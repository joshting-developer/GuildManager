import { createMemberEditAudit } from './member-edit-audit.js';
import { createDiscordSettingsRepository } from './discord-settings-repository.js';
import { createProfessionRepository } from './profession-repository.js';
import { createFileStagingRepository } from './file-staging-repository.js';
import { withFileStorage } from '../services/file-backed-repository.js';
import { createStore, exposeRepository } from './store.js';
import { asyncMap } from "./collections.js";
import { lineupEditorEventId } from '../../src/domain/lineup-index.js';
import { LineupError } from '../../src/domain/lineup-validation.js';
import { isBattleEvent } from '../../src/domain/battle-events.js';
import { videoBrowserSelection } from '../../src/domain/video-browser.js';
import { createMemberReferences, createMemberMaintenance } from './member-maintenance.js';

import { createPlatformSettingsRepository } from './platform-settings-repository.js';
import { createAuthRepository } from './auth-repository.js';
import { createEventRepository } from './event-repository.js';
import { createLineupRepository } from './lineup-repository.js';
import { createParticipationRepository } from './participation-repository.js';
import { createEventVideoRepository } from './event-video-repository.js';
import { createAttendanceRepository } from './attendance-repository.js';
import { createDutyRepository } from './duty-repository.js';
import { createBattleRecordRepository } from './battle-record-repository.js';
import { createLotteryRepository } from './lottery-repository.js';
import { randomUUID, createHash } from 'node:crypto';
import { parseMemberImport } from '../member-import.js';
import { MemberError, validateMember, validateRevision } from '../member-validation.js';

