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
