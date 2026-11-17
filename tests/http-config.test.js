import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpConfig } from '../server/http-config.js';

test('HTTP configuration fails closed without leaking invalid setting values', () => {
  for (const APP_ORIGIN of [undefined, '', 'null', 'http://example.test', 'https://example.test/', 'https://example.test/path', 'https://user:secret@example.test', 'https://example.test?x=1', 'https://example.test#x']) {
    assert.throws(() => createHttpConfig({ NODE_ENV: 'production', APP_ORIGIN }), { code: 'HTTP_CONFIGURATION', message: 'HTTP configuration is invalid' });
  }
  for (const TRUSTED_PROXY_CIDRS of ['true', '*', '1', 'loopback', '127.0.0.1/33', '::1/129', '127.0.0.1/', '127.0.0.1,,::1']) {
    assert.throws(() => createHttpConfig({ TRUSTED_PROXY_CIDRS }), { code: 'HTTP_CONFIGURATION' });
  }
  const local = createHttpConfig({});
  assert.equal(local.secureCookies, false);
  assert.equal(local.staticDir, null);
  assert.equal(local.trustProxy, false);
  assert.ok(local.allowedOrigins.includes('http://localhost:5173'));
  const production = createHttpConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://example.test:8443', TRUSTED_PROXY_CIDRS: '192.0.2.0/24, ::1/128' });
  assert.deepEqual(production.allowedOrigins, ['https://example.test:8443']);
  assert.deepEqual(production.trustProxy, ['192.0.2.0/24', '::1/128']);
  assert.equal(production.secureCookies, true);
  assert.match(production.staticDir, /dist\/$/);
});

test('HTTP initialization failure closes the repository before opening a listener', async () => {
  const { startApi } = await import('../server/runtime.js');
  let closed = 0;
  await assert.rejects(startApi({
    repository: { async close() { closed++; } },
    port: 0,
    httpConfig: { ...createHttpConfig({}), staticDir: new URL('../config/http.env.example', import.meta.url).pathname },
  }), { code: 'HTTP_CONFIGURATION' });
  assert.equal(closed, 1);
});
