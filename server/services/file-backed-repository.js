import { randomUUID, createHash } from 'node:crypto';
import { FileStorageError } from '../storage/r2.js';
import { validatePlatformSettings, validatePlatformIcon, platformIconSource } from '../../src/domain/platform-settings.js';

/** Keep object IO outside MySQL transactions; HTTP auth still guards the original routes. */
export function withFileStorage(repository, storage, journal) {
  async function read(file) {
    if (!storage || !file || storage.bucket !== file.bucket) throw new FileStorageError();
    const bytes = await storage.get(file.key);
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new FileStorageError();
    return bytes;
  }
  async function write(kind, name, mimeType, bytes) {
    if (!storage) throw new FileStorageError();
    const id = randomUUID();
    const file = { id, bucket: storage.bucket, key: `files/${kind}/${id}`, name, mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    // Persist before PUT: even an unknown provider result remains discoverable after restart.
    await journal.stage(file);
    await storage.put(file.key, bytes, mimeType);
    await journal.ready(file.id);
    return file;
  }
  async function platformResult(result) {
    const { platform, iconFile } = result;
    if (!iconFile) return { platform };
    const bytes = await read(iconFile);
    return { platform: { ...platform, iconSrc: platformIconSource({ mimeType: iconFile.mimeType, base64: bytes.toString('base64') }) } };
  }
  const methods = {
    /** Explicit maintenance operation; never exposed as a browser-selected object key API. */
    async cleanupStagedFiles({ limit = 100 } = {}) {
      if (!storage || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new FileStorageError();
      const candidates = await journal.claimExpired(storage.bucket, limit);
      let removed = 0, failed = 0;
      for (const row of candidates) {
        try {
          await storage.remove(row.object_key);
          // Retain a tombstone: a PUT paused before IO may finish after the first deletion.
          await journal.deleted(row.id);
          removed += 1;
        } catch { failed += 1; }
      }
      return { removed, failed };
    },
    async saveBattleRecords(input, { assertAccess } = {}) {
      await assertAccess?.();
      const preflight = await repository.saveBattleRecords(input, { preflight: true, assertAccess });
      if (!preflight.requiresFiles) return preflight;
      const csv = [];
      for (const record of input.records) csv.push(await write('battle-csv', record.filename, 'text/csv', Buffer.from(record.csvText)));
      const image = input.image ? await write('battle-image', input.image.name, input.image.mimeType, Buffer.from(input.image.base64, 'base64')) : null;
      // Finalize rechecks requestId, event, round, member attribution and duplicates inside one transaction.
      return repository.saveBattleRecords(input, { fileReferences: { csv, image }, assertAccess });
    },
    async getBattleAttachment(id, kind, { assertAccess } = {}) {
      await assertAccess?.();
      const result = await repository.getBattleAttachment(id, kind);
      const { file, ...attachment } = result;
      const hydrated = file ? { ...attachment, bytes: await read(file) } : attachment;
      await assertAccess?.();
      // A record removed during the external read must no longer expose its attachment.
      if (file) await repository.getBattleAttachment(id, kind);
      return hydrated;
    },
    async getPlatformSettings() { return platformResult(await repository.getPlatformSettings()); },
    async updatePlatformSettings(input, { assertAccess } = {}) {
      await assertAccess?.();
      const current = await repository.getPlatformSettings();
      const { platform } = await platformResult(current);
      validatePlatformSettings(input, platform);
      const icon = Object.hasOwn(input, 'icon') ? validatePlatformIcon(input.icon) : null;
      const changed = icon && platformIconSource(icon) !== (platform.iconSrc || null);
      const iconFile = changed ? await write('platform-icon', 'platform-icon', icon.mimeType, Buffer.from(icon.base64, 'base64')) : null;
      return platformResult(await repository.updatePlatformSettings(input, {
        assertAccess, currentIcon: platform.iconSrc || null, observedFileId: current.iconFile?.id || null, iconFile,
      }));
    },
  };
  return {
    ...repository, ...methods,
    invoke: (name, args = []) => Object.hasOwn(methods, name)
      ? methods[name](...args).then(data => ({ data, notifications: [] }))
      : repository.invoke(name, args),
    async close() { try { await repository.close(); } finally { storage?.close(); } },
  };
}
