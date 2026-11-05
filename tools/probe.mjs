// Evaluate a JS expression inside the page after a debug/sim render. Usage:
//   node tools/probe.mjs "anim=attack1&sim=1&t0=0.31&t1=0.31" "expr using window.__knight"
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [query, expr] = process.argv.slice(2);
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?' + query;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 15000 });
  console.log(JSON.stringify(await page.evaluate(expr), null, 1));
} finally { await browser.close(); }
