import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';

test('import APIs return preview/summary, accept payloads larger than a single-member request', async () => {
  const repo = await createTestRepository({ });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}/api/members/import`;
  const send = (path, body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const text = Array.from(
      { length: 300 },
      (_, index) => `${String(index).padStart(20, '0')} 這是成員名稱 碎夢 素問`,
    ).join('\n');
    let response = await send('/preview', { text });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.rows.length, 300);
    response = await send('', { text, fingerprint: preview.fingerprint });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary.added, 300);
    response = await send('', { text, fingerprint: preview.fingerprint });
    assert.equal(response.status, 409);
    response = await send('', { text: '001 錯誤 錯職業 -', fingerprint: 'bad' });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.rows[0].line, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
