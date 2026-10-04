import { isBattleType } from './event-types.js';

export class EventError extends Error {
  constructor(message, fields = {}, status = 422, code = 'VALIDATION_ERROR') {
    super(message);
    Object.assign(this, { fields, status, code });
  }
}

export function validateEvent(input, { requireRequestId = true, singleBattleDate = true } = {}) {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fields = {};
  const title = typeof values.title === 'string' ? values.title.trim() : '';
  const optionalTitle = isBattleType(values.type);
  if (
    (values.title !== undefined && typeof values.title !== 'string') ||
    (!optionalTitle && !title) ||
    title.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(title)
  )
    fields.title = optionalTitle ? '安排名稱請使用文字，最多 120 字' : '請填寫 1–120 字的安排名稱';
  if (!['activity', 'scrimmage', 'guild_war', 'dragon_tiger'].includes(values.type))
    fields.type = '請選擇活動、約戰、幫戰或龍虎戰';
  const dates = values.dates;
  if (!Array.isArray(dates) || !dates.length || dates.length > 366) {
    fields.dates = '請選擇 1–366 個日期';
  } else {
    for (const date of dates) {
      if (typeof date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) {
        fields.dates = '日期格式必須為 YYYY-MM-DD';
        break;
      }
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        fields.dates = '請選擇有效的日曆日期';
        break;
      }
    }
    if (new Set(dates).size !== dates.length) fields.dates = '日期不可重複';
    if (values.type === 'scrimmage' && dates.length !== 1) fields.dates = '約戰只能選擇一天';
    if (
      singleBattleDate &&
      ['guild_war', 'dragon_tiger'].includes(values.type) &&
      dates.length !== 1
    )
      fields.dates = '每筆幫戰或龍虎戰只能選擇一天，多個日期請使用批次建立';
  }
  if (
    requireRequestId &&
    (typeof values.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(values.requestId))
  )
    fields.requestId = '提交識別資料不正確，請重新開啟建立表單';
  if (Object.keys(fields).length) throw new EventError('請修正安排資料後再儲存', fields);
  return { title, type: values.type, dates: [...dates].sort(), requestId: values.requestId };
}
