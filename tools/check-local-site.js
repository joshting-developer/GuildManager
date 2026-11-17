import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function text(response, limit) {
  let length = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > limit) throw new Error('Response too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}

export async function checkLocalSite(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.origin !== origin) throw new Error('Explicit local HTTP origin required');
  const results = [];
  let asset;
  for (const [name, path] of [['frontend', '/'], ['api-live', '/api/live'], ['mysql-ready', '/api/health']]) {
    const started = performance.now();
    try {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      const body = await text(response, name === 'frontend' ? 65536 : 4096);
      const valid = response.status === 200 && (name === 'frontend'
        ? response.headers.get('content-type')?.includes('text/html') && /<html/i.test(body)
        : JSON.parse(body).status === 'ok');
      if (name === 'frontend') asset = body.match(/src="(\/[^"<>]+\.js(?:\?[^"<>]*)?)"/)?.[1];
      results.push({ name, ok: Boolean(valid), status: response.status, ms: Math.round(performance.now() - started) });
    } catch { results.push({ name, ok: false, code: 'CHECK_FAILED', ms: Math.round(performance.now() - started) }); }
  }
  if (asset) {
    try {
      const response = await fetch(origin + asset, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      await response.body?.cancel();
      results.push({ name: 'frontend-module', ok: response.status === 200 && /javascript/.test(response.headers.get('content-type') || ''), status: response.status });
    } catch { results.push({ name: 'frontend-module', ok: false, code: 'CHECK_FAILED' }); }
  } else results.push({ name: 'frontend-module', ok: false, code: 'MODULE_MISSING' });
  return { ok: results.every(result => result.ok), checks: results };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkLocalSite(process.argv[2]).then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; })
    .catch(() => { console.error('Local site check configuration failed'); process.exitCode = 1; });
}
