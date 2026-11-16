import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const initial = {
  uid: '001',
  name: '測試成員',
  primaryProfessionId: 3,
  secondaryProfessionId: null,
};
async function withRepo(callback) {
  const repo = (await createRepository());
  try {
    (await callback(repo));
  } finally {
    (await repo.close());
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
test('membership flags support all four combinations and API DTOs use booleans', async () =>
  (await withRepo(async (repo) => {
    const defaultMember = (await repo.addMember(initial));
    assert.equal(defaultMember.isInGuild, true);
    assert.equal(defaultMember.isInClub, false);
    for (const isInGuild of [false, true])
      for (const isInClub of [false, true]) {
        const member = (await repo.addMember({
          ...initial,
          uid: `${isInGuild}-${isInClub}`,
          isInGuild,
          isInClub,
        }));
        assert.equal(member.isInGuild, isInGuild);
        assert.equal(member.isInClub, isInClub);
      }
    assert.equal((await repo.listMembers()).members.length, 5);
    for (const member of (await repo.listMembers()).members) {
      assert.equal(typeof member.isInGuild, 'boolean');
      assert.equal(typeof member.isInClub, 'boolean');
    }
  })));
test('membership updates increment revision without name history, omitted flags preserve existing values', async () =>
  (await withRepo(async (repo) => {
    let member = (await repo.addMember({ ...initial, isInGuild: false, isInClub: true }));
    const original = member;
    member = (await repo.updateMember(member.uid, edit(member, { isInGuild: true })));
    assert.equal(member.isInGuild, true);
    assert.equal(member.isInClub, true);
    assert.equal(member.revision, original.revision + 1);
    assert.deepEqual(member.previousNames, []);
    (await assert.rejects(
      async () => (await repo.updateMember(member.uid, edit(original, { isInClub: false }))),
      (error) => error.code === 'STALE_MEMBER',
    ));
    const unchanged = (await repo.updateMember(member.uid, edit(member)));
    assert.equal(unchanged.revision, member.revision);
    member = (await repo.updateMember(
      member.uid,
      edit(member, { name: '改名', isInGuild: false, isInClub: false }),
    ));
    assert.deepEqual(
      member.previousNames.map((entry) => entry.name),
      ['測試成員'],
    );
    assert.equal(member.isInGuild, false);
    assert.equal(member.isInClub, false);
  })));
test('strings, numbers, null and arrays cannot masquerade as booleans', async () =>
  (await withRepo(async (repo) => {
    const member = (await repo.addMember(initial));
    for (const field of ['isInGuild', 'isInClub'])
      for (const value of ['false', 'true', 0, 1, null, [], {}]) {
        (await assert.rejects(
          async () => (await repo.addMember({ ...initial, uid: '002', [field]: value })),
          (error) => Boolean(error.fields[field]),
        ));
        (await assert.rejects(
          async () => (await repo.updateMember(member.uid, edit(member, { [field]: value }))),
          (error) => Boolean(error.fields[field]),
        ));
      }
    assert.equal((await repo.listMembers()).members.length, 1);
  })));
test('four-column import defaults apply only to new UIDs, member and external UIDs are skipped', async () =>
  (await withRepo(async (repo) => {
    const existing = (await repo.addMember({ ...initial, isInGuild: false, isInClub: true }));
    const external = (await repo.addMember({ ...initial, uid: '002', isInGuild: false, isInClub: true }));
    (await repo.removeMember(external.uid, external.revision));
    const text = '001 不應覆寫 素問 -\n002 恢復成員 龍吟 -\n003 新成員 碎夢 -';
    const preview = (await repo.previewMemberImport({ text }));
    const result = (await repo.importMembers({ text, fingerprint: preview.fingerprint }));
    assert.deepEqual(result.summary, { added: 1, restored: 0, skipped: 2 });
    const members = (await repo.listMembers()).members;
    assert.deepEqual(
      members.find((member) => member.uid === '001'),
      existing,
    );
    assert.equal(members.find((member) => member.uid === '002').isInGuild, false);
    assert.equal(members.find((member) => member.uid === '002').isInClub, false);
    assert.equal(members.find((member) => member.uid === '003').isInGuild, true);
    assert.equal(members.find((member) => member.uid === '003').isInClub, false);
  })));
test('membership changes invalidate an import preview and external status can be edited', async () =>
  (await withRepo(async (repo) => {
    let member = (await repo.addMember(initial));
    const text = '001 原成員 碎夢 -\n002 新成員 碎夢 -';
    const preview = (await repo.previewMemberImport({ text }));
    member = (await repo.updateMember(member.uid, edit(member, { isInClub: true })));
    (await assert.rejects(
      async () => (await repo.importMembers({ text, fingerprint: preview.fingerprint })),
      (error) => error.code === 'STALE_IMPORT',
    ));
    const external = (await repo.removeMember(member.uid, member.revision)).member;
    const updated = (await repo.updateMember(
      member.uid,
      edit(external, { isInGuild: false, isInClub: true }),
    ));
    assert.equal(updated.isInGuild, false);
    assert.equal(updated.isInClub, true);
  })));
