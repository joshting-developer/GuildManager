import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';
import { taipeiToday } from '../../src/domain/battle-events.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

const video = (event, extra = {}) => ({ name: '=長名稱', professionId: 3,
  firstUrl: 'https://example.com/first', secondUrl: 'https://example.com/second',
  groupName: '進攻二', note: '備註\n第二行', eventRevision: event.revision,
  requestId: crypto.randomUUID(), ...extra });
async function localFixture() {
  const repo = await createTestRepository({ });
  const events = await Promise.all([['過去', 'scrimmage', '2020-01-01'], ['今天', 'guild_war', taipeiToday()],
    ['未來', 'dragon_tiger', '2099-01-01'], ['活動', 'activity', taipeiToday()]].map(async ([title, type, date]) =>
    (await repo.createEvent({ title, type, dates: [date], requestId: type }))));
  (await repo.submitEventVideo(events[1].id, video(events[1])));
  (await repo.submitEventVideo(events[1].id, video(events[1], { name: '另一次提交' })));
  (await repo.submitEventVideo(events[0].id, video(events[0])));
  return { repo, events };
}

test('HTTP browser adapter performs one uncached read and retains management permissions and response checks', async () => {
  const { repo, events } = await localFixture(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const client = createEventVideoClient({ fetchImpl: (path, init) => { calls.push(path); return authed(base + path, init); } });
    assert.equal((await client.getBrowser(events[0].id)).selected.eventId, events[0].id);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('/api/videos/browser?eventId='));
    const choices = await client.getChoices();
    assert.equal(choices.events.length, 3);
    assert.equal(choices.hasMore, false);
    assert.equal((await fetch(base + '/api/videos/choices')).status, 200);
    assert.deepEqual(await client.getVideos(events[1].id), (await repo.listEventVideos(events[1].id)));
    assert.equal((await fetch(base + '/api/videos/browser')).status, 200);
    const admin = (await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }))).user;
    await (await repo.setMemberToken(admin.id, { password: '001234', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: '001234' }));
    assert.equal((await fetch(base + '/api/videos/browser', { headers: { Cookie: `guild_session=${member.token}` } })).status, 200);
    assert.equal((await fetch(base + '/api/videos/choices', { headers: { Cookie: `guild_session=${member.token}` } })).status, 200);
    const response = await authed(base + '/api/videos/browser');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await authed(base + '/api/videos/browser?eventId=' + 'x'.repeat(129))).status, 422);
    for (const malformed of [{}, { events: [], selected: {} }, { events: [events[1]], selected: null },
      { events: [events[1]], selected: { eventId: events[1].id, eventRevision: 1, videos: [{ id: 'invalid' }] } }]) {
      const bad = createEventVideoClient({ fetchImpl: async () => ({ ok: true, json: async () => malformed }) });
      await assert.rejects(bad.getBrowser());
    }
  } finally { await new Promise(resolve => server.close(resolve)); (await repo.close()); }
});
