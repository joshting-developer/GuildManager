import { withFileStorage } from '../services/file-backed-repository.js';
import { createStore, exposeRepository } from './store.js';
import { asyncMap } from "./collections.js";
import { lineupEditorEventId } from '../../src/domain/lineup-index.js';
import { LineupError } from '../../src/domain/lineup-validation.js';
import { videoBrowserSelection } from '../../src/domain/video-browser.js';
import { createMemberReferences, createMemberMaintenance } from './member-maintenance.js';

import { createPlatformSettingsRepository } from './platform-settings-repository.js';
import { createAuthRepository } from './auth-repository.js';
import { createEventRepository } from './event-repository.js';
import { createLineupRepository } from './lineup-repository.js';
import { createParticipationRepository } from './participation-repository.js';
import { createEventVideoRepository } from './event-video-repository.js';
import { createDutyRepository } from './duty-repository.js';
import { createBattleRecordRepository } from './battle-record-repository.js';
import { createLotteryRepository } from './lottery-repository.js';
import { randomUUID, createHash } from 'node:crypto';
import { parseMemberImport } from '../member-import.js';
import { MemberError, validateMember, validateRevision } from '../member-validation.js';

function createImplementation(store, authNow) {
  const db = store;
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
    const rows = (await asyncMap(parsed.rows, async (row) => {
      const existing = (await db
        .prepare('SELECT revision, removed_at FROM members WHERE uid = ?')
        .get(row.uid));
      const action = !existing ? 'add' : existing.removed_at === null ? 'skip' : 'restore';
      states.push(existing || null);
      summary[action === 'add' ? 'added' : action === 'restore' ? 'restored' : 'skipped'] += 1;
      return { ...row, action };
    }));
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
    ...createParticipationRepository(db, { notify }),
    ...createEventVideoRepository(db),
    ...createLineupRepository(db, { project: references.project }),
    ...createBattleRecordRepository(db, { project: references.project }),
    ...createMemberMaintenance(db, { getMember, updateMember: async (...args) => (await repository.updateMember(...args)), references }),
    ...createPlatformSettingsRepository(db),
    ...createLotteryRepository(db),
    async getLineupEditor(preferredId = null) {
      return (await db.transaction(async () => {
        const events = (await repository.getLineupEvents());
        const eventId = lineupEditorEventId(events, preferredId);
        return { events, ...(await repository.getLineupCatalogs()),
          selected: eventId ? { eventId, ...(await repository.getLineupEvent(eventId)) } : null };
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
    async getVideoBrowser(preferredId = null) {
      return (await db.transaction(async () => {
        const { events, eventId } = videoBrowserSelection((await repository.listEvents()).events, preferredId);
        return { events, selected: eventId ? (await repository.listEventVideos(eventId)) : null };
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
    async importMembers(input) {
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
              { linkBattles: false, quiet: true },
            ))));
        (await repository.backfillMemberBattleRecords(members));
        if (members.length) notify({ type: 'member-import', members, summary: preview.summary });
        return { members, summary: preview.summary };
      }));
    },
    async listProfessions() {
      return {
        professions: (await db
          .prepare('SELECT job_id, colorcode, name FROM professions ORDER BY job_id')
          .all()),
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
    async addMember(input, { linkBattles = true, quiet = false } = {}) {
      const member = validateMember(input);
      return (await db.transaction(async () => {
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
        const saved = (await getMember(member.uid));
        if (linkBattles) (await repository.backfillMemberBattleRecords([saved]));
        if (!quiet) memberNotice('add', saved);
        return saved;
      }));
    },
    async updateMember(uid, input) {
      const member = validateMember(input, { editing: true });
      return (await db.transaction(async () => {
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
        const updated = (await getMember(uid));
        memberNotice('update', updated, current.name);
        return updated;
      }));
    },
    async removeMember(uid, revision) {
      validateRevision(revision);
      return (await db.transaction(async () => {
        const current = (await getMember(uid));
        checkRevision(current, revision);
        if (!current.isInGuild && !current.isInClub) return { uid, member: current };
        const now = new Date().toISOString();
        (await db.prepare(
          'UPDATE members SET is_in_guild = 0, is_in_club = 0, updated_at = ?, revision = revision + 1 WHERE uid = ?',
        ).run(now, uid));
        const moved = (await getMember(uid));
        memberNotice('remove', moved);
        return { uid, member: moved };
      }));
    },
    async readHome() {
      const row = (await db.prepare('SELECT guild_name, updated_at FROM home_settings WHERE id = 1').get());
      return {
        guild: { name: row.guild_name },
        summary: {
          members: null,
          upcomingEvents: null,
          attendanceRate: null,
          pendingRegistrations: null,
        },
        events: [],
        meta: { mode: 'empty', updatedAt: row.updated_at },
      };
    },

  };
  return repository;
}

export function createMysqlRepository(database, { authNow, fileStorage } = {}) {
  const store = createStore(database);
  return withFileStorage(exposeRepository(createImplementation(store, authNow), store, database), fileStorage);
}
