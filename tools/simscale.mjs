// Scale checks of the authoritative creature simulation: node tools/simscale.mjs
//  (a) regression: the spatial-hash separation == the old O(n^2) loop (positions identical), activeRadius=Infinity == old behaviour,
//      obstacle grid == plain obstacle loop
//  (b) dormancy: far calm creatures freeze, wake without teleporting, aggro / return states never sleep, dead timers keep running
//  (c) variants: derived defs are consistent with their base (no double scaling)
//  (d) benchmark: 350 creatures over 1400 x 2000 m, one player walking: ms / tick with activeRadius 120 vs Infinity
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root = path.resolve(import.meta.dirname, '..');
globalThis.window = globalThis;
for (const f of ['creatures/defs.js', 'creatures/sim.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const D = globalThis.CREATURE_DEFS, Sim = globalThis.CreatureSim;
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };

// the pre-spatial-hash implementation, verbatim (reference)
function legacySeparate() {
  const L = this.creatures;
  for (let i = 0; i < L.length; i++) {
    const a = L[i]; if (!a.alive) continue;
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j]; if (!b.alive) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, r = (a.D.radius + b.D.radius) * 0.9;
      if (d2 > r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), push = (r - d) * 0.5, nx = dx / d, nz = dz / d;
      const wa = a.D.mass / (a.D.mass + b.D.mass);
      a.x -= nx * push * (1 - wa) * 2; a.z -= nz * push * (1 - wa) * 2; b.x += nx * push * wa * 2; b.z += nz * push * wa * 2;
    }
    for (const p of this.players.values()) {
      const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz);
      const fwd = d > 1e-6 ? Math.max(0, -(Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz) / d) : 0;
      const r = (a.D.radius + ((a.D.front || a.D.radius) - a.D.radius) * fwd + p.radius) * 0.85;
      if (d < r && d > 1e-6) { a.x = p.x + dx / d * r; a.z = p.z + dz / d * r; }
    }
    for (const o of this.obstacles) {
      const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), r = a.D.radius + o.r;
      if (d < r && d > 1e-6) { a.x = o.x + dx / d * r; a.z = o.z + dz / d * r; }
    }
    if (this.collide) { const p = this._cp; p.x = a.x; p.z = a.z; this.collide(p, a.D.radius * 0.8); a.x = p.x; a.z = p.z; }
  }
}

console.log('== (a) regression: hash separation vs the old O(n^2) loop');
{
  const mkObs = () => { const o = []; for (let i = 0; i < 40; i++) o.push({ x: Math.sin(i * 12.9) * 30, z: -20 - Math.cos(i * 7.7) * 30, r: 0.5 + (i % 4) * 0.3 }); return o; };
  const build = (legacy, opts) => {
    const sim = new Sim(Object.assign({ seed: 99, obstacles: mkObs() }, opts));
    const sp = Object.keys(D.SPECIES);
    const zones = []; for (let i = 0; i < 9; i++) zones.push({ id: 'z' + i, species: sp[i % sp.length], cx: (i % 3) * 14 - 14, cz: -Math.floor(i / 3) * 14 - 8, r: 9, count: sp[i % sp.length].startsWith('spike') ? 1 : 8 });
    sim.spawnZones(zones);
    if (legacy) sim._separate = legacySeparate;
    return sim;
  };
  const A = build(false), B = build(true), C = build(false, { activeRadius: Infinity });
  let maxd = 0, maxc = 0;
  for (let t = 0; t < 30 * 40; t++) {
    const px = Math.sin(t / 90) * 18, pz = -14 - Math.cos(t / 130) * 14;
    for (const s of [A, B, C]) { s.setPlayer('p', px, pz, true, 0.45); s.tick(1 / 30); if (t % 200 === 100 && s.creatures[3].alive) s.applyDamage(s.creatures[3].id, 400, { pid: 'p', x: px, z: pz }); s.drainEvents(); }
  }
  for (let i = 0; i < A.creatures.length; i++) { maxd = Math.max(maxd, Math.hypot(A.creatures[i].x - B.creatures[i].x, A.creatures[i].z - B.creatures[i].z)); maxc = Math.max(maxc, Math.hypot(A.creatures[i].x - C.creatures[i].x, A.creatures[i].z - C.creatures[i].z)); }
  ok(maxd < 1e-6, `${A.creatures.length} creatures, 40 s, 40 obstacles (grid): max position diff vs legacy ${maxd.toExponential(1)} m`);
  ok(maxc === 0, 'activeRadius = Infinity explicit == default (max diff ' + maxc + ')');
  ok(A.stats().dormant === 0 && A.stats().total === A.creatures.length, 'stats(): ' + JSON.stringify(A.stats()));
}

