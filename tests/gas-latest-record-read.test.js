import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetStore } from '../gas/src/storage.js';
import { gasEnvironment } from './helpers/gas-environment.js';
import { gasRuntime, cloudResult } from './helpers/gas-runtime.js';
import { participationTarget } from '../src/domain/participation-target.js';

function fixture() {
  const env = gasEnvironment(), storage = createSheetStore(env);
  storage.initialize();
  const counts = { decodes: 0, reads: [] };
  const decode = env.utilities.base64Decode;
  env.utilities.base64Decode = (value) => { counts.decodes++; return decode(value); };
  for (const [name, sheet] of env.sheets) {
    const getRange = sheet.getRange;
    sheet.getRange = (row, col, height, width) => {
      const range = getRange(row, col, height, width), getValues = range.getValues;
      range.getValues = () => {
        counts.reads.push({ name, row, col, height, width });
        return getValues();
      };
      return range;
    };
  }
  function reset() { counts.decodes = 0; counts.reads.length = 0; }
  return { env, storage, counts, reset };
}

test('latest reads use commit order rather than physical rows, ignoring abandoned and superseded payloads', () => {
  const { env, storage, counts, reset } = fixture();
  storage.transaction((s) => { s.put('members', 'a', { name: '舊甲' }); s.put('members', 'b', { name: '乙' }); });
  storage.transaction((s) => s.put('members', 'a', { name: '新甲' }));
  const rows = env.sheets.get('GM_members').data;
  const newRow = rows.pop();
  rows.splice(1, 0, newRow); // Newer committed generation is physically before the older one.
  rows.find((row, i) => i > 0 && row[0] === '"a"' && row !== newRow)[4] = 'corrupt obsolete payload';
  rows.push(['"a"', 'abandoned', 0, 1, 'uncommitted garbage']);
  reset();
  assert.deepEqual(storage.transaction((s) => s.get('members', 'a')), { name: '新甲' });
  assert.equal(counts.decodes, 1);
  const payloadReads = counts.reads.filter((r) => r.name === 'GM_members' && r.col === 5);
  assert.deepEqual(payloadReads.map((r) => [r.row, r.height]), [[2, 1]]);
  reset();
  assert.deepEqual(new Map(storage.transaction((s) => s.all('members')).map((v) => [v.name, v])), new Map([
    ['新甲', { name: '新甲' }], ['乙', { name: '乙' }],
  ]));
  assert.equal(counts.decodes, 2);
});

test('100 current members with 30 generations read and decode only 100 current payloads', () => {
  const { env, storage, counts, reset } = fixture();
  for (let version = 1; version <= 30; version++) storage.transaction((s) => {
    for (let i = 0; i < 100; i++) s.put('members', `u${i}`, { uid: `u${i}`, name: `成員${i}`, revision: version });
  });
  const before = JSON.stringify(env.sheets.get('GM_members').data);
  reset();
  const members = storage.transaction((s) => s.all('members'), { readOnly: true });
  assert.equal(members.length, 100);
  assert.ok(members.every((m) => m.revision === 30));
  assert.equal(counts.decodes, 100);
  assert.deepEqual(counts.reads.filter((r) => r.name === 'GM_members'), [
    { name: 'GM_members', row: 2, col: 1, height: 3000, width: 4 },
    { name: 'GM_members', row: 2902, col: 5, height: 100, width: 1 },
  ]);
  assert.equal(JSON.stringify(env.sheets.get('GM_members').data), before);
  reset();
  assert.equal(storage.transaction((s) => s.get('members', 'u0')).revision, 30);
  assert.equal(counts.decodes, 1);
  assert.equal(counts.reads.length, 3); // commits, index and one payload.
});

