import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ADMIN } from '../helpers/mysql-app.js';

test('health and public reads answer after MySQL completes, management requires login', async () =>
  withApp(async ({ request }) => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const events = await request('/events');
    assert.equal(events.status, 200);
    assert.equal(events.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await events.json(), { events: [], hasMore: false });
    const professions = await request('/professions');
    assert.equal((await professions.json()).professions.length, 9);
    for (const [path, method, body] of [
      ['/members', 'GET'],
      ['/members', 'POST', { uid: '1', name: 'x', primaryProfessionId: 1 }],
      ['/lineups', 'GET'],
      ['/admin/accounts', 'GET'],
    ]) {
      const response = await request(path, method, body);
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    }
  }));

test('login, session, CSRF and logout keep the existing contract on MySQL sessions', async () =>
  withApp(async ({ request, admin, advance }) => {
    const anonymous = await request('/auth/session');
    assert.deepEqual(await anonymous.json(), { user: null });
    assert.equal((await request('/auth/login', 'POST', { ...ADMIN, password: 'wrong' })).status, 401);
    const { session, headers } = await admin();
    assert.equal(session.user.username, ADMIN.username);
    assert.equal(session.user.role, 'admin');
    assert.match(session.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
    const current = await request('/auth/session', 'GET', undefined, { Cookie: headers.Cookie });
    assert.equal((await current.json()).csrfToken, session.csrfToken);
    const noCsrf = await request('/members', 'POST', { uid: '1', name: 'x', primaryProfessionId: 1 }, { Cookie: headers.Cookie });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).error.code, 'CSRF_INVALID');
    const logout = await request('/auth/logout', 'POST', {}, headers);
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { user: null });
    const after = await request('/members', 'GET', undefined, headers);
    assert.equal(after.status, 401);
    advance(0);
  }));

test('body, origin, unknown route and unexpected failures map to the fixed JSON error envelope', async () =>
  withApp({ repository: (repository) => ({ ...repository, listDuties: async () => { throw new Error('socket hang up'); } }) },
    async ({ request, admin }) => {
      const { headers, request: authed } = await admin();
      const unknown = await authed('/nope');
      assert.equal(unknown.status, 404);
      assert.deepEqual(await unknown.json(), { error: { code: 'NOT_FOUND', message: '找不到這個資料介面' } });
      const origin = await request('/members', 'POST', { uid: '1', name: 'x', primaryProfessionId: 1 }, { ...headers, Origin: 'https://evil.test' });
      assert.equal(origin.status, 403);
      assert.equal((await origin.json()).error.code, 'ORIGIN_NOT_ALLOWED');
      const text = await fetch(unknown.url.replace('/nope', '/members'), { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: 'x' });
      assert.equal(text.status, 415);
      assert.equal((await text.json()).error.code, 'JSON_REQUIRED');
      const broken = await fetch(unknown.url.replace('/nope', '/members'), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(broken.status, 400);
      assert.equal((await broken.json()).error.code, 'INVALID_BODY');
      const failure = await authed('/duties');
      assert.equal(failure.status, 500);
      const body = await failure.json();
      assert.equal(body.error.code, 'OPERATION_FAILED');
      assert.ok(!JSON.stringify(body).includes('socket'), 'driver details never reach the client');
    }));

test('public event ranges validate dates and page only matching events', async () => withApp(async ({ request, repository }) => {
  const data = { type: 'activity', title: '範圍測試' };
  await repository.createEvent({ ...data, dates: ['2026-10-01'], requestId: 'http-range-out' });
  const inside = await repository.createEvent({ ...data, dates: ['2026-11-01'], requestId: 'http-range-in' });
  const response = await request('/events?startDate=2026-11-01&endDate=2026-11-30&limit=1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { events: [inside], hasMore: false });
  assert.equal((await request('/events?startDate=2026-02-30&endDate=2026-03-01')).status, 422);
}));
