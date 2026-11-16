import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

async function setup(filename = ':memory:') {
  const repo = (await createRepository({ filename }));
  (await repo.addMember({
    uid: '001',
    name: '成員',
    primaryProfessionId: 1,
    isInGuild: true,
    isInClub: true,
  }));
  const event = (await repo.createEvent({
    title: '約戰',
    type: 'scrimmage',
    dates: ['2026-10-24'],
    requestId: 'event',
  }));
  const other = (await repo.createEvent({
    title: '',
    type: 'guild_war',
    dates: ['2026-10-25'],
    requestId: 'other',
  }));
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

test('responses are scoped to one battle, retain revisions and allow retry, switch and cancellation', async () => {
  const { repo, event, other } = (await setup());
  try {
    const input = { uid: '001', status: 'leave', note: '當天不在', revision: 0 };
    const saved = (await repo.saveMemberResponse(event.id, input));
    assert.deepEqual((await repo.saveMemberResponse(event.id, input)), saved);
    assert.equal((await repo.getEventParticipation(other.id)).responses.length, 0);
    (await assert.rejects(
      async () => (await repo.saveMemberResponse(event.id, { ...input, status: 'registered' })),
      code('PARTICIPATION_CHANGED'),
    ));
    const registered = (await repo.saveMemberResponse(event.id, {
      ...input,
      status: 'registered',
      revision: saved.revision,
    }));
    const cancelled = (await repo.saveMemberResponse(event.id, {
      ...input,
      status: 'none',
      revision: registered.revision,
    }));
    assert.equal(cancelled.revision, 3);
    assert.equal(cancelled.status, 'none');
    (await assert.rejects(
      async () => (await repo.saveMemberResponse(event.id, { ...input, uid: 'missing' })),
      code('MEMBER_NOT_FOUND'),
    ));
    (await assert.rejects(
      async () => (await repo.saveMemberResponse(event.id, { ...input, revision: -1 })),
      code('PARTICIPATION_INVALID'),
    ));
    (await assert.rejects(
      async () => (await repo.saveMemberResponse(event.id, { ...input, status: 'fake' })),
      code('PARTICIPATION_INVALID'),
    ));
  } finally {
    (await repo.close());
  }
});

test('UID-less guests have stable IDs, explicit professions and notes; retries and duplicate names do not add rows', async () => {
  const { repo, event, other } = (await setup());
  try {
    const first = (await repo.addGuestRegistration(event.id, guest()));
    assert.ok(first.id);
    assert.equal(first.uid, undefined);
    assert.equal(first.profession, '碎夢');
    assert.equal(first.note, '可以打第二場');
    assert.deepEqual((await repo.addGuestRegistration(event.id, guest())), first);
    (await assert.rejects(
      async () => (await repo.addGuestRegistration(event.id, guest({ name: '另一個人' }))),
      code('REQUEST_CONFLICT'),
    ));
    (await assert.rejects(
      async () => (await repo.addGuestRegistration(event.id, guest({ requestId: 'repeat' }))),
      code('REGISTRATION_EXISTS'),
    ));
    (await assert.rejects(
      async () => (await repo.addGuestRegistration(event.id, guest({ requestId: 'invalid', professionId: 99 }))),
      code('PARTICIPATION_INVALID'),
    ));
    (await assert.rejects(
      async () => (await repo.addGuestRegistration(event.id, guest({ requestId: 'invalid', name: ' ' }))),
      code('PARTICIPATION_INVALID'),
    ));
    assert.equal((await repo.getEventParticipation(event.id)).registrations.length, 1);
    assert.equal((await repo.listMembers()).members.length, 1);
    (await assert.rejects(
      async () => (await repo.cancelGuestRegistration(other.id, first.id, first.revision)),
      code('REGISTRATION_NOT_FOUND'),
    ));
    const cancelled = (await repo.cancelGuestRegistration(event.id, first.id, first.revision));
    assert.equal(cancelled.active, false);
    assert.deepEqual((await repo.cancelGuestRegistration(event.id, first.id, first.revision)), cancelled);
    assert.equal((await repo.getEventParticipation(event.id)).registrations.length, 0);
    assert.ok((await repo.addGuestRegistration(event.id, guest({ requestId: 're-register' }))).active);
  } finally {
    (await repo.close());
  }
});
