import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createMysqlDatabase } from '../server/database/mysql.js';

const configurationFile = process.env.GUILD_MYSQL_TEST_CONFIG;

function testEnvironment() {
  const configuration = JSON.parse(readFileSync(configurationFile, 'utf8'));
  assert.equal(configuration.purpose, 'guildmanager-integration-test');
  const env = configuration.environment;
  assert.equal(env.NODE_ENV, 'test');
  assert.match(env.DB_DATABASE, /^sp_guildmanager_[a-z][a-z0-9]{0,15}_test$/);
  assert.ok(['127.0.0.1', 'localhost', 'mysql', 'side-project-mysql'].includes(env.DB_HOST));
  assert.equal(env.DB_SSL_MODE, 'disabled');
  return env;
}

test('real MySQL preserves Chinese, leading-zero identifiers and big integers, and rolls back failed writes', { skip: !configurationFile }, async () => {
  const database = createMysqlDatabase(testEnvironment());
  const table = `gm_connection_${randomBytes(6).toString('hex')}`;
  try {
    const probe = await database.probe();
    assert.equal(probe.driver, 'mysql');
    assert.match(probe.version, /^8\./);
    await database.query(`CREATE TABLE ${table} (id VARCHAR(64) PRIMARY KEY, name VARCHAR(128) NOT NULL, amount BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await database.transaction(async (transaction) => {
      await transaction.query(`INSERT INTO ${table} VALUES (?, ?, ?)`, ['000001234567890123456789', '測試成員🌊', '9007199254740993']);
    });
    assert.deepEqual(await database.query(`SELECT * FROM ${table}`), [{ id: '000001234567890123456789', name: '測試成員🌊', amount: '9007199254740993' }]);
    await assert.rejects(database.transaction(async (transaction) => {
      await transaction.query(`INSERT INTO ${table} VALUES (?, ?, ?)`, ['rollback', '應回滾', '1']);
      await transaction.query(`INSERT INTO ${table} VALUES (?, ?, ?)`, ['000001234567890123456789', '重複', '2']);
    }), { code: 'DATABASE_DUPLICATE' });
    assert.equal((await database.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count, '1');
    // Permission checks never read another project's business rows.
    await assert.rejects(database.query('SELECT User FROM mysql.user LIMIT 0'), { code: 'DATABASE_AUTHENTICATION' });
  } finally {
    await database.query(`DROP TABLE IF EXISTS ${table}`);
    await database.close();
  }
});

test('real MySQL pool releases rolled-back transactions and closes all connections', { skip: !configurationFile }, async () => {
  const env = { ...testEnvironment(), DB_POOL_SIZE: '1', DB_QUEUE_LIMIT: '2' };
  const database = createMysqlDatabase(env);
  try {
    const marker = new Error('rollback marker');
    await assert.rejects(database.transaction(async () => { throw marker; }), (error) => error === marker);
    const results = await Promise.all([database.query('SELECT 1 AS value'), database.query('SELECT 2 AS value')]);
    assert.deepEqual(results, [[{ value: '1' }], [{ value: '2' }]]);
  } finally {
    await database.close();
  }
  await assert.rejects(database.probe(), { code: 'DATABASE_CLOSED' });
});

test('real MySQL rejects a certificate whose identity does not match the connection address', { skip: !configurationFile || !process.env.GUILD_MYSQL_TEST_CA }, async () => {
  const database = createMysqlDatabase({ ...testEnvironment(), DB_SSL_MODE: 'verify_identity', DB_SSL_CA_FILE: process.env.GUILD_MYSQL_TEST_CA });
  try {
    await assert.rejects(database.probe(), { code: 'DATABASE_TLS' });
  } finally {
    await database.close();
  }
});

test('real MySQL connection failures return a safe category without credentials', { skip: !configurationFile }, async () => {
  const database = createMysqlDatabase({ ...testEnvironment(), DB_PASSWORD: 'intentionally-invalid-private-password' });
  try {
    await assert.rejects(database.probe(), (error) => {
      assert.equal(error.code, 'DATABASE_AUTHENTICATION');
      assert.doesNotMatch(String(error), /intentionally-invalid|Access denied|sp_guildmanager/);
      return true;
    });
  } finally {
    await database.close();
  }
});
