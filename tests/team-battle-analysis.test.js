import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBattleTeams } from '../src/domain/team-battle-analysis.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createBattleRecordClient } from '../src/api/battle-records.js';
import { setGasSession } from '../src/api/gas.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';

const player = (name, extra = {}) => ({ player: name, profession: '碎夢', side: 'red', kill: 10, ...extra });
const record = (players, extra = {}) => ({ id: 'battle', eventId: 'event', roundNumber: 1, players, ...extra });
const saved = (name, uid = null) => ({ uid, member: { name, uid } });
function lineup() {
  return { createdAt: '2026-10-05T00:00:00Z', teams: emptyLineup() };
}
const group = (result, id, side = 'red') => result.sides[side].groups.find((row) => row.id === id);

test('four groups use saved team IDs; denominator includes unclassified same-side players, never opponents', () => {
  const layout = lineup();
  for (const [index, name] of [[0, '進攻甲'], [3, '進攻乙'], [6, '防守甲'], [8, '防守乙']])
    Object.assign(layout.teams[index].slots[0], saved(name));
  layout.teams[0].name = '改過隊名';
  Object.assign(layout.teams[0].slots[1], saved('外援'));
  const input = record([
    player('進攻甲', { kill: 10 }), player('外援', { kill: 30 }),
    player('進攻乙', { kill: 20 }), player('防守甲', { kill: 5 }), player('防守乙', { kill: 5 }),
    player('未排', { kill: 30 }), player('對方', { side: 'blue', kill: 1000 }),
  ]);
  const before = JSON.stringify([input, layout]);
  const result = analyzeBattleTeams(input, layout);
  assert.equal(group(result, 'attack1').rows.length, 2);
  assert.deepEqual(group(result, 'attack1').rows[0].metrics.kill, { value: 10, groupPercent: 25, wholePercent: 10 });
  assert.equal(group(result, 'attack1').rows[0].teamName, '改過隊名');
  assert.deepEqual(group(result, 'attack1').totals.kill, { value: 40, missing: 0, wholePercent: 40 });
  assert.equal(group(result, 'attack2').rows[0].name, '進攻乙');
  assert.equal(group(result, 'defense12').rows[0].name, '防守甲');
  assert.equal(group(result, 'defense34').rows[0].name, '防守乙');
  assert.equal(result.sides.red.unclassified[0].name, '未排');
  assert.equal(result.sides.blue.unclassified[0].metrics.kill.wholePercent, 100);
  assert.equal(JSON.stringify([input, layout]), before);
});

test('second round replaces only explicit second people; unknown rounds and no saved lineup never guess', () => {
  const layout = lineup();
  Object.assign(layout.teams[0].slots[0], saved('第一'));
  layout.teams[0].slots[0].secondRound = saved('第二');
  Object.assign(layout.teams[0].slots[1], saved('沿用'));
  const rows = [player('第一'), player('第二'), player('沿用')];
  assert.deepEqual(group(analyzeBattleTeams(record(rows), layout), 'attack1').rows.map((row) => row.name), ['第一', '沿用']);
  assert.deepEqual(group(analyzeBattleTeams(record(rows, { roundNumber: 2 }), layout), 'attack1').rows.map((row) => row.name), ['第二', '沿用']);
  for (const [input, version] of [[record(rows, { roundNumber: null }), layout], [record(rows, { eventId: null }), layout], [record(rows), null]]) {
    const result = analyzeBattleTeams(input, version);
    assert.ok(result.unavailable);
    assert.equal(result.lineup, null);
    assert.equal(result.sides.red.unclassified.length, 3);
  }
  layout.event = { type: 'scrimmage', dates: ['2026-11-01'] };
  assert.ok(analyzeBattleTeams(record(rows, { type: 'scrimmage', playedAt: '2026-10-05' }), layout).unavailable);
});

