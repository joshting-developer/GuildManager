import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMemberClient } from '../src/api/members.js';

function countReads(env) {
  const counter = { reads: 0 };
  for (const sheet of env.sheets.values()) {
    const original = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = original(...args);
      const getValues = range.getValues;
      range.getValues = () => (counter.reads++, getValues());
      return range;
    };
  }
  return counter;
}

test('profession list is requested once per transport and retried after a failure', async () => {
  let calls = 0,
    fail = true;
  const fetchImpl = async () => {
    calls++;
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ professions: [{ job_id: 1, name: '素問' }] }) };
  };
  await assert.rejects(createMemberClient({ fetchImpl }).getProfessions());
  fail = false;
  const [a, b] = await Promise.all([
    createMemberClient({ fetchImpl }).getProfessions(),
    createMemberClient({ fetchImpl }).getProfessions(),
  ]);
  assert.equal(a, b);
  assert.equal(calls, 2, 'one failed request, then one shared request');
  await createMemberClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  }).getProfessions();
  assert.equal(calls, 2, 'a different transport does not reuse or disturb the cache');
});
