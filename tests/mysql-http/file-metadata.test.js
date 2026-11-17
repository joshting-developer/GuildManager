import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { createR2Storage, FileStorageError } from '../../server/storage/r2.js';
import { BATTLE_COLUMNS } from '../../src/domain/battle-records.js';

const header = BATTLE_COLUMNS.map(([title]) => title).join(',');
const csv = `${header}\r\n紅方玩家,素問,1,2,3,400,0,500,600,1,2,0\r\n${header}\r\n藍方玩家,碎夢,2,3,4,500,1,0,400,2,1,1\r\n`;
const record = { filename: 'original.csv', csvText: csv, datetime: '2026-10-24T21:30:00', redTeam: '紅幫', blueTeam: '藍幫', winner: 'red', type: 'guild_war', eventId: null };
const png = { name: '陣容.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
function memoryStorage() {
  const objects = new Map(), puts = [], gets = [];
  return { bucket: 'synthetic-local', objects, puts, gets,
    async put(key, bytes) { puts.push(key); objects.set(key, Buffer.from(bytes)); },
    async get(key) { gets.push(key); if (!objects.has(key)) throw new FileStorageError('FILE_NOT_FOUND', 404); return objects.get(key); },
    async remove(key) { objects.delete(key); }, close() {},
  };
}

test('MySQL keeps only file metadata, reload resolves exact CSV and shared image, retries do no object IO', async () => {
  const storage = memoryStorage();
  await withApp({ repositoryOptions: { fileStorage: storage } }, async ({ repository, admin }) => {
    const { request } = await admin();
    const dbForLock = repositoryDatabase(repository);
    const originalPut = storage.put;
    storage.put = async (...args) => {
      await dbForLock.transaction(connection => connection.query('SELECT id FROM repository_write_lock WHERE id=1 FOR UPDATE NOWAIT'));
      await originalPut(...args);
    };
    const input = { requestId: 'metadata-pair', records: [record, { ...record, redTeam: '另一幫會' }], image: png };
    const response = await request('/battle-records', 'POST', input);
    assert.equal(response.status, 201);
    const { records } = await response.json();
    assert.equal(records.length, 2);
    const db = repositoryDatabase(repository);
    const rows = await db.query('SELECT csv_text,csv_file_id FROM battle_records ORDER BY id');
    assert.ok(rows.every(row => row.csv_text === '' && row.csv_file_id));
    const [upload] = await db.query('SELECT image_data,image_file_id FROM battle_uploads');
    assert.equal(upload.image_data, null); assert.ok(upload.image_file_id);
    const files = await db.query('SELECT object_key,size_bytes,sha256,bucket FROM file_metadata');
    assert.equal(files.length, 3); assert.ok(files.every(file => file.bucket === storage.bucket));
    assert.equal(storage.puts.length, 3);
    assert.equal((await request('/battle-records', 'POST', input)).status, 201);
    assert.equal(storage.puts.length, 3, 'committed request replay must not stage files');
    const restarted = createMysqlRepository(db, { fileStorage: storage });
    const before = storage.gets.length;
    assert.equal((await restarted.getBattleAttachment(records[0].id, 'csv')).bytes.toString(), csv);
    assert.equal(storage.gets.length, before + 1, 'download reads only the requested object');
    for (const row of records) assert.deepEqual((await restarted.getBattleAttachment(row.id, 'image')).bytes, Buffer.from(png.base64, 'base64'));
    const text = JSON.stringify(await (await request('/battle-records')).json());
    assert.ok(!/object_key|files\/battle|sha256|synthetic-local/.test(text));
    assert.equal((await request(`/battle-records/${records[0].id}`, 'DELETE', { revision: records[0].revision })).status, 200);
    assert.equal((await request(`/battle-records/${records[0].id}/attachments/image`)).status, 404);
    assert.equal((await request(`/battle-records/${records[1].id}/attachments/image`)).status, 200);
    await assert.rejects(db.query('DELETE FROM file_metadata WHERE id=?', [upload.image_file_id]), { code: 'DATABASE_REFERENCE' });
  });
});

test('platform icon metadata survives reload, identical retry and name-only edit; removing icon preserves public DTO', async () => {
  const storage = memoryStorage();
  await withApp({ repositoryOptions: { fileStorage: storage } }, async ({ repository, admin, request: anonymous }) => {
    const { request } = await admin();
    const input = { name: '測試平台', revision: 1, icon: { mimeType: png.mimeType, base64: png.base64 } };
    const response = await request('/admin/platform-settings', 'PATCH', input);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.platform.iconSrc, `data:image/png;base64,${png.base64}`);
    const db = repositoryDatabase(repository);
    const [row] = await db.query('SELECT icon_base64,icon_mime_type,icon_file_id FROM platform_settings');
    assert.equal(row.icon_base64, null); assert.equal(row.icon_mime_type, null); assert.ok(row.icon_file_id);
    assert.deepEqual(await (await anonymous('/platform-settings')).json(), saved);
    assert.deepEqual(await (await request('/admin/platform-settings', 'PATCH', input)).json(), saved);
    assert.equal(storage.puts.length, 1);
    const renamed = await request('/admin/platform-settings', 'PATCH', { name: '新名稱', revision: saved.platform.revision });
    const changed = await renamed.json();
    assert.equal(changed.platform.iconSrc, saved.platform.iconSrc); assert.equal(storage.puts.length, 1);
    const removed = await request('/admin/platform-settings', 'PATCH', { name: '新名稱', revision: changed.platform.revision, icon: null });
    assert.equal(removed.status, 200); assert.equal((await removed.json()).platform.iconSrc, undefined);
    assert.equal((await db.query('SELECT icon_file_id FROM platform_settings'))[0].icon_file_id, null);
  });
});

