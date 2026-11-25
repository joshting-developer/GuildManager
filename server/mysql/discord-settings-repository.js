import { DISCORD_WEBHOOK_SETTINGS, isDiscordWebhookUrl } from '../../src/domain/discord-notifications.js';
import { PlatformSettingsError } from '../../src/domain/platform-settings.js';

export function createDiscordSettingsRepository(db, { env = process.env } = {}) {
  const effectiveUrl = (row) => row.url === null ? (env[DISCORD_WEBHOOK_SETTINGS[row.channel]] || '').trim() : row.url;
  async function getDiscordSettings() {
    const rows = await db.prepare('SELECT channel,url,revision FROM discord_settings ORDER BY channel').all();
    return { channels: rows.map(row => ({ channel: row.channel, revision: row.revision,
      configured: isDiscordWebhookUrl(effectiveUrl(row)) })) };
  }
  return {
    getDiscordSettings,
    async getDiscordWebhooks() {
      const rows = await db.prepare('SELECT channel,url FROM discord_settings').all();
      return Object.fromEntries(rows.map(row => [row.channel, effectiveUrl(row)]));
    },
    async saveDiscordSettings(input, { assertAccess } = {}) {
      if (!input || !Object.hasOwn(DISCORD_WEBHOOK_SETTINGS, input.channel) ||
          typeof input.url !== 'string' || (input.url.trim() && !isDiscordWebhookUrl(input.url.trim())) ||
          !Number.isSafeInteger(input.revision) || input.revision < 0) {
        throw new PlatformSettingsError(422, 'INVALID_WEBHOOK', '請輸入有效的 Discord Webhook 網址');
      }
      return db.transaction(async () => {
        await assertAccess?.();
        const current = await db.prepare('SELECT url,revision FROM discord_settings WHERE channel=? FOR UPDATE').get(input.channel);
        if (current.revision !== input.revision) throw new PlatformSettingsError(409, 'STALE_SETTINGS', '通知設定已被修改，請重新載入後再儲存');
        const url = input.url.trim();
        if (current.url !== url) await db.prepare('UPDATE discord_settings SET url=?,revision=revision+1 WHERE channel=?').run(url, input.channel);
        return getDiscordSettings();
      });
    },
  };
}
