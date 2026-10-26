import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createParticipationClient } from '../src/api/participation.js';
import { gasRuntime, cloudSession, cloudResult } from './helpers/gas-runtime.js';

const types = ['scrimmage', 'guild_war', 'dragon_tiger'];
const video = (event, extra = {}) => ({ name: '公開影片', professionId: 3,
  firstUrl: 'https://example.com/video', secondUrl: '', groupName: '進攻一', note: '',
  eventRevision: event.revision, requestId: crypto.randomUUID(), ...extra });
function seedLocal() {
  const repo = createRepository({ filename: ':memory:' });
  for (const [uid, isInGuild, isInClub] of [['guild', true, false], ['club', false, true], ['outside', false, false]])
    repo.addMember({ uid, name: uid, primaryProfessionId: 3, isInGuild, isInClub });
  const events = [...types, 'activity'].map(type => repo.createEvent({ title: type, type,
    dates: ['2026-10-01'], requestId: type }));
  repo.saveMemberResponse(events[0].id, { uid: 'guild', status: 'leave', note: '不應出現在影片表單', revision: 0 });
  repo.addGuestRegistration(events[0].id, { name: '外援', professionId: 3, requestId: 'guest' });
  return { repo, events };
}

test('video form preserves the legacy public roster and professions without returning participant responses or versions', () => {
  const { repo, events } = seedLocal();
  try {
    const old = repo.getEventParticipationForm(events[0].id);
    for (const event of events.slice(0, 3)) {
      const form = repo.getEventVideoForm(event.id);
      assert.deepEqual(Object.keys(form).sort(), ['event', 'eventId', 'members', 'professions']);
      assert.deepEqual(form.event, repo.getEvent(event.id).event);
      assert.deepEqual(form.members, old.members);
      assert.deepEqual(form.professions, old.professions);
      assert.deepEqual(form.members.map(row => row.uid).sort(), ['club', 'guild']);
    }
    assert.deepEqual(repo.getEventParticipationForm(events[0].id), old);
    assert.equal(old.responses[0].note, '不應出現在影片表單');
    repo.updateEvent(events[0].id, { ...events[0], title: '已修改', revision: events[0].revision });
    assert.equal(repo.getEventVideoForm(events[0].id).event.revision, 2);
    assert.throws(() => repo.getEventVideoForm(events[3].id));
    repo.deleteEvent(events[1].id, 1);
    assert.throws(() => repo.getEventVideoForm(events[1].id));
    assert.throws(() => repo.getEventVideoForm('missing'));
  } finally { repo.close(); }
});

test('video-form HTTP adapter makes one anonymous read; member access, CSRF and video request retries retain their rules', async () => {
  const { repo, events } = seedLocal(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const calls = [], client = createParticipationClient({ fetchImpl: (path, init) => { calls.push(path); return fetch(base + path, init); } });
    for (const event of events.slice(0, 3)) assert.equal((await client.getVideoForm(event.id)).eventId, event.id);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(path => path.endsWith('/video-form')));
    const admin = await repo.createAccount({ username: 'admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    const login = await fetch(base + '/api/auth/member-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '001234' }) });
    const member = await login.json();
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
    const get = await fetch(base + `/api/events/${events[0].id}/video-form`, { headers });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + `/api/events/${events[0].id}/videos`, { headers })).status, 403);
    const input = video(events[0]);
    const submit = (extra = {}) => fetch(base + `/api/events/${events[0].id}/videos`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(input) });
    assert.equal((await submit()).status, 403);
    const first = await submit({ 'X-CSRF-Token': member.csrfToken });
    assert.equal(first.status, 201);
    const saved = await first.json();
    assert.deepEqual(await (await submit({ 'X-CSRF-Token': member.csrfToken })).json(), saved);
    for (const id of [events[3].id, 'missing'])
      assert.ok((await fetch(base + `/api/events/${id}/video-form`)).status >= 400);
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});

