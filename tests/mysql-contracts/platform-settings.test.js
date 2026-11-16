import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlatformSettingsClient } from '../../src/api/platform-settings.js';

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
