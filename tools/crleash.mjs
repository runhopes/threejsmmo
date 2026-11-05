// Mob engagement / leash check with REAL input at the game camera (village world).
//   [STAND=3] node tools/crleash.mjs <tag> [cls=warrior] [species=rat] [scenario=fight|kite]   (STAND = metres south of the camp edge)
// fight: click-to-attack the nearest creature of <species> until it dies (45 s cap). Expect: every hit lands (hp drops),
//        the creature never enters 'return' while it is being hit, never stalls.
// drift: like fight, but the player steps back after every 2nd landed hit (the fight slides out of the camp).
// kite:  hit it twice, then run far away. Expect: leash -> 'return' -> 'reset' at its spawn within a few seconds (no freeze).
// Writes shots/mobfix/<tag>_<cls>_<species>_<scenario>.json (per-frame creature log + damage results) and screenshots.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [TAG = 'run', CLS = 'warrior', SP = 'rat', SCEN = 'fight'] = process.argv.slice(2);
const BUTTON = process.env.BUTTON || 'right';                       // world actions are on the right mouse button
const STAND = +(process.env.STAND || 3);                            // where the player stands: metres south of the camp edge
const OUT = path.resolve(import.meta.dirname, '..', 'shots', 'mobfix');
fs.mkdirSync(OUT, { recursive: true });
const base = path.join(OUT, `${TAG}_${CLS}_${SP}_${SCEN}` + (STAND !== 3 ? `_s${STAND}` : ""));
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + CLS + '&spawn=gate_outer';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const killer = setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(3); }, 300000);
let errors = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errors++; console.log('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('console: ' + m.text()); } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  // logger: every authority tick records the watched creature; every damage request records its result
  await page.evaluate(() => {
    const A = __creatures.authority, L = (window.__mobLog = { frames: [], dmg: [], events: [], watch: null });
    const tick = A.tick.bind(A), apply = A.applyDamage.bind(A), drain = A.drainEvents.bind(A);
    let lastAct = null; L.swings = [];
    A.tick = (dt) => {
      tick(dt);
      const c = L.watch && A.byId.get(L.watch); if (!c) return;
      const ka = __knight.action;                                  // hero basic attacks / skills: name + targets hit (melee sweep)
      if (ka !== lastAct) { if (lastAct && lastAct.def.attack) L.swings.push({ t: +A.time.toFixed(3), name: lastAct.name, hits: lastAct.hits, gap: L.frames.length ? L.frames[L.frames.length - 1].gap : null }); lastAct = ka; }
      const p = A.players.get('local'), kp = p ? [+p.x.toFixed(2), +p.z.toFixed(2)] : null;
      L.frames.push({ t: +A.time.toFixed(3), st: c.st, alive: c.alive, hp: c.hp, x: +c.x.toFixed(2), z: +c.z.toFixed(2),
        dHome: +Math.hypot(c.x - c.home.x, c.z - c.home.z).toFixed(2), dSpawn: +Math.hypot(c.x - c.spawnX, c.z - c.spawnZ).toFixed(2),
        target: c.target, act: c.act ? c.act.id : null, stun: +Math.max(0, c.stun).toFixed(2), spd: +c.speed.toFixed(2), kp,
        gap: p ? +(Math.hypot(p.x - c.x, p.z - c.z) - c.D.radius - p.radius).toFixed(2) : null, pAlive: p ? p.alive : null, kDead: !!__knight.dead });
    };
    A.applyDamage = (id, amount, src) => { const r = apply(id, amount, src); if (id === L.watch) L.dmg.push({ t: +A.time.toFixed(3), amount, res: r && { ok: r.ok, amount: r.amount, reason: r.reason, killed: r.killed }, st: A.byId.get(id).st }); return r; };
    A.drainEvents = () => { const e = drain(); for (const v of e) if (v.id === L.watch) L.events.push(Object.assign({ t: +A.time.toFixed(3) }, v)); return e; };
    const kplay = __knight.play.bind(__knight); __knight.play = (n, ...a) => { if (n === 'die') (L.die = L.die || []).push({ t: A.time, stack: new Error().stack.split(String.fromCharCode(10)).slice(1, 6).join(' | ') }); return kplay(n, ...a); };   // who killed the hero?
  });
  const kpos = () => page.evaluate(() => ({ x: __knight.root.position.x, z: __knight.root.position.z }));
  const steer = async (tx, tz, tol, maxSteps = 200) => {           // WASD toward a point (W = -Z)
    for (let i = 0; i < maxSteps; i++) {
      const s = await kpos(); const dx = tx - s.x, dz = tz - s.z;
      if (Math.hypot(dx, dz) < tol) return true;
      const keys = []; if (dz < -0.6) keys.push('w'); if (dz > 0.6) keys.push('s'); if (dx < -0.6) keys.push('a'); if (dx > 0.6) keys.push('d');
      for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(200); for (const k of keys) await page.keyboard.up(k);
    }
    return false;
  };
  // the creature of that species nearest to the player's side of the camp
  const camp = await page.evaluate((sp) => CREATURE_DEFS.ZONES.find((z) => z.species === sp), SP);
  // stand SOUTH of the camp (the game camera looks north, so the camp is on screen); go around its east side
  await steer(camp.cx + camp.r + 5, camp.cz, 1.5, 300);
  await steer(camp.cx, camp.cz + camp.r + STAND, 1.2, 200);
  await page.waitForTimeout(500);
  const pickId = await page.evaluate((sp) => {
    const A = __creatures.authority, kp = __knight.root.position; let best = null, bd = 1e9;
    for (const c of A.creatures) if (c.alive && c.sp === sp) { const d = Math.hypot(c.x - kp.x, c.z - kp.z); if (d < bd) { bd = d; best = c; } }
    window.__mobLog.watch = best.id;
    return best.id;
  }, SP);
  const info = await page.evaluate((id) => { const c = __creatures.authority.byId.get(id); return { id, sp: c.sp, lv: c.level, hp: c.hp, maxHp: c.maxHp, spawn: [+c.spawnX.toFixed(2), +c.spawnZ.toFixed(2)], home: c.home, leash: c.D.behavior.leash }; }, pickId);
  console.log('target', JSON.stringify(info));
  const clickIt = async () => {
    const p = await page.evaluate((id) => {
      const c = __creatures.authority.byId.get(id); if (!c || !c.alive) return null;
      const v = new THREE.Vector3(c.x, Math.min(c.D.height * 0.5, 1.2), c.z).project(__camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, st: c.st, hp: c.hp };
    }, pickId);
    if (p && p.x > 5 && p.x < 1275 && p.y > 5 && p.y < 715) await page.mouse.click(p.x, p.y, { button: BUTTON });   // right click = run + attack (Metin2 style)
    return p;
  };
  const t0 = Date.now();
  let shot = 0;
  if (SCEN === 'fight' || SCEN === 'drift') {
    let landed0 = 0;
    while (Date.now() - t0 < 45000) {
      const p = await clickIt(); if (!p) break;
      await page.waitForTimeout(220);
      if (SCEN === 'drift') {                                     // drift: after every 2nd landed hit take a step back (S) - the fight slides out of the camp
        const n = await page.evaluate(() => window.__mobLog.dmg.filter((d) => d.res && d.res.ok && d.res.amount > 0).length);
        if (n >= landed0 + 2) { landed0 = n; await page.keyboard.down('s'); await page.waitForTimeout(450); await page.keyboard.up('s'); }
      }
      if (shot < 3 && Date.now() - t0 > 3000 + shot * 6000) await page.screenshot({ path: `${base}_${shot++}.png` });
    }
  } else {
    // two hits, then run back the way we came (WASD) and through the south gate into the town, far beyond the leash
    for (let i = 0; i < 40; i++) { await clickIt(); await page.waitForTimeout(220); const n = await page.evaluate(() => window.__mobLog.dmg.filter((d) => d.res && d.res.ok && d.res.amount > 0).length); if (n >= 2) break; }
    await page.screenshot({ path: `${base}_0.png` });
    await page.keyboard.down('d'); await page.waitForTimeout(300); await page.keyboard.up('d');   // WASD cancels the engagement
    await steer(camp.cx + camp.r + 5, camp.cz, 1.5, 120);
    await steer(0, 90.6, 1.5, 160);
    await steer(0, 66, 1.5, 120);
    await page.screenshot({ path: `${base}_1.png` });
    await page.waitForTimeout(12000);
    await page.screenshot({ path: `${base}_2.png` });
  }
  const L = await page.evaluate(() => window.__mobLog);
  fs.writeFileSync(base + '.json', JSON.stringify({ info, frames: L.frames, dmg: L.dmg, events: L.events, swings: L.swings, die: L.die || [] }, null, 0));
  if (L.die) console.log('hero die() calls:', JSON.stringify(L.die));
  // summary
  const ret = L.frames.filter((f) => f.st === 'return'), last = L.frames[L.frames.length - 1] || {};
  const landed = L.dmg.filter((d) => d.res && d.res.ok && d.res.amount > 0).length, immune = L.dmg.filter((d) => d.res && d.res.ok && !d.res.amount).length, rej = L.dmg.filter((d) => !d.res || !d.res.ok);
  const ev = L.events.filter((e) => ['aggro', 'leash', 'reset', 'death', 'respawn'].includes(e.type)).map((e) => e.t + ':' + e.type);
  // a stall = alive, not attacking/stunned, wants to move (chase/return) but has not moved 0.05 m in 2 s
  let stall = 0;
  for (let i = 0, j = 0; i < L.frames.length; i++) {
    while (L.frames[j].t < L.frames[i].t - 2) j++;
    const a = L.frames[j], b = L.frames[i];
    if (b.t - a.t > 1.9 && b.alive && b.st === 'return' && Math.hypot(b.x - a.x, b.z - a.z) < 0.05) stall = Math.max(stall, b.t - a.t);
  }
  const sw = L.swings || [];
  const sum = { cls: CLS, sp: SP, scen: SCEN, swings: sw.length, swingsThatHit: sw.filter((s) => s.hits > 0).length, hitsRequested: L.dmg.length, landed, immune, rejected: rej.length, rejectReasons: [...new Set(rej.map((d) => d.res && d.res.reason))],
    returnFrames: ret.length, maxDHome: Math.max(...L.frames.map((f) => f.dHome)), events: ev, final: { st: last.st, alive: last.alive, hp: last.hp, dSpawn: last.dSpawn }, returnStallSec: +stall.toFixed(2), errors };
  fs.writeFileSync(base + '_summary.json', JSON.stringify(sum, null, 1));
  console.log(JSON.stringify(sum));
} finally { clearTimeout(killer); await browser.close(); }
