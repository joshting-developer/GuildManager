import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventClient, forgetEventList } from '../src/api/events.js';

function fakeTransport() {
  const calls = [];
  const fetchImpl = async (path, init = {}) => {
    calls.push(`${init.method || 'GET'} ${path}`);
    return { ok: true, json: async () => ({ events: [{ id: String(calls.length) }], event: {} }) };
  };
  return { calls, fetchImpl };
}

test('the event list is shared for a minute and cleared by writes, sign-in changes and failures', async () => {
  forgetEventList();
  const { calls, fetchImpl } = fakeTransport();
  const client = createEventClient({ fetchImpl });
  const other = createEventClient({ fetchImpl });
  const first = await client.getEvents();
  assert.deepEqual(await other.getEvents(), first, 'pages on the same transport share the list');
  assert.equal(calls.length, 1);
  await client.createEvent({ type: 'activity' });
  await client.getEvents();
  assert.equal(calls.filter((c) => c === 'GET /api/events').length, 2, 'a write clears the list');
  await client.updateEvent('1', { revision: 1 });
  await client.getEvents();
  await client.deleteEvent('1', 2);
  await client.getEvents();
  assert.equal(calls.filter((c) => c === 'GET /api/events').length, 4);
  forgetEventList();
  await client.getEvents();
  assert.equal(calls.filter((c) => c === 'GET /api/events').length, 5, 'sign-in changes clear it');
  const separate = fakeTransport();
  await createEventClient({ fetchImpl: separate.fetchImpl }).getEvents();
  assert.equal(separate.calls.length, 1, 'another transport has its own list');
});

test('a failed list read is not cached and an expired list is fetched again', async (t) => {
  forgetEventList();
  let fail = true, reads = 0;
  const fetchImpl = async () => {
    reads += 1;
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const client = createEventClient({ fetchImpl });
  await assert.rejects(client.getEvents());
  fail = false;
  await client.getEvents();
  assert.equal(reads, 2);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 61 * 1000 });
  await client.getEvents();
  assert.equal(reads, 3, 'older than a minute is refreshed');
});

test('ranges have separate cache entries and complete pickers follow bounded pages', async () => {
  forgetEventList();
  const calls = [];
  const client = createEventClient({ fetchImpl: async url => {
    calls.push(url);
    const params = new URL(url, 'http://example.test').searchParams;
    return { ok: true, json: async () => ({ events: [{ id: params.get('offset') || '0' }], hasMore: params.get('offset') === '0' }) };
  } });
  const first = { startDate: '2026-11-01', endDate: '2026-11-30' };
  await client.getEvents(first);
  await client.getEvents({ ...first });
  await client.getEvents({ startDate: '2026-12-01', endDate: '2026-12-31' });
  assert.equal(calls.length, 2);
  assert.deepEqual((await client.getAllEvents()).events.map(e => e.id), ['0', '200']);
  assert.equal(calls.length, 4);
  await client.createEvent({});
  await client.getEvents(first);
  assert.equal(calls.length, 6, 'write invalidates every range');
});
