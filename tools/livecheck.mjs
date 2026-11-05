// Load a deployed (or staged) index.html WITHOUT query params on an emulated phone: expects the class selection (static hosting)
// or the account screens (with the server), no page errors; taps a class card + "enter" and reports that the hero spawned.
//   node tools/livecheck.mjs <outDir> <url> [--desktop]
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/newmap/live', url = process.argv[3], desktop = process.argv.includes('--desktop');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
try {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1280, height: 720 } } : { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('config.js')) errs.push(r.status() + ' ' + r.url().slice(0, 100)); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village, null, { timeout: 240000 });
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => ({ select: !!document.getElementById('select') && !document.getElementById('select').hidden, screens: !!document.querySelector('.ath-screen, #auth, .screen'), mobile: window.__MOBILE, online: window.__ONLINE }));
  await page.screenshot({ path: path.join(out, 'select.png') });
  let entered = null;
  if (st.select) {
    await page.evaluate(() => { document.querySelector('#select .card[data-cls="warrior"]').click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('enter').click());
    await page.waitForTimeout(6000);
    entered = await page.evaluate(() => { const k = window.__knight.root.position; return { x: +k.x.toFixed(1), z: +k.z.toFixed(1), joy: !!document.getElementById('m-joy') }; });
    await page.screenshot({ path: path.join(out, 'ingame.png') });
  }
  console.log('ready ms', Date.now() - t0, JSON.stringify(st), JSON.stringify(entered), errs.length ? 'ISSUES: ' + [...new Set(errs)].slice(0, 6).join(' | ') : 'no errors');
} finally { await browser.close(); }
