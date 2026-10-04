import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const MEMBER_USERNAME = 'guild_member';
const publicUser = (account) => ({ id: account.id, username: account.role === 'member' ? '' : account.username, role: account.role });
export const SESSION_SECONDS = 8 * 60 * 60;
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const csrfToken = (token) => digest(`csrf:${token}`);

function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username))
    throw new AuthError(422, 'INVALID_ACCOUNT', '帳號請使用 3–32 個英數字、底線、點或減號');
}
export async function passwordHash(password, minimum = 12) {
  if (typeof password !== 'string' || password.length < minimum || password.length > 128)
    throw new AuthError(422, 'INVALID_PASSWORD', '密碼長度須為 12–128 個字元');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}
export async function verifySecret(secret, salt, hash) {
  if (typeof secret !== 'string' || secret.length > 128) return false;
  const actual = await scrypt(secret, salt || 'unknown-account-salt', 64);
  return timingSafeEqual(actual, Buffer.from(hash || '0'.repeat(128), 'hex'));
}
const accountChanged = () => new AuthError(409, 'ACCOUNT_CHANGED', '帳號資料已更新, 請重新載入');

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}

export function createAuthRepository(db, { now = Date.now } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
  `);
  db.transaction(() => {
    const columns = db.pragma('table_info(auth_accounts)');
    if (!columns.some((column) => column.name === 'role')) {
      db.exec(
        "ALTER TABLE auth_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'manager' CHECK(role IN ('admin', 'manager', 'member'))",
      );
      const first = db
        .prepare(
          "SELECT id FROM auth_accounts ORDER BY (username = 'admin' COLLATE NOCASE) DESC, created_at, rowid LIMIT 1",
        )
        .get();
      if (first) db.prepare("UPDATE auth_accounts SET role = 'admin' WHERE id = ?").run(first.id);
    }
    if (!columns.some((column) => column.name === 'revision'))
      db.exec(
        'ALTER TABLE auth_accounts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)',
      );
  })();
  const accountSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'auth_accounts'")
    .get().sql;
  if (!accountSchema.includes("'member'")) {
    // A running dev server may have installed the two-role schema before member accounts were requested.
    const upgradedSchema = accountSchema.replace(
      /CHECK\(role IN \('admin', 'manager'\)\)/,
      "CHECK(role IN ('admin', 'manager', 'member'))",
    );
    if (upgradedSchema === accountSchema) throw new Error('無法升級帳號角色欄位, 請檢查資料庫結構');
    if (db.name !== ':memory:')
      db.prepare('VACUUM INTO ?').run(`${db.name}.before-member-role-${randomUUID()}.sqlite`);
    // Disabling FK enforcement for the table swap prevents ON DELETE CASCADE from revoking sessions.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const columns = db
          .pragma('table_info(auth_accounts)')
          .map((column) => `"${column.name}"`)
          .join(',');
        db.exec(
          upgradedSchema.replace(
            /^CREATE TABLE (?:(?:"auth_accounts")|auth_accounts)/,
            'CREATE TABLE auth_accounts_member',
          ),
        );
        db.exec(`INSERT INTO auth_accounts_member (${columns}) SELECT ${columns} FROM auth_accounts;
          DROP TABLE auth_accounts; ALTER TABLE auth_accounts_member RENAME TO auth_accounts;`);
        if (db.pragma('foreign_key_check').length)
          throw new Error('帳號升級關聯檢查失敗, 已回復原資料');
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  function checkAdmin(id) {
    const account = db.prepare('SELECT * FROM auth_accounts WHERE id = ?').get(id);
    if (account?.role !== 'admin')
      throw new AuthError(403, 'ADMIN_REQUIRED', '只有 admin 可以管理帳號');
    return account;
  }
  const repository = {
    async createAccount({ username, password, role } = {}) {
      validateUsername(username);
      if (username.toLowerCase() === MEMBER_USERNAME)
        throw new AuthError(422, 'RESERVED_ACCOUNT', '此帳號名稱已保留');
      if (db.prepare('SELECT id FROM auth_accounts WHERE username = ?').get(username)) {
        throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 不會覆寫原密碼');
      }
      if (role !== undefined && !['admin', 'manager', 'member'].includes(role))
        throw new AuthError(422, 'INVALID_ROLE', '帳號角色不正確');
      const { salt, hash } = await passwordHash(password);
      const id = randomUUID();
      return db.transaction(() => {
        if (db.prepare('SELECT id FROM auth_accounts WHERE username = ?').get(username))
          throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 不會覆寫原密碼');
        const accountRole =
          role || (db.prepare('SELECT id FROM auth_accounts LIMIT 1').get() ? 'manager' : 'admin');
        db.prepare(
          'INSERT INTO auth_accounts (id, username, password_salt, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, username, salt, hash, new Date(now()).toISOString(), accountRole);
        return { id, username, role: accountRole, revision: 1 };
      })();
    },
    getAccountSettings(adminId) {
      const admin = checkAdmin(adminId);
      const columns = 'id, username, role, revision, created_at AS createdAt';
      return {
        admin: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          revision: admin.revision,
        },
        memberToken: repository.getMemberTokenSettings(),
        managers: db
          .prepare(`SELECT ${columns} FROM auth_accounts WHERE role = 'manager' ORDER BY username`)
          .all(),
      };
    },
    async createManagedAccount(adminId, input, role) {
      checkAdmin(adminId);
      // Never accept the role supplied by a browser.
      return repository.createAccount({
        username: input?.username,
        password: input?.password,
        role,
      });
    },
    async updateManagedAccount(adminId, id, input, role) {
      checkAdmin(adminId);
      validateUsername(input?.username);
      if (input.username.toLowerCase() === MEMBER_USERNAME)
        throw new AuthError(422, 'RESERVED_ACCOUNT', '此帳號名稱已保留');
      if (!Number.isSafeInteger(input?.revision) || input.revision < 1) throw accountChanged();
      const secret =
        input.password === '' || input.password === undefined
          ? null
          : await passwordHash(input.password);
      return db.transaction(() => {
        checkAdmin(adminId);
        const manager = db
          .prepare('SELECT * FROM auth_accounts WHERE id = ? AND role = ?')
          .get(id, role);
        if (!manager) throw new AuthError(404, 'ACCOUNT_NOT_FOUND', `找不到 ${role} 帳號`);
        if (manager.revision !== input.revision) throw accountChanged();
        if (
          db
            .prepare('SELECT id FROM auth_accounts WHERE username = ? AND id != ?')
            .get(input.username, id)
        )
          throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 請使用其他名稱');
        db.prepare(
          'UPDATE auth_accounts SET username = ?, password_salt = ?, password_hash = ?, revision = revision + 1 WHERE id = ?',
        ).run(
          input.username,
          secret?.salt || manager.password_salt,
          secret?.hash || manager.password_hash,
          id,
        );
        db.prepare('DELETE FROM auth_sessions WHERE account_id = ?').run(id);
        return { id, username: input.username, role, revision: manager.revision + 1 };
      })();
    },
    async changeAdminPassword(adminId, input, sessionToken) {
      const account = checkAdmin(adminId);
      if (!Number.isSafeInteger(input?.revision) || input.revision !== account.revision)
        throw accountChanged();
      if (
        !(await verifySecret(input?.currentPassword, account.password_salt, account.password_hash))
      )
        throw new AuthError(422, 'CURRENT_PASSWORD_INVALID', '目前密碼不正確');
      const secret = await passwordHash(input?.password);
      return db.transaction(() => {
        if (checkAdmin(adminId).revision !== account.revision) throw accountChanged();
        db.prepare(
          'UPDATE auth_accounts SET password_salt = ?, password_hash = ?, revision = revision + 1 WHERE id = ?',
        ).run(secret.salt, secret.hash, adminId);
        db.prepare('DELETE FROM auth_sessions WHERE account_id = ? AND token_hash != ?').run(
          adminId,
          digest(sessionToken),
        );
        return {
          id: account.id,
          username: account.username,
          role: 'admin',
          revision: account.revision + 1,
        };
      })();
    },
    createManager: (adminId, input) => repository.createManagedAccount(adminId, input, 'manager'),
    updateManager: (adminId, id, input) =>
      repository.updateManagedAccount(adminId, id, input, 'manager'),
    getMemberTokenSettings() {
      const account = db.prepare("SELECT revision FROM auth_accounts WHERE username = ? AND role = 'member'").get(MEMBER_USERNAME);
      return { configured: !!account, revision: account?.revision || 0 };
    },
    async setMemberToken(adminId, input) {
      checkAdmin(adminId);
      if (typeof input?.password !== 'string' || !/^\d{6,128}$/.test(input.password))
        throw new AuthError(422, 'INVALID_PASSWORD', '通行密碼須為 6–128 位數字');
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw accountChanged();
      const secret = await passwordHash(input.password, 6);
      return db.transaction(() => {
        checkAdmin(adminId);
        const account = db.prepare('SELECT * FROM auth_accounts WHERE username = ?').get(MEMBER_USERNAME);
        if (account && account.role !== 'member')
          throw new AuthError(409, 'RESERVED_ACCOUNT', '保留帳號已被管理帳號使用，請先更改該管理帳號名稱');
        if ((account?.revision || 0) !== input.revision) throw accountChanged();
        if (account) {
          db.prepare('UPDATE auth_accounts SET password_salt = ?, password_hash = ?, revision = revision + 1 WHERE id = ?').run(secret.salt, secret.hash, account.id);
          db.prepare('DELETE FROM auth_sessions WHERE account_id = ?').run(account.id);
        } else {
          db.prepare("INSERT INTO auth_accounts (id, username, password_salt, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, 'member')")
            .run(randomUUID(), MEMBER_USERNAME, secret.salt, secret.hash, new Date(now()).toISOString());
        }
        return repository.getMemberTokenSettings();
      })();
    },
    authenticateMember: (input) => repository.authenticate({ username: MEMBER_USERNAME, password: input?.password }, true),
    async authenticate({ username, password } = {}, memberLogin = false) {
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        username.length > 32 ||
        password.length > 128
      ) {
        throw new AuthError(401, 'INVALID_CREDENTIALS', memberLogin ? '通行密碼不正確或尚未設定，請聯絡管理者' : '帳號或密碼不正確');
      }
      const account = db.prepare('SELECT * FROM auth_accounts WHERE username = ?').get(username);
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
      db.transaction(() => {
        const current = db
          .prepare('SELECT revision FROM auth_accounts WHERE id = ?')
          .get(account.id);
        if (current?.revision !== account.revision)
          throw new AuthError(401, 'INVALID_CREDENTIALS', memberLogin ? '通行密碼不正確或尚未設定，請聯絡管理者' : '帳號或密碼不正確');
        db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now());
        db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(
          digest(token),
          account.id,
          expiresAt,
        );
      })();
      return {
        token,
        user: publicUser(account),
        expiresAt,
      };
    },
    getSession(token) {
      if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
      const row = db
        .prepare(
          `SELECT a.id, a.username, a.role, s.expires_at FROM auth_sessions s
        JOIN auth_accounts a ON a.id = s.account_id WHERE s.token_hash = ?`,
        )
        .get(digest(token));
      if (!row || row.expires_at <= now() || (row.role === 'member' && row.username.toLowerCase() !== MEMBER_USERNAME)) {
        db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
        return null;
      }
      return {
        user: publicUser(row),
        expiresAt: row.expires_at,
      };
    },
    revokeSession(token) {
      if (typeof token === 'string')
        db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
    },
  };
  return repository;
}
