import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyLegacyImport } from '../../tools/legacy-import/apply.js';
import { GAS_TABLES, LegacyFormatError, resolveGasStore } from '../../tools/legacy-import/gas-store.js';
import { transformLegacyStore } from '../../tools/legacy-import/transform.js';
import { readWorkbook } from '../../tools/legacy-import/workbook.js';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';

// Synthetic GAS export: same sheet layout as the retired Apps Script store, fabricated values only.
const PROFESSIONS = [[1, '#ffb6c1', '素問'], [2, '#3cb371', '龍吟'], [3, '#add8e6', '碎夢'], [4, '#00bfff', '潮光'], [5, '#f0e68c', '玄機'], [6, '#9932cc', '九靈'], [7, '#ff8c00', '鐵衣'], [8, '#8b0000', '血河'], [9, '#4682b4', '神相']];
const HEADER = ['record_id', 'transaction_id', 'part_number', 'part_count', 'payload_base64'];
const T = (n) => `2026-10-0${n}T12:00:00.000Z`;
const EVENT = { id: 'event-1', title: '測試幫戰', type: 'guild_war', dates: ['2026-10-05'], revision: 1 };
const slot = (uid, member) => ({ uid, profession: null, secondRound: null, note: '', dutyIds: ['duty-a'], member, duties: [{ id: 'duty-a', name: '測試職責' }] });

