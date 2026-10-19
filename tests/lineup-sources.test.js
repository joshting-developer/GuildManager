import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { lineupPeople, lineupSourceMembers } from '../src/domain/lineup-sources.js';
import { eligibleMember, emptyLineup, participantKey } from '../src/domain/lineups.js';

test('source tabs retain leave at the bottom, hide assigned eligible people, and do not duplicate dual membership', () => {
  const members = [
    { uid: 'guild-leave', isInGuild: true, isInClub: true },
    { uid: 'guild-ready', isInGuild: true },
    { uid: 'guild-assigned', isInGuild: true },
    { uid: 'club-leave', isInClub: true },
    { uid: 'club-ready', isInClub: true },
    { uid: 'outside-leave' },
    { uid: 'outside-ready' },
    { uid: 'outside-none' },
  ];
  const participation = {
    responses: [
      ...['guild-leave', 'club-leave', 'outside-leave'].map((uid) => ({ uid, status: 'leave', note: '晚班' })),
      { uid: 'outside-ready', status: 'registered' },
    ],
    registrations: [{ id: 'guest-ready', name: '外援', professionId: 3 }],
    registrationLeaves: [{ id: 'guest-leave', name: '請假外援', professionId: 1, note: '加班' }],
  };
  const people = lineupPeople(members, participation);
  const assigned = new Set(['member:guild-assigned', 'member:guild-leave']);
  for (const type of ['scrimmage', 'guild_war', 'dragon_tiger']) {
    const source = (tab) => lineupSourceMembers(people, { type, tab, assigned });
    assert.deepEqual(source('guild').map(participantKey), ['member:guild-ready', 'member:guild-leave']);
    assert.deepEqual(source('club').map(participantKey), ['member:club-ready', 'member:club-leave']);
    assert.deepEqual(source('extra').map(participantKey), [
      'member:outside-ready', 'registration:guest-ready', 'member:outside-leave', 'registration:guest-leave',
    ]);
    assert.equal(source('guild').filter((person) => !person.isOnLeave).length, 1);
    assert.ok(people.filter((person) => person.isOnLeave).every((person) => !eligibleMember(person, type)));
  }
  assert.deepEqual(lineupSourceMembers(people, { type: 'activity', tab: 'guild' }), []);
  assert.equal(people.find((person) => person.registrationId === 'guest-leave').registrationNote, '加班');
  assert.deepEqual(members[0], { uid: 'guild-leave', isInGuild: true, isInClub: true });
});

test('SQLite participation keeps members and canceled guests visible without permitting lineup saves; cancel leave restores eligibility', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    repo.addMember({ uid: 'guild', name: '示範成員', primaryProfessionId: 1, isInGuild: true });
    const event = repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-19'], requestId: 'source-event' });
    repo.saveMemberResponse(event.id, { uid: 'guild', status: 'leave', revision: 0, note: '晚班' });
    const guest = repo.addGuestRegistration(event.id, { name: '示範外援', professionId: 3, requestId: 'source-guest' });
    repo.cancelGuestRegistration(event.id, guest.id, guest.revision);
    const people = () => lineupPeople(repo.listMembers().members, repo.getEventParticipation(event.id));
    const source = (tab) => lineupSourceMembers(people(), { type: event.type, tab });
    assert.equal(source('guild')[0].isOnLeave, true);
    assert.equal(source('extra')[0].isOnLeave, true);
    for (const person of people()) {
      const teams = emptyLineup();
      Object.assign(teams[0].slots[0], { uid: person.uid, registrationId: person.registrationId });
      assert.throws(() => repo.confirmLineup({ eventId: event.id, eventRevision: event.revision,
        expectedVersion: 0, requestId: `save-${participantKey(person)}`.replaceAll(':', '-'), teams }),
      (error) => error.code === 'INELIGIBLE_MEMBER');
    }
    const participation = repo.getEventParticipation(event.id);
    repo.cancelEventLeave(event.id, { source: 'member', id: 'guild', revision: participation.responses[0].revision });
    assert.equal(source('guild')[0].isOnLeave, false);
    assert.equal(eligibleMember(source('guild')[0], event.type), true);
    repo.cancelEventLeave(event.id, { source: 'registration', id: guest.id, revision: participation.registrationLeaves[0].revision });
    assert.equal(source('extra')[0].isOnLeave, false);
    assert.equal(eligibleMember(source('extra')[0], event.type), true);
    assert.equal(source('extra').length, 1);
  } finally {
    repo.close();
  }
});

test('older participation without registrationLeaves remains compatible', () => {
  assert.deepEqual(lineupPeople([], { responses: [], registrations: [] }), []);
});
