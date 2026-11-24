import { emptyLineupOb, validateLineupOb } from '../../src/domain/lineup-ob.js';
import { taipeiToday } from '../../src/domain/battle-events.js';
import { choiceCursor, choicePage, liveBattleSource } from './choice-pages.js';
import { randomUUID } from 'node:crypto';
import { editableLineup, eligibleMember, participantKey, LINEUP_TYPES } from "../../src/domain/lineups.js";

import {
  LineupError,
  validateLineup,
  lineupText as text,
  validateLineupRequestId as requestId,
} from '../../src/domain/lineup-validation.js';
export { LineupError, validateLineup } from '../../src/domain/lineup-validation.js';

export function createLineupRepository(db, {
  project = (_kind, _id, value) => value,
  projectMany = async (kind, rows) => Promise.all(rows.map((row) => project(kind, row.id, row.value))),
} = {}) {
  // Confirmation snapshots deliberately do not reference mutable member/profession rows.
  async function event(id) {
    const row = (await db
      .prepare(
        'SELECT id, title, type, revision, deleted_at AS deletedAt FROM scheduled_events WHERE id = ?',
      )
      .get(id));
    if (!row || row.deletedAt || !LINEUP_TYPES.includes(row.type))
      throw new LineupError('這場安排已刪除或不是戰鬥，請重新選擇場次', 409, 'EVENT_UNAVAILABLE');
    const dates = (await db
      .prepare('SELECT date FROM event_dates WHERE event_id = ? ORDER BY date')
      .all(id))
      .map((d) => d.date);
    if (dates.length !== 1) throw new LineupError('戰鬥排表需要單日場次', 409, 'EVENT_UNAVAILABLE');
    return { id: row.id, title: row.title, type: row.type, revision: row.revision, dates };
  }
  async function members(eventId) {
    const current = new Map(
      (await db
        .prepare(
          `SELECT m.uid, m.name, m.is_in_guild AS isInGuild, m.is_in_club AS isInClub,
      p.job_id AS primaryId, p.name AS primaryName, p.colorcode AS primaryColor,
      s.job_id AS secondaryId, s.name AS secondaryName, s.colorcode AS secondaryColor
      FROM members m LEFT JOIN professions p ON p.job_id = m.primary_profession_id
      LEFT JOIN professions s ON s.job_id = m.secondary_profession_id WHERE m.removed_at IS NULL`,
        )
        .all())
        .map((m) => [participantKey(m), m]),
    );
    if (eventId) {
      for (const row of (await db
        .prepare('SELECT member_uid, status FROM event_member_responses WHERE event_id = ?')
        .all(eventId))) {
        const member = current.get(participantKey({ uid: row.member_uid }));
        if (member)
          Object.assign(member, {
            isOnLeave: row.status === 'leave',
            isRegistered: row.status === 'registered',
          });
      }
    }
    const guests = (await db
      .prepare(
        `SELECT r.id AS registrationId, r.event_id AS eventId, r.name, r.note,
      p.job_id AS primaryId, p.name AS primaryName, p.colorcode AS primaryColor
      FROM event_registrations r JOIN professions p ON p.job_id = r.profession_id
      WHERE r.active = 1 ${eventId ? 'AND r.event_id = ?' : ''}`,
      )
      .all(...(eventId ? [eventId] : [])));
    for (const guest of guests) current.set(participantKey(guest), { ...guest, uid: null });
    return current;
  }
  async function snapshot(teams, type, eventId) {
    const current = (await members(eventId));
    const catalog = new Map(
      (await db
        .prepare('SELECT id,name FROM duties WHERE active = 1')
        .all())
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
              '排表使用的職責已停用或不存在，請更新職責清單並移除後再儲存',
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
  async function version(row) {
    return {
      id: row.id,
      eventId: row.event_id,
      version: row.version,
      createdAt: row.created_at,
      ...(await project('lineup', row.id, JSON.parse(row.snapshot_json))),
    };
  }
  async function template(row) {
    return {
      id: row.id,
      name: row.name,
      teams: (await project('template', row.id, JSON.parse(row.teams_json))),
      createdAt: row.created_at,
    };
  }
  const repository = {
    async getLineupChoices(input = {}) {
      const cursor = choiceCursor(input.cursor);
      // Live battles walk the date index; archived event metadata is projected in SQL, never the
      // full team snapshot. Upcoming battles come first, then past ones newest first.
      const live = liveBattleSource(db, 'e.id,e.title,e.type,e.revision,0 AS archived');
      const archived = ({ dates, keyset, direction, take }) => {
        const range = dates('date'), position = keyset('date', 'title', 'id');
        return db.prepare(`SELECT * FROM (
          SELECT v.event_id AS id,
            JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.event.title')) AS title,
            CONVERT(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.event.type')) USING ascii) COLLATE ascii_bin AS type,
            CAST(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.event.revision')) AS UNSIGNED) AS revision,
            CONVERT(JSON_UNQUOTE(JSON_EXTRACT(v.snapshot_json,'$.event.dates[0]')) USING ascii) COLLATE ascii_bin AS date,
            1 AS archived
          FROM lineup_versions v
          WHERE v.version=(SELECT MAX(version) FROM lineup_versions WHERE event_id=v.event_id)
            AND NOT EXISTS (SELECT 1 FROM scheduled_events e WHERE e.id=v.event_id
              AND e.deleted_at IS NULL AND e.type IN ('scrimmage','guild_war','dragon_tiger'))
        ) c WHERE ${range.sql}${position.sql} ORDER BY date ${direction},title,id LIMIT ?`).all(...range.args, ...position.args, take);
      };
      const { rows, hasMore, nextCursor } = await choicePage([live, archived],
        [{ operator: '>=', direction: 'ASC' }, { operator: '<', direction: 'DESC' }], taipeiToday(), cursor);
      const events = rows.map(({ date, archived, ...event }) => ({
        ...event, dates: [date], ...(Number(archived) === 1 ? { archived: true } : {}),
      }));
      return { events, hasMore, nextCursor };
    },
    async getLineupEvents() {
      return (await repository.getLineupChoices()).events;
    },
    async getLineupTemplates() {
      return { templates: (await db.prepare(
        'SELECT id, name, created_at AS createdAt FROM lineup_templates ORDER BY created_at DESC, created_order DESC',
      ).all()) };
    },
    async getLineupCurrent(eventId) {
      eventId = text(eventId, '場次', 128, true);
      const row = (await db.prepare('SELECT * FROM lineup_versions WHERE event_id = ? ORDER BY version DESC LIMIT 1').get(eventId));
      const latest = row ? (await version(row)) : null;
      const live = (await db.prepare('SELECT type, deleted_at AS deletedAt FROM scheduled_events WHERE id = ?').get(eventId));
      const currentEvent = live && !live.deletedAt && LINEUP_TYPES.includes(live.type)
        ? (await event(eventId)) : latest ? { ...latest.event, archived: true } : null;
      if (!currentEvent) throw new LineupError('這場安排已無法排表，請重新載入', 409, 'EVENT_UNAVAILABLE');
      return { event: currentEvent, versions: latest ? [latest] : [] };
    },
    async getLineupIndex() {
      const rows = await db.prepare('SELECT * FROM lineup_templates ORDER BY created_at DESC, created_order DESC').all();
      const teams = await projectMany('template', rows.map((row) => ({ id: row.id, value: JSON.parse(row.teams_json) })));
      return {
        events: await repository.getLineupEvents(),
        templates: rows.map((row, index) => ({ id: row.id, name: row.name, teams: teams[index], createdAt: row.created_at })),
      };
    },
    async getLineupHistory(eventId) {
      const rows = await db.prepare('SELECT * FROM lineup_versions WHERE event_id = ? ORDER BY version DESC').all(eventId);
      // Every version's overrides arrive in one query instead of one per version.
      const snapshots = await projectMany('lineup', rows.map((row) => ({ id: row.id, value: JSON.parse(row.snapshot_json) })));
      return {
        versions: rows.map((row, index) => ({
          id: row.id, eventId: row.event_id, version: row.version, createdAt: row.created_at, ...snapshots[index],
        })),
      };
    },
    async confirmLineup(input) {
      const teams = validateLineup(input?.teams);
      const key = requestId(input?.requestId);
      const ob = input?.ob === undefined ? null : validateLineupOb(input.ob);
      if (
        typeof input?.eventId !== 'string' ||
        !Number.isSafeInteger(input?.expectedVersion) ||
        input.expectedVersion < 0 ||
        !Number.isSafeInteger(input?.eventRevision) ||
        input.eventRevision < 1
      )
        throw new LineupError('場次或排表資料格式不正確');
      const payload = JSON.stringify({
        eventId: input.eventId,
        eventRevision: input.eventRevision,
        expectedVersion: input.expectedVersion,
        teams,
        ...(ob ? { ob } : {}),
      });
      return (await db.transaction(async () => {
        // Saves for one event queue on its row, so the version check and receipt read are current.
        (await db.prepare('SELECT id FROM scheduled_events WHERE id = ? FOR UPDATE').get(input.eventId));
        const prior = (await db.prepare('SELECT * FROM lineup_versions WHERE request_id = ?').get(key));
        if (prior) {
          const previous = JSON.parse(prior.payload_json);
          if (JSON.stringify({ ...previous, teams: validateLineup(previous.teams) }) !== payload)
            throw new LineupError(
              '這個操作識別碼已用於其他排表，請重新操作',
              409,
              'REQUEST_CONFLICT',
            );
          return (await version(prior));
        }
        const currentEvent = (await event(input.eventId));
        if (currentEvent.revision !== input.eventRevision)
          throw new LineupError('場次資料已修改，請重新載入後再儲存', 409, 'EVENT_CHANGED');
        const latest = (await db
          .prepare(
            'SELECT COALESCE(MAX(version), 0) AS version FROM lineup_versions WHERE event_id = ?',
          )
          .get(input.eventId)).version;
        if (latest !== input.expectedVersion)
          throw new LineupError(
            '已有其他人修改排表，請先重新載入；目前輸入仍保留',
            409,
            'LINEUP_CONFLICT',
          );
        const currentOb = await db.prepare('SELECT enabled, attack_mode AS attackMode, defense_mode AS defenseMode, attack, mobile, defense12, defense34 FROM event_lineup_ob WHERE event_id=?').get(input.eventId);
        const savedOb = ob || currentOb || emptyLineupOb();
        const data = {
          ob: savedOb,
          event: currentEvent,
          teams: (await snapshot(teams, currentEvent.type, currentEvent.id)),
        };
        const row = {
          id: randomUUID(),
          event_id: input.eventId,
          version: latest + 1,
          created_at: new Date().toISOString(),
          snapshot_json: JSON.stringify(data),
        };
        (await db.prepare('INSERT INTO lineup_versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          row.id,
          row.event_id,
          row.version,
          key,
          payload,
          row.snapshot_json,
          row.created_at,
        ));
        if (ob) await db.prepare(`INSERT INTO event_lineup_ob
          (id, event_id, enabled, attack_mode, defense_mode, attack, mobile, defense12, defense34)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), attack_mode=VALUES(attack_mode), defense_mode=VALUES(defense_mode),
            attack=VALUES(attack), mobile=VALUES(mobile), defense12=VALUES(defense12), defense34=VALUES(defense34)`)
          .run(randomUUID(), input.eventId, ob.enabled, ob.attackMode, ob.defenseMode, ob.attack, ob.mobile, ob.defense12, ob.defense34);
        return (await version(row));
      }));
    },
    async createLineupTemplate(input) {
      const teams = validateLineup(input?.teams);
      const name = text(input?.name, '範本名稱', 80, true);
      const key = requestId(input?.requestId);
      const templateId = input?.templateId == null ? null : text(input.templateId, '範本', 128, true);
      const payload = JSON.stringify({ name, teams, ...(templateId ? { templateId } : {}) });
      return (await db.transaction(async () => {
        const prior = (await db.prepare('SELECT * FROM lineup_templates WHERE request_id = ?').get(key));
        if (prior) {
          const previous = JSON.parse(prior.payload_json);
          if (JSON.stringify({ ...previous, teams: validateLineup(previous.teams) }) !== payload)
            throw new LineupError('操作識別碼已使用，請重新操作', 409, 'REQUEST_CONFLICT');
          return (await template(prior));
        }
        // Saving back to a chosen template, or under a name already in use, updates it in place.
        const target = templateId
          ? (await db.prepare('SELECT * FROM lineup_templates WHERE id = ? FOR UPDATE').get(templateId))
          : (await db.prepare('SELECT * FROM lineup_templates WHERE name = ? ORDER BY created_at DESC, created_order DESC LIMIT 1 FOR UPDATE').get(name));
        if (templateId && !target)
          throw new LineupError('找不到這份範本，請重新載入', 404, 'TEMPLATE_NOT_FOUND');
        if (target) {
          const teamsJson = JSON.stringify((await snapshot(teams)));
          (await db.prepare('UPDATE lineup_templates SET name = ?, request_id = ?, payload_json = ?, teams_json = ? WHERE id = ?')
            .run(name, key, payload, teamsJson, target.id));
          // The new snapshot holds current UIDs; older remaps no longer apply to it.
          (await db.prepare("DELETE FROM member_reference_overrides WHERE kind = 'template' AND record_id = ?").run(target.id));
          return { ...(await template({ ...target, name, teams_json: teamsJson })), replaced: true };
        }
        const row = {
          id: randomUUID(),
          name,
          teams_json: JSON.stringify((await snapshot(teams))),
          created_at: new Date().toISOString(),
        };
        (await db.prepare('INSERT INTO lineup_templates (id,name,request_id,payload_json,teams_json,created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          row.id,
          name,
          key,
          payload,
          row.teams_json,
          row.created_at,
        ));
        return (await template(row));
      }));
    },
    async deleteLineupTemplate(templateId) {
      const id = text(templateId, '範本', 128, true);
      return (await db.transaction(async () => {
        (await db.prepare("DELETE FROM member_reference_overrides WHERE kind = 'template' AND record_id = ?").run(id));
        (await db.prepare('DELETE FROM lineup_templates WHERE id = ?').run(id));
        return { deleted: true, id };
      }));
    },
    async applyLineupTemplate(templateId, eventId) {
      const currentEvent = (await event(eventId));
      const row = (await db.prepare('SELECT * FROM lineup_templates WHERE id = ?').get(templateId));
      if (!row) throw new LineupError('找不到這份範本，請重新載入', 404, 'TEMPLATE_NOT_FOUND');
      const current = (await members(currentEvent.id));
      const skipped = [];
      const savedTeams = (await project('template', row.id, JSON.parse(row.teams_json)));
      const catalog = new Map(
        (await db
          .prepare('SELECT id,name,active FROM duties')
          .all())
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
