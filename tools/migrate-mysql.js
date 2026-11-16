import { createMysqlDatabase } from '../server/database/mysql.js';
import { migrateMysql, migrationStatus } from '../server/database/migrate.js';
import { mysqlMigrations } from '../server/database/migrations.js';

let database;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--status')) throw new Error('Invalid migration arguments');
  database = createMysqlDatabase(process.env);
  const result = args[0] === '--status'
    ? await migrationStatus(database, mysqlMigrations)
    : await migrateMysql(database, mysqlMigrations);
  console.log(JSON.stringify({ status: 'ok', migrations: result }));
} catch (error) {
  console.error(JSON.stringify({ status: 'error', code: error.code || 'MIGRATION_ARGUMENTS' }));
  process.exitCode = 1;
} finally {
  if (database) {
    try { await database.close(); } catch { process.exitCode = 1; }
  }
}
