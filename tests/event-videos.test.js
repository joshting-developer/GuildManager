import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventVideoClient } from '../src/api/event-videos.js';

const code = (value) => (error) => error.code === value;
const video = (event, extra = {}) => ({
  name: '空城',
  url: 'https://www.youtube.com/watch?v=example',
  groupName: '進攻一',
  roundNumber: 1,
  eventRevision: event.revision,
  requestId: crypto.randomUUID(),
  ...extra,
});
function setup(filename = ':memory:') {
  const repo = createRepository({ filename });
  const events = ['scrimmage', 'guild_war', 'dragon_tiger', 'activity'].map((type) =>
    repo.createEvent({ title: type, type, dates: ['2026-10-24'], requestId: type }),
  );
  return { repo, events };
}

test('videos persist per event/round; duplicate content and request retries do not add rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-videos-'));
  const filename = join(dir, 'test.sqlite');
  let { repo, events } = setup(filename);
  try {
    const input = video(events[0]);
    const saved = repo.submitEventVideo(events[0].id, input);
    assert.deepEqual(repo.submitEventVideo(events[0].id, input), saved);
    assert.deepEqual(
      repo.submitEventVideo(events[0].id, { ...input, requestId: 'new-click' }),
      saved,
    );
    assert.throws(
      () => repo.submitEventVideo(events[0].id, { ...input, name: '另一位' }),
      code('REQUEST_CONFLICT'),
    );
    assert.throws(() => repo.submitEventVideo(events[1].id, input), code('REQUEST_CONFLICT'));
    for (const event of events.slice(0, 3))
      repo.submitEventVideo(event.id, video(event, { roundNumber: 2, groupName: '防守團' }));
    assert.equal(repo.listEventVideos(events[0].id).videos.length, 2);
    assert.equal(repo.listEventVideos(events[1].id).videos.length, 1);
    assert.equal(repo.listEventVideos(events[2].id).videos[0].roundNumber, 2);
    assert.equal(repo.listMembers().members.length, 0);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(
      repo.listEventVideos(events[0].id).videos.find((row) => row.id === saved.video.id),
      saved.video,
    );
    assert.deepEqual(repo.submitEventVideo(events[0].id, input), saved);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reject malformed links, fields, unavailable events and stale versions without saving', () => {
  const { repo, events } = setup();
  const event = events[0];
  try {
    for (const extra of [
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,test' },
      { url: 'ftp://example.com/video' },
      { url: 'youtube.com/test' },
      { url: 'https://user:secret@example.com/video' },
      { url: 'https://example.com/\nvideo' },
      { url: 'https://example.com/' + 'x'.repeat(2048) },
      { name: '' },
      { name: 'x'.repeat(65) },
      { name: '\u0000' },
      { roundNumber: 3 },
      { roundNumber: '1' },
      { groupName: '進攻團' },
      { eventRevision: '1' },
      { requestId: '' },
    ])
      assert.throws(
        () => repo.submitEventVideo(event.id, video(event, extra)),
        code('VIDEO_INVALID'),
      );
    assert.throws(
      () => repo.submitEventVideo(events[3].id, video(events[3])),
      code('EVENT_UNAVAILABLE'),
    );
    assert.throws(() => repo.submitEventVideo('missing', video(event)), code('EVENT_UNAVAILABLE'));
    const updated = repo.updateEvent(event.id, { ...event, title: '新的名稱' });
    assert.throws(() => repo.submitEventVideo(event.id, video(event)), code('EVENT_CHANGED'));
    assert.equal(repo.listEventVideos(event.id).videos.length, 0);
    repo.submitEventVideo(event.id, video(updated, { name: '<script>測試</script>' }));
    repo.deleteEvent(event.id, updated.revision);
    assert.throws(() => repo.submitEventVideo(event.id, video(updated)), code('EVENT_UNAVAILABLE'));
    assert.throws(() => repo.listEventVideos(event.id), code('EVENT_UNAVAILABLE'));
  } finally {
    repo.close();
  }
});

test('API allows calendar submissions; only admin/manager can read videos, with CSRF on signed-in writes', async () => {
  const { repo, events } = setup();
  const password = 'test-password-2026';
  const admin = await repo.createAccount({ username: 'admin', password });
  await repo.createManager(admin.id, { username: 'manager', password });
  await repo.setMemberToken(admin.id, { password: 'test123', revision: 0 });
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
    for (const event of events)
      assert.equal((await request(`/events/${event.id}/videos`)).status, 401);
    for (const event of events.slice(1, 3))
      assert.equal((await request(`/events/${event.id}/videos`, 'POST', video(event))).status, 401);
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
          await assert.rejects(client.getVideos(event.id), code('MANAGEMENT_REQUIRED'));
        else assert.equal((await client.getVideos(event.id)).videos.length > 0, true);
      }
      if (role === 'member')
        assert.equal((await request('/members', 'GET', undefined, headers)).status, 403);
      assert.equal(
        (await request(`/events/${events[3].id}/videos`, 'POST', video(events[3]), headers)).status,
        409,
      );
      await request('/auth/logout', 'POST', {}, headers);
      assert.equal(
        (await request(`/events/${events[1].id}/videos`, 'POST', video(events[1]), headers)).status,
        401,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});

test('adapter rejects unsafe saved URLs, malformed replies and GAS calls without HTTP', async () => {
  const client = createEventVideoClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        eventId: 'event',
        eventRevision: 1,
        videos: [
          { id: '1', eventId: 'event', ...video({ revision: 1 }), url: 'javascript:alert(1)' },
        ],
      }),
    }),
  });
  await assert.rejects(client.getVideos('event'), code('VIDEO_INVALID'));
  const gas = createEventVideoClient({
    source: 'gas',
    fetchImpl: () => assert.fail('must not use HTTP'),
  });
  await assert.rejects(gas.getVideos('event'), /GAS 尚未串接/);
  await assert.rejects(gas.submitVideo('event', {}), /GAS 尚未串接/);
  const broken = createEventVideoClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({ videos: [] }) }),
  });
  await assert.rejects(broken.getVideos('event'), /格式不正確/);
});
