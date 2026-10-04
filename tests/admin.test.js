import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { passwordHash } from '../server/auth-repository.js';
import { createAdminClient } from '../src/api/admin.js';

const password = 'test-password-2026';
const code = (expected) => (error) => error.code === expected;
async function setup() {
  const repo = createRepository({ filename: ':memory:' });
  await repo.createAccount({ username: 'admin', password });
  const manager = await repo.createAccount({ username: 'manager', password });
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
      repo.close();
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
    const revision = f.repo.getAccountSettings(admin.user.id).admin.revision;
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
    const changed = await f.repo.updateManager(admin.user.id, f.manager.id, {
      username: 'new_manager',
      password: '',
      revision: 1,
    });
    assert.equal(changed.revision, 2);
    assert.equal((await f.request('/members', 'GET', undefined, manager.headers)).status, 401);
    await f.login('new_manager');
    await assert.rejects(
      f.repo.updateManager(admin.user.id, f.manager.id, { username: 'admin', revision: 2 }),
      code('ACCOUNT_EXISTS'),
    );
    await assert.rejects(
      f.repo.updateManager(admin.user.id, admin.user.id, { username: 'renamed', revision: 1 }),
      code('ACCOUNT_NOT_FOUND'),
    );
    const concurrent = await Promise.allSettled(
      ['replacement-pass-1', 'replacement-pass-2'].map((secret) =>
        f.repo.updateManager(admin.user.id, f.manager.id, {
          username: 'new_manager',
          password: secret,
          revision: 2,
        }),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((r) => r.status === 'rejected').reason.code, 'ACCOUNT_CHANGED');
    await assert.rejects(
      f.repo.authenticate({ username: 'new_manager', password }),
      code('INVALID_CREDENTIALS'),
    );
  } finally {
    await f.close();
  }
});

test('legacy accounts upgrade once with an admin and preserve hashes/sessions across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-admin-'));
  const filename = join(dir, 'test.sqlite');
  let repo;
  try {
    const secret = await passwordHash(password);
    const db = new Database(filename);
    db.exec(
      'CREATE TABLE auth_accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)',
    );
    const insert = db.prepare('INSERT INTO auth_accounts VALUES (?, ?, ?, ?, ?)');
    insert.run('early', 'first', secret.salt, secret.hash, '2026-01-01');
    insert.run('admin', 'ADMIN', secret.salt, secret.hash, '2026-02-01');
    db.close();
    repo = createRepository({ filename });
    assert.equal((await repo.authenticate({ username: 'first', password })).user.role, 'manager');
    const auth = await repo.authenticate({ username: 'admin', password });
    assert.equal(auth.user.role, 'admin');
    await repo.createManager(auth.user.id, { username: 'third', password });
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.getSession(auth.token).user.role, 'admin');
    assert.equal(repo.getAccountSettings('admin').managers.length, 2);
    const inspect = new Database(filename, { readonly: true });
    assert.equal(
      inspect.prepare('SELECT password_hash FROM auth_accounts WHERE id = ?').get('early')
        .password_hash,
      secret.hash,
    );
    assert.equal(
      JSON.stringify(inspect.prepare('SELECT * FROM auth_accounts').all()).includes(password),
      false,
    );
    inspect.close();
  } finally {
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin adapter uses protected HTTP paths and GAS errors without fallback', async () => {
  const f = await setup();
  try {
    const admin = await f.login();
    const client = createAdminClient({
      fetchImpl: (path, init = {}) =>
        fetch(f.base + path, { ...init, headers: { ...init.headers, ...admin.headers } }),
    });
    assert.equal((await client.getAccounts()).admin.role, 'admin');
    const { manager } = await client.createManager({ username: 'adapter', password });
    assert.equal(
      (await client.updateManager(manager.id, { username: 'changed', revision: 1 })).manager
        .username,
      'changed',
    );
    await assert.rejects(
      client.updateManager(manager.id, { username: 'changed', revision: 1 }),
      code('ACCOUNT_CHANGED'),
    );
    await assert.rejects(
      createAdminClient({ source: 'gas', fetchImpl: () => assert.fail() }).getAccounts(),
      /尚未串接/,
    );
    let failure;
    const gas = createAdminClient({
      source: 'gas',
      googleRun: {
        withSuccessHandler() {
          return this;
        },
        withFailureHandler(fn) {
          failure = fn;
          return this;
        },
        createManager(input) {
          assert.equal(input.username, 'gas');
          failure({ message: '尚未串接' });
        },
      },
    });
    await assert.rejects(gas.createManager({ username: 'gas', password }), /尚未串接/);
  } finally {
    await f.close();
  }
});

