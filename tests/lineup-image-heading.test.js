import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLineup } from '../src/domain/lineups.js';
import { lineupImageData, lineupImageFilename } from '../src/domain/lineup-image.js';

test('image title uses the battle date and weekday rather than today, preserving filename and archived metadata', () => {
  for (const [date, day] of [['2026-11-26', '四'], ['2026-11-29', '日'], ['2026-11-30', '一'], ['2028-02-29', '二']]) {
    const data = lineupImageData({ event: { dates: [date], type: 'scrimmage', title: '21：00 測試場次' }, teams: emptyLineup(), members: [], professions: [], duties: [], status: '已封存', snapshots: true });
    assert.equal(data.dateLabel, `${date}（星期${day}）`);
    assert.equal(data.title, '約戰 · 21：00 測試場次');
    assert.equal(data.status, '已封存');
    assert.equal(lineupImageFilename(data), `${date}_約戰 · 21：00 測試場次_戰場排表.jpg`);
  }
});
