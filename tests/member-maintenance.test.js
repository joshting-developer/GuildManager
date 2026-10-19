import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { csrfToken } from '../server/auth-repository.js';
import { createMemberClient } from '../src/api/members.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { gasRuntime, cloudSession, cloudResult, fixtureCsv } from './helpers/gas-runtime.js';

const person = (uid, name = '現在名') => ({ uid, name, primaryProfessionId: 3, secondaryProfessionId: null });
// Never send the ordinary endpoint's immutable uid field to management writes.
function edit(newUid, revision, requestId) {
  const { uid, ...profile } = person(newUid);
  const input = { ...profile, newUid, revision, requestId };
  return input;
}
const code = (expected) => (error) => error.code === expected;

function contract(api) {
  api.add(person('0001'));
  api.add(person('occupied', '另一人'));
  const event = api.event({ title: '維護測試', type: 'scrimmage', dates: ['2026-10-19'], requestId: 'event' });
  const teams = emptyLineup();
  teams[0].slots[0].uid = '0001';
  api.confirm({ eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'lineup', teams });
  const template = api.template({ name: '原配置', teams, requestId: 'template' });
  const swapped = emptyLineup();
  swapped[0].slots[0].uid = 'occupied';
  swapped[0].slots[0].secondRound = { uid: '0001', profession: 'primary' };
  const secondTemplate = api.template({ name: '第二場配置', teams: swapped, requestId: 'template-second' });
  const upload = { requestId: 'upload', records: [{ eventId: event.id, roundNumber: 1,
    type: 'scrimmage', datetime: '2026-10-19', filename: 'sample.csv', csvText: fixtureCsv('現在名'), redTeam: '紅', blueTeam: '藍' }] };
  const record = api.upload(upload).records[0];
  api.response(event.id, { uid: '0001', status: 'leave', note: '保留備註', revision: 0 });

  assert.throws(() => api.edit('0001', edit('occupied', 1, 'conflict')), code('DUPLICATE_UID'));
  assert.equal(api.row('0001').revision, 1);
  const first = api.history('0001', { revision: 1, requestId: 'history', entries: [{ name: '舊名' }, { name: '錯誤舊名' }] });
  assert.equal(first.member.name, '現在名');
  assert.equal(first.member.previousNames.length, 2);
  assert.deepEqual(api.history('0001', { revision: 1, requestId: 'history', entries: [{ name: '舊名' }, { name: '錯誤舊名' }] }), first);
  const previous = first.member.previousNames.find((entry) => entry.name === '舊名');
  const revised = api.history('0001', { revision: 2, requestId: 'history-correct', entries: [{ id: previous.id, name: '正確舊名' }] });
  assert.equal(revised.member.previousNames.length, 1);
  assert.equal(revised.member.previousNames[0].changedAt, previous.changedAt);
  assert.throws(() => api.history('occupied', { revision: 1, requestId: 'foreign', entries: [{ id: previous.id, name: '冒用' }] }), code('INVALID_HISTORY'));
  assert.throws(() => api.history('0001', { revision: 3, requestId: 'dup', entries: [{ name: '重複' }, { name: '重複' }] }), code('DUPLICATE_NAME'));
  assert.throws(() => api.history('0001', { revision: 3, requestId: 'current-name', entries: [{ name: '現在名' }] }), code('DUPLICATE_NAME'));
  assert.throws(() => api.history('0001', { revision: 1, requestId: 'stale', entries: [] }), code('STALE_MEMBER'));

  const input = edit('000000000000000001', 3, 'uid-correct');
  const changed = api.edit('0001', input);
  assert.equal(changed.member.uid, input.newUid);
  assert.equal(changed.member.revision, 4);
  assert.equal(changed.member.previousNames[0].name, '正確舊名');
  assert.deepEqual(api.edit('0001', input), changed);
  assert.throws(() => api.edit('0001', { ...input, newUid: 'different' }), code('REQUEST_CONFLICT'));
  assert.throws(() => api.row('0001'), code('MEMBER_NOT_FOUND'));
  assert.equal(api.detail(record.id).players[0].memberUid, input.newUid);
  assert.equal(api.personal(input.newUid).total, 1);
  let snapshot = api.lineup(event.id).versions[0];
  assert.equal(snapshot.teams[0].slots[0].uid, input.newUid);
  assert.equal(snapshot.teams[0].slots[0].member.name, '現在名');
  assert.equal(api.apply(template.id, event.id).teams[0].slots[0].uid, null); // still on leave
  const attendance = api.attendance(event.id);
  assert.equal(attendance.leave.length, 1);
  api.response(event.id, { uid: input.newUid, status: 'registered', revision: 2, note: '重新報名' });
  assert.equal(api.apply(template.id, event.id).teams[0].slots[0].uid, input.newUid);
  assert.equal(api.apply(secondTemplate.id, event.id).teams[0].slots[0].secondRound.uid, input.newUid);
  assert.equal(api.template({ name: '原配置', teams, requestId: 'template' }).teams[0].slots[0].uid, input.newUid);
  assert.equal(api.analysis(record.id).sides.red.groups[0].rows.length, 1);

  // A reused original UID and its new snapshots are independent of the correction.
  api.add(person('0001', '不同人'));
  const secondChange = api.edit(input.newUid, edit('final-uid', 4, 'uid-again'));
  assert.equal(secondChange.member.uid, 'final-uid');
  assert.equal(api.lineup(event.id).versions[0].teams[0].slots[0].uid, 'final-uid');
  assert.equal(api.row('0001').name, '不同人');
  assert.throws(() => api.remove('final-uid', { revision: 5, requestId: 'bad-confirm', confirmUid: '0001' }), code('CONFIRMATION_REQUIRED'));
  assert.throws(() => api.remove('final-uid', { revision: 4, requestId: 'stale-delete', confirmUid: 'final-uid' }), code('STALE_MEMBER'));
  const removal = { revision: 5, requestId: 'delete', confirmUid: 'final-uid' };
  assert.equal(api.remove('final-uid', removal).deleted, true);
  assert.equal(api.attendance(event.id).registered.length, 0);
  assert.throws(() => api.row('final-uid'), code('MEMBER_NOT_FOUND'));
  assert.equal(api.detail(record.id).players[0].memberUid ?? null, null);
  assert.equal(api.detail(record.id).players[0].player, '現在名');
  snapshot = api.lineup(event.id).versions[0];
  assert.equal(snapshot.teams[0].slots[0].uid, null);
  assert.equal(snapshot.teams[0].slots[0].member.name, '現在名');
  api.add(person('final-uid', '新使用者'));
  assert.equal(api.personal('final-uid').total, 0);
  assert.deepEqual(api.remove('final-uid', removal), { uid: 'final-uid', deleted: true });
  assert.equal(api.row('final-uid').name, '新使用者');
  assert.throws(() => api.remove('final-uid', { ...removal, requestId: 'stale-after-reuse' }), code('STALE_MEMBER'));
  assert.throws(() => api.history('final-uid', { revision: 5, requestId: 'stale-history-after-reuse', entries: [] }), code('STALE_MEMBER'));
  assert.equal(api.lineup(event.id).versions[0].teams[0].slots[0].uid, null);
  assert.equal(api.upload(upload).records[0].id, record.id); // original upload retry unchanged
}

