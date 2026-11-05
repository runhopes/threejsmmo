// Screenshot any page of the project after it sets document.title = 'ready'.
//   node tools/pageshot.mjs <page.html> "<query>" <out.png> [delayMs]     env: W=1920 H=1080
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [pg, query, out, delay] = process.argv.slice(2);
const W = +process.env.W || 1920, H = +process.env.H || 1080;
const b = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
let bad = false;
p.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
await p.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', pg)).href + (query ? '?' + query : ''), { waitUntil: 'load' });
await p.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 20000 });
await p.waitForTimeout(+delay || 0);
await p.screenshot({ path: out });
await b.close();
console.log(out + (bad ? '  ERRORS' : ''));
