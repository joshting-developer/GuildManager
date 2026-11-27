import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ADMIN } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';

const person = { uid: '0001', name: '測試成員', primaryProfessionId: 1, secondaryProfessionId: null, isInGuild: true, isInClub: true };
const managerCredentials = { username: 'manager', password: 'manager-password' };
const memberPassword = '001234';
async function roles(app) {
  const admin = await app.admin();
  await app.repository.createManager(admin.session.user.id, managerCredentials);
  await app.repository.setMemberToken(admin.session.user.id, { password: memberPassword, revision: 0 });
  return {
    admin,
    manager: await app.login(managerCredentials),
    member: await app.login({ password: memberPassword }, { path: '/auth/member-login' }),
  };
}
async function denied(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error.code, code);
}

test('MySQL sessions use private cookies, restore on reload and revoke on logout, rotation and expiry', async () => withApp(async (app) => {
  const first = await app.admin();
  const cookie = first.response.headers.get('set-cookie');
  for (const pattern of [/HttpOnly/i, /SameSite=Lax/i, /Path=\/api/i, /Max-Age=28800/]) assert.match(cookie, pattern);
  assert.deepEqual(Object.keys(first.session).sort(), ['csrfToken', 'expiresAt', 'user']);
  assert.deepEqual(Object.keys(first.session.user).sort(), ['id', 'role', 'username']);
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await first.request('/auth/session')).json(), first.session);
  for (const Cookie of ['guild_session=fake', `guild_session=${'a'.repeat(43)}`, `${first.headers.Cookie}; ${first.headers.Cookie}`]) {
    await denied(await app.request('/members', 'GET', undefined, { Cookie }), 401, 'AUTH_REQUIRED');
  }
  const second = await app.login(ADMIN, { headers: { Cookie: first.headers.Cookie } });
  assert.notEqual(second.headers.Cookie, first.headers.Cookie);
  await denied(await first.request('/members'), 401, 'AUTH_REQUIRED');
  app.advance(8 * 60 * 60 * 1000);
  await denied(await second.request('/members'), 401, 'AUTH_REQUIRED');
  assert.deepEqual(await (await second.request('/auth/session')).json(), { user: null });
  const third = await app.login();
  const logout = await third.request('/auth/logout', 'POST', {});
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  await denied(await third.request('/members'), 401, 'AUTH_REQUIRED');
}));

test('anonymous callers cannot read or mutate management routes and refusals leave MySQL unchanged', async () => withApp(async (app) => {
  for (const [path, method = 'GET'] of [
    ['/members'], ['/members/'], ['/%6dembers'], ['/calendar/members'], ['/lineups'], ['/lineups/editor'], ['/duties'], ['/lottery'],
    ['/battle-records'], ['/battle-records/missing/attachments/csv'], ['/admin/accounts'],
    ['/members', 'POST'], ['/members/0001', 'PATCH'], ['/members/0001', 'DELETE'],
    ['/members/import/preview', 'POST'], ['/members/import', 'POST'], ['/members/0001/maintenance', 'PATCH'],
    ['/events', 'POST'], ['/events/missing', 'PATCH'], ['/events/missing', 'DELETE'],
    ['/lineups/confirm', 'POST'], ['/lineups/templates', 'POST'], ['/battle-records', 'POST'],
    ['/lottery', 'PATCH'], ['/admin/managers', 'POST'], ['/admin/member-token', 'PATCH'], ['/auth/logout', 'POST'],
  ]) await denied(await app.request(path, method, method === 'GET' ? undefined : {}), 401, 'AUTH_REQUIRED');
  assert.deepEqual((await app.repository.listMembers()).members, []);
  assert.deepEqual((await app.repository.listEvents()).events, []);
  assert.deepEqual(await repositoryDatabase(app.repository).query('SELECT id FROM auth_accounts'), []);
}));

