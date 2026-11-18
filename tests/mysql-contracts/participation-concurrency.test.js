import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { participationTarget } from '../../src/domain/participation-target.js';

async function fixture(source) {
  let repo, call, close = () => {};
  if (source === 'local') {
    repo = (await createRepository());
    close = async () => (await repo.close());
    call = async (op, ...args) => {
      if (op === 'getForm') return (await repo.getEventParticipationForm(...args));
      if (op === 'addMember') return (await repo.addMember(...args));
      if (op === 'updateMember') return (await repo.updateMember(...args));
      return (await repo[op](...args));
    };
  }
  const members = [];
  for (let i = 0; i < 12; i++) members.push((await call('addMember', { uid: `u${i}`, name: `成員${i}`, primaryProfessionId: 1, isInGuild: true, isInClub: true })));
  const event = (await call('createEvent', { title: '同時請假', type: 'scrimmage', dates: ['2026-10-19'], requestId: 'event' }));
  return { call, close, event, members };
}

function submission(event, form, name, requestId, status = 'leave', extra = {}) {
  const input = { name, requestId, status, note: '不能出席，請保留', professionId: status === 'registered' ? 3 : null, revision: form.revision, ...extra };
  const person = participationTarget(input, form);
  input.expectedParticipant = { person };
  return input;
}

for (const source of ['local']) {
  test(`${source}: twelve members using one old form can leave without reloading; same-person stale edits and replay stay protected`, async () => {
    const { call, close, event } = await fixture(source);
    try {
      const form = (await call('getForm', event.id));
      const inputs = Array.from({ length: 12 }, (_, i) => submission(event, form, `成員${i}`, `leave-${i}`, 'leave', { memberUid: `u${i}` }));
      for (const input of inputs) assert.equal((await call('submitParticipation', event.id, input)).status, 'leave');
      assert.equal((await call('getForm', event.id)).responses.filter((r) => r.status === 'leave').length, 12);
      (await assert.rejects(async () => (await call('submitParticipation', event.id, { ...inputs[0], requestId: 'same-person-stale' })), { code: 'PARTICIPATION_CHANGED' }));
      (await assert.rejects(async () => (await call('submitParticipation', event.id, { ...inputs[0], note: '其他內容' })), { code: 'REQUEST_CONFLICT' }));
      const latest = (await call('getForm', event.id));
      (await call('submitParticipation', event.id, submission(event, latest, '成員0', 'register-again', 'registered')));
      assert.equal((await call('submitParticipation', event.id, inputs[0])).status, 'leave');
      assert.equal((await call('getForm', event.id)).responses.find((r) => r.uid === 'u0').status, 'registered');
      const beforeEventChange = (await call('getForm', event.id));
      const staleEvent = submission(event, beforeEventChange, '成員1', 'stale-event');
      (await call('updateEvent', event.id, { title: '改名場次', type: event.type, dates: event.dates, revision: 1 }));
      assert.equal((await call('submitParticipation', event.id, staleEvent)).status, 'leave');
    } finally { (await close()); }
  });

  test(`${source}: manual names, guests, ambiguous identities, roster changes and legacy submissions remain checked`, async () => {
    const { call, close, event, members } = await fixture(source);
    try {
      const initial = (await call('getForm', event.id));
      const legacy = submission(event, initial, '新外援', 'guest-register', 'registered');
      assert.deepEqual(legacy.expectedParticipant, { person: null });
      (await call('submitParticipation', event.id, legacy));
      (await assert.rejects(async () => (await call('submitParticipation', event.id, { ...legacy, requestId: 'legacy-stale' })), { code: 'PARTICIPATION_CHANGED' }));
      const form = (await call('getForm', event.id));
      const guestLeave = submission(event, form, '新外援', 'guest-leave');
      const memberLeave = submission(event, form, '成員1', 'manual-leave');
      (await call('submitParticipation', event.id, memberLeave));
      (await call('submitParticipation', event.id, guestLeave));
      assert.equal((await call('getForm', event.id)).registrationLeaves.length, 1);
      (await assert.rejects(async () => (await call('submitParticipation', event.id, { ...guestLeave, requestId: 'stale-guest' })), { code: 'PARTICIPATION_CHANGED' }));
      const beforeRename = (await call('getForm', event.id));
      const renamed = submission(event, beforeRename, '成員2', 'renamed');
      (await call('updateMember', 'u2', { name: '新名字', primaryProfessionId: 1, secondaryProfessionId: null, revision: members[2].revision }));
      (await assert.rejects(async () => (await call('submitParticipation', event.id, renamed)), { code: 'PARTICIPATION_CHANGED' }));
      const beforeDuplicate = (await call('getForm', event.id));
      const duplicate = submission(event, beforeDuplicate, '成員3', 'duplicate-name');
      (await call('addMember', { uid: 'dup', name: '成員3', primaryProfessionId: 1 }));
      (await assert.rejects(async () => (await call('submitParticipation', event.id, duplicate)), { code: 'PARTICIPATION_CHANGED' }));
      const selected = submission(event, (await call('getForm', event.id)), '成員3', 'selected-duplicate', 'leave', { memberUid: 'u3' });
      assert.equal((await call('submitParticipation', event.id, selected)).status, 'leave');
      (await assert.rejects(async () => (await call('submitParticipation', event.id, { ...selected, requestId: 'invalid-scope', expectedParticipant: {} }))));
      for (const person of [
        { ...selected.expectedParticipant.person, nested: { unexpected: true } },
        { ...selected.expectedParticipant.person, isInGuild: 'true' },
      ]) (await assert.rejects(async () => (await call('submitParticipation', event.id, {
        ...selected, requestId: 'malformed-scope', expectedParticipant: { eventRevision: event.revision, person },
      }))));
    } finally { (await close()); }
  });
}
