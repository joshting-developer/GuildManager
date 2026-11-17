import { randomUUID } from 'node:crypto';
import { EventVideoError, validateVideoSubmission, validateVideoProfessionUpdate } from '../../src/domain/event-videos.js';

export function createEventVideoRepository(db) {
  async function checkEvent(id) {
    const event = (await db
      .prepare('SELECT type, revision, deleted_at FROM scheduled_events WHERE id = ?')
      .get(id));
    if (
      !event ||
      event.deleted_at ||
      !['scrimmage', 'guild_war', 'dragon_tiger'].includes(event.type) ||
      (await db.prepare('SELECT COUNT(*) AS count FROM event_dates WHERE event_id = ?').get(id)).count !== 1
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
    async updateEventVideoProfession(eventId, videoId, rawInput) {
      const input = validateVideoProfessionUpdate(eventId, videoId, rawInput);
      const encoded = JSON.stringify({ eventId, videoId, ...input });
      return (await db.transaction(async () => {
        (await db.prepare('SELECT id FROM scheduled_events WHERE id = ? FOR UPDATE').get(eventId));
        const previous = (await db.prepare('SELECT * FROM event_video_profession_requests WHERE request_id=?').get(input.requestId));
        if (previous) {
          if (previous.input_json !== encoded)
            throw new EventVideoError('這次操作識別碼已用於其他內容，請重新操作', 409, 'REQUEST_CONFLICT');
          return JSON.parse(previous.result_json);
        }
        (await checkEvent(eventId));
        let legacy = false;
        let current = (await db.prepare(`SELECT ${columns} FROM event_video_submissions WHERE id=? AND event_id=?`).get(videoId, eventId));
        if (!current) {
          legacy = true;
          current = (await db.prepare(`SELECT ${legacyColumns} FROM ${legacyFrom} WHERE v.id=? AND v.event_id=?`).get(videoId, eventId));
        }
        if (!current) throw new EventVideoError('找不到這筆影片，請重新載入', 404, 'VIDEO_NOT_FOUND');
        if (current.revision !== input.revision)
          throw new EventVideoError('這筆影片已更新，請重新載入後確認職業再儲存', 409, 'REVISION_CONFLICT');
        const profession = (await db.prepare('SELECT job_id, name, colorcode FROM professions WHERE job_id=?').get(input.professionId));
        if (!profession)
          throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '職業已失效，請重新載入' });
        if (legacy) {
          // Keep the original seven-column legacy table and link rows intact.
          (await db.prepare(`INSERT INTO event_video_profession_overrides VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE profession_id=VALUES(profession_id),
            profession_name=VALUES(profession_name), profession_colorcode=VALUES(profession_colorcode), revision=VALUES(revision)`)
            .run(videoId, profession.job_id, profession.name, profession.colorcode, input.revision + 1));
        } else {
          (await db.prepare('UPDATE event_video_submissions SET profession_id=?, profession_name=?, profession_colorcode=?, revision=revision+1 WHERE id=? AND event_id=?')
            .run(profession.job_id, profession.name, profession.colorcode, videoId, eventId));
        }
        const result = { video: { ...current, professionId: profession.job_id, professionName: profession.name,
          professionColorcode: profession.colorcode, revision: input.revision + 1 } };
        (await db.prepare('INSERT INTO event_video_profession_requests VALUES (?, ?, ?)').run(input.requestId, encoded, JSON.stringify(result)));
        return result;
      }));
    },
    async listEventVideos(eventId) {
      const event = (await checkEvent(eventId));
      return {
        eventId,
        eventRevision: event.revision,
        videos: [
          ...(await db
            .prepare(`SELECT ${columns} FROM event_video_submissions WHERE event_id = ?`)
            .all(eventId)),
          // Keep legacy links and group labels without merging separate submissions by name.
          ...(await db
            .prepare(
              `SELECT ${legacyColumns} FROM ${legacyFrom} WHERE v.event_id = ?`,
            )
            .all(eventId)),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
      };
    },
    async submitEventVideo(eventId, rawInput) {
      const input = validateVideoSubmission(rawInput);
      return (await db.transaction(async () => {
        (await db.prepare('SELECT id FROM scheduled_events WHERE id = ? FOR UPDATE').get(eventId));
        const previous = (await db
          .prepare('SELECT * FROM event_video_requests WHERE request_id = ?')
          .get(input.requestId));
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
        const event = (await checkEvent(eventId));
        if (event.revision !== input.eventRevision)
          throw new EventVideoError('場次已修改，請重新載入場次後再送出', 409, 'EVENT_CHANGED');
        const profession = (await db.prepare('SELECT job_id, name, colorcode FROM professions WHERE job_id = ?').get(input.professionId));
        if (!profession)
          throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '職業已失效，請重新載入' });
        if (input.memberUid) {
          const member = (await db.prepare('SELECT name, is_in_guild, is_in_club, removed_at FROM members WHERE uid = ?').get(input.memberUid));
          if (!member || member.removed_at || member.name !== input.name || !(member.is_in_guild || member.is_in_club))
            throw new EventVideoError('成員資料已更新，請重新載入後選擇成員', 409, 'VIDEO_MEMBER_CHANGED', { name: '請重新選擇成員' });
        }
        // A new request always creates a submission, even for identical names and URLs.
        const id = randomUUID();
        (await db.prepare(
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
        ));
        const video = (await db
          .prepare(`SELECT ${columns} FROM event_video_submissions WHERE id = ?`)
          .get(id));
        const result = { video };
        (await db.prepare('INSERT INTO event_video_requests VALUES (?, ?, ?, ?)').run(
          input.requestId,
          eventId,
          encoded,
          JSON.stringify(result),
        ));
        return result;
      }));
    },
  };
}
