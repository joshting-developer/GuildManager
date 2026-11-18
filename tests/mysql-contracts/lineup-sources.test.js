import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';
import { lineupPeople, lineupSourceMembers } from '../../src/domain/lineup-sources.js';
import { eligibleMember, emptyLineup, participantKey } from '../../src/domain/lineups.js';

test('source tabs retain leave at the bottom, list every 編外成員, keep 本場外援 to guests and do not duplicate dual membership', async () => {
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
    assert.deepEqual((await source('guild')).map(participantKey), ['member:guild-ready', 'member:guild-leave']);
    assert.deepEqual((await source('club')).map(participantKey), ['member:club-ready', 'member:club-leave']);
    // 編外成員 are listed whether or not they registered (registered first, leave last);
    // 本場外援 holds only UID-less guests.
    assert.deepEqual((await source('external')).map(participantKey), [
      'member:outside-ready', 'member:outside-none', 'member:outside-leave',
    ]);
    assert.ok(eligibleMember(people.find((person) => person.uid === 'outside-none'), type), 'unregistered 編外 can be arranged');
    assert.deepEqual((await source('extra')).map(participantKey), ['registration:guest-ready', 'registration:guest-leave']);
    assert.equal((await source('guild')).filter((person) => !person.isOnLeave).length, 1);
    assert.ok(people.filter((person) => person.isOnLeave).every((person) => !eligibleMember(person, type)));
  }
  assert.deepEqual(lineupSourceMembers(people, { type: 'activity', tab: 'guild' }), []);
  assert.equal(people.find((person) => person.registrationId === 'guest-leave').registrationNote, '加班');
  assert.deepEqual(members[0], { uid: 'guild-leave', isInGuild: true, isInClub: true });
});

test('MySQL participation keeps members and canceled guests visible without permitting lineup saves; cancel leave restores eligibility', async () => {
  const repo = (await createRepository());
  try {
    (await repo.addMember({ uid: 'guild', name: '示範成員', primaryProfessionId: 1, isInGuild: true }));
    const event = (await repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-19'], requestId: 'source-event' }));
    (await repo.saveMemberResponse(event.id, { uid: 'guild', status: 'leave', revision: 0, note: '晚班' }));
    const guest = (await repo.addGuestRegistration(event.id, { name: '示範外援', professionId: 3, requestId: 'source-guest' }));
    (await repo.cancelGuestRegistration(event.id, guest.id, guest.revision));
    const people = async () => lineupPeople((await repo.listMembers()).members, (await repo.getEventParticipation(event.id)));
    const source = async (tab) => lineupSourceMembers((await people()), { type: event.type, tab });
    assert.equal((await source('guild'))[0].isOnLeave, true);
    assert.equal((await source('extra'))[0].isOnLeave, true);
    for (const person of (await people())) {
      const teams = emptyLineup();
      Object.assign(teams[0].slots[0], { uid: person.uid, registrationId: person.registrationId });
      (await assert.rejects(async () => (await repo.confirmLineup({ eventId: event.id, eventRevision: event.revision,
        expectedVersion: 0, requestId: `save-${participantKey(person)}`.replaceAll(':', '-'), teams })),
      (error) => error.code === 'INELIGIBLE_MEMBER'));
    }
    const participation = (await repo.getEventParticipation(event.id));
    (await repo.cancelEventLeave(event.id, { source: 'member', id: 'guild', revision: participation.responses[0].revision }));
    assert.equal((await source('guild'))[0].isOnLeave, false);
    assert.equal(eligibleMember((await source('guild'))[0], event.type), true);
    (await repo.cancelEventLeave(event.id, { source: 'registration', id: guest.id, revision: participation.registrationLeaves[0].revision }));
    assert.equal((await source('extra'))[0].isOnLeave, false);
    assert.equal(eligibleMember((await source('extra'))[0], event.type), true);
    assert.equal((await source('extra')).length, 1);
  } finally {
    (await repo.close());
  }
});

test('older participation without registrationLeaves remains compatible', () => {
  assert.deepEqual(lineupPeople([], { responses: [], registrations: [] }), []);
});
