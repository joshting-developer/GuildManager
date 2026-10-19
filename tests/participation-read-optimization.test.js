import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventClient } from '../src/api/events.js';
import { createParticipationClient } from '../src/api/participation.js';
import { createSheetStore } from '../gas/src/storage.js';
import { createCatalog } from '../gas/src/members-events.js';
import { createParticipation } from '../gas/src/participation.js';
import { canonical, hash } from '../gas/src/common.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

test('local combined form preserves legacy data, public access and revision/retry checks', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [];
  const fetchImpl = (url, options) => {
    requests.push(url);
    return fetch(base + url, options);
  };
  const client = createParticipationClient({ fetchImpl });
  const events = createEventClient({ fetchImpl });
  try {
    repo.addMember({ uid: 'guild', name: '測試成員', primaryProfessionId: 1, isInGuild: true });
    repo.addMember({ uid: 'outside', name: '編外', primaryProfessionId: 2, isInGuild: false, isInClub: false });
    for (const type of ['scrimmage', 'guild_war', 'dragon_tiger']) {
      const event = repo.createEvent({ title: '測試', type, dates: ['2026-10-19'], requestId: type });
      requests.length = 0;
      const form = await client.getForm(event.id);
      assert.deepEqual(requests, [`/api/events/${event.id}/participation-form`]);
      assert.deepEqual(form, {
        ...await client.getParticipation(event.id),
        ...await client.getMembers(event.id),
        ...repo.listProfessions(),
      });
      assert.deepEqual(form.members.map((m) => m.uid), ['guild']);
      assert.equal(form.professions.length, 9);
      assert.deepEqual(await events.getEvent(event.id), { event });
      const input = { name: '測試成員', memberUid: 'guild', status: 'registered', professionId: 3,
        note: '', revision: form.revision, requestId: 'submit-' + type };
      const receipt = await client.submitParticipation(event.id, input);
      assert.deepEqual(await client.submitParticipation(event.id, input), receipt);
      await assert.rejects(client.submitParticipation(event.id, { ...input, requestId: 'stale-' + type }),
        (error) => error.code === 'PARTICIPATION_CHANGED');
      repo.deleteEvent(event.id, event.revision);
      await assert.rejects(events.getEvent(event.id), (error) => error.code === 'EVENT_NOT_FOUND');
      await assert.rejects(client.getForm(event.id));
    }
    const activity = repo.createEvent({ title: '一般活動', type: 'activity', dates: ['2026-10-20', '2026-10-21'], requestId: 'activity' });
    assert.deepEqual(await events.getEvent(activity.id), { event: activity });
    await assert.rejects(client.getForm(activity.id));
    await assert.rejects(events.getEvent('missing'), (error) => error.code === 'EVENT_NOT_FOUND');
    for (const path of ['/api/members', `/api/events/${activity.id}/attendance`, '/api/lineups'])
      assert.equal((await fetch(base + path)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});

test('GAS combined form uses one transaction and fewer Sheets reads, retaining legacy responses and write guards', async () => {
  const env = await gasRuntime();
  env.setup();
  const storage = createSheetStore(env);
  const stamp = '2026-10-19T00:00:00.000Z';
  storage.transaction((store) => {
    store.put('events', 'event', { id: 'event', title: '', type: 'guild_war', dates: ['2026-10-19'], revision: 1, createdAt: stamp });
    for (let i = 0; i < 30; i++) {
      store.put('members', 'u' + i, { uid: 'u' + i, name: '成員' + i, primaryProfessionId: 1, isInGuild: true, isInClub: i % 2 === 0 });
      store.put('responses', canonical(['event', 'u' + i]), { eventId: 'event', uid: 'u' + i, status: i % 2 ? 'leave' : 'registered', revision: 1 });
      store.put('registrations', 'g' + i, { id: 'g' + i, eventId: 'event', name: '外援' + i, professionId: 3, active: i % 2 === 0, revision: 1, createdAt: stamp, updatedAt: stamp });
    }
  });
  let reads = 0;
  for (const sheet of env.sheets.values()) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = getRange(...args), values = range.getValues;
      range.getValues = () => (reads++, values());
      return range;
    };
  }
  const old = {
    ...cloudResult(env.raw('getEventParticipation', ['event'])),
    ...cloudResult(env.raw('getEventParticipationMembers', ['event'])),
    ...cloudResult(env.raw('getProfessions')),
  };
  const separateReads = reads;
  reads = 0;
  const form = cloudResult(env.raw('getEventParticipationForm', ['event']));
  assert.deepEqual(form, old);
  assert.ok(reads < separateReads, `${reads} combined reads must be below ${separateReads} separate reads`);
  assert.ok(reads <= 7, `combined form used ${reads} Sheets reads`);
  assert.equal(form.members.length, 30);
  assert.equal(form.responses.length, 30);
  assert.equal(form.registrations.length, 15);
  assert.equal(form.registrationLeaves.length, 15);
  const event = cloudResult(env.raw('getEvent', ['event'])).event;
  assert.equal(event.id, 'event');
  assert.equal(event.deletedAt, undefined);
  const input = { name: '成員0', memberUid: 'u0', status: 'registered', professionId: 4,
    note: '', revision: form.revision, requestId: 'form-submit' };
  const saved = cloudResult(env.raw('submitParticipation', ['event', input]));
  assert.deepEqual(cloudResult(env.raw('submitParticipation', ['event', input])), saved);
  assert.equal(env.raw('submitParticipation', ['event', { ...input, requestId: 'stale' }]).error.code, 'PARTICIPATION_CHANGED');
  assert.equal(env.raw('submitParticipation', ['event', { ...input, requestId: 'csrf' }], { sessionToken: 'invalid' }).ok, false);
  assert.equal(env.raw('getEventAttendance', ['event']).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getMembers').error.code, 'AUTH_REQUIRED');
  const admin = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  cloudResult(env.raw('setMemberToken', [{ password: 'Member123', revision: 0 }], admin));
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  assert.deepEqual(cloudResult(env.raw('getEventParticipationForm', ['event'], member)), cloudResult(env.raw('getEventParticipationForm', ['event'], admin)));
  assert.equal(env.raw('submitParticipation', ['event', input], { sessionToken: member.sessionToken }).error.code, 'CSRF_INVALID');
  storage.transaction((store) => store.put('events', 'event', { ...event, type: 'activity', revision: 2 }));
  assert.equal(env.raw('getEventParticipationForm', ['event']).error.code, 'EVENT_INVALID');
  assert.equal(cloudResult(env.raw('getEvent', ['event'])).event.type, 'activity');
  storage.transaction((store) => store.put('events', 'event', { ...event, deletedAt: stamp }));
  for (const op of ['getEvent', 'getEventParticipationForm'])
    assert.equal(env.raw(op, ['event']).error.code, 'EVENT_NOT_FOUND');
});

test('GAS participation reuses each table once and preserves revision and same-name leave semantics', async () => {
  const env = await gasRuntime();
  env.setup();
  const storage = createSheetStore(env);
  const event = { id: 'event', type: 'scrimmage', title: '測試', dates: ['2026-10-19'], revision: 4 };
  const guests = [
    { id: 'a', name: 'Guest', active: true },
    { id: 'b', name: 'gUeSt', active: false },
    { id: 'c', name: '取消外援', active: false },
  ].map((row) => ({ ...row, eventId: 'event', professionId: 1, revision: 2, createdAt: '2026-10-19', updatedAt: '2026-10-19' }));
  storage.transaction((store) => {
    store.put('events', event.id, event);
    for (const row of guests) store.put('registrations', row.id, row);
  });
  storage.transaction((store) => {
    const calls = new Map();
    const measured = { ...store, all(table) { calls.set(table, (calls.get(table) || 0) + 1); return store.all(table); } };
    const options = { uuid: () => crypto.randomUUID(), now: () => '2026-10-19' };
    const catalog = createCatalog(measured, options);
    const result = createParticipation(measured, catalog, options).methods.getEventParticipation(['event']);
    assert.equal(calls.get('responses'), 1);
    assert.equal(calls.get('registrations'), 1);
    assert.deepEqual(result.registrations.map((row) => row.id), ['a']);
    assert.deepEqual(result.registrationLeaves.map((row) => row.id), ['c']);
    assert.equal(result.revision, hash(canonical([4, [], guests.map(({ id, revision }) => [id, revision])])));
  });
});

test('new adapters encode IDs, issue one GAS operation and propagate failures without HTTP fallback', async () => {
  const paths = [];
  const fetchImpl = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({}) };
  };
  await createEventClient({ fetchImpl }).getEvent('a/b');
  await createParticipationClient({ fetchImpl }).getForm('a/b');
  assert.deepEqual(paths, ['/api/events/a%2Fb', '/api/events/a%2Fb/participation-form']);
  let success, failure;
  const calls = [];
  const googleRun = {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler(fn) { failure = fn; return this; },
    getEvent(id) { calls.push(['getEvent', id]); success({ event: { id } }); },
    getEventParticipationForm(id) { calls.push(['form', id]); failure({ message: '讀取失敗' }); },
  };
  const options = { source: 'gas', googleRun, fetchImpl: () => assert.fail('no HTTP fallback') };
  assert.deepEqual(await createEventClient(options).getEvent('one'), { event: { id: 'one' } });
  await assert.rejects(createParticipationClient(options).getForm('one'), /讀取失敗/);
  assert.deepEqual(calls, [['getEvent', 'one'], ['form', 'one']]);
});
