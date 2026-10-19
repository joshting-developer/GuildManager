import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { emptyLineup, editableLineup } from '../src/domain/lineups.js';
import { validateLineup } from '../src/domain/lineup-validation.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

test('empty first-round IDs normalize while invalid and dual identities report the exact position', () => {
  const teams = emptyLineup();
  delete teams[0].slots[0].uid;
  teams[0].slots[1].uid = '';
  const normalized = validateLineup(teams);
  assert.equal(normalized[0].slots[0].uid, null);
  assert.equal(normalized[0].slots[1].uid, null);
  const guestTeams = emptyLineup();
  guestTeams[0].slots[0].registrationId = 'guest';
  delete guestTeams[0].slots[0].uid;
  assert.equal(validateLineup(guestTeams)[0].slots[0].uid, null);
  assert.equal(validateLineup(guestTeams)[0].slots[0].registrationId, 'guest');
  for (const person of [
    { uid: 123, profession: 'primary' },
    { uid: 'member', registrationId: 'guest', profession: 'primary' },
    { uid: null, registrationId: 'invalid:id', profession: 'primary' },
    [],
  ]) {
    const invalid = emptyLineup();
    invalid[3].slots[4].secondRound = person;
    assert.throws(() => validateLineup(invalid), (error) =>
      error.code === 'LINEUP_INVALID' && error.message.includes('機動團') &&
      error.message.includes('第 5 位') && error.message.includes('第二場'));
  }
});

test('validation normalizes an empty second round without changing snapshots or position notes and duties', () => {
  const teams = emptyLineup();
  delete teams[0].slots[0].uid;
  teams[0].slots[0].secondRound = { uid: null, profession: 'secondary', member: { name: '舊快照' } };
  teams[0].slots[0].note = '位置備註';
  teams[0].slots[0].dutyIds = ['duty-bodyguard'];
  const before = structuredClone(teams);
  const draft = validateLineup(editableLineup(teams));
  assert.equal(draft[0].slots[0].uid, null);
  assert.equal(draft[0].slots[0].secondRound, null);
  assert.equal(draft[0].slots[0].note, '位置備註');
  assert.deepEqual(draft[0].slots[0].dutyIds, ['duty-bodyguard']);
  assert.doesNotThrow(() => validateLineup(draft));
  assert.deepEqual(teams, before);
});

function saveContract(api) {
  for (let i = 0; i < 48; i++) api.add({ uid: `demo-${i}`, name: `示範${i}`, primaryProfessionId: 1 });
  const event = api.event({ title: '空人員儲存', type: 'scrimmage', dates: ['2026-10-22'], requestId: 'empty-event' });
  const teams = emptyLineup();
  for (let i = 0; i < 48; i++) teams[Math.floor(i / 6)].slots[i % 6].uid = `demo-${i}`;
  teams[9].slots[0].secondRound = { uid: 'demo-47', profession: 'primary' };
  teams[7].slots[5].uid = null;
  delete teams[9].slots[1].uid;
  teams[9].slots[2].uid = '';
  const input = { eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'empty-save', teams };
  const first = api.confirm(input);
  assert.deepEqual(api.confirm(input), first);
  api.remove('demo-47', { revision: 1, requestId: 'remove-second', confirmUid: 'demo-47' });
  const history = api.history(event.id).versions[0];
  assert.equal(history.teams[9].slots[0].secondRound.uid, null);
  assert.equal(history.teams[9].slots[0].secondRound.member.name, '示範47');
  const draft = editableLineup(history.teams);
  const saved = api.confirm({ ...input, expectedVersion: 1, requestId: 'resave-empty', teams: draft });
  assert.ok(saved);
  assert.equal(api.history(event.id).versions[0].teams[9].slots[0].secondRound, null);
  assert.deepEqual(api.history(event.id).versions[1], history);
}

test('SQLite saves 48 people with blank positions and resaves after a second-round member deletion', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    saveContract({ add: repo.addMember, event: repo.createEvent, confirm: repo.confirmLineup,
      remove: repo.deleteMemberPermanently, history: repo.getLineupHistory });
  } finally { repo.close(); }
});

test('GAS uses the same empty-position and deleted-second-round save contract', async () => {
  const env = await gasRuntime();
  env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (name, args) => cloudResult(env.raw(name, args, context));
  saveContract({
    add: (input) => call('addMember', [input]),
    event: (input) => call('createEvent', [input]).event,
    confirm: (input) => call('confirmLineup', [input]).version,
    remove: (uid, input) => call('deleteMemberPermanently', [uid, input]),
    history: (id) => call('getLineupHistory', [id]),
  });
});
