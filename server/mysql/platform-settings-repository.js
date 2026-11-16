import { validatePlatformSettings, validatePlatformIcon, platformIconSource } from "../../src/domain/platform-settings.js";

export function createPlatformSettingsRepository(db) {
  async function getPlatformSettings() {
    const row = (await db.prepare('SELECT * FROM platform_settings WHERE id = 1').get());
    const iconSrc = row.icon_base64
      ? platformIconSource({ mimeType: row.icon_mime_type, base64: row.icon_base64 })
      : null;
    return {
      platform: { name: row.name, revision: row.revision, ...(iconSrc ? { iconSrc } : {}) },
    };
  }
  return {
    getPlatformSettings,
    async updatePlatformSettings(input) {
      return (await db.transaction(async () => {
        const { platform } = (await getPlatformSettings());
        const name = validatePlatformSettings(input, platform);
        const hasIcon = Object.prototype.hasOwnProperty.call(input, 'icon');
        const icon = hasIcon ? validatePlatformIcon(input.icon) : null;
        if (
          name !== platform.name ||
          (hasIcon && platformIconSource(icon) !== (platform.iconSrc || null))
        ) {
          if (hasIcon) {
            (await db.prepare(
              'UPDATE platform_settings SET name = ?, icon_mime_type = ?, icon_base64 = ?, revision = revision + 1 WHERE id = 1',
            ).run(name, icon?.mimeType || null, icon?.base64 || null));
          } else {
            (await db.prepare(
              'UPDATE platform_settings SET name = ?, revision = revision + 1 WHERE id = 1',
            ).run(name));
          }
        }
        return (await getPlatformSettings());
      }));
    },
  };
}
