/* Canyon Cougar (levels 12-14): a large sleek puma - long low muscular body, deep narrow chest, powerful haunches, thick
 * forelegs on big round paws, small round head with a short broad muzzle, strong brow, rounded dark-backed ears, amber
 * eyes with slit pupils, a long thick tail carried low with a curled dark tip, retractable claws (sheathed unless the cat
 * strikes). Tawny sandy coat, cream chin / throat / belly, dark mask lines, muzzle spots, ear backs and tail tip.
 * Locomotion: fluid lateral-sequence walk (spine undulation) -> trot -> bounding rotary gallop with strong spine flexion,
 * plus the STALK gait (belly and head low, shoulder blades rolling, slow deliberate steps) the authority uses while the
 * cougar circles its prey (behaviour 'pack', movement mode 'stalk').
 * Attacks: pounce (crouch, hip wiggle, leap with the forepaws reaching and raking, claws out) and swipe (quick alternating
 * left / right paw slash). Idle specials: lick (paw), scan (ears swivel), yawn (low growl-yawn). Plus stagger, hit, death.
 * Authored at scale 1 (shoulder ~0.7 m); the game scale (defs) makes it ~1.0 m at the shoulder, ~1.75 m head to rump. */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- gameplay def (authored at scale 1; CREATURE_DEFS.addSpecies applies the game scale once) ---------------- */
  const A = (dur, an, wu, hit, fo, active, o) => Object.assign({ dur, phases: { s: 0, an, wu, hit, fo, e: 1 }, active }, o);
  const D = CREATURE_DEFS.addSpecies('panther', {
    scale: 1.5,
    name: 'Kanyon Pumazı', en: 'Canyon Cougar', levels: [12, 14], hp: 2500, hpLv: 300, exp: 2300, expLv: 260,
    radius: 0.4, front: 0.72, height: 0.82, mass: 0.7, poise: 0.35,
    speed: { walk: 1.3, run: 6.0, stalk: 1.5 }, turn: 8,
    behavior: { type: 'pack', aggro: 9, assist: 0, leash: 22, roam: 6, pause: [2, 6], dash: [1.5, 3.5], orbit: 3 },
    attacks: {
      pounce: A(1.5, 0.26, 0.46, 0.68, 0.82, [0.66, 0.76], { reach: 1.6, cosArc: 0.4, dmg: [300, 360], dmgLv: 38, cd: 2.6, use: [1.0, 3.4], lunge: 2.4 }),
      swipe: A(0.8, 0.2, 0.34, 0.44, 0.62, [0.4, 0.5], { reach: 1.3, cosArc: 0.4, dmg: [210, 250], dmgLv: 26, cd: 1.4, use: [0, 1.15], lunge: 0.25 }),
    },
    corpse: 12, respawn: [24, 34],
    loot: [{ id: 'puma_fang', name: 'Puma Dişi', p: 0.3 }],
  });

  /* ---------------- skeleton (world bind positions, metres) ---------------- */
  const BODY_Y = 0.58;
  const bones = [
    ['body', null, 0, BODY_Y, 0.0],
    ['ribs', 'body', 0, 0.52, 0.12],
    ['pelvis', 'body', 0, 0.6, -0.28],
    ['tail0', 'pelvis', 0, 0.6, -0.4, 'tail1'], ['tail1', 'tail0', 0, 0.565, -0.52, 'tail2'], ['tail2', 'tail1', 0, 0.47, -0.62, 'tail3'],
    ['tail3', 'tail2', 0, 0.35, -0.68, 'tail4'], ['tail4', 'tail3', 0, 0.235, -0.7, 'tail5'], ['tail5', 'tail4', 0, 0.14, -0.65],
    ['chest', 'body', 0, 0.58, 0.22],
    ['neck', 'chest', 0, 0.62, 0.38, 'head'],
    ['head', 'neck', 0, 0.69, 0.53],
    ['jaw', 'head', 0, 0.665, 0.59],
    ['earL', 'head', 0.052, 0.745, 0.515], ['earR', 'head', -0.052, 0.745, 0.515],
  ];
  for (const [s, k] of [['L', 1], ['R', -1]]) {
    bones.push(
      ['scap' + s, 'chest', k * 0.07, 0.69, 0.26, 'hum' + s],
      ['hum' + s, 'scap' + s, k * 0.088, 0.5, 0.3, 'for' + s],
      ['for' + s, 'hum' + s, k * 0.088, 0.285, 0.215, 'mc' + s],
      ['mc' + s, 'for' + s, k * 0.082, 0.1, 0.32, 'fpaw' + s],
      ['fpaw' + s, 'mc' + s, k * 0.08, 0.04, 0.35],
      ['clw' + s, 'fpaw' + s, k * 0.08, 0.026, 0.405],
      ['th' + s, 'pelvis', k * 0.08, 0.575, -0.3, 'shin' + s],
      ['shin' + s, 'th' + s, k * 0.09, 0.37, -0.2, 'met' + s],
      ['met' + s, 'shin' + s, k * 0.085, 0.205, -0.37, 'hpaw' + s],
      ['hpaw' + s, 'met' + s, k * 0.083, 0.04, -0.305],
    );
  }
  const ends = {
    tail5: [0, 0.16, -0.575], head: [0, 0.665, 0.745], jaw: [0, 0.612, 0.72], earL: [0.075, 0.8, 0.505], earR: [-0.075, 0.8, 0.505],
    fpawL: [0.08, 0.018, 0.435], fpawR: [-0.08, 0.018, 0.435], hpawL: [0.083, 0.018, -0.23], hpawR: [-0.083, 0.018, -0.23],
    clwL: [0.08, 0.012, 0.44], clwR: [-0.08, 0.012, 0.44],
    body: [0, 0.58, 0.22], pelvis: [0, 0.6, -0.4], chest: [0, 0.62, 0.38], ribs: [0, 0.52, 0.3],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikFL', 'ikFR', 'ikHL', 'ikHR', 'clawsL', 'clawsR']);

  /* ---------------- palette (display-space vertex colours; upward faces render ~2.2x brighter) ---------------- */
  const C = {
    back: [0.285, 0.2, 0.108], side: [0.38, 0.275, 0.16], flank: [0.43, 0.32, 0.19], cream: [0.64, 0.53, 0.38], leg: [0.38, 0.26, 0.14],
    paw: [0.33, 0.225, 0.125], pad: [0.085, 0.058, 0.055], claw: [0.3, 0.26, 0.21],
    mask: [0.065, 0.047, 0.036], lipPale: [0.54, 0.47, 0.37], nose: [0.36, 0.19, 0.17], noseEdge: [0.04, 0.03, 0.028], mouth: [0.13, 0.05, 0.05], tongue: [0.5, 0.16, 0.17],
    earOut: [0.06, 0.045, 0.036], earSpot: [0.28, 0.22, 0.16], earIn: [0.6, 0.5, 0.39], tail: [0.33, 0.22, 0.12], tailTip: [0.05, 0.038, 0.03],
    eye: [0.66, 0.4, 0.06], pupil: [0.012, 0.01, 0.008], tooth: [0.62, 0.58, 0.5],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // short, sleek fur: only a faint low-frequency tonal breakup along the body
  const sleek = (p) => 0.96 + 0.04 * vnoise3(p.x * 26, p.y * 26, p.z * 8) + 0.03 * (vnoise3(p.x * 70, p.y * 70, p.z * 22) - 0.5);
  function furColor(p, n) {
    const up = n.y, dors = sstep(0.2, 0.9, up), ven = sstep(-0.05, -0.65, up);
    let c = mix(C.side, C.back, dors);
    c = mix(c, C.flank, 0.35 * gs(up, 0.1, 0.35) * sstep(0.58, 0.5, p.y));                       // slightly warmer, paler flanks
    c = mix(c, mul(C.back, 0.9), 0.5 * gs(Math.abs(p.x), 0, 0.04) * dors);                        // darker saddle line
    // cream belly, chest, throat, inner legs
    c = mix(c, C.cream, Math.max(ven * 0.95, 0.85 * gs(p.z, 0.34, 0.08) * sstep(0.5, 0.4, p.y), 0.8 * sstep(0.4, 0.46, p.z) * sstep(0.62, 0.52, p.y) * sstep(0.62, 0.5, p.z)));
    return mul(c, sleek(p));
  }

  /* ---------------- geometry ---------------- */
  const SPINE = [
    ['pelvis', V(0, 0.6, -0.46), V(0, 0.6, -0.14)], ['body', V(0, 0.6, -0.14), V(0, 0.58, 0.1)],
    ['chest', V(0, 0.58, 0.1), V(0, 0.6, 0.34)], ['neck', V(0, 0.6, 0.34), V(0, 0.68, 0.52)], ['head', V(0, 0.68, 0.52), V(0, 0.69, 0.6)],
  ].map((s) => [I[s[0]], s[1], s[2]]);
  function jointS(pts) { const d = [0]; for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + pts[i].distanceTo(pts[i - 1])); return d.map((x) => x / d[d.length - 1]); }
  const prof3 = (cv, k) => { const q = [0, 0, 0]; k = k || 1; return (u, o) => { cv(u, q); o[0] = q[0] * k; o[1] = q[1] * k; o[2] = q[2] * k; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; }; };

  function build(q) {
    const parts = { fur: [], skin: [], gloss: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    /* body: long low cat - deep narrow rib cage, tucked loin, big haunch, powerful shoulders, thick neck */
    const bodySDF = K.sdf([
      { e: [0, 0.52, 0.14], r: [0.134, 0.175, 0.23] },                                 // deep, narrow rib cage
      { e: [0, 0.43, 0.3], r: [0.092, 0.09, 0.115], k: 0.07 },                         // brisket / forechest
      { e: [0.092, 0.52, 0.26], r: [0.058, 0.12, 0.11], rot: [-0.45, 0, 0], k: 0.07 },  // shoulder blades + triceps
      { e: [-0.092, 0.52, 0.26], r: [0.058, 0.12, 0.11], rot: [-0.45, 0, 0], k: 0.07 },
      { e: [0, 0.585, -0.12], r: [0.1, 0.097, 0.19], k: 0.09 },                        // loin, tucked abdomen
      { e: [0, 0.6, -0.3], r: [0.116, 0.108, 0.135], k: 0.07 },                          // croup / pelvis
      { e: [0, 0.668, 0.24], r: [0.048, 0.026, 0.1], k: 0.1 },                           // withers
      { e: [0.094, 0.5, -0.3], r: [0.06, 0.128, 0.112], rot: [0.3, 0, 0], k: 0.06 },     // thighs (big haunch)
      { e: [-0.094, 0.5, -0.3], r: [0.06, 0.128, 0.112], rot: [0.3, 0, 0], k: 0.06 },
      { e: [0.07, 0.55, -0.38], r: [0.052, 0.1, 0.075], k: 0.05 },                       // hams
      { e: [-0.07, 0.55, -0.38], r: [0.052, 0.1, 0.075], k: 0.05 },
      { e: [0, 0.656, 0.0], r: [0.058, 0.034, 0.42], k: 0.07 },                          // smooth top line
      { c: [0, 0.565, 0.33, 0, 0.665, 0.53], ra: 0.118, rb: 0.088, k: 0.06 },               // thick neck
      { e: [0, 0.682, 0.52], r: [0.076, 0.062, 0.08], k: 0.1 },                          // nape fillet over the occiput
      { e: [0, 0.575, 0.43], r: [0.074, 0.08, 0.09], k: 0.05 },                          // throat
    ]);
    const spine = new T.CatmullRomCurve3([V(0, 0.6, -0.42), V(0, 0.595, -0.26), V(0, 0.595, -0.04), V(0, 0.57, 0.16), V(0, 0.6, 0.36), V(0, 0.675, 0.52)], false, 'centripetal');
    const body = K.projectSDF({ sdf: bodySDF, curve: spine, rows: nr(50), nu: nu(32), cap0: 0.14, cap1: 0.08, rmax: 0.5 });
    const hip = { L: W('thL'), R: W('thR') }, sh = { L: W('humL'), R: W('humR') };
    K.skin(body, (p) => {
      const sd = p.x >= 0 ? 'L' : 'R';
      const ex = [
        [I['th' + sd], 0.55 * gs(p.distanceTo(hip[sd]), 0, 0.15) * sstep(0.02, 0.09, Math.abs(p.x)) * sstep(0.66, 0.54, p.y)],
        [I['scap' + sd], 0.55 * gs(p.distanceTo(sh[sd]), 0, 0.17) * sstep(0.02, 0.08, Math.abs(p.x))],
        [I.ribs, 0.5 * gs(p.z, 0.14, 0.2) * sstep(0.6, 0.46, p.y)],
      ];
      return K.envelope(SPINE, p, 4, ex);
    });
    K.paint(body, (p, n) => furColor(p, n));
    parts.fur.push(body);

    /* head: small round skull, wide cheeks, strong brow, short broad muzzle with whisker pads; separate mandible */
    const headSDF = K.sdf([
      { e: [0, 0.708, 0.552], r: [0.074, 0.066, 0.084] },                              // rounded braincase
      { e: [0.062, 0.682, 0.598], r: [0.034, 0.036, 0.05], k: 0.04 },                  // zygomatic arches / cheeks
      { e: [-0.062, 0.682, 0.598], r: [0.034, 0.036, 0.05], k: 0.04 },
      { e: [0.066, 0.66, 0.575], r: [0.024, 0.038, 0.038], rot: [0, 0, -0.4], k: 0.05 }, // cheek-fur ruffs
      { e: [-0.066, 0.66, 0.575], r: [0.024, 0.038, 0.038], rot: [0, 0, 0.4], k: 0.05 },
      { e: [0, 0.667, 0.688], r: [0.047, 0.036, 0.052], k: 0.035 },                    // short broad muzzle
      { e: [0.04, 0.734, 0.634], r: [0.026, 0.011, 0.026], k: 0.04 },                   // heavy brow ridges
      { e: [-0.04, 0.734, 0.634], r: [0.026, 0.011, 0.026], k: 0.04 },
      { e: [0, 0.697, 0.685], r: [0.027, 0.025, 0.05], k: 0.03 },                      // nasal bridge
      { e: [0.026, 0.657, 0.703], r: [0.027, 0.025, 0.03], k: 0.02 },                  // whisker pads
      { e: [-0.026, 0.657, 0.703], r: [0.027, 0.025, 0.03], k: 0.02 },
      { e: [0, 0.68, 0.737], r: [0.016, 0.012, 0.011], k: 0.008 },                     // nose leather
      { e: [0, 0.645, 0.585], r: [0.05, 0.032, 0.06], k: 0.035 },                      // under-cheek line
      { e: [0.0445, 0.704, 0.65], r: [0.016, 0.013, 0.016], k: 0.01, sub: true },      // eye sockets
      { e: [-0.0445, 0.704, 0.65], r: [0.016, 0.013, 0.016], k: 0.01, sub: true },
      { e: [0.0105, 0.677, 0.745], r: [0.005, 0.0042, 0.006], k: 0.003, sub: true },   // nostrils
      { e: [-0.0105, 0.677, 0.745], r: [0.005, 0.0042, 0.006], k: 0.003, sub: true },
    ]);
    const head = K.projectSDF({ sdf: headSDF, curve: new T.LineCurve3(V(0, 0.7, 0.49), V(0, 0.67, 0.74)), rows: nr(32), nu: nu(28), cap0: 0.22, cap1: 0.12, rmax: 0.2 });
    K.skin(head, [[I.head, 1]]);
    const eyeC = [V(0.0435, 0.703, 0.652), V(-0.0435, 0.703, 0.652)];
    const noseC = V(0, 0.68, 0.74), dotsL = [];
    for (const [x, y, z] of [[0.02, 0.668, 0.725], [0.032, 0.666, 0.715], [0.041, 0.662, 0.7], [0.026, 0.654, 0.727], [0.037, 0.65, 0.712], [0.044, 0.646, 0.695]]) dotsL.push([x, y, z]);
    const tearA = V(0.03, 0.692, 0.668), tearB = V(0.036, 0.664, 0.704), tmp = V(0, 0, 0);
    K.paint(head, (p, n) => {
      let c = furColor(p, n);
      const ax = Math.abs(p.x), sx = p.x >= 0 ? 1 : -1;
      // pale muzzle / upper lip / chin (the tawny stripe over the nasal bridge stays)
      const pale = sstep(0.672, 0.7, p.z) * sstep(0.704, 0.672, p.y + 0.012 * 0 - 0.012 * sstep(0.02, 0.0, ax)) + 0.6 * sstep(0.0, -0.5, n.y) * sstep(0.6, 0.66, p.z);
      c = mix(c, C.lipPale, Math.min(0.92, pale) + 0.5 * sstep(0.075, 0.09, ax) * sstep(0.66, 0.63, p.y) * sstep(0.56, 0.62, p.z));
      // dark: eye liner, tear lines from the inner eye corner down the muzzle, whisker-spot rows, nose leather + outline
      c = mix(c, C.mask, 0.85 * gs(p.distanceTo(eyeC[sx > 0 ? 0 : 1]), 0.017, 0.0042));
      tmp.set(ax, p.y, p.z);
      c = mix(c, C.mask, 0.8 * sstep(0.0065, 0.0035, K.segDist(tmp, tearA, tearB)));
      for (const d of dotsL) c = mix(c, C.mask, 0.85 * sstep(0.0048, 0.0028, Math.hypot(ax - d[0], p.y - d[1], p.z - d[2])));
      const dn = p.distanceTo(noseC);
      c = mix(c, C.nose, sstep(0.021, 0.016, dn));
      c = mix(c, C.noseEdge, 0.9 * gs(dn, 0.0215, 0.0035));
      c = mix(c, C.noseEdge, 0.6 * gs(ax, 0.0, 0.0035) * sstep(0.676, 0.7, p.z) * sstep(0.662, 0.676, p.y) * sstep(0.7, 0.68, p.y));   // philtrum
      c = mix(c, C.noseEdge, 0.75 * gs(p.y, 0.641, 0.0055) * sstep(0.66, 0.7, p.z) * sstep(0.3, -0.1, n.y));                         // lip line
      return mix(c, C.mouth, sstep(0.7, 0.725, p.z) * sstep(-0.35, -0.75, n.y) * sstep(0.645, 0.635, p.y));
    });
    parts.fur.push(head);
    const jawSDF = K.sdf([
      { c: [0, 0.652, 0.59, 0, 0.622, 0.698], ra: 0.038, rb: 0.021, sq: 1.2 },             // short, strong mandible
      { e: [0, 0.634, 0.64], r: [0.038, 0.024, 0.05], k: 0.025 },
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 0.648, 0.58), V(0, 0.622, 0.7)), rows: nr(16), nu: nu(18), cap0: 0.2, cap1: 0.2, rmax: 0.1 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => {
      let c = mix(C.lipPale, C.cream, 0.4);
      c = mix(c, C.noseEdge, Math.min(1, 0.5 * sstep(0.7, 0.72, p.z) + 0.5 * gs(p.y, 0.625, 0.005) * sstep(0.64, 0.69, p.z)));
      return mix(c, C.mouth, sstep(0.2, 0.75, n.y) * sstep(0.62, 0.66, p.z));
    });
    parts.fur.push(jaw);
    // tongue (hidden inside the closed mouth, shown by the lick and yawn actions)
    const tongue = K.sweep({
      pts: [V(0, 0.637, 0.62), V(0, 0.635, 0.665), V(0, 0.63, 0.695)], up: V(0, 1, 0),
      prof: (u, o) => { o[0] = 0.016 * (1 - 0.4 * u * u); o[1] = 0.0045; o[2] = 0.006; o[3] = 2.4; o[4] = 0; o[5] = 0; return o; }, rows: 6, nu: 8, cap0: 1, cap1: 2,
    });
    K.skin(tongue, [[I.jaw, 1]]); K.paint(tongue, C.tongue); parts.skin.push(tongue);
    // canines
    const fang = (pts, r, bone) => {
      const g = K.sweep({ pts, prof: (u, o) => { o[0] = r * (1 - 0.8 * u); o[1] = o[2] = r * 0.85 * (1 - 0.8 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 6, cap0: 1, cap1: 1, up: V(0, 0, 1) });
      K.skin(g, [[bone, 1]]); K.paint(g, C.tooth); return g;
    };
    for (const s of [-1, 1]) {
      parts.gloss.push(fang([V(s * 0.02, 0.652, 0.722), V(s * 0.021, 0.642, 0.724), V(s * 0.02, 0.632, 0.723)], 0.005, I.head));
      parts.gloss.push(fang([V(s * 0.016, 0.634, 0.694), V(s * 0.017, 0.642, 0.696), V(s * 0.016, 0.65, 0.695)], 0.0045, I.jaw));
      // amber eyes with a vertical slit pupil, set in the sockets, looking forward-outward
      const eye = new T.SphereGeometry(0.0145, Math.max(8, Math.round(14 * q)), Math.max(6, Math.round(10 * q)));
      eye.scale(1, 0.92, 1); eye.rotateY(s * 0.3); eye.translate(s * 0.043, 0.703, 0.652);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
      const pup = new T.SphereGeometry(0.0062, 8, 8); pup.scale(0.4, 1.9, 0.45);
      pup.rotateY(s * 0.3); pup.translate(s * (0.043 + 0.0042), 0.7035, 0.652 + 0.0129);
      parts.gloss.push(K.prim(pup, C.pupil, I.head));
    }

    /* ears: rounded, set wide and low, dark backs with a pale spot, pale inner fur */
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      const e = K.sweep({
        pts: [V(s * 0.05, 0.735, 0.522), V(s * 0.066, 0.775, 0.514), V(s * 0.082, 0.812, 0.504)], up: V(s * 0.8, 0.1, 0.55),
        prof: (u, o) => { o[0] = 0.047 * Math.pow(Math.max(0, 1 - Math.pow(u * 1.04, 2.6)), 0.5) + 0.002; o[1] = o[2] = 0.009 * (1 - 0.5 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        cup: (u) => -0.022 * Math.sin(PI * Math.min(1, u * 1.1)), rows: nr(10), nu: nu(16), cap0: 1, cap1: 2,
      });
      K.skin(e, (p) => [[I['ear' + sd], sstep(0.742, 0.756, p.y)], [I.head, 1 - sstep(0.742, 0.756, p.y)]]);
      K.paint(e, (p, n, info) => {
        const fr = n.z * 0.55 + n.x * s * 0.8 + n.y * 0.1, inner = sstep(-0.2, 0.3, fr);
        const rim = info ? sstep(0.93, 0.995, Math.abs(Math.sin(info.a))) : 0, tip = sstep(0.795, 0.815, p.y);
        const spot = gs(p.y, 0.772, 0.011) * sstep(0.1, -0.5, fr) * gs(p.x * s, 0.07, 0.013);
        let c = mix(C.earOut, C.earSpot, 0.9 * spot);
        c = mix(c, C.earIn, inner * sstep(0.742, 0.76, p.y) * (1 - Math.max(rim * 0.85, tip)));
        return c;
      });
      parts.fur.push(e);
    }

    /* tail: long, thick, drooping and curling up at the tip, dark tip, paler underside */
    const tailPts = [V(0, 0.6, -0.35), W('tail0'), W('tail1'), W('tail2'), W('tail3'), W('tail4'), W('tail5'), V(0, 0.17, -0.57)];
    const tailSegs = [['pelvis', 0, 1], ['tail0', 1, 2], ['tail1', 2, 3], ['tail2', 3, 4], ['tail3', 4, 5], ['tail4', 5, 6], ['tail5', 6, 7]].map((s) => [I[s[0]], tailPts[s[1]], tailPts[s[2]]]);
    const rc = M.curve([[0, 0.042], [0.12, 0.044], [0.5, 0.045], [0.85, 0.04], [0.96, 0.03], [1, 0.012]]), rq = [0];
    const tail = K.sweep({ pts: tailPts, up: V(1, 0, 0), prof: (u, o) => { rc(u, rq); o[0] = rq[0]; o[1] = rq[0] * 0.95; o[2] = rq[0]; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
      rows: nr(34), nu: nu(14), cap0: 0, cap1: 3 });
    K.skin(tail, (p) => K.envelope(tailSegs, p, 2.5));
    K.paint(tail, (p, n, info) => {
      const u = info ? info.s : 0;
      let c = mix(furColor(p, n), mul(C.tail, sleek(p)), sstep(0.05, 0.2, u));
      c = mix(c, C.cream, 0.45 * sstep(-0.2, -0.8, n.y) * sstep(0.1, 0.3, u));                // pale underside
      return mix(c, C.tailTip, sstep(0.84, 0.92, u));
    });
    parts.fur.push(tail);

    /* legs + paws (left built, right mirrored) */
    const legParts = [];
    const s = 1, sd = 'L';
    // hind: haunch -> hip -> stifle -> gaskin -> hock -> metatarsus -> paw joint
    const hipIn = V(s * 0.06, 0.585, -0.3);
    const hp = [hipIn, W('th' + sd), W('shin' + sd), W('met' + sd), W('hpaw' + sd)];
    const hs = jointS(hp);
    const hc = M.curve([
      [0, 0.058, 0.075, 0.085], [hs[1], 0.064, 0.088, 0.1], [lerp(hs[1], hs[2], 0.55), 0.056, 0.066, 0.092], [hs[2], 0.043, 0.048, 0.058],
      [lerp(hs[2], hs[3], 0.35), 0.038, 0.042, 0.062], [lerp(hs[2], hs[3], 0.75), 0.027, 0.027, 0.042], [hs[3], 0.025, 0.026, 0.035],
      [lerp(hs[3], 1, 0.4), 0.022, 0.022, 0.023], [1, 0.027, 0.025, 0.025]]);
    const hind = K.sweep({ pts: hp, up: V(0, 0, 1), prof: prof3(hc, 1.08), rows: nr(26), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.01 * gs(u, hs[3] - 0.01, 0.025) * ga(a, PI, 0.5) });
    K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('th' + sd)], [I['th' + sd], W('th' + sd), W('shin' + sd)], [I['shin' + sd], W('shin' + sd), W('met' + sd)], [I['met' + sd], W('met' + sd), W('hpaw' + sd)]], p, 4));
    K.paint(hind, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, mul(C.leg, sleek(p)), sstep(0.4, 0.28, p.y) * 0.8);
      c = mix(c, C.cream, sstep(0.3, 0.75, -n.x * s) * sstep(0.56, 0.44, p.y) * 0.45);                       // inner thigh
      return mix(c, mul(C.paw, sleek(p)), sstep(0.12, 0.06, p.y));
    });
    legParts.push(['fur', hind]);
    // fore: buried upper arm -> elbow -> thick forearm -> wrist -> pastern
    const shIn = V(s * 0.072, 0.595, 0.27);
    const fp = [shIn, W('hum' + sd), W('for' + sd), W('mc' + sd), W('fpaw' + sd)];
    const fs = jointS(fp);
    const fc = M.curve([
      [0, 0.054, 0.064, 0.064], [fs[1], 0.06, 0.068, 0.072], [lerp(fs[1], fs[2], 0.6), 0.052, 0.058, 0.064], [fs[2], 0.046, 0.048, 0.06],
      [lerp(fs[2], fs[3], 0.25), 0.045, 0.05, 0.047], [lerp(fs[2], fs[3], 0.8), 0.034, 0.035, 0.032], [fs[3], 0.031, 0.033, 0.031],
      [lerp(fs[3], 1, 0.5), 0.028, 0.028, 0.026], [1, 0.032, 0.03, 0.027]]);
    const fore = K.sweep({ pts: fp, up: V(0, 0, 1), prof: prof3(fc, 1.12), rows: nr(24), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.008 * gs(u, fs[2] + 0.005, 0.02) * ga(a, PI, 0.5) + 0.006 * gs(u, fs[3] - 0.01, 0.02) * ga(a, PI, 0.6) });
    K.skin(fore, (p) => K.envelope([[I['scap' + sd], shIn, W('hum' + sd)], [I['hum' + sd], W('hum' + sd), W('for' + sd)], [I['for' + sd], W('for' + sd), W('mc' + sd)], [I['mc' + sd], W('mc' + sd), W('fpaw' + sd)]], p, 4));
    K.paint(fore, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, mul(C.leg, sleek(p)), sstep(0.46, 0.36, p.y) * 0.8);
      c = mix(c, C.cream, sstep(0.0, 0.6, -n.x * s) * sstep(0.42, 0.28, p.y) * 0.6);                         // pale inner forearm
      return mix(c, mul(C.paw, sleek(p)), sstep(0.13, 0.07, p.y));
    });
    legParts.push(['fur', fore]);
    // paws: big round cushions, four toes up front, dark pads underneath
    const paw = (x0, z0, len, wid, bone, end) => {
      const pts = [V(x0, 0.05, z0 - 0.024), V(x0, 0.04, z0 + 0.006), V(x0, 0.03, z0 + len * 0.6), V(x0 + 0.001, 0.022, z0 + len)];
      const g = K.sweep({ pts, up: V(0, 1, 0),
        prof: (u, o) => { o[0] = lerp(wid * 0.75, wid, sstep(0.08, 0.5, u)) * (1 - 0.3 * sstep(0.8, 1, u)); o[1] = lerp(0.032, 0.022, u); o[2] = lerp(0.02, 0.018, u); o[3] = 2.1; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.0045 * sstep(0.55, 0.85, u) * Math.pow(Math.abs(Math.cos(a * 2)), 4) * ga(a, 0, 1.25), rows: nr(12), nu: nu(14), cap0: 2, cap1: 2 });
      K.skin(g, (p) => K.envelope([[bone, V(x0, 0.06, z0 - 0.03), V(x0, 0.04, z0)], [I[end], V(x0, 0.04, z0), V(x0, 0.018, z0 + len)]], p, 4));
      K.paint(g, (p, n) => mix(mul(C.paw, sleek(p)), C.pad, sstep(-0.2, -0.65, n.y)));
      return g;
    };
    legParts.push(['fur', paw(s * 0.08, 0.342, 0.085, 0.043, I['mc' + sd], 'fpaw' + sd)]);
    legParts.push(['fur', paw(s * 0.083, -0.384, 0.078, 0.036, I['met' + sd], 'hpaw' + sd)]);
    // claws: sheathed in the toe fur (bone scale ~0) until the strike; fore paws only, LOD0 only
    if (q >= 0.99) {
      for (const dx of [-0.028, -0.0095, 0.0095, 0.028]) {
        const x0 = s * 0.08, zt = 0.425 - 0.012 * Math.abs(dx) / 0.028;
        const cl = K.sweep({ pts: [V(x0 + dx * 0.4, 0.027, zt - 0.03), V(x0 + dx * 1.1, 0.021, zt + 0.005), V(x0 + dx * 1.35, 0.008, zt + 0.032)], up: V(0, 1, 0),
          prof: (u, o) => { o[0] = 0.0058 * (1 - 0.8 * u); o[1] = o[2] = 0.0052 * (1 - 0.8 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 5, nu: 6, cap0: 1, cap1: 1 });
        K.skin(cl, [[I['clw' + sd], 1]]); K.paint(cl, C.claw);
        legParts.push(['gloss', cl]);
      }
    }
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    for (const [slot, g] of legParts) { parts[slot].push(g); parts[slot].push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const ch = (n) => chan[n];
  const SIDES = ['L', 'R'];
  const clawsOut = (P, k) => { P[ch('clawsL')] += k; P[ch('clawsR')] += k; };
  const TAILS = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
  const legs = [
    { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: 0.04, toeLen: 0.085, lift: 0.1, curl: 0.7 },
    { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: 0.04, toeLen: 0.085, lift: 0.1, curl: 0.7 },
    { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: 0.04, toeLen: 0.075, lift: 0.095, curl: 0.55 },
    { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: 0.04, toeLen: 0.075, lift: 0.095, curl: 0.55 },
  ];
  const gaits = {
    walk: { stride: (v) => 0.4 + 0.22 * v, duty: 0.64, minV: 0.06 },
    stalk: { stride: (v) => 0.4 + 0.16 * v, duty: 0.74, minV: 0.06, liftK: () => 0.75 },
    trot: { stride: (v) => 0.62 + 0.2 * v, duty: 0.46, minV: 0.06 },
    gallop: { stride: (v) => 1.0 + 0.2 * v, duty: 0.26, dutyF: 0.22, minV: 0.06, liftK: () => 1.2 },
  };
  // lateral-sequence walk / stalk, diagonal trot, rotary gallop (hind L->R, fore R->L)
  const offsets = {
    HL: { walk: 0, stalk: 0, trot: 0.5, gallop: 0 }, FL: { walk: 0.25, stalk: 0.25, trot: 0, gallop: 0.62 },
    HR: { walk: 0.5, stalk: 0.5, trot: 0, gallop: 0.1 }, FR: { walk: 0.75, stalk: 0.75, trot: 0.5, gallop: 0.5 },
  };
  function select(v, cur) {
    if (this && this._mode === 'stalk' && v < 2.6) return 'stalk';
    if (cur === 'gallop') return v < 3.4 ? 'trot' : 'gallop';
    if (cur === 'trot') return v > 3.9 ? 'gallop' : v < 1.45 ? 'walk' : 'trot';
    return v > 1.75 ? 'trot' : 'walk';
  }
  // body bone local: hips at (y +0.02, z -0.28), shoulders at (y 0, z +0.24)
  const HIP = [0.02, -0.28];

  function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }
  function base(P, ctx, An) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    An.gait._mode = ctx.mode;
    const cur = An.v.sm.cur, atk = cur && cur.def.kind === 'attack';                                 // lunge root motion must not read as a gallop
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving && !atk ? Math.min(1, v / 0.6) : 0, atk ? 14 : 6, dt);
    const g = ctx.gaitName;
    ctx.gw = M.damp(ctx.gw || 0, g === 'gallop' && !atk ? 1 : 0, atk ? 14 : 5, dt);
    ctx.tw = M.damp(ctx.tw || 0, g === 'trot' && !atk ? 1 : 0, atk ? 14 : 5, dt);
    ctx.sw = M.damp(ctx.sw || 0, ctx.mode === 'stalk' ? 1 : 0, 3, dt);
    const mw = ctx.mw, idle = 1 - mw, gw = ctx.gw, tw = ctx.tw, sw = ctx.sw, ph = ctx.phase * TAU, walkW = Math.max(0, 1 - gw - tw);
    // vertical motion: walk / trot bob, gallop one big flight cycle; stalk = belly low, shoulders a touch lower than the hips
    P[ch('body.py')] += mw * (walkW * -0.01 * Math.cos(2 * ph) + tw * -0.02 * Math.cos(2 * ph) + gw * 0.05 * Math.sin(ph + 0.9)) - 0.02 * gw - 0.115 * sw;
    // gallop: the spine flexes (feet gathered, back arched) and extends (flight) - strong, cat-like
    const flex = gw * 0.3 * Math.sin(ph + 0.5);
    P[ch('pelvis.rx')] += flex; P[ch('chest.rx')] -= flex * 0.85; P[ch('body.rx')] -= flex * 0.25;
    P[ch('body.rx')] += gw * (0.05 * Math.sin(ph + 2.1) + 0.04) + sw * 0.08;
    // walk / stalk: lateral spine undulation, hip drop and sway, rolling shoulders (strong while stalking)
    P[ch('pelvis.rz')] += mw * (walkW + tw * 0.5) * 0.05 * Math.sin(ph);
    P[ch('pelvis.ry')] += mw * (walkW * 0.08 + sw * 0.03) * Math.sin(ph + 0.4);
    P[ch('chest.rz')] += mw * (walkW * 0.04 + sw * 0.08) * Math.sin(ph + PI * 0.5);
    P[ch('chest.ry')] += mw * (walkW * -0.07 + sw * -0.03) * Math.sin(ph + 0.4);
    P[ch('ribs.ry')] += mw * walkW * 0.03 * Math.sin(ph + 0.1);
    P[ch('body.rz')] += mw * walkW * 0.02 * Math.sin(ph);
    // bend into turns (the head leads)
    const tr = M.clamp(ctx.turn * 0.09, -0.3, 0.3);
    P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.55; P[ch('neck.ry')] += tr * 0.8; P[ch('head.ry')] += tr * 0.4;
    // idle: slow look-around, ears swivel independently
    const look = (vnoise3(t * 0.25, 1.3, 0) - 0.5) * 1.5, lookY = (vnoise3(t * 0.22, 4.1, 2) - 0.5) * 0.6;
    P[ch('neck.ry')] += idle * look * 0.4; P[ch('head.ry')] += idle * look * 0.35;
    P[ch('neck.rx')] += idle * (lookY * 0.25 - 0.06); P[ch('head.rx')] += idle * (lookY * 0.3 + 0.04);
    P[ch('body.px')] += idle * 0.01 * Math.sin(t * 0.4);
    P[ch('earL.ry')] += idle * 0.5 * (vnoise3(t * 0.5, 9, 1) - 0.5); P[ch('earR.ry')] += idle * 0.5 * (vnoise3(t * 0.5, 2, 7) - 0.5);
    P[ch('earL.rx')] += idle * 0.25 * (vnoise3(t * 0.4, 5, 3) - 0.5); P[ch('earR.rx')] += idle * 0.25 * (vnoise3(t * 0.4, 8, 6) - 0.5);
    // stalk: head dropped below the shoulders and held level, ears forward, shoulder blades rolling
    P[ch('neck.rx')] += sw * 0.72; P[ch('head.rx')] -= sw * 0.5;
    P[ch('earL.rx')] += sw * 0.25; P[ch('earR.rx')] += sw * 0.25;
    // head stabilisation: the neck cancels most of the body pitch + bob so the head glides
    const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
    P[ch('neck.rx')] -= bodyPitch * 0.75 - gw * 0.14 - tw * 0.06; P[ch('head.rx')] -= bodyPitch * 0.15 + gw * 0.1;
    P[ch('neck.rx')] += mw * (gw * 0.02 - walkW * 0.02) * Math.cos(2 * ph);
    // tail: hangs low with a lazy curl; stalk = low, still, tip twitching; gallop = streams out behind
    for (let i = 0; i < TAILS.length; i++) {
      const k = i === 0 ? 1 : 0.35;
      P[ch(TAILS[i] + '.rx')] += (i === 0 ? 0.5 : 0.2) * gw + (i === 0 ? 0.15 : 0.05) * tw - (i === 0 ? 0.18 : 0.04) * sw;
      P[ch(TAILS[i] + '.ry')] += mw * walkW * 0.07 * Math.sin(ph - 0.6 - i * 0.6) + idle * 0.07 * Math.sin(t * 0.8 - i * 0.55) * k + sw * 0.05 * Math.sin(t * 2.2 - i * 0.9) * (i > 2 ? 1 : 0.3);
    }
    P[ch('tail4.rx')] += sw * 0.1 * Math.sin(t * 3.1) + idle * 0.05 * Math.sin(t * 0.6 + 1);                 // tip twitch / lazy curl
    P[ch('tail5.rx')] += sw * 0.15 * Math.max(0, Math.sin(t * 3.1 + 0.8)) + idle * 0.06 * Math.sin(t * 0.6 + 1.7);
    // ears fold back at speed
    const back = gw * 0.9 + tw * 0.25;
    P[ch('earL.rx')] -= back * 0.55; P[ch('earR.rx')] -= back * 0.55; P[ch('earL.rz')] -= back * 0.2; P[ch('earR.rz')] += back * 0.2;
    // scapulae glide with the fore steps (shoulder blades visibly roll while stalking)
    const fL = An.gait.feet[0], fR = An.gait.feet[1];
    const sk = mw * (0.14 + 0.16 * sw + 0.08 * gw);
    P[ch('scapL.rx')] += sk * scapSwing(fL); P[ch('scapR.rx')] += sk * scapSwing(fR);
  }

  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0;
    if (Lg.type === 'hind') {
      if (f.planted) return Lg.restDistal - 0.3 * sstep(0.55, 1, f.stanceU) * mw;                  // hock extends on push-off
      return Lg.restDistal - 0.9 * Math.sin(PI * Math.min(1, f.swingU * 1.05));                    // hock flexes in swing
    }
    if (f.planted) return Lg.restDistal + 0.25 * sstep(0.6, 1, f.stanceU) * mw;                    // pastern rolls over
    return Lg.restDistal - 1.7 * Math.sin(PI * Math.min(1, f.swingU * 1.08));                      // wrist folds
  }
  function post(P, ctx, An) {
    const breath = Math.sin(ctx.t * (ctx.moving ? 7.5 + 2 * (ctx.gw || 0) : 2.4));
    An.B[I.ribs].scale.setScalar(ctx.dead ? 1 : 1 + 0.022 * breath);
    for (const sd of SIDES) An.B[I['clw' + sd]].scale.setScalar(0.02 + 0.98 * M.clamp(P[ch('claws' + sd)], 0, 1));   // retractable claws
  }
  function secondary(ctx, An) {
    const dt = ctx.dt, B = An.B;
    const tgt = -M.clamp(ctx.turn * 0.1, -0.6, 0.6);
    for (let i = 1; i < TAILS.length; i++) {
      const s = An.sp_('t' + i), x = K.stepSpring(s, tgt * (0.3 + 0.15 * i), 70 - i * 8, 7, dt);
      B[I[TAILS[i]]].rotateY(x * 0.3);
    }
    const bob = K.stepSpring(An.sp_('tb'), (An.B[I.body].position.y - BODY_Y) * -8, 80, 8, dt);
    B[I.tail1].rotateX(bob * 0.25); B[I.tail3].rotateX(bob * 0.2);
    const ey = K.stepSpring(An.sp_('ear'), (An.B[I.body].position.y - BODY_Y) * -12, 300, 16, dt);
    B[I.earL].rotateX(ey * 0.2); B[I.earR].rotateX(ey * 0.2);
  }
  const TAIL_IX = TAILS.map((n) => I[n]);
  const TAIL_END = TAILS.map((n, k) => (k < TAILS.length - 1 ? tpl.local[I[TAILS[k + 1]]].clone() : new T.Vector3(...ends.tail5).sub(tpl.world[I.tail5])));
  const TAIL_MIN = [0.06, 0.06, 0.055, 0.05, 0.045, 0.04];
  function ground(ctx, An) { K.groundChain(An, TAIL_IX, TAIL_END, TAIL_MIN); }
  function flinch(P, t, dir, pow) {
    const k = Math.exp(-t * 8) * Math.sin(Math.min(1, t * 11) * PI * 0.5) * pow;
    P[ch('body.px')] += dir[0] * 0.05 * k; P[ch('body.pz')] += dir[1] * 0.06 * k; P[ch('body.py')] -= 0.03 * k;
    P[ch('body.rz')] += -dir[0] * 0.14 * k; P[ch('chest.rx')] += 0.1 * k;
    P[ch('neck.rx')] -= 0.25 * k; P[ch('head.rx')] -= 0.15 * k; P[ch('head.ry')] += dir[0] * 0.3 * k; P[ch('jaw.rx')] += 0.4 * k;
    P[ch('earL.rx')] -= 0.7 * k; P[ch('earR.rx')] -= 0.7 * k; P[ch('tail0.rx')] -= 0.3 * k; clawsOut(P, 0.6 * k);
  }

  /* ---------------- actions: additive tracks keyed on the gameplay timeline instants (same numbers as the authority's hit window) ---------------- */
  const pa = D.attacks.pounce.phases, sa = D.attacks.swipe.phases;
  let swipeCount = 0;
  const actions = {
    pounce: {
      kind: 'attack', ground: true, dur: D.attacks.pounce.dur, blendIn: 0.1, blendOut: 0.25,
      track: (() => {
        const tr = K.track(chan, pa, {
          // s, an (drop into the crouch, eyes locked), wu (coiled: hips down + wiggling, jaws parting), hit (full stretch, claws out), fo (land), e
          'body.py': [0, -0.15, -0.18, -0.17, -0.04, 0],
          'body.rx': [0, 0.1, 0.12, -0.1, 0.09, 0],
          'body.pz': [0, -0.03, -0.07, 0.05, 0, 0],
          'pelvis.rx': [0, -0.2, -0.3, 0.3, 0.08, 0],
          'chest.rx': [0, 0.2, 0.22, -0.1, 0.12, 0],
          'neck.rx': [0, 0.3, 0.35, -0.2, 0.18, 0],
          'head.rx': [0, -0.25, -0.28, 0.1, 0.1, 0],
          'jaw.rx': [0, 0, 0.12, 0.62, 0.1, 0],
          'tail0.rx': [0, 0, 0.12, 0.35, 0.12, 0],
          'tail2.rx': [0, 0, 0, 0.2, 0.08, 0],
          'earL.rx': [0, 0.25, 0.1, -0.75, -0.45, 0], 'earR.rx': [0, 0.25, 0.1, -0.75, -0.45, 0],
          'clawsL': [0, 0, 0.25, 1, 0.9, 0], 'clawsR': [0, 0, 0.25, 1, 0.9, 0],
        });
        const air = (u) => sstep(pa.wu, pa.wu + 0.05, u) * (1 - sstep(pa.fo - 0.07, pa.fo + 0.03, u));              // all four legs in FK during the leap
        const _p = new T.Vector3();
        return (P, u, w, layer, ctx, An) => {
          tr(P, u, w);
          // coiled: butt wiggle + tail lash while the hips are down
          const wig = sstep(pa.s + 0.06, pa.an, u) * sstep(pa.wu + 0.01, pa.wu - 0.05, u);
          P[ch('pelvis.ry')] += Math.sin(u * 120) * 0.2 * wig * w; P[ch('pelvis.rz')] += Math.sin(u * 120 + 1.2) * 0.07 * wig * w;
          P[ch('chest.ry')] -= Math.sin(u * 120) * 0.06 * wig * w;
          for (let i = 0; i < TAILS.length; i++) P[ch(TAILS[i] + '.ry')] += Math.sin(u * 60 - i * 0.7) * 0.2 * wig * w;
          // the spring: the body rises out of the crouch, then follows the arc of the leap (root motion is horizontal and authoritative)
          const k = M.clamp01((u - pa.wu) / (pa.fo - pa.wu));
          P[ch('body.py')] += (sstep(pa.wu, pa.wu + 0.06, u) * (1 - sstep(pa.hit, pa.fo, u)) * 0.17 + Math.pow(Math.sin(PI * k), 0.85) * 0.15) * w;
          const a = air(u) * w;
          const fly = sstep(pa.wu, pa.hit, u), land = sstep(pa.hit, pa.fo, u);
          const rake = sstep(pa.hit - 0.03, pa.hit + 0.05, u) * (1 - sstep(pa.hit + 0.08, pa.fo, u));
          P[ch('ikFL')] -= a; P[ch('ikFR')] -= a; P[ch('ikHL')] -= a; P[ch('ikHR')] -= a;
          const spread = [0.1, -0.1];
          for (let i = 0; i < 2; i++) {
            const sd = SIDES[i];
            // forelegs: thrown forward to the prey, raking down through the strike, then reaching for the ground
            P[ch('hum' + sd + '.rx')] += (lerp(-0.25, -0.9, fly) + 0.3 * land) * a;
            P[ch('hum' + sd + '.ry')] += spread[i] * a * fly * (1 - land);
            P[ch('for' + sd + '.rx')] += (lerp(-0.2, -0.55, fly) + 0.45 * rake + 0.4 * land) * a;
            P[ch('mc' + sd + '.rx')] += (0.2 + 0.9 * rake - 0.25 * land) * a;
            P[ch('scap' + sd + '.rx')] -= 0.12 * a;
            // hind legs: push off, trail behind in the flight, gather again for the landing
            const trail = fly * (1 - 0.75 * land);
            P[ch('th' + sd + '.rx')] += 1.0 * trail * a; P[ch('shin' + sd + '.rx')] += -0.15 * trail * a; P[ch('met' + sd + '.rx')] += 0.3 * trail * a;
            P[ch('th' + sd + '.rz')] += (i ? -1 : 1) * 0.12 * trail * a;
          }
          // the gait engine must not drag the planted feet along the leap: keep re-anchoring them under the FK paws
          if (a > 0.02 && An) for (let li = 0; li < An.legs.length; li++) { An.B[An.legs[li].c[3]].getWorldPosition(_p); An.gait.plantAt(An.gait.feet[li], _p); }
        };
      })(),
    },
    swipe: {
      kind: 'attack', dur: D.attacks.swipe.dur, blendIn: 0.08, blendOut: 0.22,
      track: (() => {
        const tr = K.track(chan, sa, {
          'body.py': [0, -0.04, -0.03, 0.02, 0, 0],
          'body.rx': [0, 0.02, -0.12, -0.1, -0.02, 0],
          'chest.rx': [0, 0.04, -0.14, -0.12, 0, 0],
          'neck.rx': [0, 0.08, -0.12, -0.05, 0.05, 0],
          'jaw.rx': [0, 0, 0.1, 0.5, 0.15, 0],
          'tail0.rx': [0, 0.05, 0.15, 0.1, 0, 0],
          'earL.rx': [0, 0.15, -0.3, -0.6, -0.2, 0], 'earR.rx': [0, 0.15, -0.3, -0.6, -0.2, 0],
        });
        return (P, u, w, layer) => {
          tr(P, u, w);
          if (layer.data.side === undefined) layer.data.side = (swipeCount++ & 1) ? 1 : -1;          // alternate the paw
          const side = layer.data.side, sd = side > 0 ? 'L' : 'R';
          const air = sstep(sa.s + 0.04, sa.an + 0.08, u) * (1 - sstep(sa.fo - 0.02, sa.fo + 0.14, u)) * w;
          const cock = sstep(sa.an - 0.02, sa.wu, u) * (1 - sstep(sa.wu + 0.02, sa.hit, u));
          const slash = sstep(sa.wu + 0.02, sa.hit + 0.02, u) * (1 - sstep(sa.fo - 0.1, sa.fo + 0.08, u));
          P[ch('ikF' + sd)] -= air;
          P[ch('claws' + sd)] += sstep(sa.wu - 0.05, sa.wu + 0.05, u) * (1 - sstep(sa.fo, sa.fo + 0.22, u)) * w;
          // the cat rears onto the supporting paw, weight shifts away, torso turns into the blow
          const sw = Math.sin(PI * sstep(sa.s, sa.fo + 0.08, u)) * w;
          P[ch('chest.rz')] += -side * 0.1 * sw; P[ch('chest.ry')] += side * (-0.1 * sw + 0.3 * slash * w - 0.12 * cock * w);
          P[ch('pelvis.ry')] += -side * 0.08 * sw; P[ch('neck.ry')] += side * -0.2 * slash * w; P[ch('head.ry')] += side * -0.15 * slash * w;
          P[ch('body.px')] += -side * 0.03 * sw;
          // arm: a chambered wind-up (elbow back, forearm folded up beside the shoulder), then a fast snap across and forward
          // with the claws out - extension only at contact
          const w1 = sstep(sa.s + 0.02, sa.wu, u), w2 = sstep(sa.wu, sa.hit, u);
          const mixp = (c, s2) => c * w1 * (1 - w2) + s2 * w2;
          const hy = side * mixp(0.55, -0.7);
          P[ch('hum' + sd + '.rx')] += mixp(-0.75, -1.25) * air; P[ch('hum' + sd + '.ry')] += hy * air; P[ch('hum' + sd + '.rz')] += side * mixp(0.2, 0.0) * air;
          P[ch('for' + sd + '.rx')] += mixp(-1.4, -0.12) * air;
          P[ch('mc' + sd + '.rx')] += mixp(0.3, 0.45) * air;
          P[ch('scap' + sd + '.rx')] -= 0.3 * air;
        };
      })(),
    },
    stagger: {
      kind: 'stagger', dur: 0.8, blendIn: 0.05, blendOut: 0.25,
      track: (P, u, w) => {
        const k = Math.sin(PI * Math.min(1, u * 1.4)) * sstep(1, 0.6, u) * w;
        P[ch('body.pz')] -= 0.08 * k; P[ch('body.py')] -= 0.07 * k; P[ch('body.rz')] += 0.12 * Math.sin(u * 18) * k;
        P[ch('neck.rx')] -= 0.3 * k; P[ch('head.ry')] += 0.4 * Math.sin(u * 14) * k; P[ch('jaw.rx')] += 0.5 * k;
        P[ch('earL.rx')] -= 0.8 * k; P[ch('earR.rx')] -= 0.8 * k; P[ch('tail0.rx')] -= 0.4 * k;
        P[ch('chest.rx')] += 0.1 * k; clawsOut(P, 0.5 * k);
      },
    },
    lick: {
      kind: 'special', dur: 3.4, blendIn: 0.4, blendOut: 0.45,
      track: (P, u, w, layer) => {
        // sits back on the haunches a little, raises a forepaw to the mouth, head bowed to it, licking
        if (layer.data.lickSide === undefined) layer.data.lickSide = Math.random() < 0.5 ? 1 : -1;
        const side = layer.data.lickSide, sd = side > 0 ? 'L' : 'R';
        const env = M.ease.io(sstep(0, 0.2, u)) * M.ease.io(sstep(1, 0.8, u)) * w;
        P[ch('ikF' + sd)] -= env;
        P[ch('body.py')] -= 0.03 * env;
        K.pitchAbout(P, chan, -0.1 * env, HIP[0], HIP[1]);
        P[ch('hum' + sd + '.rx')] += -0.55 * env; P[ch('hum' + sd + '.rz')] += side * -0.12 * env;
        P[ch('for' + sd + '.rx')] += -2.3 * env; P[ch('mc' + sd + '.rx')] += -0.3 * env;
        P[ch('neck.rx')] += 0.9 * env; P[ch('head.rx')] += 0.2 * env; P[ch('neck.ry')] += side * 0.35 * env; P[ch('head.ry')] += side * 0.25 * env;
        const lickW = sstep(0.28, 0.36, u) * sstep(0.85, 0.75, u);
        const lk = Math.max(0, Math.sin(u * 62)) * lickW * w;
        P[ch('jaw.rx')] += (0.1 + 0.28 * lk) * env; P[ch('head.rx')] += 0.05 * Math.sin(u * 62) * lickW * w;
        P[ch('mc' + sd + '.rx')] += 0.1 * Math.sin(u * 31) * lickW * w;
        P[ch('earL.rx')] -= 0.2 * env; P[ch('earR.rx')] -= 0.2 * env;
        for (let i = 0; i < TAILS.length; i++) P[ch(TAILS[i] + '.ry')] += 0.1 * Math.sin(u * 7 - i * 0.6) * env;
      },
    },
    scan: {
      kind: 'special', dur: 3.2, blendIn: 0.3, blendOut: 0.4,
      track: (P, u, w) => {
        // head up, ears swivelling independently, a slow look to one side then the other
        const env = M.ease.io(sstep(0, 0.15, u)) * M.ease.io(sstep(1, 0.85, u)) * w;
        P[ch('neck.rx')] -= 0.3 * env; P[ch('head.rx')] += 0.06 * env;
        const yaw = Math.sin(u * PI * 2) * 0.75;
        P[ch('neck.ry')] += yaw * 0.55 * env; P[ch('head.ry')] += yaw * 0.45 * env;
        P[ch('earL.rx')] += 0.3 * env; P[ch('earR.rx')] += 0.3 * env;
        P[ch('earL.ry')] += (0.5 * Math.sin(u * 17) + yaw * 0.3) * env; P[ch('earR.ry')] += (0.5 * Math.sin(u * 13 + 1.3) - yaw * 0.3) * env;
        P[ch('earL.rz')] += 0.25 * Math.sin(u * 11) * env; P[ch('earR.rz')] += 0.25 * Math.sin(u * 9 + 2) * env;
        P[ch('chest.ry')] += yaw * 0.1 * env;
        for (let i = 2; i < TAILS.length; i++) P[ch(TAILS[i] + '.ry')] += 0.25 * Math.sin(u * 14 - i * 0.7) * env;
      },
    },
    yawn: {
      kind: 'special', dur: 3.0, blendIn: 0.4, blendOut: 0.5,
      track: (P, u, w) => {
        // a low growl-yawn: head dips, muzzle lifts, the jaw gapes wide, ears flatten, a shudder of the tail tip
        const env = M.ease.io(sstep(0, 0.22, u)) * M.ease.io(sstep(1, 0.78, u)) * w;
        const gape = sstep(0.22, 0.42, u) * sstep(0.8, 0.62, u) * w;
        P[ch('body.py')] -= 0.025 * env;
        P[ch('neck.rx')] += 0.2 * env - 0.55 * gape; P[ch('head.rx')] += -0.28 * gape;
        P[ch('jaw.rx')] += (0.82 + 0.05 * Math.sin(u * 40)) * gape;
        P[ch('earL.rx')] -= 0.75 * gape; P[ch('earR.rx')] -= 0.75 * gape; P[ch('earL.rz')] -= 0.25 * gape; P[ch('earR.rz')] += 0.25 * gape;
        P[ch('chest.rx')] += 0.08 * env; P[ch('body.rz')] += 0.015 * Math.sin(u * 50) * gape;
        clawsOut(P, 0.35 * gape);
        P[ch('tail4.rx')] += 0.2 * Math.sin(u * 22) * env; P[ch('tail5.rx')] += 0.3 * Math.sin(u * 22 + 1) * env;
      },
    },
    death: {
      kind: 'death', dur: 1.8, blendIn: 0.06, hold: true,
      track: (P, u, w, layer) => {
        const side = layer.data.side || 1;
        // forelegs buckle first (chest drops), then the body rolls onto its side and settles, a last kick
        const buckle = M.ease.io(sstep(0.0, 0.28, u)), fall = M.ease.io(sstep(0.15, 0.55, u)), kick = sstep(0.55, 0.62, u) * sstep(0.9, 0.62, u);
        P[ch('body.rx')] += (0.3 * buckle - 0.2 * fall) * w;
        P[ch('body.rz')] += side * 1.45 * fall * w;
        P[ch('body.py')] += (-0.12 * buckle - 0.28 * fall) * w; P[ch('body.px')] += -side * 0.1 * fall * w;
        P[ch('chest.rx')] += 0.12 * fall * w; P[ch('pelvis.rx')] -= 0.12 * fall * w;
        P[ch('neck.rx')] += (0.55 * buckle - 0.15 * fall) * w; P[ch('head.rx')] += 0.25 * fall * w; P[ch('jaw.rx')] += 0.3 * fall * w;
        P[ch('neck.ry')] += side * 0.25 * fall * w;
        const ikF = sstep(0.04, 0.2, u) * w, ikH = sstep(0.18, 0.4, u) * w;
        P[ch('ikFL')] -= ikF; P[ch('ikFR')] -= ikF; P[ch('ikHL')] -= ikH; P[ch('ikHR')] -= ikH;
        for (const sd of ['L', 'R']) {
          const top = sd === (side > 0 ? 'L' : 'R') ? 1 : 0;
          P[ch('hum' + sd + '.rz')] += side * (0.2 + 0.1 * top) * fall * w; P[ch('th' + sd + '.rz')] += side * (0.16 + 0.1 * top) * fall * w;
          P[ch('hum' + sd + '.rx')] += (-0.35 - 0.3 * top + 0.4 * (1 - fall) * buckle - 0.15 * kick * Math.sin(u * 50)) * w;
          P[ch('for' + sd + '.rx')] += (0.25 + 0.35 * top + 0.5 * buckle * (1 - fall)) * w; P[ch('mc' + sd + '.rx')] += (0.25 + 0.45 * top) * fall * w;
          P[ch('th' + sd + '.rx')] += (0.25 + 0.3 * top + 0.2 * kick * Math.sin(u * 45 + 1)) * fall * w;
          P[ch('shin' + sd + '.rx')] -= (0.25 + 0.35 * top) * fall * w; P[ch('met' + sd + '.rx')] += (0.35 + 0.2 * top) * fall * w;
        }
        for (let i = 0; i < TAILS.length; i++) { P[ch(TAILS[i] + '.ry')] += side * 0.3 * fall * w; P[ch(TAILS[i] + '.rx')] += (i === 0 ? 0.35 : 0.1) * fall * w; }
        P[ch('earL.rx')] -= 0.6 * fall * w; P[ch('earR.rx')] -= 0.6 * fall * w;
      },
    },
  };

  K.defineSpecies('panther', {
    rig: tpl, chan, build, lowQ: 0.6, animator: K.QuadAnimator, debugScale: 2.2,
    anim: { legs, gaits, offsets, select, base, distal, post, secondary, ground, flinch, actions, gaitOpts: { restTol: 0.11, idleStepDur: 0.3 }, groundFix: true },
    clips: ['idle', 'walk', 'stalk', 'run', 'pounce', 'swipe', 'lick', 'scan', 'yawn', 'hit', 'death'],
    attackAction: { pounce: 'pounce', swipe: 'swipe' }, specials: ['lick', 'scan', 'yawn'],
    def: D,
  });
})();
