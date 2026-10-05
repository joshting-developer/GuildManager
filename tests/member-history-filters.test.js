import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { createMemberClient } from '../src/api/members.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { setGasSession } from '../src/api/gas.js';
import { createSheetStore } from '../gas/src/storage.js';

const header = '玩家名字,職業,擊敗,助攻,資源,對玩家傷害,對建築傷害,治療值,承受傷害,重傷,化羽/清泉,焚骨';
const csv = (name = '新成員', job = '碎夢') => `${header}\n${name},${job},10,20,3,100,200,0,300,2,0,0\n${name},${job},5,8,2,50,100,0,200,0,0,0\n${header}\n對手,鐵衣,1,2,3,40,50,0,100,1,0,0`;
const person = (uid, name = '新成員') => ({ uid, name, primaryProfessionId: 3, secondaryProfessionId: 1 });
const record = (name = '新成員', job = '碎夢', datetime = '2026-10-24') => ({
  filename: 'history.csv', csvText: csv(name, job), type: 'scrimmage', datetime,
  redTeam: '紅方', blueTeam: '藍方', winner: 'red',
});
const upload = (repo, row) => repo.saveBattleRecords({ records: [row], requestId: crypto.randomUUID() }).records[0];
function importRoster(repo, text) {
  const { fingerprint } = repo.previewMemberImport({ text });
  return repo.importMembers({ text, fingerprint });
}

async function gasFixture() {
  const env = await gasRuntime(); env.setup();
  const session = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]));
  const context = cloudSession(session);
  const call = (op, args = []) => cloudResult(env.rpc(op, args, context));
  const upload = (row) => call('saveBattleRecords', [{ records: [row], requestId: crypto.randomUUID() }]).records[0];
  const importRoster = (text) => call('importMembers', [{ text, fingerprint: call('previewMemberImport', [{ text }]).fingerprint }]);
  return { env, session, context, call, upload, importRoster };
}

test('new member and CSV import link every exact unassigned historical row, with final-batch duplicate checks', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const first = upload(repo, record());
    repo.addMember(person('001'));
    assert.equal(repo.getMemberBattleRecords('001').total, 2);
    assert.equal(repo.getBattleRecord(first.id).players[0].memberUid, '001');
    assert.equal(repo.getBattleRecord(first.id).players[1].memberUid, '001');
    assert.ok(!repo.getBattleRecord(first.id).players[2].memberUid);
    repo.updateMember('001', { name: '已改名', primaryProfessionId: 3, secondaryProfessionId: 1, revision: 1 });
    repo.addMember(person('002'));
    assert.equal(repo.getMemberBattleRecords('002').total, 0);
    assert.equal(repo.getBattleRecord(first.id).players[0].memberUid, '001');
    upload(repo, record('匯入角色'));
    upload(repo, record('同批重名'));
    const result = importRoster(repo, '003 匯入角色 素問 -\n004 同批重名 碎夢 -\n005 同批重名 龍吟 -');
    assert.equal(result.summary.added, 3);
    assert.equal(repo.getMemberBattleRecords('003').total, 2);
    assert.equal(repo.getMemberBattleRecords('004').total, 0);
    assert.equal(repo.getMemberBattleRecords('005').total, 0);
    assert.equal(importRoster(repo, '003 匯入角色 素問 -').summary.skipped, 1);
    assert.equal(repo.getMemberBattleRecords('003').total, 2);
    upload(repo, record('小寫'));
    repo.addMember(person('006', '小寫不同'));
    assert.equal(repo.getMemberBattleRecords('006').total, 0);
    repo.addMember(person('007', '既有同名'));
    repo.addMember({ ...person('008', '既有同名'), isInGuild: false, isInClub: false });
    upload(repo, record('既有同名'));
    repo.addMember(person('009', '既有同名'));
    assert.equal(repo.getMemberBattleRecords('009').total, 0);
  } finally { repo.close(); }
});

