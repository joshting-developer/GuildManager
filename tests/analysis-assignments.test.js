import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBattleTeamContext, battleTeamContext, defenseComparisonGroups, comparisonMetricShares } from '../src/domain/team-battle-analysis.js';
import { applyAnalysisAssignments, ANALYSIS_ASSIGNMENT_OPTIONS } from '../src/domain/analysis-assignments.js';
import { emptyLineup } from '../src/domain/lineups.js';

function fixture() {
  const teams = emptyLineup();
  const player = (name, kill, side = 'red', extra = {}) => ({ player: name, profession: '碎夢', side,
    kill, playerDamage: kill * 100, buildingDamage: kill * 10, assist: 2, damageTaken: 30,
    resource: 3, seriousInjury: 1, heal: 0, revive: 0, ...extra });
  const players = [player('已排', 10, 'red', { memberUid: 'saved' }), player('同名', 20),
    player('同名', 30), player('同名', 40, 'blue'), player('缺值', 0, 'red', { heal: null })];
  Object.assign(teams[0].slots[0], { uid: 'saved', member: { uid: 'saved', name: '已排' } });
  const record = { id: 'record', eventId: 'event', type: 'scrimmage', playedAt: '2026-10-29',
    roundNumber: 1, redTeam: '紅', blueTeam: '藍', players };
  const lineup = { teams, createdAt: '2026-10-29T10:00:00Z' };
  record.teamContext = battleTeamContext(record, lineup);
  return { record, analysis: analyzeBattleTeamContext(record) };
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value); Object.values(value).forEach(freeze); return value;
}
const group = (analysis, id, side = 'red') => analysis.sides[side].groups.find(value => value.id === id);

test('temporary assignments match a newly grouped reference without changing snapshots, automatic matching or whole denominators', () => {
  const { record, analysis } = fixture();
  const before = structuredClone({ record, analysis });
  freeze(record); freeze(analysis);
  assert.equal(applyAnalysisAssignments(analysis), analysis);
  assert.equal(applyAnalysisAssignments(null, { 1: 'attack1' }), null);
  assert.equal(applyAnalysisAssignments(analysis, { 0: 'defense1', 1: 'invalid', 99: 'attack1' }), analysis);
  const assignments = freeze({ 1: 'attack1', 2: 'attack2', 3: 'defense4', 4: 'defense1' });
  const result = applyAnalysisAssignments(analysis, assignments);
  const reference = structuredClone(record);
  for (const [index, teamId] of [[1, 'attack-1'], [2, 'mobile-1'], [3, 'defense-4'], [4, 'defense-1']])
    Object.assign(reference.teamContext.assignments[index], { teamId, teamName: '手動參考', reason: null });
  const expected = analyzeBattleTeamContext(reference);
  for (const side of ['red', 'blue']) {
    assert.equal(result.sides[side].totals, analysis.sides[side].totals);
    assert.equal(result.sides[side].count, analysis.sides[side].count);
    assert.equal(result.sides[side].unclassified.length, 0);
    assert.deepEqual(result.sides[side].groups.map(g => g.totals), expected.sides[side].groups.map(g => g.totals));
    assert.deepEqual(result.sides[side].groups.map(g => g.rows.map(r => r.metrics)), expected.sides[side].groups.map(g => g.rows.map(r => r.metrics)));
    const indices = result.sides[side].groups.flatMap(g => g.rows.map(r => r.playerIndex));
    assert.equal(new Set(indices).size, indices.length);
  }
  assert.equal(group(result, 'attack1').rows[0].temporary, undefined);
  assert.equal(group(result, 'attack1').rows[1].temporary, true);
  assert.equal(group(result, 'attack1').rows[1].teamName, '進攻團（臨時）');
  assert.deepEqual({ record, analysis }, before);
  assert.equal(applyAnalysisAssignments(analysis, {}), analysis);
});

test('original row indices distinguish same-name players and moving or clearing an assignment updates both analyses once', () => {
  const { analysis } = fixture();
  assert.deepEqual(ANALYSIS_ASSIGNMENT_OPTIONS.map(x => x.title), ['進攻團', '機動團', '防守1', '防守2', '防守3', '防守4']);
  const attack = applyAnalysisAssignments(analysis, { 1: 'attack2', 2: 'attack2' });
  assert.deepEqual(group(attack, 'attack2').rows.map(r => r.playerIndex), [1, 2]);
  assert.equal(group(attack, 'attack2').totals.kill.value, 50);
  assert.equal(attack.sides.blue, analysis.sides.blue);
  assert.deepEqual(attack.sides.red.unclassified.map(r => r.playerIndex), [4]);
  const defense = applyAnalysisAssignments(analysis, { 1: 'defense1', 2: 'defense4' });
  assert.equal(group(defense, 'attack2').rows.length, 0);
  assert.deepEqual(defenseComparisonGroups(defense.sides.red, ['defense1', 'defense2']).map(g => g.totals.kill.value), [20, 30]);
  assert.deepEqual(comparisonMetricShares(defenseComparisonGroups(defense.sides.red, ['defense1', 'defense2']), 'kill').slices.map(s => s.percent), [40, 60]);
  const partial = applyAnalysisAssignments(analysis, { 2: 'defense4' });
  assert.deepEqual(partial.sides.red.unclassified.map(r => r.playerIndex), [1, 4]);
  assert.equal(group(partial, 'defense1').rows.length, 0);
  assert.equal(group(partial, 'defense4').rows.length, 1);
  assert.equal(group(defense, 'defense1').totals.kill.wholePercent, 20 / 60 * 100);
});

test('unavailable saved lineups still permit explicit temporary analysis while warnings, missing data and zero denominators stay honest', () => {
  const { record } = fixture();
  record.eventId = null;
  record.teamContext = battleTeamContext(record, null);
  const analysis = analyzeBattleTeamContext(record);
  const result = applyAnalysisAssignments(freeze(analysis), { 0: 'attack1', 1: 'attack1', 4: 'attack1' });
  assert.equal(result.unavailable, analysis.unavailable);
  assert.equal(result.lineup, null);
  assert.equal(group(result, 'attack1').rows.length, 3);
  const heal = group(result, 'attack1').totals.heal;
  assert.deepEqual(heal, { value: 0, missing: 1, wholePercent: null });
  assert.ok(group(result, 'attack1').rows.every(r => r.metrics.heal.groupPercent === null));
  assert.ok(group(result, 'attack1').rows.every(r => r.metrics.heal.wholePercent === null));
  assert.equal(group(result, 'attack1').rows[2].metrics.heal.value, null);
  assert.equal(group(result, 'attack1').rows[2].metrics.kill.value, 0);
  assert.equal(group(result, 'attack1').rows[2].metrics.kill.groupPercent, 0);
  assert.equal(comparisonMetricShares([group(result, 'attack1'), group(result, 'attack2')], 'heal').slices.length, 0);
  assert.equal(group(result, 'attack1').totals.revive.wholePercent, null);
  assert.deepEqual(result.sides.red.unclassified.map(r => r.playerIndex), [2]);
  assert.equal(result.sides.blue, analysis.sides.blue);
  assert.equal(applyAnalysisAssignments(analysis, {}), analysis);
});
