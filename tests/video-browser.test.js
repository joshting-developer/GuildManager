import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventVideoClient } from '../src/api/event-videos.js';
import { isBattleEvent, orderBattleEvents, taipeiToday } from '../src/domain/battle-events.js';
import { videoTableCsv } from '../src/domain/video-table-csv.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
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

async function fixture() {
  const env = await gasRuntime(); env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = [], ctx = context) => cloudResult(env.raw(op, args, ctx));
  call('setMemberToken', [{ password: '001234', revision: 0 }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: '001234' }])));
  call('createManager', [{ username: 'manager', password: 'manager-password' }]);
  const manager = cloudSession(cloudResult(env.raw('login', [{ username: 'manager', password: 'manager-password' }])));
  const events = [['過去', 'scrimmage', '2020-01-01'], ['今天', 'guild_war', taipeiToday()],
    ['未來', 'dragon_tiger', '2099-01-01'], ['活動', 'activity', taipeiToday()]].map(([title, type, date]) => {
    const r = call('createEvent', [{ title, type, dates: [date], requestId: type }]); return r.event || r.events[0];
  });
  for (const event of events.slice(0, 3)) call('submitEventVideo', [event.id, video(event)]);
  return { env, context, call, manager, member, events };
}

test('compiled GAS browser reuses events and commits, matches legacy results under writer lock and reads no unrelated tables', async t => {
  const { env, call, manager, member, events } = await fixture();
  let reads = [];
  for (const [name, sheet] of env.sheets) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => { const range = getRange(...args), values = range.getValues;
      range.getValues = () => { reads.push(name); return values(); }; return range; };
  }
  const legacyEvents = orderBattleEvents(call('getEvents').events.filter(isBattleEvent), { prefer: 'recent' });
  const legacySelected = call('getEventVideos', [events[1].id]), legacyReads = reads.length; reads = [];
  const before = JSON.stringify({ sheets: [...env.sheets].map(([n, s]) => [n, s.data]), properties: [...env.properties], files: [...env.files], fetches: env.fetches });
  env.lock.tryLock(); env.lock.tryLock = () => assert.fail('browser must be read-only');
  const result = call('getVideoBrowser', [null]), browserReads = reads.length;
  assert.deepEqual(result, { events: legacyEvents, selected: legacySelected });
  assert.ok(reads.every(name => ['GM_commits', 'GM_events', 'GM_videos'].includes(name)), reads.join(','));
  assert.ok(browserReads < legacyReads);
  assert.equal(call('getVideoBrowser', [events[0].id], manager).selected.eventId, events[0].id);
  assert.equal(env.raw('getVideoBrowser', [null]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getVideoBrowser', [null], member).error.code, 'MANAGEMENT_REQUIRED');
  let success; const googleRun = { withSuccessHandler(fn) { success = fn; return this; }, withFailureHandler() { return this; },
    getVideoBrowser(id) { success(env.raw('getVideoBrowser', [id], manager)); } };
  assert.deepEqual(await createEventVideoClient({ source: 'gas', googleRun }).getBrowser(events[0].id), call('getVideoBrowser', [events[0].id]));
  assert.equal(JSON.stringify({ sheets: [...env.sheets].map(([n, s]) => [n, s.data]), properties: [...env.properties], files: [...env.files], fetches: env.fetches }), before);
  t.diagnostic(JSON.stringify({ legacySheetsReads: legacyReads, browserSheetsReads: browserReads }));
});

test('compiled GAS browser handles empty selection and serializes optional-table creation only after management validation', async () => {
  const empty = await gasRuntime(); empty.setup();
  const ctx = cloudSession(cloudResult(empty.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  empty.sheets.delete('GM_videos');
  assert.deepEqual(cloudResult(empty.raw('getVideoBrowser', [null], ctx)), { events: [], selected: null });
  assert.equal(empty.sheets.has('GM_videos'), false);
  const { env, call, context, member, events } = await fixture();
  env.sheets.delete('GM_videos');
  assert.equal(env.raw('getVideoBrowser', [null]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getVideoBrowser', [null], member).error.code, 'MANAGEMENT_REQUIRED');
  assert.equal(env.sheets.has('GM_videos'), false);
  assert.deepEqual(call('getVideoBrowser', [null]).selected.videos, []);
  assert.equal(env.sheets.has('GM_videos'), true);
  assert.equal(env.raw('getVideoBrowser', [{}], context).error.code, 'VIDEO_INVALID');
  call('deleteEvent', [events[1].id, 1]);
  assert.notEqual(call('getVideoBrowser', [events[1].id]).selected.eventId, events[1].id);
  assert.equal(env.raw('getEventVideos', [events[1].id], context).ok, false);
});
