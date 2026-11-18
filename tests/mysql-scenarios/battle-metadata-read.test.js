import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

const upload = () => ({ requestId: 'metadata-fixture', records: [{ type: 'scrimmage',
  filename: 'battle.csv', csvText: fixtureCsv(), datetime: '2026-10-05T00:00:00',
  redTeam: '原紅方', blueTeam: '原藍方', winner: null, ourSide: null }] });
const patch = { redTeam: '新紅方', blueTeam: '新藍方', winner: 'blue', ourSide: 'red',
  isInternal: false, revision: 0, requestId: 'metadata-edit' };

test('HTTP metadata adapter uses one uncached management read and preserves member detail access and edit conflicts', async () => {
  const repo = await createTestRepository({ });
  const record = (await repo.saveBattleRecords(upload())).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo);
    const calls = [], client = createBattleRecordClient({ fetchImpl: (path, init) => { calls.push(path); return authed(base + path, init); } });
    assert.deepEqual((await client.getMetadata(record.id)).record, (await repo.getBattleMetadata(record.id)));
    assert.deepEqual(calls, [`/api/battle-records/${record.id}/metadata`]);
    assert.equal((await authed(base + calls[0])).headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + calls[0])).status, 401);
    const admin = (await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }))).user;
    await (await repo.setMemberToken(admin.id, { password: '001234', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: '001234' }));
    const init = { headers: { Cookie: `guild_session=${member.token}` } };
    assert.equal((await fetch(base + calls[0], init)).status, 403);
    assert.equal((await fetch(base + `/api/battle-records/${record.id}`, init)).status, 200);
    await client.updateRecord(record.id, patch);
    assert.equal((await client.getMetadata(record.id)).record.revision, 1);
    await assert.rejects(client.updateRecord(record.id, { ...patch, requestId: 'stale' }), { code: 'REVISION_CONFLICT' });
    await client.deleteRecord(record.id, 1);
    await assert.rejects(client.getMetadata(record.id), { code: 'BATTLE_NOT_FOUND' });
  } finally { await new Promise(resolve => server.close(resolve)); (await repo.close()); }
});

test('editing metadata stays readable without decoding players or CSV and follows edits and deletion', async () => {
  const repo = await createTestRepository();
  try {
    const record = (await repo.saveBattleRecords(upload())).records[0];
    await repo.updateBattleRecord(record.id, patch);
    const expected = await repo.getBattleMetadata(record.id);
    assert.equal(expected.revision, 1);
    assert.equal(expected.redTeam, patch.redTeam);
    await repositoryDatabase(repo).query('UPDATE battle_records SET players_json = ?, csv_text = ? WHERE id = ?', ['{"broken":true}', 'broken', record.id]);
    assert.deepEqual(await repo.getBattleMetadata(record.id), expected);
    await repo.deleteBattleRecord(record.id, 1);
    await assert.rejects(repo.getBattleMetadata(record.id), { code: 'BATTLE_NOT_FOUND' });
  } finally {
    await repo.close();
  }
});
