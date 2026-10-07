import { planBattleMemberSync, publicBattleSyncPlan, validateBattleSyncInput } from '../../src/domain/battle-member-sync.js';
import { canonical, fail, hash, retry } from './common.js';

export function createBattleMemberSync(store) {
  function plan() {
    const records = store.all('battles');
    const snapshots = store.getMany('battle_players', records.map(record => record.id));
    return planBattleMemberSync(
      store.all('members'), store.all('name_history'),
      records.map(record => ({ id: record.id, players: snapshots.get(record.id)?.players || record.players })),
      store.all('battle_links'),
    );
  }
  return {
    previewBattleMemberSync: () => {
      const preview = plan();
      return { ...publicBattleSyncPlan(preview), fingerprint: hash(canonical(preview)) };
    },
    syncBattleMembers: ([input]) => {
      const values = validateBattleSyncInput(input);
      return retry(store, 'syncBattleMembers', values.requestId, { fingerprint: values.fingerprint }, () => {
        const preview = plan();
        if (hash(canonical(preview)) !== values.fingerprint)
          fail('STALE_SYNC_PREVIEW', '成員或戰績資料已變動，請重新預覽後同步');
        for (const row of preview.assignments) store.put('battle_links', `${row.recordId}:${row.playerIndex}`, row);
        return { ...publicBattleSyncPlan(preview), linkedPlayers: preview.assignments.length };
      });
    },
  };
}
