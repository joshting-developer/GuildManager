import { uniqueNewMemberNames } from '../../src/domain/battle-member-links.js';
import { fail } from './common.js';

export function linkNewMemberBattles(store, newMembers) {
  const names = uniqueNewMemberNames(store.all('members'), newMembers);
  if (!names.size) return;
  const records = store.all('battles');
  const snapshots = store.getMany('battle_players', records.map((record) => record.id));
  const assigned = new Set(
    store.all('battle_links').map((link) => `${link.recordId}:${link.playerIndex}`),
  );
  for (const record of records) {
    const players = snapshots.get(record.id)?.players || record.players;
    if (!Array.isArray(players)) fail('STORAGE_CORRUPT', '戰績玩家資料不完整，請聯絡管理者');
    players.forEach((player, playerIndex) => {
      const key = `${record.id}:${playerIndex}`;
      const memberUid = names.get(player.player);
      // Original snapshots and already assigned identities remain unchanged.
      if (!memberUid || player.memberUid || assigned.has(key)) return;
      store.put('battle_links', key, { recordId: record.id, playerIndex, memberUid });
      assigned.add(key);
    });
  }
}
