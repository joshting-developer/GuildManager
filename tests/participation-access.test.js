import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createParticipationClient } from '../src/api/participation.js';

const password = 'test-password-2026';
const code = (expected) => (error) => error.code === expected;
async function setup() {
  let clock = Date.now();
  const repo = createRepository({ filename: ':memory:', authNow: () => clock });
  const admin = await repo.createAccount({ username: 'admin', password });
  const member = await repo.createMemberAccount(admin.id, { username: 'member', password });
  await repo.createManager(admin.id, { username: 'manager', password });
  for (const [uid, name, isInGuild, isInClub] of [
    ['guild', '同名成員', true, true],
    ['club', '同名成員', false, true],
    ['outside', '編外', false, false],
  ])
    repo.addMember({
      uid,
      name,
      isInGuild,
      isInClub,
      primaryProfessionId: 1,
      secondaryProfessionId: 3,
    });
  const events = ['scrimmage', 'guild_war', 'dragon_tiger'].map((type) =>
    repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type }),
  );
  const server = createApp(repo, { authNow: () => clock }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function login(username = 'member') {
    const response = await request('/auth/login', 'POST', { username, password });
    assert.equal(response.status, 200);
    const session = await response.json();
    return {
      Cookie: response.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': session.csrfToken,
    };
  }
  const input = (event, extra = {}) => ({
    name: '外援',
    professionId: 1,
    status: 'registered',
    note: '備註',
    requestId: crypto.randomUUID(),
    revision: repo.getEventParticipation(event.id).revision,
    ...extra,
  });
  return {
    repo,
    admin,
    member,
    events,
    request,
    login,
    input,
    base,
    advance: (ms) => (clock += ms),
    close: async () => {
      await new Promise((r) => server.close(r));
      repo.close();
    },
  };
}

test('guild/dragon reads and all current/legacy mutations require login; anonymous scrimmage remains available', async () => {
  const f = await setup();
  try {
    for (const event of f.events.slice(1)) {
      const registration = f.repo.addGuestRegistration(event.id, {
        name: '舊外援',
        professionId: 1,
        requestId: event.type + 'guest',
      });
      for (const [method, suffix, body] of [
        ['GET', 'participation'],
        ['GET', 'participation-members'],
        ['POST', 'participation', f.input(event)],
        ['PATCH', 'participation', { uid: 'guild', status: 'leave', note: '', revision: 0 }],
        ['POST', 'registrations', { name: '新外援', professionId: 1, requestId: event.type }],
        ['DELETE', `registrations/${registration.id}`, { revision: 1 }],
      ]) {
        const response = await f.request(`/events/${event.id}/${suffix}`, method, body);
        assert.equal(response.status, 401, method + suffix);
        assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
      }
      assert.equal(f.repo.getEventParticipation(event.id).registrations.length, 1);
      assert.equal(f.repo.getEventParticipation(event.id).responses.length, 0);
    }
    const event = f.events[0];
    assert.equal((await f.request(`/events/${event.id}/participation`)).status, 200);
    assert.equal(
      (await f.request(`/events/${event.id}/participation`, 'POST', f.input(event))).status,
      200,
    );
    assert.equal((await f.request(`/events/${event.id}/participation-members`)).status, 401);
    assert.equal((await f.request('/calendar/members')).status, 401);
  } finally {
    await f.close();
  }
});

test('member can use both roster categories, register and leave with CSRF, never read management; revoked/expired sessions fail', async () => {
  const f = await setup();
  try {
    const headers = await f.login();
    const client = createParticipationClient({
      fetchImpl: (path, options = {}) =>
        fetch(f.base + path, { ...options, headers: { ...options.headers, ...headers } }),
    });
    for (const event of f.events.slice(1)) {
      const roster = await client.getMembers(event.id);
      assert.equal(roster.eventId, event.id);
      assert.equal(roster.members.filter((m) => m.isInGuild).length, 1);
      assert.equal(roster.members.filter((m) => m.isInClub).length, 2);
      assert.ok(
        roster.members.every((m) => !('note' in m) && !('nameHistory' in m) && !('revision' in m)),
      );
      assert.equal(
        (
          await f.request(`/events/${event.id}/participation`, 'POST', f.input(event), {
            Cookie: headers.Cookie,
          })
        ).status,
        403,
      );
      const saved = await client.submitParticipation(event.id, f.input(event));
      assert.equal(saved.status, 'registered');
      const left = await client.submitParticipation(
        event.id,
        f.input(event, { status: 'leave', professionId: null }),
      );
      assert.equal(left.status, 'leave');
      assert.equal(f.repo.getEventParticipation(event.id).registrations.length, 0);
      await assert.rejects(
        client.submitParticipation(
          event.id,
          f.input(event, { name: '未知', status: 'leave', professionId: null }),
        ),
        code('PARTICIPATION_NOT_FOUND'),
      );
    }
    for (const path of ['/members', '/lineups', '/admin/accounts', '/battle-records'])
      assert.equal((await f.request(path, 'GET', undefined, headers)).status, 403);
    await f.repo.updateMemberAccount(f.admin.id, f.member.id, {
      username: 'member',
      password: 'replacement-password',
      revision: 1,
    });
    assert.equal(
      (await f.request(`/events/${f.events[1].id}/participation`, 'GET', undefined, headers))
        .status,
      401,
    );
    const response = await f.request('/auth/login', 'POST', {
      username: 'member',
      password: 'replacement-password',
    });
    const current = { Cookie: response.headers.get('set-cookie').split(';')[0] };
    f.advance(8 * 60 * 60 * 1000);
    assert.equal(
      (await f.request(`/events/${f.events[1].id}/participation`, 'GET', undefined, current))
        .status,
      401,
    );
  } finally {
    await f.close();
  }
});

