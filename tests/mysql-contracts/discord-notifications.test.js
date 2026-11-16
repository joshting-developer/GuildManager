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
  assert.ok(logs.some((text) => text.includes('TypeError')));
});
