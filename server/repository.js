import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createRepository({ filename }) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      guild_name TEXT NOT NULL,
      member_count INTEGER NOT NULL,
      attendance_rate INTEGER,
      pending_registrations INTEGER NOT NULL,
      data_mode TEXT NOT NULL CHECK (data_mode IN ('demo', 'empty')),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      registered INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      note TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      published_at TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Initialize settings only; never seed fictional people, events or statistics.
  db.prepare('INSERT OR IGNORE INTO home_settings VALUES (1, ?, 0, NULL, 0, ?, ?)').run(
    '你的幫會',
    'empty',
    new Date().toISOString(),
  );

  return {
    readHome() {
      const row = db.prepare('SELECT guild_name, updated_at FROM home_settings WHERE id = 1').get();
      return {
        guild: { name: row.guild_name },
        summary: {
          members: null,
          upcomingEvents: null,
          attendanceRate: null,
          pendingRegistrations: null,
        },
        events: [],
        announcements: [],
        meta: { mode: 'empty', updatedAt: row.updated_at },
      };
    },
    close() {
      db.close();
    },
  };
}
