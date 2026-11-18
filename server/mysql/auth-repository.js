import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const MEMBER_USERNAME = 'guild_member';
const publicUser = (account) => ({ id: account.id, username: account.role === 'member' ? '' : account.username, role: account.role });
export const SESSION_SECONDS = 8 * 60 * 60;
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const csrfToken = (token) => digest(`csrf:${token}`);
export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
export async function passwordHash(password, minimum = 6) {
  if (typeof password !== 'string' || password.length < minimum || password.length > 128)
    throw new AuthError(422, 'INVALID_PASSWORD', '密碼長度須為 6–128 個字元');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}
export async function verifySecret(secret, salt, hash) {
  if (typeof secret !== 'string' || secret.length > 128) return false;
  const actual = await scrypt(secret, salt || 'unknown-account-salt', 64);
  return timingSafeEqual(actual, Buffer.from(hash || '0'.repeat(128), 'hex'));
}
const accountChanged = () => new AuthError(409, 'ACCOUNT_CHANGED', '帳號資料已更新, 請重新載入');

function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username))
    throw new AuthError(422, 'INVALID_ACCOUNT', '帳號請使用 3–32 個英數字、底線、點或減號');
}
export function createAuthRepository(db, { now = Date.now } = {}) {
  async function checkAdmin(id, lock = '') {
    const account = (await db.prepare(`SELECT * FROM auth_accounts WHERE id = ?${lock}`).get(id));
    if (account?.role !== 'admin')
      throw new AuthError(403, 'ADMIN_REQUIRED', '只有 admin 可以管理帳號');
    return account;
  }
  const repository = {
    async createAccount({ username, password, role } = {}) {
      validateUsername(username);
      if (username.toLowerCase() === MEMBER_USERNAME)
        throw new AuthError(422, 'RESERVED_ACCOUNT', '此帳號名稱已保留');
      if ((await db.prepare('SELECT id FROM auth_accounts WHERE username = ?').get(username))) {
        throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 不會覆寫原密碼');
      }
      if (role !== undefined && !['admin', 'manager', 'member'].includes(role))
        throw new AuthError(422, 'INVALID_ROLE', '帳號角色不正確');
      const { salt, hash } = await passwordHash(password);
      const id = randomUUID();
      return (await db.transaction(async () => {
        if ((await db.prepare('SELECT id FROM auth_accounts WHERE username = ?').get(username)))
          throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 不會覆寫原密碼');
        const accountRole =
          role || ((await db.prepare('SELECT id FROM auth_accounts LIMIT 1').get()) ? 'manager' : 'admin');
        (await db.prepare(
          'INSERT INTO auth_accounts (id, username, password_salt, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, username, salt, hash, new Date(now()).toISOString(), accountRole));
        return { id, username, role: accountRole, revision: 1 };
      }));
    },
    async getAccountSettings(adminId) {
      const admin = (await checkAdmin(adminId));
      const columns = 'id, username, role, revision, created_at AS createdAt';
      return {
        admin: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          revision: admin.revision,
        },
        memberToken: (await repository.getMemberTokenSettings()),
        managers: (await db
          .prepare(`SELECT ${columns} FROM auth_accounts WHERE role = 'manager' ORDER BY username`)
          .all()),
      };
    },
    async createManagedAccount(adminId, input, role) {
      (await checkAdmin(adminId));
      // Never accept the role supplied by a browser.
      return (await repository.createAccount({
        username: input?.username,
        password: input?.password,
        role,
      }));
    },
    async updateManagedAccount(adminId, id, input, role) {
      (await checkAdmin(adminId));
      validateUsername(input?.username);
      if (input.username.toLowerCase() === MEMBER_USERNAME)
        throw new AuthError(422, 'RESERVED_ACCOUNT', '此帳號名稱已保留');
      if (!Number.isSafeInteger(input?.revision) || input.revision < 1) throw accountChanged();
      const secret =
        input.password === '' || input.password === undefined
          ? null
          : await passwordHash(input.password);
      return (await db.transaction(async () => {
        (await checkAdmin(adminId, ' FOR SHARE'));
        const manager = (await db
          .prepare('SELECT * FROM auth_accounts WHERE id = ? AND role = ? FOR UPDATE')
          .get(id, role));
        if (!manager) throw new AuthError(404, 'ACCOUNT_NOT_FOUND', `找不到 ${role} 帳號`);
        if (manager.revision !== input.revision) throw accountChanged();
        if (
          (await db
            .prepare('SELECT id FROM auth_accounts WHERE username = ? AND id != ?')
            .get(input.username, id))
        )
          throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 請使用其他名稱');
        (await db.prepare(
          'UPDATE auth_accounts SET username = ?, password_salt = ?, password_hash = ?, revision = revision + 1 WHERE id = ?',
        ).run(
          input.username,
          secret?.salt || manager.password_salt,
          secret?.hash || manager.password_hash,
          id,
        ));
        (await db.prepare('DELETE FROM auth_sessions WHERE account_id = ?').run(id));
        return { id, username: input.username, role, revision: manager.revision + 1 };
      }));
    },
    async changeAdminPassword(adminId, input, sessionToken) {
      const account = (await checkAdmin(adminId));
      if (!Number.isSafeInteger(input?.revision) || input.revision !== account.revision)
        throw accountChanged();
      if (
        !(await verifySecret(input?.currentPassword, account.password_salt, account.password_hash))
      )
        throw new AuthError(422, 'CURRENT_PASSWORD_INVALID', '目前密碼不正確');
      const secret = await passwordHash(input?.password);
      return (await db.transaction(async () => {
        if ((await checkAdmin(adminId, ' FOR UPDATE')).revision !== account.revision) throw accountChanged();
        (await db.prepare(
          'UPDATE auth_accounts SET password_salt = ?, password_hash = ?, revision = revision + 1 WHERE id = ?',
        ).run(secret.salt, secret.hash, adminId));
        (await db.prepare('DELETE FROM auth_sessions WHERE account_id = ? AND token_hash != ?').run(
          adminId,
          digest(sessionToken),
        ));
        return {
          id: account.id,
          username: account.username,
          role: 'admin',
          revision: account.revision + 1,
        };
      }));
    },
    createManager: async (adminId, input) => (await repository.createManagedAccount(adminId, input, 'manager')),
    updateManager: async (adminId, id, input) =>
      (await repository.updateManagedAccount(adminId, id, input, 'manager')),
    async getMemberTokenSettings() {
      const account = (await db.prepare("SELECT revision FROM auth_accounts WHERE username = ? AND role = 'member'").get(MEMBER_USERNAME));
      return { configured: !!account, revision: account?.revision || 0 };
    },
    async setMemberToken(adminId, input) {
      (await checkAdmin(adminId));
      if (typeof input?.password !== 'string' || !/^[a-zA-Z0-9]{6,128}$/.test(input.password))
        throw new AuthError(422, 'INVALID_PASSWORD', '通行密碼須為 6–128 個英文字母或數字');
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw accountChanged();
      const secret = await passwordHash(input.password, 6);
      return (await db.transaction(async () => {
        (await checkAdmin(adminId, ' FOR SHARE'));
        const account = (await db.prepare('SELECT * FROM auth_accounts WHERE username = ? FOR UPDATE').get(MEMBER_USERNAME));
        if (account && account.role !== 'member')
          throw new AuthError(409, 'RESERVED_ACCOUNT', '保留帳號已被管理帳號使用，請先更改該管理帳號名稱');
        if ((account?.revision || 0) !== input.revision) throw accountChanged();
        if (account) {
          (await db.prepare('UPDATE auth_accounts SET password_salt = ?, password_hash = ?, revision = revision + 1 WHERE id = ?').run(secret.salt, secret.hash, account.id));
          (await db.prepare('DELETE FROM auth_sessions WHERE account_id = ?').run(account.id));
        } else {
          (await db.prepare("INSERT INTO auth_accounts (id, username, password_salt, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'member')")
            .run(randomUUID(), MEMBER_USERNAME, secret.salt, secret.hash, new Date(now()).toISOString()));
        }
        return (await repository.getMemberTokenSettings());
      }));
    },
    authenticateMember: async (input) => (await repository.authenticate({ username: MEMBER_USERNAME, password: input?.password }, true)),
    async authenticate({ username, password } = {}, memberLogin = false) {
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        username.length > 32 ||
        password.length > 128
      ) {
        throw new AuthError(401, 'INVALID_CREDENTIALS', memberLogin ? '通行密碼不正確或尚未設定，請聯絡管理者' : '帳號或密碼不正確');
      }
      const account = (await db.prepare('SELECT * FROM auth_accounts WHERE username = ?').get(username));
      // Unknown accounts still run scrypt to avoid a fast username-enumeration response.
      if (
        !(await verifySecret(password, account?.password_salt, account?.password_hash)) ||
        !account ||
        (memberLogin ? account.role !== 'member' || account.username.toLowerCase() !== MEMBER_USERNAME : account.role === 'member')
      ) {
        throw new AuthError(401, 'INVALID_CREDENTIALS', memberLogin ? '通行密碼不正確或尚未設定，請聯絡管理者' : '帳號或密碼不正確');
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now() + SESSION_SECONDS * 1000;
      (await db.transaction(async () => {
        // A concurrent password change must either finish first or wait until this session exists.
        const current = (await db
          .prepare('SELECT revision FROM auth_accounts WHERE id = ? FOR SHARE')
          .get(account.id));
        if (current?.revision !== account.revision)
          throw new AuthError(401, 'INVALID_CREDENTIALS', memberLogin ? '通行密碼不正確或尚未設定，請聯絡管理者' : '帳號或密碼不正確');
        (await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now()));
        (await db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(
          digest(token),
          account.id,
          expiresAt,
        ));
      }));
      return {
        token,
        user: publicUser(account),
        expiresAt,
      };
    },
    async getSession(token) {
      if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
      const row = (await db
        .prepare(
          `SELECT a.id, a.username, a.role, s.expires_at FROM auth_sessions s
        JOIN auth_accounts a ON a.id = s.account_id WHERE s.token_hash = ?`,
        )
        .get(digest(token)));
      if (!row || row.expires_at <= now() || (row.role === 'member' && row.username.toLowerCase() !== MEMBER_USERNAME)) {
        (await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token)));
        return null;
      }
      return {
        user: publicUser(row),
        expiresAt: row.expires_at,
      };
    },
    async revokeSession(token) {
      if (typeof token === 'string')
        (await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token)));
    },
  };
  return repository;
}
