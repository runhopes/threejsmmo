// Castle village in the REAL game (index.html) with real input at the default game camera.
//   node tools/villageplay.mjs <outDir>
// 1) class selection line-up on the plaza   2) Enter -> plaza spawn   3) WASD walks (collision against houses)
// 4) right-click moves that must path around buildings   5) ?cls=archer quick start in the training yard, shots at a butt
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] || 'shots/village/play';
fs.mkdirSync(out, { recursive: true });
const base = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=d3d11'] });
let errs = 0;
const log = (...a) => console.log(...a);
const pos = (page) => page.evaluate(() => { const p = window.__knight.root.position; return [+p.x.toFixed(2), +p.z.toFixed(2)]; });
const fps = (page) => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); }));
// screen position of a world point
const tp = (page, x, z) => page.evaluate(([x, z]) => { const k = window.__knight.root.position, d = new THREE.Vector3(x - k.x, 0, z - k.z); k.add(d); window.__camera.position.add(d); }, [x, z]);
const screenOf = (page, x, z) => page.evaluate(([x, z]) => { const v = new THREE.Vector3(x, 0, z).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, [x, z]);
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => { errs++; log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') log('console.error: ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__village && window.__knight, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  log('load+build ms', Date.now() - t0, JSON.stringify(await page.evaluate(() => window.__village.stats)));
  await page.screenshot({ path: path.join(out, '1_select.png') });
  await page.click('.card[data-cls=warrior]'); await page.waitForTimeout(300);
  await page.click('#enter'); await page.waitForTimeout(1200);
  log('spawn', await pos(page), 'fps', await fps(page));
  await page.screenshot({ path: path.join(out, '2_spawn.png') });
  // walk north toward the waystone: must stop at its dais
  await page.keyboard.down('w'); await page.waitForTimeout(2600); await page.keyboard.up('w'); await page.waitForTimeout(300);
  log('after W into the waystone', await pos(page));
  await page.screenshot({ path: path.join(out, '3_waystone.png') });
  // right-click far behind the tavern (north-east): path must go around it
  const tgt = [36, -36];
  const sp = await screenOf(page, tgt[0], tgt[1]);
  log('click target screen', sp);
  // the target is off-screen at this zoom: use the page API path instead and drive with a synthetic right click near the edge
  const path1 = await page.evaluate(([x, z]) => { const p = window.__village.findPath(window.__knight.root.position, new THREE.Vector3(x, 0, z)); return p ? p.map((q) => [+q.x.toFixed(1), +q.z.toFixed(1)]) : null; }, tgt);
  log('path to behind the tavern', JSON.stringify(path1));
  // real right-click on a visible ground point to the north-west, between houses
  const sp2 = await screenOf(page, -9, -14);
  await page.mouse.click(sp2.x, sp2.y, { button: 'right' });
  for (let i = 0; i < 5; i++) { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, '4_rclick_' + i + '.png') }); }
  log('after right-click move', await pos(page));
  // walk into a house wall (west): must be blocked
  await tp(page, -26.5, -2.0);
  await page.waitForTimeout(200);
  await page.keyboard.down('w'); await page.waitForTimeout(1800); await page.keyboard.up('w');
  log('walked north into the house at (-26.5,-10.8) -> stopped at', await pos(page));
  await page.screenshot({ path: path.join(out, '5_house_block.png') });
  // dev overlay toggle
  await page.keyboard.press('`'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '6_debug.png') });
  await page.keyboard.press('`');
  await page.close();
  // gate: start inside (?spawn=gate_inner) and walk south out through the passage
  const pg = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  pg.on('pageerror', (e) => { errs++; log('pageerror(gate): ' + e.message); });
  await pg.goto(base + '?cls=warrior&spawn=gate_inner', { waitUntil: 'load' }); await pg.waitForFunction(() => window.__village && window.__knight, null, { timeout: 120000 }); await pg.waitForTimeout(1500);
  log('gate_inner spawn', await pos(pg));
  await pg.screenshot({ path: path.join(out, '7a_gate_inside.png') });
  await pg.keyboard.down('s'); await pg.waitForTimeout(2600); await pg.keyboard.up('s'); await pg.waitForTimeout(300);
  log('in the passage', await pos(pg)); await pg.screenshot({ path: path.join(out, '7b_gate_passage.png') });
  await pg.keyboard.down('s'); await pg.waitForTimeout(3000); await pg.keyboard.up('s'); await pg.waitForTimeout(300);
  log('outside', await pos(pg)); await pg.screenshot({ path: path.join(out, '7c_gate_outside.png') });
  await pg.keyboard.down('a'); await pg.waitForTimeout(2500); await pg.keyboard.up('a');
  log('strafe west along the outer wall', await pos(pg)); await pg.screenshot({ path: path.join(out, '7d_outer_wall.png') });
  log('region', await pg.evaluate(() => document.querySelector('.hud-map .region') && document.querySelector('.hud-map .region').textContent));
  await pg.close();
  // reference: the old arena, same machine
  const pa = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await pa.goto(base + '?cls=warrior&world=arena', { waitUntil: 'load' }); await pa.waitForFunction(() => window.__knight, null, { timeout: 120000 }); await pa.waitForTimeout(1500);
  log('arena fps (reference)', await fps(pa));
  await pa.close();

  // quick start archer in the training yard, shoot the first butt
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p2.on('pageerror', (e) => { errs++; log('pageerror(archer): ' + e.message); });
  await p2.goto(base + '?cls=archer&spawn=archery', { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__village && window.__knight, null, { timeout: 120000 });
  await p2.waitForTimeout(1500);
  log('archer spawn', await pos(p2), 'dummy', await p2.evaluate(() => [window.__dummy.position.x, window.__dummy.position.z]), 'fps', await fps(p2));
  await p2.screenshot({ path: path.join(out, '8_yard.png') });
  const butt = await p2.evaluate(() => window.__village.registry.targets[1]);
  const bs = await p2.evaluate(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }, [butt.x, butt.cy, butt.z]);
  log('butt on screen', bs);
  for (let i = 0; i < 4; i++) { await p2.mouse.click(bs.x, bs.y); await p2.waitForTimeout(800); }
  log('target frame', await p2.evaluate(() => { const e = document.querySelector('.hud-target'); return e ? e.textContent.replace(/s+/g, ' ').slice(0, 80) : 'n/a'; }));
  await p2.screenshot({ path: path.join(out, '9_archery.png') });
  log('arrows', await p2.evaluate(() => (window.__arrows || []).map((a) => (a.stuck > 0 ? 'stuck' : 'fly') + '@' + a.m.getWorldPosition(new THREE.Vector3()).x.toFixed(1) + ',' + a.m.getWorldPosition(new THREE.Vector3()).z.toFixed(1)).join(' ')));
} finally { await browser.close(); }
log('page errors', errs);
