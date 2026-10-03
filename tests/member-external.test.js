import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
const initial = {
  uid: '000001',
  name: '原名稱',
  primaryProfessionId: 3,
  secondaryProfessionId: 1,
  isInGuild: true,
  isInClub: true,
};
test('moving to external only clears flags, repeated current-version operations are no-ops', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    let member = repo.addMember(initial);
    member = repo.updateMember(member.uid, {
      name: '現名稱',
      primaryProfessionId: 3,
      secondaryProfessionId: 1,
      revision: member.revision,
    });
    const result = repo.removeMember(member.uid, member.revision);
    const expected = {
      ...member,
      isInGuild: false,
      isInClub: false,
      revision: member.revision + 1,
      updatedAt: result.member.updatedAt,
    };
    assert.equal(result.uid, member.uid);
    assert.deepEqual(result.member, expected);
    assert.deepEqual(repo.listMembers().members, [expected]);
    assert.deepEqual(repo.removeMember(member.uid, result.member.revision), result);
    assert.throws(
      () => repo.removeMember(member.uid, member.revision),
      (error) => error.code === 'STALE_MEMBER',
    );
    assert.throws(
      () => repo.removeMember('missing', 1),
      (error) => error.code === 'MEMBER_NOT_FOUND',
    );
  } finally {
    repo.close();
  }
});
test('legacy removed rows migrate to external exactly once and preserve UID, name history and join date', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-external-migration-'));
  const filename = join(directory, 'test.sqlite');
  let repo = createRepository({ filename });
  try {
    let old = repo.addMember(initial);
    old = repo.updateMember(old.uid, {
      name: '原移除成員',
      primaryProfessionId: 3,
      secondaryProfessionId: 1,
      revision: old.revision,
    });
    const db = new Database(filename);
    db.prepare('UPDATE members SET removed_at = ? WHERE uid = ?').run(
      '2026-10-01T00:00:00Z',
      old.uid,
    );
    db.close();
    repo.close();
    repo = createRepository({ filename });
    const migrated = repo.listMembers().members[0];
    assert.equal(migrated.uid, old.uid);
    assert.equal(migrated.name, old.name);
    assert.equal(migrated.joinedAt, old.joinedAt);
    assert.equal(migrated.primaryProfessionId, old.primaryProfessionId);
    assert.equal(migrated.secondaryProfessionId, old.secondaryProfessionId);
    assert.deepEqual(migrated.previousNames, old.previousNames);
    assert.equal(migrated.isInGuild, false);
    assert.equal(migrated.isInClub, false);
    assert.equal(migrated.revision, old.revision + 1);
    const restored = repo.updateMember(migrated.uid, {
      name: migrated.name,
      primaryProfessionId: 3,
      secondaryProfessionId: 1,
      isInClub: true,
      revision: migrated.revision,
    });
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.listMembers().members[0], restored);
    const check = new Database(filename);
    assert.equal(
      check.prepare('SELECT removed_at FROM members WHERE uid = ?').get(old.uid).removed_at,
      null,
    );
    check.close();
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('failed external move rolls back both flags and revision and does not touch history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-external-rollback-'));
  const filename = join(directory, 'test.sqlite');
  const repo = createRepository({ filename });
  try {
    const member = repo.addMember(initial);
    const db = new Database(filename);
    db.exec(
      "CREATE TRIGGER fail_move BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT, 'test move failure'); END;",
    );
    db.close();
    assert.throws(() => repo.removeMember(member.uid, member.revision), /test move failure/);
    assert.deepEqual(repo.listMembers().members[0], member);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
