/* Meadow Rat (levels 1-2): small, low, pear-shaped rodent - heavy haunches, arched back, narrow shoulders, pointed
 * muzzle with whisker pads, round thin ears, plantigrade hind feet, long scaly tapering tail.
 * Locomotion: lateral-sequence walk -> trot -> half-bound (spine flexion). Special idles: sniff (nose twitch + look
 * around), rear (stands on the hind legs). Attack: bite (crouch, draw back, snap lunge, head shake, recover). */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- skeleton (world bind positions, metres) ---------------- */
  const BODY_Y = 0.165;
  const L = (x) => x, Rr = (x) => -x;
  const bones = [
    ['body', null, 0, BODY_Y, 0.0],
    ['ribs', 'body', 0, 0.15, 0.02],
    ['pelvis', 'body', 0, 0.158, -0.12],
    ['tail0', 'pelvis', 0, 0.142, -0.232, 'tail1'], ['tail1', 'tail0', 0, 0.122, -0.33, 'tail2'], ['tail2', 'tail1', 0, 0.092, -0.43, 'tail3'],
    ['tail3', 'tail2', 0, 0.058, -0.53, 'tail4'], ['tail4', 'tail3', 0, 0.034, -0.64],
    ['chest', 'body', 0, 0.156, 0.1],
    ['neck', 'chest', 0, 0.158, 0.19, 'head'],
    ['head', 'neck', 0, 0.168, 0.262],
    ['jaw', 'head', 0, 0.138, 0.298],
    ['earL', 'head', 0.031, 0.203, 0.284], ['earR', 'head', -0.031, 0.203, 0.284],
  ];
  for (const [s, f] of [['L', L], ['R', Rr]]) {
    bones.push(
      ['scap' + s, 'chest', f(0.036), 0.182, 0.108, 'hum' + s],
      ['hum' + s, 'scap' + s, f(0.05), 0.122, 0.138, 'for' + s],
      ['for' + s, 'hum' + s, f(0.056), 0.074, 0.112, 'mc' + s],
      ['mc' + s, 'for' + s, f(0.054), 0.024, 0.148, 'fpaw' + s],
      ['fpaw' + s, 'mc' + s, f(0.054), 0.011, 0.166],
      ['th' + s, 'pelvis', f(0.05), 0.13, -0.14, 'shin' + s],
      ['shin' + s, 'th' + s, f(0.066), 0.083, -0.078, 'met' + s],
      ['met' + s, 'shin' + s, f(0.062), 0.024, -0.162, 'hpaw' + s],
      ['hpaw' + s, 'met' + s, f(0.062), 0.011, -0.098],
    );
  }
  const ends = {
    tail4: [0, 0.02, -0.77], head: [0, 0.141, 0.42], jaw: [0, 0.122, 0.386], earL: [0.058, 0.252, 0.274], earR: [-0.058, 0.252, 0.274],
    fpawL: [0.054, 0.007, 0.192], fpawR: [-0.054, 0.007, 0.192], hpawL: [0.063, 0.007, -0.066], hpawR: [-0.063, 0.007, -0.066],
    body: [0, 0.156, 0.1], pelvis: [0, 0.142, -0.232], chest: [0, 0.158, 0.19], ribs: [0, 0.15, 0.1],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikFL', 'ikFR', 'ikHL', 'ikHR', 'nose']);

  /* ---------------- palette (display-space vertex colours, muted earth browns) ---------------- */
  const C = {
    // calibrated against the heroes under the game's lighting (hero skin 0x9c5f44 renders ~1.45x brighter)
    back: [0.2, 0.15, 0.11], side: [0.3, 0.235, 0.17], belly: [0.47, 0.42, 0.35], muzzle: [0.32, 0.26, 0.2],
    earIn: [0.36, 0.24, 0.22], earOut: [0.25, 0.19, 0.15], tail: [0.33, 0.25, 0.23], tailTop: [0.24, 0.18, 0.16],
    foot: [0.27, 0.195, 0.17], nose: [0.24, 0.15, 0.15], mouth: [0.14, 0.06, 0.06], eye: [0.03, 0.025, 0.025], tooth: [0.62, 0.48, 0.26],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  function furColor(p, n) {
    // countershading: dark dorsal line -> warm sides -> pale belly (by surface normal), fur breakup noise
    const up = n.y, dors = sstep(0.35, 0.95, up), ven = sstep(-0.15, -0.75, up);
    let c = mix(C.side, C.back, dors);
    c = mix(c, C.belly, ven * 0.9);
    const k = 0.9 + 0.16 * vnoise3(p.x * 70, p.y * 70, p.z * 70) - 0.06 * gs(Math.abs(p.x), 0, 0.015) * dors;
    return mul(c, k);
  }

  /* ---------------- geometry ---------------- */
  const SPINE = [
    ['pelvis', V(0, 0.15, -0.26), V(0, 0.16, -0.07)], ['body', V(0, 0.16, -0.07), V(0, 0.156, 0.06)],
    ['chest', V(0, 0.156, 0.06), V(0, 0.156, 0.165)], ['neck', V(0, 0.156, 0.165), V(0, 0.166, 0.245)], ['head', V(0, 0.166, 0.245), V(0, 0.17, 0.3)],
  ].map((s) => [I[s[0]], s[1], s[2]]);
  function build(q, tplArg) {
    const parts = { fur: [], skin: [], gloss: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    /* body: SDF masses, projected along the arched spine */
    const bodySDF = K.sdf([
      { e: [0, 0.15, -0.115], r: [0.08, 0.082, 0.125] },                              // rump / haunch mass
      { e: [0, 0.128, -0.005], r: [0.074, 0.07, 0.115], k: 0.06 },                    // abdomen
      { e: [0, 0.142, 0.085], r: [0.058, 0.066, 0.085], k: 0.05 },                    // rib cage
      { e: [0, 0.18, -0.035], r: [0.05, 0.034, 0.14], k: 0.05 },                      // arched back line
      { e: [0.04, 0.138, 0.118], r: [0.032, 0.048, 0.045], k: 0.035 },               // shoulders
      { e: [-0.04, 0.138, 0.118], r: [0.032, 0.048, 0.045], k: 0.035 },
      { e: [0.056, 0.118, -0.118], r: [0.038, 0.058, 0.062], rot: [0.35, 0, 0], k: 0.04 },   // thighs (haunch bulge)
      { e: [-0.056, 0.118, -0.118], r: [0.038, 0.058, 0.062], rot: [0.35, 0, 0], k: 0.04 },
      { c: [0, 0.15, 0.13, 0, 0.165, 0.262], ra: 0.05, rb: 0.04, k: 0.04 },          // neck
      { e: [0, 0.128, 0.19], r: [0.036, 0.034, 0.05], k: 0.03 },                      // throat
    ]);
    const spine = new T.CatmullRomCurve3([V(0, 0.15, -0.2), V(0, 0.158, -0.12), V(0, 0.162, -0.02), V(0, 0.155, 0.09), V(0, 0.158, 0.18), V(0, 0.168, 0.25)], false, 'centripetal');
    const body = K.projectSDF({ sdf: bodySDF, curve: spine, rows: nr(46), nu: nu(30), cap0: 0.16, cap1: 0.1, rmax: 0.26 });
    const hip = { L: W('thL'), R: W('thR') }, sh = { L: W('humL'), R: W('humR') };
    K.skin(body, (p) => {
      const sd = p.x >= 0 ? 'L' : 'R';
      const ex = [
        [I['th' + sd], 0.55 * gs(p.distanceTo(hip[sd]), 0, 0.05) * sstep(0.008, 0.04, Math.abs(p.x))],
        [I['scap' + sd], 0.5 * gs(p.distanceTo(sh[sd]), 0, 0.05) * sstep(0.008, 0.035, Math.abs(p.x))],
        [I.ribs, 0.55 * gs(p.z, 0.0, 0.075) * sstep(0.15, 0.115, p.y)],
      ];
      return K.envelope(SPINE, p, 4, ex);
    });
    K.paint(body, (p, n) => furColor(p, n));
    parts.fur.push(body);

    /* head: skull + muzzle sculpt along the head axis; separate mandible on the jaw bone */
    const headSDF = K.sdf([
      { e: [0, 0.178, 0.29], r: [0.036, 0.042, 0.058] },                               // cranium
      { c: [0, 0.168, 0.31, 0, 0.137, 0.404], ra: 0.036, rb: 0.013, k: 0.025 },        // muzzle
      { e: [0.019, 0.155, 0.305], r: [0.018, 0.023, 0.034], k: 0.016 },                  // masseter / cheeks
      { e: [-0.019, 0.155, 0.305], r: [0.018, 0.023, 0.034], k: 0.016 },
      { e: [0.012, 0.136, 0.386], r: [0.015, 0.014, 0.02], k: 0.012 },                 // whisker pads
      { e: [-0.012, 0.136, 0.386], r: [0.015, 0.014, 0.02], k: 0.012 },
      { e: [0, 0.168, 0.352], r: [0.018, 0.016, 0.05], k: 0.02 },                      // nasal bridge
      { e: [0, 0.141, 0.414], r: [0.0105, 0.0095, 0.0095], k: 0.008 },                 // nose
      { e: [0, 0.138, 0.322], r: [0.026, 0.02, 0.042], k: 0.02 },                      // under-jaw / throat line
      { e: [0.0305, 0.1835, 0.3225], r: [0.0098, 0.009, 0.011], k: 0.006, sub: true },  // eye sockets
      { e: [-0.0305, 0.1835, 0.3225], r: [0.0098, 0.009, 0.011], k: 0.006, sub: true },
    ]);
    const hAxis = new T.LineCurve3(V(0, 0.172, 0.252), V(0, 0.143, 0.408));
    const head = K.projectSDF({ sdf: headSDF, curve: hAxis, rows: nr(30), nu: nu(28), cap0: 0.24, cap1: 0.14, rmax: 0.12 });
    K.skin(head, [[I.head, 1]]);
    K.paint(head, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, C.muzzle, sstep(0.36, 0.4, p.z) * 0.6);
      c = mix(c, C.nose, gs(p.distanceTo(V(0, 0.142, 0.418)), 0, 0.009));
      const mouth = sstep(0.34, 0.37, p.z) * sstep(-0.3, -0.7, n.y) * sstep(0.135, 0.128, p.y);
      return mix(c, C.mouth, mouth);
    });
    parts.fur.push(head);
    const jawSDF = K.sdf([
      { c: [0, 0.137, 0.3, 0, 0.122, 0.384], ra: 0.021, rb: 0.009, sq: 1.25 },
      { e: [0, 0.13, 0.33], r: [0.019, 0.013, 0.04], k: 0.015 },
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 0.135, 0.3), V(0, 0.123, 0.382)), rows: nr(14), nu: nu(16), cap0: 0.2, cap1: 0.2, rmax: 0.06 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => mix(mix(C.belly, C.muzzle, 0.4), C.mouth, sstep(0.3, 0.8, n.y) * sstep(0.33, 0.36, p.z)));
    parts.fur.push(jaw);
    // incisors (the rat's landmark) and eyes, nose leather
    for (const s of [-1, 1]) {
      const up = K.sweep({ pts: [V(s * 0.0038, 0.131, 0.401), V(s * 0.004, 0.1245, 0.405), V(s * 0.004, 0.119, 0.403)], prof: (u, o) => { o[0] = 0.0026; o[1] = 0.0018 * (1 - 0.4 * u); o[2] = 0.0018; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 6, cap0: 1, cap1: 2, up: V(0, 0, 1) });
      K.skin(up, [[I.head, 1]]); K.paint(up, C.tooth); parts.gloss.push(up);
      const lo = K.sweep({ pts: [V(s * 0.003, 0.119, 0.382), V(s * 0.0032, 0.1235, 0.388), V(s * 0.003, 0.1275, 0.391)], prof: (u, o) => { o[0] = 0.0022; o[1] = 0.0015; o[2] = 0.0015; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 6, cap0: 1, cap1: 2, up: V(0, 0, 1) });
      K.skin(lo, [[I.jaw, 1]]); K.paint(lo, C.tooth); parts.gloss.push(lo);
      const eye = new T.SphereGeometry(0.0108, Math.max(8, Math.round(12 * q)), Math.max(6, Math.round(9 * q)));
      eye.translate(s * 0.0318, 0.1838, 0.3235);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
    }
    const noseG = new T.SphereGeometry(0.0085, 10, 7); noseG.scale(1.15, 0.85, 0.8); noseG.translate(0, 0.1435, 0.4205);
    parts.gloss.push(K.prim(noseG, C.nose, I.head));

    /* ears: thin cupped discs on ear bones (inner face pink) */
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      const e = K.sweep({
        pts: [V(s * 0.027, 0.196, 0.283), V(s * 0.041, 0.226, 0.279), V(s * 0.054, 0.254, 0.272)], up: V(s * 0.75, 0.05, 0.66),
        prof: (u, o) => { o[0] = 0.009 + 0.014 * Math.sin(Math.min(1, u * 1.05) * PI * 0.78) * (1 - 0.5 * sstep(0.7, 1, u)); o[1] = o[2] = 0.0022; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        cup: (u) => -0.0065 * Math.sin(PI * Math.min(1, u * 1.1)), rows: nr(10), nu: nu(16), cap0: 1, cap1: 4,
      });
      K.skin(e, (p) => [[I['ear' + sd], sstep(0.205, 0.215, p.y)], [I.head, 1 - sstep(0.205, 0.215, p.y)]]);
      K.paint(e, (p, n) => mix(C.earOut, C.earIn, sstep(-0.1, 0.5, n.z * 0.66 + n.x * s * 0.75) * sstep(0.21, 0.225, p.y)));
      parts.fur.push(e);
    }

    /* tail: scaly, tapering, fur only at the root */
    const tailPts = [V(0, 0.152, -0.2), W('tail0'), W('tail1'), W('tail2'), W('tail3'), W('tail4'), V(0, 0.02, -0.77)];
    const tailSegs = [['pelvis', 0, 1], ['tail0', 1, 2], ['tail1', 2, 3], ['tail2', 3, 4], ['tail3', 4, 5], ['tail4', 5, 6]].map((s) => [I[s[0]], tailPts[s[1]], tailPts[s[2]]]);
    const rc = M.curve([[0, 0.022], [0.1, 0.017], [0.3, 0.0125], [0.65, 0.0075], [1, 0.0026]]), rq = [0];
    const tail = K.sweep({ pts: tailPts, prof: (u, o) => { rc(u, rq); o[0] = rq[0]; o[1] = rq[0] * 0.95; o[2] = rq[0]; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
      rows: nr(40), nu: nu(10), cap0: 0, cap1: 2 });
    K.skin(tail, (p) => K.envelope(tailSegs, p, 4));
    K.paint(tail, (p, n, info) => {
      const u = info ? info.s : 0, fur = sstep(0.1, 0.03, u);
      const ring = 0.93 + 0.07 * Math.sin(u * 260);                                    // faint scale rings
      const c = mix(C.tail, C.tailTop, sstep(0.1, 0.8, n.y));
      return mix(mul(c, ring), furColor(p, n), fur);
    });
    parts.skin.push(tail);

    /* legs + paws, built on the left and mirrored */
    const legParts = [];
    for (const [s, sd] of [[1, 'L']]) {
      const hipIn = V(s * 0.034, 0.168, -0.12);
      const hp = [hipIn, W('th' + sd), W('shin' + sd), V(s * 0.064, 0.048, -0.128), W('met' + sd)];
      const hc = M.curve([[0, 0.03, 0.04, 0.045], [0.22, 0.034, 0.047, 0.052], [0.46, 0.02, 0.02, 0.03], [0.7, 0.013, 0.012, 0.019], [1, 0.0095, 0.009, 0.011]]), hq = [0, 0, 0];
      const hind = K.sweep({ pts: hp, up: V(0, 0, 1), prof: (u, o) => { hc(u, hq); o[0] = hq[0]; o[1] = hq[1]; o[2] = hq[2]; o[3] = 2.1; o[4] = 0; o[5] = 0; return o; }, rows: nr(22), nu: nu(14), cap0: 2, cap1: 2 });
      K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('th' + sd)], [I['th' + sd], W('th' + sd), W('shin' + sd)], [I['shin' + sd], W('shin' + sd), W('met' + sd)], [I['met' + sd], W('met' + sd), W('hpaw' + sd)]], p, 4));
      K.paint(hind, (p, n) => mix(furColor(p, n), C.foot, sstep(0.04, 0.02, p.y)));
      legParts.push(['fur', hind]);
      const foot = K.sweep({ pts: [V(s * 0.062, 0.021, -0.17), V(s * 0.062, 0.015, -0.13), V(s * 0.062, 0.0105, -0.094), V(s * 0.063, 0.0075, -0.064)], up: V(0, 1, 0),
        prof: (u, o) => { o[0] = lerp(0.0115, 0.0175, sstep(0.2, 0.75, u)) * (1 - 0.45 * sstep(0.85, 1, u)); o[1] = lerp(0.0095, 0.006, u); o[2] = lerp(0.0085, 0.0055, u); o[3] = 2.3; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.0018 * sstep(0.72, 0.9, u) * Math.pow(Math.abs(Math.cos(a * 2.5)), 3) * ga(a, 0, 1.2), rows: nr(10), nu: nu(12), cap0: 2, cap1: 2 });
      K.skin(foot, (p) => K.envelope([[I['met' + sd], W('met' + sd), W('hpaw' + sd)], [I['hpaw' + sd], W('hpaw' + sd), V(s * 0.063, 0.007, -0.066)]], p, 4));
      K.paint(foot, (p, n) => mul(C.foot, 0.92 + 0.08 * n.y));
      legParts.push(['skin', foot]);
      const shIn = V(s * 0.026, 0.165, 0.12);
      const fp = [shIn, W('hum' + sd), W('for' + sd), W('mc' + sd)];
      const fc = M.curve([[0, 0.02, 0.024, 0.024], [0.3, 0.022, 0.026, 0.028], [0.56, 0.016, 0.014, 0.02], [1, 0.0085, 0.0075, 0.0085]]), fq = [0, 0, 0];
      const fore = K.sweep({ pts: fp, up: V(0, 0, 1), prof: (u, o) => { fc(u, fq); o[0] = fq[0]; o[1] = fq[1]; o[2] = fq[2]; o[3] = 2.1; o[4] = 0; o[5] = 0; return o; }, rows: nr(18), nu: nu(12), cap0: 2, cap1: 2 });
      K.skin(fore, (p) => K.envelope([[I['scap' + sd], shIn, W('hum' + sd)], [I['hum' + sd], W('hum' + sd), W('for' + sd)], [I['for' + sd], W('for' + sd), W('mc' + sd)], [I['mc' + sd], W('mc' + sd), W('fpaw' + sd)]], p, 4));
      K.paint(fore, (p, n) => mix(furColor(p, n), C.foot, sstep(0.04, 0.022, p.y)));
      legParts.push(['fur', fore]);
      const hand = K.sweep({ pts: [V(s * 0.054, 0.03, 0.142), V(s * 0.054, 0.016, 0.157), V(s * 0.054, 0.0095, 0.176), V(s * 0.055, 0.0068, 0.194)], up: V(0, 1, 0),
        prof: (u, o) => { o[0] = lerp(0.0085, 0.0115, sstep(0.2, 0.7, u)) * (1 - 0.45 * sstep(0.85, 1, u)); o[1] = 0.0062; o[2] = 0.0052; o[3] = 2.3; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.0014 * sstep(0.65, 0.88, u) * Math.pow(Math.abs(Math.cos(a * 2.5)), 3) * ga(a, 0, 1.2), rows: nr(9), nu: nu(10), cap0: 2, cap1: 2 });
      K.skin(hand, (p) => K.envelope([[I['mc' + sd], W('mc' + sd), W('fpaw' + sd)], [I['fpaw' + sd], W('fpaw' + sd), V(s * 0.054, 0.007, 0.192)]], p, 4));
      K.paint(hand, C.foot);
      legParts.push(['skin', hand]);
    }
    // mirror the left limbs to the right (bone names L -> R)
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    for (const [slot, g] of legParts) { parts[slot].push(g); parts[slot].push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const D = CREATURE_DEFS.SPECIES.rat;
  const ch = (n) => chan[n];
  const TAILS = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'];
  const legs = [
    { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: 0.011, toeLen: 0.026, lift: 0.035, curl: 1.0 },
    { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: 0.011, toeLen: 0.026, lift: 0.035, curl: 1.0 },
    { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: 0.011, toeLen: 0.03, lift: 0.04, curl: 0.6 },
    { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: 0.011, toeLen: 0.03, lift: 0.04, curl: 0.6 },
  ];
  const gaits = {
    walk: { stride: (v) => 0.12 + 0.11 * v, duty: 0.64, minV: 0.06 },
    trot: { stride: (v) => 0.2 + 0.1 * v, duty: 0.46, minV: 0.06 },
    bound: { stride: (v) => 0.28 + 0.09 * v, duty: 0.36, dutyF: 0.25, minV: 0.06, liftK: () => 1.25 },
  };
  const offsets = {
    HL: { walk: 0, trot: 0.5, bound: 0 }, FL: { walk: 0.25, trot: 0, bound: 0.5 },
    HR: { walk: 0.5, trot: 0, bound: 0.07 }, FR: { walk: 0.75, trot: 0.5, bound: 0.6 },
  };
  function select(v, cur) {
    if (cur === 'bound') return v < 1.9 ? 'trot' : 'bound';
    if (cur === 'trot') return v > 2.2 ? 'bound' : v < 0.95 ? 'walk' : 'trot';
    return v > 1.15 ? 'trot' : 'walk';
  }
  // body bone local: hips at (y -0.035, z -0.14), shoulders at (y -0.04, z +0.14)
  const HIP = [-0.035, -0.14], SHO = [-0.043, 0.138];

  function base(P, ctx, A) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.5) : 0, 7, dt);
    const mw = ctx.mw, idle = 1 - mw, run = sstep(1.0, 2.6, v), bound = ctx.gaitName === 'bound' ? 1 : 0;
    ctx.bw = M.damp(ctx.bw || 0, bound, 6, dt);
    const ph = ctx.phase * TAU, bw = ctx.bw;
    // gait body motion: double bob for walk / trot, one big flex-extend cycle for the bound
    P[ch('body.py')] += mw * ((1 - bw) * (-0.005 - 0.003 * run) * Math.cos(2 * ph) + bw * 0.012 * Math.sin(ph + 0.6)) - 0.012 * run;
    const flex = bw * 0.22 * Math.sin(ph + 0.4);
    P[ch('pelvis.rx')] += flex; P[ch('chest.rx')] -= flex * 0.8;
    P[ch('body.rx')] += bw * 0.06 * Math.sin(ph + 1.9) + 0.05 * run;
    P[ch('body.rz')] += mw * (1 - bw) * 0.035 * Math.sin(ph);
    P[ch('pelvis.rz')] += mw * (1 - bw) * 0.06 * Math.sin(ph);
    P[ch('pelvis.ry')] += mw * (1 - bw) * 0.07 * Math.sin(ph + 0.5);
    P[ch('chest.ry')] += mw * (1 - bw) * -0.05 * Math.sin(ph + 0.5);
    // bend into turns (spine curves toward the turn, head leads)
    const tr = M.clamp(ctx.turn * 0.07, -0.35, 0.35);
    P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.6; P[ch('neck.ry')] += tr * 0.9;
    // idle: breathing, slow look-around, nose twitches (special actions add more)
    const look = (vnoise3(t * 0.35, 1.3, 0) - 0.5) * 1.6, lookY = (vnoise3(t * 0.3, 4.1, 2) - 0.5) * 0.7;
    P[ch('neck.ry')] += idle * look * 0.55; P[ch('head.ry')] += idle * look * 0.45;
    P[ch('neck.rx')] += idle * lookY * 0.3 - 0.06 * idle; P[ch('head.rx')] += idle * lookY * 0.4;
    P[ch('nose')] += idle * Math.max(0, Math.sin(t * 17)) * (vnoise3(t * 0.8, 7, 1) > 0.55 ? 1 : 0);
    // head stabilisation: the neck cancels most of the body pitch and bob so the head glides
    const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
    P[ch('neck.rx')] -= bodyPitch * 0.75 - run * 0.08; P[ch('head.rx')] -= bodyPitch * 0.2;
    // tail: carried low and level, swaying opposite the hips, straight back in the bound
    for (let i = 0; i < TAILS.length; i++) {
      P[ch(TAILS[i] + '.rx')] += (i === 0 ? -0.12 : 0.05) * (1 - run) + run * (i === 0 ? 0.3 : 0.03) - flex * 0.25;   // + = up for backward bones
      P[ch(TAILS[i] + '.ry')] += mw * (1 - bw) * 0.09 * Math.sin(ph - i * 0.7) + idle * 0.06 * Math.sin(t * 0.9 - i * 0.6);
    }
    // ears lie back at speed
    P[ch('earL.rz')] -= run * 0.3; P[ch('earR.rz')] += run * 0.3; P[ch('earL.rx')] -= run * 0.4; P[ch('earR.rx')] -= run * 0.4;
    // scapulae glide with the fore steps
    const fF = A.gait.feet[0], fR = A.gait.feet[1];
    P[ch('scapL.rx')] += mw * 0.25 * scapSwing(fF); P[ch('scapR.rx')] += mw * 0.25 * scapSwing(fR);
  }
  // scapula angle from a fore foot's step: forward during swing, back through stance
  function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }

  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0;
    if (Lg.type === 'hind') {
      if (f.planted) return Lg.restDistal - 0.8 * sstep(0.5, 1, f.stanceU) * mw;
      return Lg.restDistal - 0.85 * (1 - sstep(0.4, 1, f.swingU));
    }
    if (f.planted) return Lg.restDistal + 0.35 * sstep(0.6, 1, f.stanceU) * mw;
    return Lg.restDistal - 1.9 * Math.sin(PI * Math.min(1, f.swingU * 1.1));
  }
  function post(P, ctx, A) {
    const breath = Math.sin(ctx.t * (ctx.moving ? 9 : 4.2));
    const b = A.B[I.ribs]; b.scale.setScalar(ctx.dead ? 1 : 1 + 0.035 * breath * (ctx.dead ? 0 : 1));
    // nose twitch: tiny head pitch flicks
    A.B[I.head].rotateX(-0.06 * P[ch('nose')]);
  }
  function secondary(ctx, A) {
    // tail lags behind turns and bounces with the body; ears jiggle
    const dt = ctx.dt, B = A.B;
    const tgt = -M.clamp(ctx.turn * 0.12, -0.7, 0.7);
    for (let i = 1; i < TAILS.length; i++) {
      const s = A.sp_('t' + i), x = K.stepSpring(s, tgt * (0.3 + 0.2 * i), 90 - i * 10, 9, dt);
      B[I[TAILS[i]]].rotateY(x * 0.35);
    }
    const ey = K.stepSpring(A.sp_('ear'), (A.B[I.body].position.y - BODY_Y) * -30, 260, 14, dt);
    B[I.earL].rotateX(ey * 0.3); B[I.earR].rotateX(ey * 0.3);
  }
  const TAIL_IX = TAILS.map((n) => I[n]);
  const TAIL_END = TAILS.map((n, k) => (k < TAILS.length - 1 ? tpl.local[I[TAILS[k + 1]]].clone() : new T.Vector3(...ends.tail4).sub(tpl.world[I.tail4])));
  const TAIL_MIN = [0.02, 0.016, 0.012, 0.008, 0.005];
  function ground(ctx, A) { K.groundChain(A, TAIL_IX, TAIL_END, TAIL_MIN); }
  function flinch(P, t, dir, pow) {
    const k = Math.exp(-t * 9) * Math.sin(Math.min(1, t * 12) * PI * 0.5) * pow;
    P[ch('body.px')] += dir[0] * 0.03 * k; P[ch('body.pz')] += dir[1] * 0.03 * k; P[ch('body.py')] -= 0.012 * k;
    P[ch('body.rz')] += -dir[0] * 0.25 * k; P[ch('chest.rx')] += 0.15 * k;
    P[ch('neck.rx')] -= 0.3 * k; P[ch('head.rx')] -= 0.2 * k; P[ch('jaw.rx')] += 0.35 * k;
    P[ch('earL.rx')] -= 0.6 * k; P[ch('earR.rx')] -= 0.6 * k;
  }

  /* actions: additive tracks keyed on the gameplay timeline instants */
  const atk = D.attacks.bite, ph = atk.phases;
  const actions = {
    bite: {
      kind: 'attack', dur: atk.dur, blendIn: 0.08, blendOut: 0.2,
      track: (() => {
        const tr = K.track(chan, ph, {
          // s, an (crouch + draw back), wu (head up, mouth wide), hit (snap: neck out, jaw shut), fo (shake), e
          'body.py': [0, -0.022, -0.012, -0.006, -0.008, 0],
          'chest.rx': [0, 0.18, 0.05, 0.05, 0.06, 0],
          'neck.rx': [0, 0.25, -0.45, 0.2, 0.15, 0],
          'head.rx': [0, 0.1, -0.35, 0.06, 0.08, 0],
          'jaw.rx': [0, 0.05, 0.62, 0.0, 0.12, 0],
          'pelvis.rx': [0, -0.12, -0.05, 0.08, 0.04, 0],
          'tail0.rx': [0, 0.1, -0.15, -0.25, -0.1, 0],
          'earL.rx': [0, -0.4, -0.7, -0.5, -0.3, 0], 'earR.rx': [0, -0.4, -0.7, -0.5, -0.3, 0],
        });
        return (P, u, w) => {
          tr(P, u, w);
          // weight shift: body pulls back over the hind legs, then thrusts past the shoulders
          const pz = u < ph.an ? -0.035 * M.ease.io(u / ph.an) : u < ph.hit ? lerp(-0.035, 0.06, M.ease.io((u - ph.an) / (ph.hit - ph.an))) : lerp(0.06, 0, M.ease.io((u - ph.hit) / (1 - ph.hit)));
          P[ch('body.pz')] += pz * w;
          // follow-through head shake
          const sh = sstep(ph.hit, ph.hit + 0.05, u) * sstep(ph.fo + 0.05, ph.fo - 0.04, u);
          P[ch('head.ry')] += Math.sin((u - ph.hit) * 70) * 0.22 * sh * w; P[ch('neck.ry')] += Math.sin((u - ph.hit) * 70 - 0.6) * 0.12 * sh * w;
        };
      })(),
    },
    sniff: {
      kind: 'special', dur: 2.4, blendIn: 0.25, blendOut: 0.35,
      track: (P, u, w) => {
        const env = sstep(0, 0.12, u) * sstep(1, 0.85, u) * w;
        P[ch('neck.rx')] -= 0.35 * env; P[ch('head.rx')] -= 0.25 * env;
        P[ch('head.ry')] += 0.35 * Math.sin(u * 7) * env; P[ch('neck.ry')] += 0.25 * Math.sin(u * 7 - 0.5) * env;
        P[ch('nose')] += 1.4 * Math.max(0, Math.sin(u * 95)) * env;
        P[ch('earL.rx')] += 0.15 * env; P[ch('earR.rx')] += 0.15 * env;
      },
    },
    rear: {
      kind: 'special', dur: 2.6, blendIn: 0.3, blendOut: 0.35,
      track: (P, u, w) => {
        // stands up on the hind legs (pivot about the hips), fore paws held to the chest, sniffs the air
        const env = M.ease.io(sstep(0.0, 0.25, u)) * M.ease.io(sstep(1, 0.78, u)) * w;
        K.pitchAbout(P, chan, -0.95 * env, HIP[0], HIP[1]);
        P[ch('pelvis.rx')] += 0.25 * env; P[ch('chest.rx')] -= 0.1 * env;
        P[ch('neck.rx')] += 0.55 * env; P[ch('head.rx')] += 0.35 * env;
        P[ch('head.ry')] += 0.3 * Math.sin(u * 9) * env;
        P[ch('nose')] += 1.2 * Math.max(0, Math.sin(u * 90)) * env;
        const fk = sstep(0.06, 0.2, u) * sstep(0.9, 0.76, u) * w;              // fore legs leave the ground -> FK tuck
        P[ch('ikFL')] -= fk; P[ch('ikFR')] -= fk;
        for (const s of ['L', 'R']) { P[ch('hum' + s + '.rx')] -= 0.9 * env; P[ch('for' + s + '.rx')] += 1.5 * env; P[ch('mc' + s + '.rx')] += 0.9 * env; }
        P[ch('tail0.rx')] += 0.35 * env; P[ch('tail1.rx')] -= 0.2 * env;
      },
    },
    death: {
      kind: 'death', dur: 1.5, blendIn: 0.06, hold: true,
      track: (P, u, w, layer) => {
        const side = layer.data.side || 1;
        const fall = M.ease.io(sstep(0.0, 0.42, u)), kick = sstep(0.42, 0.5, u) * sstep(0.85, 0.55, u);
        P[ch('body.rz')] += side * 1.5 * fall * w;
        P[ch('body.py')] += -0.09 * fall * w; P[ch('body.px')] += -side * 0.06 * fall * w;
        P[ch('body.rx')] += 0.1 * fall * w; P[ch('chest.rx')] += 0.2 * fall * w; P[ch('pelvis.rx')] -= 0.25 * fall * w;
        P[ch('neck.rx')] += (0.45 * fall - 0.4 * sstep(0, 0.15, u) * sstep(0.35, 0.15, u)) * w; P[ch('head.rx')] += 0.3 * fall * w; P[ch('jaw.rx')] += 0.3 * fall * w;
        const ikOff = sstep(0.08, 0.3, u) * w;
        for (const k of ['ikFL', 'ikFR', 'ikHL', 'ikHR']) P[ch(k)] -= ikOff;
        for (const s of ['L', 'R']) {
          const up = s === (side > 0 ? 'L' : 'R') ? 1 : 0;          // upper legs fold over, lower ones splay on the ground
          // limp: every joint folds (fore paws curl to the chest, hind legs draw up under the belly)
          P[ch('hum' + s + '.rx')] += (-0.35 - 0.3 * up - 0.2 * kick * Math.sin(u * 60)) * fall * w; P[ch('for' + s + '.rx')] += (1.0 + 0.4 * up) * fall * w; P[ch('mc' + s + '.rx')] += 1.3 * fall * w;
          P[ch('hum' + s + '.rz')] += side * 0.25 * up * fall * w;
          P[ch('th' + s + '.rx')] += (0.55 + 0.45 * up + 0.25 * kick * Math.sin(u * 55 + 1)) * fall * w; P[ch('shin' + s + '.rx')] -= (0.75 + 0.4 * up) * fall * w; P[ch('met' + s + '.rx')] += 0.9 * fall * w; P[ch('hpaw' + s + '.rx')] += 0.6 * fall * w;
        }
        for (let i = 0; i < TAILS.length; i++) { P[ch(TAILS[i] + '.ry')] += side * 0.35 * fall * w; P[ch(TAILS[i] + '.rx')] -= (i === 0 ? 0.25 : 0.04) * fall * w; }
        P[ch('earL.rx')] -= 0.5 * fall * w; P[ch('earR.rx')] -= 0.5 * fall * w;
      },
    },
  };

  K.defineSpecies('rat', {
    rig: tpl, chan, build, lowQ: 0.5, animator: K.QuadAnimator, debugScale: 0.6,
    anim: { legs, gaits, offsets, select, base, distal, post, secondary, ground, flinch, actions, gaitOpts: { restTol: 0.045, idleStepDur: 0.16 }, groundFix: true, groundPct: 0.12 },
    clips: ['idle', 'walk', 'run', 'bite', 'sniff', 'rear', 'hit', 'death'],
    attackAction: { bite: 'bite' }, specials: ['sniff', 'rear'],
    def: D,
  });
})();
