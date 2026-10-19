import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createBattleRecordClient } from '../src/api/battle-records.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { createSheetStore } from '../gas/src/storage.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { BATTLE_COLUMNS } from '../src/domain/battle-records.js';
import { analyzeBattleTeams, battleTeamContext, analyzeBattleTeamContext, defenseComparisonGroups, comparisonMetricShares, combineAnalysisGroups } from '../src/domain/team-battle-analysis.js';

function fixture() {
  const teams = emptyLineup();
  const positions = [0, 3, 6, 7, 8, 9];
  const players = positions.map((position, index) => {
    const uid = `private-${index}`, name = `玩家${index}`;
    Object.assign(teams[position].slots[0], { uid, member: { uid, name }, note: 'private-note', dutyIds: ['private-duty'] });
    return { side: 'red', player: name, profession: '碎夢', memberUid: uid, kill: (index + 1) * 10,
      assist: 20, resource: 10, buildingDamage: (index + 1) * 1000, damageTaken: 4000,
      playerDamage: (index + 1) * 2000, seriousInjury: index, heal: 3000, revive: 1 };
  });
  players.push({ ...players[0], memberUid: null, player: '未排紅方', kill: 50 });
  players.push({ ...players[0], memberUid: null, player: '未排藍方', side: 'blue', kill: 999 });
  const record = { id: 'battle', eventId: 'event', type: 'scrimmage', playedAt: '2026-10-19', roundNumber: 1,
    createdAt: '2026-10-19T12:00:00Z', redTeam: '紅', blueTeam: '藍', winner: 'red', ourSide: 'red', players };
  const lineup = { id: 'lineup', eventId: 'event', version: 1, event: { type: record.type, dates: [record.playedAt] }, createdAt: record.createdAt, teams };
  return { record, lineup };
}
const enriched = (record, lineup) => ({ ...record, teamContext: battleTeamContext(record, lineup) });

test('minimal context preserves identity matching without exposing lineup identifiers, duties or notes; six groups agree with legacy analysis', () => {
  const { record, lineup } = fixture(), before = structuredClone([record, lineup]);
  const context = battleTeamContext(record, lineup), publicText = JSON.stringify(context);
  assert.ok(!publicText.includes('private-'));
  assert.ok(!publicText.includes('uid') && !publicText.includes('registrationId'));
  assert.deepEqual(context.assignments[2], { playerIndex: 2, teamId: 'defense-1', teamName: '1 隊', reason: null });
  const next = analyzeBattleTeamContext({ ...record, teamContext: context }), old = analyzeBattleTeams(record, lineup);
  assert.deepEqual(next.sides.red.groups.map(g => g.name), ['進攻團', '機動團', '防守1', '防守2', '防守3', '防守4']);
  assert.deepEqual(next.sides.red.groups.slice(0, 2).map(g => g.totals), old.sides.red.groups.slice(0, 2).map(g => g.totals));
  for (const [ids, legacyId] of [[['defense1', 'defense2'], 'defense12'], [['defense3', 'defense4'], 'defense34']]) {
    const merged = combineAnalysisGroups(next.sides.red.groups, ids, next.sides.red.totals, '比較');
    assert.deepEqual(merged.totals, old.sides.red.groups.find(g => g.id === legacyId).totals);
  }
  assert.equal(next.sides.red.unclassified.length, 1);
  assert.equal(next.sides.blue.unclassified.length, 1);
  assert.deepEqual([record, lineup], before);
});

