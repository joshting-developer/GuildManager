import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { createMemberClient } from '../src/api/members.js';
import { BATTLE_COLUMNS } from '../src/domain/battle-records.js';
import { summarizePersonalBattles } from '../src/domain/personal-battle-statistics.js';

const header = BATTLE_COLUMNS.map(([label]) => label).join(',');
const csv = `${header}\n空城,碎夢,2,4,3,100,10,0,200,2,1,\n同名,素問,1,1,1,20,0,40,10,0,0,0\n${header}\n敵人,鐵衣,1,2,3,30,0,0,100,1,0,0`;
function add(repo, uid, name) {
  return repo.addMember({ uid, name, primaryProfessionId: 3, secondaryProfessionId: null });
}
function upload(repo, extra = {}, requestId = crypto.randomUUID()) {
  const input = {
    requestId,
    records: [
      {
        filename: 'battle.csv',
        csvText: csv,
        type: 'scrimmage',
        datetime: '2026-10-24',
        redTeam: '我方',
        blueTeam: '對手',
        winner: 'red',
        ...extra,
      },
    ],
  };
  return { input, result: repo.saveBattleRecords(input) };
}

test('upload matches unique exact current names in its transaction; retries, duplicates and renames preserve identity and raw snapshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-personal-'));
  const filename = join(dir, 'test.sqlite');
  let repo = createRepository({ filename });
  try {
    const original = add(repo, '001', '空城');
    add(repo, '002', '同名');
    add(repo, '003', '同名');
    const { input, result } = upload(repo);
    const record = result.records[0];
    assert.equal(record.players[0].memberUid, '001');
    assert.ok(!record.players[1].memberUid);
    assert.ok(!record.players[2].memberUid);
    const inspect = new Database(filename, { readonly: true });
    const snapshot = inspect
      .prepare(
        'SELECT players_json, input_hash FROM battle_records r JOIN battle_uploads u ON u.id = r.upload_id WHERE r.id = ?',
      )
      .get(record.id);
    assert.ok(!snapshot.players_json.includes('memberUid'));
    assert.deepEqual(inspect.prepare('SELECT member_uid FROM battle_player_links').all(), [
      { member_uid: '001' },
    ]);
    assert.equal(
      inspect.prepare('SELECT csv_text FROM battle_records WHERE id = ?').get(record.id).csv_text,
      csv,
    );
    inspect.close();
    repo.updateMember('001', {
      name: '新名字',
      primaryProfessionId: 3,
      secondaryProfessionId: null,
      revision: original.revision,
    });
    add(repo, '004', '敵人');
    assert.deepEqual(repo.saveBattleRecords(input), result);
    assert.throws(
      () => upload(repo),
      (e) => e.code === 'BATTLE_DUPLICATE',
    );
    assert.equal(repo.getMemberBattleRecords('004').total, 0);
    assert.equal(repo.getMemberBattleRecords('002').total, 0);
    const data = repo.getMemberBattleRecords('001');
    assert.equal(data.member.name, '新名字');
    assert.equal(data.entries[0].player.player, '空城');
    assert.equal(data.summary.battleCount, 1);
    assert.equal(data.summary.wins, 1);
    assert.equal(data.summary.metrics.find((m) => m.key === 'playerDamage').total, 100);
    assert.equal(data.summary.metrics.find((m) => m.key === 'playerDamage').perLife, 50);
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.getMemberBattleRecords('001').total, 1);
    assert.equal(repo.getBattleRecord(record.id).players[0].memberUid, '001');
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('old unlinked records are never backfilled; pages share full summary and failures roll back links', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    upload(repo);
    add(repo, '001', '空城');
    assert.equal(repo.getMemberBattleRecords('001').total, 0);
    for (let i = 0; i < 21; i++)
      upload(repo, { datetime: `2026-10-${String(i + 1).padStart(2, '0')}` });
    const first = repo.getMemberBattleRecords('001');
    const second = repo.getMemberBattleRecords('001', { page: 2 });
    assert.equal(first.entries.length, 20);
    assert.equal(second.entries.length, 1);
    assert.equal(first.total, 21);
    assert.deepEqual(first.summary, second.summary);
    assert.equal(first.summary.metrics.find((m) => m.key === 'kill').total, 42);
    assert.equal(first.entries[0].playedAt, '2026-10-21');
    assert.throws(() =>
      repo.saveBattleRecords({
        requestId: 'invalid-pair',
        records: [
          {
            filename: 'new.csv',
            csvText: csv,
            type: 'scrimmage',
            datetime: '2026-11-01',
            redTeam: '我方',
            blueTeam: '對手',
          },
          {
            filename: 'bad.csv',
            csvText: csv,
            type: 'guild_war',
            datetime: '2026-11-01',
            eventId: 'missing',
            redTeam: '我方',
            blueTeam: '對手',
          },
        ],
      }),
    );
    assert.equal(repo.getMemberBattleRecords('001').total, 21);
    assert.throws(() => repo.getMemberBattleRecords('001', { page: 0 }));
    assert.throws(
      () => repo.getMemberBattleRecords('missing'),
      (e) => e.code === 'MEMBER_NOT_FOUND',
    );
  } finally {
    repo.close();
  }
});

