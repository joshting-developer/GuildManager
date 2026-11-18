import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { csrfToken } from '../../server/mysql/auth-repository.js';
import { createMemberClient } from '../../src/api/members.js';

const person = {
  uid: '0001',
  name: '初名',
  primaryProfessionId: 3,
  secondaryProfessionId: 1,
  isInGuild: true,
  isInClub: true,
};
async function memberFlow(client) {
  assert.equal((await client.getMembers()).members.length, 0);
  const created = (await client.addMember(person)).member;
  assert.equal(created.uid, '0001');
  const { uid, ...values } = person;
  const changed = (
    await client.updateMember(uid, {
      ...values,
      name: '新名',
      primaryProfessionId: 2,
      secondaryProfessionId: 5,
      revision: created.revision,
    })
  ).member;
  assert.equal(changed.name, '新名');
  assert.equal(changed.previousNames[0].name, '初名');
  await assert.rejects(
    client.updateMember(uid, { ...values, name: '衝突名', revision: created.revision }),
  );
  await assert.rejects(client.removeMember(uid, changed.revision),
    (error) => error.code === 'MANAGEMENT_REQUIRED');
  const membershipChanged = (await client.updateMember(uid, {
    ...values, name: '新名', primaryProfessionId: 2, secondaryProfessionId: 5,
    isInClub: false, revision: changed.revision,
  })).member;
  assert.equal(membershipChanged.isInGuild, true);
  assert.equal(membershipChanged.isInClub, false);
  const source = { text: 'UID Name 主職業 副職業\n0001 不覆寫 素問 -\n0002 匯入新成員 龍吟 碎夢' };
  const preview = await client.previewMemberImport(source);
  assert.equal(preview.summary.skipped, 1);
  const imported = await client.importMembers({ ...source, fingerprint: preview.fingerprint });
  assert.equal(imported.summary.added, 1);
  const members = (await client.getMembers()).members;
  assert.equal(members.length, 2);
  assert.equal(members.find((row) => row.uid === '0001').name, '新名');
  assert.equal(members.find((row) => row.uid === '0001').isInGuild, true);
  const restored = (
    await client.updateMember(uid, { ...values, name: '新名', revision: membershipChanged.revision })
  ).member;
  assert.equal(restored.isInGuild, true);
  assert.equal(restored.isInClub, true);
  return members;
}

test('member HTTP roster retains editing/import but denies move-to-external; admin/manager retain the action', async () => {
  const repo = await createTestRepository({ });
  const admin = await (await repo.createAccount({ username: 'admin', password: 'admin-password-123' }));
  await (await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 }));
  const session = await (await repo.authenticateMember({ password: 'Member123' }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Cookie: `guild_session=${session.token}`, 'X-CSRF-Token': csrfToken(session.token) };
  const fetchMember = (path, init = {}) =>
    fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
  try {
    for (const [path, method, body] of [
      ['/members', 'GET'],
      ['/members', 'POST', person],
      ['/members/0001', 'PATCH', {}],
      ['/members/0001', 'DELETE', { revision: 1 }],
      ['/members/import/preview', 'POST', { text: '' }],
      ['/members/import', 'POST', {}],
    ]) {
      const init = {
        method,
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      };
      assert.equal((await fetch(base + '/api' + path, init)).status, 401);
      if (method !== 'GET')
        assert.equal(
          (
            await fetch(base + '/api' + path, {
              ...init,
              headers: { ...init.headers, Cookie: headers.Cookie },
            })
          ).status,
          403,
        );
    }
    await memberFlow(createMemberClient({ fetchImpl: fetchMember }));
    for (const role of ['admin', 'manager']) {
      if (role === 'manager') await (await repo.createAccount({ username: role, password: 'manager-password-123' }));
      const privileged = await (await repo.authenticate({ username: role,
        password: role === 'admin' ? 'admin-password-123' : 'manager-password-123' }));
      const current = (await repo.listMembers()).members.find((row) => row.uid === '0001');
      const response = await fetch(base + '/api/members/0001', {
        method: 'DELETE',
        headers: { Cookie: `guild_session=${privileged.token}`, 'X-CSRF-Token': csrfToken(privileged.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: current.revision }),
      });
      assert.equal(response.status, 200, role);
      const moved = (await response.json()).member;
      assert.equal(moved.isInGuild, false);
      assert.equal(moved.isInClub, false);
    }
    for (const [path, method] of [
      ['/lineups', 'GET'],
      ['/duties', 'GET'],
      ['/admin/accounts', 'GET'],
      ['/events', 'POST'],
      ['/lineups/confirm', 'POST'],
      ['/battle-records', 'POST'],
      ['/members/0001/battle-records', 'PATCH'],
      ['/members/import/extra', 'POST'],
    ]) {
      assert.equal((await fetchMember('/api' + path, { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{}' }) })).status, 403, `${method} ${path}`);
    }
    await (await repo.setMemberToken(admin.id, { password: 'NewPass123', revision: 1 }));
    assert.equal((await fetchMember('/api/members')).status, 401);
    assert.equal(
      (await fetchMember('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(person),
      })).status,
      401,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
