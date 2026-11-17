import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import { createHttpConfig } from '../../server/http-config.js';
import { withApp, ADMIN } from '../helpers/mysql-app.js';

const site = 'https://guild.example.test';
const production = () => ({ ...createHttpConfig({ NODE_ENV: 'production', APP_ORIGIN: site }), staticDir: null });

test('production site accepts only its configured Origin and preserves CSRF and private Secure cookies', async () => withApp({ httpConfig: production() }, async (app) => {
  await app.repository.createAccount(ADMIN);
  for (const Origin of ['', 'https://evil.test', 'null', `${site}.evil.test`, `${site}/`, 'http://localhost:5173', 'http://guild.example.test']) {
    const response = await app.request('/auth/login', 'POST', ADMIN, { Origin, Host: 'guild.example.test', 'X-Forwarded-Host': 'guild.example.test', 'X-Forwarded-Proto': 'https' });
    assert.equal(response.status, 403, Origin);
    assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const login = await app.login(ADMIN, { headers: { Origin: site } });
  for (const pattern of [/; Secure/i, /HttpOnly/i, /SameSite=Lax/i, /Path=\/api/i, /Max-Age=28800/]) assert.match(login.response.headers.get('set-cookie'), pattern);
  assert.doesNotMatch(login.response.headers.get('set-cookie'), /Domain=/i);
  assert.deepEqual(await (await login.request('/auth/session')).json(), login.session);
  assert.equal((await app.request('/auth/logout', 'POST', {}, { Cookie: login.headers.Cookie, Origin: site })).status, 403);
  assert.equal((await app.request('/auth/logout', 'POST', {}, { ...login.headers, Origin: `${site}:444` })).status, 403);
  const noJson = await app.request('/auth/logout', 'POST', undefined, { ...login.headers, Origin: site });
  assert.equal(noJson.status, 415);
  const logout = await app.request('/auth/logout', 'POST', {}, { ...login.headers, Origin: site });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /; Secure/i);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await login.request('/members')).status, 401);
  // CLI clients without Origin retain the existing authenticated JSON contract.
  assert.equal((await app.login()).response.status, 200);
}));

test('proxy headers cannot rotate login rate-limit identities unless the immediate peer is trusted', async () => {
  for (const trustProxy of [false, ['192.0.2.0/24'], ['127.0.0.1/32']]) {
    await withApp({ httpConfig: { ...production(), trustProxy } }, async (app) => {
      for (let i = 0; i < 10; i++) {
        const response = await app.request('/auth/login', 'POST', ADMIN, { 'X-Forwarded-For': `198.51.100.${i + 1}` });
        assert.equal(response.status, 401);
      }
      // A trusted proxy appends the actual client: varying the leftmost spoofed value
      // must not change the closest untrusted client used by the limiter.
      const chain = trustProxy && trustProxy[0] === '127.0.0.1/32';
      for (let i = 0; i < 11; i++) {
        const response = await app.request('/auth/login', 'POST', ADMIN, { 'X-Forwarded-For': chain ? `203.0.113.${i + 1}, 198.51.100.99` : `198.51.100.${i + 20}` });
        assert.equal(response.status, chain && i < 10 ? 401 : 429);
      }
    });
  }
});

test('production static serving exposes the build, keeps unknown API and missing assets out of HTML, and requires a build', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gm-site-'));
  try {
    assert.throws(() => createApp({}, { httpConfig: { ...production(), staticDir: directory } }), { code: 'HTTP_CONFIGURATION' });
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<!doctype html><title>synthetic build</title>');
    writeFileSync(join(directory, 'assets/app.js'), 'console.log("synthetic");');
    writeFileSync(join(directory, '.secret'), 'synthetic-private');
    await withApp({ httpConfig: { ...production(), staticDir: directory } }, async (app) => {
      const auth = await app.admin();
      const base = auth.response.url.replace('/api/auth/login', '');
      assert.match(await (await fetch(base + '/')).text(), /synthetic build/);
      assert.match(await (await fetch(base + '/assets/app.js')).text(), /console.log/);
      for (const path of ['/assets/missing.js', '/.secret', '/server/index.js', '/management']) assert.equal((await fetch(base + path)).status, 404, path);
      const unknown = await auth.request('/unknown');
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
