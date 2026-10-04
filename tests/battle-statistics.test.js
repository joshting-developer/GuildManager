import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeBattle,
  sortBattlePlayers,
  battleResultLabel,
  battleRoundLabel,
  battleDateLabel,
  battleSideLabel,
  battlePlayerValue,
  BATTLE_TABLE_COLUMNS,
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

test('per-life contributions preserve missing values and injury counts without modifying snapshots', () => {
  const player = {
    player: '甲',
    profession: '素問',
    kill: 100,
    heal: 0,
    resource: 60,
    seriousInjury: 4,
  };
  const before = structuredClone(player);
  assert.equal(battlePlayerValue(player, 'kill', 'per_life'), 25);
  assert.equal(battlePlayerValue(player, 'heal', 'per_life'), 0);
  assert.equal(battlePlayerValue(player, 'resource', 'per_life'), 15);
  assert.equal(battlePlayerValue(player, 'seriousInjury', 'per_life'), 4);
  assert.equal(battlePlayerValue(player, 'player', 'per_life'), '甲');
  assert.equal(battlePlayerValue({ ...player, seriousInjury: 0 }, 'kill', 'per_life'), 100);
  assert.equal(battlePlayerValue({ ...player, seriousInjury: null }, 'kill', 'per_life'), null);
  assert.equal(
    battlePlayerValue({ ...player, seriousInjury: undefined }, 'kill', 'per_life'),
    null,
  );
  assert.equal(battlePlayerValue({ ...player, kill: null }, 'kill', 'per_life'), null);
  assert.equal(battlePlayerValue(player, 'kill'), 100);
  assert.deepEqual(player, before);
  assert.equal(BATTLE_TABLE_COLUMNS.at(-1)[1], 'resource');
  assert.equal(new Set(BATTLE_TABLE_COLUMNS.map(([, key]) => key)).size, 12);
});

test('profession filters intersect with side and per-life ranking uses unrounded values before pagination', () => {
  const players = [
    { side: 'red', player: '總計較高', profession: '素問', kill: 100, seriousInjury: 10 },
    { side: 'red', player: '一命較高', profession: '素問', kill: 50, seriousInjury: 1 },
    { side: 'red', player: '其他職業', profession: '龍吟', kill: 1000, seriousInjury: 0 },
    { side: 'red', player: '無重傷資料', profession: '素問', kill: 1000, seriousInjury: null },
    { side: 'blue', player: '其他陣營', profession: '素問', kill: 9999, seriousInjury: 1 },
  ];
  const before = structuredClone(players);
  const options = { profession: '素問', mode: 'per_life' };
  assert.deepEqual(
    sortBattlePlayers(players, 'red', 'kill', 'desc', options).map((p) => p.player),
    ['一命較高', '總計較高', '無重傷資料'],
  );
  assert.deepEqual(
    sortBattlePlayers(players, 'red', 'kill', 'asc', options).map((p) => p.player),
    ['總計較高', '一命較高', '無重傷資料'],
  );
  assert.equal(
    sortBattlePlayers(players, 'blue', 'kill', 'desc', { profession: '龍吟' }).length,
    0,
  );
  assert.deepEqual(players, before);
  const precise = [
    { side: 'red', kill: 10, seriousInjury: 10 },
    { side: 'red', kill: 10000001, seriousInjury: 10000000 },
  ];
  assert.equal(
    sortBattlePlayers(precise, 'red', 'kill', 'desc', { mode: 'per_life' })[0],
    precise[1],
  );
  const many = Array.from({ length: 45 }, (_, index) => ({
    side: 'red',
    profession: '新職業',
    kill: index * 3,
    seriousInjury: 3,
  }));
  assert.equal(
    sortBattlePlayers(many, 'red', 'kill', 'desc', {
      profession: '新職業',
      mode: 'per_life',
    }).slice(20, 40)[0].kill,
    72,
  );
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
