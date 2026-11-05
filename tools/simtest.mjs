// Headless checks of the authoritative creature simulation (creatures/sim.js): node tools/simtest.mjs
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const root = path.resolve(import.meta.dirname, '..');
globalThis.window = globalThis;
for (const f of ['creatures/defs.js', 'creatures/sim.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const D = globalThis.CREATURE_DEFS;
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
function run(zoneSp, count, opts = {}) {
  const sim = new globalThis.CreatureSim({ seed: 7 });
  const Z = { id: 'z', species: zoneSp, cx: 0, cz: 0, r: 4, count };
  sim.spawnZones([Z]);
  return sim;
}
for (const sp of Object.keys(D.SPECIES)) {
  console.log('== ' + sp);
  const sim = run(sp, sp === 'spikeback' ? 1 : 3);
  const P = { x: 0, z: 25, alive: true };
  const log = [], all = [];
  const step = (secs, fn) => { for (let t = 0; t < secs; t += 1 / 30) { if (fn) fn(); sim.setPlayer('p', P.x, P.z, P.alive); sim.tick(1 / 30); for (const e of sim.drainEvents()) { const x = Object.assign({ at: sim.time }, e); log.push(x); all.push(x); } } };
  step(2);
  const D0 = D.SPECIES[sp];
  ok(!log.some((e) => e.type === 'hit'), 'no attacks on a player outside the camp');
  // walk into the camp
  P.x = 0.5; P.z = 1.2; step(4);
  const passive = D0.behavior.aggro <= 0;
  const aggroed = log.some((e) => e.type === 'aggro');
  ok(passive ? !aggroed : aggroed, passive ? 'passive species ignores a nearby player' : 'aggressive species aggroes a nearby player');
  // hit one creature
  const c = sim.creatures[0];
  const r = sim.applyDamage(c.id, 10, { pid: 'p', x: P.x, z: P.z });
  ok(r.ok && c.target === 'p', 'damage request accepted, attacker becomes the target');
  if (D0.behavior.assist) ok(sim.creatures.filter((o) => o.target === 'p').length >= Math.min(2, sim.creatures.length), 'camp members assist');
  log.length = 0;
  step(12, () => { P.x = 0.5; P.z = 1.2; });
  const atks = log.filter((e) => e.type === 'attack'), hits = log.filter((e) => e.type === 'hit');
  ok(atks.length > 0, 'attacks started (' + atks.length + ')');
  ok(hits.length > 0, 'attacks landed (' + hits.length + ')');
  // every hit must fall inside the attack's active window
  let inWin = true;
  for (const h of hits) {
    const a = [...all].reverse().find((e) => e.type === 'attack' && e.id === h.id && e.at <= h.at);
    const def = D0.attacks[h.attack], u = (h.at - a.at) / def.dur;
    if (u < def.active[0] - 0.06 || u > def.active[1] + 0.06) { inWin = false; console.log('    hit at u=' + u.toFixed(3) + ' window', def.active); }
  }
  ok(inWin, 'every hit registered inside the active window');
  // player runs away -> no damage from far away, then leash
  log.length = 0;
  P.x = 0; P.z = 60; step(10);
  ok(!log.some((e) => e.type === 'hit'), 'no damage at range');
  ok(sim.creatures.every((o) => o.target === null), 'leash: all targets dropped');
  step(10);
  ok(sim.creatures.every((o) => o.hp === o.maxHp), 'evade reset: back to full health');
  // kill one
  log.length = 0;
  sim.applyDamage(c.id, 1e6, { pid: 'p', x: c.x, z: c.z + 1 });
  ok(!c.alive && log.length === 0 && sim.events.some((e) => e.type === 'death'), 'death event');
  step(0.1);
  ok(sim.applyDamage(c.id, 5, { pid: 'p' }).ok === false, 'dead creature refuses damage');
  step(D0.corpse + 0.5);
  ok(log.some((e) => e.type === 'despawn'), 'corpse despawns after ' + D0.corpse + 's');
  step(D0.respawn[1] + 1);
  ok(log.some((e) => e.type === 'respawn') && c.alive && c.hp === c.maxHp, 'respawns at full health');
}
console.log(fails ? fails + ' FAILED' : 'combat loop passed');

/* ---------------- species-specific behaviour ---------------- */
console.log('== behaviours');
function arena(sp, count, P0) {
  const sim = new globalThis.CreatureSim({ seed: 11 });
  sim.spawnZones([{ id: 'z', species: sp, cx: 0, cz: 0, r: 4, count }]);
  const P = Object.assign({ x: 0, z: 30, alive: true }, P0 || {}), all = [];
  const step = (secs, fn) => { for (let t = 0; t < secs; t += 1 / 30) { if (fn) fn(sim); sim.setPlayer('p', P.x, P.z, P.alive); sim.tick(1 / 30); for (const e of sim.drainEvents()) all.push(Object.assign({ at: sim.time }, e)); } };
  return { sim, P, all, step };
}
{ // snake: never roams, raises before engaging, only engages at short range
  const A = arena('snake', 2); const s0 = A.sim.creatures.map((c) => [c.x, c.z]);
  A.step(20);
  { const mv = Math.max(...A.sim.creatures.map((c, i) => Math.hypot(c.x - s0[i][0], c.z - s0[i][1]))); ok(mv < 0.3, 'snake: lies in ambush (moved ' + mv.toFixed(2) + ' m in 20 s)'); }
  const c = A.sim.creatures[0]; A.P.x = c.x + 6; A.P.z = c.z; A.step(2);
  ok(!A.all.some((e) => e.type === 'aggro' && e.id === c.id), 'snake: ignores a player 6 m away');
  A.P.x = c.x + 3; A.step(3);
  const al = A.all.find((e) => e.type === 'alert' && e.id === c.id), ag = A.all.find((e) => e.type === 'aggro' && e.id === c.id);
  ok(al && ag && al.at <= ag.at, 'snake: raises (alert) before it engages');
}
{ // boar: opens with a charge from range
  const A = arena('boar', 1); const c = A.sim.creatures[0];
  A.P.x = c.x; A.P.z = c.z + 6.2; A.step(4);
  ok(A.all.some((e) => e.type === 'attack' && e.attack === 'charge'), 'boar: charges from range');
}
{ // wolf pack: stalks / orbits instead of running straight in, then lunges
  const A = arena('wolf', 3); const c = A.sim.creatures[0];
  A.P.x = c.x; A.P.z = c.z + 7; let stalk = 0;
  A.step(8, (s) => { for (const w of s.creatures) if (w.mode === 'stalk' && w.speed > 0.05) stalk++; });
  ok(stalk > 20, 'wolf: stalks around the target (' + stalk + ' stalk frames)');
  ok(A.all.filter((e) => e.type === 'aggro').length >= 2, 'wolf: the pack joins in');
  ok(A.all.some((e) => e.type === 'attack' && e.attack === 'lunge'), 'wolf: lunge bites');
}
{ // rabbit: dodges away when the attacker closes in
  const A = arena('rabbit', 1); const c = A.sim.creatures[0];
  A.sim.applyDamage(c.id, 5, { pid: 'p', x: c.x + 1, z: c.z });
  A.P.x = c.x + 1; A.P.z = c.z; let away = 0;
  A.step(5, (s) => { if (c.evadeT > 0) away++; A.P.x += (c.x - A.P.x) * 0.05; A.P.z += (c.z - A.P.z) * 0.05; });
  ok(away > 5, 'rabbit: evasive hops away (' + away + ' frames evading)');
}
{ // goblin: strafes between attacks and uses both attacks
  const A = arena('goblin', 1); const c = A.sim.creatures[0];
  A.P.x = c.x; A.P.z = c.z + 3; let strafe = 0;
  A.step(14, (s) => { if (!c.act && c.speed > 0.05 && Math.abs(Math.sin(Math.atan2(c.vx, c.vz) - c.yaw)) > 0.7) strafe++; });
  const used = new Set(A.all.filter((e) => e.type === 'attack').map((e) => e.attack));
  ok(strafe > 5, 'goblin: side-steps between attacks (' + strafe + ' frames)');
  ok(used.has('stab') && used.has('slash'), 'goblin: alternates stab and slash');
}
{ // spikeback: telegraphed heavy attacks, enrage at 40 %, stagger thresholds
  const A = arena('spikeback', 1); const c = A.sim.creatures[0];
  A.P.x = c.x; A.P.z = c.z + 7; A.step(20);
  const atk = A.all.filter((e) => e.type === 'attack');
  ok(atk.length && atk.every((e) => e.telegraph), 'boss: every attack is telegraphed (' + [...new Set(atk.map((e) => e.attack))].join(',') + ')');
  A.sim.applyDamage(c.id, c.maxHp * 0.36, { pid: 'p', x: A.P.x, z: A.P.z });
  ok(A.all.length >= 0 && A.sim.events.some((e) => e.stagger), 'boss: staggers when HP crosses 66 %');
  A.sim.applyDamage(c.id, c.maxHp * 0.26, { pid: 'p', x: A.P.x, z: A.P.z });
  A.step(4);
  ok(A.all.some((e) => e.type === 'enraged') && c.enraged, 'boss: enrages below 40 %');
}
console.log(fails ? fails + ' FAILED' : 'behaviours passed');

/* ---------------- leash / evade ("I hit it, it runs home, freezes and takes no damage") ---------------- */
console.log('== leash / evade');
const f0 = fails;
function camp(sp, opts = {}) {                 // real camp size (village camps: r 7.5-9.4)
  const sim = new globalThis.CreatureSim({ seed: opts.seed || 5, obstacles: opts.obstacles || [] });
  sim.spawnZones([{ id: 'z', species: sp, cx: 0, cz: 0, r: opts.r || 7.5, count: 1 }]);
  const c = sim.creatures[0], P = { x: 0, z: 40, alive: true }, all = [];
  const step = (secs, fn) => { for (let t = 0; t < secs; t += 1 / 30) { if (fn) fn(); sim.setPlayer('p', P.x, P.z, P.alive); sim.tick(1 / 30); for (const e of sim.drainEvents()) all.push(Object.assign({ at: sim.time }, e)); } };
  return { sim, c, P, all, step };
}
for (const sp of ['snake', 'rat', 'boar']) {   // a ranged player hits from 14 m outside the camp edge: the creature comes out and keeps fighting
  const A = camp(sp), c = A.c, D0 = c.D;
  A.P.x = c.x; A.P.z = c.z + 14;
  let tries = 0, zero = 0, bad = 0;
  A.step(0.5);
  for (let k = 0; k < 80 && c.alive; k++) {
    const r = A.sim.applyDamage(c.id, Math.ceil(c.maxHp / 12), { pid: 'p', x: A.P.x, z: A.P.z });
    tries++; if (!r.ok) bad++; else if (!r.amount) zero++;
    A.step(0.8);
  }
  ok(!c.alive && zero === 0 && bad === 0, sp + ': hit from range outside the camp, takes damage every hit until it dies (' + tries + ' hits, ' + zero + ' immune, ' + bad + ' refused)');
  ok(!A.all.some((e) => e.type === 'leash'), sp + ': never leashes while it is being hit in range');
}
{ // the player hits once, then really runs away: the creature leashes, walks home, resets
  const A = camp('rat'), c = A.c;
  A.P.x = c.x + 1.5; A.P.z = c.z + 1.5; A.step(0.3);
  A.sim.applyDamage(c.id, 60, { pid: 'p', x: A.P.x, z: A.P.z });
  for (let k = 0; k < 300 && c.st !== 'return'; k++) A.step(1 / 30, () => { A.P.z += 6 / 30; });   // runs away at 6 m/s until the leash
  const lea = A.all.find((e) => e.type === 'leash' && e.id === c.id);
  ok(!!lea && c.target === null, 'rat: leashes when the player runs far away' + (lea ? ' (after ' + lea.at.toFixed(1) + ' s)' : ''));
  const r = A.sim.applyDamage(c.id, 50, { pid: 'p', x: c.x, z: c.z + 2 });
  ok(c.st !== 'return' || (r.ok === false && r.reason === 'evade'), 'rat: evading home it refuses damage openly (no silent 0-damage hits, no flinch)');
  A.step(12);
  ok(A.all.some((e) => e.type === 'reset' && e.id === c.id) && c.st !== 'return' && c.hp === c.maxHp, 'rat: back home, reset to full health');
}
{ // spawn point inside a rock (village props): the walk home must still end - never stuck immune in "return"
  const A = camp('snake'), c = A.c;
  A.sim.obstacles.push({ x: c.spawnX, z: c.spawnZ, r: 1.4 });
  A.step(0.5);
  A.P.x = c.x + 3; A.P.z = c.z; A.step(2);                 // ambush: raises, engages
  A.P.x = c.x + 60; A.step(14);                             // player gone -> leash
  ok(A.all.some((e) => e.type === 'leash' && e.id === c.id), 'snake: leashes once the player is gone');
  ok(c.st !== 'return' && A.all.some((e) => e.type === 'reset' && e.id === c.id), 'snake: blocked spawn point - the evade still ends (state ' + c.st + ')');
  A.P.x = c.x + 3; A.P.z = c.z; A.step(2);
  const r = A.sim.applyDamage(c.id, 40, { pid: 'p', x: A.P.x, z: A.P.z });
  ok(r.ok && r.amount === 40, 'snake: after the reset it can be fought again');
}
{ // roaming: a leg whose end point is blocked gives up instead of walking in place forever
  const A = camp('rat'), c = A.c;
  A.step(0.2);
  const leg = c.dest = { x: c.x + 2, z: c.z }; c.destMode = 'walk'; c.destT = 6; c.st = 'roam';
  A.sim.obstacles.push({ x: c.x + 2, z: c.z, r: 1.2 });
  A.step(10);
  ok(c.dest !== leg, 'rat: blocked roam leg is abandoned (no running in place)');
}
console.log(fails > f0 ? (fails - f0) + ' FAILED' : 'leash / evade passed');
process.exit(fails ? 1 : 0);
