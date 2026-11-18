import { EventError } from './event-validation.js';

export function eventListQuery(input = {}) {
  const { startDate, endDate } = input;
  const validDate = value => typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if ((startDate !== undefined || endDate !== undefined) &&
      (!validDate(startDate) || !validDate(endDate) || startDate > endDate ||
       Date.parse(endDate) - Date.parse(startDate) > 366 * 86400000))
    throw new EventError('請指定一年內的有效日期範圍');
  const limit = input.limit === undefined ? 200 : Number(input.limit);
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
    throw new EventError('場次分頁範圍不正確');
  return { startDate, endDate, limit, offset };
}

export function calendarDateRange(month) {
  const first = new Date(`${month}-01T00:00:00Z`);
  first.setUTCDate(1 - first.getUTCDay());
  const startDate = first < new Date('1000-01-01T00:00:00Z') ? '1000-01-01' : first.toISOString().slice(0, 10);
  first.setUTCDate(first.getUTCDate() + 41);
  return { startDate, endDate: first > new Date('9999-12-31T00:00:00Z') ? '9999-12-31' : first.toISOString().slice(0, 10) };
}
