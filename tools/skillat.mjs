// One skill from a distance: CLS=.. node tools/skillat.mjs <out> <key> <dist> <ms,ms,...>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [out, key, dist, times] = process.argv.slice(2);
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + (process.env.CLS || 'warrior');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  // walk away from the dummy so the skill has room
  await page.keyboard.down('s'); await page.waitForTimeout(+dist * 260); await page.keyboard.up('s'); await page.waitForTimeout(700);
  const d = await page.evaluate(() => { const v = window.__dummy.position.clone().setY(1.0).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  await page.mouse.move(d.x, d.y);
  await page.keyboard.press(key);
  let last = 0;
  for (const [i, t] of times.split(',').map(Number).entries()) { await page.waitForTimeout(t - last); last = t; await page.screenshot({ path: `${out}_${i}.png` }); }
} finally { await browser.close(); }
console.log('page errors', errs);