console.log('== (b) dormancy');
{
  const sim = new Sim({ seed: 3, activeRadius: 50 });
  sim.spawnZones([{ id: 'near', species: 'wolf', cx: 0, cz: -20, r: 6, count: 3 }, { id: 'far', species: 'goblin', cx: 0, cz: -200, r: 6, count: 3 }, { id: 'den', species: 'spikeback', cx: 400, cz: 0, r: 4, count: 1 }]);
  const far = sim.creatures.filter((c) => c.sp === 'goblin'), P = { x: 0, z: 0 };
  const run = (secs, fn) => { for (let t = 0; t < secs; t += 1 / 30) { if (fn) fn(); sim.setPlayer('p', P.x, P.z, true, 0.45); sim.tick(1 / 30); sim.drainEvents(); } };
  const p0 = far.map((c) => [c.x, c.z]);
  run(30);
  ok(far.every((c, i) => c.dormant && c.x === p0[i][0] && c.z === p0[i][1] && c.speed === 0), 'far goblins are dormant and do not move');
  const st = sim.stats(); ok(st.dormant >= 4 && st.active === st.total - st.dormant && st.total === 7, 'stats ' + JSON.stringify(st));
  ok(sim.creatures.filter((c) => c.sp === 'wolf').some((c) => !c.dormant), 'creatures inside the radius are simulated');
  // walk toward the far camp: no teleport (per-tick displacement stays physical), they wake and roam
  let maxStep = 0, last = far.map((c) => [c.x, c.z]), woke = 0;
  run(90, () => { P.z -= 4 / 30; });
  P.z = -150; last = far.map((c) => [c.x, c.z]);
  for (let t = 0; t < 30 * 40; t++) {
    sim.setPlayer('p', P.x, P.z, true, 0.45); sim.tick(1 / 30); sim.drainEvents();
    far.forEach((c, i) => { maxStep = Math.max(maxStep, Math.hypot(c.x - last[i][0], c.z - last[i][1])); last[i] = [c.x, c.z]; });
    P.z -= 3 / 30 * (t < 120 ? 1 : 0);
  }
  woke = far.filter((c) => !c.dormant).length;
  ok(woke === 3, 'goblins woke when the player came within 50 m (' + woke + '/3)');
  ok(maxStep < 0.35, 'no teleport while waking / moving (max step ' + maxStep.toFixed(3) + ' m / tick)');
  // an aggro'd creature never sleeps even when the player runs away; a dead one still respawns while far
  const w = sim.creatures.find((c) => c.sp === 'wolf');
  P.x = w.x; P.z = w.z + 3; run(0.3);
  sim.applyDamage(w.id, 50, { pid: 'p', x: P.x, z: P.z });
  ok(!w.dormant && w.target === 'p', 'a creature in combat is awake');
  sim.applyDamage(w.id, 1e9, { pid: 'p', x: P.x, z: P.z });
  ok(!w.alive, 'killed');
  P.x = 3000; P.z = 3000; let respawned = false;
  for (let t = 0; t < 30 * 80 && !respawned; t++) { sim.setPlayer('p', P.x, P.z, true, 0.45); sim.tick(1 / 30); for (const e of sim.drainEvents()) if (e.type === 'respawn' && e.id === w.id) respawned = true; }
  ok(respawned && w.alive, 'corpse timers + respawn run while every player is far away');
  const none = new Sim({ seed: 1, activeRadius: 50 }); none.spawnZones([{ id: 'z', species: 'rat', cx: 0, cz: 0, r: 3, count: 3 }]);
  const q0 = none.creatures.map((c) => c.x); for (let t = 0; t < 300; t++) none.tick(1 / 30);
  ok(none.stats().dormant === 3 && none.creatures.every((c, i) => c.x === q0[i]), 'no player at all: nothing is simulated');
}

