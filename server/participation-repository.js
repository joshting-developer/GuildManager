import { randomUUID } from 'node:crypto';
import { LINEUP_TYPES } from '../src/domain/lineups.js';

export class ParticipationError extends Error {
  constructor(message, status = 422, code = 'PARTICIPATION_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = {};
  }
}
function text(value, label, max, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    (required && !value.trim())
  ) {
    throw new ParticipationError(`${label}格式不正確，最多 ${max} 字`);
  }
  return value.trim();
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ParticipationError('資料版本不正確，請重新載入');
}
export function createParticipationRepository(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_member_responses (
      event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      member_uid TEXT NOT NULL REFERENCES members(uid),
      status TEXT NOT NULL CHECK(status IN ('registered', 'leave', 'none')),
      note TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), updated_at TEXT NOT NULL,
      PRIMARY KEY(event_id, member_uid)
    );
    CREATE TABLE IF NOT EXISTS event_registrations (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      name TEXT NOT NULL, profession_id INTEGER NOT NULL REFERENCES professions(job_id),
      note TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0, 1)),
      revision INTEGER NOT NULL CHECK(revision > 0), request_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_registration_name
      ON event_registrations(event_id, name COLLATE NOCASE) WHERE active = 1;
  `);
  function checkEvent(id) {
    const event = db.prepare('SELECT type, deleted_at FROM scheduled_events WHERE id = ?').get(id);
    if (!event || event.deleted_at || !LINEUP_TYPES.includes(event.type)) {
      throw new ParticipationError(
        '這場戰鬥已刪除或無法報名，請重新載入行事曆',
        409,
        'EVENT_UNAVAILABLE',
      );
    }
    if (
      db.prepare('SELECT COUNT(*) AS count FROM event_dates WHERE event_id = ?').get(id).count !== 1
    ) {
      throw new ParticipationError('報名／請假需要單日戰鬥場次');
    }
  }
  function response(eventId, uid) {
    return db
      .prepare(
        `SELECT event_id AS eventId, member_uid AS uid, status, note, revision,
      updated_at AS updatedAt FROM event_member_responses WHERE event_id = ? AND member_uid = ?`,
      )
      .get(eventId, uid);
  }
  function registration(id) {
    const row = db
      .prepare(
        `SELECT r.id, r.event_id AS eventId, r.name, r.profession_id AS professionId,
      p.name AS profession, p.colorcode, r.note, r.active, r.revision, r.created_at AS createdAt,
      r.updated_at AS updatedAt FROM event_registrations r JOIN professions p ON p.job_id = r.profession_id WHERE r.id = ?`,
      )
      .get(id);
    return row ? { ...row, active: Boolean(row.active) } : null;
  }
  return {
    getEventParticipation(eventId) {
      checkEvent(eventId);
      return {
        eventId,
        responses: db
          .prepare(
            'SELECT member_uid FROM event_member_responses WHERE event_id = ? ORDER BY member_uid',
          )
          .all(eventId)
          .map((row) => response(eventId, row.member_uid)),
        registrations: db
          .prepare(
            'SELECT id FROM event_registrations WHERE event_id = ? AND active = 1 ORDER BY created_at, id',
          )
          .all(eventId)
          .map((row) => registration(row.id)),
      };
    },
    saveMemberResponse(eventId, input) {
      const uid = text(input?.uid, '成員資料', 64, true);
      const note = text(input?.note ?? '', '備註', 160);
      const status = input?.status;
      if (!['registered', 'leave', 'none'].includes(status))
        throw new ParticipationError('請選擇報名、請假或取消');
      revision(input?.revision);
      return db.transaction(() => {
        checkEvent(eventId);
        if (!db.prepare('SELECT uid FROM members WHERE uid = ? AND removed_at IS NULL').get(uid)) {
          throw new ParticipationError('找不到這位成員，請重新選擇', 404, 'MEMBER_NOT_FOUND');
        }
        const prior = response(eventId, uid);
        if ((prior?.revision || 0) !== input.revision) {
          if (
            prior?.revision === input.revision + 1 &&
            prior.status === status &&
            prior.note === note
          )
            return prior;
          throw new ParticipationError(
            '這位成員的場次回應已更新，請重新載入再操作',
            409,
            'PARTICIPATION_CHANGED',
          );
        }
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO event_member_responses VALUES (?, ?, ?, ?, 1, ?)
          ON CONFLICT(event_id, member_uid) DO UPDATE SET status = excluded.status,
          note = excluded.note, revision = event_member_responses.revision + 1, updated_at = excluded.updated_at`,
        ).run(eventId, uid, status, note, now);
        return response(eventId, uid);
      })();
    },
    addGuestRegistration(eventId, input) {
      const name = text(input?.name, '名稱', 64, true);
      const note = text(input?.note ?? '', '備註', 160);
      const professionId = input?.professionId;
      const requestId = input?.requestId;
      if (!Number.isSafeInteger(professionId) || professionId < 1)
        throw new ParticipationError('請選擇職業');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId))
        throw new ParticipationError('缺少有效的操作識別碼，請重新操作');
      return db.transaction(() => {
        const priorId = db
          .prepare('SELECT id FROM event_registrations WHERE request_id = ?')
          .get(requestId)?.id;
        if (priorId) {
          const prior = registration(priorId);
          if (
            prior.eventId === eventId &&
            prior.name === name &&
            prior.note === note &&
            prior.professionId === professionId
          )
            return prior;
          throw new ParticipationError(
            '操作識別碼已用於其他報名，請重新操作',
            409,
            'REQUEST_CONFLICT',
          );
        }
        checkEvent(eventId);
        if (!db.prepare('SELECT job_id FROM professions WHERE job_id = ?').get(professionId))
          throw new ParticipationError('職業不存在，請重新載入職業清單');
        if (
          db
            .prepare(
              'SELECT id FROM event_registrations WHERE event_id = ? AND name = ? COLLATE NOCASE AND active = 1',
            )
            .get(eventId, name)
        ) {
          throw new ParticipationError(
            '本場已有同名額外報名，請確認是否已送出',
            409,
            'REGISTRATION_EXISTS',
          );
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO event_registrations VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)').run(
          id,
          eventId,
          name,
          professionId,
          note,
          requestId,
          now,
          now,
        );
        return registration(id);
      })();
    },
    cancelGuestRegistration(eventId, id, expectedRevision) {
      revision(expectedRevision);
      return db.transaction(() => {
        checkEvent(eventId);
        const prior = registration(id);
        if (!prior || prior.eventId !== eventId)
          throw new ParticipationError('找不到本場報名', 404, 'REGISTRATION_NOT_FOUND');
        if (!prior.active && prior.revision === expectedRevision + 1) return prior;
        if (!prior.active || prior.revision !== expectedRevision)
          throw new ParticipationError('報名已更新，請重新載入', 409, 'PARTICIPATION_CHANGED');
        db.prepare(
          'UPDATE event_registrations SET active = 0, revision = revision + 1, updated_at = ? WHERE id = ?',
        ).run(new Date().toISOString(), id);
        return registration(id);
      })();
    },
  };
}
