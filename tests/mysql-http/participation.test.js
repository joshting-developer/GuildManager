import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, recordingNotifier } from '../helpers/mysql-app.js';

async function setup(repository) {
  await repository.addMember({ uid: '001', name: '成員', primaryProfessionId: 1, isInGuild: true, isInClub: true });
  return repository.createEvent({ title: '約戰', type: 'scrimmage', dates: ['2026-10-24'], requestId: 'event' });
}

test('calendar participation is public, waits for MySQL and notifies leave changes after commit', async () => {
  const notifier = recordingNotifier();
  await withApp({ notifier }, async ({ request, repository }) => {
    const event = await setup(repository);
    const form = await request(`/events/${event.id}/participation-form`);
    assert.equal(form.status, 200);
    assert.equal((await form.json()).members.length, 1);
    const leave = await request(`/events/${event.id}/participation`, 'PATCH', { uid: '001', status: 'leave', note: '當天不在', revision: 0 });
    assert.equal(leave.status, 200);
    const saved = (await leave.json()).response;
    assert.equal(saved.status, 'leave');
    assert.equal(saved.revision, 1);
    assert.equal(notifier.calls.length, 1);
    assert.equal(notifier.calls[0].notices[0].action, 'leave');
    const stale = await request(`/events/${event.id}/participation`, 'PATCH', { uid: '001', status: 'registered', revision: 0 });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'PARTICIPATION_CHANGED');
    assert.equal(notifier.calls.length, 1);
    const guest = await request(`/events/${event.id}/registrations`, 'POST', { name: '來支援的人', professionId: 3, note: '可以打第二場', requestId: 'guest' });
    assert.equal(guest.status, 201);
    const { registration } = await guest.json();
    assert.equal(registration.profession, '碎夢');
    const participation = await request(`/events/${event.id}/participation`);
    assert.equal(participation.headers.get('cache-control'), 'no-store');
    const data = await participation.json();
    assert.equal(data.responses.length, 1);
    assert.equal(data.registrations.length, 1);
    const submitted = await request(`/events/${event.id}/participation`, 'POST', { name: '外援甲', status: 'registered', professionId: 2, requestId: 'submit', expectedParticipant: { person: null } });
    assert.equal(submitted.status, 200);
    const missing = await request('/events/missing/participation');
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).error.code, 'EVENT_UNAVAILABLE');
  });
});
