import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository, repositoryDatabase } from '../helpers/mysql-repository.js';

const submission = event => ({ name: '填錯天', professionId: 3, firstUrl: 'https://example.com/first',
  secondUrl: '', groupName: '防守團', note: '備註', eventRevision: event.revision, requestId: crypto.randomUUID() });
const move = (targetEventId, extra = {}) => ({ targetEventId, revision: 0, requestId: crypto.randomUUID(), ...extra });
const ids = async (repo, event) => (await repo.listEventVideos(event.id)).videos.map(video => video.id);

test('MySQL video move changes only the event, bumps revision and replays the same request', async () => {
  const repo = await createRepository();
  try {
    const wrong = await repo.createEvent({ type: 'guild_war', title: '', dates: ['2026-11-14'], requestId: 'wrong' });
    const right = await repo.createEvent({ type: 'dragon_tiger', title: '', dates: ['2026-11-15'], requestId: 'right' });
    const activity = await repo.createEvent({ type: 'activity', title: '活動', dates: ['2026-11-15'], requestId: 'activity' });
    const uploaded = submission(wrong), saved = (await repo.submitEventVideo(wrong.id, uploaded)).video;
    const keep = (await repo.submitEventVideo(wrong.id, submission(wrong))).video;
    const patch = move(right.id);
    const result = await repo.moveEventVideo(wrong.id, saved.id, patch);
    assert.equal(result.fromEventId, wrong.id);
    assert.deepEqual(result.video, { ...saved, eventId: right.id, revision: 1 });
    assert.deepEqual(await ids(repo, wrong), [keep.id]);
    assert.deepEqual((await repo.listEventVideos(right.id)).videos, [result.video]);
    assert.deepEqual(await repo.moveEventVideo(wrong.id, saved.id, patch), result);
    assert.deepEqual((await repo.submitEventVideo(wrong.id, uploaded)).video, saved); // Upload receipt does not recreate it.
    assert.deepEqual(await ids(repo, wrong), [keep.id]);
    await assert.rejects(repo.moveEventVideo(wrong.id, saved.id, { ...patch, targetEventId: activity.id }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(repo.moveEventVideo(wrong.id, saved.id, move(right.id, { revision: 1 })), { code: 'VIDEO_NOT_FOUND' });
    await assert.rejects(repo.moveEventVideo(right.id, saved.id, move(wrong.id)), { code: 'REVISION_CONFLICT' });
    await assert.rejects(repo.moveEventVideo(right.id, saved.id, move(activity.id, { revision: 1 })), { code: 'TARGET_UNAVAILABLE' });
    await assert.rejects(repo.moveEventVideo(right.id, saved.id, move('missing', { revision: 1 })), { code: 'TARGET_UNAVAILABLE' });
    for (const bad of [{ targetEventId: right.id }, { targetEventId: '' }, { targetEventId: 5 }, { revision: -1 },
      { requestId: 'bad:id' }, { name: 'not editable' }])
      await assert.rejects(repo.moveEventVideo(right.id, saved.id, move(wrong.id, { revision: 1, ...bad })), { code: 'VIDEO_INVALID' });
    const back = (await repo.moveEventVideo(right.id, saved.id, move(wrong.id, { revision: 1 }))).video;
    assert.equal(back.revision, 2);
    const fixed = (await repo.updateEventVideoProfession(wrong.id, saved.id, { professionId: 4, revision: 2, requestId: crypto.randomUUID() })).video;
    assert.equal(fixed.revision, 3);
    await repo.deleteEvent(right.id, right.revision);
    await assert.rejects(repo.moveEventVideo(wrong.id, saved.id, move(right.id, { revision: 3 })), { code: 'TARGET_UNAVAILABLE' });
  } finally { await repo.close(); }
});

test('MySQL video delete checks revision, removes only that row and rejects repeats', async () => {
  const repo = await createRepository();
  try {
    const event = await repo.createEvent({ type: 'scrimmage', title: '刪除', dates: ['2026-11-16'], requestId: 'delete' });
    const other = await repo.createEvent({ type: 'scrimmage', title: '其他', dates: ['2026-11-17'], requestId: 'other' });
    const first = (await repo.submitEventVideo(event.id, submission(event))).video;
    const second = (await repo.submitEventVideo(event.id, submission(event))).video;
    await assert.rejects(repo.deleteEventVideo(other.id, first.id, { revision: 0 }), { code: 'VIDEO_NOT_FOUND' });
    await assert.rejects(repo.deleteEventVideo(event.id, first.id, { revision: 1 }), { code: 'REVISION_CONFLICT' });
    for (const bad of [{}, { revision: '0' }, { revision: 0, requestId: 'x' }, null])
      await assert.rejects(repo.deleteEventVideo(event.id, first.id, bad), { code: 'VIDEO_INVALID' });
    assert.deepEqual(await repo.deleteEventVideo(event.id, first.id, { revision: 0 }), { eventId: event.id, videoId: first.id, deleted: true });
    assert.deepEqual(await ids(repo, event), [second.id]);
    await assert.rejects(repo.deleteEventVideo(event.id, first.id, { revision: 0 }), { code: 'VIDEO_NOT_FOUND' });
    await repo.deleteEvent(event.id, event.revision);
    await assert.rejects(repo.deleteEventVideo(event.id, second.id, { revision: 0 }), { code: 'EVENT_UNAVAILABLE' });
  } finally { await repo.close(); }
});

test('MySQL legacy videos can be moved or deleted together with their profession correction', async () => {
  const repo = await createRepository(), database = repositoryDatabase(repo);
  try {
    const wrong = await repo.createEvent({ type: 'scrimmage', title: 'wrong', dates: ['2026-11-16'], requestId: 'legacy-wrong' });
    const right = await repo.createEvent({ type: 'scrimmage', title: 'right', dates: ['2026-11-17'], requestId: 'legacy-right' });
    const insert = (id, eventId, url) => database.query('INSERT INTO event_videos(id,event_id,round_number,name,url,group_name,created_at) VALUES(?,?,?,?,?,?,?)',
      [id, eventId, 1, 'old', url, '防守團', '2026-11-16T00:00:00Z']);
    await insert('plain', wrong.id, 'https://example.test/plain');
    await insert('corrected', wrong.id, 'https://example.test/corrected');
    await insert('twin', wrong.id, 'https://example.test/twin');
    await insert('twin-target', right.id, 'https://example.test/twin');
    await repo.updateEventVideoProfession(wrong.id, 'corrected', { professionId: 2, revision: 0, requestId: crypto.randomUUID() });
    const plain = await repo.moveEventVideo(wrong.id, 'plain', move(right.id));
    assert.equal(plain.video.revision, 0);
    const corrected = await repo.moveEventVideo(wrong.id, 'corrected', move(right.id, { revision: 1 }));
    assert.equal(corrected.video.revision, 2);
    assert.equal(corrected.video.professionId, 2);
    await assert.rejects(repo.moveEventVideo(wrong.id, 'twin', move(right.id)), { code: 'VIDEO_DUPLICATE' });
    assert.deepEqual((await repo.listEventVideos(right.id)).videos.map(video => video.id).sort(), ['corrected', 'plain', 'twin-target']);
    await assert.rejects(repo.deleteEventVideo(right.id, 'corrected', { revision: 1 }), { code: 'REVISION_CONFLICT' });
    await repo.deleteEventVideo(right.id, 'corrected', { revision: 2 });
    await repo.deleteEventVideo(wrong.id, 'twin', { revision: 0 });
    assert.deepEqual(await database.query('SELECT video_id FROM event_video_profession_overrides'), []);
    assert.deepEqual((await database.query('SELECT id FROM event_videos ORDER BY id')).map(row => row.id), ['plain', 'twin-target']);
  } finally { await repo.close(); }
});
