// Keep persisted values stable for old videos and request retries.
export const VIDEO_GROUP_OPTIONS = [
  { title: '進攻團', value: '進攻一' },
  { title: '機動團', value: '進攻二' },
  { title: '防守團', value: '防守團' },
];
export const VIDEO_GROUPS = VIDEO_GROUP_OPTIONS.map((group) => group.value);
export function videoGroupLabel(value) {
  return VIDEO_GROUP_OPTIONS.find((group) => group.value === value)?.title || value || '未記錄';
}
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
// Keep URL validation portable and consistent across runtimes.
function isHttpVideoUrl(url) {
  const match = /^https?:\/\/([^/?#]+)(?:[/?#][^\s\\]*)?$/i.exec(url);
  if (!match || /[\s@\\%]/.test(match[1])) return false;
  const authority = /^(\[[0-9a-f:.]+\]|[^:\[\]]+)(?::([0-9]+))?$/i.exec(match[1]);
  if (!authority || (authority[2] && (authority[2].length > 5 || Number(authority[2]) > 65535)))
    return false;
  const host = authority[1];
  if (host.startsWith('[')) return host.includes(':') && !host.includes(':::');
  return host
    .replace(/\.$/, '')
    .split('.')
    .every((label) =>
      /^[a-z0-9\u0080-\uffff](?:[a-z0-9\u0080-\uffff-]*[a-z0-9\u0080-\uffff])?$/i.test(label),
    );
}
function videoUrl(value, field, label) {
  const url = text(value ?? '', label, 2048, field, false);
  if (!url) return '';
  if (!isHttpVideoUrl(url)) {
    throw new EventVideoError(`請填寫完整的 http／https ${label}`, 422, 'VIDEO_INVALID', {
      [field]: '請填寫完整的 http／https 網址',
    });
  }
  return url;
}
export function validateVideoDetails(input, { allowMissingGroup = false, allowMissingProfession = false } = {}) {
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
  const professionId = input.professionId ?? null;
  if (!(allowMissingProfession && professionId === null) &&
    (!Number.isSafeInteger(professionId) || professionId < 1))
    throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '請選擇職業' });
  return { name, professionId, firstUrl, secondUrl, groupName: input.groupName ?? null, note };
}
export function validateVideoSubmission(input) {
  const details = validateVideoDetails(input);
  const requestId = text(input.requestId, '提交識別碼', 128, 'requestId');
  const memberUid = input.memberUid === undefined ? null : text(input.memberUid, '成員資料', 64, 'name');
  return { ...details, requestId, ...(memberUid ? { memberUid } : {}) };
}

export function validateVideoProfessionUpdate(eventId, videoId, input) {
  text(eventId, '場次', 128, 'eventId');
  text(videoId, '影片', 128, 'videoId');
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['professionId', 'revision', 'requestId'].includes(key)))
    throw new EventVideoError('只能修改這筆影片的職業');
  if (!Number.isSafeInteger(input.professionId) || input.professionId < 1)
    throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '請選擇職業' });
  if (!Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new EventVideoError('影片版本不正確，請重新載入');
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
    throw new EventVideoError('缺少有效的操作識別碼，請重新操作');
  return { professionId: input.professionId, revision: input.revision, requestId: input.requestId };
}

function videoEditTarget(eventId, videoId, input, allowed, message) {
  text(eventId, '場次', 128, 'eventId');
  text(videoId, '影片', 128, 'videoId');
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key)))
    throw new EventVideoError(message);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new EventVideoError('影片版本不正確，請重新載入');
}

export function validateVideoMove(eventId, videoId, input) {
  videoEditTarget(eventId, videoId, input, ['targetEventId', 'revision', 'requestId'], '只能更換這筆影片的場次');
  if (typeof input.targetEventId !== 'string' || !input.targetEventId.trim() || input.targetEventId.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(input.targetEventId))
    throw new EventVideoError('請選擇要更換的場次', 422, 'VIDEO_INVALID', { targetEventId: '請選擇場次' });
  if (input.targetEventId === eventId)
    throw new EventVideoError('請選擇與目前不同的場次', 422, 'VIDEO_INVALID', { targetEventId: '請選擇其他場次' });
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
    throw new EventVideoError('缺少有效的操作識別碼，請重新操作');
  return { targetEventId: input.targetEventId, revision: input.revision, requestId: input.requestId };
}

export function validateVideoDelete(eventId, videoId, input) {
  videoEditTarget(eventId, videoId, input, ['revision'], '刪除影片只需要版本資料');
  return { revision: input.revision };
}

export function validateVideoList(input = {}) {
  const { page = 1, limit = 20, search = '', group = '', videoId = '' } = input;
  if (!Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / 200) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new EventVideoError('影片頁碼或每頁筆數不正確');
  const needle = text(search, '搜尋名稱', 64, 'search', false);
  if (typeof group !== 'string' || (group && !VIDEO_GROUPS.includes(group)))
    throw new EventVideoError('請選擇有效團別');
  return { page, limit, search: needle, group, videoId: text(videoId, '影片', 128, 'videoId', false) };
}

export function filterVideoNames(names, { search = '', professionId = '', sort = 'name' } = {}) {
  const needle = search.trim().toLowerCase();
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return names.filter(row => row.name.toLowerCase().includes(needle) &&
    (professionId === '' || String(row.professionId ?? 0) === professionId))
    .sort((a, b) => {
      if (sort !== 'name') {
        if (a.professionName === null && b.professionName !== null) return 1;
        if (b.professionName === null && a.professionName !== null) return -1;
        const jobOrder = compare(a.professionName || '', b.professionName || '');
        if (jobOrder) return sort === 'professionDesc' ? -jobOrder : jobOrder;
      }
      return compare(a.name, b.name);
    });
}
