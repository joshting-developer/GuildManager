import { test } from 'node:test';
import assert from 'node:assert/strict';

import { join } from 'node:path';

import { createTestRepository as createRepository, reopenTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';

import { BATTLE_COLUMNS } from '../../src/domain/battle-records.js';
import { summarizePersonalBattles } from '../../src/domain/personal-battle-statistics.js';

const header = BATTLE_COLUMNS.map(([label]) => label).join(',');
const csv = `${header}\n空城,碎夢,2,4,3,100,10,0,200,2,1,\n同名,素問,1,1,1,20,0,40,10,0,0,0\n${header}\n敵人,鐵衣,1,2,3,30,0,0,100,1,0,0`;
async function add(repo, uid, name) {
  return (await repo.addMember({ uid, name, primaryProfessionId: 3, secondaryProfessionId: null }));
}
async function upload(repo, extra = {}, requestId = crypto.randomUUID()) {
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
  return { input, result: (await repo.saveBattleRecords(input)) };
}

test('upload matches unique exact current names; retries, duplicates and renames preserve identity and raw snapshots', async () => {
  let repo = await createRepository();
  try {
    const original = await add(repo, '001', '空城');
    await add(repo, '002', '同名');
    await add(repo, '003', '同名');
    const { input, result } = await upload(repo);
    const record = result.records[0];
    assert.equal(record.players[0].memberUid, '001');
    assert.ok(!record.players[1].memberUid);
    assert.ok(!record.players[2].memberUid);
    const database = repositoryDatabase(repo);
    const [snapshot] = await database.query('SELECT players_json FROM battle_records WHERE id = ?', [record.id]);
    assert.ok(!JSON.stringify(snapshot.players_json).includes('memberUid'));
    assert.deepEqual((await database.query('SELECT member_uid FROM battle_player_links')).map((row) => row.member_uid), ['001']);
    await repo.updateMember('001', { name: '新名字', primaryProfessionId: 3, secondaryProfessionId: null, revision: original.revision });
    await add(repo, '004', '敵人');
    const replay = await repo.saveBattleRecords(input);
    assert.equal(replay.records[0].id, record.id);
    assert.equal(replay.records[0].players[0].memberUid, '001');
    assert.equal(replay.records[0].players[2].memberUid, '004');
    await assert.rejects(upload(repo), (error) => error.code === 'BATTLE_DUPLICATE');
    assert.equal((await repo.getMemberBattleRecords('004')).total, 1);
    assert.equal((await repo.getMemberBattleRecords('002')).total, 0);
    const data = await repo.getMemberBattleRecords('001');
    assert.equal(data.member.name, '新名字');
    assert.equal(data.entries[0].player.player, '空城');
    assert.equal(data.summary.battleCount, 1);
    assert.equal(data.summary.wins, 1);
    assert.equal(data.summary.metrics.find((metric) => metric.key === 'playerDamage').total, 100);
    assert.equal(data.summary.metrics.find((metric) => metric.key === 'playerDamage').perLife, 50);
    repo = reopenTestRepository(repo);
    assert.equal((await repo.getMemberBattleRecords('001')).total, 1);
    assert.equal((await repo.getBattleRecord(record.id)).players[0].memberUid, '001');
  } finally {
    await repo.close();
  }
});

test('new members link older records; pages share full summary and failures roll back links', async () => {
  const repo = (await createRepository());
  try {
    (await upload(repo));
    (await add(repo, '001', '空城'));
    assert.equal((await repo.getMemberBattleRecords('001')).total, 1);
    for (let i = 0; i < 21; i++)
      (await upload(repo, { datetime: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    const first = (await repo.getMemberBattleRecords('001'));
    const second = (await repo.getMemberBattleRecords('001', { page: 2 }));
    assert.equal(first.entries.length, 20);
    assert.equal(second.entries.length, 2);
    assert.equal(first.total, 22);
    assert.deepEqual(first.summary, second.summary);
    assert.equal(first.summary.metrics.find((m) => m.key === 'kill').total, 44);
    assert.equal(first.entries[0].playedAt, '2026-10-24');
    // Selected rows are re-read by key, in API order, scoped to this member, with no summary.
    const all = (await repo.getMemberBattleRecords('001', { all: true })).entries;
    const key = (entry) => `${entry.recordId}:${entry.playerIndex}`;
    const picked = [all[21], all[0], all[5]];
    const reread = await repo.getMemberBattleRecords('001', { keys: [...picked.map(key), 'missing:0'].join(',') });
    assert.deepEqual(reread.entries, [all[0], all[5], all[21]]);
    assert.equal(reread.summary, undefined);
    assert.ok(all[0].createdAt);
    await add(repo, '002', '旁人');
    assert.deepEqual((await repo.getMemberBattleRecords('002', { keys: key(all[0]) })).entries, []);
    for (const bad of ['', 'x', Array.from({ length: 101 }, (_, i) => `r:${i}`).join(',')])
      await assert.rejects(repo.getMemberBattleRecords('001', { keys: bad }), (e) => e.code === 'BATTLE_FILTER_INVALID');
    (await assert.rejects(async () =>
      (await repo.saveBattleRecords({
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
      })),
    ));
    assert.equal((await repo.getMemberBattleRecords('001')).total, 22);
    (await assert.rejects(async () => (await repo.getMemberBattleRecords('001', { page: 0 }))));
    (await assert.rejects(
      async () => (await repo.getMemberBattleRecords('missing')),
      (e) => e.code === 'MEMBER_NOT_FOUND',
    ));
  } finally {
    (await repo.close());
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

test('player projection migration backfills existing JSON without changing personal history', async () => {
  const { repositoryDatabase } = await import('../helpers/mysql-repository.js');
  const { migrateMysql } = await import('../../server/database/migrate.js');
  const { mysqlMigrations } = await import('../../server/database/migrations.js');
  const repo = await createRepository();
  try {
    await add(repo, 'migration-member', '空城');
    await upload(repo);
    const before = await repo.getMemberBattleRecords('migration-member', { all: true });
    const db = repositoryDatabase(repo);
    // Later migrations must be rolled back too, otherwise the history has a gap.
    await db.query('ALTER TABLE professions DROP COLUMN revision, DROP COLUMN request_id, DROP COLUMN original_input');
    await db.query('DROP TABLE event_lineup_ob');
    await db.query('DROP TABLE event_video_move_requests');
    await db.query('DROP TABLE battle_player_stats');
    await db.query("DELETE FROM schema_migrations WHERE id IN ('0006_battle_player_stats', '0007_event_video_moves', '0008_profession_management', '0009_lineup_ob')");
    assert.deepEqual((await migrateMysql(db, mysqlMigrations)).applied, ['0006_battle_player_stats', '0007_event_video_moves', '0008_profession_management', '0009_lineup_ob']);
    assert.deepEqual(await repo.getMemberBattleRecords('migration-member', { all: true }), before);
    const paged = await repo.getMemberBattleRecords('migration-member');
    assert.deepEqual(paged.summary, summarizePersonalBattles(before.entries));
  } finally { await repo.close(); }
});
