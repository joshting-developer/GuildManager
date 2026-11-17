import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { BATTLE_COLUMNS } from '../../src/domain/battle-records.js';

const header = BATTLE_COLUMNS.map(([title]) => title).join(',');
const csv = `${header}\r\n紅方玩家,素問,1,2,3,400,0,500,600,1,2,0\r\n${header}\r\n藍方玩家,碎夢,2,3,4,500,1,0,400,2,1,1\r\n`;
const record = { filename: '20261024_213000_紅幫_藍幫.csv', csvText: csv, datetime: '2026-10-24T21:30:00', redTeam: '紅幫', blueTeam: '藍幫', winner: 'red', type: 'guild_war', eventId: null };

test('battle upload, list, detail, attachment download and delete keep the JSON and header contract', async () =>
  withApp(async ({ admin, request: anonymous }) => {
    const { request } = await admin();
    const uploaded = await request('/battle-records', 'POST', { requestId: 'upload', records: [record], image: null });
    assert.equal(uploaded.status, 201);
    const list = await request('/battle-records?page=1');
    assert.equal(list.status, 200);
    const { records } = await list.json();
    assert.equal(records.length, 1);
    const id = records[0].id;
    const detail = await request(`/battle-records/${id}`);
    assert.equal(detail.status, 200);
    const { record: full } = await detail.json();
    assert.equal(full.id, id);
    assert.equal(full.redTeam, '紅幫');
    assert.equal(full.players.length, 2);
    const metadata = await request(`/battle-records/${id}/metadata`);
    assert.equal(metadata.headers.get('cache-control'), 'no-store');
    assert.equal((await metadata.json()).record.id, id);
    const attachment = await request(`/battle-records/${id}/attachments/csv`);
    assert.equal(attachment.status, 200);
    assert.equal(attachment.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(attachment.headers.get('x-content-type-options'), 'nosniff');
    assert.match(attachment.headers.get('content-disposition'), /attachment; filename="download.csv"/);
    assert.equal(await attachment.text(), csv);
    assert.equal((await request(`/battle-records/${id}/attachments/image`)).status, 404);
    assert.equal((await anonymous(`/battle-records/${id}`)).status, 401);
    const stale = await request(`/battle-records/${id}`, 'DELETE', { revision: 99 });
    assert.equal(stale.status, 409);
    const deleted = await request(`/battle-records/${id}`, 'DELETE', { revision: full.revision });
    assert.equal(deleted.status, 200);
    assert.deepEqual((await (await request('/battle-records')).json()).records, []);
    assert.equal((await request(`/battle-records/${id}`)).status, 404);
  }));
