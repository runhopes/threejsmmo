// Archer VFX bench captures: each skill at its key phases (seconds after the key press), stepped deterministically at
// 60 fps through the gameplay camera, one contact sheet per skill + the timeline the bench logged.
//   node tools/archervfx.mjs [basic,volley,...|all] [--cam=game|archer|far|close|side|top|target] [--ground=arena|grass|dirt|stone]
//                            [--lane=right|up|down|left|diag] [--dist=9] [--quality=high] [--creatures] [--moving] [--village]
//                            [--target=T1|T2|T3|F1|F2] [--out=shots/archervfx] [--scale=0.5] [--times=0.4,0.6]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : (args.includes('--' + k) ? true : d); };
const PHASES = {
  basic:  [0.42, 0.53, 0.575, 0.62, 0.7, 0.86],
  volley: [0.45, 0.57, 0.62, 0.68, 0.8, 0.95],
  pierce: [0.5, 0.72, 0.79, 0.84, 0.9, 1.08],
  farrow: [0.4, 0.53, 0.58, 0.66, 0.72, 1.3],
  parrow: [0.4, 0.53, 0.6, 0.71, 0.9, 2.2],
  rain:   [0.3, 0.63, 0.95, 1.2, 1.6, 2.6],
  rapid:  [0.31, 0.45, 0.66, 1.0, 1.32, 1.8],
  hop:    [0.1, 0.16, 0.26, 0.36, 0.46, 0.62],
  eagle:  [0.3, 0.47, 0.6, 0.85, 1.6, 3.2],
};
const first = args.find((a) => !a.startsWith('--'));
const skills = !first || first === 'all' ? Object.keys(PHASES) : first.split(',');
const outDir = path.resolve(opt('out', 'shots/archervfx'));
const scale = +opt('scale', 0.5), W = 1280, H = 720;
fs.mkdirSync(outDir, { recursive: true });
const q = new URLSearchParams({ shot: '1', fresh: '1', cam: opt('cam', 'game') });
if (opt('village')) q.set('world', 'village');
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'archer-vfx.html')).href + '?' + q.toString();

const killer = setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(3); }, 60000 + skills.length * 25000);
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errors = 0;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { errors++; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('console: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 30000 });
  await page.evaluate((o) => {
    for (const id of ['ctl', 'info', 'hint']) document.getElementById(id).style.display = 'none';
    const B = window.__bench; B.pause(true);
    if (o.ground) B.ground(o.ground);
    if (o.lane) B.set('lane', o.lane);
    if (o.dist) B.set('dist', +o.dist);
    if (o.quality) B.AV.tuning.quality = o.quality;
    if (o.creatures) B.set('creatures', true);
    if (o.moving) B.set('moving', true);
    if (o.target) B.select(o.target);
    B.setCam(o.cam);
    B.advance(0.6);
  }, { ground: opt('ground'), lane: opt('lane'), dist: opt('dist'), quality: opt('quality'), creatures: !!opt('creatures'), moving: !!opt('moving'), cam: opt('cam', 'game'), target: opt('target') });
  const custom = opt('times') && typeof opt('times') === 'string' ? opt('times').split(',').map(Number) : null;
  for (const skill of skills) {
    const times = custom || PHASES[skill]; if (!times) { console.log('unknown skill ' + skill); continue; }
    await page.evaluate(() => { window.__AV.clear(); window.__bench.advance(0.5); });
    await page.evaluate((s) => window.__bench.cast(s), skill);
    let t = 0; const files = [];
    for (const tt of times) {
      await page.evaluate((d) => window.__bench.advance(d), Math.max(0, tt - t)); t = tt;
      const f = path.join(outDir, `${skill}_${String(Math.round(tt * 1000)).padStart(4, '0')}.png`);
      await page.screenshot({ path: f }); files.push(f);
    }
    const stats = await page.evaluate(() => { const s = window.__AV.stats(); return `add ${s.add} norm ${s.norm} ground ${s.gadd + s.gnorm} trails ${s.trails} flats ${s.flats} beams ${s.beams} dropped ${s.dropped}`; });
    const tl = await page.evaluate(() => window.__bench.timeline());
    // contact sheet (3 columns, downscaled)
    const cols = 3, w = Math.round(W * scale);
    const html = `<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:2px;width:max-content">` +
      files.map((f) => `<div style="position:relative"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="display:block;width:${w}px"><span style="position:absolute;left:4px;top:3px;color:#fff;font:600 12px system-ui;background:#000a;padding:1px 6px;border-radius:3px">${skill} · ${path.basename(f, '.png').split('_')[1]} ms</span></div>`).join('') + '</body></html>';
    const sp = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await sp.setContent(html); await sp.waitForTimeout(50);
    const sheet = path.join(outDir, `sheet_${skill}.png`);
    await sp.screenshot({ path: sheet, fullPage: true }); await sp.close();
    console.log(`${sheet}\n  ${stats}\n  ` + tl.split('\n').join('\n  '));
  }
} finally { await browser.close(); clearTimeout(killer); }
console.log('page errors: ' + errors);
process.exit(errors ? 1 : 0);
