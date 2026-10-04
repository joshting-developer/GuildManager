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
    CREATE TABLE IF NOT EXISTS event_video_requests (
      request_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      input_json TEXT NOT NULL, result_json TEXT NOT NULL
    );
  `);
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
  const columns = `id, event_id AS eventId, round_number AS roundNumber,
    name, url, group_name AS groupName, created_at AS createdAt`;
  return {
    listEventVideos(eventId) {
      const event = checkEvent(eventId);
      return {
        eventId,
        eventRevision: event.revision,
        videos: db
          .prepare(
            `SELECT ${columns} FROM event_videos WHERE event_id = ? ORDER BY created_at DESC, id`,
          )
          .all(eventId),
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
        // Duplicate clicks with a new request ID still retain one identical link.
        let video = db
          .prepare(
            `SELECT ${columns} FROM event_videos WHERE event_id = ? AND round_number = ? AND name = ? AND url = ? AND group_name = ?`,
          )
          .get(eventId, input.roundNumber, input.name, input.url, input.groupName);
        if (!video) {
          const id = randomUUID();
          db.prepare('INSERT INTO event_videos VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            id,
            eventId,
            input.roundNumber,
            input.name,
            input.url,
            input.groupName,
            new Date().toISOString(),
          );
          video = db.prepare(`SELECT ${columns} FROM event_videos WHERE id = ?`).get(id);
        }
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
