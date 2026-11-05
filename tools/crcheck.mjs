// Headless numeric validation of a creature species (no browser): node tools/crcheck.mjs rat [more species...]
//  - geometry: triangle counts per LOD, bone count, build time
//  - foot sliding: drift of each planted paw (world XZ) during walk / run / turn (stance must stay put)
//  - ground contact: min CPU-skinned vertex height per clip (no terrain clipping), death rest height (no floating)
//  - state machine: death is terminal (attack / hit requests after death are refused)
import { load } from './crnode.mjs';
const FILES = { rat: 'rat', rabbit: 'rabbit', snake: 'snake', boar: 'boar', spikeback: 'boar', wolf: 'wolf', goblin: 'goblin', panther: 'panther', bear: 'bear', troll: 'troll', stag: 'stag' };
const VBASE = { rat_swamp: 'rat', rabbit_king: 'rabbit', snake_marsh: 'snake', snake_dune: 'snake', boar_black: 'boar', boar_iron: 'boar', wolf_dark: 'wolf', wolf_alpha: 'wolf', wolf_frost: 'wolf', goblin_warrior: 'goblin', goblin_brute: 'goblin', goblin_chief: 'goblin', goblin_frost: 'goblin', spike_red: 'spikeback', spike_frost: 'spikeback' };
globalThis.__vb = (s) => VBASE[s];
const list = process.argv.slice(2).length ? process.argv.slice(2) : ['rat'];
// variants (rat_swamp, wolf_frost, ...) render with their base species file; load them all, variants.js registers the variants
const { THREE, K, D } = await load([...new Set(list.map((s) => FILES[s] || FILES[globalThis.__vb(s)]).filter(Boolean))]);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
for (const id of list) {
  const sp = K.SPECIES[id], def = D.SPECIES[id];
  console.log('== ' + id);
  const g0 = K.speciesGeometry(id, 0), g1 = K.speciesGeometry(id, 1);
  console.log(`  tris LOD0 ${Math.round(g0.tris)}  LOD1 ${Math.round(g1.tris)}  bones ${sp.rig.n}  build ${(g0.ms + g1.ms).toFixed(0)} ms  slots ${Object.keys(g0.slots).join(',')}`);
  const scene = new THREE.Scene();
  const mk = () => { const v = new K.CreatureView(id); scene.add(v.root); v.teleport(0, 0, 0); return v; };
  const dt = 1 / 60;
  // CPU skinning of the full LOD1 mesh -> min y
  const minY = (v) => {
    v.root.updateMatrixWorld(true);
    const G = K.speciesGeometry(id, 1), inv = v.tpl.inverses, B = v.bones, M = B.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]));
    let m = 1e9; const p = new THREE.Vector3(), q = new THREE.Vector3(), acc = new THREE.Vector3();
    for (const s in G.slots) {
      const g = G.slots[s], P = g.attributes.position, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
      for (let i = 0; i < P.count; i += 2) {
        p.fromBufferAttribute(P, i); acc.set(0, 0, 0);
        for (let j = 0; j < 4; j++) { const w = SW[4 * i + j]; if (w > 0) acc.addScaledVector(q.copy(p).applyMatrix4(M[SI[4 * i + j]]), w); }
        if (acc.y < m) m = acc.y;
      }
    }
    return m;
  };
  const clip = (name, secs, setup, perFrame) => {
    const v = mk(); if (setup) setup(v);
    let lo = 1e9, slide = 0, slides = [];
    const feet = v.anim && v.anim.gait ? v.anim.gait.feet : [];
    const legs = v.anim && v.anim.legs ? v.anim.legs : [];
    const anchor = feet.map(() => null);
    const P = new THREE.Vector3();
    for (let t = 0; t < secs; t += dt) {
      if (perFrame) perFrame(v, t);
      v.update(dt, 2);
      if (t > 0.6) {
        lo = Math.min(lo, minY(v));
        feet.forEach((f, k) => {
          v.bones[legs[k].c[3]].getWorldPosition(P);
          if (f.planted && v.anim.legs[k].ikW > 0.99) { if (!anchor[k]) anchor[k] = P.clone(); else { const d = Math.hypot(P.x - anchor[k].x, P.z - anchor[k].z); slide = Math.max(slide, d); } }
          else anchor[k] = null;
        });
      }
    }
    return { v, lo, slide };
  };
  const spd = def.speed;
  const straight = (s) => (v, t) => { v.root.position.z += s * dt; };
  const circle = (s, R) => { let a = 0; return (v) => { a += s / R * dt; v.root.position.set(R * Math.sin(a), 0, R * (1 - Math.cos(a))); v.root.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); }; };
  const modeSet = (m) => (v) => { if (v.anim.setMode) v.anim.setMode(m); };
  for (const [n, secs, pf, mode] of [['idle', 3, null, null], ['walk', 4, straight(spd.walk), 'walk'], ['run', 4, straight(spd.run), 'run'], ['turn', 4, circle(spd.walk, 1.6 * (def.scale || 1)), 'walk']]) {
    const r = clip(n, secs, modeSet(mode), pf);
    const tol = 0.012 * Math.max(1, def.height / 0.6);
    ok(r.lo > -0.012 * (def.sizeMul || 1), `${n}: lowest vertex ${r.lo.toFixed(3)} m (no ground clipping)`);
    if (r.v.anim && r.v.anim.gait && n !== 'idle') ok(r.slide < tol, `${n}: max planted-foot slide ${(r.slide * 100).toFixed(2)} cm (< ${(tol * 100).toFixed(1)})`);
  }
  for (const a in def.attacks) {
    const name = (sp.attackAction && sp.attackAction[a]) || a;
    if (!sp.anim || !sp.anim.actions || !sp.anim.actions[name]) { ok(false, `attack ${a}: no animation '${name}'`); continue; }
    const A = def.attacks[a];
    const r = clip(a, A.dur + 0.5, (v) => { v.play(name); }, (v, t) => { const s = D.lungeAt(A, Math.min(1, t / A.dur)); v.root.position.z = s; });
    ok(r.lo > -0.015 * Math.pow(def.sizeMul || 1, 1.5), `${a}: lowest vertex ${r.lo.toFixed(3)} m`);
  }
  // death: settles on the ground, terminal
  const r = clip('death', 3.5, (v) => { v.play('death', { data: { side: 1 } }); });
  const rest = minY(r.v);
  ok(rest > -0.015 && rest < 0.03, `death rest: lowest vertex ${rest.toFixed(3)} m (on the ground, not floating)`);
  // corpse stays still: no bone may keep moving once the death has settled
  {
    const v = r.v, snap = () => v.bones.map((b) => { const p = new THREE.Vector3(); b.getWorldPosition(p); return p; });
    const s0 = snap(); for (let t = 0; t < 1; t += dt) v.update(dt, 2); const s1 = snap();
    const mv = Math.max(...s0.map((p, i) => p.distanceTo(s1[i])));
    ok(mv < 0.004, 'corpse is still after settling (max bone drift ' + (mv * 1000).toFixed(1) + ' mm / s)');
  }
  const refused = !r.v.play(Object.keys(def.attacks).map((a) => (sp.attackAction && sp.attackAction[a]) || a)[0]);
  ok(refused && r.v.sm.dead, 'death is terminal (attack request refused)');
}
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
