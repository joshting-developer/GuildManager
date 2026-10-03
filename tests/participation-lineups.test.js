import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import {
  emptyLineup,
  participantKey,
  addMemberToSlot,
  placeMember,
  editableLineup,
} from '../src/domain/lineups.js';

const code = (value) => (error) => error.code === value;
function setup() {
  const repo = createRepository({ filename: ':memory:' });
  for (const [uid, isInGuild, isInClub] of [
    ['guild', true, true],
    ['club', false, true],
    ['outside', false, false],
  ]) {
    repo.addMember({ uid, name: uid, primaryProfessionId: 1, isInGuild, isInClub });
  }
  const events = ['scrimmage', 'guild_war', 'dragon_tiger'].map((type) =>
    repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type }),
  );
  const input = (event, teams, extra = {}) => ({
    eventId: event.id,
    eventRevision: event.revision,
    expectedVersion: 0,
    requestId: `confirm-${event.id}`,
    teams,
    ...extra,
  });
  return { repo, events, input };
}

test('three battle types accept guild/club and registered outsiders, reject leave, and recheck templates without mutating history', () => {
  const { repo, events, input } = setup();
  try {
    for (const event of events) {
      const teams = emptyLineup();
      teams[0].slots[0].uid = 'guild';
      teams[0].slots[1].uid = 'club';
      teams[0].slots[2].uid = 'outside';
      assert.throws(() => repo.confirmLineup(input(event, teams)), code('INELIGIBLE_MEMBER'));
      repo.saveMemberResponse(event.id, { uid: 'outside', status: 'registered', revision: 0 });
      const snapshot = repo.confirmLineup(input(event, teams));
      const template = repo.createLineupTemplate({
        teams,
        name: '名單',
        requestId: `template-${event.id}`,
      });
      repo.saveMemberResponse(event.id, { uid: 'guild', status: 'leave', revision: 0 });
      assert.throws(
        () =>
          repo.confirmLineup(
            input(event, teams, { expectedVersion: 1, requestId: `new-${event.id}` }),
          ),
        code('INELIGIBLE_MEMBER'),
      );
      const applied = repo.applyLineupTemplate(template.id, event.id);
      assert.equal(applied.teams[0].slots[0].uid, null);
      assert.equal(applied.teams[0].slots[1].uid, 'club');
      assert.equal(applied.skipped[0].reason, '本場已請假');
      assert.deepEqual(repo.getLineupHistory(event.id).versions[0], snapshot);
      assert.deepEqual(repo.confirmLineup(input(event, teams)), snapshot);
    }
  } finally {
    repo.close();
  }
});

test('guest references are UID-less, unique across rounds, scoped to their battle, and immutable after cancellation', () => {
  const { repo, events, input } = setup();
  try {
    const guest = repo.addGuestRegistration(events[0].id, {
      name: '外援',
      professionId: 3,
      note: '第二場才能到',
      requestId: 'guest',
    });
    const teams = emptyLineup();
    teams[0].slots[0].uid = 'guild';
    teams[0].slots[0].secondRound = { uid: null, registrationId: guest.id, profession: 'primary' };
    const snapshot = repo.confirmLineup(input(events[0], teams));
    const savedGuest = snapshot.teams[0].slots[0].secondRound.member;
    assert.equal(savedGuest.uid, null);
    assert.equal(savedGuest.registrationId, guest.id);
    assert.equal(savedGuest.note, '第二場才能到');
    assert.equal(savedGuest.primaryProfession.name, '碎夢');
    const template = repo.createLineupTemplate({ teams, name: '含外援', requestId: 'template' });
    assert.deepEqual(repo.applyLineupTemplate(template.id, events[0].id).teams, teams);
    const other = repo.applyLineupTemplate(template.id, events[1].id);
    assert.equal(other.teams[0].slots[0].uid, 'guild');
    assert.equal(other.teams[0].slots[0].secondRound, null);
    assert.match(other.skipped[0].reason, /不屬於本場/);
    assert.throws(() => repo.confirmLineup(input(events[1], teams)), code('INELIGIBLE_MEMBER'));
    const duplicate = structuredClone(teams);
    duplicate[0].slots[1] = { ...duplicate[0].slots[1], uid: null, registrationId: guest.id };
    assert.throws(
      () => repo.confirmLineup(input(events[1], duplicate)),
      code('DUPLICATE_LINEUP_UID'),
    );
    const invalid = structuredClone(teams);
    invalid[0].slots[0].secondRound.uid = 'guild';
    assert.throws(() => repo.confirmLineup(input(events[1], invalid)), code('LINEUP_INVALID'));
    repo.cancelGuestRegistration(events[0].id, guest.id, 1);
    assert.throws(
      () =>
        repo.confirmLineup(input(events[0], teams, { expectedVersion: 1, requestId: 'cancelled' })),
      code('INELIGIBLE_MEMBER'),
    );
    assert.equal(
      repo.applyLineupTemplate(template.id, events[0].id).teams[0].slots[0].secondRound,
      null,
    );
    assert.deepEqual(repo.getLineupHistory(events[0].id).versions[0], snapshot);
    assert.deepEqual(repo.confirmLineup(input(events[0], teams)), snapshot);
    assert.deepEqual(
      repo.getLineupIndex().templates.find((row) => row.id === template.id),
      template,
    );
  } finally {
    repo.close();
  }
});

test('guest first-round clearing, swaps and second-round moves preserve shared duties and notes', () => {
  const teams = emptyLineup();
  const key = participantKey({ registrationId: 'guest-id' });
  assert.ok(addMemberToSlot(teams, key, 'attack-1', 0));
  assert.equal(teams[0].slots[0].uid, null);
  assert.equal(teams[0].slots[0].registrationId, 'guest-id');
  teams[0].slots[0].note = '保鑣';
  teams[0].slots[0].dutyIds = ['duty'];
  assert.ok(addMemberToSlot(teams, participantKey({ uid: 'guild' }), 'attack-1', 0));
  assert.equal(teams[0].slots[0].secondRound.uid, 'guild');
  assert.equal(addMemberToSlot(teams, 'third', 'attack-1', 0), false);
  placeMember(teams, key, 'attack-1', 1);
  assert.equal(teams[0].slots[0].registrationId, undefined);
  assert.equal(teams[0].slots[1].registrationId, 'guest-id');
  assert.equal(teams[0].slots[0].note, '保鑣');
  assert.deepEqual(teams[0].slots[0].dutyIds, ['duty']);
  assert.deepEqual(editableLineup(teams), teams);
});
