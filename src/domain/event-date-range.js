const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    ? time
    : null;
}

export function eventDateRange(start, end, { multiple = true } = {}) {
  const startTime = parseDate(start);
  if (startTime === null)
    throw new Error(multiple ? '請選擇有效的開始日期' : '請選擇有效的安排日期');
  if (!multiple) return [start];
  const endTime = parseDate(end);
  if (endTime === null) throw new Error('請選擇有效的結束日期');
  if (endTime < startTime) throw new Error('結束日期不可早於開始日期');
  const count = (endTime - startTime) / DAY_MS + 1;
  if (count > 366) throw new Error('每次最多選擇 366 天，請縮短日期區間');
  // UTC is only used for day arithmetic; API values remain Taipei calendar date strings.
  return Array.from({ length: count }, (_, index) =>
    new Date(startTime + index * DAY_MS).toISOString().slice(0, 10),
  );
}
