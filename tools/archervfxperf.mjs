// Archer VFX cost under load: bench (archer-vfx.html), 4 stress archers + rain + rapid + eagle, 4 s at 60 fps;
// reports ArcherVFX.update() ms (avg / peak), peak live counts per pool and dropped particles.   node tools/archervfxperf.mjs
import { chromium } from 'playwright-core'; import { pathToFileURL } from 'node:url'; import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'archer-vfx.html')).href + '?fresh=1';
const b = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(url); await p.waitForFunction(() => document.title === 'ready' || document.title === 'ERR');
await p.waitForTimeout(1500);

const r = await p.evaluate(() => {
  const B = __bench, AV = __AV; B.pause(true); B.advance(0.3);
  // AV.update cost alone, under a party-sized load: stress archers + rain + rapid + eagle, 4 s at 60 fps
  B.set('stress', true); B.cast('rain');
  const orig = AV.update; let tot = 0, n = 0, peak = 0, maxP = { add: 0, norm: 0, g: 0, trails: 0, flats: 0, beams: 0 };
  AV.update = function (dt) { const t0 = performance.now(); orig(dt); const ms = performance.now() - t0; tot += ms; n++; peak = Math.max(peak, ms);
    const s = AV.stats(); maxP.add = Math.max(maxP.add, s.add); maxP.norm = Math.max(maxP.norm, s.norm); maxP.g = Math.max(maxP.g, s.gadd + s.gnorm); maxP.trails = Math.max(maxP.trails, s.trails); maxP.flats = Math.max(maxP.flats, s.flats); maxP.beams = Math.max(maxP.beams, s.beams); };
  for (let i = 0; i < 4; i++) { B.advance(0.5); if (i === 1) B.cast('rapid'); if (i === 2) AV.eagle(5); }
  B.advance(2);
  AV.update = orig;
  const s = AV.stats();
  return { avgMs: +(tot / n).toFixed(3), peakMs: +peak.toFixed(2), frames: n, peakCounts: maxP, dropped: s.dropped, pool: s.pool };
});
console.log(JSON.stringify(r)); console.log('errors', errs.length ? errs : 0);
await b.close();
