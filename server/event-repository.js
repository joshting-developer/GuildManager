import { randomUUID } from 'node:crypto';
import { EventError, validateEvent } from '../src/domain/event-validation.js';
export { EventError, validateEvent } from '../src/domain/event-validation.js';

export function createEventRepository(db) {
  // Keep legacy demo events untouched; only this schema stores user-created arrangements.
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('activity', 'scrimmage', 'guild_war', 'dragon_tiger')),
      request_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_dates (
      event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      date TEXT NOT NULL,
      PRIMARY KEY (event_id, date)
    );
    CREATE INDEX IF NOT EXISTS event_dates_by_date ON event_dates(date);
    CREATE TABLE IF NOT EXISTS event_batches (
      request_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('guild_war', 'dragon_tiger')),
      dates_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_batch_items (
      batch_request_id TEXT NOT NULL REFERENCES event_batches(request_id),
      event_id TEXT NOT NULL UNIQUE REFERENCES scheduled_events(id),
      PRIMARY KEY (batch_request_id, event_id)
    );
  `);
  db.transaction(() => {
    const columns = db
      .prepare('PRAGMA table_info(scheduled_events)')
      .all()
      .map((column) => column.name);
    if (!columns.includes('revision'))
      db.exec(
        'ALTER TABLE scheduled_events ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)',
      );
    if (!columns.includes('updated_at'))
      db.exec("ALTER TABLE scheduled_events ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('deleted_at'))
      db.exec('ALTER TABLE scheduled_events ADD COLUMN deleted_at TEXT');
    db.exec("UPDATE scheduled_events SET updated_at = created_at WHERE updated_at = ''");
  })();
  const schema = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name = 'scheduled_events'")
    .get().sql;
  if (!schema.includes("'guild_war'") || !schema.includes("'dragon_tiger'")) {
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    // Rebuild only the parent table; keep date references pointing at its original name.
    // https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const objects = db
          .prepare(
            `SELECT sql FROM sqlite_schema
          WHERE tbl_name = 'scheduled_events' AND type IN ('index', 'trigger') AND sql IS NOT NULL`,
          )
          .all();
        db.exec(`
          CREATE TABLE scheduled_events_next (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('activity', 'scrimmage', 'guild_war', 'dragon_tiger')),
            request_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
            updated_at TEXT NOT NULL DEFAULT '',
            deleted_at TEXT
          );
          INSERT INTO scheduled_events_next (id, title, type, request_id, created_at, revision, updated_at, deleted_at)
            SELECT id, title, type, request_id, created_at, revision, updated_at, deleted_at FROM scheduled_events;
          DROP TABLE scheduled_events;
          ALTER TABLE scheduled_events_next RENAME TO scheduled_events;
        `);
        for (const object of objects) db.exec(object.sql);
        if (db.pragma('foreign_key_check').length)
          throw new Error('活動類型遷移的資料關聯檢查失敗');
      })();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
  }
  function checkRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new EventError('安排版本不正確，請重新載入清單後再試', { revision: '請重新載入安排' });
  }
  function conflict() {
    throw new EventError(
      '安排已被其他操作修改，請保留輸入並重新載入清單後再試',
      {},
      409,
      'REVISION_CONFLICT',
    );
  }
  function sameValues(event, values) {
    return (
      event.title === values.title &&
      event.type === values.type &&
      JSON.stringify(event.dates) === JSON.stringify(values.dates)
    );
  }
  function getEvent(id) {
    const event = db
      .prepare(
        'SELECT id, title, type, created_at AS createdAt, updated_at AS updatedAt, revision FROM scheduled_events WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id);
    if (!event) return null;
    event.dates = db
      .prepare('SELECT date FROM event_dates WHERE event_id = ? ORDER BY date')
      .all(id)
      .map((row) => row.date);
    return event;
  }
  const repository = {
    listEvents() {
      const rows = db
        .prepare(
          `SELECT e.id, e.title, e.type, e.created_at AS createdAt, e.updated_at AS updatedAt, e.revision, d.date
        FROM scheduled_events e JOIN event_dates d ON d.event_id = e.id
        WHERE e.deleted_at IS NULL
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
        if (
          db
            .prepare('SELECT request_id FROM event_batches WHERE request_id = ?')
            .get(values.requestId)
        )
          throw new EventError(
            '這次提交已用於批次建立，請重新載入清單',
            {},
            409,
            'REQUEST_CONFLICT',
          );
        const prior = db
          .prepare('SELECT id FROM scheduled_events WHERE request_id = ?')
          .get(values.requestId);
        if (prior) {
          const event = getEvent(prior.id);
          if (!event)
            throw new EventError('此安排已刪除，請重新載入清單', {}, 410, 'EVENT_DELETED');
          if (!sameValues(event, values))
            throw new EventError(
              '上次提交已儲存，請重新載入清單後再建立其他安排',
              {},
              409,
              'REQUEST_CONFLICT',
            );
          return event;
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO scheduled_events (id, title, type, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, values.title, values.type, values.requestId, now, now);
        const insertDate = db.prepare('INSERT INTO event_dates (event_id, date) VALUES (?, ?)');
        for (const date of values.dates) insertDate.run(id, date);
        return getEvent(id);
      })();
    },
    createEventBatch(input) {
      const values = validateEvent(input, { singleBattleDate: false });
      if (!['guild_war', 'dragon_tiger'].includes(values.type))
        throw new EventError('批次建立只適用於幫戰或龍虎戰', { type: '請選擇幫戰或龍虎戰' });
      return db.transaction(() => {
        const prior = db
          .prepare('SELECT * FROM event_batches WHERE request_id = ?')
          .get(values.requestId);
        if (prior) {
          if (
            prior.title !== values.title ||
            prior.type !== values.type ||
            prior.dates_json !== JSON.stringify(values.dates)
          )
            throw new EventError(
              '上次批次已儲存，請重新載入清單後再建立其他安排',
              {},
              409,
              'REQUEST_CONFLICT',
            );
          const events = db
            .prepare('SELECT event_id FROM event_batch_items WHERE batch_request_id = ?')
            .all(values.requestId)
            .map((row) => getEvent(row.event_id));
          if (events.some((event) => !event))
            throw new EventError(
              '這批安排中已有項目刪除，請重新載入清單',
              {},
              410,
              'EVENT_DELETED',
            );
          return events.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
        }
        if (
          db.prepare('SELECT id FROM scheduled_events WHERE request_id = ?').get(values.requestId)
        )
          throw new EventError(
            '這次提交已儲存其他安排，請重新載入清單',
            {},
            409,
            'REQUEST_CONFLICT',
          );
        db.prepare(
          'INSERT INTO event_batches (request_id, title, type, dates_json) VALUES (?, ?, ?, ?)',
        ).run(values.requestId, values.title, values.type, JSON.stringify(values.dates));
        const link = db.prepare(
          'INSERT INTO event_batch_items (batch_request_id, event_id) VALUES (?, ?)',
        );
        const events = values.dates.map((date) => {
          const event = repository.createEvent({
            title: values.title,
            type: values.type,
            dates: [date],
            requestId: randomUUID(),
          });
          link.run(values.requestId, event.id);
          return event;
        });
        return events;
      })();
    },
    updateEvent(id, input) {
      const values = validateEvent(input, { requireRequestId: false });
      checkRevision(input.revision);
      return db.transaction(() => {
        const current = getEvent(id);
        if (!current)
          throw new EventError(
            '找不到安排，可能已刪除，請重新載入清單',
            {},
            404,
            'EVENT_NOT_FOUND',
          );
        // A lost response can be retried without a second write if exactly this revision was saved.
        if (current.revision === input.revision + 1 && sameValues(current, values)) return current;
        if (current.revision !== input.revision) conflict();
        if (sameValues(current, values)) return current;
        db.prepare(
          'UPDATE scheduled_events SET title = ?, type = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        ).run(values.title, values.type, new Date().toISOString(), id);
        db.prepare('DELETE FROM event_dates WHERE event_id = ?').run(id);
        const insertDate = db.prepare('INSERT INTO event_dates (event_id, date) VALUES (?, ?)');
        for (const date of values.dates) insertDate.run(id, date);
        return getEvent(id);
      })();
    },
    deleteEvent(id, revision) {
      checkRevision(revision);
      return db.transaction(() => {
        const current = db
          .prepare('SELECT revision, deleted_at FROM scheduled_events WHERE id = ?')
          .get(id);
        if (!current)
          throw new EventError('找不到安排，請重新載入清單', {}, 404, 'EVENT_NOT_FOUND');
        if (current.deleted_at && current.revision === revision + 1) return { id };
        if (current.revision !== revision) conflict();
        if (current.deleted_at)
          throw new EventError('此安排已刪除，請重新載入清單', {}, 410, 'EVENT_DELETED');
        const now = new Date().toISOString();
        db.prepare(
          'UPDATE scheduled_events SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        ).run(now, now, id);
        return { id };
      })();
    },
  };
  return repository;
}
