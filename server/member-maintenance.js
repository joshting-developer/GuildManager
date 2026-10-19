import { createHash, randomUUID } from 'node:crypto';
import { MemberError } from './member-validation.js';
import { maintenanceInput, validateMemberMaintenance, validateNameHistory,
  projectMemberReferences, remapMemberReferences } from '../src/domain/member-maintenance.js';

export function createMemberReferences(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_reference_overrides (
      kind TEXT NOT NULL, record_id TEXT NOT NULL, overrides_json TEXT NOT NULL,
      PRIMARY KEY(kind, record_id)
    );
    CREATE TABLE IF NOT EXISTS member_maintenance_requests (
      request_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_uid_revisions (
      uid TEXT PRIMARY KEY, revision INTEGER NOT NULL
    );
  `);
  function overrides(kind, id) {
    const row = db.prepare('SELECT overrides_json FROM member_reference_overrides WHERE kind=? AND record_id=?').get(kind, id);
    return row ? JSON.parse(row.overrides_json) : [];
  }
  return {
    nextRevision: (uid) => (db.prepare('SELECT revision FROM member_uid_revisions WHERE uid=?').get(uid)?.revision || 0) + 1,
    retire(uid, revision) {
      db.prepare('INSERT INTO member_uid_revisions VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET revision=MAX(revision, excluded.revision)').run(uid, revision);
    },
    project: (kind, id, value) => projectMemberReferences(value, overrides(kind, id)),
    remap(fromUid, toUid) {
      for (const [kind, table, column] of [
        ['lineup', 'lineup_versions', 'snapshot_json'],
        ['template', 'lineup_templates', 'teams_json'],
        ['battle', 'battle_records', 'players_json'],
      ]) {
        for (const row of db.prepare(`SELECT id, ${column} AS content FROM ${table}`).all()) {
          const old = overrides(kind, row.id);
          const next = remapMemberReferences(JSON.parse(row.content), old, fromUid, toUid);
          if (JSON.stringify(old) !== JSON.stringify(next))
            db.prepare('INSERT OR REPLACE INTO member_reference_overrides VALUES (?, ?, ?)')
              .run(kind, row.id, JSON.stringify(next));
        }
      }
    },
  };
}

export function createMemberMaintenance(db, { getMember, updateMember, references }) {
  function check(current, expected) {
    if (current.revision !== expected)
      throw new MemberError(409, 'STALE_MEMBER', '這位成員的資料已更新，請重新載入後再操作');
  }
  function retry(operation, uid, input, work) {
    return db.transaction(() => {
      const hash = createHash('sha256').update(JSON.stringify([operation, uid, input])).digest('hex');
      const previous = db.prepare('SELECT * FROM member_maintenance_requests WHERE request_id=?').get(input.requestId);
      if (previous) {
        if (previous.input_hash !== hash)
          throw new MemberError(409, 'REQUEST_CONFLICT', '操作識別碼已用於其他資料，請重新操作');
        return JSON.parse(previous.result_json);
      }
      const result = work();
      db.prepare('INSERT INTO member_maintenance_requests VALUES (?, ?, ?)')
        .run(input.requestId, hash, JSON.stringify(result));
      return result;
    })();
  }
  return {
    getMemberMaintenance(uid) { return { member: getMember(uid) }; },
    maintainMember(uid, input) {
      const values = validateMemberMaintenance(input);
      return retry('maintainMember', uid, input, () => {
        const current = getMember(uid);
        check(current, values.revision);
        const { newUid, requestId, ...profile } = values;
        if (newUid !== uid) {
          if (db.prepare('SELECT 1 FROM members WHERE uid=?').get(newUid))
            throw new MemberError(409, 'DUPLICATE_UID', '這個 UID 已在成員清單中', { uid: '這個 UID 已存在' });
          // Copy first, then move foreign keys, then remove the old key, all in one transaction.
          const columns = db.pragma('table_info(members)').map((column) => column.name);
          const row = db.prepare('SELECT * FROM members WHERE uid=?').get(uid);
          db.prepare(`INSERT INTO members (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
            .run(...columns.map((key) => key === 'uid' ? newUid : row[key]));
          for (const [table, column] of [['member_name_history', 'member_uid'],
            ['event_member_responses', 'member_uid'], ['battle_player_links', 'member_uid']])
            db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(newUid, uid);
          db.prepare('UPDATE event_member_responses SET revision=revision+1 WHERE member_uid=?').run(newUid);
          references.remap(uid, newUid);
          references.retire(uid, current.revision);
          db.prepare('DELETE FROM members WHERE uid=?').run(uid);
        }
        const updated = updateMember(newUid, profile);
        if (newUid !== uid)
          db.prepare('UPDATE members SET revision=?, updated_at=? WHERE uid=?')
            .run(Math.max(updated.revision, current.revision + 1, references.nextRevision(newUid)), new Date().toISOString(), newUid);
        return { member: getMember(newUid) };
      });
    },
    saveMemberNameHistory(uid, input) {
      maintenanceInput(input, ['entries', 'revision', 'requestId']);
      return retry('saveMemberNameHistory', uid, input, () => {
        const current = getMember(uid);
        check(current, input.revision);
        const entries = validateNameHistory(input, current);
        const previous = new Map(current.previousNames.map((entry) => [entry.id, entry]));
        db.prepare('DELETE FROM member_name_history WHERE member_uid=?').run(uid);
        const insert = db.prepare('INSERT INTO member_name_history VALUES (?, ?, ?, ?)');
        for (const entry of entries) insert.run(entry.id || randomUUID(), uid, entry.name,
          previous.get(entry.id)?.changedAt || new Date().toISOString());
        db.prepare('UPDATE members SET revision=revision+1, updated_at=? WHERE uid=?').run(new Date().toISOString(), uid);
        return { member: getMember(uid) };
      });
    },
    deleteMemberPermanently(uid, input) {
      maintenanceInput(input, ['revision', 'requestId', 'confirmUid']);
      if (input.confirmUid !== uid)
        throw new MemberError(422, 'CONFIRMATION_REQUIRED', '請輸入完整 UID 確認永久刪除', { confirmUid: 'UID 不一致' });
      return retry('deleteMemberPermanently', uid, input, () => {
        const current = getMember(uid);
        check(current, input.revision);
        references.remap(uid, null);
        references.retire(uid, current.revision);
        for (const table of ['member_name_history', 'event_member_responses', 'battle_player_links'])
          db.prepare(`DELETE FROM ${table} WHERE member_uid=?`).run(uid);
        db.prepare('DELETE FROM members WHERE uid=?').run(uid);
        return { uid, deleted: true };
      });
    },
  };
}
