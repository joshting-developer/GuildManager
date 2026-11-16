import test from 'node:test';
import assert from 'node:assert/strict';

import { visibleCalendarEvents } from '../../src/domain/calendar-access.js';

test('calendar exposes every event type regardless of login without altering dates or snapshots', () => {
  const events = ['activity', 'scrimmage', 'guild_war', 'dragon_tiger'].map((type) => ({
    id: type,
    type,
    title: type,
    dates: ['2026-10-04'],
  }));
  assert.deepEqual(visibleCalendarEvents(events), events);
  assert.deepEqual(visibleCalendarEvents(events, { role: 'invalid' }), events);
  for (const role of ['member', 'manager', 'admin'])
    assert.deepEqual(visibleCalendarEvents(events, { role }), events);
  assert.equal(events.length, 4);
});
