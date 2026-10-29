import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventVideoClient } from '../src/api/event-videos.js';
import { videoTableCsv } from '../src/domain/video-table-csv.js';
import { validateVideoProfessionUpdate } from '../src/domain/event-videos.js';
import { createSheetStore } from '../gas/src/storage.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';

const submission = event => ({ name: '同名角色', professionId: 3, firstUrl: 'https://example.com/first',
  secondUrl: 'https://example.com/second', groupName: '進攻二', note: '長備註\n第二行',
  eventRevision: event.revision, requestId: crypto.randomUUID() });
const input = (extra = {}) => ({ professionId: 4, revision: 0, requestId: crypto.randomUUID(), ...extra });
const unchanged = ({ professionId, professionName, professionColorcode, revision, ...rest }) => rest;
function exercise({ get, update, submit, unavailable }, event, other, saved, uploaded) {
  const original = saved.video, sameName = submit(event.id, { ...uploaded, requestId: crypto.randomUUID() }).video;
  const patch = input();
  const changed = update(event.id, original.id, patch).video;
  assert.equal(changed.professionId, 4);
  assert.equal(changed.revision, 1);
  assert.deepEqual(unchanged(changed), unchanged(original));
  assert.ok(changed.professionName && changed.professionColorcode);
  assert.equal(get(event.id).videos.find(row => row.id === sameName.id).professionId, 3);
  assert.deepEqual(update(event.id, original.id, patch).video, changed);
  assert.deepEqual(submit(event.id, uploaded), saved); // Original upload receipt does not revert correction.
  assert.deepEqual(get(event.id).videos.find(row => row.id === original.id), changed);
  assert.ok(videoTableCsv([changed]).includes(changed.professionName));
  assert.throws(() => update(event.id, original.id, { ...patch, professionId: 5 }), { code: 'REQUEST_CONFLICT' });
  assert.throws(() => update(event.id, original.id, input()), { code: 'REVISION_CONFLICT' });
  assert.throws(() => update(other.id, original.id, input()), { code: 'VIDEO_NOT_FOUND' });
  assert.throws(() => update(event.id, 'missing', input()), { code: 'VIDEO_NOT_FOUND' });
  for (const bad of [{ professionId: 999 }, { professionId: '4' }, { professionId: null }, { revision: -1 },
    { revision: 0.5 }, { requestId: '' }, { requestId: 'bad:id' }, { note: 'not editable' }, { firstUrl: 'https://example.com/overwrite' }])
    assert.throws(() => update(event.id, original.id, input({ revision: 1, ...bad })), { code: 'VIDEO_INVALID' });
  const second = update(event.id, original.id, input({ professionId: 5, revision: 1 })).video;
  assert.equal(second.revision, 2);
  assert.deepEqual(unchanged(second), unchanged(original));
  unavailable(event);
  assert.throws(() => update(event.id, original.id, input({ revision: 2 })), { code: 'EVENT_UNAVAILABLE' });
}

test('SQLite profession corrections preserve duplicate submissions, metadata and receipts, require a per-video revision and survive restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-video-edit-')), filename = join(dir, 'isolated.sqlite');
  let repo = createRepository({ filename });
  try {
    const events = ['scrimmage', 'guild_war', 'dragon_tiger'].map(type => repo.createEvent({ type, title: type, dates: ['2026-10-01'], requestId: type }));
    const other = repo.createEvent({ type: 'scrimmage', title: '其他', dates: ['2026-10-03'], requestId: 'other' });
    for (const event of events) {
      const uploaded = submission(event), saved = repo.submitEventVideo(event.id, uploaded);
      exercise({ get: id => repo.listEventVideos(id), update: (...args) => repo.updateEventVideoProfession(...args),
        submit: (...args) => repo.submitEventVideo(...args), unavailable: e => repo.deleteEvent(e.id, e.revision) },
      event, other, saved, uploaded);
    }
    const extra = repo.createEvent({ type: 'scrimmage', title: '重啟', dates: ['2026-10-02'], requestId: 'restart' });
    const video = repo.submitEventVideo(extra.id, submission(extra)).video, patch = input();
    const result = repo.updateEventVideoProfession(extra.id, video.id, patch);
    repo.close(); repo = createRepository({ filename });
    assert.deepEqual(repo.updateEventVideoProfession(extra.id, video.id, patch), result);
    assert.deepEqual(repo.listEventVideos(extra.id).videos[0], result.video);
  } finally { repo.close(); rmSync(dir, { recursive: true }); }
});

