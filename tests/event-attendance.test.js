import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createParticipationClient } from '../src/api/participation.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { setGasSession } from '../src/api/gas.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const member = (uid, name) => ({ uid, name, primaryProfessionId: 1, secondaryProfessionId: 3 });
const eventInput = (type) => ({
  type,
  title: type === 'scrimmage' || type === 'activity' ? type : '',
  dates: ['2026-10-05'],
  requestId: type,
});
function seed(repo) {
  repo.addMember(member('001', '報名成員'));
  repo.addMember(member('002', '請假成員'));
  repo.addMember(member('003', '未回應成員'));
  repo.addMember(member('004', '舊 none 成員'));
  const event = repo.createEvent(eventInput('guild_war'));
  const other = repo.createEvent(eventInput('scrimmage'));
  repo.saveMemberResponse(event.id, {
    uid: '001',
    status: 'registered',
    professionId: 3,
    note: '本場副職業',
    revision: 0,
  });
  repo.saveMemberResponse(event.id, { uid: '002', status: 'leave', note: '有事', revision: 0 });
  repo.saveMemberResponse(event.id, { uid: '004', status: 'none', note: '', revision: 0 });
  repo.addGuestRegistration(event.id, {
    name: '外援報名',
    professionId: 2,
    note: '<b>文字備註</b>',
    requestId: 'registered-guest',
  });
  const guest = repo.addGuestRegistration(event.id, {
    name: '外援取消',
    professionId: 4,
    note: '改天參加',
    requestId: 'leave-guest',
  });
  repo.cancelGuestRegistration(event.id, guest.id, guest.revision);
  return { event, other };
}
const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]));
function check(data, eventId) {
  assert.equal(data.eventId, eventId);
  assert.equal(data.leave.length, 2);
  assert.equal(data.registered.length, 2);
  assert.deepEqual(byName(data.leave)['請假成員'], {
    source: 'member',
    id: '002',
    revision: 1,
    name: '請假成員',
    profession: '素問',
    colorcode: '#ffb6c1',
    note: '有事',
  });
  assert.equal(byName(data.registered)['報名成員'].profession, '碎夢');
  assert.equal(byName(data.registered)['外援報名'].note, '<b>文字備註</b>');
  assert.equal(byName(data.leave)['外援取消'].profession, '潮光');
  for (const row of [...data.leave, ...data.registered])
    assert.deepEqual(Object.keys(row).sort(), [
      'colorcode',
      'id',
      'name',
      'note',
      'profession',
      'revision',
      'source',
    ]);
}

test('attendance lists only explicit current responses and guest cancellations; reads preserve data and remain scoped', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const { event, other } = seed(repo);
    const before = repo.getEventParticipation(event.id);
    check(repo.getEventAttendance(event.id), event.id);
    assert.deepEqual(repo.getEventParticipation(event.id), before);
    assert.deepEqual(repo.getEventAttendance(other.id), {
      eventId: other.id,
      leave: [],
      registered: [],
    });
    const guest = repo.addGuestRegistration(event.id, {
      name: '外援取消',
      professionId: 4,
      note: '又可以',
      requestId: 'again',
    });
    assert.ok(guest.active);
    assert.equal(repo.getEventAttendance(event.id).leave.length, 1);
    assert.equal(repo.getEventAttendance(event.id).registered.length, 3);
    repo.saveMemberResponse(event.id, {
      uid: '002',
      status: 'registered',
      professionId: 2,
      note: '可以參加',
      revision: 1,
    });
    assert.equal(repo.getEventAttendance(event.id).leave.length, 0);
    assert.equal(repo.getEventAttendance(event.id).registered.length, 4);
    const ordinary = repo.createEvent(eventInput('activity'));
    assert.throws(
      () => repo.getEventAttendance(ordinary.id),
      (e) => e.code === 'EVENT_UNAVAILABLE',
    );
    assert.throws(
      () => repo.getEventAttendance('missing'),
      (e) => e.code === 'EVENT_UNAVAILABLE',
    );
    repo.deleteEvent(event.id, event.revision);
    assert.throws(
      () => repo.getEventAttendance(event.id),
      (e) => e.code === 'EVENT_UNAVAILABLE',
    );
  } finally {
    repo.close();
  }
});