test('new frontend model preserves round replacements, unknown and ambiguous rows and rejects stale or incomplete contexts', () => {
  const { record, lineup } = fixture();
  const first = record.players[0];
  const second = { ...first, memberUid: 'private-second', player: '第二人', side: 'blue' };
  lineup.teams[0].slots[0].secondRound = { uid: second.memberUid, member: { uid: second.memberUid, name: second.player } };
  const round2 = { ...record, roundNumber: 2, players: [first, second] };
  const next = analyzeBattleTeamContext(enriched(round2, lineup));
  assert.equal(next.sides.red.groups[0].rows.length, 0);
  assert.equal(next.sides.blue.groups[0].rows[0].name, '第二人');
  const duplicate = { ...record, players: [first, { ...first }] };
  assert.equal(analyzeBattleTeamContext(enriched(duplicate, lineup)).sides.red.unclassified.length, 2);
  for (const r of [{ ...record, eventId: null }, { ...record, roundNumber: null }]) {
    const data = analyzeBattleTeamContext(enriched(r, lineup));
    assert.ok(data.unavailable);
    assert.equal(data.sides.red.groups.every(g => g.rows.length === 0), true);
  }
  const context = battleTeamContext(record, lineup);
  assert.throws(() => analyzeBattleTeamContext({ ...record, teamContext: { ...context, recordId: 'other' } }), { code: 'TEAM_CONTEXT_INVALID' });
  assert.throws(() => analyzeBattleTeamContext({ ...record, teamContext: { ...context, assignments: context.assignments.slice(1) } }), { code: 'TEAM_CONTEXT_INVALID' });
});

test('every two-team defense pairing partitions four teams once and uses pair totals, preserving whole-side denominators', () => {
  const { record, lineup } = fixture(), data = analyzeBattleTeamContext(enriched(record, lineup)), side = data.sides.red;
  for (const first of [['defense1', 'defense2'], ['defense1', 'defense3'], ['defense1', 'defense4'], ['defense2', 'defense3'], ['defense2', 'defense4'], ['defense3', 'defense4']]) {
    const pairs = defenseComparisonGroups(side, first);
    assert.equal(pairs.length, 2);
    assert.equal(new Set(pairs.flatMap(g => g.rows.map(r => r.playerIndex))).size, 4);
    assert.equal(pairs.flatMap(g => g.rows).length, 4);
    assert.equal(pairs.reduce((sum, g) => sum + g.totals.kill.value, 0), 180);
    const shares = comparisonMetricShares(pairs, 'kill');
    assert.equal(shares.slices.reduce((sum, s) => sum + s.percent, 0), 100);
  }
  const pairs = defenseComparisonGroups(side, ['defense1', 'defense4']);
  assert.deepEqual(pairs.map(g => g.totals.kill.value), [90, 90]);
  assert.equal(pairs[0].totals.kill.wholePercent, 90 / 260 * 100);
  for (const invalid of [[], ['defense1'], ['defense1', 'defense1'], ['defense1', 'attack1']]) assert.deepEqual(defenseComparisonGroups(side, invalid), []);
});

test('pie shares never fabricate partial, missing or zero-sum percentages, and known zero remains a valid slice', () => {
  const group = (value, missing = 0) => ({ id: String(value), name: String(value), totals: { kill: { value, missing } } });
  assert.deepEqual(comparisonMetricShares([group(0), group(10)], 'kill').slices.map(s => s.percent), [0, 100]);
  for (const groups of [[group(0), group(0)], [group(null), group(1)], [group(2, 1), group(4)], []]) assert.equal(comparisonMetricShares(groups, 'kill').slices.length, 0);
});