async function cloudFixture() {
  const env = await gasRuntime(); env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  call('setMemberToken', [{ password: '001234', revision: 0 }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: '001234' }])));
  call('addMember', [{ uid: 'guild', name: '幫會成員', primaryProfessionId: 3, isInGuild: true, isInClub: false }]);
  call('addMember', [{ uid: 'club', name: '俱樂部成員', primaryProfessionId: 3, isInGuild: false, isInClub: true }]);
  const events = [...types, 'activity'].map(type => {
    const result = call('createEvent', [{ title: type, type, dates: ['2026-10-01'], requestId: type }]);
    return result.event || result.events[0];
  });
  call('saveMemberResponse', [events[0].id, { uid: 'guild', status: 'leave', note: '不應讀取', revision: 0 }]);
  call('addGuestRegistration', [events[0].id, { name: '外援', professionId: 3, requestId: 'guest' }]);
  return { env, context, member, call, events };
}

test('compiled GAS video-form reads only events, public members and professions while a writer holds the lock', async (t) => {
  const { env, context, member, call, events } = await cloudFixture();
  let reads = [];
  for (const [name, sheet] of env.sheets) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => { const range = getRange(...args), getValues = range.getValues;
      range.getValues = () => { reads.push(name); return getValues(); }; return range; };
  }
  const old = call('getEventParticipationForm', [events[0].id]);
  const oldReads = reads.length; reads = [];
  const before = JSON.stringify({ sheets: [...env.sheets].map(([name, sheet]) => [name, sheet.data]),
    properties: [...env.properties], files: [...env.files], notices: env.fetches });
  env.lock.tryLock(); env.lock.tryLock = () => assert.fail('video form must not acquire the writer lock');
  const form = cloudResult(env.raw('getEventVideoForm', [events[0].id]));
  const newReads = reads.length;
  assert.deepEqual(form.members, old.members); assert.deepEqual(form.professions, old.professions);
  assert.deepEqual(Object.keys(form).sort(), ['event', 'eventId', 'members', 'professions']);
  assert.ok(reads.every(name => ['GM_commits', 'GM_events', 'GM_members', 'GM_professions'].includes(name)), reads.join(','));
  assert.ok(newReads < oldReads);
  for (const ctx of [context, member]) assert.deepEqual(cloudResult(env.raw('getEventVideoForm', [events[0].id], ctx)), form);
  for (const event of events.slice(1, 3)) assert.equal(cloudResult(env.raw('getEventVideoForm', [event.id])).eventId, event.id);
  assert.equal(JSON.stringify({ sheets: [...env.sheets].map(([name, sheet]) => [name, sheet.data]),
    properties: [...env.properties], files: [...env.files], notices: env.fetches }), before);
  t.diagnostic(JSON.stringify({ participationFormSheetsReads: oldReads, videoFormSheetsReads: newReads }));
});

test('compiled GAS video form rejects unavailable events and retains revision, member, CSRF and requestId checks on writes', async () => {
  const { env, member, call, events } = await cloudFixture();
  for (const id of [events[3].id, 'missing']) assert.equal(env.raw('getEventVideoForm', [id]).ok, false);
  call('deleteEvent', [events[1].id, 1]);
  assert.equal(env.raw('getEventVideoForm', [events[1].id]).ok, false);
  const form = cloudResult(env.raw('getEventVideoForm', [events[0].id]));
  const input = video(form.event);
  assert.equal(env.raw('submitEventVideo', [events[0].id, input], { sessionToken: member.sessionToken }).error.code, 'CSRF_INVALID');
  const saved = cloudResult(env.raw('submitEventVideo', [events[0].id, input], member));
  assert.deepEqual(cloudResult(env.raw('submitEventVideo', [events[0].id, input], member)), saved);
  assert.equal(env.raw('submitEventVideo', [events[0].id, { ...input, name: '不同', requestId: input.requestId }], member).error.code, 'REQUEST_CONFLICT');
  call('updateEvent', [events[0].id, { ...events[0], title: '新名稱', revision: 1 }]);
  assert.equal(env.raw('submitEventVideo', [events[0].id, video(form.event)]).error.code, 'EVENT_CHANGED');
});
