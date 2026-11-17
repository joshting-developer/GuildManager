import { createHash, randomUUID } from 'node:crypto';
import { MemberError } from '../member-validation.js';
import { maintenanceInput, validateMemberMaintenance, validateNameHistory,
  projectMemberReferences, remapMemberReferences } from '../../src/domain/member-maintenance.js';

export function createMemberReferences(db) {
  async function overrides(kind, id) {
    const row = (await db.prepare('SELECT overrides_json FROM member_reference_overrides WHERE kind=? AND record_id=?').get(kind, id));
    return row ? JSON.parse(row.overrides_json) : [];
  }
  return {
    nextRevision: async (uid) => ((await db.prepare('SELECT revision FROM member_uid_revisions WHERE uid=?').get(uid))?.revision || 0) + 1,
    async retire(uid, revision) {
      (await db.prepare('INSERT INTO member_uid_revisions VALUES (?, ?) ON DUPLICATE KEY UPDATE revision=GREATEST(revision, VALUES(revision))').run(uid, revision));
    },
    project: async (kind, id, value) => projectMemberReferences(value, (await overrides(kind, id))),
    async remap(fromUid, toUid) {
      for (const [kind, table, column] of [
        ['lineup', 'lineup_versions', 'snapshot_json'],
        ['template', 'lineup_templates', 'teams_json'],
        ['battle', 'battle_records', 'players_json'],
      ]) {
        for (const row of (await db.prepare(`SELECT id, ${column} AS content FROM ${table}`).all())) {
          const old = (await overrides(kind, row.id));
          const next = remapMemberReferences(JSON.parse(row.content), old, fromUid, toUid);
          if (JSON.stringify(old) !== JSON.stringify(next))
            (await db.prepare('INSERT INTO member_reference_overrides (kind,record_id,overrides_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE overrides_json=VALUES(overrides_json)')
              .run(kind, row.id, JSON.stringify(next)));
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
  async function retry(operation, uid, input, work) {
    return (await db.transaction(async () => {
      const hash = createHash('sha256').update(JSON.stringify([operation, uid, input])).digest('hex');
      const previous = (await db.prepare('SELECT * FROM member_maintenance_requests WHERE request_id=?').get(input.requestId));
      if (previous) {
        if (previous.input_hash !== hash)
          throw new MemberError(409, 'REQUEST_CONFLICT', '操作識別碼已用於其他資料，請重新操作');
        return JSON.parse(previous.result_json);
      }
      const result = (await work());
      (await db.prepare('INSERT INTO member_maintenance_requests VALUES (?, ?, ?)')
        .run(input.requestId, hash, JSON.stringify(result)));
      return result;
    }));
  }
  return {
    async getMemberMaintenance(uid) { return { member: (await getMember(uid)) }; },
    async maintainMember(uid, input) {
      const values = validateMemberMaintenance(input);
      return (await retry('maintainMember', uid, input, async () => {
        const current = (await getMember(uid));
        check(current, values.revision);
        const { newUid, requestId, ...profile } = values;
        if (newUid !== uid) {
          if ((await db.prepare('SELECT 1 FROM members WHERE uid=?').get(newUid)))
            throw new MemberError(409, 'DUPLICATE_UID', '這個 UID 已在成員清單中', { uid: '這個 UID 已存在' });
          // Copy first, then move foreign keys, then remove the old key, all in one transaction.
          const columns = (await db.memberColumns()).map((column) => column.name);
          const row = (await db.prepare('SELECT * FROM members WHERE uid=?').get(uid));
          (await db.prepare(`INSERT INTO members (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
            .run(...columns.map((key) => key === 'uid' ? newUid : row[key])));
          for (const [table, column] of [['member_name_history', 'member_uid'],
            ['event_member_responses', 'member_uid'], ['battle_player_links', 'member_uid'], ['attendance_records', 'member_uid']])
            (await db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(newUid, uid));
          (await db.prepare('UPDATE event_member_responses SET revision=revision+1 WHERE member_uid=?').run(newUid));
          (await references.remap(uid, newUid));
          (await references.retire(uid, current.revision));
          (await db.prepare('DELETE FROM members WHERE uid=?').run(uid));
        }
        const updated = (await updateMember(newUid, profile));
        if (newUid !== uid)
          (await db.prepare('UPDATE members SET revision=?, updated_at=? WHERE uid=?')
            .run(Math.max(updated.revision, current.revision + 1, (await references.nextRevision(newUid))), new Date().toISOString(), newUid));
        return { member: (await getMember(newUid)) };
      }));
    },
    async saveMemberNameHistory(uid, input) {
      maintenanceInput(input, ['entries', 'revision', 'requestId']);
      return (await retry('saveMemberNameHistory', uid, input, async () => {
        const current = (await getMember(uid));
        check(current, input.revision);
        const entries = validateNameHistory(input, current);
        const previous = new Map(current.previousNames.map((entry) => [entry.id, entry]));
        (await db.prepare('DELETE FROM member_name_history WHERE member_uid=?').run(uid));
        const insert = db.prepare('INSERT INTO member_name_history (id,member_uid,name,changed_at) VALUES (?, ?, ?, ?)');
        for (const entry of entries) (await insert.run(entry.id || randomUUID(), uid, entry.name,
          previous.get(entry.id)?.changedAt || new Date().toISOString()));
        (await db.prepare('UPDATE members SET revision=revision+1, updated_at=? WHERE uid=?').run(new Date().toISOString(), uid));
        return { member: (await getMember(uid)) };
      }));
    },
    async deleteMemberPermanently(uid, input) {
      maintenanceInput(input, ['revision', 'requestId', 'confirmUid']);
      if (input.confirmUid !== uid)
        throw new MemberError(422, 'CONFIRMATION_REQUIRED', '請輸入完整 UID 確認永久刪除', { confirmUid: 'UID 不一致' });
      return (await retry('deleteMemberPermanently', uid, input, async () => {
        const current = (await getMember(uid));
        check(current, input.revision);
        (await references.remap(uid, null));
        (await references.retire(uid, current.revision));
        for (const table of ['attendance_records', 'member_name_history', 'event_member_responses', 'battle_player_links'])
          (await db.prepare(`DELETE FROM ${table} WHERE member_uid=?`).run(uid));
        (await db.prepare('DELETE FROM members WHERE uid=?').run(uid));
        return { uid, deleted: true };
      }));
    },
  };
}
