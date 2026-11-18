import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createLineupClient } from '../../src/api/lineups.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

test('local managers can delete a 本場外援 outright; repeats are no-ops and stale revisions are refused', async () => {
  const repo = await createTestRepository({ });
  const event = (await repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-24'], requestId: 'war' }));
  const other = (await repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-25'], requestId: 'war2' }));
  const guest = (await repo.addGuestRegistration(event.id, { name: '打錯的外援', professionId: 3, requestId: 'guest' }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createLineupClient({ fetchImpl: (path, init) => fetch(base + path, init) });
  try {
    await assert.rejects(client.deleteGuest(other.id, guest.id, guest.revision), (e) => e.code === 'REGISTRATION_NOT_FOUND');
    await assert.rejects(client.deleteGuest(event.id, guest.id, guest.revision + 5), (e) => e.code === 'PARTICIPATION_CHANGED');
    assert.deepEqual(await client.deleteGuest(event.id, guest.id, guest.revision), { deleted: true, id: guest.id });
    const participation = (await repo.getEventParticipation(event.id));
    assert.equal(participation.registrations.length, 0);
    assert.equal(participation.registrationLeaves.length, 0, 'deleted, not turned into leave');
    assert.deepEqual(await client.deleteGuest(event.id, guest.id, guest.revision), { deleted: true, id: guest.id });
    const anonymous = await globalThis.fetch(`${base}/api/lineups/events/${event.id}/guests/${guest.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1 }),
    });
    assert.equal(anonymous.status, 401, 'signed-out visitors cannot delete');
  } finally {
    server.close();
    (await repo.close());
  }
});