test('UID links survive renames; ambiguous names/UIDs and linked different people stay aside without exposing identifiers', () => {
  const layout = lineup();
  Object.assign(layout.teams[0].slots[0], saved('新名', 'private-uid-a'));
  Object.assign(layout.teams[0].slots[1], saved('同名', 'private-uid-b'));
  Object.assign(layout.teams[3].slots[0], saved('同名', 'private-uid-c'));
  Object.assign(layout.teams[6].slots[0], saved('兩邊同名'));
  const result = analyzeBattleTeams(record([
    player('舊名', { memberUid: 'private-uid-a' }), player('新名'), player('同名'),
    player('兩邊同名'), player('兩邊同名', { side: 'blue' }),
    player('同名', { memberUid: 'private-uid-other' }),
  ], { isInternal: true, ourSide: 'red' }), layout);
  assert.deepEqual(group(result, 'attack1').rows.map((row) => row.name), ['舊名']);
  assert.equal(result.sides.red.unclassified.length, 4);
  assert.equal(result.sides.blue.unclassified.length, 1);
  assert.equal(result.ourSide, null);
  assert.equal(JSON.stringify(result).includes('private-uid'), false);
  assert.equal(JSON.stringify(result).includes('memberUid'), false);
  const duplicate = analyzeBattleTeams(record([player('a', { memberUid: 'private-uid-a' }), player('b', { memberUid: 'private-uid-a' })]), layout);
  assert.equal(group(duplicate, 'attack1').rows.length, 0);
});

test('null, partial and zero denominators are not represented as actual zero or invented percentages', () => {
  const layout = lineup();
  Object.assign(layout.teams[0].slots[0], saved('甲'));
  Object.assign(layout.teams[0].slots[1], saved('乙'));
  const result = analyzeBattleTeams(record([
    player('甲', { heal: 20, revive: 0 }), player('乙', { heal: 0, revive: 0 }),
    player('未排', { heal: null, kill: null, revive: 0 }),
  ]), layout);
  const attack = group(result, 'attack1');
  assert.equal(attack.rows[0].metrics.heal.groupPercent, 100);
  assert.equal(attack.rows[0].metrics.heal.wholePercent, null);
  assert.equal(attack.rows[1].metrics.heal.groupPercent, 0);
  assert.equal(attack.rows[0].metrics.revive.groupPercent, null);
  assert.deepEqual(attack.totals.buildingDamage, { value: null, missing: 2, wholePercent: null });
  assert.equal(attack.totals.heal.wholePercent, null);
  assert.equal(attack.totals.revive.wholePercent, null);
  assert.equal(attack.rows[0].metrics.buildingDamage.value, null);
  assert.equal(attack.rows[0].metrics.kill.wholePercent, null);
});

test('group summary uses its own side and suppresses partial numerator percentages; known zero remains zero', () => {
  const layout = lineup();
  Object.assign(layout.teams[0].slots[0], saved('甲'));
  Object.assign(layout.teams[0].slots[1], saved('乙'));
  Object.assign(layout.teams[3].slots[0], saved('丙'));
  const result = analyzeBattleTeams(record([
    player('甲', { kill: null, heal: 0 }), player('乙', { kill: 10, heal: 0 }),
    player('未排', { kill: 30, heal: 100 }),
    player('丙', { side: 'blue', kill: 20 }), player('對方未排', { side: 'blue', kill: 80 }),
  ]), layout);
  assert.deepEqual(group(result, 'attack1').totals.kill, { value: 10, missing: 1, wholePercent: null });
  assert.equal(group(result, 'attack1').totals.heal.wholePercent, 0);
  assert.deepEqual(group(result, 'attack2', 'blue').totals.kill, { value: 20, missing: 0, wholePercent: 20 });
  assert.equal(group(result, 'defense12').totals.kill.wholePercent, null);
});

const upload = (eventId, roundNumber) => ({ requestId: `upload-${roundNumber}`, records: [{
  eventId, roundNumber, type: 'scrimmage', datetime: '2026-10-05', filename: '示範.csv',
  redTeam: '我方', blueTeam: '對方', ourSide: 'red', csvText: fixtureCsv('舊名', '第二人'),
}] });
function contract({ add, event, confirm, save, analysis, rename, remove }) {
  add({ uid: '001', name: '舊名', primaryProfessionId: 3 });
  add({ uid: '002', name: '第二人', primaryProfessionId: 1 });
  const e = event();
  const teams = emptyLineup();
  teams[0].slots[0].uid = '001';
  teams[0].slots[0].secondRound = { uid: '002', profession: 'primary' };
  confirm({ eventId: e.id, eventRevision: e.revision, expectedVersion: 0, requestId: 'lineup1', teams });
  const first = save(upload(e.id, 1)).records[0];
  const second = save(upload(e.id, 2)).records[0];
  rename('001', { name: '新名', primaryProfessionId: 3, revision: 1 });
  assert.equal(group(analysis(first.id), 'attack1').rows[0].name, '舊名');
  assert.equal(group(analysis(second.id), 'attack1', 'blue').rows[0].name, '第二人');
  assert.equal(group(analysis(second.id), 'attack1').rows.length, 0);
  teams[3].slots[0] = teams[0].slots[0];
  teams[0].slots[0] = emptyLineup()[0].slots[0];
  confirm({ eventId: e.id, eventRevision: e.revision, expectedVersion: 1, requestId: 'lineup2', teams });
  assert.equal(group(analysis(first.id), 'attack1').rows.length, 0);
  assert.equal(group(analysis(first.id), 'attack2').rows[0].name, '舊名');
  remove(e.id, e.revision);
  assert.equal(group(analysis(second.id), 'attack2', 'blue').rows[0].name, '第二人');
  return first;
}

