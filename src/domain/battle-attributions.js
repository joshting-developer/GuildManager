import { BattleRecordError } from './battle-records.js';

export function memberAffiliation(member) {
  if (!member) return '未匹配';
  if (member.isInGuild && member.isInClub) return '幫會／俱樂部';
  if (member.isInGuild) return '幫會';
  if (member.isInClub) return '俱樂部';
  return '編外';
}
export function battlePlayerName(player) {
  return player.creditedName || player.player || '—';
}
export function battleRosterIndex(members) {
  const byUid = new Map(), byName = new Map();
  for (const member of members) {
    byUid.set(member.uid, member);
    if (!byName.has(member.name)) byName.set(member.name, []);
    byName.get(member.name).push(member);
  }
  return { byUid, byName };
}
export function battlePlayerMember(player, attribution, index) {
  if (attribution) return index.byUid.get(attribution.memberUid) || null;
  if (player.memberUid) return index.byUid.get(player.memberUid) || null;
  const matches = index.byName.get(player.player) || [];
  return matches.length === 1 ? matches[0] : null;
}

export function validateBattleAttributions(input, players) {
  if (input === undefined) return [];
  const invalid = () => { throw new BattleRecordError('數據歸屬資料不正確，請重新選擇成員', 422, 'ATTRIBUTION_INVALID'); };
  if (!Array.isArray(input) || input.length > players.length) invalid();
  const seen = new Set(), keys = ['playerIndex', 'sourcePlayer', 'sourceSide', 'memberUid', 'memberName', 'memberRevision'];
  return input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
        Object.keys(value).some(key => !keys.includes(key))) invalid();
    const { playerIndex, sourcePlayer, sourceSide, memberUid, memberName, memberRevision } = value;
    if (!Number.isSafeInteger(playerIndex) || playerIndex < 0 || !players[playerIndex] || seen.has(playerIndex) ||
        sourcePlayer !== players[playerIndex].player || sourceSide !== players[playerIndex].side ||
        typeof memberUid !== 'string' || !memberUid || memberUid.length > 64 ||
        typeof memberName !== 'string' || !memberName || memberName.length > 64 ||
        !Number.isSafeInteger(memberRevision) || memberRevision < 1) invalid();
    seen.add(playerIndex);
    return { playerIndex, sourcePlayer, sourceSide, memberUid, memberName, memberRevision };
  }).sort((a, b) => a.playerIndex - b.playerIndex);
}

// A display-only name is insufficient: the caller saves these targets as member links.
// Keep the CSV player string and numeric snapshot intact for provenance and hashing.
export function applyBattleAttributions(players, attributions, membersByUid) {
  const targets = new Map();
  for (const value of attributions) {
    const member = membersByUid.get(value.memberUid);
    if (!member || member.name !== value.memberName || member.revision !== value.memberRevision)
      throw new BattleRecordError('歸屬成員資料已變更，請重新載入名冊並確認後再上傳', 409, 'ATTRIBUTION_MEMBER_CHANGED');
    targets.set(value.playerIndex, member);
  }
  return { targets, players: players.map((player, index) => targets.has(index)
    ? { ...player, creditedName: targets.get(index).name } : player) };
}