test('attendance HTTP and adapter are management-only for all battle types, with internal action targets', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const { event, other } = seed(repo);
  const dragon = repo.createEvent(eventInput('dragon_tiger'));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fetchAdmin = await authenticatedFetch(server, repo);
    const client = createParticipationClient({
      fetchImpl: (path, init) => fetchAdmin(base + path, init),
    });
    check(await client.getAttendance(event.id), event.id);
    const admin = (
      await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' })
    ).user;
    await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
    const memberSession = await repo.authenticateMember({ password: 'Member123' });
    await repo.createManager(admin.id, {
      username: 'manager_test',
      password: 'manager-password-123',
    });
    const managerSession = await repo.authenticate({
      username: 'manager_test',
      password: 'manager-password-123',
    });
    for (const e of [event, other, dragon]) {
      const path = `${base}/api/events/${e.id}/attendance`;
      assert.equal((await fetch(path)).status, 401);
      assert.equal(
        (await fetch(path, { headers: { Cookie: `guild_session=${memberSession.token}` } })).status,
        403,
      );
      const response = await fetch(path, {
        headers: { Cookie: `guild_session=${managerSession.token}` },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    repo.deleteEvent(event.id, event.revision);
    await assert.rejects(client.getAttendance(event.id), (e) => e.code === 'EVENT_UNAVAILABLE');
    await assert.rejects(
      createParticipationClient({
        fetchImpl: async () => {
          throw new Error('offline');
        },
      }).getAttendance(event.id),
      /無法連線/,
    );
  } finally {
    await new Promise((r) => server.close(r));
    repo.close();
  }
});

test('GAS attendance matches local lists and enforces wrapper/session roles; adapter has no HTTP fallback', async () => {
  const env = await gasRuntime();
  env.setup();
  const session = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const context = cloudSession(session);
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  for (const [uid, name] of [
    ['001', '報名成員'],
    ['002', '請假成員'],
    ['003', '未回應成員'],
    ['004', '舊 none 成員'],
  ])
    call('addMember', [member(uid, name)]);
  const event = call('createEvent', [eventInput('guild_war')]).events[0];
  const scrim = call('createEvent', [eventInput('scrimmage')]).event;
  const dragon = call('createEvent', [eventInput('dragon_tiger')]).events[0];
  call('saveMemberResponse', [
    event.id,
    { uid: '001', status: 'registered', professionId: 3, note: '本場副職業', revision: 0 },
  ]);
  call('saveMemberResponse', [
    event.id,
    { uid: '002', status: 'leave', note: '有事', revision: 0 },
  ]);
  call('saveMemberResponse', [event.id, { uid: '004', status: 'none', note: '', revision: 0 }]);
  call('addGuestRegistration', [
    event.id,
    { name: '外援報名', professionId: 2, note: '<b>文字備註</b>', requestId: 'registered-guest' },
  ]);
  const guest = call('addGuestRegistration', [
    event.id,
    { name: '外援取消', professionId: 4, note: '改天參加', requestId: 'leave-guest' },
  ]).registration;
  call('cancelGuestRegistration', [event.id, guest.id, guest.revision]);
  const before = call('getEventParticipation', [event.id]);
  check(call('getEventAttendance', [event.id]), event.id);
  assert.deepEqual(call('getEventParticipation', [event.id]), before);
  assert.deepEqual(call('getEventAttendance', [scrim.id]), {
    eventId: scrim.id,
    leave: [],
    registered: [],
  });
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const memberContext = cloudSession(
    cloudResult(env.raw('loginMember', [{ password: 'Member123' }])),
  );
  call('createManager', [{ username: 'manager_test', password: 'manager-password-123' }]);
  const managerContext = cloudSession(
    cloudResult(env.raw('login', [{ username: 'manager_test', password: 'manager-password-123' }])),
  );
  for (const e of [event, scrim, dragon]) {
    assert.equal(env.raw('getEventAttendance', [e.id]).error.code, 'AUTH_REQUIRED');
    assert.equal(
      env.raw('getEventAttendance', [e.id], { role: 'admin' }).error.code,
      'AUTH_REQUIRED',
    );
    assert.equal(
      env.raw('getEventAttendance', [e.id], memberContext).error.code,
      'MANAGEMENT_REQUIRED',
    );
    assert.equal(env.raw('getEventAttendance', [e.id], managerContext).ok, true);
  }
  setGasSession(session);
  const run = {
    withSuccessHandler(fn) {
      this.done = fn;
      return this;
    },
    withFailureHandler(fn) {
      this.fail = fn;
      return this;
    },
    getEventAttendance(id, ctx) {
      this.done(env.raw('getEventAttendance', [id], ctx));
    },
  };
  const client = createParticipationClient({
    source: 'gas',
    googleRun: run,
    fetchImpl: () => assert.fail('no HTTP fallback'),
  });
  check(await client.getAttendance(event.id), event.id);
  call('deleteEvent', [event.id, event.revision]);
  await assert.rejects(client.getAttendance(event.id), (e) => e.code === 'EVENT_NOT_FOUND');
  setGasSession({ user: null });
});

function cancellationChecks(get, cancel, participation, save, eligible, event, other) {
  const memberLeave = get(event.id).leave.find((row) => row.source === 'member');
  const guestLeave = get(event.id).leave.find((row) => row.source === 'registration');
  const input = ({ source, id, revision }) => ({ source, id, revision });
  assert.throws(() => cancel(event.id, { ...input(memberLeave), revision: 0 }));
  assert.throws(
    () => cancel(other.id, input(memberLeave)),
    (e) => e.code === 'PARTICIPATION_CHANGED',
  );
  assert.throws(
    () => cancel(other.id, input(guestLeave)),
    (e) => e.code === 'PARTICIPATION_CHANGED',
  );
  const result = cancel(event.id, input(memberLeave));
  assert.deepEqual(result, { eventId: event.id, cancelled: true });
  assert.deepEqual(cancel(event.id, input(memberLeave)), result);
  assert.equal(get(event.id).leave.length, 1);
  assert.equal(get(event.id).registered.length, 2);
  assert.equal(participation(event.id).responses.find((row) => row.uid === '002').status, 'none');
  assert.equal(participation(event.id).responses.find((row) => row.uid === '002').note, '有事');
  assert.ok(eligible(event.id).members.some((row) => row.uid === '002'));
  cancel(event.id, input(guestLeave));
  assert.equal(get(event.id).leave.length, 0);
  assert.equal(get(event.id).registered.length, 3);
  assert.deepEqual(cancel(event.id, input(guestLeave)), result);
  assert.equal(
    participation(event.id).registrations.find((row) => row.name === '外援取消').id,
    guestLeave.id,
  );
  assert.equal(
    participation(event.id).registrations.find((row) => row.name === '外援取消').note,
    '改天參加',
  );
  save(event.id, { uid: '002', status: 'leave', note: '新的請假', revision: 2 });
  assert.throws(
    () => cancel(event.id, input(memberLeave)),
    (e) => e.code === 'PARTICIPATION_CHANGED',
  );
  assert.equal(get(event.id).leave.length, 1);
  save(event.id, {
    uid: '002',
    status: 'registered',
    professionId: 3,
    note: '又可以參加',
    revision: 3,
  });
  assert.equal(get(event.id).leave.length, 0);
  const current = eligible(event.id).members.find((row) => row.uid === '002');
  assert.ok(current && current.isInGuild);
  assert.ok(!eligible(event.id).registrations.some((row) => row.name === '請假成員'));
  assert.throws(() => cancel(event.id, { ...input(memberLeave), source: 'invalid' }));
}

test('local manager cancellation clears member leave, restores the original guest and checks revisions/retries without changing membership', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const { event, other } = seed(repo);
    cancellationChecks(
      (id) => repo.getEventAttendance(id),
      (id, input) => repo.cancelEventLeave(id, input),
      (id) => repo.getEventParticipation(id),
      (id, input) => repo.saveMemberResponse(id, input),
      (id) => {
        const teams = emptyLineup();
        teams[0].slots[0].uid = '002';
        repo.confirmLineup({
          eventId: id,
          eventRevision: 1,
          expectedVersion: repo.getLineupHistory(id).versions[0]?.version || 0,
          teams,
          requestId: crypto.randomUUID(),
        });
        return {
          members: repo.listMembers().members,
          registrations: repo.getEventParticipation(id).registrations,
        };
      },
      event,
      other,
    );
    const member = repo.listMembers().members.find((row) => row.uid === '002');
    assert.equal(member.isInGuild, true);
    assert.equal(member.isInClub, false);
  } finally {
    repo.close();
  }
});

