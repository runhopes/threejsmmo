/* Brown Bear - Kahverengi Ayı (levels 11-13): massive PLANTIGRADE quadruped.
 * Anatomy (bear units, metres at scale 1; the game scale 1.6 makes the hump ~1.47 m): rolling muscular shoulder hump over
 * the withers, deep chest, back sloping down to a lower rump, very broad thick neck, small round-eared head with a dished
 * profile and a long straight muzzle, small eyes, thick pillar legs on flat paws (the whole sole is down, the heel touches
 * first) with long pale claws, stub tail. Shaggy coat: noisy surface, layered fur cards (tufts) over the hump / neck ruff /
 * flanks / belly skirt / cheeks, grizzled golden tips, darker "stockings", paler muzzle.
 * Locomotion: lumbering lateral-sequence walk (rolling shoulders, swaying head) and a heavy bounding gallop.
 * Attacks: maul (half-rear, right paw overhead-to-ground swat), slam (full rear, both paws crash down; heavy).
 * Specials: roar (stands up on the hind legs), sniff, scratch. Stagger, hit flinch, death (kneels, rolls onto its side). */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const hash01 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  /* ---------------- gameplay def (authored at scale 1; CREATURE_DEFS.addSpecies applies the game scale once) ---------------- */
  const A = (dur, an, wu, hit, fo, active, o) => Object.assign({ dur, phases: { s: 0, an, wu, hit, fo, e: 1 }, active }, o);
  if (!CREATURE_DEFS.SPECIES.bear) {
    CREATURE_DEFS.addSpecies('bear', {
      scale: 1.7,
      name: 'Kahverengi Ayı', en: 'Brown Bear', levels: [11, 13], hp: 3200, hpLv: 340, exp: 2600, expLv: 300,
      radius: 0.52, front: 1.02, height: 0.95, mass: 2.4, poise: 0.7,
      speed: { walk: 1.1, run: 4.2 }, turn: 4,
      behavior: { type: 'charger', aggro: 7, assist: 0, leash: 20, roam: 4, pause: [2, 5], dash: [1.5, 3.5] },
      attacks: {
        maul: A(1.25, 0.24, 0.42, 0.5, 0.74, [0.5, 0.61], { reach: 1.0, cosArc: 0.2, dmg: [260, 320], dmgLv: 32, cd: 1.8, use: [0, 0.9], lunge: 0.3 }),
        slam: A(1.75, 0.3, 0.55, 0.6, 0.8, [0.6, 0.7], { reach: 0.8, cosArc: -0.1, dmg: [380, 440], dmgLv: 45, cd: 4, use: [0, 0.7], lunge: 0.38, heavy: true }),
      },
      corpse: 13, respawn: [26, 36],
      loot: [{ id: 'bear_claw', name: 'Ayı Pençesi', p: 0.3 }],
    });
  }
  const D = CREATURE_DEFS.SPECIES.bear;

  /* ---------------- skeleton (world bind positions, bear units) ---------------- */
  const BODY_Y = 0.64;
  const bones = [
    ['body', null, 0, BODY_Y, 0],
    ['ribs', 'body', 0, 0.56, 0.12],
    ['pelvis', 'body', 0, 0.62, -0.38],
    ['tail0', 'pelvis', 0, 0.66, -0.6, 'tail1'], ['tail1', 'tail0', 0, 0.63, -0.66],
    ['chest', 'body', 0, 0.66, 0.28],
    ['neck', 'chest', 0, 0.74, 0.46, 'head'],
    ['head', 'neck', 0, 0.72, 0.66],
    ['jaw', 'head', 0, 0.62, 0.77],
    ['earL', 'head', 0.115, 0.85, 0.7], ['earR', 'head', -0.115, 0.85, 0.7],
  ];
  for (const [s, f] of [['L', 1], ['R', -1]]) {
    bones.push(
      ['scap' + s, 'chest', f * 0.13, 0.76, 0.3, 'hum' + s],
      ['hum' + s, 'scap' + s, f * 0.18, 0.62, 0.33, 'for' + s],
      ['for' + s, 'hum' + s, f * 0.19, 0.34, 0.19, 'mc' + s],                 // elbow tucked back: reach slack for the IK
      ['mc' + s, 'for' + s, f * 0.175, 0.1, 0.355, 'fpaw' + s],              // wrist / carpal pad
      ['fpaw' + s, 'mc' + s, f * 0.175, 0.035, 0.5],                          // ball of the paw
      ['th' + s, 'pelvis', f * 0.17, 0.62, -0.42, 'shin' + s],
      ['shin' + s, 'th' + s, f * 0.2, 0.38, -0.2, 'met' + s],
      ['met' + s, 'shin' + s, f * 0.185, 0.115, -0.38, 'hpaw' + s],           // hock / heel
      ['hpaw' + s, 'met' + s, f * 0.18, 0.035, -0.19],
    );
  }
  const ends = {
    tail1: [0, 0.6, -0.71], head: [0, 0.61, 1.07], jaw: [0, 0.52, 0.96], earL: [0.14, 0.9, 0.7], earR: [-0.14, 0.9, 0.7],
    fpawL: [0.175, 0.015, 0.59], fpawR: [-0.175, 0.015, 0.59], hpawL: [0.18, 0.015, -0.1], hpawR: [-0.18, 0.015, -0.1],
    body: [0, 0.66, 0.28], pelvis: [0, 0.66, -0.6], chest: [0, 0.74, 0.46], ribs: [0, 0.56, 0.3],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikFL', 'ikFR', 'ikHL', 'ikHR', 'nose']);
  const ch = (n) => chan[n];

  /* ---------------- palette (display-space vertex colours; upward faces render ~2.2x brighter) ---------------- */
  const C = {
    back: [0.2, 0.128, 0.072], side: [0.27, 0.172, 0.098], belly: [0.3, 0.2, 0.118], gold: [0.38, 0.262, 0.135], dark: [0.1, 0.064, 0.04],
    leg: [0.085, 0.056, 0.037], pad: [0.04, 0.034, 0.032], claw: [0.56, 0.5, 0.39], clawTip: [0.3, 0.26, 0.2],
    muzzle: [0.34, 0.235, 0.145], cheek: [0.31, 0.205, 0.12], nose: [0.03, 0.027, 0.027], lip: [0.05, 0.04, 0.038], mouth: [0.2, 0.06, 0.06],
    tongue: [0.34, 0.1, 0.1], tooth: [0.62, 0.58, 0.48], earIn: [0.13, 0.085, 0.06], eye: [0.04, 0.025, 0.014],
  };
  const grizzle = (p) => 0.8 + 0.28 * vnoise3(p.x * 30, p.y * 30, p.z * 9) + 0.12 * (vnoise3(p.x * 95, p.y * 95, p.z * 30) - 0.5);
  function fur(p, n) {
    const up = n.y, dors = sstep(0.2, 0.95, up), ven = sstep(-0.1, -0.8, up);
    let c = mix(C.side, C.back, dors);
    c = mix(c, C.belly, ven * 0.7);
    // paler, golden-grizzled hump and neck ruff, darker rump and spine line
    const hump = gs(p.z, 0.32, 0.2) * sstep(0.66, 0.9, p.y) + 0.55 * gs(p.z, 0.52, 0.12) * sstep(0.6, 0.8, p.y);
    c = mix(c, C.gold, 0.5 * hump * (0.5 + 0.8 * vnoise3(p.x * 20, p.y * 20, p.z * 12)));
    c = mix(c, C.dark, 0.5 * sstep(-0.1, -0.5, p.z) * dors);
    return mul(c, grizzle(p));
  }
  const legCol = (p, n, high) => mix(fur(p, n), mul(C.leg, 0.85 + 0.3 * vnoise3(p.x * 30, p.y * 30, p.z * 12)), sstep(high, high - 0.22, p.y));

  /* ---------------- geometry ---------------- */
  const SPINE = [
    ['pelvis', V(0, 0.6, -0.6), V(0, 0.63, -0.2)], ['body', V(0, 0.63, -0.2), V(0, 0.66, 0.14)],
    ['chest', V(0, 0.66, 0.14), V(0, 0.72, 0.46)], ['neck', V(0, 0.72, 0.46), V(0, 0.73, 0.64)], ['head', V(0, 0.73, 0.64), V(0, 0.7, 0.8)],
  ].map((s) => [I[s[0]], s[1], s[2]]);
  const SCAPC = { L: V(0.13, 0.76, 0.3), R: V(-0.13, 0.76, 0.3) };
  function bodyWeights(p) {
    const sd = p.x >= 0 ? 'L' : 'R', ax = Math.abs(p.x);
    const wl = sstep(-0.1, 0.1, p.x);                                    // the hump splits between both scapulae (centre line barely moves)
    const sc = gs(p.distanceTo(V(0, 0.76, 0.3)), 0, 0.26) * 0.62;
    return K.envelope(SPINE, p, 4, [
      [I['th' + sd], 0.55 * gs(p.distanceTo(W('th' + sd)), 0, 0.16) * sstep(0.02, 0.1, ax)],
      [I.scapL, sc * wl], [I.scapR, sc * (1 - wl)],
      [I.ribs, 0.5 * gs(p.z, 0.04, 0.2) * sstep(0.56, 0.4, p.y)],
    ]);
  }
  function surfacePoint(f, O, D0, rmax) {
    let r = rmax;
    for (let i = 0; i < 90; i++) { const d = f(O.x + D0.x * r, O.y + D0.y * r, O.z + D0.z * r); if (d < 0.0008) break; r -= Math.max(0.003, d * 0.85); if (r < 0.01) return null; }
    return V(O.x + D0.x * r, O.y + D0.y * r, O.z + D0.z * r);
  }
  const gradN = (f, p) => { const e = 0.004; return V(f(p.x + e, p.y, p.z) - f(p.x - e, p.y, p.z), f(p.x, p.y + e, p.z) - f(p.x, p.y - e, p.z), f(p.x, p.y, p.z + e) - f(p.x, p.y, p.z - e)).normalize(); };

  function build(q) {
    const parts = { fur: [], horn: [], gloss: [], skin: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    /* ---- body: SDF masses projected along the spine ---- */
    const bodyBase = K.sdf([
      { e: [0, 0.52, -0.36], r: [0.2, 0.19, 0.24] },                                         // rump / haunches
      { e: [0, 0.53, -0.04], r: [0.235, 0.225, 0.28], k: 0.14 },                              // barrel
      { e: [0, 0.57, 0.27], r: [0.24, 0.26, 0.27], k: 0.12 },                                // deep chest
      { e: [0, 0.76, 0.3], r: [0.17, 0.2, 0.26], k: 0.14 },                                // shoulder hump
      { e: [0, 0.63, -0.1], r: [0.15, 0.09, 0.26], k: 0.1 },                                  // loin, back line sloping to the rump
      { e: [0.175, 0.58, 0.3], r: [0.1, 0.21, 0.2], k: 0.1 },                                // shoulder muscles
      { e: [-0.175, 0.58, 0.3], r: [0.1, 0.21, 0.2], k: 0.1 },
      { e: [0.175, 0.52, -0.38], r: [0.1, 0.2, 0.18], rot: [0.25, 0, 0], k: 0.1 },          // hams
      { e: [-0.175, 0.52, -0.38], r: [0.1, 0.2, 0.18], rot: [0.25, 0, 0], k: 0.1 },
      { c: [0, 0.71, 0.4, 0, 0.72, 0.63], ra: 0.21, rb: 0.175, k: 0.12 },                    // broad thick neck
      { e: [0, 0.46, 0.46], r: [0.15, 0.15, 0.17], k: 0.1 },                                 // brisket / throat
    ]);
    // shaggy relief: low-frequency clumps over the whole coat
    const bodySDF = (x, y, z) => bodyBase(x, y, z) - 0.011 * (vnoise3(x * 15, y * 13, z * 11) - 0.4);
    const spine = new T.CatmullRomCurve3([V(0, 0.6, -0.52), V(0, 0.63, -0.38), V(0, 0.65, -0.12), V(0, 0.66, 0.12), V(0, 0.69, 0.3), V(0, 0.72, 0.46), V(0, 0.73, 0.62)], false, 'centripetal');
    const body = K.projectSDF({ sdf: bodySDF, curve: spine, rows: nr(56), nu: nu(36), cap0: 0.14, cap1: 0.1, rmax: 0.7 });
    K.skin(body, bodyWeights);
    K.paint(body, fur);
    parts.fur.push(body);

    /* ---- fur cards: tapered flat blades lying along the flow of the coat ---- */
    const snap = (f, p, off) => { for (let i = 0; i < 4; i++) { const d = f(p.x, p.y, p.z); if (Math.abs(d) < 0.0005) break; p.addScaledVector(gradN(f, p), -d); } return p.addScaledVector(gradN(f, p), off); };
    const tuft = (sdfF, O, Dir, L, Wd, bone, wFn) => {
      const P = surfacePoint(sdfF, O, Dir, 0.8); if (!P) return;
      const n = gradN(sdfF, P);
      const flow = V(0, -0.3, -1); flow.addScaledVector(n, -flow.dot(n)).normalize();
      const down = V(0, -1, 0);
      const pts = [P.clone().addScaledVector(n, -0.014), snap(sdfF, P.clone().addScaledVector(flow, L * 0.5), 0.003), snap(sdfF, P.clone().addScaledVector(flow, L), 0.011).addScaledVector(down, L * 0.05)];
      const g = K.sweep({ pts, up: n.clone(), prof: (u, o) => { o[0] = Wd * (1 - Math.pow(u, 1.5)) + 0.0015; o[1] = o[2] = 0.004 * (1 - 0.3 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 3, nu: 4, cap0: 0, cap1: 1 });
      { const N = g.attributes.normal; for (let i = 0; i < N.count; i++) N.setXYZ(i, n.x, n.y, n.z); }   // shade like the coat underneath: locks read as colour streaks, not cones
      if (wFn) K.skin(g, wFn); else K.skin(g, [[bone, 1]]);
      const base = fur(P, n), jit = 0.88 + 0.28 * hash01(P.x * 91 + P.y * 37 + P.z * 53);
      K.paint(g, (p, nn, info) => { const s = info ? info.s : 0; return mul(mix(base, C.gold, 0.25 * sstep(0.4, 1, s)), jit * (0.8 + 0.3 * s)); });
      parts.fur.push(g);
    };
    {
      const ax = (z) => { const c = spine.getPointAt(clamp01((z + 0.52) / 1.14)); return V(0, c.y, z); };    // approx. spine point at z
      const zone = (n, z0, z1, a0, a1, L, Wd, seed, both) => {
        for (let i = 0; i < Math.max(2, Math.round(n * q)); i++) {
          const h1 = hash01(seed + i * 3.1), h2 = hash01(seed + i * 7.7 + 1), h3 = hash01(seed + i * 5.3 + 2);
          const z = lerp(z0, z1, h1), a = lerp(a0, a1, h2) * (both && h3 < 0.5 ? -1 : 1), O = ax(z), Dr = V(Math.sin(a), Math.cos(a), 0);
          tuft(bodyBase, O, Dr, L * (0.75 + 0.5 * h3), Wd * (0.8 + 0.4 * h1), 0, bodyWeights);
        }
      };
      zone(110, 0.3, 0.66, 0.1, 3.0, 0.14, 0.021, 11, true);            // neck ruff / mane (all round the neck)
      zone(60, 0.0, 0.4, 0.0, 0.9, 0.14, 0.021, 31, true);            // hump
      zone(50, -0.36, 0.2, 1.0, 2.3, 0.13, 0.02, 53, true);           // flanks
      zone(44, -0.3, 0.4, 2.4, 3.0, 0.14, 0.021, 71, true);             // belly skirt
      zone(40, -0.56, -0.26, 0.2, 2.2, 0.13, 0.02, 97, true);          // rump
    }

    /* ---- head: broad skull, dished profile, long straight muzzle, black nose ---- */
    const headSDF = K.sdf([
      { e: [0, 0.73, 0.74], r: [0.15, 0.125, 0.15] },                                      // cranium
      { e: [0.115, 0.67, 0.77], r: [0.07, 0.1, 0.1], k: 0.08 },                            // cheeks / masseters
      { e: [-0.115, 0.67, 0.77], r: [0.07, 0.1, 0.1], k: 0.08 },
      { c: [0, 0.695, 0.82, 0, 0.612, 1.04], ra: 0.096, rb: 0.054, k: 0.06, sq: 1.08 },       // long tapering muzzle
      { e: [0, 0.683, 0.93], r: [0.046, 0.04, 0.11], k: 0.05 },                              // nasal bridge: keeps the top line straight
      { e: [0, 0.78, 0.8], r: [0.115, 0.03, 0.07], k: 0.05 },                                // brow
      { e: [0, 0.602, 1.05], r: [0.05, 0.036, 0.028], k: 0.022 },                           // rhinarium
      { e: [0, 0.79, 0.9], r: [0.06, 0.045, 0.07], k: 0.09, sub: true },                      // dish between brow and muzzle
      { e: [0.082, 0.762, 0.868], r: [0.022, 0.018, 0.022], k: 0.012, sub: true },            // eye sockets (small eyes)
      { e: [-0.082, 0.762, 0.868], r: [0.022, 0.018, 0.022], k: 0.012, sub: true },
      { e: [0.02, 0.6, 1.072], r: [0.012, 0.01, 0.02], k: 0.006, sub: true },             // nostrils
      { e: [-0.02, 0.6, 1.072], r: [0.012, 0.01, 0.02], k: 0.006, sub: true },
    ]);
    const head = K.projectSDF({ sdf: headSDF, curve: new T.LineCurve3(V(0, 0.74, 0.62), V(0, 0.615, 1.05)), rows: nr(36), nu: nu(30), cap0: 0.22, cap1: 0.1, rmax: 0.3 });
    K.skin(head, [[I.head, 1]]);
    const noseC = V(0, 0.604, 1.054);
    K.paint(head, (p, n) => {
      let c = fur(p, n);
      c = mix(c, C.muzzle, sstep(0.84, 0.95, p.z) * 0.85);
      c = mix(c, C.cheek, sstep(0.07, 0.12, Math.abs(p.x)) * gs(p.y, 0.68, 0.08) * gs(p.z, 0.76, 0.1) * 0.7);
      c = mix(c, C.nose, sstep(0.062, 0.04, p.distanceTo(noseC)));
      c = mix(c, C.lip, 0.8 * gs(p.y, 0.575, 0.012) * sstep(0.84, 0.9, p.z) * sstep(0.3, -0.4, n.y));
      c = mix(c, C.lip, 0.55 * sstep(0.82, 0.88, p.z) * sstep(-0.2, -0.7, n.y) * sstep(0.6, 0.57, p.y));
      return c;
    });
    parts.fur.push(head);
    const jsdf = K.sdf([
      { c: [0, 0.612, 0.78, 0, 0.565, 0.945], ra: 0.07, rb: 0.044, sq: 1.15 },
      { e: [0, 0.59, 0.82], r: [0.062, 0.04, 0.1], k: 0.04 },
    ]);
    const jaw = K.projectSDF({ sdf: jsdf, curve: new T.LineCurve3(V(0, 0.607, 0.78), V(0, 0.57, 0.94)), rows: nr(16), nu: nu(18), cap0: 0.2, cap1: 0.2, rmax: 0.16 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => mix(mix(mul(C.muzzle, 0.85), mul(C.belly, 0.9), 0.4), C.mouth, sstep(0.25, 0.8, n.y) * sstep(0.8, 0.86, p.z)));
    parts.fur.push(jaw);
    // tongue (visible in the roar) + canines
    {
      const tg = K.sweep({ pts: [V(0, 0.595, 0.8), V(0, 0.59, 0.87), V(0, 0.585, 0.93)], up: V(0, 1, 0), prof: (u, o) => { o[0] = 0.034 * (1 - 0.35 * u); o[1] = 0.011; o[2] = 0.011; o[3] = 2.2; o[4] = 0; o[5] = 0; return o; }, rows: 6, nu: 8, cap0: 1, cap1: 2 });
      K.skin(tg, [[I.jaw, 1]]); K.paint(tg, C.tongue); parts.skin.push(tg);
      const fang = (pts, r, bone) => {
        const g = K.sweep({ pts, up: V(0, 0, 1), prof: (u, o) => { o[0] = r * (1 - 0.8 * u); o[1] = o[2] = r * 0.9 * (1 - 0.8 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 6, cap0: 1, cap1: 1 });
        K.skin(g, [[bone, 1]]); K.paint(g, C.tooth); return g;
      };
      for (const s of [-1, 1]) {
        parts.horn.push(fang([V(s * 0.04, 0.59, 1.0), V(s * 0.041, 0.574, 1.004), V(s * 0.04, 0.557, 1.0)], 0.0105, I.head));
        parts.horn.push(fang([V(s * 0.034, 0.585, 0.94), V(s * 0.035, 0.6, 0.945), V(s * 0.034, 0.612, 0.941)], 0.0085, I.jaw));
        // small dark eyes
        const eye = new T.SphereGeometry(0.0145, Math.max(8, Math.round(12 * q)), Math.max(6, Math.round(9 * q)));
        eye.scale(1, 0.85, 1); eye.translate(s * 0.083, 0.762, 0.865);
        parts.gloss.push(K.prim(eye, C.eye, I.head));
      }
    }
    // cheek / brow fur cards (head-bone skinned)
    for (let i = 0; i < Math.max(4, Math.round(14 * q)); i++) {
      const h1 = hash01(200 + i * 3.7), h2 = hash01(200 + i * 7.1), s = i % 2 ? 1 : -1;
      const O = V(0, 0.7, lerp(0.7, 0.86, h1)), a = lerp(1.2, 2.3, h2);
      tuft(headSDF, O, V(s * Math.sin(a), Math.cos(a), 0), 0.07, 0.026, I.head);
    }

    /* ears: small, round, set wide on the skull, dark inside */
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      const e = K.sweep({
        pts: [V(s * 0.095, 0.82, 0.7), V(s * 0.112, 0.86, 0.705), V(s * 0.126, 0.9, 0.708)], up: V(s * 0.7, 0.1, 0.7),
        prof: (u, o) => { o[0] = 0.052 * Math.sqrt(Math.max(0.0, 1 - Math.pow(2 * u - 0.55, 2) * 1.1)) + 0.004; o[1] = o[2] = 0.014 * (1 - 0.4 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        cup: (u) => -0.012 * Math.sin(PI * u), rows: nr(9), nu: nu(16), cap0: 1, cap1: 3,
      });
      K.skin(e, (p) => [[I['ear' + sd], sstep(0.835, 0.855, p.y)], [I.head, 1 - sstep(0.835, 0.855, p.y)]]);
      K.paint(e, (p, n) => mul(mix(mix(C.back, C.dark, 0.3), C.earIn, sstep(0.0, 0.6, n.z * 0.7 + n.x * s * 0.7) * sstep(0.84, 0.87, p.y)), 0.9 + 0.2 * vnoise3(p.x * 50, p.y * 50, 1)));
      parts.fur.push(e);
    }

    /* stub tail */
    {
      const tp = [V(0, 0.65, -0.55), W('tail0'), W('tail1'), V(0, 0.6, -0.71)];
      const tsegs = [['pelvis', 0, 1], ['tail0', 1, 2], ['tail1', 2, 3]].map((x) => [I[x[0]], tp[x[1]], tp[x[2]]]);
      const tail = K.sweep({ pts: tp, prof: (u, o) => { o[0] = o[1] = o[2] = lerp(0.062, 0.03, u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: nr(8), nu: nu(10), cap0: 0, cap1: 3 });
      K.skin(tail, (p) => K.envelope(tsegs, p, 4));
      K.paint(tail, (p, n) => mul(mix(C.back, C.dark, 0.4), grizzle(p)));
      parts.fur.push(tail);
    }

    /* ---- legs (left built, right mirrored): pillar limbs + flat plantigrade paws + claws ---- */
    const legParts = [];
    const sd = 'L', S = 1;
    const prof3 = (cv) => { const o3 = [0, 0, 0]; return (u, o) => { cv(u, o3); o[0] = o3[0]; o[1] = o3[1]; o[2] = o3[2]; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; }; };
    // fore: buried shoulder -> upper arm -> elbow -> forearm -> carpus
    const shIn = V(S * 0.11, 0.7, 0.31), fmid = V(0.186, 0.48, 0.26), fmid2 = V(0.18, 0.21, 0.28);
    const fp = [shIn, W('hum' + sd), fmid, W('for' + sd), fmid2, W('mc' + sd)];
    const fc = M.curve([[0, 0.115, 0.125, 0.125], [0.14, 0.13, 0.14, 0.145], [0.4, 0.105, 0.108, 0.125], [0.55, 0.095, 0.098, 0.115], [0.72, 0.105, 0.105, 0.105], [0.9, 0.078, 0.078, 0.08], [1, 0.072, 0.073, 0.074]]);
    const fore = K.sweep({ pts: fp, up: V(0, 0, 1), prof: prof3(fc), rows: nr(28), nu: nu(18), cap0: 2, cap1: 2,
      detail: (u, a) => 0.012 * gs(u, 0.56, 0.05) * ga(a, PI, 0.5) + 0.008 * (vnoise3(u * 25, a * 2, 3) - 0.4) });
    K.skin(fore, (p) => K.envelope([[I['scap' + sd], shIn, W('hum' + sd)], [I['hum' + sd], W('hum' + sd), W('for' + sd)], [I['for' + sd], W('for' + sd), W('mc' + sd)], [I['mc' + sd], W('mc' + sd), W('fpaw' + sd)]], p, 4, [[I['scap' + sd], 0.8 * gs(p.distanceTo(shIn), 0, 0.12)]]));
    K.paint(fore, (p, n) => legCol(p, n, 0.5));
    legParts.push(['fur', fore]);
    // hind: haunch -> hip -> knee -> shin -> hock (heel)
    const hipIn = V(S * 0.11, 0.6, -0.42), hmid = V(0.19, 0.5, -0.31), hmid2 = V(0.19, 0.25, -0.29);
    const hp = [hipIn, hmid, W('shin' + sd), hmid2, W('met' + sd)];
    const hc = M.curve([[0, 0.1, 0.12, 0.13], [0.28, 0.15, 0.16, 0.17], [0.52, 0.1, 0.1, 0.12], [0.62, 0.095, 0.095, 0.11], [0.8, 0.088, 0.088, 0.1], [0.95, 0.072, 0.074, 0.08], [1, 0.07, 0.072, 0.074]]);
    const hind = K.sweep({ pts: hp, up: V(0, 0, 1), prof: prof3(hc), rows: nr(30), nu: nu(18), cap0: 2, cap1: 2,
      detail: (u, a) => 0.012 * gs(u, 0.52, 0.045) * ga(a, 0, 0.5) + 0.008 * (vnoise3(u * 25, a * 2, 8) - 0.4) });
    K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('th' + sd)], [I['th' + sd], W('th' + sd), W('shin' + sd)], [I['shin' + sd], W('shin' + sd), W('met' + sd)], [I['met' + sd], W('met' + sd), W('hpaw' + sd)]], p, 4, [[I.pelvis, 0.9 * gs(p.distanceTo(hipIn), 0, 0.12)]]));   // the buried hip end rides on the pelvis
    K.paint(hind, (p, n) => legCol(p, n, 0.46));
    legParts.push(['fur', hind]);
    // paws: broad flat sole, five toe ridges, pale claws. cx / z0 = wrist / heel, z1 = ball, z2 = toe tips
    const pawW = (kind) => kind === 'fore' ? 0.088 : 0.08;
    const paw = (kind) => {
      const fore = kind === 'fore', cx = S * 0.175;
      const z0 = fore ? 0.335 : -0.395, y0 = fore ? 0.085 : 0.095, zb = fore ? 0.5 : -0.19, z2 = fore ? 0.572 : -0.11, hw = pawW(kind);
      const pts = [V(cx, y0, z0), V(cx, 0.048, lerp(z0, zb, 0.45)), V(cx, 0.036, zb), V(cx, 0.027, z2)];
      const g = K.sweep({ pts, up: V(0, 1, 0), prof: (u, o) => { o[0] = hw * lerp(0.82, 1, sstep(0.05, 0.5, u)) * (1 - 0.3 * sstep(0.85, 1, u)); o[1] = lerp(0.052, 0.034, u); o[2] = lerp(0.036, 0.028, u); o[3] = 2.5; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => -0.0075 * sstep(0.7, 0.8, u) * (gs(Math.abs(a), 0.3, 0.1) + gs(Math.abs(a), 0.68, 0.1)) * (Math.abs(a) < PI / 2 ? 1 : 0), rows: nr(16), nu: nu(20), cap0: 1, cap1: 2 });
      const m = fore ? I['mc' + sd] : I['met' + sd], t = fore ? I['fpaw' + sd] : I['hpaw' + sd];
      const bp = V(cx, 0.036, zb), tip = V(cx, 0.02, z2);
      K.skin(g, (p) => K.envelope([[m, V(cx, y0, z0), bp], [t, bp, tip]], p, 5));
      K.paint(g, (p, n, info) => {
        const sole = sstep(-0.35, -0.7, n.y), toes = sstep(0.55, 0.8, info ? info.s : 0);
        let c = mix(mul(C.leg, 0.9 + 0.25 * vnoise3(p.x * 40, p.y * 40, p.z * 20)), mul(C.dark, 0.8), 0.4 * toes);
        return mix(c, C.pad, sole);
      });
      legParts.push(['fur', g]);
      // claws: long curved keratin, pale with darker tips
      const cl = fore ? 0.075 : 0.045;
      for (let k = 0; k < 5; k++) {
        const dx = (k - 2) * (hw * 0.38), zt = z2 - 0.012 - 0.006 * Math.abs(k - 2) * (fore ? 1 : 0.5), sp = (k - 2) * 0.012;
        const c = K.sweep({ pts: [V(cx + dx, 0.031, zt - 0.008), V(cx + dx + sp * 0.5, 0.027, zt + cl * 0.5), V(cx + dx + sp, 0.012, zt + cl)], up: V(0, 1, 0),
          prof: (u, o) => { const r = 0.0105 * (1 - 0.82 * Math.pow(u, 0.9)); o[0] = r; o[1] = r * 0.85; o[2] = r * 0.85; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 5, nu: 7, cap0: 1, cap1: 1 });
        K.skin(c, [[t, 1]]); K.paint(c, (p, n, info) => mix(C.claw, C.clawTip, sstep(0.55, 1, info ? info.s : 0)));
        legParts.push(['horn', c]);
      }
    };
    paw('fore'); paw('hind');
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    for (const [slot, g] of legParts) { parts[slot].push(g); parts[slot].push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const PAD = 0.03;
  const legs = [
    { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: PAD, toeLen: 0.09, lift: 0.1, curl: 0.5 },
    { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: PAD, toeLen: 0.09, lift: 0.1, curl: 0.5 },
    { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: PAD, toeLen: 0.085, lift: 0.09, curl: 0.45 },
    { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: PAD, toeLen: 0.085, lift: 0.09, curl: 0.45 },
  ];
  let curV = 0;
  const gaits = {
    walk: { stride: (v) => 0.62 + 0.2 * v, duty: 0.58, minV: 0.06 },
    gallop: { stride: (v) => 1.3 + 0.2 * v, get duty() { return M.clamp(0.3 - 0.02 * (curV - 3), 0.2, 0.3); }, get dutyF() { return M.clamp(0.26 - 0.02 * (curV - 3), 0.17, 0.26); }, minV: 0.06, liftK: () => 1.25 },
  };
  const offsets = {
    HL: { walk: 0, gallop: 0 }, FL: { walk: 0.25, gallop: 0.58 },
    HR: { walk: 0.5, gallop: 0.1 }, FR: { walk: 0.75, gallop: 0.47 },
  };
  const vG = 2.0;
  function select(v, cur) { curV = v; return cur === 'gallop' ? (v < vG - 0.5 ? 'walk' : 'gallop') : (v > vG ? 'gallop' : 'walk'); }
  const HIP = [0.62 - BODY_Y, -0.38], SHO = [0.66 - BODY_Y, 0.28];

  function base(P, ctx, A_) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.5) : 0, 6, dt);
    const mw = ctx.mw, idle = 1 - mw, run = sstep(1.2, 3.0, v), gal = ctx.gaitName === 'gallop' ? 1 : 0;
    ctx.gw = M.damp(ctx.gw || 0, gal, 5, dt);
    const ph = ctx.phase * TAU, gw = ctx.gw, wk = mw * (1 - gw);
    // weight: heavy double bob in the walk, one rocking cycle in the gallop; the whole bear sinks into the run
    P[ch('body.py')] += mw * ((1 - gw) * -0.014 * Math.cos(2 * ph) + gw * 0.045 * Math.sin(ph + 0.7)) - 0.07 * run;
    const flex = gw * 0.13 * Math.sin(ph + 0.4);
    P[ch('pelvis.rx')] += flex; P[ch('chest.rx')] -= flex * 0.75;
    P[ch('body.rx')] += gw * 0.05 * Math.sin(ph + 2.0) + 0.05 * run;
    // lumbering walk: the body rolls over the planted legs, shoulders and hips counter-twist, head swings low
    P[ch('body.rz')] += wk * 0.03 * Math.sin(ph + 0.4);
    P[ch('pelvis.rz')] += wk * 0.05 * Math.sin(ph + 0.4);
    P[ch('chest.rz')] += wk * -0.05 * Math.sin(ph + 0.6);
    P[ch('pelvis.ry')] += wk * 0.07 * Math.sin(ph + 0.5);
    P[ch('chest.ry')] += wk * -0.06 * Math.sin(ph + 0.5);
    P[ch('neck.ry')] += wk * 0.14 * Math.sin(ph + 1.9); P[ch('head.ry')] += wk * 0.1 * Math.sin(ph + 2.3);
    P[ch('neck.rz')] += wk * 0.05 * Math.sin(ph + 0.9);
    P[ch('neck.rx')] += wk * 0.05 * Math.cos(2 * ph + 0.5) - 0.04 * wk;
    const tr = M.clamp(ctx.turn * 0.05, -0.25, 0.25);
    P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.5; P[ch('neck.ry')] += tr * 0.8;
    // idle: heavy, low head scanning slowly, breathing, snout twitches
    const look = (vnoise3(t * 0.2, 1.3, 0) - 0.5) * 1.3, lookY = (vnoise3(t * 0.18, 4.1, 2) - 0.5) * 0.6;
    P[ch('neck.ry')] += idle * look * 0.5; P[ch('head.ry')] += idle * look * 0.3;
    P[ch('neck.rx')] += idle * (lookY * 0.3 - 0.06); P[ch('head.rx')] += idle * lookY * 0.2;
    P[ch('nose')] += idle * Math.max(0, Math.sin(t * 12)) * (vnoise3(t * 0.6, 7, 1) > 0.6 ? 1 : 0);
    // sprint: head low and level, ears flat
    P[ch('neck.rx')] += 0.3 * run; P[ch('head.rx')] += 0.08 * run;
    P[ch('earL.rz')] += run * 0.1; P[ch('earR.rz')] -= run * 0.1;
    P[ch('earL.rx')] -= run * 0.4; P[ch('earR.rx')] -= run * 0.4;
    P[ch('earL.ry')] += idle * 0.4 * Math.max(0, Math.sin(t * 9)) * (vnoise3(t * 0.5, 2, 5) > 0.64 ? 1 : 0);
    const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
    P[ch('neck.rx')] -= bodyPitch * 0.6; P[ch('head.rx')] -= bodyPitch * 0.2;
    P[ch('tail0.ry')] += idle * 0.08 * Math.sin(t * 1.7);
    // scapulae glide with the fore steps: the hump rolls
    const fF = A_.gait.feet[0], fR = A_.gait.feet[1];
    P[ch('scapL.rx')] += mw * 0.22 * scapSwing(fF); P[ch('scapR.rx')] += mw * 0.22 * scapSwing(fR);
    P[ch('scapL.rz')] += mw * 0.05 * scapSwing(fF); P[ch('scapR.rz')] -= mw * 0.05 * scapSwing(fR);
  }
  function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }
  // plantigrade foot: the heel (carpus / hock) touches down first, the sole rolls flat, the heel leaves first; swing folds
  // the paw (toes hang). Angle = the segment wrist -> ball off vertical.
  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0, rest = Lg.restDistal, hi = Lg.type === 'hind' ? 1.28 : 1.3;
    if (f.planted) return lerp(hi, lerp(hi, rest, sstep(0, 0.4, f.stanceU)) - 0.55 * sstep(0.45, 1, f.stanceU), mw);
    return rest - 0.35 * Math.sin(PI * Math.min(1, f.swingU * 1.05)) + (hi - rest) * sstep(0.75, 1, f.swingU) * mw;
  }
  function toeExtra() { return 0; }
  function post(P, ctx, A_) {
    const fast = ctx.moving ? 1 : 0, breath = Math.sin(ctx.t * (fast ? 5 : 2.4));
    A_.B[I.ribs].scale.setScalar(ctx.dead ? 1 : 1 + 0.02 * breath);
    A_.B[I.head].rotateX(-0.06 * P[ch('nose')]);
  }
  function secondary(ctx, A_) {
    const dt = ctx.dt, B = A_.B;
    const ey = K.stepSpring(A_.sp_('ear'), (B[I.body].position.y - BODY_Y) * -18, 220, 12, dt);
    B[I.earL].rotateX(ey * 0.25); B[I.earR].rotateX(ey * 0.25);
    const tg = -M.clamp(ctx.turn * 0.12, -0.6, 0.6);
    B[I.tail1].rotateY(K.stepSpring(A_.sp_('t1'), tg, 70, 7, dt) * 0.3);
  }
  function flinch(P, t, dir, pow) {
    const f = Math.exp(-t * 8) * Math.sin(Math.min(1, t * 11) * PI * 0.5) * pow * 0.7;
    P[ch('body.px')] += dir[0] * 0.04 * f; P[ch('body.pz')] += dir[1] * 0.05 * f; P[ch('body.py')] -= 0.02 * f;
    P[ch('body.rz')] += -dir[0] * 0.1 * f; P[ch('chest.rx')] += 0.06 * f;
    P[ch('neck.rx')] -= 0.25 * f; P[ch('head.rx')] -= 0.15 * f; P[ch('head.ry')] += dir[0] * 0.3 * f; P[ch('jaw.rx')] += 0.3 * f;
    P[ch('earL.rx')] -= 0.5 * f; P[ch('earR.rx')] -= 0.5 * f;
  }

  /* ---------------- actions (keyed on the authority's phase instants) ---------------- */
  const A_ = D.attacks;
  const through = (ph, vals) => { const c = M.curve(['s', 'an', 'wu', 'hit', 'fo', 'e'].map((nm, i) => [ph[nm], vals[i]]).filter((x, i, a) => i === 0 || x[0] > a[i - 1][0] + 1e-6)), o = [0]; return (u) => c(u, o)[0]; };
  // FK arm posed by WORLD angles (forward of straight-down, radians; the bind arm is a zigzag, so raw bone offsets would be unreadable):
  // t1 upper arm, t2 forearm, t3 hand/paw; lat swings the arm outward (+), yaw toward the centre line (+). The fore leg leaves IK by fk.
  const bAng = (p, q) => Math.atan2(q.z - p.z, -(q.y - p.y));
  const B1 = bAng(tpl.world[I.humL], tpl.world[I.forL]), B2 = bAng(tpl.world[I.forL], tpl.world[I.mcL]), B3 = bAng(tpl.world[I.mcL], tpl.world[I.fpawL]);
  function arm(P, s, fk, t1, t2, t3, lat, yaw) {
    if (fk <= 0) return;
    const bp = P[ch('body.rx')] + P[ch('chest.rx')] + P[ch('scap' + s + '.rx')], a1 = B1 - t1, a2 = B2 - t2, a3 = B3 - t3, sg = s === 'L' ? 1 : -1;
    P[ch('ikF' + s)] -= fk;
    P[ch('hum' + s + '.rx')] += (a1 - bp) * fk; P[ch('for' + s + '.rx')] += (a2 - a1) * fk; P[ch('mc' + s + '.rx')] += (a3 - a2) * fk;
    P[ch('hum' + s + '.rz')] += (lat || 0) * sg * fk; P[ch('hum' + s + '.ry')] += (yaw || 0) * -sg * fk;
  }
  const actions = {};
  {
    const a = A_.maul, ph = a.phases;
    // half-rear, right paw (bone R, -X) cocked overhead, then swatted down across the front; the left paw guards
    const tr = K.track(chan, ph, {
      'neck.rx': [0, -0.2, -0.28, 0.1, 0.12, 0], 'head.rx': [0, -0.15, -0.2, 0.16, 0.1, 0], 'jaw.rx': [0, 0.2, 0.4, 0.5, 0.2, 0],
      'neck.ry': [0, 0.1, 0.12, -0.15, -0.1, 0], 'chest.ry': [0, 0.14, 0.2, -0.3, -0.22, 0], 'chest.rz': [0, -0.04, -0.06, 0.1, 0.06, 0],
      'pelvis.ry': [0, -0.05, -0.08, 0.1, 0.07, 0], 'body.rz': [0, 0.04, 0.06, -0.1, -0.06, 0],
      'earL.rx': [0, -0.4, -0.6, -0.7, -0.4, 0], 'earR.rx': [0, -0.4, -0.6, -0.7, -0.4, 0],
    });
    const rear = through(ph, [0, -0.3, -0.5, 0.17, 0.08, 0]), py = through(ph, [0, 0.02, 0.03, -0.07, -0.03, 0]);
    const r1 = through(ph, [-0.1, 1.6, 2.5, 0.95, 0.6, -0.1]), r2 = through(ph, [0.5, 2.4, 3.3, 0.75, 0.4, 0.5]), r3 = through(ph, [1.2, 1.5, 2.6, 1.45, 1.2, 1.15]);
    const rl = through(ph, [0, 0.3, 0.5, -0.15, -0.35, 0]), ry = through(ph, [0, 0, 0, 0.25, 0.4, 0]);
    const l1 = through(ph, [-0.1, 1.0, 0.8, 0.5, 0.4, -0.1]), l2 = through(ph, [0.5, 1.9, 1.6, 0.5, 0.5, 0.5]), l3 = through(ph, [1.2, 1.3, 1.2, 1.4, 1.2, 1.15]);
    actions.maul = { kind: 'attack', dur: a.dur, blendIn: 0.12, blendOut: 0.3, ground: true, track: (P, u, w) => {
      tr(P, u, w);
      const fk = sstep(0, ph.an * 0.8, u) * sstep(1.0, ph.fo + 0.02, u) * w;
      K.pitchAbout(P, chan, rear(u) * w, HIP[0], HIP[1]);
      P[ch('body.py')] += py(u) * w;
      arm(P, 'R', fk, r1(u), r2(u), r3(u), rl(u), ry(u));
      arm(P, 'L', fk, l1(u), l2(u), l3(u), 0.1, 0);
    } };
  }
  {
    const a = A_.slam, ph = a.phases;
    const tr = K.track(chan, ph, {
      'neck.rx': [0, -0.35, -0.5, 0.2, 0.15, 0], 'head.rx': [0, -0.2, -0.35, 0.1, 0.08, 0], 'jaw.rx': [0, 0.35, 0.65, 0.35, 0.15, 0],
      'earL.rx': [0, -0.4, -0.7, -0.9, -0.5, 0], 'earR.rx': [0, -0.4, -0.7, -0.9, -0.5, 0],
      'chest.rx': [0, 0, -0.05, 0.06, 0.02, 0], 'tail0.rx': [0, 0.2, 0.3, 0, 0, 0],
    });
    const rear = through(ph, [0, -0.78, -1.05, 0.2, 0.1, 0]), py = through(ph, [0, 0.03, 0.05, -0.07, -0.02, 0]);
    const s1 = through(ph, [-0.1, 2.0, 2.7, 0.8, 0.6, -0.1]), s2 = through(ph, [0.5, 2.6, 3.2, 0.6, 0.4, 0.5]), s3 = through(ph, [1.2, 1.8, 2.4, 1.4, 1.2, 1.15]), sl = through(ph, [0, 0.2, 0.3, 0.1, 0.05, 0]);
    actions.slam = { kind: 'attack', dur: a.dur, blendIn: 0.15, blendOut: 0.32, ground: true, track: (P, u, w) => {
      tr(P, u, w);
      K.pitchAbout(P, chan, rear(u) * w, HIP[0], HIP[1]);
      P[ch('body.py')] += py(u) * w;
      const fk = sstep(0, ph.an * 0.7, u) * sstep(1.0, ph.fo + 0.02, u) * w;
      for (const s of ['L', 'R']) arm(P, s, fk, s1(u), s2(u), s3(u), sl(u), 0);
      // impact: the whole bear compresses, the head snaps down
      const imp = sstep(ph.hit - 0.01, ph.hit + 0.02, u) * sstep(ph.fo + 0.1, ph.hit + 0.03, u);
      P[ch('body.py')] -= 0.06 * imp * w; P[ch('chest.rx')] += 0.06 * imp * w;
    } };
  }
  actions.stagger = { kind: 'stagger', dur: 1.0, blendIn: 0.06, blendOut: 0.3, ground: true, track: (P, u, w, layer) => {
    const side = (layer.data && layer.data.side) || 1;
    const e = sstep(0, 0.12, u) * sstep(1, 0.6, u) * w, wob = Math.sin(u * 20) * sstep(0.1, 0.3, u) * sstep(0.9, 0.4, u);
    P[ch('body.px')] += side * 0.1 * e; P[ch('body.rz')] += side * 0.18 * e + 0.05 * wob * w; P[ch('body.ry')] += side * 0.14 * e;
    P[ch('body.py')] -= 0.04 * e; K.pitchAbout(P, chan, -0.14 * e, HIP[0], HIP[1]);
    P[ch('neck.rx')] += 0.25 * e; P[ch('head.ry')] += 0.3 * wob * w; P[ch('neck.ry')] -= 0.2 * wob * w; P[ch('jaw.rx')] += 0.3 * e;
    P[ch('earL.rx')] -= 0.5 * e; P[ch('earR.rx')] -= 0.5 * e;
  } };
  actions.death = { kind: 'death', dur: 2.1, blendIn: 0.08, hold: true, track: (P, u, w, layer) => {
    const side = (layer.data && layer.data.side) || 1;
    const kneel = M.ease.io(sstep(0.0, 0.3, u)), roll = M.ease.io(sstep(0.28, 0.66, u)), kick = sstep(0.6, 0.66, u) * sstep(0.88, 0.7, u);
    K.pitchAbout(P, chan, 0.2 * kneel * (1 - roll) * w, HIP[0], HIP[1]);
    P[ch('body.py')] += (-0.14 * kneel - 0.2 * roll) * w;
    P[ch('body.rz')] += side * 1.45 * roll * w; P[ch('body.px')] += -side * 0.1 * roll * w;
    P[ch('chest.rx')] += 0.1 * roll * w; P[ch('pelvis.rx')] -= 0.1 * roll * w;
    P[ch('neck.rx')] += (0.4 * kneel - 0.15 * roll) * w; P[ch('head.rx')] += 0.2 * roll * w; P[ch('jaw.rx')] += 0.25 * roll * w;
    P[ch('neck.ry')] += side * 0.2 * roll * w;
    const ikF = sstep(0.04, 0.22, u) * w, ikH = sstep(0.22, 0.42, u) * w;
    P[ch('ikFL')] -= ikF; P[ch('ikFR')] -= ikF; P[ch('ikHL')] -= ikH; P[ch('ikHR')] -= ikH;
    for (const s of ['L', 'R']) {
      const up = s === (side > 0 ? 'L' : 'R') ? 1 : 0;
      P[ch('hum' + s + '.rx')] += (-0.35 * kneel + (-0.1 - 0.3 * up) * roll - 0.15 * kick * Math.sin(u * 50)) * w;
      P[ch('for' + s + '.rx')] += (-0.5 * kneel * (1 - roll) + (-0.2 - 0.3 * up) * roll) * w;
      P[ch('mc' + s + '.rx')] += (0.6 * kneel * (1 - roll) + 0.3 * roll) * w;
      P[ch('th' + s + '.rx')] += ((0.05 + 0.25 * up) * roll + 0.2 * kick * Math.sin(u * 45 + 1)) * w;
      P[ch('shin' + s + '.rx')] -= (0.25 + 0.35 * up) * roll * w; P[ch('met' + s + '.rx')] += 0.3 * roll * w;
    }
    P[ch('tail0.ry')] += side * 0.3 * roll * w;
    P[ch('earL.rx')] -= 0.4 * roll * w; P[ch('earR.rx')] -= 0.4 * roll * w;
  } };
  actions.roar = { kind: 'special', dur: 3.6, blendIn: 0.25, blendOut: 0.5, ground: true, track: (P, u, w) => {
    // rear up on the hind legs, paws up and out, head thrown back, jaws wide (shuddering roar), drop back down
    const up = M.ease.io(sstep(0.0, 0.26, u)) * M.ease.io(sstep(1.0, 0.82, u)) * w;
    const open = sstep(0.24, 0.32, u) * sstep(0.74, 0.66, u) * w;
    K.pitchAbout(P, chan, -1.1 * up, HIP[0], HIP[1]);
    P[ch('body.py')] += 0.05 * up;
    P[ch('neck.rx')] += (-0.35 * up - 0.12 * open) ; P[ch('head.rx')] += -0.3 * up - 0.2 * open;
    P[ch('jaw.rx')] += 0.75 * open * (0.85 + 0.15 * Math.sin(u * 60));
    P[ch('head.rz')] += 0.1 * Math.sin(u * 44) * open; P[ch('neck.rz')] += 0.05 * Math.sin(u * 44 - 0.5) * open;
    P[ch('chest.rz')] += 0.03 * Math.sin(u * 44 - 1.0) * open;
    const fk = up;
    arm(P, 'L', fk, 0.75 + 0.08 * Math.sin(u * 5), 2.0, 1.5, 0.45, 0); arm(P, 'R', fk, 0.75 + 0.08 * Math.sin(u * 5 + 1.5), 2.0, 1.5, 0.45, 0);
    P[ch('earL.rx')] -= 0.8 * open; P[ch('earR.rx')] -= 0.8 * open;
    P[ch('tail0.rx')] += 0.2 * up;
  } };
  actions.sniff = { kind: 'special', dur: 3.0, blendIn: 0.3, blendOut: 0.4, track: (P, u, w) => {
    // nose up into the air, quick sniffs, a slow sweep side to side, then the nose drops to the ground
    const air = M.ease.io(sstep(0, 0.12, u)) * M.ease.io(sstep(0.62, 0.5, u)) * w, gnd = M.ease.io(sstep(0.5, 0.65, u)) * M.ease.io(sstep(1, 0.88, u)) * w;
    P[ch('neck.rx')] += -0.5 * air + 0.3 * gnd; P[ch('head.rx')] += -0.3 * air + 0.5 * gnd;
    P[ch('neck.ry')] += 0.5 * Math.sin(u * 9) * air + 0.3 * Math.sin(u * 6) * gnd; P[ch('head.ry')] += 0.2 * Math.sin(u * 9 + 0.6) * air;
    P[ch('nose')] += 1.3 * Math.max(0, Math.sin(u * 70)) * (air + gnd);
    K.pitchAbout(P, chan, 0.12 * gnd, HIP[0], HIP[1]); P[ch('body.pz')] += 0.05 * gnd;
    P[ch('chest.rx')] -= 0.05 * air;
  } };
  actions.scratch = { kind: 'special', dur: 3.0, blendIn: 0.3, blendOut: 0.4, ground: true, track: (P, u, w) => {
    // weight shifts onto the left side, head turns down toward the raised right paw, which rakes back and forth over the cheek / ear
    const e = M.ease.io(sstep(0, 0.16, u)) * M.ease.io(sstep(1, 0.84, u)) * w, rub = Math.sin(u * 34);
    P[ch('body.rz')] += 0.08 * e; P[ch('body.px')] += 0.03 * e;
    P[ch('neck.ry')] += -0.5 * e; P[ch('neck.rx')] += 0.05 * e; P[ch('head.ry')] += -0.2 * e; P[ch('head.rz')] += -0.25 * e + 0.05 * rub * e; P[ch('head.rx')] += -0.1 * e;
    P[ch('jaw.rx')] += 0.05 * e;
    arm(P, 'R', e, 1.35 + 0.1 * rub, 2.25 + 0.2 * rub, 2.0, -0.1, 0.1);
    P[ch('earR.rz')] += 0.3 * rub * e;
    K.pitchAbout(P, chan, -0.1 * e, HIP[0], HIP[1]);
  } };

  const sp0 = K.defineSpecies('bear', {
    rig: tpl, chan, build, lowQ: 0.5, animator: K.QuadAnimator, debugScale: 2.2,
    anim: { legs, gaits, offsets, select, base, distal, toeExtra, post, secondary, flinch, actions, gaitOpts: { restTol: 0.1, idleStepDur: 0.3, strainFrom: 0.3 }, groundFix: true },
    clips: ['idle', 'walk', 'run', 'maul', 'slam', 'stagger', 'hit', 'death', 'roar', 'sniff', 'scratch'],
    specials: ['roar', 'sniff', 'scratch', 'sniff'],
    def: D,
  });
  // the death / ground-contact floor test (core groundFix) samples ~1500 vertices per slot; the bear's fur slot has ~10k, and the
  // bulging flank of a thigh that ends up under the lying body can fall between samples (a few cm of ground clipping). Denser samples
  // (every 2nd LOD1 vertex), built lazily under the same cache field core uses.
  Object.defineProperty(sp0, '_gs', { configurable: true, get() {
    const G = K.speciesGeometry('bear', 1), p = [], ii = [], ww = [];
    for (const s in G.slots) {
      const g = G.slots[s], P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
      for (let i = 0; i < P.count; i += 2) { p.push(P.getX(i), P.getY(i), P.getZ(i)); for (let j = 0; j < 4; j++) { ii.push(SI.array[4 * i + j]); ww.push(SW.array[4 * i + j]); } }
    }
    const gs = { p: new Float32Array(p), i: new Uint16Array(ii), w: new Float32Array(ww), n: p.length / 3 };
    Object.defineProperty(sp0, '_gs', { value: gs, writable: true });
    return gs;
  } });

})();
