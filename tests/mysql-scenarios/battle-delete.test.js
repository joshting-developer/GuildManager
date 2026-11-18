import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

const member = { uid: '001', name: '城', primaryProfessionId: 3 };
const upload = (eventId, roundNumber, requestId, redTeam = '紅方') => ({
  requestId,
  records: [{
    type: 'scrimmage', eventId, roundNumber, filename: 'battle.csv', csvText: fixtureCsv(),
    datetime: '2026-10-05T00:00:00', redTeam, blueTeam: '藍方', winner: null, ourSide: null,
  }],
});

// The same file can be uploaded again after the mistaken one is deleted.
async function checks({ save, remove, get, list, personal }, eventId) {
  const wrong = (await save(upload(eventId, 1, 'wrong', '傳錯的'))).records[0];
  assert.equal((await personal()).total, 1);
  await assert.rejects(async () => (await save(upload(eventId, 1, 'again'))), (e) => e.code === 'BATTLE_ROUND_EXISTS');
  await assert.rejects(async () => (await remove(wrong.id, wrong.revision + 1)), (e) => e.code === 'REVISION_CONFLICT');
  assert.deepEqual((await remove(wrong.id, wrong.revision)), { deleted: true, id: wrong.id });
  await assert.rejects(async () => (await get(wrong.id)), (e) => e.code === 'BATTLE_NOT_FOUND');
  assert.deepEqual((await list()), []);
  assert.equal((await personal()).total, 0, 'personal records drop the deleted battle');
  assert.deepEqual((await remove(wrong.id, wrong.revision)), { deleted: true, id: wrong.id }, 'repeat is a no-op');
  const fixed = (await save(upload(eventId, 1, 'fixed', '正確的'))).records[0];
  assert.equal((await get(fixed.id)).redTeam, '正確的');
  assert.equal((await personal()).total, 1);
}

test('local managers delete a mistaken battle upload so the round can be uploaded again', async () => {
  const repo = await createTestRepository({ });
  (await repo.addMember(member));
  const event = (await repo.createEvent({ type: 'scrimmage', title: '約戰', dates: ['2026-10-05'], requestId: 'event' }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createBattleRecordClient({ fetchImpl: (path, init) => fetch(base + path, init) });
  try {
    await checks({
      save: async (input) => (await repo.saveBattleRecords(input)),
      remove: async (id, revision) => (await repo.deleteBattleRecord(id, revision)),
      get: async (id) => (await repo.getBattleRecord(id)),
      list: async () => (await repo.listBattleRecords({ eventId: event.id })).records,
      personal: async () => (await repo.getMemberBattleRecords('001', {})),
    }, event.id);
    const record = (await repo.listBattleRecords({ eventId: event.id })).records[0];
    const anonymous = await globalThis.fetch(`${base}/api/battle-records/${record.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0 }),
    });
    assert.equal(anonymous.status, 401, 'signed-out visitors cannot delete');
    assert.deepEqual(await client.deleteRecord(record.id, record.revision), { deleted: true, id: record.id });
    assert.equal((await repo.listBattleRecords({ eventId: event.id })).records.length, 0);
  } finally {
    server.close();
    (await repo.close());
  }
});
