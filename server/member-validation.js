export class MemberError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function validateMember(input, { editing = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MemberError(422, 'VALIDATION_ERROR', '請填寫成員資料');
  }
  const fields = {};
  const values = {};
  const definitions = {
    ...(editing ? {} : { uid: ['UID', 64, true] }),
    name: ['名稱', 64, true],
  };
  for (const [key, [label, max, required]] of Object.entries(definitions)) {
    const value = input[key] ?? (required ? undefined : '');
    if (typeof value !== 'string') {
      fields[key] = `${label}必須以文字填寫`;
      continue;
    }
    values[key] = value.trim();
    if (required && !values[key]) fields[key] = `請填寫${label}`;
    else if (values[key].length > max) fields[key] = `${label}最多 ${max} 個字元`;
    else if (
      /[\u0000-\u001f\u007f]/.test(values[key]) ||
      (key === 'uid' && /\s/.test(values[key]))
    ) {
      fields[key] = `${label}格式不正確`;
    }
  }
  for (const [key, label] of [
    ['primaryProfessionId', '主職業'],
    ['secondaryProfessionId', '副職業'],
  ]) {
    const value = input[key] ?? null;
    if (key === 'secondaryProfessionId' && value === null) values[key] = null;
    else if (!Number.isSafeInteger(value) || value < 1) fields[key] = `請選擇${label}`;
    else values[key] = value;
  }
  for (const [key, label] of [
    ['isInGuild', '是否在幫派內'],
    ['isInClub', '是否在俱樂部內'],
  ]) {
    if (input[key] === undefined) {
      if (!editing) values[key] = key === 'isInGuild';
    } else if (typeof input[key] !== 'boolean') fields[key] = `${label}必須為布林值`;
    else values[key] = input[key];
  }
  const allowed = new Set([
    ...Object.keys(definitions),
    'primaryProfessionId',
    'secondaryProfessionId',
    'isInGuild',
    'isInClub',
    ...(editing ? ['revision'] : []),
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new MemberError(
      422,
      'VALIDATION_ERROR',
      editing ? 'UID 不可修改，請只修改名稱、職業與所屬狀態' : '包含不支援的成員欄位',
    );
  }
  if (Object.keys(fields).length)
    throw new MemberError(422, 'VALIDATION_ERROR', '請檢查成員資料', fields);
  if (editing) values.revision = validateRevision(input.revision);
  return values;
}

export function validateRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MemberError(422, 'INVALID_REVISION', '成員資料版本不正確，請重新載入');
  }
  return revision;
}
