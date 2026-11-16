import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createMysqlDatabase, mysqlPoolOptions } from '../server/database/mysql.js';

const local = { DB_HOST: '127.0.0.1', DB_DATABASE: 'example', DB_USERNAME: 'example', DB_PASSWORD: 'private-value', DB_SSL_MODE: 'disabled' };

test('MySQL configuration fails closed and never includes credentials or a private path in errors', () => {
  for (const changes of [
    { DB_PASSWORD: '' }, { DB_PORT: '3306suffix' }, { DB_POOL_SIZE: '0' }, { DB_QUEUE_LIMIT: '0' },
    { NODE_ENV: 'production' }, { DB_HOST: 'database.example.test' }, { DB_SSL_MODE: 'prefer' },
    { DB_SSL_MODE: 'verify_identity' },
    { DB_SSL_MODE: 'verify_identity', DB_SSL_CA_FILE: '/private/example/ca.pem' },
  ]) {
    assert.throws(() => mysqlPoolOptions({ ...local, ...changes }, { readFile: () => { throw new Error('private-value /private/example/ca.pem'); } }), (error) => {
      assert.equal(error.code, 'DATABASE_CONFIGURATION');
      assert.doesNotMatch(String(error), /private-value|\/private\/example/);
      return true;
    });
  }
  const options = mysqlPoolOptions(local);
  assert.equal(options.connectionLimit, 5);
  assert.equal(options.queueLimit, 20);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.bigNumberStrings, true);
  assert.equal(options.charset, 'utf8mb4');
});

test('remote and production MySQL always validate CA and hostname without exposing certificate read errors', () => {
  const options = mysqlPoolOptions({ ...local, DB_HOST: 'database.example.test', NODE_ENV: 'production', DB_SSL_MODE: 'verify_identity', DB_SSL_CA_FILE: 'ca.pem' }, {
    readFile: () => '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----',
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  assert.equal(options.ssl.minVersion, 'TLSv1.2');
});

function fakeDatabase({ failQuery, failCommit, failRollback } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, values) { calls.push(['execute', sql, values]); if (failQuery) throw Object.assign(new Error('private-value SQL payload'), { code: 'ER_ACCESS_DENIED_ERROR' }); return [[{ value: 7 }]]; },
    async commit() { calls.push('commit'); if (failCommit) throw new Error('private-value'); },
    async rollback() { calls.push('rollback'); if (failRollback) throw new Error('private-value'); },
    release() { calls.push('release'); },
    destroy() { calls.push('destroy'); },
  };
  const pool = { execute: connection.execute, async getConnection() { return connection; }, async end() { calls.push('end'); } };
  return { database: createMysqlDatabase(local, { poolFactory: () => pool }), calls };
}

test('a transaction commits on its own connection and releases it after all asynchronous work', async () => {
  const { database, calls } = fakeDatabase();
  const result = await database.transaction(async (transaction) => {
    const rows = await transaction.query('SELECT ?', [7]);
    return rows[0].value;
  });
  assert.equal(result, 7);
  assert.deepEqual(calls, ['begin', ['execute', 'SELECT ?', [7]], 'commit', 'release']);
  await database.close();
});

test('transaction failures roll back, retain business errors and discard connections after rollback failure', async () => {
  const { database, calls } = fakeDatabase({ failRollback: true });
  const businessError = new Error('version conflict');
  await assert.rejects(database.transaction(async () => { throw businessError; }), (error) => error === businessError);
  assert.deepEqual(calls, ['begin', 'rollback', 'destroy', 'release']);
  await database.close();
});

test('query and uncertain commit failures expose a fixed error and are not automatically retried', async () => {
  for (const failure of [{ failQuery: true }, { failCommit: true }]) {
    const { database, calls } = fakeDatabase(failure);
    await assert.rejects(database.transaction((transaction) => transaction.query('INSERT INTO example VALUES (?)', ['private-value'])), (error) => {
      assert.doesNotMatch(String(error), /private-value|SQL payload/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(calls.filter((call) => call === 'begin').length, 1);
    assert.equal(calls.filter((call) => call === 'rollback').length, 1);
    await database.close();
  }
});

test('closing a MySQL pool is idempotent and rejects new work', async () => {
  const { database, calls } = fakeDatabase();
  const closing = database.close();
  assert.equal(database.close(), closing);
  await closing;
  assert.deepEqual(calls, ['end']);
  await assert.rejects(database.query('SELECT 1'), { code: 'DATABASE_CLOSED' });
});

test('a finished transaction cannot reuse a connection that has been returned to the pool', async () => {
  const { database } = fakeDatabase();
  let transaction;
  await database.transaction(async (current) => { transaction = current; });
  assert.throws(() => transaction.query('SELECT 1'), { code: 'DATABASE_TRANSACTION_CLOSED' });
  await database.close();
});

test('CLI errors are safe and the MySQL test entry point refuses implicit database settings', () => {
  const env = { ...process.env, DB_HOST: '', DB_PASSWORD: 'private-value', GUILD_MYSQL_TEST_CONFIG: '' };
  const check = spawnSync(process.execPath, ['tools/check-mysql.js'], { encoding: 'utf8', env });
  assert.equal(check.status, 1);
  assert.equal(JSON.parse(check.stderr).code, 'DATABASE_CONFIGURATION');
  assert.doesNotMatch(check.stdout + check.stderr, /private-value/);
  const tests = spawnSync(process.execPath, ['tools/run-mysql-tests.js'], { encoding: 'utf8', env });
  assert.equal(tests.status, 2);
});