function fixture(mutate = () => {}) {
  let tx = 0;
  const commits = [];
  const sheets = new Map(GAS_TABLES.map((table) => [`GM_${table}`, [HEADER]]));
  const write = (table, key, record, { commit = true, parts = 1 } = {}) => {
    const id = `tx-${++tx}`;
    const payload = Buffer.from(JSON.stringify(record)).toString('base64');
    const size = Math.ceil(payload.length / parts);
    for (let index = 0; index < parts; index += 1)
      sheets.get(`GM_${table}`).push([JSON.stringify(key), id, `${index}.0`, `${parts}.0`, payload.slice(index * size, (index + 1) * size)]);
    if (commit) commits.push([id, T(1)]);
  };
  const put = (table, key, value, options) => write(table, key, { value }, options);
  for (const [job_id, colorcode, name] of PROFESSIONS) put('professions', String(job_id), { job_id, colorcode, name });
  put('settings', 'platform', { name: '測試平台', icon: null, revision: 2 });
  put('duties', 'duty-a', { id: 'duty-a', name: '測試職責', active: true, revision: 1, createdAt: T(1), updatedAt: T(1) });
  const member = (uid, name) => ({ uid, name, primaryProfessionId: 1, secondaryProfessionId: null, isInGuild: true, isInClub: false, revision: 2, joinedAt: T(1), updatedAt: T(2) });
  put('members', '100000001', { ...member('100000001', '舊名'), revision: 1 });
  put('members', '100000001', member('100000001', '成員甲'));
  put('members', '000000001', member('000000001', '補位使用中'));
  put('members', '000000009', member('000000009', '補位未使用'));
  put('members', '100000009', member('100000009', '已刪除'));
  write('members', '100000009', { deleted: true });
  put('name_history', 'h1', { id: 'h1', uid: '100000001', name: '舊名', changedAt: T(2) });
  put('name_history', 'h2', { id: 'h2', uid: '100000001', name: "'同門'100000001", changedAt: T(1) });
  put('name_history', 'h3', { id: 'h3', uid: '100000001', name: '成員甲', changedAt: T(1) });
  put('name_history', 'h4', { id: 'h4', uid: '100000009', name: '已刪除舊名', changedAt: T(1) });
  put('events', 'event-1', { ...EVENT, createdAt: T(1), updatedAt: T(1), deletedAt: null });
  put('events', 'event-2', { id: 'event-2', title: '', type: 'activity', dates: ['2026-10-06', '2026-10-07'], revision: 1, createdAt: T(1), updatedAt: T(1), deletedAt: T(3) });
  put('responses', JSON.stringify(['event-1', '100000001']), { eventId: 'event-1', uid: '100000001', status: 'leave', note: '請假', professionId: null, revision: 1, updatedAt: T(2) });
  put('registrations', 'reg-used', { id: 'reg-used', eventId: 'event-1', name: '98765432100', note: '', professionId: 2, active: true, revision: 1, createdAt: T(1), updatedAt: T(1) });
  put('registrations', 'reg-unused', { id: 'reg-unused', eventId: 'event-1', name: '12345678', note: '', professionId: 2, active: true, revision: 1, createdAt: T(1), updatedAt: T(1) });
  put('videos', 'video-1', { id: 'video-1', eventId: 'event-1', name: '成員甲', professionId: 1, professionName: '素問', professionColorcode: '#ffb6c1', firstUrl: 'https://example.com/v', secondUrl: '', groupName: '進攻一', note: '', createdAt: T(2) });
  const teams = [{ id: 'attack', name: '進攻一', slots: [slot('100000001', { uid: '100000001', name: '成員甲' }), slot('000000001', { uid: '000000001', name: '補位使用中' }), { ...slot(null, { registrationId: 'reg-used', name: '98765432100' }), dutyIds: [], duties: [] }] }];
  put('lineup_versions', 'lineup-1', { id: 'lineup-1', eventId: 'event-1', version: 1, createdAt: T(2), event: EVENT, teams });
  put('templates', 'template-1', { id: 'template-1', name: '標準', teams, createdAt: T(2) });
  const players = [
    { side: 'red', player: '成員甲', profession: '素問', kill: 1, memberUid: '100000001' },
    { side: 'blue', player: '路人', profession: '龍吟', kill: 2, creditedName: '補位使用中', memberUid: '000000001' },
  ];
  put('battles', 'battle-1', { id: 'battle-1', eventId: 'event-1', roundNumber: 1, type: 'guild_war', playedAt: '2026-10-05T13:00:00.000Z', redTeam: '甲', blueTeam: '乙', winner: 'red', ourSide: 'red', isInternal: false, filename: 'battle.csv', event: EVENT, createdAt: T(3), contentHash: 'hash-1', csvFileId: 'drive-1', imageFileId: null, image: null, redCount: 1, blueCount: 1 });
  put('battle_players', 'battle-1', { players }, { parts: 3 });
  put('battle_links', 'battle-1:0', { recordId: 'battle-1', playerIndex: 0, memberUid: '100000001' });
  put('battle_links', 'battle-1:1', { recordId: 'battle-1', playerIndex: 1, memberUid: '000000001' });
  put('battle_links', 'battle-1:9', { recordId: 'battle-1', playerIndex: 9, memberUid: '100000001' }, { commit: false });
  put('requests', 'member-revision:100000001', { revision: 3 });
  put('requests', 'member-revision:100000009', { revision: 2 });
  put('requests', 'member-ref:lineup:lineup-1', { overrides: [['000000009', null]] });
  put('requests', 'member-ref:battle:missing', { overrides: [['100000001', null]] });
  put('requests', 'request-1', { hash: 'x', result: { ok: true } });
  put('lottery', 'default', { players: ['成員甲'], prizes: [], revision: 4, updatedAt: T(3) });
  mutate({ put, write });
  sheets.set('GM_commits', [['transaction_id', 'created_at'], ...commits]);
  return sheets;
}

test('legacy store resolves committed generations, deletions and multipart payloads', () => {
  const { tables, stats } = resolveGasStore(fixture());
  assert.equal(tables.get('members').values.get('100000001').name, '成員甲');
  assert.equal(tables.get('members').values.has('100000009'), false);
  assert.equal(tables.get('battle_players').values.get('battle-1').players.length, 2);
  assert.equal(tables.get('battle_links').values.has('battle-1:9'), false);
  assert.equal(stats.tables.battle_links.uncommittedRows, 1);
  const broken = fixture(({ write }) => write('members', 'x', { value: {} }, { parts: 2 }));
  broken.get('GM_members').pop();
  assert.throws(() => resolveGasStore(broken), LegacyFormatError);
});