function local(repo) {
  return { add: repo.addMember, event: repo.createEvent, confirm: repo.confirmLineup,
    template: repo.createLineupTemplate, upload: repo.saveBattleRecords, response: repo.saveMemberResponse,
    history: repo.saveMemberNameHistory, edit: repo.maintainMember, remove: repo.deleteMemberPermanently,
    row: (uid) => repo.getMemberMaintenance(uid).member, detail: repo.getBattleRecord,
    personal: repo.getMemberBattleRecords, lineup: repo.getLineupHistory,
    apply: repo.applyLineupTemplate, analysis: repo.getBattleTeamAnalysis, attendance: repo.getEventAttendance };
}

test('SQLite member maintenance preserves records, foreign keys, snapshot immutability and safe retries across UID reuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-member-maintenance-'));
  const filename = join(dir, 'test.sqlite');
  let repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    contract(local(repo));
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    const snapshot = JSON.parse(db.prepare('SELECT snapshot_json FROM lineup_versions').get().snapshot_json);
    assert.equal(snapshot.teams[0].slots[0].uid, '0001');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM member_name_history').get().n, 0);
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.getLineupHistory(db.prepare('SELECT event_id FROM lineup_versions').get().event_id).versions[0].teams[0].slots[0].uid, null);
    assert.equal(repo.getMemberMaintenance('final-uid').member.name, '新使用者');
  } finally { repo.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('GAS real RPC runs the same maintenance contract and rejects member/anonymous calls', async () => {
  const env = await gasRuntime(); env.setup();
  const admin = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]));
  const context = cloudSession(admin);
  const call = (name, args = []) => cloudResult(env.raw(name, args, context));
  contract({
    add: (input) => call('addMember', [input]).member, event: (input) => call('createEvent', [input]).event,
    confirm: (input) => call('confirmLineup', [input]), template: (input) => call('createLineupTemplate', [input]).template,
    upload: (input) => call('saveBattleRecords', [input]), response: (id, input) => call('saveMemberResponse', [id, input]),
    history: (uid, input) => call('saveMemberNameHistory', [uid, input]), edit: (uid, input) => call('maintainMember', [uid, input]),
    remove: (uid, input) => call('deleteMemberPermanently', [uid, input]), row: (uid) => call('getMemberMaintenance', [uid]).member,
    detail: (id) => call('getBattleRecord', [id]).record, personal: (uid) => call('getMemberBattleRecords', [uid, 1, {}]),
    lineup: (id) => call('getLineupHistory', [id]), apply: (id, eventId) => call('applyLineupTemplate', [id, eventId]),
    analysis: (id) => call('getBattleTeamAnalysis', [id]), attendance: (id) => call('getEventAttendance', [id]),
  });
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  for (const [operation, args] of [['getMemberMaintenance', ['final-uid']], ['maintainMember', ['final-uid', edit('x', 1, 'member')]],
    ['saveMemberNameHistory', ['final-uid', { revision: 1, requestId: 'member', entries: [] }]],
    ['deleteMemberPermanently', ['final-uid', { revision: 1, requestId: 'member', confirmUid: 'final-uid' }]]]) {
    assert.equal(env.raw(operation, args).error.code, 'AUTH_REQUIRED');
    assert.equal(env.raw(operation, args, member).error.code, 'MANAGEMENT_REQUIRED');
    if (operation !== 'getMemberMaintenance')
      assert.equal(env.raw(operation, args, { ...context, csrfToken: 'bad' }).error.code, 'CSRF_INVALID');
  }
  env.failOn('GM_members');
  const before = call('getMemberMaintenance', ['final-uid']).member;
  assert.equal(env.raw('maintainMember', ['final-uid', edit('rollback', before.revision, 'rollback')], context).ok, false);
  env.failOn(null);
  assert.deepEqual(call('getMemberMaintenance', ['final-uid']).member, before);
  assert.equal(env.raw('getMemberMaintenance', ['rollback'], context).error.code, 'MEMBER_NOT_FOUND');
  call('createManager', [{ username: 'manager', password: 'manager-password-123' }]);
  const manager = cloudSession(cloudResult(env.raw('login', [{ username: 'manager', password: 'manager-password-123' }])));
  const row = cloudResult(env.raw('getMemberMaintenance', ['final-uid'], manager)).member;
  const history = cloudResult(env.raw('saveMemberNameHistory', ['final-uid', {
    revision: row.revision, requestId: 'manager-history', entries: [{ name: '管理者補名' }],
  }], manager)).member;
  const updated = cloudResult(env.raw('maintainMember', ['final-uid', edit('manager-fixed', history.revision, 'manager-edit')], manager)).member;
  assert.equal(cloudResult(env.raw('deleteMemberPermanently', ['manager-fixed', {
    revision: updated.revision, requestId: 'manager-delete', confirmUid: 'manager-fixed',
  }], manager)).deleted, true);
});

