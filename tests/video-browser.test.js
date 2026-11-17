import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventVideoClient } from '../src/api/event-videos.js';
import { isBattleEvent, orderBattleEvents, taipeiToday } from '../src/domain/battle-events.js';
import { videoTableCsv } from '../src/domain/video-table-csv.js';

import { authenticatedFetch } from './helpers/authenticated-fetch.js';

const video = (event, extra = {}) => ({ name: '=長名稱', professionId: 3,
  firstUrl: 'https://example.com/first', secondUrl: 'https://example.com/second',
  groupName: '進攻二', note: '備註\n第二行', eventRevision: event.revision,
  requestId: crypto.randomUUID(), ...extra });
function localFixture() {
  const repo = createRepository({ filename: ':memory:' });
  const events = [['過去', 'scrimmage', '2020-01-01'], ['今天', 'guild_war', taipeiToday()],
    ['未來', 'dragon_tiger', '2099-01-01'], ['活動', 'activity', taipeiToday()]].map(([title, type, date]) =>
    repo.createEvent({ title, type, dates: [date], requestId: type }));
  repo.submitEventVideo(events[1].id, video(events[1]));
  repo.submitEventVideo(events[1].id, video(events[1], { name: '另一次提交' }));
  repo.submitEventVideo(events[0].id, video(events[0]));
  return { repo, events };
}

test('SQLite browser returns the same sorted choices and selected videos as legacy reads, including CSV, without stale reloads', () => {
  const { repo, events } = localFixture();
  try {
    const oldEvents = orderBattleEvents(repo.listEvents().events.filter(isBattleEvent), { prefer: 'recent' });
    const result = repo.getVideoBrowser();
    assert.deepEqual(result.events, oldEvents);
    assert.equal(result.selected.eventId, events[1].id);
    assert.deepEqual(result.selected, repo.listEventVideos(events[1].id));
    assert.equal(videoTableCsv(result.selected.videos), videoTableCsv(repo.listEventVideos(events[1].id).videos));
    assert.equal(repo.getVideoBrowser(events[0].id).selected.eventId, events[0].id);
    repo.updateEvent(events[0].id, { ...events[0], title: '新名稱', revision: 1 });
    assert.equal(repo.getVideoBrowser(events[0].id).events.find(e => e.id === events[0].id).title, '新名稱');
    repo.deleteEvent(events[0].id, 2);
    assert.equal(repo.getVideoBrowser(events[0].id).selected.eventId, events[1].id);
    assert.throws(() => repo.getVideoBrowser({}), { code: 'VIDEO_INVALID' });
    assert.throws(() => repo.getVideoBrowser('x'.repeat(129)), { code: 'VIDEO_INVALID' });
  } finally { repo.close(); }
});

test('empty or future-only browser uses the previous picker rule without reading an unavailable event', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    assert.deepEqual(repo.getVideoBrowser(), { events: [], selected: null });
    repo.createEvent({ type: 'activity', title: '活動', dates: ['2099-01-01'], requestId: 'activity' });
    assert.deepEqual(repo.getVideoBrowser('removed'), { events: [], selected: null });
    const future = repo.createEvent({ type: 'scrimmage', title: '未來', dates: ['2099-01-01'], requestId: 'future' });
    assert.equal(repo.getVideoBrowser().selected.eventId, future.id);
    assert.deepEqual(repo.getVideoBrowser().selected.videos, []);
  } finally { repo.close(); }
});

test('HTTP browser adapter performs one uncached read and retains management permissions and response checks', async () => {
  const { repo, events } = localFixture(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const client = createEventVideoClient({ fetchImpl: (path, init) => { calls.push(path); return authed(base + path, init); } });
    assert.equal((await client.getBrowser(events[0].id)).selected.eventId, events[0].id);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('/api/videos/browser?eventId='));
    assert.deepEqual(await client.getVideos(events[1].id), repo.listEventVideos(events[1].id));
    assert.equal((await fetch(base + '/api/videos/browser')).status, 401);
    const admin = (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' })).user;
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    const member = await repo.authenticateMember({ password: '001234' });
    assert.equal((await fetch(base + '/api/videos/browser', { headers: { Cookie: `guild_session=${member.token}` } })).status, 403);
    const response = await authed(base + '/api/videos/browser');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await authed(base + '/api/videos/browser?eventId=' + 'x'.repeat(129))).status, 422);
    for (const malformed of [{}, { events: [], selected: {} }, { events: [events[1]], selected: null },
      { events: [events[1]], selected: { eventId: events[1].id, eventRevision: 1, videos: [{ id: 'invalid' }] } }]) {
      const bad = createEventVideoClient({ fetchImpl: async () => ({ ok: true, json: async () => malformed }) });
      await assert.rejects(bad.getBrowser());
    }
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});
