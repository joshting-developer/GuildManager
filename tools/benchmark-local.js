// Synthetic local MySQL lab only; the helper refuses non-test schemas and requires an empty database.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import express from 'express';
import { benchmarkBrowser } from './benchmark-browser.js';
import { createTestApp } from '../tests/helpers/mysql-app.js';
import { repositoryDatabase } from '../tests/helpers/mysql-repository.js';
import { BATTLE_COLUMNS } from '../src/domain/battle-records.js';

const samples = 100;
assert.ok(process.env.CHROME_PATH, 'CHROME_PATH must identify an installed Chrome binary');
const app = await createTestApp();
let webServer;
const database = repositoryDatabase(app.repository);
const report = { scope: 'synthetic local MySQL; memory object storage; warm sequential HTTP; not production/RUM', hardware: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30) }, samples, stages: [] };
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
let queries = [];
function measureQuery(query) {
  return async (...args) => {
    const started = performance.now();
    const result = await query(...args);
    queries.push({ ms: performance.now() - started, rows: Array.isArray(result) ? result.length : 0 });
    return result;
  };
}
const query = database.query.bind(database), transaction = database.transaction.bind(database);
database.query = measureQuery(query);
database.transaction = (work, options) => transaction(connection => work({ ...connection, query: measureQuery(connection.query.bind(connection)) }), options);
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
eventLoop.enable();
try {
  const admin = await app.admin();
  const apiOrigin = new URL((await app.request('/live')).url).origin;
  const web = express();
  web.use('/api', async (request, response, next) => {
    try {
      const result = await fetch(apiOrigin + request.originalUrl, { headers: admin.headers });
      response.status(result.status).set('Content-Type', result.headers.get('content-type') || 'application/json').send(Buffer.from(await result.arrayBuffer()));
    } catch (error) { next(error); }
  });
  web.use(express.static('dist'));
  webServer = web.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => webServer.once('listening', resolve).once('error', reject));
  const browserOrigin = `http://127.0.0.1:${webServer.address().port}`;
  const event = (await (await admin.request('/events', 'POST', { title: 'Benchmark', type: 'scrimmage', dates: ['2026-11-21'], requestId: 'bench-event' })).json()).event;
  assert.ok(event?.id);
  const header = BATTLE_COLUMNS.map(([name]) => name).join(',');
  const player = side => Array.from({ length: 60 }, (_, i) => `Bench${side}${i},素問,1,2,3,400,0,500,600,1,2,0`).join('\r\n');
  const csvText = `${header}\r\n${player('red')}\r\n${header}\r\n${player('blue')}\r\n`;
  const upload = await admin.request('/battle-records', 'POST', { requestId: 'bench-upload', image: { name: 'bench.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }, records: [{ filename: 'bench.csv', csvText, datetime: '2026-11-21T21:30:00', redTeam: 'Bench', blueTeam: 'Opponent', winner: 'red', type: 'scrimmage' }] });
  assert.equal(upload.status, 201);
  const battle = (await (await admin.request('/battle-records')).json()).records[0];
  let members = 0, battles = 1;
  for (const size of [20, 100, 500]) {
    for (; members < size; members++) {
      await query(`INSERT INTO members (uid,name,primary_profession_id,primary_profession,secondary_profession,is_in_guild,is_in_club,joined_at,updated_at,revision) VALUES (?, ?,1,'','',1,1,'2026-11-17','2026-11-17',0)`, [`BENCH-${members}`, `Bench${members}`]);
    }
    for (; battles < size; battles++) {
      await query(`INSERT INTO battle_records (id,upload_id,event_id,event_snapshot_json,battle_type,played_at,red_team,blue_team,winner,filename,csv_text,players_json,content_hash,created_at,round_number,our_side,is_internal,csv_file_id)
        SELECT ?,upload_id,NULL,NULL,battle_type,played_at,red_team,blue_team,winner,filename,csv_text,players_json,?,created_at,NULL,our_side,is_internal,csv_file_id FROM battle_records WHERE id=?`, [`BENCH-${battles}`, `bench-hash-${battles}`, battle.id]);
    }
    await query(`INSERT IGNORE INTO battle_player_links (record_id,player_index,member_uid) SELECT id,0,'BENCH-0' FROM battle_records`);
    const stage = { members, battles, playersPerBattle: 120, endpoints: [] };
    for (const path of ['/home', '/members', '/events', '/lineups/editor', `/events/${event.id}/participation-form`, '/battle-records', `/battle-records/${battle.id}`, `/battle-records/${battle.id}?includeTeamContext=true`, '/members/BENCH-0/battle-records?all=true', `/battle-records/${battle.id}/attachments/csv`, `/battle-records/${battle.id}/attachments/image`, '/platform-settings']) {
      const times = [], sqlCounts = [], sqlTimes = [], rowCounts = [], bytes = [];
      for (let i = 0; i <= samples; i++) {
        queries = [];
        const start = performance.now();
        const response = await admin.request(path);
        const body = await response.arrayBuffer();
        assert.equal(response.status, 200, path);
        if (i === 0) continue;
        times.push(performance.now() - start); sqlCounts.push(queries.length); sqlTimes.push(queries.reduce((sum, q) => sum + q.ms, 0)); rowCounts.push(queries.reduce((sum, q) => sum + q.rows, 0)); bytes.push(body.byteLength);
      }
      stage.endpoints.push({ path, p50ms: percentile(times, .5), p95ms: percentile(times, .95), p99ms: percentile(times, .99), sqlCount: percentile(sqlCounts, .5), sqlP95ms: percentile(sqlTimes, .95), rows: percentile(rowCounts, .5), bytes: percentile(bytes, .5) });
    }
    stage.browser = await benchmarkBrowser(browserOrigin);
    report.stages.push(stage);
    console.log('measured synthetic stage', size);
  }
  report.eventLoop = { p95ms: eventLoop.percentile(95) / 1e6, maxMs: eventLoop.max / 1e6 };
  mkdirSync('.local/benchmarks', { recursive: true });
  writeFileSync('.local/benchmarks/latest.json', JSON.stringify(report, null, 2) + '\n');
} finally { eventLoop.disable(); if (webServer) await new Promise(resolve => webServer.close(resolve)); await app.close(); }
