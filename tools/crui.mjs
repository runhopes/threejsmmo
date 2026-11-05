// Showcase UI capture: opens creatures.html interactively, toggles debug buttons, screenshots.  node tools/crui.mjs <query> <out.png> [buttonIds...]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [query, out, ...btns] = process.argv.slice(2);
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'creatures.html')).href + '?' + query;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR');
  for (const b of btns) { await page.click('#' + b); await page.waitForTimeout(300); }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
} finally { await browser.close(); }
console.log(out);