function createImplementation(store, authNow, participationNow) {
  const db = store;
  const audit = createMemberEditAudit(db);
  const memberColumns = `m.uid, m.name, m.primary_profession_id AS primaryProfessionId,
    m.secondary_profession_id AS secondaryProfessionId,
    m.is_in_guild AS isInGuild, m.is_in_club AS isInClub,
    COALESCE(p.name, m.primary_profession) AS primaryProfession,
    COALESCE(s.name, m.secondary_profession) AS secondaryProfession,
    m.joined_at AS joinedAt, m.updated_at AS updatedAt, m.revision`;
  const memberFrom = `members m LEFT JOIN professions p ON p.job_id = m.primary_profession_id
    LEFT JOIN professions s ON s.job_id = m.secondary_profession_id`;
  async function professionNames(member) {
    const names = [];
    for (const [field, label] of [
      ['primaryProfessionId', '主職業'],
      ['secondaryProfessionId', '副職業'],
    ]) {
      if (member[field] === null) {
        names.push('');
        continue;
      }
      const job = (await db.prepare('SELECT name FROM professions WHERE job_id = ?').get(member[field]));
      if (!job)
        throw new MemberError(422, 'VALIDATION_ERROR', '請重新選擇職業', {
          [field]: `${label}不存在，請重新載入職業清單`,
        });
      names.push(job.name);
    }
    return names;
  }
  async function previousNames(uid) {
    return (await db
      .prepare(
        `SELECT id, name, changed_at AS changedAt FROM member_name_history
      WHERE member_uid = ? ORDER BY changed_at DESC, created_order DESC`,
      )
      .all(uid));
  }
  async function getMember(uid) {
    const row = (await db
      .prepare(
        `SELECT ${memberColumns} FROM ${memberFrom} WHERE m.uid = ? AND m.removed_at IS NULL`,
      )
      .get(uid));
    if (!row) throw new MemberError(404, 'MEMBER_NOT_FOUND', '找不到這位成員，可能已被移除');
    return {
      ...row,
      isInGuild: Boolean(row.isInGuild),
      isInClub: Boolean(row.isInClub),
      previousNames: (await previousNames(uid)),
    };
  }
  // Member writes lock the UID row first; a UID that does not exist yet is protected by the primary key.
  async function lockMember(uid) {
    (await db.prepare('SELECT uid FROM members WHERE uid = ? FOR UPDATE').get(uid));
  }
  function checkRevision(member, revision) {
    if (member.revision !== revision) {
      throw new MemberError(409, 'STALE_MEMBER', '這位成員的資料已更新，請重新載入後再操作');
    }
  }
  async function recordName(uid, name, time) {
    (await db.prepare('INSERT INTO member_name_history (id,member_uid,name,changed_at) VALUES (?, ?, ?, ?)').run(
      randomUUID(),
      uid,
      name,
      time,
    ));
  }

  async function previewMemberImport(input) {
    const jobs = (await db.prepare('SELECT job_id, name FROM professions ORDER BY job_id').all());
    const parsed = parseMemberImport(input?.text, jobs);
    const states = [];
    const summary = { added: 0, restored: 0, skipped: 0 };
    const existingRows = parsed.rows.length ? await db.prepare(
      `SELECT uid, revision, removed_at FROM members WHERE uid IN (${parsed.rows.map(() => '?').join(', ')})`,
    ).all(...parsed.rows.map(row => row.uid)) : [];
    const byUid = new Map(existingRows.map(({ uid, revision, removed_at }) => [uid, { revision, removed_at }]));
    const rows = parsed.rows.map(row => {
      const existing = byUid.get(row.uid);
      const action = !existing ? 'add' : existing.removed_at === null ? 'skip' : 'restore';
      states.push(existing || null);
      summary[action === 'add' ? 'added' : action === 'restore' ? 'restored' : 'skipped'] += 1;
      return { ...row, action };
    });
    const fingerprint = parsed.issues.length
      ? null
      : createHash('sha256').update(JSON.stringify({ rows, states })).digest('hex');
    return { rows, issues: parsed.issues, summary, fingerprint };
  }

  const notify = notice => store.notify(notice);
  const memberNotice = (action, member, previousName) =>
    notify({
      type: 'member',
      action,
      member: {
        uid: member.uid,
        name: member.name,
        primaryProfession: member.primaryProfession,
        secondaryProfession: member.secondaryProfession,
        isInGuild: member.isInGuild,
        isInClub: member.isInClub,
      },
      previousName,
    });

  const references = createMemberReferences(db);
  const repository = {
    getMember,

    ...createAuthRepository(db, { now: authNow }),
    ...createEventRepository(db),
    ...createDutyRepository(db),
    ...createProfessionRepository(db),
    ...createAttendanceRepository(db),
    ...createParticipationRepository(db, { notify, now: participationNow }),
    ...createEventVideoRepository(db),
    ...createLineupRepository(db, { project: references.project, projectMany: references.projectMany }),
    ...createBattleRecordRepository(db, { project: references.project, projectAll: references.projectAll }),
    ...createMemberMaintenance(db, { getMember, updateMember: async (...args) => (await repository.updateMember(...args)), references, audit }),
    ...createPlatformSettingsRepository(db),
    ...createDiscordSettingsRepository(db),
    ...createLotteryRepository(db),
    async getLineupEditor(preferredId = null) {
      return (await db.transaction(async () => {
        const choices = await repository.getLineupChoices();
        const { events } = choices;
        let eventId = lineupEditorEventId(events, preferredId);
        let selected = null;
        if (preferredId && !events.some(event => event.id === preferredId)) {
          try {
            selected = { eventId: preferredId, ...(await repository.getLineupEvent(preferredId)) };
            events.push(selected.event);
            eventId = preferredId;
          } catch (error) {
            if (error.code !== 'EVENT_UNAVAILABLE') throw error;
          }
        }
        selected ||= eventId ? { eventId, ...(await repository.getLineupEvent(eventId)) } : null;
        return { ...choices, ...(await repository.getLineupCatalogs()), selected };
      }));
    },
    async getLineupCatalogs() {
      return { ...(await repository.listMembers()), ...(await repository.listProfessions()), ...(await repository.listDuties()) };
    },
    async getLineupSources(eventId) {
      return (await db.transaction(async () => {
        const { event } = (await repository.getEvent(eventId));
        if (!['scrimmage', 'guild_war', 'dragon_tiger'].includes(event.type) || event.dates.length !== 1)
          throw new LineupError('這場安排已無法排表，請重新載入', 409, 'EVENT_UNAVAILABLE');
        return { event, ...(await repository.getLineupCatalogs()), participation: (await repository.getEventParticipation(eventId)) };
      }));
    },
    async getLineupEvent(eventId, includeCatalogs = false) {
      if (typeof includeCatalogs !== 'boolean') throw new LineupError('排表讀取選項格式不正確');
      return (await db.transaction(async () => {
        const current = (await repository.getLineupCurrent(eventId));
        return { ...current,
          participation: current.event.archived ? null : (await repository.getEventParticipation(eventId)),
          ...(includeCatalogs ? (await repository.getLineupCatalogs()) : {}) };
      }));
    },
    async getVideoBrowser(preferredId = null, options = {}, access = {}) {
      return (await db.transaction(async () => {
        videoBrowserSelection([], preferredId);
        const choices = await repository.getVideoChoices();
        if (preferredId && !choices.events.some(event => event.id === preferredId)) {
          try {
            const { event } = await repository.getEvent(preferredId);
            if (isBattleEvent(event)) choices.events.push(event);
          } catch (error) {
            if (error.code !== 'EVENT_NOT_FOUND') throw error;
          }
        }
        const { events, eventId } = videoBrowserSelection(choices.events, preferredId);
        return { ...choices, events, selected: eventId ? (await repository.listEventVideos(eventId, options, access)) : null };
      }));
    },
    async getEventVideoForm(eventId) {
      return (await db.transaction(async () => ({
        ...(await repository.getEvent(eventId)),
        ...(await repository.listEventParticipationMembers(eventId)),
        ...(await repository.listProfessions()),
      })));
    },
    async getEventParticipationForm(eventId) {
      return (await db.transaction(async () => ({
        ...(await repository.listEventParticipationMembers(eventId)),
        ...(await repository.listProfessions()),
        ...(await repository.getEventParticipation(eventId)),
      })));
    },
    previewMemberImport,
    async importMembers(input, actor) {
      return (await db.transaction(async () => {
        const preview = (await previewMemberImport(input));
        if (preview.issues.length) {
          const error = new MemberError(422, 'IMPORT_INVALID', '資料有錯誤，請修正後重新預覽');
          error.rows = preview.issues;
          throw error;
        }
        if (!input?.fingerprint || input.fingerprint !== preview.fingerprint) {
          throw new MemberError(409, 'STALE_IMPORT', '資料或成員清單已變動，請重新預覽後再匯入');
        }
        const members = (await asyncMap(preview.rows
          .filter((row) => row.action !== 'skip'), async (row) =>
            (await repository.addMember(
              {
                uid: row.uid,
                name: row.name,
                primaryProfessionId: row.primaryProfessionId,
                secondaryProfessionId: row.secondaryProfessionId,
              },
              { linkBattles: false, quiet: true, actor, action: 'import' },
            ))));
        (await repository.backfillMemberBattleRecords(members));
        if (members.length) notify({ type: 'member-import', members, summary: preview.summary });
        return { members, summary: preview.summary };
      }));
    },
    async getMemberEditHistory(uid, cursor) {
      const pageSize = 200;
      let after = null;
      if (cursor) {
        try { after = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')); } catch { after = null; }
        if (!Array.isArray(after) || after.length !== 2 || !after.every(value => typeof value === 'string'))
          throw new MemberError(400, 'INVALID_CURSOR', '編輯歷程分頁參數無效');
      }
      const rows = await db.prepare(`SELECT id, member_uid AS uid, action,
        actor_account_id AS actorAccountId, actor_name AS actorName, created_at AS changedAt,
        source, changes_json FROM member_edit_logs WHERE member_uid=?
        ${after ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
        ORDER BY created_at DESC, id DESC LIMIT ${pageSize + 1}`).all(uid, ...(after ? [after[0], after[0], after[1]] : []));
      const page = rows.slice(0, pageSize);
      const last = page.at(-1);
      return {
        items: page.map(({ changes_json, ...row }) => ({ ...row, changes: JSON.parse(changes_json) })),
        nextCursor: rows.length > pageSize ? Buffer.from(JSON.stringify([last.changedAt, last.id])).toString('base64url') : null,
      };
    },
    async listParticipationMembers() {
      return {
        members: (await db
          .prepare('SELECT uid, name FROM members WHERE removed_at IS NULL ORDER BY name, uid')
          .all()),
      };
    },
    async listMembers() {
      const members = (await db
        .prepare(
          `SELECT ${memberColumns} FROM ${memberFrom} WHERE m.removed_at IS NULL ORDER BY m.joined_at, m.uid`,
        )
        .all());
      const histories = (await db
        .prepare(
          `SELECT id, member_uid, name, changed_at AS changedAt FROM member_name_history
        WHERE member_uid IN (SELECT uid FROM members WHERE removed_at IS NULL)
        ORDER BY changed_at DESC, created_order DESC`,
        )
        .all());
      const byUid = new Map();
      for (const { member_uid, ...history } of histories) {
        if (!byUid.has(member_uid)) byUid.set(member_uid, []);
        byUid.get(member_uid).push(history);
      }
      return {
        members: members.map((member) => ({
          ...member,
          isInGuild: Boolean(member.isInGuild),
          isInClub: Boolean(member.isInClub),
          previousNames: byUid.get(member.uid) || [],
        })),
      };
    },
    async addMember(input, { linkBattles = true, quiet = false, actor, action } = {}) {
      const member = validateMember(input);
      return (await db.transaction(async () => {
        (await lockMember(member.uid));
        const [primaryName, secondaryName] = (await professionNames(member));
        const existing = (await db.prepare('SELECT * FROM members WHERE uid = ?').get(member.uid));
        const now = new Date().toISOString();
        if (existing && existing.removed_at === null) {
          throw new MemberError(409, 'DUPLICATE_UID', '這個 UID 已在成員清單中', {
            uid: '這個 UID 已存在',
          });
        }
        if (existing) {
          // Four-column imports retain archived membership flags when restoring a UID.
          if (input.isInGuild === undefined) member.isInGuild = Boolean(existing.is_in_guild);
          if (input.isInClub === undefined) member.isInClub = Boolean(existing.is_in_club);
          if (existing.name !== member.name) (await recordName(member.uid, existing.name, now));
          (await db.prepare(
            `UPDATE members SET name = ?, primary_profession_id = ?, secondary_profession_id = ?, primary_profession = ?, secondary_profession = ?,
            is_in_guild = ?, is_in_club = ?, joined_at = ?, updated_at = ?, removed_at = NULL, revision = revision + 1 WHERE uid = ?`,
          ).run(
            member.name,
            member.primaryProfessionId,
            member.secondaryProfessionId,
            primaryName,
            secondaryName,
            Number(member.isInGuild),
            Number(member.isInClub),
            now,
            now,
            member.uid,
          ));
        } else {
          (await db.prepare(
            `INSERT INTO members (uid, name, primary_profession_id, secondary_profession_id, primary_profession, secondary_profession, is_in_guild, is_in_club, joined_at, updated_at, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            member.uid,
            member.name,
            member.primaryProfessionId,
            member.secondaryProfessionId,
            primaryName,
            secondaryName,
            Number(member.isInGuild),
            Number(member.isInClub),
            now,
            now,
            (await references.nextRevision(member.uid)),
          ));
        }
        await audit(member.uid, action || (existing ? 'restore' : 'create'), existing ? { uid: existing.uid, name: existing.name, primaryProfession: existing.primary_profession, secondaryProfession: existing.secondary_profession, isInGuild: Boolean(existing.is_in_guild), isInClub: Boolean(existing.is_in_club), joinedAt: existing.joined_at } : null, await getMember(member.uid), actor);
        const saved = (await getMember(member.uid));
        if (linkBattles) (await repository.backfillMemberBattleRecords([saved]));
        if (!quiet) memberNotice('add', saved);
        return saved;
      }));
    },
    async updateMember(uid, input, actor, { skipAudit = false } = {}) {
      const member = validateMember(input, { editing: true });
      return (await db.transaction(async () => {
        (await lockMember(uid));
        const [primaryName, secondaryName] = (await professionNames(member));
        const current = (await getMember(uid));
        checkRevision(current, member.revision);
        member.isInGuild ??= current.isInGuild;
        member.isInClub ??= current.isInClub;
        if (
          current.name === member.name &&
          current.primaryProfessionId === member.primaryProfessionId &&
          current.secondaryProfessionId === member.secondaryProfessionId &&
          current.isInGuild === member.isInGuild &&
          current.isInClub === member.isInClub
        )
          return current;
        const now = new Date().toISOString();
        if (current.name !== member.name) (await recordName(uid, current.name, now));
        (await db.prepare(
          `UPDATE members SET name = ?, primary_profession_id = ?, secondary_profession_id = ?, primary_profession = ?, secondary_profession = ?,
          is_in_guild = ?, is_in_club = ?, updated_at = ?, revision = revision + 1 WHERE uid = ?`,
        ).run(
          member.name,
          member.primaryProfessionId,
          member.secondaryProfessionId,
          primaryName,
          secondaryName,
          Number(member.isInGuild),
          Number(member.isInClub),
          now,
          uid,
        ));
        if (!skipAudit) await audit(uid, 'update', current, await getMember(uid), actor);
        const updated = (await getMember(uid));
        memberNotice('update', updated, current.name);
        return updated;
      }));
    },
    async removeMember(uid, revision, actor) {
      validateRevision(revision);
      return (await db.transaction(async () => {
        (await lockMember(uid));
        const current = (await getMember(uid));
        checkRevision(current, revision);
        if (!current.isInGuild && !current.isInClub) return { uid, member: current };
        const now = new Date().toISOString();
        (await db.prepare(
          'UPDATE members SET is_in_guild = 0, is_in_club = 0, updated_at = ?, revision = revision + 1 WHERE uid = ?',
        ).run(now, uid));
        await audit(uid, 'remove', current, await getMember(uid), actor);
        const moved = (await getMember(uid));
        memberNotice('remove', moved);
        return { uid, member: moved };
      }));
    },
  };
  return repository;
}

export function createMysqlRepository(database, { authNow, fileStorage, participationNow } = {}) {
  const store = createStore(database);
  return withFileStorage(exposeRepository(createImplementation(store, authNow, participationNow), store, database), fileStorage, createFileStagingRepository(store));
}
