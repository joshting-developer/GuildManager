import { derivePassword, equalSecret, fail, hash, lower, mac, revision } from './common.js';
const MEMBER = 'guild_member',
  EXPIRY = 8 * 60 * 60 * 1000;
const userDto = (account) => ({
  id: account.id,
  username: account.role === 'member' ? '' : account.username,
  role: account.role,
});
const accountDto = ({ id, username, role, revision, createdAt }) => ({
  id,
  username,
  role,
  revision,
  createdAt,
});
export function createGasAuth(
  state,
  { secret, uuid, clock = Date.now, passwordKdf = derivePassword },
) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) fail('CONFIG_INVALID', '請先設定私有 AUTH_SECRET');
  const makeToken = () => mac(secret, `${uuid()}:${clock()}:${uuid()}`);
  const csrf = (token) => mac(secret, `csrf:${token}`);
  function clean() {
    state.sessions = state.sessions.filter((session) => session.expiresAt > clock());
    state.limits = state.limits.filter((limit) => limit.until > clock());
  }
  function username(value) {
    if (
      typeof value !== 'string' ||
      !/^[a-zA-Z0-9_.-]{3,32}$/.test(value) ||
      lower(value) === MEMBER
    )
      fail('INVALID_ACCOUNT', '帳號請使用 3–32 個英數字、底線、點或減號，並避開保留名稱');
    return value;
  }
  function password(value, member = false) {
    if (
      typeof value !== 'string' ||
      (member ? !/^[a-zA-Z0-9]{6,128}$/.test(value) : value.length < 12 || value.length > 128)
    )
      fail(
        'INVALID_PASSWORD',
        member ? '通行密碼須為 6–128 個英文字母或數字' : '密碼長度須為 12–128 個字元',
      );
    const salt = makeToken().slice(0, 32);
    return { salt, hash: passwordKdf(value, salt), kdf: 'pbkdf2-sha256-600000' };
  }
  function verify(value, account) {
    const valid = typeof value === 'string' && value.length <= 128;
    const actual = passwordKdf(valid ? value : '', account?.salt || '0'.repeat(32));
    return valid && !!account && equalSecret(actual, account.hash);
  }
  function session(context = {}) {
    const token = context?.sessionToken;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const record = state.sessions.find((value) => value.tokenHash === hash(token));
    const account = state.accounts.find((value) => value.id === record?.accountId);
    if (
      !record ||
      !account ||
      record.expiresAt <= clock() ||
      record.accountRevision !== account.revision
    )
      return null;
    return {
      user: userDto(account),
      expiresAt: new Date(record.expiresAt).toISOString(),
      csrfToken: csrf(token),
    };
  }
  function requireRole(context, roles = ['admin', 'manager']) {
    const current = session(context);
    if (!current) fail('AUTH_REQUIRED', '請先登入後再操作');
    if (!roles.includes(current.user.role))
      fail(
        roles.length === 1 ? 'ADMIN_REQUIRED' : 'MANAGEMENT_REQUIRED',
        roles.length === 1 ? '只有 admin 可以管理帳號' : '此登入只能使用行事曆報名功能',
      );
    return current.user;
  }
  function requireWrite(context) {
    if (
      session(context) &&
      !equalSecret(String(context?.csrfToken || ''), csrf(context.sessionToken))
    )
      fail('CSRF_INVALID', '登入驗證已變更，請重新登入');
  }
  function memberSettings() {
    const account = state.accounts.find(
      (account) => account.username === MEMBER && account.role === 'member',
    );
    return { configured: !!account, revision: account?.revision || 0 };
  }
  function revoke(accountId, except) {
    state.sessions = state.sessions.filter(
      (record) => record.accountId !== accountId || record.tokenHash === except,
    );
  }
  function login(input, context, member = false) {
    clean();
    const name = member
      ? MEMBER
      : typeof input?.username === 'string'
        ? lower(input.username).slice(0, 32)
        : 'unknown';
    const key = `login:${name}`;
    for (const [id, maximum] of [
      ['global', 50],
      [key, 10],
    ]) {
      let limit = state.limits.find((value) => value.id === id);
      if (!limit) {
        limit = { id, count: 0, until: clock() + 300000 };
        state.limits.push(limit);
      }
      if (limit.count >= maximum) fail('LOGIN_LIMIT', '嘗試次數過多，請於 5 分鐘後再登入');
      limit.count++;
    }
    const account = state.accounts.find((account) => lower(account.username) === name);
    if (
      !verify(input?.password, account) ||
      (member ? account.role !== 'member' : account.role === 'member')
    )
      fail(
        'INVALID_CREDENTIALS',
        member ? '通行密碼不正確或尚未設定，請聯絡管理者' : '帳號或密碼不正確',
      );
    state.limits = state.limits.filter((value) => value.id !== key);
    state.limits.find((value) => value.id === 'global').count--;
    const oldHash = context?.sessionToken ? hash(context.sessionToken) : '';
    state.sessions = state.sessions.filter((value) => value.tokenHash !== oldHash);
    if (state.sessions.length >= 200) fail('AUTH_CAPACITY', '登入人數已達上限，請稍後再試');
    const token = makeToken();
    state.sessions.push({
      tokenHash: hash(token),
      accountId: account.id,
      accountRevision: account.revision,
      expiresAt: clock() + EXPIRY,
    });
    return { ...session({ sessionToken: token }), sessionToken: token };
  }
  const methods = {
    getAuthSession: (_args, context) => session(context) || { user: null },
    login: ([input], context) => login(input, context),
    loginMember: ([input], context) => login(input, context, true),
    logout(_args, context) {
      requireRole(context, ['admin', 'manager', 'member']);
      requireWrite(context);
      state.sessions = state.sessions.filter(
        (value) => value.tokenHash !== hash(context.sessionToken),
      );
      return { user: null };
    },
    getAccountSettings(_args, context) {
      const admin = requireRole(context, ['admin']);
      return {
        admin: accountDto(state.accounts.find((account) => account.id === admin.id)),
        managers: state.accounts
          .filter((account) => account.role === 'manager')
          .map(accountDto)
          .sort((a, b) => a.username.localeCompare(b.username)),
        memberToken: memberSettings(),
      };
    },
    changeAdminPassword([input], context) {
      const admin = requireRole(context, ['admin']);
      requireWrite(context);
      const account = state.accounts.find((account) => account.id === admin.id);
      revision(input?.revision, account.revision);
      if (!verify(input.currentPassword, account))
        fail('CURRENT_PASSWORD_INVALID', '目前密碼不正確');
      Object.assign(account, password(input.password), { revision: account.revision + 1 });
      revoke(account.id, hash(context.sessionToken));
      // Keep the current session valid after updating the account revision.
      state.sessions.find(
        (value) => value.tokenHash === hash(context.sessionToken),
      ).accountRevision = account.revision;
      return { admin: accountDto(account) };
    },
    createManager([input], context) {
      requireRole(context, ['admin']);
      requireWrite(context);
      const name = username(input?.username);
      if (state.accounts.some((account) => lower(account.username) === lower(name)))
        fail('ACCOUNT_EXISTS', '帳號已存在');
      if (state.accounts.length >= 50) fail('AUTH_CAPACITY', '管理帳號數量已達上限');
      const account = {
        id: uuid(),
        username: name,
        role: 'manager',
        revision: 1,
        createdAt: new Date(clock()).toISOString(),
        ...password(input.password),
      };
      state.accounts.push(account);
      return { manager: accountDto(account) };
    },
    updateManager([input], context) {
      requireRole(context, ['admin']);
      requireWrite(context);
      const account = state.accounts.find(
        (account) => account.id === input?.id && account.role === 'manager',
      );
      if (!account) fail('ACCOUNT_NOT_FOUND', '找不到 manager 帳號');
      revision(input.revision, account.revision);
      const name = username(input.username);
      if (
        state.accounts.some(
          (other) => other.id !== account.id && lower(other.username) === lower(name),
        )
      )
        fail('ACCOUNT_EXISTS', '帳號已存在');
      const nextPassword =
        input.password === '' || input.password === undefined ? {} : password(input.password);
      Object.assign(account, nextPassword, { username: name, revision: account.revision + 1 });
      revoke(account.id);
      return { manager: accountDto(account) };
    },
    setMemberToken([input], context) {
      requireRole(context, ['admin']);
      requireWrite(context);
      let account = state.accounts.find((account) => account.username === MEMBER);
      revision(input?.revision, account?.revision || 0);
      const encrypted = password(input.password, true);
      if (!account) {
        account = {
          id: uuid(),
          username: MEMBER,
          role: 'member',
          revision: 0,
          createdAt: new Date(clock()).toISOString(),
        };
        state.accounts.push(account);
      }
      Object.assign(account, encrypted, { revision: account.revision + 1 });
      revoke(account.id);
      return { memberToken: memberSettings() };
    },
  };
  function bootstrap(input) {
    if (state.accounts.length) return false;
    state.accounts.push({
      id: uuid(),
      username: username(input.username),
      role: 'admin',
      revision: 1,
      createdAt: new Date(clock()).toISOString(),
      ...password(input.password),
    });
    return true;
  }
  return { methods, session, requireRole, requireWrite, bootstrap, clean };
}
