import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { createEventVideoClient } from '../../src/api/event-videos.js';

test('video SQL pages both sources, scopes filters, and CSV client reads every matching page', async () => {
  const repo = await createTestRepository();
  let server;
  try {
    const db = repositoryDatabase(repo);
    const event = await repo.createEvent({ title: '影片', type: 'scrimmage', dates: ['2026-01-01'], requestId: 'e' });
    const other = await repo.createEvent({ title: '其他場次', type: 'scrimmage', dates: ['2026-01-02'], requestId: 'o' });
    for (let i = 0; i < 205; i++) await db.query(`INSERT INTO event_video_submissions
      (id,event_id,name,first_url,second_url,note,created_at,group_name,profession_id,profession_name,profession_colorcode)
      VALUES (?,?,?,'https://example.test/video','','','2026-01-01','進攻一',1,'素問','#123456')`,
    [`v${String(i).padStart(3,'0')}`, event.id, i === 204 ? '100%_MATCH' : 'Video']);
    await db.query("INSERT INTO event_videos(id,event_id,round_number,name,url,created_at,group_name) VALUES ('legacy',?,1,'Video','https://example.test/old','2026-01-01','防守團')", [event.id]);
    await db.query("INSERT INTO event_videos(id,event_id,round_number,name,url,created_at,group_name) VALUES ('unrelated',?,1,'Video','https://example.test/other','2026-01-01','進攻一')", [other.id]);
    const first = await repo.listEventVideos(event.id);
    assert.equal(first.videos.length, 20);
    assert.equal(first.total, 206);
    const second = await repo.listEventVideos(event.id, { page: 2 });
    assert.equal(new Set([...first.videos, ...second.videos].map(v => v.id)).size, 40);
    assert.equal(first.videos[0].id, 'legacy');
    assert.equal((await repo.listEventVideos(event.id, { group: '防守團' })).total, 1);
    const literal = await repo.listEventVideos(event.id, { search: '%_match' });
    assert.deepEqual(literal.videos.map(v => v.id), ['v204']);
    assert.equal((await repo.listEventVideos(event.id, { group: '防守團', search: '%_' })).total, 0);
    assert.equal((await repo.listEventVideos(event.id, { videoId: 'v204' })).videos[0].id, 'v204');
    assert.equal((await repo.listEventVideos(event.id, { videoId: 'unrelated' })).total, 0);
    for (const input of [{ page: 0 }, { limit: 201 }, { page: 1.5 }, { search: [] }, { group: 'wrong' }])
      await assert.rejects(repo.listEventVideos(event.id, input), { code: 'VIDEO_INVALID' });
    const transaction = db.transaction.bind(db), reads = [];
    db.transaction = (work, options) => transaction(connection => work({ ...connection, async query(sql, args) {
      const result = await connection.query(sql, args);
      reads.push({ sql, args, rows: Array.isArray(result) ? result.length : 0 });
      return result;
    } }), options);
    await repo.listEventVideos(event.id, { page: 2, search: 'video' });
    const pageRead = reads.find(r => r.sql.includes('LIMIT ? OFFSET ?'));
    assert.equal(pageRead.rows, 20);
    assert.deepEqual(pageRead.args.slice(-2), [20, 20]);
    assert.ok(pageRead.args.filter(arg => arg === event.id).length === 2);
    server = createApp(repo).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const authed = await authenticatedFetch(server, repo), paths = [];
    const client = createEventVideoClient({ fetchImpl: (path, init) => { paths.push(path); return authed(base + path, init); } });
    const all = await client.getAllVideos(event.id, { group: '進攻一' });
    assert.equal(all.length, 205);
    assert.equal(paths.length, 2);
    assert.ok(paths.every(path => path.includes('limit=200')));
    assert.equal((await client.getBrowser(event.id)).selected.videos.length, 20);
    assert.equal((await authed(`${base}/api/events/${event.id}/videos?limit=201`)).status, 422);
    assert.equal((await fetch(`${base}/api/events/${event.id}/videos`)).status, 200);
    await repo.deleteEvent(event.id, 1);
    await assert.rejects(client.getVideos(event.id), { code: 'EVENT_UNAVAILABLE' });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await repo.close();
  }
});
