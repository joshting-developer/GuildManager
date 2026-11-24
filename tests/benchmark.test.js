import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBenchmarkBudgets } from '../tools/benchmark-budgets.js';
import { createBenchmarkFixture } from '../tools/benchmark-fixture.js';
import { createTestRepository, repositoryDatabase } from './helpers/mysql-repository.js';

test('benchmark budgets reject unbounded results and incompatible baselines', () => {
  const report = { schemaVersion: 2, samples: 5, hardware: { cpus: 4 }, stages: [{ distribution: 'normal', fixture: { size: 20 },
    endpoints: [{ name: 'videos', sqlCount: 10, resultCount: 20, bytes: 10000, p95ms: 10 }],
    browsers: [{ route: '#/videos', width: 390, rows: 20, nodes: 1500, cls: 0 }] }] };
  assert.deepEqual(checkBenchmarkBudgets(report), { failures: [], warnings: [] });
  const changed = structuredClone(report);
  changed.stages[0].endpoints[0].resultCount = 21;
  changed.stages[0].endpoints[0].sqlCount = 50;
  changed.stages[0].browsers[0].nodes = 3000;
  assert.equal(checkBenchmarkBudgets(changed).failures.length, 3);
  const incompatible = structuredClone(report);
  incompatible.samples = 10;
  assert.throws(() => checkBenchmarkBudgets(report, incompatible), /sample count/);
  changed.stages[0].endpoints[0].p95ms = 80;
  assert.equal(checkBenchmarkBudgets(changed, report).warnings.length, 1);
});

test('benchmark fixtures separate normal and concentrated loads and preserve two-record batches', async () => {
  for (const distribution of ['normal', 'concentrated']) {
    const repo = await createTestRepository();
    try {
      const fixture = await createBenchmarkFixture(repo, distribution);
      const config = { size: 30, eventCount: 25, guestCount: 5, versionCount: 30, videoCount: 45 };
      const first = await fixture.grow(config);
      assert.deepEqual(await fixture.grow(config), first, 'growing to the same size is idempotent');
      assert.equal(first.maxRecordsPerUpload, 2);
      assert.equal(first.videos, distribution === 'normal' ? 20 : 45);
      assert.equal(first.versions, distribution === 'normal' ? 20 : 30);
      const db = repositoryDatabase(repo);
      const [counts] = await db.query('SELECT COUNT(DISTINCT event_id) AS events FROM battle_records');
      assert.ok(distribution === 'normal' ? counts.events > 1 : Number(counts.events) === 1);
      const [bad] = await db.query('SELECT COUNT(*) AS count FROM battle_records b JOIN scheduled_events e ON e.id=b.event_id WHERE e.type=\'activity\'');
      assert.equal(Number(bad.count), 0);
    } finally { await repo.close(); }
  }
});
