// Screenshots of the open world in the dev viewer (village.html).
//   node tools/worldshot.mjs <outDir> <spec> [<spec> ...]   spec = name:at:x:z[:iso] | name:cam:px:py:pz:tx:ty:tz[:fov]
//   e.g. node tools/worldshot.mjs shots/world gate:at:0:100:2 top:cam:0:2600:1000:0:0:1000:30
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = args[0] || 'shots/world';
const specs = args.slice(1).filter((a) => !a.startsWith('--'));
const W = +(args.find((a) => a.startsWith('--w=')) || '--w=1500').slice(4), H = +(args.find((a) => a.startsWith('--h=')) || '--h=860').slice(4);
const query = (args.find((a) => a.startsWith('--q=')) || '--q=').slice(4);
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'village.html')).href + (query ? '?' + query : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (t.includes('shader error')) fs.writeFileSync('shots/world/shader_error.txt', t); console.log('console.' + m.type() + ': ' + t.slice(0, 300)); }; });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 240000 });
  console.log('load ' + (Date.now() - t0) + ' ms, title=' + await page.title());
  console.log(JSON.stringify(await page.evaluate(() => { const w = window.__world; const V = window.Village; return { stats: w && w.stats, world: V.World && { fieldMs: Math.round(V.World.fieldMs), maps: V.World.maps && Math.round(V.World.maps.ms), terrain: V.World.terrainStats, populateMs: Math.round(V.World.populateMs || 0), scenery: V.World.sceneryStats, snapped: V.World.snapped, bridges: (V.World.bridges || []).length, nav: w.nav.wild && { w: w.nav.wild.w, h: w.nav.wild.h, ms: Math.round(w.nav.wild.buildMs) } } }; })));
  for (const s of specs) {
    const p = s.split(':'), name = p[0];
    if (p[1] === 'ortho') { await page.evaluate(() => window.Village.World.cullOff(true)); await page.setViewportSize({ width: +p[4] || 1100, height: +p[5] || 1100 }); await page.evaluate(([cx, cz, w, d]) => window.__ortho(cx, cz, w, d), [+p[2], +p[3], +p[6], +p[7]]); }
    else if (p[1] === 'at') await page.evaluate(([x, z, k]) => window.__at(x, z, k), [+p[2], +p[3], p[4] ? +p[4] : 1]);
    else await page.evaluate(([a, b, f]) => window.__cam(a, b, f), [[+p[2], +p[3], +p[4]], [+p[5], +p[6], +p[7]], p[8] ? +p[8] : 0]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, name + '.png') });
    if (p[1] === 'ortho') { await page.evaluate(() => { window.__ortho(0, 0, 0, 0); window.Village.World.cullOff(false); }); await page.setViewportSize({ width: W, height: H }); }
  }
} finally { await browser.close(); }
console.log(bad ? 'ERRORS' : 'ok');
