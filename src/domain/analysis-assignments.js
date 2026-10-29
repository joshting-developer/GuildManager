import { BATTLE_ANALYSIS_GROUPS } from './team-battle-analysis.js';

export const ANALYSIS_ASSIGNMENT_OPTIONS = BATTLE_ANALYSIS_GROUPS.map(({ id, name }) => ({
  title: name, value: id,
}));

// This overlay only accepts originally unclassified CSV rows. It never changes
// saved matching, raw player data or the whole-side denominator.
export function applyAnalysisAssignments(analysis, assignments = {}) {
  if (!analysis || !Object.keys(assignments).length) return analysis;
  const allowed = new Map(ANALYSIS_ASSIGNMENT_OPTIONS.map(item => [item.value, item.title]));
  let changed = false;
  const sides = Object.fromEntries(['red', 'blue'].map(side => {
    const original = analysis.sides[side];
    const additions = new Map();
    const unclassified = [];
    for (const row of original.unclassified) {
      const target = assignments[row.playerIndex];
      if (!allowed.has(target)) { unclassified.push(row); continue; }
      changed = true;
      if (!additions.has(target)) additions.set(target, []);
      additions.get(target).push({ ...row, temporary: true,
        teamName: `${allowed.get(target)}（臨時）`, reason: null });
    }
    if (!additions.size) return [side, original];
    const groups = original.groups.map(group => {
      const extra = additions.get(group.id);
      if (!extra) return group;
      const rows = [...group.rows, ...extra].sort((a, b) => a.playerIndex - b.playerIndex);
      const totals = Object.fromEntries(Object.keys(group.totals).map(key => {
        const values = rows.map(row => row.metrics[key].value).filter(Number.isFinite);
        const value = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
        const missing = rows.length - values.length, whole = original.totals[key];
        return [key, { value, missing,
          wholePercent: !missing && Number.isFinite(value) && !whole.missing && whole.value > 0
            ? value / whole.value * 100 : null }];
      }));
      return { ...group, totals, rows: rows.map(row => ({ ...row,
        metrics: Object.fromEntries(Object.entries(row.metrics).map(([key, metric]) => [key, {
          ...metric, groupPercent: Number.isFinite(metric.value) && !totals[key].missing && totals[key].value > 0
            ? metric.value / totals[key].value * 100 : null,
        }])),
      })) };
    });
    return [side, { ...original, groups, unclassified }];
  }));
  return changed ? { ...analysis, sides } : analysis;
}
