import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { participationTarget } from '../src/domain/participation-target.js';
import { callGas, setGasSession } from '../src/api/gas.js';

async function fixture(source) {
  let repo, call, close = () => {};
  if (source === 'local') {
    repo = createRepository({ filename: ':memory:' });
    close = () => repo.close();
    call = (op, ...args) => {
      if (op === 'getForm') return repo.getEventParticipationForm(...args);
      if (op === 'addMember') return repo.addMember(...args);
      if (op === 'updateMember') return repo.updateMember(...args);
      return repo[op](...args);
    };
  } else {
    const env = await gasRuntime();
    env.setup();
    const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
    call = (op, ...args) => {
      const result = cloudResult(env.rpc(op === 'getForm' ? 'getEventParticipationForm' : op, args, context));
      return ['createEvent', 'updateEvent'].includes(op) ? result.event : ['addMember', 'updateMember'].includes(op) ? result.member : result;
    };
  }
  const members = [];
  for (let i = 0; i < 12; i++) members.push(call('addMember', { uid: `u${i}`, name: `成員${i}`, primaryProfessionId: 1, isInGuild: true, isInClub: true }));
  const event = call('createEvent', { title: '同時請假', type: 'scrimmage', dates: ['2026-10-19'], requestId: 'event' });
  return { call, close, event, members };
}

function submission(event, form, name, requestId, status = 'leave', extra = {}) {
  const input = { name, requestId, status, note: '不能出席，請保留', professionId: status === 'registered' ? 3 : null, revision: form.revision, ...extra };
  const person = participationTarget(input, form);
  if (person) input.expectedParticipant = { eventRevision: event.revision, person };
  return input;
}

for (const source of ['local', 'gas']) {
  test(`${source}: twelve members using one old form can leave without reloading; same-person stale edits and replay stay protected`, async () => {
    const { call, close, event } = await fixture(source);
    try {
      const form = call('getForm', event.id);
      const inputs = Array.from({ length: 12 }, (_, i) => submission(event, form, `成員${i}`, `leave-${i}`, 'leave', { memberUid: `u${i}` }));
      for (const input of inputs) assert.equal(call('submitParticipation', event.id, input).status, 'leave');
      assert.equal(call('getForm', event.id).responses.filter((r) => r.status === 'leave').length, 12);
      assert.throws(() => call('submitParticipation', event.id, { ...inputs[0], requestId: 'same-person-stale' }), { code: 'PARTICIPATION_CHANGED' });
      assert.throws(() => call('submitParticipation', event.id, { ...inputs[0], note: '其他內容' }), { code: 'REQUEST_CONFLICT' });
      const latest = call('getForm', event.id);
      call('submitParticipation', event.id, submission(event, latest, '成員0', 'register-again', 'registered'));
      assert.equal(call('submitParticipation', event.id, inputs[0]).status, 'leave');
      assert.equal(call('getForm', event.id).responses.find((r) => r.uid === 'u0').status, 'registered');
      const beforeEventChange = call('getForm', event.id);
      const staleEvent = submission(event, beforeEventChange, '成員1', 'stale-event');
      call('updateEvent', event.id, { title: '改名場次', type: event.type, dates: event.dates, revision: 1 });
      assert.throws(() => call('submitParticipation', event.id, staleEvent), { code: 'EVENT_CHANGED' });
    } finally { close(); }
  });

  test(`${source}: manual names, guests, ambiguous identities, roster changes and legacy submissions remain checked`, async () => {
    const { call, close, event, members } = await fixture(source);
    try {
      const initial = call('getForm', event.id);
      const legacy = submission(event, initial, '新外援', 'guest-register', 'registered');
      assert.equal(legacy.expectedParticipant, undefined);
      call('submitParticipation', event.id, legacy);
      assert.throws(() => call('submitParticipation', event.id, { ...legacy, requestId: 'legacy-stale' }), { code: 'PARTICIPATION_CHANGED' });
      const form = call('getForm', event.id);
      const guestLeave = submission(event, form, '新外援', 'guest-leave');
      const memberLeave = submission(event, form, '成員1', 'manual-leave');
      call('submitParticipation', event.id, memberLeave);
      call('submitParticipation', event.id, guestLeave);
      assert.equal(call('getForm', event.id).registrationLeaves.length, 1);
      assert.throws(() => call('submitParticipation', event.id, { ...guestLeave, requestId: 'stale-guest' }), { code: 'PARTICIPATION_CHANGED' });
      const beforeRename = call('getForm', event.id);
      const renamed = submission(event, beforeRename, '成員2', 'renamed');
      call('updateMember', 'u2', { name: '新名字', primaryProfessionId: 1, secondaryProfessionId: null, revision: members[2].revision });
      assert.throws(() => call('submitParticipation', event.id, renamed), { code: 'PARTICIPATION_CHANGED' });
      const beforeDuplicate = call('getForm', event.id);
      const duplicate = submission(event, beforeDuplicate, '成員3', 'duplicate-name');
      call('addMember', { uid: 'dup', name: '成員3', primaryProfessionId: 1 });
      assert.throws(() => call('submitParticipation', event.id, duplicate), { code: 'PARTICIPATION_CHANGED' });
      const selected = submission(event, call('getForm', event.id), '成員3', 'selected-duplicate', 'leave', { memberUid: 'u3' });
      assert.equal(call('submitParticipation', event.id, selected).status, 'leave');
      assert.throws(() => call('submitParticipation', event.id, { ...selected, requestId: 'invalid-scope', expectedParticipant: {} }));
      for (const person of [
        { ...selected.expectedParticipant.person, nested: { unexpected: true } },
        { ...selected.expectedParticipant.person, isInGuild: 'true' },
      ]) assert.throws(() => call('submitParticipation', event.id, {
        ...selected, requestId: 'malformed-scope', expectedParticipant: { eventRevision: event.revision, person },
      }));
    } finally { close(); }
  });
}

