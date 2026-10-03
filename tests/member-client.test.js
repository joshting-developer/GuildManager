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

test('import client sends text/fingerprint to batch endpoints and retains row errors', async () => {
  const requests = [];
  const client = createMemberClient({
    fetchImpl: async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return path.endsWith('/preview')
        ? { ok: true, json: async () => ({ rows: [], issues: [], fingerprint: 'preview-version' }) }
        : {
            ok: false,
            json: async () => ({
              error: {
                code: 'IMPORT_INVALID',
                message: '請修正資料',
                rows: [{ line: 2, message: '錯職業' }],
              },
            }),
          };
    },
  });
  const text = 'UID Name 主職業 副職業\n001 角色 碎夢 -';
  assert.equal((await client.previewMemberImport({ text })).fingerprint, 'preview-version');
  await assert.rejects(
    client.importMembers({ text, fingerprint: 'preview-version' }),
    (error) => error.code === 'IMPORT_INVALID' && error.rows[0].line === 2,
  );
  assert.deepEqual(requests, [
    { path: '/api/members/import/preview', body: { text } },
    { path: '/api/members/import', body: { text, fingerprint: 'preview-version' } },
  ]);
});
test('GAS import adapter passes batch input to named functions and reports unconnected backend', async () => {
  let success;
  let failure;
  let received;
  const run = {
    withSuccessHandler(handler) {
      success = handler;
      return this;
    },
    withFailureHandler(handler) {
      failure = handler;
      return this;
    },
    previewMemberImport(input) {
      received = input;
      success({ fingerprint: 'version' });
    },
    importMembers() {
      failure({ message: '雲端成員匯入尚未串接' });
    },
  };
  const client = createMemberClient({ source: 'gas', googleRun: run });
  const input = { text: '001 角色 碎夢 -' };
  assert.equal((await client.previewMemberImport(input)).fingerprint, 'version');
  assert.deepEqual(received, input);
  await assert.rejects(client.importMembers({ ...input, fingerprint: 'version' }), /尚未串接/);
});
