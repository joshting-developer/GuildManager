import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createDiscordNotifier } from '../server/discord-notifier.js';
import {
  discordMessage,
  isDiscordWebhookUrl,
  leaveNotice,
} from '../src/domain/discord-notifications.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const LEAVE_URL = 'https://discord.com/api/webhooks/123456/leave-token_A';
const MEMBER_URL = 'https://discordapp.com/api/webhooks/654321/member-token';

test('webhook URLs are limited to Discord and messages escape player-supplied markdown', () => {
  assert.ok(isDiscordWebhookUrl(LEAVE_URL));
  assert.ok(isDiscordWebhookUrl(MEMBER_URL));
  assert.ok(isDiscordWebhookUrl('https://canary.discord.com/api/webhooks/1/abc'));
  for (const url of [
    'http://discord.com/api/webhooks/1/abc',
    'https://discord.com.evil.test/api/webhooks/1/abc',
    'https://example.com/api/webhooks/1/abc',
    'https://discord.com/api/webhooks/1/abc?wait=true',
    '',
    null,
  ])
    assert.equal(isDiscordWebhookUrl(url), false, String(url));

  assert.equal(leaveNotice('none', 'leave'), 'leave');
  assert.equal(leaveNotice('registered', 'leave'), 'leave');
  assert.equal(leaveNotice('leave', 'registered'), 'reregister');
  assert.equal(leaveNotice('leave', 'none'), 'cancel');
  assert.equal(leaveNotice('none', 'registered'), null);
  assert.equal(leaveNotice('leave', 'leave'), null);

  const { channel, payload } = discordMessage(
    {
      type: 'leave',
      action: 'leave',
      event: { title: '', type: 'guild_war', date: '2026-10-24' },
      name: '**@everyone**',
      profession: '碎夢',
    },
    { footer: '測試幫會', timestamp: '2026-10-07T00:00:00.000Z' },
  );
  assert.equal(channel, 'leave');
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const [embed] = payload.embeds;
  assert.equal(embed.fields[0].value, '2026/10/24 · 幫戰');
  assert.equal(embed.fields[1].value, '**\\*\\*@everyone\\*\\***（碎夢）');
  assert.equal(embed.fields[2].value, '**已請假**');
  assert.equal(embed.footer.text, '測試幫會');
});

test('local notifier posts to configured channels, retries one 429, logs failures without the URL', async () => {
  const calls = [],
    logs = [];
  const responses = [
    { status: 429, ok: false, json: async () => ({ retry_after: 0.01 }) },
    { status: 204, ok: true },
    { status: 500, ok: false },
  ];
  const log = { warn: (text) => logs.push(text), error: (text) => logs.push(text) };
  const notifier = createDiscordNotifier({
    env: { DISCORD_WEBHOOK_LEAVE: LEAVE_URL, DISCORD_WEBHOOK_MEMBER: 'https://example.com/x' },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return responses.shift();
    },
    log,
  });
  assert.equal(notifier.enabled('leave'), true);
  assert.equal(notifier.enabled('member'), false);
  assert.match(logs[0], /DISCORD_WEBHOOK_MEMBER/);
  const leave = {
    type: 'leave',
    action: 'leave',
    event: { title: '週末幫戰', type: 'guild_war', date: '2026-10-24' },
    name: '甲',
    profession: '素問',
  };
  const member = {
    type: 'member',
    action: 'add',
    member: { uid: '1', name: '乙', primaryProfession: '龍吟', isInGuild: true, isInClub: false },
  };
  await notifier.send([leave, member, leave], { footer: '平台' });
  assert.equal(calls.length, 3, 'two leave posts (first retried) and no member post');
  assert.ok(calls.every((call) => call.url === LEAVE_URL));
  assert.equal(calls[0].body.embeds[0].footer.text, '平台');
  assert.ok(logs.some((text) => text.includes('HTTP 500')));
  assert.ok(logs.every((text) => !text.includes('leave-token')));

  const broken = createDiscordNotifier({
    env: { DISCORD_WEBHOOK_LEAVE: LEAVE_URL },
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
    log,
  });
  await broken.send([leave]);
  assert.ok(logs.some((text) => text.includes('TypeError')));
});

