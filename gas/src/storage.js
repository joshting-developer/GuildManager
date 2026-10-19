import { canonical, clone, fail } from './common.js';

export const BUSINESS_TABLES = [
  'settings',
  'professions',
  'members',
  'name_history',
  'events',
  'duties',
  'responses',
  'registrations',
  'videos',
  'requests',
  'lineup_versions',
  'templates',
  'battles',
  'battle_players',
  'battle_links',
  'lottery',
];
const HEADER = ['record_id', 'transaction_id', 'part_number', 'part_count', 'payload_base64'];
const COMMIT_HEADER = ['transaction_id', 'created_at'];
const CHUNK_SIZE = 36000;
// A second Sheets round-trip costs more than a small bulk read. Large tables
// and key lookups fetch payloads only after choosing the committed generations.
const SMALL_TABLE_ROWS = 128;

export function createSheetStore({
  spreadsheet,
  utilities,
  prefix = 'GM_',
  clock = Date.now,
  flush = () => {},
  run = (_stage, work) => work(),
}) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(prefix)) fail('CONFIG_INVALID', '工作表前綴格式不正確');
  // Reads skip the header round-trip (each Sheets call costs real time in GAS);
  // writes and initialization still verify the schema before touching rows.
  function sheet(table, initialize = false, verify = true) {
    const name = `${prefix}${table}`;
    let current = spreadsheet.getSheetByName(name);
    const header = table === 'commits' ? COMMIT_HEADER : HEADER;
    if (!current && initialize) {
      current = spreadsheet.insertSheet(name);
      current.getRange(1, 1, 1, header.length).setValues([header]);
      current.setFrozenRows(1);
    }
    if (!current) fail('SETUP_REQUIRED', '雲端資料尚未初始化，請聯絡管理者');
    if (!verify) return current;
    const actual = current.getRange(1, 1, 1, header.length).getValues()[0];
    if (canonical(actual) !== canonical(header) || current.getLastColumn() !== header.length)
      fail('SCHEMA_INVALID', `工作表 ${name} 欄位不符，請勿覆寫既有資料`);
    return current;
  }
  function initialize() {
    // Validate every existing sheet first, before creating any missing one.
    for (const table of ['commits', ...BUSINESS_TABLES])
      if (spreadsheet.getSheetByName(`${prefix}${table}`)) sheet(table);
    for (const table of ['commits', ...BUSINESS_TABLES]) sheet(table, true);
  }
  function rows(current, width, lastRow = current.getLastRow()) {
    return lastRow <= 1
      ? []
      : current.getRange(2, 1, lastRow - 1, width).getValues();
  }
  function append(current, values) {
    const end = current.getLastRow() + values.length;
    if (end > current.getMaxRows())
      current.insertRowsAfter(current.getMaxRows(), end - current.getMaxRows());
    current
      .getRange(current.getLastRow() + 1, 1, values.length, values[0].length)
      .setValues(values);
  }
  function transaction(work, { readOnly = false } = {}) {
    const commitRows = run('SHEETS_READ', () => rows(sheet('commits', false, false), 2), 'commits');
    const order = new Map(commitRows.map(([id], index) => [id, index]));
    const tables = new Map(),
      partial = new Map(),
      indexes = new Map(),
      changes = new Map();
    function index(table, keys) {
      if (indexes.has(table)) return indexes.get(table);
      const current = run('SHEETS_READ', () => sheet(table, false, false), table);
      const lastRow = run('SHEETS_READ', () => current.getLastRow(), table);
      const inline = !keys && lastRow - 1 <= SMALL_TABLE_ROWS;
      const records = run('SHEETS_READ', () => rows(current, inline ? 5 : 4, lastRow), table);
      const latest = new Map();
      for (let row = 0; row < records.length; row++) {
        const [key, tx] = records[row];
        if (!order.has(tx)) continue;
        const id = JSON.parse(key), previous = latest.get(id);
        if (!previous || order.get(tx) > order.get(previous.tx))
          latest.set(id, { key: id, tx, rows: [row] });
        else if (previous.tx === tx) previous.rows.push(row);
      }
      const result = { current, records, latest, inline };
      indexes.set(table, result);
      return result;
    }
    function load(table, keys = null) {
      if (!BUSINESS_TABLES.includes(table)) fail('TABLE_INVALID', '資料表不允許存取');
      if (tables.has(table)) return tables.get(table);
      if (!partial.has(table)) partial.set(table, new Map());
      const cache = partial.get(table);
      if (keys && keys.every((key) => cache.has(key))) return cache;
      const { current, records, latest, inline } = index(table, keys);
      const selected = keys
        ? [...new Set(keys)].map((key) => latest.get(key)).filter(Boolean)
        : [...latest.values()];
      const groups = selected.filter((group) => !cache.has(group.key));
      const selectedRows = [];
      // Validate the latest generation before fetching data. Never fall back to
      // an older value when a committed generation is incomplete or malformed.
      for (const group of groups) {
        group.count = records[group.rows[0]][3];
        group.parts = new Map();
        for (const row of group.rows) {
          const [, , part, count] = records[row];
          if (!Number.isSafeInteger(count) || count < 1 || group.count !== count ||
              group.parts.has(part) || !Number.isSafeInteger(part) || part < 0 || part >= count)
            fail('STORAGE_CORRUPT', '已提交資料不完整，請聯絡管理者');
          group.parts.set(part, row);
          selectedRows.push(row);
        }
        if (group.parts.size !== group.count)
          fail('STORAGE_CORRUPT', '已提交資料分段缺漏，請聯絡管理者');
      }
      if (!inline) {
        selectedRows.sort((a, b) => a - b);
        for (let start = 0; start < selectedRows.length;) {
          let end = start + 1;
          while (end < selectedRows.length && selectedRows[end] === selectedRows[end - 1] + 1) end++;
          const payloads = run('SHEETS_READ', () =>
            current.getRange(selectedRows[start] + 2, 5, end - start, 1).getValues(), table);
          for (let offset = start; offset < end; offset++)
            records[selectedRows[offset]][4] = payloads[offset - start][0];
          start = end;
        }
      }
      const values = new Map();
      for (const group of groups) {
        const payload = Array.from({ length: group.count }, (_, index) =>
          records[group.parts.get(index)][4],
        ).join('');
        const encoded = utilities.newBlob(utilities.base64Decode(payload)).getDataAsString('UTF-8');
        const record = JSON.parse(encoded);
        cache.set(group.key, record.deleted ? undefined : record.value);
      }
      for (const group of selected)
        if (cache.get(group.key) !== undefined)
          values.set(group.key, cache.get(group.key));
      for (const [key, record] of changes.get(table) || []) {
        if (record.deleted) values.delete(key);
        else values.set(key, clone(record.value));
      }
      if (keys) {
        for (const key of keys) cache.set(key, values.get(key));
        return cache;
      }
      tables.set(table, values);
      return values;
    }
    const store = {
      ensureTable(table) {
        if (!BUSINESS_TABLES.includes(table)) fail('TABLE_INVALID', '資料表不允許存取');
        if (readOnly && !spreadsheet.getSheetByName(`${prefix}${table}`))
          fail('TABLE_INITIALIZATION_REQUIRED', '資料表需要初始化');
        sheet(table, !readOnly);
      },
      all: (table) => [...load(table).values()].map(clone),
      get: (table, key) => clone(load(table, [String(key)]).get(String(key))),
      getMany(table, keys) {
        keys = keys.map(String);
        const values = load(table, keys);
        return new Map(keys.map((key) => [key, clone(values.get(key))]));
      },
      put(table, key, value) {
        if (readOnly) fail('READ_ONLY', '唯讀操作不能修改資料');
        key = String(key);
        if (!BUSINESS_TABLES.includes(table)) fail('TABLE_INVALID', '資料表不允許存取');
        if (tables.has(table)) tables.get(table).set(key, clone(value));
        if (!partial.has(table)) partial.set(table, new Map());
        partial.get(table).set(key, clone(value));
        if (!changes.has(table)) changes.set(table, new Map());
        changes.get(table).set(key, { value: clone(value) });
      },
      remove(table, key) {
        if (readOnly) fail('READ_ONLY', '唯讀操作不能修改資料');
        key = String(key);
        if (!BUSINESS_TABLES.includes(table)) fail('TABLE_INVALID', '資料表不允許存取');
        if (tables.has(table)) tables.get(table).delete(key);
        if (!partial.has(table)) partial.set(table, new Map());
        partial.get(table).set(key, undefined);
        if (!changes.has(table)) changes.set(table, new Map());
        changes.get(table).set(key, { deleted: true });
      },
    };
    const result = work(store);
    if (!changes.size) return result;
    const tx = utilities.getUuid();
    for (const [table, records] of changes) {
      run('SHEETS_WRITE', () => {
        const current = sheet(table),
          values = [];
        for (const [key, record] of records) {
          // Base64 and a quoted JSON key prevent formula interpretation, including chunk boundaries.
          const payload = utilities.base64Encode(JSON.stringify(record), utilities.Charset.UTF_8);
          const count = Math.ceil(payload.length / CHUNK_SIZE);
          for (let index = 0; index < count; index++)
            values.push([
              JSON.stringify(key),
              tx,
              index,
              count,
              payload.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
            ]);
        }
        append(current, values);
      }, table);
    }
    // Flush all entity rows before publishing the marker; Sheets may buffer writes.
    run('SHEETS_FLUSH', flush);
    // This marker is authoritative; abandoned rows from any failed write are invisible.
    run('SHEETS_COMMIT', () => append(sheet('commits'), [[tx, new Date(clock()).toISOString()]]), 'commits');
    run('SHEETS_FLUSH', flush);
    return result;
  }
  return { initialize, transaction };
}

