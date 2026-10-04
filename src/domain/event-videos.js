export const VIDEO_GROUPS = ['進攻一', '進攻二', '防守團'];
export class EventVideoError extends Error {
  constructor(message, status = 422, code = 'VIDEO_INVALID', fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
function text(value, label, max, field) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new EventVideoError(`請填寫${label}，最多 ${max} 字`, 422, 'VIDEO_INVALID', {
      [field]: `請填寫${label}，最多 ${max} 字`,
    });
  return value.trim();
}
export function validateVideoDetails(input) {
  if (!input || typeof input !== 'object') throw new EventVideoError('影片資料格式不正確');
  const name = text(input.name, '名稱', 64, 'name');
  const url = text(input.url, '影片網址', 2048, 'url');
  try {
    const parsed = new URL(url);
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
  } catch {
    throw new EventVideoError('請填寫完整的 http／https 影片網址', 422, 'VIDEO_INVALID', {
      url: '請填寫完整的 http／https 影片網址',
    });
  }
  if (![1, 2].includes(input.roundNumber)) throw new EventVideoError('請選擇第一場或第二場');
  if (!VIDEO_GROUPS.includes(input.groupName))
    throw new EventVideoError('請選擇團別', 422, 'VIDEO_INVALID', { groupName: '請選擇團別' });
  return { name, url, roundNumber: input.roundNumber, groupName: input.groupName };
}
export function validateVideoSubmission(input) {
  const details = validateVideoDetails(input);
  const requestId = text(input.requestId, '提交識別碼', 128, 'requestId');
  if (!Number.isSafeInteger(input.eventRevision) || input.eventRevision < 1)
    throw new EventVideoError('場次版本不正確，請重新載入場次');
  return { ...details, requestId, eventRevision: input.eventRevision };
}
