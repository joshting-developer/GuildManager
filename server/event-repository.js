import { randomUUID } from 'node:crypto';

export class EventError extends Error {
  constructor(message, fields = {}, status = 422, code = 'VALIDATION_ERROR') {
    super(message);
    Object.assign(this, { fields, status, code });
  }
}

export function validateEvent(input) {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fields = {};
  const title = typeof values.title === 'string' ? values.title.trim() : '';
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title))
    fields.title = '請填寫 1–120 字的安排名稱';
  if (!['activity', 'scrimmage'].includes(values.type)) fields.type = '請選擇活動或約戰';
  const dates = values.dates;
  if (!Array.isArray(dates) || !dates.length || dates.length > 366) {
    fields.dates = '請選擇 1–366 個日期';
  } else {
    for (const date of dates) {
      if (typeof date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) {
        fields.dates = '日期格式必須為 YYYY-MM-DD';
        break;
      }
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        fields.dates = '請選擇有效的日曆日期';
        break;
      }
    }
    if (new Set(dates).size !== dates.length) fields.dates = '日期不可重複';
    if (values.type === 'scrimmage' && dates.length !== 1) fields.dates = '約戰只能選擇一天';
  }
  if (typeof values.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(values.requestId))
    fields.requestId = '提交識別資料不正確，請重新開啟建立表單';
  if (Object.keys(fields).length) throw new EventError('請修正安排資料後再儲存', fields);
  return { title, type: values.type, dates: [...dates].sort(), requestId: values.requestId };
}

export function createEventRepository(db) {
  // Keep legacy demo events untouched; only this schema stores user-created arrangements.
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('activity', 'scrimmage')),
      request_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_dates (
      event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      date TEXT NOT NULL,
      PRIMARY KEY (event_id, date)
    );
    CREATE INDEX IF NOT EXISTS event_dates_by_date ON event_dates(date);
  `);
  function getEvent(id) {
    const event = db
      .prepare('SELECT id, title, type, created_at AS createdAt FROM scheduled_events WHERE id = ?')
      .get(id);
    if (!event) return null;
    event.dates = db
      .prepare('SELECT date FROM event_dates WHERE event_id = ? ORDER BY date')
      .all(id)
      .map((row) => row.date);
    return event;
  }
  return {
    listEvents() {
      const rows = db
        .prepare(
          `SELECT e.id, e.title, e.type, e.created_at AS createdAt, d.date
        FROM scheduled_events e JOIN event_dates d ON d.event_id = e.id
        ORDER BY d.date, e.created_at, e.id`,
        )
        .all();
      const events = new Map();
      for (const { date, ...event } of rows) {
        if (!events.has(event.id)) events.set(event.id, { ...event, dates: [] });
        events.get(event.id).dates.push(date);
      }
      return { events: [...events.values()] };
    },
    createEvent(input) {
      const values = validateEvent(input);
      return db.transaction(() => {
        const prior = db
          .prepare('SELECT id FROM scheduled_events WHERE request_id = ?')
          .get(values.requestId);
        if (prior) {
          const event = getEvent(prior.id);
          if (
            event.title !== values.title ||
            event.type !== values.type ||
            JSON.stringify(event.dates) !== JSON.stringify(values.dates)
          )
            throw new EventError(
              '上次提交已儲存，請重新載入清單後再建立其他安排',
              {},
              409,
              'REQUEST_CONFLICT',
            );
          return event;
        }
        const id = randomUUID();
        db.prepare(
          'INSERT INTO scheduled_events (id, title, type, request_id, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(id, values.title, values.type, values.requestId, new Date().toISOString());
        const insertDate = db.prepare('INSERT INTO event_dates (event_id, date) VALUES (?, ?)');
        for (const date of values.dates) insertDate.run(id, date);
        return getEvent(id);
      })();
    },
  };
}
