import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  battleEventLabel,
  defaultBattleEventId,
  isBattleEvent,
  orderBattleEvents,
  taipeiToday,
} from '../src/domain/battle-events.js';
import { compactStat, isWanColumn, statCell } from '../src/domain/number-format.js';

const event = (id, date, type = 'scrimmage', title = '') => ({ id, dates: [date], type, title });
const events = [
  event('past-far', '2026-10-10'),
  event('past', '2026-10-19', 'guild_war'),
  event('today', '2026-10-20', 'scrimmage', '21：00 楓橋'),
  event('soon', '2026-10-22'),
  event('later', '2026-10-29', 'dragon_tiger'),
];
const ids = (list) => list.map((item) => item.id);

test('lineups prefer the nearest session from today, then past sessions newest first', () => {
  const today = '2026-10-20';
  assert.deepEqual(ids(orderBattleEvents(events, { prefer: 'upcoming', today })), [
    'today', 'soon', 'later', 'past', 'past-far',
  ]);
  // Without a session today, the 20th still picks the 22nd rather than the 19th.
  assert.equal(defaultBattleEventId(events.filter((item) => item.id !== 'today'), { today }), 'soon');
  assert.equal(defaultBattleEventId(events.slice(0, 2), { prefer: 'upcoming', today }), 'past');
});

test('uploads and videos prefer today or the latest past session, then upcoming soonest first', () => {
  const today = '2026-10-21';
  assert.deepEqual(ids(orderBattleEvents(events, { prefer: 'recent', today })), [
    'today', 'past', 'past-far', 'soon', 'later',
  ]);
  assert.equal(defaultBattleEventId(events.slice(3), { prefer: 'recent', today }), 'soon');
  assert.equal(defaultBattleEventId([], { today }), null);
  const original = JSON.stringify(events);
  orderBattleEvents(events, { today });
  assert.equal(JSON.stringify(events), original, 'ordering does not mutate the input');
});

test('labels show weekday, type, title and other years; only battles qualify', () => {
  const today = '2026-10-20';
  assert.equal(battleEventLabel(events[2], today), '10/20（二）· 約戰 · 21：00 楓橋');
  assert.equal(battleEventLabel(events[1], today), '10/19（一）· 幫戰');
  assert.equal(battleEventLabel(event('old', '2025-12-31', 'dragon_tiger'), today), '2025/12/31（三）· 龍虎戰');
  assert.ok(isBattleEvent(events[0]) && !isBattleEvent(event('a', today, 'activity')));
  assert.equal(taipeiToday(new Date('2026-10-19T16:30:00Z')), '2026-10-20', 'Taipei date, not UTC');
});

test('a column reaching 10,000 shows every cell in 萬 with one decimal; zero reads as a faint dash', () => {
  assert.equal(isWanColumn([12, 9999, null]), false);
  assert.equal(isWanColumn([12, -10000]), true);
  const wan = (value) => statCell(value, { wan: true });
  assert.deepEqual([1234567, 120000, 8000, 999, 300, -23456].map((value) => wan(value).text), [
    '123.5萬', '12.0萬', '0.8萬', '0.1萬', '<0.1萬', '-2.3萬',
  ]);
  assert.equal(wan(1234567).title, '1,234,567', 'tooltip keeps the exact value');
  assert.deepEqual(statCell(0), { text: '—', empty: true });
  assert.deepEqual(statCell(null, { wan: true }), { text: '—', empty: true });
  assert.deepEqual(statCell(12), { text: '12', empty: false });
  assert.equal(statCell(2.456, { maximumFractionDigits: 2 }).text, '2.46');
  assert.equal(statCell('碎夢').text, '碎夢');
});

test('team totals read in 萬 or 億 with one decimal so summary cards stay on one line', () => {
  assert.deepEqual([1720965125, 33504808, 2340, 0, null].map(compactStat), [
    '17.2億', '3,350.5萬', '2,340', '0', '—',
  ]);
});