function runner(results) {
  let success, failure;
  const calls = [];
  return {
    calls,
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler(fn) { failure = fn; return this; },
    submitParticipation(...args) {
      calls.push(structuredClone(args));
      const result = results.shift();
      if (result instanceof Error) failure(result);
      else success(result);
    },
  };
}
const busy = { __gasRpc: 1, ok: false, error: { code: 'BUSY', message: '稍候' } };
test('GAS BUSY backs off with the same input/context and succeeds without clearing a draft or changing requestId', async () => {
  setGasSession({ user: {}, sessionToken: 'a'.repeat(64), csrfToken: 'csrf' });
  const run = runner([busy, busy, { __gasRpc: 1, ok: true, data: { status: 'leave' } }]);
  const input = { name: '成員', note: '保留輸入', requestId: 'same-request', status: 'leave' };
  const waits = [];
  let notifications = 0;
  try {
    assert.deepEqual(await callGas('submitParticipation', ['event', input], run, { wait: async (ms) => waits.push(ms), random: () => 0, onBusyRetry: () => notifications++ }), { status: 'leave' });
    assert.deepEqual(waits, [350, 700]);
    assert.equal(notifications, 2);
    assert.equal(run.calls.length, 3);
    assert.ok(run.calls.every((call) => JSON.stringify(call) === JSON.stringify(run.calls[0])));
    assert.equal(input.note, '保留輸入');
  } finally { setGasSession({ user: null }); }
});

test('BUSY retry is bounded and transport, version, validation and authorization errors are not blindly retried', async () => {
  for (const result of [busy, new Error('傳輸中斷'), ...['PARTICIPATION_CHANGED', 'VALIDATION_ERROR', 'AUTH_REQUIRED'].map((code) => ({ __gasRpc: 1, ok: false, error: { code, message: code } }))]) {
    const run = runner([result, result, result]);
    await assert.rejects(callGas('submitParticipation', ['event', {}], run, { wait: async () => {}, random: () => 0 }));
    assert.equal(run.calls.length, result === busy ? 3 : 1);
  }
});