test('small bulk reads retain one Sheets read per table and still skip obsolete decoding', () => {
  const { storage, counts, reset } = fixture();
  for (let v = 1; v <= 10; v++) storage.transaction((s) => s.put('members', 'a', { version: v }));
  reset();
  assert.deepEqual(storage.transaction((s) => s.all('members')), [{ version: 10 }]);
  assert.equal(counts.decodes, 1);
  assert.deepEqual(counts.reads.filter((r) => r.name === 'GM_members'), [
    { name: 'GM_members', row: 2, col: 1, height: 10, width: 5 },
  ]);
});

test('latest deletion does not resurrect old values; a later recreation and staged changes remain visible', () => {
  const { storage, counts, reset } = fixture();
  storage.transaction((s) => { s.put('members', 'a', { value: '舊' }); s.put('members', 'b', { value: '乙' }); });
  storage.transaction((s) => s.remove('members', 'a'));
  reset();
  assert.equal(storage.transaction((s) => s.get('members', 'a')), undefined);
  assert.equal(counts.decodes, 1);
  assert.deepEqual(storage.transaction((s) => s.all('members')), [{ value: '乙' }]);
  storage.transaction((s) => s.put('members', 'a', { value: '重建' }));
  reset();
  storage.transaction((s) => {
    assert.deepEqual(s.getMany('members', ['a', 'missing', 'b']), new Map([
      ['a', { value: '重建' }], ['missing', undefined], ['b', { value: '乙' }],
    ]));
    s.put('members', 'a', { value: '本次修改' });
    s.remove('members', 'b');
    s.put('members', 'c', { value: '本次新增' });
    assert.deepEqual(s.all('members'), [{ value: '本次修改' }, { value: '本次新增' }]);
    assert.deepEqual(s.get('members', 'a'), { value: '本次修改' });
    assert.equal(s.get('members', 'b'), undefined);
  });
  assert.equal(counts.decodes, 2, 'already loaded values are not decoded again by all()');
  assert.equal(counts.reads.filter((r) => r.name === 'GM_members' && r.row === 2 && r.width === 4).length, 1);
});

test('indices are reused inside one transaction, pinned across concurrent commits and refreshed in the next', () => {
  const { storage, counts, reset } = fixture();
  storage.transaction((s) => { s.put('members', 'a', { version: 1 }); s.put('members', 'b', { version: 1 }); });
  reset();
  storage.transaction((s) => {
    assert.equal(s.get('members', 'a').version, 1);
    storage.transaction((writer) => { writer.put('members', 'b', { version: 2 }); writer.put('members', 'c', { version: 2 }); });
    assert.equal(s.get('members', 'b').version, 1);
    assert.equal(s.get('members', 'c'), undefined);
    assert.equal(s.all('members').length, 2);
  }, { readOnly: true });
  assert.equal(counts.reads.filter((r) => r.name === 'GM_members' && r.width === 4).length, 1);
  assert.equal(storage.transaction((s) => s.get('members', 'b')).version, 2);
  assert.equal(storage.transaction((s) => s.all('members')).length, 3);
});

test('multi-chunk latest values support reordered parts, Unicode, formula-like text and selective getMany', () => {
  const { env, storage, counts, reset } = fixture();
  const value = { text: '=公式字首繁體中文😀'.repeat(10000) };
  storage.transaction((s) => { s.put('battle_players', '001', { obsolete: true }); s.put('battle_players', 'unrelated', { other: true }); });
  storage.transaction((s) => s.put('battle_players', '001', value));
  const sheet = env.sheets.get('GM_battle_players');
  sheet.data.splice(3, sheet.data.length - 3, ...sheet.data.slice(3).reverse());
  sheet.data[1][4] = 'bad obsolete payload';
  sheet.data[2][4] = 'bad unrelated payload';
  reset();
  assert.deepEqual(storage.transaction((s) => s.getMany('battle_players', ['missing', '001'])), new Map([
    ['missing', undefined], ['001', value],
  ]));
  assert.equal(counts.decodes, 1);
  assert.deepEqual(counts.reads.filter((r) => r.name === 'GM_battle_players' && r.col === 5).map((r) => [r.row, r.height]), [[4, sheet.data.length - 3]]);
});

