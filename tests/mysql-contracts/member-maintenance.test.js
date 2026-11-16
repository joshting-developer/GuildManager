import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { emptyLineup } from '../../src/domain/lineups.js';
import { fixtureCsv } from '../helpers/gas-runtime.js';
const person = (uid, name = '現在名') => ({ uid, name, primaryProfessionId: 3, secondaryProfessionId: null });
// Never send the ordinary endpoint's immutable uid field to management writes.
function edit(newUid, revision, requestId) {
  const { uid, ...profile } = person(newUid);
  const input = { ...profile, newUid, revision, requestId };
  return input;
}
const code = (expected) => (error) => error.code === expected;

async function contract(api) {
  (await api.add(person('0001')));
  (await api.add(person('occupied', '另一人')));
  const event = (await api.event({ title: '維護測試', type: 'scrimmage', dates: ['2026-10-19'], requestId: 'event' }));
  const teams = emptyLineup();
  teams[0].slots[0].uid = '0001';
  (await api.confirm({ eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'lineup', teams }));
  const template = (await api.template({ name: '原配置', teams, requestId: 'template' }));
  const swapped = emptyLineup();
  swapped[0].slots[0].uid = 'occupied';
  swapped[0].slots[0].secondRound = { uid: '0001', profession: 'primary' };
  const secondTemplate = (await api.template({ name: '第二場配置', teams: swapped, requestId: 'template-second' }));
  const upload = { requestId: 'upload', records: [{ eventId: event.id, roundNumber: 1,
    type: 'scrimmage', datetime: '2026-10-19', filename: 'sample.csv', csvText: fixtureCsv('現在名'), redTeam: '紅', blueTeam: '藍' }] };
  const record = (await api.upload(upload)).records[0];
  (await api.response(event.id, { uid: '0001', status: 'leave', note: '保留備註', revision: 0 }));

  (await assert.rejects(async () => (await api.edit('0001', edit('occupied', 1, 'conflict'))), code('DUPLICATE_UID')));
  assert.equal((await api.row('0001')).revision, 1);
  const first = (await api.history('0001', { revision: 1, requestId: 'history', entries: [{ name: '舊名' }, { name: '錯誤舊名' }] }));
  assert.equal(first.member.name, '現在名');
  assert.equal(first.member.previousNames.length, 2);
  assert.deepEqual((await api.history('0001', { revision: 1, requestId: 'history', entries: [{ name: '舊名' }, { name: '錯誤舊名' }] })), first);
  const previous = first.member.previousNames.find((entry) => entry.name === '舊名');
  const revised = (await api.history('0001', { revision: 2, requestId: 'history-correct', entries: [{ id: previous.id, name: '正確舊名' }] }));
  assert.equal(revised.member.previousNames.length, 1);
  assert.equal(revised.member.previousNames[0].changedAt, previous.changedAt);
  (await assert.rejects(async () => (await api.history('occupied', { revision: 1, requestId: 'foreign', entries: [{ id: previous.id, name: '冒用' }] })), code('INVALID_HISTORY')));
  (await assert.rejects(async () => (await api.history('0001', { revision: 3, requestId: 'dup', entries: [{ name: '重複' }, { name: '重複' }] })), code('DUPLICATE_NAME')));
  (await assert.rejects(async () => (await api.history('0001', { revision: 3, requestId: 'current-name', entries: [{ name: '現在名' }] })), code('DUPLICATE_NAME')));
  (await assert.rejects(async () => (await api.history('0001', { revision: 1, requestId: 'stale', entries: [] })), code('STALE_MEMBER')));

  const input = edit('000000000000000001', 3, 'uid-correct');
  const changed = (await api.edit('0001', input));
  assert.equal(changed.member.uid, input.newUid);
  assert.equal(changed.member.revision, 4);
  assert.equal(changed.member.previousNames[0].name, '正確舊名');
  assert.deepEqual((await api.edit('0001', input)), changed);
  (await assert.rejects(async () => (await api.edit('0001', { ...input, newUid: 'different' })), code('REQUEST_CONFLICT')));
  (await assert.rejects(async () => (await api.row('0001')), code('MEMBER_NOT_FOUND')));
  assert.equal((await api.detail(record.id)).players[0].memberUid, input.newUid);
  assert.equal((await api.personal(input.newUid)).total, 1);
  let snapshot = (await api.lineup(event.id)).versions[0];
  assert.equal(snapshot.teams[0].slots[0].uid, input.newUid);
  assert.equal(snapshot.teams[0].slots[0].member.name, '現在名');
  assert.equal((await api.apply(template.id, event.id)).teams[0].slots[0].uid, null); // still on leave
  const attendance = (await api.attendance(event.id));
  assert.equal(attendance.leave.length, 1);
  (await api.response(event.id, { uid: input.newUid, status: 'registered', revision: 2, note: '重新報名' }));
  assert.equal((await api.apply(template.id, event.id)).teams[0].slots[0].uid, input.newUid);
  assert.equal((await api.apply(secondTemplate.id, event.id)).teams[0].slots[0].secondRound.uid, input.newUid);
  assert.equal((await api.template({ name: '原配置', teams, requestId: 'template' })).teams[0].slots[0].uid, input.newUid);
  assert.equal((await api.analysis(record.id)).sides.red.groups[0].rows.length, 1);

  // A reused original UID and its new snapshots are independent of the correction.
  (await api.add(person('0001', '不同人')));
  const secondChange = (await api.edit(input.newUid, edit('final-uid', 4, 'uid-again')));
  assert.equal(secondChange.member.uid, 'final-uid');
  assert.equal((await api.lineup(event.id)).versions[0].teams[0].slots[0].uid, 'final-uid');
  assert.equal((await api.row('0001')).name, '不同人');
  (await assert.rejects(async () => (await api.remove('final-uid', { revision: 5, requestId: 'bad-confirm', confirmUid: '0001' })), code('CONFIRMATION_REQUIRED')));
  (await assert.rejects(async () => (await api.remove('final-uid', { revision: 4, requestId: 'stale-delete', confirmUid: 'final-uid' })), code('STALE_MEMBER')));
  const removal = { revision: 5, requestId: 'delete', confirmUid: 'final-uid' };
  assert.equal((await api.remove('final-uid', removal)).deleted, true);
  assert.equal((await api.attendance(event.id)).registered.length, 0);
  (await assert.rejects(async () => (await api.row('final-uid')), code('MEMBER_NOT_FOUND')));
  assert.equal((await api.detail(record.id)).players[0].memberUid ?? null, null);
  assert.equal((await api.detail(record.id)).players[0].player, '現在名');
  snapshot = (await api.lineup(event.id)).versions[0];
  assert.equal(snapshot.teams[0].slots[0].uid, null);
  assert.equal(snapshot.teams[0].slots[0].member.name, '現在名');
  (await api.add(person('final-uid', '新使用者')));
  assert.equal((await api.personal('final-uid')).total, 0);
  assert.deepEqual((await api.remove('final-uid', removal)), { uid: 'final-uid', deleted: true });
  assert.equal((await api.row('final-uid')).name, '新使用者');
  (await assert.rejects(async () => (await api.remove('final-uid', { ...removal, requestId: 'stale-after-reuse' })), code('STALE_MEMBER')));
  (await assert.rejects(async () => (await api.history('final-uid', { revision: 5, requestId: 'stale-history-after-reuse', entries: [] })), code('STALE_MEMBER')));
  assert.equal((await api.lineup(event.id)).versions[0].teams[0].slots[0].uid, null);
  assert.equal((await api.upload(upload)).records[0].id, record.id); // original upload retry unchanged
}

