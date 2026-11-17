import { createHash } from 'node:crypto';
import { FileStorageError } from '../storage/r2.js';

/**
 * authorize must revalidate the server session and resource access on every call,
 * returning a trusted { key, name, mimeType } descriptor or null. Never pass a
 * browser supplied descriptor. Metadata linking/transactions belong to the caller.
 */
export function createPrivateFileService({ storage, authorize }) {
  if (!storage || typeof authorize !== 'function') throw new TypeError('storage and authorize are required');
  async function descriptor(sessionToken, resourceId, operation) {
    const file = await authorize({ sessionToken, resourceId, operation });
    if (!file) {
      const error = new Error('沒有存取這個檔案的權限');
      error.code = 'FILE_ACCESS_DENIED';
      error.status = 403;
      throw error;
    }
    if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 160 || /[\u0000-\u001f\u007f/\\]/.test(file.name) ||
        !['text/csv', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)) throw new FileStorageError('INVALID_FILE', 422);
    return file;
  }
  function validateBytes(bytes, mimeType) {
    const max = mimeType === 'text/csv' ? 1024 * 1024 : 4 * 1024 * 1024;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > max) throw new FileStorageError('INVALID_FILE', 422);
    const valid = mimeType === 'text/csv' ||
      (mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mimeType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
      (mimeType === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
    if (!valid) throw new FileStorageError('INVALID_FILE', 422);
  }
  return {
    async upload(sessionToken, resourceId, bytes) {
      const file = await descriptor(sessionToken, resourceId, 'upload');
      validateBytes(bytes, file.mimeType);
      await storage.put(file.key, bytes, file.mimeType);
      return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    },
    async download(sessionToken, resourceId) {
      const file = await descriptor(sessionToken, resourceId, 'download');
      const bytes = await storage.get(file.key);
      validateBytes(bytes, file.mimeType);
      return { name: file.name, mimeType: file.mimeType, bytes };
    },
    async remove(sessionToken, resourceId) {
      const file = await descriptor(sessionToken, resourceId, 'remove');
      await storage.remove(file.key);
    },
  };
}
