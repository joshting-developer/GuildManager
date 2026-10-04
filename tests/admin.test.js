import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('admin issues member accounts; members cannot access management or elevate roles, reset revokes login', async () => {
  const f = await setup();
  try {
    const admin = await f.login();
    const created = await f.request(
      '/admin/members',
      'POST',
      { username: 'player', password, role: 'admin' },
      admin.headers,
    );
    assert.equal(created.status, 201);
    const { member } = await created.json();
    assert.equal(member.role, 'member');
    const login = await f.login('player');
    assert.equal(login.user.role, 'member');
    for (const path of [
      '/home',
      '/members',
      '/lineups',
      '/events/test',
      '/battle-records',
      '/admin/accounts',
    ]) {
      assert.equal((await f.request(path, 'GET', undefined, login.headers)).status, 403, path);
    }
    assert.equal((await f.request('/events', 'GET', undefined, login.headers)).status, 200);
    await assert.rejects(
      f.repo.updateManager(admin.user.id, member.id, { username: 'player', revision: 1 }),
      code('ACCOUNT_NOT_FOUND'),
    );
    const updated = await f.request(
      `/admin/members/${member.id}`,
      'PATCH',
      { username: 'player_new', password: 'new-member-password', revision: 1, role: 'admin' },
      admin.headers,
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).member.role, 'member');
    assert.equal(
      (await (await f.request('/auth/session', 'GET', undefined, login.headers)).json()).user,
      null,
    );
    await f.login('player_new', 'new-member-password');
    const settings = f.repo.getAccountSettings(admin.user.id);
    assert.equal(settings.members.length, 1);
    assert.equal(settings.managers.length, 1);
  } finally {
    await f.close();
  }
});
