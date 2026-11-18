import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

const A = { uid: 'A', name: '實際操作A', primaryProfessionId: 3, isInGuild: true, isInClub: false };
const B = { uid: 'B', name: '角色B', primaryProfessionId: 3, isInGuild: false, isInClub: true };
const csv = fixtureCsv(B.name, '外部對手');
const attribution = (extra = {}) => ({ playerIndex: 0, sourcePlayer: B.name, sourceSide: 'red',
  memberUid: A.uid, memberName: A.name, memberRevision: 1, ...extra });
const input = (extra = {}) => ({ requestId: crypto.randomUUID(), records: [{ filename: 'battle.csv', csvText: csv,
  type: 'scrimmage', datetime: '2026-10-27', redTeam: '本幫', blueTeam: '對手', ourSide: 'red', winner: 'red',
  attributions: [attribution()], ...extra }] });
const localFixture = async () => { const repo = await createTestRepository({ }); (await repo.addMember(A)); (await repo.addMember(B)); return repo; };

test('HTTP roster is one uncached management request, submission attribution retains CSRF and malformed responses fail', async () => {
  const repo = await localFixture(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const client = createBattleRecordClient({ fetchImpl: async (url, init) => {
      calls.push(url);
      const response = await authed(base + url, init);
      if (url === '/api/battle-upload/roster') assert.equal(response.headers.get('cache-control'), 'no-store');
      return response;
    } });
    const roster = await client.getUploadRoster();
    assert.deepEqual(calls, ['/api/battle-upload/roster']); assert.equal(roster.members.length, 2);
    const admin = await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }));
    await (await repo.setMemberToken(admin.user.id, { password: '001234', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: '001234' }));
    assert.equal((await fetch(base + calls[0])).status, 401);
    assert.equal((await fetch(base + calls[0], { headers: { Cookie: `guild_session=${member.token}` } })).status, 403);
    const path = base + '/api/battle-records';
    for (const [token, status] of [[null, 401], [member.token, 403], [admin.token, 403]])
      assert.equal((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `guild_session=${token}` } : {}) }, body: JSON.stringify(input()) })).status, status);
    assert.equal((await client.saveRecords(input())).records[0].players[0].memberUid, A.uid);
    for (const malformed of [{}, { members: [{}] }, { members: [{ ...roster.members[0], revision: null }] }]) {
      const bad = createBattleRecordClient({ fetchImpl: async () => ({ ok: true, json: async () => malformed }) });
      await assert.rejects(bad.getUploadRoster());
    }
  } finally { await new Promise(r => server.close(r)); (await repo.close()); }
});
