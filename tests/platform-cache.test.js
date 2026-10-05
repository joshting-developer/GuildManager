import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformCache, normalizeCachedPlatform } from '../src/api/platform-cache.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const iconSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('branding persists across client instances, isolates source/scripts and clears removed icons', () => {
  const storage = memoryStorage();
  const make = (source, namespace) => createPlatformCache({ source, namespace, storage });
  const initial = { name: '仗劍幫會', revision: 2, iconSrc, secret: 'must-not-cache' };
  assert.equal(make('gas', 'script-a').write(initial), true);
  assert.deepEqual(make('gas', 'script-a').read(), { name: initial.name, revision: 2, iconSrc });
  assert.equal(make('gas', 'script-b').read(), null);
  assert.equal(make('local').read(), null);
  assert.equal(make('gas').write(initial), false);
  assert.equal(make('gas').read(), null);
  assert.equal([...storage.values.values()].some(value => value.includes('must-not-cache')), false);
  make('gas', 'script-a').write({ name: '新幫會', revision: 3, iconSrc: null });
  assert.deepEqual(make('gas', 'script-a').read(), { name: '新幫會', revision: 3, iconSrc: null });
});

test('invalid, corrupt and oversized cache entries cannot supply branding or replace valid data', () => {
  const storage = memoryStorage();
  const cache = createPlatformCache({ source: 'local', storage });
  const valid = { name: '正常幫會', revision: 1, iconSrc: null };
  for (const value of [
    null, {}, { ...valid, name: ' ' }, { ...valid, name: '字'.repeat(31) },
    { ...valid, name: '換\n行' }, { ...valid, revision: 0 },
    { ...valid, revision: '1' }, { ...valid, iconSrc: 123 },
    { ...valid, iconSrc: 'https://example.com/logo.png' },
    { ...valid, iconSrc: 'data:image/svg+xml;base64,PHN2Zz4=' },
  ]) {
    cache.write(valid);
    assert.equal(cache.write(value), false);
    assert.deepEqual(cache.read(), valid);
    storage.setItem('guild-platform:v1:local', JSON.stringify(value));
    assert.equal(cache.read(), null);
  }
  for (const raw of ['{broken', 'x'.repeat(361 * 1024)]) {
    storage.setItem('guild-platform:v1:local', raw);
    assert.equal(cache.read(), null);
  }
  assert.deepEqual(normalizeCachedPlatform({ name: '舊版無圖示', revision: 1 }), {
    name: '舊版無圖示', revision: 1, iconSrc: null,
  });
});

test('blocked or full browser storage never prevents using server branding', () => {
  const unavailable = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  const cache = createPlatformCache({ source: 'local', storage: unavailable });
  assert.equal(cache.read(), null);
  assert.equal(cache.write({ name: '後端設定', revision: 1 }), false);
  assert.equal(createPlatformCache({ source: 'local', storage: null }).write({ name: '後端設定', revision: 1 }), false);
});

test('GAS first response embeds only public branding and preserves script-like names literally', async () => {
  const env = await gasRuntime(); env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const name = '</script>$&幫會';
  cloudResult(env.raw('updatePlatformSettings', [{ name, revision: 1 }], context));
  env.sandbox.ScriptApp = { getScriptId: () => 'branding-script' };
  env.sandbox.HtmlService = {
    createHtmlOutputFromFile: () => ({ getContent: () => '<head></head><body></body>' }),
    createHtmlOutput: (html) => ({
      html,
      setTitle(title) { this.title = title; return this; },
      addMetaTag() { return this; },
    }),
  };
  const result = env.sandbox.doGet();
  assert.equal(result.title, `${name} · 幫會管理平台`);
  const match = /window\.__GUILD_PLATFORM__=(.*);<\/script>/.exec(result.html);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), { name, revision: 2 });
  assert.equal(result.html.match(/<\/script>/g).length, 1);
  assert.equal(result.html.includes('initial-password-123'), false);
  assert.equal(result.html.includes('sessionToken'), false);
});
