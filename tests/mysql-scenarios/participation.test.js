import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createParticipationClient } from '../../src/api/participation.js';

async function setup() {
  const repo = await createTestRepository({ });
  (await repo.addMember({
    uid: '001',
    name: '成員',
    primaryProfessionId: 1,
    isInGuild: true,
    isInClub: true,
  }));
  const event = (await repo.createEvent({
    title: '約戰',
    type: 'scrimmage',
    dates: ['2026-10-24'],
    requestId: 'event',
  }));
  const other = (await repo.createEvent({
    title: '',
    type: 'guild_war',
    dates: ['2026-10-25'],
    requestId: 'other',
  }));
  return { repo, event, other };
}
const code = (value) => (error) => error.code === value;
const guest = (extra = {}) => ({
  name: '來支援的人',
  professionId: 3,
  note: '可以打第二場',
  requestId: 'guest',
  ...extra,
});

test('ordinary, deleted and missing events reject participation while valid responses persist after restart', async () => {
  let { repo, event } = await setup();
  try {
    const ordinary = (await repo.createEvent({
      title: '活動',
      type: 'activity',
      dates: ['2026-10-24'],
      requestId: 'ordinary',
    }));
    await assert.rejects(async () => (await repo.getEventParticipation(ordinary.id)), code('EVENT_UNAVAILABLE'));
    await assert.rejects(async () => (await repo.addGuestRegistration('missing', guest())), code('EVENT_UNAVAILABLE'));
    (await repo.saveMemberResponse(event.id, { uid: '001', status: 'leave', note: '', revision: 0 }));
    const registration = (await repo.addGuestRegistration(event.id, guest()));
    const before = (await repo.getEventParticipation(event.id));
    repo = reopenTestRepository(repo);
    assert.deepEqual((await repo.getEventParticipation(event.id)), before);
    (await repo.deleteEvent(event.id, event.revision));
    await assert.rejects(async () => (await repo.getEventParticipation(event.id)), code('EVENT_UNAVAILABLE'));
    await assert.rejects(
      async () => (await repo.cancelGuestRegistration(event.id, registration.id, 1)),
      code('EVENT_UNAVAILABLE'),
    );
  } finally {
    (await repo.close());
  }
});

test('HTTP adapter performs responses, guests and cancellation, and surfaces validation/conflict failures', async () => {
  const { repo, event } = await setup();
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createParticipationClient({
    fetchImpl: (path, options) => fetch(`${base}${path}`, options),
  });
  try {
    assert.equal((await client.getParticipation(event.id)).eventId, event.id);
    const saved = await client.saveResponse(event.id, {
      uid: '001',
      status: 'leave',
      note: '',
      revision: 0,
    });
    assert.equal(saved.response.status, 'leave');
    const result = await client.registerGuest(event.id, guest());
    await assert.rejects(
      client.registerGuest(event.id, guest({ requestId: 'duplicate' })),
      code('REGISTRATION_EXISTS'),
    );
    await assert.rejects(
      client.registerGuest(event.id, guest({ requestId: 'invalid', professionId: 100 })),
      code('PARTICIPATION_INVALID'),
    );
    assert.equal(
      (await client.cancelGuest(event.id, result.registration.id, 1)).registration.active,
      false,
    );
    await assert.rejects(client.getParticipation('missing'), code('EVENT_UNAVAILABLE'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
