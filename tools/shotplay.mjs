// Archer shot in the game camera: click the dummy and grab crops around the hero through the shot.
//   node tools/shotplay.mjs <outPrefix> [q]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2] || 'shots/v3/ashot';
const useQ = process.argv[3] === 'q';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=archer';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const sp = (o) => page.evaluate((o) => {
    const v = (o ? window.__dummy.position.clone().setY(1.2) : window.__knight.root.position.clone().setY(1.1)).project(window.__camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }, o);
  const d = await sp(true);
  // stand to the side so the draw is seen in profile
  await page.keyboard.down('a'); await page.waitForTimeout(500); await page.keyboard.up('a'); await page.waitForTimeout(600);
  const d2 = await sp(true);
  if (useQ) { await page.mouse.move(d2.x, d2.y); await page.keyboard.press('q'); } else await page.mouse.click(d2.x, d2.y);
  for (let i = 0; i < 12; i++) {
    const c = await sp(false);
    await page.screenshot({ path: `${out}_${String(i).padStart(2, '0')}.png`, clip: { x: Math.max(0, c.x - 170), y: Math.max(0, c.y - 190), width: 340, height: 300 } });
    await page.waitForTimeout(40);
  }
} finally { await browser.close(); }
