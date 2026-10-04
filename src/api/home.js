import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
export function createHomeClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  return {
    async getHomeData() {
      let data;
      if (source === 'gas') {
        data = await callGas('getHomeData', [], googleRun);
      } else {
        const response = await fetchImpl('/api/home');
        if (!response.ok) throw new Error('本機資料讀取失敗，請確認 API 已啟動後重試');
        data = await response.json();
      }
      if (
        !data?.guild ||
        !data.summary ||
        !Array.isArray(data.events) ||
        !['demo', 'empty', 'live'].includes(data.meta?.mode)
      ) {
        throw new Error('資料格式不符，請確認首頁資料介面');
      }
      return data;
    },
  };
}