export function createPrivateStore(properties, uuid) {
  const POINTER = 'GM_AUTH_POINTER',
    PREFIX = 'GM_AUTH_';
  function load() {
    // A writer publishes a new pointer before removing old chunks. Readers pin a
    // generation and retry when publication/cleanup crosses their read window.
    for (let attempt = 0; attempt < 3; attempt++) {
      const pointer = properties.getProperty(POINTER);
      if (!pointer) return { accounts: [], sessions: [], limits: [] };
      const { id, count } = JSON.parse(pointer);
      let text = '', missing = false;
      for (let index = 0; index < count; index++) {
        const chunk = properties.getProperty(`${PREFIX}${id}_${index}`);
        if (chunk === null) { missing = true; break; }
        text += chunk;
      }
      if (properties.getProperty(POINTER) !== pointer) continue;
      if (missing) fail('AUTH_STORAGE_INVALID', '登入資料不完整，請聯絡管理者');
      return JSON.parse(text);
    }
    fail('BUSY', '登入資料正在更新，請稍後重試');
  }
  function save(state) {
    const text = JSON.stringify(state),
      id = uuid(),
      count = Math.ceil(text.length / 1800);
    // 1800 UTF-16 characters remain under 9 KB even with multibyte names.
    if (text.length > 75000) fail('AUTH_CAPACITY', '登入資料容量已滿，請稍後再試');
    for (let index = 0; index < count; index++)
      properties.setProperty(
        `${PREFIX}${id}_${index}`,
        text.slice(index * 1800, (index + 1) * 1800),
      );
    properties.setProperty(POINTER, JSON.stringify({ id, count }));
    for (const key of Object.keys(properties.getProperties()))
      if (key.startsWith(PREFIX) && key !== POINTER && !key.startsWith(`${PREFIX}${id}_`))
        properties.deleteProperty(key);
  }
  return { load, save };
}
