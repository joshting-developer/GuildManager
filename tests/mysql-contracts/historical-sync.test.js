import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

const person = (uid, name) => ({ uid, name, primaryProfessionId: 3 });
let uploadMinute = 0;
const uploadInput = (name, requestId = crypto.randomUUID()) => ({
  requestId,
  records: [{ filename: 'history.csv', csvText: fixtureCsv(name), type: 'scrimmage',
    datetime: `2026-10-24T12:${String(uploadMinute++).padStart(2, '0')}`, redTeam: '紅方', blueTeam: '藍方', winner: null }],
});
const code = expected => error => error.code === expected;

// Rename is used to reproduce members created before historical backfill existed.
async function fixture(api) {
  const current = (await api.upload('現在甲'));
  const old = (await api.upload('過去甲'));
  (await api.upload('乙')); (await api.upload('舊同名')); (await api.upload('未知'));
  (await api.add(person('1', '起始甲')));
  (await api.rename('1', '過去甲', 1)); (await api.rename('1', '現在甲', 2));
  (await api.add(person('2', '起始乙')));
  (await api.rename('2', '乙', 1)); (await api.rename('2', '舊同名', 2)); (await api.rename('2', '乙', 3));
  (await api.add(person('3', '起始丙')));
  (await api.rename('3', '舊同名', 1)); (await api.rename('3', '丙', 2));
  // A current name also matching another member's old name must not win priority.
  (await api.add(person('4', '起始丁')));
  (await api.rename('4', '乙', 1)); (await api.rename('4', '丁', 2));
  const owned = (await api.upload('現在甲'));
  return { current, old, owned };
}

async function checkSync(api, records) {
  const preview = (await api.preview());
  assert.equal(preview.summary.eligiblePlayers, 2);
  assert.equal(preview.summary.historyNamePlayers, 1);
  assert.equal(preview.summary.conflictPlayers, 2);
  assert.equal((await api.personal('1')).total, 1);
  const input = { fingerprint: preview.fingerprint, requestId: 'sync-first' };
  const result = (await api.sync(input));
  assert.equal(result.linkedPlayers, 2);
  assert.equal((await api.personal('1')).total, 3);
  for (const id of [records.current.id, records.old.id, records.owned.id])
    assert.equal((await api.detail(id)).players[0].memberUid, '1');
  assert.equal((await api.personal('2')).total, 0);
  assert.deepEqual((await api.sync(input)), result);
  (await assert.rejects(async () => (await api.sync({ ...input, fingerprint: 'a'.repeat(64) })), code('REQUEST_CONFLICT')));
  (await assert.rejects(async () => (await api.sync({ ...input, requestId: 'stale' })), code('STALE_SYNC_PREVIEW')));
  const refreshed = (await api.preview());
  assert.equal(refreshed.summary.eligiblePlayers, 0);
  assert.equal((await api.sync({ fingerprint: refreshed.fingerprint, requestId: 'empty' })).linkedPlayers, 0);
  const stale = (await api.preview());
  (await api.rename('1', '再次改名', 3));
  (await assert.rejects(async () => (await api.sync({ fingerprint: stale.fingerprint, requestId: 'after-rename' })), code('STALE_SYNC_PREVIEW')));
  for (const bad of [{}, { fingerprint: preview.fingerprint, requestId: '' }, { fingerprint: 'bad', requestId: 'bad' }])
    (await assert.rejects(async () => (await api.sync(bad)), code('INVALID_SYNC_REQUEST')));
}

function localApi(repo) {
  return {
    upload: async name => (await repo.saveBattleRecords(uploadInput(name))).records[0],
    add: async row => (await repo.addMember(row)),
    rename: async (uid, name, revision) => (await repo.updateMember(uid, { name, primaryProfessionId: 3, revision })),
    preview: async () => (await repo.previewBattleMemberSync()), sync: async input => (await repo.syncBattleMembers(input)),
    personal: async uid => (await repo.getMemberBattleRecords(uid)), detail: async id => (await repo.getBattleRecord(id)),
  };
}

