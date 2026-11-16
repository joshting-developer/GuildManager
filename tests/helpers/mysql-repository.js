import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMysqlDatabase } from '../../server/database/mysql.js';
import { migrateMysql } from '../../server/database/migrate.js';
import { mysqlMigrations } from '../../server/database/migrations.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';

const databases = new WeakMap();
export function repositoryDatabase(repository) { return databases.get(repository); }

let gate = Promise.resolve();
export async function createTestRepository(options = {}) {
  const configuration = JSON.parse(readFileSync(process.env.GUILD_MYSQL_REPOSITORY_TEST_CONFIG, 'utf8'));
  assert.equal(configuration.purpose, 'guildmanager-repository-test');
  const env = configuration.environment;
  assert.equal(env.NODE_ENV, 'test');
  assert.match(env.DB_DATABASE, /^sp_guildmanager_[a-z][a-z0-9]{0,15}_repositorytest$/);
  assert.ok(['127.0.0.1', 'localhost', 'mysql', 'side-project-mysql'].includes(env.DB_HOST));
  assert.equal(env.DB_SSL_MODE, 'disabled');
  const database = createMysqlDatabase(env);
  let release;
  const previous = gate;
  gate = new Promise((resolve) => { release = resolve; });
  await previous;
  const tables = mysqlMigrations.flatMap((migration) => migration.statements).map((sql) => sql.match(/^CREATE TABLE `?([a-z_]+)`? /)?.[1]).filter(Boolean);
  let owns = false, closed;
  async function close() {
    if (!closed) closed = (async () => {
      try {
        if (owns) {
          for (const table of [...tables].reverse()) await database.query(`DROP TABLE IF EXISTS \`${table}\``);
          await database.query('DROP TABLE IF EXISTS schema_migrations');
        }
      } finally { try { await database.close(); } finally { release(); } }
    })();
    return closed;
  }
  try {
    const [count] = await database.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE()');
    assert.equal(Number(count.count), 0, 'Repository tests require an empty dedicated schema');
    owns = true;
    await migrateMysql(database, mysqlMigrations);
    const repository = { ...createMysqlRepository(database, options), close };
    databases.set(repository, database);
    return repository;
  } catch (error) { await close(); throw error; }
}
