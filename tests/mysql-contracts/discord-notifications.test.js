import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDiscordNotifier } from '../../server/discord-notifier.js';
import {
  discordMessage,
  isDiscordWebhookUrl,
  leaveNotice,
} from '../../src/domain/discord-notifications.js';

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
  assert.ok(logs.some((text) => text.includes('REQUEST_EXCEPTION')));
});

const notice = (name) => ({ type: 'member', action: 'add', member: { uid: name, name, primaryProfession: '素問', isInGuild: true } });

test('notification queue preserves order across concurrent sends and keeps working after fetch or logger failures', async () => {
  const calls = [];
  const notifier = createDiscordNotifier({
    env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL },
    log: { error() { throw new Error('synthetic secret'); } },
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, 'error');
      calls.push(JSON.parse(init.body).embeds[0].fields[0].value);
      if (calls.length === 1) throw Object.assign(new Error('synthetic secret'), { name: 'synthetic secret' });
      return { ok: true, status: 204 };
    },
  });
  notifier.send([notice('first')]);
  notifier.send([notice('second'), notice('third')]);
  await notifier.drain();
  assert.deepEqual(calls, ['**first**', '**second**', '**third**']);
});

test('429 retry waits are bounded, retry only once, and never retry other HTTP errors', async () => {
  for (const [retry_after, wait] of [[0, 250], [9999, 5000], [-1, 2000], ['invalid', 2000]]) {
    const calls = [], waits = [], logs = [];
    const notifier = createDiscordNotifier({
      env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL },
      sleepImpl: async (ms) => waits.push(ms),
      log: { error: (message) => logs.push(message) },
      fetchImpl: async (_url, init) => {
        calls.push(init.body);
        return { status: 429, ok: false, json: async () => ({ retry_after }) };
      },
    });
    await notifier.send([notice('rate-limited')]);
    assert.deepEqual(waits, [wait]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1], '429 retry uses the exact same payload');
    assert.deepEqual(logs, ['Discord 通知失敗：HTTP_ERROR HTTP 429']);
  }
  let calls = 0;
  const notifier = createDiscordNotifier({
    env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL },
    sleepImpl: async () => assert.fail('non-429 must not retry'),
    log: { error() {} },
    fetchImpl: async () => { calls++; return { status: 500, ok: false }; },
  });
  await notifier.send([notice('failed')]);
  assert.equal(calls, 1);
});

test('disabled channels and malformed notices never leak content or prevent a later valid notice', async () => {
  const logs = [], calls = [];
  const notifier = createDiscordNotifier({
    env: { DISCORD_WEBHOOK_MEMBER: MEMBER_URL, DISCORD_WEBHOOK_LEAVE: 'https://invalid.test/synthetic-secret' },
    log: { warn: (message) => logs.push(message), error: (message) => logs.push(message) },
    fetchImpl: async (_url, init) => { calls.push(init.body); return { ok: true, status: 204 }; },
  });
  assert.equal(notifier.enabled('leave'), false);
  await notifier.send([{ type: 'synthetic-secret' }, notice('valid')]);
  await notifier.drain();
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(logs).includes('synthetic-secret'), false);
  assert.deepEqual(logs, ['DISCORD_WEBHOOK_LEAVE WEBHOOK_INVALID', 'Discord 通知失敗：FORMAT_ERROR']);
});
