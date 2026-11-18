import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createMysqlDatabase } from '../server/database/mysql.js';
import { migrateMysql, migrationStatus, migrationLockName } from '../server/database/migrate.js';

const configurationFile = process.env.GUILD_MYSQL_MIGRATION_TEST_CONFIG;

test('migration manifest validation rejects duplicates and out-of-order versions before accessing the database', async () => {
  const one = { id: '0001_example', statements: ['SELECT 1'] };
  for (const invalid of [[one, one], [{ ...one, id: '../outside' }], [{ ...one, statements: [] }]]) {
    await assert.rejects(migrateMysql(null, invalid), { code: 'MIGRATION_MANIFEST' });
  }
  assert.notEqual(migrationLockName('first_database'), migrationLockName('second_database'));
  assert.ok(migrationLockName('example').length <= 64);
});

test('real MySQL migrations are serialized, immutable and stop safely after partially committed DDL', { skip: !configurationFile }, async () => {
  const configuration = JSON.parse(readFileSync(configurationFile, 'utf8'));
  assert.equal(configuration.purpose, 'guildmanager-migration-test');
  const env = configuration.environment;
  assert.equal(env.NODE_ENV, 'test');
  assert.match(env.DB_DATABASE, /^sp_guildmanager_[a-z][a-z0-9]{0,15}_migrationtest$/);
  assert.ok(['127.0.0.1', 'localhost', 'mysql', 'side-project-mysql'].includes(env.DB_HOST));
  assert.equal(env.DB_SSL_MODE, 'disabled');
  const database = createMysqlDatabase(env);
  const suffix = randomBytes(5).toString('hex');
  const table = `gm_migration_${suffix}`;
  const partialTable = `gm_partial_${suffix}`;
  const migration = { id: '0001_example', statements: [`CREATE TABLE ${table} (id INT PRIMARY KEY, value VARCHAR(64)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, `INSERT INTO ${table} VALUES (1, '初次資料')`] };
  let ownsLedger = false;
  try {
    const [before] = await database.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()');
    assert.equal(Number(before.count), 0, 'Migration tests require an empty dedicated test schema; do not reset existing tables');
    ownsLedger = true;
    assert.deepEqual(await migrationStatus(database, [migration]), [{ id: migration.id, state: 'pending', completedSteps: 0 }]);
    const [afterStatus] = await database.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()');
    assert.equal(Number(afterStatus.count), 0);
    assert.deepEqual(await migrateMysql(database, [migration]), { applied: [migration.id], skipped: [] });
    assert.deepEqual(await migrateMysql(database, [migration]), { applied: [], skipped: [migration.id] });
    await assert.rejects(migrateMysql(database, [{ ...migration, statements: [...migration.statements, 'SELECT 1'] }]), { code: 'MIGRATION_CHECKSUM' });
    await assert.rejects(migrateMysql(database, []), { code: 'MIGRATION_UNKNOWN_VERSION' });
    await assert.rejects(migrateMysql(database, [{ id: '0000_before', statements: ['SELECT 1'] }, migration]), { code: 'MIGRATION_HISTORY_GAP' });
    assert.deepEqual(await database.query(`SELECT * FROM ${table}`), [{ id: 1, value: '初次資料' }]);
    assert.equal((await database.query(`SELECT value FROM ${table} WHERE id = 1`))[0].value, '初次資料');
    await assert.rejects(migrateMysql(database, [{ ...migration, statements: [...migration.statements, 'SELECT 1'] }]), { code: 'MIGRATION_CHECKSUM' });
    await assert.rejects(migrateMysql(database, []), { code: 'MIGRATION_UNKNOWN_VERSION' });

    await database.withConnection(async (holder) => {
      const lock = migrationLockName(env.DB_DATABASE);
      const [acquired] = await holder.query('SELECT GET_LOCK(?, 0) AS acquired', [lock]);
      assert.equal(Number(acquired.acquired), 1);
      try {
        await assert.rejects(migrateMysql(database, [migration], { lockTimeout: 0 }), { code: 'MIGRATION_BUSY' });
      } finally {
        await holder.query('SELECT RELEASE_LOCK(?)', [lock]);
      }
    });
    const partial = { id: '0002_partial', statements: [`CREATE TABLE ${partialTable} (id INT PRIMARY KEY) ENGINE=InnoDB`, 'THIS IS INVALID SQL'] };
    await assert.rejects(migrateMysql(database, [migration, partial]), { code: 'DATABASE_QUERY' });
    const status = await migrationStatus(database, [migration, partial]);
    assert.equal(status[1].state, 'started');
    assert.equal(status[1].completedSteps, 1);
    assert.deepEqual(await database.query(`SELECT * FROM ${partialTable}`), []);
    await assert.rejects(migrateMysql(database, [migration, partial]), { code: 'MIGRATION_INCOMPLETE' });
    await database.withConnection(async (connection) => {
      const lock = migrationLockName(env.DB_DATABASE);
      const [acquired] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lock]);
      assert.equal(Number(acquired.acquired), 1, 'Failed migrations must release their advisory lock');
      await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
    });
  } finally {
    if (ownsLedger) {
      for (const name of [partialTable, table, 'schema_migrations']) await database.query(`DROP TABLE IF EXISTS ${name}`);
    }
    await database.close();
  }
});
