import { sessionFetch } from './session.js';
export function createHomeClient({ fetchImpl = sessionFetch } = {}) {
  return {
    async getHomeData() {
      let data;

      const response = await fetchImpl('/api/home');
      if (!response.ok) throw new Error('本機資料讀取失敗，請確認 API 已啟動後重試');
      data = await response.json();

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
