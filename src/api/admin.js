import { sessionFetch } from './session.js';

export function createAdminClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(operation, path, method = 'GET', input) {
    if (source === 'gas') {
      const run = googleRun || globalThis.google?.script?.run;
      if (!run) throw new Error('雲端帳號與 token 管理尚未串接');
      return new Promise((resolve, reject) => {
        run
          .withSuccessHandler(resolve)
          .withFailureHandler((error) =>
            reject(new Error(error?.message || '雲端帳號管理操作失敗')),
          )
          [operation](...(input ? [input] : []));
      });
    }
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
    getAccounts: () => call('getAccountSettings', 'accounts'),
    changePassword: (input) => call('changeAdminPassword', 'password', 'POST', input),
    createManager: (input) => call('createManager', 'managers', 'POST', input),
    createMember: (input) => call('createMemberAccount', 'members', 'POST', input),
    updateMember: (id, input) =>
      call('updateMemberAccount', `members/${encodeURIComponent(id)}`, 'PATCH', { ...input, id }),
    updateManager: (id, input) =>
      call('updateManager', `managers/${encodeURIComponent(id)}`, 'PATCH', { ...input, id }),
  };
}
