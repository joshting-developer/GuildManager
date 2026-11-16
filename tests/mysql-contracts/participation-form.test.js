import { asyncMap } from "../../server/mysql/collections.js";
import { test } from 'node:test';

import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { emptyLineup } from '../../src/domain/lineups.js';

const code = (value) => (error) => error.code === value;
async function setup() {
  const repo = (await createRepository());
  for (const [uid, name, isInGuild, isInClub] of [
    ['guild', '幫內成員', true, true],
    ['club', '俱樂部成員', false, true],
    ['outside', '編外成員', false, false],
  ])
    (await repo.addMember({ uid, name, primaryProfessionId: 1, isInGuild, isInClub }));
  const events = (await asyncMap(['scrimmage', 'guild_war', 'dragon_tiger'], async (type) =>
    (await repo.createEvent({
      title: type,
      type,
      dates: ['2026-10-24'],
      requestId: type,
    }))));
  let request = 0;
  const submit = async (name, status, extra = {}, event = events[0]) =>
    (await repo.submitParticipation(event.id, {
      name,
      status,
      note: '',
      professionId: 3,
      requestId: `form-${++request}`,
      revision: (await repo.getEventParticipation(event.id)).revision,
      ...extra,
    }));
  return { repo, events, submit };
}

test('name form links members, rejects unknown leave and unregistered outsiders, and scopes responses to each battle', async () => {
  const { repo, events, submit } = (await setup());
  try {
    for (const event of events) {
      for (const name of ['沒有這個人', '編外成員']) {
        (await assert.rejects(async () => (await submit(name, 'leave', {}, event)), code('PARTICIPATION_NOT_FOUND')));
      }
      assert.equal((await repo.getEventParticipation(event.id)).responses.length, 0);
      (await submit(' 幫內成員 ', 'leave', { professionId: null, note: '晚到' }, event));
      (await submit('俱樂部成員', 'leave', { professionId: null }, event));
      (await submit('編外成員', 'registered', {}, event));
      (await submit('編外成員', 'leave', {}, event));
      const rows = (await repo.getEventParticipation(event.id));
      assert.equal(rows.registrations.length, 0);
      assert.equal(rows.responses.length, 3);
      assert.ok(rows.responses.every((row) => row.status === 'leave'));
      assert.equal(rows.responses.find((row) => row.uid === 'guild').note, '晚到');
      (await submit('幫內成員', 'registered', {}, event));
      assert.equal(
        (await repo.getEventParticipation(event.id)).responses.find((row) => row.uid === 'guild').status,
        'registered',
      );
      assert.equal(
        (await repo.listMembers()).members.find((row) => row.uid === 'guild').primaryProfessionId,
        1,
      );
    }
    assert.equal((await repo.listMembers()).members.length, 3);
    (await assert.rejects(async () => (await submit('新外援', 'none')), code('PARTICIPATION_INVALID')));
    (await assert.rejects(
      async () => (await submit('新外援', 'registered', { professionId: 99 })),
      code('PARTICIPATION_INVALID'),
    ));
    (await assert.rejects(
      async () => (await submit('新外援', 'leave', {}, { id: 'missing' })),
      code('EVENT_UNAVAILABLE'),
    ));
  } finally {
    (await repo.close());
  }
});

test('guest leave retains identity, removes lineup eligibility and preserves snapshots; re-registration restores one entry', async () => {
  const { repo, events, submit } = (await setup());
  const event = events[0];
  try {
    (await submit('外援', 'registered', { note: '山盟' }));
    const guest = (await repo.getEventParticipation(event.id)).registrations[0];
    assert.equal(guest.uid, undefined);
    const teams = emptyLineup();
    teams[0].slots[0].registrationId = guest.id;
    const snapshot = (await repo.confirmLineup({
      eventId: event.id,
      eventRevision: 1,
      expectedVersion: 0,
      requestId: 'snapshot',
      teams,
    }));
    const template = (await repo.createLineupTemplate({ name: '範本', requestId: 'template', teams }));
    (await submit('外援', 'leave', { note: '不能來', professionId: null }));
    const leave = (await repo.getEventParticipation(event.id));
    assert.equal(leave.registrations.length, 0);
    assert.equal(leave.registrationLeaves[0].id, guest.id);
    assert.equal(leave.registrationLeaves[0].note, '不能來');
    assert.equal(
      (await repo.applyLineupTemplate(template.id, event.id)).teams[0].slots[0].registrationId,
      undefined,
    );
    (await assert.rejects(
      async () =>
        (await repo.confirmLineup({
          eventId: event.id,
          eventRevision: 1,
          expectedVersion: 1,
          requestId: 'invalid',
          teams,
        })),
      code('INELIGIBLE_MEMBER'),
    ));
    assert.deepEqual((await repo.getLineupHistory(event.id)).versions[0], snapshot);
    (await assert.rejects(async () => (await submit('外援', 'leave', {}, events[1])), code('PARTICIPATION_NOT_FOUND')));
    (await submit('外援', 'registered', { professionId: 4, note: '改打潮光' }));
    const restored = (await repo.getEventParticipation(event.id));
    assert.equal(restored.registrations.length, 1);
    assert.equal(restored.registrations[0].id, guest.id);
    assert.equal(restored.registrations[0].profession, '潮光');
    assert.equal(restored.registrationLeaves.length, 0);
    assert.equal(
      (await repo.applyLineupTemplate(template.id, event.id)).teams[0].slots[0].registrationId,
      guest.id,
    );
    assert.deepEqual((await repo.getLineupHistory(event.id)).versions[0], snapshot);
  } finally {
    (await repo.close());
  }
});

