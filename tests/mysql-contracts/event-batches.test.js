import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const input = {
  title: '循環幫戰',
  type: 'guild_war',
  dates: ['2026-10-31', '2026-10-24'],
  requestId: 'batch-1',
};
test('batch dates create separate IDs and revisions; editing or deleting one event never changes siblings', async () => {
  const repo = (await createRepository());
  try {
    const events = (await repo.createEventBatch(input));
    assert.equal(new Set(events.map((event) => event.id)).size, 2);
    assert.deepEqual(
      events.map((event) => event.dates),
      [['2026-10-24'], ['2026-10-31']],
    );
    assert.deepEqual(
      events.map((event) => event.revision),
      [1, 1],
    );
    const changed = (await repo.updateEvent(events[0].id, {
      title: '第一場改期',
      type: 'dragon_tiger',
      dates: ['2026-10-25'],
      revision: 1,
    }));
    assert.deepEqual((await repo.listEvents()).events, [changed, events[1]]);
    (await assert.rejects(
      async () => (await repo.updateEvent(changed.id, { ...input, revision: 2 })),
      (error) => Boolean(error.fields.dates),
    ));
    (await repo.deleteEvent(changed.id, 2));
    assert.deepEqual((await repo.listEvents()).events, [events[1]]);
    (await assert.rejects(
      async () => (await repo.createEventBatch(input)),
      (error) => error.code === 'EVENT_DELETED',
    ));
    assert.deepEqual((await repo.listEvents()).events, [events[1]]);
  } finally {
    (await repo.close());
  }
});
test('batch retries return the original IDs, changed payloads conflict and request IDs cannot be reused across regular/batch creation', async () => {
  const repo = (await createRepository());
  try {
    const events = (await repo.createEventBatch(input));
    assert.deepEqual(
      (await repo.createEventBatch({ ...input, dates: [...input.dates].reverse() })),
      events,
    );
    for (const change of [
      { title: '別的安排' },
      { type: 'dragon_tiger' },
      { dates: ['2026-11-07'] },
    ])
      (await assert.rejects(
        async () => (await repo.createEventBatch({ ...input, ...change })),
        (error) => error.code === 'REQUEST_CONFLICT',
      ));
    (await assert.rejects(
      async () => (await repo.createEvent({ ...input, type: 'activity' })),
      (error) => error.code === 'REQUEST_CONFLICT',
    ));
    (await repo.createEvent({ ...input, type: 'activity', requestId: 'regular' }));
    (await assert.rejects(
      async () => (await repo.createEventBatch({ ...input, requestId: 'regular' })),
      (error) => error.code === 'REQUEST_CONFLICT',
    ));
    assert.equal((await repo.listEvents()).events.length, 3);
  } finally {
    (await repo.close());
  }
});
