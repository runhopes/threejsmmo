// Data sanity check of the open-world layout (village.html, no screenshots):
//   node tools/worldcheck.mjs
// Prints: zone label / site / marker points that are NOT on the walkable floor, bridges, steep-cell count, relief stats,
// camps that had to be snapped, and the ground height at spawn points.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'village.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 240000 });
  const r = await page.evaluate(() => {
    const W = window.Village.World, out = { off: [], bridges: [], zones: [] };
    const chk = (name, x, z, m) => { const s = W.sdAt(x, z); if (s > -(m || 3)) out.off.push(name + ' (' + Math.round(x) + ',' + Math.round(z) + ') sd=' + s.toFixed(1)); };
    for (const z of W.zones) { chk('zone ' + z.id, z.label[0], z.label[1]); out.zones.push(z.id + ' h=' + W.heightAt(z.label[0], z.label[1]).toFixed(1)); }
    for (const k in W.sites) if (k !== 'tower' && k !== 'titan') chk('site ' + k, W.sites[k][0], W.sites[k][1], 1);
    for (const m of W.markers) chk('marker ' + m[0], m[1], m[2], 0);
    for (const c of W.camps) chk('camp ' + c.id, c.cx, c.cz, 3);
    out.bridges = (W.bridges || []).map((b) => b.id + ' @' + Math.round(b.x) + ',' + Math.round(b.z));
    out.steep = W.steepCells; out.snapped = W.snapped;
    let hmax = -1e9, hmin = 1e9, n = 0, sl = 0;
    for (let i = 0; i < W.hgrid.length; i += 7) if (W.sd[i] < -4) { const h = W.hgrid[i]; hmax = Math.max(hmax, h); hmin = Math.min(hmin, h); n++; }
    out.floorHeight = { min: +hmin.toFixed(1), max: +hmax.toFixed(1), samples: n };
    out.yAtVillage = [W.heightAt(0, 0), W.heightAt(0, 120), W.heightAt(0, 180)].map((v) => +v.toFixed(2));
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
