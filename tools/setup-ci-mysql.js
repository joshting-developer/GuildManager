import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'mysql2/promise';

const purposes = ['test', 'migrationtest', 'schematest', 'repositorytest'];
const names = { test: 'integration', migrationtest: 'migration', schematest: 'schema', repositorytest: 'repository' };

export async function provisionCiMysql(connection, folder, port) {
  // Refuse existing schemas/accounts. This command never resets an existing database.
  for (const purpose of purposes) {
    const [schemas] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME=?', ['sp_guildmanager_ci_' + purpose]);
    const [users] = await connection.query('SELECT User FROM mysql.user WHERE User=?', ['gm_ci_' + purpose]);
    if (schemas.length || users.length) throw new Error('CI resources already exist');
  }
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const purpose of purposes) {
    const database = 'sp_guildmanager_ci_' + purpose, username = 'gm_ci_' + purpose;
    const password = randomBytes(24).toString('base64url');
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    await connection.query("CREATE USER ?@'%' IDENTIFIED BY ?", [username, password]);
    await connection.query(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON \`${database.replaceAll('_', '\\_')}\`.* TO ?@'%'`, [username]);
    const config = { purpose: `guildmanager-${names[purpose]}-test`, environment: { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_DATABASE: database, DB_USERNAME: username, DB_PASSWORD: password, DB_SSL_MODE: 'disabled' } };
    const suffix = names[purpose] === 'integration' ? 'test' : names[purpose] + '-test';
    writeFileSync(resolve(folder, 'mysql-' + suffix + '.json'), JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  }
}

async function main() {
  const port = Number(process.env.CI_MYSQL_PORT);
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true' || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === 13306 || !process.env.CI_MYSQL_ROOT_PASSWORD) {
    throw new Error('Explicit disposable GitHub CI MySQL required');
  }
  const connection = await createConnection({ host: '127.0.0.1', port, user: 'root', password: process.env.CI_MYSQL_ROOT_PASSWORD, connectTimeout: 10000 });
  try { await provisionCiMysql(connection, resolve('.local/ci'), port); } finally { await connection.end(); }
  console.log('Four disposable CI schemas and private test configurations created');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('CI MySQL setup failed; configuration and provider details withheld'); process.exitCode = 1; });
}
