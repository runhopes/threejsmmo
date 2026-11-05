// What the PLAYER sees: drive index.html with real WASD input at the default game camera and capture crops of the
// knight while running in several directions.   node tools/runplay.mjs <outPrefix>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/v3/run';
fs.mkdirSync(path.dirname(out), { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + (process.env.CLS || 'warrior');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  // knight screen position -> crop around it
  const crop = async () => page.evaluate(() => {
    const k = window.__knight.root.position.clone(); k.y = 1.1;
    const v = k.project(window.__camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  });
  for (const [keysDown, tag] of [[['d'], 'right'], [['s'], 'down'], [['a'], 'left'], [['w'], 'up'], [['s', 'd'], 'downright']]) {
    for (const k of keysDown) await page.keyboard.down(k);
    await page.waitForTimeout(700);
    for (let i = 0; i < 4; i++) {
      const c = await crop();
      await page.screenshot({ path: `${out}_${tag}_${i}.png`, clip: { x: Math.max(0, c.x - 170), y: Math.max(0, c.y - 190), width: 340, height: 300 } });
      await page.waitForTimeout(80);
    }
    for (const k of keysDown) await page.keyboard.up(k);
    await page.waitForTimeout(500);
  }
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
