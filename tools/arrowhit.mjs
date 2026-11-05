// Archer: click the dummy (single shot) then Q (volley) and report each arrow's state.   node tools/arrowhit.mjs
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=archer';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const d = await page.evaluate(() => { const v = window.__dummy.position.clone().setY(1.2).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  const state = () => page.evaluate(() => (window.__arrows || []).map((a) => a.stuck > 0 ? (a.m.parent && a.m.parent.type !== 'Scene' ? 'STUCK-dummy' : 'STUCK-ground') : 'fly').join(','));
  await page.mouse.click(d.x, d.y); await page.waitForTimeout(1800);
  console.log('after shot  :', await state());
  await page.mouse.move(d.x, d.y); await page.keyboard.press('q'); await page.waitForTimeout(1800);
  console.log('after volley:', await state());
} finally { await browser.close(); }
console.log('page errors', errs);
