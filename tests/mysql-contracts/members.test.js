import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const initial = {
  uid: '00012345678901234567890',
  name: '測試成員',
  primaryProfessionId: 1,
  secondaryProfessionId: null,
};
async function withRepository(callback) {
  const repository = (await createRepository());
  try {
    (await callback(repository));
  } finally {
    (await repository.close());
  }
}
test('member UID preserves leading zeros and values larger than safe integers', async () =>
  (await withRepository(async (repo) => {
    const member = (await repo.addMember(initial));
    assert.equal(member.uid, initial.uid);
    assert.equal(member.secondaryProfession, '');
    assert.deepEqual(member.previousNames, []);
    (await assert.rejects(
      async () => (await repo.addMember({ ...initial, uid: 123 })),
      (error) => Boolean(error.fields.uid),
    ));
    (await assert.rejects(
      async () => (await repo.addMember(initial)),
      (error) => error.code === 'DUPLICATE_UID',
    ));
  })));
test('renames store the previous name with UID and profession-only changes create no history', async () =>
  (await withRepository(async (repo) => {
    const first = (await repo.addMember(initial));
    const renamed = (await repo.updateMember(first.uid, {
      name: '新名稱',
      primaryProfessionId: 2,
      secondaryProfessionId: 4,
      revision: first.revision,
    }));
    assert.equal(renamed.name, '新名稱');
    assert.deepEqual(
      renamed.previousNames.map((entry) => entry.name),
      ['測試成員'],
    );
    const changed = (await repo.updateMember(first.uid, {
      name: renamed.name,
      primaryProfessionId: 3,
      secondaryProfessionId: null,
      revision: renamed.revision,
    }));
    assert.equal(changed.previousNames.length, 1);
    assert.equal(changed.primaryProfession, '碎夢');
    assert.deepEqual((await repo.listMembers()).members[0].previousNames, changed.previousNames);
  })));
test('unchanged saves do not change revision or duplicate history', async () =>
  (await withRepository(async (repo) => {
    const member = (await repo.addMember(initial));
    const result = (await repo.updateMember(member.uid, {
      name: member.name,
      primaryProfessionId: member.primaryProfessionId,
      secondaryProfessionId: null,
      revision: member.revision,
    }));
    assert.equal(result.revision, member.revision);
    assert.deepEqual(result.previousNames, []);
  })));
test('stale edits and removals cannot overwrite current data', async () =>
  (await withRepository(async (repo) => {
    const member = (await repo.addMember(initial));
    (await repo.updateMember(member.uid, {
      name: '新名稱',
      primaryProfessionId: 1,
      secondaryProfessionId: null,
      revision: member.revision,
    }));
    (await assert.rejects(
      async () =>
        (await repo.updateMember(member.uid, {
          name: '過期名稱',
          primaryProfessionId: 1,
          revision: member.revision,
        })),
      (error) => error.code === 'STALE_MEMBER',
    ));
    (await assert.rejects(
      async () => (await repo.removeMember(member.uid, member.revision)),
      (error) => error.code === 'STALE_MEMBER',
    ));
    assert.equal((await repo.listMembers()).members[0].name, '新名稱');
    assert.equal((await repo.listMembers()).members[0].previousNames.length, 1);
  })));
test('moving to external retains UID and history, returning to members uses editing', async () =>
  (await withRepository(async (repo) => {
    let member = (await repo.addMember(initial));
    member = (await repo.updateMember(member.uid, {
      name: '移至編外前名稱',
      primaryProfessionId: 1,
      revision: member.revision,
    }));
    const result = (await repo.removeMember(member.uid, member.revision));
    assert.equal(result.member.isInGuild, false);
    assert.equal(result.member.isInClub, false);
    assert.equal(result.member.uid, member.uid);
    assert.equal((await repo.listMembers()).members.length, 1);
    assert.deepEqual(result.member.previousNames, member.previousNames);
    (await assert.rejects(
      async () => (await repo.removeMember(member.uid, member.revision)),
      (error) => error.code === 'STALE_MEMBER',
    ));
    (await assert.rejects(
      async () => (await repo.addMember(initial)),
      (error) => error.code === 'DUPLICATE_UID',
    ));
    const rejoined = (await repo.updateMember(member.uid, {
      name: result.member.name,
      primaryProfessionId: 1,
      isInClub: true,
      revision: result.member.revision,
    }));
    assert.equal(rejoined.isInGuild, false);
    assert.equal(rejoined.isInClub, true);
    assert.deepEqual(rejoined.previousNames, member.previousNames);
  })));
