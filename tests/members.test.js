import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';

const initial = {
  uid: '00012345678901234567890',
  name: '測試成員',
  primaryProfessionId: 1,
  secondaryProfessionId: null,
};
function withRepository(callback) {
  const repository = createRepository({ filename: ':memory:' });
  try {
    callback(repository);
  } finally {
    repository.close();
  }
}
test('member UID preserves leading zeros and values larger than safe integers', () =>
  withRepository((repo) => {
    const member = repo.addMember(initial);
    assert.equal(member.uid, initial.uid);
    assert.equal(member.secondaryProfession, '');
    assert.deepEqual(member.previousNames, []);
    assert.throws(
      () => repo.addMember({ ...initial, uid: 123 }),
      (error) => Boolean(error.fields.uid),
    );
    assert.throws(
      () => repo.addMember(initial),
      (error) => error.code === 'DUPLICATE_UID',
    );
  }));
test('renames store the previous name with UID and profession-only changes create no history', () =>
  withRepository((repo) => {
    const first = repo.addMember(initial);
    const renamed = repo.updateMember(first.uid, {
      name: '新名稱',
      primaryProfessionId: 2,
      secondaryProfessionId: 4,
      revision: first.revision,
    });
    assert.equal(renamed.name, '新名稱');
    assert.deepEqual(
      renamed.previousNames.map((entry) => entry.name),
      ['測試成員'],
    );
    const changed = repo.updateMember(first.uid, {
      name: renamed.name,
      primaryProfessionId: 3,
      secondaryProfessionId: null,
      revision: renamed.revision,
    });
    assert.equal(changed.previousNames.length, 1);
    assert.equal(changed.primaryProfession, '碎夢');
    assert.deepEqual(repo.listMembers().members[0].previousNames, changed.previousNames);
  }));
test('unchanged saves do not change revision or duplicate history', () =>
  withRepository((repo) => {
    const member = repo.addMember(initial);
    const result = repo.updateMember(member.uid, {
      name: member.name,
      primaryProfessionId: member.primaryProfessionId,
      secondaryProfessionId: null,
      revision: member.revision,
    });
    assert.equal(result.revision, member.revision);
    assert.deepEqual(result.previousNames, []);
  }));
test('stale edits and removals cannot overwrite current data', () =>
  withRepository((repo) => {
    const member = repo.addMember(initial);
    repo.updateMember(member.uid, {
      name: '新名稱',
      primaryProfessionId: 1,
      secondaryProfessionId: null,
      revision: member.revision,
    });
    assert.throws(
      () =>
        repo.updateMember(member.uid, {
          name: '過期名稱',
          primaryProfessionId: 1,
          revision: member.revision,
        }),
      (error) => error.code === 'STALE_MEMBER',
    );
    assert.throws(
      () => repo.removeMember(member.uid, member.revision),
      (error) => error.code === 'STALE_MEMBER',
    );
    assert.equal(repo.listMembers().members[0].name, '新名稱');
    assert.equal(repo.listMembers().members[0].previousNames.length, 1);
  }));
test('removal hides a member, rejoining restores the same UID and name history', () =>
  withRepository((repo) => {
    let member = repo.addMember(initial);
    member = repo.updateMember(member.uid, {
      name: '退會前名稱',
      primaryProfessionId: 1,
      revision: member.revision,
    });
    repo.removeMember(member.uid, member.revision);
    assert.deepEqual(repo.listMembers().members, []);
    assert.throws(
      () => repo.removeMember(member.uid, member.revision),
      (error) => error.code === 'MEMBER_NOT_FOUND',
    );
    const rejoined = repo.addMember({ ...initial, name: '重新加入名稱' });
    assert.equal(rejoined.uid, member.uid);
    assert.deepEqual(
      rejoined.previousNames.map((entry) => entry.name),
      ['退會前名稱', '測試成員'],
    );
    assert.equal(repo.listMembers().members.length, 1);
  }));
test('invalid fields, immutable UID and missing revisions are rejected', () =>
  withRepository((repo) => {
    assert.throws(
      () => repo.addMember({ ...initial, name: '   ', primaryProfessionId: null }),
      (error) => Boolean(error.fields.name && error.fields.primaryProfessionId),
    );
    assert.throws(
      () => repo.addMember({ ...initial, uid: 'has space' }),
      (error) => Boolean(error.fields.uid),
    );
    const member = repo.addMember(initial);
    assert.throws(
      () => repo.updateMember(member.uid, { ...initial, revision: member.revision }),
      (error) => error.code === 'VALIDATION_ERROR',
    );
    assert.throws(
      () => repo.removeMember(member.uid, undefined),
      (error) => error.code === 'INVALID_REVISION',
    );
  }));