test('a corrupt latest generation fails closed instead of returning an older committed value', () => {
  for (const corrupt of ['missing', 'duplicate', 'count', 'part', 'payload']) {
    const { env, storage } = fixture();
    storage.transaction((s) => s.put('members', 'a', { old: true }));
    storage.transaction((s) => s.put('members', 'a', { text: '長內容😀'.repeat(16000) }));
    const rows = env.sheets.get('GM_members').data;
    if (corrupt === 'missing') rows.pop();
    if (corrupt === 'duplicate') rows.push([...rows[2]]);
    if (corrupt === 'count') rows[2][3]++;
    if (corrupt === 'part') rows[2][2] = -1;
    if (corrupt === 'payload') rows[2][4] = '!invalid!';
    if (corrupt === 'payload') assert.throws(() => storage.transaction((s) => s.get('members', 'a')));
    else assert.throws(() => storage.transaction((s) => s.get('members', 'a')), { code: 'STORAGE_CORRUPT' });
  }
});

test('a failed multi-table write and a commit published after the snapshot cannot replace earlier values', () => {
  const { env, storage } = fixture();
  storage.transaction((s) => s.put('members', 'a', { version: 1 }));
  env.failOn('GM_events');
  assert.throws(() => storage.transaction((s) => { s.put('members', 'a', { version: 2 }); s.put('events', 'event', {}); }));
  env.failOn(null);
  storage.transaction((s) => {
    storage.transaction((writer) => writer.put('members', 'a', { version: 3 }));
    assert.deepEqual(s.get('members', 'a'), { version: 1 });
  }, { readOnly: true });
  assert.deepEqual(storage.transaction((s) => s.get('members', 'a')), { version: 3 });
});

test('compiled GAS reads a history-heavy roster under a writer lock and preserves concurrent leave and retry rules', async () => {
  const env = await gasRuntime();
  env.setup();
  const storage = createSheetStore(env);
  const stamp = '2026-10-19T00:00:00Z';
  for (let revision = 1; revision <= 30; revision++) storage.transaction((s) => {
    for (let i = 0; i < 100; i++) s.put('members', `u${i}`, {
      uid: `u${i}`, name: `成員${i}`, primaryProfessionId: 1, secondaryProfessionId: null,
      isInGuild: true, isInClub: true, revision, joinedAt: stamp, updatedAt: stamp,
    });
  });
  storage.transaction((s) => s.put('events', 'event', {
    id: 'event', title: '隔離場次', type: 'guild_war', dates: ['2026-10-19'], revision: 1, createdAt: stamp,
  }));
  let decodes = 0;
  const decode = env.utilities.base64Decode;
  env.utilities.base64Decode = (value) => { decodes++; return decode(value); };
  env.lock.tryLock();
  let form;
  try { form = cloudResult(env.rpc('getEventParticipationForm', ['event'])); }
  finally { env.lock.releaseLock(); env.utilities.base64Decode = decode; }
  assert.equal(form.members.length, 100);
  assert.equal(decodes, 110, '100 members, 9 professions and 1 event, independent of historical generations');
  const inputs = [0, 1].map((i) => {
    const input = { name: `成員${i}`, memberUid: `u${i}`, status: 'leave', note: '保留', requestId: `leave-${i}`, revision: form.revision };
    return { ...input, expectedParticipant: { eventRevision: 1, person: participationTarget(input, form) } };
  });
  for (const input of inputs) assert.equal(cloudResult(env.rpc('submitParticipation', ['event', input])).status, 'leave');
  assert.equal(cloudResult(env.rpc('getEventParticipation', ['event'])).responses.length, 2);
  assert.equal(cloudResult(env.rpc('submitParticipation', ['event', inputs[0]])).status, 'leave');
  assert.equal(env.rpc('submitParticipation', ['event', { ...inputs[0], requestId: 'stale-person' }]).error.code, 'PARTICIPATION_CHANGED');
  assert.equal(env.sheets.get('GM_members').data.length, 3001, 'all historical source rows are retained');
});
