import { submitFromCurrentForm } from '../helpers/participation-input.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { emptyLineup } from '../../src/domain/lineups.js';

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

test('attendance lists only explicit current responses and guest cancellations; reads preserve data and remain scoped', async () => {
  const repo = (await createRepository());
  try {
    const { event, other } = (await seed(repo));
    const before = (await repo.getEventParticipation(event.id));
    check((await repo.getEventAttendance(event.id)), event.id);
    assert.deepEqual((await repo.getEventParticipation(event.id)), before);
    assert.deepEqual((await repo.getEventAttendance(other.id)), {
      eventId: other.id,
      leave: [],
      registered: [],
    });
    const guest = (await repo.addGuestRegistration(event.id, {
      name: '外援取消',
      professionId: 4,
      note: '又可以',
      requestId: 'again',
    }));
    assert.ok(guest.active);
    assert.equal((await repo.getEventAttendance(event.id)).leave.length, 1);
    assert.equal((await repo.getEventAttendance(event.id)).registered.length, 3);
    (await repo.saveMemberResponse(event.id, {
      uid: '002',
      status: 'registered',
      professionId: 2,
      note: '可以參加',
      revision: 1,
    }));
    assert.equal((await repo.getEventAttendance(event.id)).leave.length, 0);
    assert.equal((await repo.getEventAttendance(event.id)).registered.length, 4);
    const ordinary = (await repo.createEvent(eventInput('activity')));
    (await assert.rejects(
      async () => (await repo.getEventAttendance(ordinary.id)),
      (e) => e.code === 'EVENT_UNAVAILABLE',
    ));
    (await assert.rejects(
      async () => (await repo.getEventAttendance('missing')),
      (e) => e.code === 'EVENT_UNAVAILABLE',
    ));
    (await repo.deleteEvent(event.id, event.revision));
    (await assert.rejects(
      async () => (await repo.getEventAttendance(event.id)),
      (e) => e.code === 'EVENT_UNAVAILABLE',
    ));
  } finally {
    (await repo.close());
  }
});

async function cancellationChecks(get, cancel, participation, save, eligible, event, other) {
  const memberLeave = (await get(event.id)).leave.find((row) => row.source === 'member');
  const guestLeave = (await get(event.id)).leave.find((row) => row.source === 'registration');
  const input = ({ source, id, revision }) => ({ source, id, revision });
  (await assert.rejects(async () => (await cancel(event.id, { ...input(memberLeave), revision: 0 }))));
  (await assert.rejects(
    async () => (await cancel(other.id, input(memberLeave))),
    (e) => e.code === 'PARTICIPATION_CHANGED',
  ));
  (await assert.rejects(
    async () => (await cancel(other.id, input(guestLeave))),
    (e) => e.code === 'PARTICIPATION_CHANGED',
  ));
  const result = (await cancel(event.id, input(memberLeave)));
  assert.deepEqual(result, { eventId: event.id, cancelled: true });
  await assert.rejects(cancel(event.id, input(memberLeave)), { code: 'PARTICIPATION_CHANGED' });
  assert.equal((await get(event.id)).leave.length, 1);
  assert.equal((await get(event.id)).registered.length, 2);
  assert.equal((await participation(event.id)).responses.find((row) => row.uid === '002').status, 'none');
  assert.equal((await participation(event.id)).responses.find((row) => row.uid === '002').note, '有事');
  assert.ok((await eligible(event.id)).members.some((row) => row.uid === '002'));
  (await cancel(event.id, input(guestLeave)));
  assert.equal((await get(event.id)).leave.length, 0);
  assert.equal((await get(event.id)).registered.length, 3);
  await assert.rejects(cancel(event.id, input(guestLeave)), { code: 'PARTICIPATION_CHANGED' });
  assert.equal(
    (await participation(event.id)).registrations.find((row) => row.name === '外援取消').id,
    guestLeave.id,
  );
  assert.equal(
    (await participation(event.id)).registrations.find((row) => row.name === '外援取消').note,
    '改天參加',
  );
  (await save(event.id, { uid: '002', status: 'leave', note: '新的請假', revision: 2 }));
  (await assert.rejects(
    async () => (await cancel(event.id, input(memberLeave))),
    (e) => e.code === 'PARTICIPATION_CHANGED',
  ));
  assert.equal((await get(event.id)).leave.length, 1);
  (await save(event.id, {
    uid: '002',
    status: 'registered',
    professionId: 3,
    note: '又可以參加',
    revision: 3,
  }));
  assert.equal((await get(event.id)).leave.length, 0);
  const current = (await eligible(event.id)).members.find((row) => row.uid === '002');
  assert.ok(current && current.isInGuild);
  assert.ok(!(await eligible(event.id)).registrations.some((row) => row.name === '請假成員'));
  (await assert.rejects(async () => (await cancel(event.id, { ...input(memberLeave), source: 'invalid' }))));
}

