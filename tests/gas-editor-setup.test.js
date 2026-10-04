import test from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime, cloudResult } from './helpers/gas-runtime.js';

test('editor setup entry rejects empty/different Google identities before any writes', async () => {
  const env = await gasRuntime();
  let active = '',
    effective = 'deployer@example.com';
  env.sandbox.Session = {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => effective }),
  };
  for (const [current, executor] of [
    ['', 'deployer@example.com'],
    ['visitor@example.com', 'deployer@example.com'],
    ['deployer@example.com', ''],
    ['', ''],
  ]) {
    active = current;
    effective = executor;
    assert.throws(
      () => env.sandbox.setupGas({ role: 'admin', email: executor }),
      /Google 執行帳號/,
    );
    assert.equal(env.sheets.size, 0);
    assert.equal(env.files.size, 0);
    assert.equal(env.properties.get('BOOTSTRAP_ADMIN_PASSWORD'), 'initial-password-123');
    assert.equal(env.properties.has('DRIVE_FOLDER_ID'), false);
  }
  active = effective = 'deployer@example.com';
  assert.equal(env.sandbox.setupGas().initialized, true);
  assert.equal(env.properties.has('BOOTSTRAP_ADMIN_PASSWORD'), false);
  assert.equal(env.sheets.has('GM_members'), true);
  assert.equal(env.sandbox.setupGas().initialized, true);
  const login = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  assert.equal(login.user.role, 'admin');
  assert.equal(env.rpc('setupGas').error.code, 'OPERATION_INVALID');
  assert.equal(env.rpc('setupGas_').error.code, 'OPERATION_INVALID');
});
