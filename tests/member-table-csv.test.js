import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberTableCsv } from '../src/domain/member-table-csv.js';

const member = {
  uid: '000123', name: '測試成員', primaryProfession: '神相', secondaryProfession: null,
  isInGuild: true, isInClub: false, previousNames: [],
};
const header = '\ufeff"UID","名稱","主職業","副職業","幫派內","俱樂部內","過去名稱"\r\n';

test('member CSV keeps roster order, all supplied rows and independent membership flags', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    ...member,
    uid: String(index).padStart(6, '0'),
    isInGuild: index % 2 === 0,
    isInClub: index % 3 === 0,
    secondaryProfession: index === 24 ? '素問' : null,
    previousNames: index === 24 ? [{ name: '舊名字' }, { name: '更早的名字' }] : [],
  }));
  const before = structuredClone(rows);
  const csv = memberTableCsv(rows);
  assert.ok(csv.startsWith(header + '"000000","測試成員","神相","","是","是",""\r\n'));
  assert.ok(csv.includes('"000001","測試成員","神相","","否","否",""\r\n'));
  assert.ok(csv.endsWith('"000024","測試成員","神相","素問","是","是","舊名字\n更早的名字"\r\n'));
  assert.equal(csv.split('\r\n').length, 27);
  assert.deepEqual(rows, before);
  assert.equal(memberTableCsv([]), header);
});

test('member CSV escapes Chinese, commas, quotes and multiline history, excluding internal fields', () => {
  const csv = memberTableCsv([{
    ...member, name: '名字,"測試"\n下一行', revision: 37, secret: 'not-exported',
    previousNames: [{ name: '舊名,"一"' }, { name: '舊名二' }],
  }]);
  assert.equal(csv, header +
    '"000123","名字,""測試""\n下一行","神相","","是","否","舊名,""一""\n舊名二"\r\n');
  assert.ok(!csv.includes('not-exported') && !csv.includes('revision'));
});

test('member CSV treats formula-like UID, names, professions and history as text', () => {
  for (const value of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1)', ' \t=1+1']) {
    const csv = memberTableCsv([{
      ...member, uid: value, name: value, primaryProfession: value,
      secondaryProfession: value, previousNames: [{ name: value }],
    }]);
    const cell = '"\'' + value + '"';
    assert.equal(csv, header + `${cell},${cell},${cell},${cell},"是","否",${cell}\r\n`);
  }
});