test('retries never reverse a newer leave and stale submissions or ambiguous names cannot mutate records', async () => {
  const { repo, events, submit } = (await setup());
  const event = events[0];
  try {
    const input = {
      name: '外援',
      status: 'registered',
      professionId: 3,
      note: '',
      requestId: 'retry',
      revision: (await repo.getEventParticipation(event.id)).revision,
    };
    const receipt = (await repo.submitParticipation(event.id, input));
    assert.deepEqual((await repo.submitParticipation(event.id, input)), receipt);
    (await assert.rejects(
      async () => (await repo.submitParticipation(event.id, { ...input, requestId: 'stale', status: 'leave' })),
      code('PARTICIPATION_CHANGED'),
    ));
    (await submit('外援', 'leave'));
    assert.deepEqual((await repo.submitParticipation(event.id, input)), receipt);
    assert.equal((await repo.getEventParticipation(event.id)).registrations.length, 0);
    (await assert.rejects(
      async () => (await repo.submitParticipation(event.id, { ...input, name: '另一人' })),
      code('REQUEST_CONFLICT'),
    ));
    (await repo.addMember({ uid: 'duplicate', name: '幫內成員', primaryProfessionId: 1 }));
    const before = (await repo.getEventParticipation(event.id));
    (await assert.rejects(async () => (await submit('幫內成員', 'leave')), code('PARTICIPATION_AMBIGUOUS')));
    assert.deepEqual((await repo.getEventParticipation(event.id)), before);
    (await repo.addGuestRegistration(event.id, {
      name: '俱樂部成員',
      professionId: 1,
      requestId: 'legacy',
    }));
    (await assert.rejects(async () => (await submit('俱樂部成員', 'leave')), code('PARTICIPATION_AMBIGUOUS')));
  } finally {
    (await repo.close());
  }
});

test('member registrations retain their selected battle profession without changing the roster or saved lineup', async () => {
  const { repo, events, submit } = (await setup());
  const event = events[0];
  try {
    const teams = emptyLineup();
    teams[0].slots[0].uid = 'guild';
    const snapshot = (await repo.confirmLineup({
      eventId: event.id,
      eventRevision: 1,
      expectedVersion: 0,
      requestId: 'profession-snapshot',
      teams,
    }));
    (await submit('幫內成員', 'registered', { professionId: 3 }));
    const row = async () =>
      (await repo.getEventParticipation(event.id)).responses.find((response) => response.uid === 'guild');
    assert.equal((await row()).professionId, 3);
    assert.equal((await row()).profession, '碎夢');
    assert.equal(
      (await repo.listMembers()).members.find((member) => member.uid === 'guild').primaryProfessionId,
      1,
    );
    (await submit('幫內成員', 'leave', { professionId: null }));
    assert.equal((await row()).status, 'leave');
    assert.equal((await row()).professionId, 3);
    (await submit('幫內成員', 'registered', { professionId: 4 }));
    assert.equal((await row()).professionId, 4);
    assert.equal((await row()).profession, '潮光');
    assert.equal((await repo.getEventParticipation(events[1].id)).responses.length, 0);
    assert.deepEqual((await repo.getLineupHistory(event.id)).versions[0], snapshot);
    const input = {
      uid: 'guild',
      status: 'registered',
      note: '',
      professionId: 2,
      revision: (await row()).revision,
    };
    const saved = (await repo.saveMemberResponse(event.id, input));
    assert.deepEqual((await repo.saveMemberResponse(event.id, input)), saved);
    (await assert.rejects(
      async () => (await repo.saveMemberResponse(event.id, { ...input, professionId: 3 })),
      code('PARTICIPATION_CHANGED'),
    ));
    (await assert.rejects(
      async () => (await repo.saveMemberResponse(event.id, { ...input, professionId: 99 })),
      code('PARTICIPATION_INVALID'),
    ));
    assert.equal((await row()).professionId, 2);
  } finally {
    (await repo.close());
  }
});
