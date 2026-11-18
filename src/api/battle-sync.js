import { sessionFetch } from './session.js';

export function createBattleSyncClient({ fetchImpl = sessionFetch } = {}) {
  async function call(input) {
    let response;
    try {
      response = await fetchImpl(input ? '/api/admin/battle-sync' : '/api/admin/battle-sync/preview', input ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      } : {});
    } catch { throw new Error('無法連線，請確認服務後重試'); }
    let data;
    try { data = await response.json(); }
    catch { throw new Error('同步回應格式不正確，請重新載入'); }
    if (!response.ok) throw Object.assign(new Error(data.error?.message || '同步戰績失敗，請重試'), { code: data.error?.code });
    return data;
  }
  return { preview: () => call(), sync: input => call(input) };
}
