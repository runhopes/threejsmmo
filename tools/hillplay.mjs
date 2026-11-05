// Walkable hills in the REAL game: vertical frame (hero y = 0, world group shifted by -yBase), click-to-move up a slope,
// feet / creatures on the terrain.   node tools/hillplay.mjs <outDir> [x:z hill foot] [--w=1600 --h=900] [--q=extra&query]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = args[0] || 'shots/hills';
const opt = (k, d) => { const a = args.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const start = (args[1] && !args[1].startsWith('--') ? args[1] : '-70:335').split(':').map(Number);
const goal = (opt('goal', '-70:262')).split(':').map(Number);
const W = +opt('w', 1600), H = +opt('h', 900);
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + opt('cls', 'warrior') + '&spawn=plaza' + (opt('q') ? '&' + opt('q') : '');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let bad = false;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { bad = true; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error: ' + m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village && window.__knight, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const sel = document.getElementById('select'); if (sel) sel.style.display = 'none'; });
  // teleport to the foot of the hill, camera keeps its offset
  await page.evaluate(([x, z]) => {
    const k = window.__knight.root.position, cam = window.__camera, ctl = window.__controls;
    const o = new THREE.Vector3(0, 7.4, 9.5), t = new THREE.Vector3(0, 1.3, 0);   // default game camera (~38 deg pitch, 12 m)
    k.set(x, 0, z); ctl.target.copy(k).add(t); cam.position.copy(k).add(o); ctl.update();
  }, start);
  await page.waitForTimeout(1200);
  const state = () => page.evaluate(() => { const W = window.__village.World, k = window.__knight.root.position; return { x: +k.x.toFixed(1), y: +k.y.toFixed(3), z: +k.z.toFixed(1), trueH: +W.heightAt(k.x, k.z).toFixed(2), yBase: +W.yBase.toFixed(2), groupY: +window.__village.group.position.y.toFixed(2) }; });
  if (opt('nofoot')) await page.evaluate(() => { window.__knight.groundAt = null; });
  console.log('start', JSON.stringify(await state()), 'footOffsets', JSON.stringify(await page.evaluate(() => window.__knight._fgS || null)));
  await page.screenshot({ path: path.join(out, '1_foot.png') });
  // real right-clicks on ground points ahead (projected through the game camera; the point sits on the terrain: frame height)
  const goals = String(opt('goals', '-126:190,-126:176,-126:162,-126:150')).split(',').map((q) => q.split(':').map(Number));
  let gi = 0;
  for (const g of goals) {
    const scr = await page.evaluate(([x, z]) => {
      const V = window.__village, cam = window.__camera, v = new THREE.Vector3(x, V.frameY(x, z), z).project(cam), r = document.querySelector('canvas').getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    }, g);
    await page.mouse.click(scr.x, scr.y, { button: 'right' });
    await page.waitForTimeout(3300);
    console.log('goal', g, 'click', Math.round(scr.x), Math.round(scr.y), JSON.stringify(await state()));
    if (++gi === 2) await page.screenshot({ path: path.join(out, '2_climb.png') });
  }
  await page.screenshot({ path: path.join(out, '3_top.png') });
  // pick accuracy: pickGround under the cursor at the screen centre vs the visible ground there
  console.log('pick', JSON.stringify(await page.evaluate(() => {
    const V = window.__village, cam = window.__camera, ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0.2, -0.3), cam);
    const p = V.pickGround(ray, new THREE.Vector3()); return p ? { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), frameY: +V.frameY(p.x, p.z).toFixed(2) } : null;
  })));
  console.log('creatures', JSON.stringify(await page.evaluate(() => { const c = window.__creatures; return c ? Object.keys(c).slice(0, 8) : 'no __creatures'; })));
  if (opt('creature')) {                                  // a creature standing on a slope: root on the terrain, hero fights it with the real right-click
    const pick = await page.evaluate(() => {
      const W = window.__village.World, C = window.__creatures.authority.creatures; let best = null;
      for (const c of C) { if (!c.alive) continue; const h = W.heightAt(c.x, c.z); if (h < 2.5 || h > 9 || W.sdAt(c.x, c.z) > -12) continue; if (!best || h > best.h) best = { id: c.id, x: c.x, z: c.z, h, sp: c.sp }; }
      return best;
    });
    console.log('creature pick', JSON.stringify(pick));
    if (pick) {
      await page.evaluate(([x, z]) => { const k = window.__knight.root.position, cam = window.__camera, ctl = window.__controls; const o = new THREE.Vector3(0, 7.4, 9.5), t = new THREE.Vector3(0, 1.3, 0); k.set(x, 0, z); ctl.target.copy(k).add(t); cam.position.copy(k).add(o); ctl.update(); }, [pick.x, pick.z + 9]);
      await page.waitForTimeout(2500);
      const info = () => page.evaluate((id) => { const c = window.__creatures, W = window.__village.World, rec = c.authority.byId.get(id), e = c.authority.byId && null; let y = null; c.group.children.forEach((g) => { if (Math.abs(g.position.x - rec.x) < 0.01 && Math.abs(g.position.z - rec.z) < 0.01) y = g.position.y; }); return { x: +rec.x.toFixed(1), z: +rec.z.toFixed(1), hp: rec.hp, frameY: +W.frameY(rec.x, rec.z).toFixed(2), rootY: y === null ? null : +y.toFixed(2), heroTrueH: +W.heightAt(window.__knight.root.position.x, window.__knight.root.position.z).toFixed(2) }; }, pick.id);
      console.log('creature before', JSON.stringify(await info()));
      await page.screenshot({ path: path.join(out, '4_creature.png') });
      const sc = await page.evaluate((id) => { const c = window.__creatures.authority.byId.get(id), V = window.__village, cam = window.__camera, v = new THREE.Vector3(c.x, V.frameY(c.x, c.z) + 0.8, c.z).project(cam), r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; }, pick.id);
      for (let k = 0; k < 8; k++) { await page.mouse.click(sc.x, sc.y, { button: 'right' }); await page.waitForTimeout(500); }
      await page.waitForTimeout(1500);
      console.log('creature after 8 clicks', JSON.stringify(await info()));
      await page.screenshot({ path: path.join(out, '5_fight.png') });
    }
  }
} finally { await browser.close(); }
if (bad) process.exitCode = 1;
