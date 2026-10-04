import { BATTLE_METRICS } from './battle-statistics.js';

// A battle may contain the same member on both sides; keep both rows but count the battle once.
export function summarizePersonalBattles(entries) {
  const results = new Map();
  for (const entry of entries) {
    const known = !entry.isInternal && ['red', 'blue'].includes(entry.winner);
    const result = known ? (entry.winner === entry.player.side ? 'win' : 'loss') : 'unknown';
    const previous = results.get(entry.recordId);
    results.set(entry.recordId, previous && previous !== result ? 'unknown' : result);
  }
  return {
    battleCount: results.size,
    rowCount: entries.length,
    wins: [...results.values()].filter((value) => value === 'win').length,
    losses: [...results.values()].filter((value) => value === 'loss').length,
    unknown: [...results.values()].filter((value) => value === 'unknown').length,
    metrics: BATTLE_METRICS.map(([label, key]) => {
      const values = entries.map((entry) => entry.player[key]).filter(Number.isFinite);
      const total = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
      const lifeRows = entries
        .map((entry) => entry.player)
        .filter((player) => Number.isFinite(player[key]) && Number.isFinite(player.seriousInjury));
      const lives = lifeRows.reduce((sum, player) => sum + Math.max(player.seriousInjury, 1), 0);
      return {
        key,
        label,
        total,
        average: total == null ? null : total / values.length,
        missing: entries.length - values.length,
        perLife:
          key === 'seriousInjury'
            ? total
            : lives
              ? lifeRows.reduce((sum, player) => sum + player[key], 0) / lives
              : null,
        perLifeMissing:
          key === 'seriousInjury'
            ? entries.length - values.length
            : entries.length - lifeRows.length,
      };
    }),
  };
}
