import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordHash, verifySecret } from '../server/auth-repository.js';
import { createRepository } from '../server/repository.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const invalid = { code: 'INVALID_PASSWORD' };

test('password hashing accepts six through 128 characters, keeps leading zeroes and rejects outside boundaries', async () => {
  for (const password of ['12345', 'a'.repeat(129), 123456, null]) {
    await assert.rejects(passwordHash(password), invalid);
  }
  for (const password of ['001234', 'Ab!234', 'a'.repeat(128)]) {
    const secret = await passwordHash(password);
    assert.equal(await verifySecret(password, secret.salt, secret.hash), true);
    assert.equal(await verifySecret(password + 'x', secret.salt, secret.hash), false);
  }
});

test('SQLite creation, admin changes, manager edits and member tokens accept six characters without losing revision/session protection', async () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const admin = await repo.createAccount({ username: 'admin', password: '001234' });
    const session = await repo.authenticate({ username: 'admin', password: '001234' });
    await assert.rejects(repo.createManager(admin.id, { username: 'short', password: '12345' }), invalid);
    const manager = await repo.createManager(admin.id, { username: 'manager', password: 'Ab!234' });
    const managerSession = await repo.authenticate({ username: 'manager', password: 'Ab!234' });
    await assert.rejects(repo.updateManager(admin.id, manager.id, { username: 'manager', password: '12345', revision: 1 }), invalid);
    await repo.updateManager(admin.id, manager.id, { username: 'manager', password: '', revision: 1 });
    await repo.authenticate({ username: 'manager', password: 'Ab!234' });
    await repo.updateManager(admin.id, manager.id, { username: 'manager', password: '654321', revision: 2 });
    assert.equal(repo.getSession(managerSession.token), null);
    await repo.authenticate({ username: 'manager', password: '654321' });
    await assert.rejects(repo.changeAdminPassword(admin.id, { currentPassword: '001234', password: '12345', revision: 1 }, session.token), invalid);
    await repo.changeAdminPassword(admin.id, { currentPassword: '001234', password: 'a'.repeat(128), revision: 1 }, session.token);
    await repo.authenticate({ username: 'admin', password: 'a'.repeat(128) });
    await assert.rejects(repo.changeAdminPassword(admin.id, { currentPassword: 'a'.repeat(128), password: '654321', revision: 1 }, session.token), { code: 'ACCOUNT_CHANGED' });
    await repo.changeAdminPassword(admin.id, { currentPassword: 'a'.repeat(128), password: '654321', revision: 2 }, session.token);
    await repo.authenticate({ username: 'admin', password: '654321' });
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    await repo.authenticateMember({ password: '001234' });
    await assert.rejects(repo.setMemberToken(admin.id, { password: 'abc!23', revision: 1 }), invalid);
  } finally { repo.close(); }
});

test('compiled GAS accepts six-character bootstrap, manager/admin updates and editor recovery with unchanged member rules', async () => {
  const env = await gasRuntime();
  env.properties.set('BOOTSTRAP_ADMIN_PASSWORD', '001234');
  env.setup();
  const login = password => cloudResult(env.raw('login', [{ username: 'admin', password }]));
  const session = login('001234'), context = cloudSession(session);
  const call = (operation, args) => cloudResult(env.raw(operation, args, context));
  for (const password of ['12345', 'a'.repeat(129), 123456]) {
    assert.equal(env.raw('createManager', [{ username: 'short', password }], context).error.code, 'INVALID_PASSWORD');
  }
  const manager = call('createManager', [{ username: 'manager', password: 'Ab!234' }]).manager;
  call('updateManager', [{ id: manager.id, username: 'manager', password: '', revision: 1 }]);
  cloudResult(env.raw('login', [{ username: 'manager', password: 'Ab!234' }]));
  call('updateManager', [{ id: manager.id, username: 'manager', password: '654321', revision: 2 }]);
  cloudResult(env.raw('login', [{ username: 'manager', password: '654321' }]));
  assert.equal(env.raw('changeAdminPassword', [{ currentPassword: '001234', password: '12345', revision: 1 }], context).error.code, 'INVALID_PASSWORD');
  call('changeAdminPassword', [{ currentPassword: '001234', password: 'a'.repeat(128), revision: 1 }]);
  login('a'.repeat(128));
  call('changeAdminPassword', [{ currentPassword: 'a'.repeat(128), password: '654321', revision: 2 }]);
  call('setMemberToken', [{ password: '001234', revision: 0 }]);
  cloudResult(env.raw('loginMember', [{ password: '001234' }]));
  assert.equal(env.raw('setMemberToken', [{ password: 'abc!23', revision: 1 }], context).error.code, 'INVALID_PASSWORD');
  const business = JSON.stringify([...env.sheets].map(([name, sheet]) => [name, sheet.data]));
  env.sandbox.Session = {
    getActiveUser: () => ({ getEmail: () => 'deployer@example.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'deployer@example.com' }),
  };
  env.sandbox.Logger = { log() {} };
  env.properties.set('RECOVERY_ADMIN_PASSWORD', '12345');
  assert.throws(() => env.sandbox.resetAdminPassword(), invalid);
  env.properties.set('RECOVERY_ADMIN_PASSWORD', '000123');
  assert.equal(env.sandbox.resetAdminPassword().reset, true);
  assert.equal(env.properties.has('RECOVERY_ADMIN_PASSWORD'), false);
  assert.equal(cloudResult(env.raw('getAuthSession', [], context)).user, null);
  login('000123');
  assert.equal(JSON.stringify([...env.sheets].map(([name, sheet]) => [name, sheet.data])), business);
});