console.log('== (c) variants: derived defs');
{
  const ids = Object.keys(D.VARIANTS);
  ok(ids.length === 15, ids.length + ' variants derived');
  let bad = [];
  for (const id of ids) {
    const V = D.SPECIES[id], B = D.SPECIES[V.variantOf], m = V.sizeMul;
    const chk = [Math.abs(V.radius / B.radius - m), Math.abs(V.height / B.height - m), Math.abs(V.front / B.front - m), Math.abs(V.scale / B.scale - m)];
    for (const k in B.attacks) { const a = V.attacks[k], b = B.attacks[k]; chk.push(Math.abs(a.reach - b.reach * m), Math.abs(a.lunge - b.lunge * (b.charge ? 1 : m)), Math.abs(a.dur - b.dur)); if (JSON.stringify(a.phases) !== JSON.stringify(b.phases) || JSON.stringify(a.active) !== JSON.stringify(b.active)) chk.push(1); }
    { const sv0 = Math.min(Math.sqrt(B.scale), 1.25), sv1 = Math.min(Math.sqrt(V.scale), 1.25); for (const k in B.speed) chk.push(Math.abs(V.speed[k] - B.speed[k] * sv1 / sv0)); }   // same capped sqrt rule as the base
    if (chk.some((x) => x > 1e-9)) bad.push(id);
    if (!V.boss && JSON.stringify(V.behavior) !== JSON.stringify(B.behavior)) bad.push(id + ':behavior');
    if (!(V.hp > 0 && V.exp > 0 && V.loot.length === 1 && V.respawn && V.corpse)) bad.push(id + ':fields');
  }
  ok(!bad.length, 'geometry x multiplier exactly once, timings / phases unchanged, non-boss behaviour copied' + (bad.length ? ' BAD: ' + bad : ''));
  // every variant spawns and runs through the sim
  const sim = new Sim({ seed: 5 });
  sim.spawnZones(ids.map((id, i) => ({ id, species: id, cx: i * 30, cz: 0, r: 4, count: 2 })));
  for (let t = 0; t < 300; t++) { sim.setPlayer('p', 5, 5, true); sim.tick(1 / 30); }
  ok(sim.creatures.every((c) => c.level >= c.D.levels[0] && c.level <= c.D.levels[1] && c.maxHp === D.statsFor(c.sp, c.level).maxHp), 'every variant spawns at a level inside its band with statsFor hp');
}

console.log('== (d) benchmark: 350 creatures over 1400 x 2000 m');
function bench(activeRadius, ticks) {
  const sim = new Sim({ seed: 123, activeRadius, collide: (p, r) => { if (p.x > 690) p.x = 690; } });
  const sp = ['rat', 'rabbit', 'snake', 'boar', 'wolf', 'goblin', 'rat_swamp', 'snake_marsh', 'boar_black', 'wolf_dark', 'goblin_warrior', 'goblin_brute', 'wolf_frost', 'boar_iron', 'goblin_frost'];
  let seed = 42; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const zones = []; for (let i = 0; i < 50; i++) zones.push({ id: 'c' + i, species: sp[i % sp.length], cx: (R() - 0.5) * 1300, cz: -R() * 2000, r: 7 + R() * 3, count: 7 });
  sim.spawnZones(zones);
  const P = { x: 0, z: 0 };
  const times = [];
  for (let t = 0; t < ticks; t++) {
    P.z -= 6 / 30; P.x = Math.sin(t / 400) * 300;                       // a run across the map
    sim.setPlayer('p', P.x, P.z, true, 0.45);
    const t0 = performance.now(); sim.tick(1 / 30); times.push(performance.now() - t0);
    sim.drainEvents();
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { avg, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], stats: sim.stats(), n: sim.creatures.length };
}
bench(120, 100);                                                       // JIT warm-up
const b1 = bench(120, 2400), b2 = bench(Infinity, 600);
console.log(`  activeRadius 120: avg ${b1.avg.toFixed(3)} ms/tick  p95 ${b1.p95.toFixed(3)}  max ${b1.max.toFixed(2)}   (${b1.n} creatures, final ${JSON.stringify(b1.stats)})`);
console.log(`  activeRadius Inf: avg ${b2.avg.toFixed(3)} ms/tick  p95 ${b2.p95.toFixed(3)}  max ${b2.max.toFixed(2)}`);
ok(b1.n === 350, '350 creatures');
ok(b1.avg < 1.5, `activeRadius=120 averages ${b1.avg.toFixed(3)} ms/tick (< 1.5)`);
ok(b1.avg < b2.avg, `dormancy is cheaper than simulating everything (${(b2.avg / b1.avg).toFixed(1)}x)`);
console.log(fails ? fails + ' FAILED' : 'simscale passed');
process.exit(fails ? 1 : 0);
