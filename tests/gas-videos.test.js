import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { createEventVideoClient } from '../src/api/event-videos.js';
import { setGasSession } from '../src/api/gas.js';

async function setup() {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const context = cloudSession(admin);
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  call('createManager', [{ username: 'manager', password: 'manager-password-123' }]);
  const member = cloudResult(env.raw('loginMember', [{ password: 'Member123' }]));
  const manager = cloudResult(
    env.raw('login', [{ username: 'manager', password: 'manager-password-123' }]),
  );
  const events = ['scrimmage', 'guild_war', 'dragon_tiger'].map((type) => {
    const result = call('createEvent', [
      { title: type, type, dates: ['2026-10-24'], requestId: type },
    ]);
    return result.event || result.events[0];
  });
  const input = (event, extra = {}) => ({
    name: '空城',
    firstUrl: 'https://youtu.be/first',
    secondUrl: 'https://www.youtube.com/watch?v=second',
    groupName: '進攻一',
    note: '第一行\n第二行',
    eventRevision: event.revision,
    requestId: crypto.randomUUID(),
    ...extra,
  });
  return {
    env,
    admin,
    context,
    member: cloudSession(member),
    manager: cloudSession(manager),
    events,
    input,
    call,
  };
}

const error = (result, code) => {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
};

test('GAS videos support paired URLs/notes with no URL global, repeated names and safe retries', async () => {
  const f = await setup();
  assert.equal(f.env.sandbox.URL, undefined);
  assert.ok(f.env.sheets.has('GM_videos'));
  const event = f.events[0];
  const input = f.input(event);
  const saved = cloudResult(f.env.raw('submitEventVideo', [event.id, input]));
  assert.equal(saved.video.firstUrl, input.firstUrl);
  assert.equal(saved.video.secondUrl, input.secondUrl);
  assert.equal(saved.video.note, input.note);
  assert.deepEqual(cloudResult(f.env.raw('submitEventVideo', [event.id, input])), saved);
  const again = cloudResult(
    f.env.raw('submitEventVideo', [event.id, { ...input, requestId: crypto.randomUUID() }]),
  );
  assert.notEqual(again.video.id, saved.video.id);
  error(
    f.env.raw('submitEventVideo', [event.id, { ...input, note: '不同備註' }]),
    'REQUEST_CONFLICT',
  );
  error(f.env.raw('submitEventVideo', [f.events[1].id, input], f.context), 'REQUEST_CONFLICT');
  assert.equal(f.call('getEventVideos', [event.id]).videos.length, 2);
  for (const other of f.events.slice(1)) {
    const row = f.call('submitEventVideo', [
      other.id,
      f.input(other, {
        firstUrl: '',
        secondUrl: 'https://example.com/second',
        groupName: '防守團',
      }),
    ]);
    assert.equal(row.video.firstUrl, '');
    assert.equal(f.call('getEventVideos', [other.id]).videos.length, 1);
  }
  assert.equal(f.env.files.size, 0);
});

test('GAS role checks restrict viewing to admin/manager, allow member submissions and enforce CSRF', async () => {
  const f = await setup();
  for (const event of f.events) {
    error(f.env.raw('getEventVideos', [event.id]), 'AUTH_REQUIRED');
    error(f.env.raw('getEventVideos', [event.id], f.member), 'MANAGEMENT_REQUIRED');
    for (const context of [f.context, f.manager, f.member]) {
      error(
        f.env.raw('submitEventVideo', [event.id, f.input(event)], {
          ...context,
          csrfToken: 'wrong',
        }),
        'CSRF_INVALID',
      );
      assert.equal(
        cloudResult(f.env.raw('submitEventVideo', [event.id, f.input(event)], context)).video.name,
        '空城',
      );
    }
    for (const context of [f.context, f.manager])
      assert.equal(cloudResult(f.env.raw('getEventVideos', [event.id], context)).videos.length, 3);
  }
  for (const event of f.events.slice(1))
    error(f.env.raw('submitEventVideo', [event.id, f.input(event)]), 'AUTH_REQUIRED');
  cloudResult(f.env.raw('logout', [], f.member));
  error(
    f.env.raw('submitEventVideo', [f.events[1].id, f.input(f.events[1])], f.member),
    'AUTH_REQUIRED',
  );
  error(f.env.rpc('ensureTable', ['videos'], f.context), 'OPERATION_INVALID');
});

