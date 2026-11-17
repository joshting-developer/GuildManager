import assert from 'node:assert/strict';
import { createTestRepository } from './mysql-repository.js';
import { createApp } from '../../server/app.js';

export const ADMIN = { username: 'test_admin', password: 'test-password-2026' };

// Boots the real Express app on an isolated MySQL schema. Every helper returns the raw
// fetch Response so tests assert status, headers and JSON shape exactly as the frontend sees them.
export async function createTestApp({ notifier = null, repository: wrap = (value) => value } = {}) {
  let time = Date.now();
  const repository = await createTestRepository({ authNow: () => time });
  const server = createApp(wrap(repository), { authNow: () => time, notifier }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method = 'GET', body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  async function login(credentials = ADMIN, { path = '/auth/login', headers: loginHeaders = {} } = {}) {
    const response = await request(path, 'POST', credentials, loginHeaders);
    assert.equal(response.status, 200);
    const session = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
    return {
      response,
      session,
      headers,
      request: (path, method = 'GET', body) => request(path, method, body, headers),
    };
  }
  async function admin() {
    await repository.createAccount(ADMIN);
    return login();
  }
  return {
    repository,
    request,
    login,
    admin,
    advance: (ms) => { time += ms; },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await repository.close();
    },
  };
}

export async function withApp(options, callback) {
  if (typeof options === 'function') [options, callback] = [{}, options];
  const app = await createTestApp(options);
  try {
    await callback(app);
  } finally {
    await app.close();
  }
}

export function recordingNotifier() {
  const calls = [];
  return {
    calls,
    enabled: () => true,
    send(notices, options) {
      calls.push({ notices, options });
      return Promise.resolve();
    },
  };
}