test('HTTP detail opt-in uses one adapter request and protects context fields and options while retaining legacy responses', async () => {
  const { record, lineup } = fixture(), repo = createRepository({ filename: ':memory:' });
  const csv = [BATTLE_COLUMNS.map(([label]) => label).join(','), ...record.players.filter(p => p.side === 'red').map(p => BATTLE_COLUMNS.map(([, k]) => p[k] ?? '').join(',')), BATTLE_COLUMNS.map(([label]) => label).join(','), ...record.players.filter(p => p.side === 'blue').map(p => BATTLE_COLUMNS.map(([, k]) => p[k] ?? '').join(','))].join('\n');
  for (const player of record.players.filter(p => p.memberUid)) repo.addMember({ uid: player.memberUid, name: player.player, primaryProfessionId: 3, secondaryProfessionId: null });
  const event = repo.createEvent({ requestId: 'event', title: '分析', type: record.type, dates: [record.playedAt] });
  const teams = lineup.teams.map(team => ({ ...team, slots: team.slots.map(slot => ({ ...slot, dutyIds: [] })) }));
  repo.confirmLineup({ eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'lineup', teams });
  const battle = repo.saveBattleRecords({ requestId: 'battle', records: [{ eventId: event.id, type: record.type, datetime: record.playedAt, roundNumber: 1, filename: 'fixture.csv', csvText: csv, redTeam: '紅', blueTeam: '藍' }] }).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authFetch = await authenticatedFetch(server, repo);
    let reads = 0;
    const client = createBattleRecordClient({ fetchImpl: (url, init) => { reads++; return authFetch(base + url, init); } });
    const result = await client.getRecord(battle.id, { includeTeamContext: true });
    assert.equal(reads, 1);
    assert.ok(!JSON.stringify(result.record.teamContext).includes('private-'));
    assert.equal(analyzeBattleTeamContext(result.record).sides.red.groups[2].rows.length, 1);
    assert.equal((await client.getRecord(battle.id)).record.teamContext, undefined);
    assert.equal((await fetch(`${base}/api/battle-records/${battle.id}?includeTeamContext=true`)).status, 401);
    assert.equal((await authFetch(`${base}/api/battle-records/${battle.id}?includeTeamContext=invalid`)).status, 422);
    assert.throws(() => repo.getBattleRecord(battle.id, { includeTeamContext: 'true' }), { code: 'BATTLE_FILTER_INVALID' });
    assert.deepEqual(repo.getBattleTeamAnalysis(battle.id).sides.red.groups[0].totals, analyzeBattleTeamContext(result.record).sides.red.groups[0].totals);
  } finally { await new Promise(r => server.close(r)); repo.close(); }
});

test('compiled GAS details include minimal context under held writer lock with legacy wrapper compatibility and no writes', async () => {
  const env = await gasRuntime(); env.setup();
  const session = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])), context = cloudSession(session);
  cloudResult(env.raw('setMemberToken', [{ password: 'Member123', revision: 0 }], context));
  const member = cloudResult(env.raw('loginMember', [{ password: 'Member123' }]));
  const storage = createSheetStore(env), fixtureData = fixture();
  storage.transaction(s => {
    const { players, ...record } = fixtureData.record;
    s.put('battles', record.id, record); s.put('battle_players', record.id, { players });
    s.put('lineup_versions', fixtureData.lineup.id, fixtureData.lineup);
  });
  const snapshot = () => JSON.stringify({ sheets: [...env.sheets].map(([name, s]) => [name, s.data]), properties: [...env.properties], files: [...env.files.keys()], fetches: env.fetches });
  const before = snapshot(); env.lock.tryLock(); env.lock.tryLock = () => assert.fail('detail must not acquire writer lock');
  env.globals.DriveApp.getFileById = () => assert.fail('analysis context must not read Drive');
  const result = cloudResult(env.raw('getBattleRecord', ['battle', { includeTeamContext: true }], context));
  assert.ok(!JSON.stringify(result.record.teamContext).includes('private-'));
  assert.equal(analyzeBattleTeamContext(result.record).sides.red.groups.length, 6);
  assert.ok(cloudResult(env.raw('getBattleRecord', ['battle', { includeTeamContext: true }], cloudSession(member))).record.teamContext);
  assert.equal(cloudResult(env.raw('getBattleRecord', ['battle'], context)).record.teamContext, undefined);
  assert.equal(env.raw('getBattleRecord', ['battle', { includeTeamContext: true }]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getBattleRecord', ['battle', { includeTeamContext: 'true' }], context).error.code, 'BATTLE_FILTER_INVALID');
  assert.equal(snapshot(), before);
});