test('selected roster identities resolve duplicate names, validate current membership and preserve retry/roster', async () => {
  const f = await setup();
  try {
    const headers = await f.login();
    const event = f.events[1];
    const client = createParticipationClient({
      fetchImpl: (path, options = {}) =>
        fetch(f.base + path, { ...options, headers: { ...options.headers, ...headers } }),
    });
    await assert.rejects(
      client.submitParticipation(event.id, f.input(event, { name: '同名成員' })),
      code('PARTICIPATION_AMBIGUOUS'),
    );
    const selected = f.input(event, { name: '同名成員', memberUid: 'club', professionId: 3 });
    const before = f.repo.listMembers();
    const result = await client.submitParticipation(event.id, selected);
    assert.deepEqual(await client.submitParticipation(event.id, selected), result);
    assert.equal(f.repo.getEventParticipation(event.id).responses[0].uid, 'club');
    assert.equal(f.repo.getEventParticipation(event.id).responses[0].professionId, 3);
    assert.deepEqual(f.repo.listMembers(), before);
    await client.submitParticipation(
      event.id,
      f.input(event, { name: '同名成員', memberUid: 'club', status: 'leave', professionId: null }),
    );
    for (const extra of [
      { memberUid: 'missing', name: '同名成員' },
      { memberUid: 'outside', name: '編外' },
      { memberUid: 'guild', name: '錯誤姓名' },
    ])
      await assert.rejects(
        client.submitParticipation(event.id, f.input(event, extra)),
        code('PARTICIPATION_MEMBER_CHANGED'),
      );
    const changed = f.repo.updateMember('club', {
      name: '新姓名',
      primaryProfessionId: 1,
      isInClub: false,
      isInGuild: false,
      revision: 1,
    });
    assert.equal(changed.isInClub, false);
    await assert.rejects(
      client.submitParticipation(event.id, f.input(event, { memberUid: 'club', name: '新姓名' })),
      code('PARTICIPATION_MEMBER_CHANGED'),
    );
  } finally {
    await f.close();
  }
});

test('manager reporting and member logout work; selected-name GAS adapter forwards the same payload without HTTP', async () => {
  const f = await setup();
  try {
    const headers = await f.login('manager');
    const event = f.events[2];
    assert.equal(
      (await f.request(`/events/${event.id}/participation`, 'POST', f.input(event), headers))
        .status,
      200,
    );
    const member = await f.login();
    assert.equal((await f.request('/auth/logout', 'POST', {}, member)).status, 200);
    assert.equal(
      (await f.request(`/events/${event.id}/participation`, 'GET', undefined, member)).status,
      401,
    );
    let success, failure;
    const input = f.input(event, { memberUid: 'guild', name: '同名成員' });
    const gas = createParticipationClient({
      source: 'gas',
      fetchImpl: () => assert.fail(),
      googleRun: {
        withSuccessHandler(fn) {
          success = fn;
          return this;
        },
        withFailureHandler(fn) {
          failure = fn;
          return this;
        },
        getEventParticipationMembers(id) {
          assert.equal(id, event.id);
          failure({ message: '尚未串接' });
        },
        submitParticipation(id, payload) {
          assert.equal(id, event.id);
          assert.deepEqual(payload, input);
          success({ status: 'registered' });
        },
      },
    });
    await assert.rejects(gas.getMembers(event.id), /尚未串接/);
    assert.equal((await gas.submitParticipation(event.id, input)).status, 'registered');
  } finally {
    await f.close();
  }
});
