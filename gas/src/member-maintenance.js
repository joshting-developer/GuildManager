import { maintenanceInput, validateMemberMaintenance, validateNameHistory,
  projectMemberReferences, remapMemberReferences } from '../../src/domain/member-maintenance.js';
import { canonical, fail, retry } from './common.js';

// Reserved keys cannot collide with user request IDs (which cannot contain ':').
const referenceKey = (kind, id) => `member-ref:${kind}:${id}`;
export function projectReferences(store, kind, id, value) {
  return projectMemberReferences(value, store.get('requests', referenceKey(kind, id))?.overrides || []);
}

export function createMemberMaintenance(store, catalog, { uuid, now }) {
  const dto = (uid) => catalog.methods.getMembers().members.find((member) => member.uid === uid);
  function check(current, expected) {
    if (current.revision !== expected)
      fail('STALE_MEMBER', '這位成員的資料已更新，請重新載入後再操作');
  }
  function remap(fromUid, toUid) {
    for (const [kind, table] of [['lineup', 'lineup_versions'], ['template', 'templates'], ['battle', 'battles']]) {
      for (const record of store.all(table)) {
        const value = kind === 'battle' ? store.get('battle_players', record.id)?.players || record.players : record;
        const key = referenceKey(kind, record.id);
        const old = store.get('requests', key)?.overrides || [];
        const next = remapMemberReferences(value, old, fromUid, toUid);
        if (canonical(next) !== canonical(old)) store.put('requests', key, { overrides: next });
      }
    }
  }
  function moveRelations(fromUid, toUid) {
    for (const row of store.all('name_history').filter((entry) => entry.uid === fromUid)) {
      if (toUid === null) store.remove('name_history', row.id);
      else store.put('name_history', row.id, { ...row, uid: toUid });
    }
    for (const row of store.all('responses').filter((entry) => entry.uid === fromUid)) {
      store.remove('responses', canonical([row.eventId, fromUid]));
      if (toUid !== null) store.put('responses', canonical([row.eventId, toUid]),
        { ...row, uid: toUid, revision: row.revision + 1 });
    }
    for (const row of store.all('battle_links').filter((entry) => entry.memberUid === fromUid)) {
      const key = `${row.recordId}:${row.playerIndex}`;
      if (toUid === null) store.remove('battle_links', key);
      else store.put('battle_links', key, { ...row, memberUid: toUid });
    }
    remap(fromUid, toUid);
  }
  function retire(uid, revision) {
    const key = `member-revision:${uid}`;
    store.put('requests', key, { revision: Math.max(revision, store.get('requests', key)?.revision || 0) });
  }
  return {
    getMemberMaintenance([uid]) {
      catalog.member(uid);
      return { member: dto(uid) };
    },
    maintainMember([uid, input]) {
      const values = validateMemberMaintenance(input);
      return retry(store, 'maintainMember', input.requestId, { uid, input }, () => {
        const current = catalog.member(uid);
        check(current, input.revision);
        const { newUid, requestId, ...profile } = values;
        if (newUid !== uid) {
          if (store.get('members', newUid)) fail('DUPLICATE_UID', '這個 UID 已在成員清單中', { uid: '這個 UID 已存在' });
          store.put('members', newUid, { ...current, uid: newUid });
          moveRelations(uid, newUid);
          retire(uid, current.revision);
          store.remove('members', uid);
        }
        catalog.methods.updateMember([newUid, profile]);
        const updated = catalog.member(newUid);
        if (newUid !== uid)
          store.put('members', newUid, { ...updated, revision: Math.max(updated.revision, current.revision + 1,
            (store.get('requests', `member-revision:${newUid}`)?.revision || 0) + 1), updatedAt: now() });
        return { member: dto(newUid) };
      });
    },
    saveMemberNameHistory([uid, input]) {
      maintenanceInput(input, ['entries', 'revision', 'requestId']);
      return retry(store, 'saveMemberNameHistory', input.requestId, { uid, input }, () => {
        const current = catalog.member(uid);
        check(current, input.revision);
        const before = dto(uid);
        const entries = validateNameHistory(input, before);
        const previous = new Map(before.previousNames.map((entry) => [entry.id, entry]));
        for (const old of before.previousNames) store.remove('name_history', old.id);
        for (const entry of entries) {
          const id = entry.id || uuid();
          store.put('name_history', id, { id, uid, name: entry.name, changedAt: previous.get(entry.id)?.changedAt || now() });
        }
        store.put('members', uid, { ...current, revision: current.revision + 1, updatedAt: now() });
        return { member: dto(uid) };
      });
    },
    deleteMemberPermanently([uid, input]) {
      maintenanceInput(input, ['revision', 'requestId', 'confirmUid']);
      if (input.confirmUid !== uid) fail('CONFIRMATION_REQUIRED', '請輸入完整 UID 確認永久刪除', { confirmUid: 'UID 不一致' });
      return retry(store, 'deleteMemberPermanently', input.requestId, { uid, input }, () => {
        const current = catalog.member(uid);
        check(current, input.revision);
        moveRelations(uid, null);
        retire(uid, current.revision);
        store.remove('members', uid);
        return { uid, deleted: true };
      });
    },
  };
}