function local(repo) {
  return { add: repo.addMember, event: repo.createEvent, confirm: repo.confirmLineup,
    template: repo.createLineupTemplate, upload: repo.saveBattleRecords, response: repo.saveMemberResponse,
    history: repo.saveMemberNameHistory, edit: repo.maintainMember, remove: repo.deleteMemberPermanently,
    row: async (uid) => (await repo.getMemberMaintenance(uid)).member, detail: repo.getBattleRecord,
    personal: repo.getMemberBattleRecords, lineup: repo.getLineupHistory,
    apply: repo.applyLineupTemplate, analysis: repo.getBattleTeamAnalysis, attendance: repo.getEventAttendance };
}

test('MySQL member maintenance preserves reference projections, immutable snapshots and retries across UID reuse', async () => {
 const repo=await createRepository();
 try {
  await contract(local(repo));
  const database = repositoryDatabase(repo);
  const [raw] = await database.query('SELECT snapshot_json, event_id FROM lineup_versions ORDER BY version LIMIT 1');
  assert.equal(JSON.parse(raw.snapshot_json).teams[0].slots[0].uid, '0001');
  assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM member_name_history'))[0].count), 0);
  const reopened = createMysqlRepository(database);
  assert.equal((await reopened.getLineupHistory(raw.event_id)).versions[0].teams[0].slots[0].uid, null);
  assert.equal((await reopened.getMemberMaintenance('final-uid')).member.name, '新使用者');
 } finally { await repo.close(); }
});