test('local manager cancellation clears member leave, restores the original guest and checks revisions/retries without changing membership', async () => {
  const repo = (await createRepository());
  try {
    const { event, other } = (await seed(repo));
    (await cancellationChecks(
      async (id) => (await repo.getEventAttendance(id)),
      async (id, input) => (await repo.cancelEventLeave(id, input)),
      async (id) => (await repo.getEventParticipation(id)),
      async (id, input) => (await repo.saveMemberResponse(id, input)),
      async (id) => {
        const teams = emptyLineup();
        teams[0].slots[0].uid = '002';
        (await repo.confirmLineup({
          eventId: id,
          eventRevision: 1,
          expectedVersion: (await repo.getLineupHistory(id)).versions[0]?.version || 0,
          teams,
          requestId: crypto.randomUUID(),
        }));
        return {
          members: (await repo.listMembers()).members,
          registrations: (await repo.getEventParticipation(id)).registrations,
        };
      },
      event,
      other,
    ));
    const member = (await repo.listMembers()).members.find((row) => row.uid === '002');
    assert.equal(member.isInGuild, true);
    assert.equal(member.isInClub, false);
  } finally {
    (await repo.close());
  }
});

test('guild and club members can re-register after leave through the public form without creating guest identities', async () => {
  const repo = (await createRepository());
  try {
    (await repo.addMember({ ...member('guild', '幫會人員'), isInGuild: true, isInClub: true }));
    (await repo.addMember({ ...member('club', '俱樂部人員'), isInGuild: false, isInClub: true }));
    for (const type of ['guild_war', 'dragon_tiger']) {
      const event = (await repo.createEvent(eventInput(type)));
      for (const [uid, name] of [
        ['guild', '幫會人員'],
        ['club', '俱樂部人員'],
      ]) {
        const submit = async (status) =>
          (await submitFromCurrentForm(repo, event.id, {
            name,
            status,
            professionId: 3,
            note: '',
            revision: (await repo.getEventParticipation(event.id)).revision,
            requestId: crypto.randomUUID(),
          }));
        (await submit('leave'));
        assert.ok((await repo.getEventAttendance(event.id)).leave.some((row) => row.id === uid));
        (await submit('registered'));
        assert.ok(!(await repo.getEventAttendance(event.id)).leave.some((row) => row.id === uid));
        assert.equal(
          (await repo.getEventParticipation(event.id)).responses.find((row) => row.uid === uid).status,
          'registered',
        );
        assert.equal((await repo.getEventParticipation(event.id)).registrations.length, 0);
      }
      const teams = emptyLineup();
      teams[0].slots[0].uid = 'guild';
      teams[0].slots[1].uid = 'club';
      (await repo.confirmLineup({
        eventId: event.id,
        eventRevision: 1,
        expectedVersion: 0,
        teams,
        requestId: crypto.randomUUID(),
      }));
    }
    assert.deepEqual(
      (await repo
        .listMembers())
        .members.map(({ uid, isInGuild, isInClub }) => ({ uid, isInGuild, isInClub }))
        .sort((a, b) => a.uid.localeCompare(b.uid)),
      [
        { uid: 'club', isInGuild: false, isInClub: true },
        { uid: 'guild', isInGuild: true, isInClub: true },
      ],
    );
  } finally {
    (await repo.close());
  }
});
