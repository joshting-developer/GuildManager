let token = '';
export function setCsrfToken(value) {
  token = typeof value === 'string' ? value : '';
}
export async function sessionFetch(path, init = {}) {
  const headers = new Headers(init.headers);
  if (token && ['POST', 'PATCH', 'DELETE'].includes(init.method))
    headers.set('X-CSRF-Token', token);
  const response = await globalThis.fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401 && path !== '/api/auth/login' && typeof window !== 'undefined') {
    setCsrfToken('');
    window.dispatchEvent(new Event('guild-auth-required'));
  }
  return response;
}
