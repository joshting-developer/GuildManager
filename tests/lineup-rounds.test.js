import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import {
  emptyLineup,
  addMemberToSlot,
  placeMember,
  slotAssignments,
  editableLineup,
} from '../src/domain/lineups.js';

function setup() {
  const repo = createRepository({ filename: ':memory:' });
  for (const uid of ['001', '002', '003'])
    repo.addMember({
      uid,
      name: `原名${uid}`,
      primaryProfessionId: 1,
      secondaryProfessionId: uid === '003' ? null : 2,
      isInGuild: uid !== '002',
      isInClub: true,
    });
  const event = repo.createEvent({
    title: '分場約戰',
    type: 'scrimmage',
    dates: ['2026-10-24'],
    requestId: 'round-event',
  });
  const teams = emptyLineup();
  teams[0].slots[0].uid = '001';
  teams[0].slots[0].secondRound = { uid: '002', profession: 'secondary' };
  teams[0].slots[0].note = '位置共用備註';
  const input = {
    eventId: event.id,
    eventRevision: 1,
    expectedVersion: 0,
    requestId: 'round-confirm',
    teams,
  };
  return { repo, event, teams, input };
}
const code = (expected) => (e) => e.code === expected;

test('drag merges two rounds, deduplicates and refuses a third without mutating or losing the source', () => {
  const teams = emptyLineup();
  const first = teams[0].slots[0],
    source = teams[0].slots[1];
  Object.assign(first, { uid: '001', note: '前塔', dutyIds: ['duty-bodyguard'] });
  Object.assign(source, { uid: '002', profession: 'secondary', note: '來源備註' });
  assert.equal(addMemberToSlot(teams, '002', 'attack-1', 0), true);
  assert.equal(first.uid, '001');
  assert.deepEqual(first.secondRound, { uid: '002', profession: 'secondary' });
  assert.equal(source.uid, null);
  assert.equal(source.note, '來源備註');
  assert.equal(first.note, '前塔');
  assert.deepEqual(first.dutyIds, ['duty-bodyguard']);
  assert.equal(addMemberToSlot(teams, '002', 'attack-1', 0), true);
  source.uid = '003';
  const before = JSON.stringify(teams);
  assert.equal(addMemberToSlot(teams, '003', 'attack-1', 0), false);
  assert.equal(JSON.stringify(teams), before);
  assert.equal(addMemberToSlot(teams, '002', 'defense-4', 5), true);
  assert.equal(first.secondRound, null);
  assert.equal(teams[9].slots[5].uid, '002');
  assert.equal(teams[9].slots[5].profession, 'secondary');
  placeMember(teams, '001', 'defense-4', 5, 1);
  assert.equal(first.uid, '002');
  assert.equal(first.profession, 'secondary');
  assert.equal(
    teams.flatMap((t) => t.slots.flatMap(slotAssignments)).filter((p) => p.uid === '001').length,
    1,
  );
});

test('both rounds are validated for duplicates, eligibility, profession and exact two-person shape', () => {
  const { repo, teams, input } = setup();
  try {
    teams[0].slots[0].secondRound.uid = '001';
    assert.throws(() => repo.confirmLineup(input), code('DUPLICATE_LINEUP_UID'));
    teams[0].slots[0].secondRound.uid = '002';
    teams[0].slots[1].uid = '002';
    assert.throws(() => repo.confirmLineup(input), code('DUPLICATE_LINEUP_UID'));
    teams[0].slots[1].uid = null;
    for (const invalid of [
      { uid: null, profession: 'primary' },
      [],
      { uid: 42, profession: 'primary' },
      { uid: '002', profession: 'third' },
    ]) {
      teams[0].slots[0].secondRound = invalid;
      assert.throws(() => repo.confirmLineup(input), code('LINEUP_INVALID'));
    }
    teams[0].slots[0].secondRound = { uid: '003', profession: 'secondary' };
    assert.throws(() => repo.confirmLineup(input), code('LINEUP_INVALID'));
    teams[0].slots[0].secondRound = { uid: 'missing', profession: 'primary' };
    assert.throws(() => repo.confirmLineup(input), code('INELIGIBLE_MEMBER'));
    teams[0].slots[0].secondRound = { uid: '002', profession: 'primary' };
    const guild = repo.createEvent({
      title: '分場幫戰',
      type: 'guild_war',
      dates: ['2026-10-25'],
      requestId: 'round-guild',
    });
    assert.throws(
      () => repo.confirmLineup({ ...input, eventId: guild.id }),
      code('INELIGIBLE_MEMBER'),
    );
    assert.equal(repo.getLineupHistory(input.eventId).versions.length, 0);
    assert.equal(repo.getLineupHistory(guild.id).versions.length, 0);
  } finally {
    repo.close();
  }
});

test('second round snapshots are immutable and retryable, templates preserve both people and skip only ineligible assignments', () => {
  const { repo, event, teams, input } = setup();
  try {
    const version = repo.confirmLineup(input);
    assert.equal(version.teams[0].slots[0].secondRound.member.name, '原名002');
    assert.equal(version.teams[0].slots[0].secondRound.member.secondaryProfession.name, '龍吟');
    assert.deepEqual(repo.confirmLineup(input), version);
    const template = repo.createLineupTemplate({
      name: '雙場配置',
      teams,
      requestId: 'round-template',
    });
    const player = repo.listMembers().members.find((m) => m.uid === '002');
    repo.updateMember('002', {
      name: '修改後名字',
      primaryProfessionId: 9,
      secondaryProfessionId: 2,
      isInGuild: false,
      isInClub: true,
      revision: player.revision,
    });
    assert.deepEqual(repo.getLineupHistory(event.id).versions[0], version);
    assert.deepEqual(repo.confirmLineup(input), version);
    const applied = repo.applyLineupTemplate(template.id, event.id);
    assert.deepEqual(applied.teams, editableLineup(teams));
    const guild = repo.createEvent({
      title: '另一場幫戰',
      type: 'guild_war',
      dates: ['2026-10-25'],
      requestId: 'round-template-guild',
    });
    const skipped = repo.applyLineupTemplate(template.id, guild.id);
    assert.equal(skipped.teams[0].slots[0].uid, '001');
    assert.equal(skipped.teams[0].slots[0].secondRound, null);
    assert.equal(skipped.teams[0].slots[0].note, '位置共用備註');
    assert.deepEqual(
      skipped.skipped.map((p) => [p.uid, p.name, p.round]),
      [['002', '原名002', 2]],
    );
    assert.deepEqual(repo.getLineupIndex().templates[0], template);
    teams[0].slots[0].secondRound.profession = 'primary';
    assert.throws(() => repo.confirmLineup(input), code('REQUEST_CONFLICT'));
  } finally {
    repo.close();
  }
});
