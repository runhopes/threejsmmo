// Atherion hit / kill feedback in the REAL game, real input (right click = attack), game camera, frame-exact crops.
//   node tools/impactplay.mjs [warrior|archer|mage ...]   -> shots/impact/<cls>_*.png
// A virtual clock replaces performance.now / requestAnimationFrame: the game runs in real time while walking to the camp,
// then advances one 60 Hz frame at a time so contact / +50 / +150 / +300 ms are exact.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const classes = process.argv.slice(2).length ? process.argv.slice(2) : ['warrior', 'archer', 'mage'];
const OUT = 'shots/impact';
fs.mkdirSync(OUT, { recursive: true });
const VW = 1600, VH = 900;
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const clockInit = () => {
  const realNow = performance.now.bind(performance), realRAF = window.requestAnimationFrame.bind(window);
  let manual = false, vt = 0, last = realNow(), q = [];
  performance.now = () => { if (!manual) { const r = realNow(); vt += r - last; last = r; } return vt; };
  window.requestAnimationFrame = (cb) => { if (manual) { q.push(cb); return 1; } return realRAF(() => cb(performance.now())); };
  window.__vclock = {
    manual(on) { if (on === manual) return; performance.now(); manual = on; if (!on) { last = realNow(); const k = q; q = []; k.forEach((cb) => realRAF(() => cb(performance.now()))); } },
    step(n, ms) { for (let i = 0; i < n; i++) { vt += ms || 1000 / 60; const k = q; q = []; k.forEach((cb) => cb(vt)); } return vt; },
    get t() { return vt; },
  };
};
try {
  for (const cls of classes) {
    console.log('== ' + cls);
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    const errors = [];
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  pageerror: ' + e.message); });
    page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('  console.error: ' + m.text()); } });
    await page.addInitScript(clockInit);
    await page.goto(pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + cls + '&spawn=' + (process.env.SPAWN || 'gate_outer'), { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      window.__hitLog = []; window.__xpLog = []; window.__killLog = [];
      const h = __impact.hit; __impact.hit = function (o) { __hitLog.push({ t: performance.now(), crit: !!o.crit, heavy: !!o.heavy, self: !!o.self, kind: o.kind || null, point: !!o.point }); return h.call(this, o); };
      const k = __impact.kill; __impact.kill = function (o) { __killLog.push({ t: performance.now() }); return k.call(this, o); };
      const x = __hud.xpGain; __hud.xpGain = function (n) { __xpLog.push({ t: performance.now(), n }); return x.call(this, n); };
    });
    // walk (real time, WASD) to the rat meadow, stop south of it: the camera looks north
    const camp = await page.evaluate(() => CREATURE_DEFS.ZONES.find((z) => z.species === 'rat'));
    const standOff = cls === 'warrior' ? 5 : 9;
    for (let i = 0; i < 220; i++) {
      const s = await page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
      const dx = camp.cx - s.x, dz = camp.cz + standOff - s.z;
      if (Math.hypot(dx, dz) < 1) break;
      const keys = []; if (dz < -0.5) keys.push('w'); if (dz > 0.5) keys.push('s'); if (dx < -0.5) keys.push('a'); if (dx > 0.5) keys.push('d');
      for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(160); for (const k of keys) await page.keyboard.up(k);
    }
    await page.waitForTimeout(500);
    await page.evaluate(() => __vclock.manual(true));
    const step = (n) => page.evaluate((n) => __vclock.step(n), n);
    const nearestRat = () => page.evaluate(() => { const kp = __knight.root.position; let b = null, bd = 1e9; for (const c of __creatures.authority.creatures) if (c.alive && c.sp === 'rat') { const d = Math.hypot(c.x - kp.x, c.z - kp.z); if (d < bd) { bd = d; b = c; } } return b && b.id; });
    let id = await nearestRat();
    ok(!!id, 'a rat to fight');
    const info = (id) => page.evaluate((id) => {
      const c = __creatures.authority.byId.get(id), v = new THREE.Vector3(c.x, Math.min(0.75, c.D.height * 0.5), c.z).project(__camera);
      const kp = __knight.root.position, w = new THREE.Vector3(kp.x, 1.0, kp.z).project(__camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, hx: (w.x * 0.5 + 0.5) * innerWidth, hy: (-w.y * 0.5 + 0.5) * innerHeight, hp: c.hp, alive: c.alive, hits: __hitLog.length,
        dead: !!__knight.dead, busy: !!__knight.action || (window.__arrows || []).some((a) => !a.stuck) || (window.__fireballs || []).length > 0 };
    }, id);
    const crop = (s, w, h) => ({ x: Math.max(0, Math.min(VW - w, Math.round(s.x - w / 2))), y: Math.max(0, Math.min(VH - h, Math.round(s.y - h * 0.6))), width: w, height: h });
    const CW = 520, CH = 400;
    let s = await info(id);
    await page.mouse.click(s.x, s.y, { button: 'right' });
    // capture a hit: keep the previous frame as "before", then contact / +50 / +150 / +300 ms
    async function captureHit(tag, filter, maxFrames, reclick) {
      let prev = null, n0 = (await info(id)).hits;
      for (let f = 0; f < maxFrames; f++) {
        s = await info(id);
        if (!s.alive) return null;
        if (s.dead) { await page.keyboard.press('r'); await step(2); continue; }   // rats bit the hero down: dev revive, keep testing
        if (f % 300 === 299) console.log('  .. ' + tag + ' frame ' + f + ' rat hp ' + s.hp + ' hits ' + s.hits);
        if (reclick && f % reclick === 0) await page.mouse.click(s.x, s.y, { button: 'right' });
        const box = crop(s, CW, CH);
        if (s.busy || !prev || f % 6 === 0) prev = { buf: await page.screenshot({ clip: box }), box };   // 'before' = last frame while the strike / shot is under way
        await step(1);
        const log = await page.evaluate(() => __hitLog);
        const fresh = log.slice(n0).filter((h) => !h.self);
        n0 = log.length;
        const hit = fresh.find(filter);
        if (hit) {
          fs.writeFileSync(`${OUT}/${cls}_${tag}_0before.png`, prev.buf);
          await page.screenshot({ path: `${OUT}/${cls}_${tag}_1contact.png`, clip: prev.box });
          await step(3); await page.screenshot({ path: `${OUT}/${cls}_${tag}_2_50ms.png`, clip: prev.box });
          await step(6); await page.screenshot({ path: `${OUT}/${cls}_${tag}_3_150ms.png`, clip: prev.box });
          await step(9); await page.screenshot({ path: `${OUT}/${cls}_${tag}_4_300ms.png`, clip: prev.box });
          return hit;
        }
      }
      return null;
    }
    const h1 = await captureHit('hit', () => true, 480, 0);
    ok(!!h1, 'first hit captured ' + JSON.stringify(h1));
    await page.screenshot({ path: `${OUT}/${cls}_context.png` });
    // a crit (15 %): keep attacking (right click every 12 frames) until one lands
    let hc = null;
    for (let tries = 0; tries < 4 && !hc; tries++) { hc = await captureHit('crit', (h) => h.crit, 1500, 12); if (!hc) { id = await nearestRat(); if (!id) break; } }
    ok(!!hc, 'crit captured ' + JSON.stringify(hc));
    // the kill: keep attacking, then the death burst and the EXP orb flight
    let killedAt = -1;
    for (let f = 0; f < 2400; f++) {
      s = await info(id);
      if (!s.alive) break;
      if (s.dead) { await page.keyboard.press('r'); await step(2); continue; }
      if (f % 12 === 0) await page.mouse.click(s.x, s.y, { button: 'right' });
      await step(1);
    }
    s = await info(id);
    ok(!s.alive, 'rat killed');
    if (!s.alive) {
      await step(1);                                            // a projectile kill is handled by the authority's next drain (1 frame)
      const k = await page.evaluate(() => ({ t: __killLog.length ? __killLog[__killLog.length - 1].t : -1, xp: __xpLog.length, now: performance.now(), log: __killLog.length }));
      console.log('  kill log ' + JSON.stringify(k));
      killedAt = k.t;
      const box = { x: Math.max(0, Math.round(Math.min(s.x, s.hx) - 260)), y: Math.max(0, Math.round(Math.min(s.y, s.hy) - 260)), width: Math.min(VW, Math.round(Math.abs(s.x - s.hx) + 520)), height: Math.min(VH, Math.round(Math.abs(s.y - s.hy) + 420)) };
      box.width = Math.min(box.width, VW - box.x); box.height = Math.min(box.height, VH - box.y);
      const shots = [[0, 'kill_0'], [6, 'kill_100ms'], [12, 'kill_300ms'], [18, 'kill_600ms'], [6, 'orb_0700ms'], [12, 'orb_0900ms'], [12, 'orb_1100ms'], [12, 'orb_1300ms'], [18, 'orb_1600ms'], [24, 'orb_2000ms']];
      for (const [n, tag] of shots) { if (n) await step(n); await page.screenshot({ path: `${OUT}/${cls}_${tag}.png`, clip: box }); }
      await step(60);
      const xp = await page.evaluate(() => __xpLog);
      const after = xp.filter((e) => e.t >= killedAt);
      ok(after.length >= 1, 'EXP credited after the kill: ' + JSON.stringify(after.map((e) => ({ dt: Math.round(e.t - killedAt), n: Math.round(e.n) }))));
      ok(after.length && after[0].t - killedAt > 300, 'EXP lands when the orb is absorbed (not at the kill)');
    }
    // level-up effect (API: the real one needs ~9 kills) + the hero's red self-hit (dev key E = "darbe al")
    await page.evaluate(() => __progress.levelUp(__knight.root));
    const hb = await info(id);
    const hbox = { x: Math.max(0, Math.round(hb.hx - 330)), y: Math.max(0, Math.round(hb.hy - 330)), width: 660, height: 520 };
    for (const [n, tag] of [[6, 'levelup_0100ms'], [24, 'levelup_0500ms'], [42, 'levelup_1200ms'], [48, 'levelup_2000ms']]) { await step(n); await page.screenshot({ path: `${OUT}/${cls}_${tag}.png`, clip: hbox }); }
    await step(40);
    await page.keyboard.press('e');
    await step(1); await page.screenshot({ path: `${OUT}/${cls}_selfhit_1contact.png`, clip: hbox });
    await step(5); await page.screenshot({ path: `${OUT}/${cls}_selfhit_2_100ms.png`, clip: hbox });
    const st = await page.evaluate(() => __impact.stats());
    console.log('  stats ' + JSON.stringify(st) + ' hits ' + JSON.stringify(await page.evaluate(() => __hitLog.map((h) => (h.self ? 'S' : '') + (h.crit ? 'C' : '') + (h.heavy ? 'H' : '') + (h.kind ? h.kind[0] : '-') + (h.point ? 'p' : '')).join(' '))));
    ok(!errors.length, 'no console errors (' + errors.length + ')');
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
