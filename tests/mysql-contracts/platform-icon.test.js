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
