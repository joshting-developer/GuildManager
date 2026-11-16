import { asyncMap } from "../../server/mysql/collections.js";
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import {
  BATTLE_COLUMNS,
  parseBattleCsv,
  taipeiBattleTime,
  battleFilenameDefaults,
} from '../../src/domain/battle-records.js';
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

test('event links, image signatures and payload limits are enforced by server', async () => {
  const repo = (await createRepository());
  try {
    const event = (await repo.createEvent({
      title: '',
      type: 'guild_war',
      dates: ['2026-10-24'],
      requestId: 'event',
    }));
    for (const extra of [
      { eventId: 'missing' },
      { eventId: event.id, type: 'scrimmage' },
      { eventId: event.id, datetime: '2026-10-25T21:30' },
    ])
      (await assert.rejects(async () => (await repo.saveBattleRecords(input({ records: [record(extra)] })))));
    for (const image of [
      { ...png, mimeType: 'image/svg+xml' },
      { ...png, base64: Buffer.from('<html>').toString('base64') },
      { ...png, base64: '!' },
      { ...png, base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') },
    ])
      (await assert.rejects(async () => (await repo.saveBattleRecords(input({ image })))));
    (await assert.rejects(async () => (await repo.saveBattleRecords(input({ records: Array(3).fill(record()) })))));
    (await assert.rejects(
      async () => (await repo.getBattleRecord('missing')),
      (error) => error.status === 404,
    ));
    (await assert.rejects(async () => (await repo.listBattleRecords({ page: NaN }))));
    assert.equal((await repo.listBattleRecords()).total, 0);
  } finally {
    (await repo.close());
  }
});

test('game team summaries supply names and warn about count differences without confusing player rows', () => {
  const exported = `我方,1\n${header}\n空城,碎夢,0,0,780,0,14007676,0,1388582,0,0,0\n\n敵方,1\n${header}\n對手,鐵衣,0,0,0,0,0,0,0,0,0,0\n`;
  const parsed = parseBattleCsv(exported);
  assert.deepEqual(
    [parsed.redTeam, parsed.blueTeam, parsed.redCount, parsed.blueCount],
    ['我方', '敵方', 1, 1],
  );
  assert.equal(parsed.players[1].playerDamage, 0);
  const mismatched = parseBattleCsv(exported.replace('我方,1', '我方,2'));
  assert.deepEqual(mismatched.players, parsed.players);
  assert.deepEqual([mismatched.redCount, mismatched.blueCount], [1, 1]);
  assert.match(mismatched.warnings[0], /摘要為 2 人.*實際玩家戰績為 1 筆/);
  assert.equal(parsed.warnings, undefined);
  assert.throws(() => parseBattleCsv(exported.replace('我方,1', '我方,-1')));
  assert.throws(() => parseBattleCsv(exported.replace('我方,1', '我方,9007199254740992')), /摘要人數/);
  assert.throws(() => parseBattleCsv(exported + '假摘要,1\n'));
});

test('event rounds allow second-round-first, separate retries and reject occupied or invalid rounds atomically', async () => {
  const repo = (await createRepository());
  try {
    const events = (await asyncMap(['scrimmage', 'guild_war', 'dragon_tiger'], async (type) =>
      (await repo.createEvent({
        type,
        title: '測試場次',
        dates: ['2026-10-24'],
        requestId: `event-${type}`,
      }))));
    const linked = (event, roundNumber) =>
      record({
        type: event.type,
        eventId: event.id,
        datetime: event.dates[0],
        roundNumber,
      });
    const payload = input({ requestId: 'second', records: [linked(events[0], 2)] });
    const second = (await repo.saveBattleRecords(payload)).records[0];
    assert.equal(second.roundNumber, 2);
    assert.equal(second.playedAt, '2026-10-24');
    assert.deepEqual((await repo.saveBattleRecords(payload)).records[0], second);
    (await assert.rejects(
      async () => (await repo.saveBattleRecords({ ...payload, requestId: 'occupied' })),
      (error) => error.code === 'BATTLE_ROUND_EXISTS',
    ));
    for (const roundNumber of [0, 3, '1', null]) {
      (await assert.rejects(async () =>
        (await repo.saveBattleRecords(
          input({ requestId: `invalid-${roundNumber}`, records: [linked(events[0], roundNumber)] }),
        )),
      ));
    }
    (await assert.rejects(async () => (await repo.saveBattleRecords(input({ records: [record({ roundNumber: 1 })] })))));
    for (const event of events.slice(2)) {
      (await assert.rejects(async () =>
        (await repo.saveBattleRecords(
          input({ requestId: event.type, records: [linked(event, 1), linked(event, 2)] }),
        )),
      ));
      assert.equal((await repo.listBattleRecords({ eventId: event.id })).total, 0);
      assert.equal(
        (await repo.saveBattleRecords(
          input({ requestId: `one-${event.type}`, records: [linked(event, 1)] }),
        )).records[0].roundNumber,
        1,
      );
    }
    const first = (await repo.saveBattleRecords(
      input({ requestId: 'first', records: [linked(events[0], 1)] }),
    )).records[0];
    assert.equal(first.roundNumber, 1);
    assert.notEqual(first.id, second.id);
    assert.deepEqual(
      (await repo
        .listBattleRecords({ eventId: events[0].id }))
        .records.map((r) => r.roundNumber)
        .sort(),
      [1, 2],
    );
    assert.equal((await repo.listBattleRecords()).total, 3);
    const other = (await repo.createEvent({
      type: 'scrimmage',
      title: '另一場',
      dates: ['2026-10-24'],
      requestId: 'other',
    }));
    (await assert.rejects(
      async () =>
        (await repo.saveBattleRecords(
          input({ requestId: 'same-round', records: [linked(other, 1), linked(other, 1)] }),
        )),
      /同一場/,
    ));
    assert.equal((await repo.listBattleRecords({ eventId: other.id })).total, 0);
    assert.equal(
      (await repo.saveBattleRecords(
        input({ requestId: 'two-rounds', records: [linked(other, 1), linked(other, 2)] }),
      )).records.length,
      2,
    );
    (await repo.deleteEvent(events[0].id, 1));
    assert.deepEqual((await repo.saveBattleRecords(payload)).records[0], second);
  } finally {
    (await repo.close());
  }
});
