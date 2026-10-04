export const VIDEO_TABLE_HEADERS = ['角色名稱', '第一場連結', '第二場連結', '團別', '備註'];
export function videoTableRow(video) {
  return [
    video.name,
    video.firstUrl || '—',
    video.secondUrl || '—',
    video.groupName || '未記錄',
    video.note || '—',
  ];
}
function csvCell(value) {
  let text = String(value);
  // Preserve player input as text when opening the export in spreadsheet software.
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function videoTableCsv(videos) {
  return (
    '\ufeff' +
    [VIDEO_TABLE_HEADERS, ...videos.map(videoTableRow)]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}
