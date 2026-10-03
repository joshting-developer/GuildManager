import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createRepository({ filename, seedDemo = true }) {
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

  // Only initialize a new database. Restarting never overwrites existing data.
  db.transaction(() => {
    if (db.prepare('SELECT id FROM home_settings WHERE id = 1').get()) return;
    const now = new Date();
    db.prepare('INSERT INTO home_settings VALUES (1, ?, ?, ?, ?, ?, ?)').run(
      '你的幫會',
      seedDemo ? 128 : 0,
      seedDemo ? 86 : null,
      seedDemo ? 8 : 0,
      seedDemo ? 'demo' : 'empty',
      now.toISOString(),
    );
    if (!seedDemo) return;
    const addEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const start = new Date(`${today}T20:00:00+08:00`);
    [
      [
        'event-1',
        '幫會聯賽 · 一起集結',
        'league',
        1,
        52,
        60,
        '請提前 15 分鐘集合，確認隊伍與語音頻道。',
      ],
      [
        'event-2',
        '團本活動 · 並肩闖關',
        'raid',
        3,
        10,
        12,
        '出發前確認裝備與隊伍分工，活動內容待正式設定。',
      ],
      [
        'event-3',
        '幫會聯賽 · 週末約定',
        'league',
        5,
        46,
        60,
        '名單確認後再安排隊伍，此處僅為示範活動。',
      ],
    ].forEach(([id, title, type, days, registered, capacity, note]) => {
      const startsAt = new Date(start.getTime() + days * 86400000).toISOString();
      addEvent.run(id, title, type, startsAt, registered, capacity, note);
    });
    const addNotice = db.prepare('INSERT INTO announcements VALUES (?, ?, ?, ?, ?)');
    addNotice.run(
      'notice-1',
      '這週的集結，先把時間留給彼此',
      '活動前請留意集合時間，若無法參與，記得提早告知幹部，方便安排隊伍。',
      now.toISOString(),
      1,
    );
    addNotice.run(
      'notice-2',
      '歡迎來到幫會管理平台',
      '成員、活動與出勤將集中在這裡。目前是首頁示範，正式資料與管理功能會分步接入。',
      now.toISOString(),
      0,
    );
  })();

  return {
    readHome() {
      const row = db.prepare('SELECT * FROM home_settings WHERE id = 1').get();
      const events = db
        .prepare(
          `SELECT id, title, type, starts_at AS startsAt,
        registered, capacity, note FROM events ORDER BY starts_at, id`,
        )
        .all();
      const announcements = db
        .prepare(
          `SELECT id, title, body,
        published_at AS publishedAt, pinned FROM announcements ORDER BY pinned DESC, published_at DESC, id`,
        )
        .all()
        .map((notice) => ({ ...notice, pinned: Boolean(notice.pinned) }));
      return {
        guild: { name: row.guild_name },
        summary: {
          members: row.member_count,
          upcomingEvents: events.length,
          attendanceRate: row.attendance_rate,
          pendingRegistrations: row.pending_registrations,
        },
        events,
        announcements,
        meta: { mode: row.data_mode, updatedAt: row.updated_at },
      };
    },
    close() {
      db.close();
    },
  };
}