test('shared member token is fixed, private, admin-only and revokes all sessions on reset', async () => {
  const f = await setup();
  try {
    const admin = await f.login();
    const settings = f.repo.getAccountSettings(admin.user.id);
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
    for (const path of ['/home', '/members', '/lineups', '/battle-records', '/admin/accounts'])
      assert.equal((await f.request(path, 'GET', undefined, headers)).status, 403, path);
    assert.equal((await f.request('/auth/login', 'POST', { username: 'guild_member', password: '001234' })).status, 401);
    assert.equal((await f.request('/admin/members', 'POST', { username: 'other', password }, admin.headers)).status, 404);
    await assert.rejects(f.repo.createManager(admin.user.id, { username: 'GUILD_MEMBER', password }), code('RESERVED_ACCOUNT'));
    const data = await (await f.request('/admin/accounts', 'GET', undefined, admin.headers)).json();
    assert.ok(!JSON.stringify(data).includes('guild_member'));
    assert.ok(!JSON.stringify(data).includes('001234'));
    const adapter = createAdminClient({ fetchImpl: (path, init) => f.request(path.replace('/api', ''), init?.method, init?.body ? JSON.parse(init.body) : undefined, admin.headers) });
    assert.deepEqual(await adapter.setMemberToken({ password: 'aB1234', revision: 1 }), { memberToken: { configured: true, revision: 2 } });
    assert.equal((await (await f.request('/auth/session', 'GET', undefined, headers)).json()).user, null);
    await assert.rejects(f.repo.setMemberToken(admin.user.id, { password: '999999', revision: 1 }), code('ACCOUNT_CHANGED'));
    assert.equal((await f.request('/auth/member-login', 'POST', { password: '001234' })).status, 401);
    assert.equal((await f.request('/auth/member-login', 'POST', { password: 'Ab1234' })).status, 401);
    assert.equal((await f.request('/auth/member-login', 'POST', { password: 'aB1234' })).status, 200);
  } finally { await f.close(); }
});

test('two-role schema is backed up and upgraded without cascading session deletion or changing credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-role-upgrade-'));
  const filename = join(dir, 'test.sqlite');
  let repo;
  try {
    const secret = await passwordHash(password),
      token = 'a'.repeat(43);
    const db = new Database(filename);
    db.exec(`CREATE TABLE auth_accounts (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager' CHECK(role IN ('admin', 'manager')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0));
      CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);`);
    db.prepare('INSERT INTO auth_accounts VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'admin',
      'admin',
      secret.salt,
      secret.hash,
      '2026-10-01',
      'admin',
      4,
    );
    db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(
      createHash('sha256').update(token).digest('hex'),
      'admin',
      Date.now() + 60000,
    );
    const accounts = db.prepare('SELECT * FROM auth_accounts').all(),
      sessions = db.prepare('SELECT * FROM auth_sessions').all();
    db.close();
    repo = createRepository({ filename });
    assert.equal(repo.getSession(token).user.role, 'admin');
    assert.equal(repo.getAccountSettings('admin').admin.revision, 4);
    const backups = readdirSync(dir).filter((name) => name.includes('.before-member-role-'));
    assert.equal(backups.length, 1);
    const backup = new Database(join(dir, backups[0]), { readonly: true });
    assert.deepEqual(backup.prepare('SELECT * FROM auth_accounts').all(), accounts);
    assert.deepEqual(backup.prepare('SELECT * FROM auth_sessions').all(), sessions);
    backup.close();
    await repo.setMemberToken('admin', { password: '001234', revision: 0 });
    const inspect = new Database(filename, { readonly: true });
    assert.equal(
      inspect.prepare('SELECT password_hash FROM auth_accounts WHERE id = ?').get('admin')
        .password_hash,
      secret.hash,
    );
    assert.equal(inspect.pragma('foreign_key_check').length, 0);
    inspect.close();
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.getAccountSettings('admin').memberToken.configured, true);
    assert.equal(repo.getSession(token).user.username, 'admin');
    assert.equal(
      readdirSync(dir).filter((name) => name.includes('.before-member-role-')).length,
      1,
    );
  } finally {
    repo?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('management and member logins share rate limiting; legacy individual members remain stored but cannot authenticate', async () => {
  const f = await setup();
  try {
    const account = await f.repo.createAccount({ username: 'legacy_member', password, role: 'member' });
    await assert.rejects(f.repo.authenticate({ username: 'legacy_member', password }), code('INVALID_CREDENTIALS'));
    assert.ok(account.id);
    for (let i = 0; i < 10; i++) {
      const path = i % 2 ? '/auth/login' : '/auth/member-login';
      assert.equal((await f.request(path, 'POST', { username: 'admin', password: 'wrong' })).status, 401);
    }
    assert.equal((await f.request('/auth/login', 'POST', { username: 'admin', password })).status, 429);
    assert.equal((await f.request('/auth/member-login', 'POST', { password: '123456' })).status, 429);
  } finally { await f.close(); }
});
