// Mage VFX contact sheets from the game camera (magefx.html, deterministic 1/60 s stepping):
//   node tools/mfxshot.mjs <outDir> [spell,spell|all] [extra query, e.g. "cam=far&world=arena&q=low"]
// One sheet per spell: <outDir>/<spell>.png, frames labelled with the time since the key press.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const [outDir = 'shots/mfx', which = 'all', extra = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const TIMES = {
  fireball: [0.25, 0.44, 0.55, 0.7, 0.84, 0.95, 1.3, 2.2],
  meteor:   [0.4, 0.82, 1.0, 1.25, 1.42, 1.55, 1.9, 3.0],
  nova:     [0.3, 0.48, 0.56, 0.68, 0.82, 0.96, 1.25, 1.9],
  ice:      [0.22, 0.38, 0.45, 0.56, 0.66, 0.8, 1.3, 2.4],
  bolt:     [0.3, 0.5, 0.57, 0.62, 0.68, 0.78, 1.0, 1.6],
  pillar:   [0.3, 0.48, 0.58, 0.68, 0.9, 1.5, 2.1, 2.8],
  blink:    [0.1, 0.2, 0.24, 0.28, 0.36, 0.5, 0.75, 1.1],
  mshield:  [0.2, 0.38, 0.45, 0.55, 0.8, 1.4, 1.48, 2.2],
  storm:    [0.6, 1.1, 1.52, 1.75, 2.0, 2.35, 2.75, 4.0],
};
const spells = which === 'all' ? Object.keys(TIMES) : which.split(',');
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'magefx.html')).href + '?shot=1' + (extra ? '&' + extra : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 120000 });
  if (await page.title() === 'ERR') console.log('page error:', await page.evaluate(() => document.getElementById('err').textContent));
  await page.evaluate(() => window.__mfxTest.advance(0.5));
  const clip = { x: 190, y: 40, width: 900, height: 640 };
  for (const sp of spells) {
    const frames = [];
    await page.evaluate(() => { const T = window.__mfxTest; T.fx.clear(); T.knight.root.position.copy(T.knight.root.position); T.advance(0.6); });
    await page.evaluate((id) => window.__mfxTest.cast(id), sp);
    let last = 0;
    for (const t of TIMES[sp]) {
      await page.evaluate((d) => window.__mfxTest.advance(d), t - last); last = t;
      if (sp === 'mshield' && t === 1.4) await page.evaluate(() => window.__mfxTest.shieldHit());
      const f = path.join(outDir, `${sp}_${String(Math.round(t * 100)).padStart(3, '0')}.png`);
      await page.screenshot({ path: f, clip }); frames.push([f, t]);
    }
    if (sp === 'blink') await page.evaluate(() => { const T = window.__mfxTest; T.cast('blink'); T.advance(1.2); });   // blink back home
    const b64 = frames.map(([f, t]) => [fs.readFileSync(f).toString('base64'), t]);
    const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(4,450px);gap:3px;width:max-content">${b64.map(([s, t]) =>
      `<div style="position:relative"><img src="data:image/png;base64,${s}" style="display:block;width:450px"><span style="position:absolute;left:5px;top:3px;color:#fff;font:600 13px sans-serif;background:#000a;padding:1px 6px">${sp} ${t.toFixed(2)}s</span></div>`).join('')}</body></html>`;
    const mp = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await mp.setContent(html); await mp.screenshot({ path: path.join(outDir, sp + '.png'), fullPage: true }); await mp.close();
    if (!process.env.KEEP) for (const [f] of frames) fs.unlinkSync(f);   // KEEP=1 keeps the full-resolution frames
    console.log('sheet', path.join(outDir, sp + '.png'));
  }
  const st = await page.evaluate(() => window.__mfxTest.fx.stats());
  console.log('stats', JSON.stringify(st));
} finally { await browser.close(); }
console.log('page errors', errs);
