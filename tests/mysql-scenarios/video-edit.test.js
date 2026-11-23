import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';

const submission = event => ({ name: 'HTTP 角色', professionId: 3, firstUrl: 'https://example.com/first',
  secondUrl: '', groupName: '進攻一', note: '', eventRevision: event.revision, requestId: crypto.randomUUID() });

test('HTTP video move and delete are management-only, require CSRF and the adapter checks responses', async () => {
  const repo = await createTestRepository({});
  const wrong = await repo.createEvent({ type: 'guild_war', title: '', dates: ['2020-01-01'], requestId: 'http-wrong' });
  const right = await repo.createEvent({ type: 'guild_war', title: '', dates: ['2020-01-08'], requestId: 'http-right' });
  const video = (await repo.submitEventVideo(wrong.id, submission(wrong))).video;
  const server = createApp(repo).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, calls = [];
    await repo.createAccount({ username: 'test_admin', password: 'test-password-2026' });
    const admin = await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.user.id, { password: '001234', revision: 0 });
    const member = await repo.authenticateMember({ password: '001234' });
    const send = (method, path, body, cookie) => fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `guild_session=${cookie}` } : {}) }, body: JSON.stringify(body) });
    const movePath = `/api/events/${wrong.id}/videos/${video.id}/event`, deletePath = `/api/events/${wrong.id}/videos/${video.id}`;
    for (const [method, path, body] of [['PATCH', movePath, { targetEventId: right.id, revision: 0, requestId: 'anon' }], ['DELETE', deletePath, { revision: 0 }]]) {
      assert.equal((await send(method, path, body)).status, 401);
      assert.equal((await send(method, path, body, member.token)).status, 403);
      assert.equal((await send(method, path, body, admin.token)).status, 403); // Missing CSRF.
    }
    await repo.createManager(admin.user.id, { username: 'manager', password: 'manager-password' });
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'manager', password: 'manager-password' }) });
    const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
    const client = createEventVideoClient({ fetchImpl: (url, options) => { calls.push([url, options.method]);
      return fetch(base + url, { ...options, headers: { ...options.headers, Cookie: cookie, 'X-CSRF-Token': session.csrfToken } }); } });
    const moved = await client.moveVideo(wrong.id, video.id, { targetEventId: right.id, revision: 0, requestId: crypto.randomUUID() });
    assert.deepEqual(calls, [[movePath, 'PATCH']]);
    assert.equal(moved.video.eventId, right.id);
    assert.equal((await client.getVideos(wrong.id)).videos.length, 0);
    await assert.rejects(client.deleteVideo(right.id, video.id, { revision: 0 }), { code: 'REVISION_CONFLICT' });
    assert.deepEqual(await client.deleteVideo(right.id, video.id, { revision: 1 }), { eventId: right.id, videoId: video.id, deleted: true });
    assert.equal(calls.at(-1)[1], 'DELETE');
    assert.equal((await client.getVideos(right.id)).videos.length, 0);
    await assert.rejects(client.deleteVideo(right.id, video.id, { revision: 1 }), { code: 'VIDEO_NOT_FOUND' });
  } finally { await new Promise(r => server.close(r)); await repo.close(); }
});
