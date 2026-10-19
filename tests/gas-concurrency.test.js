import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetStore, createPrivateStore } from '../gas/src/storage.js';
import { gasEnvironment } from './helpers/gas-environment.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';
import { participationTarget } from '../src/domain/participation-target.js';

test('read-only journal pins commits and refuses writes, removals and missing-table creation', () => {
  const env = gasEnvironment(), storage = createSheetStore(env);
  storage.initialize();
  storage.transaction((store) => store.put('members', 'a', { name: '原始' }));
  const before = JSON.stringify([...env.sheets].map(([name, sheet]) => [name, sheet.data]));
  for (const action of [
    (store) => store.put('members', 'b', {}),
    (store) => store.remove('members', 'a'),
  ]) assert.throws(() => storage.transaction(action, { readOnly: true }), { code: 'READ_ONLY' });
  assert.equal(JSON.stringify([...env.sheets].map(([name, sheet]) => [name, sheet.data])), before);
  env.sheets.delete('GM_videos');
  assert.throws(() => storage.transaction((store) => store.ensureTable('videos'), { readOnly: true }), { code: 'TABLE_INITIALIZATION_REQUIRED' });
  assert.equal(env.sheets.has('GM_videos'), false);
  storage.transaction((store) => {
    assert.equal(store.get('members', 'a').name, '原始');
    storage.transaction((writer) => {
      writer.put('members', 'a', { name: '新值' });
      writer.put('duties', 'd', { name: '新職責' });
    });
    assert.equal(store.get('members', 'a').name, '原始');
    assert.equal(store.get('duties', 'd'), undefined);
  }, { readOnly: true });
  assert.equal(storage.transaction((store) => store.get('members', 'a')).name, '新值');
});

test('private auth readers retry publication/cleanup races but reject stable corruption and bounded churn', () => {
  const env = gasEnvironment();
  let id = 0;
  const storage = createPrivateStore(env.propertyService, () => `generation-${++id}`);
  const old = { accounts: [], sessions: [], limits: [] };
  const updated = { ...old, limits: [{ id: 'new' }] };
  storage.save(old);
  const get = env.propertyService.getProperty;
  let swapped = false;
  env.propertyService.getProperty = (key) => {
    if (key === 'GM_AUTH_generation-1_0' && !swapped) { swapped = true; storage.save(updated); }
    return get(key);
  };
  assert.deepEqual(storage.load(), updated);
  env.propertyService.getProperty = get;
  env.propertyService.deleteProperty('GM_AUTH_generation-2_0');
  assert.throws(() => storage.load(), { code: 'AUTH_STORAGE_INVALID' });
  storage.save(old);
  let checks = 0;
  env.propertyService.getProperty = (key) => {
    if (key === 'GM_AUTH_POINTER' && ++checks % 2 === 0) storage.save(old);
    return get(key);
  };
  assert.throws(() => storage.load(), { code: 'BUSY' });
  assert.equal(checks, 6);
});

async function fixture() {
  const env = await gasRuntime();
  env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.rpc(op, args, context));
  call('addMember', [{ uid: 'a', name: '成員甲', primaryProfessionId: 1 }]);
  const event = call('createEvent', [{ title: '交錯測試', type: 'scrimmage', dates: ['2026-10-19'], requestId: 'event' }]).event;
  const input = { requestId: 'upload', records: [1, 2].map((roundNumber) => ({
    eventId: event.id, roundNumber, type: event.type, datetime: event.dates[0],
    redTeam: '紅', blueTeam: '藍', filename: `round-${roundNumber}.csv`, csvText: fixtureCsv(),
  })) };
  return { env, context, call, event, input };
}

test('all audited reads bypass an occupied writer lock while permissions and writes remain enforced', async () => {
  const { env, context, event } = await fixture();
  env.lock.tryLock();
  try {
    for (const op of [
      'getAuthSession', 'getAccountSettings', 'getHomeData', 'getPlatformSettings',
      'getProfessions', 'getMembers', 'getParticipationMembers', 'previewMemberImport',
      'getMemberMaintenance', 'getEvents', 'getEvent', 'getDuties',
      'getEventParticipation', 'getEventParticipationForm', 'getEventParticipationMembers',
      'getEventAttendance', 'getLineupIndex', 'getLineupHistory', 'applyLineupTemplate',
      'getBattleRecords', 'getBattleRecord', 'getBattleTeamAnalysis', 'getMemberBattleRecords',
      'getBattleAttachment', 'previewBattleMemberSync', 'getEventVideos', 'getLottery',
    ]) assert.notEqual(env.rpc(op, [event.id], context).error?.code, 'BUSY', op);
    assert.equal(env.rpc('getAuthSession').data.user, null);
    assert.equal(env.rpc('getEvents').ok, true);
    assert.equal(env.rpc('getMembers').error.code, 'AUTH_REQUIRED');
    assert.equal(env.rpc('getEventAttendance', [event.id]).error.code, 'AUTH_REQUIRED');
    assert.equal(env.rpc('createEvent').error.code, 'BUSY');
  } finally { env.lock.releaseLock(); }
  assert.equal(env.rpc('notAudited').error.code, 'OPERATION_INVALID');
});

