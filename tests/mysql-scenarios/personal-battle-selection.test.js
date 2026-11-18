import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createMemberClient } from '../../src/api/members.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

test('local all=true returns complete history in one authorized adapter call and preserves legacy pages and filters', async () => {
  const repo = await createTestRepository({ });
  (await repo.addMember({ uid: 'a', name: '城', primaryProfessionId: 1, secondaryProfessionId: null }));
  (await repo.addMember({ uid: 'other', name: '別人', primaryProfessionId: 1, secondaryProfessionId: null }));
  for (let i = 1; i <= 25; i++) (await repo.saveBattleRecords({ requestId: `row-${i}`, records: [{ filename: 'test.csv', csvText: fixtureCsv('城'), type: 'scrimmage', datetime: `2026-10-${String(i).padStart(2, '0')}`, redTeam: '甲', blueTeam: '乙' }] }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const authFetch = await authenticatedFetch(server, repo);
    let calls = 0;
    const client = createMemberClient({ fetchImpl: (path, init) => { calls++; return authFetch(base + path, init); } });
    const data = await client.getBattleRecords('a', 1, { all: true });
    assert.equal(calls, 1);
    assert.equal(data.entries.length, 25);
    assert.equal(data.summary, undefined); // Full-history mode leaves aggregation to the browser.
    assert.equal(data.entries[0].playedAt, '2026-10-25');
    assert.equal((await repo.getMemberBattleRecords('a', { page: 2 })).entries.length, 5);
    assert.equal((await repo.getMemberBattleRecords('a', { all: true, startDate: '2026-10-20' })).entries.length, 6);
    assert.equal((await repo.getMemberBattleRecords('other', { all: true })).entries.length, 0);
    assert.equal((await fetch(`${base}/api/members/a/battle-records?all=true`)).status, 401);
    assert.equal((await authFetch(`${base}/api/members/a/battle-records?all=invalid`)).status, 422);
    await assert.rejects(async () => (await repo.getMemberBattleRecords('a', { all: 'true' })), { code: 'BATTLE_FILTER_INVALID' });
  } finally { await new Promise(r => server.close(r)); (await repo.close()); }
});
