import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { csrfToken } from '../server/auth-repository.js';
import { createMemberClient } from '../src/api/members.js';
import { setGasSession } from '../src/api/gas.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const person = {
  uid: '0001',
  name: '初名',
  primaryProfessionId: 3,
  secondaryProfessionId: 1,
  isInGuild: true,
  isInClub: true,
};
async function memberFlow(client) {
  assert.equal((await client.getMembers()).members.length, 0);
  const created = (await client.addMember(person)).member;
  assert.equal(created.uid, '0001');
  const { uid, ...values } = person;
  const changed = (
    await client.updateMember(uid, {
      ...values,
      name: '新名',
      primaryProfessionId: 2,
      secondaryProfessionId: 5,
      revision: created.revision,
    })
  ).member;
  assert.equal(changed.name, '新名');
  assert.equal(changed.previousNames[0].name, '初名');
  await assert.rejects(
    client.updateMember(uid, { ...values, name: '衝突名', revision: created.revision }),
  );
  const moved = (await client.removeMember(uid, changed.revision)).member;
  assert.equal(moved.isInGuild, false);
  assert.equal(moved.isInClub, false);
  const source = { text: 'UID Name 主職業 副職業\n0001 不覆寫 素問 -\n0002 匯入新成員 龍吟 碎夢' };
  const preview = await client.previewMemberImport(source);
  assert.equal(preview.summary.skipped, 1);
  const imported = await client.importMembers({ ...source, fingerprint: preview.fingerprint });
  assert.equal(imported.summary.added, 1);
  const members = (await client.getMembers()).members;
  assert.equal(members.length, 2);
  assert.equal(members.find((row) => row.uid === '0001').name, '新名');
  assert.equal(members.find((row) => row.uid === '0001').isInGuild, false);
  const restored = (
    await client.updateMember(uid, { ...values, name: '新名', revision: moved.revision })
  ).member;
  assert.equal(restored.isInGuild, true);
  assert.equal(restored.isInClub, true);
  return members;
}

test('member HTTP session has full roster capabilities with CSRF, revisions and import protections; other management stays restricted', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const admin = await repo.createAccount({ username: 'admin', password: 'admin-password-123' });
  await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
  const session = await repo.authenticateMember({ password: 'Member123' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Cookie: `guild_session=${session.token}`, 'X-CSRF-Token': csrfToken(session.token) };
  const fetchMember = (path, init = {}) =>
    fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
  try {
    for (const [path, method, body] of [
      ['/members', 'GET'],
      ['/members', 'POST', person],
      ['/members/0001', 'PATCH', {}],
      ['/members/0001', 'DELETE', { revision: 1 }],
      ['/members/import/preview', 'POST', { text: '' }],
      ['/members/import', 'POST', {}],
    ]) {
      const init = {
        method,
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      };
      assert.equal((await fetch(base + '/api' + path, init)).status, 401);
      if (method !== 'GET')
        assert.equal(
          (
            await fetch(base + '/api' + path, {
              ...init,
              headers: { ...init.headers, Cookie: headers.Cookie },
            })
          ).status,
          403,
        );
    }
    await memberFlow(createMemberClient({ fetchImpl: fetchMember }));
    for (const [path, method] of [
      ['/home', 'GET'],
      ['/lineups', 'GET'],
      ['/duties', 'GET'],
      ['/admin/accounts', 'GET'],
      ['/events', 'POST'],
      ['/lineups/confirm', 'POST'],
      ['/battle-records', 'POST'],
      ['/members/0001/battle-records', 'PATCH'],
      ['/members/import/extra', 'POST'],
    ]) {
      assert.equal((await fetchMember('/api' + path, { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{}' }) })).status, 403, `${method} ${path}`);
    }
    await repo.setMemberToken(admin.id, { password: 'NewPass123', revision: 1 });
    assert.equal((await fetchMember('/api/members')).status, 401);
    assert.equal(
      (await fetchMember('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(person),
      })).status,
      401,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});

test('GAS member RPC adapter supports all roster operations while management roles and session/CSRF checks stay scoped', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const adminCtx = cloudSession(admin);
  cloudResult(env.raw('setMemberToken', [{ password: 'Member123', revision: 0 }], adminCtx));
  const session = cloudResult(env.raw('loginMember', [{ password: 'Member123' }]));
  const context = cloudSession(session);
  for (const [op, args] of [
    ['getMembers', []],
    ['addMember', [person]],
    ['updateMember', ['0001', {}]],
    ['removeMember', ['0001', 1]],
    ['previewMemberImport', [{ text: '' }]],
    ['importMembers', [{}]],
  ]) {
    assert.equal(env.raw(op, args).error.code, 'AUTH_REQUIRED', op);
    if (!['getMembers', 'previewMemberImport'].includes(op))
      assert.equal(
        env.raw(op, args, { sessionToken: session.sessionToken }).error.code,
        'CSRF_INVALID',
        op,
      );
  }
  setGasSession(session);
  function run(success = () => {}, failure = () => {}) {
    return new Proxy(
      {},
      {
        get(_, op) {
          if (op === 'withSuccessHandler') return (fn) => run(fn, failure);
          if (op === 'withFailureHandler') return (fn) => run(success, fn);
          return (...args) => {
            try {
              success(env.raw(op, args));
            } catch (error) {
              failure(error);
            }
          };
        },
      },
    );
  }
  await memberFlow(
    createMemberClient({
      source: 'gas',
      googleRun: run(),
      fetchImpl: () => assert.fail('no HTTP fallback'),
    }),
  );
  for (const [op, args] of [
    ['getHomeData', []],
    ['getLineupIndex', []],
    ['getDuties', []],
    ['getEventVideos', ['missing']],
    ['getEventAttendance', ['missing']],
    ['createEvent', [{}]],
    ['confirmLineup', [{}]],
    ['saveBattleRecords', [{}]],
    ['updateBattleRecord', ['missing', {}]],
    ['getAccountSettings', []],
  ]) {
    assert.equal(
      env.raw(op, args, context).error.code,
      op === 'getAccountSettings' ? 'ADMIN_REQUIRED' : 'MANAGEMENT_REQUIRED',
      op,
    );
  }
  cloudResult(env.raw('setMemberToken', [{ password: 'NewPass123', revision: 1 }], adminCtx));
  assert.equal(env.raw('getMembers', [], context).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('addMember', [person], context).error.code, 'AUTH_REQUIRED');
  setGasSession({ user: null });
});