test('GAS URL validation, stale/deleted/activity events and incomplete writes preserve committed data', async () => {
  const f = await setup(),
    event = f.events[0];
  for (const extra of [
    { firstUrl: '', secondUrl: '' },
    { firstUrl: 'javascript:alert(1)' },
    { secondUrl: 'https://user:password@example.com/' },
    { groupName: '' },
    { note: 'x'.repeat(501) },
    { firstUrl: 'https://example.com:99999/v' },
    { firstUrl: 'https://example.com\\evil/v' },
  ])
    error(f.env.raw('submitEventVideo', [event.id, f.input(event, extra)]), 'VIDEO_INVALID');
  const activity = f.call('createEvent', [
    { type: 'activity', title: '活動', dates: ['2026-10-24'], requestId: 'activity' },
  ]).event;
  error(
    f.env.raw('submitEventVideo', [activity.id, f.input(activity)], f.context),
    'EVENT_INVALID',
  );
  const changed = f.call('updateEvent', [event.id, { ...event, title: '新場次' }]).event;
  error(f.env.raw('submitEventVideo', [event.id, f.input(event)]), 'EVENT_CHANGED');
  for (const table of ['GM_videos', 'GM_requests', 'GM_commits']) {
    const input = f.input(changed);
    f.env.failOn(table);
    error(f.env.raw('submitEventVideo', [event.id, input]), 'GAS_ERROR');
    f.env.failOn(null);
    assert.equal(f.call('getEventVideos', [event.id]).videos.length, 0);
    const saved = cloudResult(f.env.raw('submitEventVideo', [event.id, input]));
    assert.deepEqual(cloudResult(f.env.raw('submitEventVideo', [event.id, input])), saved);
    // Use another event for each failure so its visible baseline stays empty.
    f.call('deleteEvent', [event.id, changed.revision]);
    if (table !== 'GM_commits') {
      const next = f.call('createEvent', [
        { type: 'scrimmage', title: table, dates: ['2026-10-24'], requestId: table },
      ]).event;
      Object.assign(event, next);
      Object.assign(changed, next);
    }
  }
  error(f.env.raw('submitEventVideo', [event.id, f.input(changed)]), 'EVENT_NOT_FOUND');
});

test('GAS videos lazily add the missing sheet on older installations and adapter uses RPC only', async () => {
  const f = await setup(),
    event = f.events[0];
  f.env.sheets.delete('GM_videos');
  const before = f.env.sheets.get('GM_members').data.map((row) => [...row]);
  error(f.env.raw('getEventVideos', [event.id], f.member), 'MANAGEMENT_REQUIRED');
  assert.equal(f.env.sheets.has('GM_videos'), false);
  assert.equal(f.call('getEventVideos', [event.id]).videos.length, 0);
  assert.deepEqual(f.env.sheets.get('GM_members').data, before);
  let success, failure;
  const googleRun = {
    withSuccessHandler(fn) {
      success = fn;
      return this;
    },
    withFailureHandler(fn) {
      failure = fn;
      return this;
    },
    getEventVideos(...args) {
      success(f.env.raw('getEventVideos', args.slice(0, 1), args[1]));
    },
    submitEventVideo(...args) {
      success(f.env.raw('submitEventVideo', args.slice(0, 2), args[2]));
    },
  };
  setGasSession({ ...f.admin });
  const client = createEventVideoClient({
    source: 'gas',
    googleRun,
    fetchImpl: () => assert.fail('HTTP must not be used'),
  });
  const saved = await client.submitVideo(event.id, f.input(event));
  assert.equal((await client.getVideos(event.id)).videos[0].id, saved.video.id);
  googleRun.getEventVideos = () => failure({ message: '模擬失敗' });
  await assert.rejects(client.getVideos(event.id), /模擬失敗/);
  setGasSession({ user: null });
});
