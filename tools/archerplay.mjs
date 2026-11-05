// Archer VFX in the REAL game with real input: index.html?cls=archer (village training yard), click the dummy (basic
// shot), then every skill key 1-8, screenshots through the game camera at the effect's key moments.
//   node tools/archerplay.mjs [--out=shots/archerplay] [--arena]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : (args.includes('--' + k) ? true : d); };
const out = path.resolve(opt('out', 'shots/archerplay'));
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=archer' + (opt('arena') ? '&world=arena' : '');
const killer = setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(3); }, 150000);
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load', timeout: 40000 });
  await page.waitForTimeout(2500);
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }); };
  const dummyXY = () => page.evaluate(() => { const v = window.__dummy.position.clone().setY(1.3).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  let d = await dummyXY();
  await page.mouse.move(d.x, d.y);
  // basic attack: click the dummy (Metin2-style engage)
  await page.mouse.click(d.x, d.y);
  await page.waitForTimeout(560); await shot('1_basic_release');
  await page.waitForTimeout(160); await shot('1_basic_hit');
  await page.waitForTimeout(1200);
  const keys = [
    ['1', 'volley', [600, 760]], ['2', 'pierce', [700, 820, 900]], ['3', 'farrow', [420, 600, 760]], ['4', 'parrow', [600, 760, 2200]],
    ['5', 'rain', [250, 1150, 1600, 2400]], ['6', 'rapid', [700, 1300]], ['7', 'hop', [200, 420]], ['8', 'eagle', [520, 1600]],
  ];
  for (const [k, name, waits] of keys) {
    d = await dummyXY(); await page.mouse.move(d.x, d.y);
    await page.keyboard.press(k);
    let t = 0;
    for (const w of waits) { await page.waitForTimeout(w - t); t = w; await shot(`${k}_${name}_${w}`); }
    await page.waitForTimeout(Math.max(300, 2400 - t));
  }
  const info = await page.evaluate(() => {
    const A = window.__archerVFX, s = A.stats();
    return { stats: s, arrows: (window.__arrows || []).map((a) => (a.stuck > 0 ? 'stuck' : 'fly')).join(','), fps: document.querySelector('.hud-perf, #perf') ? document.querySelector('.hud-perf, #perf').textContent : '' };
  });
  console.log(JSON.stringify(info));
} finally { await browser.close(); clearTimeout(killer); }
console.log(errors.length ? errors.join('\n') : 'page errors: 0');
process.exit(errors.length ? 1 : 0);
