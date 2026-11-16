import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { createPool } from 'mysql2/promise';

export class DatabaseError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.status = status;
  }
}

function invalidConfiguration() {
  return new DatabaseError('DATABASE_CONFIGURATION', '資料庫設定不完整或格式不正確, 請檢查伺服器設定', 500);
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw invalidConfiguration();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw invalidConfiguration();
  return number;
}

export function mysqlPoolOptions(env, { readFile = readFileSync } = {}) {
  const required = ['DB_HOST', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'];
  if (required.some((key) => typeof env[key] !== 'string' || !env[key].trim())) throw invalidConfiguration();
  if (/[\s\0/]/.test(env.DB_HOST) || /\0/.test(env.DB_DATABASE + env.DB_USERNAME + env.DB_PASSWORD)) {
    throw invalidConfiguration();
  }
  const mode = env.DB_SSL_MODE || 'verify_identity';
  let ssl;
  if (mode === 'disabled') {
    const host = env.DB_HOST.toLowerCase();
    const loopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
    if (env.NODE_ENV === 'production' || (!loopback && !['mysql', 'side-project-mysql'].includes(host))) {
      throw invalidConfiguration();
    }
    if (env.DB_SSL_CA_FILE || env.DB_SSL_CA_BASE64) throw invalidConfiguration();
  } else if (mode === 'verify_identity') {
    if (Boolean(env.DB_SSL_CA_FILE) === Boolean(env.DB_SSL_CA_BASE64)) throw invalidConfiguration();
    let ca;
    try {
      ca = env.DB_SSL_CA_FILE
        ? readFile(env.DB_SSL_CA_FILE, 'utf8')
        : Buffer.from(env.DB_SSL_CA_BASE64, 'base64').toString('utf8');
    } catch {
      throw invalidConfiguration();
    }
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw invalidConfiguration();
    ssl = { ca, rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
  } else {
    throw invalidConfiguration();
  }
  return {
    host: env.DB_HOST,
    port: integer(env.DB_PORT, 3306, 1, 65535),
    database: env.DB_DATABASE,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    ...(ssl ? { ssl } : {}),
    connectionLimit: integer(env.DB_POOL_SIZE, 5, 1, 20),
    queueLimit: integer(env.DB_QUEUE_LIMIT, 20, 1, 10000),
    connectTimeout: integer(env.DB_CONNECT_TIMEOUT, 10000, 100, 60000),
    waitForConnections: true,
    enableKeepAlive: true,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    jsonStrings: true,
    multipleStatements: false,
    maxPreparedStatements: 128,
  };
}

function databaseError(error) {
  if (error instanceof DatabaseError) return error;
  const codes = {
    ER_ACCESS_DENIED_ERROR: ['DATABASE_AUTHENTICATION', '資料庫驗證失敗, 請檢查伺服器帳號設定'],
    ER_DBACCESS_DENIED_ERROR: ['DATABASE_AUTHENTICATION', '資料庫驗證失敗, 請檢查伺服器帳號設定'],
    ER_TABLEACCESS_DENIED_ERROR: ['DATABASE_AUTHENTICATION', '資料庫驗證失敗, 請檢查伺服器帳號設定'],
    ER_BAD_DB_ERROR: ['DATABASE_NOT_FOUND', '找不到指定資料庫, 請先完成資料庫設定'],
    ER_DUP_ENTRY: ['DATABASE_DUPLICATE', '資料已存在, 請重新載入後確認'],
    ER_NO_REFERENCED_ROW_2: ['DATABASE_REFERENCE', '關聯資料已變更, 請重新載入後確認'],
    ER_ROW_IS_REFERENCED_2: ['DATABASE_REFERENCE', '仍有資料使用這筆紀錄, 請先確認相關資料'],
    ER_LOCK_DEADLOCK: ['DATABASE_CONFLICT', '資料正在被其他操作更新, 請確認最新資料後重試'],
    ER_LOCK_WAIT_TIMEOUT: ['DATABASE_BUSY', '資料庫忙碌中, 請稍後確認操作結果'],
    ECONNREFUSED: ['DATABASE_UNAVAILABLE', '目前無法連線資料庫, 請稍後再試'],
    ETIMEDOUT: ['DATABASE_UNAVAILABLE', '目前無法連線資料庫, 請稍後再試'],
    ENOTFOUND: ['DATABASE_UNAVAILABLE', '目前無法連線資料庫, 請稍後再試'],
    EPERM: ['DATABASE_UNAVAILABLE', '目前無法連線資料庫, 請稍後再試'],
    HANDSHAKE_SSL_ERROR: ['DATABASE_TLS', '資料庫安全連線失敗, 請檢查憑證與伺服器名稱'],
    ERR_TLS_CERT_ALTNAME_INVALID: ['DATABASE_TLS', '資料庫安全連線失敗, 請檢查憑證與伺服器名稱'],
    CERT_HAS_EXPIRED: ['DATABASE_TLS', '資料庫安全連線失敗, 請檢查憑證與伺服器名稱'],
    DEPTH_ZERO_SELF_SIGNED_CERT: ['DATABASE_TLS', '資料庫安全連線失敗, 請檢查憑證與伺服器名稱'],
    SELF_SIGNED_CERT_IN_CHAIN: ['DATABASE_TLS', '資料庫安全連線失敗, 請檢查憑證與伺服器名稱'],
  };
  const [code, message] = codes[error?.code] || ['DATABASE_QUERY', '資料庫操作失敗, 請稍後確認操作結果'];
  return new DatabaseError(code, message);
}

export function createMysqlDatabase(env, { poolFactory = createPool, readFile } = {}) {
  const options = mysqlPoolOptions(env, { readFile });
  let pool;
  try {
    pool = poolFactory(options);
  } catch (error) {
    throw databaseError(error);
  }
  let closing;
  const assertOpen = () => {
    if (closing) throw new DatabaseError('DATABASE_CLOSED', '資料庫連線已關閉');
  };
  const execute = async (executor, sql, parameters = []) => {
    try {
      const [rows] = await executor.execute(sql, parameters);
      return rows;
    } catch (error) {
      throw databaseError(error);
    }
  };
  return {
    async query(sql, parameters = []) {
      assertOpen();
      return execute(pool, sql, parameters);
    },
    async probe() {
      assertOpen();
      const [row] = await execute(pool, 'SELECT DATABASE() AS databaseName, VERSION() AS version, @@character_set_connection AS charset');
      if (row.databaseName !== options.database || row.charset !== 'utf8mb4') throw invalidConfiguration();
      if (options.ssl) {
        const [tls] = await execute(pool, "SHOW SESSION STATUS LIKE 'Ssl_cipher'");
        if (!tls?.Value) throw new DatabaseError('DATABASE_TLS', '資料庫未建立安全連線');
      }
      return { status: 'ok', driver: 'mysql', version: row.version, tls: Boolean(options.ssl) };
    },
    async transaction(work) {
      assertOpen();
      let connection;
      try {
        connection = await pool.getConnection();
      } catch (error) {
        throw databaseError(error);
      }
      let phase = 'begin';
      try {
        await connection.beginTransaction();
        phase = 'work';
        const result = await work({ query: (sql, parameters) => {
          if (phase !== 'work') throw new DatabaseError('DATABASE_TRANSACTION_CLOSED', '資料庫交易已結束');
          return execute(connection, sql, parameters);
        } });
        phase = 'commit';
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          connection.destroy();
        }
        // Unknown commit outcomes are never replayed here; the caller retains its requestId.
        throw phase === 'work' ? error : databaseError(error);
      } finally {
        phase = 'closed';
        connection.release();
      }
    },
    close() {
      if (!closing) closing = Promise.resolve().then(() => pool.end()).catch((error) => { throw databaseError(error); });
      return closing;
    },
  };
}
