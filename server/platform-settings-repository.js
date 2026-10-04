import {
  DEFAULT_PLATFORM_NAME,
  validatePlatformSettings,
  validatePlatformIcon,
  platformIconSource,
} from '../src/domain/platform-settings.js';

export function createPlatformSettingsRepository(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1)
  );`);
  db.prepare('INSERT OR IGNORE INTO platform_settings (id, name, revision) VALUES (1, ?, 1)').run(
    DEFAULT_PLATFORM_NAME,
  );
  const columns = db.prepare('PRAGMA table_info(platform_settings)').all();
  for (const column of ['icon_mime_type', 'icon_base64']) {
    if (!columns.some((entry) => entry.name === column))
      db.exec(`ALTER TABLE platform_settings ADD COLUMN ${column} TEXT`);
  }
  function getPlatformSettings() {
    const row = db.prepare('SELECT * FROM platform_settings WHERE id = 1').get();
    const iconSrc = row.icon_base64
      ? platformIconSource({ mimeType: row.icon_mime_type, base64: row.icon_base64 })
      : null;
    return {
      platform: { name: row.name, revision: row.revision, ...(iconSrc ? { iconSrc } : {}) },
    };
  }
  return {
    getPlatformSettings,
    updatePlatformSettings(input) {
      return db.transaction(() => {
        const { platform } = getPlatformSettings();
        const name = validatePlatformSettings(input, platform);
        const hasIcon = Object.prototype.hasOwnProperty.call(input, 'icon');
        const icon = hasIcon ? validatePlatformIcon(input.icon) : null;
        if (
          name !== platform.name ||
          (hasIcon && platformIconSource(icon) !== (platform.iconSrc || null))
        ) {
          if (hasIcon) {
            db.prepare(
              'UPDATE platform_settings SET name = ?, icon_mime_type = ?, icon_base64 = ?, revision = revision + 1 WHERE id = 1',
            ).run(name, icon?.mimeType || null, icon?.base64 || null);
          } else {
            db.prepare(
              'UPDATE platform_settings SET name = ?, revision = revision + 1 WHERE id = 1',
            ).run(name);
          }
        }
        return getPlatformSettings();
      })();
    },
  };
}
