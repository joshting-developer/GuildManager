import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';
import { BATTLE_COLUMNS } from '../../src/domain/battle-records.js';
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

test('battle records persist source CSV, image and immutable event snapshots without changing roster or lineups', async () => {
  let repo = await createTestRepository({ });
  try {
    const member = (await repo.addMember({
      uid: '001',
      name: '紅方玩家',
      primaryProfessionId: 2,
      isInGuild: true,
      isInClub: true,
    }));
    const event = (await repo.createEvent({
      title: '',
      type: 'guild_war',
      dates: ['2026-10-24'],
      requestId: 'event',
    }));
    const payload = input({ image: png, records: [record({ eventId: event.id })] });
    const saved = (await repo.saveBattleRecords(payload)).records[0];
    assert.equal(saved.playedAt, '2026-10-24T21:30:00+08:00');
    assert.equal(saved.players.length, 2);
    assert.equal(saved.image.name, '陣容.png');
    assert.deepEqual((await repo.listMembers()).members, [member]);
    assert.equal((await repo.getLineupHistory(event.id)).versions.length, 0);
    assert.equal((await repo.getBattleAttachment(saved.id, 'csv')).bytes.toString(), csv);
    assert.equal((await repo.getBattleAttachment(saved.id, 'image')).bytes.toString('base64'), png.base64);
    (await repo.updateEvent(event.id, {
      title: '後補對手',
      type: 'guild_war',
      dates: ['2026-10-25'],
      revision: 1,
    }));
    (await repo.deleteEvent(event.id, 2));
    assert.equal((await repo.getBattleRecord(saved.id)).event.title, '');
    assert.equal((await repo.getBattleRecord(saved.id)).event.dates[0], '2026-10-24');
    assert.deepEqual((await repo.saveBattleRecords(payload)).records[0], saved);
    repo = reopenTestRepository(repo);
    assert.deepEqual((await repo.saveBattleRecords(payload)).records[0], saved);
    assert.equal((await repo.listBattleRecords()).total, 1);
    assert.equal(Object.hasOwn((await repo.listBattleRecords()).records[0], 'players'), false);
  } finally {
    (await repo.close());
  }
});

test('internal scrimmages keep an explicit flag, omit enemy/result, preserve retries and reject other battle types', async () => {
  let repo = await createTestRepository({ });
  try {
    const event = (await repo.createEvent({
      type: 'scrimmage',
      title: '內推',
      dates: ['2026-10-24'],
      requestId: 'internal-event',
    }));
    const payload = input({
      records: [
        record({
          type: event.type,
          eventId: event.id,
          datetime: event.dates[0],
          roundNumber: 2,
          isInternal: true,
          winner: null,
          ourSide: null,
        }),
      ],
    });
    const saved = (await repo.saveBattleRecords(payload)).records[0];
    assert.equal(saved.isInternal, true);
    assert.equal(saved.winner, null);
    assert.equal(saved.ourSide, null);
    assert.deepEqual((await repo.saveBattleRecords(payload)).records[0], saved);
    for (const extra of [
      { isInternal: 'true' },
      { type: 'guild_war' },
      { type: 'dragon_tiger' },
      { winner: 'red' },
      { ourSide: 'blue' },
    ]) {
      await assert.rejects(async () =>
        (await repo.saveBattleRecords({
          ...payload,
          requestId: 'bad-internal',
          records: [{ ...payload.records[0], ...extra }],
        })),
      );
    }
    repo = reopenTestRepository(repo);
    assert.deepEqual((await repo.getBattleRecord(saved.id)), saved);
    const first = (await repo.saveBattleRecords(
      input({ requestId: 'internal-first', records: [{ ...payload.records[0], roundNumber: 1 }] }),
    )).records[0];
    assert.equal(first.isInternal, true);
  } finally {
    (await repo.close());
  }
});

test('guild wars persist two rounds with different opponents/results and allow a single-round week or later supplement', async () => {
  let repo = await createTestRepository({ });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const event = (await repo.createEvent({
      type: 'guild_war',
      title: '',
      dates: ['2026-10-24'],
      requestId: 'guild-two-rounds',
    }));
    const authFetch = await authenticatedFetch(server, repo);
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = createBattleRecordClient({
      fetchImpl: (url, options) => authFetch(base + url, options),
    });
    const linked = (roundNumber, extra = {}) =>
      record({
        eventId: event.id,
        datetime: event.dates[0],
        roundNumber,
        redTeam: '我方',
        blueTeam: roundNumber === 1 ? '第一場對手' : '第二場對手',
        winner: roundNumber === 1 ? 'red' : 'blue',
        ourSide: 'red',
        ...extra,
      });
    const payload = input({ requestId: 'guild-second-first', records: [linked(2)] });
    const second = (await client.saveRecords(payload)).records[0];
    assert.equal(second.roundNumber, 2);
    assert.equal(second.blueTeam, '第二場對手');
    assert.equal(second.winner, 'blue');
    assert.deepEqual((await client.saveRecords(payload)).records[0], second);
    assert.deepEqual(
      (await client.getRecords(1, event.id)).records.map((r) => r.roundNumber),
      [2],
    );
    const first = (
      await client.saveRecords(input({ requestId: 'guild-first', records: [linked(1)] }))
    ).records[0];
    assert.equal(first.blueTeam, '第一場對手');
    assert.equal(first.winner, 'red');
    assert.deepEqual((await repo.getBattleRecord(second.id)), second);
    await assert.rejects(
      client.saveRecords(
        input({ requestId: 'guild-occupied', records: [linked(1, { blueTeam: '另一個對手' })] }),
      ),
      (error) => error.code === 'BATTLE_ROUND_EXISTS',
    );
    for (const extra of [{ roundNumber: 3 }, { isInternal: true, winner: null, ourSide: null }])
      await assert.rejects(
        client.saveRecords(input({ requestId: 'guild-invalid', records: [linked(2, extra)] })),
      );
    const week = (await repo.createEvent({
      type: 'guild_war',
      title: '單場週',
      dates: ['2026-10-31'],
      requestId: 'guild-one-week',
    }));
    const single = (await repo.saveBattleRecords(
      input({
        requestId: 'single-week',
        records: [linked(1, { eventId: week.id, datetime: week.dates[0] })],
      }),
    )).records[0];
    assert.equal((await repo.listBattleRecords({ eventId: week.id })).total, 1);
    const batch = (await repo.createEvent({
      type: 'guild_war',
      title: '雙場週',
      dates: ['2026-11-07'],
      requestId: 'guild-batch-week',
    }));
    const records = (await repo.saveBattleRecords(
      input({
        requestId: 'batch-week',
        records: [1, 2].map((round) =>
          linked(round, { eventId: batch.id, datetime: batch.dates[0] }),
        ),
      }),
    )).records;
    assert.deepEqual(
      records.map((r) => r.roundNumber),
      [1, 2],
    );
    assert.notEqual(records[0].blueTeam, records[1].blueTeam);
    await new Promise((resolve) => server.close(resolve));
    repo = reopenTestRepository(repo);
    assert.deepEqual((await repo.getBattleRecord(first.id)), first);
    assert.deepEqual((await repo.getBattleRecord(second.id)), second);
    assert.deepEqual((await repo.getBattleRecord(single.id)), single);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
