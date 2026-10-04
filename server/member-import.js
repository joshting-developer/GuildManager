import { utf8Bytes } from '../src/domain/utf8.js';
import { MemberError, validateMember } from './member-validation.js';

export const MAX_IMPORT_BYTES = 256 * 1024;
export const MAX_IMPORT_ROWS = 500;

function parseCsv(text) {
  const records = [];
  let values = [];
  let value = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let startLine = 1;
  function finishField() {
    values.push(value.trim());
    value = '';
    closed = false;
  }
  function finishRow() {
    finishField();
    if (values.some((field) => field !== '')) records.push({ line: startLine, values });
    values = [];
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        value += character;
        if (character === '\n') line += 1;
      }
      continue;
    }
    if (character === ',') {
      finishField();
      continue;
    }
    if (character === '\n') {
      finishRow();
      line += 1;
      startLine = line;
      continue;
    }
    if (character === '\r' && text[index + 1] === '\n') continue;
    if (character === '"' && !closed && !value.trim()) {
      value = '';
      quoted = true;
      continue;
    }
    if (character === '"' || (closed && !/\s/.test(character))) {
      return {
        records: [],
        issues: [{ line, message: 'CSV 引號格式不正確，請用雙引號包住整個欄位' }],
      };
    }
    if (!closed) value += character;
  }
  if (quoted)
    return { records: [], issues: [{ line: startLine, message: 'CSV 欄位缺少結尾雙引號' }] };
  finishRow();
  return { records, issues: [] };
}

export function parseMemberImport(text, professions) {
  if (typeof text !== 'string' || !text.trim())
    throw new MemberError(422, 'IMPORT_EMPTY', '請貼上或選擇要匯入的成員資料');
  if (utf8Bytes(text).length > MAX_IMPORT_BYTES)
    throw new MemberError(413, 'IMPORT_TOO_LARGE', '每次匯入最多 256 KiB，請分批匯入');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.split('\n').find((line) => line.trim()) || '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(',') ? ',' : ' ';
  const parsed =
    delimiter === ','
      ? parseCsv(text)
      : {
          records: text.split('\n').flatMap((line, index) =>
            line.trim()
              ? [
                  {
                    line: index + 1,
                    values:
                      delimiter === '\t'
                        ? line.split('\t').map((field) => field.trim())
                        : line.trim().split(/\s+/),
                  },
                ]
              : [],
          ),
          issues: [],
        };
  const { records, issues } = parsed;
  if (
    records.length &&
    /^(?:uid)$/i.test(records[0].values[0]) &&
    /^(?:name|名稱)$/i.test(records[0].values[1] || '')
  ) {
    const header = records.shift();
    if (
      header.values.length !== 4 ||
      !/^(?:主職業|job1)$/i.test(header.values[2]) ||
      !/^(?:副職業|job2)$/i.test(header.values[3])
    ) {
      issues.push({ line: header.line, message: '表頭順序必須為 UID Name 主職業 副職業' });
    }
  }
  if (records.length > MAX_IMPORT_ROWS)
    throw new MemberError(422, 'IMPORT_TOO_MANY', '每次最多匯入 500 位成員，請分批匯入');
  if (!records.length && !issues.length) issues.push({ line: 1, message: '沒有可匯入的成員資料' });
  const byName = new Map(professions.map((job) => [job.name, job.job_id]));
  const seen = new Map();
  const rows = [];
  for (const record of records) {
    const { values, line } = record;
    if (values.length !== 4) {
      issues.push({ line, message: `需要 4 欄，目前有 ${values.length} 欄；副職業未設定請填 -` });
      continue;
    }
    const [uid, name, primaryProfession, secondaryProfession] = values;
    const messages = [];
    if (seen.has(uid)) messages.push(`UID 與第 ${seen.get(uid)} 行重複`);
    else seen.set(uid, line);
    const primaryProfessionId = byName.get(primaryProfession);
    const secondaryProfessionId = ['', '-', '無副職業'].includes(secondaryProfession)
      ? null
      : byName.get(secondaryProfession);
    if (!primaryProfessionId) messages.push(`主職業「${primaryProfession}」不存在，請填職業名稱`);
    if (secondaryProfessionId === undefined)
      messages.push(`副職業「${secondaryProfession}」不存在，請填職業名稱或 -`);
    let member;
    try {
      member = validateMember({
        uid,
        name,
        primaryProfessionId: primaryProfessionId ?? null,
        secondaryProfessionId: secondaryProfessionId ?? null,
      });
    } catch (error) {
      if (!(error instanceof MemberError)) throw error;
      messages.push(
        ...Object.entries(error.fields)
          .filter(([key]) => ['uid', 'name'].includes(key))
          .map(([, message]) => message),
      );
    }
    if (messages.length) issues.push({ line, message: messages.join('；') });
    else
      rows.push({
        line,
        ...member,
        primaryProfession,
        secondaryProfession: secondaryProfessionId === null ? '' : secondaryProfession,
      });
  }
  return { rows, issues };
}
