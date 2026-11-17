import { sessionFetch } from './session.js';

export function createAdminClient({ fetchImpl = sessionFetch } = {}) {
  async function call(path, method = 'GET', input) {
    let response;
    try {
      response = await fetchImpl(`/api/admin/${path}`, {
        method,
        ...(input
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
          : {}),
      });
    } catch {
      throw new Error('無法連線, 請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('資料回應格式不正確, 請稍後再試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '無法完成帳號管理操作');
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return {
    getAccounts: () => call('accounts'),
    changePassword: (input) => call('password', 'POST', input),
    createManager: (input) => call('managers', 'POST', input),
    setMemberToken: (input) => call('member-token', 'PATCH', input),
    updateManager: (id, input) =>
      call(`managers/${encodeURIComponent(id)}`, 'PATCH', { ...input, id }),
  };
}
