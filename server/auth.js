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
function publicRequest(request, repository) {
  const path = request.path;
  if (
    request.method === 'GET' &&
    ['/health', '/auth/session', '/events', '/professions'].includes(path)
  )
    return true;
  if (request.method === 'POST' && ['/auth/login', '/auth/member-login'].includes(path)) return true;
  const participation = path.match(
    /^\/events\/([^/]+)\/(participation|participation-members|registrations(?:\/[^/]+)?)$/,
  );
  if (!participation) return false;
  const allowed =
    participation[2] === 'participation'
      ? ['GET', 'POST', 'PATCH']
      : participation[2] === 'participation-members'
        ? ['GET']
        : participation[2] === 'registrations'
          ? ['POST']
          : ['DELETE'];
  if (!allowed.includes(request.method)) return false;
  request.participationAccess = true;
  let eventId;
  try {
    eventId = decodeURIComponent(participation[1]);
  } catch {
    throw new AuthError(422, 'INVALID_EVENT', '場次資料格式不正確');
  }
  const requiresLogin =
    repository.participationRequiresLogin(eventId) || participation[2] === 'participation-members';
  request.participationLoginRequired = requiresLogin;
  // Anonymous scrimmages remain public; any authenticated write still requires CSRF.
  return !requiresLogin && (!request.auth || request.method === 'GET');
}

export function installAuth(app, repository, { now = Date.now } = {}) {
  const failures = new Map();
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    request.sessionToken = readToken(request);
    request.auth = repository.getSession(request.sessionToken);
    if (publicRequest(request, repository)) return next();
    if (!request.auth)
      return next(
        new AuthError(
          401,
          'AUTH_REQUIRED',
          request.participationLoginRequired
            ? '請先登入帳號後再報名或請假'
            : '請先登入後再使用管理功能',
        ),
      );
    if (
      request.auth.user.role === 'member' &&
      request.path !== '/auth/logout' &&
      !request.participationAccess &&
      request.path !== '/calendar/members'
    )
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
  const login = (memberLogin) => async (request, response) => {
    const key = request.ip;
    for (const [ip, value] of failures) if (value.until <= now()) failures.delete(ip);
    const previous = failures.get(key);
    if (previous?.count >= 10)
      throw new AuthError(429, 'LOGIN_LIMIT', '嘗試次數過多, 請於 5 分鐘後再登入');
    // Count before awaiting password verification so parallel requests cannot bypass the limit.
    const attempt = previous || { count: 0, until: now() + 5 * 60 * 1000 };
    attempt.count += 1;
    failures.set(key, attempt);
    const session = await (memberLogin ? repository.authenticateMember(request.body) : repository.authenticate(request.body));
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
  };
  app.post('/api/auth/login', login(false));
  app.post('/api/auth/member-login', login(true));
  app.post('/api/auth/logout', (request, response) => {
    repository.revokeSession(request.sessionToken);
    response.clearCookie(COOKIE_NAME, cookieOptions()).json({ user: null });
  });
}
