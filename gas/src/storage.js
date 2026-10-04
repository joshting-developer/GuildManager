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
];
const HEADER = ['record_id', 'transaction_id', 'part_number', 'part_count', 'payload_base64'];
const COMMIT_HEADER = ['transaction_id', 'created_at'];
const CHUNK_SIZE = 36000;

export function createSheetStore({
  spreadsheet,
  utilities,
  prefix = 'GM_',
  clock = Date.now,
  flush = () => {},
}) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(prefix)) fail('CONFIG_INVALID', '工作表前綴格式不正確');
  function sheet(table, initialize = false) {
    const name = `${prefix}${table}`;
    let current = spreadsheet.getSheetByName(name);
    const header = table === 'commits' ? COMMIT_HEADER : HEADER;
    if (!current && initialize) {
      current = spreadsheet.insertSheet(name);
      current.getRange(1, 1, 1, header.length).setValues([header]);
      current.setFrozenRows(1);
    }
    if (!current) fail('SETUP_REQUIRED', '雲端資料尚未初始化，請聯絡管理者');
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
  function rows(current, width) {
    return current.getLastRow() <= 1
      ? []
      : current.getRange(2, 1, current.getLastRow() - 1, width).getValues();
  }
  function append(current, values) {
    const end = current.getLastRow() + values.length;
    if (end > current.getMaxRows())
      current.insertRowsAfter(current.getMaxRows(), end - current.getMaxRows());
    current
      .getRange(current.getLastRow() + 1, 1, values.length, values[0].length)
      .setValues(values);
  }
  function transaction(work) {
    const commitRows = rows(sheet('commits'), 2);
    const order = new Map(commitRows.map(([id], index) => [id, index]));
    const tables = new Map(),
      partial = new Map(),
      changes = new Map();
    function load(table, keys = null) {
      if (!BUSINESS_TABLES.includes(table)) fail('TABLE_INVALID', '資料表不允許存取');
      if (tables.has(table)) return tables.get(table);
      if (!partial.has(table)) partial.set(table, new Map());
      const cache = partial.get(table);
      if (keys && keys.every((key) => cache.has(key))) return cache;
      const current = sheet(table);
      let records = rows(current, keys ? 4 : 5);
      if (keys) {
        const selected = records.map(
          ([key, tx]) => order.has(tx) && keys.includes(JSON.parse(key)),
        );
        // Read adjacent matching payload chunks together; unrelated battle snapshots stay unread.
        for (let start = 0; start < records.length; start++) {
          if (!selected[start]) continue;
          let end = start + 1;
          while (selected[end]) end++;
          const payloads = current.getRange(start + 2, 5, end - start, 1).getValues();
          for (let index = start; index < end; index++)
            records[index].push(payloads[index - start][0]);
          start = end - 1;
        }
        records = records.filter((_row, index) => selected[index]);
      }
      const groups = new Map();
      for (const [key, tx, part, count, payload] of records) {
        if (!order.has(tx)) continue;
        if (keys && !keys.includes(JSON.parse(key))) continue;
        const groupKey = canonical([key, tx]);
        if (!groups.has(groupKey))
          groups.set(groupKey, { key: JSON.parse(key), tx, count, parts: new Map() });
        const group = groups.get(groupKey);
        if (
          !Number.isSafeInteger(count) ||
          count < 1 ||
          group.count !== count ||
          group.parts.has(part) ||
          !Number.isSafeInteger(part) ||
          part < 0 ||
          part >= count
        )
          fail('STORAGE_CORRUPT', '已提交資料不完整，請聯絡管理者');
        group.parts.set(part, payload);
      }
      const values = new Map();
      for (const group of [...groups.values()].sort((a, b) => order.get(a.tx) - order.get(b.tx))) {
        if (group.parts.size !== group.count)
          fail('STORAGE_CORRUPT', '已提交資料分段缺漏，請聯絡管理者');
        const payload = Array.from({ length: group.count }, (_, index) =>
          group.parts.get(index),
        ).join('');
        const encoded = utilities.newBlob(utilities.base64Decode(payload)).getDataAsString('UTF-8');
        const record = JSON.parse(encoded);
        if (record.deleted) values.delete(group.key);
        else values.set(group.key, record.value);
      }
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
        sheet(table, true);
      },
      all: (table) => [...load(table).values()].map(clone),
      get: (table, key) => clone(load(table, [String(key)]).get(String(key))),
      getMany(table, keys) {
        keys = keys.map(String);
        const values = load(table, keys);
        return new Map(keys.map((key) => [key, clone(values.get(key))]));
      },
      put(table, key, value) {
        key = String(key);
        if (!BUSINESS_TABLES.includes(table)) fail('TABLE_INVALID', '資料表不允許存取');
        if (tables.has(table)) tables.get(table).set(key, clone(value));
        if (!partial.has(table)) partial.set(table, new Map());
        partial.get(table).set(key, clone(value));
        if (!changes.has(table)) changes.set(table, new Map());
        changes.get(table).set(key, { value: clone(value) });
      },
      remove(table, key) {
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
    }
    // Flush all entity rows before publishing the marker; Sheets may buffer writes.
    flush();
    const commits = sheet('commits');
    // This marker is authoritative; abandoned rows from any failed write are invisible.
    append(commits, [[tx, new Date(clock()).toISOString()]]);
    flush();
    return result;
  }
  return { initialize, transaction };
}

export function createPrivateStore(properties, uuid) {
  const POINTER = 'GM_AUTH_POINTER',
    PREFIX = 'GM_AUTH_';
  function load() {
    const pointer = properties.getProperty(POINTER);
    if (!pointer) return { accounts: [], sessions: [], limits: [] };
    const { id, count } = JSON.parse(pointer);
    let text = '';
    for (let index = 0; index < count; index++) {
      const chunk = properties.getProperty(`${PREFIX}${id}_${index}`);
      if (chunk === null) fail('AUTH_STORAGE_INVALID', '登入資料不完整，請聯絡管理者');
      text += chunk;
    }
    return JSON.parse(text);
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