test('SQLite and GAS use latest saved snapshot, preserve archive/round/name links and identical public analysis', async () => {
  const repo = createRepository({ filename: ':memory:' });
  let localSides;
  try {
    const first = contract({
      add: repo.addMember, event: () => repo.createEvent({ title: '分析約戰', type: 'scrimmage', dates: ['2026-10-05'], requestId: 'event' }),
      confirm: repo.confirmLineup, save: repo.saveBattleRecords, analysis: repo.getBattleTeamAnalysis,
      rename: repo.updateMember, remove: repo.deleteEvent,
    });
    localSides = repo.getBattleTeamAnalysis(first.id).sides;
    assert.throws(() => repo.getBattleTeamAnalysis('missing'), (e) => e.code === 'BATTLE_NOT_FOUND');
  } finally { repo.close(); }
  const env = await gasRuntime(); env.setup();
  const admin = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]));
  const ctx = cloudSession(admin), call = (op, args = []) => cloudResult(env.raw(op, args, ctx));
  const first = contract({
    add: (input) => call('addMember', [input]),
    event: () => call('createEvent', [{ title: '分析約戰', type: 'scrimmage', dates: ['2026-10-05'], requestId: 'event' }]).event,
    confirm: (input) => call('confirmLineup', [input]), save: (input) => call('saveBattleRecords', [input]),
    analysis: (id) => call('getBattleTeamAnalysis', [id]), rename: (uid, input) => call('updateMember', [uid, input]),
    remove: (id, revision) => call('deleteEvent', [id, revision]),
  });
  assert.deepEqual(call('getBattleTeamAnalysis', [first.id]).sides, localSides);
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const member = cloudResult(env.raw('loginMember', [{ password: 'Member123' }]));
  assert.equal(env.raw('getBattleTeamAnalysis', [first.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getLineupHistory', [first.eventId], cloudSession(member)).error.code, 'MANAGEMENT_REQUIRED');
  assert.equal(env.raw('getBattleTeamAnalysis', ['missing'], cloudSession(member)).error.code, 'BATTLE_NOT_FOUND');
  setGasSession(member);
  const run = { withSuccessHandler(fn) { this.success = fn; return this; }, withFailureHandler() { return this; },
    getBattleTeamAnalysis(id, context) { this.success(env.raw('getBattleTeamAnalysis', [id], context)); },
  };
  const client = createBattleRecordClient({ source: 'gas', googleRun: run, fetchImpl: () => assert.fail('no HTTP fallback') });
  assert.equal(group(await client.getTeamAnalysis(first.id), 'attack2').rows[0].name, '舊名');
  setGasSession({ user: null });
});

test('HTTP permits member analysis GET only, retains lineup/write protection and returns missing-record/adapter errors', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const first = repo.saveBattleRecords({ requestId: 'old', records: [{ type: 'scrimmage', datetime: '2026-10-05', filename: 'old.csv', csvText: fixtureCsv(), redTeam: '紅', blueTeam: '藍' }] }).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fetchAdmin = await authenticatedFetch(server, repo);
    const admin = await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.user.id, { password: 'Member123', revision: 0 });
    const member = await repo.authenticateMember({ password: 'Member123' });
    const headers = { Cookie: `guild_session=${member.token}` }, path = `${base}/api/battle-records/${first.id}/team-analysis`;
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await fetch(`${base}/api/lineups`, { headers })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const client = createBattleRecordClient({ fetchImpl: (url, init) => fetch(base + url, { ...init, headers }) });
    assert.equal((await client.getTeamAnalysis(first.id)).sides.red.unclassified.length, 1);
    assert.ok((await createBattleRecordClient({ fetchImpl: (url, init) => fetchAdmin(base + url, init) }).getTeamAnalysis(first.id)).unavailable);
    await assert.rejects(client.getTeamAnalysis('missing'), (e) => e.code === 'BATTLE_NOT_FOUND');
  } finally { await new Promise((resolve) => server.close(resolve)); repo.close(); }
});
