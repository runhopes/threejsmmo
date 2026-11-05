// Pathfinding + floor push-back in the open world (page API, no rendering needed).
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'village.html')).href + '?hero=0';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 240000 });
  const res = await page.evaluate(() => {
    const w = window.__world, W = window.Village.World, T = THREE, out = { paths: [], push: [] };
    const P = (x, z) => new T.Vector3(x, 0, z);
    const tests = [['plaza -> rat camp (through the gate)', P(0, 8), P(74, 198)], ['gate -> bridge', P(0, 150), P(0, 470)], ['bridge -> sazlik camp', P(0, 470), P(-72, 578)], ['north bank -> south bank (must use the bridge)', P(60, 430), P(60, 520)],
      ['meadow -> warren heart', P(0, 300), P(214, 330)], ['wolf wood -> wolf den', P(-250, 800), P(-320, 960)], ['frost valley', P(40, 1700), P(60, 1850)], ['wild -> village plaza', P(30, 200), P(0, 8)]];
    for (const [name, a, b] of tests) { const t0 = performance.now(); const p = w.findPath(a, b); out.paths.push({ name, ok: !!p, nodes: p ? p.length : 0, ms: +(performance.now() - t0).toFixed(1), len: p ? Math.round(p.reduce((s, q, i) => s + (i ? Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : Math.hypot(q.x - a.x, q.z - a.z)), 0)) : 0 }); }
    // push-back: drop points inside the river, the lake, a mountain, a wall of the keep and see where they end up
    for (const [name, x, z] of [['river Akardere', 120, 489], ['lake Aynagol', -430, 545], ['mountain east of the meadow', 330, 200], ['deep in rock south of the frost valley', 40, 2050], ['marsh pool', -60, 905], ['hill island (watchtower)', 232, 800]]) {
      const p = P(x, z); w.collide(p, 0.42); const sd = W.sdAt(p.x, p.z);
      out.push.push({ name, from: [x, z], to: [+p.x.toFixed(1), +p.z.toFixed(1)], sd: +sd.toFixed(2), onFloor: sd < -0.3 });
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
} finally { await browser.close(); }
