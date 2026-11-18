import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleSyncClient } from '../../src/api/battle-sync.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

const person = (uid, name) => ({ uid, name, primaryProfessionId: 3 });
let uploadMinute = 0;
const uploadInput = (name, requestId = crypto.randomUUID()) => ({
  requestId,
  records: [{ filename: 'history.csv', csvText: fixtureCsv(name), type: 'scrimmage',
    datetime: `2026-10-24T12:${String(uploadMinute++).padStart(2, '0')}`, redTeam: '紅方', blueTeam: '藍方', winner: null }],
});
const code = expected => error => error.code === expected;

// Rename is used to reproduce members created before historical backfill existed.
async function fixture(api) {
  const current = (await api.upload('現在甲'));
  const old = (await api.upload('過去甲'));
  (await api.upload('乙')); (await api.upload('舊同名')); (await api.upload('未知'));
  (await api.add(person('1', '起始甲')));
  (await api.rename('1', '過去甲', 1)); (await api.rename('1', '現在甲', 2));
  (await api.add(person('2', '起始乙')));
  (await api.rename('2', '乙', 1)); (await api.rename('2', '舊同名', 2)); (await api.rename('2', '乙', 3));
  (await api.add(person('3', '起始丙')));
  (await api.rename('3', '舊同名', 1)); (await api.rename('3', '丙', 2));
  // A current name also matching another member's old name must not win priority.
  (await api.add(person('4', '起始丁')));
  (await api.rename('4', '乙', 1)); (await api.rename('4', '丁', 2));
  const owned = (await api.upload('現在甲'));
  return { current, old, owned };
}

async function localApi(repo) {
  return {
    upload: async name => (await repo.saveBattleRecords(uploadInput(name))).records[0],
    add: async row => (await repo.addMember(row)),
    rename: async (uid, name, revision) => (await repo.updateMember(uid, { name, primaryProfessionId: 3, revision })),
    preview: async () => (await repo.previewBattleMemberSync()), sync: async input => (await repo.syncBattleMembers(input)),
    personal: async uid => (await repo.getMemberBattleRecords(uid)), detail: async id => (await repo.getBattleRecord(id)),
  };
}

test('HTTP sync enforces admin + CSRF, denies manager/member, and returns stale/retry errors through adapter', async () => {
  const repo = await createTestRepository({ });
  await fixture(await localApi(repo));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const authFetch = await authenticatedFetch(server, repo);
    const admin = await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }));
    await (await repo.setMemberToken(admin.user.id, { password: 'Member123', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: 'Member123' }));
    await (await repo.createAccount({ username: 'test_manager', password: 'manager-password-123' }));
    const manager = await (await repo.authenticate({ username: 'test_manager', password: 'manager-password-123' }));
    const client = createBattleSyncClient({ fetchImpl: (path, init) => authFetch(base + path, init) });
    const preview = await client.preview();
    const input = { fingerprint: preview.fingerprint, requestId: 'http-sync' };
    for (const path of ['/api/admin/battle-sync/preview', '/api/admin/battle-sync']) {
      const init = path.endsWith('preview') ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
      assert.equal((await fetch(base + path, init)).status, 401);
      assert.equal((await fetch(base + path, { ...init, headers: { ...init.headers, Cookie: `guild_session=${member.token}`, 'X-CSRF-Token': member.csrfToken } })).status, 403);
      const denied = await fetch(base + path, { ...init, headers: { ...init.headers, Cookie: `guild_session=${manager.token}`, 'X-CSRF-Token': manager.csrfToken } });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).error.code, 'ADMIN_REQUIRED');
    }
    assert.equal((await fetch(base + '/api/admin/battle-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `guild_session=${admin.token}` }, body: JSON.stringify(input) })).status, 403);
    assert.equal((await client.sync(input)).linkedPlayers, 2);
    assert.equal((await client.sync(input)).linkedPlayers, 2);
    await assert.rejects(client.sync({ ...input, requestId: 'stale-http' }), code('STALE_SYNC_PREVIEW'));
    const response = await authFetch(base + '/api/admin/battle-sync/preview');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await authFetch(base + '/api/battle-sync/preview')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); (await repo.close()); }
});
