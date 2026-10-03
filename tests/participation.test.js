import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createParticipationClient } from '../src/api/participation.js';

function setup(filename = ':memory:') {
  const repo = createRepository({ filename });
  repo.addMember({
    uid: '001',
    name: '成員',
    primaryProfessionId: 1,
    isInGuild: true,
    isInClub: true,
  });
  const event = repo.createEvent({
    title: '約戰',
    type: 'scrimmage',
    dates: ['2026-10-24'],
    requestId: 'event',
  });
  const other = repo.createEvent({
    title: '',
    type: 'guild_war',
    dates: ['2026-10-25'],
    requestId: 'other',
  });
  return { repo, event, other };
}
const code = (value) => (error) => error.code === value;
const guest = (extra = {}) => ({
  name: '來支援的人',
  professionId: 3,
  note: '可以打第二場',
  requestId: 'guest',
  ...extra,
});

test('responses are scoped to one battle, retain revisions and allow retry, switch and cancellation', () => {
  const { repo, event, other } = setup();
  try {
    const input = { uid: '001', status: 'leave', note: '當天不在', revision: 0 };
    const saved = repo.saveMemberResponse(event.id, input);
    assert.deepEqual(repo.saveMemberResponse(event.id, input), saved);
    assert.equal(repo.getEventParticipation(other.id).responses.length, 0);
    assert.throws(
      () => repo.saveMemberResponse(event.id, { ...input, status: 'registered' }),
      code('PARTICIPATION_CHANGED'),
    );
    const registered = repo.saveMemberResponse(event.id, {
      ...input,
      status: 'registered',
      revision: saved.revision,
    });
    const cancelled = repo.saveMemberResponse(event.id, {
      ...input,
      status: 'none',
      revision: registered.revision,
    });
    assert.equal(cancelled.revision, 3);
    assert.equal(cancelled.status, 'none');
    assert.throws(
      () => repo.saveMemberResponse(event.id, { ...input, uid: 'missing' }),
      code('MEMBER_NOT_FOUND'),
    );
    assert.throws(
      () => repo.saveMemberResponse(event.id, { ...input, revision: -1 }),
      code('PARTICIPATION_INVALID'),
    );
    assert.throws(
      () => repo.saveMemberResponse(event.id, { ...input, status: 'fake' }),
      code('PARTICIPATION_INVALID'),
    );
  } finally {
    repo.close();
  }
});

test('UID-less guests have stable IDs, explicit professions and notes; retries and duplicate names do not add rows', () => {
  const { repo, event, other } = setup();
  try {
    const first = repo.addGuestRegistration(event.id, guest());
    assert.ok(first.id);
    assert.equal(first.uid, undefined);
    assert.equal(first.profession, '碎夢');
    assert.equal(first.note, '可以打第二場');
    assert.deepEqual(repo.addGuestRegistration(event.id, guest()), first);
    assert.throws(
      () => repo.addGuestRegistration(event.id, guest({ name: '另一個人' })),
      code('REQUEST_CONFLICT'),
    );
    assert.throws(
      () => repo.addGuestRegistration(event.id, guest({ requestId: 'repeat' })),
      code('REGISTRATION_EXISTS'),
    );
    assert.throws(
      () => repo.addGuestRegistration(event.id, guest({ requestId: 'invalid', professionId: 99 })),
      code('PARTICIPATION_INVALID'),
    );
    assert.throws(
      () => repo.addGuestRegistration(event.id, guest({ requestId: 'invalid', name: ' ' })),
      code('PARTICIPATION_INVALID'),
    );
    assert.equal(repo.getEventParticipation(event.id).registrations.length, 1);
    assert.equal(repo.listMembers().members.length, 1);
    assert.throws(
      () => repo.cancelGuestRegistration(other.id, first.id, first.revision),
      code('REGISTRATION_NOT_FOUND'),
    );
    const cancelled = repo.cancelGuestRegistration(event.id, first.id, first.revision);
    assert.equal(cancelled.active, false);
    assert.deepEqual(repo.cancelGuestRegistration(event.id, first.id, first.revision), cancelled);
    assert.equal(repo.getEventParticipation(event.id).registrations.length, 0);
    assert.ok(repo.addGuestRegistration(event.id, guest({ requestId: 're-register' })).active);
  } finally {
    repo.close();
  }
});

