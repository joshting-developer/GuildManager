export const DEFAULT_PLATFORM_NAME = '逆水寒';
export const MAX_PLATFORM_ICON_BYTES = 256 * 1024;

export function validatePlatformIcon(icon) {
  if (icon === null) return null;
  const invalid = () => {
    throw new PlatformSettingsError(
      422,
      'INVALID_PLATFORM_ICON',
      '圖示須為有效的 PNG、JPEG 或 WebP 圖片，最多 256 KB',
    );
  };
  if (
    !icon ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(icon.mimeType) ||
    typeof icon.base64 !== 'string' ||
    !icon.base64 ||
    icon.base64.length > Math.ceil(MAX_PLATFORM_ICON_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(icon.base64)
  )
    invalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = icon.base64.endsWith('==') ? 2 : icon.base64.endsWith('=') ? 1 : 0;
  const size = (icon.base64.length / 4) * 3 - padding;
  const last = alphabet.indexOf(icon.base64[icon.base64.length - padding - 1]);
  if (
    size > MAX_PLATFORM_ICON_BYTES ||
    size < 12 ||
    (padding === 2 && last & 15) ||
    (padding === 1 && last & 3)
  )
    invalid();
  // Decode only the signature, using the same implementation in browsers and GAS.
  const bytes = [];
  for (let i = 0; i < Math.min(icon.base64.length, 32); i += 4) {
    const value =
      (alphabet.indexOf(icon.base64[i]) << 18) |
      (alphabet.indexOf(icon.base64[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(icon.base64[i + 2])) << 6) |
      Math.max(0, alphabet.indexOf(icon.base64[i + 3]));
    bytes.push((value >>> 16) & 255, (value >>> 8) & 255, value & 255);
  }
  const matches = (signature, offset = 0) =>
    signature.every((byte, index) => bytes[index + offset] === byte);
  if (icon.mimeType === 'image/png' && !matches([137, 80, 78, 71, 13, 10, 26, 10])) invalid();
  if (icon.mimeType === 'image/jpeg' && !matches([255, 216, 255])) invalid();
  if (
    icon.mimeType === 'image/webp' &&
    !(matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8))
  )
    invalid();
  return { mimeType: icon.mimeType, base64: icon.base64 };
}

export function platformIconSource(icon) {
  return icon ? `data:${icon.mimeType};base64,${icon.base64}` : null;
}

export class PlatformSettingsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validatePlatformSettings(input, current) {
  const iconMatches =
    !Object.prototype.hasOwnProperty.call(input || {}, 'icon') ||
    platformIconSource(validatePlatformIcon(input.icon)) === (current.iconSrc || null);
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name || [...name].length > 30 || /[\u0000-\u001f\u007f-\u009f]/u.test(input.name)) {
    throw new PlatformSettingsError(
      422,
      'INVALID_PLATFORM_NAME',
      '平台名稱須為 1–30 個字，不能包含換行或控制字元',
    );
  }
  if (!Number.isSafeInteger(input?.revision) || input.revision < 1) {
    throw new PlatformSettingsError(422, 'INVALID_REVISION', '設定版本不正確，請重新載入');
  }
  // A retry after a lost successful response can return the already saved value.
  if (
    input.revision !== current.revision &&
    !(name === current.name && iconMatches && input.revision + 1 === current.revision)
  ) {
    throw new PlatformSettingsError(409, 'STALE_SETTINGS', '平台設定已被修改，請重新載入後再儲存');
  }
  return name;
}