test('personal analysis preserves missing values and unknown results; same battle on both sides counts once', () => {
  const entries = [
    {
      recordId: 'one',
      winner: 'red',
      player: { side: 'red', playerDamage: 100, seriousInjury: 2 },
    },
    {
      recordId: 'one',
      winner: 'red',
      player: { side: 'blue', playerDamage: 200, seriousInjury: 0 },
    },
    {
      recordId: 'two',
      winner: 'blue',
      isInternal: true,
      player: { side: 'blue', playerDamage: null, seriousInjury: 1 },
    },
    {
      recordId: 'three',
      winner: null,
      player: { side: 'red', playerDamage: 300, seriousInjury: null },
    },
  ];
  const summary = summarizePersonalBattles(entries);
  assert.equal(summary.battleCount, 3);
  assert.equal(summary.rowCount, 4);
  assert.deepEqual([summary.wins, summary.losses, summary.unknown], [0, 0, 3]);
  const damage = summary.metrics.find((m) => m.key === 'playerDamage');
  assert.deepEqual(damage, {
    label: '對玩家傷害',
    key: 'playerDamage',
    total: 600,
    average: 200,
    missing: 1,
    perLife: 100,
    perLifeMissing: 2,
  });
  assert.equal(summary.metrics.find((m) => m.key === 'heal').total, null);
  assert.equal(summarizePersonalBattles([]).battleCount, 0);
});

test('personal API and adapter reject anonymous access, support member and manager and surface GAS failure', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const member = add(repo, '001', '空城');
  upload(repo);
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/members/001/battle-records`)).status, 401);
    const authenticated = await authenticatedFetch(server, repo);
    const fetchImpl = (path, init) => authenticated(base + path, init);
    const client = createMemberClient({ fetchImpl });
    assert.equal((await client.getBattleRecords(member.uid)).total, 1);
    await assert.rejects(client.getBattleRecords('missing'), (e) => e.code === 'MEMBER_NOT_FOUND');
    const admin = (
      await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' })
    ).user;
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    const response = await fetch(`${base}/api/auth/member-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '001234' }),
    });
    assert.equal(
      (
        await fetch(`${base}/api/members/001/battle-records`, {
          headers: { Cookie: response.headers.get('set-cookie').split(';')[0] },
        })
      ).status,
      200,
    );
    const manager = await repo.createManager(admin.id, {
      username: 'manager',
      password: 'test-password-2026',
    });
    const login = await repo.authenticate({
      username: manager.username,
      password: 'test-password-2026',
    });
    assert.equal(
      (
        await fetch(`${base}/api/members/001/battle-records`, {
          headers: { Cookie: `guild_session=${login.token}` },
        })
      ).status,
      200,
    );
    const run = {
      withSuccessHandler(fn) {
        this.done = fn;
        return this;
      },
      withFailureHandler(fn) {
        this.fail = fn;
        return this;
      },
      getMemberBattleRecords(uid, page) {
        assert.equal(uid, '001');
        assert.equal(page, 2);
        this.fail({ message: '尚未串接' });
      },
    };
    await assert.rejects(
      createMemberClient({
        source: 'gas',
        googleRun: run,
        fetchImpl: () => assert.fail('no HTTP'),
      }).getBattleRecords('001', 2),
      /尚未串接/,
    );
  } finally {
    await new Promise((r) => server.close(r));
    repo.close();
  }
});

test('adding the link table to an existing database preserves old snapshots and retry responses without backfill', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-old-personal-'));
  const filename = join(dir, 'old.sqlite');
  let repo = createRepository({ filename });
  try {
    const { input, result } = upload(repo);
    repo.close();
    const db = new Database(filename);
    db.exec('DROP TABLE battle_player_links');
    const before = db.prepare('SELECT * FROM battle_records').all();
    db.close();
    repo = createRepository({ filename });
    add(repo, '001', '空城');
    assert.deepEqual(repo.saveBattleRecords(input), result);
    assert.equal(repo.getMemberBattleRecords('001').total, 0);
    const inspect = new Database(filename, { readonly: true });
    assert.deepEqual(inspect.prepare('SELECT * FROM battle_records').all(), before);
    assert.equal(inspect.pragma('foreign_key_check').length, 0);
    inspect.close();
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
