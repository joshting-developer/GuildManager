export async function authenticatedFetch(server, repository) {
  const credentials = { username: 'test_admin', password: 'test-password-2026' };
  await repository.createAccount(credentials);
  const response = await globalThis.fetch(
    `http://127.0.0.1:${server.address().port}/api/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    },
  );
  if (!response.ok) throw new Error('測試帳號登入失敗');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const session = await response.json();
  return (url, init = {}) =>
    globalThis.fetch(url, {
      ...init,
      headers: { Cookie: cookie, 'X-CSRF-Token': session.csrfToken, ...init.headers },
    });
}