test('SQLite legacy links can receive explicit profession corrections and receipt failures roll back without changing old rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-video-legacy-')), filename = join(dir, 'isolated.sqlite');
  let repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    const event = repo.createEvent({ type: 'scrimmage', title: '舊場次', dates: ['2020-01-01'], requestId: 'legacy-event' });
    db.prepare('INSERT INTO event_videos(id,event_id,round_number,name,url,group_name,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('legacy', event.id, 2, '舊影片', 'https://example.com/legacy', '防守團', '2020-01-01T01:00:00Z');
    const before = repo.listEventVideos(event.id).videos[0];
    assert.equal(before.professionId, null); assert.equal(before.revision, 0);
    db.exec("CREATE TRIGGER fail_edit_receipt BEFORE INSERT ON event_video_profession_requests BEGIN SELECT RAISE(ABORT,'isolated failure'); END");
    const patch = input();
    assert.throws(() => repo.updateEventVideoProfession(event.id, 'legacy', patch));
    assert.deepEqual(repo.listEventVideos(event.id).videos[0], before);
    db.exec('DROP TRIGGER fail_edit_receipt');
    const result = repo.updateEventVideoProfession(event.id, 'legacy', patch);
    assert.deepEqual(unchanged(result.video), unchanged(before));
    assert.deepEqual(repo.updateEventVideoProfession(event.id, 'legacy', patch), result);
    repo.close(); repo = createRepository({ filename });
    assert.deepEqual(repo.listEventVideos(event.id).videos[0], result.video);
  } finally { db.close(); repo.close(); rmSync(dir, { recursive: true }); }
});

test('HTTP profession editing is management-only, requires CSRF and adapter PATCH returns only the affected video', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const event = repo.createEvent({ type: 'scrimmage', title: 'HTTP', dates: ['2020-01-01'], requestId: 'http' });
  const video = repo.submitEventVideo(event.id, submission(event)).video;
  const server = createApp(repo).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const admin = await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.user.id, { password: '001234', revision: 0 });
    const member = await repo.authenticateMember({ password: '001234' });
    const path = `/api/events/${event.id}/videos/${video.id}/profession`, body = JSON.stringify(input());
    const request = cookie => fetch(base + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `guild_session=${cookie}` } : {}) }, body });
    assert.equal((await request()).status, 401);
    assert.equal((await request(member.token)).status, 403);
    assert.equal((await request(admin.token)).status, 403);
    await repo.createManager(admin.user.id, { username: 'manager', password: 'manager-password' });
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'manager', password: 'manager-password' }) });
    const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
    const client = createEventVideoClient({ fetchImpl: (url, options) => { calls.push([url, options]); return fetch(base + url, { ...options, headers: { ...options.headers, Cookie: cookie, 'X-CSRF-Token': session.csrfToken } }); } });
    const patch = input(), changed = await client.updateProfession(event.id, video.id, patch);
    assert.equal(changed.video.revision, 1);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], path); assert.equal(calls[0][1].method, 'PATCH');
    assert.deepEqual(await client.updateProfession(event.id, video.id, patch), changed);
    await assert.rejects(client.updateProfession(event.id, video.id, input()), { code: 'REVISION_CONFLICT' });
    assert.equal((await authed(base + `/api/events/${event.id}/videos`)).status, 200);
  } finally { await new Promise(r => server.close(r)); repo.close(); }
});

async function cloudFixture() {
  const env = await gasRuntime(); env.setup();
  const session = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])), context = cloudSession(session);
  const call = (operation, args = [], ctx = context) => cloudResult(env.raw(operation, args, ctx));
  return { env, session, context, call };
}

