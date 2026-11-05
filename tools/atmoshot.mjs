// Atmosphere / forest look in the REAL game (index.html) at the default game camera.
//   node tools/atmoshot.mjs <outDir> [spot1,spot2,...] [--w=1600 --h=900] [--q=extra&query] [--orbit=<rad>] [--zoom=<k>]
//        [--pitch=<deg> --dist=<m>]  explicit camera elevation / distance (e.g. --pitch=14 --dist=20 = low view with the horizon)
// Spots are world points the hero is teleported to (camera follows); each gives one screenshot + fps.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = args[0] || 'shots/atmo';
const opt = (k, d) => { const a = args.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SPOTS = {
  plaza: [0, 7.5], gate: [0, 92], meadow: [-17, 108], grove: [62, 116], camp: [76, 112], steppe: [-80, 110],
  reeds: [-52, 118], den: [-9, 134], east: [96, 20], west: [-96, -10], north: [10, -96], warren: [18, 104],
};
const list = (args[1] && !args[1].startsWith('--')) ? args[1].split(',') : ['plaza', 'gate', 'meadow', 'grove', 'camp', 'den'];
const W = +opt('w', 1600), H = +opt('h', 900), orbit = +opt('orbit', 0), zoom = +opt('zoom', 1), pitch = opt('pitch', null), dist = +opt('dist', 10.3);
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=warrior&spawn=plaza' + (opt('q') ? '&' + opt('q') : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let bad = false;
const fps = (page) => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1200) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); }));
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error: ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village && window.__knight, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  console.log('load ms', Date.now() - t0, JSON.stringify(await page.evaluate(() => window.__village.stats)));
  for (const s of list) {
    const p = SPOTS[s] || s.split(':').map(Number);
    await page.evaluate(([x, z, orbit, zoom, pitch, dist]) => {
      const k = window.__knight.root.position, cam = window.__camera, ctl = window.__controls;
      if (!window.__atmoOff) window.__atmoOff = [cam.position.clone().sub(k), ctl.target.clone().sub(k)];
      const [o0, t0] = window.__atmoOff;
      const off = pitch !== null ? new THREE.Vector3(0, Math.sin(pitch * Math.PI / 180) * dist, Math.cos(pitch * Math.PI / 180) * dist).applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit)
        : o0.clone().sub(t0).multiplyScalar(zoom).applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
      k.set(x, 0, z); ctl.target.copy(k).add(t0); cam.position.copy(ctl.target).add(off); ctl.update();
    }, [p[0], p[1], orbit, zoom, pitch === null ? null : +pitch, dist]);
    await page.evaluate(() => { const sel = document.getElementById('select'); if (sel) sel.style.display = 'none'; });   // class-select overlay would cover the bottom of the shot
    await page.waitForTimeout(900);
    const f = await fps(page);
    await page.screenshot({ path: path.join(out, s.replace(/[:]/g, '_') + '.png') });
    console.log(s, p, 'fps', f, JSON.stringify(await page.evaluate(() => { const i = window.__renderer && window.__renderer.info.render; return i ? { calls: i.calls, tris: i.triangles } : null; })));
  }
} finally { await browser.close(); }
if (bad) process.exitCode = 1;
