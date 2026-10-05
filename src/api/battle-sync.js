import { callGas } from './gas.js';
import { sessionFetch } from './session.js';

export function createBattleSyncClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(input) {
    if (source === 'gas') return callGas(input ? 'syncBattleMembers' : 'previewBattleMemberSync', input ? [input] : [], googleRun);
    let response;
    try {
      response = await fetchImpl(input ? '/api/battle-sync' : '/api/battle-sync/preview', input ? {
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
