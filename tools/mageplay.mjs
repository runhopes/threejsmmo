// Mage in the real game camera: click the dummy (fireball) then Q on the dummy (meteor); frames of both.
//   node tools/mageplay.mjs <outPrefix>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2] || 'shots/v3/mage';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=mage';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const d = await page.evaluate(() => { const v = window.__dummy.position.clone().setY(1.2).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  const clip = { x: 240, y: 60, width: 800, height: 560 };
  await page.mouse.click(d.x, d.y);
  await page.waitForTimeout(250);
  for (let i = 0; i < 8; i++) { await page.screenshot({ path: `${out}_fb_${i}.png`, clip }); await page.waitForTimeout(55); }
  await page.waitForTimeout(1200);
  await page.mouse.move(d.x, d.y); await page.keyboard.press('q');
  await page.waitForTimeout(150);
  for (let i = 0; i < 12; i++) { await page.screenshot({ path: `${out}_mt_${String(i).padStart(2, '0')}.png`, clip }); await page.waitForTimeout(110); }
} finally { await browser.close(); }
console.log('page errors', errs);
