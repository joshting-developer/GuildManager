import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBattleMemberSync } from '../src/domain/battle-member-sync.js';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createBattleSyncClient } from '../src/api/battle-sync.js';
import { setGasSession } from '../src/api/gas.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';

const person = (uid, name) => ({ uid, name, primaryProfessionId: 3 });
let uploadMinute = 0;
const uploadInput = (name, requestId = crypto.randomUUID()) => ({
  requestId,
  records: [{ filename: 'history.csv', csvText: fixtureCsv(name), type: 'scrimmage',
    datetime: `2026-10-24T12:${String(uploadMinute++).padStart(2, '0')}`, redTeam: '紅方', blueTeam: '藍方', winner: null }],
});
const code = expected => error => error.code === expected;

test('sync planner deduplicates one member aliases, skips all cross-UID aliases and preserves prior ownership', () => {
  const plan = planBattleMemberSync(
    [person('1', '甲'), person('2', '乙'), person('3', '丙'), person('4', '丁')],
    [{ uid: '1', name: '甲' }, { uid: '1', name: '舊甲' }, { uid: '1', name: '舊甲' },
      { uid: '1', name: '乙' }, { uid: '2', name: '舊同名' }, { uid: '3', name: '舊同名' },
      { uid: 'missing', name: '未知' }],
    [{ id: 'a', players: ['甲', '舊甲', '乙', '舊同名', '未知', '甲 ', '丁', '乙']
      .map((player, i) => ({ player, ...(i === 6 ? { memberUid: 'prior' } : {}) })) }],
    [{ recordId: 'a', playerIndex: 7, memberUid: 'prior' }],
  );
  assert.deepEqual(plan.summary, { records: 1, players: 8, alreadyLinked: 2, eligiblePlayers: 2,
    currentNamePlayers: 1, historyNamePlayers: 1, conflictPlayers: 2, unmatchedPlayers: 2, matchedMembers: 1 });
  assert.deepEqual(plan.assignments.map(row => row.playerIndex), [0, 1]);
  assert.deepEqual(plan.matches.map(row => row.matchType).sort(), ['current', 'history']);
  assert.equal(plan.conflicts.find(row => row.name === '乙').candidates.length, 2);
  assert.equal(plan.conflicts.find(row => row.name === '舊同名').candidates.length, 2);
});

// Rename is used to reproduce members created before historical backfill existed.
function fixture(api) {
  const current = api.upload('現在甲');
  const old = api.upload('過去甲');
  api.upload('乙'); api.upload('舊同名'); api.upload('未知');
  api.add(person('1', '起始甲'));
  api.rename('1', '過去甲', 1); api.rename('1', '現在甲', 2);
  api.add(person('2', '起始乙'));
  api.rename('2', '乙', 1); api.rename('2', '舊同名', 2); api.rename('2', '乙', 3);
  api.add(person('3', '起始丙'));
  api.rename('3', '舊同名', 1); api.rename('3', '丙', 2);
  // A current name also matching another member's old name must not win priority.
  api.add(person('4', '起始丁'));
  api.rename('4', '乙', 1); api.rename('4', '丁', 2);
  const owned = api.upload('現在甲');
  return { current, old, owned };
}

function checkSync(api, records) {
  const preview = api.preview();
  assert.equal(preview.summary.eligiblePlayers, 2);
  assert.equal(preview.summary.historyNamePlayers, 1);
  assert.equal(preview.summary.conflictPlayers, 2);
  assert.equal(api.personal('1').total, 1);
  const input = { fingerprint: preview.fingerprint, requestId: 'sync-first' };
  const result = api.sync(input);
  assert.equal(result.linkedPlayers, 2);
  assert.equal(api.personal('1').total, 3);
  for (const id of [records.current.id, records.old.id, records.owned.id])
    assert.equal(api.detail(id).players[0].memberUid, '1');
  assert.equal(api.personal('2').total, 0);
  assert.deepEqual(api.sync(input), result);
  assert.throws(() => api.sync({ ...input, fingerprint: 'a'.repeat(64) }), code('REQUEST_CONFLICT'));
  assert.throws(() => api.sync({ ...input, requestId: 'stale' }), code('STALE_SYNC_PREVIEW'));
  const refreshed = api.preview();
  assert.equal(refreshed.summary.eligiblePlayers, 0);
  assert.equal(api.sync({ fingerprint: refreshed.fingerprint, requestId: 'empty' }).linkedPlayers, 0);
  const stale = api.preview();
  api.rename('1', '再次改名', 3);
  assert.throws(() => api.sync({ fingerprint: stale.fingerprint, requestId: 'after-rename' }), code('STALE_SYNC_PREVIEW'));
  for (const bad of [{}, { fingerprint: preview.fingerprint, requestId: '' }, { fingerprint: 'bad', requestId: 'bad' }])
    assert.throws(() => api.sync(bad), code('INVALID_SYNC_REQUEST'));
}

function localApi(repo) {
  return {
    upload: name => repo.saveBattleRecords(uploadInput(name)).records[0],
    add: row => repo.addMember(row),
    rename: (uid, name, revision) => repo.updateMember(uid, { name, primaryProfessionId: 3, revision }),
    preview: () => repo.previewBattleMemberSync(), sync: input => repo.syncBattleMembers(input),
    personal: uid => repo.getMemberBattleRecords(uid), detail: id => repo.getBattleRecord(id),
  };
}

