function csvCell(value) {
  let text = String(value ?? '');
  // Preserve player input as text when opening the export in spreadsheet software.
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function tableCsv(headers, rows) {
  return '\ufeff' + [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n') + '\r\n';
}
