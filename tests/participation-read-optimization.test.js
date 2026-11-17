import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventClient } from '../src/api/events.js';
import { createParticipationClient } from '../src/api/participation.js';

test('local combined form preserves legacy data, public access and revision/retry checks', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [];
  const fetchImpl = (url, options) => {
    requests.push(url);
    return fetch(base + url, options);
  };
  const client = createParticipationClient({ fetchImpl });
  const events = createEventClient({ fetchImpl });
  try {
    repo.addMember({ uid: 'guild', name: '測試成員', primaryProfessionId: 1, isInGuild: true });
    repo.addMember({ uid: 'outside', name: '編外', primaryProfessionId: 2, isInGuild: false, isInClub: false });
    for (const type of ['scrimmage', 'guild_war', 'dragon_tiger']) {
      const event = repo.createEvent({ title: '測試', type, dates: ['2026-10-19'], requestId: type });
      requests.length = 0;
      const form = await client.getForm(event.id);
      assert.deepEqual(requests, [`/api/events/${event.id}/participation-form`]);
      assert.deepEqual(form, {
        ...await client.getParticipation(event.id),
        ...await client.getMembers(event.id),
        ...repo.listProfessions(),
      });
      assert.deepEqual(form.members.map((m) => m.uid), ['guild']);
      assert.equal(form.professions.length, 9);
      assert.deepEqual(await events.getEvent(event.id), { event });
      const input = { name: '測試成員', memberUid: 'guild', status: 'registered', professionId: 3,
        note: '', revision: form.revision, requestId: 'submit-' + type };
      const receipt = await client.submitParticipation(event.id, input);
      assert.deepEqual(await client.submitParticipation(event.id, input), receipt);
      await assert.rejects(client.submitParticipation(event.id, { ...input, requestId: 'stale-' + type }),
        (error) => error.code === 'PARTICIPATION_CHANGED');
      repo.deleteEvent(event.id, event.revision);
      await assert.rejects(events.getEvent(event.id), (error) => error.code === 'EVENT_NOT_FOUND');
      await assert.rejects(client.getForm(event.id));
    }
    const activity = repo.createEvent({ title: '一般活動', type: 'activity', dates: ['2026-10-20', '2026-10-21'], requestId: 'activity' });
    assert.deepEqual(await events.getEvent(activity.id), { event: activity });
    await assert.rejects(client.getForm(activity.id));
    await assert.rejects(events.getEvent('missing'), (error) => error.code === 'EVENT_NOT_FOUND');
    for (const path of ['/api/members', `/api/events/${activity.id}/attendance`, '/api/lineups'])
      assert.equal((await fetch(base + path)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
