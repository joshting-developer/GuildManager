import { createR2Storage } from './storage/r2.js';
import { createMysqlDatabase } from './database/mysql.js';
import { migrationStatus, MigrationError } from './database/migrate.js';
import { mysqlMigrations } from './database/migrations.js';
import { createMysqlRepository } from './mysql/repository.js';
import { startApi } from './runtime.js';
import { reportError } from './error-log.js';
import { createDiscordNotifier } from './discord-notifier.js';

// Startup never creates or alters tables: the schema must already be at the expected version
// (see docs/mysql-development.md). Any mismatch stops the process with a fixed code only.
let database;
try {
  database = createMysqlDatabase(process.env);
  await database.probe();
  const pending = (await migrationStatus(database, mysqlMigrations)).filter((migration) => migration.state !== 'applied');
  if (pending.length) {
    throw new MigrationError('MIGRATION_PENDING');
  }
} catch (error) {
  reportError(console, 'startup_failed', error);
  if (database) await database.close().catch(() => {});
  process.exit(1);
}

let repository;
try {
  repository = createMysqlRepository(database, { fileStorage: createR2Storage(process.env) });
} catch (error) {
  reportError(console, 'startup_failed', error);
  await database.close().catch(() => {});
  process.exit(1);
}
const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);
try {
  const runtime = await startApi({ repository, host, port, notifier: createDiscordNotifier() });
  console.log('GuildManager API: listening');
  const shutdown = () => { runtime.shutdown().then((code) => process.exit(code)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  reportError(console, 'startup_failed', error);
  await database.close().catch(() => {});
  process.exitCode = 1;
}
