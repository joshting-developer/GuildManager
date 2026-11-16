import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { fixtureCsv } from "../helpers/gas-runtime.js";

const member = { uid: '001', name: '城', primaryProfessionId: 3 };
const upload = (type = 'scrimmage', eventId = null, roundNumber) => ({
  requestId: `upload-${type}-${roundNumber || 'old'}`,
  records: [
    {
      type,
      eventId,
      ...(roundNumber ? { roundNumber } : {}),
      filename: 'battle.csv',
      csvText: fixtureCsv(),
      datetime: '2026-10-05T00:00:00',
      redTeam: '原紅方',
      blueTeam: '原藍方',
      winner: null,
      ourSide: null,
    },
  ],
});
const patch = (extra = {}) => ({
  redTeam: '新紅方',
  blueTeam: '新藍方',
  winner: 'red',
  ourSide: 'red',
  isInternal: false,
  revision: 0,
  requestId: 'edit-one',
  ...extra,
});
const code = (expected) => (error) => error.code === expected;
async function checks(
  { get, update, list, attachment, personal, save },
  first,
  second,
  ordinary,
  savedInput,
) {
  const original = (await get(first.id));
  const csv = (await attachment(first.id));
  const changed = (await update(first.id, patch())).record;
  assert.equal(changed.winner, 'red');
  assert.equal(changed.revision, 1);
  assert.equal((await list()).find((row) => row.id === first.id).redTeam, '新紅方');
  assert.equal((await personal()).summary.wins, 1);
  assert.equal((await get(second.id)).revision, 0);
  const internal = (await update(
    first.id,
    patch({ revision: 1, requestId: 'internal', isInternal: true }),
  )).record;
  assert.equal(internal.isInternal, true);
  assert.equal(internal.winner, null);
  assert.equal(internal.ourSide, null);
  assert.equal((await personal()).summary.wins, 0);
  assert.equal((await personal()).summary.unknown, 3);
  assert.deepEqual(
    (await update(first.id, patch({ revision: 1, requestId: 'internal', isInternal: true }))).record,
    internal,
  );
  (await assert.rejects(
    async () => (await update(first.id, patch({ revision: 1, requestId: 'stale' }))),
    code('REVISION_CONFLICT'),
  ));
  (await assert.rejects(
    async () => (await update(first.id, patch({ revision: 1, requestId: 'internal', redTeam: '不同操作' }))),
    code('REQUEST_CONFLICT'),
  ));
  const regular = (await update(
    first.id,
    patch({ revision: 2, requestId: 'regular', winner: 'blue' }),
  )).record;
  assert.equal(regular.isInternal, false);
  assert.equal((await personal()).summary.losses, 1);
  assert.deepEqual((await get(first.id)).players, original.players);
  for (const key of [
    'event',
    'eventId',
    'type',
    'playedAt',
    'roundNumber',
    'filename',
    'createdAt',
    'redCount',
    'blueCount',
  ])
    assert.deepEqual((await get(first.id))[key], original[key]);
  assert.deepEqual((await attachment(first.id)), csv);
  assert.equal((await save(savedInput)).records[0].id, first.id);
  assert.equal((await get(first.id)).revision, 3);
  for (const values of [
    { redTeam: '' },
    { blueTeam: 'a\nname' },
    { winner: 'draw' },
    { ourSide: 'other' },
    { isInternal: 'true' },
    { revision: -1 },
    { revision: 0.5 },
    { requestId: '' },
    { players: [] },
    { type: 'guild_war' },
    { roundNumber: 2 },
    { csvText: 'change' },
  ])
    (await assert.rejects(
      async () => (await update(first.id, patch({ revision: 3, requestId: 'invalid', ...values }))),
      code('BATTLE_INVALID'),
    ));
  (await assert.rejects(async () => (await update(ordinary.id, patch({ isInternal: true }))), code('BATTLE_INVALID')));
  (await assert.rejects(async () => (await update('missing', patch())), code('BATTLE_NOT_FOUND')));
  return regular;
}

test('MySQL result editing preserves CSV, players, member links and round identity; latest personal analysis reflects corrections', async () => {
  const repo = (await createRepository());
  try {
    (await repo.addMember(member));
    const event = (await repo.createEvent({
      type: 'scrimmage',
      title: '約戰',
      dates: ['2026-10-05'],
      requestId: 'event',
    }));
    const savedInput = upload('scrimmage', event.id, 1);
    const first = (await repo.saveBattleRecords(savedInput)).records[0];
    const second = (await repo.saveBattleRecords(upload('scrimmage', event.id, 2))).records[0];
    const ordinary = (await repo.saveBattleRecords(upload('guild_war'))).records[0];
    (await repo.deleteEvent(event.id, event.revision));
    (await checks(
      {
        get: async (id) => (await repo.getBattleRecord(id)),
        update: async (id, input) => (await repo.updateBattleRecord(id, input)),
        list: async () => (await repo.listBattleRecords()).records,
        attachment: async (id) => (await repo.getBattleAttachment(id, 'csv')),
        personal: async () =>
          (await repo.getMemberBattleRecords('001', { startDate: '2026-10-05', endDate: '2026-10-05' })),
        save: async (input) => (await repo.saveBattleRecords(input)),
      },
      first,
      second,
      ordinary,
      savedInput,
    ));
  } finally {
    (await repo.close());
  }
});
