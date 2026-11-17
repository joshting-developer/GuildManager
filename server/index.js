import { createMysqlDatabase } from './database/mysql.js';
import { migrationStatus } from './database/migrate.js';
import { mysqlMigrations } from './database/migrations.js';
import { createMysqlRepository } from './mysql/repository.js';
import { createApp } from './app.js';
import { createDiscordNotifier } from './discord-notifier.js';

// Startup never creates or alters tables: the schema must already be at the expected version
// (see docs/mysql-development.md). Any mismatch stops the process with a fixed code only.
let database;
try {
  database = createMysqlDatabase(process.env);
  await database.probe();
  const pending = (await migrationStatus(database, mysqlMigrations)).filter((migration) => migration.state !== 'applied');
  if (pending.length) {
    console.error(JSON.stringify({ status: 'error', code: 'MIGRATION_PENDING', migrations: pending.map((migration) => migration.id) }));
    await database.close();
    process.exit(1);
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'error', code: error.code || 'DATABASE_STARTUP' }));
  if (database) await database.close().catch(() => {});
  process.exit(1);
}

const repository = createMysqlRepository(database);
const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);
const app = createApp(repository, { notifier: createDiscordNotifier() });
const server = app.listen(port, host, () => {
  console.log(`GuildManager API: http://${host}:${port}`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    try {
      await repository.close();
    } finally {
      process.exit(0);
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
