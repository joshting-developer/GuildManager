import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createHomeClient } from '../../src/api/home.js';

test('local API returns the home contract and rejects unsupported writes', async () => {
  const repository = await createTestRepository({ });
  const server = createApp(repository).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repository);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = createHomeClient({ fetchImpl: (path) => fetch(`${base}${path}`) });
    const data = await client.getHomeData();
    assert.equal(data.meta.mode, 'empty');
    assert.equal(data.summary.upcomingEvents, null);
    assert.deepEqual(data.events, []);
    assert.equal(
      (
        await fetch(`${base}/api/home`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      404,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repository.close());
  }
});

test('local transport rejects malformed payloads and HTTP errors', async () => {
  await assert.rejects(
    createHomeClient({ fetchImpl: async () => ({ ok: false }) }).getHomeData(),
    /本機資料讀取失敗/,
  );
  await assert.rejects(
    createHomeClient({
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }).getHomeData(),
    /資料格式不符/,
  );
});
