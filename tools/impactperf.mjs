// Frame time with ~10 mobs being hit (Atherion hit fx + damage numbers), vs the same scene without hits.
//   node tools/impactperf.mjs [cls]
// Ten creatures are placed in a ring around the hero (game camera), then hit at 10 hits/s in total (each ~1/s, 15 % crits,
// a third heavy) through the same ImpactFX / combat-text calls index.html makes, plus a kill + EXP orb every 2 s.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const cls = process.argv[2] || 'warrior';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + cls + '&spawn=gate_outer', { waitUntil: 'load' });
await page.waitForTimeout(2500);
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log('renderer: ' + gpu);
const run = (hits) => page.evaluate(async (hits) => {
  const kp = __knight.root.position, cr = __creatures;
  const list = cr.authority.creatures.filter((c) => c.alive).slice(0, 10);
  list.forEach((c, i) => { const a = i / list.length * Math.PI * 2; c.x = kp.x + Math.cos(a) * 3.2; c.z = kp.z - 2 + Math.sin(a) * 2.4; });
  await new Promise((r) => setTimeout(r, 400));
  const fx = __impact, pg = __progress, U = fx.UNIT;
  const t0w = performance.now(); let fxMs = 0, frames = 0, last = performance.now(); const dts = [];
  const upd = fx.update, pup = pg.update;
  // interleaved A/B: blocks of 12 frames with the effect batches drawn / hidden (same load, same moment) -> their draw cost
  const fxMeshes = []; __camera.parent; (function walk(o) { if (o.name && o.name.startsWith('impactfx:')) fxMeshes.push(o); o.children.forEach(walk); })(__knight.root.parent);
  let block = 0; const ab = { on: [], off: [] };
  fx.update = function (dt) { const s = performance.now(); upd.call(fx, dt); fxMs += performance.now() - s; if (hits && (block & 1)) for (const m of fxMeshes) m.visible = false; };
  pg.update = function (dt) { const s = performance.now(); pup.call(pg, dt); fxMs += performance.now() - s; };
  let nextHit = 0, nextKill = 2000, n = 0;
  await new Promise((done) => {
    function f() {
      const now = performance.now(), dt = now - last; last = now; if (frames++ > 5) { dts.push(dt); if (frames % 12 > 2) (block & 1 ? ab.off : ab.on).push(dt); } if (frames % 12 === 0) block++;
      const el = now - t0w;
      if (hits) {
        while (el >= nextHit) {
          nextHit += 100; n++;
          const c = list[(Math.random() * list.length) | 0], e = cr.views.get(c.id); if (!e) continue;
          const crit = Math.random() < 0.15, heavy = Math.random() < 0.33;
          fx.hit({ root: e.view.root, r: fx.bodyRadius(c.D.height), surf: Math.max(0.25, c.D.radius * 0.6), depth: c.D.radius + 0.1, from: kp, kind: 'blade', heavy, crit, flash: (d, s) => e.view.flash(d, s) });
          __hud.combatText({ x: c.x, y: fx.NUMBER_Y, z: c.z }, String(80 + ((Math.random() * 60) | 0) * (crit ? 2 : 1)), crit ? 'crit' : 'dmg');
        }
        if (el >= nextKill) { nextKill += 2000; const c = list[(Math.random() * list.length) | 0]; fx.kill({ x: c.x, z: c.z }); pg.orb({ x: c.x, y: 0, z: c.z }, { pos: (o) => o.copy(kp) }, 100, () => {}, 0.3); }
      }
      if (el < 8000) requestAnimationFrame(f); else done();
    }
    requestAnimationFrame(f);
  });
  fx.update = upd; pg.update = pup;
  dts.sort((a, b) => a - b);
  const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
  return { frames: dts.length, avgMs: +avg.toFixed(2), p50: +dts[dts.length >> 1].toFixed(2), p95: +dts[(dts.length * 0.95) | 0].toFixed(2), max: +dts[dts.length - 1].toFixed(2), fxCpuMsPerFrame: +(fxMs / dts.length).toFixed(3), hits: n, stats: fx.stats(),
    abDrawnMs: ab.on.length ? +(ab.on.reduce((a, b) => a + b, 0) / ab.on.length).toFixed(2) : null, abHiddenMs: ab.off.length ? +(ab.off.reduce((a, b) => a + b, 0) / ab.off.length).toFixed(2) : null };
}, hits);
const res = { base: [], load: [] };
for (let k = 0; k < 3; k++) {                                  // alternate: this iGPU's frame time drifts between runs
  const b = await run(false); res.base.push(b); console.log('no hits   ' + JSON.stringify(b));
  const l = await run(true); res.load.push(l); console.log('10 hits/s ' + JSON.stringify(l));
}
const med = (a, k) => a.map((x) => x[k]).sort((x, y) => x - y)[a.length >> 1];
console.log('median avg ms: no hits ' + med(res.base, 'avgMs') + ' / hits ' + med(res.load, 'avgMs') + ' · p95: ' + med(res.base, 'p95') + ' / ' + med(res.load, 'p95') + ' · fx CPU ms/frame ' + med(res.load, 'fxCpuMsPerFrame') + ' · A/B fx drawn ' + med(res.load, 'abDrawnMs') + ' vs hidden ' + med(res.load, 'abHiddenMs'));
await page.screenshot({ path: 'shots/impact/perf_' + cls + '.png' });
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no errors');
await browser.close();
