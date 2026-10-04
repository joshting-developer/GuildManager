import Database from 'better-sqlite3';
import { createPlatformSettingsRepository } from './platform-settings-repository.js';
import { createAuthRepository } from './auth-repository.js';
import { createEventRepository } from './event-repository.js';
import { createLineupRepository } from './lineup-repository.js';
import { createParticipationRepository } from './participation-repository.js';
import { createDutyRepository } from './duty-repository.js';
import { createBattleRecordRepository } from './battle-record-repository.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseMemberImport } from './member-import.js';
import { MemberError, validateMember, validateRevision } from './member-validation.js';

export function createRepository({ filename, authNow }) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      guild_name TEXT NOT NULL,
      member_count INTEGER NOT NULL,
      attendance_rate INTEGER,
      pending_registrations INTEGER NOT NULL,
      data_mode TEXT NOT NULL CHECK (data_mode IN ('demo', 'empty')),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      registered INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      note TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS professions (
      job_id INTEGER PRIMARY KEY,
      colorcode TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS members (
      uid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      primary_profession_id INTEGER REFERENCES professions(job_id),
      secondary_profession_id INTEGER REFERENCES professions(job_id),
      primary_profession TEXT NOT NULL,
      secondary_profession TEXT NOT NULL DEFAULT '',
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS member_name_history (
      id TEXT PRIMARY KEY,
      member_uid TEXT NOT NULL REFERENCES members(uid),
      name TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_by_uid ON member_name_history(member_uid);
  `);

  const jobs = [
    [1, '#ffb6c1', '素問'],
    [2, '#3cb371', '龍吟'],
    [3, '#add8e6', '碎夢'],
    [4, '#00bfff', '潮光'],
    [5, '#f0e68c', '玄機'],
    [6, '#9932cc', '九靈'],
    [7, '#ff8c00', '鐵衣'],
    [8, '#8b0000', '血河'],
    [9, '#4682b4', '神相'],
  ];
  // Keep existing text columns as migration snapshots; IDs are authoritative for new writes.
  db.transaction(() => {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO professions (job_id, colorcode, name) VALUES (?, ?, ?)',
    );
    for (const job of jobs) insert.run(...job);
    const columns = db.pragma('table_info(members)').map((column) => column.name);
    for (const column of ['primary_profession_id', 'secondary_profession_id']) {
      if (!columns.includes(column))
        db.exec(`ALTER TABLE members ADD COLUMN ${column} INTEGER REFERENCES professions(job_id)`);
    }
    if (!columns.includes('is_in_guild')) {
      db.exec(
        'ALTER TABLE members ADD COLUMN is_in_guild INTEGER NOT NULL DEFAULT 1 CHECK (is_in_guild IN (0, 1))',
      );
      db.exec('UPDATE members SET is_in_guild = 0 WHERE removed_at IS NOT NULL');
    }
    if (!columns.includes('is_in_club'))
      db.exec(
        'ALTER TABLE members ADD COLUMN is_in_club INTEGER NOT NULL DEFAULT 0 CHECK (is_in_club IN (0, 1))',
      );
    for (const type of ['primary', 'secondary']) {
      db.exec(`UPDATE members SET ${type}_profession_id =
        (SELECT job_id FROM professions WHERE name = members.${type}_profession)
        WHERE ${type}_profession_id IS NULL AND ${type}_profession != ''`);
    }
    // Former soft removals become external personnel; only legacy rows are changed.
    db.prepare(
      `UPDATE members SET is_in_guild = 0, is_in_club = 0, removed_at = NULL,
      updated_at = ?, revision = revision + 1 WHERE removed_at IS NOT NULL`,
    ).run(new Date().toISOString());
  })();
  const memberColumns = `m.uid, m.name, m.primary_profession_id AS primaryProfessionId,
    m.secondary_profession_id AS secondaryProfessionId,
    m.is_in_guild AS isInGuild, m.is_in_club AS isInClub,
    COALESCE(p.name, m.primary_profession) AS primaryProfession,
    COALESCE(s.name, m.secondary_profession) AS secondaryProfession,
    m.joined_at AS joinedAt, m.updated_at AS updatedAt, m.revision`;
  const memberFrom = `members m LEFT JOIN professions p ON p.job_id = m.primary_profession_id
    LEFT JOIN professions s ON s.job_id = m.secondary_profession_id`;
  function professionNames(member) {
    const names = [];
    for (const [field, label] of [
      ['primaryProfessionId', '主職業'],
      ['secondaryProfessionId', '副職業'],
    ]) {
      if (member[field] === null) {
        names.push('');
        continue;
      }
      const job = db.prepare('SELECT name FROM professions WHERE job_id = ?').get(member[field]);
      if (!job)
        throw new MemberError(422, 'VALIDATION_ERROR', '請重新選擇職業', {
          [field]: `${label}不存在，請重新載入職業清單`,
        });
      names.push(job.name);
    }
    return names;
  }
  function previousNames(uid) {
    return db
      .prepare(
        `SELECT id, name, changed_at AS changedAt FROM member_name_history
      WHERE member_uid = ? ORDER BY changed_at DESC, rowid DESC`,
      )
      .all(uid);
  }
  function getMember(uid) {
    const row = db
      .prepare(
        `SELECT ${memberColumns} FROM ${memberFrom} WHERE m.uid = ? AND m.removed_at IS NULL`,
      )
      .get(uid);
    if (!row) throw new MemberError(404, 'MEMBER_NOT_FOUND', '找不到這位成員，可能已被移除');
    return {
      ...row,
      isInGuild: Boolean(row.isInGuild),
      isInClub: Boolean(row.isInClub),
      previousNames: previousNames(uid),
    };
  }
  function checkRevision(member, revision) {
    if (member.revision !== revision) {
      throw new MemberError(409, 'STALE_MEMBER', '這位成員的資料已更新，請重新載入後再操作');
    }
  }
  function recordName(uid, name, time) {
    db.prepare('INSERT INTO member_name_history VALUES (?, ?, ?, ?)').run(
      randomUUID(),
      uid,
      name,
      time,
    );
  }

  function previewMemberImport(input) {
    const jobs = db.prepare('SELECT job_id, name FROM professions ORDER BY job_id').all();
    const parsed = parseMemberImport(input?.text, jobs);
    const states = [];
    const summary = { added: 0, restored: 0, skipped: 0 };
    const rows = parsed.rows.map((row) => {
      const existing = db
        .prepare('SELECT revision, removed_at FROM members WHERE uid = ?')
        .get(row.uid);
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

  // Initialize settings only; never seed fictional people, events or statistics.
  db.prepare('INSERT OR IGNORE INTO home_settings VALUES (1, ?, 0, NULL, 0, ?, ?)').run(
    '你的幫會',
    'empty',
    new Date().toISOString(),
  );

  const repository = {
    ...createAuthRepository(db, { now: authNow }),
    ...createEventRepository(db),
    ...createDutyRepository(db),
    ...createParticipationRepository(db),
    ...createLineupRepository(db),
    ...createBattleRecordRepository(db),
    ...createPlatformSettingsRepository(db),
    previewMemberImport,
    importMembers(input) {
      return db.transaction(() => {
        const preview = previewMemberImport(input);
        if (preview.issues.length) {
          const error = new MemberError(422, 'IMPORT_INVALID', '資料有錯誤，請修正後重新預覽');
          error.rows = preview.issues;
          throw error;
        }
        if (!input?.fingerprint || input.fingerprint !== preview.fingerprint) {
          throw new MemberError(409, 'STALE_IMPORT', '資料或成員清單已變動，請重新預覽後再匯入');
        }
        const members = preview.rows
          .filter((row) => row.action !== 'skip')
          .map((row) =>
            repository.addMember({
              uid: row.uid,
              name: row.name,
              primaryProfessionId: row.primaryProfessionId,
              secondaryProfessionId: row.secondaryProfessionId,
            }),
          );
        return { members, summary: preview.summary };
      })();
    },
    listProfessions() {
      return {
        professions: db
          .prepare('SELECT job_id, colorcode, name FROM professions ORDER BY job_id')
          .all(),
      };
    },
    listParticipationMembers() {
      return {
        members: db
          .prepare('SELECT uid, name FROM members WHERE removed_at IS NULL ORDER BY name, uid')
          .all(),
      };
    },
    listMembers() {
      const members = db
        .prepare(
          `SELECT ${memberColumns} FROM ${memberFrom} WHERE m.removed_at IS NULL ORDER BY m.joined_at, m.uid`,
        )
        .all();
      const histories = db
        .prepare(
          `SELECT id, member_uid, name, changed_at AS changedAt FROM member_name_history
        WHERE member_uid IN (SELECT uid FROM members WHERE removed_at IS NULL)
        ORDER BY changed_at DESC, rowid DESC`,
        )
        .all();
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
    addMember(input) {
      const member = validateMember(input);
      return db.transaction(() => {
        const [primaryName, secondaryName] = professionNames(member);
        const existing = db.prepare('SELECT * FROM members WHERE uid = ?').get(member.uid);
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
          if (existing.name !== member.name) recordName(member.uid, existing.name, now);
          db.prepare(
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
          );
        } else {
          db.prepare(
            `INSERT INTO members (uid, name, primary_profession_id, secondary_profession_id, primary_profession, secondary_profession, is_in_guild, is_in_club, joined_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          );
        }
        return getMember(member.uid);
      })();
    },
    updateMember(uid, input) {
      const member = validateMember(input, { editing: true });
      return db.transaction(() => {
        const [primaryName, secondaryName] = professionNames(member);
        const current = getMember(uid);
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
        if (current.name !== member.name) recordName(uid, current.name, now);
        db.prepare(
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
        );
        return getMember(uid);
      })();
    },
    removeMember(uid, revision) {
      validateRevision(revision);
      return db.transaction(() => {
        const current = getMember(uid);
        checkRevision(current, revision);
        if (!current.isInGuild && !current.isInClub) return { uid, member: current };
        const now = new Date().toISOString();
        db.prepare(
          'UPDATE members SET is_in_guild = 0, is_in_club = 0, updated_at = ?, revision = revision + 1 WHERE uid = ?',
        ).run(now, uid);
        return { uid, member: getMember(uid) };
      })();
    },
    readHome() {
      const row = db.prepare('SELECT guild_name, updated_at FROM home_settings WHERE id = 1').get();
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
    close() {
      db.close();
    },
  };
  return repository;
}
