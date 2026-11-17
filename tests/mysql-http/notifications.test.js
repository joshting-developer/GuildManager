import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, recordingNotifier } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { createDiscordNotifier } from '../../server/discord-notifier.js';

const MEMBER_URL = 'https://discord.com/api/webhooks/654321/synthetic-token';
const LEAVE_URL = 'https://discord.com/api/webhooks/123456/synthetic-token';
const person = (uid) => ({ uid, name: `成員${uid}`, primaryProfessionId: 1, isInGuild: true, isInClub: true });
const log = () => ({ entries: [], error(message) { this.entries.push(message); }, warn(message) { this.entries.push(message); } });

// The real MySQL row must be visible from a separate pool connection before fetch starts.
test('HTTP writes commit before delivery, return while Discord is waiting, and keep data after network failure', async () => {
  let database, started, finish;
  const entered = new Promise((resolve) => { started = resolve; });
  const released = new Promise((resolve) => { finish = resolve; });
  const observed = [], logger = log();
  const notifier = createDiscordNotifier({
    env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL }, log: logger,
    fetchImpl: async () => {
      observed.push(await database.query('SELECT uid, name FROM members WHERE uid=?', ['001']));
      started();
      await released;
      throw new Error('synthetic-token SQL secret');
    },
  });
  try {
    await withApp({ notifier }, async ({ admin, repository }) => {
      database = repositoryDatabase(repository);
      const { request } = await admin();
      const response = await request('/members', 'POST', person('001'));
      assert.equal(response.status, 201);
      await entered;
      assert.deepEqual(observed, [[{ uid: '001', name: '成員001' }]]);
      finish();
      await notifier.drain();
      assert.equal((await repository.listMembers()).members.length, 1);
      assert.deepEqual(logger.entries, ['Discord 通知失敗：REQUEST_EXCEPTION']);
    });
  } finally { finish(); await notifier.drain(); }
});

test('a rollback after collecting a notice sends nothing and a later successful request has only its own notice', async () => {
  const notifier = recordingNotifier();
  await withApp({ notifier, log: log(), repository: (repo) => {
    const database = repositoryDatabase(repo);
    const broken = createMysqlRepository({ ...database, transaction: (work, options) => database.transaction(async (connection) => {
      let inserted = false;
      const result = await work({ query: async (sql, parameters) => {
        const value = await connection.query(sql, parameters);
        if (sql.startsWith('INSERT INTO members')) inserted = true;
        return value;
      } });
      if (inserted) throw new Error('synthetic rollback after notification');
      return result;
    }, options) });
    return { ...repo, invoke: (name, args) => args[0]?.uid === 'failed' ? broken.invoke(name, args) : repo.invoke(name, args) };
  } }, async ({ admin, repository }) => {
    const { request } = await admin();
    assert.equal((await request('/members', 'POST', person('failed'))).status, 500);
    assert.deepEqual((await repository.listMembers()).members, []);
    assert.equal(notifier.calls.length, 0);
    const responses = await Promise.all(['001', '002'].map((uid) => request('/members', 'POST', person(uid))));
    assert.ok(responses.every((response) => response.status === 201));
    assert.equal(notifier.calls.length, 2);
    assert.deepEqual(notifier.calls.map(({ notices }) => notices.map((notice) => notice.member.uid)).sort(), [['001'], ['002']]);
  });
});

test('failed footer lookup uses the default footer and rejected send promises do not undo a committed operation', async () => {
  for (const rejectSend of [false, true]) {
    const calls = [], logger = log();
    const notifier = createDiscordNotifier({ env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL }, log: logger,
      fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 204 }; } });
    const sender = rejectSend ? { send: () => Promise.reject(new Error('synthetic-secret')) } : notifier;
    await withApp({ notifier: sender, log: logger, repository: (repo) => ({ ...repo, getPlatformSettings: async () => { throw new Error('synthetic-secret'); } }) }, async ({ admin, repository }) => {
      const { request } = await admin();
      assert.equal((await request('/members', 'POST', person('001'))).status, 201);
      await notifier.drain();
      assert.equal((await repository.listMembers()).members.length, 1);
      if (!rejectSend) {
        assert.equal(calls.length, 1);
        assert.equal(calls[0].embeds[0].footer.text, '幫會管理平台');
      }
      const events = logger.entries.map((entry) => JSON.parse(entry).event);
      assert.ok(events.includes('notification_footer_failed'));
      assert.equal(events.includes('notification_schedule_failed'), rejectSend);
      assert.equal(JSON.stringify(logger.entries).includes('synthetic-secret'), false);
    });
  }
});

test('member no-ops, ordinary registration and replayed requestId do not duplicate delivery', async () => {
  const calls = [];
  const notifier = createDiscordNotifier({ env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL, DISCORD_WEBHOOK_LEAVE: LEAVE_URL },
    fetchImpl: async (url, init) => { calls.push({ url, payload: JSON.parse(init.body) }); return { ok: true, status: 204 }; } });
  await withApp({ notifier }, async ({ admin, request: anonymous, repository }) => {
    const { request } = await admin();
    assert.equal((await request('/members', 'POST', person('001'))).status, 201);
    await notifier.drain();
    assert.equal(calls.length, 1);
    const unchanged = await request('/members/001', 'PATCH', { name: '成員001', primaryProfessionId: 1, revision: 1 });
    assert.equal(unchanged.status, 200);
    await notifier.drain();
    assert.equal(calls.length, 1);
    const event = await repository.createEvent({ type: 'scrimmage', title: '通知測試', dates: ['2099-10-24'], requestId: 'notify-event' });
    const path = `/events/${event.id}/participation`;
    const registered = await anonymous(path, 'PATCH', { uid: '001', status: 'registered', revision: 0 });
    assert.equal(registered.status, 200);
    await notifier.drain();
    assert.equal(calls.length, 1);
    const guest = await anonymous(`/events/${event.id}/registrations`, 'POST', { name: '外援', professionId: 1, requestId: 'guest-register' });
    assert.equal(guest.status, 201);
    await notifier.drain();
    assert.equal(calls.length, 1, 'ordinary guest registration does not notify');
    const participation = await repository.getEventParticipation(event.id);
    const input = { name: '外援', status: 'leave', professionId: 1, requestId: 'guest-leave', revision: participation.revision };
    const response = await anonymous(path, 'POST', input);
    assert.equal(response.status, 200);
    const saved = await response.json();
    await notifier.drain();
    assert.equal(calls.length, 2);
    const retries = await Promise.all([anonymous(path, 'POST', input), anonymous(path, 'POST', input)]);
    for (const retry of retries) { assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), saved); }
    await notifier.drain();
    assert.equal(calls.length, 2, 'same requestId replays the result without another notice');
    assert.equal(calls[1].url, LEAVE_URL);
    assert.deepEqual(calls[1].payload.allowed_mentions, { parse: [] });
    assert.equal((await anonymous(path, 'POST', { ...input, name: '不同輸入' })).status, 409);
    await notifier.drain();
    assert.equal(calls.length, 2);
  });
});
