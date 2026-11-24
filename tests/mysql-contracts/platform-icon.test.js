import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_PLATFORM_ICON_BYTES, validatePlatformIcon } from '../../src/domain/platform-settings.js';
import { createPlatformSettingsClient } from '../../src/api/platform-settings.js';

const png = {
  mimeType: 'image/png',
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
};

const large = Buffer.alloc(240 * 1024);
Buffer.from(png.base64, 'base64').copy(large);

test('icon validation rejects oversized, malformed, spoofed and active image types', () => {
  assert.deepEqual(validatePlatformIcon(png), png);
  assert.equal(validatePlatformIcon(null), null);
  for (const icon of [
    undefined,
    {},
    { ...png, mimeType: 'image/svg+xml' },
    { ...png, mimeType: 'image/jpeg' },
    { ...png, base64: 'data:image/png;base64,' + png.base64 },
    { ...png, base64: png.base64.slice(1) },
    { ...png, base64: Buffer.alloc(MAX_PLATFORM_ICON_BYTES + 1).toString('base64') },
  ]) {
    assert.throws(() => validatePlatformIcon(icon), { code: 'INVALID_PLATFORM_ICON' });
  }
});

test('platform adapter refuses arbitrary or malformed image sources', async () => {
  for (const iconSrc of [
    'https://example.com/logo.svg',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,bad',
  ]) {
    await assert.rejects(
      createPlatformSettingsClient({
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ platform: { name: 'test', revision: 1, iconSrc } }),
        }),
      }).getSettings(),
      /圖示回應格式/,
    );
  }
});

test('platform icon object is read and verified once per file, and a new file replaces it', async () => {
  const { withFileStorage } = await import('../../server/services/file-backed-repository.js');
  const { createHash } = await import('node:crypto');
  const objects = new Map(), reads = [];
  const store = (id, bytes) => {
    objects.set(`files/platform-icon/${id}`, bytes);
    return { id, bucket: 'synthetic', key: `files/platform-icon/${id}`, size: bytes.length, mimeType: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  let iconFile = store('first', Buffer.from(png.base64, 'base64'));
  const app = withFileStorage({ getPlatformSettings: async () => ({ platform: { name: 'GM', revision: 1 }, iconFile }), close: async () => {} },
    { bucket: 'synthetic', get: async (key) => { reads.push(key); return objects.get(key); } }, {});
  for (let i = 0; i < 10; i++) assert.equal((await app.getPlatformSettings()).platform.iconSrc, `data:image/png;base64,${png.base64}`);
  assert.deepEqual(reads, ['files/platform-icon/first']);
  iconFile = store('second', large);
  assert.equal((await app.getPlatformSettings()).platform.iconSrc, `data:image/png;base64,${large.toString('base64')}`);
  assert.deepEqual(reads, ['files/platform-icon/first', 'files/platform-icon/second']);
  objects.set('files/platform-icon/third', Buffer.from('tampered'));
  iconFile = { ...iconFile, id: 'third', key: 'files/platform-icon/third' };
  await assert.rejects(app.getPlatformSettings());
});
