import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';

const credentials = { username: 'admin', password: 'test-password-2026' };
async function fixture() {
  let time = Date.now();
  const repo = createRepository({ filename: ':memory:', authNow: () => time });
  await repo.createAccount(credentials);
  const server = createApp(repo, { authNow: () => time }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method = 'GET', body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function login(headers = {}) {
    const response = await request('/auth/login', 'POST', credentials, headers);
    assert.equal(response.status, 200);
    const session = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return {
      response,
      session,
      cookie,
      headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken },
    };
  }
  return {
    repo,
    request,
    login,
    advance: (ms) => {
      time += ms;
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      repo.close();
    },
  };
}

test('anonymous callers cannot read or mutate any management API', async () => {
  const f = await fixture();
  try {
    for (const [method, path] of [
      ['GET', '/home'],
      ['GET', '/members'],
      ['POST', '/members'],
      ['PATCH', '/members/test'],
      ['DELETE', '/members/test'],
      ['POST', '/members/import/preview'],
      ['POST', '/members/import'],
      ['POST', '/events'],
      ['PATCH', '/events/test'],
      ['DELETE', '/events/test'],
      ['GET', '/lineups'],
      ['GET', '/lineups/events/test'],
      ['POST', '/lineups/confirm'],
      ['POST', '/lineups/templates'],
      ['GET', '/lineups/templates/test/apply/test'],
      ['GET', '/duties'],
      ['POST', '/duties'],
      ['PATCH', '/duties/test'],
      ['POST', '/auth/logout'],
      ['GET', '/members/'],
      ['GET', '/%6dembers'],
    ]) {
      const response = await f.request(path, method, method === 'GET' ? undefined : {});
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    }
    assert.deepEqual(f.repo.listMembers().members, []);
    assert.deepEqual(f.repo.listEvents().events, []);
  } finally {
    await f.close();
  }
});

test('login issues an HttpOnly session, reload restores it, logout revokes it server-side', async () => {
  const f = await fixture();
  try {
    const anon = await f.request('/auth/session');
    assert.deepEqual(await anon.json(), { user: null });
    assert.equal(anon.headers.get('cache-control'), 'no-store');
    const auth = await f.login();
    const cookie = auth.response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/api/);
    assert.match(cookie, /Max-Age=28800/);
    assert.deepEqual(Object.keys(auth.session).sort(), ['csrfToken', 'expiresAt', 'user']);
    assert.deepEqual(Object.keys(auth.session.user).sort(), ['id', 'role', 'username']);
    assert.equal((await f.request('/members', 'GET', undefined, auth.headers)).status, 200);
    assert.deepEqual(
      await (await f.request('/auth/session', 'GET', undefined, auth.headers)).json(),
      auth.session,
    );
    const logout = await f.request('/auth/logout', 'POST', {}, auth.headers);
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await f.request('/members', 'GET', undefined, auth.headers)).status, 401);
    assert.deepEqual(
      await (await f.request('/auth/session', 'GET', undefined, auth.headers)).json(),
      { user: null },
    );
  } finally {
    await f.close();
  }
});

test('fake, duplicated and expired cookies never grant access; re-login rotates sessions', async () => {
  const f = await fixture();
  try {
    const auth = await f.login();
    assert.equal(
      (await f.request('/members', 'GET', undefined, { Cookie: 'guild_session=fake' })).status,
      401,
    );
    assert.equal(
      (await f.request('/members', 'GET', undefined, { Cookie: `${auth.cookie}; ${auth.cookie}` }))
        .status,
      401,
    );
    const next = await f.login({ Cookie: auth.cookie });
    assert.notEqual(next.cookie, auth.cookie);
    assert.equal((await f.request('/members', 'GET', undefined, auth.headers)).status, 401);
    f.advance(8 * 60 * 60 * 1000);
    assert.equal((await f.request('/members', 'GET', undefined, next.headers)).status, 401);
  } finally {
    await f.close();
  }
});

