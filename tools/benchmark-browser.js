import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW_STORAGE_KEY } from '../src/domain/launch-countdown.js';

// Browser timing is a synthetic lab observation, not field INP or a visual regression test.
export async function benchmarkBrowser(origin, { route = '#/members', readyText = 'Bench', width = 1440, cpuSlowdown = 1 } = {}) {
  if (!process.env.CHROME_PATH) throw new Error('CHROME_PATH is required for browser measurements');
  const profile = mkdtempSync(join(tmpdir(), 'guild-benchmark-'));
  const chrome = spawn(process.env.CHROME_PATH, ['--headless', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  try {
    const browserUrl = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      chrome.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    const url = new URL(browserUrl);
    const tabs = await (await fetch(`http://${url.host}/json`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      message.error ? item.reject(new Error('CDP operation failed')) : item.resolve(message.result);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error('CDP timeout')); }, 20000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem(${JSON.stringify(PREVIEW_STORAGE_KEY)}, '1');window.lab={lcp:null,cls:0,events:[]};new PerformanceObserver(l=>{for(const e of l.getEntries())lab.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)lab.cls+=e.value}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())lab.events.push(e.duration)}).observe({type:'event',buffered:true,durationThreshold:16});` });
    await call('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
    await call('Page.navigate', { url: origin + '/' + route });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      ready = await evaluate(`location.hash===${JSON.stringify(route)}&&document.body.innerText.includes(${JSON.stringify(readyText)})`);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Benchmark route data did not load');
    const point = await evaluate(`(()=>{const e=document.querySelector('input');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (point) {
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await evaluate(`({route:location.hash,width:innerWidth,cpuSlowdown:${cpuSlowdown},nodes:document.querySelectorAll('*').length,rows:Array.from(document.querySelectorAll('a')).filter(e=>e.href.startsWith('https://example.test/video')).length,lcpMs:lab.lcp,cls:lab.cls,labInteractionMaxMs:lab.events.length?Math.max(...lab.events):null,resources:performance.getEntriesByType('resource').length,resourceBytes:performance.getEntriesByType('resource').reduce((n,e)=>n+e.transferSize,0),ttfbMs:performance.getEntriesByType('navigation')[0].responseStart})`);
    if (result.route !== route) throw new Error('Benchmark navigation failed');
    return result;
  } finally {
    socket?.close();
    if (chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill('SIGTERM'); await exited; }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) {
      if (error.code !== 'ENOTEMPTY') throw error;
      process.stderr.write('Chrome profile cleanup pending: ENOTEMPTY\n');
    }
  }
}
