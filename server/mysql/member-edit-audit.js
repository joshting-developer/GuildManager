import { randomUUID } from 'node:crypto';

const fields = ['uid', 'name', 'primaryProfession', 'secondaryProfession', 'isInGuild', 'isInClub', 'joinedAt'];
export function memberChanges(before, after) {
  return fields.flatMap(field => {
    const oldValue = before?.[field] ?? null, newValue = after?.[field] ?? null;
    return JSON.stringify(oldValue) === JSON.stringify(newValue) ? [] : [{ field, before: oldValue, after: newValue }];
  });
}
export function createMemberEditAudit(db) {
  return async (uid, action, before, after, actor = {}, changes = memberChanges(before, after)) => {
    if (!changes.length) return;
    const accountId = actor?.id ?? null, name = actor?.username || actor?.role || null;
    await db.prepare(`INSERT INTO member_edit_logs
      (id,member_uid,action,actor_account_id,actor_name,source,changes_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), uid, action, accountId, name,
        actor?.source || 'members', JSON.stringify(changes), new Date().toISOString());
  };
}
