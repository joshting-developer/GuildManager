import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { createSheetStore, createPrivateStore } from '../gas/src/storage.js';
import { createGasAuth } from '../gas/src/auth.js';
import { derivePassword, hash } from '../gas/src/common.js';
import { gasEnvironment } from './helpers/gas-environment.js';
import { callGas, setGasSession } from '../src/api/gas.js';

test('GAS password KDF agrees with the standard implementation', () => {
  const salt = '0123456789abcdef0123456789abcdef';
  assert.equal(
    derivePassword('混合文字Password!123', salt),
    pbkdf2Sync('混合文字Password!123', Buffer.from(salt, 'hex'), 600000, 32, 'sha256').toString(
      'hex',
    ),
  );
});
test('GAS journal rejects partial writes, retains long payloads and formula-safe cells', () => {
  const env = gasEnvironment(),
    storage = createSheetStore(env);
  storage.initialize();
  const value = { name: '=IMPORTDATA("secret")', long: '繁體中文😀'.repeat(15000) };
  storage.transaction((store) => store.put('members', '001', value));
  assert.deepEqual(
    storage.transaction((store) => store.get('members', '001')),
    value,
  );
  env.failOn('GM_events');
  assert.throws(() =>
    storage.transaction((store) => {
      store.put('members', '001', { changed: true });
      store.put('events', 'event', { created: true });
    }),
  );
  env.failOn(null);
  assert.deepEqual(
    storage.transaction((store) => store.get('members', '001')),
    value,
  );
  assert.equal(
    storage.transaction((store) => store.get('events', 'event')),
    undefined,
  );
  storage.transaction((store) => store.put('members', '001', { successful: true }));
  assert.deepEqual(
    storage.transaction((store) => store.get('members', '001')),
    { successful: true },
  );
  for (const sheet of env.sheets.values())
    for (const row of sheet.data.slice(1))
      for (const cell of row) if (typeof cell === 'string') assert.ok(!/^[=+\-@]/.test(cell));
});
test('GAS private auth storage, roles, mixed token, CSRF and revocation', () => {
  const env = gasEnvironment(),
    privateStore = createPrivateStore(env.propertyService, env.utilities.getUuid);
  const state = privateStore.load();
  const auth = createGasAuth(state, {
    secret: 'a'.repeat(64),
    uuid: env.utilities.getUuid,
    passwordKdf: (pw, salt) => hash(pw + salt),
  });
  auth.bootstrap({ username: 'admin', password: 'initial-password-123' });
  const admin = auth.methods.login([{ username: 'admin', password: 'initial-password-123' }]);
  const context = { sessionToken: admin.sessionToken, csrfToken: admin.csrfToken };
  assert.throws(
    () =>
      auth.methods.setMemberToken([{ password: 'abc123', revision: 0 }], {
        sessionToken: admin.sessionToken,
      }),
    { code: 'CSRF_INVALID' },
  );
  auth.methods.setMemberToken([{ password: 'ABC123xy', revision: 0 }], context);
  const member = auth.methods.loginMember([{ password: 'ABC123xy' }]);
  assert.equal(member.user.username, '');
  assert.throws(() => auth.requireRole({ sessionToken: member.sessionToken }), {
    code: 'MANAGEMENT_REQUIRED',
  });
  auth.methods.setMemberToken([{ password: 'other123', revision: 1 }], context);
  assert.equal(auth.session({ sessionToken: member.sessionToken }), null);
  privateStore.save(state);
  assert.deepEqual(privateStore.load(), state);
  assert.ok(!JSON.stringify(env.propertyService.getProperties()).includes('ABC123xy'));
});
test('GAS adapter appends private context and preserves structured errors', async () => {
  setGasSession({ user: {}, sessionToken: 'a'.repeat(64), csrfToken: 'csrf' });
  let success;
  const run = {
    withSuccessHandler(handler) {
      success = handler;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    operation(input, context) {
      assert.equal(input, 1);
      assert.equal(context.csrfToken, 'csrf');
      success({
        __gasRpc: 1,
        ok: false,
        error: { code: 'STALE_MEMBER', message: '請重新載入', fields: { name: '錯誤' } },
      });
    },
  };
  await assert.rejects(callGas('operation', [1], run), {
    code: 'STALE_MEMBER',
    fields: { name: '錯誤' },
  });
  setGasSession({ user: null });
});
