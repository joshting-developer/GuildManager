import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createLineupClient } from '../src/api/lineups.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

test('local managers can delete a 本場外援 outright; repeats are no-ops and stale revisions are refused', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const event = repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-24'], requestId: 'war' });
  const other = repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-10-25'], requestId: 'war2' });
  const guest = repo.addGuestRegistration(event.id, { name: '打錯的外援', professionId: 3, requestId: 'guest' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createLineupClient({ fetchImpl: (path, init) => fetch(base + path, init) });
  try {
    await assert.rejects(client.deleteGuest(other.id, guest.id, guest.revision), (e) => e.code === 'REGISTRATION_NOT_FOUND');
    await assert.rejects(client.deleteGuest(event.id, guest.id, guest.revision + 5), (e) => e.code === 'PARTICIPATION_CHANGED');
    assert.deepEqual(await client.deleteGuest(event.id, guest.id, guest.revision), { deleted: true, id: guest.id });
    const participation = repo.getEventParticipation(event.id);
    assert.equal(participation.registrations.length, 0);
    assert.equal(participation.registrationLeaves.length, 0, 'deleted, not turned into leave');
    assert.deepEqual(await client.deleteGuest(event.id, guest.id, guest.revision), { deleted: true, id: guest.id });
    const anonymous = await globalThis.fetch(`${base}/api/lineups/events/${event.id}/guests/${guest.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1 }),
    });
    assert.equal(anonymous.status, 401, 'signed-out visitors cannot delete');
  } finally {
    server.close();
    repo.close();
  }
});

test('GAS deletes a 本場外援 for managers only, without a leave record or Discord notice', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.raw(op, args, admin));
  env.propertyService.setProperty('DISCORD_WEBHOOK_LEAVE', 'https://discord.com/api/webhooks/123456/leave-token_A');
  const event = call('createEvent', [{ type: 'guild_war', title: '', dates: ['2026-10-04'], requestId: 'war' }]).events[0];
  const guest = call('addGuestRegistration', [event.id, { name: '打錯的外援', professionId: 2, requestId: 'guest' }]).registration;
  env.fetches.length = 0;
  assert.equal(env.raw('deleteGuestRegistration', [event.id, guest.id, guest.revision]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('deleteGuestRegistration', [event.id, guest.id, guest.revision + 3], admin).error.code, 'REVISION_CONFLICT');
  assert.deepEqual(call('deleteGuestRegistration', [event.id, guest.id, guest.revision]), { deleted: true, id: guest.id });
  const participation = call('getEventParticipation', [event.id]);
  assert.equal(participation.registrations.length, 0);
  assert.equal(participation.registrationLeaves.length, 0);
  assert.equal(env.fetches.length, 0, 'no Discord notice');
  assert.deepEqual(call('deleteGuestRegistration', [event.id, guest.id, guest.revision]), { deleted: true, id: guest.id });
});
