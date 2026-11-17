import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { BATTLE_COLUMNS, MAX_CSV_BYTES, MAX_IMAGE_BYTES } from '../../src/domain/battle-records.js';
import { MAX_PLATFORM_ICON_BYTES } from '../../src/domain/platform-settings.js';

const header = BATTLE_COLUMNS.map(([title]) => title).join(',');
const csv = `${header}\r\n紅方玩家,素問,1,2,3,400,0,500,600,1,2,0\r\n${header}\r\n藍方玩家,碎夢,2,3,4,500,1,0,400,2,1,1\r\n`;
const record = { filename: '戰績.csv', csvText: csv, datetime: '2026-10-24T21:30:00', redTeam: '紅幫', blueTeam: '藍幫', winner: 'red', type: 'guild_war', eventId: null };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function image(size, mimeType = 'image/png') {
  const bytes = Buffer.alloc(size);
  png.copy(bytes);
  return { name: '陣容圖片.png', mimeType, base64: bytes.toString('base64') };
}
function storage() {
  const objects = new Map();
  return { bucket: 'synthetic-local', objects,
    async put(key, bytes) { objects.set(key, Buffer.from(bytes)); },
    async get(key) { return objects.get(key); },
    async remove(key) { objects.delete(key); }, close() {},
  };
}

test('HTTP accepts exact CSV/image byte limits and downloads unchanged bytes with safe filenames', async () => {
  await withApp(async ({ admin }) => {
    const { request } = await admin();
    const csvText = csv + ' '.repeat(MAX_CSV_BYTES - Buffer.byteLength(csv));
    const attachment = image(MAX_IMAGE_BYTES);
    const response = await request('/battle-records', 'POST', { requestId: 'exact-limits', records: [{ ...record, csvText }], image: attachment });
    assert.equal(response.status, 201, await response.clone().text());
    const { records } = await response.json();
    for (const [kind, mime, expected, name] of [
      ['csv', 'text/csv; charset=utf-8', Buffer.from(csvText), record.filename],
      ['image', 'image/png', Buffer.from(attachment.base64, 'base64'), attachment.name],
    ]) {
      const result = await request(`/battle-records/${records[0].id}/attachments/${kind}`);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('content-type'), mime);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(result.headers.get('content-disposition').includes(encodeURIComponent(name)));
      assert.deepEqual(Buffer.from(await result.arrayBuffer()), expected);
    }
  });
});

test('oversize and invalid media fail before R2 IO or database staging', async () => {
  const files = storage();
  await withApp({ repositoryOptions: { fileStorage: files } }, async ({ admin, repository }) => {
    const { request } = await admin();
    const cases = [
      { records: [{ ...record, csvText: csv + ' '.repeat(MAX_CSV_BYTES - Buffer.byteLength(csv) + 1) }] },
      { image: image(MAX_IMAGE_BYTES + 1) },
      { image: image(64, 'image/jpeg') },
      { image: { name: 'x.png', mimeType: 'image/png', base64: '!!!!' } },
      { image: { name: 'x.svg', mimeType: 'image/svg+xml', base64: png.toString('base64') } },
    ];
    for (const [index, change] of cases.entries()) {
      const response = await request('/battle-records', 'POST', { requestId: `invalid-${index}`, records: [record], ...change });
      assert.equal(response.status, 422, await response.clone().text());
    }
    assert.equal(files.objects.size, 0);
    const db = repositoryDatabase(repository);
    for (const table of ['battle_records', 'file_metadata', 'file_staging']) assert.equal((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n, '0');
    const tooLarge = await request('/battle-records', 'POST', { padding: 'x'.repeat(10 * 1024 * 1024) });
    assert.equal(tooLarge.status, 413);
  });
});

test('platform icon exact limit persists, oversized and mismatched types preserve saved settings', async () => {
  await withApp(async ({ admin, request: anonymous }) => {
    const { request } = await admin();
    const icon = image(MAX_PLATFORM_ICON_BYTES);
    const saved = await request('/admin/platform-settings', 'PATCH', { name: '圖示驗證', revision: 1, icon });
    assert.equal(saved.status, 200, await saved.clone().text());
    const settings = await saved.json();
    for (const invalid of [image(MAX_PLATFORM_ICON_BYTES + 1), image(64, 'image/webp')]) {
      assert.equal((await request('/admin/platform-settings', 'PATCH', { name: '不可保存', revision: settings.platform.revision, icon: invalid })).status, 422);
    }
    assert.deepEqual(await (await anonymous('/platform-settings')).json(), settings);
    assert.equal(settings.platform.iconSrc, `data:image/png;base64,${icon.base64}`);
  });
});

test('video URLs round trip both rounds and replay without object IO; invalid schemes and lengths are rejected', async () => {
  const files = storage();
  await withApp({ repositoryOptions: { fileStorage: files } }, async ({ admin, repository, request: anonymous }) => {
    const { request } = await admin();
    const event = await repository.createEvent({ title: '影片驗證', type: 'scrimmage', dates: ['2026-10-24'], requestId: 'media-event' });
    const input = { name: '影片玩家', professionId: 3, firstUrl: 'https://example.test/watch?a=1&b=2', secondUrl: 'http://example.test/第二場', groupName: '進攻一', note: '第一行\n第二行', eventRevision: event.revision, requestId: 'media-video' };
    for (let index = 0; index < 2; index++) assert.equal((await anonymous(`/events/${event.id}/videos`, 'POST', input)).status, 201);
    const { videos } = await (await request(`/events/${event.id}/videos`)).json();
    assert.equal(videos.length, 1);
    for (const key of ['firstUrl', 'secondUrl', 'note']) assert.equal(videos[0][key], input[key]);
    for (const firstUrl of ['javascript:alert(1)', 'data:text/html,test', 'https://example.test/' + 'x'.repeat(2048)]) {
      assert.equal((await anonymous(`/events/${event.id}/videos`, 'POST', { ...input, requestId: 'invalid-url', firstUrl })).status, 422);
    }
    assert.equal(files.objects.size, 0, 'external video URLs are never uploaded to R2');
  });
});
