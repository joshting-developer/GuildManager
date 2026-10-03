import { randomUUID } from 'node:crypto';
import {
  emptyLineup,
  editableLineup,
  eligibleMember,
  participantKey,
  LINEUP_TYPES,
} from '../src/domain/lineups.js';

export class LineupError extends Error {
  constructor(message, status = 422, code = 'LINEUP_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = {};
  }
}
function text(value, label, max, required = false) {
  if (
    typeof value !== 'string' ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new LineupError(`${label}格式不正確，長度最多 ${max} 字`);
  }
  return value.trim();
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    throw new LineupError('缺少有效的操作識別碼，請重新操作');
  return value;
}
export function validateLineup(teams) {
  const layout = emptyLineup();
  if (!Array.isArray(teams) || teams.length !== layout.length)
    throw new LineupError('排表需要十隊，每隊六個位置');
  const seen = new Set();
  return layout.map((defaultTeam, teamIndex) => {
    const team = teams[teamIndex];
    if (team?.id !== defaultTeam.id || !Array.isArray(team.slots) || team.slots.length !== 6)
      throw new LineupError('排表位置格式不正確');
    return {
      id: team.id,
      name: text(team.name, '隊名', 40, true),
      slots: team.slots.map((slot) => {
        function validateAssignment(person, allowEmpty = false) {
          const registrationId = person?.registrationId ?? null;
          if (
            !person ||
            (person.uid !== null &&
              (typeof person.uid !== 'string' || !person.uid || person.uid.length > 64)) ||
            (registrationId !== null &&
              (typeof registrationId !== 'string' ||
                !/^[a-zA-Z0-9_-]{1,64}$/.test(registrationId))) ||
            (person.uid !== null && registrationId !== null) ||
            (!allowEmpty && !person.uid && !registrationId)
          )
            throw new LineupError('人員資料格式不正確, 請重新選擇');
          if (!['primary', 'secondary'].includes(person.profession))
            throw new LineupError('請選擇主職業或副職業');
          const identity = participantKey(person);
          if (identity) {
            if (seen.has(identity))
              throw new LineupError(
                '同一位人員在這份排表中重複, 請調整安排',
                422,
                'DUPLICATE_LINEUP_UID',
              );
            seen.add(identity);
          }
          return {
            uid: person.uid,
            ...(registrationId ? { registrationId } : {}),
            profession: person.profession,
          };
        }
        const first = validateAssignment(slot, true);
        const secondRound = slot.secondRound == null ? null : validateAssignment(slot.secondRound);
        const dutyIds = slot.dutyIds === undefined ? [] : slot.dutyIds;
        if (
          !Array.isArray(dutyIds) ||
          dutyIds.some((id) => typeof id !== 'string' || !id || id.length > 64) ||
          new Set(dutyIds).size !== dutyIds.length
        )
          throw new LineupError('職責 ID 格式不正確或同一位置重複分配職責');
        return {
          ...first,
          secondRound,
          note: text(slot.note, '任務備註', 160),
          dutyIds: [...dutyIds],
        };
      }),
    };
  });
}
export function createLineupRepository(db) {
  // Confirmation snapshots deliberately do not reference mutable member/profession rows.
  db.exec(`
    CREATE TABLE IF NOT EXISTS lineup_versions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES scheduled_events(id),
      version INTEGER NOT NULL CHECK(version > 0), request_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(event_id, version)
    );
    CREATE TABLE IF NOT EXISTS lineup_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL, teams_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS lineup_versions_immutable_update BEFORE UPDATE ON lineup_versions
      BEGIN SELECT RAISE(ABORT, 'lineup versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS lineup_versions_immutable_delete BEFORE DELETE ON lineup_versions
      BEGIN SELECT RAISE(ABORT, 'lineup versions are immutable'); END;
  `);
  function event(id) {
    const row = db
      .prepare(
        'SELECT id, title, type, revision, deleted_at AS deletedAt FROM scheduled_events WHERE id = ?',
      )
      .get(id);
    if (!row || row.deletedAt || !LINEUP_TYPES.includes(row.type))
      throw new LineupError('這場安排已刪除或不是戰鬥，請重新選擇場次', 409, 'EVENT_UNAVAILABLE');
    const dates = db
      .prepare('SELECT date FROM event_dates WHERE event_id = ? ORDER BY date')
      .all(id)
      .map((d) => d.date);
    if (dates.length !== 1) throw new LineupError('戰鬥排表需要單日場次', 409, 'EVENT_UNAVAILABLE');
    return { id: row.id, title: row.title, type: row.type, revision: row.revision, dates };
  }
  function members(eventId) {
    const current = new Map(
      db
        .prepare(
          `SELECT m.uid, m.name, m.is_in_guild AS isInGuild, m.is_in_club AS isInClub,
      p.job_id AS primaryId, p.name AS primaryName, p.colorcode AS primaryColor,
      s.job_id AS secondaryId, s.name AS secondaryName, s.colorcode AS secondaryColor
      FROM members m LEFT JOIN professions p ON p.job_id = m.primary_profession_id
      LEFT JOIN professions s ON s.job_id = m.secondary_profession_id WHERE m.removed_at IS NULL`,
        )
        .all()
        .map((m) => [participantKey(m), m]),
    );
    if (eventId) {
      for (const row of db
        .prepare('SELECT member_uid, status FROM event_member_responses WHERE event_id = ?')
        .all(eventId)) {
        const member = current.get(participantKey({ uid: row.member_uid }));
        if (member)
          Object.assign(member, {
            isOnLeave: row.status === 'leave',
            isRegistered: row.status === 'registered',
          });
      }
    }
    const guests = db
      .prepare(
        `SELECT r.id AS registrationId, r.event_id AS eventId, r.name, r.note,
      p.job_id AS primaryId, p.name AS primaryName, p.colorcode AS primaryColor
      FROM event_registrations r JOIN professions p ON p.job_id = r.profession_id
      WHERE r.active = 1 ${eventId ? 'AND r.event_id = ?' : ''}`,
      )
      .all(...(eventId ? [eventId] : []));
    for (const guest of guests) current.set(participantKey(guest), { ...guest, uid: null });
    return current;
  }
  function snapshot(teams, type, eventId) {
    const current = members(eventId);
    const catalog = new Map(
      db
        .prepare('SELECT id,name FROM duties WHERE active = 1')
        .all()
        .map((duty) => [duty.id, duty]),
    );
    function snapshotPerson(slot) {
      if (!participantKey(slot)) return { ...slot, member: null };
      const person = current.get(participantKey(slot));
      if (!person || (type && !eligibleMember(person, type)))
        throw new LineupError(
          '人員已請假、取消報名或不符合這場戰鬥資格，請重新載入成員清單',
          409,
          'INELIGIBLE_MEMBER',
        );
      const chosen = slot.profession;
      if (!person[`${chosen}Id`])
        throw new LineupError(
          `${person.name} 沒有可用的${chosen === 'secondary' ? '副' : '主'}職業，請重新選擇`,
        );
      return {
        ...slot,
        member: {
          uid: person.uid,
          ...(person.registrationId
            ? { registrationId: person.registrationId, eventId: person.eventId, note: person.note }
            : {}),
          name: person.name,
          primaryProfession: {
            job_id: person.primaryId,
            name: person.primaryName,
            colorcode: person.primaryColor,
          },
          secondaryProfession: person.secondaryId
            ? {
                job_id: person.secondaryId,
                name: person.secondaryName,
                colorcode: person.secondaryColor,
              }
            : null,
        },
      };
    }
    return teams.map((team) => ({
      ...team,
      slots: team.slots.map((slot) => {
        const duties = slot.dutyIds.map((id) => {
          if (!catalog.has(id))
            throw new LineupError(
              '排表使用的職責已停用或不存在，請更新職責清單並移除後再確認',
              409,
              'DUTY_UNAVAILABLE',
            );
          return catalog.get(id);
        });
        return {
          ...snapshotPerson(slot),
          duties,
          secondRound: slot.secondRound ? snapshotPerson(slot.secondRound) : null,
        };
      }),
    }));
  }
  function version(row) {
    return {
      id: row.id,
      eventId: row.event_id,
      version: row.version,
      createdAt: row.created_at,
      ...JSON.parse(row.snapshot_json),
    };
  }
  function template(row) {
    return {
      id: row.id,
      name: row.name,
      teams: JSON.parse(row.teams_json),
      createdAt: row.created_at,
    };
  }
  const repository = {
    getLineupIndex() {
      const events = db
        .prepare(
          "SELECT id FROM scheduled_events WHERE deleted_at IS NULL AND type IN ('scrimmage', 'guild_war', 'dragon_tiger')",
        )
        .all()
        .map((row) => event(row.id));
      const live = new Set(events.map((e) => e.id));
      const archived = db
        .prepare(
          `SELECT v.* FROM lineup_versions v WHERE version = (SELECT MAX(version) FROM lineup_versions WHERE event_id = v.event_id) ORDER BY created_at DESC`,
        )
        .all()
        .filter((v) => !live.has(v.event_id))
        .map((v) => ({ ...version(v).event, archived: true }));
      return {
        events: [...events, ...archived].sort(
          (a, b) => b.dates[0].localeCompare(a.dates[0]) || a.title.localeCompare(b.title),
        ),
        templates: db
          .prepare('SELECT * FROM lineup_templates ORDER BY created_at DESC, rowid DESC')
          .all()
          .map(template),
      };
    },
    getLineupHistory(eventId) {
      return {
        versions: db
          .prepare('SELECT * FROM lineup_versions WHERE event_id = ? ORDER BY version DESC')
          .all(eventId)
          .map(version),
      };
    },
    confirmLineup(input) {
      const teams = validateLineup(input?.teams);
      const key = requestId(input?.requestId);
      if (
        typeof input?.eventId !== 'string' ||
        !Number.isSafeInteger(input?.expectedVersion) ||
        input.expectedVersion < 0 ||
        !Number.isSafeInteger(input?.eventRevision) ||
        input.eventRevision < 1
      )
        throw new LineupError('場次或排表版本格式不正確');
      const payload = JSON.stringify({
        eventId: input.eventId,
        eventRevision: input.eventRevision,
        expectedVersion: input.expectedVersion,
        teams,
      });
      return db.transaction(() => {
        const prior = db.prepare('SELECT * FROM lineup_versions WHERE request_id = ?').get(key);
        if (prior) {
          const previous = JSON.parse(prior.payload_json);
          if (JSON.stringify({ ...previous, teams: validateLineup(previous.teams) }) !== payload)
            throw new LineupError(
              '這個操作識別碼已用於其他排表，請重新操作',
              409,
              'REQUEST_CONFLICT',
            );
          return version(prior);
        }
        const currentEvent = event(input.eventId);
        if (currentEvent.revision !== input.eventRevision)
          throw new LineupError('場次資料已修改，請重新載入後再確認', 409, 'EVENT_CHANGED');
        const latest = db
          .prepare(
            'SELECT COALESCE(MAX(version), 0) AS version FROM lineup_versions WHERE event_id = ?',
          )
          .get(input.eventId).version;
        if (latest !== input.expectedVersion)
          throw new LineupError(
            '已有其他人確認新版本，請先重新載入排表；目前輸入仍保留',
            409,
            'LINEUP_CONFLICT',
          );
        const data = {
          event: currentEvent,
          teams: snapshot(teams, currentEvent.type, currentEvent.id),
        };
        const row = {
          id: randomUUID(),
          event_id: input.eventId,
          version: latest + 1,
          created_at: new Date().toISOString(),
          snapshot_json: JSON.stringify(data),
        };
        db.prepare('INSERT INTO lineup_versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          row.id,
          row.event_id,
          row.version,
          key,
          payload,
          row.snapshot_json,
          row.created_at,
        );
        return version(row);
      })();
    },
    createLineupTemplate(input) {
      const teams = validateLineup(input?.teams);
      const name = text(input?.name, '範本名稱', 80, true);
      const key = requestId(input?.requestId);
      const payload = JSON.stringify({ name, teams });
      return db.transaction(() => {
        const prior = db.prepare('SELECT * FROM lineup_templates WHERE request_id = ?').get(key);
        if (prior) {
          const previous = JSON.parse(prior.payload_json);
          if (JSON.stringify({ ...previous, teams: validateLineup(previous.teams) }) !== payload)
            throw new LineupError('操作識別碼已使用，請重新操作', 409, 'REQUEST_CONFLICT');
          return template(prior);
        }
        const row = {
          id: randomUUID(),
          name,
          teams_json: JSON.stringify(snapshot(teams)),
          created_at: new Date().toISOString(),
        };
        db.prepare('INSERT INTO lineup_templates VALUES (?, ?, ?, ?, ?, ?)').run(
          row.id,
          name,
          key,
          payload,
          row.teams_json,
          row.created_at,
        );
        return template(row);
      })();
    },
    applyLineupTemplate(templateId, eventId) {
      const currentEvent = event(eventId);
      const row = db.prepare('SELECT * FROM lineup_templates WHERE id = ?').get(templateId);
      if (!row) throw new LineupError('找不到這份範本，請重新載入', 404, 'TEMPLATE_NOT_FOUND');
      const current = members(currentEvent.id);
      const skipped = [];
      const savedTeams = JSON.parse(row.teams_json);
      const catalog = new Map(
        db
          .prepare('SELECT id,name,active FROM duties')
          .all()
          .map((duty) => [duty.id, duty]),
      );
      const skippedDuties = [];
      const teams = editableLineup(savedTeams).map((team) => ({
        ...team,
        slots: team.slots.map((slot, index) => {
          const dutyIds = slot.dutyIds.filter((id) => {
            if (catalog.get(id)?.active) return true;
            const saved = savedTeams
              .find((savedTeam) => savedTeam.id === team.id)
              .slots[index].duties?.find((duty) => duty.id === id);
            skippedDuties.push({
              id,
              name: saved?.name || catalog.get(id)?.name || id,
              teamId: team.id,
              teamName: team.name,
              position: index + 1,
              reason: '職責已停用或不存在',
            });
            return false;
          });
          slot = { ...slot, dutyIds };
          function applyPerson(person, round) {
            if (!participantKey(person)) return person;
            const currentPerson = current.get(participantKey(person));
            const reason = !currentPerson
              ? person.registrationId
                ? '額外報名不屬於本場或已取消'
                : '成員已不存在'
              : currentPerson.isOnLeave
                ? '本場已請假'
                : !eligibleMember(currentPerson, currentEvent.type)
                  ? '不符合本場成員資格'
                  : !currentPerson[`${person.profession}Id`]
                    ? '原本的職業已無法使用'
                    : '';
            if (!reason) return person;
            const savedSlot = savedTeams.find((t) => t.id === team.id).slots[index];
            const savedPerson = round === 2 ? savedSlot.secondRound : savedSlot;
            skipped.push({
              uid: person.uid,
              ...(person.registrationId ? { registrationId: person.registrationId } : {}),
              name: savedPerson?.member?.name || currentPerson?.name || '找不到人員',
              reason,
              teamName: team.name,
              position: index + 1,
              round,
            });
            if (round === 2) return null;
            const cleared = { ...person, uid: null, profession: 'primary' };
            delete cleared.registrationId;
            return cleared;
          }
          return {
            ...applyPerson(slot, 1),
            secondRound: applyPerson(slot.secondRound, 2),
          };
        }),
      }));
      return { teams, skipped, skippedDuties, event: currentEvent };
    },
  };
  return repository;
}
