import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLineup,
  participantKey,
  placeMember,
  removeFromSlot,
  restoreToSlot,
  slotAssignments,
} from '../src/domain/lineups.js';

function lineup() {
  const teams = emptyLineup();
  const slot = teams[0].slots[2];
  Object.assign(slot, { uid: 'a', profession: 'secondary', note: '拆塔', dutyIds: ['duty'] });
  slot.secondRound = { uid: null, registrationId: 'guest', profession: 'primary' };
  return teams;
}
const keys = (teams) => teams.flatMap((team) => team.slots.flatMap(slotAssignments)).map(participantKey).filter(Boolean);

test('removing one round clears only that person and keeps the position duties and note', () => {
  const teams = lineup();
  const teamId = teams[0].id;
  assert.deepEqual(removeFromSlot(teams, teamId, 2, 2), { key: 'registration:guest', profession: 'primary' });
  assert.equal(teams[0].slots[2].secondRound, null);
  assert.equal(teams[0].slots[2].uid, 'a', 'first round stays');
  assert.deepEqual(removeFromSlot(teams, teamId, 2, 1), { key: 'member:a', profession: 'secondary' });
  const slot = teams[0].slots[2];
  assert.equal(participantKey(slot), null);
  assert.equal(slot.registrationId, undefined);
  assert.equal(slot.note, '拆塔');
  assert.deepEqual(slot.dutyIds, ['duty']);
  assert.deepEqual(keys(teams), []);
  assert.equal(removeFromSlot(teams, teamId, 2, 1), null, 'an empty round has nothing to remove');
  assert.equal(removeFromSlot(teams, 'missing', 0, 1), null);
});

test('removing the first round of a double position keeps the second round person', () => {
  const teams = lineup();
  removeFromSlot(teams, teams[0].id, 2, 1);
  assert.equal(participantKey(teams[0].slots[2]), null);
  assert.equal(participantKey(teams[0].slots[2].secondRound), 'registration:guest');
});

test('undo restores the same person and profession only while the round is still free', () => {
  const teams = lineup();
  const teamId = teams[0].id;
  const removed = removeFromSlot(teams, teamId, 2, 1);
  assert.equal(restoreToSlot(teams, teamId, 2, 1, removed), true);
  assert.equal(participantKey(teams[0].slots[2]), 'member:a');
  assert.equal(teams[0].slots[2].profession, 'secondary');

  const again = removeFromSlot(teams, teamId, 2, 1);
  placeMember(teams, 'member:a', teams[1].id, 0);
  assert.equal(restoreToSlot(teams, teamId, 2, 1, again), false, 'already placed elsewhere');
  assert.equal(keys(teams).filter((key) => key === 'member:a').length, 1);

  const guest = removeFromSlot(teams, teamId, 2, 2);
  placeMember(teams, 'member:b', teamId, 2, 2);
  assert.equal(restoreToSlot(teams, teamId, 2, 2, guest), false, 'round filled by someone else');
  assert.equal(participantKey(teams[0].slots[2].secondRound), 'member:b');
});
