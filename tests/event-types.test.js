import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createEventRepository } from '../server/event-repository.js';
const base = { title: '多日戰鬥安排', dates: ['2026-10-24', '2026-10-26', '2026-11-02'] };
const oldSchema = `
  CREATE TABLE scheduled_events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('activity', 'scrimmage')),
    request_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TEXT NOT NULL DEFAULT '', deleted_at TEXT
  );
  CREATE TABLE event_dates (event_id TEXT NOT NULL REFERENCES scheduled_events(id), date TEXT NOT NULL,
    PRIMARY KEY (event_id, date));
`;
test('guild war and dragon tiger support discrete multi-day creation, editing between types, retry and single-day arrangements', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    for (const type of ['guild_war', 'dragon_tiger']) {
      const values = { ...base, type, requestId: type };
      const events = repo.createEventBatch(values);
      const event = events[0];
      assert.equal(event.type, type);
      assert.deepEqual(
        events.map((event) => event.dates[0]),
        base.dates,
      );
      assert.deepEqual(repo.createEventBatch(values), events);
      const updated = repo.updateEvent(event.id, {
        ...base,
        dates: event.dates,
        type: type === 'guild_war' ? 'dragon_tiger' : 'guild_war',
        revision: 1,
      });
      assert.equal(updated.revision, 2);
      assert.deepEqual(updated.dates, event.dates);
      const single = repo.updateEvent(event.id, {
        ...base,
        type,
        dates: ['2026-10-24'],
        revision: 2,
      });
      assert.deepEqual(single.dates, ['2026-10-24']);
    }
    assert.equal(repo.listEvents().events.length, 6);
  } finally {
    repo.close();
  }
});
test('new multi-day types enforce date limits and valid dates, while scrimmage remains single-day', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const maximum = Array.from({ length: 366 }, (_, index) =>
      new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    );
    for (const type of ['guild_war', 'dragon_tiger']) {
      const events = repo.createEventBatch({ ...base, type, dates: maximum, requestId: type });
      const event = events[0];
      assert.equal(events.length, 366);
      for (const dates of [
        [],
        [...maximum, '2027-01-02'],
        ['2026-10-24', '2026-10-24'],
        ['2026-02-29'],
      ]) {
        assert.throws(
          () => repo.createEventBatch({ ...base, type, dates, requestId: 'invalid' }),
          (error) => Boolean(error.fields.dates),
        );
        assert.throws(
          () => repo.updateEvent(event.id, { ...base, type, dates, revision: 1 }),
          (error) => Boolean(error.fields.dates),
        );
      }
      assert.throws(
        () => repo.updateEvent(event.id, { ...base, type: 'scrimmage', revision: 1 }),
        (error) => error.fields.dates === '約戰只能選擇一天',
      );
    }
    assert.throws(
      () => repo.createEvent({ ...base, type: 'unknown', requestId: 'unknown' }),
      (error) => Boolean(error.fields.type),
    );
  } finally {
    repo.close();
  }
});
test('old CHECK migration preserves all metadata, deleted rows, dates, unique IDs, indexes and triggers and survives restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-new-types-'));
  const filename = join(directory, 'test.sqlite');
  const db = new Database(filename);
  let repo;
  try {
    db.exec(oldSchema);
    db.exec(`
      INSERT INTO scheduled_events VALUES ('old', '舊活動', 'activity', 'old-request', '2026-10-01T00:00:00Z', 7, '2026-10-02T00:00:00Z', NULL);
      INSERT INTO scheduled_events VALUES ('deleted', '已刪約戰', 'scrimmage', 'deleted-request', '2026-10-01T00:00:00Z', 4, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z');
      INSERT INTO event_dates VALUES ('old', '2026-10-24'), ('old', '2026-10-26'), ('deleted', '2026-10-25');
      CREATE INDEX scheduled_type_index ON scheduled_events(type);
      CREATE TRIGGER check_title BEFORE UPDATE ON scheduled_events WHEN NEW.title = '禁止標題' BEGIN SELECT RAISE(ABORT, 'title trigger'); END;
    `);
    const rows = db.prepare('SELECT * FROM scheduled_events ORDER BY id').all();
    const dates = db.prepare('SELECT * FROM event_dates ORDER BY event_id, date').all();
    repo = createRepository({ filename });
    assert.deepEqual(db.prepare('SELECT * FROM scheduled_events ORDER BY id').all(), rows);
    assert.deepEqual(db.prepare('SELECT * FROM event_dates ORDER BY event_id, date').all(), dates);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('foreign_key_list(event_dates)')[0].table, 'scheduled_events');
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS total FROM sqlite_schema WHERE name IN ('scheduled_type_index', 'check_title')",
        )
        .get().total,
      2,
    );
    assert.throws(
      () =>
        repo.updateEvent('old', {
          ...base,
          dates: ['2026-10-24'],
          title: '禁止標題',
          type: 'guild_war',
          revision: 7,
        }),
      /title trigger/,
    );
    const saved = repo.updateEvent('old', {
      ...base,
      dates: ['2026-10-24'],
      type: 'guild_war',
      revision: 7,
    });
    assert.equal(saved.revision, 8);
    assert.equal(saved.createdAt, rows.find((row) => row.id === 'old').created_at);
    const created = repo.createEventBatch({
      ...base,
      type: 'dragon_tiger',
      requestId: 'new-request',
    })[0];
    assert.throws(
      () =>
        repo.createEvent({
          title: '已刪約戰',
          type: 'scrimmage',
          dates: ['2026-10-25'],
          requestId: 'deleted-request',
        }),
      (error) => error.code === 'EVENT_DELETED',
    );
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(
      repo.listEvents().events.find((event) => event.id === saved.id),
      saved,
    );
    assert.deepEqual(
      repo.listEvents().events.find((event) => event.id === created.id),
      created,
    );
    assert.equal(
      db.prepare('SELECT revision FROM scheduled_events WHERE id = ?').get('deleted').revision,
      4,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    repo?.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('a failed schema migration rolls back table replacement and restores enabled foreign keys', () => {
  const db = new Database(':memory:');
  try {
    db.exec(oldSchema);
    db.pragma('foreign_keys = OFF');
    db.exec(
      "INSERT INTO scheduled_events VALUES ('old', '舊活動', 'activity', 'old-request', '2026-10-01T00:00:00Z', 3, '2026-10-02T00:00:00Z', NULL); INSERT INTO event_dates VALUES ('missing', '2026-10-24');",
    );
    db.pragma('foreign_keys = ON');
    const before = db.prepare('SELECT * FROM scheduled_events').all();
    assert.throws(() => createEventRepository(db), /資料關聯檢查失敗/);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.prepare('SELECT * FROM scheduled_events').all(), before);
    assert.equal(
      db
        .prepare("SELECT sql FROM sqlite_schema WHERE name = 'scheduled_events'")
        .get()
        .sql.includes('guild_war'),
      false,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) AS total FROM sqlite_schema WHERE name = 'scheduled_events_next'")
        .get().total,
      0,
    );
    assert.throws(
      () => db.prepare('INSERT INTO event_dates VALUES (?, ?)').run('other-missing', '2026-10-25'),
      /FOREIGN KEY/,
    );
  } finally {
    db.close();
  }
});