test('ordinary, deleted and missing events reject participation while valid responses persist after restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guild-participation-'));
  const filename = join(folder, 'test.sqlite');
  let { repo, event } = setup(filename);
  try {
    const ordinary = repo.createEvent({
      title: '活動',
      type: 'activity',
      dates: ['2026-10-24'],
      requestId: 'ordinary',
    });
    assert.throws(() => repo.getEventParticipation(ordinary.id), code('EVENT_UNAVAILABLE'));
    assert.throws(() => repo.addGuestRegistration('missing', guest()), code('EVENT_UNAVAILABLE'));
    repo.saveMemberResponse(event.id, { uid: '001', status: 'leave', note: '', revision: 0 });
    const registration = repo.addGuestRegistration(event.id, guest());
    const before = repo.getEventParticipation(event.id);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.getEventParticipation(event.id), before);
    repo.deleteEvent(event.id, event.revision);
    assert.throws(() => repo.getEventParticipation(event.id), code('EVENT_UNAVAILABLE'));
    assert.throws(
      () => repo.cancelGuestRegistration(event.id, registration.id, 1),
      code('EVENT_UNAVAILABLE'),
    );
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('HTTP adapter performs responses, guests and cancellation, and surfaces validation/conflict failures', async () => {
  const { repo, event } = setup();
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createParticipationClient({
    fetchImpl: (path, options) => fetch(`${base}${path}`, options),
  });
  try {
    assert.equal((await client.getParticipation(event.id)).eventId, event.id);
    const saved = await client.saveResponse(event.id, {
      uid: '001',
      status: 'leave',
      note: '',
      revision: 0,
    });
    assert.equal(saved.response.status, 'leave');
    const result = await client.registerGuest(event.id, guest());
    await assert.rejects(
      client.registerGuest(event.id, guest({ requestId: 'duplicate' })),
      code('REGISTRATION_EXISTS'),
    );
    await assert.rejects(
      client.registerGuest(event.id, guest({ requestId: 'invalid', professionId: 100 })),
      code('PARTICIPATION_INVALID'),
    );
    assert.equal(
      (await client.cancelGuest(event.id, result.registration.id, 1)).registration.active,
      false,
    );
    await assert.rejects(client.getParticipation('missing'), code('EVENT_UNAVAILABLE'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});

test('GAS participation preserves all arguments, propagates failures and never falls back to HTTP', async () => {
  const calls = [];
  let success, failure;
  const run = {
    withSuccessHandler(callback) {
      success = callback;
      return this;
    },
    withFailureHandler(callback) {
      failure = callback;
      return this;
    },
    getEventParticipation(...args) {
      calls.push(['get', ...args]);
      success({ responses: [] });
    },
    saveMemberResponse(...args) {
      calls.push(['save', ...args]);
      success({ response: {} });
    },
    addGuestRegistration(...args) {
      calls.push(['guest', ...args]);
      success({ registration: {} });
    },
    cancelGuestRegistration(...args) {
      calls.push(['cancel', ...args]);
      failure({ message: '尚未串接' });
    },
  };
  const client = createParticipationClient({
    source: 'gas',
    googleRun: run,
    fetchImpl: () => assert.fail('不可呼叫 HTTP'),
  });
  await client.getParticipation('event');
  await client.saveResponse('event', { uid: '001' });
  await client.registerGuest('event', guest());
  await assert.rejects(client.cancelGuest('event', 'registration', 2), /尚未串接/);
  assert.deepEqual(calls, [
    ['get', 'event'],
    ['save', 'event', { uid: '001' }],
    ['guest', 'event', guest()],
    ['cancel', 'event', 'registration', 2],
  ]);
  await assert.rejects(
    createParticipationClient({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }).getParticipation('e'),
    /無法連線/,
  );
  await assert.rejects(
    createParticipationClient({
      fetchImpl: async () => ({
        json: async () => {
          throw new Error('invalid');
        },
      }),
    }).getParticipation('e'),
    /格式不正確/,
  );
});
