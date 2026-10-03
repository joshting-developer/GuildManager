import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { createBattleRecordClient } from '../src/api/battle-records.js';
import {
  BATTLE_COLUMNS,
  parseBattleCsv,
  taipeiBattleTime,
  battleFilenameDefaults,
} from '../src/domain/battle-records.js';
const header = BATTLE_COLUMNS.map(([title]) => title).join(',');
const csv = `${header}\r\n紅方玩家,素問,1,2,3,400,0,500,600,1,2,0\r\n${header}\r\n藍方玩家,碎夢,2,3,4,500,1,0,400,2,1,1\r\n`;
const record = (extra = {}) => ({
  filename: '20261024_213000_紅幫_藍幫.csv',
  csvText: csv,
  datetime: '2026-10-24T21:30:00',
  redTeam: '紅幫',
  blueTeam: '藍幫',
  winner: 'red',
  type: 'guild_war',
  eventId: null,
  ...extra,
});
const input = (extra = {}) => ({ requestId: 'upload', records: [record()], image: null, ...extra });
const png = {
  name: '陣容.png',
  mimeType: 'image/png',
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
};

test('battle CSV handles BOM, team headers, reordered columns, escaped names, quoted thousands and missing metrics', () => {
  const parsed = parseBattleCsv('\ufeff' + csv);
  assert.deepEqual([parsed.redCount, parsed.blueCount], [1, 1]);
  assert.equal(parsed.players[0].heal, 500);
  const special = csv.replace('紅方玩家,素問,1,2,3,400', '"玩家,\"\"名字\"\"",素問,1,2,3,"1,234"');
  const player = parseBattleCsv(special).players[0];
  assert.equal(player.player, '玩家,"名字"');
  assert.equal(player.playerDamage, 1234);
  const old = csv
    .split('\r\n')
    .filter(Boolean)
    .map((line) => line.split(',').slice(0, 11).join(','))
    .join('\n');
  assert.equal(parseBattleCsv(old).players[0].burnBone, null);
  assert.equal(parseBattleCsv(csv.replace(',600,', ',—,')).players[0].damageTaken, null);
  const reordered = csv
    .split('\r\n')
    .filter(Boolean)
    .map((line) => line.split(',').reverse().join(','))
    .join('\n');
  assert.deepEqual(parseBattleCsv(reordered), parsed);
});

test('battle CSV rejects malformed quotes, headers, numeric data, oversized exports and invalid dates', () => {
  for (const bad of [
    '',
    'garbage,a,b',
    header + '\n',
    csv.replace('400', '-1'),
    csv.replace('400', '9007199254740992'),
    csv.replace('職業', '職業X'),
    csv + '"unclosed',
    csv + header + '\n',
    'a'.repeat(1024 * 1024 + 1),
    csv.replace('素問', '\ufffd'),
  ])
    assert.throws(() => parseBattleCsv(bad));
  assert.equal(taipeiBattleTime('2026-10-24T00:30'), '2026-10-24T00:30:00+08:00');
  assert.equal(taipeiBattleTime('2026-10-24'), '2026-10-24');
  assert.throws(() => taipeiBattleTime('2026-02-29'));
  for (const bad of [
    '2026-02-29T21:00',
    '2026-13-01T21:00',
    '2026-10-24T24:00',
    '2026-10-24T21:60',
    '2026-10-24T21:00Z',
  ])
    assert.throws(() => taipeiBattleTime(bad));
  assert.deepEqual(battleFilenameDefaults('20261024_213000_紅幫_藍幫.csv'), {
    datetime: '2026-10-24T21:30:00',
    redTeam: '紅幫',
    blueTeam: '藍幫',
  });
  assert.equal(battleFilenameDefaults('20260229_213000_紅幫_藍幫.csv').datetime, '');
  assert.equal(battleFilenameDefaults('其他.csv').redTeam, '');
});

