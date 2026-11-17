import { inflateRawSync } from 'node:zlib';

// Minimal reader for the Sheets xlsx export; no dependency, values only (no styles or formulas).
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export function readZipEntries(buffer) {
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('不是有效的 xlsx（找不到 zip 目錄）');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('xlsx zip 目錄損毀');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (size > MAX_ENTRY_BYTES) throw new Error(`xlsx 內容過大：${name}`);
    entries.set(name, () => {
      if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('xlsx 檔案內容損毀');
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      throw new Error(`不支援的 xlsx 壓縮方式：${method}`);
    });
  }
  return entries;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity] ?? match;
  });
}
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((match) => decodeXml(match[1] || '')).join('');
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

function columnIndex(reference) {
  let number = 0;
  for (const character of reference.match(/^[A-Z]+/)[0]) number = number * 26 + character.charCodeAt(0) - 64;
  return number - 1;
}

export function readWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const read = (name) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`xlsx 缺少 ${name}`);
    return entry().toString('utf8');
  };
  const shared = entries.has('xl/sharedStrings.xml')
    ? [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]))
    : [];
  const relations = new Map(
    [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map(([tag]) => [attribute(tag, 'Id'), attribute(tag, 'Target')]),
  );
  const sheets = new Map();
  for (const [tag] of read('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)) {
    const name = decodeXml(attribute(tag, 'name'));
    const target = relations.get(attribute(tag, 'r:id')).replace(/^\//, '');
    const xml = read(target.startsWith('xl/') ? target : `xl/${target}`);
    const rows = [];
    for (const [, body] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const [, cellTag, content = ''] of body.matchAll(/<c(\s[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = attribute(cellTag, 't');
        const raw = content.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = '';
        if (type === 's' && raw !== undefined) value = shared[Number(raw)];
        else if (type === 'inlineStr') value = textOf(content);
        else if (raw !== undefined) value = decodeXml(raw);
        values[columnIndex(attribute(cellTag, 'r'))] = value;
      }
      if (values.some((value) => value !== undefined && value !== '')) rows.push(Array.from(values, (value) => value ?? ''));
    }
    sheets.set(name, rows);
  }
  return sheets;
}
