import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkLocalSite } from '../tools/check-local-site.js';

test('local site monitor separates frontend, API liveness and database readiness without leaking failure bodies', async () => {
  let failed = false;
  const server = http.createServer((request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); return response.end('<html><script src="/main.js"></script></html>'); }
    if (request.url === '/main.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(''); }
    response.setHeader('Content-Type', 'application/json');
    if (failed && request.url === '/api/health') { response.statusCode = 503; return response.end('{"secret":"must-not-leak"}'); }
    response.end('{"status":"ok"}');
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await checkLocalSite(origin)).ok, true);
    failed = true;
    const report = await checkLocalSite(origin);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find(check => check.name === 'api-live').ok, true);
    assert.equal(report.checks.find(check => check.name === 'mysql-ready').status, 503);
    assert.doesNotMatch(JSON.stringify(report), /must-not-leak|secret/);
    await assert.rejects(checkLocalSite('https://example.test'));
    await assert.rejects(checkLocalSite(origin + '/path'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
