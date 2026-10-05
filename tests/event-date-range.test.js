import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventDateRange } from '../src/domain/event-date-range.js';

test('日期區間包含起訖日、跨月與閏日，完整月份不用逐日點選', () => {
  const month = eventDateRange('2026-10-01', '2026-10-31');
  assert.equal(month.length, 31);
  assert.equal(month[0], '2026-10-01');
  assert.equal(month.at(-1), '2026-10-31');
  assert.deepEqual(eventDateRange('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.deepEqual(eventDateRange('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(eventDateRange('9999-12-31', '9999-12-31'), ['9999-12-31']);
});

test('最多 366 天，拒絕反向期間、無效日期、格式及越界年份', () => {
  assert.equal(eventDateRange('2028-01-01', '2028-12-31').length, 366);
  assert.throws(() => eventDateRange('2028-01-01', '2029-01-01'), /最多選擇 366 天/);
  assert.throws(() => eventDateRange('2026-10-02', '2026-10-01'), /不可早於/);
  for (const value of ['', null, '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0999-01-01', '10000-01-01']) {
    assert.throws(() => eventDateRange(value, '2026-10-01'), /有效的開始日期/);
    assert.throws(() => eventDateRange('2026-01-01', value), /有效的結束日期/);
  }
});

test('單日情境只回傳安排日期，不沿用之前的結束日期', () => {
  assert.deepEqual(eventDateRange('2026-10-17', '2026-10-31', { multiple: false }), ['2026-10-17']);
  assert.throws(() => eventDateRange('', '', { multiple: false }), /有效的安排日期/);
});
