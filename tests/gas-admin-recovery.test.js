import test from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

test('GAS admin recovery requires Google executor identity and valid private password', async () => {
  const env = await gasRuntime();
  const original = 'initial-password-123',
    next = 'new-recovery-password-123';
  const logs = [];
  let active = '',
    effective = 'deployer@example.com';
  env.sandbox.Session = {
    getActiveUser: () => ({ getEmail: () => active }),
    getEffectiveUser: () => ({ getEmail: () => effective }),
  };
  env.sandbox.Logger = { log: (message) => logs.push(message) };
  env.setup();
  const login = (username, password) => cloudResult(env.raw('login', [{ username, password }]));
  const admin = login('admin', original),
    context = cloudSession(admin);
  const call = (op, args = [], ctx = context) => cloudResult(env.raw(op, args, ctx));
  call('createManager', [{ username: 'manager', password: 'manager-password-123' }]);
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const manager = login('manager', 'manager-password-123');
  const member = cloudResult(env.raw('loginMember', [{ password: 'Member123' }]));
  call('addMember', [
    {
      uid: 'recovery-test',
      name: '保留名冊',
      primaryProfessionId: 1,
      secondaryProfessionId: null,
      isInGuild: true,
      isInClub: false,
    },
  ]);
  const business = JSON.stringify([...env.sheets].map(([name, sheet]) => [name, sheet.data]));
  env.properties.set('RECOVERY_ADMIN_PASSWORD', next);
  for (const email of ['', 'visitor@example.com']) {
    active = email;
    assert.throws(
      () => env.sandbox.resetAdminPassword({ role: 'admin', email: effective }),
      /Google 執行帳號/,
    );
    assert.equal(call('getAccountSettings').admin.revision, 1);
    assert.equal(env.properties.get('RECOVERY_ADMIN_PASSWORD'), next);
    assert.equal(logs.length, 0);
  }
  active = effective;
  env.properties.delete('RECOVERY_ADMIN_PASSWORD');
  assert.throws(() => env.sandbox.resetAdminPassword(), { code: 'RECOVERY_PASSWORD_REQUIRED' });
  env.properties.set('RECOVERY_ADMIN_PASSWORD', 'short');
  assert.throws(() => env.sandbox.resetAdminPassword(), { code: 'INVALID_PASSWORD' });
  assert.equal(env.properties.get('RECOVERY_ADMIN_PASSWORD'), 'short');
  assert.equal(call('getAccountSettings').admin.revision, 1);
  // A locked-out admin can recover; other accounts and sessions are preserved.
  for (let i = 0; i < 10; i++)
    assert.equal(
      env.raw('login', [{ username: 'admin', password: 'incorrect' }]).error.code,
      'INVALID_CREDENTIALS',
    );
  assert.equal(
    env.raw('login', [{ username: 'admin', password: original }]).error.code,
    'LOGIN_LIMIT',
  );
  env.properties.set('RECOVERY_ADMIN_PASSWORD', next);
  const result = env.sandbox.resetAdminPassword();
  assert.equal(result.reset, true);
  assert.equal(result.username, 'admin');
  assert.equal(env.properties.has('RECOVERY_ADMIN_PASSWORD'), false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes(next), false);
  assert.equal(logs[0].includes(effective), false);
  assert.equal(call('getAuthSession').user, null);
  assert.equal(call('getAuthSession', [], cloudSession(manager)).user.role, 'manager');
  assert.equal(call('getAuthSession', [], cloudSession(member)).user.role, 'member');
  assert.equal(
    env.raw('login', [{ username: 'admin', password: original }]).error.code,
    'INVALID_CREDENTIALS',
  );
  const restored = login('admin', next);
  assert.equal(restored.user.id, admin.user.id);
  assert.equal(call('getAccountSettings', [], cloudSession(restored)).admin.revision, 2);
  assert.equal(
    JSON.stringify([...env.sheets].map(([name, sheet]) => [name, sheet.data])),
    business,
  );
  assert.equal(JSON.stringify(Object.fromEntries(env.properties)).includes(next), false);
  assert.equal(
    env.rpc('resetAdminPassword', [], cloudSession(restored)).error.code,
    'OPERATION_INVALID',
  );
});

test('GAS recovery cannot create or reset an absent admin', async () => {
  const env = await gasRuntime();
  env.properties.set('RECOVERY_ADMIN_PASSWORD', 'new-recovery-password-123');
  assert.throws(() => env.sandbox.GuildGas.resetAdminPassword(), {
    code: 'ADMIN_RECOVERY_INVALID',
  });
  assert.equal(env.properties.has('GM_AUTH_POINTER'), false);
  assert.equal(env.properties.has('RECOVERY_ADMIN_PASSWORD'), true);
});
