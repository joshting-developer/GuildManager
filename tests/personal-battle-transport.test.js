import test from 'node:test';
import assert from 'node:assert/strict';
import { packPersonalBattles, unpackPersonalBattles } from '../src/domain/personal-battle-transport.js';

test('complete history transport preserves display and metric fields while removing repeated keys', () => {
  const entry = { recordId: 'battle', playerIndex: 0, type: 'scrimmage', playedAt: '2026-11-18', roundNumber: null,
    redTeam: '紅', blueTeam: '藍', winner: 'red', isInternal: false,
    player: { player: '測試', profession: '素問', side: 'red', kill: 3, resource: null, playerDamage: 500 } };
  const data = { entries: Array.from({ length: 500 }, () => ({ ...entry })), total: 500, member: { name: '測試' } };
  const packed = packPersonalBattles(data);
  assert.deepEqual(unpackPersonalBattles(packed), data);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(data).length * 0.65);
  assert.equal(unpackPersonalBattles({ entries: [] }).entries.length, 0);
  assert.deepEqual(unpackPersonalBattles(packPersonalBattles({ entries: [] })), { entries: [] });
});
