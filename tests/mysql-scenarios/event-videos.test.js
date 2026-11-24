import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
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
async function setup() {
  const repo = await createTestRepository({ });
  const events = await Promise.all(['scrimmage', 'guild_war', 'dragon_tiger', 'activity'].map(async (type) =>
    (await repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type })),
  ));
  return { repo, events };
}

test('submissions persist paired URLs/notes; repeated names create records but request retries do not', async () => {
  let { repo, events } = await setup();
  try {
    const input = video(events[0]);
    const saved = (await repo.submitEventVideo(events[0].id, input));
    assert.deepEqual((await repo.submitEventVideo(events[0].id, input)), saved);
    const repeated = (await repo.submitEventVideo(events[0].id, { ...input, requestId: 'new-click' }));
    assert.notEqual(repeated.video.id, saved.video.id);
    await assert.rejects(
      async () => (await repo.submitEventVideo(events[0].id, { ...input, name: '另一位' })),
      code('REQUEST_CONFLICT'),
    );
    await assert.rejects(async () => (await repo.submitEventVideo(events[1].id, input)), code('REQUEST_CONFLICT'));
    for (const event of events.slice(0, 3))
      (await repo.submitEventVideo(
        event.id,
        video(event, {
          firstUrl: '',
          secondUrl: 'https://example.com/second',
          groupName: '防守團',
          note: '第二場\n備註',
        }),
      ));
    assert.equal((await repo.listEventVideos(events[0].id)).videos.length, 3);
    assert.equal((await repo.listEventVideos(events[1].id)).videos.length, 1);
    assert.equal((await repo.listEventVideos(events[2].id)).videos[0].firstUrl, '');
    assert.equal(
      (await repo.listEventVideos(events[2].id)).videos[0].secondUrl,
      'https://example.com/second',
    );
    assert.equal((await repo.listEventVideos(events[2].id)).videos[0].note, '第二場\n備註');
    assert.equal((await repo.listMembers()).members.length, 0);
    repo = reopenTestRepository(repo);
    assert.deepEqual(
      (await repo.listEventVideos(events[0].id)).videos.find((row) => row.id === saved.video.id),
      saved.video,
    );
    assert.deepEqual((await repo.submitEventVideo(events[0].id, input)), saved);
  } finally {
    (await repo.close());
  }
});

test('reject malformed links, fields, unavailable events and stale versions without saving', async () => {
  const { repo, events } = await setup();
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
      await assert.rejects(
        async () => (await repo.submitEventVideo(event.id, video(event, extra))),
        code('VIDEO_INVALID'),
      );
    await assert.rejects(
      async () => (await repo.submitEventVideo(events[3].id, video(events[3]))),
      code('EVENT_UNAVAILABLE'),
    );
    await assert.rejects(async () => (await repo.submitEventVideo('missing', video(event))), code('EVENT_UNAVAILABLE'));
    assert.equal((await repo.listEventVideos(event.id)).videos.length, 0);
    const updated = (await repo.updateEvent(event.id, { ...event, title: '新的名稱' }));
    (await repo.submitEventVideo(event.id, video(updated, { name: '<script>測試</script>' })));
    (await repo.deleteEvent(event.id, updated.revision));
    await assert.rejects(async () => (await repo.submitEventVideo(event.id, video(updated))), code('EVENT_UNAVAILABLE'));
    await assert.rejects(async () => (await repo.listEventVideos(event.id)), code('EVENT_UNAVAILABLE'));
  } finally {
    (await repo.close());
  }
});

test('API allows public redacted video reads and calendar submissions, with CSRF on signed-in writes', async () => {
  const { repo, events } = await setup();
  const password = 'test-password-2026';
  const admin = await (await repo.createAccount({ username: 'admin', password }));
  await (await repo.createManager(admin.id, { username: 'manager', password }));
  await (await repo.setMemberToken(admin.id, { password: 'test123', revision: 0 }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) =>
    fetch(base + '/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (await request(`/events/${events[0].id}/videos`, 'POST', video(events[0]))).status,
      201,
    );
    for (const event of events.slice(0, 3))
      assert.equal((await request(`/events/${event.id}/videos`)).status, 200);
    assert.equal((await request(`/events/${events[3].id}/videos`)).status, 409);
    for (const event of events.slice(1, 3))
      assert.equal((await request(`/events/${event.id}/videos`, 'POST', video(event))).status, 201);
    for (const role of ['member', 'admin', 'manager']) {
      const login =
        role === 'member'
          ? await request('/auth/member-login', 'POST', { password: 'test123' })
          : await request('/auth/login', 'POST', { username: role, password });
      assert.equal(login.status, 200);
      const { csrfToken } = await login.json();
      const headers = {
        Cookie: login.headers.get('set-cookie').split(';')[0],
        'X-CSRF-Token': csrfToken,
      };
      const client = createEventVideoClient({
        fetchImpl: (path, options = {}) =>
          fetch(base + path, {
            ...options,
            headers: { ...options.headers, ...headers },
          }),
      });
      for (const event of events.slice(0, 3)) {
        assert.equal(
          (
            await request(`/events/${event.id}/videos`, 'POST', video(event), {
              Cookie: headers.Cookie,
            })
          ).status,
          403,
        );
        assert.equal(
          (await client.submitVideo(event.id, video(event, { name: role }))).video.name,
          role,
        );
        if (role === 'member')
          assert.equal((await client.getVideos(event.id)).canManage, false);
        else assert.equal((await client.getVideos(event.id)).videos.length > 0, true);
      }
      if (role === 'member')
        assert.equal((await request('/members', 'GET', undefined, headers)).status, 200);
      assert.equal(
        (await request(`/events/${events[3].id}/videos`, 'POST', video(events[3]), headers)).status,
        409,
      );
      await request('/auth/logout', 'POST', {}, headers);
      assert.equal(
        (await request(`/events/${events[1].id}/videos`, 'POST', video(events[1]), headers)).status,
        201,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
