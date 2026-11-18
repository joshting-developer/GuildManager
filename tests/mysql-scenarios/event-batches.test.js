import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
const input = {
  title: '循環幫戰',
  type: 'guild_war',
  dates: ['2026-10-31', '2026-10-24'],
  requestId: 'batch-1',
};

test('HTTP battle creation returns separate single-day arrangements, regular activities retain one multi-day arrangement', async () => {
  const repo = await createTestRepository({ });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repo);
  const url = `http://127.0.0.1:${server.address().port}/api/events`;
  const post = (body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    for (const type of ['guild_war', 'dragon_tiger']) {
      const response = await post({ ...input, type, requestId: type });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.events.length, 2);
      assert.equal(body.event, undefined);
      for (const event of body.events) {
        assert.equal(event.dates.length, 1);
        assert.equal(event.type, type);
      }
      assert.deepEqual(
        (await (await post({ ...input, type, requestId: type })).json()).events,
        body.events,
      );
    }
    const activity = (
      await (await post({ ...input, type: 'activity', requestId: 'regular' })).json()
    ).event;
    assert.equal(activity.dates.length, 2);
    assert.equal((await repo.listEvents()).events.length, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