test('member retains roster edits and battle reads while management and admin remain protected', async () => withApp(async (app) => {
  const { admin, manager, member } = await roles(app);
  assert.equal(member.session.user.role, 'member');
  assert.equal(member.session.user.username, '');
  assert.equal((await member.request('/members')).status, 200);
  const created = await member.request('/members', 'POST', person);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).member.uid, person.uid);
  const { uid, ...values } = person;
  const updated = await member.request(`/members/${uid}`, 'PATCH', { ...values, name: '新名字', revision: 1 });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).member.previousNames[0].name, person.name);
  const text = 'UID Name 主職業 副職業\n0002 匯入成員 素問 -';
  const preview = await member.request('/members/import/preview', 'POST', { text });
  assert.equal(preview.status, 200);
  const fingerprint = (await preview.json()).fingerprint;
  assert.equal((await member.request('/members/import', 'POST', { text, fingerprint })).status, 200);
  assert.equal((await member.request('/battle-records')).status, 200);
  assert.equal((await member.request('/members/0001/battle-records')).status, 200);
  assert.equal((await member.request('/calendar/members')).status, 200);
  for (const [path, method = 'GET'] of [
    ['/lineups'], ['/duties'], ['/lottery'], ['/admin/accounts'],
    ['/members/0001/edit-history'], ['/members/0001/maintenance'], ['/members/0001', 'DELETE'], ['/members/0001/history', 'PATCH'],
    ['/members/0001/permanent-delete', 'POST'], ['/members/0001/maintenance', 'PATCH'],
    ['/events', 'POST'], ['/lineups/confirm', 'POST'], ['/battle-records', 'POST'], ['/battle-records/missing', 'DELETE'],
    ['/members/0001/battle-records', 'PATCH'], ['/members/import/extra', 'POST'],
  ]) await denied(await member.request(path, method, method === 'GET' ? undefined : {}), 403, 'MANAGEMENT_REQUIRED');
  assert.equal((await app.repository.listMembers()).members.find((m) => m.uid === '0001').revision, 2);
  for (const actor of [admin, manager]) {
    for (const path of ['/lineups', '/duties', '/lottery', '/members/0001/maintenance']) {
      assert.equal((await actor.request(path)).status, 200, path);
    }
    const current = (await app.repository.listMembers()).members.find((m) => m.uid === person.uid);
    assert.equal((await actor.request('/members/0001', 'DELETE', { revision: current.revision })).status, 200);
  }
  for (const [path, method = 'GET'] of [
    ['/admin/accounts'], ['/admin/managers', 'POST'], ['/admin/managers/missing', 'PATCH'],
    ['/admin/password', 'POST'], ['/admin/member-token', 'PATCH'], ['/admin/platform-settings', 'PATCH'],
  ]) await denied(await manager.request(path, method, method === 'GET' ? undefined : {}), 403, 'ADMIN_REQUIRED');
  assert.equal((await admin.request('/admin/accounts')).status, 200);
}));

test('all roles require their current CSRF token for writes, including authenticated public participation', async () => withApp(async (app) => {
  const { admin, manager, member } = await roles(app);
  await app.repository.addMember(person);
  const event = await app.repository.createEvent({ type: 'scrimmage', title: 'CSRF測試', dates: ['2099-10-24'], requestId: 'csrf-event' });
  const path = `/events/${event.id}/participation`;
  const body = { uid: person.uid, status: 'leave', revision: 0 };
  for (const actor of [admin, manager, member]) {
    for (const token of [undefined, 'fake', admin === actor ? member.session.csrfToken : admin.session.csrfToken]) {
      const headers = { Cookie: actor.headers.Cookie, ...(token ? { 'X-CSRF-Token': token } : {}) };
      await denied(await app.request('/members', 'POST', { ...person, uid: 'blocked' }, headers), 403, 'CSRF_INVALID');
      await denied(await app.request(path, 'PATCH', body, headers), 403, 'CSRF_INVALID');
      await denied(await app.request('/auth/logout', 'POST', {}, headers), 403, 'CSRF_INVALID');
    }
    await denied(await app.request('/members', 'POST', { ...person, uid: 'blocked' }, { ...actor.headers, Origin: 'https://evil.test' }), 403, 'ORIGIN_NOT_ALLOWED');
  }
  assert.equal((await app.repository.listMembers()).members.length, 1);
  assert.deepEqual((await app.repository.getEventParticipation(event.id)).responses, []);
  assert.equal((await app.request(path, 'PATCH', body)).status, 200, 'anonymous calendar writes remain public');
  assert.equal((await member.request(path, 'PATCH', { ...body, status: 'registered', revision: 1 })).status, 200);
  assert.equal((await app.request('/members', 'POST', { ...person, uid: 'allowed' }, { ...member.headers, Origin: 'http://localhost:5173' })).status, 201);
}));

