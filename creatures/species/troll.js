/* Forest Troll (levels 14-16): a huge hunched humanoid brute, ~2.9 m tall at the top of the head, authored at game size
 * (def scale 1). Same pipeline as the goblin / heroes: SDF-sculpted torso projected along a strongly forward-leaning spine
 * (sloping shoulders, back hump, barrel gut), SDF head (heavy brow, flat wide nose, underbite with two lower tusks, tiny deep
 * yellow eyes, small pointed ears), swept arms that nearly reach the ground (big knuckled hands), short bowed legs with broad
 * flat feet. Skin: mossy grey-green with darker warty patches, warts, moss mats and tufts, bone-white scars. Gear: rope belt,
 * ragged hide loincloth, tooth / bone necklace, a gnarled tree-trunk club (own bone, so it can roll away on death).
 * Animation: the shared foot-planting QuadAnimator with two plantigrade legs (heavy lumbering walk, loping run), spring-driven
 * belly / ears / club, step shake; smash (overhead club slam) and backhand (wide club sweep) keyed on the gameplay timeline
 * (defs.js); hit / stagger, death (topples, club rolls away), idle specials (scratch head, chew / spit, beat chest). */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- gameplay def (authored at scale 1 = game size) ---------------- */
  const A = (dur, an, wu, hit, fo, active, o) => Object.assign({ dur, phases: { s: 0, an, wu, hit, fo, e: 1 }, active }, o);
  CREATURE_DEFS.addSpecies('troll', {
    scale: 1.1,
    name: 'Orman Trolü', en: 'Forest Troll', levels: [14, 16], hp: 5200, hpLv: 520, exp: 3300, expLv: 380,
    radius: 0.77, front: 0.77, height: 2.64, mass: 3, poise: 0.8,
    speed: { walk: 1.145, run: 3.72 }, turn: 3.4,
    behavior: { type: 'skirmisher', aggro: 8, assist: 0, leash: 21, roam: 4, pause: [2, 5], dash: [1.2, 3], strafe: 1.0 },
    attacks: {
      smash: A(1.9, 0.34, 0.5, 0.56, 0.78, [0.54, 0.66], { reach: 1.82, cosArc: 0.1, dmg: [420, 500], dmgLv: 48, cd: 3.2, use: [0, 1.55], lunge: 0.27, heavy: true }),
      backhand: A(1.15, 0.26, 0.42, 0.5, 0.72, [0.45, 0.58], { reach: 1.73, cosArc: -0.1, dmg: [330, 390], dmgLv: 38, cd: 1.8, use: [0, 1.35], lunge: 0.23 }),
    },
    corpse: 14, respawn: [30, 42],
    loot: [{ id: 'troll_bone', name: 'Trol Kemiği', p: 0.3 }],
  });
  const D = CREATURE_DEFS.SPECIES.troll;

  /* ---------------- skeleton (world bind positions, metres; hunched, arms hanging) ---------------- */
  const bones = [
    ['body', null, 0, 1.28, -0.12],
    ['pelvis', 'body', 0, 1.28, -0.12],
    ['spine', 'body', 0, 1.5, 0.02, 'chest'],
    ['belly', 'spine', 0, 1.62, 0.1],
    ['chest', 'spine', 0, 1.92, 0.24, 'neck'],
    ['ribs', 'chest', 0, 1.95, 0.3],
    ['neck', 'chest', 0, 2.3, 0.42, 'head'],
    ['head', 'neck', 0, 2.42, 0.66],
    ['jaw', 'head', 0, 2.34, 0.72],
    ['earL', 'head', 0.2, 2.5, 0.68], ['earR', 'head', -0.2, 2.5, 0.68],
  ];
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    bones.push(
      ['th' + k, 'pelvis', s * 0.3, 1.24, -0.1, 'shin' + k],
      ['shin' + k, 'th' + k, s * 0.38, 0.7, 0.0, 'foot' + k],
      ['foot' + k, 'shin' + k, s * 0.34, 0.17, -0.09, 'toe' + k],
      ['toe' + k, 'foot' + k, s * 0.34, 0.07, 0.2],
      ['clav' + k, 'chest', s * 0.12, 2.3, 0.34, 'up' + k],
      ['up' + k, 'clav' + k, s * 0.64, 2.2, 0.38, 'lo' + k],
      ['lo' + k, 'up' + k, s * 0.8, 1.52, 0.34, 'hand' + k],
      ['hand' + k, 'lo' + k, s * 0.88, 0.84, 0.48],
    );
  }
  bones.push(['club', 'handR', -0.93, 0.47, 0.5]);
  const ends = {
    body: [0, 1.5, 0.02], pelvis: [0, 1.1, -0.1], belly: [0, 1.4, 0.45], ribs: [0, 1.95, 0.7], head: [0, 2.45, 1.1], jaw: [0, 2.25, 1.08],
    earL: [0.34, 2.64, 0.6], earR: [-0.34, 2.64, 0.6], toeL: [0.34, 0.04, 0.4], toeR: [-0.34, 0.04, 0.4],
    handL: [0.92, 0.3, 0.55], handR: [-0.92, 0.3, 0.55], club: [-0.93, 0.47, 1.8],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikL', 'ikR', 'jawO']);

  /* ---------------- palette (display-space vertex colours; upward faces render ~2.2x brighter) ---------------- */
  const C = {
    skin: [0.2, 0.218, 0.168], skinD: [0.135, 0.15, 0.108], skinL: [0.26, 0.262, 0.2], wart: [0.13, 0.14, 0.095], wartTip: [0.21, 0.215, 0.16],
    lip: [0.15, 0.1, 0.085], nose: [0.17, 0.14, 0.105], earIn: [0.22, 0.15, 0.12], mouth: [0.1, 0.045, 0.045], gum: [0.2, 0.1, 0.095],
    eye: [0.78, 0.6, 0.06], pupil: [0.03, 0.02, 0.01], tusk: [0.62, 0.55, 0.4], nail: [0.2, 0.17, 0.12], scar: [0.5, 0.46, 0.38],
    moss: [0.055, 0.08, 0.03], mossL: [0.09, 0.115, 0.045], lichen: [0.27, 0.29, 0.2],
    bark: [0.2, 0.145, 0.1], barkD: [0.12, 0.085, 0.06], wood: [0.42, 0.31, 0.2],
    hide: [0.42, 0.4, 0.32], hideD: [0.25, 0.23, 0.18], rope: [0.42, 0.32, 0.2], ropeD: [0.25, 0.18, 0.11], bone: [0.56, 0.5, 0.38], boneD: [0.36, 0.3, 0.22],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const noise = (p, f) => vnoise3(p.x * f, p.y * f, p.z * f);
  const g3 = (p, c, s) => { const x = (p.x - c[0]) / s[0], y = (p.y - c[1]) / s[1], z = (p.z - c[2]) / s[2]; return Math.exp(-(x * x + y * y + z * z)); };
  const hash1 = (i) => { const s = Math.sin(i * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
  function scaleUV(g, su, sv) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * su, U.getY(i) * sv); return g; }

  // bone-white scars (painted): segments in bind space [ax, ay, az, bx, by, bz, half-width]
  const SCARS = [
    [-0.45, 2.1, 0.66, 0.12, 1.66, 0.7, 0.013], [-0.34, 2.05, 0.7, -0.22, 2.1, 0.7, 0.01], [-0.28, 1.95, 0.74, 0.0, 1.78, 0.74, 0.008],
    [0.14, 2.56, 0.94, 0.2, 2.32, 0.9, 0.009],                                       // across the left cheek / eye
    [-0.82, 1.95, 0.42, -0.74, 1.45, 0.4, 0.014], [0.55, 1.4, 0.58, 0.18, 1.3, 0.62, 0.011], [0.3, 1.55, 0.6, 0.48, 1.34, 0.56, 0.008],
    [0.78, 1.7, 0.36, 0.84, 1.3, 0.4, 0.011],
  ].map((s) => ({ a: V(s[0], s[1], s[2]), b: V(s[3], s[4], s[5]), w: s[6] }));
  const SCAR_MIR = SCARS.map((s) => ({ a: V(-s.a.x, s.a.y, s.a.z), b: V(-s.b.x, s.b.y, s.b.z), w: s.w }));
  function scarW(p) {
    let w = 0;
    for (const L of SCARS) { const d = K.segDist(p, L.a, L.b); w = Math.max(w, Math.exp(-(d * d) / (L.w * L.w))); }
    return w;
  }
  function skinColor(p, n, o) {
    o = o || {};
    const up = n.y;
    let c = mix(C.skin, C.skinD, sstep(0.2, 0.9, up) * 0.65);                          // tops of the shoulders / head a touch darker
    c = mix(c, C.skinL, sstep(-0.2, -0.85, up) * 0.45);
    // belly: paler, yellowish
    c = mix(c, [0.28, 0.27, 0.19], 0.55 * g3(p, [0, 1.5, 0.55], [0.3, 0.3, 0.2]) * sstep(0.1, 0.6, n.z));
    // dark warty mottling (low-frequency patches with a rough edge) and mossy stains on the upward faces
    const patch = sstep(0.5, 0.62, noise(p, 3.2) * 0.7 + noise(p, 11) * 0.3);
    c = mix(c, mix(C.wart, [0.17, 0.15, 0.11], sstep(0.4, 0.7, noise(p, 7.3))), 0.95 * patch);
    c = mix(c, [0.3, 0.32, 0.25], 0.45 * sstep(0.7, 0.82, noise(p, 16)) * (1 - patch));          // pale lichen blotches
    c = mix(c, [0.15, 0.19, 0.09], 0.5 * sstep(0.5, 0.75, noise(p, 5.5)) * sstep(0.1, 0.7, up));
    c = mul(c, 0.88 + 0.2 * noise(p, 26));
    if (!o.noScar) { const s = Math.max(scarW(p), scarMir(p)); c = mix(c, C.scar, 0.85 * s); }
    return c;
  }
  function scarMir(p) { let w = 0; for (const L of SCAR_MIR) { const d = K.segDist(p, L.a, L.b); w = Math.max(w, Math.exp(-(d * d) / (L.w * L.w))); } return w * 0.8; }

  /* ---------------- torso SDF (shared by the body surface, gear and decoration placement) ---------------- */
  const torsoBase = K.sdf([
    { e: [0, 1.25, -0.14], r: [0.4, 0.27, 0.32] },                                    // pelvis
    { e: [0.2, 1.2, -0.3], r: [0.2, 0.22, 0.2], k: 0.08 },                            // glutes
    { e: [-0.2, 1.2, -0.3], r: [0.2, 0.22, 0.2], k: 0.08 },
    { e: [0.3, 1.2, -0.08], r: [0.16, 0.2, 0.18], k: 0.08 },                          // hip joints
    { e: [-0.3, 1.2, -0.08], r: [0.16, 0.2, 0.18], k: 0.08 },
    { e: [0, 1.5, 0.2], r: [0.5, 0.46, 0.46], k: 0.14 },                              // barrel gut
    { e: [0, 1.37, 0.34], r: [0.38, 0.27, 0.28], k: 0.1 },                            // overhanging lower belly
    { e: [0, 1.93, 0.2], r: [0.52, 0.44, 0.46], k: 0.12 },                            // rib cage
    { e: [0.25, 2.0, 0.5], r: [0.21, 0.15, 0.14], k: 0.07 },                          // pectorals
    { e: [-0.25, 2.0, 0.5], r: [0.21, 0.15, 0.14], k: 0.07 },
    { e: [0, 2.3, 0.12], r: [0.52, 0.3, 0.34], k: 0.12 },                             // back hump
    { c: [0, 2.34, 0.3, 0.62, 2.16, 0.38], ra: 0.27, rb: 0.25, k: 0.1 },              // sloping trapezius -> shoulders
    { c: [0, 2.34, 0.3, -0.62, 2.16, 0.38], ra: 0.27, rb: 0.25, k: 0.1 },
    { e: [0.3, 2.04, -0.1], r: [0.19, 0.25, 0.11], k: 0.08 },                         // shoulder blades
    { e: [-0.3, 2.04, -0.1], r: [0.19, 0.25, 0.11], k: 0.08 },
    { c: [0, 2.2, 0.36, 0, 2.43, 0.68], ra: 0.29, rb: 0.21, k: 0.1 },                 // short thick neck, thrust forward
  ]);
  // lumpy hide: low-frequency swells, warty lumps and sagging belly folds are part of the field (surface + gear stay consistent)
  const torsoSDF = (x, y, z) => torsoBase(x, y, z) - 0.04 * (vnoise3(x * 6, y * 6, z * 6) - 0.5) - 0.02 * sstep(0.58, 0.8, vnoise3(x * 14 + 3, y * 14, z * 14)) - 0.008 * (vnoise3(x * 30, y * 30, z * 30) - 0.5) + 0.011 * Math.sin(y * 34 + z * 4) * gs(y, 1.47, 0.22) * sstep(0.0, 0.3, z);
  const spineCurve = new T.CatmullRomCurve3([V(0, 1.1, -0.17), V(0, 1.3, -0.1), V(0, 1.55, 0.05), V(0, 1.82, 0.19), V(0, 2.08, 0.32), V(0, 2.3, 0.46), V(0, 2.42, 0.68)], false, 'centripetal');
  const czAt = (() => { const tab = []; for (let i = 0; i <= 200; i++) { const p = spineCurve.getPointAt(i / 200); tab.push([p.y, p.z]); } return (y) => { if (y <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (tab[i][0] >= y) { const a = tab[i - 1], b = tab[i], t = (y - a[0]) / Math.max(1e-6, b[0] - a[0]); return lerp(a[1], b[1], t); } return tab[tab.length - 1][1]; }; })();
  // point on the torso surface (+ offset) by a horizontal ray from the spine at height y, angle a (0 = front, +pi/2 = left)
  function surf(y, a, off, out) {
    const cz = czAt(y), dx = Math.sin(a), dz = Math.cos(a);
    let r = 0.9;
    for (let it = 0; it < 90; it++) { const d = torsoSDF(dx * r, y, cz + dz * r) - off; if (Math.abs(d) < 1e-5) break; r -= d * 0.8; if (r < 0.005) { r = 0.005; break; } }
    return (out || new T.Vector3()).set(dx * r, y, cz + dz * r);
  }
  // pull a point onto the torso surface (+ offset along the normal); returns { p, n }
  function snap(x, y, z, off) {
    const p = V(x, y, z), e = 2e-3, n = V(0, 1, 0);
    for (let it = 0; it < 40; it++) {
      const d = torsoSDF(p.x, p.y, p.z);
      n.set(torsoSDF(p.x + e, p.y, p.z) - torsoSDF(p.x - e, p.y, p.z), torsoSDF(p.x, p.y + e, p.z) - torsoSDF(p.x, p.y - e, p.z), torsoSDF(p.x, p.y, p.z + e) - torsoSDF(p.x, p.y, p.z - e)).normalize();
      if (Math.abs(d - (off || 0)) < 1e-4) break;
      p.addScaledVector(n, -(d - (off || 0)) * 0.9);
    }
    return { p, n };
  }
  // surface point by spine parameter s and ray angle a (same frame as K.projectSDF with up = +Z)
  const _tg = V(0, 0, 0), _yy = V(0, 0, 0), _xx = V(0, 0, 0);
  function torsoPoint(s, a, off) {
    const o = spineCurve.getPointAt(s), tg = spineCurve.getTangentAt(s, _tg);
    _yy.set(0, 0, 1).addScaledVector(tg, -tg.z).normalize(); _xx.crossVectors(_yy, tg);
    const d = V(0, 0, 0).addScaledVector(_yy, Math.cos(a)).addScaledVector(_xx, Math.sin(a)).normalize();
    let r = 1.1;
    for (let it = 0; it < 90; it++) { const dd = torsoSDF(o.x + d.x * r, o.y + d.y * r, o.z + d.z * r) - (off || 0); if (Math.abs(dd) < 1e-5) break; r -= dd * 0.8; if (r < 0.01) { r = 0.01; break; } }
    return snap(o.x + d.x * r, o.y + d.y * r, o.z + d.z * r, off || 0);
  }
  /* thick garment band around the torso between yb(a) and yt(a) */
  function band(o) {
    const rows = [[0, o.inner]];
    for (let j = 0; j <= o.rows; j++) rows.push([j / o.rows, o.off]);
    rows.push([1, o.inner]);
    const g = K.gridGeo(rows.length, o.nu, (j, i, out) => {
      const a = -PI + TAU * i / o.nu, [t, off] = rows[j], y = lerp(o.yb(a), o.yt(a), t);
      surf(y, a, off, out);
      return { a, t, y, rim: j === 0 || j === rows.length - 1 };
    }, { extra: true });
    const ex = g.userData.extra;
    return K.finish(g, (k, out) => out.set(0, ex[k].y, czAt(ex[k].y)));
  }
  // orient a primitive (built around the origin with +Y as its "up") along a normal and move it to p
  const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _up = V(0, 1, 0);
  function place(g, p, n, roll) { _q.setFromUnitVectors(_up, n); g.applyMatrix4(_m4.makeRotationFromQuaternion(_q)); g.translate(p.x, p.y, p.z); void roll; return g; }

  /* ---------------- geometry ---------------- */
  function build(q) {
    const parts = { skin: [], fur: [], horn: [], gloss: [], leather: [], cloth: [] };
    const nr = (n) => Math.max(5, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    const segs = (list) => list.map((s) => [I[s[0]], s[1], s[2]]);
    const lod = q < 0.9, sw = lod ? 5 : 7, sh2 = lod ? 3 : 5;                     // distant LOD: fewer / cheaper warts, blades

    /* torso: one surface from the crotch to inside the skull */
    const torso = K.projectSDF({ sdf: torsoSDF, curve: spineCurve, up: V(0, 0, 1), rows: nr(48), nu: nu(36), cap0: 0.1, cap1: 0.06, rmax: 1.1 });
    const TS = segs([['pelvis', V(0, 1.05, -0.17), V(0, 1.4, -0.06)], ['spine', V(0, 1.4, -0.06), V(0, 1.76, 0.15)], ['chest', V(0, 1.76, 0.15), V(0, 2.28, 0.42)], ['neck', V(0, 2.28, 0.42), V(0, 2.4, 0.66)], ['head', V(0, 2.4, 0.66), V(0, 2.45, 0.9)]]);
    const torsoW = (p) => {
      const k = p.x >= 0 ? 'L' : 'R', s = p.x >= 0 ? 1 : -1;
      return K.envelope(TS, p, 4, [
        [I['th' + k], 0.62 * gs(p.distanceTo(W('th' + k)), 0, 0.26) * sstep(1.32, 1.2, p.y)],
        [I['up' + k], 0.5 * gs(p.distanceTo(W('up' + k)), 0, 0.22) * sstep(0.28, 0.4, Math.abs(p.x))],
        [I['clav' + k], 0.35 * gs(p.distanceTo(V(s * 0.3, 2.26, 0.34)), 0, 0.2)],
        [I.belly, 0.7 * gs(p.distanceTo(V(0, 1.52, 0.4)), 0, 0.34) * sstep(0.0, 0.2, p.z)],
        [I.ribs, 0.35 * gs(p.y, 1.95, 0.25) * sstep(0.1, 0.4, p.z)],
      ]);
    };
    K.skin(torso, torsoW);
    K.paint(torso, (p, n) => skinColor(p, n));
    parts.skin.push(torso);

    /* head: skull, brow, flat wide nose, upper jaw with tiny deep eyes; mandible (underbite) on the jaw bone */
    const headBase = K.sdf([
      { e: [0, 2.5, 0.7], r: [0.2, 0.18, 0.21] },                                       // cranium
      { e: [0, 2.46, 0.58], r: [0.17, 0.15, 0.14], k: 0.06 },                            // occiput
      { e: [0, 2.4, 0.86], r: [0.17, 0.16, 0.15], k: 0.06 },                             // face
      { e: [0.12, 2.37, 0.9], r: [0.07, 0.07, 0.08], k: 0.04 },                          // cheeks
      { e: [-0.12, 2.37, 0.9], r: [0.07, 0.07, 0.08], k: 0.04 },
      { e: [0, 2.51, 0.93], r: [0.2, 0.045, 0.07], k: 0.04 },                            // heavy brow ridge
      { e: [0.1, 2.51, 0.94], r: [0.09, 0.05, 0.07], k: 0.03 },
      { e: [-0.1, 2.51, 0.94], r: [0.09, 0.05, 0.07], k: 0.03 },
      { e: [0, 2.44, 0.99], r: [0.05, 0.05, 0.05], k: 0.03 },                            // nose bridge
      { e: [0, 2.37, 1.04], r: [0.075, 0.045, 0.055], k: 0.03 },                         // wide flat nose
      { e: [0.06, 2.36, 1.0], r: [0.04, 0.035, 0.04], k: 0.02 },                         // nostril wings
      { e: [-0.06, 2.36, 1.0], r: [0.04, 0.035, 0.04], k: 0.02 },
      { e: [0, 2.3, 0.97], r: [0.13, 0.055, 0.09], k: 0.05 },                            // upper lip / muzzle
      { e: [0.032, 2.35, 1.07], r: [0.014, 0.011, 0.022], k: 0.008, sub: true },         // nostrils
      { e: [-0.032, 2.35, 1.07], r: [0.014, 0.011, 0.022], k: 0.008, sub: true },
      { e: [0.085, 2.455, 0.955], r: [0.036, 0.024, 0.03], k: 0.02, sub: true },         // deep eye sockets
      { e: [-0.085, 2.455, 0.955], r: [0.036, 0.024, 0.03], k: 0.02, sub: true },
      { e: [0.2, 2.5, 0.8], r: [0.03, 0.05, 0.06], k: 0.03, sub: true },                  // temples
      { e: [-0.2, 2.5, 0.8], r: [0.03, 0.05, 0.06], k: 0.03, sub: true },
    ]);
    const headSDF = (x, y, z) => headBase(x, y, z) - 0.006 * (vnoise3(x * 22, y * 22, z * 22) - 0.5) - 0.004 * sstep(0.62, 0.8, vnoise3(x * 40 + 1, y * 40, z * 40));
    const head = K.projectSDF({ sdf: headSDF, curve: new T.LineCurve3(V(0, 2.47, 0.5), V(0, 2.4, 1.0)), rows: nr(40), nu: nu(30), cap0: 0.2, cap1: 0.3, rmax: 0.5 });
    K.skin(head, [[I.head, 1]]);
    K.paint(head, (p, n) => {
      let c = skinColor(p, n);
      const sock = g3(p, [0.085, 2.455, 0.95], [0.05, 0.035, 0.04]) + g3(p, [-0.085, 2.455, 0.95], [0.05, 0.035, 0.04]);
      c = mul(c, 1 - 0.45 * Math.min(1, sock));
      c = mix(c, C.nose, g3(p, [0, 2.36, 1.07], [0.05, 0.035, 0.035]) * 0.7);
      c = mix(c, C.lip, g3(p, [0, 2.275, 1.03], [0.12, 0.012, 0.03]) * 0.6);
      return c;
    });
    parts.skin.push(head);
    const jawSDF = K.sdf([
      { e: [0, 2.25, 0.9], r: [0.155, 0.065, 0.14] },
      { e: [0, 2.235, 1.01], r: [0.1, 0.06, 0.075], k: 0.04 },                           // heavy chin, juts past the upper lip (underbite)
      { e: [0.12, 2.3, 0.78], r: [0.045, 0.07, 0.08], k: 0.04 },                         // jaw angles
      { e: [-0.12, 2.3, 0.78], r: [0.045, 0.07, 0.08], k: 0.04 },
      { e: [0, 2.28, 1.0], r: [0.07, 0.02, 0.05], k: 0.02, sub: true },                  // mouth cavity under the lip
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 2.27, 0.74), V(0, 2.245, 1.0)), rows: nr(20), nu: nu(24), cap0: 0.25, cap1: 0.25, rmax: 0.3 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => mix(mix(skinColor(p, n), C.lip, g3(p, [0, 2.275, 1.0], [0.1, 0.012, 0.04]) * 0.5), C.mouth, sstep(0.4, 0.85, n.y) * sstep(0.84, 0.92, p.z)));
    parts.skin.push(jaw);
    for (const s of [-1, 1]) {
      // tiny yellow eyes with a dark slit pupil, heavy lids
      const eye = new T.SphereGeometry(0.021, nu(12), nr(8)); eye.translate(s * 0.082, 2.452, 0.952);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
      const pup = new T.SphereGeometry(0.0085, nu(8), nr(6)); pup.scale(0.55, 1, 1); pup.translate(s * 0.082, 2.452, 0.9715);
      parts.gloss.push(K.prim(pup, C.pupil, I.head));
      const lid = new T.SphereGeometry(0.0245, nu(12), nr(5), 0, TAU, 0, 1.05); lid.rotateX(0.35); lid.rotateZ(s * 0.3); lid.translate(s * 0.082, 2.455, 0.948);
      parts.skin.push(K.prim(lid, mul(C.skinD, 0.85), I.head));
      // two lower tusks, curving up past the upper lip
      const tusk = K.sweep({ pts: [V(s * 0.062, 2.245, 1.01), V(s * 0.07, 2.285, 1.07), V(s * 0.074, 2.345, 1.085), V(s * 0.07, 2.395, 1.075)], up: V(0, 0, 1), rows: nr(8), nu: 8, cap0: 1, cap1: 3,
        prof: (u, o) => { o[0] = o[1] = o[2] = lerp(0.026, 0.0045, Math.pow(u, 0.8)); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(tusk, [[I.jaw, 1]]); K.paint(tusk, (p) => mix(C.tusk, mul(C.tusk, 0.6), sstep(2.33, 2.25, p.y) * 0.8 + 0.1 * noise(p, 60)));
      parts.horn.push(tusk);
    }
    /* ears: small, pointed, swept back and out */
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const e = K.sweep({
        pts: [V(s * 0.19, 2.5, 0.7), V(s * 0.25, 2.55, 0.66), V(s * 0.3, 2.6, 0.62), V(s * 0.34, 2.65, 0.58)], up: V(s * 0.45, 0.12, 0.88),
        prof: (u, o) => { o[0] = (0.045 + 0.02 * Math.sin(Math.min(1, u * 2.2) * PI * 0.5)) * Math.pow(1 - u, 0.7) + 0.003; o[1] = o[2] = 0.009 * (1 - 0.5 * u) + 0.002; o[3] = 2; o[4] = 0; o[5] = 0.01 * Math.sin(PI * u); return o; },
        cup: (u) => -0.015 * Math.sin(PI * Math.min(1, u * 1.3)) * (1 - u * 0.5), rows: nr(10), nu: nu(12), cap0: 2, cap1: 2,
      });
      K.skin(e, (p) => { const w = sstep(0.21, 0.26, Math.abs(p.x)); return [[I['ear' + k], w], [I.head, 1 - w]]; });
      K.paint(e, (p, n) => mix(skinColor(p, n), C.earIn, sstep(0.0, 0.6, n.z * 0.88 + n.x * s * 0.45) * sstep(0.2, 0.25, Math.abs(p.x)) * 0.8));
      parts.skin.push(e);
    }

    /* limbs (left built, right mirrored) */
    const left = { skin: [], horn: [], fur: [] };
    // arm: shoulder -> elbow -> wrist, bulky upper arm / forearm
    const aPts = [V(0.34, 2.3, 0.34), W('upL'), W('loL'), W('handL')];
    const aCurve = new T.CatmullRomCurve3(aPts, false, 'centripetal');
    const aTab = M.curve([[0, 0.25, 0.26, 0.25], [0.1, 0.28, 0.27, 0.27], [0.28, 0.22, 0.23, 0.22], [0.48, 0.185, 0.19, 0.185], [0.59, 0.165, 0.165, 0.16], [0.68, 0.2, 0.19, 0.19], [0.85, 0.15, 0.15, 0.14], [1, 0.108, 0.105, 0.1]]), aq = [0, 0, 0];
    const armProf = (u, o) => { aTab(u, aq); o[0] = aq[0]; o[1] = aq[1]; o[2] = aq[2]; o[3] = 2.2; o[4] = 0; o[5] = 0; return o; };
    const arm = K.sweep({ curve: aCurve, up: V(0, 0, 1), prof: armProf, rows: nr(30), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.02 * gs(u, 0.3, 0.1) * ga(a, 0, 0.8) + 0.018 * gs(u, 0.27, 0.12) * ga(a, PI, 0.9) + 0.02 * gs(u, 0.7, 0.09) * ga(a, PI / 2, 0.8) + 0.012 * gs(u, 0.62, 0.03) * ga(a, PI, 0.4) });
    const AS = segs([['clavL', aPts[0], aPts[1]], ['upL', aPts[1], aPts[2]], ['loL', aPts[2], aPts[3]], ['handL', aPts[3], V(0.92, 0.3, 0.55)]]);
    K.skin(arm, (p) => K.envelope(AS, p, 4));
    K.paint(arm, (p, n) => skinColor(p, n));
    left.skin.push(arm);
    // leg: hip -> knee (bowed outward) -> ankle
    const lPts = [V(0.27, 1.3, -0.1), W('thL'), W('shinL'), W('footL')];
    const lTab = M.curve([[0, 0.25, 0.25, 0.26], [0.12, 0.26, 0.27, 0.27], [0.35, 0.2, 0.22, 0.2], [0.5, 0.165, 0.17, 0.16], [0.6, 0.17, 0.16, 0.19], [0.75, 0.145, 0.14, 0.15], [0.9, 0.12, 0.11, 0.115], [1, 0.1, 0.095, 0.1]]), lq = [0, 0, 0];
    const leg = K.sweep({ pts: lPts, up: V(0, 0, 1), rows: nr(26), nu: nu(16), cap0: 2, cap1: 2,
      prof: (u, o) => { lTab(u, lq); o[0] = lq[0]; o[1] = lq[1]; o[2] = lq[2]; o[3] = 2.2; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.015 * gs(u, 0.62, 0.08) * ga(a, PI / 2, 0.9) + 0.012 * gs(u, 0.25, 0.1) * ga(a, 0.3, 0.8) });
    const LS = segs([['pelvis', lPts[0], lPts[1]], ['thL', lPts[1], lPts[2]], ['shinL', lPts[2], lPts[3]], ['footL', lPts[3], W('toeL')]]);
    K.skin(leg, (p) => K.envelope(LS, p, 4));
    K.paint(leg, (p, n) => skinColor(p, n));
    left.skin.push(leg);
    // broad flat foot: heel / arch / ball, stubby toes with thick dark nails
    const FS = segs([['shinL', V(0.345, 0.4, -0.04), W('footL')], ['footL', W('footL'), W('toeL')], ['toeL', W('toeL'), V(0.34, 0.04, 0.4)]]);
    const foot = K.sweep({ pts: [V(0.345, 0.3, -0.07), V(0.34, 0.16, -0.12), V(0.34, 0.1, -0.02), V(0.34, 0.085, 0.14), V(0.34, 0.075, 0.3)], up: V(0, 1, 0), rows: nr(16), nu: nu(18), cap0: 2, cap1: 2,
      prof: (u, o) => { o[0] = lerp(0.12, 0.16, sstep(0.3, 0.85, u)) * (1 - 0.25 * sstep(0.88, 1, u)); o[1] = lerp(0.11, 0.055, sstep(0.0, 0.7, u)); o[2] = lerp(0.1, 0.05, sstep(0.2, 0.6, u)); o[3] = 2.5; o[4] = 0; o[5] = -0.01 * sstep(0.3, 0.7, u); return o; } });
    K.skin(foot, (p) => K.envelope(FS, p, 4)); K.paint(foot, (p, n) => skinColor(p, n, { noScar: true }));
    left.skin.push(foot);
    for (const [tx, tl] of [[-0.115, 0.8], [-0.055, 0.95], [0.0, 1], [0.055, 0.95], [0.11, 0.78]]) {
      const x0 = 0.34 + tx * 1.1;
      const toe = K.sweep({ pts: [V(x0, 0.075, 0.28), V(x0 + tx * 0.2, 0.062, 0.33 + 0.03 * tl), V(x0 + tx * 0.3, 0.05, 0.36 + 0.055 * tl)], up: V(0, 1, 0), rows: 5, nu: nu(10), cap0: 1, cap1: 3,
        prof: (u, o) => { o[0] = lerp(0.036, 0.03, u); o[1] = lerp(0.04, 0.03, u); o[2] = lerp(0.034, 0.024, u); o[3] = 2.2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(toe, (p) => K.envelope(FS, p, 4));
      K.paint(toe, (p, n, info) => mix(skinColor(p, n, { noScar: true }), C.nail, sstep(0.78, 0.96, info ? info.s : 0) * sstep(-0.1, 0.5, n.y)));
      left.skin.push(toe);
    }
    // left hand: thick palm, big knuckles, half-curled thick fingers + thumb (hangs, knuckles near the ground)
    const HS = segs([['loL', W('loL'), W('handL')], ['handL', W('handL'), V(0.92, 0.3, 0.55)]]);
    const palm = K.sweep({ pts: [V(0.88, 0.86, 0.48), V(0.9, 0.7, 0.51), V(0.912, 0.58, 0.53)], up: V(1, 0, 0), rows: nr(8), nu: nu(14), cap0: 1, cap1: 1,
      prof: (u, o) => { o[0] = lerp(0.105, 0.13, u); o[1] = lerp(0.075, 0.07, u); o[2] = lerp(0.065, 0.05, u); o[3] = 2.3; o[4] = 0; o[5] = 0; return o; } });
    K.skin(palm, (p) => K.envelope(HS, p, 4)); K.paint(palm, (p, n) => skinColor(p, n));
    left.skin.push(palm);
    const finger = (pts, r0, slot, list, tw) => {
      const f = K.sweep({ pts, up: V(0, 0, 1), rows: nr(9), nu: 8, cap0: 1, cap1: 3,
        prof: (u, o) => { o[0] = o[1] = o[2] = lerp(r0, r0 * 0.7, u) * (1 + 0.14 * Math.sin(u * PI * 3.2)); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(f, [[I[slot], 1]]);
      K.paint(f, (p, n, info) => mix(skinColor(p, n, { noScar: true }), C.nail, sstep(0.84, 0.97, info ? info.s : 0) * sstep(-0.3, 0.4, tw ? n.z * tw : n.y)));
      list.push(f);
    };
    const knuckle = (x, y, z, r, slot, list) => {
      const k = new T.SphereGeometry(r, lod ? 6 : 8, lod ? 4 : 6); k.scale(1, 0.85, 1.05); k.translate(x, y, z);
      K.prim(k, mix(C.skin, C.skinD, 0.5), I[slot]); list.push(k);
    };
    for (const [zf, len] of [[-0.075, 0.82], [-0.025, 1], [0.025, 0.96], [0.075, 0.8]]) {
      const z = 0.53 + zf;
      finger([V(0.912, 0.6, z), V(0.918, 0.5, z + 0.005), V(0.895, 0.42 - 0.01 * len, z + 0.012), V(0.855, 0.385 - 0.02 * len, z + 0.018)], 0.036, 'handL', left.skin);
      knuckle(0.925, 0.6, z, 0.043, 'handL', left.skin);
    }
    finger([V(0.88, 0.7, 0.62), V(0.865, 0.62, 0.66), V(0.84, 0.54, 0.665)], 0.04, 'handL', left.skin);
    // mirror the left-side parts to the right side (the right hand is built separately: it grips the club)
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    const remap = (b) => (lr[b] !== undefined ? lr[b] : b);
    const handParts = new Set(left.skin.slice(left.skin.indexOf(palm)));
    for (const g of handParts) { g.translate(-0.88, -0.84, -0.48); g.scale(1.3, 1.3, 1.3); g.translate(0.88, 0.84, 0.48); }
    for (const slot in left) for (const g of left[slot]) { parts[slot].push(g); }
    for (const slot in left) for (const g of left[slot]) { if (handParts.has(g)) continue; parts[slot].push(K.mirrorX(g, remap)); }
    parts.skin.push(K.mirrorX(palm, remap));
    // right hand: fist wrapped around the club handle (handle axis along +Z through (-0.93, 0.47))
    const GX = -0.93, GY = 0.47, RH = [], rho = 0.112;
    const wrapPts = (z, k) => { const a = [135, 180, 225, 270, 315, 360, 395].map((d) => d * PI / 180); return [V(-0.915, 0.6, z)].concat(a.map((t, i) => V(GX + rho * Math.cos(t) * (1 - 0.03 * k), GY + rho * Math.sin(t) * (1 - 0.03 * k), z + 0.004 * i))); };
    for (const [zf, k] of [[-0.075, 1], [-0.025, 0], [0.025, 0], [0.075, 1]]) {
      const z = 0.53 + zf;
      finger(wrapPts(z, k), 0.044, 'handR', RH);
      knuckle(-0.93, 0.62, z, 0.052, 'handR', RH);
    }
    finger([V(-0.89, 0.72, 0.6), V(GX + 0.1, GY + 0.16, 0.58), V(GX + 0.115, GY + 0.04, 0.56), V(GX + 0.08, GY - 0.08, 0.57)], 0.05, 'handR', RH);
    parts.skin.push(...RH);

    /* club: gnarled tree trunk, own bone (rolls away on death). Axis +Z through the fist. */
    const cp = [V(GX, GY, 0.14), V(GX + 0.005, GY + 0.004, 0.5), V(GX + 0.01, GY - 0.005, 0.95), V(GX + 0.0, GY + 0.01, 1.35), V(GX - 0.015, GY, 1.62), V(GX - 0.02, GY - 0.012, 1.82)];
    const cTab = M.curve([[0, 0.095, 0.095, 0.095], [0.06, 0.085, 0.085, 0.085], [0.3, 0.078, 0.078, 0.078], [0.5, 0.095, 0.095, 0.095], [0.7, 0.14, 0.14, 0.14], [0.86, 0.195, 0.195, 0.19], [0.96, 0.205, 0.205, 0.2], [1, 0.14, 0.14, 0.14]]), cq = [0, 0, 0];
    const clubGeo = K.sweep({ pts: cp, up: V(0, 1, 0), rows: nr(30), nu: nu(18), cap0: 3, cap1: 3,
      prof: (u, o) => { cTab(u, cq); o[0] = cq[0]; o[1] = cq[1]; o[2] = cq[2]; o[3] = 2.4; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.018 * Math.sin(a * 6 + u * 9) * sstep(0.3, 0.6, u) + 0.012 * Math.sin(a * 11 - u * 20) + 0.03 * gs(u, 0.74, 0.04) * ga(a, 1.0, 0.6) + 0.024 * gs(u, 0.88, 0.035) * ga(a, -2.2, 0.55) + 0.02 * gs(u, 0.58, 0.03) * ga(a, 2.4, 0.5) });
    K.skin(clubGeo, [[I.club, 1]]);
    K.paint(clubGeo, (p, n, info) => {
      const u = info ? info.s : 0.5;
      let c = mix(C.bark, C.barkD, clamp01(0.5 + 0.5 * Math.sin((info ? info.a : 0) * 7 + u * 9 + noise(p, 15) * 4)));
      c = mul(c, 0.85 + 0.3 * noise(p, 30));
      c = mix(c, C.moss, 0.55 * sstep(0.55, 0.75, noise(p, 12)) * sstep(0.2, 0.8, n.y) * sstep(0.35, 0.6, u));
      c = mix(c, [0.3, 0.26, 0.2], 0.7 * sstep(0.0, 0.07, 0.07 - u) * 0 + sstep(0.93, 1, u) * 0.5);          // butt / head end cut grey
      c = mix(c, mul(C.barkD, 0.8), sstep(0.03, 0.0, u) * 0.8);
      return c;
    });
    parts.fur.push(clubGeo);
    for (const [u0, ang, len, r] of [[0.7, 1.0, 0.13, 0.034], [0.84, -2.2, 0.15, 0.04], [0.56, 2.4, 0.1, 0.03], [0.93, 0.2, 0.09, 0.036]]) {
      const base = clubGeo.userData.curve.getPointAt(u0);
      const dir = V(Math.sin(ang), Math.cos(ang), 0.35).normalize();
      const stub = K.sweep({ pts: [base.clone().addScaledVector(dir, 0.06), base.clone().addScaledVector(dir, 0.06 + len * 0.55), base.clone().addScaledVector(dir, 0.06 + len).add(V(0, 0.02, 0.0))], up: V(0, 1, 0.2), rows: 6, nu: nu(10), cap0: 1, cap1: 1,
        prof: (u, o) => { o[0] = o[1] = o[2] = lerp(r * 1.3, r * 0.75, u); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(stub, [[I.club, 1]]);
      K.paint(stub, (p, n, info) => { const u = info ? info.s : 0; return mix(mix(C.bark, C.barkD, 0.4), C.wood, sstep(0.9, 1, u) * 0.9); });
      parts.fur.push(stub);
    }

    /* warts: small bumps on the torso / shoulders / back (skinned like the torso) */
    for (let i = 0; i < 34; i++) {
      const s = 0.12 + 0.82 * hash1(i * 3 + 1), a = (hash1(i * 3 + 2) * 2 - 1) * PI;
      if ((s > 0.86 && Math.abs(a) < 2.2) || (lod && i % 3)) continue;
      const { p, n } = torsoPoint(s, a, -0.004), r = 0.012 + 0.024 * hash1(i * 3 + 3);
      const w = new T.SphereGeometry(r, sw, sh2); w.scale(1, 0.7, 1); place(w, p, n);
      K.prim(w, mix(C.wart, C.wartTip, 0.4 * hash1(i + 90))); K.skin(w, torsoW);
      parts.skin.push(w);
    }
    const mv = (v) => V(-v.x, v.y, v.z), ASR = segs([['clavR', mv(aPts[0]), mv(aPts[1])], ['upR', mv(aPts[1]), mv(aPts[2])], ['loR', mv(aPts[2]), mv(aPts[3])], ['handR', mv(aPts[3]), V(-0.92, 0.3, 0.55)]]);
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) for (let i = 0; i < 7; i++) {
      const u = 0.2 + 0.7 * hash1(i * 5 + 7 + (s > 0 ? 0 : 50)), pt = aCurve.getPointAt(u), ang = hash1(i * 5 + 8 + (s > 0 ? 0 : 50)) * TAU, rr = 0.2 * (1 - 0.35 * u);
      if (lod && i % 2) continue;
      const dir = V(Math.sin(ang), 0, Math.cos(ang)), w = new T.SphereGeometry(0.02 + 0.016 * hash1(i + 33), sw, sh2);
      w.scale(1, 0.7, 1); const n = dir.clone(); place(w, V(s * pt.x, pt.y, pt.z).addScaledVector(V(s * dir.x, 0, dir.z), rr * (u < 0.5 ? 1.0 : 0.85)), V(s * n.x, 0, n.z).normalize());
      K.prim(w, mix(C.wart, C.wartTip, 0.4 * hash1(i + 12))); K.skin(w, (p) => K.envelope(s > 0 ? AS : ASR, p, 4));
      parts.skin.push(w); void k;
    }
    for (const [x, y, z, r] of [[0.03, 2.4, 1.04, 0.022], [-0.1, 2.36, 0.98, 0.018], [0.14, 2.33, 0.93, 0.02], [-0.16, 2.52, 0.9, 0.016], [0.0, 2.58, 0.8, 0.02]]) {
      const w = new T.SphereGeometry(r, 7, 5); w.translate(x, y, z); K.prim(w, mix(C.wart, C.wartTip, 0.5), I.head); parts.skin.push(w);
    }

    /* moss mats and lichen tufts on the shoulders, back hump and head top */
    const MOSS = [[0.5, 2.72, 0.22, 0.16, 0.34], [-0.52, 2.7, 0.26, 0.14, 0.32], [0.0, 2.8, 0.08, 0.2, 0.34], [0.28, 2.62, -0.16, 0.13, 0.3], [-0.3, 2.6, -0.14, 0.12, 0.3],
      [0.0, 2.2, -0.34, 0.15, 0.3], [0.2, 1.8, -0.42, 0.1, 0.28], [-0.62, 2.45, 0.12, 0.09, 0.3], [0.65, 2.42, 0.1, 0.08, 0.3]];
    MOSS.forEach(([x, y, z, rad, ht], mi) => {
      const { p, n } = snap(x, y, z, 0.0);
      const g = new T.SphereGeometry(rad, nu(14), nr(7), 0, TAU, 0, PI * 0.55);
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) { const x0 = P.getX(i), y0 = P.getY(i), z0 = P.getZ(i), k = 1 + 0.3 * (noise(V(x0 * 9 + mi * 7, y0 * 9, z0 * 9 + mi), 1) - 0.5) + 0.12 * Math.sin(Math.atan2(z0, x0) * 5 + mi * 3); P.setXYZ(i, x0 * k * 1.3, y0 * ht * k, z0 * k * 1.3); }
      place(g, p.clone().addScaledVector(n, -0.025), n);
      g.userData.extra = null;
      g.computeVertexNormals();
      K.paint(g, (pp) => { const m = noise(pp, 22); return mul(mix(mix(C.moss, C.mossL, m), C.lichen, 0.55 * sstep(0.68, 0.82, noise(pp, 36))), 0.85 + 0.3 * noise(pp, 70)); });
      K.skin(g, torsoW); parts.fur.push(g);
      // a few drooping blades of lichen along the rim
      for (let b = 0; b < (lod ? 2 : 4); b++) {
        const ang = hash1(mi * 11 + b) * TAU, side = V(Math.cos(ang), 0.1, Math.sin(ang)).addScaledVector(n, -n.dot(V(Math.cos(ang), 0.1, Math.sin(ang)))).normalize(), len = 0.07 + 0.08 * hash1(mi * 13 + b);
        const base = p.clone().addScaledVector(side, rad * 0.7).addScaledVector(n, 0.01);
        const bl = K.sweep({ pts: [base, base.clone().addScaledVector(n, len * 0.55).addScaledVector(side, len * 0.25), base.clone().addScaledVector(n, len * 0.7).addScaledVector(side, len * 0.7).add(V(0, -len * 0.35, 0))], up: n, rows: 5, nu: 4, cap0: 0, cap1: 1,
          prof: (u, o) => { o[0] = 0.02 * (1 - 0.8 * u) + 0.003; o[1] = o[2] = 0.004; o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
        K.skin(bl, torsoW); K.paint(bl, (pp, nn, info) => mul(mix(C.mossL, C.moss, info ? info.s : 0.5), 0.9 + 0.2 * hash1(mi + b)));
        parts.fur.push(bl);
      }
    });
    // a tuft of moss on the crown
    for (let b = 0; b < 5; b++) {
      const ang = b * 1.3, base = V(0.02 * Math.cos(ang) , 2.66, 0.66 + 0.04 * Math.sin(ang));
      const bl = K.sweep({ pts: [base, base.clone().add(V(0.04 * Math.cos(ang), 0.07, 0.04 * Math.sin(ang))), base.clone().add(V(0.09 * Math.cos(ang), 0.1, 0.09 * Math.sin(ang)))], up: V(0, 0, 1), rows: 5, nu: 4, cap0: 0, cap1: 1,
        prof: (u, o) => { o[0] = 0.014 * (1 - 0.85 * u) + 0.002; o[1] = o[2] = 0.004; o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(bl, [[I.head, 1]]); K.paint(bl, (pp, nn, info) => mix(C.moss, C.mossL, info ? info.s : 0.5)); parts.fur.push(bl);
    }

    /* rope belt (below the gut) with a knot and hanging ends */
    const belt = band({ yb: () => 1.13, yt: () => 1.25, off: 0.03, inner: 0.004, rows: nr(4), nu: nu(36) });
    K.skin(belt, torsoW);
    K.paint(belt, (p, n, info) => { const t = info ? info.t : 0.5, tw = 0.5 + 0.5 * Math.sin(((info ? info.a : 0) * 26 + t * 14)); return mul(mix(C.rope, C.ropeD, tw * 0.7 + (info && info.rim ? 0.4 : 0)), 0.9 + 0.2 * noise(p, 40)); });
    parts.cloth.push(scaleUV(belt, 3, 0.4));
    const kp = surf(1.19, 0.5, 0.04);
    for (const [dx, dy, dz, len] of [[0.0, 0.0, 0.0, 0.34], [0.045, 0.0, 0.0, 0.26]]) {
      const rp = K.sweep({ pts: [V(kp.x + dx, kp.y - 0.02, kp.z + 0.01 + dz), V(kp.x + dx + 0.02, kp.y - len * 0.5, kp.z + 0.05 + dz), V(kp.x + dx + 0.03, kp.y - len, kp.z + 0.06 + dz)], up: V(0, 0, 1), rows: 7, nu: 7, cap0: 1, cap1: 2,
        prof: (u, o) => { o[0] = o[1] = o[2] = 0.017 * (1 - 0.2 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(rp, (p) => { const w = sstep(1.2, 0.95, p.y); return [[I.pelvis, 1 - w], [I.thL, w * 0.5], [I.thR, w * 0.5]]; });
      K.paint(rp, (p) => mul(C.rope, 0.75 + 0.2 * Math.abs(Math.sin(p.y * 220))));
      parts.cloth.push(scaleUV(rp, 0.4, 0.6));
    }
    const knot = new T.SphereGeometry(0.045, nu(10), nr(8)); knot.scale(1.3, 1, 0.9); knot.translate(kp.x, kp.y, kp.z + 0.005);
    K.prim(knot, C.rope); K.skin(knot, torsoW); parts.cloth.push(knot);

    /* ragged hide loincloth: separate hide strips hanging from the belt (front, back, sides), uneven hems; lower rows follow the thighs */
    const strip = (x0, topY, len, wd, a, seedI) => {
      const top = surf(topY, a, 0.032), sg = Math.cos(a) >= 0 ? 1 : -1;
      const out = V(Math.sin(a), 0, Math.cos(a)).normalize();
      const pts = [top.clone(), top.clone().addScaledVector(out, 0.07).add(V(0, -len * 0.45, 0)), top.clone().addScaledVector(out, 0.11 + 0.03 * hash1(seedI)).add(V(0, -len, 0))];
      const g = K.sweep({ pts, up: V(out.x, 0, out.z), rows: nr(9), nu: nu(8), cap0: 1, cap1: 1,
        prof: (u, o) => { o[0] = wd * (1 - 0.18 * u) * (0.9 + 0.1 * Math.sin(u * 30 + seedI)); o[1] = o[2] = 0.01; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        detail: (u, aa) => 0.004 * Math.sin(Math.sin(aa) * 14 + seedI) * u });
      K.skin(g, (p) => { const w = sstep(1.12, 0.86, p.y), l = p.x >= 0; return [[I.pelvis, 1 - w], [l ? I.thL : I.thR, w]]; });
      K.paint(g, (p, n, info) => { const u = info ? info.s : 0; return mul(mix(C.hide, C.hideD, 0.3 + 0.5 * sstep(0.6, 1, u) + 0.3 * noise(p, 30)), 0.88 + 0.2 * noise(p, 18)); });
      parts.leather.push(scaleUV(g, 0.5, 0.6)); void sg; void x0;
    };
    const fronts = [[-0.32, 0.9], [-0.2, 0.8], [-0.1, 1.0], [0.0, 0.85], [0.1, 0.95], [0.21, 0.78], [0.32, 0.92]];
    fronts.forEach(([ax, lm], i) => strip(0, 1.2, 0.5 * lm, 0.088, ax * 1.6 * 0 + Math.asin(Math.max(-0.99, Math.min(0.99, ax / 0.5))) * 1.0, i + 1));
    [[-0.34, 0.8], [-0.2, 0.95], [-0.05, 0.82], [0.1, 1.0], [0.25, 0.85], [0.37, 0.75]].forEach(([ax, lm], i) => strip(0, 1.2, 0.5 * lm, 0.092, PI - Math.asin(Math.max(-0.99, Math.min(0.99, ax / 0.5))), i + 20));
    for (const s of [-1, 1]) strip(0, 1.2, 0.36, 0.09, s * 1.57, 40 + s);

    /* bone / tooth necklace: a rope over the neck base with big fangs and bones hanging on the chest */
    const nk = [];
    for (let i = 0; i <= 18; i++) {
      const th = -PI + TAU * i / 18, front = Math.max(0, Math.cos(th));
      const x = 0.3 * Math.sin(th) * (1 + 0.25 * front), y = 2.3 - 0.32 * Math.pow(front, 1.4), z = 0.4 + 0.3 * Math.cos(th) + 0.05 * front;
      nk.push(snap(x, y, z, 0.04).p);
    }
    const nkCurve = new T.CatmullRomCurve3(nk, true, 'centripetal');
    const cord = K.sweep({ curve: nkCurve, up: V(0, 1, 0), rows: nr(40), nu: 6, cap0: 0, cap1: 0, closed: true,
      prof: (u, o) => { o[0] = o[1] = o[2] = 0.014; o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
    K.skin(cord, torsoW); K.paint(cord, (p) => mul(C.rope, 0.75 + 0.2 * Math.abs(Math.sin(p.x * 150 + p.y * 120))));
    parts.cloth.push(scaleUV(cord, 1, 0.5));
    const charms = [[0.5, 0.15, 'tooth'], [0.5 - 0.058, 0.1, 'bone'], [0.5 + 0.058, 0.1, 'tooth'], [0.5 - 0.105, 0.075, 'tooth'], [0.5 + 0.105, 0.085, 'bone'], [0.5 - 0.15, 0.06, 'tooth'], [0.5 + 0.15, 0.06, 'tooth']];
    for (const [t, len, kind] of charms) {
      const base = nkCurve.getPointAt(t), tg = nkCurve.getTangentAt(t), side = tg.x >= 0 ? 1 : -1;
      const pts = [base.clone().add(V(0, -0.005, 0.015)), base.clone().add(V(0.004 * side, -len * 0.5, 0.04 + len * 0.1)), base.clone().add(V(0.006 * side, -len, 0.05 + len * 0.18))];
      const ch = K.sweep({ pts, up: V(1, 0, 0), rows: 7, nu: 7, cap0: 2, cap1: kind === 'tooth' ? 3 : 2,
        prof: (u, o) => { const r = kind === 'tooth' ? lerp(0.03, 0.004, Math.pow(u, 0.75)) * (len / 0.1) ** 0.5 : 0.018 * (1 + 0.5 * Math.pow(Math.abs(u * 2 - 1), 2)); o[0] = o[2] = r; o[1] = r * 0.9; o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(ch, [[I.chest, 1]]); K.paint(ch, (p) => mix(kind === 'tooth' ? C.bone : mul(C.bone, 0.9), C.boneD, sstep(0.0, 0.5, base.y - p.y) * 0.5 + 0.12 * noise(p, 70)));
      parts.horn.push(ch);
    }
    return parts;
  }


  /* ---------------- animation ---------------- */
  const ch = (n) => chan[n];
  const add = (P, n, v) => { P[chan[n]] += v; };
  const legs = [
    { key: 'L', type: 'hind', side: 1, chain: ['thL', 'shinL', 'footL', 'toeL'], padH: 0.055, toeLen: 0.3, lift: 0.14, curl: 0.3 },
    { key: 'R', type: 'hind', side: -1, chain: ['thR', 'shinR', 'footR', 'toeR'], padH: 0.055, toeLen: 0.3, lift: 0.14, curl: 0.3 },
  ];
  const gaits = {
    walk: { stride: (v) => 1.0 + 0.25 * v, duty: 0.64, minV: 0.06 },
    run: { stride: (v) => 1.5 + 0.2 * v, duty: 0.4, minV: 0.06, liftK: () => 1.25 },
  };
  const offsets = { L: { walk: 0, run: 0 }, R: { walk: 0.5, run: 0.5 } };
  const select = (v, cur) => (cur === 'run' ? (v < 2.0 ? 'walk' : 'run') : (v > 2.4 ? 'run' : 'walk'));

  // ready stance shared by idle / locomotion: deep crouch, hunched, long arms hanging, club dragging forward
  function stance(P, k) {
    add(P, 'body.py', -0.13 * k); add(P, 'spine.rx', 0.07 * k); add(P, 'chest.rx', 0.02 * k);
    add(P, 'neck.rx', -0.16 * k); add(P, 'head.rx', -0.08 * k);
    add(P, 'upL.rx', 0.02 * k); add(P, 'upL.rz', 0.05 * k); add(P, 'loL.rx', -0.26 * k); add(P, 'handL.rx', -0.14 * k);
    add(P, 'upR.rx', 0.0 * k); add(P, 'upR.rz', -0.02 * k); add(P, 'loR.rx', -0.05 * k); add(P, 'handR.rx', -0.3 * k);
    add(P, 'clavL.rz', 0.04 * k); add(P, 'clavR.rz', -0.04 * k);
  }
  function base(P, ctx, A) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.7) : 0, 5, dt);
    ctx.rw = M.damp(ctx.rw || 0, ctx.gaitName === 'run' ? 1 : 0, 4, dt);
    const mw = ctx.mw, idle = 1 - mw, rw = ctx.rw, ww = mw * (1 - rw), rr = mw * rw, ph = ctx.phase * TAU, k = A.alive();
    const sh = K.stepSpring(A.sp_('sh'), 0, 120, 9, dt) * k;               // foot-fall shock (negative = pushed down)
    stance(P, 1);
    // ---- lumbering walk: bob lowest at the foot fall, heavy weight shift over the stance leg, pelvis yaw + hip drop,
    //      shoulders roll the other way, arms swing like pendulums (club arm barely)
    const mid = ph - TAU * 0.31;
    add(P, 'body.py', ww * (0.026 * Math.cos(2 * mid) - 0.015));
    add(P, 'body.px', ww * 0.06 * Math.cos(mid));
    add(P, 'pelvis.ry', -(ww * 0.13 + rr * 0.2) * Math.cos(ph));
    add(P, 'pelvis.rz', ww * 0.07 * Math.cos(mid));
    add(P, 'spine.ry', (ww * 0.08 + rr * 0.1) * Math.cos(ph));
    add(P, 'chest.ry', (ww * 0.16 + rr * 0.2) * Math.cos(ph));
    add(P, 'chest.rz', -(ww * 0.09 + rr * 0.06) * Math.cos(mid));
    add(P, 'spine.rz', -ww * 0.03 * Math.cos(mid));
    // ---- loping run: deep crouch, big forward lean, long airborne bounds, arms pumping, club carried up in front
    add(P, 'body.py', rr * (-0.12 - 0.05 * Math.cos(2 * (ph - TAU * 0.17))));
    add(P, 'spine.rx', rr * 0.25 + ww * 0.04); add(P, 'chest.rx', rr * 0.08);
    const S = ww * 0.22 + rr * 0.5;
    add(P, 'upL.rx', S * Math.cos(ph)); add(P, 'upR.rx', -S * 0.28 * Math.cos(ph) - rr * 0.35);
    add(P, 'loL.rx', -rr * 0.9 - 0.3 * mw * Math.max(0, -Math.cos(ph))); add(P, 'loR.rx', -rr * 0.9);
    add(P, 'handR.rx', rr * 0.55);
    add(P, 'upL.rz', -rr * 0.1 + ww * 0.03 * Math.cos(ph)); add(P, 'upR.rz', rr * 0.05);
    // bend into turns
    const tr = M.clamp(ctx.turn * 0.05, -0.25, 0.25);
    add(P, 'spine.ry', tr * 0.5); add(P, 'chest.ry', tr * 0.4); add(P, 'neck.ry', tr * 0.8);
    // ---- step shake: the whole mass dips, nods, the arms flop
    add(P, 'body.py', sh * 0.3); add(P, 'chest.rx', -sh * 0.5); add(P, 'neck.rx', sh * 0.5); add(P, 'head.rx', -sh * 0.4);
    add(P, 'upL.rx', -sh * 0.8); add(P, 'upR.rx', -sh * 0.5); add(P, 'jawO', -sh * 1.2);
    // ---- idle: slow weight shifting, heavy breathing, slow brutish head looks (animator state)
    const sway = Math.sin(t * 0.4) * 0.6 + Math.sin(t * 0.17 + 1) * 0.4;
    add(P, 'body.px', idle * 0.04 * sway); add(P, 'pelvis.rz', idle * 0.04 * sway); add(P, 'chest.rz', -idle * 0.035 * sway);
    add(P, 'body.py', idle * 0.01 * Math.sin(t * 1.3));
    add(P, 'chest.rx', idle * 0.03 * Math.sin(t * 1.7)); add(P, 'neck.rx', -idle * 0.02 * Math.sin(t * 1.7 + 0.5));
    add(P, 'upL.rx', idle * 0.03 * Math.sin(t * 0.9)); add(P, 'loL.rx', idle * 0.05 * Math.sin(t * 0.8 + 1));
    const L = A.look;
    add(P, 'neck.ry', L.y * 0.5 * (0.4 + 0.6 * idle)); add(P, 'head.ry', L.y * 0.5 * (0.4 + 0.6 * idle));
    add(P, 'neck.rx', L.p * 0.4 * idle); add(P, 'head.rx', L.p * 0.5 * idle);
    add(P, 'head.rz', L.y * -0.1 * idle);
    // head stabilisation: the neck cancels the trunk pitch so the eyes stay on the target
    const trunk = P[ch('spine.rx')] + P[ch('chest.rx')] - 0.09;
    add(P, 'neck.rx', -trunk * 0.5); add(P, 'head.rx', -trunk * 0.15);
    add(P, 'jawO', 0.05 + 0.03 * Math.sin(t * 1.7) * idle + 0.1 * rr);
    add(P, 'earL.ry', -rr * 0.3); add(P, 'earR.ry', rr * 0.3);
  }
  // heel-toe roll: heel lifts through late stance, toe pushes off, the foot dorsiflexes before landing
  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0, r = Lg.restDistal;
    if (f.planted) return r - 0.7 * sstep(0.6, 1, f.stanceU) * mw;
    const u = f.swingU;
    return r - 0.7 * (1 - sstep(0.0, 0.5, u)) + 0.2 * sstep(0.45, 0.75, u) * sstep(1.0, 0.85, u);
  }
  function post(P, ctx, A) {
    const B = A.B, k = A.alive();
    B[I.ribs].scale.setScalar(1 + 0.035 * k * Math.sin(ctx.t * (ctx.moving ? 5 : 1.7)));
    B[I.jaw].rotateX(Math.max(0, P[ch('jawO')]) * 0.5);
  }
  function secondary(ctx, A) {
    const dt = ctx.dt, B = A.B, lk = A.look, k = A.alive();                 // corpses stay still
    if (k <= 0) return;
    const sh = A.sp_('sh').x;
    // belly: wobbles with every foot fall and the weight shift
    const bel = K.stepSpring(A.sp_('bel'), -sh * 1.1 + Math.sin(ctx.t * 1.7) * 0.01, 150, 5, dt);
    B[I.belly].rotateX(bel * k);
    // ears flop behind the head turns and the bob
    const by = (B[I.body].position.y - tpl.local[I.body].y) * -8;
    const ex = K.stepSpring(A.sp_('ex'), by + lk.vy * 0.03, 130, 8, dt), ey = K.stepSpring(A.sp_('ey'), -lk.vy * 0.05, 110, 8, dt);
    B[I.earL].rotateX(ex * 0.5 * k); B[I.earR].rotateX(ex * 0.5 * k); B[I.earL].rotateY(ey * 0.5 * k); B[I.earR].rotateY(ey * 0.5 * k);
    // the club lags behind the fist a little (heavy end)
    const cl = K.stepSpring(A.sp_('club'), -sh * 1.6 + (ctx.moving ? 0.03 * Math.sin(ctx.phase * TAU * 2) : 0), 70, 7, dt);
    B[I.club].rotateX(cl * k);
  }
  function flinch(P, t, dir, pow) {                                          // it is heavy: a small, quickly decaying jolt
    const k = Math.exp(-t * 9) * Math.sin(Math.min(1, t * 16) * PI * 0.5) * Math.min(1.3, pow);
    add(P, 'body.px', dir[0] * 0.04 * k); add(P, 'body.pz', dir[1] * 0.04 * k); add(P, 'body.py', -0.015 * k);
    add(P, 'spine.rx', -0.1 * k); add(P, 'chest.rx', -0.08 * k); add(P, 'spine.rz', -dir[0] * 0.1 * k);
    add(P, 'neck.rx', -0.2 * k); add(P, 'head.rx', -0.15 * k); add(P, 'jawO', 0.35 * k);
    add(P, 'upL.rx', -0.15 * k);
  }

  /* attacks keyed on the gameplay timeline (s, an, wu, hit, fo, e) */
  // [s, an, wu, hit, fo, e] arrays -> explicit keys with a short plateau after the strike (no Hermite overshoot through the ground)
  const plateau = (ph, chans) => { const o = {}; for (const n in chans) { const v = chans[n]; o[n] = { k: [[ph.s, v[0]], [ph.an, v[1]], [ph.wu, v[2]], [ph.hit, v[3]], [ph.hit + 0.025, v[3]], [ph.fo, v[4]], [ph.e, v[5]]] }; } return o; };
  const smashA = D.attacks.smash, backA = D.attacks.backhand;
  const actions = {
    // SMASH: rear back with a roar, club over the shoulder (long anticipation), hold, then a heavy overhand slam into the ground
    smash: {
      kind: 'attack', dur: smashA.dur, blendIn: 0.15, blendOut: 0.35,
      track: K.track(chan, smashA.phases, plateau(smashA.phases, {
        'body.py': [0, -0.12, -0.15, -0.06, -0.06, 0], 'body.pz': [0, -0.14, -0.2, -0.15, -0.1, 0],
        'spine.rx': [0, -0.33, -0.38, 0.17, 0.2, 0], 'chest.rx': [0, -0.1, -0.14, 0.04, 0.1, 0], 'chest.ry': [0, -0.25, -0.4, 0.2, 0.2, 0], 'spine.ry': [0, -0.12, -0.2, 0.1, 0.1, 0],
        'neck.rx': [0, -0.5, -0.6, 0.1, 0.12, 0], 'head.rx': [0, -0.25, -0.4, 0.2, 0.2, 0],
        'jawO': [0, 0.8, 1.0, 0.3, 0.2, 0], 'earL.rx': [0, -0.3, -0.5, 0.3, 0.2, 0], 'earR.rx': [0, -0.3, -0.5, 0.3, 0.2, 0],
        'upR.rx': [0, -1.5, -1.6, -0.85, -0.85, 0], 'loR.rx': [0, -1.6, -1.7, 0.1, 0.1, 0], 'handR.rx': [0, 1.05, 1.1, 0.7, 0.7, 0], 'upR.rz': [0, 0.0, 0.0, 0.12, 0.12, 0], 'upR.ry': [0, 0.0, 0.0, 0.0, 0.0, 0],
        'upL.rx': [0, -0.3, -0.4, 0.45, 0.4, 0], 'upL.rz': [0, 1.0, 1.15, 0.5, 0.45, 0], 'loL.rx': [0, -0.5, -0.6, -0.15, -0.15, 0],
      })),
    },
    // BACKHAND: club drawn across the body to the left, torso wound up, then a wide fast horizontal sweep to the right
    backhand: {
      kind: 'attack', dur: backA.dur, blendIn: 0.1, blendOut: 0.3,
      track: K.track(chan, backA.phases, {
        'body.py': [0, -0.03, -0.05, -0.04, -0.04, 0], 'body.pz': [0, -0.05, -0.08, 0.04, 0.04, 0],
        'chest.ry': [0, 0.3, 0.5, -0.5, -0.8, 0], 'spine.ry': [0, 0.18, 0.3, -0.3, -0.48, 0], 'pelvis.ry': [0, 0.1, 0.17, -0.17, -0.28, 0],
        'spine.rx': [0, 0.0, -0.05, 0.03, 0.03, 0], 'chest.rz': [0, 0, 0.04, -0.06, -0.06, 0],
        'upR.rx': [0, -0.4, -0.45, -0.7, -0.5, 0], 'upR.rz': [0, 0.7, 0.75, 0.65, 0.3, 0], 'upR.ry': [0, 0.4, 0.6, 0.5, -0.3, 0],
        'loR.rx': [0, -0.2, -0.3, -0.3, -0.3, 0], 'handR.rx': [0, 0.4, 0.6, 1.1, 0.8, 0],
        'upL.rx': [0, 0.1, 0.25, -0.4, -0.5, 0], 'upL.rz': [0, 0.3, 0.5, 0.8, 0.9, 0], 'loL.rx': [0, -0.2, -0.3, -0.4, -0.4, 0],
        'neck.ry': [0, -0.2, -0.35, 0.25, 0.45, 0], 'head.ry': [0, -0.1, -0.15, 0.1, 0.2, 0], 'jawO': [0, 0.3, 0.6, 0.7, 0.4, 0],
      }),
    },
    // STAGGER: heavy rocking back on its heels, club arm swinging out
    stagger: {
      kind: 'stagger', dur: 1.3, blendIn: 0.08, blendOut: 0.35,
      track: (P, u, w) => {
        const k = Math.sin(PI * Math.min(1, u * 1.1)) * w, wob = Math.sin(u * 16) * sstep(0, 0.2, u) * sstep(0.85, 0.4, u) * w;
        add(P, 'body.pz', -0.16 * k); add(P, 'body.py', -0.08 * k); add(P, 'spine.rx', -0.4 * k); add(P, 'chest.rx', -0.25 * k);
        add(P, 'spine.rz', 0.14 * wob); add(P, 'neck.rx', -0.3 * k); add(P, 'head.rz', 0.22 * wob); add(P, 'jawO', 0.8 * k);
        add(P, 'upL.rx', -0.9 * k); add(P, 'upL.rz', 0.7 * k); add(P, 'loL.rx', -0.5 * k); add(P, 'upR.rz', -0.7 * k); add(P, 'upR.rx', -0.5 * k);
      },
    },
    // DEATH: a roaring recoil, the knees buckle, the club slips from the fist, it topples onto its side and goes limp
    death: {
      kind: 'death', dur: 2.6, blendIn: 0.08, hold: true,
      track: (P, u, w, layer, ctx, A) => {
        const side = (layer.data && layer.data.side) || 1;
        stance(P, (1 - A.alive()) * w);
        const rec = sstep(0, 0.08, u) * sstep(0.3, 0.14, u), kn = M.ease.io(sstep(0.08, 0.5, u)), fall = M.ease.io(sstep(0.46, 0.8, u)), lim = sstep(0.75, 1, u);
        add(P, 'spine.rx', (-0.35 * rec + 0.5 * kn - 0.35 * fall) * w); add(P, 'chest.rx', (-0.3 * rec + 0.2 * kn) * w);
        add(P, 'neck.rx', (-0.5 * rec + 0.3 * kn) * w); add(P, 'head.rx', (0.2 * kn - 0.2 * fall) * w);
        add(P, 'body.py', (-0.6 * kn - 0.2 * fall) * w); add(P, 'body.pz', (-0.1 * rec + 0.15 * kn) * w);
        add(P, 'body.rz', side * 1.4 * fall * w); add(P, 'body.rx', 0.35 * fall * w);
        const ik = sstep(0.05, 0.2, u) * w;
        add(P, 'ikL', -ik); add(P, 'ikR', -ik);
        for (const [k, s] of [['L', 1], ['R', -1]]) {
          const low = (s === -1) === (side === 1);                                  // the limb that ends up underneath
          add(P, 'th' + k + '.rx', (-0.5 * kn - (low ? 0.2 : 0.7) * fall) * w); add(P, 'shin' + k + '.rx', (1.6 * kn - (low ? 0.8 : 0.5) * fall) * w); add(P, 'foot' + k + '.rx', (0.5 * kn - 0.3 * fall) * w);
          add(P, 'th' + k + '.rz', s * 0.12 * kn * w);
          add(P, 'up' + k + '.rx', (0.2 * kn - (low ? 0.9 : 0.5) * fall) * w); add(P, 'up' + k + '.rz', (s * -0.2 * kn - s * (low ? 0.3 : 0.8) * fall) * w);
          add(P, 'lo' + k + '.rx', (0.2 * kn + (low ? -0.2 : 0.4) * fall + 0.3 * lim) * w); add(P, 'hand' + k + '.rx', (0.3 * kn + 0.2 * fall) * w);
          add(P, 'ear' + k + '.rx', -0.5 * kn * w);
        }
        add(P, 'neck.rz', -side * 0.3 * fall * w); add(P, 'jawO', (0.5 * kn + 0.2 * lim) * w);
      },
    },
    scratch: {
      kind: 'special', dur: 3.0, blendIn: 0.35, blendOut: 0.45,
      track: (P, u, w) => {
        const env = sstep(0, 0.14, u) * sstep(1, 0.86, u) * w, sc = Math.sin(u * TAU * 7), look = Math.sin(u * TAU * 1.2);
        add(P, 'upL.rx', -1.46 * env); add(P, 'upL.ry', (-1.5 + 0.1 * sc) * env); add(P, 'upL.rz', -0.5 * env); add(P, 'loL.rx', (-1.64 - 0.14 * sc) * env); add(P, 'handL.rx', 0.25 * sc * env);
        add(P, 'neck.rx', 0.1 * env); add(P, 'head.rz', (0.15 + 0.03 * sc) * env); add(P, 'head.ry', 0.2 * look * env);
        add(P, 'spine.rx', -0.05 * env); add(P, 'jawO', 0.15 * env);
      },
    },
    chew: {
      kind: 'special', dur: 3.2, blendIn: 0.3, blendOut: 0.4,
      track: (P, u, w) => {
        const env = sstep(0, 0.1, u) * sstep(1, 0.88, u) * w, chewing = sstep(0.62, 0.55, u), spit = Math.sin(PI * M.clamp01((u - 0.66) / 0.14)) * w;
        add(P, 'jawO', (0.28 + 0.28 * Math.sin(u * TAU * 9)) * chewing * env + 1.0 * spit);
        add(P, 'head.rz', 0.06 * Math.sin(u * TAU * 4.5) * chewing * env); add(P, 'neck.rx', 0.1 * env * chewing);
        add(P, 'head.rx', 0.28 * spit); add(P, 'neck.rx', 0.35 * spit); add(P, 'spine.rx', 0.12 * spit);
        add(P, 'body.pz', 0.04 * spit); add(P, 'chest.rx', -0.05 * env * chewing);
      },
    },
    beat: {
      kind: 'special', dur: 3.0, blendIn: 0.3, blendOut: 0.45,
      track: (P, u, w) => {
        const env = sstep(0, 0.12, u) * sstep(1, 0.88, u) * w, hit = Math.pow(Math.max(0, Math.sin(u * TAU * 4.5)), 2);
        add(P, 'spine.rx', -0.28 * env); add(P, 'chest.rx', (-0.22 + 0.1 * hit) * env); add(P, 'neck.rx', (-0.45 + 0.1 * hit) * env); add(P, 'head.rx', -0.25 * env); add(P, 'body.py', 0.05 * env);
        add(P, 'jawO', (0.85 + 0.15 * hit) * env);
        add(P, 'upL.rx', (0.14 - 0.12 * hit) * env); add(P, 'upL.rz', -0.79 * env); add(P, 'upL.ry', (-0.34 - 0.12 * hit) * env); add(P, 'loL.rx', (-1.05 - 0.28 * hit) * env); add(P, 'handL.rx', 0.1 * env);
        add(P, 'upR.rx', -0.9 * env); add(P, 'loR.rx', -0.5 * env); add(P, 'handR.rx', 0.3 * env); add(P, 'upR.rz', -0.3 * env);
        add(P, 'chest.rz', 0.04 * Math.sin(u * TAU * 4.5) * env);
      },
    },
  };

  /* the club: parented to the right hand; once the troll dies it slips from the fist, falls, bounces and rolls away
     (simple rigid-body integration on the club bone, in the `ground` hook after the pose is solved) */
  const CLUB = { r: [[0, 0.085], [0.3, 0.07], [0.55, 0.1], [0.8, 0.18], [1, 0.2]], len: 1.68, release: 0.55 };
  const clubR = (s) => { for (let i = 1; i < CLUB.r.length; i++) if (s <= CLUB.r[i][0]) { const a = CLUB.r[i - 1], b = CLUB.r[i], t = (s - a[0]) / (b[0] - a[0]); return lerp(a[1], b[1], t); } return 0.2; };
  const _cm = new T.Matrix4(), _cp = new T.Matrix4(), _cq3 = new T.Quaternion(), _cq = new T.Quaternion(), _cq2 = new T.Quaternion(), _ce = new T.Euler(), _cv = new T.Vector3(), _cd = new T.Vector3(), _cs = new T.Vector3(1, 1, 1);
  const _ax = new T.Vector3(0, 0, 1);
  // lowest point of the club (tapered rod; the bone origin sits at the fist, 0.36 m from the butt) in world y
  function clubMinY(pos, q, sc) {
    _cd.set(0, 0, 1).applyQuaternion(q);
    let m = 1e9;
    for (let i = 0; i <= 12; i++) { const s = i / 12, y = pos.y + _cd.y * (-0.36 + s * CLUB.len) * sc, r = (clubR(s) + 0.03) * sc * Math.sqrt(Math.max(0, 1 - _cd.y * _cd.y)); m = Math.min(m, y - r); }
    return m;
  }
  function clubPhysics(ctx, A) {
    const B = A.B, club = B[I.club], dead = A.v.sm.dead;
    if (!dead) {
      if (A.clubS) { A.clubS = null; club.position.copy(tpl.local[I.club]); club.quaternion.identity(); }
      return;
    }
    const cur = A.v.sm.cur, T0 = cur ? cur.t : 99, dt = Math.min(ctx.dt || 0.016, 0.1), root = A.v.root, sc = root.scale.x;
    let S = A.clubS;
    if (!S) {
      if (T0 < CLUB.release) return;                                          // still in the fist
      club.updateMatrixWorld(true);
      S = A.clubS = { p: new T.Vector3(), q: new T.Quaternion(), v: new T.Vector3(), roll: 0, rv: 0, t: 0, air: true, bounced: false, q0: new T.Quaternion(), yaw: 0 };
      club.matrixWorld.decompose(S.p, S.q, _cv);
      S.q0.copy(S.q);
      const side = (cur && cur.data && cur.data.side) || 1;
      root.getWorldQuaternion(_cq); _cd.set(0, 0, 1).applyQuaternion(_cq);
      S.yaw = Math.atan2(_cd.x, _cd.z) + side * 0.7 + 0.2;
      S.v.set(Math.sin(S.yaw) * 0.5 - side * Math.cos(S.yaw) * 0.5, 0.3, Math.cos(S.yaw) * 0.5 + side * Math.sin(S.yaw) * 0.5).multiplyScalar(sc);
      S.rv = -side * 4.5;
    }
    // rest orientation: lying on the ground, axis along `yaw`, tilted up by the taper, then rolling about its own axis
    const tilt = Math.asin((0.2 - 0.085) / CLUB.len), steps = Math.max(1, Math.ceil(dt / 0.01)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      S.t += h;
      const ka = M.clamp01(S.t / 0.5), ease = ka * ka * (3 - 2 * ka);
      _ce.set(-tilt, S.yaw, 0, 'YXZ'); _cq2.setFromEuler(_ce);
      _cq.copy(_cq2).multiply(_cq3.setFromAxisAngle(_ax, S.roll));
      S.q.copy(S.q0).slerp(_cq, ease);
      if (S.air) {
        S.v.y -= 9.8 * sc * 0.8 * h; S.p.addScaledVector(S.v, h);
        const m = clubMinY(S.p, S.q, sc);
        if (m < 0) {
          S.p.y -= m;
          if (!S.bounced) { S.bounced = true; S.v.y = -S.v.y * 0.28; S.v.x *= 0.6; S.v.z *= 0.6; } else { S.air = false; S.v.y = 0; }
        }
      } else {
        S.rv *= Math.exp(-2.4 * h); S.roll += S.rv * h;                         // rolling along the ground, decaying; travel is perpendicular to the axis
        S.p.x += Math.cos(S.yaw) * S.rv * h * 0.17 * sc; S.p.z -= Math.sin(S.yaw) * S.rv * h * 0.17 * sc;
        S.v.multiplyScalar(Math.exp(-4 * h)); S.p.x += S.v.x * h; S.p.z += S.v.z * h;
        if (Math.abs(S.rv) < 0.02) S.rv = 0;
        S.p.y -= clubMinY(S.p, S.q, sc);                                        // stay exactly on the ground while it rolls / settles
      }
    }
    // world pose -> bone-local pose under its parent (the right hand)
    _cm.compose(S.p, S.q, _cs);
    _cp.copy(club.parent.matrixWorld).invert();
    _cm.premultiply(_cp);
    _cm.decompose(club.position, club.quaternion, _cv);
    club.updateMatrixWorld(true);
  }

  /* BipedAnimator: the shared foot-planting / IK animator with two plantigrade legs, plus a troll's slow nervous system
     (lazy head looks, foot-fall shock). */
  class TrollAnimator extends K.QuadAnimator {
    constructor(view, opts) {
      super(view, opts);
      this.look = { y: 0, p: 0, ty: 0, tp: 0, t: 1 + Math.random() * 2, vy: 0 };
      this.clubS = null;
      this.gait.onPlant = (f) => this.plant(f);
    }
    alive() { return this.v.sm.dead ? Math.max(0, 1 - (this.deadT || 0) / 0.35) : 1; }
    plant(f) {                                                                // heavy foot fall: kick the shock spring (more at speed)
      if (this.v.sm.dead) return;
      const sp = this.v.speedSm / this.v.scale, k = f.idleStep ? 0.3 : 0.55 + 0.45 * Math.min(1, sp / 3.5);
      this.sp_('sh').v -= 1.15 * k;
    }
    reset() { super.reset(); this.clubS = null; const c = this.B[I.club]; c.position.copy(tpl.local[I.club]); c.quaternion.identity(); }
    update(dt, quality) {
      const L = this.look;
      if (this.v.sm.dead) { L.ty = L.y; L.tp = L.p; L.t = 99; }
      L.t -= dt;
      if (L.t <= 0) { L.ty = (Math.random() - 0.5) * 1.1; L.tp = (Math.random() - 0.5) * 0.3; L.t = 1.5 + Math.random() * 3.5; }
      const py = L.y;
      L.y = M.damp(L.y, L.ty, 3.5, dt); L.p = M.damp(L.p, L.tp, 3, dt);
      L.vy = (L.y - py) / Math.max(dt, 1e-4);
      super.update(dt, quality);
    }
  }

  K.defineSpecies('troll', {
    rig: tpl, chan, build, lowQ: 0.4, animator: TrollAnimator, debugScale: 2,
    anim: { legs, gaits, offsets, select, base, distal, post, secondary, ground: clubPhysics, flinch, actions, gaitOpts: { restTol: 0.1, idleStepDur: 0.34 }, groundFix: true },
    clips: ['idle', 'walk', 'run', 'smash', 'backhand', 'scratch', 'chew', 'beat', 'hit', 'stagger', 'death'],
    attackAction: { smash: 'smash', backhand: 'backhand' }, specials: ['scratch', 'chew', 'beat'],
    def: D,
  });
})();
