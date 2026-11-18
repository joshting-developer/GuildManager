import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createEventClient } from '../../src/api/events.js';
const values = (type, extra = {}) => ({
  type,
  dates: ['2026-10-24'],
  requestId: `empty-${type}`,
  ...extra,
});
const nameError = (e) => Boolean(e.fields?.title);

test('HTTP event adapter creates blank battle batches, clears names and rejects blank scrimmages', async () => {
  const repo = await createTestRepository({ });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const client = createEventClient({
    fetchImpl: (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init),
  });
  try {
    const created = await client.createEvent(values('dragon_tiger', { title: '' }));
    assert.equal(created.events[0].title, '');
    const event = created.events[0];
    const named = await client.updateEvent(event.id, {
      type: event.type,
      title: '暫定',
      dates: event.dates,
      revision: 1,
    });
    const cleared = await client.updateEvent(event.id, {
      type: event.type,
      title: '',
      dates: event.dates,
      revision: named.event.revision,
    });
    assert.equal(cleared.event.title, '');
    await assert.rejects(() => client.createEvent(values('scrimmage', { title: '' })), nameError);
    assert.equal((await client.getEvents()).events.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
