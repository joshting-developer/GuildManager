import { createMysqlDatabase, DatabaseError } from './database/mysql.js';
import { migrationStatus, MigrationError } from './database/migrate.js';
import { mysqlMigrations } from './database/migrations.js';
import { createMysqlRepository } from './mysql/repository.js';
import { AuthError } from './auth-repository.js';

// Read credentials through stdin, not command arguments or application logs.
let database;
try {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 4096) throw new AuthError(422, 'INVALID_ACCOUNT', '帳號設定內容過大');
  }
  const credentials = JSON.parse(input);
  database = createMysqlDatabase(process.env);
  await database.probe();
  const status = await migrationStatus(database, mysqlMigrations);
  if (status.some((migration) => migration.state !== 'applied')) throw new MigrationError('MIGRATION_PENDING');
  const account = await createMysqlRepository(database).createAccount(credentials);
  console.log(`已建立本機登入帳號：${account.username}`);
} catch (error) {
  const message = error instanceof SyntaxError ? '請提供有效的帳號設定 JSON'
    : error instanceof AuthError ? error.message
      : error instanceof DatabaseError || error instanceof MigrationError ? error.code
        : '建立帳號失敗, 請檢查伺服器設定';
  console.error(message);
  process.exitCode = 1;
} finally {
  if (database) await database.close();
}
