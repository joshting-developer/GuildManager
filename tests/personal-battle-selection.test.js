import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createMemberClient } from '../src/api/members.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';
import { createSheetStore } from '../gas/src/storage.js';
import { latestPersonalSelection, personalBattleKey, selectedPersonalBattles, personalKillEfficiency, summarizeKillEfficiency, personalTrendPoints } from '../src/domain/personal-battle-selection.js';
import { filterPersonalBattles } from '../src/domain/personal-battle-filters.js';
import { summarizePersonalBattles } from '../src/domain/personal-battle-statistics.js';

function entries(count = 25) {
  return Array.from({ length: count }, (_, i) => ({
    recordId: `b${count - i}`, playerIndex: 0, type: 'scrimmage', roundNumber: 1,
    playedAt: `2026-10-${String(count - i).padStart(2, '0')}`, winner: 'red',
    player: { side: 'red', player: '城', profession: i % 2 ? '素問' : '碎夢', kill: i + 1, playerDamage: (i + 1) * 100, seriousInjury: 1 },
  }));
}

test('latest ten selection persists across pages and filters; same battle rows stay independently selectable', () => {
  const rows = entries(), keys = latestPersonalSelection(rows);
  assert.equal(keys.size, 10);
  assert.equal(summarizePersonalBattles(selectedPersonalBattles(rows, keys)).metrics.find(m => m.key === 'kill').total, 55);
  keys.add(personalBattleKey(rows[24]));
  const filtered = filterPersonalBattles(rows, { profession: '素問' });
  assert.equal(selectedPersonalBattles(filtered, keys).length, 5);
  assert.equal(keys.size, 11);
  assert.equal(selectedPersonalBattles(rows, keys).length, 11);
  const both = [rows[0], { ...rows[0], playerIndex: 1, player: { ...rows[0].player, side: 'blue' } }];
  assert.equal(latestPersonalSelection(both).size, 2);
  assert.equal(summarizePersonalBattles(both).battleCount, 1);
  assert.equal(latestPersonalSelection([]).size, 0);
});

test('kill efficiency uses paired damage divided by kills, preserving zero-kill damage and unknown values', () => {
  const values = [{ playerDamage: 1000, kill: 10 }, { playerDamage: 3000, kill: 2 }, { playerDamage: 200, kill: 0 }, { playerDamage: null, kill: 8 }, { playerDamage: 900, kill: null }];
  assert.equal(personalKillEfficiency(values[0]), 100);
  assert.equal(personalKillEfficiency(values[2]), null);
  assert.equal(personalKillEfficiency(values[3]), null);
  assert.equal(personalKillEfficiency(values[4]), null);
  assert.deepEqual(summarizeKillEfficiency(values.map(player => ({ player }))), { value: 350, missing: 2 });
  assert.deepEqual(summarizeKillEfficiency([{ player: values[2] }]), { value: null, missing: 0 });
  assert.deepEqual(summarizeKillEfficiency([]), { value: null, missing: 0 });
});

test('trend keeps chronological order and independent same-day rows, gaps and raw values without mutating inputs', () => {
  const rows = entries(3), before = structuredClone(rows);
  rows[1].player.kill = 0;
  const points = personalTrendPoints(rows, 'killEfficiency');
  assert.equal(points[0].key, personalBattleKey(rows[2]));
  assert.deepEqual(points.map(p => p.value), [100, null, 100]);
  assert.deepEqual(personalTrendPoints(rows, 'playerDamage').map(p => p.value), [300, 200, 100]);
  assert.deepEqual(personalTrendPoints(rows, 'invalid'), []);
  assert.equal(rows[0].recordId, before[0].recordId);
});

