import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
import { validatePlatformIcon, platformIconSource } from '../domain/platform-settings.js';

export function createPlatformSettingsClient({
  source = 'local',
  fetchImpl = sessionFetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(input) {
    let data;
    if (source === 'gas') {
      data = await callGas(
        input ? 'updatePlatformSettings' : 'getPlatformSettings',
        input ? [input] : [],
        googleRun,
      );
    } else {
      let response;
      try {
        response = await fetchImpl(
          input ? '/api/admin/platform-settings' : '/api/platform-settings',
          {
            method: input ? 'PATCH' : 'GET',
            ...(input
              ? {
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(input),
                }
              : {}),
          },
        );
      } catch {
        throw new Error('無法載入平台設定，請確認服務連線後重試');
      }
      try {
        data = await response.json();
      } catch {
        throw new Error('平台設定回應格式不正確，請重新載入');
      }
      if (!response.ok)
        throw Object.assign(new Error(data.error?.message || '無法儲存平台設定'), {
          code: data.error?.code,
        });
    }
    if (
      typeof data?.platform?.name !== 'string' ||
      !data.platform.name ||
      !Number.isSafeInteger(data.platform.revision)
    ) {
      throw new Error('平台設定回應格式不正確，請重新載入');
    }
    if (data.platform.iconSrc != null) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(data.platform.iconSrc);
      try {
        if (!match) throw new Error();
        validatePlatformIcon({ mimeType: match[1], base64: match[2] });
      } catch {
        throw new Error('平台圖示回應格式不正確，請重新載入');
      }
    }
    return data;
  }
  return { getSettings: () => call(), updateSettings: (input) => call(input) };
}

export async function readPlatformIcon(file) {
  if (!file || file.size > 256 * 1024) throw new Error('圖示最多 256 KB');
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('無法讀取圖片，請重新選擇'));
    reader.readAsDataURL(file);
  });
  const icon = validatePlatformIcon({ mimeType: file.type, base64 });
  await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      image.naturalWidth <= 4096 && image.naturalHeight <= 4096
        ? resolve()
        : reject(new Error('圖示尺寸最多 4096 × 4096 像素'));
    image.onerror = () => reject(new Error('無法顯示圖片，請選擇有效的 PNG、JPEG 或 WebP'));
    image.src = platformIconSource(icon);
  });
  return icon;
}
