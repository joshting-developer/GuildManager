import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, PROFESSIONS } from '../gas/src/members-events.js';
import { createParticipation } from '../gas/src/participation.js';
import { createSheetStore } from '../gas/src/storage.js';
import { gasEnvironment } from './helpers/gas-environment.js';

function fixture() {
  const env = gasEnvironment(),
    storage = createSheetStore(env);
  storage.initialize();
  storage.transaction((store) => {
    for (const job of PROFESSIONS) store.put('professions', job.job_id, job);
  });
  const options = {
    uuid: env.utilities.getUuid,
    now: () => new Date().toISOString(),
    guildName: '測試幫會',
  };
  function call(operation, args = []) {
    return storage.transaction((store) => {
      const catalog = createCatalog(store, options),
        participation = createParticipation(store, catalog, options);
      return { ...catalog.methods, ...participation.methods }[operation](args);
    });
  }
  return { env, call, storage };
}
const person = (uid, name) => ({
  uid,
  name,
  primaryProfessionId: 1,
  secondaryProfessionId: 2,
  isInGuild: true,
  isInClub: true,
});
test('GAS members, immutable UID, rename history, membership, import and concurrency', () => {
  const { call } = fixture();
  assert.equal(call('getMembers').members.length, 0);
  const { member } = call('addMember', [person('0001', '城')]);
  assert.equal(member.uid, '0001');
  assert.throws(() => call('addMember', [person('0001', '新')]), { code: 'DUPLICATE_UID' });
  const { uid, ...input } = person('0001', '新名');
  const changed = call('updateMember', ['0001', { ...input, revision: 1 }]).member;
  assert.equal(changed.previousNames[0].name, '城');
  assert.throws(() => call('updateMember', ['0001', { ...input, name: '其他', revision: 1 }]), {
    code: 'STALE_MEMBER',
  });
  assert.equal(call('removeMember', ['0001', 2]).member.isInClub, false);
  const source = { text: '0001 舊名 素問 -\n0002 新成員 龍吟 -' };
  const preview = call('previewMemberImport', [source]);
  assert.equal(preview.summary.skipped, 1);
  const result = call('importMembers', [{ ...source, fingerprint: preview.fingerprint }]);
  assert.equal(result.summary.added, 1);
  assert.equal(call('getMembers').members[0].name, '新名');
  assert.throws(() => call('importMembers', [{ ...source, fingerprint: preview.fingerprint }]), {
    code: 'STALE_IMPORT',
  });
});
test('GAS events split battle dates, retain empty titles and make request retries atomic', () => {
  const { call, env } = fixture();
  const input = {
    type: 'guild_war',
    dates: ['2026-10-11', '2026-10-04'],
    title: '',
    requestId: 'batch',
  };
  const first = call('createEvent', [input]);
  assert.equal(first.events.length, 2);
  assert.deepEqual(call('createEvent', [input]), first);
  assert.throws(() => call('createEvent', [{ ...input, title: '不同' }]), {
    code: 'REQUEST_CONFLICT',
  });
  assert.throws(() => call('createEvent', [{ ...input, type: 'scrimmage', requestId: 'scrim' }]), {
    code: 'VALIDATION_ERROR',
  });
  env.failOn('GM_requests');
  assert.throws(() => call('createEvent', [{ ...input, requestId: 'failure' }]));
  env.failOn(null);
  assert.equal(call('getEvents').events.length, 2);
  const event = first.events[0];
  call('updateEvent', [
    event.id,
    { type: 'guild_war', title: '測試', dates: event.dates, revision: 1 },
  ]);
  assert.throws(() => call('deleteEvent', [event.id, 1]), { code: 'REVISION_CONFLICT' });
  call('deleteEvent', [event.id, 2]);
  assert.equal(call('getEvents').events.length, 1);
});
test('GAS participation handles roster, outsiders, mixed names, leave, professions and retries', () => {
  const { call } = fixture();
  call('addMember', [person('a', '城')]);
  const event = call('createEvent', [
    { type: 'scrimmage', title: '對戰', dates: ['2026-10-04'], requestId: 'event' },
  ]).event;
  const submit = (name, status, id) => {
    const revision = call('getEventParticipation', [event.id]).revision;
    return { name, status, note: '=公式也只當文字', professionId: 3, requestId: id, revision };
  };
  const first = submit('城', 'registered', 'member');
  call('submitParticipation', [event.id, first]);
  assert.deepEqual(call('submitParticipation', [event.id, first]), {
    eventId: event.id,
    name: '城',
    status: 'registered',
  });
  call('submitParticipation', [event.id, submit('外援', 'registered', 'guest')]);
  assert.equal(call('getEventParticipation', [event.id]).registrations.length, 1);
  call('submitParticipation', [event.id, submit('外援', 'leave', 'leave')]);
  assert.equal(call('getEventParticipation', [event.id]).registrationLeaves.length, 1);
  call('submitParticipation', [event.id, submit('外援', 'registered', 'return')]);
  assert.equal(call('getEventParticipation', [event.id]).registrations.length, 1);
  assert.throws(
    () => call('submitParticipation', [event.id, submit('不存在', 'leave', 'unknown')]),
    { code: 'PARTICIPATION_NOT_FOUND' },
  );
  call('addMember', [person('b', '城')]);
  assert.throws(
    () => call('submitParticipation', [event.id, submit('城', 'registered', 'duplicate')]),
    { code: 'PARTICIPATION_AMBIGUOUS' },
  );
  const input = submit('城', 'leave', 'selected');
  call('submitParticipation', [event.id, { ...input, memberUid: 'a' }]);
  assert.equal(call('getEventParticipation', [event.id]).responses[0].professionId, 3);
});

