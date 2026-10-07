import { BattleRecordError } from './battle-records.js';

export function validateBattleSyncInput(input) {
  if (
    !input ||
    typeof input.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.fingerprint || '') ||
    typeof input.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId)
  ) throw new BattleRecordError('同步資料不正確，請重新預覽', 422, 'INVALID_SYNC_REQUEST');
  return { fingerprint: input.fingerprint, requestId: input.requestId };
}

export function planBattleMemberSync(members, history, records, links) {
  const memberMap = new Map(members.map(member => [member.uid, member]));
  const owners = new Map();
  function addName(name, uid) {
    if (!memberMap.has(uid) || typeof name !== 'string' || !name) return;
    if (!owners.has(name)) owners.set(name, new Set());
    owners.get(name).add(uid);
  }
  for (const member of members) addName(member.name, member.uid);
  for (const entry of history) addName(entry.name, entry.uid);
  const assigned = new Set(links.map(link => JSON.stringify([link.recordId, link.playerIndex])));
  const summary = {
    records: records.length, players: 0, alreadyLinked: 0, eligiblePlayers: 0,
    currentNamePlayers: 0, historyNamePlayers: 0, conflictPlayers: 0,
    unmatchedPlayers: 0, matchedMembers: 0,
  };
  const matches = new Map(), conflicts = new Map(), assignments = [], matchedMembers = new Set();
  for (const record of records) {
    if (!Array.isArray(record.players))
      throw new BattleRecordError('戰績玩家資料不完整，請聯絡管理者', 500, 'STORAGE_CORRUPT');
    record.players.forEach((player, playerIndex) => {
      summary.players++;
      if (player.memberUid || assigned.has(JSON.stringify([record.id, playerIndex]))) {
        summary.alreadyLinked++;
        return;
      }
      const candidates = [...(owners.get(player.player) || [])].sort();
      if (!candidates.length) { summary.unmatchedPlayers++; return; }
      if (candidates.length > 1) {
        summary.conflictPlayers++;
        if (!conflicts.has(player.player)) conflicts.set(player.player, {
          name: player.player,
          candidates: candidates.map(uid => ({ memberUid: uid, memberName: memberMap.get(uid).name })),
          count: 0,
        });
        conflicts.get(player.player).count++;
        return;
      }
      const memberUid = candidates[0], memberName = memberMap.get(memberUid).name;
      const matchType = memberName === player.player ? 'current' : 'history';
      summary.eligiblePlayers++;
      summary[matchType === 'current' ? 'currentNamePlayers' : 'historyNamePlayers']++;
      matchedMembers.add(memberUid);
      assignments.push({ recordId: record.id, playerIndex, memberUid });
      if (!matches.has(player.player)) matches.set(player.player, {
        name: player.player, memberUid, memberName, matchType, count: 0,
      });
      matches.get(player.player).count++;
    });
  }
  summary.matchedMembers = matchedMembers.size;
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    // Keep roster changes detectable even when every matching row is already linked.
    roster: members.map(({ uid, name }) => ({ uid, name })).sort((a, b) => a.uid.localeCompare(b.uid)),
    history: history.map(({ uid, name }) => ({ uid, name })).sort((a, b) => a.uid.localeCompare(b.uid) || a.name.localeCompare(b.name)),
    summary,
    matches: [...matches.values()].sort(byName),
    conflicts: [...conflicts.values()].sort(byName),
    assignments: assignments.sort((a, b) => a.recordId.localeCompare(b.recordId) || a.playerIndex - b.playerIndex),
  };
}

export function publicBattleSyncPlan({ summary, matches, conflicts }) {
  return { summary, matches, conflicts };
}
