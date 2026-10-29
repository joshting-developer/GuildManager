import { BattleRecordError } from './battle-records.js';
import { battlePlayerName } from './battle-attributions.js';

export const TEAM_ANALYSIS_GROUPS = [
  { id: 'attack1', name: '進攻1', teams: ['attack-1', 'attack-2', 'attack-3'], attack: true },
  { id: 'attack2', name: '進攻2', teams: ['mobile-1', 'mobile-2', 'mobile-3'], attack: true },
  { id: 'defense12', name: '防守12隊', teams: ['defense-1', 'defense-2'], attack: false },
  { id: 'defense34', name: '防守34隊', teams: ['defense-3', 'defense-4'], attack: false },
];
export const ATTACK_ANALYSIS_METRICS = [
  ['塔傷', 'buildingDamage'], ['承傷', 'damageTaken'], ['人傷', 'playerDamage'],
  ['擊殺', 'kill'], ['助攻', 'assist'], ['重傷', 'seriousInjury'],
  ['治療', 'heal'], ['化羽/清泉', 'revive'],
];
export const DEFENSE_ANALYSIS_METRICS = [
  ['人傷', 'playerDamage'], ['擊殺', 'kill'], ['助攻', 'assist'], ['資源', 'resource'],
  ['重傷', 'seriousInjury'], ['治療', 'heal'], ['化羽/清泉', 'revive'],
];
const keys = [...new Set([...ATTACK_ANALYSIS_METRICS, ...DEFENSE_ANALYSIS_METRICS].map(([, key]) => key))];
function indexBy(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    if (!index.has(value)) index.set(value, []);
    index.get(value).push(row);
  }
  return index;
}
function totals(rows) {
  return Object.fromEntries(keys.map((key) => {
    const values = rows.map((row) => row[key]).filter(Number.isFinite);
    return [key, {
      value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
      missing: rows.length - values.length,
    }];
  }));
}
function percentage(value, total) {
  return Number.isFinite(value) && !total.missing && total.value > 0
    ? value / total.value * 100 : null;
}

// Only the saved lineup is consulted. Never mutate player snapshots or infer a round/side.
function matchBattlePlayers(record, lineup) {
  let unavailable = null;
  if (!record.eventId) unavailable = '這筆戰績未關聯活動，無法對應排表。';
  else if (![1, 2].includes(record.roundNumber)) unavailable = '這筆戰績未指定場序，無法判斷第一／第二場人選。';
  else if (!lineup) unavailable = '這個活動尚未儲存排表，玩家暫列未歸類。';
  else if (lineup.event && (lineup.event.type !== record.type ||
    !lineup.event.dates?.includes(record.playedAt?.slice(0, 10))))
    unavailable = '最後儲存的排表日期或類型與這筆戰績不同，暫不分團。';
  const assignments = unavailable ? [] : lineup.teams.flatMap((team) => {
    const group = TEAM_ANALYSIS_GROUPS.find((item) => item.teams.includes(team.id));
    if (!group) return [];
    return team.slots.flatMap((slot) => {
      const chosen = record.roundNumber === 2 ? slot.secondRound || slot : slot;
      return chosen.member ? [{
        groupId: group.id, teamId: team.id, teamName: team.name,
        uid: chosen.uid || chosen.member.uid || null,
        name: chosen.member.name,
      }] : [];
    });
  });
  const byUid = indexBy(assignments, (row) => row.uid);
  const byName = indexBy(assignments, (row) => row.name);
  const playerUids = indexBy(record.players, (row) => row.memberUid);
  const playerNames = indexBy(record.players, (row) => row.player);
  const matched = record.players.map((player, playerIndex) => {
    const candidates = player.memberUid ? byUid.get(player.memberUid) : byName.get(player.player);
    const unique = player.memberUid
      ? playerUids.get(player.memberUid)?.length === 1
      : playerNames.get(player.player)?.length === 1;
    const assignment = candidates?.length === 1 && unique ? candidates[0] : null;
    return { player, playerIndex, assignment, reason: unavailable || (
      candidates?.length && (!unique || candidates.length !== 1)
        ? '姓名或成員對應重複，無法唯一辨識'
        : '未列於本場人選的排表'
    ) };
  });
  // A linked old name and an unlinked new name must not count the same saved person twice.
  const assigned = indexBy(matched, (row) => row.assignment);
  for (const entry of matched) {
    if (!entry.assignment) continue;
    const duplicates = assigned.get(entry.assignment);
    if (duplicates.length > 1 && (!entry.player.memberUid ||
      duplicates.filter((row) => row.player.memberUid).length !== 1)) {
      entry.assignment = null;
      entry.reason = '同一排表人選對應多筆戰績，無法唯一辨識';
    }
  }
  return { unavailable, matched };
}

export function includeBattleTeamContext(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'includeTeamContext') ||
      (options.includeTeamContext !== undefined && typeof options.includeTeamContext !== 'boolean'))
    throw new BattleRecordError('戰績讀取選項格式不正確', 422, 'BATTLE_FILTER_INVALID');
  return options.includeTeamContext === true;
}

// Identity matching stays on the server. Only the assignments needed for the visible CSV travel to the browser.
export function battleTeamContext(record, lineup) {
  const { unavailable, matched } = matchBattlePlayers(record, lineup);
  return {
    recordId: record.id,
    unavailable,
    lineup: unavailable ? null : { savedAt: lineup.createdAt },
    assignments: matched.map(entry => ({
      playerIndex: entry.playerIndex,
      teamId: entry.assignment?.teamId || null,
      teamName: entry.assignment?.teamName || null,
      reason: entry.assignment ? null : entry.reason,
    })),
  };
}

