import { validatePlatformSettings, validatePlatformIcon, platformIconSource, PlatformSettingsError } from '../../src/domain/platform-settings.js';
import { createFileMetadataRepository } from './file-metadata.js';

export function createPlatformSettingsRepository(db) {
  const files = createFileMetadataRepository(db);
  async function getPlatformSettings() {
    const row = await db.prepare('SELECT name,revision,icon_mime_type,icon_base64,icon_file_id FROM platform_settings WHERE id=1').get();
    const iconSrc = row.icon_base64 ? platformIconSource({ mimeType: row.icon_mime_type, base64: row.icon_base64 }) : null;
    return {
      platform: { name: row.name, revision: row.revision, ...(iconSrc ? { iconSrc } : {}) },
      iconFile: row.icon_file_id ? await files.get(row.icon_file_id) : null,
    };
  }
  return {
    getPlatformSettings,
    async updatePlatformSettings(input, { assertAccess, currentIcon = null, observedFileId = null, iconFile = null } = {}) {
      return db.transaction(async () => {
        await assertAccess?.();
        await db.prepare('SELECT id FROM platform_settings WHERE id=1 FOR UPDATE').get();
        const current = await getPlatformSettings();
        if ((current.iconFile?.id || null) !== observedFileId) throw new PlatformSettingsError(409, 'STALE_SETTINGS', '平台設定已被修改，請重新載入後再儲存');
        const platform = { ...current.platform, ...(current.iconFile ? { iconSrc: currentIcon } : {}) };
        const name = validatePlatformSettings(input, platform);
        const hasIcon = Object.hasOwn(input, 'icon');
        const icon = hasIcon ? validatePlatformIcon(input.icon) : null;
        const changed = hasIcon && platformIconSource(icon) !== (platform.iconSrc || null);
        if (name !== platform.name || changed) {
          if (changed) {
            const id = icon ? await files.insert(iconFile) : null;
            await db.prepare('UPDATE platform_settings SET name=?, icon_mime_type=NULL, icon_base64=NULL, icon_file_id=?, revision=revision+1 WHERE id=1').run(name, id);
          } else {
            await db.prepare('UPDATE platform_settings SET name=?, revision=revision+1 WHERE id=1').run(name);
          }
        }
        return getPlatformSettings();
      });
    },
  };
}