test('MySQL sync repairs historical aliases atomically while retaining original battle and upload bytes', async () => {
 const repo=await createRepository(); const database=repositoryDatabase(repo);
 try {
  const api=localApi(repo),records=await fixture(api);
  const snapshot=await database.query('SELECT * FROM battle_records ORDER BY created_order');
  const uploads=await database.query('SELECT * FROM battle_uploads ORDER BY id');
  const preview=await repo.previewBattleMemberSync();
  // Links are one batched INSERT now; failing the receipt after it proves the links roll back too.
  const broken=createMysqlRepository({...database, transaction:(work,options)=>database.transaction(async connection=>(await work({query(sql,args){
   if(sql.startsWith('INSERT INTO battle_sync_requests')) throw new Error('synthetic sync failure');
   return connection.query(sql,args);
  }})),options)});
  await assert.rejects((broken.syncBattleMembers({fingerprint:preview.fingerprint,requestId:'fail'})),/synthetic sync failure/);
  assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM battle_sync_requests'))[0].count),0);
  assert.equal((await repo.getMemberBattleRecords('1')).total,1);
  await checkSync(api,records);
  assert.deepEqual(await database.query('SELECT * FROM battle_records ORDER BY created_order'),snapshot);
  assert.deepEqual(await database.query('SELECT * FROM battle_uploads ORDER BY id'),uploads);
  assert.equal((await createMysqlRepository(database).getMemberBattleRecords('1')).total,3);
 } finally {await repo.close();}
});

test('uploads and member sync write player links in one statement instead of one per player', async () => {
  const repo = await createRepository();
  const database = repositoryDatabase(repo);
  const statements = [];
  const observed = createMysqlRepository({
    ...database,
    transaction: (work, options) => database.transaction((connection) => work({
      query(sql, parameters) { statements.push(sql); return connection.query(sql, parameters); },
    }), options),
  }, { fileStorage: (await import('../helpers/mysql-repository.js')).repositoryFileStorage(repo) });
  const linkInserts = () => statements.filter((sql) => sql.startsWith('INSERT INTO battle_player_links')).length;
  try {
    const before = [];
    for (const name of ['甲', '乙', '丙']) before.push((await observed.saveBattleRecords(uploadInput(name))).records[0]);
    for (const [uid, name] of [['1', '甲'], ['2', '乙'], ['3', '丙'], ['4', '對手']])
      await database.query('INSERT INTO members (uid,name,primary_profession_id,primary_profession,is_in_guild,is_in_club,joined_at,updated_at,revision) VALUES (?,?,3,?,1,1,?,?,1)', [uid, name, '素問', '2026-01-01', '2026-01-01']);
    statements.length = 0;
    const preview = await observed.previewBattleMemberSync();
    const synced = await observed.syncBattleMembers({ fingerprint: preview.fingerprint, requestId: 'batched-sync' });
    assert.equal(synced.linkedPlayers, 6);
    assert.equal(linkInserts(), 1);
    // Preview + sync read a fixed set of tables; the count no longer grows with records or players.
    assert.ok(statements.length <= 15, `sync used ${statements.length} statements`);
    for (const record of before) assert.ok((await repo.getBattleRecord(record.id)).players.every((player) => player.memberUid));

    statements.length = 0;
    const uploaded = (await observed.saveBattleRecords(uploadInput('甲'))).records[0];
    assert.equal(linkInserts(), 1);
    assert.deepEqual(uploaded.players.map((player) => player.memberUid), ['1', '4']);
    const again = uploadInput('乙');
    await observed.saveBattleRecords(again);
    await assert.rejects(observed.saveBattleRecords({ ...again, requestId: 'same-content' }), code('BATTLE_DUPLICATE'));
  } finally { await repo.close(); }
});
