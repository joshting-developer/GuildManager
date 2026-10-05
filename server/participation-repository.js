import { createHash, randomUUID } from 'node:crypto';
import { LINEUP_TYPES } from '../src/domain/lineups.js';
import { eventAttendance } from '../src/domain/event-attendance.js';

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
      profession_id INTEGER REFERENCES professions(job_id),
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
    CREATE TABLE IF NOT EXISTS event_participation_requests (
      request_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      input_json TEXT NOT NULL, result_json TEXT NOT NULL
    );
  `);
  if (
    !db
      .pragma('table_info(event_member_responses)')
      .some((column) => column.name === 'profession_id')
  ) {
    db.exec(
      'ALTER TABLE event_member_responses ADD COLUMN profession_id INTEGER REFERENCES professions(job_id)',
    );
  }
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
      updated_at AS updatedAt, profession_id AS professionId
      FROM event_member_responses WHERE event_id = ? AND member_uid = ?`,
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
  function participationRevision(eventId) {
    const responses = db
      .prepare(
        'SELECT member_uid, revision FROM event_member_responses WHERE event_id = ? ORDER BY member_uid',
      )
      .all(eventId);
    const registrations = db
      .prepare('SELECT id, revision FROM event_registrations WHERE event_id = ? ORDER BY id')
      .all(eventId);
    return createHash('sha256')
      .update(JSON.stringify([responses, registrations]))
      .digest('hex');
  }
  const repository = {
    getEventAttendance(eventId) {
      return eventAttendance(repository.getEventParticipation(eventId));
    },
    cancelEventLeave(eventId, input) {
      const id = text(input?.id, '人員資料', 64, true);
      revision(input?.revision);
      if (input.revision < 1) throw new ParticipationError('資料版本不正確，請重新載入');
      if (!['member', 'registration'].includes(input?.source))
        throw new ParticipationError('人員來源不正確，請重新載入');
      return db.transaction(() => {
        checkEvent(eventId);
        const changed = () => {
          throw new ParticipationError('請假資料已更新，請重新載入後再操作', 409, 'PARTICIPATION_CHANGED');
        };
        if (input.source === 'member') {
          const current = response(eventId, id);
          if (current?.status === 'none' && current.revision === input.revision + 1)
            return { eventId, cancelled: true };
          if (!current || current.status !== 'leave' || current.revision !== input.revision) changed();
          repository.saveMemberResponse(eventId, {
            uid: id, status: 'none', note: current.note, revision: input.revision,
          });
        } else {
          const current = registration(id);
          if (!current || current.eventId !== eventId) changed();
          if (current.active && current.revision === input.revision + 1)
            return { eventId, cancelled: true };
          if (
            current.active || current.revision !== input.revision ||
            !repository.getEventParticipation(eventId).registrationLeaves.some((row) => row.id === id)
          ) changed();
          db.prepare('UPDATE event_registrations SET active = 1, revision = revision + 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), id);
        }
        return { eventId, cancelled: true };
      })();
    },
    participationRequiresLogin(eventId) {
      checkEvent(eventId);
      return ['guild_war', 'dragon_tiger'].includes(
        db.prepare('SELECT type FROM scheduled_events WHERE id = ?').get(eventId).type,
      );
    },
    listEventParticipationMembers(eventId) {
      checkEvent(eventId);
      const members = db
        .prepare(
          `SELECT uid, name, primary_profession_id AS primaryProfessionId,
        secondary_profession_id AS secondaryProfessionId, is_in_guild AS isInGuild, is_in_club AS isInClub
        FROM members WHERE removed_at IS NULL AND (is_in_guild = 1 OR is_in_club = 1) ORDER BY name, uid`,
        )
        .all();
      return {
        eventId,
        members: members.map((row) => ({
          ...row,
          isInGuild: Boolean(row.isInGuild),
          isInClub: Boolean(row.isInClub),
        })),
      };
    },
    getEventParticipation(eventId) {
      checkEvent(eventId);
      return {
        eventId,
        revision: participationRevision(eventId),
        responses: db
          .prepare(
            `SELECT r.event_id AS eventId, r.member_uid AS uid, r.status, r.note, r.revision,
              r.updated_at AS updatedAt, m.name, p.job_id AS professionId, p.name AS profession, p.colorcode
            FROM event_member_responses r JOIN members m ON m.uid = r.member_uid
            JOIN professions p ON p.job_id = COALESCE(r.profession_id, m.primary_profession_id)
            WHERE r.event_id = ? ORDER BY r.member_uid`,
          )
          .all(eventId),
        registrations: db
          .prepare(
            'SELECT id FROM event_registrations WHERE event_id = ? AND active = 1 ORDER BY created_at, id',
          )
          .all(eventId)
          .map((row) => registration(row.id)),
        registrationLeaves: db
          .prepare(
            `SELECT r.id FROM event_registrations r WHERE r.event_id = ? AND r.active = 0
          AND NOT EXISTS (SELECT 1 FROM event_registrations newer
            WHERE newer.event_id = r.event_id AND newer.name = r.name COLLATE NOCASE
            AND (newer.active = 1 OR newer.created_at > r.created_at
              OR (newer.created_at = r.created_at AND newer.id > r.id)))
          ORDER BY r.updated_at, r.id`,
          )
          .all(eventId)
          .map((row) => registration(row.id)),
      };
    },
    submitParticipation(eventId, input) {
      const name = text(input?.name, '名稱', 64, true);
      const note = text(input?.note ?? '', '備註', 160);
      const status = input?.status;
      const professionId = status === 'registered' ? input?.professionId : null;
      const memberUid =
        input?.memberUid === undefined ? null : text(input.memberUid, '成員資料', 64, true);
      if (!['registered', 'leave'].includes(status))
        throw new ParticipationError('請選擇報名或請假');
      if (status === 'registered' && (!Number.isSafeInteger(professionId) || professionId < 1))
        throw new ParticipationError('請選擇職業');
      if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
        throw new ParticipationError('缺少有效的操作識別碼, 請重新操作');
      if (typeof input?.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision))
        throw new ParticipationError('資料版本不正確, 請重新載入');
      const encoded = JSON.stringify({
        name,
        note,
        status,
        professionId,
        revision: input.revision,
        ...(memberUid ? { memberUid } : {}),
      });
      return db.transaction(() => {
        const priorRequest = db
          .prepare(
            'SELECT event_id, input_json, result_json FROM event_participation_requests WHERE request_id = ?',
          )
          .get(input.requestId);
        if (priorRequest) {
          if (priorRequest.event_id === eventId && priorRequest.input_json === encoded)
            return JSON.parse(priorRequest.result_json);
          throw new ParticipationError(
            '操作識別碼已用於其他回應, 請重新操作',
            409,
            'REQUEST_CONFLICT',
          );
        }
        if (
          db.prepare('SELECT id FROM event_registrations WHERE request_id = ?').get(input.requestId)
        )
          throw new ParticipationError(
            '操作識別碼已用於其他報名, 請重新操作',
            409,
            'REQUEST_CONFLICT',
          );
        checkEvent(eventId);
        if (participationRevision(eventId) !== input.revision)
          throw new ParticipationError(
            '本場報名資料已更新, 請重新載入後再送出',
            409,
            'PARTICIPATION_CHANGED',
          );
        if (
          status === 'registered' &&
          !db.prepare('SELECT job_id FROM professions WHERE job_id = ?').get(professionId)
        )
          throw new ParticipationError('職業不存在, 請重新載入職業清單');
        const members = memberUid
          ? db
              .prepare(
                `SELECT uid FROM members WHERE uid = ? AND name = ? COLLATE NOCASE
          AND removed_at IS NULL AND (is_in_guild = 1 OR is_in_club = 1)`,
              )
              .all(memberUid, name)
          : db
              .prepare(
                `SELECT m.uid FROM members m LEFT JOIN event_member_responses r
            ON r.member_uid = m.uid AND r.event_id = ?
          WHERE m.name = ? COLLATE NOCASE AND m.removed_at IS NULL
            AND (? = 'registered' OR m.is_in_guild = 1 OR m.is_in_club = 1
              OR r.status IN ('registered', 'leave'))`,
              )
              .all(eventId, name, status);
        if (memberUid && !members.length)
          throw new ParticipationError(
            '成員資料已更新, 請重新載入名單後再選擇',
            409,
            'PARTICIPATION_MEMBER_CHANGED',
          );
        const guest = memberUid
          ? null
          : db
              .prepare(
                `SELECT id FROM event_registrations WHERE event_id = ? AND name = ? COLLATE NOCASE
          ORDER BY active DESC, created_at DESC, id DESC LIMIT 1`,
              )
              .get(eventId, name);
        if (members.length > 1 || (members.length && guest))
          throw new ParticipationError(
            '有同名資料, 無法確認人員, 請聯絡管理者',
            409,
            'PARTICIPATION_AMBIGUOUS',
          );
        if (members.length) {
          const uid = members[0].uid;
          repository.saveMemberResponse(eventId, {
            uid,
            status,
            note,
            revision: response(eventId, uid)?.revision || 0,
            ...(status === 'registered' ? { professionId } : {}),
          });
        } else if (guest) {
          db.prepare(
            `UPDATE event_registrations SET active = ?, note = ?,
              profession_id = COALESCE(?, profession_id), revision = revision + 1, updated_at = ?
            WHERE id = ?`,
          ).run(
            status === 'registered' ? 1 : 0,
            note,
            professionId,
            new Date().toISOString(),
            guest.id,
          );
        } else if (status === 'registered') {
          repository.addGuestRegistration(eventId, {
            name,
            note,
            professionId,
            requestId: input.requestId,
          });
        } else {
          throw new ParticipationError('沒有報名或沒有資料', 404, 'PARTICIPATION_NOT_FOUND');
        }
        const result = { eventId, name, status };
        db.prepare('INSERT INTO event_participation_requests VALUES (?, ?, ?, ?)').run(
          input.requestId,
          eventId,
          encoded,
          JSON.stringify(result),
        );
        return result;
      })();
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
        const professionId =
          input.professionId === undefined ? (prior?.professionId ?? null) : input.professionId;
        if (
          professionId !== null &&
          (!Number.isSafeInteger(professionId) ||
            !db.prepare('SELECT job_id FROM professions WHERE job_id = ?').get(professionId))
        )
          throw new ParticipationError('職業不存在, 請重新載入職業清單');
        if ((prior?.revision || 0) !== input.revision) {
          if (
            prior?.revision === input.revision + 1 &&
            prior.status === status &&
            prior.note === note &&
            prior.professionId === professionId
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
          `INSERT INTO event_member_responses
            (event_id, member_uid, status, note, revision, updated_at, profession_id)
            VALUES (?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(event_id, member_uid) DO UPDATE SET status = excluded.status,
          note = excluded.note, revision = event_member_responses.revision + 1,
          updated_at = excluded.updated_at, profession_id = excluded.profession_id`,
        ).run(eventId, uid, status, note, now, professionId);
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
  return repository;
}
