import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createEventClient } from '../../src/api/events.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

test('management event list is one bounded request and stays management-only', async () => {
  const repo = await createTestRepository({});
  for (let index = 0; index < 25; index++)
    await repo.createEvent({ title: `安排 ${index}`, type: 'activity', dates: ['2026-10-01'], requestId: `m-${index}` });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const client = createEventClient({ fetchImpl: (path, init) => { calls.push(path); return authed(base + path, init); } });
    const data = await client.getManagedEvents({ page: 2, search: '安排' });
    assert.deepEqual([calls.length, data.page, data.events.length, data.total, data.filteredTotal], [1, 2, 5, 25, 25]);
    assert.equal(calls[0], '/api/event-management?page=2&search=%E5%AE%89%E6%8E%92');
    assert.equal((await fetch(base + '/api/event-management')).status, 401);
    const admin = (await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }))).user;
    await (await repo.setMemberToken(admin.id, { password: '001234', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: '001234' }));
    assert.equal((await fetch(base + '/api/event-management', { headers: { Cookie: `guild_session=${member.token}` } })).status, 403);
    assert.equal((await authed(base + '/api/event-management?type=bad')).status, 422);
  } finally { await new Promise(resolve => server.close(resolve)); (await repo.close()); }
});
