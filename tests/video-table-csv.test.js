import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoTableCsv } from '../src/domain/video-table-csv.js';

test('CSV exports the given visible rows in table order, with BOM and five columns', () => {
  const csv = videoTableCsv([
    {
      name: '空城',
      firstUrl: 'https://example.com/first',
      secondUrl: '',
      groupName: '防守團',
      note: '',
    },
    {
      name: '同名',
      firstUrl: '',
      secondUrl: 'https://example.com/second',
      groupName: '進攻一',
      note: '備註',
    },
  ]);
  assert.equal(
    csv,
    '\ufeff"角色名稱","第一場連結","第二場連結","團別","備註"\r\n' +
      '"空城","https://example.com/first","—","防守團","—"\r\n' +
      '"同名","—","https://example.com/second","進攻一","備註"\r\n',
  );
  assert.equal(videoTableCsv([]), '\ufeff"角色名稱","第一場連結","第二場連結","團別","備註"\r\n');
});

test('CSV escapes commas, quotes and multi-line notes and treats formula-like input as text', () => {
  const csv = videoTableCsv([
    {
      name: '=角色',
      firstUrl: 'https://example.com/a,b',
      secondUrl: '',
      groupName: null,
      note: '第一行,"測試"\n第二行',
    },
  ]);
  assert.ok(
    csv.includes('"\'=角色","https://example.com/a,b","—","未記錄","第一行,""測試""\n第二行"'),
  );
  for (const value of ['+SUM(1,2)', '-1+2', '@SUM(1)', ' \t=1+1'])
    assert.ok(videoTableCsv([{ name: '名字', note: value }]).includes('"\'' + value + '"'));
});
