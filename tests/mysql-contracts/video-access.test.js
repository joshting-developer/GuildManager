import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';
import { videoTableCsv } from '../../src/domain/video-table-csv.js';

test('video reads redact private fields for visitors and members, ignoring query escalation, while management retains reads and writes', async () => withApp(async app => {
  const admin = await app.admin();
  await app.repository.createManager(admin.session.user.id, { username: 'manager', password: 'manager-password' });
  const manager = await app.login({ username: 'manager', password: 'manager-password' });
  await app.repository.setMemberToken(admin.session.user.id, { password: '001234', revision: 0 });
  const member = await app.login({ password: '001234' }, { path: '/auth/member-login' });
  const event = await app.repository.createEvent({ title: '公開影片名單', type: 'scrimmage', dates: ['2026-01-01'], requestId: 'access' });
  const saved = await app.repository.submitEventVideo(event.id, { name: '測試玩家', professionId: 1, firstUrl: 'https://example.test/private', secondUrl: '', note: 'private-note', groupName: '進攻一', requestId: 'access-video' });
  await repositoryDatabase(app.repository).query("INSERT INTO event_videos(id,event_id,round_number,name,url,created_at,group_name) VALUES ('legacy',?,1,'舊玩家','https://example.test/legacy','2026-01-01','防守團')", [event.id]);
  for (const actor of [app, member]) {
    const client = createEventVideoClient({ fetchImpl: path => actor.request(path.replace('/api', '')) });
    assert.equal((await client.getChoices()).events.length, 1);
    for (const result of [(await client.getBrowser(event.id)).selected, await client.getVideos(event.id, { includePrivate: 'true', canManage: 'true', limit: 1 })]) {
      assert.equal(result.canManage, false);
      assert.equal(result.total, 2);
      for (const row of result.videos) {
        assert.deepEqual(Object.keys(row).sort(), ['id', 'eventId', 'name', 'professionId', 'professionName', 'professionColorcode', 'groupName', 'createdAt'].sort());
      }
      assert.ok(!JSON.stringify(result).includes('private'));
      const csv = videoTableCsv(result.videos, false);
      assert.ok(!csv.includes('連結') && !csv.includes('備註') && !csv.includes('private'));
    }
    const filtered = await client.getVideos(event.id, { search: '測試', group: '進攻一' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.videos[0].name, '測試玩家');
    for (const [suffix, method] of [['profession', 'PATCH'], ['event', 'PATCH'], ['', 'DELETE']]) {
      const response = await actor.request(`/events/${event.id}/videos/${saved.video.id}${suffix ? '/' + suffix : ''}`, method, {});
      assert.equal(response.status, actor === app ? 401 : 403);
    }
  }
  for (const actor of [admin, manager]) {
    const data = await (await actor.request(`/videos/browser?eventId=${event.id}`)).json();
    assert.equal(data.selected.canManage, true);
    assert.equal(data.selected.videos.find(row => row.id === saved.video.id).note, 'private-note');
    const changed = await actor.request(`/events/${event.id}/videos/${saved.video.id}/profession`, 'PATCH', { professionId: 2, revision: saved.video.revision + (actor === admin ? 0 : 1), requestId: `edit-${actor.session.user.role}` });
    assert.equal(changed.status, 200);
  }
}));
