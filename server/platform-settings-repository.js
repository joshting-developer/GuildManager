import {
  DEFAULT_PLATFORM_NAME,
  validatePlatformSettings,
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
  function getPlatformSettings() {
    return {
      platform: db.prepare('SELECT name, revision FROM platform_settings WHERE id = 1').get(),
    };
  }
  return {
    getPlatformSettings,
    updatePlatformSettings(input) {
      return db.transaction(() => {
        const { platform } = getPlatformSettings();
        const name = validatePlatformSettings(input, platform);
        if (name !== platform.name) {
          db.prepare(
            'UPDATE platform_settings SET name = ?, revision = revision + 1 WHERE id = 1',
          ).run(name);
        }
        return getPlatformSettings();
      })();
    },
  };
}
