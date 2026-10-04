import { AuthError, SESSION_SECONDS, csrfToken } from './auth-repository.js';

const COOKIE_NAME = 'guild_session';
function readToken(request) {
  const cookies = (request.get('Cookie') || '').split(';').map((value) => value.trim());
  const matches = cookies.filter((value) => value.startsWith(`${COOKIE_NAME}=`));
  return matches.length === 1 ? matches[0].slice(COOKIE_NAME.length + 1) : null;
}
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
  };
}
function publicRequest(request) {
  const path = request.path;
  if (
    request.method === 'GET' &&
    ['/health', '/auth/session', '/events', '/professions', '/calendar/members'].includes(path)
  )
    return true;
  if (request.method === 'POST' && path === '/auth/login') return true;
  if (
    ['GET', 'POST', 'PATCH'].includes(request.method) &&
    /^\/events\/[^/]+\/participation$/.test(path)
  )
    return true;
  if (request.method === 'POST' && /^\/events\/[^/]+\/registrations$/.test(path)) return true;
  return request.method === 'DELETE' && /^\/events\/[^/]+\/registrations\/[^/]+$/.test(path);
}

export function installAuth(app, repository, { now = Date.now } = {}) {
  const failures = new Map();
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    request.sessionToken = readToken(request);
    request.auth = repository.getSession(request.sessionToken);
    if (publicRequest(request)) return next();
    if (!request.auth) return next(new AuthError(401, 'AUTH_REQUIRED', '請先登入後再使用管理功能'));
    if (request.auth.user.role === 'member' && request.path !== '/auth/logout')
      return next(new AuthError(403, 'MANAGEMENT_REQUIRED', 'member 帳號只能使用行事曆報名功能'));
    if (request.path.startsWith('/admin') && request.auth.user.role !== 'admin')
      return next(new AuthError(403, 'ADMIN_REQUIRED', '只有 admin 可以管理帳號'));
    if (
      ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
      request.get('X-CSRF-Token') !== csrfToken(request.sessionToken)
    ) {
      return next(new AuthError(403, 'CSRF_INVALID', '登入驗證已變更, 請重新整理後再試'));
    }
    next();
  });
  app.get('/api/auth/session', (request, response) => {
    const session = request.auth;
    response.json(
      session
        ? {
            user: session.user,
            expiresAt: new Date(session.expiresAt).toISOString(),
            csrfToken: csrfToken(request.sessionToken),
          }
        : { user: null },
    );
  });
  app.post('/api/auth/login', async (request, response) => {
    const key = request.ip;
    for (const [ip, value] of failures) if (value.until <= now()) failures.delete(ip);
    const previous = failures.get(key);
    if (previous?.count >= 10)
      throw new AuthError(429, 'LOGIN_LIMIT', '嘗試次數過多, 請於 5 分鐘後再登入');
    // Count before awaiting password verification so parallel requests cannot bypass the limit.
    const attempt = previous || { count: 0, until: now() + 5 * 60 * 1000 };
    attempt.count += 1;
    failures.set(key, attempt);
    const session = await repository.authenticate(request.body);
    failures.delete(key);
    repository.revokeSession(request.sessionToken);
    response.cookie(COOKIE_NAME, session.token, {
      ...cookieOptions(),
      maxAge: SESSION_SECONDS * 1000,
    });
    response.json({
      user: session.user,
      expiresAt: new Date(session.expiresAt).toISOString(),
      csrfToken: csrfToken(session.token),
    });
  });
  app.post('/api/auth/logout', (request, response) => {
    repository.revokeSession(request.sessionToken);
    response.clearCookie(COOKIE_NAME, cookieOptions()).json({ user: null });
  });
}
