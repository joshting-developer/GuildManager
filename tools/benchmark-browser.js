import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Browser timing is a synthetic lab observation, not field INP or a visual regression test.
export async function benchmarkBrowser(origin) {
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
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.lab={lcp:null,cls:0,events:[]};new PerformanceObserver(l=>{for(const e of l.getEntries())lab.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)lab.cls+=e.value}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())lab.events.push(e.duration)}).observe({type:'event',buffered:true,durationThreshold:16});` });
    await call('Page.navigate', { url: origin });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.readyState==='complete'&&document.body.innerText.includes('登出')`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    const point = await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button,a')).find(e=>e.textContent.trim()==='成員清單'&&e.getBoundingClientRect().width);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!point) throw new Error('Member navigation missing');
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`location.hash==='#/members'&&document.body.innerText.includes('Bench0')`)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const result = await evaluate(`({route:location.hash,lcpMs:lab.lcp,cls:lab.cls,labInteractionMaxMs:lab.events.length?Math.max(...lab.events):null,resources:performance.getEntriesByType('resource').length,resourceBytes:performance.getEntriesByType('resource').reduce((n,e)=>n+e.transferSize,0),ttfbMs:performance.getEntriesByType('navigation')[0].responseStart})`);
    if (result.route !== '#/members') throw new Error('Member navigation failed');
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
