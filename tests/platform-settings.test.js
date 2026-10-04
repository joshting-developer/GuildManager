import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createPlatformSettingsClient } from '../src/api/platform-settings.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { setGasSession } from '../src/api/gas.js';

const secret = 'test-password-2026';
test('local platform settings enforce admin/CSRF and preserve changes after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-platform-'));
  const filename = join(directory, 'test.sqlite');
  let repo = createRepository({ filename });
  const admin = await repo.createAccount({
    username: 'admin',
    password: secret,
  });
  await repo.createAccount({ username: 'manager', password: secret });
  await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', input, headers = {}) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(input ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  async function login(username) {
    const response = await request(
      username ? '/auth/login' : '/auth/member-login',
      'POST',
      username ? { username, password: secret } : { password: 'Member123' },
    );
    const session = await response.json();
    return {
      Cookie: response.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': session.csrfToken,
    };
  }
  try {
    const initial = { platform: { name: '逆水寒', revision: 1 } };
    assert.deepEqual(await (await request('/platform-settings')).json(), initial);
    const input = { name: '仗劍幫會', revision: 1 };
    assert.equal((await request('/admin/platform-settings', 'PATCH', input)).status, 401);
    for (const username of ['manager', null]) {
      assert.equal(
        (await request('/admin/platform-settings', 'PATCH', input, await login(username))).status,
        403,
      );
    }
    const headers = await login('admin');
    assert.equal(
      (
        await request('/admin/platform-settings', 'PATCH', input, {
          Cookie: headers.Cookie,
        })
      ).status,
      403,
    );
    const client = createPlatformSettingsClient({
      fetchImpl: (path, options) =>
        fetch(`${base}${path}`, {
          ...options,
          headers: { ...options.headers, ...headers },
        }),
    });
    assert.deepEqual(await client.updateSettings({ ...input, name: ' 仗劍幫會 ' }), {
      platform: { name: '仗劍幫會', revision: 2 },
    });
    assert.deepEqual(await client.updateSettings(input), {
      platform: { name: '仗劍幫會', revision: 2 },
    });
    await assert.rejects(client.updateSettings({ name: '其他名稱', revision: 1 }), {
      code: 'STALE_SETTINGS',
    });
    for (const name of ['', '  ', '字'.repeat(31), '換\n行', '\n名稱', 123]) {
      await assert.rejects(client.updateSettings({ name, revision: 2 }), {
        code: 'INVALID_PLATFORM_NAME',
      });
    }
    await assert.rejects(client.updateSettings({ name: '名稱', revision: '2' }), {
      code: 'INVALID_REVISION',
    });
    const literal = '= <b>仗劍</b>';
    assert.equal(
      (await client.updateSettings({ name: literal, revision: 2 })).platform.name,
      literal,
    );
    assert.deepEqual(await (await request('/platform-settings')).json(), {
      platform: { name: literal, revision: 3 },
    });
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.getPlatformSettings(), {
      platform: { name: literal, revision: 3 },
    });
    assert.equal(repo.readHome().guild.name, '你的幫會');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('compiled GAS settings use public read, admin-only write and committed Sheets persistence', async () => {
  const env = await gasRuntime();
  env.setup();
  const context = cloudSession(
    cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])),
  );
  const call = (op, args = [], ctx = context) => cloudResult(env.raw(op, args, ctx));
  assert.deepEqual(call('getPlatformSettings', [], {}), {
    platform: { name: '逆水寒', revision: 1 },
  });
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  call('createManager', [{ username: 'manager', password: secret }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  const manager = cloudSession(
    cloudResult(env.raw('login', [{ username: 'manager', password: secret }])),
  );
  const input = { name: '=仗劍平台', revision: 1 };
  assert.equal(env.raw('updatePlatformSettings', [input], {}).error.code, 'AUTH_REQUIRED');
  for (const ctx of [member, manager])
    assert.equal(env.raw('updatePlatformSettings', [input], ctx).error.code, 'ADMIN_REQUIRED');
  assert.equal(
    env.raw('updatePlatformSettings', [input], {
      sessionToken: context.sessionToken,
    }).error.code,
    'CSRF_INVALID',
  );
  assert.deepEqual(call('updatePlatformSettings', [input]), {
    platform: { name: '=仗劍平台', revision: 2 },
  });
  assert.deepEqual(call('updatePlatformSettings', [input]), {
    platform: { name: '=仗劍平台', revision: 2 },
  });
  assert.equal(
    env.raw('updatePlatformSettings', [{ name: '不同名稱', revision: 1 }], context).error.code,
    'STALE_SETTINGS',
  );
  assert.equal(
    env.raw('updatePlatformSettings', [{ name: '字'.repeat(31), revision: 2 }], context).error.code,
    'INVALID_PLATFORM_NAME',
  );
  env.setup();
  assert.deepEqual(call('getPlatformSettings', [], {}), {
    platform: { name: '=仗劍平台', revision: 2 },
  });
  assert.equal(call('getHomeData').guild.name, '測試幫會');
  env.sandbox.ScriptApp = { getScriptId: () => 'platform-test-script' };
  env.sandbox.HtmlService = {
    createHtmlOutputFromFile: () => ({ getContent: () => '<head></head>' }),
    createHtmlOutput: () => ({
      setTitle(title) {
        this.title = title;
        return this;
      },
      addMetaTag() {
        return this;
      },
    }),
  };
  assert.equal(env.sandbox.doGet().title, '=仗劍平台 · 幫會管理平台');

  // Use the same asynchronous runner contract as the real frontend adapter.
  function runner(success, failure) {
    return new Proxy(
      {},
      {
        get(_target, operation) {
          if (operation === 'withSuccessHandler') return (handler) => runner(handler, failure);
          if (operation === 'withFailureHandler') return (handler) => runner(success, handler);
          return (...args) =>
            queueMicrotask(() => {
              try {
                success(env.raw(operation, args.slice(0, -1), args.at(-1)));
              } catch (error) {
                failure(error);
              }
            });
        },
      },
    );
  }
  setGasSession({ user: { role: 'admin' }, ...context });
  try {
    const client = createPlatformSettingsClient({
      source: 'gas',
      googleRun: runner(),
    });
    assert.deepEqual(await client.getSettings(), {
      platform: { name: '=仗劍平台', revision: 2 },
    });
    assert.deepEqual(await client.updateSettings({ name: '雲端幫會', revision: 2 }), {
      platform: { name: '雲端幫會', revision: 3 },
    });
    setGasSession({ user: { role: 'member' }, ...member });
    await assert.rejects(client.updateSettings({ name: '無權限', revision: 3 }), {
      code: 'ADMIN_REQUIRED',
    });
    assert.equal(call('getPlatformSettings', [], {}).platform.name, '雲端幫會');
  } finally {
    setGasSession(null);
  }
});

test('platform settings adapter reports connection and malformed response failures', async () => {
  await assert.rejects(
    createPlatformSettingsClient({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }).getSettings(),
    /服務連線/,
  );
  await assert.rejects(
    createPlatformSettingsClient({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ platform: { name: null } }),
      }),
    }).getSettings(),
    /格式不正確/,
  );
});