test('management writes require the current CSRF token and a permitted Origin', async () => {
  const f = await fixture();
  try {
    const auth = await f.login();
    const member = { uid: 'test', name: '測試角色', primaryProfessionId: 1 };
    for (const headers of [
      { Cookie: auth.cookie },
      { ...auth.headers, 'X-CSRF-Token': 'fake' },
      { ...auth.headers, Origin: 'https://example.com' },
    ])
      assert.equal((await f.request('/members', 'POST', member, headers)).status, 403);
    assert.equal(
      (
        await f.request('/members', 'POST', member, {
          ...auth.headers,
          Origin: 'http://localhost:5173',
        })
      ).status,
      201,
    );
    assert.equal(f.repo.listMembers().members.length, 1);
    assert.equal(
      (await f.request('/auth/logout', 'POST', {}, { Cookie: auth.cookie })).status,
      403,
    );
    assert.equal((await f.request('/members', 'GET', undefined, auth.headers)).status, 200);
  } finally {
    await f.close();
  }
});

test('public calendar and participation remain available without exposing full member records', async () => {
  const f = await fixture();
  try {
    f.repo.addMember({ uid: '001', name: '原名', primaryProfessionId: 1 });
    f.repo.updateMember('001', { name: '新名', primaryProfessionId: 1, revision: 1 });
    const event = f.repo.createEvent({
      title: '測試約戰',
      type: 'scrimmage',
      dates: ['2026-10-24'],
      requestId: 'public-test',
    });
    assert.equal((await f.request('/events')).status, 200);
    assert.equal((await f.request('/professions')).status, 200);
    assert.equal((await f.request('/calendar/members')).status, 401);
    const auth = await f.login();
    assert.deepEqual(
      await (await f.request('/calendar/members', 'GET', undefined, auth.headers)).json(),
      {
        members: [{ uid: '001', name: '新名' }],
      },
    );
    assert.equal(
      (
        await f.request(`/events/${event.id}/participation`, 'PATCH', {
          uid: '001',
          status: 'leave',
          note: '請假',
          revision: 0,
        })
      ).status,
      200,
    );
    const guest = await f.request(`/events/${event.id}/registrations`, 'POST', {
      name: '外援',
      professionId: 1,
      note: '',
      requestId: 'public-guest',
    });
    assert.equal(guest.status, 201);
    const { registration } = await guest.json();
    assert.equal(
      (
        await f.request(`/events/${event.id}/registrations/${registration.id}`, 'DELETE', {
          revision: registration.revision,
        })
      ).status,
      200,
    );
    assert.equal((await f.request(`/events/${event.id}/participation`)).status, 200);
  } finally {
    await f.close();
  }
});

test('wrong and unknown credentials return the same error and never authenticate', async () => {
  const f = await fixture();
  try {
    const responses = [];
    for (const input of [
      { ...credentials, password: 'incorrect' },
      { ...credentials, username: 'unknown' },
      {},
      { username: {}, password: [] },
    ]) {
      const response = await f.request('/auth/login', 'POST', input);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('set-cookie'), null);
      responses.push(await response.json());
    }
    responses.forEach((value) => assert.deepEqual(value, responses[0]));
  } finally {
    await f.close();
  }
});

test('parallel failed logins are limited and the limit expires', async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all(
      Array.from({ length: 11 }, () =>
        f.request('/auth/login', 'POST', { ...credentials, password: 'wrong' }),
      ),
    );
    assert.equal(responses.filter((response) => response.status === 401).length, 10);
    assert.equal(responses.filter((response) => response.status === 429).length, 1);
    assert.equal((await f.request('/auth/login', 'POST', credentials)).status, 429);
    f.advance(5 * 60 * 1000);
    await f.login();
  } finally {
    await f.close();
  }
});

test('accounts and hashed sessions survive restart, with no plaintext stored and no account overwrite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-auth-'));
  const filename = join(directory, 'auth.sqlite');
  let repo = createRepository({ filename });
  try {
    await repo.createAccount(credentials);
    await assert.rejects(
      repo.createAccount({ ...credentials, username: 'ADMIN' }),
      (e) => e.code === 'ACCOUNT_EXISTS',
    );
    await assert.rejects(
      repo.createAccount({ username: 'new', password: 'short' }),
      (e) => e.code === 'INVALID_PASSWORD',
    );
    const auth = await repo.authenticate(credentials);
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.getSession(auth.token).user.username, 'admin');
    const db = new Database(filename, { readonly: true });
    const rows = JSON.stringify({
      accounts: db.prepare('SELECT * FROM auth_accounts').all(),
      sessions: db.prepare('SELECT * FROM auth_sessions').all(),
    });
    db.close();
    assert.equal(rows.includes(credentials.password), false);
    assert.equal(rows.includes(auth.token), false);
    repo.revokeSession(auth.token);
    assert.equal(repo.getSession(auth.token), null);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
