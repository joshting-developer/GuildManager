import { participationTarget } from '../../src/domain/participation-target.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createParticipationClient } from '../../src/api/participation.js';

const password = 'test-password-2026';
const code = (expected) => (error) => error.code === expected;
async function setup() {
  let clock = Date.now();
  const repo = await createTestRepository({ authNow: () => clock });
  const admin = await (await repo.createAccount({ username: 'admin', password }));
  const member = await (await repo.setMemberToken(admin.id, { password: '001234', revision: 0 }));
  await (await repo.createManager(admin.id, { username: 'manager', password }));
  for (const [uid, name, isInGuild, isInClub] of [
    ['guild', '同名成員', true, true],
    ['club', '同名成員', false, true],
    ['outside', '編外', false, false],
  ])
    (await repo.addMember({
      uid,
      name,
      isInGuild,
      isInClub,
      primaryProfessionId: 1,
      secondaryProfessionId: 3,
    }));
  const events = await Promise.all(['scrimmage', 'guild_war', 'dragon_tiger'].map(async (type) =>
    (await repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type })),
  ));
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
    const response = username === 'member'
      ? await request('/auth/member-login', 'POST', { password: '001234' })
      : await request('/auth/login', 'POST', { username, password });
    assert.equal(response.status, 200);
    const session = await response.json();
    return {
      Cookie: response.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': session.csrfToken,
    };
  }
  const input = async (event, extra = {}) => {
    const value = {
      name: '外援',
      professionId: 1,
      status: 'registered',
      note: '備註',
      requestId: crypto.randomUUID(),
      ...extra,
    };
    return { expectedParticipant: { person: participationTarget(value, await repo.getEventParticipationForm(event.id)) }, ...value };
  };
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
      (await repo.close());
    },
  };
}

test('all three battles allow anonymous current/legacy participation and minimal event rosters', async () => {
  const f = await setup();
  try {
    for (const event of f.events) {
      const registration = (await f.repo.addGuestRegistration(event.id, {
        name: '舊外援', professionId: 1, requestId: event.type + 'guest',
      }));
      for (const [method, suffix, body, expected] of [
        ['GET', 'participation', undefined, 200],
        ['GET', 'participation-members', undefined, 200],
        ['POST', 'participation', await f.input(event), 200],
        ['PATCH', 'participation', { uid: 'guild', status: 'leave', note: '', revision: 0 }, 200],
        ['POST', 'registrations', { name: '新外援', professionId: 1, requestId: event.type }, 201],
        ['DELETE', `registrations/${registration.id}`, { revision: 1 }, 200],
      ]) {
        const response = await f.request(`/events/${event.id}/${suffix}`, method, body);
        assert.equal(response.status, expected, method + suffix);
      }
      const roster = await (await f.request(`/events/${event.id}/participation-members`)).json();
      assert.equal(roster.members.length, 2);
      assert.ok(roster.members.every(row => !('previousNames' in row) && !('revision' in row)));
      assert.equal((await f.repo.getEventParticipation(event.id)).responses[0].status, 'leave');
    }
    assert.equal((await f.request('/calendar/members')).status, 401);
    assert.equal((await f.request('/members')).status, 401);
    assert.equal((await f.request('/lineups')).status, 401);
  } finally {
    await f.close();
  }
});

test('selected roster identities resolve duplicate names, validate current membership and preserve retry/roster', async () => {
  const f = await setup();
  try {
    const headers = {};
    const event = f.events[1];
    const client = createParticipationClient({
      fetchImpl: (path, options = {}) =>
        fetch(f.base + path, { ...options, headers: { ...options.headers, ...headers } }),
    });
    await assert.rejects(
      client.submitParticipation(event.id, await f.input(event, { name: '同名成員' })),
      code('PARTICIPATION_AMBIGUOUS'),
    );
    const selected = await f.input(event, { name: '同名成員', memberUid: 'club', professionId: 3 });
    const before = (await f.repo.listMembers());
    const result = await client.submitParticipation(event.id, selected);
    assert.deepEqual(await client.submitParticipation(event.id, selected), result);
    assert.equal((await f.repo.getEventParticipation(event.id)).responses[0].uid, 'club');
    assert.equal((await f.repo.getEventParticipation(event.id)).responses[0].professionId, 3);
    assert.deepEqual((await f.repo.listMembers()), before);
    await client.submitParticipation(
      event.id,
      await f.input(event, { name: '同名成員', memberUid: 'club', status: 'leave', professionId: null }),
    );
    for (const extra of [
      { memberUid: 'missing', name: '同名成員' },
      { memberUid: 'outside', name: '編外' },
      { memberUid: 'guild', name: '錯誤姓名' },
    ])
      await assert.rejects(
        client.submitParticipation(event.id, await f.input(event, extra)),
        code('PARTICIPATION_MEMBER_CHANGED'),
      );
    const changed = (await f.repo.updateMember('club', {
      name: '新姓名',
      primaryProfessionId: 1,
      isInClub: false,
      isInGuild: false,
      revision: 1,
    }));
    assert.equal(changed.isInClub, false);
    await assert.rejects(
      client.submitParticipation(event.id, await f.input(event, { memberUid: 'club', name: '新姓名' })),
      code('PARTICIPATION_MEMBER_CHANGED'),
    );
  } finally {
    await f.close();
  }
});
