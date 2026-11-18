import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const base = { title: '多日戰鬥安排', dates: ['2026-10-24', '2026-10-26', '2026-11-02'] };

test('guild war and dragon tiger support discrete multi-day creation, editing between types, retry and single-day arrangements', async () => {
  const repo = (await createRepository());
  try {
    for (const type of ['guild_war', 'dragon_tiger']) {
      const values = { ...base, type, requestId: type };
      const events = (await repo.createEventBatch(values));
      const event = events[0];
      assert.equal(event.type, type);
      assert.deepEqual(
        events.map((event) => event.dates[0]),
        base.dates,
      );
      assert.deepEqual((await repo.createEventBatch(values)), events);
      const updated = (await repo.updateEvent(event.id, {
        ...base,
        dates: event.dates,
        type: type === 'guild_war' ? 'dragon_tiger' : 'guild_war',
        revision: 1,
      }));
      assert.equal(updated.revision, 2);
      assert.deepEqual(updated.dates, event.dates);
      const single = (await repo.updateEvent(event.id, {
        ...base,
        type,
        dates: ['2026-10-24'],
        revision: 2,
      }));
      assert.deepEqual(single.dates, ['2026-10-24']);
    }
    assert.equal((await repo.listEvents()).events.length, 6);
  } finally {
    (await repo.close());
  }
});
test('new multi-day types enforce date limits and valid dates, while scrimmage remains single-day', async () => {
  const repo = (await createRepository());
  try {
    const maximum = Array.from({ length: 366 }, (_, index) =>
      new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    );
    for (const type of ['guild_war', 'dragon_tiger']) {
      const events = (await repo.createEventBatch({ ...base, type, dates: maximum, requestId: type }));
      const event = events[0];
      assert.equal(events.length, 366);
      for (const dates of [
        [],
        [...maximum, '2027-01-02'],
        ['2026-10-24', '2026-10-24'],
        ['2026-02-29'],
      ]) {
        (await assert.rejects(
          async () => (await repo.createEventBatch({ ...base, type, dates, requestId: 'invalid' })),
          (error) => Boolean(error.fields.dates),
        ));
        (await assert.rejects(
          async () => (await repo.updateEvent(event.id, { ...base, type, dates, revision: 1 })),
          (error) => Boolean(error.fields.dates),
        ));
      }
      (await assert.rejects(
        async () => (await repo.updateEvent(event.id, { ...base, type: 'scrimmage', revision: 1 })),
        (error) => error.fields.dates === '約戰只能選擇一天',
      ));
    }
    (await assert.rejects(
      async () => (await repo.createEvent({ ...base, type: 'unknown', requestId: 'unknown' })),
      (error) => Boolean(error.fields.type),
    ));
  } finally {
    (await repo.close());
  }
});
