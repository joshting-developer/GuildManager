import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createR2Storage } from '../server/storage/r2.js';
import { createPrivateFileService } from '../server/services/private-files.js';

const path = process.env.GUILD_R2_TEST_CONFIG;
test('real private R2 roundtrip, revoked access, unsigned denial and exact-object cleanup', { skip: !path }, async () => {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(config.purpose, 'guildmanager-r2-test');
  assert.match(config.environment.R2_BUCKET, /^[a-z0-9-]+-local$/);
  const storage = createR2Storage(config.environment);
  const file = { key: `files/probe/${randomUUID()}`, name: '測試.csv', mimeType: 'text/csv' };
  let allowed = true;
  const service = createPrivateFileService({ storage, authorize: async ({ sessionToken, resourceId }) => allowed && sessionToken === 'test-session' && resourceId === 'test-resource' ? file : null });
  const bytes = Buffer.from('name,score\n測試,1\n');
  try {
    const saved = await service.upload('test-session', 'test-resource', bytes);
    assert.equal(saved.size, bytes.length);
    const result = await service.download('test-session', 'test-resource');
    assert.deepEqual(result.bytes, bytes);
    allowed = false;
    await assert.rejects(service.download('test-session', 'test-resource'), { code: 'FILE_ACCESS_DENIED' });
    await assert.rejects(service.remove('test-session', 'test-resource'), { code: 'FILE_ACCESS_DENIED' });
    const unsigned = await fetch(`${config.environment.R2_ENDPOINT.replace(/\/$/, '')}/${config.environment.R2_BUCKET}/${file.key}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    assert.ok([400, 401, 403].includes(unsigned.status));
    await unsigned.body?.cancel();
  } finally {
    try {
      allowed = true;
      await service.remove('test-session', 'test-resource');
      await assert.rejects(storage.get(file.key), { code: 'FILE_NOT_FOUND' });
    } finally { storage.close(); }
  }
});
