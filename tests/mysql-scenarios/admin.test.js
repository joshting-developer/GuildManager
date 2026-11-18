import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createAdminClient } from '../../src/api/admin.js';

const password = 'test-password-2026';
const code = (expected) => (error) => error.code === expected;
async function setup() {
  const repo = await createTestRepository({ });
  await (await repo.createAccount({ username: 'admin', password }));
  const manager = await (await repo.createAccount({ username: 'manager', password }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function login(username = 'admin', secret = password) {
    const response = await request('/auth/login', 'POST', { username, password: secret });
    assert.equal(response.status, 200);
    const session = await response.json();
    return {
      user: session.user,
      headers: {
        Cookie: response.headers.get('set-cookie').split(';')[0],
        'X-CSRF-Token': session.csrfToken,
      },
    };
  }
  return {
    repo,
    manager,
    request,
    login,
    base,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      (await repo.close());
    },
  };
}

test('admin-only APIs reject anonymous, manager and missing CSRF; browser roles cannot promote accounts', async () => {
  const f = await setup();
  try {
    const admin = await f.login(),
      manager = await f.login('manager');
    assert.equal(admin.user.role, 'admin');
    assert.equal(manager.user.role, 'manager');
    for (const [method, path] of [
      ['GET', '/admin/accounts'],
      ['POST', '/admin/password'],
      ['POST', '/admin/managers'],
      ['PATCH', `/admin/managers/${f.manager.id}`],
    ]) {
      assert.equal((await f.request(path, method, method === 'GET' ? undefined : {})).status, 401);
      assert.equal(
        (await f.request(path, method, method === 'GET' ? undefined : {}, manager.headers)).status,
        403,
      );
    }
    assert.equal((await f.request('/members', 'GET', undefined, manager.headers)).status, 200);
    assert.equal(
      (
        await f.request(
          '/admin/managers',
          'POST',
          { username: 'other', password },
          { Cookie: admin.headers.Cookie },
        )
      ).status,
      403,
    );
    const created = await (
      await f.request(
        '/admin/managers',
        'POST',
        { username: 'other', password, role: 'admin' },
        admin.headers,
      )
    ).json();
    assert.equal(created.manager.role, 'manager');
    const settings = await (
      await f.request('/admin/accounts', 'GET', undefined, admin.headers)
    ).json();
    assert.equal(settings.managers.length, 2);
    assert.equal(JSON.stringify(settings).includes('password'), false);
  } finally {
    await f.close();
  }
});

test('admin password requires current secret and revision, preserves current session and revokes others', async () => {
  const f = await setup();
  try {
    const admin = await f.login(),
      other = await f.login();
    const revision = (await f.repo.getAccountSettings(admin.user.id)).admin.revision;
    assert.equal(
      (
        await f.request(
          '/admin/password',
          'POST',
          { currentPassword: 'wrong', password: 'new-test-password', revision },
          admin.headers,
        )
      ).status,
      422,
    );
    const result = await f.request(
      '/admin/password',
      'POST',
      { currentPassword: password, password: 'new-test-password', revision },
      admin.headers,
    );
    assert.equal(result.status, 200);
    assert.equal((await f.request('/admin/accounts', 'GET', undefined, admin.headers)).status, 200);
    assert.equal((await f.request('/admin/accounts', 'GET', undefined, other.headers)).status, 401);
    assert.equal(
      (
        await f.request(
          '/admin/password',
          'POST',
          { currentPassword: 'new-test-password', password: 'another-password', revision },
          admin.headers,
        )
      ).status,
      409,
    );
    assert.equal(
      (await f.request('/auth/login', 'POST', { username: 'admin', password })).status,
      401,
    );
    await f.login('admin', 'new-test-password');
  } finally {
    await f.close();
  }
});

test('manager rename/password preserve or replace hashes, revoke sessions and reject duplicates, admin edits and races', async () => {
  const f = await setup();
  try {
    const admin = await f.login(),
      manager = await f.login('manager');
    const changed = await (await f.repo.updateManager(admin.user.id, f.manager.id, {
      username: 'new_manager',
      password: '',
      revision: 1,
    }));
    assert.equal(changed.revision, 2);
    assert.equal((await f.request('/members', 'GET', undefined, manager.headers)).status, 401);
    await f.login('new_manager');
    await assert.rejects((f.repo.updateManager(admin.user.id, f.manager.id, { username: 'admin', revision: 2 })),
      code('ACCOUNT_EXISTS'),
    );
    await assert.rejects((f.repo.updateManager(admin.user.id, admin.user.id, { username: 'renamed', revision: 1 })),
      code('ACCOUNT_NOT_FOUND'),
    );
    const concurrent = await Promise.allSettled(
      ['replacement-pass-1', 'replacement-pass-2'].map(async (secret) =>
        (await f.repo.updateManager(admin.user.id, f.manager.id, {
          username: 'new_manager',
          password: secret,
          revision: 2,
        })),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((r) => r.status === 'rejected').reason.code, 'ACCOUNT_CHANGED');
    await assert.rejects((f.repo.authenticate({ username: 'new_manager', password })),
      code('INVALID_CREDENTIALS'),
    );
  } finally {
    await f.close();
  }
});

test('shared member token is fixed, private, admin-only and revokes all sessions on reset', async () => {
  const f = await setup();
  try {
    const admin = await f.login();
    const settings = (await f.repo.getAccountSettings(admin.user.id));
    assert.deepEqual(settings.memberToken, { configured: false, revision: 0 });
    for (const password of ['12345', 'abc!23', 123456, '123456 ', '1'.repeat(129)]) {
      assert.equal((await f.request('/admin/member-token', 'PATCH', { password, revision: 0 }, admin.headers)).status, 422);
    }
    assert.equal((await f.request('/admin/member-token', 'PATCH', { password: '001234', revision: 0 }, { Cookie: admin.headers.Cookie })).status, 403);
    const manager = await f.login('manager');
    assert.equal((await f.request('/admin/member-token', 'PATCH', { password: '001234', revision: 0 }, manager.headers)).status, 403);
    const created = await f.request('/admin/member-token', 'PATCH', { password: '001234', revision: 0, username: 'admin', role: 'admin' }, admin.headers);
    assert.deepEqual(await created.json(), { memberToken: { configured: true, revision: 1 } });
    const loginResponse = await f.request('/auth/member-login', 'POST', { password: '001234', username: 'admin', role: 'admin' });
    assert.equal(loginResponse.status, 200);
    const session = await loginResponse.json();
    assert.equal(session.user.role, 'member');
    assert.equal(session.user.username, '');
    const headers = { Cookie: loginResponse.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
    assert.equal((await f.request('/members', 'GET', undefined, headers)).status, 200);
    for (const path of ['/home', '/lineups', '/admin/accounts'])
      assert.equal((await f.request(path, 'GET', undefined, headers)).status, 403, path);
    assert.equal((await f.request('/auth/login', 'POST', { username: 'guild_member', password: '001234' })).status, 401);
    assert.equal((await f.request('/admin/members', 'POST', { username: 'other', password }, admin.headers)).status, 404);
    await assert.rejects((f.repo.createManager(admin.user.id, { username: 'GUILD_MEMBER', password })), code('RESERVED_ACCOUNT'));
    const data = await (await f.request('/admin/accounts', 'GET', undefined, admin.headers)).json();
    assert.ok(!JSON.stringify(data).includes('guild_member'));
    assert.ok(!JSON.stringify(data).includes('001234'));
    const adapter = createAdminClient({ fetchImpl: (path, init) => f.request(path.replace('/api', ''), init?.method, init?.body ? JSON.parse(init.body) : undefined, admin.headers) });
    assert.deepEqual(await adapter.setMemberToken({ password: 'aB1234', revision: 1 }), { memberToken: { configured: true, revision: 2 } });
    assert.equal((await (await f.request('/auth/session', 'GET', undefined, headers)).json()).user, null);
    await assert.rejects((f.repo.setMemberToken(admin.user.id, { password: '999999', revision: 1 })), code('ACCOUNT_CHANGED'));
    assert.equal((await f.request('/auth/member-login', 'POST', { password: '001234' })).status, 401);
    assert.equal((await f.request('/auth/member-login', 'POST', { password: 'Ab1234' })).status, 401);
    assert.equal((await f.request('/auth/member-login', 'POST', { password: 'aB1234' })).status, 200);
  } finally { await f.close(); }
});

test('management and member logins share rate limiting; legacy individual members remain stored but cannot authenticate', async () => {
  const f = await setup();
  try {
    const account = await (await f.repo.createAccount({ username: 'legacy_member', password, role: 'member' }));
    await assert.rejects((f.repo.authenticate({ username: 'legacy_member', password })), code('INVALID_CREDENTIALS'));
    assert.ok(account.id);
    for (let i = 0; i < 10; i++) {
      const path = i % 2 ? '/auth/login' : '/auth/member-login';
      assert.equal((await f.request(path, 'POST', { username: 'admin', password: 'wrong' })).status, 401);
    }
    assert.equal((await f.request('/auth/login', 'POST', { username: 'admin', password })).status, 429);
    assert.equal((await f.request('/auth/member-login', 'POST', { password: '123456' })).status, 429);
  } finally { await f.close(); }
});
