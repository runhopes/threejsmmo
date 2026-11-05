// Game-camera close look at a camp: walk there with WASD, wheel-zoom in, take a few shots over time.
// node tools/crzoom.mjs <outPrefix> [species=rat] [wheel=-900]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/creatures/play/zoom', SP = process.argv[3] || 'rat', WHEEL = +(process.argv[4] || -900);
fs.mkdirSync(path.dirname(out), { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=warrior';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { bad++; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const camp = await page.evaluate((sp) => CREATURE_DEFS.ZONES.find((z) => z.species === sp), SP);
  for (let i = 0; i < 50; i++) {
    const s = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
    const dx = camp.cx - s.x, dz = camp.cz + camp.r * 0.6 - s.z;
    if (Math.hypot(dx, dz) < 1.0) break;
    const keys = []; if (dz < -0.5) keys.push('w'); if (dz > 0.5) keys.push('s'); if (dx < -0.5) keys.push('a'); if (dx > 0.5) keys.push('d');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(200);
    for (const k of keys) await page.keyboard.up(k);
  }
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, WHEEL);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1300); await page.screenshot({ path: `${out}_${i}.png` }); }
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
