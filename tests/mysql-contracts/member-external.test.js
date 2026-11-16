import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';
const initial = {
  uid: '000001',
  name: '原名稱',
  primaryProfessionId: 3,
  secondaryProfessionId: 1,
  isInGuild: true,
  isInClub: true,
};
test('moving to external only clears flags, repeated current-version operations are no-ops', async () => {
  const repo = (await createRepository());
  try {
    let member = (await repo.addMember(initial));
    member = (await repo.updateMember(member.uid, {
      name: '現名稱',
      primaryProfessionId: 3,
      secondaryProfessionId: 1,
      revision: member.revision,
    }));
    const result = (await repo.removeMember(member.uid, member.revision));
    const expected = {
      ...member,
      isInGuild: false,
      isInClub: false,
      revision: member.revision + 1,
      updatedAt: result.member.updatedAt,
    };
    assert.equal(result.uid, member.uid);
    assert.deepEqual(result.member, expected);
    assert.deepEqual((await repo.listMembers()).members, [expected]);
    assert.deepEqual((await repo.removeMember(member.uid, result.member.revision)), result);
    (await assert.rejects(
      async () => (await repo.removeMember(member.uid, member.revision)),
      (error) => error.code === 'STALE_MEMBER',
    ));
    (await assert.rejects(
      async () => (await repo.removeMember('missing', 1)),
      (error) => error.code === 'MEMBER_NOT_FOUND',
    ));
  } finally {
    (await repo.close());
  }
});