test('SQLite failed UID, history and delete writes roll back all related changes and retry receipts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-maintenance-rollback-'));
  const filename = join(dir, 'test.sqlite');
  const repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    repo.addMember(person('001'));
    repo.saveMemberNameHistory('001', { revision: 1, requestId: 'seed-history', entries: [{ name: '保留舊名' }] });
    const before = repo.getMemberMaintenance('001');
    db.exec("CREATE TRIGGER reject_member_delete BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    assert.throws(() => repo.maintainMember('001', edit('002', 2, 'fail-edit')), /simulated failure/);
    assert.throws(() => repo.deleteMemberPermanently('001', { revision: 2, requestId: 'fail-delete', confirmUid: '001' }), /simulated failure/);
    assert.deepEqual(repo.getMemberMaintenance('001'), before);
    assert.throws(() => repo.getMemberMaintenance('002'), code('MEMBER_NOT_FOUND'));
    assert.equal(db.prepare("SELECT count(*) AS n FROM member_maintenance_requests WHERE request_id LIKE 'fail-%'").get().n, 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON member_name_history BEGIN SELECT RAISE(ABORT, 'simulated history failure'); END");
    assert.throws(() => repo.saveMemberNameHistory('001', { revision: 2, requestId: 'fail-history', entries: [{ name: '不應寫入' }] }), /simulated history failure/);
    assert.deepEqual(repo.getMemberMaintenance('001'), before);
  } finally { repo.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

// Run the actual Express middleware and JSON routes without opening a socket.
// Live HTTP integration remains covered by the existing application suites.
function inProcessFetch(app, session, csrf = true) {
  return (path, options = {}) => new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
    const request = new IncomingMessage(socket);
    request.method = options.method || 'GET';
    request.url = path;
    request.httpVersion = '1.1';
    const headers = new Headers(options.headers);
    if (session) {
      headers.set('Cookie', `guild_session=${session.token}`);
      if (csrf) headers.set('X-CSRF-Token', csrfToken(session.token));
    }
    if (options.body) headers.set('Content-Length', String(Buffer.byteLength(options.body)));
    request.headers = Object.fromEntries(headers);
    request.on('end', () => { request.complete = true; });
    const response = new ServerResponse(request);
    const timeout = setTimeout(() => reject(new Error('Express response timed out')), 2000);
    response.end = (body) => {
      clearTimeout(timeout);
      resolve(new Response(body, { status: response.statusCode, headers: response.getHeaders() }));
      socket.destroy();
    };
    app.handle(request, response);
    if (options.body) request.push(options.body);
    request.push(null);
  });
}

