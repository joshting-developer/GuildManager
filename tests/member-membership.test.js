import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
const initial = {
  uid: '001',
  name: '測試成員',
  primaryProfessionId: 3,
  secondaryProfessionId: null,
};
function withRepo(callback) {
  const repo = createRepository({ filename: ':memory:' });
  try {
    callback(repo);
  } finally {
    repo.close();
  }
}
function edit(member, values = {}) {
  return {
    name: member.name,
    primaryProfessionId: member.primaryProfessionId,
    secondaryProfessionId: member.secondaryProfessionId,
    revision: member.revision,
    ...values,
  };
}
test('membership flags support all four combinations and API DTOs use booleans', () =>
  withRepo((repo) => {
    const defaultMember = repo.addMember(initial);
    assert.equal(defaultMember.isInGuild, true);
    assert.equal(defaultMember.isInClub, false);
    for (const isInGuild of [false, true])
      for (const isInClub of [false, true]) {
        const member = repo.addMember({
          ...initial,
          uid: `${isInGuild}-${isInClub}`,
          isInGuild,
          isInClub,
        });
        assert.equal(member.isInGuild, isInGuild);
        assert.equal(member.isInClub, isInClub);
      }
    assert.equal(repo.listMembers().members.length, 5);
    for (const member of repo.listMembers().members) {
      assert.equal(typeof member.isInGuild, 'boolean');
      assert.equal(typeof member.isInClub, 'boolean');
    }
  }));
test('membership updates increment revision without name history, omitted flags preserve existing values', () =>
  withRepo((repo) => {
    let member = repo.addMember({ ...initial, isInGuild: false, isInClub: true });
    const original = member;
    member = repo.updateMember(member.uid, edit(member, { isInGuild: true }));
    assert.equal(member.isInGuild, true);
    assert.equal(member.isInClub, true);
    assert.equal(member.revision, original.revision + 1);
    assert.deepEqual(member.previousNames, []);
    assert.throws(
      () => repo.updateMember(member.uid, edit(original, { isInClub: false })),
      (error) => error.code === 'STALE_MEMBER',
    );
    const unchanged = repo.updateMember(member.uid, edit(member));
    assert.equal(unchanged.revision, member.revision);
    member = repo.updateMember(
      member.uid,
      edit(member, { name: '改名', isInGuild: false, isInClub: false }),
    );
    assert.deepEqual(
      member.previousNames.map((entry) => entry.name),
      ['測試成員'],
    );
    assert.equal(member.isInGuild, false);
    assert.equal(member.isInClub, false);
  }));
test('strings, numbers, null and arrays cannot masquerade as booleans', () =>
  withRepo((repo) => {
    const member = repo.addMember(initial);
    for (const field of ['isInGuild', 'isInClub'])
      for (const value of ['false', 'true', 0, 1, null, [], {}]) {
        assert.throws(
          () => repo.addMember({ ...initial, uid: '002', [field]: value }),
          (error) => Boolean(error.fields[field]),
        );
        assert.throws(
          () => repo.updateMember(member.uid, edit(member, { [field]: value })),
          (error) => Boolean(error.fields[field]),
        );
      }
    assert.equal(repo.listMembers().members.length, 1);
  }));
test('four-column import defaults apply only to new UIDs, member and external UIDs are skipped', () =>
  withRepo((repo) => {
    const existing = repo.addMember({ ...initial, isInGuild: false, isInClub: true });
    const external = repo.addMember({ ...initial, uid: '002', isInGuild: false, isInClub: true });
    repo.removeMember(external.uid, external.revision);
    const text = '001 不應覆寫 素問 -\n002 恢復成員 龍吟 -\n003 新成員 碎夢 -';
    const preview = repo.previewMemberImport({ text });
    const result = repo.importMembers({ text, fingerprint: preview.fingerprint });
    assert.deepEqual(result.summary, { added: 1, restored: 0, skipped: 2 });
    const members = repo.listMembers().members;
    assert.deepEqual(
      members.find((member) => member.uid === '001'),
      existing,
    );
    assert.equal(members.find((member) => member.uid === '002').isInGuild, false);
    assert.equal(members.find((member) => member.uid === '002').isInClub, false);
    assert.equal(members.find((member) => member.uid === '003').isInGuild, true);
    assert.equal(members.find((member) => member.uid === '003').isInClub, false);
  }));
