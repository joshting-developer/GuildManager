import { MemberError } from '../member-validation.js';

const columns = `m.uid, m.name, m.primary_profession_id AS primaryProfessionId,
  m.secondary_profession_id AS secondaryProfessionId, m.is_in_guild AS isInGuild,
  m.is_in_club AS isInClub, COALESCE(p.name, m.primary_profession) AS primaryProfession,
  COALESCE(s.name, m.secondary_profession) AS secondaryProfession,
  m.joined_at AS joinedAt, m.updated_at AS updatedAt, m.revision`;
const from = `members m LEFT JOIN professions p ON p.job_id=m.primary_profession_id
  LEFT JOIN professions s ON s.job_id=m.secondary_profession_id`;

function member(row, previousNames) {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MemberError(500, 'INVALID_STORED_REVISION', '成員版本資料不正確, 請聯絡管理者');
  }
  return { ...row, revision, isInGuild: Boolean(Number(row.isInGuild)), isInClub: Boolean(Number(row.isInClub)), previousNames };
}

export function createMysqlMemberRepository(database) {
  return {
    async listProfessions() {
      return { professions: await database.query('SELECT job_id, colorcode, name FROM professions ORDER BY job_id') };
    },
    async listMembers() {
      return database.transaction(async (transaction) => {
        const members = await transaction.query(`SELECT ${columns} FROM ${from} WHERE m.removed_at IS NULL ORDER BY m.joined_at, m.uid`);
        const histories = await transaction.query(`SELECT id, member_uid AS memberUid, name, changed_at AS changedAt
          FROM member_name_history WHERE member_uid IN (SELECT uid FROM members WHERE removed_at IS NULL)
          ORDER BY changed_at DESC, created_order DESC`);
        const byUid = new Map();
        for (const { memberUid, ...history } of histories) {
          if (!byUid.has(memberUid)) byUid.set(memberUid, []);
          byUid.get(memberUid).push(history);
        }
        return { members: members.map((row) => member(row, byUid.get(row.uid) || [])) };
      }, { readOnly: true });
    },
    async getMember(uid) {
      return database.transaction(async (transaction) => {
        const [row] = await transaction.query(`SELECT ${columns} FROM ${from} WHERE m.uid=? AND m.removed_at IS NULL`, [uid]);
        if (!row) throw new MemberError(404, 'MEMBER_NOT_FOUND', '找不到這位成員, 請重新載入');
        const history = await transaction.query('SELECT id, name, changed_at AS changedAt FROM member_name_history WHERE member_uid=? ORDER BY changed_at DESC, created_order DESC', [uid]);
        return member(row, history);
      }, { readOnly: true });
    },
  };
}
