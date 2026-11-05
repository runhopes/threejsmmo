// Frame-cost breakdown of the castle village in the real game page (toggles parts of the scene and measures fps).
//   node tools/villageperf.mjs [spawn=plaza]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const spawn = process.argv[2] || 'plaza';
const base = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=warrior&spawn=' + spawn + '&nocreatures=1';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village && window.__knight, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const W = window.__village, scene = W.group.parent;
    const sun = scene.children.find((o) => o.isDirectionalLight && o.castShadow);
    const measure = () => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1600) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); });
    const out = {};
    out.full = await measure();
    sun.castShadow = false; out.noShadow = await measure(); sun.castShadow = true;
    const inst = W.group.children.filter((o) => o.isInstancedMesh), stat = W.group.children.filter((o) => o.isMesh && !o.isInstancedMesh && o.name.startsWith('vb_'));
    inst.forEach((o) => (o.visible = false)); out.noInstanced = await measure(); inst.forEach((o) => (o.visible = true));
    stat.forEach((o) => (o.visible = false)); out.noStatic = await measure(); stat.forEach((o) => (o.visible = true));
    const terr = W.group.children.find((o) => o.name === 'village_terrain'); terr.visible = false; out.noTerrain = await measure(); terr.visible = true;
    W.group.visible = false; out.noVillage = await measure(); W.group.visible = true;
    const sz = sun.shadow.mapSize.x; sun.shadow.mapSize.set(2048, 2048); sun.shadow.map.dispose(); sun.shadow.map = null; out.shadow2048 = await measure();
    sun.shadow.mapSize.set(sz, sz); sun.shadow.map.dispose(); sun.shadow.map = null;
    // where the triangles are (visible after frustum culling is unknown here; total per kind)
    const per = {};
    for (const o of W.group.children) { if (!o.geometry || !o.geometry.attributes.position) continue; const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); const k = o.isInstancedMesh ? o.name.split('_')[1] : (o.material.name || 'mat'); per[k] = (per[k] || 0) + Math.round(n); }
    out.trisByKind = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 14);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const info = await page.evaluate(() => { const rr = window.__village.group.parent; return null; });
  void info;
} finally { await browser.close(); }