test('admin manages fixed-role accounts, revisions and passwords, revoking other sessions immediately', async () => withApp(async (app) => {
  const first = await app.admin();
  const second = await app.login();
  const created = await first.request('/admin/managers', 'POST', { ...managerCredentials, role: 'admin' });
  assert.equal(created.status, 201);
  const { manager } = await created.json();
  assert.equal(manager.role, 'manager', 'browser role cannot grant admin');
  const session = await app.login(managerCredentials);
  const editPath = `/admin/managers/${manager.id}`;
  await denied(await first.request(editPath, 'PATCH', { ...managerCredentials, password: 'changed-password', revision: 99 }), 409, 'ACCOUNT_CHANGED');
  assert.equal((await session.request('/duties')).status, 200, 'failed edit does not revoke session');
  assert.equal((await first.request(editPath, 'PATCH', { ...managerCredentials, password: 'changed-password', revision: 1 })).status, 200);
  await denied(await session.request('/duties'), 401, 'AUTH_REQUIRED');
  await denied(await app.request('/auth/login', 'POST', managerCredentials), 401, 'INVALID_CREDENTIALS');
  assert.equal((await app.login({ ...managerCredentials, password: 'changed-password' })).session.user.role, 'manager');
  const change = { currentPassword: ADMIN.password, password: 'new-admin-password', revision: 1 };
  await denied(await first.request('/admin/password', 'POST', { ...change, currentPassword: 'wrong' }), 422, 'CURRENT_PASSWORD_INVALID');
  assert.equal((await second.request('/admin/accounts')).status, 200);
  assert.equal((await first.request('/admin/password', 'POST', change)).status, 200);
  assert.equal((await first.request('/admin/accounts')).status, 200, 'current admin session is preserved');
  await denied(await second.request('/admin/accounts'), 401, 'AUTH_REQUIRED');
  await denied(await first.request('/admin/password', 'POST', change), 409, 'ACCOUNT_CHANGED');
  await denied(await app.request('/auth/login', 'POST', ADMIN), 401, 'INVALID_CREDENTIALS');
  assert.equal((await app.login({ ...ADMIN, password: change.password })).session.user.role, 'admin');
}));

test('member password is case-sensitive with leading zeroes, hides identity and rotates every member session', async () => withApp(async (app) => {
  const { admin, member } = await roles(app);
  const another = await app.login({ password: memberPassword }, { path: '/auth/member-login' });
  await denied(await app.request('/auth/login', 'POST', { username: 'guild_member', password: memberPassword }), 401, 'INVALID_CREDENTIALS');
  await denied(await app.request('/auth/member-login', 'POST', { password: '1234' }), 401, 'INVALID_CREDENTIALS');
  const tokenPath = '/admin/member-token';
  await denied(await admin.request(tokenPath, 'PATCH', { password: 'NewPass1', revision: 0 }), 409, 'ACCOUNT_CHANGED');
  assert.equal((await member.request('/members')).status, 200);
  const settings = await admin.request('/admin/accounts');
  assert.deepEqual((await settings.json()).memberToken, { configured: true, revision: 1 });
  assert.equal((await admin.request(tokenPath, 'PATCH', { password: 'NewPass1', revision: 1 })).status, 200);
  for (const actor of [member, another]) await denied(await actor.request('/members'), 401, 'AUTH_REQUIRED');
  for (const password of [memberPassword, 'newpass1']) await denied(await app.request('/auth/member-login', 'POST', { password }), 401, 'INVALID_CREDENTIALS');
  const renewed = await app.login({ password: 'NewPass1', username: ADMIN.username, role: 'admin' }, { path: '/auth/member-login' });
  assert.equal(renewed.session.user.role, 'member');
  assert.equal(renewed.session.user.username, '');
  assert.equal((await admin.request('/admin/accounts')).status, 200);
}));

