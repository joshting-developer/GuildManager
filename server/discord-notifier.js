import {
  DISCORD_WEBHOOK_SETTINGS,
  discordMessage,
  isDiscordWebhookUrl,
} from '../src/domain/discord-notifications.js';

const MAX_RETRY_WAIT_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Delivery is best-effort after data is saved: failures are logged without the
// webhook URL (it is a credential) and never change the API response.
export function createDiscordNotifier({
  env = process.env,
  fetchImpl = fetch,
  log = console,
} = {}) {
  const webhooks = {};
  for (const [channel, key] of Object.entries(DISCORD_WEBHOOK_SETTINGS)) {
    const url = env[key]?.trim();
    if (!url) continue;
    if (isDiscordWebhookUrl(url)) webhooks[channel] = url;
    else log.warn(`${key} 不是 Discord Webhook 網址，已停用此通知`);
  }
  let queue = Promise.resolve();
  async function post(url, payload) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 429 || attempt) return response;
      let wait = 2000;
      try {
        wait = Math.ceil((await response.json()).retry_after * 1000) + 250 || wait;
      } catch {}
      await sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
    }
  }
  return {
    enabled: (channel) => Boolean(webhooks[channel]),
    send(notices, { footer } = {}) {
      const messages = notices
        .map((notice) => discordMessage(notice, { footer, timestamp: new Date().toISOString() }))
        .filter((message) => webhooks[message.channel]);
      // Sequential delivery keeps notification order and stays within Discord rate limits.
      for (const message of messages)
        queue = queue.then(async () => {
          try {
            const response = await post(webhooks[message.channel], message.payload);
            if (!response.ok) log.error(`Discord 通知失敗：HTTP ${response.status}`);
          } catch (error) {
            log.error(`Discord 通知失敗：${error.name}`);
          }
        });
      return queue;
    },
  };
}