test('local all=true returns complete history in one authorized adapter call and preserves legacy pages and filters', async () => {
  const repo = createRepository({ filename: ':memory:' });
  repo.addMember({ uid: 'a', name: '城', primaryProfessionId: 1, secondaryProfessionId: null });
  repo.addMember({ uid: 'other', name: '別人', primaryProfessionId: 1, secondaryProfessionId: null });
  for (let i = 1; i <= 25; i++) repo.saveBattleRecords({ requestId: `row-${i}`, records: [{ filename: 'test.csv', csvText: fixtureCsv('城'), type: 'scrimmage', datetime: `2026-10-${String(i).padStart(2, '0')}`, redTeam: '甲', blueTeam: '乙' }] });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const authFetch = await authenticatedFetch(server, repo);
    let calls = 0;
    const client = createMemberClient({ fetchImpl: (path, init) => { calls++; return authFetch(base + path, init); } });
    const data = await client.getBattleRecords('a', 1, { all: true });
    assert.equal(calls, 1);
    assert.equal(data.entries.length, 25);
    assert.equal(data.summary, undefined); // Full-history mode leaves aggregation to the browser.
    assert.equal(data.entries[0].playedAt, '2026-10-25');
    assert.equal(repo.getMemberBattleRecords('a', { page: 2 }).entries.length, 5);
    assert.equal(repo.getMemberBattleRecords('a', { all: true, startDate: '2026-10-20' }).entries.length, 6);
    assert.equal(repo.getMemberBattleRecords('other', { all: true }).entries.length, 0);
    assert.equal((await fetch(`${base}/api/members/a/battle-records?all=true`)).status, 401);
    assert.equal((await authFetch(`${base}/api/members/a/battle-records?all=invalid`)).status, 422);
    assert.throws(() => repo.getMemberBattleRecords('a', { all: 'true' }), { code: 'BATTLE_FILTER_INVALID' });
  } finally { await new Promise(r => server.close(r)); repo.close(); }
});

test('compiled GAS all history remains authorized, lock-free and read-only, reading only linked battle payloads', async () => {
  const env = await gasRuntime();
  env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const store = createSheetStore(env);
  store.transaction(s => {
    s.put('members', 'a', { uid: 'a', name: '城', primaryProfessionId: 1, revision: 1, isInGuild: true, isInClub: false });
    for (const row of entries()) {
      const { player, playerIndex, recordId, ...metadata } = row;
      s.put('battles', recordId, { id: recordId, createdAt: `${row.playedAt}T00:00:00Z`, ...metadata });
      s.put('battle_players', recordId, { players: [player, { ...player, player: '其他人' }] });
      s.put('battle_links', recordId, { recordId, playerIndex, memberUid: 'a' });
    }
    s.put('battles', 'unrelated', { id: 'unrelated', playedAt: '2026-11-01', createdAt: '2026-11-01T00:00:00Z' });
    s.put('battle_players', 'unrelated', { players: [{ player: '隱私' }] });
  });
  const snapshot = () => JSON.stringify({ sheets: [...env.sheets].map(([name,s]) => [name,s.data]), properties: [...env.properties], files: [...env.files.keys()], notifications: env.fetches });
  const before = snapshot();
  // Any attempt to obtain a writer lock or read Drive is a test failure.
  assert.equal(env.lock.tryLock(0), true);
  env.lock.tryLock = () => assert.fail('personal history must not acquire the writer lock');
  env.globals.DriveApp.getFileById = () => assert.fail('personal history must not read Drive');
  const decoded = [], decode = env.utilities.base64Decode;
  env.utilities.base64Decode = payload => { decoded.push(Buffer.from(payload,'base64').toString()); return decode(payload); };
  const data = cloudResult(env.raw('getMemberBattleRecords', ['a', 1, { all: true }], context));
  assert.equal(data.entries.length, 25);
  assert.equal(data.summary, undefined);
  assert.equal(data.entries[0].playedAt, '2026-10-25');
  assert.ok(data.entries.every(e => e.player.player === '城' && !e.player.memberUid));
  assert.ok(!decoded.some(text => text.includes('unrelated') || text.includes('隱私')));
  assert.equal(snapshot(), before);
  assert.equal(cloudResult(env.rpc('getMemberBattleRecords', ['a', 2, {}], context)).entries.length, 5);
  assert.equal(env.rpc('getMemberBattleRecords', ['a', 1, { all: true }]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.rpc('getMemberBattleRecords', ['a', 1, { all: 'true' }], context).error.code, 'BATTLE_FILTER_INVALID');
});
