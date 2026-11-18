import test from 'node:test';
import assert from 'node:assert/strict';

import { memberChoices } from '../../src/domain/member-choices.js';

const members = [
  { uid: 'a', name: '主職', primaryProfessionId: 1, secondaryProfessionId: 2, isInGuild: true, isInClub: false },
  { uid: 'b', name: '副職', primaryProfessionId: 3, secondaryProfessionId: 1, isInGuild: true, isInClub: true },
  { uid: 'c', name: '雙同', primaryProfessionId: 1, secondaryProfessionId: 1, isInGuild: false, isInClub: true },
  { uid: 'd', name: '無副', primaryProfessionId: 2, secondaryProfessionId: null, isInGuild: true, isInClub: true },
  { uid: 'a', name: '主職', primaryProfessionId: 1, secondaryProfessionId: 2, isInGuild: true, isInClub: false },
];
const uids = (source, professionId) => memberChoices(members, source, professionId).map((member) => member.uid);

test('member choices match primary or secondary profession once per UID within the chosen roster', () => {
  assert.deepEqual(uids('guild', 1), ['a', 'b']);
  assert.deepEqual(uids('club', 1), ['b', 'c']);
  assert.deepEqual(uids('guild', 2), ['a', 'd']);
  assert.deepEqual(uids('club', 2), ['d']);
});

test('member choices stay empty without a profession or when nobody matches', () => {
  assert.deepEqual(uids('guild', null), []);
  assert.deepEqual(uids('guild', 9), []);
  assert.deepEqual(uids('manual', 1), []);
});
