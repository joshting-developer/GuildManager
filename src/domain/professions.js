export class ProfessionError extends Error {
  constructor(message, status = 422, code = 'PROFESSION_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = {};
  }
}

export function validateProfession(input, editing = false) {
  const allowed = editing ? ['name', 'colorcode', 'revision'] : ['name', 'colorcode', 'requestId'];
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !allowed.includes(key)))
    throw new ProfessionError('職業資料包含不支援的欄位');
  if (typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 64 || /[\u0000-\u001f\u007f]/.test(input.name))
    throw new ProfessionError('請填寫 1–64 字的職業名稱');
  if (typeof input.colorcode !== 'string' || !/^#[a-f\d]{6}$/i.test(input.colorcode))
    throw new ProfessionError('請選擇顏色或填寫六位 HEX 色碼');
  if (editing ? !Number.isSafeInteger(input.revision) || input.revision < 1 : typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
    throw new ProfessionError('職業版本或操作識別碼不正確, 請重新載入');
  return { name: input.name.trim(), colorcode: input.colorcode.toLowerCase() };
}
