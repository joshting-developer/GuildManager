import {
  DISCORD_WEBHOOK_SETTINGS,
  discordMessage,
  isDiscordWebhookUrl,
} from '../src/domain/discord-notifications.js';

const MAX_RETRY_WAIT_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Delivery is best-effort after commit; unknown network outcomes are never replayed.
export function createDiscordNotifier({
  env = process.env,
  fetchImpl = fetch,
  log = console,
  sleepImpl = sleep,
} = {}) {
  function record(level, message) {
    try {
      Promise.resolve(log[level](message)).catch(() => {});
    } catch {}
  }
  const webhooks = {};
  for (const [channel, key] of Object.entries(DISCORD_WEBHOOK_SETTINGS)) {
    const url = env[key]?.trim();
    if (!url) continue;
    if (isDiscordWebhookUrl(url)) webhooks[channel] = url;
    else record('warn', `${key} WEBHOOK_INVALID`);
  }
  let queue = Promise.resolve();
  async function post(url, payload) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (response.status !== 429 || attempt) return response;
      let wait = 2000;
      try {
        const seconds = Number((await response.json()).retry_after);
        if (Number.isFinite(seconds) && seconds >= 0) wait = Math.ceil(seconds * 1000) + 250;
      } catch {}
      await sleepImpl(Math.min(wait, MAX_RETRY_WAIT_MS));
    }
  }
  return {
    enabled: (channel) => Boolean(webhooks[channel]),
    send(notices, { footer } = {}) {
      for (const notice of notices) {
        let message;
        try {
          message = discordMessage(notice, { footer, timestamp: new Date().toISOString() });
        } catch {
          record('error', 'Discord 通知失敗：FORMAT_ERROR');
          continue;
        }
        if (!webhooks[message.channel]) continue;
        // Each queue item absorbs its own failure, including failed diagnostics.
        queue = queue.then(async () => {
          try {
            const response = await post(webhooks[message.channel], message.payload);
            if (!response.ok) {
              const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;
              record('error', `Discord 通知失敗：HTTP_ERROR HTTP ${status}`);
            }
          } catch {
            record('error', 'Discord 通知失敗：REQUEST_EXCEPTION');
          }
        });
      }
      return queue;
    },
    drain: () => queue,
  };
}
