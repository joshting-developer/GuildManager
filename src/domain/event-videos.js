export const VIDEO_GROUPS = ['進攻一', '進攻二', '防守團'];
export class EventVideoError extends Error {
  constructor(message, status = 422, code = 'VIDEO_INVALID', fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
function text(value, label, max, field, required = true, multiline = false) {
  if (
    typeof value !== 'string' ||
    (required && !value.trim()) ||
    value.length > max ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(
      value,
    )
  )
    throw new EventVideoError(`${label}格式不正確，最多 ${max} 字`, 422, 'VIDEO_INVALID', {
      [field]: `${label}格式不正確，最多 ${max} 字`,
    });
  return value.trim();
}
function videoUrl(value, field, label) {
  const url = text(value ?? '', label, 2048, field, false);
  if (!url) return '';
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
    throw new EventVideoError(`請填寫完整的 http／https ${label}`, 422, 'VIDEO_INVALID', {
      [field]: '請填寫完整的 http／https 網址',
    });
  }
  return url;
}
export function validateVideoDetails(input, { allowMissingGroup = false } = {}) {
  if (!input || typeof input !== 'object') throw new EventVideoError('影片資料格式不正確');
  const name = text(input.name, '角色名稱', 64, 'name');
  const firstUrl = videoUrl(input.firstUrl, 'firstUrl', '第一場網址');
  const secondUrl = videoUrl(input.secondUrl, 'secondUrl', '第二場網址');
  const note = text(input.note ?? '', '備註', 500, 'note', false, true);
  if (!firstUrl && !secondUrl)
    throw new EventVideoError('請至少填寫一個場次的影片網址', 422, 'VIDEO_INVALID', {
      firstUrl: '兩場網址至少填寫一個',
      secondUrl: '兩場網址至少填寫一個',
    });
  if (!VIDEO_GROUPS.includes(input.groupName) && !(allowMissingGroup && input.groupName == null))
    throw new EventVideoError('請選擇團別', 422, 'VIDEO_INVALID', { groupName: '請選擇團別' });
  return { name, firstUrl, secondUrl, groupName: input.groupName ?? null, note };
}
export function validateVideoSubmission(input) {
  const details = validateVideoDetails(input);
  const requestId = text(input.requestId, '提交識別碼', 128, 'requestId');
  if (!Number.isSafeInteger(input.eventRevision) || input.eventRevision < 1)
    throw new EventVideoError('場次版本不正確，請重新載入場次');
  return { ...details, requestId, eventRevision: input.eventRevision };
}
