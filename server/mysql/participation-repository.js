import { asyncMap } from "./collections.js";
import { createHash, randomUUID } from 'node:crypto';
import { LINEUP_TYPES } from '../../src/domain/lineups.js';
import { eventAttendance } from '../../src/domain/event-attendance.js';
import { leaveNotice } from '../../src/domain/discord-notifications.js';
import { participationTarget, validParticipationExpectation, sameParticipationTarget } from '../../src/domain/participation-target.js';

import { ParticipationError } from '../participation-repository.js';
export { ParticipationError } from '../participation-repository.js';

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
export function createParticipationRepository(db, { notify = () => {} } = {}) {
  async function checkEvent(id) {
    const event = (await db.prepare('SELECT type, deleted_at FROM scheduled_events WHERE id = ?').get(id));
    if (!event || event.deleted_at || !LINEUP_TYPES.includes(event.type)) {
      throw new ParticipationError(
        '這場戰鬥已刪除或無法報名，請重新載入行事曆',
        409,
        'EVENT_UNAVAILABLE',
      );
    }
    if (
      (await db.prepare('SELECT COUNT(*) AS count FROM event_dates WHERE event_id = ?').get(id)).count !== 1
    ) {
      throw new ParticipationError('報名／請假需要單日戰鬥場次');
    }
  }
  async function response(eventId, uid) {
    return (await db
      .prepare(
        `SELECT event_id AS eventId, member_uid AS uid, status, note, revision,
      updated_at AS updatedAt, profession_id AS professionId
      FROM event_member_responses WHERE event_id = ? AND member_uid = ?`,
      )
      .get(eventId, uid));
  }
  async function registration(id) {
    const row = (await db
      .prepare(
        `SELECT r.id, r.event_id AS eventId, r.name, r.profession_id AS professionId,
      p.name AS profession, p.colorcode, r.note, r.active, r.revision, r.created_at AS createdAt,
      r.updated_at AS updatedAt FROM event_registrations r JOIN professions p ON p.job_id = r.profession_id WHERE r.id = ?`,
      )
      .get(id));
    return row ? { ...row, active: Boolean(row.active) } : null;
  }
  async function participationRevision(eventId) {
    const responses = (await db
      .prepare(
        'SELECT member_uid, revision FROM event_member_responses WHERE event_id = ? ORDER BY member_uid',
      )
      .all(eventId));
    const registrations = (await db
      .prepare('SELECT id, revision FROM event_registrations WHERE event_id = ? ORDER BY id')
      .all(eventId));
    return createHash('sha256')
      .update(JSON.stringify([responses, registrations]))
      .digest('hex');
  }
  // Notices are queued inside the transaction and only delivered after it commits.
  async function notifyLeave(eventId, action, person) {
    if (!action) return;
    const event = (await db
      .prepare(
        `SELECT e.title, e.type, d.date FROM scheduled_events e
        JOIN event_dates d ON d.event_id = e.id WHERE e.id = ?`,
      )
      .get(eventId));
    notify({ type: 'leave', action, event, ...person });
  }
  async function memberPerson(eventId, uid) {
    return (await db
      .prepare(
        `SELECT m.name, p.name AS profession FROM members m
        LEFT JOIN event_member_responses r ON r.member_uid = m.uid AND r.event_id = ?
        LEFT JOIN professions p ON p.job_id = COALESCE(r.profession_id, m.primary_profession_id)
        WHERE m.uid = ?`,
      )
      .get(eventId, uid));
  }
  const guestPerson = async (id) => {
    const guest = (await registration(id));
    return { name: guest.name, profession: guest.profession };
  };
  const repository = {
    async getEventAttendance(eventId) {
      return eventAttendance((await repository.getEventParticipation(eventId)));
    },
    async cancelEventLeave(eventId, input) {
      const id = text(input?.id, '人員資料', 64, true);
      revision(input?.revision);
      if (input.revision < 1) throw new ParticipationError('資料版本不正確，請重新載入');
      if (!['member', 'registration'].includes(input?.source))
        throw new ParticipationError('人員來源不正確，請重新載入');
      return (await db.transaction(async () => {
        (await checkEvent(eventId));
        const changed = () => {
          throw new ParticipationError('請假資料已更新，請重新載入後再操作', 409, 'PARTICIPATION_CHANGED');
        };
        if (input.source === 'member') {
          const current = (await response(eventId, id));
          if (current?.status === 'none' && current.revision === input.revision + 1)
            return { eventId, cancelled: true };
          if (!current || current.status !== 'leave' || current.revision !== input.revision) changed();
          (await repository.saveMemberResponse(eventId, {
            uid: id, status: 'none', note: current.note, revision: input.revision,
          }));
        } else {
          const current = (await registration(id));
          if (!current || current.eventId !== eventId) changed();
          if (current.active && current.revision === input.revision + 1)
            return { eventId, cancelled: true };
          if (
            current.active || current.revision !== input.revision ||
            !(await repository.getEventParticipation(eventId)).registrationLeaves.some((row) => row.id === id)
          ) changed();
          (await db.prepare('UPDATE event_registrations SET active = 1, revision = revision + 1, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), id));
          (await notifyLeave(eventId, 'cancel', (await guestPerson(id))));
        }
        return { eventId, cancelled: true };
      }));
    },
    async participationRequiresLogin(eventId) {
      (await checkEvent(eventId));
      return false;
    },
    async listEventParticipationMembers(eventId) {
      (await checkEvent(eventId));
      const members = (await db
        .prepare(
          `SELECT uid, name, primary_profession_id AS primaryProfessionId,
        secondary_profession_id AS secondaryProfessionId, is_in_guild AS isInGuild, is_in_club AS isInClub
        FROM members WHERE removed_at IS NULL AND (is_in_guild = 1 OR is_in_club = 1) ORDER BY name, uid`,
        )
        .all());
      return {
        eventId,
        members: members.map((row) => ({
          ...row,
          isInGuild: Boolean(row.isInGuild),
          isInClub: Boolean(row.isInClub),
        })),
      };
    },
    async getEventParticipation(eventId) {
      (await checkEvent(eventId));
      return {
        eventId,
        revision: (await participationRevision(eventId)),
        responses: (await db
          .prepare(
            `SELECT r.event_id AS eventId, r.member_uid AS uid, r.status, r.note, r.revision,
              r.updated_at AS updatedAt, m.name, p.job_id AS professionId, p.name AS profession, p.colorcode
            FROM event_member_responses r JOIN members m ON m.uid = r.member_uid
            JOIN professions p ON p.job_id = COALESCE(r.profession_id, m.primary_profession_id)
            WHERE r.event_id = ? ORDER BY r.member_uid`,
          )
          .all(eventId)),
        registrations: (await asyncMap(await db
          .prepare(
            'SELECT id FROM event_registrations WHERE event_id = ? AND active = 1 ORDER BY created_at, id',
          )
          .all(eventId), async (row) => (await registration(row.id)))),
        registrationLeaves: (await asyncMap(await db
          .prepare(
            `SELECT r.id FROM event_registrations r WHERE r.event_id = ? AND r.active = 0
          AND NOT EXISTS (SELECT 1 FROM event_registrations newer
            WHERE newer.event_id = r.event_id AND CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(newer.name, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) = CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(r.name, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY)
            AND (newer.active = 1 OR newer.created_at > r.created_at
              OR (newer.created_at = r.created_at AND newer.id > r.id)))
          ORDER BY r.updated_at, r.id`,
          )
          .all(eventId), async (row) => (await registration(row.id)))),
      };
    },
    async submitParticipation(eventId, input) {
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
      if (input.expectedParticipant !== undefined && !validParticipationExpectation(input.expectedParticipant))
        throw new ParticipationError('人員資料版本不正確，請重新載入');
      const encoded = JSON.stringify({
        name,
        note,
        status,
        professionId,
        revision: input.revision,
        ...(memberUid ? { memberUid } : {}),
        ...(input.expectedParticipant !== undefined ? { expectedParticipant: input.expectedParticipant } : {}),
      });
      return (await db.transaction(async () => {
        const priorRequest = (await db
          .prepare(
            'SELECT event_id, input_json, result_json FROM event_participation_requests WHERE request_id = ?',
          )
          .get(input.requestId));
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
          (await db.prepare('SELECT id FROM event_registrations WHERE request_id = ?').get(input.requestId))
        )
          throw new ParticipationError(
            '操作識別碼已用於其他報名, 請重新操作',
            409,
            'REQUEST_CONFLICT',
          );
        (await checkEvent(eventId));
        if (input.expectedParticipant !== undefined) {
          const event = (await db.prepare('SELECT revision FROM scheduled_events WHERE id = ?').get(eventId));
          if (event.revision !== input.expectedParticipant.eventRevision)
            throw new ParticipationError('場次已修改，請重新載入場次後再送出', 409, 'EVENT_CHANGED');
          const person = participationTarget({ name, status, memberUid }, {
            ...(await repository.getEventParticipation(eventId)),
            ...(await repository.listEventParticipationMembers(eventId)),
          });
          if (!sameParticipationTarget(person, input.expectedParticipant.person))
            throw new ParticipationError('這位人員的資料已更新，請重新載入確認後再送出', 409, 'PARTICIPATION_CHANGED');
        } else if ((await participationRevision(eventId)) !== input.revision)
          throw new ParticipationError(
            '本場報名資料已更新, 請重新載入後再送出',
            409,
            'PARTICIPATION_CHANGED',
          );
        if (
          status === 'registered' &&
          !(await db.prepare('SELECT job_id FROM professions WHERE job_id = ?').get(professionId))
        )
          throw new ParticipationError('職業不存在, 請重新載入職業清單');
        const members = memberUid
          ? (await db
              .prepare(
                `SELECT uid FROM members WHERE uid = ? AND CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) = CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(?, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY)
          AND removed_at IS NULL AND (is_in_guild = 1 OR is_in_club = 1)`,
              )
              .all(memberUid, name))
          : (await db
              .prepare(
                `SELECT m.uid FROM members m LEFT JOIN event_member_responses r
            ON r.member_uid = m.uid AND r.event_id = ?
          WHERE CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.name, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) = CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(?, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) AND m.removed_at IS NULL
            AND (? = 'registered' OR m.is_in_guild = 1 OR m.is_in_club = 1
              OR r.status IN ('registered', 'leave'))`,
              )
              .all(eventId, name, status));
        if (memberUid && !members.length)
          throw new ParticipationError(
            '成員資料已更新, 請重新載入名單後再選擇',
            409,
            'PARTICIPATION_MEMBER_CHANGED',
          );
        const guest = memberUid
          ? null
          : (await db
              .prepare(
                `SELECT id, active FROM event_registrations WHERE event_id = ? AND CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) = CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(?, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY)
          ORDER BY active DESC, created_at DESC, id DESC LIMIT 1`,
              )
              .get(eventId, name));
        if (members.length > 1 || (members.length && guest))
          throw new ParticipationError(
            '有同名資料, 無法確認人員, 請聯絡管理者',
            409,
            'PARTICIPATION_AMBIGUOUS',
          );
        if (members.length) {
          const uid = members[0].uid;
          (await repository.saveMemberResponse(eventId, {
            uid,
            status,
            note,
            revision: (await response(eventId, uid))?.revision || 0,
            ...(status === 'registered' ? { professionId } : {}),
          }));
        } else if (guest) {
          (await db.prepare(
            `UPDATE event_registrations SET active = ?, note = ?,
              profession_id = COALESCE(?, profession_id), revision = revision + 1, updated_at = ?
            WHERE id = ?`,
          ).run(
            status === 'registered' ? 1 : 0,
            note,
            professionId,
            new Date().toISOString(),
            guest.id,
          ));
          (await notifyLeave(
            eventId,
            leaveNotice(guest.active ? 'registered' : 'leave', status),
            (await guestPerson(guest.id)),
          ));
        } else if (status === 'registered') {
          (await repository.addGuestRegistration(eventId, {
            name,
            note,
            professionId,
            requestId: input.requestId,
          }));
        } else {
          throw new ParticipationError('沒有報名或沒有資料', 404, 'PARTICIPATION_NOT_FOUND');
        }
        const result = { eventId, name, status };
        (await db.prepare('INSERT INTO event_participation_requests VALUES (?, ?, ?, ?)').run(
          input.requestId,
          eventId,
          encoded,
          JSON.stringify(result),
        ));
        return result;
      }));
    },
    async saveMemberResponse(eventId, input) {
      const uid = text(input?.uid, '成員資料', 64, true);
      const note = text(input?.note ?? '', '備註', 160);
      const status = input?.status;
      if (!['registered', 'leave', 'none'].includes(status))
        throw new ParticipationError('請選擇報名、請假或取消');
      revision(input?.revision);
      return (await db.transaction(async () => {
        (await checkEvent(eventId));
        if (!(await db.prepare('SELECT uid FROM members WHERE uid = ? AND removed_at IS NULL').get(uid))) {
          throw new ParticipationError('找不到這位成員，請重新選擇', 404, 'MEMBER_NOT_FOUND');
        }
        const prior = (await response(eventId, uid));
        const professionId =
          input.professionId === undefined ? (prior?.professionId ?? null) : input.professionId;
        if (
          professionId !== null &&
          (!Number.isSafeInteger(professionId) ||
            !(await db.prepare('SELECT job_id FROM professions WHERE job_id = ?').get(professionId)))
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
        (await db.prepare(
          `INSERT INTO event_member_responses
            (event_id, member_uid, status, note, revision, updated_at, profession_id)
            VALUES (?, ?, ?, ?, 1, ?, ?)
          ON DUPLICATE KEY UPDATE status = VALUES(status),
          note = VALUES(note), revision = event_member_responses.revision + 1,
          updated_at = VALUES(updated_at), profession_id = VALUES(profession_id)`,
        ).run(eventId, uid, status, note, now, professionId));
        (await notifyLeave(eventId, leaveNotice(prior?.status ?? 'none', status), (await memberPerson(eventId, uid))));
        return (await response(eventId, uid));
      }));
    },
    async addGuestRegistration(eventId, input) {
      const name = text(input?.name, '名稱', 64, true);
      const note = text(input?.note ?? '', '備註', 160);
      const professionId = input?.professionId;
      const requestId = input?.requestId;
      if (!Number.isSafeInteger(professionId) || professionId < 1)
        throw new ParticipationError('請選擇職業');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId))
        throw new ParticipationError('缺少有效的操作識別碼，請重新操作');
      return (await db.transaction(async () => {
        const priorId = (await db
          .prepare('SELECT id FROM event_registrations WHERE request_id = ?')
          .get(requestId))?.id;
        if (priorId) {
          const prior = (await registration(priorId));
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
        (await checkEvent(eventId));
        if (!(await db.prepare('SELECT job_id FROM professions WHERE job_id = ?').get(professionId)))
          throw new ParticipationError('職業不存在，請重新載入職業清單');
        if (
          (await db
            .prepare(
              'SELECT id FROM event_registrations WHERE event_id = ? AND CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) = CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(?, 0x41, 0x61), 0x42, 0x62), 0x43, 0x63), 0x44, 0x64), 0x45, 0x65), 0x46, 0x66), 0x47, 0x67), 0x48, 0x68), 0x49, 0x69), 0x4a, 0x6a), 0x4b, 0x6b), 0x4c, 0x6c), 0x4d, 0x6d), 0x4e, 0x6e), 0x4f, 0x6f), 0x50, 0x70), 0x51, 0x71), 0x52, 0x72), 0x53, 0x73), 0x54, 0x74), 0x55, 0x75), 0x56, 0x76), 0x57, 0x77), 0x58, 0x78), 0x59, 0x79), 0x5a, 0x7a) AS BINARY) AND active = 1',
            )
            .get(eventId, name))
        ) {
          throw new ParticipationError(
            '本場已有同名額外報名，請確認是否已送出',
            409,
            'REGISTRATION_EXISTS',
          );
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        (await db.prepare('INSERT INTO event_registrations (id,event_id,name,profession_id,note,active,revision,request_id,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)').run(
          id,
          eventId,
          name,
          professionId,
          note,
          requestId,
          now,
          now,
        ));
        return (await registration(id));
      }));
    },
    // Managers delete a mistaken 本場外援 outright: no leave record and no Discord notice.
    // Saved lineup versions keep their own snapshots; a retry after success is a no-op.
    async deleteGuestRegistration(eventId, id, expectedRevision) {
      revision(expectedRevision);
      return (await db.transaction(async () => {
        (await checkEvent(eventId));
        const prior = (await registration(id));
        if (!prior) return { deleted: true, id };
        if (prior.eventId !== eventId)
          throw new ParticipationError('找不到本場報名', 404, 'REGISTRATION_NOT_FOUND');
        if (prior.revision !== expectedRevision)
          throw new ParticipationError('報名已更新，請重新載入', 409, 'PARTICIPATION_CHANGED');
        (await db.prepare('DELETE FROM event_registrations WHERE id = ?').run(id));
        return { deleted: true, id };
      }));
    },
    async cancelGuestRegistration(eventId, id, expectedRevision) {
      revision(expectedRevision);
      return (await db.transaction(async () => {
        (await checkEvent(eventId));
        const prior = (await registration(id));
        if (!prior || prior.eventId !== eventId)
          throw new ParticipationError('找不到本場報名', 404, 'REGISTRATION_NOT_FOUND');
        if (!prior.active && prior.revision === expectedRevision + 1) return prior;
        if (!prior.active || prior.revision !== expectedRevision)
          throw new ParticipationError('報名已更新，請重新載入', 409, 'PARTICIPATION_CHANGED');
        (await db.prepare(
          'UPDATE event_registrations SET active = 0, revision = revision + 1, updated_at = ? WHERE id = ?',
        ).run(new Date().toISOString(), id));
        (await notifyLeave(eventId, 'leave', (await guestPerson(id))));
        return (await registration(id));
      }));
    },
  };
  return repository;
}
