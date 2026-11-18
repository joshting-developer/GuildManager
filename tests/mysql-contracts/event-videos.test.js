import { asyncMap } from "../../server/mysql/collections.js";
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { createEventVideoClient } from '../../src/api/event-videos.js';

const code = (value) => (error) => error.code === value;
const video = (event, extra = {}) => ({
  name: '空城',
  professionId: 3,
  firstUrl: 'https://www.youtube.com/watch?v=example',
  secondUrl: '',
  note: '',
  groupName: '進攻一',
  eventRevision: event.revision,
  requestId: crypto.randomUUID(),
  ...extra,
});
async function setup(filename = ':memory:') {
  const repo = (await createRepository({ filename }));
  const events = (await asyncMap(['scrimmage', 'guild_war', 'dragon_tiger', 'activity'], async (type) =>
    (await repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type }))));
  return { repo, events };
}

test('reject malformed links, fields, unavailable events, while title changes allow submission', async () => {
  const { repo, events } = (await setup());
  const event = events[0];
  try {
    for (const extra of [
      { firstUrl: 'javascript:alert(1)' },
      { firstUrl: 'data:text/html,test' },
      { firstUrl: 'ftp://example.com/video' },
      { firstUrl: 'youtube.com/test' },
      { firstUrl: 'https://user:secret@example.com/video' },
      { firstUrl: 'https://example.com/\nvideo' },
      { firstUrl: 'https://example.com/' + 'x'.repeat(2048) },
      { name: '' },
      { name: 'x'.repeat(65) },
      { name: '\u0000' },
      { firstUrl: '', secondUrl: '' },
      { firstUrl: '   ', secondUrl: '   ' },
      { secondUrl: 'javascript:alert(1)' },
      { firstUrl: 123 },
      { note: 'x'.repeat(501) },
      { note: '\u0000' },
      { groupName: null },
      { groupName: '進攻團' },
      { requestId: '' },
      { professionId: null },
      { professionId: '3' },
      { professionId: 999 },
    ])
      (await assert.rejects(
        async () => (await repo.submitEventVideo(event.id, video(event, extra))),
        code('VIDEO_INVALID'),
      ));
    (await assert.rejects(
      async () => (await repo.submitEventVideo(events[3].id, video(events[3]))),
      code('EVENT_UNAVAILABLE'),
    ));
    (await assert.rejects(async () => (await repo.submitEventVideo('missing', video(event))), code('EVENT_UNAVAILABLE')));
    const updated = (await repo.updateEvent(event.id, { ...event, title: '新的名稱' }));
    await repo.submitEventVideo(event.id, video(event));
    assert.equal((await repo.listEventVideos(event.id)).videos.length, 1);
    (await repo.submitEventVideo(event.id, video(updated, { name: '<script>測試</script>' })));
    (await repo.deleteEvent(event.id, updated.revision));
    (await assert.rejects(async () => (await repo.submitEventVideo(event.id, video(updated))), code('EVENT_UNAVAILABLE')));
    (await assert.rejects(async () => (await repo.listEventVideos(event.id)), code('EVENT_UNAVAILABLE')));
  } finally {
    (await repo.close());
  }
});

test('adapter rejects unsafe saved URLs and malformed replies', async () => {
  const client = createEventVideoClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        eventId: 'event',
        eventRevision: 1,
        videos: [
          { id: '1', eventId: 'event', ...video({ revision: 1 }), firstUrl: 'javascript:alert(1)' },
        ],
      }),
    }),
  });
  await assert.rejects(client.getVideos('event'), code('VIDEO_INVALID'));
  const broken = createEventVideoClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({ videos: [] }) }),
  });
  await assert.rejects(broken.getVideos('event'), /格式不正確/);
});

test('video professions are required snapshots and selected members must still match the current roster', async () => {
  const { repo, events } = (await setup());
  try {
    for (const [uid, isInGuild, isInClub] of [['guild', true, true], ['club', false, true], ['outside', false, false]])
      (await repo.addMember({ uid, name: '同名', primaryProfessionId: 1, isInGuild, isInClub }));
    const before = (await repo.listMembers());
    for (const event of events.slice(0, 3)) {
      const input = video(event, { name: '同名', memberUid: 'club', professionId: 3 });
      const saved = (await repo.submitEventVideo(event.id, input));
      assert.equal(saved.video.professionId, 3);
      assert.equal(saved.video.professionName, '碎夢');
      assert.equal(saved.video.professionColorcode, (await repo.listProfessions()).professions.find(row => row.job_id === 3).colorcode);
      assert.ok(!('memberUid' in saved.video));
      assert.deepEqual((await repo.submitEventVideo(event.id, input)), saved);
      (await assert.rejects(async () => (await repo.submitEventVideo(event.id, { ...input, professionId: 1 })), code('REQUEST_CONFLICT')));
      for (const extra of [{ memberUid: 'missing' }, { memberUid: 'outside' }, { memberUid: 'guild', name: '舊名' }])
        (await assert.rejects(async () => (await repo.submitEventVideo(event.id, video(event, { name: '同名', ...extra }))), code('VIDEO_MEMBER_CHANGED')));
    }
    assert.deepEqual((await repo.listMembers()), before);
    (await repo.updateMember('club', { name: '新名', primaryProfessionId: 1, isInGuild: false, isInClub: false, revision: 1 }));
    (await assert.rejects(async () => (await repo.submitEventVideo(events[0].id, video(events[0], { name: '新名', memberUid: 'club' }))), code('VIDEO_MEMBER_CHANGED')));
    assert.equal((await repo.listEventVideos(events[0].id)).videos[0].professionName, '碎夢');
  } finally { (await repo.close()); }
});

test('one or both round URLs are saved together and validation never partially saves a submission', async () => {
  const { repo, events } = (await setup());
  try {
    const saved = (await repo.submitEventVideo(
      events[0].id,
      video(events[0], {
        secondUrl: 'https://example.com/second',
        note: ' 第一行\n第二行 ',
      }),
    ));
    assert.equal(saved.video.firstUrl, 'https://www.youtube.com/watch?v=example');
    assert.equal(saved.video.secondUrl, 'https://example.com/second');
    assert.equal(saved.video.note, '第一行\n第二行');
    (await assert.rejects(
      async () =>
        (await repo.submitEventVideo(
          events[0].id,
          video(events[0], {
            secondUrl: 'invalid',
          }),
        )),
      code('VIDEO_INVALID'),
    ));
    assert.equal((await repo.listEventVideos(events[0].id)).videos.length, 1);
    for (const event of events.slice(0, 3)) {
      const second = (await repo.submitEventVideo(
        event.id,
        video(event, {
          firstUrl: '',
          secondUrl: 'https://example.com/second-only',
        }),
      ));
      assert.equal(second.video.firstUrl, '');
      assert.equal(second.video.secondUrl, 'https://example.com/second-only');
    }
  } finally {
    (await repo.close());
  }
});