test('SQLite member/link writes roll back together and keep original snapshots, retry hashes and persistence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guild-history-'));
  const filename = join(dir, 'test.sqlite');
  let repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    const input = { records: [record()], requestId: 'original' };
    const saved = repo.saveBattleRecords(input).records[0];
    const before = db.prepare('SELECT * FROM battle_records').all();
    const requests = db.prepare('SELECT * FROM battle_uploads').all();
    db.exec("CREATE TRIGGER reject_links BEFORE INSERT ON battle_player_links BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    assert.throws(() => repo.addMember(person('001')), /simulated failure/);
    assert.equal(repo.listMembers().members.length, 0);
    assert.throws(() => importRoster(repo, '001 無戰績 素問 -\n002 新成員 碎夢 -'), /simulated failure/);
    assert.equal(repo.listMembers().members.length, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM battle_player_links').get().n, 0);
    db.exec('DROP TRIGGER reject_links');
    repo.addMember(person('001'));
    assert.deepEqual(db.prepare('SELECT * FROM battle_records').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM battle_uploads').all(), requests);
    assert.equal(repo.saveBattleRecords(input).records[0].id, saved.id);
    repo.close(); repo = createRepository({ filename });
    assert.equal(repo.getMemberBattleRecords('001').total, 2);
    assert.equal(db.pragma('foreign_key_check').length, 0);
  } finally { db.close(); repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('GAS single/import backfill overlays detail links without changing snapshots or retry results', async () => {
  const f = await gasFixture();
  const input = { records: [record()], requestId: 'original-history' };
  const result = f.call('saveBattleRecords', [input]);
  const original = result.records[0];
  const snapshot = JSON.stringify(f.env.sheets.get('GM_battle_players').data);
  f.call('addMember', [person('001')]);
  assert.equal(f.call('getMemberBattleRecords', ['001']).total, 2);
  assert.equal(f.call('getBattleRecord', [original.id]).record.players[1].memberUid, '001');
  assert.equal(JSON.stringify(f.env.sheets.get('GM_battle_players').data), snapshot);
  assert.deepEqual(f.call('saveBattleRecords', [input]), result);
  f.call('updateMember', ['001', { name: '新名', primaryProfessionId: 3, secondaryProfessionId: 1, revision: 1 }]);
  f.call('addMember', [person('002')]);
  assert.equal(f.call('getMemberBattleRecords', ['002']).total, 0);
  f.upload(record('匯入角色')); f.upload(record('同批重名'));
  f.importRoster('003 匯入角色 素問 -\n004 同批重名 碎夢 -\n005 同批重名 龍吟 -');
  assert.equal(f.call('getMemberBattleRecords', ['003']).total, 2);
  assert.equal(f.call('getMemberBattleRecords', ['004']).total, 0);
  assert.equal(f.call('getMemberBattleRecords', ['005']).total, 0);
  f.call('addMember', [person('007', '既有同名')]);
  f.call('addMember', [{ ...person('008', '既有同名'), isInGuild: false, isInClub: false }]);
  f.upload(record('既有同名'));
  f.call('addMember', [person('009', '既有同名')]);
  assert.equal(f.call('getMemberBattleRecords', ['009']).total, 0);
  const legacy = f.upload(record('舊格式角色'));
  const storage = createSheetStore(f.env);
  storage.transaction((store) => {
    store.put('battles', legacy.id, { ...store.get('battles', legacy.id), players: legacy.players });
    store.remove('battle_players', legacy.id);
  });
  const before = storage.transaction((store) => store.get('battles', legacy.id));
  f.call('addMember', [person('010', '舊格式角色')]);
  assert.equal(f.call('getMemberBattleRecords', ['010']).total, 2);
  assert.equal(f.call('getBattleRecord', [legacy.id]).record.players[0].memberUid, '010');
  assert.deepEqual(storage.transaction((store) => store.get('battles', legacy.id)), before);
});

test('GAS incomplete backfill is invisible and retries recover the whole member and batch', async () => {
  const f = await gasFixture(); f.upload(record());
  f.env.failOn('GM_battle_links');
  assert.equal(f.env.raw('addMember', [person('001')], f.context).ok, false);
  f.env.failOn(null);
  assert.equal(f.call('getMembers').members.length, 0);
  assert.ok(!f.call('getBattleRecord', [f.call('getBattleRecords').records[0].id]).record.players[0].memberUid);
  const text = '001 新成員 碎夢 -\n002 無戰績 素問 -';
  const input = { text, fingerprint: f.call('previewMemberImport', [{ text }]).fingerprint };
  f.env.failOn('GM_commits');
  assert.equal(f.env.raw('importMembers', [input], f.context).ok, false);
  f.env.failOn(null);
  assert.equal(f.call('getMembers').members.length, 0);
  f.call('importMembers', [input]);
  assert.equal(f.call('getMembers').members.length, 2);
  assert.equal(f.call('getMemberBattleRecords', ['001']).total, 2);
});

async function checkFilters(add, save, get) {
  const late = save(record('新成員', '碎夢', '2026-10-24T23:59'));
  save(record('新成員', '素問', '2026-10-25T00:00'));
  add(person('001'));
  for (let day = 1; day <= 21; day++) save(record('新成員', '龍吟', `2026-11-${String(day).padStart(2, '0')}`));
  const selected = get('001', { startDate: '2026-10-24', endDate: '2026-10-24', profession: '碎夢' });
  assert.equal(selected.total, 2); assert.equal(selected.summary.battleCount, 1);
  assert.equal(selected.entries[0].recordId, late.id);
  assert.equal(selected.summary.metrics.find(m => m.key === 'kill').total, 15);
  assert.equal(get('001', { endDate: '2026-10-24' }).total, 2);
  assert.equal(get('001', { startDate: '2026-10-25', endDate: '2026-10-25' }).total, 2);
  const first = get('001', { startDate: '2026-11-01', profession: '龍吟' });
  const second = get('001', { startDate: '2026-11-01', profession: '龍吟', page: 2 });
  assert.equal(first.total, 42); assert.equal(first.entries.length, 20); assert.equal(second.entries.length, 20);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.metrics.find(m => m.key === 'kill').total, 315);
  assert.equal(first.summary.battleCount, 21);
  const empty = get('001', { profession: '鐵衣' });
  assert.equal(empty.total, 0); assert.equal(empty.summary.battleCount, 0);
  assert.deepEqual(new Set(empty.professions), new Set(['碎夢', '素問', '龍吟']));
  for (const filters of [{ startDate: '2026-02-30' }, { endDate: 'wrong' }, { startDate: '2026-10-25', endDate: '2026-10-24' }, { profession: [] }])
    assert.throws(() => get('001', filters), e => e.code === 'BATTLE_FILTER_INVALID');
}

test('SQLite date/profession filters include Taipei boundary days and summaries precede pagination', async () => {
  const repo = createRepository({ filename: ':memory:' });
  try { await checkFilters(p => repo.addMember(p), r => upload(repo, r), (uid, filters) => repo.getMemberBattleRecords(uid, filters)); }
  finally { repo.close(); }
});

test('GAS filters match SQLite semantics and old session-context call remains compatible', async () => {
  const f = await gasFixture();
  await checkFilters(p => f.call('addMember', [p]), f.upload, (uid, { page = 1, ...filters } = {}) => f.call('getMemberBattleRecords', [uid, page, filters]));
  assert.equal(f.call('getMemberBattleRecords', ['001', 1]).total, 46);
  assert.equal(cloudResult(f.env.raw('getMemberBattleRecords', ['001', 1], f.context)).total, 46);
  f.call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const member = cloudSession(cloudResult(f.env.raw('loginMember', [{ password: 'Member123' }])));
  assert.equal(cloudResult(f.env.raw('getMemberBattleRecords', ['001', 1, { profession: '素問' }], member)).total, 2);
  assert.equal(f.env.raw('getMemberBattleRecords', ['001', 1, { profession: '素問' }]).error.code, 'AUTH_REQUIRED');
});

test('HTTP/adapter and GAS adapter forward filters and preserve existing access checks', async () => {
  const repo = createRepository({ filename: ':memory:' });
  upload(repo, record()); repo.addMember(person('001'));
  const server = createApp(repo).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const auth = await authenticatedFetch(server, repo);
    const client = createMemberClient({ fetchImpl: (path, init) => auth(base + path, init) });
    assert.equal((await client.getBattleRecords('001', 1, { profession: '碎夢', endDate: '2026-10-24' })).total, 2);
    assert.equal((await client.getBattleRecords('001', 1, { profession: '素問' })).total, 0);
    await assert.rejects(client.getBattleRecords('001', 1, { endDate: '2026-02-30' }), e => e.code === 'BATTLE_FILTER_INVALID');
    assert.equal((await fetch(`${base}/api/members/001/battle-records?profession=碎夢`)).status, 401);
    const f = await gasFixture(); f.upload(record()); f.call('addMember', [person('001')]);
    setGasSession(f.session);
    const run = { withSuccessHandler(fn) { this.done = fn; return this; }, withFailureHandler(fn) { this.fail = fn; return this; }, getMemberBattleRecords(...args) { this.done(f.env.raw('getMemberBattleRecords', args.slice(0, 3), args[3])); } };
    const gasClient = createMemberClient({ source: 'gas', googleRun: run, fetchImpl: () => assert.fail('no HTTP fallback') });
    assert.equal((await gasClient.getBattleRecords('001', 1, { profession: '碎夢' })).total, 2);
    assert.equal((await gasClient.getBattleRecords('001', 1, { profession: '素問' })).total, 0);
    setGasSession({ user: null });
  } finally { await new Promise(r => server.close(r)); repo.close(); }
});
