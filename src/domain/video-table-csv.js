import { videoGroupLabel } from './event-videos.js';
import { tableCsv } from './table-csv.js';

export const VIDEO_TABLE_HEADERS = ['角色名稱', '職業', '第一場連結', '第二場連結', '團別', '備註'];
export function videoTableRow(video) {
  return [
    video.name,
    video.professionName || '未記錄',
    video.firstUrl || '—',
    video.secondUrl || '—',
    videoGroupLabel(video.groupName),
    video.note || '—',
  ];
}
export function videoTableCsv(videos, canManage = true) {
  return tableCsv(canManage ? VIDEO_TABLE_HEADERS : PUBLIC_VIDEO_TABLE_HEADERS, videos.map(canManage ? videoTableRow : publicVideoTableRow));
}

export const PUBLIC_VIDEO_TABLE_HEADERS = ['角色名稱', '職業', '團別'];
export function publicVideoTableRow(video) {
  return [video.name, video.professionName || '未記錄', videoGroupLabel(video.groupName)];
}
