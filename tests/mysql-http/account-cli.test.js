import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { withApp, ADMIN } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';

async function createAccount(input, environment) {
  const child = spawn(process.execPath, ['server/create-account.js'], {
    env: { PATH: process.env.PATH, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
    return { code: await exited, output };
  } finally {
    clearTimeout(timer);
  }
}

test('account CLI creates hashed MySQL accounts usable by HTTP and refuses duplicates without resetting passwords', async () => withApp(async (app) => {
  const environment = JSON.parse(readFileSync(process.env.GUILD_MYSQL_REPOSITORY_TEST_CONFIG, 'utf8')).environment;
  const result = await createAccount(ADMIN, environment);
  assert.equal(result.code, 0);
  assert.match(result.output, /已建立本機登入帳號/);
  assert.equal(result.output.includes(ADMIN.password), false);
  assert.equal((await app.login()).session.user.role, 'admin');
  const duplicate = await createAccount({ ...ADMIN, username: ADMIN.username.toUpperCase(), password: 'different-password' }, environment);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.output, /帳號已存在/);
  const login = await app.login();
  assert.equal(login.session.user.role, 'admin');
  const manager = await createAccount({ username: 'second', password: '001234' }, environment);
  assert.equal(manager.code, 0);
  assert.equal((await app.login({ username: 'second', password: '001234' })).session.user.role, 'manager');
  for (const input of ['{', ' '.repeat(4097), { username: 'invalid', password: 'short' }]) {
    assert.equal((await createAccount(input, environment)).code, 1);
  }
  assert.equal((await repositoryDatabase(app.repository).query('SELECT id FROM auth_accounts')).length, 2);
}));

test('account CLI refuses missing configuration and incomplete migrations without creating accounts or repairing the schema', async () => withApp(async (app) => {
  const environment = JSON.parse(readFileSync(process.env.GUILD_MYSQL_REPOSITORY_TEST_CONFIG, 'utf8')).environment;
  const missing = await createAccount(ADMIN, {});
  assert.equal(missing.code, 1);
  assert.equal(missing.output.trim(), 'DATABASE_CONFIGURATION');
  const db = repositoryDatabase(app.repository);
  await db.query("UPDATE schema_migrations SET state='started' WHERE id='0002_repository_lock'");
  const pending = await createAccount(ADMIN, environment);
  assert.equal(pending.code, 1);
  assert.equal(pending.output.trim(), 'MIGRATION_PENDING');
  assert.deepEqual(await db.query('SELECT id FROM auth_accounts'), []);
  assert.equal((await db.query("SELECT state FROM schema_migrations WHERE id='0002_repository_lock'"))[0].state, 'started');
  const failed = await createAccount(ADMIN, { ...environment, DB_PASSWORD: 'synthetic-invalid-password' });
  assert.equal(failed.code, 1);
  assert.equal(failed.output.includes('synthetic-invalid-password'), false);
  assert.equal(failed.output.includes(environment.DB_USERNAME), false);
}));
