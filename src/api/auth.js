import { callGas, setGasSession } from './gas.js';
import { setCsrfToken, sessionFetch } from './session.js';

export function createAuthClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  let version = 0;
  async function call(operation, path, input) {
    const currentVersion = ++version;
    let data;
    if (source === 'gas') {
      data = await callGas(operation, input ? [input] : [], googleRun);
    } else {
      let response;
      try {
        response = await fetchImpl(`/api/auth/${path}`, {
          ...(input
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
              }
            : {}),
        });
      } catch {
        throw new Error('無法連線, 請確認本機服務已啟動後重試');
      }
      try {
        data = await response.json();
      } catch {
        throw new Error('登入回應格式不正確, 請稍後再試');
      }
      if (!response.ok) {
        const error = new Error(data.error?.message || '無法完成登入操作');
        error.code = data.error?.code;
        throw error;
      }
    }
    if (
      !data ||
      !Object.hasOwn(data, 'user') ||
      (data.user !== null &&
        (typeof data.user?.id !== 'string' ||
          typeof data.user?.username !== 'string' ||
          typeof data.csrfToken !== 'string' ||
          !Number.isFinite(Date.parse(data.expiresAt))))
    ) {
      throw new Error('登入回應格式不正確, 請稍後再試');
    }
    if (['login', 'loginMember'].includes(operation) && !data.user)
      throw new Error('登入未完成, 請再試一次');
    if (currentVersion === version) {
      setCsrfToken(data.csrfToken);
      if (source === 'gas') setGasSession(data);
    }
    return data;
  }
  return {
    getSession: () => call('getAuthSession', 'session'),
    loginMember: (input) => call('loginMember', 'member-login', { password: input.password }),
    login: (input) => call('login', 'login', input),
    logout: () => call('logout', 'logout', {}),
  };
}