test('SQLite sync repairs legacy members/aliases atomically, persists links, preserves CSV snapshots and upload retry hashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-sync-'));
  const filename = join(dir, 'test.sqlite');
  let repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    const api = localApi(repo), records = fixture(api);
    const snapshot = db.prepare('SELECT * FROM battle_records').all();
    const uploads = db.prepare('SELECT * FROM battle_uploads').all();
    const preview = api.preview();
    db.exec("CREATE TRIGGER reject_sync BEFORE INSERT ON battle_player_links WHEN (SELECT count(*) FROM battle_player_links)>1 BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    assert.throws(() => api.sync({ fingerprint: preview.fingerprint, requestId: 'fail' }), /simulated failure/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM battle_sync_requests').get().n, 0);
    assert.equal(api.personal('1').total, 1);
    db.exec('DROP TRIGGER reject_sync');
    checkSync(api, records);
    assert.deepEqual(db.prepare('SELECT * FROM battle_records').all(), snapshot);
    assert.deepEqual(db.prepare('SELECT * FROM battle_uploads').all(), uploads);
    repo.close(); repo = createRepository({ filename });
    assert.equal(repo.getMemberBattleRecords('1').total, 3);
    assert.equal(db.pragma('foreign_key_check').length, 0);
  } finally { db.close(); repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('GAS sync uses committed aliases and immutable snapshots; partial writes stay invisible and adapters support manager role', async () => {
  const env = await gasRuntime(); env.setup();
  const session = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]));
  const context = cloudSession(session);
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  const api = {
    upload: name => call('saveBattleRecords', [uploadInput(name)]).records[0],
    add: row => call('addMember', [row]),
    rename: (uid, name, revision) => call('updateMember', [uid, { name, primaryProfessionId: 3, revision }]),
    preview: () => call('previewBattleMemberSync'), sync: input => call('syncBattleMembers', [input]),
    personal: uid => call('getMemberBattleRecords', [uid, 1, {}]), detail: id => call('getBattleRecord', [id]).record,
  };
  const records = fixture(api);
  const snapshot = JSON.stringify(env.sheets.get('GM_battle_players').data);
  const first = api.preview();
  const input = { fingerprint: first.fingerprint, requestId: 'failed-sync' };
  for (const sheet of ['GM_battle_links', 'GM_commits']) {
    env.failOn(sheet);
    assert.equal(env.raw('syncBattleMembers', [input], context).ok, false);
    env.failOn(null);
    assert.equal(api.personal('1').total, 1);
    assert.equal(api.preview().fingerprint, first.fingerprint);
  }
  checkSync(api, records);
  assert.equal(JSON.stringify(env.sheets.get('GM_battle_players').data), snapshot);
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  for (const op of ['previewBattleMemberSync', 'syncBattleMembers']) {
    assert.equal(env.raw(op, op === 'syncBattleMembers' ? [input] : []).error.code, 'AUTH_REQUIRED');
    assert.equal(env.raw(op, op === 'syncBattleMembers' ? [input] : [], member).error.code, 'MANAGEMENT_REQUIRED');
  }
  assert.equal(env.raw('syncBattleMembers', [input], { sessionToken: session.sessionToken }).error.code, 'CSRF_INVALID');
  call('createManager', [{ username: 'manager', password: 'manager-password-123' }]);
  const manager = cloudResult(env.raw('login', [{ username: 'manager', password: 'manager-password-123' }]));
  setGasSession(manager);
  const run = {
    withSuccessHandler(fn) { this.done = fn; return this; },
    withFailureHandler() { return this; },
    previewBattleMemberSync(ctx) { this.done(env.raw('previewBattleMemberSync', [], ctx)); },
    syncBattleMembers(value, ctx) { this.done(env.raw('syncBattleMembers', [value], ctx)); },
  };
  try {
    const client = createBattleSyncClient({ source: 'gas', googleRun: run });
    const p = await client.preview();
    assert.equal((await client.sync({ fingerprint: p.fingerprint, requestId: 'manager-sync' })).linkedPlayers, 0);
  } finally { setGasSession({ user: null }); }
});

test('HTTP sync enforces management + CSRF and returns stale/retry errors through adapter', async () => {
  const repo = createRepository({ filename: ':memory:' });
  fixture(localApi(repo));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const authFetch = await authenticatedFetch(server, repo);
    const admin = await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.user.id, { password: 'Member123', revision: 0 });
    const member = await repo.authenticateMember({ password: 'Member123' });
    const client = createBattleSyncClient({ fetchImpl: (path, init) => authFetch(base + path, init) });
    const preview = await client.preview();
    const input = { fingerprint: preview.fingerprint, requestId: 'http-sync' };
    for (const path of ['/api/battle-sync/preview', '/api/battle-sync']) {
      const init = path.endsWith('preview') ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
      assert.equal((await fetch(base + path, init)).status, 401);
      assert.equal((await fetch(base + path, { ...init, headers: { ...init.headers, Cookie: `guild_session=${member.token}`, 'X-CSRF-Token': member.csrfToken } })).status, 403);
    }
    assert.equal((await fetch(base + '/api/battle-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `guild_session=${admin.token}` }, body: JSON.stringify(input) })).status, 403);
    assert.equal((await client.sync(input)).linkedPlayers, 2);
    assert.equal((await client.sync(input)).linkedPlayers, 2);
    await assert.rejects(client.sync({ ...input, requestId: 'stale-http' }), code('STALE_SYNC_PREVIEW'));
    const response = await authFetch(base + '/api/battle-sync/preview');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});
