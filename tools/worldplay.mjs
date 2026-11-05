// The open world in the REAL game (index.html) at the game camera: reachability audit of every camp (BFS over the nav grid),
// creature census, then the hero is dropped at a few camps / landmarks for screenshots + a frame-rate probe.
//   node tools/worldplay.mjs <outDir> [campId ...]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/world/play';
const visit = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const base = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;
const EXTRA = process.env.WQ ? '&' + process.env.WQ : '';   // e.g. WQ=giants=0 (compare reachability without the ancient trees)
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let errs = 0;
const log = (...a) => console.log(...a);
const fps = (page) => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); }));
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => { errs++; log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errs++; log('console.error: ' + m.text().slice(0, 400)); } });
  const t0 = Date.now();
  await page.goto(base + '?cls=warrior&spawn=gate_outer' + EXTRA, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village && window.__knight && window.__creatures, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  log('load+build ms', Date.now() - t0);
  log('village stats', JSON.stringify(await page.evaluate(() => window.__village.stats)));
  // ---- reachability: BFS from the south gate over the wilderness nav grid ----
  const audit = await page.evaluate(() => {
    const W = window.Village.World, nav = window.__village.nav.wild, v = window.__village.nav.village;
    const cell = (x, z) => nav.cellOf(x, z);
    let s = nav.nearestFree(cell(0, 150), 12);
    const seen = new Uint8Array(nav.w * nav.h), q = new Int32Array(nav.w * nav.h); let h = 0, t = 0;
    q[t++] = s; seen[s] = 1; let free = 0, reach = 0;
    for (let i = 0; i < nav.block.length; i++) if (!nav.block[i]) free++;
    while (h < t) {
      const k = q[h++]; reach++; const i = k % nav.w, j = (k - i) / nav.w;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= nav.w || nj >= nav.h) continue; const nk = nj * nav.w + ni; if (seen[nk] || nav.block[nk]) continue; seen[nk] = 1; q[t++] = nk; }
    }
    const bad = [];
    const ok = (x, z, r) => { for (let a = 0; a < 8; a++) { const k = cell(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r); if (k >= 0 && seen[k]) return true; } const k = cell(x, z); return k >= 0 && seen[k]; };
    for (const c of W.camps) if (!ok(c.cx, c.cz, 3)) bad.push('camp ' + c.id);
    for (const b of W.bridges) if (!ok(b.x, b.z, 1)) bad.push('bridge ' + b.id);
    for (const [name, p] of Object.entries(W.sites)) if (!ok(p[0], p[1], 6)) bad.push('site ' + name);
    return { freeCells: free, reachable: reach, pct: +(reach / free * 100).toFixed(1), unreachable: bad, camps: W.camps.length, snapped: W.snapped, navW: nav.w, navH: nav.h };
  });
  log('reachability', JSON.stringify(audit));
  // ---- census ----
  const census = await page.evaluate(() => {
    const cr = window.__creatures, a = cr.authority, by = {};
    for (const c of a.creatures) { const k = c.sp; by[k] = by[k] || { n: 0, lv: [99, 0] }; by[k].n++; by[k].lv[0] = Math.min(by[k].lv[0], c.level); by[k].lv[1] = Math.max(by[k].lv[1], c.level); }
    return { total: a.creatures.length, bySpecies: by, stats: cr.stats(), sim: a.stats && a.stats() };
  });
  log('census', JSON.stringify(census));
  await page.waitForTimeout(500);
  log('fps at the gate', await fps(page));
  await page.screenshot({ path: path.join(out, 'gate.png') });
  const camps = visit.length ? visit : ['rat_a', 'rab_king', 'boar_a', 'wolf_c', 'gob_d', 'mrat_a', 'boss_gob', 'bb_b', 'fg_a', 'boss_frost'];
  for (const id of camps) {
    const info = await page.evaluate((id) => {
      const W = window.Village.World, c = W.camps.find((q) => q.id === id); if (!c) return null;
      const k = window.__knight.root.position, d = new THREE.Vector3(c.cx - k.x, 0, c.cz + c.r * 0.6 + 4 - k.z);
      k.add(d); window.__camera.position.add(d); window.__controls.target.add(d);
      return { id, species: c.species, at: [Math.round(c.cx), Math.round(c.cz)] };
    }, id);
    if (!info) { log('no camp', id); continue; }
    await page.waitForTimeout(3500);
    const st = await page.evaluate(() => ({ cr: window.__creatures.stats(), sim: window.__creatures.authority.stats && window.__creatures.authority.stats(), gl: { calls: window.__renderer.info.render.calls, tris: window.__renderer.info.render.triangles } }));
    log('camp', JSON.stringify(info), JSON.stringify(st), 'fps', await fps(page));
    await page.screenshot({ path: path.join(out, 'camp_' + id + '.png') });
  }
} finally { await browser.close(); }
log(errs ? 'ERRORS ' + errs : 'ok');
