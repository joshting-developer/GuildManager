import { createMysqlDatabase } from '../server/database/mysql.js';
import { migrationStatus } from '../server/database/migrate.js';
import { mysqlMigrations } from '../server/database/migrations.js';
import { createMysqlRepository } from '../server/mysql/repository.js';
import { createR2Storage } from '../server/storage/r2.js';

let database, storage;
try {
  // Maintenance is opt-in; no startup cleanup or installed schedule.
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') throw new Error();
  database = createMysqlDatabase(process.env);
  if ((await migrationStatus(database, mysqlMigrations)).some(version => version.state !== 'applied')) throw new Error();
  storage = createR2Storage(process.env);
  const repository = createMysqlRepository(database, { fileStorage: storage });
  const result = await repository.cleanupStagedFiles();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ status: 'error', code: 'FILE_CLEANUP_FAILED' }));
  process.exitCode = 1;
} finally {
  storage?.close();
  if (database) await database.close().catch(() => { process.exitCode = 1; });
}
