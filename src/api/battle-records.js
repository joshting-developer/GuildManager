import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
export function createBattleRecordClient({
  source = 'local',
  fetchImpl = sessionFetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(operation, path, input, args = [], method = 'POST') {
    if (source === 'gas') {
      return callGas(operation, args, googleRun);
    }
    let response;
    try {
      response = await fetchImpl(
        `/api/battle-records${path}`,
        input
          ? {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            }
          : {},
      );
    } catch {
      throw new Error('無法連線, 請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('戰績回應格式不正確, 請稍後再試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '無法完成戰績操作');
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return {
    getRecords: (page = 1, eventId = null) =>
      call(
        'getBattleRecords',
        `?page=${page}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`,
        undefined,
        [page, eventId],
      ),
    getRecord: (id) => call('getBattleRecord', `/${encodeURIComponent(id)}`, undefined, [id]),
    saveRecords: (input) => call('saveBattleRecords', '', input, [input]),
    updateRecord: (id, input) =>
      call('updateBattleRecord', `/${encodeURIComponent(id)}`, input, [id, input], 'PATCH'),
    async getAttachment(id, kind) {
      if (!['csv', 'image'].includes(kind)) throw new Error('未知附件類型');
      if (source === 'gas') {
        const result = await call('getBattleAttachment', '', undefined, [id, kind]);
        return new Blob([Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))], {
          type: result.mimeType,
        });
      }
      let response;
      try {
        response = await fetchImpl(
          `/api/battle-records/${encodeURIComponent(id)}/attachments/${kind}`,
        );
      } catch {
        throw new Error('附件下載失敗, 請重試');
      }
      if (!response.ok) {
        let data;
        try {
          data = await response.json();
        } catch {}
        throw new Error(data?.error?.message || '附件下載失敗, 請重試');
      }
      return response.blob();
    },
  };
}
