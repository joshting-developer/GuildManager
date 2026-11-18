import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const input = {
  title: '幫會活動',
  type: 'activity',
  dates: ['2026-10-08', '2026-10-03'],
  requestId: 'test-1',
};
async function withRepo(callback) {
  const repo = (await createRepository());
  try {
    (await callback(repo));
  } finally {
    (await repo.close());
  }
}
test('activities save discrete dates, scrimmages save one day, with no seeded events', async () =>
  (await withRepo(async (repo) => {
    assert.deepEqual((await repo.listEvents()), { events: [] });
    const event = (await repo.createEvent(input));
    assert.deepEqual(event.dates, ['2026-10-03', '2026-10-08']);
    const single = (await repo.createEvent({
      ...input,
      type: 'scrimmage',
      dates: ['2026-10-05'],
      requestId: 'test-2',
    }));
    assert.deepEqual(single.dates, ['2026-10-05']);
    assert.deepEqual((await repo.listEvents()).events, [event, single]);
  })));
test('server rejects multi-day scrimmages and missing, duplicate, malformed or impossible dates', async () =>
  (await withRepo(async (repo) => {
    const invalid = [
      { type: 'scrimmage' },
      { dates: [] },
      { dates: null },
      { dates: Array(367).fill('2026-10-03') },
      { dates: ['2026-10-03', '2026-10-03'] },
      { dates: ['2026-02-29'] },
      { dates: ['2026-04-31'] },
      { dates: ['2026-13-01'] },
      { dates: ['2026-1-3'] },
      { dates: ['2026-10-03T00:00:00Z'] },
      { dates: [123] },
    ];
    for (const values of invalid)
      (await assert.rejects(
        async () => (await repo.createEvent({ ...input, ...values })),
        (error) => Boolean(error.fields.dates),
      ));
    assert.deepEqual((await repo.listEvents()).events, []);
    assert.deepEqual((await repo.createEvent({ ...input, dates: ['2028-02-29'] })).dates, ['2028-02-29']);
  })));
test('type, title and request ID are validated independently of the browser', async () =>
  (await withRepo(async (repo) => {
    for (const values of [
      null,
      {},
      { ...input, title: '' },
      { ...input, title: 'x'.repeat(121) },
      { ...input, type: 'battle' },
      { ...input, requestId: '' },
    ])
      (await assert.rejects(
        async () => (await repo.createEvent(values)),
        (error) => error.code === 'VALIDATION_ERROR',
      ));
    assert.equal((await repo.createEvent({ ...input, title: '  幫會活動  ' })).title, '幫會活動');
  })));
test('retrying a successful request returns the same event, changing that request is rejected', async () =>
  (await withRepo(async (repo) => {
    const event = (await repo.createEvent(input));
    assert.deepEqual((await repo.createEvent({ ...input, dates: [...input.dates].reverse() })), event);
    (await assert.rejects(
      async () => (await repo.createEvent({ ...input, title: '其他活動' })),
      (error) => error.code === 'REQUEST_CONFLICT',
    ));
    assert.equal((await repo.listEvents()).events.length, 1);
  })));

test('event lists filter in SQL before pagination and retain complete dates for editing', async () => withRepo(async repo => {
  const outside = await repo.createEvent({ ...input, dates: ['2026-09-01'], requestId: 'range-outside' });
  const spanning = await repo.createEvent({ ...input, dates: ['2026-09-30', '2026-10-08'], requestId: 'range-spanning' });
  const inside = await repo.createEvent({ ...input, dates: ['2026-10-09'], requestId: 'range-inside' });
  const options = { startDate: '2026-10-01', endDate: '2026-10-31', limit: 1 };
  assert.deepEqual(await repo.listEvents(options), { events: [spanning], hasMore: true });
  assert.deepEqual(await repo.listEvents({ ...options, offset: 1 }), { events: [inside], hasMore: false });
  assert.ok(!(await repo.listEvents(options)).events.some(e => e.id === outside.id));
  for (const invalid of [{ startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-01-01' }, { limit: 1001 }, { offset: -1 }])
    await assert.rejects(repo.listEvents(invalid), e => e.code === 'VALIDATION_ERROR');
}));