test('session reads use current database roles and reject legacy individual member accounts', async () => withApp(async (app) => {
  const { admin, manager } = await roles(app);
  const db = repositoryDatabase(app.repository);
  await db.query("UPDATE auth_accounts SET role='manager' WHERE id=?", [admin.session.user.id]);
  await denied(await admin.request('/admin/accounts'), 403, 'ADMIN_REQUIRED');
  await db.query("UPDATE auth_accounts SET role='member' WHERE id=?", [manager.session.user.id]);
  await denied(await manager.request('/duties'), 401, 'AUTH_REQUIRED');
  await denied(await app.request('/auth/login', 'POST', managerCredentials), 401, 'INVALID_CREDENTIALS');
}));

test('unknown and wrong logins have identical envelopes, share a parallel limit with member login and expire', async () => withApp(async (app) => {
  await app.admin();
  const errors = [];
  for (const input of [{ ...ADMIN, password: 'wrong' }, { username: 'unknown', password: 'wrong' }, {}, { username: {}, password: [] }]) {
    const response = await app.request('/auth/login', 'POST', input);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    errors.push(await response.json());
  }
  errors.forEach((body) => assert.deepEqual(body, errors[0]));
  app.advance(5 * 60 * 1000);
  const responses = await Promise.all(Array.from({ length: 11 }, (_, i) => app.request(
    i % 2 ? '/auth/member-login' : '/auth/login', 'POST', i % 2 ? { password: 'wrong' } : { ...ADMIN, password: 'wrong' },
  )));
  assert.equal(responses.filter((r) => r.status === 401).length, 10);
  assert.equal(responses.filter((r) => r.status === 429).length, 1);
  await denied(await app.request('/auth/login', 'POST', ADMIN), 429, 'LOGIN_LIMIT');
  app.advance(5 * 60 * 1000);
  await app.login();
}));

test('MySQL stores only hashes and a newly created Repository can restore the session without overwriting accounts', async () => withApp(async (app) => {
  const admin = await app.admin();
  await assert.rejects(app.repository.createAccount({ ...ADMIN, username: ADMIN.username.toUpperCase() }), { code: 'ACCOUNT_EXISTS' });
  const db = repositoryDatabase(app.repository);
  const accounts = await db.query('SELECT * FROM auth_accounts');
  const sessions = await db.query('SELECT * FROM auth_sessions');
  const token = admin.headers.Cookie.split('=')[1];
  const stored = JSON.stringify({ accounts, sessions });
  assert.equal(stored.includes(ADMIN.password), false);
  assert.equal(stored.includes(token), false);
  assert.match(accounts[0].password_hash, /^[a-f0-9]+$/i);
  assert.match(sessions[0].token_hash, /^[a-f0-9]{64}$/i);
  const reopened = createMysqlRepository(db);
  assert.deepEqual((await reopened.getSession(token)).user, admin.session.user);
  await reopened.revokeSession(token);
  await denied(await admin.request('/members'), 401, 'AUTH_REQUIRED');
}));


test('loopback development login remains usable without Secure cookies', async () => withApp(async (app) => {
  const login = await app.admin();
  assert.doesNotMatch(login.response.headers.get('set-cookie'), /; Secure/i);
  assert.match(login.response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(login.response.headers.get('set-cookie'), /SameSite=Lax/i);
}));

test('case-insensitive Express routes cannot bypass the admin guard with mixed-case paths', async () => withApp(async (app) => {
  const { manager } = await roles(app);
  const before = await app.repository.getPlatformSettings();
  for (const path of ['/ADMIN/platform-settings', '/AdMiN/platform-settings']) {
    await denied(await manager.request(path, 'PATCH', { name: '禁止變更', revision: before.platform.revision }), 403, 'ADMIN_REQUIRED');
  }
  assert.deepEqual(await app.repository.getPlatformSettings(), before);
}));