test('invalid fields, immutable UID and missing revisions are rejected', async () =>
  (await withRepository(async (repo) => {
    (await assert.rejects(
      async () => (await repo.addMember({ ...initial, name: '   ', primaryProfessionId: null })),
      (error) => Boolean(error.fields.name && error.fields.primaryProfessionId),
    ));
    (await assert.rejects(
      async () => (await repo.addMember({ ...initial, uid: 'has space' })),
      (error) => Boolean(error.fields.uid),
    ));
    const member = (await repo.addMember(initial));
    (await assert.rejects(
      async () => (await repo.updateMember(member.uid, { ...initial, revision: member.revision })),
      (error) => error.code === 'VALIDATION_ERROR',
    ));
    (await assert.rejects(
      async () => (await repo.removeMember(member.uid, undefined)),
      (error) => error.code === 'INVALID_REVISION',
    ));
  })));

test('member audit records real differences, actor snapshots, no-ops and removal', async () => withRepository(async repo => {
  const actor = { id: 'audit-account', username: 'editor', role: 'manager' };
  const first = await repo.addMember(initial, { actor });
  assert.equal(Object.hasOwn(first, 'updatedBy'), false);
  assert((await repo.listMembers()).members.every(row => !Object.hasOwn(row, 'updatedBy')));
  let history = (await repo.getMemberEditHistory(first.uid)).items;
  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'create');
  assert.equal(history[0].actorAccountId, actor.id);
  assert.equal(history[0].actorName, 'editor');
  const profile = { name: first.name, primaryProfessionId: 1, secondaryProfessionId: null, revision: first.revision };
  await repo.updateMember(first.uid, profile, actor);
  assert.equal((await repo.getMemberEditHistory(first.uid)).items.length, 1);
  const next = await repo.updateMember(first.uid, { ...profile, name: '已修改' }, { ...actor, username: 'renamed-account' });
  history = (await repo.getMemberEditHistory(first.uid)).items;
  const update = history.find(row => row.action === 'update');
  assert.deepEqual(update.changes, [{ field: 'name', before: first.name, after: '已修改' }]);
  assert.equal(update.actorName, 'renamed-account');
  assert.equal(history.find(row => row.action === 'create').actorName, 'editor');
  await repo.removeMember(first.uid, next.revision, actor);
  const removed = (await repo.getMemberEditHistory(first.uid)).items.find(row => row.action === 'remove');
  assert.deepEqual(removed.changes, [{ field: 'isInGuild', before: true, after: false }]);
  assert.deepEqual((await repo.getMemberEditHistory('unrelated')).items, []);
}));

test('pre-audit members omit updatedBy and imports record their actor', async () => withRepository(async repo => {
  const { repositoryDatabase } = await import('../helpers/mysql-repository.js');
  const db = repositoryDatabase(repo);
  await db.query(`INSERT INTO members (uid,name,primary_profession_id,primary_profession,secondary_profession,is_in_guild,is_in_club,joined_at,updated_at,revision)
    VALUES ('legacy-audit','legacy',1,'碎夢','',1,0,'2026-01-01','2026-01-01',1)`);
  assert.equal(Object.hasOwn((await repo.listMembers()).members[0], 'updatedBy'), false);
  assert.deepEqual((await repo.getMemberEditHistory('legacy-audit')).items, []);
  const text = 'UID Name 主職業 副職業\nimport-audit 匯入成員 碎夢 -';
  const preview = await repo.previewMemberImport({ text });
  await repo.importMembers({ text, fingerprint: preview.fingerprint }, { id: 'importer', username: 'import-account' });
  const log = (await repo.getMemberEditHistory('import-audit')).items[0];
  assert.equal(log.action, 'import');
  assert.equal(log.actorName, 'import-account');
}));

test('restores record changed fields and history reads are bounded to one UID', async () => withRepository(async repo => {
  const { repositoryDatabase } = await import('../helpers/mysql-repository.js');
  const db = repositoryDatabase(repo);
  const first = await repo.addMember(initial);
  await db.query('UPDATE members SET removed_at=? WHERE uid=?', ['2020-01-01', first.uid]);
  await repo.addMember({ ...initial, name: '回歸' }, { actor: { id: 'restore-editor', username: 'restore-account' } });
  const restored = (await repo.getMemberEditHistory(first.uid)).items.find(row => row.action === 'restore');
  assert.ok(restored.changes.some(change => change.field === 'name' && change.before === initial.name && change.after === '回歸'));
  for (let index = 0; index < 205; index++) {
    await db.query(`INSERT INTO member_edit_logs (id,member_uid,action,source,changes_json,created_at) VALUES (?,?,'update','test','[]',?)`,
      [`bounded-${String(index).padStart(3, '0')}`, first.uid, '2099-01-01T00:00:00.000Z']);
  }
  const items = (await repo.getMemberEditHistory(first.uid)).items;
  assert.equal(items.length, 200);
  assert.ok(items.every(row => row.uid === first.uid));
  assert.equal(items[0].id, 'bounded-204');
  assert.equal(items.at(-1).id, 'bounded-005');
}));
