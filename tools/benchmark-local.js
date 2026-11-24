// Build dist first. Set GUILD_MYSQL_REPOSITORY_TEST_CONFIG and CHROME_PATH explicitly.
// BENCHMARK_SMOKE=true uses small fixtures; BENCHMARK_SAMPLES defaults to 100.
// BENCHMARK_BASELINE compares a saved schemaVersion=2 report on the same hardware.
// Synthetic local MySQL lab only; the helper refuses non-test schemas and requires an empty database.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import express from 'express';
import { benchmarkBrowser } from './benchmark-browser.js';
import { createTestApp } from '../tests/helpers/mysql-app.js';
import { repositoryDatabase, repositoryFileStorage } from '../tests/helpers/mysql-repository.js';
import { createBenchmarkFixture } from './benchmark-fixture.js';
import { checkBenchmarkBudgets } from './benchmark-budgets.js';

const samples = Number(process.env.BENCHMARK_SAMPLES || 100);
assert.ok(Number.isSafeInteger(samples) && samples >= 5 && samples <= 1000, 'BENCHMARK_SAMPLES must be 5..1000');
assert.ok(process.env.CHROME_PATH, 'CHROME_PATH must identify an installed Chrome binary');
const smoke = process.env.BENCHMARK_SMOKE === 'true';
const distributions = ['normal', 'concentrated'];
const stages = smoke ? [{ size: 20, eventCount: 25, guestCount: 5, versionCount: 2, videoCount: 45 }] : [
  { size: 20, eventCount: 20, guestCount: 0, versionCount: 1, videoCount: 20 },
  { size: 100, eventCount: 500, guestCount: 20, versionCount: 20, videoCount: 200 },
  { size: 500, eventCount: 2000, guestCount: 100, versionCount: 100, videoCount: 1000 },
];
const report = { schemaVersion: 2, scope: 'synthetic local MySQL; memory object storage; warm sequential HTTP; browser lab, not production/RUM',
  hardware: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, nodeVersion: process.version, memoryGiB: Math.round(os.totalmem() / 2 ** 30) }, samples, stages: [] };
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
eventLoop.enable();
try {
  for (const distribution of distributions) {
    const app = await createTestApp();
    let webServer;
    try {
      const database = repositoryDatabase(app.repository);
      let queries = [], objectReads = 0;
      const measureQuery = query => async (...args) => {
        const started = performance.now();
        const result = await query(...args);
        queries.push({ ms: performance.now() - started, rows: Array.isArray(result) ? result.length : 0 });
        return result;
      };
      database.query = measureQuery(database.query.bind(database));
      const transaction = database.transaction.bind(database);
      database.transaction = (work, options) => transaction(connection => work({ ...connection, query: measureQuery(connection.query.bind(connection)) }), options);
      const storage = repositoryFileStorage(app.repository), getObject = storage.get.bind(storage);
      storage.get = (...args) => { objectReads++; return getObject(...args); };
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
      const fixture = await createBenchmarkFixture(app.repository, distribution);
      for (const config of stages) {
        const stage = { distribution, fixture: await fixture.grow(config), endpoints: [], browsers: [] };
        const choice = await (await admin.request('/lineups/choices')).json();
        const endpoints = [
          ['members', '/members'], ['events', '/event-management'], ['lineup', '/lineups/editor'],
          ['lineup-history', `/lineups/events/${fixture.eventId}`],
          ['guests', `/events/${fixture.eventId}/participation-form`],
          ['battles', '/battle-records'], ['battle-detail', `/battle-records/${fixture.battleId}`],
          ['personal', '/members/BENCH-0/battle-records'],
          ['videos', `/events/${fixture.eventId}/videos`], ['video-browser', '/videos/browser'],
          ['lineup-choices', '/lineups/choices'], ['video-choices', '/videos/choices'],
          ...(choice.nextCursor ? [['lineup-choices-next', `/lineups/choices?cursor=${encodeURIComponent(choice.nextCursor)}`]] : []),
          ['platform', '/platform-settings'],
        ];
        for (const [name, path] of endpoints) {
          const times = [], sqlCounts = [], sqlTimes = [], rowCounts = [], bytes = [], reads = [];
          let resultCount = 0;
          for (let i = 0; i <= samples; i++) {
            queries = []; objectReads = 0;
            const start = performance.now(), response = await admin.request(path), body = await response.arrayBuffer();
            assert.equal(response.status, 200, name);
            const data = JSON.parse(Buffer.from(body).toString('utf8'));
            resultCount = (data.selected?.videos || data.videos || data.events || data.records || data.entries || data.members || []).length;
            if (i === 0) continue;
            times.push(performance.now() - start); sqlCounts.push(queries.length); sqlTimes.push(queries.reduce((sum, q) => sum + q.ms, 0));
            rowCounts.push(queries.reduce((sum, q) => sum + q.rows, 0)); bytes.push(body.byteLength); reads.push(objectReads);
          }
          stage.endpoints.push({ name, path: path.includes('cursor=') ? path.split('?')[0] + '?cursor=<synthetic>' : path,
            p50ms: percentile(times, .5), p95ms: percentile(times, .95), p99ms: percentile(times, .99), sqlCount: percentile(sqlCounts, .5),
            sqlP95ms: percentile(sqlTimes, .95), rows: percentile(rowCounts, .5), bytes: percentile(bytes, .5), resultCount, objectReads: percentile(reads, .5) });
        }
        for (const width of [1440, 390]) stage.browsers.push(await benchmarkBrowser(browserOrigin, { route: '#/videos', readyText: 'example.test/video', width, cpuSlowdown: 4 }));
        stage.browsers.push(await benchmarkBrowser(browserOrigin));
        report.stages.push(stage);
        console.log('measured synthetic stage', distribution, config.size);
      }
    } finally { if (webServer) await new Promise(resolve => webServer.close(resolve)); await app.close(); }
  }
  report.eventLoop = { p95ms: eventLoop.percentile(95) / 1e6, maxMs: eventLoop.max / 1e6 };
  report.budgets = checkBenchmarkBudgets(report, process.env.BENCHMARK_BASELINE ? JSON.parse(readFileSync(process.env.BENCHMARK_BASELINE, 'utf8')) : null);
  mkdirSync('.local/benchmarks', { recursive: true });
  writeFileSync('.local/benchmarks/latest.json', JSON.stringify(report, null, 2) + '\n');
  console.log('budget failures:', report.budgets.failures.length, 'timing/CLS warnings:', report.budgets.warnings.length);
  assert.deepEqual(report.budgets.failures, [], 'benchmark structural budgets failed; inspect private report');
} finally { eventLoop.disable(); }
