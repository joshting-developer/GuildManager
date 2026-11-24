import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';

test('public uploaded names merge old and new videos, deduplicate, page and expose only players and professions for this event', async () => withApp(async ({ repository, request }) => {
  const event = await repository.createEvent({ title: '影片名單', type: 'scrimmage', dates: ['2026-01-01'], requestId: 'names-event' });
  const other = await repository.createEvent({ title: '其他場次', type: 'scrimmage', dates: ['2026-01-02'], requestId: 'other-event' });
  const db = repositoryDatabase(repository);
  for (let i = 0; i < 25; i++) await repository.submitEventVideo(event.id, {
    name: `測試${String(i).padStart(2, '0')}`, professionId: i % 2 + 1, firstUrl: 'https://example.test/private',
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
  assert.ok(first.names.every(row => Object.keys(row).sort().join() === 'name,professionId,professionName'));
  const second = await (await request(`/events/${event.id}/video-names?page=2`)).json();
  assert.equal(second.names.length, 6);
  assert.equal(new Set([...first.names, ...second.names].map(row => row.name)).size, 26);
  assert.ok(![...first.names, ...second.names].some(row => row.name === '其他人'));
  const literal = await (await request(`/events/${event.id}/video-names?search=%25_match`)).json();
  assert.deepEqual(literal.names, [{ name: '100%_MATCH', professionId: null, professionName: null }]);
  assert.equal((await (await request(`/events/${event.id}/video-names?search=沒有`)).json()).total, 0);
  for (const query of ['page=0', 'page=1.5', 'search=x&search=y', 'search=' + 'x'.repeat(65)])
    assert.equal((await request(`/events/${event.id}/video-names?${query}`)).status, 422);
  const unknown = await (await request(`/events/${event.id}/video-names?professionId=0`)).json();
  assert.deepEqual(unknown.names, [{ name: '100%_MATCH', professionId: null, professionName: null }]);
  const profession = await (await request(`/events/${event.id}/video-names?professionId=2&sort=professionDesc`)).json();
  assert.equal(profession.total, 12);
  assert.ok(profession.names.every(row => row.professionId === 2));
  for (const sort of ['professionAsc', 'professionDesc']) {
    const data = await repository.listEventVideoNames(event.id, { sort });
    const known = data.names.filter(row => row.professionName).map(row => row.professionName);
    assert.deepEqual(known, [...known].sort((a, b) => sort === 'professionAsc' ? (a < b ? -1 : a > b ? 1 : 0) : (a < b ? 1 : a > b ? -1 : 0)));
    const next = await repository.listEventVideoNames(event.id, { sort, page: 2 });
    assert.equal(next.names.at(-1).professionName, null, 'unknown professions sort last in both directions');
  }
  for (const query of ['professionId=-1', 'professionId=x', 'professionId=1&professionId=2', 'sort=bad', 'sort=name&sort=professionAsc'])
    assert.equal((await request(`/events/${event.id}/video-names?${query}`)).status, 422);
  const latest = await repository.submitEventVideo(event.id, { name: '測試00', professionId: 2, firstUrl: 'https://example.test/latest', secondUrl: '', groupName: '進攻一', note: '', requestId: 'latest-job' });
  await db.query("UPDATE event_video_submissions SET created_at='2099-01-01' WHERE id=?", [latest.video.id]);
  const updated = await repository.listEventVideoNames(event.id, { search: '測試00' });
  assert.equal(updated.total, 1);
  assert.equal(updated.names[0].professionId, 2);
  assert.equal((await request(`/events/${event.id}/videos`)).status, 401);
  await repository.updateEventVideoProfession(event.id, 'literal', { professionId: 2, revision: 0, requestId: 'legacy-job' });
  assert.equal((await repository.listEventVideoNames(event.id, { search: '100%' })).names[0].professionId, 2);
  const client = createEventVideoClient({ fetchImpl: path => request(path.replace('/api', '')) });
  assert.equal((await client.getNames(event.id, { page: 2 })).names.length, 6);
  await repository.deleteEvent(event.id, event.revision);
  assert.equal((await request(`/events/${event.id}/video-names`)).status, 409);
}));