test('membership changes invalidate an import preview and external status can be edited', () =>
  withRepo((repo) => {
    let member = repo.addMember(initial);
    const text = '001 原成員 碎夢 -\n002 新成員 碎夢 -';
    const preview = repo.previewMemberImport({ text });
    member = repo.updateMember(member.uid, edit(member, { isInClub: true }));
    assert.throws(
      () => repo.importMembers({ text, fingerprint: preview.fingerprint }),
      (error) => error.code === 'STALE_IMPORT',
    );
    const external = repo.removeMember(member.uid, member.revision).member;
    const updated = repo.updateMember(
      member.uid,
      edit(external, { isInGuild: false, isInClub: true }),
    );
    assert.equal(updated.isInGuild, false);
    assert.equal(updated.isInClub, true);
  }));
test('legacy membership migration preserves records, history and revisions and never resets flags on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-membership-'));
  const filename = join(directory, 'test.sqlite');
  const db = new Database(filename);
  db.exec(`CREATE TABLE members (uid TEXT PRIMARY KEY, name TEXT NOT NULL, primary_profession TEXT NOT NULL,
    secondary_profession TEXT NOT NULL DEFAULT '', joined_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    removed_at TEXT, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE member_name_history (id TEXT PRIMARY KEY, member_uid TEXT NOT NULL REFERENCES members(uid), name TEXT NOT NULL, changed_at TEXT NOT NULL);
    INSERT INTO members VALUES ('001', '原成員', '碎夢', '', '2026-01-01', '2026-01-01', NULL, 3);
    INSERT INTO members VALUES ('002', '已移除', '素問', '', '2026-01-01', '2026-01-01', '2026-02-01', 2);
    INSERT INTO member_name_history VALUES ('h1', '001', '過去名稱', '2026-01-01');`);
  db.close();
  let repo = createRepository({ filename });
  try {
    const member = repo.listMembers().members[0];
    assert.equal(member.isInGuild, true);
    assert.equal(member.isInClub, false);
    assert.equal(member.revision, 3);
    assert.equal(member.previousNames[0].name, '過去名稱');
    const check = new Database(filename);
    assert.equal(
      check.prepare("SELECT is_in_guild FROM members WHERE uid = '002'").get().is_in_guild,
      0,
    );
    assert.throws(() => check.exec("UPDATE members SET is_in_club = 2 WHERE uid = '001'"), /CHECK/);
    check.close();
    const updated = repo.updateMember(
      member.uid,
      edit(member, { isInGuild: false, isInClub: true }),
    );
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.listMembers().members[0], updated);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('membership API supports false values and returns field errors for non-booleans', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const base = `http://127.0.0.1:${server.address().port}/api/members`;
  const send = (url, method, body) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await send(base, 'POST', { ...initial, isInGuild: false, isInClub: true });
    assert.equal(response.status, 201);
    const member = (await response.json()).member;
    assert.equal(member.isInGuild, false);
    assert.equal(member.isInClub, true);
    response = await send(`${base}/001`, 'PATCH', edit(member, { isInClub: false }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).member.isInClub, false);
    response = await send(base, 'POST', { ...initial, uid: '002', isInGuild: 'false' });
    assert.equal(response.status, 422);
    assert.ok((await response.json()).error.fields.isInGuild);
    const list = (await (await fetch(base)).json()).members;
    assert.equal(list.length, 1);
    assert.equal(list[0].isInGuild, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
