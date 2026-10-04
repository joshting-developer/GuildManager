import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeBattle,
  sortBattlePlayers,
  battleResultLabel,
  battleRoundLabel,
  battleDateLabel,
  battleSideLabel,
} from '../src/domain/battle-statistics.js';

test('statistics distinguish zero, missing values and partial totals across independent sides', () => {
  const players = [
    { side: 'red', player: '甲', profession: '素問', kill: 10, heal: 0, burnBone: null },
    { side: 'red', player: '乙', profession: '素問', kill: 2, heal: null },
    { side: 'blue', player: '丙', profession: '碎夢', kill: 5, heal: 0, burnBone: null },
  ];
  const before = structuredClone(players);
  const { teams, metrics } = summarizeBattle(players);
  assert.equal(teams.red.count, 2);
  assert.deepEqual(teams.red.professions, [{ name: '素問', count: 2 }]);
  assert.deepEqual(teams.red.metrics.kill, { value: 12, missing: 0 });
  assert.deepEqual(teams.red.metrics.heal, { value: 0, missing: 1 });
  assert.equal(metrics.find((m) => m.key === 'kill').gap, 7);
  assert.equal(metrics.find((m) => m.key === 'heal').partial, true);
  assert.equal(metrics.find((m) => m.key === 'burnBone').gap, null);
  assert.equal(teams.blue.metrics.burnBone.value, null);
  assert.equal(summarizeBattle([]).teams.red.metrics.kill.value, null);
  assert.deepEqual(players, before);
});

test('numeric sorting occurs before pagination, is stable and leaves missing values last in both directions', () => {
  const players = [null, 2, 100, 10, 0, undefined, 10].map((kill, index) => ({
    side: 'red',
    player: String(index),
    kill,
  }));
  players.push({ side: 'blue', player: '藍方', kill: 999 });
  const before = structuredClone(players);
  assert.deepEqual(
    sortBattlePlayers(players, 'red', 'kill', 'desc').map((p) => p.player),
    ['2', '3', '6', '1', '4', '0', '5'],
  );
  assert.deepEqual(
    sortBattlePlayers(players, 'red', 'kill', 'asc').map((p) => p.player),
    ['4', '1', '3', '6', '2', '0', '5'],
  );
  assert.deepEqual(
    sortBattlePlayers(players, 'blue', 'player', 'asc').map((p) => p.player),
    ['藍方'],
  );
  const many = Array.from({ length: 45 }, (_, index) => ({ side: 'red', kill: index }));
  assert.equal(sortBattlePlayers(many, 'red', 'kill', 'desc').slice(20, 40)[0].kill, 24);
  assert.deepEqual(players, before);
});

test('labels preserve optional enemy/result, internal matches, legacy rounds and Taipei dates', () => {
  assert.equal(battleResultLabel({ winner: null }), '結果未填');
  assert.equal(battleResultLabel({ winner: 'blue' }), '藍方獲勝');
  assert.equal(battleResultLabel({ isInternal: true, winner: 'red' }), '內推');
  assert.equal(battleSideLabel({ ourSide: null }, 'red'), '紅方');
  assert.equal(battleSideLabel({ ourSide: 'blue' }, 'red'), '紅方 · 對方');
  assert.equal(battleSideLabel({ isInternal: true, ourSide: 'red' }, 'red'), '紅方');
  assert.equal(battleRoundLabel({ type: 'guild_war', roundNumber: 2 }), '第二場');
  assert.equal(battleRoundLabel({ type: 'dragon_tiger', roundNumber: 1 }), '單場');
  assert.equal(battleRoundLabel({ type: 'guild_war', roundNumber: null }), '場序未指定');
  assert.equal(battleDateLabel('2026-10-01'), '2026/10/01');
  assert.match(battleDateLabel('2026-09-30T17:00:00Z'), /2026\/10\/01.*01:00/);
  assert.equal(battleDateLabel('bad'), '—');
});
