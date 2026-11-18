import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createPlatformSettingsClient } from '../../src/api/platform-settings.js';

const secret = 'test-password-2026';

test('local platform settings enforce admin/CSRF and preserve changes after restart', async () => {
  let repo = await createTestRepository({ });
  const admin = await (await repo.createAccount({
    username: 'admin',
    password: secret,
  }));
  await (await repo.createAccount({ username: 'manager', password: secret }));
  await (await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 }));
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
    repo = reopenTestRepository(repo);
    assert.deepEqual((await repo.getPlatformSettings()), {
      platform: { name: literal, revision: 3 },
    });
    assert.equal((await repo.readHome()).guild.name, '你的幫會');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
