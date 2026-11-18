import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planBattleMemberSync } from '../../src/domain/battle-member-sync.js';

const person = (uid, name) => ({ uid, name, primaryProfessionId: 3 });

test('sync planner deduplicates one member aliases, skips all cross-UID aliases and preserves prior ownership', () => {
  const plan = planBattleMemberSync(
    [person('1', '甲'), person('2', '乙'), person('3', '丙'), person('4', '丁')],
    [{ uid: '1', name: '甲' }, { uid: '1', name: '舊甲' }, { uid: '1', name: '舊甲' },
      { uid: '1', name: '乙' }, { uid: '2', name: '舊同名' }, { uid: '3', name: '舊同名' },
      { uid: 'missing', name: '未知' }],
    [{ id: 'a', players: ['甲', '舊甲', '乙', '舊同名', '未知', '甲 ', '丁', '乙']
      .map((player, i) => ({ player, ...(i === 6 ? { memberUid: 'prior' } : {}) })) }],
    [{ recordId: 'a', playerIndex: 7, memberUid: 'prior' }],
  );
  assert.deepEqual(plan.summary, { records: 1, players: 8, alreadyLinked: 2, eligiblePlayers: 2,
    currentNamePlayers: 1, historyNamePlayers: 1, conflictPlayers: 2, unmatchedPlayers: 2, matchedMembers: 1 });
  assert.deepEqual(plan.assignments.map(row => row.playerIndex), [0, 1]);
  assert.deepEqual(plan.matches.map(row => row.matchType).sort(), ['current', 'history']);
  assert.equal(plan.conflicts.find(row => row.name === '乙').candidates.length, 2);
  assert.equal(plan.conflicts.find(row => row.name === '舊同名').candidates.length, 2);
});

// Rename is used to reproduce members created before historical backfill existed.
