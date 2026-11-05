// Screenshots of the castle village dev viewer (village.html) from named views.
//   node tools/villageshot.mjs <outDir> [view1,view2,...] [--debug] [--w=1600 --h=900]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = args[0] || 'shots/village';
const list = (args[1] && !args[1].startsWith('--')) ? args[1].split(',') : null;
const debug = args.includes('--debug');
const W = +(args.find((a) => a.startsWith('--w=')) || '--w=1600').slice(4), H = +(args.find((a) => a.startsWith('--h=')) || '--h=900').slice(4);
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'village.html')).href + (debug ? '?debug=1' : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console.' + m.type() + ': ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 120000 });
  console.log('load ' + (Date.now() - t0) + ' ms, title=' + await page.title());
  console.log(JSON.stringify(await page.evaluate(() => window.__world && window.__world.stats)));
  const views = list || await page.evaluate(() => window.__views);
  for (const v of views) {
    await page.evaluate((v) => window.__setView(v), v);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(out, v + '.png') });
  }
  console.log(await page.evaluate(() => document.getElementById('hud').textContent));
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