test('compiled GAS corrections keep receipts atomic and preserve old missing professions, histories and original upload retry behavior', async () => {
  const { env, call, context } = await cloudFixture();
  const event = call('createEvent', [{ type: 'scrimmage', title: 'GAS', dates: ['2020-01-01'], requestId: 'gas' }]).event;
  const other = call('createEvent', [{ type: 'scrimmage', title: '其他', dates: ['2020-01-01'], requestId: 'other' }]).event;
  const uploaded = submission(event), saved = call('submitEventVideo', [event.id, uploaded]);
  const storage = createSheetStore(env);
  const old = { ...saved.video, id: 'legacy' }; delete old.revision; delete old.professionId; delete old.professionName; delete old.professionColorcode;
  storage.transaction(s => s.put('videos', 'legacy', old));
  assert.equal(call('getEventVideos', [event.id]).videos.find(v => v.id === 'legacy').revision, 0);
  const patch = input();
  env.failOn('GM_commits');
  assert.equal(env.raw('updateEventVideoProfession', [event.id, 'legacy', patch], context).ok, false);
  env.failOn(null);
  assert.equal(call('getEventVideos', [event.id]).videos.find(v => v.id === 'legacy').professionId, undefined);
  const changed = call('updateEventVideoProfession', [event.id, 'legacy', patch]).video;
  assert.deepEqual(unchanged(changed), unchanged(old));
  assert.deepEqual(call('updateEventVideoProfession', [event.id, 'legacy', patch]).video, changed);
  assert.ok(env.sheets.get('GM_videos').data.length > 3); // Append history retained; failed rows invisible.
  exercise({ get: id => call('getEventVideos', [id]), update: (...args) => call('updateEventVideoProfession', args),
    submit: (...args) => call('submitEventVideo', args), unavailable: e => call('deleteEvent', [e.id, e.revision]) }, event, other, saved, uploaded);
});

test('compiled GAS profession writes retain lock, management, CSRF and scoped table dependencies; adapter never falls back to HTTP', async () => {
  const { env, call, context } = await cloudFixture();
  const event = call('createEvent', [{ type: 'scrimmage', title: '權限', dates: ['2020-01-01'], requestId: 'event' }]).event;
  const video = call('submitEventVideo', [event.id, submission(event)]).video;
  call('setMemberToken', [{ password: '001234', revision: 0 }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: '001234' }])));
  call('createManager', [{ username: 'manager', password: 'manager-password' }]);
  const manager = cloudSession(cloudResult(env.raw('login', [{ username: 'manager', password: 'manager-password' }])));
  const patch = input();
  assert.equal(env.raw('updateEventVideoProfession', [event.id, video.id, patch]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('updateEventVideoProfession', [event.id, video.id, patch], member).error.code, 'MANAGEMENT_REQUIRED');
  assert.equal(env.raw('updateEventVideoProfession', [event.id, video.id, patch], { sessionToken: context.sessionToken }).error.code, 'CSRF_INVALID');
  env.lock.tryLock();
  assert.equal(env.raw('updateEventVideoProfession', [event.id, video.id, patch], context).error.code, 'BUSY');
  env.lock.releaseLock();
  const accessed = new Set();
  for (const [name, sheet] of env.sheets) { const getRange = sheet.getRange.bind(sheet); sheet.getRange = (...args) => { accessed.add(name); return getRange(...args); }; }
  let handler; const run = { withSuccessHandler(fn) { handler = fn; return this; }, withFailureHandler() { return this; },
    updateEventVideoProfession(eventId, id, values) { handler(env.raw('updateEventVideoProfession', [eventId, id, values], manager)); } };
  const client = createEventVideoClient({ source: 'gas', googleRun: run, fetchImpl: () => assert.fail('no HTTP fallback') });
  const filesBefore = env.files.size, requestsBefore = env.fetches.length;
  assert.equal((await client.updateProfession(event.id, video.id, patch)).video.revision, 1);
  assert.ok([...accessed].every(name => ['GM_commits', 'GM_requests', 'GM_events', 'GM_videos', 'GM_professions'].includes(name)), [...accessed].join(','));
  assert.equal(env.files.size, filesBefore); assert.equal(env.fetches.length, requestsBefore);
  assert.throws(() => validateVideoProfessionUpdate(event.id, video.id, []), { code: 'VIDEO_INVALID' });
  const valid = call('getEventVideos', [event.id]).videos[0];
  for (const malformed of [null, { ...valid, revision: 99 }, { ...valid, id: 'wrong' }, { ...valid, professionId: 5 }]) {
    const bad = createEventVideoClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ video: malformed }) }) });
    await assert.rejects(bad.updateProfession(event.id, video.id, patch));
  }
});
