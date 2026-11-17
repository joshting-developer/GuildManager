import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createR2Storage } from '../server/storage/r2.js';
import { createPrivateFileService } from '../server/services/private-files.js';

const env = { R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, R2_BUCKET: 'example-local', R2_ACCESS_KEY_ID: 'synthetic', R2_SECRET_ACCESS_KEY: 'synthetic' };
const file = { key: 'files/battle/example-id', name: '戰績.csv', mimeType: 'text/csv' };
const bytes = Buffer.from('name,score\n測試,1\n');

test('configuration rejects non-R2 URLs, credentials in URLs, missing credentials and disabled TLS', () => {
  for (const change of [{ R2_ENDPOINT: 'http://example.test' }, { R2_ENDPOINT: env.R2_ENDPOINT + '/bucket' }, { R2_ENDPOINT: env.R2_ENDPOINT + '?secret=1' }, { R2_ACCESS_KEY_ID: '' }, { R2_BUCKET: '../other' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) {
    assert.throws(() => createR2Storage({ ...env, ...change }), { code: 'STORAGE_UNAVAILABLE' });
  }
});

test('all operations reauthorize session and resource, revoked/unknown access does no IO', async () => {
  const calls = []; let allowed = true;
  const storage = { put: async (...args) => calls.push(args), get: async key => { calls.push(key); return bytes; }, remove: async key => calls.push(key) };
  const checked = [];
  const service = createPrivateFileService({ storage, authorize: async input => { checked.push(input); return allowed ? file : null; } });
  const saved = await service.upload('trusted-session', 'resource-id', bytes);
  assert.equal(saved.size, bytes.length); assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await service.download('trusted-session', 'resource-id'), { name: file.name, mimeType: file.mimeType, bytes });
  await service.remove('trusted-session', 'resource-id');
  assert.deepEqual(checked.map(x => x.operation), ['upload', 'download', 'remove']);
  assert.ok(checked.every(x => x.sessionToken === 'trusted-session' && x.resourceId === 'resource-id'));
  allowed = false;
  for (const operation of ['upload', 'download', 'remove']) await assert.rejects(service[operation](null, 'other', bytes), { code: 'FILE_ACCESS_DENIED' });
  assert.equal(calls.length, 3);
  assert.throws(() => createPrivateFileService({ storage }), TypeError);
});

test('upload/download enforce CSV size and image signatures without writing invalid data', async () => {
  let writes = 0;
  const storage = { put: async () => writes++, get: async () => Buffer.alloc(1024 * 1024 + 1) };
  for (const descriptor of [file, { ...file, mimeType: 'image/png' }, { ...file, name: 'bad\r\nheader' }, { ...file, mimeType: 'text/html' }]) {
    const service = createPrivateFileService({ storage, authorize: async () => descriptor });
    await assert.rejects(service.upload('s', 'r', descriptor === file ? Buffer.alloc(1024 * 1024 + 1) : bytes), { code: 'INVALID_FILE' });
  }
  const service = createPrivateFileService({ storage, authorize: async () => file });
  await assert.rejects(service.download('s', 'r'), { code: 'INVALID_FILE' });
  assert.equal(writes, 0);
});

test('storage confines keys and does not expose provider details or retry failed IO', async () => {
  let count = 0;
  const storage = createR2Storage(env, { client: { send: async () => { count++; throw new Error('private endpoint credential SQL secret'); } } });
  for (const key of ['../escape', 'files/other/../key', 'https://example.test/file', 'files/a/b?key=1']) await assert.rejects(storage.get(key), { code: 'INVALID_FILE' });
  assert.equal(count, 0);
  for (const operation of [() => storage.put(file.key, bytes, file.mimeType), () => storage.get(file.key), () => storage.remove(file.key)]) {
    await assert.rejects(operation(), e => e.code === 'STORAGE_UNAVAILABLE' && !/secret|credential|endpoint/.test(e.message) && !e.cause);
  }
  assert.equal(count, 3);
});

test('bounded download rejects missing, oversized, truncated and growing streams and closes them', async () => {
  for (const result of [{ ContentLength: 0 }, { ContentLength: 5 }, { ContentLength: 1, chunks: [Buffer.from('12')] }, { ContentLength: 3, chunks: [Buffer.from('1')] }]) {
    const body = Readable.from(result.chunks || []);
    const storage = createR2Storage(env, { maxBytes: 4, client: { send: async () => ({ Body: body, ContentLength: result.ContentLength }) } });
    await assert.rejects(storage.get(file.key));
    assert.equal(body.destroyed, true);
  }
});

test('successful storage download returns only bytes; missing object maps to safe 404', async () => {
  const commands = [];
  const storage = createR2Storage(env, { client: { send: async command => { commands.push(command); return { Body: Readable.from([bytes]), ContentLength: bytes.length }; } } });
  assert.deepEqual(await storage.get(file.key), bytes);
  assert.equal(commands[0].input.Key, file.key);
  assert.equal(commands[0].input.Bucket, env.R2_BUCKET);
  const missing = createR2Storage(env, { client: { send: async () => { throw { $metadata: { httpStatusCode: 404 }, message: 'private object' }; } } });
  await assert.rejects(missing.get(file.key), { code: 'FILE_NOT_FOUND', status: 404 });
});

test('stalled response body is aborted within the operation deadline', async () => {
  const body = new Readable({ read() {} });
  const storage = createR2Storage(env, { timeoutMs: 20, client: { send: async () => ({ Body: body, ContentLength: 1 }) } });
  await assert.rejects(storage.get(file.key), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(body.destroyed, true);
});


test('normal ASCII filenames are allowed while separators and actual control characters are rejected', async () => {
  for (const name of ['upload.csv', 'round-1.csv']) {
    const service = createPrivateFileService({ storage: { put: async () => {} }, authorize: async () => ({ ...file, name }) });
    await service.upload('s', 'r', bytes);
  }
  for (const name of ['bad\r\nheader.csv', '../file.csv', 'dir/file.csv', 'dir\\file.csv']) {
    const service = createPrivateFileService({ storage: { put: async () => assert.fail('must not write') }, authorize: async () => ({ ...file, name }) });
    await assert.rejects(service.upload('s', 'r', bytes), { code: 'INVALID_FILE' });
  }
});
