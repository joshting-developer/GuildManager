import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { csrfToken } from '../../server/mysql/auth-repository.js';
import { createMemberClient } from '../../src/api/members.js';

const person = (uid, name = '現在名') => ({ uid, name, primaryProfessionId: 3, secondaryProfessionId: null });
// Never send the ordinary endpoint's immutable uid field to management writes.
function edit(newUid, revision, requestId) {
  const { uid, ...profile } = person(newUid);
  const input = { ...profile, newUid, revision, requestId };
  return input;
}
const code = (expected) => (error) => error.code === expected;

// Run the actual Express middleware and JSON routes without opening a socket.
// Live HTTP integration remains covered by the existing application suites.
function inProcessFetch(app, session, csrf = true) {
  return (path, options = {}) => new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
    const request = new IncomingMessage(socket);
    request.method = options.method || 'GET';
    request.url = path;
    request.httpVersion = '1.1';
    const headers = new Headers(options.headers);
    if (session) {
      headers.set('Cookie', `guild_session=${session.token}`);
      if (csrf) headers.set('X-CSRF-Token', csrfToken(session.token));
    }
    if (options.body) headers.set('Content-Length', String(Buffer.byteLength(options.body)));
    request.headers = Object.fromEntries(headers);
    request.on('end', () => { request.complete = true; });
    const response = new ServerResponse(request);
    const timeout = setTimeout(() => reject(new Error('Express response timed out')), 2000);
    response.end = (body) => {
      clearTimeout(timeout);
      resolve(new Response(body, { status: response.statusCode, headers: response.getHeaders() }));
      socket.destroy();
    };
    app.handle(request, response);
    if (options.body) request.push(options.body);
    request.push(null);
  });
}

test('Express routes and member client enforce manager-only endpoints, CSRF and immutable ordinary UID writes', async () => {
  const repo = await createTestRepository({ });
  const admin = await (await repo.createAccount({ username: 'admin', password: 'admin-password-123' }));
  await (await repo.createAccount({ username: 'manager', password: 'manager-password-123' }));
  await (await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 }));
  const manager = await (await repo.authenticate({ username: 'manager', password: 'manager-password-123' }));
  const member = await (await repo.authenticateMember({ password: 'Member123' }));
  (await repo.addMember(person('001')));
  const app = createApp(repo);
  const fetchAs = (session, csrf = true) => inProcessFetch(app, session, csrf);
  try {
    for (const client of [createMemberClient({ fetchImpl: fetchAs(member) }), createMemberClient({ fetchImpl: fetchAs() })]) {
      await assert.rejects(client.getMemberMaintenance('001'));
      await assert.rejects(client.maintainMember('001', edit('002', 1, 'deny')));
      await assert.rejects(client.saveMemberNameHistory('001', { revision: 1, requestId: 'deny', entries: [] }));
      await assert.rejects(client.deleteMemberPermanently('001', { revision: 1, requestId: 'deny', confirmUid: '001' }));
    }
    const client = createMemberClient({ fetchImpl: fetchAs(manager) });
    const noCsrf = createMemberClient({ fetchImpl: fetchAs(manager, false) });
    await assert.rejects(noCsrf.maintainMember('001', edit('002', 1, 'csrf')), code('CSRF_INVALID'));
    await assert.rejects(client.updateMember('001', { ...person('002'), revision: 1 }), code('VALIDATION_ERROR'));
    assert.equal((await client.getMemberMaintenance('001')).member.uid, '001');
    const updated = await client.maintainMember('001', edit('002', 1, 'http-edit'));
    // More than 16 KB verifies that the history route supports its documented limit.
    const entries = Array.from({ length: 150 }, (_,i) => ({ name: `歷史名${i}${'長'.repeat(50)}` }));
    const history = await client.saveMemberNameHistory('002', { revision: updated.member.revision, requestId: 'http-history', entries });
    assert.equal(history.member.previousNames.length, 150);
    assert.equal((await client.deleteMemberPermanently('002', { revision: history.member.revision, requestId: 'http-delete', confirmUid: '002' })).deleted, true);
  } finally { (await repo.close()); }
});

test('audit follows UID maintenance, request replay, history edits and permanent deletion', async () => {
  const repo = await createTestRepository();
  const actor = { id: 'manager-audit', username: 'maintainer' };
  try {
    const first = await repo.addMember(person('audit-old'), { actor });
    const input = edit('audit-new', first.revision, 'audit-maintain');
    const maintained = await repo.maintainMember(first.uid, input, actor);
    await repo.maintainMember(first.uid, input, actor);
    assert.equal((await repo.getMemberEditHistory(first.uid)).items.length, 0);
    const logs = (await repo.getMemberEditHistory('audit-new')).items;
    assert.equal(logs.length, 2, 'replay does not duplicate the audit');
    assert.deepEqual(logs.find(row => row.action === 'maintenance').changes, [{ field: 'uid', before: 'audit-old', after: 'audit-new' }]);
    const history = await repo.saveMemberNameHistory('audit-new', { revision: maintained.member.revision, requestId: 'audit-history', entries: [{ name: '早期名稱' }] }, actor);
    assert.deepEqual((await repo.getMemberEditHistory('audit-new')).items.find(row => row.action === 'history_edit').changes[0], { field: 'previousNames', before: [], after: ['早期名稱'] });
    await repo.deleteMemberPermanently('audit-new', { revision: history.member.revision, requestId: 'audit-delete', confirmUid: 'audit-new' }, actor);
    assert.equal((await repo.listMembers()).members.length, 0);
    assert.equal((await repo.getMemberEditHistory('audit-new')).items.length, 4);
    assert.ok((await repo.getMemberEditHistory('audit-new')).items.some(row => row.action === 'permanent_delete'));
    assert.ok((await repo.getMemberEditHistory('audit-new')).items.every(row => row.actorAccountId === actor.id && row.actorName === actor.username));
    assert.equal((await repo.getMemberEditHistory('audit-new')).nextCursor, null);
    await assert.rejects(repo.getMemberEditHistory('audit-new', 'not-a-cursor'), { code: 'INVALID_CURSOR' });
  } finally { await repo.close(); }
});
