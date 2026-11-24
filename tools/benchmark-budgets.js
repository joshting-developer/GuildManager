import assert from 'node:assert/strict';

// Structural budgets fail reliably; noisy local timings are comparison warnings.
export function checkBenchmarkBudgets(report, baseline = null) {
  const failures = [], warnings = [];
  for (const stage of report.stages) {
    const label = `${stage.distribution}/${stage.fixture.size}`;
    for (const endpoint of stage.endpoints) {
      const key = `${label}/${endpoint.name}`;
      if (endpoint.sqlCount > 35) failures.push(`${key}: SQL count ${endpoint.sqlCount} > 35`);
      if (endpoint.name === 'videos' || endpoint.name === 'video-browser') {
        if (endpoint.resultCount > 20 || endpoint.bytes > (endpoint.name === 'video-browser' ? 65536 : 20000)) failures.push(`${key}: unbounded video response`);
      }
      if (['events', 'battles', 'personal'].includes(endpoint.name) && endpoint.resultCount > 20)
        failures.push(`${key}: more than 20 page rows`);
      if (['events', 'battles', 'personal'].includes(endpoint.name) && endpoint.bytes > 65536)
        failures.push(`${key}: page response > 64 KiB`);
      if (endpoint.name.includes('choices') && endpoint.resultCount > 200) failures.push(`${key}: more than 200 choices`);
      if (endpoint.name === 'platform' && endpoint.objectReads > 0) failures.push(`${key}: warm icon object read`);
    }
    for (const browser of stage.browsers) {
      const key = `${label}/${browser.route}/${browser.width}`;
      if (browser.route === '#/videos' && (browser.rows > 20 || browser.nodes > 2500)) failures.push(`${key}: video DOM budget exceeded`);
      if (browser.cls > 0.1) warnings.push(`${key}: lab CLS ${browser.cls.toFixed(3)} > 0.1`);
    }
  }
  if (baseline) {
    assert.equal(report.schemaVersion, baseline.schemaVersion, 'baseline format differs');
    assert.equal(report.samples, baseline.samples, 'baseline sample count differs');
    assert.deepEqual(report.hardware, baseline.hardware, 'compare on the same hardware');
    assert.deepEqual(report.stages.map(s => [s.distribution, s.fixture]), baseline.stages.map(s => [s.distribution, s.fixture]), 'baseline fixture differs');
    for (let i = 0; i < report.stages.length; i++) {
      const current = report.stages[i], previous = baseline.stages[i];
      assert.deepEqual(current.browsers.map(b => [b.route, b.width, b.cpuSlowdown]), previous.browsers.map(b => [b.route, b.width, b.cpuSlowdown]), 'baseline browser configuration differs');
      assert.deepEqual(current.endpoints.map(e => e.name), previous.endpoints.map(e => e.name), 'baseline endpoints differ');
      for (let j = 0; j < current.endpoints.length; j++) {
        const after = current.endpoints[j], before = previous.endpoints[j];
        if (after.p95ms > before.p95ms + Math.max(20, before.p95ms * .2)) warnings.push(`${current.distribution}/${current.fixture.size}/${after.name}: p95 increased beyond 20% / 20ms noise allowance`);
        if (after.sqlCount > before.sqlCount) failures.push(`${after.name}: SQL count regression`);
        if (after.bytes > before.bytes * 1.1 + 1024) failures.push(`${after.name}: response byte regression`);
      }
    }
  }
  return { failures, warnings };
}