test('GAS membership omissions, invalid import and profession updates preserve existing data', () => {
  const { call, storage } = fixture();
  const member = call('addMember', [{ ...person('001', '城'), isInGuild: false }]).member;
  const changed = call('updateMember', [
    '001',
    {
      name: member.name,
      primaryProfessionId: 3,
      secondaryProfessionId: null,
      revision: member.revision,
    },
  ]).member;
  assert.equal(changed.isInGuild, false);
  assert.equal(changed.isInClub, true);
  assert.deepEqual(changed.previousNames, []);
  const preview = call('previewMemberImport', [{ text: '002 第二位 碎夢 -\n003 第三位 不存在 -' }]);
  assert.ok(preview.issues.length);
  assert.throws(
    () =>
      call('importMembers', [
        { text: '002 第二位 碎夢 -\n003 第三位 不存在 -', fingerprint: 'invalid' },
      ]),
    { code: 'IMPORT_INVALID' },
  );
  assert.equal(call('getMembers').members.length, 1);
  storage.transaction((store) =>
    store.put('professions', 10, { job_id: 10, name: '新職業', colorcode: '#abcdef' }),
  );
  assert.equal(call('getProfessions').professions.length, 10);
  assert.equal(
    call('addMember', [{ ...person('004', '第四位'), primaryProfessionId: 10 }]).member
      .primaryProfession,
    '新職業',
  );
});

test('GAS duty state and rename, deleted event retries and participation stale inputs', () => {
  const { call } = fixture();
  const duty = call('addDuty', [{ name: '保鑣' }]).duty;
  assert.throws(() => call('addDuty', [{ name: '保鑣' }]), { code: 'DUPLICATE_DUTY' });
  const updated = call('updateDuty', [duty.id, { name: '山盟', active: false, revision: 1 }]).duty;
  assert.equal(updated.active, false);
  assert.throws(() => call('updateDuty', [duty.id, { name: '山盟', active: true, revision: 1 }]), {
    code: 'REVISION_CONFLICT',
  });
  const input = { type: 'dragon_tiger', title: '', dates: ['2026-10-04'], requestId: 'dragon' };
  const event = call('createEvent', [input]).events[0];
  const revision = call('getEventParticipation', [event.id]).revision;
  const signup = {
    name: '外援',
    status: 'registered',
    professionId: 1,
    note: '',
    revision,
    requestId: 'signup',
  };
  call('submitParticipation', [event.id, signup]);
  assert.throws(
    () =>
      call('submitParticipation', [event.id, { ...signup, name: '其他人', requestId: 'stale' }]),
    { code: 'PARTICIPATION_CHANGED' },
  );
  assert.equal(call('getEventParticipation', [event.id]).registrations.length, 1);
  call('deleteEvent', [event.id, 1]);
  assert.deepEqual(call('deleteEvent', [event.id, 1]), { id: event.id });
  assert.deepEqual(call('createEvent', [input]).events[0], event);
  assert.deepEqual(call('getEvents').events, []);
});
