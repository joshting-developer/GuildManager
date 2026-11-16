import test from 'node:test';
import assert from 'node:assert/strict';

import { latestPersonalSelection, personalBattleKey, selectedPersonalBattles, personalKillEfficiency, summarizeKillEfficiency, personalTrendPoints } from '../../src/domain/personal-battle-selection.js';
import { filterPersonalBattles } from '../../src/domain/personal-battle-filters.js';
import { summarizePersonalBattles } from '../../src/domain/personal-battle-statistics.js';

function entries(count = 25) {
  return Array.from({ length: count }, (_, i) => ({
    recordId: `b${count - i}`, playerIndex: 0, type: 'scrimmage', roundNumber: 1,
    playedAt: `2026-10-${String(count - i).padStart(2, '0')}`, winner: 'red',
    player: { side: 'red', player: '城', profession: i % 2 ? '素問' : '碎夢', kill: i + 1, playerDamage: (i + 1) * 100, seriousInjury: 1 },
  }));
}

test('latest ten selection persists across pages and filters; same battle rows stay independently selectable', () => {
  const rows = entries(), keys = latestPersonalSelection(rows);
  assert.equal(keys.size, 10);
  assert.equal(summarizePersonalBattles(selectedPersonalBattles(rows, keys)).metrics.find(m => m.key === 'kill').total, 55);
  keys.add(personalBattleKey(rows[24]));
  const filtered = filterPersonalBattles(rows, { profession: '素問' });
  assert.equal(selectedPersonalBattles(filtered, keys).length, 5);
  assert.equal(keys.size, 11);
  assert.equal(selectedPersonalBattles(rows, keys).length, 11);
  const both = [rows[0], { ...rows[0], playerIndex: 1, player: { ...rows[0].player, side: 'blue' } }];
  assert.equal(latestPersonalSelection(both).size, 2);
  assert.equal(summarizePersonalBattles(both).battleCount, 1);
  assert.equal(latestPersonalSelection([]).size, 0);
});

test('kill efficiency uses paired damage divided by kills, preserving zero-kill damage and unknown values', () => {
  const values = [{ playerDamage: 1000, kill: 10 }, { playerDamage: 3000, kill: 2 }, { playerDamage: 200, kill: 0 }, { playerDamage: null, kill: 8 }, { playerDamage: 900, kill: null }];
  assert.equal(personalKillEfficiency(values[0]), 100);
  assert.equal(personalKillEfficiency(values[2]), null);
  assert.equal(personalKillEfficiency(values[3]), null);
  assert.equal(personalKillEfficiency(values[4]), null);
  assert.deepEqual(summarizeKillEfficiency(values.map(player => ({ player }))), { value: 350, missing: 2 });
  assert.deepEqual(summarizeKillEfficiency([{ player: values[2] }]), { value: null, missing: 0 });
  assert.deepEqual(summarizeKillEfficiency([]), { value: null, missing: 0 });
});

test('trend keeps chronological order and independent same-day rows, gaps and raw values without mutating inputs', () => {
  const rows = entries(3), before = structuredClone(rows);
  rows[1].player.kill = 0;
  const points = personalTrendPoints(rows, 'killEfficiency');
  assert.equal(points[0].key, personalBattleKey(rows[2]));
  assert.deepEqual(points.map(p => p.value), [100, null, 100]);
  assert.deepEqual(personalTrendPoints(rows, 'playerDamage').map(p => p.value), [300, 200, 100]);
  assert.deepEqual(personalTrendPoints(rows, 'invalid'), []);
  assert.equal(rows[0].recordId, before[0].recordId);
});
