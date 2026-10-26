import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastBattleEvent, taipeiToday } from '../src/domain/battle-events.js';

test('only battles strictly before the Taipei calendar date are past, without changing event data', () => {
  const today = '2026-10-26';
  for (const type of ['scrimmage', 'guild_war', 'dragon_tiger']) {
    const event = { type, dates: ['2026-10-25'] }, before = structuredClone(event);
    assert.equal(isPastBattleEvent(event, today), true);
    assert.deepEqual(event, before);
    assert.equal(isPastBattleEvent({ type, dates: [today] }, today), false);
    assert.equal(isPastBattleEvent({ type, dates: ['2026-10-27'] }, today), false);
    assert.equal(isPastBattleEvent({ type, dates: ['2025-12-31'] }, '2026-01-01'), true);
  }
  for (const event of [null, {}, { type: 'activity', dates: ['2026-10-25'] },
    { type: 'scrimmage', dates: [] }, { type: 'scrimmage', dates: [null] },
    { type: 'scrimmage', dates: ['invalid'] },
    { type: 'scrimmage', dates: ['2026-10-25', today] }]) {
    assert.equal(isPastBattleEvent(event, today), false);
  }
});

test('expiry switches at Taipei midnight instead of UTC or the device timezone', () => {
  const event = { type: 'scrimmage', dates: ['2026-10-26'] };
  assert.equal(isPastBattleEvent(event, taipeiToday(new Date('2026-10-26T15:59:59Z'))), false);
  assert.equal(isPastBattleEvent(event, taipeiToday(new Date('2026-10-26T16:00:00Z'))), true);
});
