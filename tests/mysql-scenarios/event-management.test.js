import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createEventClient } from '../../src/api/events.js';
const input = {
  title: '多日活動',
  type: 'activity',
  dates: ['2026-10-24', '2026-10-26'],
  requestId: 'management-test',
};

test('HTTP PATCH/DELETE accept revisions, report conflicts and prevent cross-origin writes', async () => {
  const repo = await createTestRepository({ });
  const event = (await repo.createEvent(input));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repo);
  const url = `http://127.0.0.1:${server.address().port}/api/events/${event.id}`;
  const request = (method, body, headers = {}) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    let response = await request('PATCH', { ...input, title: 'API 修改', revision: 1 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).event.revision, 2);
    assert.equal((await request('DELETE', { revision: 1 })).status, 409);
    assert.equal((await request('DELETE', {})).status, 422);
    assert.equal(
      (await request('DELETE', { revision: 2 }, { Origin: 'https://example.com' })).status,
      403,
    );
    response = await request('DELETE', { revision: 2 });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: event.id });
    assert.equal((await request('DELETE', { revision: 2 })).status, 200);
    assert.equal((await request('PATCH', { ...input, revision: 2 })).status, 404);
    assert.deepEqual((await repo.listEvents()), { events: [] });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});

test('event adapter encodes IDs and passes revisions for HTTP edits/deletes with no automatic retry', async () => {
  const requests = [];
  const values = { ...input, revision: 3 };
  const client = createEventClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: requests.length === 1,
        json: async () =>
          requests.length === 1
            ? { event: { id: 'a/b', ...values } }
            : { error: { code: 'REVISION_CONFLICT', message: '安排已修改' } },
      };
    },
  });
  assert.equal((await client.updateEvent('a/b', values)).event.id, 'a/b');
  await assert.rejects(client.deleteEvent('a/b', 3), (error) => error.code === 'REVISION_CONFLICT');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/events/a%2Fb');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), values);
  assert.equal(requests[1].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[1].options.body), { revision: 3 });
});