test('battle records persist source CSV, image and immutable event snapshots without changing roster or lineups', () => {
  const directory = mkdtempSync('/private/tmp/battle-records-test-'),
    filename = directory + '/test.sqlite';
  let repo = createRepository({ filename });
  try {
    const member = repo.addMember({
      uid: '001',
      name: '紅方玩家',
      primaryProfessionId: 2,
      isInGuild: true,
      isInClub: true,
    });
    const event = repo.createEvent({
      title: '',
      type: 'guild_war',
      dates: ['2026-10-24'],
      requestId: 'event',
    });
    const payload = input({ image: png, records: [record({ eventId: event.id })] });
    const saved = repo.saveBattleRecords(payload).records[0];
    assert.equal(saved.playedAt, '2026-10-24T21:30:00+08:00');
    assert.equal(saved.players.length, 2);
    assert.equal(saved.image.name, '陣容.png');
    assert.deepEqual(repo.listMembers().members, [member]);
    assert.equal(repo.getLineupHistory(event.id).versions.length, 0);
    assert.equal(repo.getBattleAttachment(saved.id, 'csv').bytes.toString(), csv);
    assert.equal(repo.getBattleAttachment(saved.id, 'image').bytes.toString('base64'), png.base64);
    repo.updateEvent(event.id, {
      title: '後補對手',
      type: 'guild_war',
      dates: ['2026-10-25'],
      revision: 1,
    });
    repo.deleteEvent(event.id, 2);
    assert.equal(repo.getBattleRecord(saved.id).event.title, '');
    assert.equal(repo.getBattleRecord(saved.id).event.dates[0], '2026-10-24');
    assert.deepEqual(repo.saveBattleRecords(payload).records[0], saved);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.saveBattleRecords(payload).records[0], saved);
    assert.equal(repo.listBattleRecords().total, 1);
    assert.equal(Object.hasOwn(repo.listBattleRecords().records[0], 'players'), false);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('batch save validates every item, rolls back database failure and prevents duplicates and conflicting retries', () => {
  const directory = mkdtempSync('/private/tmp/battle-atomic-'),
    filename = directory + '/test.sqlite',
    repo = createRepository({ filename }),
    db = new Database(filename);
  try {
    assert.throws(() =>
      repo.saveBattleRecords(input({ records: [record(), record({ winner: '' })] })),
    );
    assert.equal(repo.listBattleRecords().total, 0);
    db.exec(
      "CREATE TRIGGER reject_battle BEFORE INSERT ON battle_records BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    assert.throws(() => repo.saveBattleRecords(input()), /test rollback/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM battle_uploads').get().n, 0);
    db.exec('DROP TRIGGER reject_battle');
    const saved = repo.saveBattleRecords(input());
    assert.deepEqual(repo.saveBattleRecords(input()), saved);
    assert.throws(
      () => repo.saveBattleRecords(input({ records: [record({ winner: 'blue' })] })),
      (error) => error.code === 'REQUEST_CONFLICT',
    );
    assert.throws(
      () =>
        repo.saveBattleRecords(
          input({
            requestId: 'new-id',
            records: [record({ filename: 'renamed.csv', csvText: '\ufeff' + csv })],
          }),
        ),
      (error) => error.code === 'BATTLE_DUPLICATE',
    );
    assert.throws(
      () =>
        repo.saveBattleRecords(
          input({
            requestId: 'dupe-batch',
            records: [
              record({ datetime: '2026-10-25T21:30' }),
              record({ datetime: '2026-10-25T21:30' }),
            ],
          }),
        ),
      /重複/,
    );
    const batch = repo.saveBattleRecords(
      input({
        requestId: 'two',
        records: [
          record({ datetime: '2026-10-25T21:30' }),
          record({ datetime: '2026-10-25T22:30' }),
        ],
      }),
    );
    assert.equal(batch.records.length, 2);
    assert.equal(repo.listBattleRecords().total, 3);
  } finally {
    db.close();
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('event links, image signatures and payload limits are enforced by server', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const event = repo.createEvent({
      title: '',
      type: 'guild_war',
      dates: ['2026-10-24'],
      requestId: 'event',
    });
    for (const extra of [
      { eventId: 'missing' },
      { eventId: event.id, type: 'scrimmage' },
      { eventId: event.id, datetime: '2026-10-25T21:30' },
    ])
      assert.throws(() => repo.saveBattleRecords(input({ records: [record(extra)] })));
    for (const image of [
      { ...png, mimeType: 'image/svg+xml' },
      { ...png, base64: Buffer.from('<html>').toString('base64') },
      { ...png, base64: '!' },
      { ...png, base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') },
    ])
      assert.throws(() => repo.saveBattleRecords(input({ image })));
    assert.throws(() => repo.saveBattleRecords(input({ records: Array(3).fill(record()) })));
    assert.throws(
      () => repo.getBattleRecord('missing'),
      (error) => error.status === 404,
    );
    assert.throws(() => repo.listBattleRecords({ page: NaN }));
    assert.equal(repo.listBattleRecords().total, 0);
  } finally {
    repo.close();
  }
});

test('upload, list, detail and download APIs require login, mutation requires CSRF and adapter preserves failures', async () => {
  const repo = createRepository({ filename: ':memory:' }),
    server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of [
      '/api/battle-records',
      '/api/battle-records/anything',
      '/api/battle-records/anything/attachments/csv',
    ])
      assert.equal((await fetch(base + path)).status, 401);
    assert.equal(
      (
        await fetch(base + '/api/battle-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input()),
        })
      ).status,
      401,
    );
    const authFetch = await authenticatedFetch(server, repo);
    const denied = await authFetch(base + '/api/battle-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'invalid' },
      body: JSON.stringify(input()),
    });
    assert.equal(denied.status, 403);
    const client = createBattleRecordClient({
      fetchImpl: (url, options) => authFetch(base + url, options),
    });
    const saved = (await client.saveRecords(input({ image: png }))).records[0];
    assert.equal((await client.getRecords()).total, 1);
    assert.equal((await client.getRecord(saved.id)).record.players.length, 2);
    assert.equal(await (await client.getAttachment(saved.id, 'csv')).text(), csv);
    assert.equal((await client.getAttachment(saved.id, 'image')).type, 'image/png');
    const download = await authFetch(base + `/api/battle-records/${saved.id}/attachments/image`);
    assert.match(download.headers.get('content-disposition'), /^attachment/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    await assert.rejects(
      client.saveRecords(input({ requestId: 'duplicate' })),
      (error) => error.code === 'BATTLE_DUPLICATE',
    );
    await assert.rejects(createBattleRecordClient({ source: 'gas' }).getRecords(), /尚未串接/);
    const failing = createBattleRecordClient({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await assert.rejects(failing.saveRecords(input()), /無法連線/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
