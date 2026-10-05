import { BattleRecordError, taipeiBattleTime } from './battle-records.js';

export function validatePersonalBattleFilters(input = {}) {
  const invalid = (message, field) => {
    const error = new BattleRecordError(message, 422, 'BATTLE_FILTER_INVALID');
    error.fields = field ? { [field]: message } : {};
    throw error;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid('篩選條件格式不正確');
  const result = {};
  for (const [field, label] of [['startDate', '開始日期'], ['endDate', '結束日期']]) {
    const value = input[field] ?? '';
    if (typeof value !== 'string') invalid(`請填寫正確的${label}`, field);
    result[field] = value.trim();
    if (!result[field]) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result[field])) invalid(`請填寫正確的${label}`, field);
    try {
      taipeiBattleTime(result[field]);
    } catch {
      invalid(`請填寫正確的${label}`, field);
    }
  }
  if (result.startDate && result.endDate && result.startDate > result.endDate)
    invalid('結束日期不得早於開始日期', 'endDate');
  const profession = input.profession ?? '';
  if (
    typeof profession !== 'string' ||
    profession.trim().length > 120 ||
    /[\u0000-\u001f\u007f]/.test(profession)
  )
    invalid('職業篩選格式不正確', 'profession');
  result.profession = profession.trim();
  return result;
}

export function filterPersonalBattles(entries, filters) {
  return entries.filter((entry) => {
    const date = entry.playedAt.slice(0, 10);
    return (
      (!filters.startDate || date >= filters.startDate) &&
      (!filters.endDate || date <= filters.endDate) &&
      (!filters.profession || entry.player.profession === filters.profession)
    );
  });
}

export function personalBattleProfessions(entries) {
  return [...new Set(entries.map((entry) => entry.player.profession).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-TW'));
}