test('optional table initialization is permission-checked and serialized only when missing', async () => {
  const { env, call, event } = await fixture();
  for (const table of ['GM_videos', 'GM_lottery']) env.sheets.delete(table);
  assert.equal(env.rpc('getEventVideos', [event.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.sheets.has('GM_videos'), false);
  assert.equal(call('getEventVideos', [event.id]).videos.length, 0);
  assert.ok(call('getLottery').lottery);
  env.lock.tryLock();
  try {
    assert.equal(call('getEventVideos', [event.id]).videos.length, 0);
    assert.ok(call('getLottery').lottery);
  } finally { env.lock.releaseLock(); }
});

test('Drive preparation permits an actual leave transaction and final upload retains both rounds and leave', async () => {
  const { env, call, event, input } = await fixture();
  const form = call('getEventParticipationForm', [event.id]);
  const create = env.folder.createFile;
  let inserted = false;
  env.folder.createFile = (blob) => {
    assert.equal(env.lock.tryLock(), true);
    env.lock.releaseLock();
    assert.equal(env.rpc('getEvents').ok, true);
    if (!inserted) {
      inserted = true;
      const leave = { name: '成員甲', status: 'leave', note: '保留備註', requestId: 'leave', revision: form.revision };
      leave.expectedParticipant = { eventRevision: event.revision, person: participationTarget(leave, form) };
      cloudResult(env.rpc('submitParticipation', [event.id, leave]));
    }
    return create(blob);
  };
  const receipt = call('saveBattleRecords', [input]);
  assert.equal(receipt.records.length, 2);
  assert.equal(call('getEventParticipation', [event.id]).responses[0].note, '保留備註');
  assert.equal(env.files.size, 2);
  assert.deepEqual(call('saveBattleRecords', [input]), receipt);
  assert.equal(env.files.size, 2);
});

test('upload rechecks changed event, revoked session and duplicate round after unlocked Drive preparation', async () => {
  for (const kind of ['event', 'session', 'duplicate']) {
    const { env, call, context, event, input } = await fixture();
    const create = env.folder.createFile;
    let inserted = false;
    env.folder.createFile = (blob) => {
      if (!inserted) {
        inserted = true;
        if (kind === 'event') call('updateEvent', [event.id, { type: event.type, title: event.title, dates: ['2026-10-20'], revision: 1 }]);
        if (kind === 'session') call('logout');
        if (kind === 'duplicate') call('saveBattleRecords', [{ ...input, requestId: 'other-upload' }]);
      }
      return create(blob);
    };
    const result = env.rpc('saveBattleRecords', [input], context);
    assert.equal(result.error.code, { event: 'BATTLE_INVALID', session: 'AUTH_REQUIRED', duplicate: 'BATTLE_ROUND_EXISTS' }[kind]);
    env.folder.createFile = create;
    if (kind !== 'session') assert.equal(call('getBattleRecords').total, kind === 'duplicate' ? 2 : 0);
  }
});

test('platform icon reads/writes do not hold the writer lock and concurrent settings are not overwritten', async () => {
  const { env, call } = await fixture();
  const icon = { mimeType: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64') };
  const create = env.folder.createFile;
  env.folder.createFile = (blob) => {
    assert.equal(env.lock.tryLock(), true); env.lock.releaseLock();
    return create(blob);
  };
  const saved = call('updatePlatformSettings', [{ name: '新品牌', revision: 1, icon }]).platform;
  assert.equal(saved.revision, 2);
  assert.ok(saved.iconSrc);
  const read = env.globals.DriveApp.getFileById;
  env.globals.DriveApp.getFileById = (id) => {
    assert.equal(env.lock.tryLock(), true); env.lock.releaseLock();
    return read(id);
  };
  assert.deepEqual(call('getPlatformSettings').platform, saved);
  let changed = false;
  env.folder.createFile = (blob) => {
    if (!changed) { changed = true; call('updatePlatformSettings', [{ name: '其他人的品牌', revision: 2 }]); }
    return create(blob);
  };
  const otherIcon = { ...icon, base64: Buffer.from([137,80,78,71,13,10,26,10,1,0,0,0]).toString('base64') };
  assert.throws(() => call('updatePlatformSettings', [{ name: '我的品牌', revision: 2, icon: otherIcon }]), { code: 'STALE_SETTINGS' });
  assert.equal(call('getPlatformSettings').platform.name, '其他人的品牌');
});
