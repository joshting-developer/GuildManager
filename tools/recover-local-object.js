import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createR2Storage } from '../server/storage/r2.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.local');
const types = new Set(['text/csv', 'image/png', 'image/jpeg', 'image/webp']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function privateFile(path, writing = false) {
  const file = resolve(path);
  if (!file.startsWith(root + sep)) throw new Error('Private .local path required');
  if (writing) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const actual = realpathSync(writing ? dirname(file) : file), canonicalRoot = realpathSync(root);
  if (actual !== canonicalRoot && !actual.startsWith(canonicalRoot + sep)) throw new Error('Private .local path required');
  return file;
}
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

export async function snapshotObject(storage, key, mimeType, file) {
  if (!storage.bucket.endsWith('-local')) throw new Error('Local bucket required');
  if (!types.has(mimeType)) throw new Error('Invalid media type');
  file = privateFile(file, true);
  const bytesFile = basename(file) + '.bytes';
  const bytes = await storage.get(key);
  writeFileSync(resolve(dirname(file), bytesFile), bytes, { flag: 'wx', mode: 0o600 });
  save(file, { purpose: 'guildmanager-local-object-backup', bucket: storage.bucket, key, mimeType, bytesFile, size: bytes.length, sha256: hash(bytes) });
}

export async function restoreObject(storage, file, receipt) {
  if (!storage.bucket.endsWith('-local')) throw new Error('Local bucket required');
  file = privateFile(file);
  receipt = privateFile(receipt, true);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.purpose !== 'guildmanager-local-object-backup' || manifest.bucket !== storage.bucket ||
      !types.has(manifest.mimeType) || manifest.bytesFile !== basename(file) + '.bytes') throw new Error('Invalid backup manifest');
  const bytes = readFileSync(privateFile(resolve(dirname(file), manifest.bytesFile)));
  if (bytes.length !== manifest.size || hash(bytes) !== manifest.sha256) throw new Error('Backup checksum mismatch');
  // Always use a new key. Recovery never overwrites a current object or changes MySQL references.
  const key = `files/recovery/${randomUUID()}`;
  save(receipt, { purpose: 'guildmanager-local-object-recovery', sourceKey: manifest.key, key, sha256: manifest.sha256, state: 'planned' });
  await storage.put(key, bytes, manifest.mimeType);
  if (hash(await storage.get(key)) !== manifest.sha256) throw new Error('Recovered object checksum mismatch');
  writeFileSync(receipt, JSON.stringify({ purpose: 'guildmanager-local-object-recovery', sourceKey: manifest.key, key, sha256: manifest.sha256, state: 'verified' }, null, 2) + '\n', { mode: 0o600 });
  return key;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { config: { type: 'string' }, key: { type: 'string' }, type: { type: 'string' }, file: { type: 'string' }, receipt: { type: 'string' } } });
  const path = privateFile(values.config);
  if (statSync(path).mode & 0o077) throw new Error('Private configuration mode required');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.purpose !== 'guildmanager-r2-local-recovery' || !config.environment.R2_BUCKET?.endsWith('-local')) throw new Error('Explicit local bucket required');
  const storage = createR2Storage(config.environment);
  try {
    if (positionals.length !== 1) throw new Error('One operation required');
    if (positionals[0] === 'backup') await snapshotObject(storage, values.key, values.type, values.file);
    else if (positionals[0] === 'restore') await restoreObject(storage, values.file, values.receipt);
    else throw new Error('Unknown operation');
    console.log('Local object recovery operation verified; keys remain in private manifests');
  } finally { storage.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Local object recovery failed; inspect private configuration and receipt'); process.exitCode = 1; });
}
