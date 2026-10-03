import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const SESSION_SECONDS = 8 * 60 * 60;
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const csrfToken = (token) => digest(`csrf:${token}`);

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
  return {
    async createAccount({ username, password } = {}) {
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
        throw new AuthError(422, 'INVALID_ACCOUNT', '帳號請使用 3–32 個英數字、底線、點或減號');
      }
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
        throw new AuthError(422, 'INVALID_PASSWORD', '密碼長度須為 12–128 個字元');
      }
      if (db.prepare('SELECT id FROM auth_accounts WHERE username = ?').get(username)) {
        throw new AuthError(409, 'ACCOUNT_EXISTS', '帳號已存在, 不會覆寫原密碼');
      }
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      const id = randomUUID();
      // Account creation is a local CLI operation, never a public registration endpoint.
      db.prepare('INSERT INTO auth_accounts VALUES (?, ?, ?, ?, ?)').run(
        id,
        username,
        salt,
        hash,
        new Date(now()).toISOString(),
      );
      return { id, username };
    },
    async authenticate({ username, password } = {}) {
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        username.length > 32 ||
        password.length > 128
      ) {
        throw new AuthError(401, 'INVALID_CREDENTIALS', '帳號或密碼不正確');
      }
      const account = db.prepare('SELECT * FROM auth_accounts WHERE username = ?').get(username);
      // Unknown accounts still run scrypt to avoid a fast username-enumeration response.
      const actual = await scrypt(password, account?.password_salt || 'unknown-account-salt', 64);
      const expected = Buffer.from(account?.password_hash || '0'.repeat(128), 'hex');
      if (!timingSafeEqual(actual, expected) || !account) {
        throw new AuthError(401, 'INVALID_CREDENTIALS', '帳號或密碼不正確');
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now() + SESSION_SECONDS * 1000;
      db.transaction(() => {
        db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now());
        db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(
          digest(token),
          account.id,
          expiresAt,
        );
      })();
      return { token, user: { id: account.id, username: account.username }, expiresAt };
    },
    getSession(token) {
      if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
      const row = db
        .prepare(
          `SELECT a.id, a.username, s.expires_at FROM auth_sessions s
        JOIN auth_accounts a ON a.id = s.account_id WHERE s.token_hash = ?`,
        )
        .get(digest(token));
      if (!row || row.expires_at <= now()) {
        db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
        return null;
      }
      return { user: { id: row.id, username: row.username }, expiresAt: row.expires_at };
    },
    revokeSession(token) {
      if (typeof token === 'string')
        db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
    },
  };
}
