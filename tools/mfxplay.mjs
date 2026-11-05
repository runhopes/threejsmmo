// Mage VFX in the REAL game with real input (index.html?cls=mage, training yard, game camera):
// click the dummy (basic attack = fireball), then keys 1..8 aimed at the dummy; a sheet of frames per spell.
//   node tools/mfxplay.mjs <outDir> [extra query, e.g. "mfx=0" for the old effects or "world=arena"]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [outDir = 'shots/mfx/play', extra = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=mage' + (extra ? '&' + extra : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
const PLAN = [   // [label, key ('click' = left click on the dummy), frame gaps in ms]
  ['0_fireball', 'click', [150, 150, 150, 150, 200, 300]],
  ['1_meteor', '1', [250, 300, 300, 200, 200, 400]],
  ['2_nova', '2', [250, 200, 150, 150, 200, 300]],
  ['3_ice', '3', [200, 150, 120, 120, 200, 300]],
  ['4_bolt', '4', [250, 200, 100, 100, 200, 400]],
  ['5_pillar', '5', [250, 200, 200, 300, 400, 600]],
  ['7_mshield', '7', [200, 200, 300, 400, 400, 400]],
  ['8_storm', '8', [400, 400, 300, 300, 300, 400]],
  ['6_blink', '6', [120, 120, 120, 150, 200, 300]],
];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  const mfx = await page.evaluate(() => !!window.__mfx);
  console.log('MageFX active:', mfx);
  // step back so the spells have room, then aim at the dummy
  await page.keyboard.down('s'); await page.waitForTimeout(700); await page.keyboard.up('s'); await page.waitForTimeout(800);
  const dummyAt = () => page.evaluate(() => { const v = window.__dummy.position.clone().setY(1.2).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  const clip = { x: 190, y: 40, width: 900, height: 640 };
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;   // ONLY=storm,blink runs a subset
  for (const [label, key, gaps] of PLAN.filter((p) => !only || only.some((o) => p[0].includes(o)))) {
    const d = await dummyAt();
    await page.mouse.move(d.x, d.y);
    if (key === 'click') await page.mouse.click(d.x, d.y); else await page.keyboard.press(key);
    const frames = [];
    for (let i = 0; i < gaps.length; i++) {
      await page.waitForTimeout(gaps[i]);
      const f = path.join(outDir, `${label}_${i}.png`); await page.screenshot({ path: f, clip }); frames.push(f);
    }
    await page.waitForTimeout(1600);
    const b64 = frames.map((f) => fs.readFileSync(f).toString('base64'));
    const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(3,450px);gap:3px;width:max-content">${b64.map((s, i) =>
      `<div style="position:relative"><img src="data:image/png;base64,${s}" style="display:block;width:450px"><span style="position:absolute;left:5px;top:3px;color:#fff;font:600 13px sans-serif;background:#000a;padding:1px 6px">${label} #${i}</span></div>`).join('')}</body></html>`;
    const mp = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await mp.setContent(html); await mp.screenshot({ path: path.join(outDir, label + '.png'), fullPage: true }); await mp.close();
    for (const f of frames) fs.unlinkSync(f);
  }
  const st = await page.evaluate(() => window.__mfx ? window.__mfx.stats() : null);
  console.log('stats', JSON.stringify(st));
} finally { await browser.close(); }
console.log('page errors', errs);
