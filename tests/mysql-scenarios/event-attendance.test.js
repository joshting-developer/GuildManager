import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createParticipationClient } from '../../src/api/participation.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

const member = (uid, name) => ({ uid, name, primaryProfessionId: 1, secondaryProfessionId: 3 });
const eventInput = (type) => ({
  type,
  title: type === 'scrimmage' || type === 'activity' ? type : '',
  dates: ['2026-10-05'],
  requestId: type,
});
async function seed(repo) {
  (await repo.addMember(member('001', '報名成員')));
  (await repo.addMember(member('002', '請假成員')));
  (await repo.addMember(member('003', '未回應成員')));
  (await repo.addMember(member('004', '舊 none 成員')));
  const event = (await repo.createEvent(eventInput('guild_war')));
  const other = (await repo.createEvent(eventInput('scrimmage')));
  (await repo.saveMemberResponse(event.id, {
    uid: '001',
    status: 'registered',
    professionId: 3,
    note: '本場副職業',
    revision: 0,
  }));
  (await repo.saveMemberResponse(event.id, { uid: '002', status: 'leave', note: '有事', revision: 0 }));
  (await repo.saveMemberResponse(event.id, { uid: '004', status: 'none', note: '', revision: 0 }));
  (await repo.addGuestRegistration(event.id, {
    name: '外援報名',
    professionId: 2,
    note: '<b>文字備註</b>',
    requestId: 'registered-guest',
  }));
  const guest = (await repo.addGuestRegistration(event.id, {
    name: '外援取消',
    professionId: 4,
    note: '改天參加',
    requestId: 'leave-guest',
  }));
  (await repo.cancelGuestRegistration(event.id, guest.id, guest.revision));
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

test('attendance HTTP and adapter are management-only for all battle types, with internal action targets', async () => {
  const repo = await createTestRepository({ });
  const { event, other } = await seed(repo);
  const dragon = (await repo.createEvent(eventInput('dragon_tiger')));
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
      await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }))
    ).user;
    await (await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 }));
    const memberSession = await (await repo.authenticateMember({ password: 'Member123' }));
    await (await repo.createManager(admin.id, {
      username: 'manager_test',
      password: 'manager-password-123',
    }));
    const managerSession = await (await repo.authenticate({
      username: 'manager_test',
      password: 'manager-password-123',
    }));
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
    (await repo.deleteEvent(event.id, event.revision));
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
    (await repo.close());
  }
});

test('attendance PATCH enforces manager access and CSRF while leaving public response APIs unchanged', async () => {
  const repo = await createTestRepository({ });
  const { event } = await seed(repo);
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const auth = await authenticatedFetch(server, repo);
    const adminSession = await (await repo.authenticate({
      username: 'test_admin',
      password: 'test-password-2026',
    }));
    await (await repo.setMemberToken(adminSession.user.id, { password: 'Member123', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: 'Member123' }));
    const row = (await repo.getEventAttendance(event.id)).leave.find((row) => row.source === 'member');
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
    (await repo.close());
  }
});
