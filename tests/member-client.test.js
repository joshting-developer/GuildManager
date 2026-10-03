import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberClient } from '../src/api/members.js';

test('member client preserves backend field errors and never retries a failed write', async () => {
  let calls = 0;
  const client = createMemberClient({
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        json: async () => ({
          error: { code: 'DUPLICATE_UID', message: 'UID 已存在', fields: { uid: '重複 UID' } },
        }),
      };
    },
  });
  await assert.rejects(
    client.addMember({ uid: '001' }),
    (error) => error.code === 'DUPLICATE_UID' && error.fields.uid === '重複 UID',
  );
  assert.equal(calls, 1);
});
test('GAS member transport passes UID/revision and propagates failures without local fallback', async () => {
  let success;
  let failure;
  let args;
  const run = {
    withSuccessHandler(handler) {
      success = handler;
      return this;
    },
    withFailureHandler(handler) {
      failure = handler;
      return this;
    },
    updateMember(...input) {
      args = input;
      success({ member: { uid: input[0] } });
    },
    removeMember() {
      failure({ message: '雲端成員移除尚未串接' });
    },
  };
  const client = createMemberClient({
    source: 'gas',
    googleRun: run,
    fetchImpl: () => assert.fail('must not fall back to HTTP'),
  });
  assert.equal((await client.updateMember('0001', { revision: 3 })).member.uid, '0001');
  assert.deepEqual(args, ['0001', { revision: 3 }]);
  await assert.rejects(client.removeMember('0001', 3), /尚未串接/);
});
test('member client reports network and invalid JSON failures', async () => {
  await assert.rejects(
    createMemberClient({
      fetchImpl: async () => {
        throw new Error('network');
      },
    }).getMembers(),
    /無法連線/,
  );
  await assert.rejects(
    createMemberClient({
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('not JSON');
        },
      }),
    }).getProfessions(),
    /格式不正確/,
  );
});
