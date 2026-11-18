// Mirrors the retired GAS sheet store (the former gas/src/storage.js): append-only generations,
// GM_commits as the only commit marker, base64 JSON payloads split into ordered parts.
export const GAS_TABLES = [
  'settings', 'professions', 'members', 'name_history', 'events', 'duties', 'responses', 'registrations',
  'videos', 'requests', 'lineup_versions', 'templates', 'battles', 'battle_players', 'battle_links', 'lottery',
];
const HEADER = ['record_id', 'transaction_id', 'part_number', 'part_count', 'payload_base64'];
const COMMIT_HEADER = ['transaction_id', 'created_at'];

export class LegacyFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LegacyFormatError';
  }
}

// xlsx exports numeric cells as "0.0"; the sheet itself stored integers.
function integer(value, label) {
  const number = Number(value);
  if (value === '' || !Number.isSafeInteger(number) || number < 0) throw new LegacyFormatError(`${label} 不是整數`);
  return number;
}

function sameHeader(actual, expected) {
  return actual.length === expected.length && expected.every((name, index) => actual[index] === name);
}

export function resolveGasStore(sheets, { prefix = 'GM_' } = {}) {
  const commitRows = sheets.get(`${prefix}commits`);
  if (!commitRows || !sameHeader(commitRows[0] || [], COMMIT_HEADER)) throw new LegacyFormatError('找不到 GM_commits 或欄位不符');
  const order = new Map();
  for (const [tx, createdAt] of commitRows.slice(1)) {
    if (order.has(tx)) throw new LegacyFormatError('GM_commits 有重複交易');
    order.set(tx, { index: order.size, createdAt });
  }
  const tables = new Map();
  const stats = {
    commits: order.size,
    firstCommitAt: commitRows[1]?.[1] || null,
    lastCommitAt: commitRows.at(-1)?.[1] || null,
    tables: {},
  };
  for (const table of GAS_TABLES) {
    const rows = sheets.get(`${prefix}${table}`);
    if (!rows) throw new LegacyFormatError(`找不到工作表 ${prefix}${table}`);
    if (!sameHeader(rows[0] || [], HEADER)) throw new LegacyFormatError(`工作表 ${prefix}${table} 欄位不符`);
    const generations = new Map();
    let uncommitted = 0;
    for (const [rawKey, tx, part, count, payload] of rows.slice(1)) {
      if (!order.has(tx)) {
        uncommitted += 1;
        continue;
      }
      const key = JSON.parse(rawKey);
      if (typeof key !== 'string') throw new LegacyFormatError(`${table} 的 record_id 格式不正確`);
      if (!generations.has(key)) generations.set(key, new Map());
      const byTx = generations.get(key);
      if (!byTx.has(tx)) byTx.set(tx, []);
      byTx.get(tx).push({ part: integer(part, `${table} part_number`), count: integer(count, `${table} part_count`), payload });
    }
    const values = new Map();
    const history = new Map();
    let deleted = 0;
    for (const [key, byTx] of generations) {
      const ordered = [...byTx].sort(([a], [b]) => order.get(a).index - order.get(b).index);
      const decoded = ordered.map(([tx, parts]) => ({ tx, committedAt: order.get(tx).createdAt, record: decodeParts(table, key, parts) }));
      history.set(key, decoded);
      const latest = decoded.at(-1).record;
      if (latest.deleted) deleted += 1;
      else values.set(key, latest.value);
    }
    tables.set(table, { values, history });
    stats.tables[table] = { rows: rows.length - 1, uncommittedRows: uncommitted, keys: generations.size, live: values.size, deleted };
  }
  return { tables, stats };
}

// A committed generation must be complete; never fall back to an older generation.
function decodeParts(table, key, parts) {
  const count = parts[0].count;
  const sorted = [...parts].sort((a, b) => a.part - b.part);
  if (count < 1 || sorted.length !== count || sorted.some((value, index) => value.part !== index || value.count !== count))
    throw new LegacyFormatError(`${table} 的 ${key} 已提交資料分段不完整`);
  const text = Buffer.from(sorted.map((value) => value.payload).join(''), 'base64').toString('utf8');
  const record = JSON.parse(text);
  if (!record || typeof record !== 'object' || (!record.deleted && !('value' in record)))
    throw new LegacyFormatError(`${table} 的 ${key} 內容格式不正確`);
  return record;
}
