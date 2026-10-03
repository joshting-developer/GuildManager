import { sessionFetch } from './session.js';
export function createHomeClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  return {
    async getHomeData() {
      let data;
      if (source === 'gas') {
        const run = googleRun || globalThis.google?.script?.run;
        if (!run) throw new Error('雲端資料介面尚未串接，請在 Apps Script 環境中使用');
        data = await new Promise((resolve, reject) => {
          run
            .withSuccessHandler(resolve)
            .withFailureHandler(() =>
              reject(new Error('雲端資料讀取失敗，請確認資料介面與存取權限')),
            )
            .getHomeData();
        });
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
