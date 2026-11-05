// Browser check of CreatureWorld's lazy views + dormant sim with ~350 creatures (no index.html needed): node tools/crworld.mjs
// Loads creatures.html (all species + variants) in shot mode, injects sim.js + world.js and drives a world with viewRadius 110 /
// activeRadius 120 while a fake player runs across a 1400 x 2000 m map. Reports view counts, hit-target consistency, ms / update.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (/Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) return; if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.join(root, 'creatures.html')).href + '?sp=all&t=0&strip=1', { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR', null, { timeout: 60000 });
  for (const f of ['creatures/sim.js', 'creatures/world.js']) await page.addScriptTag({ path: path.join(root, f) });
  const res = await page.evaluate(() => {
    const out = {}, S = window.__shot, T = THREE;
    const ids = ['rat', 'rabbit', 'snake', 'boar', 'wolf', 'goblin', 'rat_swamp', 'snake_marsh', 'boar_black', 'wolf_dark', 'goblin_warrior', 'goblin_brute', 'wolf_frost', 'boar_iron', 'goblin_frost'].filter((s) => CreatureKit.SPECIES[s]);
    let seed = 42; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const zones = []; for (let i = 0; i < 50; i++) zones.push({ id: 'c' + i, species: ids[i % ids.length], cx: (R() - 0.5) * 1300, cz: -R() * 2000, r: 7 + R() * 3, count: 7 });
    zones.push({ id: 'start', species: 'rat', cx: 0, cz: -12, r: 5, count: 4 });
    const heroes = { me: { hitTargets: [] } };
    const cam = new T.PerspectiveCamera(38, 16 / 9, 0.1, 400); const scene = S.scene;
    const world = CreatureWorld.create({ scene, camera: cam, zones, heroes, viewRadius: 110, activeRadius: 120, obstacles: [] });
    const P = { x: 0, z: 0, alive: true };
    const frame = (dt) => { cam.position.set(P.x, 18, P.z + 16); cam.lookAt(P.x, 0, P.z); world.update(dt, P); };
    for (let i = 0; i < 30; i++) frame(1 / 30);
    const dist = (rec) => Math.hypot(rec.x - P.x, rec.z - P.z);
    const check = () => {
      let inR = 0, aliveViews = 0, farViews = 0;
      for (const rec of world.authority.creatures) { if (rec.alive && dist(rec) < 110) inR++; const e = world.views.get(rec.id); if (e) { if (rec.alive) aliveViews++; if (dist(rec) > 125 && !rec.target) farViews++; } }
      return { inR, views: world.views.size, aliveViews, farViews, targets: heroes.me.hitTargets.length };
    };
    out.start = check(); out.stats0 = world.stats();
    // run across the map
    let maxViews = 0, t0 = performance.now(), n = 0, bad = 0, appear = 0;
    world.hooks.onEvent = (ev) => { if (ev.type === 'appear') appear++; };
    for (let i = 0; i < 30 * 70; i++) {
      P.z -= 6 / 30; P.x = Math.sin(i / 400) * 300; frame(1 / 30); n++;
      if (i % 30 === 0) { const c = check(); maxViews = Math.max(maxViews, c.views); if (c.targets !== c.aliveViews) bad++; if (c.farViews) bad += 100; }
    }
    out.ms = (performance.now() - t0) / n; out.maxViews = maxViews; out.bad = bad; out.appear = appear; out.end = check(); out.stats1 = world.stats();
    // pin: keep a creature that is far away
    const far = world.authority.creatures.find((r) => r.alive && dist(r) > 130 && dist(r) < 200) || world.authority.creatures.find((r) => r.alive && dist(r) > 130);
    out.farId = far.id;
    P.z += 0; world.pin(far.id); frame(1 / 30);
    // move the player next to it, then away
    P.x = far.x; P.z = far.z + 30; for (let i = 0; i < 5; i++) frame(1 / 30);
    out.pinHasView = world.views.has(far.id);
    P.x += 400; for (let i = 0; i < 5; i++) frame(1 / 30);
    out.pinKeepsView = world.views.has(far.id);
    world.unpin(far.id); frame(1 / 30);
    out.unpinReleased = !world.views.has(far.id);
    // kill one in range, never views for corpses that never had one
    P.x = far.x; P.z = far.z + 10; for (let i = 0; i < 5; i++) frame(1 / 30);
    const tg = heroes.me.hitTargets.filter((t) => t.creature && t.creature.alive).sort((a, b) => Math.hypot(a.pos.x - P.x, a.pos.z - P.z) - Math.hypot(b.pos.x - P.x, b.pos.z - P.z))[0];
    if (tg) { world.damage(tg, 1e9, { x: P.x, z: P.z }); frame(1 / 30); out.targetsAfterKill = heroes.me.hitTargets.filter((t) => t.creature === tg.creature).length; }
    const Z0 = CREATURE_DEFS.ZONES[0]; out.zoneAt = !!world.zoneAt(Z0.cx, Z0.cz);
    out.markers = world.markers(P.x, P.z, 300).length;
    return out;
  });
  console.log(JSON.stringify(res, null, 1).replace(/\n\s*/g, ' '));
  ok(res.start.views === res.start.inR, `initial views == creatures within 110 m (${res.start.views}/${res.start.inR}), total ${res.stats0.creatures}`);
  ok(res.start.targets === res.start.aliveViews, 'hit targets exist exactly while a view exists (' + res.start.targets + ')');
  ok(res.bad === 0, 'while running across the map: targets == alive views and no far view survives (bad ' + res.bad + ')');
  ok(res.maxViews < 100, 'max simultaneous views ' + res.maxViews + ' of 351');
  ok(res.appear < 15, "views acquired by distance fire no 'appear' / rise (" + res.appear + " appear events)");
  ok(res.pinHasView && res.pinKeepsView && res.unpinReleased, 'pin keeps the view far away, unpin releases it');
  ok(res.targetsAfterKill === 0, 'killed creature loses its hit target');
  ok(res.zoneAt && res.markers > 5, 'zoneAt / markers keep working (markers ' + res.markers + ')');
  console.log(`  world.update: ${res.ms.toFixed(3)} ms / frame (sim + view management, 351 creatures, software GL page)`);
  ok(res.stats1.dormant > 300, 'sim dormant ' + res.stats1.dormant + ' / ' + res.stats1.creatures);
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally { await browser.close(); }
console.log(fails ? fails + ' FAILED' : 'crworld passed');
process.exit(fails ? 1 : 0);