test('attendance PATCH enforces manager access and CSRF while leaving public response APIs unchanged', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const { event } = seed(repo);
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const auth = await authenticatedFetch(server, repo);
    const adminSession = await repo.authenticate({
      username: 'test_admin',
      password: 'test-password-2026',
    });
    await repo.setMemberToken(adminSession.user.id, { password: 'Member123', revision: 0 });
    const member = await repo.authenticateMember({ password: 'Member123' });
    const row = repo.getEventAttendance(event.id).leave.find((row) => row.source === 'member');
    const input = { id: row.id, source: row.source, revision: row.revision };
    const init = {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    };
    const path = `${base}/api/events/${event.id}/attendance`;
    assert.equal((await fetch(path, init)).status, 401);
    assert.equal(
      (
        await fetch(path, {
          ...init,
          headers: { ...init.headers, Cookie: `guild_session=${member.token}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(path, {
          ...init,
          headers: { ...init.headers, Cookie: `guild_session=${adminSession.token}` },
        })
      ).status,
      403,
    );
    const client = createParticipationClient({
      fetchImpl: (url, options) => auth(base + url, options),
    });
    assert.equal((await client.cancelLeave(event.id, input)).cancelled, true);
    assert.equal((await client.getAttendance(event.id)).leave.length, 1);
  } finally {
    await new Promise((r) => server.close(r));
    repo.close();
  }
});

test('GAS cancellation is atomic, manager-only, CSRF-protected and restores eligibility without converting members to guests', async () => {
  const env = await gasRuntime();
  env.setup();
  const session = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const ctx = cloudSession(session);
  const call = (op, args = []) => cloudResult(env.raw(op, args, ctx));
  for (const [uid, name] of [
    ['001', '報名成員'],
    ['002', '請假成員'],
    ['003', '未回應成員'],
    ['004', '舊 none 成員'],
  ])
    call('addMember', [member(uid, name)]);
  const event = call('createEvent', [eventInput('guild_war')]).events[0];
  const other = call('createEvent', [eventInput('scrimmage')]).event;
  call('saveMemberResponse', [
    event.id,
    { uid: '001', status: 'registered', professionId: 3, note: '本場副職業', revision: 0 },
  ]);
  call('saveMemberResponse', [
    event.id,
    { uid: '002', status: 'leave', note: '有事', revision: 0 },
  ]);
  call('addGuestRegistration', [
    event.id,
    { name: '外援報名', professionId: 2, note: '', requestId: 'guest-a' },
  ]);
  const guest = call('addGuestRegistration', [
    event.id,
    { name: '外援取消', professionId: 4, note: '改天參加', requestId: 'guest-b' },
  ]).registration;
  call('cancelGuestRegistration', [event.id, guest.id, guest.revision]);
  const row = call('getEventAttendance', [event.id]).leave.find((row) => row.source === 'member');
  const input = { source: row.source, id: row.id, revision: row.revision };
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const memberCtx = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  assert.equal(env.raw('cancelEventLeave', [event.id, input]).error.code, 'AUTH_REQUIRED');
  assert.equal(
    env.raw('cancelEventLeave', [event.id, input], memberCtx).error.code,
    'MANAGEMENT_REQUIRED',
  );
  assert.equal(
    env.raw('cancelEventLeave', [event.id, input], { sessionToken: session.sessionToken }).error
      .code,
    'CSRF_INVALID',
  );
  env.failOn('GM_commits');
  assert.equal(env.raw('cancelEventLeave', [event.id, input], ctx).ok, false);
  env.failOn(null);
  assert.equal(call('getEventAttendance', [event.id]).leave.length, 2);
  cancellationChecks(
    (id) => call('getEventAttendance', [id]),
    (id, input) => call('cancelEventLeave', [id, input]),
    (id) => call('getEventParticipation', [id]),
    (id, input) => call('saveMemberResponse', [id, input]).response,
    (id) => {
      const teams = emptyLineup();
      teams[0].slots[0].uid = '002';
      call('confirmLineup', [
        {
          eventId: id,
          eventRevision: 1,
          expectedVersion: call('getLineupHistory', [id]).versions[0]?.version || 0,
          teams,
          requestId: crypto.randomUUID(),
        },
      ]);
      return {
        members: call('getMembers').members,
        registrations: call('getEventParticipation', [id]).registrations,
      };
    },
    event,
    other,
  );
  call('createManager', [{ username: 'manager_test', password: 'manager-password-123' }]);
  const managerCtx = cloudSession(
    cloudResult(env.raw('login', [{ username: 'manager_test', password: 'manager-password-123' }])),
  );
  call('saveMemberResponse', [
    event.id,
    { uid: '002', status: 'leave', note: '稍後再改', revision: 4 },
  ]);
  const managerInput = { ...input, revision: 5 };
  assert.equal(env.raw('cancelEventLeave', [event.id, managerInput], managerCtx).ok, true);
  call('addMember', [{ ...member('club', '俱樂部人員'), isInGuild: false, isInClub: true }]);
  for (const type of ['guild_war', 'dragon_tiger']) {
    const e = call('createEvent', [{ ...eventInput(type), requestId: 'club-' + type }]).events[0];
    for (const status of ['leave', 'registered'])
      call('submitParticipation', [
        e.id,
        {
          name: '俱樂部人員',
          status,
          professionId: 3,
          note: '',
          revision: call('getEventParticipation', [e.id]).revision,
          requestId: crypto.randomUUID(),
        },
      ]);
    assert.equal(call('getEventAttendance', [e.id]).leave.length, 0);
    assert.equal(call('getEventParticipation', [e.id]).registrations.length, 0);
    assert.equal(call('getEventParticipation', [e.id]).responses[0].uid, 'club');
    const teams = emptyLineup();
    teams[0].slots[0].uid = 'club';
    call('confirmLineup', [
      {
        eventId: e.id,
        eventRevision: 1,
        expectedVersion: 0,
        teams,
        requestId: crypto.randomUUID(),
      },
    ]);
  }
  const club = call('getMembers').members.find((row) => row.uid === 'club');
  assert.equal(club.isInGuild, false);
  assert.equal(club.isInClub, true);
});

test('guild and club members can re-register after leave through the public form without creating guest identities', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    repo.addMember({ ...member('guild', '幫會人員'), isInGuild: true, isInClub: true });
    repo.addMember({ ...member('club', '俱樂部人員'), isInGuild: false, isInClub: true });
    for (const type of ['guild_war', 'dragon_tiger']) {
      const event = repo.createEvent(eventInput(type));
      for (const [uid, name] of [
        ['guild', '幫會人員'],
        ['club', '俱樂部人員'],
      ]) {
        const submit = (status) =>
          repo.submitParticipation(event.id, {
            name,
            status,
            professionId: 3,
            note: '',
            revision: repo.getEventParticipation(event.id).revision,
            requestId: crypto.randomUUID(),
          });
        submit('leave');
        assert.ok(repo.getEventAttendance(event.id).leave.some((row) => row.id === uid));
        submit('registered');
        assert.ok(!repo.getEventAttendance(event.id).leave.some((row) => row.id === uid));
        assert.equal(
          repo.getEventParticipation(event.id).responses.find((row) => row.uid === uid).status,
          'registered',
        );
        assert.equal(repo.getEventParticipation(event.id).registrations.length, 0);
      }
      const teams = emptyLineup();
      teams[0].slots[0].uid = 'guild';
      teams[0].slots[1].uid = 'club';
      repo.confirmLineup({
        eventId: event.id,
        eventRevision: 1,
        expectedVersion: 0,
        teams,
        requestId: crypto.randomUUID(),
      });
    }
    assert.deepEqual(
      repo
        .listMembers()
        .members.map(({ uid, isInGuild, isInClub }) => ({ uid, isInGuild, isInClub }))
        .sort((a, b) => a.uid.localeCompare(b.uid)),
      [
        { uid: 'club', isInGuild: false, isInClub: true },
        { uid: 'guild', isInGuild: true, isInClub: true },
      ],
    );
  } finally {
    repo.close();
  }
});
