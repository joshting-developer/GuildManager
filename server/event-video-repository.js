import { randomUUID } from 'node:crypto';
import { EventVideoError, validateVideoSubmission } from '../src/domain/event-videos.js';

export function createEventVideoRepository(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_videos (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      round_number INTEGER NOT NULL CHECK(round_number IN (1, 2)),
      name TEXT NOT NULL, url TEXT NOT NULL,
      group_name TEXT NOT NULL CHECK(group_name IN ('進攻一', '進攻二', '防守團')),
      created_at TEXT NOT NULL,
      UNIQUE(event_id, round_number, name, url, group_name)
    );
    CREATE TABLE IF NOT EXISTS event_video_submissions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      name TEXT NOT NULL, first_url TEXT NOT NULL, second_url TEXT NOT NULL,
      note TEXT NOT NULL, created_at TEXT NOT NULL,
      group_name TEXT NOT NULL CHECK(group_name IN ('進攻一', '進攻二', '防守團')),
      CHECK(first_url <> '' OR second_url <> '')
    );
    CREATE INDEX IF NOT EXISTS event_video_submissions_by_event
      ON event_video_submissions(event_id, created_at);
    CREATE TABLE IF NOT EXISTS event_video_requests (
      request_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      input_json TEXT NOT NULL, result_json TEXT NOT NULL
    );
  `);
  if (
    !db.pragma('table_info(event_video_submissions)').some((column) => column.name === 'group_name')
  ) {
    // Preserve records from an earlier local preview; an unrecorded group remains unknown.
    db.exec(
      "ALTER TABLE event_video_submissions ADD COLUMN group_name TEXT CHECK(group_name IN ('進攻一', '進攻二', '防守團'))",
    );
  }
  function checkEvent(id) {
    const event = db
      .prepare('SELECT type, revision, deleted_at FROM scheduled_events WHERE id = ?')
      .get(id);
    if (
      !event ||
      event.deleted_at ||
      !['scrimmage', 'guild_war', 'dragon_tiger'].includes(event.type) ||
      db.prepare('SELECT COUNT(*) AS count FROM event_dates WHERE event_id = ?').get(id).count !== 1
    )
      throw new EventVideoError(
        '這個場次已刪除或無法使用影片功能，請重新載入行事曆',
        409,
        'EVENT_UNAVAILABLE',
      );
    return event;
  }
  const columns = `id, event_id AS eventId, name, first_url AS firstUrl,
    second_url AS secondUrl, group_name AS groupName, note, created_at AS createdAt`;
  return {
    listEventVideos(eventId) {
      const event = checkEvent(eventId);
      return {
        eventId,
        eventRevision: event.revision,
        videos: [
          ...db
            .prepare(`SELECT ${columns} FROM event_video_submissions WHERE event_id = ?`)
            .all(eventId),
          // Keep legacy links and group labels without merging separate submissions by name.
          ...db
            .prepare(
              `SELECT id, event_id AS eventId, name,
            CASE WHEN round_number = 1 THEN url ELSE '' END AS firstUrl,
            CASE WHEN round_number = 2 THEN url ELSE '' END AS secondUrl,
            '' AS note, group_name AS groupName, created_at AS createdAt
            FROM event_videos WHERE event_id = ?`,
            )
            .all(eventId),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
      };
    },
    submitEventVideo(eventId, rawInput) {
      const input = validateVideoSubmission(rawInput);
      return db.transaction(() => {
        const previous = db
          .prepare('SELECT * FROM event_video_requests WHERE request_id = ?')
          .get(input.requestId);
        const encoded = JSON.stringify(input);
        if (previous) {
          if (previous.event_id !== eventId || previous.input_json !== encoded)
            throw new EventVideoError(
              '這次提交識別碼已用於其他內容，請重新送出',
              409,
              'REQUEST_CONFLICT',
            );
          return JSON.parse(previous.result_json);
        }
        const event = checkEvent(eventId);
        if (event.revision !== input.eventRevision)
          throw new EventVideoError('場次已修改，請重新載入場次後再送出', 409, 'EVENT_CHANGED');
        // A new request always creates a submission, even for identical names and URLs.
        const id = randomUUID();
        db.prepare(
          'INSERT INTO event_video_submissions (id, event_id, name, first_url, second_url, note, created_at, group_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          eventId,
          input.name,
          input.firstUrl,
          input.secondUrl,
          input.note,
          new Date().toISOString(),
          input.groupName,
        );
        const video = db
          .prepare(`SELECT ${columns} FROM event_video_submissions WHERE id = ?`)
          .get(id);
        const result = { video };
        db.prepare('INSERT INTO event_video_requests VALUES (?, ?, ?, ?)').run(
          input.requestId,
          eventId,
          encoded,
          JSON.stringify(result),
        );
        return result;
      })();
    },
  };
}