async function localFixture() {
  const repo = createRepository({ filename: ':memory:' });
  const sent = [];
  const notifier = { send: (notices, options) => sent.push({ notices, options }) };
  const server = createApp(repo, { notifier }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchAdmin = await authenticatedFetch(server, repo);
  const call = async (method, path, body) => {
    const response = await fetchAdmin(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const notices = () => sent.splice(0).flatMap((batch) => batch.notices);
  return { repo, server, call, notices, sent };
}

test('local writes queue notices only for real changes and never for failed or retried requests', async () => {
  const f = await localFixture();
  try {
    const person = { uid: '001', name: '甲', primaryProfessionId: 3, secondaryProfessionId: 1 };
    const added = (await f.call('POST', '/api/members', person)).data.member;
    let [notice] = f.notices();
    assert.equal(notice.type, 'member');
    assert.equal(notice.action, 'add');
    assert.equal(notice.member.primaryProfession, '碎夢');
    assert.equal(f.sent.length, 0);

    const edit = { ...person, name: '甲二', revision: added.revision };
    delete edit.uid;
    const updated = (await f.call('PATCH', '/api/members/001', edit)).data.member;
    [notice] = f.notices();
    assert.equal(notice.action, 'update');
    assert.equal(notice.previousName, '甲');
    assert.equal((await f.call('PATCH', '/api/members/001', edit)).status, 409);
    assert.equal(
      (await f.call('PATCH', '/api/members/001', { ...edit, revision: updated.revision })).status,
      200,
    );
    assert.deepEqual(f.notices(), [], 'stale and unchanged edits are silent');

    const text = 'UID Name 主職業 副職業\n002 乙 素問 -\n003 丙 龍吟 -';
    const preview = (await f.call('POST', '/api/members/import/preview', { text })).data;
    await f.call('POST', '/api/members/import', { text, fingerprint: preview.fingerprint });
    const imported = f.notices();
    assert.equal(imported.length, 1);
    assert.equal(imported[0].type, 'member-import');
    assert.deepEqual(
      imported[0].members.map((member) => member.name),
      ['乙', '丙'],
    );

    const event = (
      await f.call('POST', '/api/events', {
        title: '',
        type: 'guild_war',
        dates: ['2026-10-24'],
        requestId: 'war',
      })
    ).data.events[0];
    f.notices();
    const participation = async () =>
      (await f.call('GET', `/api/events/${event.id}/participation`)).data;
    const submit = async (name, status, requestId) =>
      f.call('POST', `/api/events/${event.id}/participation`, {
        name,
        status,
        note: '',
        professionId: 2,
        requestId,
        revision: (await participation()).revision,
      });
    await submit('甲二', 'registered', 'r1');
    assert.deepEqual(f.notices(), [], 'ordinary registration is silent');
    const leaveInput = {
      name: '甲二',
      status: 'leave',
      note: '',
      professionId: 2,
      requestId: 'r2',
      revision: (await participation()).revision,
    };
    await f.call('POST', `/api/events/${event.id}/participation`, leaveInput);
    [notice] = f.notices();
    assert.equal(notice.action, 'leave');
    assert.equal(notice.name, '甲二');
    assert.equal(notice.profession, '龍吟', 'keeps the profession chosen for this battle');
    assert.deepEqual(notice.event, { title: '', type: 'guild_war', date: '2026-10-24' });
    await f.call('POST', `/api/events/${event.id}/participation`, leaveInput);
    assert.deepEqual(f.notices(), [], 'requestId retry is silent');
    await submit('甲二', 'registered', 'r3');
    assert.equal(f.notices()[0].action, 'reregister');

    await submit('外援', 'registered', 'g1');
    assert.deepEqual(f.notices(), []);
    await submit('外援', 'leave', 'g2');
    [notice] = f.notices();
    assert.equal(notice.action, 'leave');
    assert.equal(notice.name, '外援');

    await submit('乙', 'leave', 'r4');
    f.notices();
    const attendance = (await f.call('GET', `/api/events/${event.id}/attendance`)).data;
    for (const row of attendance.leave)
      await f.call('PATCH', `/api/events/${event.id}/attendance`, {
        id: row.id,
        source: row.source,
        revision: row.revision,
      });
    assert.deepEqual(
      f
        .notices()
        .map((item) => [item.action, item.name])
        .sort(),
      [
        ['cancel', '乙'],
        ['cancel', '外援'],
      ],
    );

    const moved = (await f.call('DELETE', '/api/members/002', { revision: 1 })).data;
    assert.equal(moved.member.isInGuild, false);
    [notice] = f.notices();
    assert.equal(notice.action, 'remove');
    assert.equal(f.sent.length, 0);
  } finally {
    f.server.close();
    f.repo.close();
  }
});

test('local API hands notices to the notifier with the platform name only after success', async () => {
  const f = await localFixture();
  try {
    f.repo.addMember({ uid: '009', name: '丁', primaryProfessionId: 1 });
    f.repo.takeNotifications();
    assert.equal((await f.call('DELETE', '/api/members/009', { revision: 99 })).status, 409);
    assert.equal(f.sent.length, 0);
    await f.call('DELETE', '/api/members/009', { revision: 1 });
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].options.footer, f.repo.getPlatformSettings().platform.name);
    assert.deepEqual(
      f.sent[0].notices.map((item) => item.action),
      ['remove'],
    );
  } finally {
    f.server.close();
    f.repo.close();
  }
});

test('GAS sends committed notices after the lock, skips retries and survives webhook failures', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const context = cloudSession(admin);
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));

  call('addMember', [{ uid: '001', name: '甲', primaryProfessionId: 3 }]);
  assert.equal(env.fetches.length, 0, 'no webhook configured');

  env.propertyService.setProperty('DISCORD_WEBHOOK_LEAVE', LEAVE_URL);
  env.propertyService.setProperty('DISCORD_WEBHOOK_MEMBER', 'https://example.com/not-discord');
  call('addMember', [{ uid: '002', name: '乙', primaryProfessionId: 1 }]);
  assert.equal(env.fetches.length, 0, 'non-Discord URLs are ignored');
  env.propertyService.setProperty('DISCORD_WEBHOOK_MEMBER', MEMBER_URL);
  const member = call('addMember', [{ uid: '003', name: '丙', primaryProfessionId: 2 }]).member;
  assert.equal(env.fetches.length, 1);
  assert.equal(env.fetches[0].url, MEMBER_URL);
  const embed = JSON.parse(env.fetches[0].options.payload).embeds[0];
  assert.equal(embed.title, '➕ 幫眾名冊：新增');
  assert.equal(embed.footer.text, '逆水寒');

  const edit = { name: '丙', primaryProfessionId: 2, secondaryProfessionId: null };
  call('updateMember', ['003', { ...edit, revision: member.revision }]);
  assert.equal(env.fetches.length, 1, 'unchanged update is silent');
  assert.equal(env.raw('removeMember', ['003', 99], context).ok, false);
  assert.equal(env.fetches.length, 1, 'failed write is silent');

  const event = call('createEvent', [
    { title: '週末', type: 'guild_war', dates: ['2026-10-24'], requestId: 'war' },
  ]).events[0];
  const input = (name, status, requestId) => ({
    name,
    status,
    note: '',
    professionId: 4,
    requestId,
    revision: call('getEventParticipation', [event.id]).revision,
  });
  env.fetches.length = 0;
  const leave = input('甲', 'leave', 'leave-1');
  call('submitParticipation', [event.id, leave]);
  call('submitParticipation', [event.id, leave]);
  assert.equal(env.fetches.length, 1, 'retry with the same requestId is silent');
  const leaveEmbed = JSON.parse(env.fetches[0].options.payload).embeds[0];
  assert.equal(env.fetches[0].url, LEAVE_URL);
  assert.equal(leaveEmbed.fields[0].value, '2026/10/24 · 幫戰 · 週末');
  assert.equal(leaveEmbed.fields[1].value, '**甲**（碎夢）');

  env.fetchRespondsWith(429);
  call('submitParticipation', [event.id, input('甲', 'registered', 'back-1')]);
  assert.equal(env.fetches.length, 3, 'one retry after 429');
  assert.equal(
    JSON.parse(env.fetches[2].options.payload).embeds[0].fields[2].value,
    '**已改回報名**',
  );

  env.fetchRespondsWith('throw');
  const saved = env.raw(
    'submitParticipation',
    [event.id, input('乙', 'leave', 'leave-2')],
    context,
  );
  assert.equal(saved.ok, true, 'webhook failure does not fail the saved operation');
  const attendance = call('getEventAttendance', [event.id]);
  assert.deepEqual(
    attendance.leave.map((row) => row.name),
    ['乙'],
  );
});
