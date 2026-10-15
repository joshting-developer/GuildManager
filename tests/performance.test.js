import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
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

test('page branding is cached for doGet and cleared when settings change', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudSession(
    cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])),
  );
  const first = JSON.parse(JSON.stringify(env.sandbox.GuildGas.pagePlatform()));
  const counter = countReads(env);
  assert.deepEqual(JSON.parse(JSON.stringify(env.sandbox.GuildGas.pagePlatform())), first);
  assert.equal(counter.reads, 0, 'cached page open reads no sheets');
  cloudResult(
    env.raw('updatePlatformSettings', [{ name: '新名字', revision: first.revision }], admin),
  );
  assert.equal(env.sandbox.GuildGas.pagePlatform().name, '新名字');
});

test('roster and participation reads load members and professions in batches', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudSession(
    cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])),
  );
  const call = (op, args = []) => cloudResult(env.raw(op, args, admin));
  for (let i = 0; i < 30; i++)
    call('addMember', [{ uid: `u${i}`, name: `人${i}`, primaryProfessionId: (i % 9) + 1 }]);
  const event = call('createEvent', [
    { title: '', type: 'guild_war', dates: ['2026-11-01'], requestId: 'e' },
  ]).events[0];
  for (let i = 0; i < 30; i++) {
    const { revision } = call('getEventParticipation', [event.id]);
    call('submitParticipation', [
      event.id,
      {
        name: `人${i}`,
        status: 'registered',
        note: '',
        professionId: 1,
        requestId: `r${i}`,
        revision,
      },
    ]);
  }
  const counter = countReads(env);
  call('getEventParticipation', [event.id]);
  assert.ok(counter.reads <= 10, `participation used ${counter.reads} reads`);
  counter.reads = 0;
  call('getMembers');
  assert.ok(counter.reads <= 6, `members used ${counter.reads} reads`);
});

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
