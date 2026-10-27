import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createBattleRecordClient } from '../src/api/battle-records.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';

const upload = () => ({ requestId: 'metadata-fixture', records: [{ type: 'scrimmage',
  filename: 'battle.csv', csvText: fixtureCsv(), datetime: '2026-10-05T00:00:00',
  redTeam: '原紅方', blueTeam: '原藍方', winner: null, ourSide: null }] });
const patch = { redTeam: '新紅方', blueTeam: '新藍方', winner: 'blue', ourSide: 'red',
  isInternal: false, revision: 0, requestId: 'metadata-edit' };
const keys = ['id', 'type', 'playedAt', 'roundNumber', 'redTeam', 'blueTeam', 'winner', 'ourSide', 'isInternal', 'revision'];
const editing = record => Object.fromEntries(keys.map(key => [key, record[key]]));

test('SQLite editing metadata matches fresh detail fields without decoding players, CSV or member projection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-metadata-'));
  const filename = join(directory, 'isolated.sqlite'), repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    const record = repo.saveBattleRecords(upload()).records[0];
    assert.deepEqual(repo.getBattleMetadata(record.id), editing(repo.getBattleRecord(record.id)));
    repo.updateBattleRecord(record.id, patch);
    const expected = editing(repo.getBattleRecord(record.id));
    assert.equal(expected.revision, 1);
    assert.deepEqual(repo.getBattleMetadata(record.id), expected);
    db.prepare('UPDATE battle_records SET players_json=?, csv_text=? WHERE id=?').run('broken', 'broken', record.id);
    assert.deepEqual(repo.getBattleMetadata(record.id), expected);
    assert.throws(() => repo.getBattleRecord(record.id), SyntaxError);
    repo.deleteBattleRecord(record.id, 1);
    assert.throws(() => repo.getBattleMetadata(record.id), { code: 'BATTLE_NOT_FOUND' });
  } finally { db.close(); repo.close(); rmSync(directory, { recursive: true }); }
});

test('HTTP metadata adapter uses one uncached management read and preserves member detail access and edit conflicts', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const record = repo.saveBattleRecords(upload()).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo);
    const calls = [], client = createBattleRecordClient({ fetchImpl: (path, init) => { calls.push(path); return authed(base + path, init); } });
    assert.deepEqual((await client.getMetadata(record.id)).record, repo.getBattleMetadata(record.id));
    assert.deepEqual(calls, [`/api/battle-records/${record.id}/metadata`]);
    assert.equal((await authed(base + calls[0])).headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + calls[0])).status, 401);
    const admin = (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' })).user;
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    const member = await repo.authenticateMember({ password: '001234' });
    const init = { headers: { Cookie: `guild_session=${member.token}` } };
    assert.equal((await fetch(base + calls[0], init)).status, 403);
    assert.equal((await fetch(base + `/api/battle-records/${record.id}`, init)).status, 200);
    await client.updateRecord(record.id, patch);
    assert.equal((await client.getMetadata(record.id)).record.revision, 1);
    await assert.rejects(client.updateRecord(record.id, { ...patch, requestId: 'stale' }), { code: 'REVISION_CONFLICT' });
    await client.deleteRecord(record.id, 1);
    await assert.rejects(client.getMetadata(record.id), { code: 'BATTLE_NOT_FOUND' });
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});

test('compiled GAS metadata reads only battles and commits under a held writer lock, retains role checks and fresh revisions', async t => {
  const env = await gasRuntime(); env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = [], ctx = context) => cloudResult(env.raw(op, args, ctx));
  const record = call('saveBattleRecords', [upload()]).records[0];
  const expected = editing(call('getBattleRecord', [record.id]).record);
  call('setMemberToken', [{ password: '001234', revision: 0 }]);
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: '001234' }])));
  call('createManager', [{ username: 'manager', password: 'manager-password' }]);
  const manager = cloudSession(cloudResult(env.raw('login', [{ username: 'manager', password: 'manager-password' }])));
  let reads = [];
  for (const [name, sheet] of env.sheets) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => { const range = getRange(...args), values = range.getValues;
      range.getValues = () => { reads.push(name); return values(); }; return range; };
  }
  const snapshot = () => JSON.stringify({ sheets: [...env.sheets].map(([n, s]) => [n, s.data]), properties: [...env.properties], files: [...env.files], fetches: env.fetches });
  const before = snapshot(), lock = env.lock.tryLock;
  env.lock.tryLock(); env.lock.tryLock = () => assert.fail('metadata must not acquire the writer lock');
  assert.deepEqual(call('getBattleMetadata', [record.id]).record, expected);
  assert.ok(reads.includes('GM_battles'));
  assert.ok(reads.every(name => ['GM_commits', 'GM_battles'].includes(name)), reads.join(','));
  const metadataReads = reads.length;
  reads = []; call('getBattleRecord', [record.id, { includeTeamContext: true }]);
  const detailReads = reads.length;
  assert.ok(detailReads > metadataReads);
  assert.equal(env.raw('getBattleMetadata', [record.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getBattleMetadata', [record.id], member).error.code, 'MANAGEMENT_REQUIRED');
  assert.deepEqual(call('getBattleMetadata', [record.id], manager).record, expected);
  assert.equal(env.raw('getBattleMetadata', ['missing'], context).error.code, 'BATTLE_NOT_FOUND');
  let success;
  const googleRun = { withSuccessHandler(fn) { success = fn; return this; }, withFailureHandler() { return this; },
    getBattleMetadata(id) { success(env.raw('getBattleMetadata', [id], manager)); } };
  assert.deepEqual((await createBattleRecordClient({ source: 'gas', googleRun }).getMetadata(record.id)).record, expected);
  assert.equal(snapshot(), before);
  env.lock.tryLock = lock; env.lock.releaseLock();
  call('updateBattleRecord', [record.id, patch]);
  assert.equal(call('getBattleMetadata', [record.id]).record.revision, 1);
  call('deleteBattleRecord', [record.id, 1]);
  assert.equal(env.raw('getBattleMetadata', [record.id], context).error.code, 'BATTLE_NOT_FOUND');
  t.diagnostic(`isolated Sheets getValues: detail ${detailReads}, metadata ${metadataReads}; not production latency`);
});
