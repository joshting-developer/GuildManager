import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';

const png = {
  mimeType: 'image/png',
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
};
const source = `data:image/png;base64,${png.base64}`;
const large = Buffer.alloc(240 * 1024);
Buffer.from(png.base64, 'base64').copy(large);
const largePng = { mimeType: 'image/png', base64: large.toString('base64') };

test('local icon upload is admin-only, atomic, retryable, public-readable and persistent', async () => {
  let repo = await createTestRepository({ });
  const password = 'icon-password-123';
  await (await repo.createAccount({ username: 'admin', password }));
  await (await repo.createAccount({ username: 'manager', password }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, input, headers = {}) =>
    fetch(`${base}/api${path}`, {
      method: input ? (path.includes('/auth/') ? 'POST' : 'PATCH') : 'GET',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  const login = async (username) => {
    const response = await request('/auth/login', { username, password });
    const session = await response.json();
    return {
      Cookie: response.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': session.csrfToken,
    };
  };
  try {
    const input = { name: '圖示幫會', revision: 1, icon: png };
    assert.equal((await request('/admin/platform-settings', input)).status, 401);
    assert.equal(
      (await request('/admin/platform-settings', input, await login('manager'))).status,
      403,
    );
    const headers = await login('admin');
    assert.equal(
      (await request('/admin/platform-settings', input, { Cookie: headers.Cookie })).status,
      403,
    );
    const save = async (body) => {
      const response = await request('/admin/platform-settings', body, headers);
      assert.equal(response.status, 200);
      return (await response.json()).platform;
    };
    assert.deepEqual(await save(input), { name: input.name, revision: 2, iconSrc: source });
    assert.deepEqual(await save(input), { name: input.name, revision: 2, iconSrc: source });
    assert.equal(
      (await request('/admin/platform-settings', { ...input, icon: null }, headers)).status,
      409,
    );
    const invalid = await request(
      '/admin/platform-settings',
      { name: '不可局部更新', revision: 2, icon: { ...png, mimeType: 'image/svg+xml' } },
      headers,
    );
    assert.equal(invalid.status, 422);
    assert.deepEqual((await repo.getPlatformSettings()).platform, {
      name: input.name,
      revision: 2,
      iconSrc: source,
    });
    assert.equal((await save({ name: '改名', revision: 2 })).iconSrc, source);
    assert.equal((await save({ name: '改名', revision: 3, icon: largePng })).revision, 4);
    const reopened = reopenTestRepository(repo);
    assert.equal(
      (await reopened.getPlatformSettings()).platform.iconSrc,
      `data:image/png;base64,${largePng.base64}`,
    );
    assert.deepEqual(await save({ name: '改名', revision: 4, icon: null }), {
      name: '改名',
      revision: 5,
    });
    assert.deepEqual(await save({ name: '改名', revision: 4, icon: null }), {
      name: '改名',
      revision: 5,
    });
    assert.deepEqual((await repo.getPlatformSettings()).platform, { name: '改名', revision: 5 });
    assert.deepEqual(await (await request('/platform-settings')).json(), {
      platform: { name: '改名', revision: 5 },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
