import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createR2Storage } from '../server/storage/r2.js';

const path = process.env.GUILD_R2_TEST_CONFIG;
test('real private R2 roundtrip, unsigned denial and exact-object cleanup', { skip: !path }, async () => {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(config.purpose, 'guildmanager-r2-test');
  assert.match(config.environment.R2_BUCKET, /^[a-z0-9-]+-local$/);
  const storage = createR2Storage(config.environment);
  const key = `files/probe/${randomUUID()}`;
  const bytes = Buffer.from('name,score\n測試,1\n');
  try {
    await storage.put(key, bytes, 'text/csv');
    assert.deepEqual(await storage.get(key), bytes);
    const unsigned = await fetch(`${config.environment.R2_ENDPOINT.replace(/\/$/, '')}/${config.environment.R2_BUCKET}/${key}`);
    assert.ok([400, 401, 403].includes(unsigned.status));
    await unsigned.body?.cancel();
  } finally {
    try {
      await storage.remove(key);
      await assert.rejects(storage.get(key), { code: 'FILE_NOT_FOUND' });
    } finally { storage.close(); }
  }
});
