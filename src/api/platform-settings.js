import { callGas } from './gas.js';
import { sessionFetch } from './session.js';

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
    return data;
  }
  return { getSettings: () => call(), updateSettings: (input) => call(input) };
}