test('a failed member update rolls back both the new name and history insertion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guildmember-rollback-'));
  const filename = join(directory, 'test.sqlite');
  const repository = createRepository({ filename });
  try {
    const member = repository.addMember(initial);
    const db = new Database(filename);
    db.exec(
      "CREATE TRIGGER block_update BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    db.close();
    assert.throws(
      () =>
        repository.updateMember(member.uid, {
          name: '失敗的改名',
          primaryProfessionId: 1,
          revision: member.revision,
        }),
      /test failure/,
    );
    const after = repository.listMembers().members[0];
    assert.equal(after.name, member.name);
    assert.deepEqual(after.previousNames, []);
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('member data and past names persist across repository restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guildmember-persist-'));
  const filename = join(directory, 'test.sqlite');
  let repository = createRepository({ filename });
  try {
    const member = repository.addMember(initial);
    repository.updateMember(member.uid, {
      name: '持續保存',
      primaryProfessionId: 1,
      revision: member.revision,
    });
    repository.close();
    repository = createRepository({ filename });
    assert.equal(repository.listMembers().members[0].name, '持續保存');
    assert.equal(repository.listMembers().members[0].previousNames[0].name, initial.name);
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('API supports add/edit/remove and returns actionable validation/conflict responses', async () => {
  const repository = createRepository({ filename: ':memory:' });
  const server = createApp(repository).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const base = `http://127.0.0.1:${server.address().port}/api/members`;
  const send = (method, body, uid = '') =>
    fetch(`${base}${uid ? `/${uid}` : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await send('POST', initial);
    assert.equal(response.status, 201);
    const { member } = await response.json();
    assert.equal((await send('POST', initial)).status, 409);
    response = await send(
      'PATCH',
      { name: 'API 改名', primaryProfessionId: 2, revision: member.revision },
      member.uid,
    );
    assert.equal(response.status, 200);
    const changed = (await response.json()).member;
    assert.equal(changed.previousNames[0].name, initial.name);
    assert.equal((await send('DELETE', { revision: member.revision }, member.uid)).status, 409);
    assert.equal((await send('DELETE', { revision: changed.revision }, member.uid)).status, 200);
    assert.deepEqual((await (await fetch(base)).json()).members, []);
    response = await send('POST', { ...initial, name: '' });
    assert.equal(response.status, 422);
    assert.ok((await response.json()).error.fields.name);
    assert.equal(
      (
        await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
          body: JSON.stringify(initial),
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base, { method: 'POST', body: 'not JSON' })).status, 415);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repository.close();
  }
});

test('profession catalog uses supplied IDs/colors and accepts future jobs from the table', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-jobs-'));
  const filename = join(directory, 'test.sqlite');
  const repo = createRepository({ filename });
  try {
    const jobs = repo.listProfessions().professions;
    assert.equal(jobs.length, 9);
    assert.deepEqual(jobs[0], { job_id: 1, colorcode: '#ffb6c1', name: '素問' });
    assert.equal(jobs[8].name, '神相');
    assert.throws(
      () => repo.addMember({ ...initial, primaryProfessionId: 99 }),
      (error) => Boolean(error.fields.primaryProfessionId),
    );
    assert.throws(
      () => repo.addMember({ ...initial, secondaryProfessionId: 99 }),
      (error) => Boolean(error.fields.secondaryProfessionId),
    );
    const db = new Database(filename);
    db.prepare('INSERT INTO professions VALUES (?, ?, ?)').run(10, '#123456', '未來測試職業');
    db.close();
    assert.equal(repo.listProfessions().professions.length, 10);
    assert.equal(
      repo.addMember({ ...initial, primaryProfessionId: 10 }).primaryProfession,
      '未來測試職業',
    );
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('text profession migration preserves existing members and name history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-migration-'));
  const filename = join(directory, 'test.sqlite');
  const db = new Database(filename);
  db.exec(`CREATE TABLE members (uid TEXT PRIMARY KEY, name TEXT NOT NULL, primary_profession TEXT NOT NULL,
    secondary_profession TEXT NOT NULL DEFAULT '', joined_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    removed_at TEXT, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE member_name_history (id TEXT PRIMARY KEY, member_uid TEXT NOT NULL REFERENCES members(uid), name TEXT NOT NULL, changed_at TEXT NOT NULL);
    INSERT INTO members VALUES ('001', '既有成員', '碎夢', '素問', '2026-01-01', '2026-01-01', NULL, 2);
    INSERT INTO member_name_history VALUES ('h1', '001', '舊名', '2026-01-01');`);
  db.close();
  let repo = createRepository({ filename });
  try {
    const member = repo.listMembers().members[0];
    assert.equal(member.primaryProfessionId, 3);
    assert.equal(member.secondaryProfessionId, 1);
    assert.equal(member.previousNames[0].name, '舊名');
    assert.equal(member.revision, 2);
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.listMembers().members[0].previousNames.length, 1);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
