export const DEFAULT_PLATFORM_NAME = '逆水寒';

export class PlatformSettingsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validatePlatformSettings(input, current) {
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
    !(name === current.name && input.revision + 1 === current.revision)
  ) {
    throw new PlatformSettingsError(409, 'STALE_SETTINGS', '平台設定已被修改，請重新載入後再儲存');
  }
  return name;
}
