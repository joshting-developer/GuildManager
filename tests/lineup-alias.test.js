import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editableLineup,
  emptyLineup,
  placeMember,
  removeFromSlot,
  restoreToSlot,
} from '../src/domain/lineups.js';
import { validateLineup } from '../src/domain/lineup-validation.js';
import { lineupImageData } from '../src/domain/lineup-image.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

function lineup() {
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: 'a', profession: 'primary', alias: '小白' });
  teams[0].slots[0].secondRound = { uid: 'b', profession: 'primary', alias: '阿黑' };
  Object.assign(teams[0].slots[1], { uid: 'c', profession: 'primary' });
  return teams;
}

test('nicknames are optional, trimmed, at most 20 characters and dropped from empty positions', () => {
  const saved = validateLineup(lineup());
  assert.equal(saved[0].slots[0].alias, '小白');
  assert.equal(saved[0].slots[0].secondRound.alias, '阿黑');
  assert.equal('alias' in saved[0].slots[1], false);
  const padded = lineup();
  padded[0].slots[0].alias = '  小白  ';
  assert.equal(validateLineup(padded)[0].slots[0].alias, '小白');
  const blank = lineup();
  blank[0].slots[0].alias = '   ';
  assert.equal('alias' in validateLineup(blank)[0].slots[0], false);
  const orphan = emptyLineup();
  orphan[0].slots[3].alias = '沒人';
  assert.equal('alias' in validateLineup(orphan)[0].slots[3], false, 'an empty seat keeps no nickname');
  for (const alias of ['一'.repeat(21), '換\n行', 42]) {
    const bad = lineup();
    bad[0].slots[0].alias = alias;
    assert.throws(() => validateLineup(bad), /小名/);
  }
  assert.equal(editableLineup(saved)[0].slots[0].secondRound.alias, '阿黑');
});

test('a nickname travels with its person when moved, swapped, removed and restored', () => {
  const teams = lineup();
  const [team] = teams;
  placeMember(teams, 'member:a', team.id, 1);
  assert.equal(team.slots[1].uid, 'a');
  assert.equal(team.slots[1].alias, '小白', 'moved person keeps their nickname');
  assert.equal(team.slots[0].uid, 'c');
  assert.equal(team.slots[0].alias, undefined, 'the swapped person had none');
  const removed = removeFromSlot(teams, team.id, 1, 1);
  assert.equal(removed.alias, '小白');
  assert.equal(team.slots[1].alias, undefined);
  assert.equal(restoreToSlot(teams, team.id, 1, 1, removed), true);
  assert.equal(team.slots[1].alias, '小白');
  removeFromSlot(teams, team.id, 0, 2);
  assert.equal(team.slots[0].secondRound, null);
});

test('the exported image shows the nickname instead of the real name', () => {
  const teams = lineup();
  const data = lineupImageData({
    event: { type: 'scrimmage', title: '', dates: ['2026-10-24'] },
    teams, status: '已儲存', snapshots: false, theme: 'light',
    members: [
      { uid: 'a', name: '本名甲', primaryProfessionId: 1 },
      { uid: 'b', name: '本名乙', primaryProfessionId: 1 },
      { uid: 'c', name: '本名丙', primaryProfessionId: 1 },
    ],
    professions: [{ job_id: 1, name: '素問', colorcode: '#ffb6c1' }],
    duties: [],
  });
  const people = data.groups[0].teams[0].rows[0].people;
  assert.deepEqual(people.map((person) => person.name), ['小白', '阿黑']);
  assert.equal(data.groups[0].teams[0].rows[1].people[0].name, '本名丙');
  assert.ok(!JSON.stringify(data).includes('本名甲'), 'the real name is not in the image data');
});

test('GAS keeps nicknames in saved lineup versions', async () => {
  const env = await gasRuntime();
  env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  call('addMember', [{ uid: '0001', name: '本名', primaryProfessionId: 3, isInGuild: true, isInClub: false }]);
  const event = call('createEvent', [{ type: 'guild_war', title: '', dates: ['2026-10-04'], requestId: 'war' }]).events[0];
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: '0001', profession: 'primary', alias: '阿本' });
  const version = call('confirmLineup', [{ teams, eventId: event.id, eventRevision: 1, expectedVersion: 0, requestId: 'alias' }]).version;
  assert.equal(version.teams[0].slots[0].alias, '阿本');
  assert.equal(version.teams[0].slots[0].member.name, '本名');
  assert.equal(call('getLineupHistory', [event.id]).versions[0].teams[0].slots[0].alias, '阿本');
});

test('SQLite keeps nicknames in saved lineup versions and history', async () => {
  const { createRepository } = await import('../server/repository.js');
  const repo = createRepository({ filename: ':memory:' });
  try {
    repo.addMember({ uid: '0001', name: '本名', primaryProfessionId: 1, isInGuild: true });
    const event = repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-24'], requestId: 'war' });
    const teams = emptyLineup();
    Object.assign(teams[0].slots[0], { uid: '0001', profession: 'primary', alias: '阿本' });
    const saved = repo.confirmLineup({ eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'alias', teams });
    assert.equal(saved.teams[0].slots[0].alias, '阿本');
    assert.equal(repo.getLineupHistory(event.id).versions[0].teams[0].slots[0].alias, '阿本');
  } finally {
    repo.close();
  }
});
