import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberChanges, createMemberEditAudit } from '../server/mysql/member-edit-audit.js';

test('audit diffs ignore revision and timestamp, preserve false and null, and skip no-ops', async () => {
  const before = { uid: '001', name: 'old', isInGuild: true, secondaryProfession: '' };
  const after = { ...before, name: 'new', isInGuild: false, revision: 5, updatedAt: 'now' };
  assert.deepEqual(memberChanges(before, after), [
    { field: 'name', before: 'old', after: 'new' },
    { field: 'isInGuild', before: true, after: false },
  ]);
  const calls = [];
  const audit = createMemberEditAudit({ prepare: sql => ({ run: async (...args) => calls.push({ sql, args }) }) });
  await audit('001', 'update', before, before);
  assert.equal(calls.length, 0);
  await audit('001', 'update', before, after, { id: 'account', username: 'snapshot' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(3, 5), ['account', 'snapshot']);
  assert.deepEqual(JSON.parse(calls[0].args[6]), memberChanges(before, after));
});

test('history route permits manager/admin and rejects member/anonymous without opening a server', async () => {
  const { createApp } = await import('../server/app.js');
  const { IncomingMessage, ServerResponse } = await import('node:http');
  const { Duplex } = await import('node:stream');
  for (const [role, expected] of [['admin', 200], ['manager', 200], ['member', 403], [null, 401]]) {
    let reads = 0;
    const app = createApp({
      getSession: async () => role ? { user: { id: 'a', role } } : null,
      getMemberEditHistory: async uid => { reads++; assert.equal(uid, '001'); return { items: [] }; },
    });
    const result = await new Promise((resolve, reject) => {
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
      const request = new IncomingMessage(socket);
      request.method = 'GET'; request.url = '/api/members/001/edit-history';
      request.headers = {};
      const response = new ServerResponse(request);
      const timeout = setTimeout(() => reject(new Error('Response timed out')), 2000);
      response.end = body => {
        clearTimeout(timeout);
        resolve({ status: response.statusCode, body: JSON.parse(body) });
        socket.destroy();
      };
      app.handle(request, response);
      request.push(null);
    });
    assert.equal(result.status, expected, String(role));
    assert.equal(reads, expected === 200 ? 1 : 0);
  }
});