test('Express routes and member client enforce manager-only endpoints, CSRF and immutable ordinary UID writes', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const admin = await repo.createAccount({ username: 'admin', password: 'admin-password-123' });
  await repo.createAccount({ username: 'manager', password: 'manager-password-123' });
  await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
  const manager = await repo.authenticate({ username: 'manager', password: 'manager-password-123' });
  const member = await repo.authenticateMember({ password: 'Member123' });
  repo.addMember(person('001'));
  const app = createApp(repo);
  const fetchAs = (session, csrf = true) => inProcessFetch(app, session, csrf);
  try {
    for (const client of [createMemberClient({ fetchImpl: fetchAs(member) }), createMemberClient({ fetchImpl: fetchAs() })]) {
      await assert.rejects(client.getMemberMaintenance('001'));
      await assert.rejects(client.maintainMember('001', edit('002', 1, 'deny')));
      await assert.rejects(client.saveMemberNameHistory('001', { revision: 1, requestId: 'deny', entries: [] }));
      await assert.rejects(client.deleteMemberPermanently('001', { revision: 1, requestId: 'deny', confirmUid: '001' }));
    }
    const client = createMemberClient({ fetchImpl: fetchAs(manager) });
    const noCsrf = createMemberClient({ fetchImpl: fetchAs(manager, false) });
    await assert.rejects(noCsrf.maintainMember('001', edit('002', 1, 'csrf')), code('CSRF_INVALID'));
    await assert.rejects(client.updateMember('001', { ...person('002'), revision: 1 }), code('VALIDATION_ERROR'));
    assert.equal((await client.getMemberMaintenance('001')).member.uid, '001');
    const updated = await client.maintainMember('001', edit('002', 1, 'http-edit'));
    // More than 16 KB verifies that the history route supports its documented limit.
    const entries = Array.from({ length: 150 }, (_,i) => ({ name: `歷史名${i}${'長'.repeat(50)}` }));
    const history = await client.saveMemberNameHistory('002', { revision: updated.member.revision, requestId: 'http-history', entries });
    assert.equal(history.member.previousNames.length, 150);
    assert.equal((await client.deleteMemberPermanently('002', { revision: history.member.revision, requestId: 'http-delete', confirmUid: '002' })).deleted, true);
  } finally { repo.close(); }
});
