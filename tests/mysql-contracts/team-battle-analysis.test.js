import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBattleTeams } from '../../src/domain/team-battle-analysis.js';
import { emptyLineup } from '../../src/domain/lineups.js';

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
