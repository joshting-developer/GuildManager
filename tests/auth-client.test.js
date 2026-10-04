import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient } from '../src/api/auth.js';
import { sessionFetch, setCsrfToken } from '../src/api/session.js';
import { createMemberClient } from '../src/api/members.js';

const session = {
  user: { id: 'test-account', username: 'admin' },
  csrfToken: 'test-csrf',
  expiresAt: '2026-10-24T00:00:00Z',
};
test('auth adapter uses server session state, surfaces login failures and never retries passwords', async () => {
  const calls = [];
  const client = createAuthClient({
    fetchImpl: async (path, init) => {
      calls.push({ path, init });
      return {
        ok: path !== '/api/auth/login',
        json: async () =>
          path === '/api/auth/login'
            ? { error: { code: 'INVALID_CREDENTIALS', message: '帳號或密碼不正確' } }
            : session,
      };
    },
  });
  assert.deepEqual(await client.getSession(), session);
  await assert.rejects(
    client.login({ username: 'admin', password: 'wrong' }),
    (e) => e.code === 'INVALID_CREDENTIALS',
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), { username: 'admin', password: 'wrong' });
  setCsrfToken('');
});

test('incomplete or unauthenticated login responses never become a successful login', async () => {
  for (const value of [
    { user: null },
    { user: { username: 'admin' } },
    { ...session, expiresAt: 'invalid' },
    {},
  ]) {
    const client = createAuthClient({
      fetchImpl: async () => ({ ok: true, json: async () => value }),
    });
    await assert.rejects(client.login({ username: 'admin', password: 'password' }));
  }
});

test('shared browser transport sends CSRF and cookies, and announces a revoked session', async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const window = new EventTarget();
  let expired = 0;
  window.addEventListener('guild-auth-required', () => expired++);
  globalThis.window = window;
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: calls.length === 2 ? 401 : 200 };
  };
  try {
    setCsrfToken('csrf-value');
    await sessionFetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.headers.get('X-CSRF-Token'), 'csrf-value');
    assert.equal(calls[0].init.headers.get('Content-Type'), 'application/json');
    await sessionFetch('/api/members');
    assert.equal(expired, 1);
    await sessionFetch('/api/members', { method: 'DELETE' });
    assert.equal(calls[2].init.headers.get('X-CSRF-Token'), null);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.window = oldWindow;
    setCsrfToken('');
  }
});

test('GAS auth propagates unconfigured identity without HTTP fallback', async () => {
  const calls = [];
  const run = {
    withSuccessHandler(fn) {
      this.done = fn;
      return this;
    },
    withFailureHandler(fn) {
      this.fail = fn;
      return this;
    },
    getAuthSession() {
      calls.push('session');
      this.fail({ message: 'Google 登入尚未設定' });
    },
    login(input) {
      calls.push(input);
      this.fail({ message: 'Google 登入尚未設定' });
    },
  };
  const client = createAuthClient({
    source: 'gas',
    googleRun: run,
    fetchImpl: () => assert.fail('no HTTP fallback'),
  });
  await assert.rejects(client.getSession(), /Google 登入尚未設定/);
  await assert.rejects(
    client.login({ username: 'admin', password: 'wrong' }),
    /Google 登入尚未設定/,
  );
  assert.equal(calls.length, 2);
});

test('legacy member catalog uses a separate endpoint from the management roster', async () => {
  const paths = [];
  const client = createMemberClient({
    fetchImpl: async (path) => {
      paths.push(path);
      return { ok: true, json: async () => ({ members: [] }) };
    },
  });
  await client.getParticipationMembers();
  await client.getMembers();
  assert.deepEqual(paths, ['/api/calendar/members', '/api/members']);
});

test('a failed login does not expire an existing session or clear its CSRF token', async () => {
  const oldFetch = globalThis.fetch,
    oldWindow = globalThis.window;
  const window = new EventTarget();
  let expired = 0,
    headers;
  window.addEventListener('guild-auth-required', () => expired++);
  globalThis.window = window;
  globalThis.fetch = async (path, init) => {
    headers = init.headers;
    return { status: ['/api/auth/login', '/api/auth/member-login'].includes(path) ? 401 : 200 };
  };
  try {
    setCsrfToken('existing-csrf');
    await sessionFetch('/api/auth/login', { method: 'POST' });
    await sessionFetch('/api/auth/member-login', { method: 'POST' });
    assert.equal(expired, 0);
    await sessionFetch('/api/events/battle/participation', { method: 'POST' });
    assert.equal(headers.get('X-CSRF-Token'), 'existing-csrf');
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.window = oldWindow;
    setCsrfToken('');
  }
});

test('member login only transmits the password and accepts an anonymous account label', async () => {
  let request;
  const client = createAuthClient({ fetchImpl: async (path, init) => {
    request = { path, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ ...session, user: { id: 'member', username: '', role: 'member' } }) };
  } });
  const result = await client.loginMember({ password: '001234', username: 'ignored', role: 'admin' });
  assert.deepEqual(request, { path: '/api/auth/member-login', body: { password: '001234' } });
  assert.equal(result.user.username, '');
  const run = { withSuccessHandler(fn) { this.done = fn; return this; }, withFailureHandler(fn) { this.fail = fn; return this; }, loginMember(input) { assert.deepEqual(input, { password: '001234' }); this.fail({ message: '尚未串接' }); } };
  await assert.rejects(createAuthClient({ source: 'gas', googleRun: run, fetchImpl: () => assert.fail('no HTTP') }).loginMember({ password: '001234' }), /尚未串接/);
  setCsrfToken('');
});
