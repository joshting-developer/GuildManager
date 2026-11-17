import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotObject, restoreObject } from '../tools/recover-local-object.js';

test('private object backup restores bytes to a fresh key, and corruption performs no put', async () => {
  const folder = mkdtempSync(resolve('.local/recovery-test-'));
  const objects = new Map([['files/probe/source', Buffer.from('name,score\n測試,1\n')]]);
  let puts = 0;
  const storage = { bucket: 'synthetic-local', async get(key) { return objects.get(key); }, async put(key, bytes) { puts++; objects.set(key, bytes); } };
  const file = resolve(folder, 'backup.json');
  try {
    await snapshotObject(storage, 'files/probe/source', 'text/csv', file);
    const expected = objects.get('files/probe/source');
    objects.delete('files/probe/source');
    const key = await restoreObject(storage, file, resolve(folder, 'receipt.json'));
    assert.notEqual(key, 'files/probe/source');
    assert.deepEqual(objects.get(key), expected);
    assert.equal(objects.has('files/probe/source'), false);
    writeFileSync(file + '.bytes', 'corrupt');
    await assert.rejects(restoreObject(storage, file, resolve(folder, 'corrupt-receipt.json')), /checksum/);
    assert.equal(puts, 1);
    await assert.rejects(snapshotObject(storage, key, 'text/csv', resolve('public-backup.json')), /Private/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
