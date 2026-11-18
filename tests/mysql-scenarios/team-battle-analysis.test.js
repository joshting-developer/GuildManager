import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

test('HTTP permits member analysis GET only, retains lineup/write protection and returns missing-record/adapter errors', async () => {
  const repo = await createTestRepository({ });
  const first = (await repo.saveBattleRecords({ requestId: 'old', records: [{ type: 'scrimmage', datetime: '2026-10-05', filename: 'old.csv', csvText: fixtureCsv(), redTeam: '紅', blueTeam: '藍' }] })).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fetchAdmin = await authenticatedFetch(server, repo);
    const admin = await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }));
    await (await repo.setMemberToken(admin.user.id, { password: 'Member123', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: 'Member123' }));
    const headers = { Cookie: `guild_session=${member.token}` }, path = `${base}/api/battle-records/${first.id}/team-analysis`;
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await fetch(`${base}/api/lineups`, { headers })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const client = createBattleRecordClient({ fetchImpl: (url, init) => fetch(base + url, { ...init, headers }) });
    assert.equal((await client.getTeamAnalysis(first.id)).sides.red.unclassified.length, 1);
    assert.ok((await createBattleRecordClient({ fetchImpl: (url, init) => fetchAdmin(base + url, init) }).getTeamAnalysis(first.id)).unavailable);
    await assert.rejects(client.getTeamAnalysis('missing'), (e) => e.code === 'BATTLE_NOT_FOUND');
  } finally { await new Promise((resolve) => server.close(resolve)); (await repo.close()); }
});
