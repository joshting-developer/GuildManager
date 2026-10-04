// HTML Service cannot issue our local HttpOnly cookie. Keep the cloud credential
// per tab, scoped to this Script project; never include it in business DTOs.
let cloudToken = '',
  cloudCsrf = '';
function storageKey() {
  return `guild-gas:${globalThis.__GUILD_GAS_KEY__ || 'default'}`;
}
function readToken() {
  if (cloudToken) return cloudToken;
  try {
    cloudToken = globalThis.sessionStorage?.getItem(storageKey()) || '';
  } catch {}
  return cloudToken;
}
export function setGasSession(data) {
  cloudToken = data?.user ? data.sessionToken || readToken() : '';
  cloudCsrf = data?.csrfToken || '';
  try {
    if (cloudToken) globalThis.sessionStorage?.setItem(storageKey(), cloudToken);
    else globalThis.sessionStorage?.removeItem(storageKey());
  } catch {}
}
export async function callGas(operation, args = [], googleRun) {
  const run = googleRun || globalThis.google?.script?.run;
  if (!run) throw new Error('請在 Apps Script Web App 中使用雲端資料介面');
  const token = readToken();
  const result = await new Promise((resolve, reject) => {
    run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) =>
        reject(new Error(error?.message || '雲端操作失敗，請稍後再試')),
      )
      [operation](...args, ...(token ? [{ sessionToken: token, csrfToken: cloudCsrf }] : []));
  });
  if (result?.__gasRpc !== 1) return result;
  if (result.ok) return result.data;
  const error = Object.assign(new Error(result.error?.message || '雲端操作失敗'), {
    code: result.error?.code,
    fields: result.error?.fields || {},
    rows: result.error?.rows || [],
  });
  if (error.code === 'AUTH_REQUIRED' && !['login', 'loginMember'].includes(operation)) {
    setGasSession({ user: null });
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('guild-auth-required'));
  }
  throw error;
}
