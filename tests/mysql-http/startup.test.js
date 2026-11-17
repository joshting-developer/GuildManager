import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';

async function boot(environment, ready = false) {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { PATH: process.env.PATH, ...environment, API_HOST: '127.0.0.1', API_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  let timer;
  try {
    const started = new Promise((resolve) => child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('GuildManager API:')) resolve('ready');
    }));
    child.stderr.on('data', (chunk) => { output += chunk; });
    const outcome = await Promise.race([
      exited, started,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('startup timed out')), 10000); }),
    ]);
    assert.equal(outcome, ready ? 'ready' : 1);
    return output;
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM');
    await exited;
  }
}

test('HTTP startup requires explicit configuration and an applied migration ledger', async () => {
  assert.equal(JSON.parse(await boot({})).code, 'DATABASE_CONFIGURATION');
  await withApp(async ({ repository }) => {
    const environment = JSON.parse(readFileSync(process.env.GUILD_MYSQL_REPOSITORY_TEST_CONFIG, 'utf8')).environment;
    assert.match(await boot(environment, true), /GuildManager API:/);
    const db = repositoryDatabase(repository);
    await db.query("UPDATE schema_migrations SET state = 'started' WHERE id = '0002_repository_lock'");
    const before = await db.query('SELECT id, state FROM schema_migrations ORDER BY id');
    assert.equal(JSON.parse(await boot(environment)).code, 'MIGRATION_PENDING');
    assert.deepEqual(await db.query('SELECT id, state FROM schema_migrations ORDER BY id'), before, 'startup never repairs migrations');
  });
});
