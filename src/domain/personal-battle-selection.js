import { BATTLE_METRICS, battleDateLabel, battleRoundLabel } from './battle-statistics.js';

export const PERSONAL_TREND_METRICS = [
  ...BATTLE_METRICS.map(([title, value]) => ({ title, value })),
  { title: '擊殺效率（傷害／擊敗）', value: 'killEfficiency' },
];
export const personalBattleKey = (entry) => `${entry.recordId}:${entry.playerIndex}`;
export const latestPersonalSelection = (entries) => new Set(entries.slice(0, 10).map(personalBattleKey));
export const selectedPersonalBattles = (entries, keys) => entries.filter((entry) => keys.has(personalBattleKey(entry)));

function hasEfficiencyValues(player) {
  return Number.isFinite(player.playerDamage) && Number.isFinite(player.kill);
}
export function personalKillEfficiency(player) {
  return hasEfficiencyValues(player) && player.kill > 0 ? player.playerDamage / player.kill : null;
}
export function summarizeKillEfficiency(entries) {
  let damage = 0, kills = 0, missing = 0;
  for (const { player } of entries) {
    if (!hasEfficiencyValues(player)) { missing++; continue; }
    damage += player.playerDamage;
    kills += player.kill;
  }
  return { value: kills > 0 ? damage / kills : null, missing };
}
export function personalTrendPoints(entries, metric) {
  if (!PERSONAL_TREND_METRICS.some((item) => item.value === metric)) return [];
  // The API supplies newest first, including stable ties. Reverse a copy for time progression.
  return entries.slice().reverse().map((entry) => ({
    key: personalBattleKey(entry),
    label: `${battleDateLabel(entry.playedAt)} · ${battleRoundLabel(entry)} · ${entry.player.side === 'red' ? '紅方' : '藍方'} · ${entry.player.player}`,
    value: metric === 'killEfficiency' ? personalKillEfficiency(entry.player)
      : Number.isFinite(entry.player[metric]) ? entry.player[metric] : null,
  }));
}
