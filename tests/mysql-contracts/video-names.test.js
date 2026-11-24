import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';

test('public uploaded names merge old and new videos, deduplicate, page and expose only names for this event', async () => withApp(async ({ repository, request }) => {
  const event = await repository.createEvent({ title: '影片名單', type: 'scrimmage', dates: ['2026-01-01'], requestId: 'names-event' });
  const other = await repository.createEvent({ title: '其他場次', type: 'scrimmage', dates: ['2026-01-02'], requestId: 'other-event' });
  const db = repositoryDatabase(repository);
  for (let i = 0; i < 25; i++) await repository.submitEventVideo(event.id, {
    name: `測試${String(i).padStart(2, '0')}`, professionId: 1, firstUrl: 'https://example.test/private',
    secondUrl: '', groupName: '進攻一', note: 'private', requestId: `names-${i}`,
  });
  await db.query("INSERT INTO event_videos(id,event_id,round_number,name,url,created_at,group_name) VALUES ('legacy',?,1,'測試00','https://example.test/old','2026-01-01','防守團')", [event.id]);
  await db.query("INSERT INTO event_videos(id,event_id,round_number,name,url,created_at,group_name) VALUES ('other',?,1,'其他人','https://example.test/other','2026-01-01','防守團')", [other.id]);
  await db.query("INSERT INTO event_videos(id,event_id,round_number,name,url,created_at,group_name) VALUES ('literal',?,1,'100%_MATCH','https://example.test/old','2026-01-01','防守團')", [event.id]);
  const response = await request(`/events/${event.id}/video-names`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const first = await response.json();
  assert.deepEqual(Object.keys(first).sort(), ['eventId', 'limit', 'names', 'page', 'total']);
  assert.equal(first.total, 26);
  assert.equal(first.names.length, 20);
  assert.ok(first.names.every(row => Object.keys(row).join() === 'name'));
  const second = await (await request(`/events/${event.id}/video-names?page=2`)).json();
  assert.equal(second.names.length, 6);
  assert.equal(new Set([...first.names, ...second.names].map(row => row.name)).size, 26);
  assert.ok(![...first.names, ...second.names].some(row => row.name === '其他人'));
  const literal = await (await request(`/events/${event.id}/video-names?search=%25_match`)).json();
  assert.deepEqual(literal.names, [{ name: '100%_MATCH' }]);
  assert.equal((await (await request(`/events/${event.id}/video-names?search=沒有`)).json()).total, 0);
  for (const query of ['page=0', 'page=1.5', 'search=x&search=y', 'search=' + 'x'.repeat(65)])
    assert.equal((await request(`/events/${event.id}/video-names?${query}`)).status, 422);
  assert.equal((await request(`/events/${event.id}/videos`)).status, 401);
  const client = createEventVideoClient({ fetchImpl: path => request(path.replace('/api', '')) });
  assert.equal((await client.getNames(event.id, { page: 2 })).names.length, 6);
  await repository.deleteEvent(event.id, event.revision);
  assert.equal((await request(`/events/${event.id}/video-names`)).status, 409);
}));