function summarizeMatches(record, lineup, unavailable, matched, groups) {
  const sides = {};
  for (const side of ['red', 'blue']) {
    const entries = matched.filter((row) => row.player.side === side);
    const whole = totals(entries.map((row) => row.player));
    const publicRow = (entry, groupTotals) => ({
      playerIndex: entry.playerIndex, name: battlePlayerName(entry.player), profession: entry.player.profession,
      teamName: entry.assignment?.teamName || null,
      reason: entry.assignment ? null : entry.reason,
      metrics: Object.fromEntries(keys.map((key) => {
        const value = Number.isFinite(entry.player[key]) ? entry.player[key] : null;
        return [key, { value,
          groupPercent: groupTotals ? percentage(value, groupTotals[key]) : null,
          wholePercent: percentage(value, whole[key]),
        }];
      })),
    });
    sides[side] = {
      count: entries.length, totals: whole,
      groups: groups.map((group) => {
        const rows = entries.filter((row) => row.assignment?.groupId === group.id);
        const groupTotals = totals(rows.map((row) => row.player));
        return { id: group.id, name: group.name, attack: group.attack,
          totals: Object.fromEntries(keys.map((key) => [key, {
            ...groupTotals[key],
            wholePercent: groupTotals[key].missing ? null : percentage(groupTotals[key].value, whole[key]),
          }])),
          rows: rows.map((row) => publicRow(row, groupTotals)),
        };
      }),
      unclassified: entries.filter((row) => !row.assignment).map((row) => publicRow(row, null)),
    };
  }
  return {
    recordId: record.id, roundNumber: record.roundNumber,
    redTeam: record.redTeam, blueTeam: record.blueTeam, ourSide: record.isInternal ? null : record.ourSide,
    unavailable, lineup: !unavailable ? { savedAt: lineup.createdAt } : null, sides,
  };
}


export function analyzeBattleTeams(record, lineup) {
  const { unavailable, matched } = matchBattlePlayers(record, lineup);
  return summarizeMatches(record, lineup, unavailable, matched, TEAM_ANALYSIS_GROUPS);
}

export const BATTLE_ANALYSIS_GROUPS = [
  { ...TEAM_ANALYSIS_GROUPS[0], name: '進攻團' },
  { ...TEAM_ANALYSIS_GROUPS[1], name: '機動團' },
  ...[1, 2, 3, 4].map(number => ({ id: `defense${number}`, name: `防守${number}`, teams: [`defense-${number}`], attack: false })),
];

export function analyzeBattleTeamContext(record) {
  const context = record.teamContext;
  if (!context || context.recordId !== record.id || !Array.isArray(context.assignments) ||
      context.assignments.length !== record.players.length)
    throw new BattleRecordError('分團資料未完整載入，請重新載入對戰詳情', 422, 'TEAM_CONTEXT_INVALID');
  const byIndex = new Map(context.assignments.map(row => [row.playerIndex, row]));
  if (byIndex.size !== record.players.length || record.players.some((_, index) => !byIndex.has(index)))
    throw new BattleRecordError('分團資料與玩家紀錄不符，請重新載入對戰詳情', 422, 'TEAM_CONTEXT_INVALID');
  const matched = record.players.map((player, playerIndex) => {
    const row = byIndex.get(playerIndex);
    const group = !context.unavailable && BATTLE_ANALYSIS_GROUPS.find(item => item.teams.includes(row.teamId));
    return { player, playerIndex,
      assignment: group ? { groupId: group.id, teamName: row.teamName } : null,
      reason: context.unavailable || row.reason || '未列於本場人選的排表',
    };
  });
  return summarizeMatches(record, context.lineup ? { createdAt: context.lineup.savedAt } : null,
    context.unavailable, matched, BATTLE_ANALYSIS_GROUPS);
}

export function combineAnalysisGroups(groups, ids, whole, name) {
  const rows = groups.filter(group => ids.includes(group.id)).flatMap(group => group.rows);
  const groupTotals = totals(rows.map(row => Object.fromEntries(keys.map(key => [key, row.metrics[key].value]))));
  return { id: ids.join('+'), name, attack: false, rows,
    totals: Object.fromEntries(keys.map(key => [key, { ...groupTotals[key],
      wholePercent: groupTotals[key].missing ? null : percentage(groupTotals[key].value, whole[key]),
    }])),
  };
}

export function defenseComparisonGroups(side, firstIds) {
  const groups = side.groups.filter(group => !group.attack);
  const unique = new Set(firstIds);
  if (firstIds.length !== 2 || unique.size !== 2 || firstIds.some(id => !groups.some(group => group.id === id))) return [];
  const first = groups.filter(group => unique.has(group.id));
  const second = groups.filter(group => !unique.has(group.id));
  return [first, second].map((items, index) => combineAnalysisGroups(groups, items.map(item => item.id), side.totals,
    `比較組 ${index === 0 ? 'A' : 'B'}（${items.map(item => item.name).join('＋')}）`));
}

export function comparisonMetricShares(groups, key) {
  if (!groups.length || groups.some(group => group.totals[key]?.value == null || group.totals[key].missing))
    return { slices: [], reason: '缺值或部分資料，無法計算占比' };
  const total = groups.reduce((sum, group) => sum + group.totals[key].value, 0);
  if (total <= 0) return { slices: [], reason: '合計為 0，無法計算占比' };
  return { slices: groups.map(group => ({ name: group.name, value: group.totals[key].value,
    percent: group.totals[key].value / total * 100 })), reason: '' };
}
