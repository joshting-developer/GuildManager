export const memberEditActions = Object.freeze({
  create: '新增成員', update: '編輯成員', remove: '移至編外', restore: '重新加入',
  maintenance: '資料維護', import: '匯入成員', history_edit: '編輯過去名稱', permanent_delete: '永久刪除',
});
export const memberEditFields = Object.freeze({
  name: '名稱', uid: 'UID', primaryProfession: '主職業', secondaryProfession: '副職業',
  primaryProfessionId: '主職業', secondaryProfessionId: '副職業',
  isInGuild: '幫派內', isInClub: '俱樂部內', joinedAt: '加入時間',
  maintenance: '資料維護', previousNames: '過去名稱',
});
export function formatEditTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}
export function formatEditValue(field, value, professions = []) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (['primaryProfession', 'secondaryProfession', 'primaryProfessionId', 'secondaryProfessionId'].includes(field)) {
    if (typeof value === 'object') return value.name || '—';
    return professions.find(job => String(job.job_id) === String(value))?.name || String(value);
  }
  if (field === 'joinedAt') return formatEditTime(value);
  if (Array.isArray(value)) return value.map(item => formatEditValue(field, item, professions)).join('、') || '—';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${memberEditFields[key] || key}：${formatEditValue(key, item, professions)}`).join('、');
  return String(value);
}