test('cleaning rules keep used placeholders, drop unused or orphan rows and report every hit', () => {
  const { rows, report } = transformLegacyStore(resolveGasStore(fixture()));
  assert.deepEqual(report.anomalies, []);
  assert.deepEqual(rows.members.map((row) => row.uid).sort(), ['000000001', '100000001']);
  assert.deepEqual(report.hits.R3.map(({ key, kept }) => [key, kept]).sort(), [['000000001', true], ['000000009', false]]);
  assert.deepEqual(report.hits.R4.map(({ key, kept }) => [key, kept]).sort(), [['reg-unused', false], ['reg-used', true]]);
  assert.deepEqual(report.hits.R1.map(({ key }) => key), ['h2']);
  assert.deepEqual(report.hits.R2.map(({ key }) => key), ['h3']);
  assert.deepEqual(report.hits.R5.map(({ table, key }) => `${table}:${key}`).sort(), ['name_history:h4', 'requests:member-ref:battle:missing', 'requests:member-revision:100000009']);
  assert.deepEqual(rows.member_uid_revisions, [{ uid: '100000001', revision: 3 }]);
});

test('unknown values block the import instead of being guessed', () => {
  const store = resolveGasStore(fixture(({ put }) => put('responses', JSON.stringify(['event-1', '000000001']), { eventId: 'event-1', uid: '000000001', status: 'maybe', note: '', professionId: null, revision: 1, updatedAt: T(2) })));
  assert.deepEqual(transformLegacyStore(store).report.anomalies.map(({ table }) => table), ['responses']);
});

test('xlsx reader returns the exported sheet rows', () => {
  const sheets = new Map([['GM_commits', [['transaction_id', 'created_at'], ['tx-1', T(1)]]], ['名冊', [['a&b', '甲'], ['', '0.0']]]]);
  assert.deepEqual(readWorkbook(xlsx(sheets)), sheets);
});

test('import writes an empty migrated database that v2 repositories read back unchanged', async () => {
  const repository = await createTestRepository();
  try {
    const database = repositoryDatabase(repository);
    const plan = transformLegacyStore(resolveGasStore(fixture()));
    const inserted = await applyLegacyImport(database, plan);
    assert.equal(inserted.members, 2);

    const { members } = await repository.listMembers();
    assert.deepEqual(members.map((member) => member.uid).sort(), ['000000001', '100000001']);
    const { member } = await repository.getMemberMaintenance('100000001');
    assert.deepEqual(member.previousNames.map((entry) => entry.name).sort(), ["'同門'100000001", '成員甲', '舊名'].sort());
    assert.deepEqual((await repository.getPlatformSettings()).platform, { name: '測試平台', revision: 2 });
    assert.deepEqual((await repository.listDuties()).duties.map((duty) => duty.id), ['duty-a']);

    const { versions } = await repository.getLineupHistory('event-1');
    assert.equal(versions.length, 1);
    assert.deepEqual(versions[0].event, EVENT);
    assert.equal(versions[0].teams[0].slots.length, 3);

    const battle = await repository.getBattleRecord('battle-1');
    assert.deepEqual(battle.players.map((player) => [player.player, player.memberUid, player.creditedName]), [['成員甲', '100000001', undefined], ['路人', '000000001', '補位使用中']]);
    assert.equal((await repository.getLottery()).lottery.revision, 4);

    await assert.rejects(() => applyLegacyImport(database, plan), /已有資料/);
  } finally {
    await repository.close();
  }
});

// Smallest valid xlsx: stored (uncompressed) zip with shared strings.
function xlsx(sheets) {
  const strings = [];
  const index = (value) => (strings.includes(value) ? strings.indexOf(value) : strings.push(value) - 1);
  const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const column = (number) => String.fromCharCode(65 + number);
  const files = [];
  let sheetIndex = 0;
  const entries = [];
  for (const [name, rows] of sheets) {
    sheetIndex += 1;
    const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => (value === '' ? '' : `<c r="${column(c)}${r + 1}" t="s"><v>${index(value)}</v></c>`)).join('')}</row>`).join('');
    files.push([`xl/worksheets/sheet${sheetIndex}.xml`, `<worksheet><sheetData>${body}</sheetData></worksheet>`]);
    entries.push([name, sheetIndex]);
  }
  files.push(['xl/workbook.xml', `<workbook><sheets>${entries.map(([name, i]) => `<sheet name="${escape(name)}" sheetId="${i}" r:id="rId${i}"/>`).join('')}</sheets></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<Relationships>${entries.map(([, i]) => `<Relationship Id="rId${i}" Target="worksheets/sheet${i}.xml"/>`).join('')}</Relationships>`]);
  files.push(['xl/sharedStrings.xml', `<sst>${strings.map((value) => `<si><t>${escape(value)}</t></si>`).join('')}</sst>`]);
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text), fileName = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += 30 + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
