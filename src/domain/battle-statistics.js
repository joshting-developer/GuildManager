import { BATTLE_COLUMNS } from './battle-records.js';

export const BATTLE_METRICS = BATTLE_COLUMNS.slice(2);
export const BATTLE_TABLE_COLUMNS = [
  ...BATTLE_COLUMNS.filter(([, key]) => key !== 'resource'),
  BATTLE_COLUMNS.find(([, key]) => key === 'resource'),
];
const sideNames = { red: '紅方', blue: '藍方' };

export function battleRoundLabel(record) {
  if (record.roundNumber == null) return '場序未指定';
  if (record.type === 'dragon_tiger') return '單場';
  return record.roundNumber === 2 ? '第二場' : '第一場';
}

export function battleDateLabel(value) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '/');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function battleResultLabel(record) {
  if (record.isInternal) return '內推';
  if (!sideNames[record.winner]) return '結果未填';
  return `${sideNames[record.winner]}獲勝`;
}

export function battleSideLabel(record, side) {
  const own = !record.isInternal && record.ourSide;
  return `${sideNames[side]}${own ? (own === side ? ' · 我方' : ' · 對方') : ''}`;
}

export function summarizeBattle(players) {
  const teams = {};
  for (const side of ['red', 'blue']) {
    const rows = players.filter((player) => player.side === side);
    const professions = new Map();
    for (const row of rows) {
      const name = row.profession || '未分類';
      professions.set(name, (professions.get(name) || 0) + 1);
    }
    teams[side] = {
      count: rows.length,
      professions: [...professions]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant')),
      metrics: Object.fromEntries(
        BATTLE_METRICS.map(([, key]) => {
          const values = rows.map((row) => row[key]).filter(Number.isFinite);
          return [
            key,
            {
              value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
              missing: rows.length - values.length,
            },
          ];
        }),
      ),
    };
  }
  const metrics = BATTLE_METRICS.map(([label, key]) => {
    const red = teams.red.metrics[key],
      blue = teams.blue.metrics[key];
    return {
      label,
      key,
      red,
      blue,
      gap: red.value == null || blue.value == null ? null : Math.abs(red.value - blue.value),
      partial: red.missing > 0 || blue.missing > 0,
    };
  });
  return { teams, metrics };
}

export function battlePlayerValue(player, key, mode = 'total') {
  const value = player[key] ?? null;
  if (mode !== 'per_life' || ['player', 'profession', 'seriousInjury'].includes(key)) return value;
  // An unknown injury count cannot provide a denominator; zero uses one as in NSHM_history.
  if (value == null || !Number.isFinite(player.seriousInjury)) return null;
  return value / Math.max(player.seriousInjury, 1);
}

// Compare unrounded display values, never formatted text; missing data remains last both ways.
export function sortBattlePlayers(
  players,
  side,
  key,
  direction = 'desc',
  { profession = '', mode = 'total' } = {},
) {
  const factor = direction === 'asc' ? 1 : -1;
  return players
    .filter((row) => row.side === side && (!profession || row.profession === profession))
    .slice()
    .sort((a, b) => {
      const left = battlePlayerValue(a, key, mode),
        right = battlePlayerValue(b, key, mode);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      const compare =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'zh-Hant');
      return compare * factor;
    });
}
