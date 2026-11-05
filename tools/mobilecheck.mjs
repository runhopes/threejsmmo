// Phone emulation (touch + coarse pointer, landscape): loads the game, checks the mobile layer and takes a screenshot.
//   node tools/mobilecheck.mjs <outDir> [url]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/newmap/mobile';
const base = process.argv[3] || pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  const t0 = Date.now();
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'cls=warrior&spawn=plaza', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village && window.__knight, null, { timeout: 240000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => ({ mobile: window.__MOBILE, joy: !!document.getElementById('m-joy'), fire: !!document.getElementById('m-fire'), giants: window.Village.World && window.Village.World.sceneryStats && window.Village.World.sceneryStats.giants, mapMs: window.__miniMs }));
  // push the joystick forward with a real touch for a second and see that the hero moves
  const p0 = await page.evaluate(() => [window.__knight.root.position.x, window.__knight.root.position.z]);
  const jb = await page.evaluate(() => { const r = document.getElementById('m-joy').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb[0], y: jb[1], id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jb[0], y: jb[1] - 50, id: 1 }] });
  await page.waitForTimeout(2500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const p1 = await page.evaluate(() => [window.__knight.root.position.x, window.__knight.root.position.z]);
  await page.screenshot({ path: path.join(out, 'phone.png') });
  console.log('load+ready ms', Date.now() - t0, JSON.stringify(info), 'moved m', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1), errs.length ? 'ERRORS ' + errs.slice(0, 3).join(' | ') : 'no errors');
} finally { await browser.close(); }
