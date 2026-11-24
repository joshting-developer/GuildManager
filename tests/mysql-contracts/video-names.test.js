import { filterVideoNames } from '../../src/domain/event-videos.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';

test('public uploaded names merge old and new videos, deduplicate, return all players and expose only players and professions for this event', async () => withApp(async ({ repository, request }) => {
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
  assert.deepEqual(Object.keys(first).sort(), ['eventId', 'names']);
  assert.equal(first.names.length, 26, 'all players are returned, including those beyond the old first page');
  assert.ok(first.names.every(row => Object.keys(row).sort().join() === 'name,professionId,professionName'));
  assert.equal(new Set(first.names.map(row => row.name)).size, 26);
  assert.ok(!first.names.some(row => row.name === '其他人'));
  assert.deepEqual(filterVideoNames(first.names, { search: '%_match' }), [{ name: '100%_MATCH', professionId: null, professionName: null }]);
  assert.deepEqual(filterVideoNames(first.names, { search: '沒有' }), []);
  assert.deepEqual(filterVideoNames(first.names, { professionId: '0' }), [{ name: '100%_MATCH', professionId: null, professionName: null }]);
  const profession = filterVideoNames(first.names, { professionId: '2', sort: 'professionDesc' });
  assert.equal(profession.length, 12);
  assert.ok(profession.every(row => row.professionId === 2));
  assert.equal(filterVideoNames(first.names, { professionId: '2', search: '測試03' }).length, 1);
  for (const sort of ['professionAsc', 'professionDesc']) {
    const data = filterVideoNames(first.names, { sort });
    const known = data.filter(row => row.professionName).map(row => row.professionName);
    assert.deepEqual(known, [...known].sort((a, b) => sort === 'professionAsc' ? (a < b ? -1 : a > b ? 1 : 0) : (a < b ? 1 : a > b ? -1 : 0)));
    assert.equal(data.at(-1).professionName, null, 'unknown professions sort last in both directions');
    assert.equal(data.length, 26);
  }
  assert.equal(first.names[0].name, '100%_MATCH', 'client sorting does not mutate loaded data');
  const latest = await repository.submitEventVideo(event.id, { name: '測試00', professionId: 2, firstUrl: 'https://example.test/latest', secondUrl: '', groupName: '進攻一', note: '', requestId: 'latest-job' });
  await db.query("UPDATE event_video_submissions SET created_at='2099-01-01' WHERE id=?", [latest.video.id]);
  const updated = filterVideoNames((await repository.listEventVideoNames(event.id)).names, { search: '測試00' });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].professionId, 2);
  assert.equal((await request(`/events/${event.id}/videos`)).status, 401);
  await repository.updateEventVideoProfession(event.id, 'literal', { professionId: 2, revision: 0, requestId: 'legacy-job' });
  assert.equal(filterVideoNames((await repository.listEventVideoNames(event.id)).names, { search: '100%' })[0].professionId, 2);
  const client = createEventVideoClient({ fetchImpl: path => request(path.replace('/api', '')) });
  assert.equal((await client.getNames(event.id)).names.length, 26);
  await repository.deleteEvent(event.id, event.revision);
  assert.equal((await request(`/events/${event.id}/video-names`)).status, 409);
}));
