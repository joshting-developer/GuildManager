export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const BATTLE_COLUMNS = [
  ['玩家名字', 'player'],
  ['職業', 'profession'],
  ['擊敗', 'kill'],
  ['助攻', 'assist'],
  ['資源', 'resource'],
  ['對玩家傷害', 'playerDamage'],
  ['對建築傷害', 'buildingDamage'],
  ['治療值', 'heal'],
  ['承受傷害', 'damageTaken'],
  ['重傷', 'seriousInjury'],
  ['化羽/清泉', 'revive'],
  ['焚骨', 'burnBone'],
];

export class BattleRecordError extends Error {
  constructor(message, status = 422, code = 'BATTLE_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function csvRows(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && text[index + 1] === '\n') index++;
      }
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed || char === '"') throw new BattleRecordError('CSV 引號格式不正確');
    else cell += char;
  }
  if (quoted) throw new BattleRecordError('CSV 有未閉合的引號');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function parseBattleCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new BattleRecordError('CSV 內容不能為空');
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES)
    throw new BattleRecordError('每個 CSV 不可超過 1 MB');
  if (text.includes('\ufffd') || text.includes('\u0000'))
    throw new BattleRecordError('CSV 請使用 UTF-8 編碼');
  const rows = csvRows(text.replace(/^\ufeff/, ''));
  let header = null,
    side = 0;
  const players = [];
  for (const [index, raw] of rows.entries()) {
    const row = raw.map((value) => value.trim());
    if (row.every((value) => !value)) continue;
    if (row.includes('玩家名字') && row.includes('職業')) {
      const required = BATTLE_COLUMNS.slice(0, 11).map(([title]) => title);
      if (
        required.some((title) => row.filter((value) => value === title).length !== 1) ||
        new Set(row).size !== row.length
      ) {
        throw new BattleRecordError(`CSV 第 ${index + 1} 列缺少或重複必要欄位`);
      }
      if (++side > 2) throw new BattleRecordError('每個 CSV 最多包含紅方與藍方兩段資料');
      header = row;
      continue;
    }
    // Game exports can include a one-cell title before or between team tables.
    if (row.length === 1) continue;
    if (!header) throw new BattleRecordError(`CSV 第 ${index + 1} 列前缺少戰績表頭`);
    if (row.length !== header.length)
      throw new BattleRecordError(`CSV 第 ${index + 1} 列欄位數不符`);
    const player = { side: side === 1 ? 'red' : 'blue' };
    for (const [title, key] of BATTLE_COLUMNS) {
      const position = header.indexOf(title);
      const value = position < 0 ? '' : row[position];
      if (key === 'player' || key === 'profession') {
        if (!value || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
          throw new BattleRecordError(`CSV 第 ${index + 1} 列的${title}不正確`);
        }
        player[key] = value;
      } else {
        if (value === '' || value === '—' || value === '-') {
          player[key] = null;
          continue;
        }
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))
          throw new BattleRecordError(`CSV 第 ${index + 1} 列的${title}須為非負整數`);
        const number = Number(value.replaceAll(',', ''));
        if (!Number.isSafeInteger(number))
          throw new BattleRecordError(`CSV 第 ${index + 1} 列的${title}超出範圍`);
        player[key] = number;
      }
    }
    players.push(player);
    if (players.length > 500) throw new BattleRecordError('每個 CSV 最多 500 筆玩家戰績');
  }
  if (!players.length) throw new BattleRecordError('CSV 沒有可匯入的玩家戰績, 請確認遊戲匯出格式');
  return {
    players,
    redCount: players.filter((row) => row.side === 'red').length,
    blueCount: players.filter((row) => row.side === 'blue').length,
  };
}

export function taipeiBattleTime(value) {
  const match =
    typeof value === 'string' &&
    value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new BattleRecordError('請填寫正確的對戰時間');
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    Number(year) < 2000 ||
    Number(year) > 2100 ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    throw new BattleRecordError('請填寫有效的對戰日期與時間');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

export function battleFilenameDefaults(filename) {
  const parts = filename.replace(/\.csv$/i, '').split('_');
  if (parts.length !== 4 || !/^\d{8}$/.test(parts[0]) || !/^\d{6}$/.test(parts[1]))
    return { datetime: '', redTeam: '', blueTeam: '' };
  const [date, time, redTeam, blueTeam] = parts;
  const datetime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}`;
  try {
    taipeiBattleTime(datetime);
  } catch {
    return { datetime: '', redTeam, blueTeam };
  }
  return { datetime, redTeam, blueTeam };
}
