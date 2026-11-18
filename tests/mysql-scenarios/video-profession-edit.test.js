import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

const submission = event => ({ name: '同名角色', professionId: 3, firstUrl: 'https://example.com/first',
  secondUrl: 'https://example.com/second', groupName: '進攻二', note: '長備註\n第二行',
  eventRevision: event.revision, requestId: crypto.randomUUID() });
const input = (extra = {}) => ({ professionId: 4, revision: 0, requestId: crypto.randomUUID(), ...extra });

test('HTTP profession editing is management-only, requires CSRF and adapter PATCH returns only the affected video', async () => {
  const repo = await createTestRepository({ });
  const event = (await repo.createEvent({ type: 'scrimmage', title: 'HTTP', dates: ['2020-01-01'], requestId: 'http' }));
  const video = (await repo.submitEventVideo(event.id, submission(event))).video;
  const server = createApp(repo).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const admin = await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }));
    await (await repo.setMemberToken(admin.user.id, { password: '001234', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: '001234' }));
    const path = `/api/events/${event.id}/videos/${video.id}/profession`, body = JSON.stringify(input());
    const request = cookie => fetch(base + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `guild_session=${cookie}` } : {}) }, body });
    assert.equal((await request()).status, 401);
    assert.equal((await request(member.token)).status, 403);
    assert.equal((await request(admin.token)).status, 403);
    await (await repo.createManager(admin.user.id, { username: 'manager', password: 'manager-password' }));
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'manager', password: 'manager-password' }) });
    const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
    const client = createEventVideoClient({ fetchImpl: (url, options) => { calls.push([url, options]); return fetch(base + url, { ...options, headers: { ...options.headers, Cookie: cookie, 'X-CSRF-Token': session.csrfToken } }); } });
    const patch = input(), changed = await client.updateProfession(event.id, video.id, patch);
    assert.equal(changed.video.revision, 1);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], path); assert.equal(calls[0][1].method, 'PATCH');
    assert.deepEqual(await client.updateProfession(event.id, video.id, patch), changed);
    await assert.rejects(client.updateProfession(event.id, video.id, input()), { code: 'REVISION_CONFLICT' });
    assert.equal((await authed(base + `/api/events/${event.id}/videos`)).status, 200);
  } finally { await new Promise(r => server.close(r)); (await repo.close()); }
});
