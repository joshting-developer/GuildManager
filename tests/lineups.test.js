import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createLineupClient } from '../src/api/lineups.js';
import { emptyLineup, placeMember } from '../src/domain/lineups.js';
const member = (uid, flags = {}) => ({
  uid,
  name: `名字${uid}`,
  primaryProfessionId: 1,
  secondaryProfessionId: 2,
  isInGuild: false,
  isInClub: false,
  ...flags,
});
function memberEdit({
  name,
  primaryProfessionId,
  secondaryProfessionId,
  isInGuild,
  isInClub,
  revision,
}) {
  return { name, primaryProfessionId, secondaryProfessionId, isInGuild, isInClub, revision };
}
function setup(filename = ':memory:') {
  const repo = createRepository({ filename });
  repo.addMember(member('001', { isInGuild: true }));
  repo.addMember(member('002', { isInClub: true }));
  repo.addMember(member('003'));
  const events = ['scrimmage', 'guild_war', 'dragon_tiger'].map((type) =>
    repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type }),
  );
  repo.saveMemberResponse(events[0].id, { uid: '003', status: 'registered', revision: 0 });
  return { repo, events };
}
function input(event, uid = '001', extra = {}) {
  const teams = emptyLineup();
  teams[0].slots[0].uid = uid;
  return {
    eventId: event.id,
    eventRevision: event.revision,
    expectedVersion: 0,
    requestId: `confirm-${event.id}`,
    teams,
    ...extra,
  };
}
const errorCode = (code) => (error) => error.code === code;
test('lineups enforce source membership, unique UID, fixed layout and valid secondary professions', () => {
  const { repo, events } = setup();
  try {
    assert.equal(
      repo.confirmLineup(input(events[0], '003')).teams[0].slots[0].member.name,
      '名字003',
    );
    repo.saveMemberResponse(events[1].id, { uid: '002', status: 'leave', revision: 0 });
    assert.throws(
      () => repo.confirmLineup(input(events[1], '002')),
      errorCode('INELIGIBLE_MEMBER'),
    );
    repo.saveMemberResponse(events[2].id, { uid: '001', status: 'leave', revision: 0 });
    assert.throws(
      () => repo.confirmLineup(input(events[2], '001')),
      errorCode('INELIGIBLE_MEMBER'),
    );
    repo.confirmLineup(input(events[1]));
    repo.confirmLineup(input(events[2], '002'));
    const duplicate = input(events[0], '001', { requestId: 'duplicate', expectedVersion: 1 });
    duplicate.teams[9].slots[5].uid = '001';
    assert.throws(() => repo.confirmLineup(duplicate), errorCode('DUPLICATE_LINEUP_UID'));
    const bad = input(events[0], 'missing', { requestId: 'missing', expectedVersion: 1 });
    assert.throws(() => repo.confirmLineup(bad), errorCode('INELIGIBLE_MEMBER'));
    bad.teams.pop();
    assert.throws(() => repo.confirmLineup(bad), errorCode('LINEUP_INVALID'));
    const current = repo.listMembers().members.find((m) => m.uid === '001');
    repo.updateMember('001', { ...memberEdit(current), secondaryProfessionId: null });
    const noJob = input(events[0], '001', { requestId: 'job', expectedVersion: 1 });
    noJob.teams[0].slots[0].profession = 'secondary';
    assert.throws(() => repo.confirmLineup(noJob), errorCode('LINEUP_INVALID'));
    assert.equal(repo.getLineupHistory(events[0].id).versions.length, 1);
  } finally {
    repo.close();
  }
});
test('immutable snapshots survive rename, job change, new versions and event deletion; retries do not duplicate', () => {
  const { repo, events } = setup();
  try {
    const payload = input(events[0]);
    payload.teams[0].slots[0].note = '塔前炮';
    const first = repo.confirmLineup(payload);
    assert.deepEqual(repo.confirmLineup(payload), first);
    assert.throws(
      () => repo.confirmLineup({ ...payload, teams: emptyLineup() }),
      errorCode('REQUEST_CONFLICT'),
    );
    assert.throws(
      () => repo.confirmLineup({ ...payload, requestId: 'stale' }),
      errorCode('LINEUP_CONFLICT'),
    );
    repo.updateMember('001', {
      ...memberEdit(repo.listMembers().members.find((m) => m.uid === '001')),
      name: '後來名稱',
      primaryProfessionId: 9,
    });
    assert.deepEqual(repo.confirmLineup(payload), first);
    const second = repo.confirmLineup({ ...payload, requestId: 'new-version', expectedVersion: 1 });
    assert.equal(second.version, 2);
    assert.equal(second.teams[0].slots[0].member.name, '後來名稱');
    assert.equal(second.teams[0].slots[0].member.primaryProfession.name, '神相');
    assert.equal(first.teams[0].slots[0].member.primaryProfession.colorcode, '#ffb6c1');
    repo.deleteEvent(events[0].id, 1);
    assert.deepEqual(repo.getLineupHistory(events[0].id).versions, [second, first]);
    assert.equal(repo.getLineupIndex().events.find((e) => e.id === events[0].id).archived, true);
    assert.deepEqual(repo.confirmLineup(payload), first);
    assert.throws(
      () => repo.confirmLineup({ ...payload, requestId: 'deleted', expectedVersion: 2 }),
      errorCode('EVENT_UNAVAILABLE'),
    );
  } finally {
    repo.close();
  }
});
test('templates resolve current eligibility and professions, disclose skipped people, and remain reusable across events', () => {
  const { repo, events } = setup();
  try {
    const teams = emptyLineup();
    teams[0].slots[0].uid = '001';
    teams[0].slots[1].uid = '002';
    teams[0].slots[2].uid = '003';
    teams[0].slots[0].note = '御拆';
    teams[0].name = '前線隊';
    const payload = { name: '常用名單', teams, requestId: 'template1' };
    const template = repo.createLineupTemplate(payload);
    assert.deepEqual(repo.createLineupTemplate(payload), template);
    assert.throws(
      () => repo.createLineupTemplate({ ...payload, name: '改名' }),
      errorCode('REQUEST_CONFLICT'),
    );
    // 003 is 編外 and registered only for the scrimmage; 編外 no longer need to register,
    // so only leave makes a template skip them.
    repo.saveMemberResponse(events[1].id, { uid: '003', status: 'leave', revision: 0 });
    const guild = repo.applyLineupTemplate(template.id, events[1].id);
    assert.equal(guild.teams[0].slots[0].uid, '001');
    assert.equal(guild.teams[0].slots[0].note, '御拆');
    assert.deepEqual(
      guild.skipped.map((s) => s.uid),
      ['003'],
    );
    assert.equal(repo.applyLineupTemplate(template.id, events[2].id).teams[0].slots[1].uid, '002');
    assert.equal(repo.applyLineupTemplate(template.id, events[0].id).skipped.length, 0);
    repo.removeMember('001', 1);
    assert.equal(
      repo.applyLineupTemplate(template.id, events[1].id).skipped.length,
      1,
      'moving 001 to 編外 keeps them eligible',
    );
    const original = repo.getLineupIndex().templates[0];
    assert.deepEqual(original, template);
    const changed = repo.updateEvent(events[0].id, {
      title: '改期',
      type: 'guild_war',
      dates: ['2026-10-31'],
      revision: 1,
    });
    assert.throws(() => repo.confirmLineup(input(events[0])), errorCode('EVENT_CHANGED'));
    repo.saveMemberResponse(changed.id, { uid: '001', status: 'leave', revision: 0 });
    assert.throws(() => repo.confirmLineup(input(changed)), errorCode('INELIGIBLE_MEMBER'));
    assert.throws(
      () => repo.applyLineupTemplate('missing', changed.id),
      errorCode('TEMPLATE_NOT_FOUND'),
    );
  } finally {
    repo.close();
  }
});
test('snapshot storage is immutable, transactional and persists after restart without overwriting existing data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-lineups-'));
  const filename = join(directory, 'test.sqlite');
  const { repo, events } = setup(filename);
  const raw = new Database(filename);
  try {
    const first = repo.confirmLineup(input(events[0]));
    const template = repo.createLineupTemplate({
      teams: emptyLineup(),
      name: '空白配置',
      requestId: 'empty-template',
    });
    assert.throws(() => raw.prepare('UPDATE lineup_versions SET version = 4').run(), /immutable/);
    assert.throws(() => raw.prepare('DELETE FROM lineup_versions').run(), /immutable/);
    raw.exec(
      "CREATE TRIGGER fail_lineup BEFORE INSERT ON lineup_versions BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    assert.throws(() => repo.confirmLineup(input(events[1])), /test failure/);
    assert.equal(repo.getLineupHistory(events[1].id).versions.length, 0);
    raw.exec('DROP TRIGGER fail_lineup');
    repo.close();
    const restarted = createRepository({ filename });
    try {
      assert.deepEqual(restarted.getLineupHistory(events[0].id).versions, [first]);
      assert.deepEqual(restarted.getLineupIndex().templates, [template]);
      assert.deepEqual(raw.pragma('foreign_key_check'), []);
    } finally {
      restarted.close();
    }
  } finally {
    raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('moving and swapping people preserves one UID per lineup and seat notes', () => {
  const teams = emptyLineup();
  teams[0].slots[0].uid = '001';
  teams[0].slots[0].profession = 'secondary';
  teams[0].slots[0].note = '前塔';
  teams[0].slots[1].uid = '002';
  placeMember(teams, '001', 'attack-1', 1);
  assert.equal(teams[0].slots[0].uid, '002');
  assert.equal(teams[0].slots[1].uid, '001');
  assert.equal(teams[0].slots[1].profession, 'secondary');
  assert.equal(teams[0].slots[0].note, '前塔');
  placeMember(teams, '001', 'defense-4', 5);
  assert.equal(teams[0].slots[1].uid, null);
  assert.equal(teams.flatMap((t) => t.slots).filter((s) => s.uid === '001').length, 1);
  placeMember(teams, '003', 'attack-1', 0);
  assert.equal(teams[0].slots[0].uid, '003');
});
