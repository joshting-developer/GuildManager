import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
export function createDutyClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(method, input, id) {
    if (source === 'gas') {
      const operation = { GET: 'getDuties', POST: 'addDuty', PATCH: 'updateDuty' }[method];
      const args =
        method === 'GET'
          ? []
          : method === 'POST'
            ? [input]
            : [id, method === 'DELETE' ? input.revision : input];
      return callGas(operation, args, googleRun);
    }
    let response;
    try {
      response = await fetchImpl(
        id === undefined ? '/api/duties' : `/api/duties/${encodeURIComponent(id)}`,
        {
          method,
          ...(input
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
            : {}),
        },
      );
    } catch {
      throw new Error('無法連線，請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('資料回應格式不正確，請稍後再試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '目前無法完成操作，請稍後再試');
      error.fields = data.error?.fields || {};
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return {
    getDuties: () => call('GET'),
    addDuty: (input) => call('POST', input),
    updateDuty: (id, input) => call('PATCH', input, id),
  };
}
