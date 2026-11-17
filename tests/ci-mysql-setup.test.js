import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { provisionCiMysql } from '../tools/setup-ci-mysql.js';

test('CI setup refuses preexisting resources before writing and creates only four scoped accounts', async () => {
  let writes = 0;
  const occupied = { async query(sql) { if (!sql.startsWith('SELECT')) writes++; return [[{ exists: true }]]; } };
  await assert.rejects(provisionCiMysql(occupied, 'unused', 3306), /already exist/);
  assert.equal(writes, 0);
  const folder = mkdtempSync(resolve('.local/ci-setup-test-')), calls = [];
  try {
    await provisionCiMysql({ async query(sql, parameters) { calls.push({ sql, parameters }); return [[]]; } }, folder, 3306);
    assert.equal(calls.filter(call => call.sql.startsWith('CREATE DATABASE')).length, 4);
    const grants = calls.filter(call => call.sql.startsWith('GRANT'));
    assert.equal(grants.length, 4);
    for (const grant of grants) {
      assert.match(grant.sql, /ON `sp\\_guildmanager\\_ci\\_/);
      assert.doesNotMatch(grant.sql, /ALL PRIVILEGES|GRANT OPTION|ON \*\.\*/);
    }
    const file = resolve(folder, 'mysql-repository-test.json');
    const config = JSON.parse(readFileSync(file));
    assert.equal(config.purpose, 'guildmanager-repository-test');
    assert.equal(config.environment.DB_DATABASE, 'sp_guildmanager_ci_repositorytest');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('CI command refuses the local shared port before connecting or printing credentials', () => {
  const result = spawnSync(process.execPath, ['tools/setup-ci-mysql.js'], { encoding: 'utf8', env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true', CI_MYSQL_PORT: '13306', CI_MYSQL_ROOT_PASSWORD: 'must-not-leak-root-password' } });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-leak-root-password/);
});
