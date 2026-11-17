import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export class FileStorageError extends Error {
  constructor(code = 'STORAGE_UNAVAILABLE', status = 503) {
    super(code === 'FILE_NOT_FOUND' ? '找不到檔案' : code === 'INVALID_FILE' ? '檔案格式或大小不正確' : '檔案服務暫時無法使用，請稍後重試');
    this.name = 'FileStorageError';
    this.code = code;
    this.status = status;
  }
}

function configuration(env) {
  const endpoint = env.R2_ENDPOINT;
  if (typeof endpoint !== 'string' || !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/.test(endpoint) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET || '') ||
      !env.R2_ACCESS_KEY_ID?.trim() || !env.R2_SECRET_ACCESS_KEY?.trim() ||
      (env.R2_REGION !== undefined && env.R2_REGION !== 'auto') || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new FileStorageError();
  }
  return { endpoint, bucket: env.R2_BUCKET };
}

function validateKey(key) {
  // Only server-owned keys; never accept URLs, paths or keys outside this namespace.
  if (typeof key !== 'string' || !/^files\/[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_-]{1,128}$/.test(key)) {
    throw new FileStorageError('INVALID_FILE', 422);
  }
}

/** Bounded private object IO. No listing, public ACL, presigning or automatic retries. */
export function createR2Storage(env, { client: injectedClient, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024 } = {}) {
  const { endpoint, bucket } = configuration(env);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024) throw new FileStorageError();
  // Node's global TLS escape hatch must not silently disable certificate validation.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new FileStorageError();
  const client = injectedClient || new S3Client({
    endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 3000, requestTimeout: timeoutMs },
  });
  async function perform(Command, key, input = {}, read = false) {
    validateKey(key);
    const controller = new AbortController();
    let body;
    const timer = setTimeout(() => {
      controller.abort();
      body?.destroy?.(new FileStorageError());
    }, timeoutMs);
    try {
      const result = await client.send(new Command({ Bucket: bucket, Key: key, ...input }), { abortSignal: controller.signal });
      if (!read) return;
      body = result.Body;
      if (!body || !Number.isSafeInteger(result.ContentLength) || result.ContentLength < 1 || result.ContentLength > maxBytes) {
        throw new FileStorageError('INVALID_FILE', 422);
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of body) {
        length += chunk.length;
        if (length > maxBytes || controller.signal.aborted) throw new FileStorageError();
        chunks.push(Buffer.from(chunk));
      }
      if (length !== result.ContentLength) throw new FileStorageError();
      return Buffer.concat(chunks, length);
    } catch (error) {
      if (error instanceof FileStorageError) throw error;
      if (read && error?.$metadata?.httpStatusCode === 404) throw new FileStorageError('FILE_NOT_FOUND', 404);
      // Provider messages, endpoints and keys must not cross the service boundary.
      throw new FileStorageError();
    } finally {
      clearTimeout(timer);
      body?.destroy?.();
    }
  }
  return {
    async put(key, bytes, mimeType) {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxBytes ||
          !['text/csv', 'image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new FileStorageError('INVALID_FILE', 422);
      await perform(PutObjectCommand, key, { Body: bytes, ContentType: mimeType, ContentLength: bytes.length });
    },
    get: key => perform(GetObjectCommand, key, {}, true),
    remove: key => perform(DeleteObjectCommand, key),
    close() { if (!injectedClient) client.destroy(); },
  };
}