test('R2 failure does not commit metadata, integrity failure is safe 503, and revoked session during staging cannot commit', async () => {
  const storage = memoryStorage(); const put = storage.put;
  let action;
  storage.put = async (key, bytes) => { await put(key, bytes); await action?.(); };
  await withApp({ repositoryOptions: { fileStorage: storage }, log: { error() {} } }, async ({ repository, admin, advance }) => {
    const { request } = await admin(); const db = repositoryDatabase(repository);
    action = () => { throw new FileStorageError(); };
    assert.equal((await request('/battle-records', 'POST', { requestId: 'failed', records: [record] })).status, 503);
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM file_metadata'))[0].n, '0');
    action = null;
    const saved = await (await request('/battle-records', 'POST', { requestId: 'success', records: [record] })).json();
    const [file] = await db.query('SELECT object_key FROM file_metadata');
    storage.objects.set(file.object_key, Buffer.from('corrupted'));
    const response = await request(`/battle-records/${saved.records[0].id}/attachments/csv`);
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'STORAGE_UNAVAILABLE');
    action = () => advance(9 * 60 * 60 * 1000);
    assert.equal((await request('/battle-records', 'POST', { requestId: 'revoked', records: [{ ...record, redTeam: '其他隊伍' }] })).status, 401);
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM file_metadata'))[0].n, '1');
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM battle_uploads'))[0].n, '1');
  });
});

const realConfig = process.env.GUILD_R2_TEST_CONFIG;
test('real MySQL plus R2 resolves original CSV, image and platform icon through existing HTTP contracts', { skip: !realConfig }, async () => {
  const config = JSON.parse(readFileSync(realConfig, 'utf8'));
  assert.equal(config.purpose, 'guildmanager-r2-test'); assert.match(config.environment.R2_BUCKET, /-local$/);
  const adapter = createR2Storage(config.environment), keys = [];
  const storage = { ...adapter, close() {}, async put(key, bytes, mimeType) { keys.push(key); await adapter.put(key, bytes, mimeType); } };
  try {
    await withApp({ repositoryOptions: { fileStorage: storage } }, async ({ admin, request: anonymous, repository }) => {
      const { request } = await admin();
      const uploaded = await request('/battle-records', 'POST', { requestId: 'real-r2', records: [record], image: png });
      assert.equal(uploaded.status, 201);
      const { records } = await uploaded.json();
      assert.equal(await (await request(`/battle-records/${records[0].id}/attachments/csv`)).text(), csv);
      assert.deepEqual(Buffer.from(await (await request(`/battle-records/${records[0].id}/attachments/image`)).arrayBuffer()), Buffer.from(png.base64, 'base64'));
      assert.equal((await anonymous(`/battle-records/${records[0].id}/attachments/csv`)).status, 401);
      const saved = await request('/admin/platform-settings', 'PATCH', { name: '真R2測試', revision: 1, icon: { mimeType: png.mimeType, base64: png.base64 } });
      assert.equal(saved.status, 200);
      assert.equal((await (await anonymous('/platform-settings')).json()).platform.iconSrc, `data:image/png;base64,${png.base64}`);
      assert.equal((await repositoryDatabase(repository).query('SELECT COUNT(*) AS n FROM file_metadata'))[0].n, '3');
    });
  } finally {
    try {
      for (const key of keys) { await adapter.remove(key); await assert.rejects(adapter.get(key), { code: 'FILE_NOT_FOUND' }); }
    } finally { adapter.close(); }
  }
});

test('legacy inline attachments remain readable without R2 and removal during object read prevents delivery', async () => {
  const storage = memoryStorage();
  await withApp({ repositoryOptions: { fileStorage: storage } }, async ({ repository, admin }) => {
    const { request } = await admin(); const db = repositoryDatabase(repository);
    const input = { requestId: 'legacy-fixture', records: [record], image: png };
    const saved = await repository.saveBattleRecords(input); const id = saved.records[0].id;
    await db.query('UPDATE battle_records SET csv_text=?,csv_file_id=NULL WHERE id=?', [csv, id]);
    await db.query('UPDATE battle_uploads SET image_data=?,image_file_id=NULL', [Buffer.from(png.base64, 'base64')]);
    await db.query('UPDATE platform_settings SET icon_base64=?,icon_mime_type=?,icon_file_id=NULL WHERE id=1', [png.base64, png.mimeType]);
    const noStorage = createMysqlRepository(db);
    assert.equal((await noStorage.getBattleAttachment(id, 'csv')).bytes.toString(), csv);
    assert.deepEqual((await noStorage.getBattleAttachment(id, 'image')).bytes, Buffer.from(png.base64, 'base64'));
    assert.equal((await noStorage.getPlatformSettings()).platform.iconSrc, `data:image/png;base64,${png.base64}`);
    const another = await repository.saveBattleRecords({ requestId: 'remove-during-read', records: [{ ...record, redTeam: '另一隊' }] });
    const target = another.records[0]; const originalGet = storage.get;
    storage.get = async key => {
      const result = await originalGet(key);
      await repository.deleteBattleRecord(target.id, target.revision);
      return result;
    };
    assert.equal((await request(`/battle-records/${target.id}/attachments/csv`)).status, 404);
  });
});
