// Accessibility audit of the castle village: from the plaza spawn, every NPC point, building door, spawn and world exit
// must be reachable on the nav grid (and its standing spot must be free). Also checks every spawn is collision-free.
//   node tools/villagenav.mjs
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'village.html')).href + '?hero=0';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const W = window.__world, R = W.registry, nav = W.nav, col = W.collision;
    const from = R.spawns.plaza.position;
    const goals = [];
    for (const n of R.npcs) if (!(n.position.y > 0.5)) goals.push(['npc:' + n.id, n.position.x, n.position.z]);
    for (const b of W.buildings) if (b.door) goals.push(['door:' + (b.spec && b.spec.seed), b.door[0], b.door[1]]);
    for (const k in R.spawns) goals.push(['spawn:' + k, R.spawns[k].position.x, R.spawns[k].position.z]);
    for (const t of R.transitions) goals.push(['exit:' + t.id, t.center.x, t.center.z]);
    for (const d of R.dummies) goals.push(['dummy', d.x, d.z + 1.4]);
    for (const t of R.targets) goals.push(['butt-front', t.x + Math.sin(t.yaw) * 1.6, t.z + Math.cos(t.yaw) * 1.6]);
    const out = { ok: 0, fail: [], far: [], spawnsBlocked: [] };
    let tMax = 0;
    for (const [id, x, z] of goals) {
      const t0 = performance.now();
      const p = nav.findPath(from.x, from.z, x, z);
      tMax = Math.max(tMax, performance.now() - t0);
      if (!p) { out.fail.push(id); continue; }
      const e = p[p.length - 1], d = Math.hypot(e.x - x, e.z - z);
      if (d > 2.2) out.far.push(id + ' (' + d.toFixed(1) + ' m short)'); else out.ok++;
    }
    for (const k in R.spawns) { const s = R.spawns[k].position; if (col.blocked(s.x, s.z, W.config.playerRadius)) out.spawnsBlocked.push(k); }
    out.goals = goals.length; out.worstPathMs = +tMax.toFixed(1);
    let free = 0; for (let i = 0; i < nav.block.length; i++) if (!nav.block[i]) free++;
    out.walkableArea_m2 = Math.round(free * nav.cell * nav.cell);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); }
