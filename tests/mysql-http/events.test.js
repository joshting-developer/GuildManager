import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';

const input = { title: '幫會活動', type: 'activity', dates: ['2026-10-08', '2026-10-03'], requestId: 'test-1' };

test('events API returns persisted arrangements and actionable validation errors', async () =>
  withApp(async ({ admin }) => {
    const { request } = await admin();
    let response = await request('/events', 'POST', { ...input, type: 'scrimmage' });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.fields.dates, '約戰只能選擇一天');
    response = await request('/events', 'POST', input);
    assert.equal(response.status, 201);
    const { event } = await response.json();
    assert.deepEqual(event.dates, ['2026-10-03', '2026-10-08']);
    assert.equal(event.revision, 1);
    const list = await request('/events');
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await list.json()).events, [event]);
    assert.equal((await request('/events', 'POST', { ...input, title: 'changed' })).status, 409);
    assert.deepEqual((await (await request('/events', 'POST', input)).json()).event, event, 'same request replays the saved event');
    const single = await request(`/events/${event.id}`);
    assert.deepEqual(await single.json(), { event });
    const missing = await request('/events/missing');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'EVENT_NOT_FOUND');
  }));

test('updates and deletes wait for the committed row and reject stale revisions', async () =>
  withApp(async ({ admin }) => {
    const { request } = await admin();
    const { event } = await (await request('/events', 'POST', input)).json();
    const stale = await request(`/events/${event.id}`, 'PATCH', { ...input, title: '改名', revision: 5 });
    assert.equal(stale.status, 409);
    const updated = await request(`/events/${event.id}`, 'PATCH', { ...input, title: '改名', revision: event.revision });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).event.title, '改名');
    assert.equal((await (await request(`/events/${event.id}`)).json()).event.revision, 2);
    const removed = await request(`/events/${event.id}`, 'DELETE', { revision: 2 });
    assert.equal(removed.status, 200);
    assert.deepEqual((await (await request('/events')).json()).events, []);
    const batch = await request('/events', 'POST', { title: '', type: 'guild_war', dates: ['2026-10-24', '2026-10-25'], requestId: 'batch' });
    assert.equal(batch.status, 201);
    assert.equal((await batch.json()).events.length, 2);
  }));
