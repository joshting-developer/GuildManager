import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { utf8Bytes } from '../../src/domain/utf8.js';

export class GasError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    Object.assign(this, { code, fields });
  }
}
export const fail = (code, message, fields) => {
  throw new GasError(code, message, fields);
};
export const clone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const lower = (value) => value.toLowerCase();
export function canonical(value) {
  return JSON.stringify(normalize(value));
}
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, normalize(value[key])]),
    );
  return value;
}
export const hash = (text) => bytesToHex(sha256(utf8Bytes(text)));
export const mac = (secret, text) => bytesToHex(hmac(sha256, hexToBytes(secret), utf8Bytes(text)));
export function equalSecret(left, right) {
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return difference === 0;
}
export function derivePassword(password, salt) {
  return bytesToHex(
    pbkdf2(sha256, utf8Bytes(password), hexToBytes(salt), { c: 600000, dkLen: 32 }),
  );
}
export function text(value, label, max = 64, required = true) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    (required && !value.trim())
  )
    fail('VALIDATION_ERROR', `${label}格式不正確，最多 ${max} 字`);
  return value.trim();
}
export function revision(value, current) {
  if (!Number.isSafeInteger(value) || value < 0 || value !== current)
    fail('REVISION_CONFLICT', '資料已更新，請重新載入後再操作');
}
export function requestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    fail('INVALID_REQUEST', '操作識別碼不正確，請重新操作');
  return value;
}
export function pageNumber(value = 1) {
  if (!Number.isSafeInteger(value) || value < 1) fail('VALIDATION_ERROR', '頁碼不正確');
  return value;
}
export function retry(store, operation, id, input, work) {
  const key = requestId(id),
    fingerprint = hash(canonical([operation, input]));
  const previous = store.get('requests', key);
  if (previous) {
    if (previous.hash !== fingerprint)
      fail('REQUEST_CONFLICT', '操作識別碼已用於其他資料，請重新操作');
    return clone(previous.result);
  }
  const result = work();
  store.put('requests', key, { hash: fingerprint, result });
  return result;
}
