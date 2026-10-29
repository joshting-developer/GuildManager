import { randomUUID } from 'node:crypto';
import { EventVideoError, validateVideoSubmission, validateVideoProfessionUpdate } from '../src/domain/event-videos.js';

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
    CREATE TABLE IF NOT EXISTS event_video_profession_requests (
      request_id TEXT PRIMARY KEY, input_json TEXT NOT NULL, result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_video_profession_overrides (
      video_id TEXT PRIMARY KEY REFERENCES event_videos(id),
      profession_id INTEGER NOT NULL REFERENCES professions(job_id),
      profession_name TEXT NOT NULL, profession_colorcode TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 1)
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
  const professionColumns = {
    profession_id: 'INTEGER REFERENCES professions(job_id)',
    profession_name: 'TEXT',
    profession_colorcode: 'TEXT',
    revision: 'INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)',
  };
  for (const [column, type] of Object.entries(professionColumns)) {
    if (!db.pragma('table_info(event_video_submissions)').some((field) => field.name === column))
      db.exec(`ALTER TABLE event_video_submissions ADD COLUMN ${column} ${type}`);
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
    second_url AS secondUrl, group_name AS groupName, note, created_at AS createdAt,
    profession_id AS professionId, profession_name AS professionName, profession_colorcode AS professionColorcode, revision`;
  const legacyColumns = `v.id, v.event_id AS eventId, v.name,
    CASE WHEN v.round_number = 1 THEN v.url ELSE '' END AS firstUrl,
    CASE WHEN v.round_number = 2 THEN v.url ELSE '' END AS secondUrl,
    '' AS note, v.group_name AS groupName, v.created_at AS createdAt,
    p.profession_id AS professionId, p.profession_name AS professionName,
    p.profession_colorcode AS professionColorcode, COALESCE(p.revision, 0) AS revision`;
  const legacyFrom = 'event_videos v LEFT JOIN event_video_profession_overrides p ON p.video_id=v.id';
  return {
    updateEventVideoProfession(eventId, videoId, rawInput) {
      const input = validateVideoProfessionUpdate(eventId, videoId, rawInput);
      const encoded = JSON.stringify({ eventId, videoId, ...input });
      return db.transaction(() => {
        const previous = db.prepare('SELECT * FROM event_video_profession_requests WHERE request_id=?').get(input.requestId);
        if (previous) {
          if (previous.input_json !== encoded)
            throw new EventVideoError('這次操作識別碼已用於其他內容，請重新操作', 409, 'REQUEST_CONFLICT');
          return JSON.parse(previous.result_json);
        }
        checkEvent(eventId);
        let legacy = false;
        let current = db.prepare(`SELECT ${columns} FROM event_video_submissions WHERE id=? AND event_id=?`).get(videoId, eventId);
        if (!current) {
          legacy = true;
          current = db.prepare(`SELECT ${legacyColumns} FROM ${legacyFrom} WHERE v.id=? AND v.event_id=?`).get(videoId, eventId);
        }
        if (!current) throw new EventVideoError('找不到這筆影片，請重新載入', 404, 'VIDEO_NOT_FOUND');
        if (current.revision !== input.revision)
          throw new EventVideoError('這筆影片已更新，請重新載入後確認職業再儲存', 409, 'REVISION_CONFLICT');
        const profession = db.prepare('SELECT job_id, name, colorcode FROM professions WHERE job_id=?').get(input.professionId);
        if (!profession)
          throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '職業已失效，請重新載入' });
        if (legacy) {
          // Keep the original seven-column legacy table and link rows intact.
          db.prepare(`INSERT INTO event_video_profession_overrides VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET profession_id=excluded.profession_id,
            profession_name=excluded.profession_name, profession_colorcode=excluded.profession_colorcode, revision=excluded.revision`)
            .run(videoId, profession.job_id, profession.name, profession.colorcode, input.revision + 1);
        } else {
          db.prepare('UPDATE event_video_submissions SET profession_id=?, profession_name=?, profession_colorcode=?, revision=revision+1 WHERE id=? AND event_id=?')
            .run(profession.job_id, profession.name, profession.colorcode, videoId, eventId);
        }
        const result = { video: { ...current, professionId: profession.job_id, professionName: profession.name,
          professionColorcode: profession.colorcode, revision: input.revision + 1 } };
        db.prepare('INSERT INTO event_video_profession_requests VALUES (?, ?, ?)').run(input.requestId, encoded, JSON.stringify(result));
        return result;
      })();
    },
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
              `SELECT ${legacyColumns} FROM ${legacyFrom} WHERE v.event_id = ?`,
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
        const profession = db.prepare('SELECT job_id, name, colorcode FROM professions WHERE job_id = ?').get(input.professionId);
        if (!profession)
          throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '職業已失效，請重新載入' });
        if (input.memberUid) {
          const member = db.prepare('SELECT name, is_in_guild, is_in_club, removed_at FROM members WHERE uid = ?').get(input.memberUid);
          if (!member || member.removed_at || member.name !== input.name || !(member.is_in_guild || member.is_in_club))
            throw new EventVideoError('成員資料已更新，請重新載入後選擇成員', 409, 'VIDEO_MEMBER_CHANGED', { name: '請重新選擇成員' });
        }
        // A new request always creates a submission, even for identical names and URLs.
        const id = randomUUID();
        db.prepare(
          'INSERT INTO event_video_submissions (id, event_id, name, first_url, second_url, note, created_at, group_name, profession_id, profession_name, profession_colorcode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          eventId,
          input.name,
          input.firstUrl,
          input.secondUrl,
          input.note,
          new Date().toISOString(),
          input.groupName,
          profession.job_id,
          profession.name,
          profession.colorcode,
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
