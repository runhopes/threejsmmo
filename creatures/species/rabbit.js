/* Wild Rabbit (levels 2-3): lean, compact lagomorph - rounded arched back rising into heavy haunches, long folded
 * hind legs on long furred plantigrade feet, short slender forelegs, rounded head with large lateral eyes, blunt muzzle
 * with a cleft upper lip and a twitching nose, LONG upright ears (two bones each), short fluffy tail with a white
 * underside. Agouti brown-grey coat, rusty nape, pale belly.
 * Locomotion: HOPPING. walk = slow hop (hind feet together, fore feet placed one after the other), run = sprint hops:
 * hind compression -> explosive extension -> airborne arc -> fore feet land first -> hind feet swing past and land ahead
 * of / outside the fore prints. Ears ride with restrained spring motion, the tail flags its white underside at speed.
 * Actions: kick (hop-spin, rump toward the target, double hind-leg kick, spin back), death, specials: twitch, sit, groom. */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- skeleton (world bind positions, metres) ---------------- */
  const BODY_Y = 0.2;
  const L = (x) => x, Rr = (x) => -x;
  const bones = [
    ['body', null, 0, BODY_Y, 0.0],
    ['ribs', 'body', 0, 0.175, 0.03],
    ['pelvis', 'body', 0, 0.205, -0.12],
    ['tail', 'pelvis', 0, 0.218, -0.222],
    ['chest', 'body', 0, 0.19, 0.095],
    ['neck', 'chest', 0, 0.2, 0.165, 'head'],
    ['head', 'neck', 0, 0.238, 0.205],
    ['jaw', 'head', 0, 0.205, 0.238],
    ['nose', 'head', 0, 0.214, 0.298],
    ['earL', 'head', 0.021, 0.284, 0.212, 'earLb'], ['earLb', 'earL', 0.031, 0.357, 0.196],
    ['earR', 'head', -0.021, 0.284, 0.212, 'earRb'], ['earRb', 'earR', -0.031, 0.357, 0.196],
  ];
  for (const [s, f] of [['L', L], ['R', Rr]]) {
    bones.push(
      ['scap' + s, 'chest', f(0.032), 0.222, 0.08, 'hum' + s],
      ['hum' + s, 'scap' + s, f(0.044), 0.16, 0.108, 'for' + s],
      ['for' + s, 'hum' + s, f(0.049), 0.104, 0.086, 'mc' + s],
      ['mc' + s, 'for' + s, f(0.047), 0.03, 0.12, 'fpaw' + s],
      ['fpaw' + s, 'mc' + s, f(0.047), 0.012, 0.136],
      ['th' + s, 'pelvis', f(0.055), 0.18, -0.118, 'shin' + s],
      ['shin' + s, 'th' + s, f(0.071), 0.112, -0.05, 'met' + s],
      ['met' + s, 'shin' + s, f(0.067), 0.03, -0.168, 'hpaw' + s],
      ['hpaw' + s, 'met' + s, f(0.067), 0.012, -0.054],
    );
  }
  const ends = {
    tail: [0, 0.236, -0.282], head: [0, 0.205, 0.33], jaw: [0, 0.188, 0.302], nose: [0, 0.205, 0.33],
    earLb: [0.037, 0.44, 0.176], earRb: [-0.037, 0.44, 0.176],
    fpawL: [0.047, 0.008, 0.162], fpawR: [-0.047, 0.008, 0.162], hpawL: [0.068, 0.008, -0.018], hpawR: [-0.068, 0.008, -0.018],
    body: [0, 0.19, 0.095], pelvis: [0, 0.218, -0.222], chest: [0, 0.2, 0.165], ribs: [0, 0.175, 0.1],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikFL', 'ikFR', 'ikHL', 'ikHR', 'twitch']);

  /* ---------------- palette (agouti, calibrated like the rat for the game lighting) ---------------- */
  const C = {
    back: [0.2, 0.165, 0.13], side: [0.29, 0.24, 0.185], belly: [0.5, 0.47, 0.42], nape: [0.33, 0.22, 0.15],
    muzzle: [0.33, 0.28, 0.22], eyeRing: [0.42, 0.37, 0.3], earIn: [0.38, 0.29, 0.26], earOut: [0.25, 0.205, 0.165], earTip: [0.09, 0.075, 0.07],
    tailTop: [0.22, 0.18, 0.14], tailUnder: [0.6, 0.58, 0.54], foot: [0.28, 0.235, 0.19], sole: [0.2, 0.165, 0.13],
    nose: [0.3, 0.2, 0.19], mouth: [0.14, 0.07, 0.07], eye: [0.05, 0.032, 0.024], tooth: [0.5, 0.46, 0.38],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  function furColor(p, n) {
    // agouti: dark grizzled saddle -> warm grey-brown flanks -> pale belly; ticked fur breakup at two scales
    const up = n.y, dors = sstep(0.3, 0.95, up), ven = sstep(-0.1, -0.7, up);
    let c = mix(C.side, C.back, dors);
    c = mix(c, C.belly, ven * 0.92);
    const tick = 0.88 + 0.14 * vnoise3(p.x * 80, p.y * 80, p.z * 80) + 0.06 * vnoise3(p.x * 220, p.y * 220, p.z * 220);
    return mul(c, tick);
  }

  // legs: flank colour (no pale belly band on down-facing leg surfaces), slightly darker toward the feet
  function legColor(p, n) {
    const c = mix(C.side, C.back, sstep(0.3, 0.95, n.y) * 0.6);
    const k = (0.9 + 0.14 * vnoise3(p.x * 80, p.y * 80, p.z * 80)) * (0.88 + 0.12 * sstep(0.02, 0.12, p.y));
    return mul(c, k);
  }

  /* ---------------- geometry ---------------- */
  const SPINE = [
    ['pelvis', V(0, 0.2, -0.25), V(0, 0.222, -0.07)], ['body', V(0, 0.222, -0.07), V(0, 0.2, 0.05)],
    ['chest', V(0, 0.2, 0.05), V(0, 0.2, 0.15)], ['neck', V(0, 0.2, 0.15), V(0, 0.228, 0.2)], ['head', V(0, 0.228, 0.2), V(0, 0.24, 0.25)],
  ].map((s) => [I[s[0]], s[1], s[2]]);
  function build(q) {
    const parts = { fur: [], gloss: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    /* body: compact rib cage, round belly, high rounded rump with folded haunches, arched back */
    const bodySDF = K.sdf([
      { e: [0, 0.212, -0.118], r: [0.082, 0.092, 0.112] },                              // rump / haunch mass
      { e: [0, 0.175, -0.02], r: [0.07, 0.07, 0.105], k: 0.06 },                        // abdomen
      { e: [0, 0.188, 0.07], r: [0.055, 0.064, 0.078], k: 0.05 },                       // rib cage
      { e: [0, 0.248, -0.07], r: [0.048, 0.04, 0.115], k: 0.06 },                       // arched lumbar back
      { e: [0.034, 0.178, 0.095], r: [0.028, 0.042, 0.038], k: 0.03 },                 // shoulders
      { e: [-0.034, 0.178, 0.095], r: [0.028, 0.042, 0.038], k: 0.03 },
      { e: [0.061, 0.168, -0.104], r: [0.036, 0.068, 0.078], rot: [0.32, 0, 0], k: 0.04 },   // folded thighs
      { e: [-0.061, 0.168, -0.104], r: [0.036, 0.068, 0.078], rot: [0.32, 0, 0], k: 0.04 },
      { c: [0, 0.19, 0.12, 0, 0.226, 0.205], ra: 0.048, rb: 0.04, k: 0.04 },          // neck
      { e: [0, 0.166, 0.152], r: [0.038, 0.034, 0.048], k: 0.03 },                      // throat / dewlap
    ]);
    const spine = new T.CatmullRomCurve3([V(0, 0.208, -0.19), V(0, 0.228, -0.11), V(0, 0.222, -0.02), V(0, 0.198, 0.075), V(0, 0.204, 0.145), V(0, 0.228, 0.198)], false, 'centripetal');
    const body = K.projectSDF({ sdf: bodySDF, curve: spine, rows: nr(46), nu: nu(30), cap0: 0.18, cap1: 0.1, rmax: 0.28 });
    const hip = { L: W('thL'), R: W('thR') }, sh = { L: W('humL'), R: W('humR') };
    K.skin(body, (p) => {
      const sd = p.x >= 0 ? 'L' : 'R';
      const ex = [
        [I['th' + sd], 0.55 * gs(p.distanceTo(hip[sd]), 0, 0.06) * sstep(0.01, 0.045, Math.abs(p.x))],
        [I['scap' + sd], 0.5 * gs(p.distanceTo(sh[sd]), 0, 0.045) * sstep(0.008, 0.032, Math.abs(p.x))],
        [I.ribs, 0.5 * gs(p.z, 0.02, 0.075) * sstep(0.19, 0.15, p.y)],
      ];
      return K.envelope(SPINE, p, 4, ex);
    });
    K.paint(body, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, C.nape, 0.55 * gs(p.z, 0.165, 0.035) * sstep(0.2, 0.7, n.y));          // rusty nape patch
      return c;
    });
    parts.fur.push(body);

    /* head: round cranium, large lateral eyes, blunt muzzle, cleft upper lip, small chin */
    const headSDF = K.sdf([
      { e: [0, 0.248, 0.232], r: [0.043, 0.046, 0.058] },                               // cranium
      { e: [0, 0.22, 0.28], r: [0.032, 0.033, 0.046], k: 0.03 },                        // muzzle
      { e: [0.026, 0.224, 0.258], r: [0.024, 0.028, 0.038], k: 0.022 },                 // cheeks
      { e: [-0.026, 0.224, 0.258], r: [0.024, 0.028, 0.038], k: 0.022 },
      { e: [0, 0.245, 0.282], r: [0.02, 0.018, 0.04], k: 0.02 },                        // nasal bridge
      { e: [0.0105, 0.206, 0.313], r: [0.0135, 0.013, 0.012], k: 0.01 },                // whisker pads (split upper lip)
      { e: [-0.0105, 0.206, 0.313], r: [0.0135, 0.013, 0.012], k: 0.01 },
      { e: [0, 0.217, 0.318], r: [0.0125, 0.01, 0.0095], k: 0.009 },                    // nose
      { e: [0, 0.2, 0.322], r: [0.0028, 0.011, 0.007], k: 0.004, sub: true },          // lip cleft
      { e: [0, 0.205, 0.262], r: [0.026, 0.018, 0.04], k: 0.02 },                       // under-jaw line
      { e: [0.038, 0.256, 0.25], r: [0.0145, 0.0135, 0.016], k: 0.006, sub: true },     // eye sockets (lateral, high)
      { e: [-0.038, 0.256, 0.25], r: [0.0145, 0.0135, 0.016], k: 0.006, sub: true },
    ]);
    const hAxis = new T.LineCurve3(V(0, 0.244, 0.19), V(0, 0.214, 0.315));
    const head = K.projectSDF({ sdf: headSDF, curve: hAxis, rows: nr(30), nu: nu(28), cap0: 0.26, cap1: 0.16, rmax: 0.12 });
    const noseC = W('nose');
    K.skin(head, (p) => { const w = 0.85 * sstep(0.296, 0.315, p.z) * sstep(0.192, 0.204, p.y); return [[I.nose, w], [I.head, 1 - w]]; });
    K.paint(head, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, C.muzzle, sstep(0.27, 0.31, p.z) * 0.55);
      const ring = Math.max(gs(Math.hypot(p.x - 0.038, p.y - 0.256, p.z - 0.25), 0.02, 0.006), gs(Math.hypot(p.x + 0.038, p.y - 0.256, p.z - 0.25), 0.02, 0.006));
      c = mix(c, C.eyeRing, 0.7 * ring);                                                 // pale eye ring
      c = mix(c, C.nape, 0.6 * gs(p.z, 0.2, 0.025) * sstep(0.3, 0.8, n.y));
      c = mix(c, C.nose, 0.8 * gs(p.distanceTo(V(0, 0.218, 0.326)), 0, 0.008));
      const mouth = sstep(0.285, 0.305, p.z) * sstep(-0.55, -0.85, n.y) * sstep(0.197, 0.191, p.y);   // only deep under the lip
      return mix(c, C.mouth, mouth * 0.8);
    });
    parts.fur.push(head);
    const jawSDF = K.sdf([
      { c: [0, 0.204, 0.245, 0, 0.192, 0.3], ra: 0.018, rb: 0.009, sq: 1.25 },
      { e: [0, 0.198, 0.27], r: [0.017, 0.011, 0.03], k: 0.012 },
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 0.202, 0.245), V(0, 0.193, 0.298)), rows: nr(12), nu: nu(14), cap0: 0.2, cap1: 0.2, rmax: 0.05 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => mix(mul(C.belly, 0.92), C.mouth, 0.7 * sstep(0.55, 0.9, n.y) * sstep(0.27, 0.29, p.z)));
    parts.fur.push(jaw);
    for (const s of [-1, 1]) {
      const inc = K.sweep({ pts: [V(s * 0.003, 0.199, 0.311), V(s * 0.0031, 0.1958, 0.3132), V(s * 0.0031, 0.1934, 0.3128)], prof: (u, o) => { o[0] = 0.0024; o[1] = 0.0014; o[2] = 0.0014; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 6, cap0: 1, cap1: 2, up: V(0, 0, 1) });
      K.skin(inc, [[I.head, 1]]); K.paint(inc, C.tooth); parts.gloss.push(inc);
      const eye = new T.SphereGeometry(0.0136, Math.max(8, Math.round(14 * q)), Math.max(6, Math.round(10 * q)));
      eye.scale(0.84, 1, 1.02); eye.translate(s * 0.0386, 0.2565, 0.2505);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
    }
    const noseG = new T.SphereGeometry(0.0072, 10, 7); noseG.scale(1.25, 0.75, 0.75); noseG.translate(0, 0.2185, 0.3265);
    parts.gloss.push(K.prim(noseG, C.nose, I.nose));

    /* ears: long cupped sheets, rolled narrow at the base, opening forward-outward, dark rims at the tip */
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      const e0 = W('ear' + sd), e1 = W('ear' + sd + 'b'), tip = V(...ends['ear' + sd + 'b']);
      const e = K.sweep({
        pts: [V(s * 0.018, 0.272, 0.214), e0, e0.clone().lerp(e1, 0.55), e1, e1.clone().lerp(tip, 0.6), tip], up: V(s * 0.45, 0.05, 0.89),
        prof: (u, o) => {
          o[0] = 0.0075 + 0.0165 * Math.sin(Math.min(1, u * 1.12) * PI * 0.72) * (1 - 0.6 * sstep(0.68, 1, u));
          o[1] = o[2] = 0.0026 * (1 - 0.35 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o;
        },
        cup: (u) => -0.009 * Math.sin(PI * Math.min(1, u * 1.05)) * sstep(0.0, 0.25, u), rows: nr(16), nu: nu(16), cap0: 1, cap1: 4,
      });
      K.skin(e, (p) => K.envelope([[I.head, V(s * 0.018, 0.26, 0.214), e0], [I['ear' + sd], e0, e1], [I['ear' + sd + 'b'], e1, tip]], p, 4));
      K.paint(e, (p, n, info) => {
        const u = info ? info.s : 0, inner = sstep(-0.05, 0.45, n.z * 0.89 + n.x * s * 0.45);
        let c = mix(mul(C.earOut, 0.95 + 0.1 * vnoise3(p.x * 90, p.y * 90, p.z * 90)), C.earIn, inner * sstep(0.08, 0.2, u) * sstep(0.97, 0.8, u));
        c = mix(c, C.earTip, sstep(0.82, 0.97, u));                                    // black-edged tips
        return c;
      });
      parts.fur.push(e);
    }

    /* tail: short fluffy scut, dark top, white underside */
    const tailPts = [V(0, 0.214, -0.2), W('tail'), V(0, 0.228, -0.258), V(...ends.tail)];
    const tc = M.curve([[0, 0.026], [0.3, 0.031], [0.7, 0.026], [1, 0.012]]), tq = [0];
    const tail = K.sweep({ pts: tailPts, prof: (u, o) => { tc(u, tq); o[0] = tq[0]; o[1] = tq[0] * 0.92; o[2] = tq[0] * 1.08; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.0025 * (vnoise3(u * 9, a * 3, 1) - 0.5) * sstep(0.1, 0.4, u), rows: nr(10), nu: nu(14), cap0: 0, cap1: 4 });
    K.skin(tail, (p) => [[I.tail, sstep(-0.205, -0.235, p.z)], [I.pelvis, 1 - sstep(-0.205, -0.235, p.z)]]);
    K.paint(tail, (p, n) => mix(C.tailTop, C.tailUnder, sstep(0.35, -0.35, n.y)));
    parts.fur.push(tail);

    /* legs + feet (left, mirrored): folded long hind leg, long furred hind foot, short slender foreleg */
    const legParts = [];
    for (const [s, sd] of [[1, 'L']]) {
      const hipIn = V(s * 0.036, 0.215, -0.11);
      const hp = [hipIn, W('th' + sd), W('shin' + sd), V(s * 0.07, 0.07, -0.11), W('met' + sd).add(V(0, 0.006, 0))];
      const hc = M.curve([[0, 0.034, 0.05, 0.05], [0.22, 0.039, 0.058, 0.06], [0.42, 0.03, 0.03, 0.04], [0.62, 0.024, 0.018, 0.034], [0.82, 0.018, 0.014, 0.024], [1, 0.0135, 0.012, 0.016]]), hq = [0, 0, 0];
      const hind = K.sweep({ pts: hp, up: V(0, 0, 1), prof: (u, o) => { hc(u, hq); o[0] = hq[0]; o[1] = hq[1]; o[2] = hq[2]; o[3] = 2.1; o[4] = 0; o[5] = 0; return o; }, rows: nr(22), nu: nu(14), cap0: 2, cap1: 2 });
      K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('th' + sd)], [I['th' + sd], W('th' + sd), W('shin' + sd)], [I['shin' + sd], W('shin' + sd), W('met' + sd)], [I['met' + sd], W('met' + sd), W('hpaw' + sd)]], p, 4));
      K.paint(hind, (p, n) => mix(legColor(p, n), furColor(p, n), sstep(0.13, 0.17, p.y)));
      legParts.push(hind);
      // long hind foot: heel -> ball -> toe tuft (furred, darker sole)
      const foot = K.sweep({ pts: [V(s * 0.067, 0.03, -0.18), V(s * 0.067, 0.022, -0.13), V(s * 0.067, 0.015, -0.075), V(s * 0.068, 0.012, -0.04), V(s * 0.068, 0.009, -0.015)], up: V(0, 1, 0),
        prof: (u, o) => { o[0] = lerp(0.0155, 0.018, sstep(0.15, 0.7, u)) * (1 - 0.4 * sstep(0.86, 1, u)); o[1] = lerp(0.019, 0.0105, sstep(0, 0.6, u)); o[2] = lerp(0.012, 0.008, u); o[3] = 2.2; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.0015 * sstep(0.75, 0.92, u) * Math.pow(Math.abs(Math.cos(a * 2)), 3) * ga(a, 0, 1.2), rows: nr(12), nu: nu(12), cap0: 3, cap1: 3 });
      K.skin(foot, (p) => K.envelope([[I['met' + sd], W('met' + sd), W('hpaw' + sd)], [I['hpaw' + sd], W('hpaw' + sd), V(s * 0.068, 0.008, -0.018)]], p, 4));
      K.paint(foot, (p, n) => mix(mul(C.foot, 0.92 + 0.12 * vnoise3(p.x * 90, p.y * 90, p.z * 90)), C.sole, sstep(-0.2, -0.8, n.y)));
      legParts.push(foot);
      const shIn = V(s * 0.024, 0.2, 0.09);
      const fp = [shIn, W('hum' + sd), W('for' + sd), W('mc' + sd)];
      const fc = M.curve([[0, 0.02, 0.024, 0.024], [0.3, 0.022, 0.026, 0.027], [0.55, 0.0165, 0.0155, 0.019], [1, 0.0105, 0.0095, 0.0105]]), fq = [0, 0, 0];
      const fore = K.sweep({ pts: fp, up: V(0, 0, 1), prof: (u, o) => { fc(u, fq); o[0] = fq[0]; o[1] = fq[1]; o[2] = fq[2]; o[3] = 2.1; o[4] = 0; o[5] = 0; return o; }, rows: nr(18), nu: nu(12), cap0: 2, cap1: 2 });
      K.skin(fore, (p) => K.envelope([[I['scap' + sd], shIn, W('hum' + sd)], [I['hum' + sd], W('hum' + sd), W('for' + sd)], [I['for' + sd], W('for' + sd), W('mc' + sd)], [I['mc' + sd], W('mc' + sd), W('fpaw' + sd)]], p, 4));
      K.paint(fore, (p, n) => mix(mix(legColor(p, n), furColor(p, n), sstep(0.13, 0.17, p.y)), C.foot, sstep(0.07, 0.03, p.y) * 0.5));
      legParts.push(fore);
      const hand = K.sweep({ pts: [V(s * 0.047, 0.036, 0.115), V(s * 0.047, 0.019, 0.128), V(s * 0.047, 0.0105, 0.146), V(s * 0.048, 0.0078, 0.162)], up: V(0, 1, 0),
        prof: (u, o) => { o[0] = lerp(0.0102, 0.0118, sstep(0.2, 0.7, u)) * (1 - 0.4 * sstep(0.85, 1, u)); o[1] = 0.0078; o[2] = 0.0062; o[3] = 2.3; o[4] = 0; o[5] = 0; return o; },
        rows: nr(9), nu: nu(10), cap0: 2, cap1: 2 });
      K.skin(hand, (p) => K.envelope([[I['mc' + sd], W('mc' + sd), W('fpaw' + sd)], [I['fpaw' + sd], W('fpaw' + sd), V(s * 0.047, 0.008, 0.162)]], p, 4));
      K.paint(hand, (p, n) => mul(C.foot, 0.95 + 0.1 * vnoise3(p.x * 90, p.y * 90, p.z * 90)));
      legParts.push(hand);
    }
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    for (const g of legParts) { parts.fur.push(g); parts.fur.push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const D = CREATURE_DEFS.SPECIES.rabbit;
  const ch = (n) => chan[n];
  const legs = [
    { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: 0.012, toeLen: 0.026, lift: 0.045, curl: 0.9 },
    { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: 0.012, toeLen: 0.026, lift: 0.045, curl: 0.9 },
    { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: 0.012, toeLen: 0.036, lift: 0.07, curl: 0.5 },
    { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: 0.012, toeLen: 0.036, lift: 0.07, curl: 0.5 },
  ];
  /* hop cycles, phase 0 = hind touchdown:
   *  slow hop (walk):  hinds planted [0, .52)  - short float - FL [.56, .86), FR [.70, 1.0)  (fores placed one after the other)
   *  sprint (run):     hinds planted [0, .26)  - airborne [.26, .50) - FL [.50, .66), FR [.55, .71) - hinds swing past */
  const gaits = {
    walk: { stride: (v) => 0.22 + 0.2 * v, duty: 0.52, dutyF: 0.3, minV: 0.06, liftK: (v) => 0.6 + 0.3 * clamp01(v) },
    run: { stride: (v) => 0.46 + 0.17 * v, duty: 0.26, dutyF: 0.13, minV: 0.06, liftK: () => 1.25 },
  };
  const offsets = {
    HL: { walk: 0, run: 0 }, HR: { walk: 0.985, run: 0.985 },
    FL: { walk: 0.44, run: 0.5 }, FR: { walk: 0.3, run: 0.45 },
  };
  function select(v, cur) {
    if (cur === 'run') return v < 2.0 ? 'walk' : 'run';
    return v > 2.5 ? 'run' : 'walk';
  }
  // body bone local: hips (y -0.02, z -0.118), shoulders (y -0.04, z 0.108)
  const HIP = [-0.02, -0.118], SHO = [-0.04, 0.108];
  // body motion over the hop cycle (phase 0 = hind touchdown): [phase, height, pitch(+ nose down), spine (+ extended), surge z]
  const WALK_K = M.curve([[0, -0.006, 0.02, -0.12, -0.004], [0.14, -0.014, -0.03, -0.06, 0.0], [0.4, -0.002, -0.07, 0.1, 0.012], [0.54, 0.012, -0.02, 0.14, 0.012],
    [0.66, 0.0, 0.06, 0.04, 0.002], [0.82, -0.004, 0.06, -0.08, -0.008], [1, -0.006, 0.02, -0.12, -0.004]]);
  const RUN_K = M.curve([[0, -0.012, 0.0, -0.3, -0.01], [0.1, -0.034, -0.08, -0.16, -0.006], [0.25, 0.0, -0.18, 0.18, 0.016], [0.38, 0.045, -0.05, 0.28, 0.02],
    [0.5, 0.0, 0.13, 0.12, 0.012], [0.6, -0.04, 0.22, -0.05, 0.0], [0.78, -0.01, 0.12, -0.22, -0.012], [1, -0.012, 0.0, -0.3, -0.01]]);
  const kw = [0, 0, 0, 0], kr = [0, 0, 0, 0];

  function base(P, ctx, A) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.4) : 0, 7, dt);
    ctx.rw = M.damp(ctx.rw || 0, ctx.gaitName === 'run' ? 1 : 0, 5, dt);
    const mw = ctx.mw, rw = ctx.rw, idle = 1 - mw, p = ctx.phase;
    WALK_K(p, kw); RUN_K(p, kr);
    const amp = mw * (0.55 + 0.45 * clamp01((v - 0.3) / 0.9));
    const h = lerp(kw[0], kr[0], rw) * amp, pitch = lerp(kw[1], kr[1], rw) * amp, ext = lerp(kw[2], kr[2], rw) * amp, surge = lerp(kw[3], kr[3], rw) * amp;
    ctx.ext = ext; ctx.hopH = h;
    P[ch('body.py')] += h - 0.008 * rw * mw - 0.014 * idle;
    P[ch('pelvis.rx')] -= 0.08 * idle;                                                   // rump rounds down at rest
    P[ch('body.pz')] += surge;
    P[ch('body.rx')] += pitch;
    P[ch('pelvis.rx')] += ext * 0.9; P[ch('chest.rx')] -= ext * 0.55;
    // slow hop: a little lateral rock as the fores step one after the other
    P[ch('body.rz')] += mw * (1 - rw) * 0.03 * Math.sin(TAU * (p - 0.6));
    // bend into turns
    const tr = M.clamp(ctx.turn * 0.07, -0.35, 0.35);
    P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.55; P[ch('neck.ry')] += tr * 0.8;
    // idle: alert posture, slow scanning, nose twitch bursts
    const look = (vnoise3(t * 0.3, 2.3, 0) - 0.5) * 1.5, lookY = (vnoise3(t * 0.27, 5.1, 2) - 0.5) * 0.6;
    P[ch('neck.ry')] += idle * look * 0.5; P[ch('head.ry')] += idle * look * 0.4;
    P[ch('neck.rx')] += idle * (lookY * 0.25 - 0.04); P[ch('head.rx')] += idle * lookY * 0.35;
    P[ch('twitch')] += (0.6 + 0.4 * idle) * Math.max(0, Math.sin(t * 19)) * (vnoise3(t * 0.7, 9, 3) > 0.5 ? 1 : 0.25);
    // head stabilisation: the neck cancels most of the body pitch and the spine wave
    const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
    P[ch('neck.rx')] -= bodyPitch * 0.8; P[ch('head.rx')] -= bodyPitch * 0.15 - 0.06 * rw * mw;
    // ears: upright and alert at rest, laid back along the neck in the sprint
    for (const [e, s] of [['earL', 1], ['earR', -1]]) {
      P[ch(e + '.rx')] -= rw * mw * 0.95 + (1 - rw) * mw * 0.07;
      P[ch(e + '.rz')] -= s * (0.06 + rw * mw * 0.08);
      P[ch(e + 'b.rx')] -= rw * mw * 0.25;
      P[ch(e + '.ry')] += s * idle * 0.12 * (vnoise3(t * 0.4, s * 3, 7) - 0.5);
    }
    // tail flags its white underside when the rabbit runs
    P[ch('tail.rx')] += 0.15 * idle + mw * (0.5 + 0.5 * rw) - ext * 0.4;
    // flight: after the push-off the hind legs trail fully extended (FK), then swing forward and IK takes the landing
    for (const [k, sd] of [[2, 'L'], [3, 'R']]) {
      const f = A.gait.feet[k];
      const fk = f.planted ? 0 : rw * mw * sstep(0.03, 0.16, f.swingU) * sstep(0.62, 0.38, f.swingU) * 0.92;
      A['fkH' + sd] = fk;
      if (fk <= 0) continue;
      P[ch('ikH' + sd)] -= fk;
      const tr = 1 - sstep(0.18, 0.55, f.swingU);                                          // trailing (near level) -> recovering
      P[ch('th' + sd + '.rx')] += (1.8 * tr + 0.2) * fk; P[ch('shin' + sd + '.rx')] -= (1.55 * tr + 0.2) * fk;
      P[ch('met' + sd + '.rx')] += (2.4 * tr + 0.3) * fk; P[ch('hpaw' + sd + '.rx')] += 0.4 * tr * fk;
    }
    // scapulae glide with the fore steps
    const fF = A.gait.feet[0], fR = A.gait.feet[1];
    P[ch('scapL.rx')] += mw * (0.22 + 0.18 * rw) * scapSwing(fF); P[ch('scapR.rx')] += mw * (0.22 + 0.18 * rw) * scapSwing(fR);
  }
  function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }

  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0, rw = ctx.rw || 0;
    if (Lg.type === 'hind') {
      // planted: long foot flat, the heel rises through the push-off (explosive extension at speed)
      if (f.planted) return Lg.restDistal - (0.55 + 0.6 * rw) * sstep(0.35, 1, f.stanceU) * mw;
      // swing: foot trails extended behind after take-off, then swings forward flat for the landing
      const u = f.swingU, back = Math.sin(PI * Math.min(1, u * 1.6)) * (0.6 + 0.9 * rw);
      return Lg.restDistal - (0.55 + 0.6 * rw) * (1 - sstep(0.0, 0.25, u)) - back * (1 - sstep(0.55, 0.9, u));
    }
    if (f.planted) return Lg.restDistal + (0.3 + 0.55 * rw) * sstep(0.45, 1, f.stanceU) * mw;
    return Lg.restDistal - 1.7 * Math.sin(PI * Math.min(1, f.swingU * 1.15)) + 0.25 * sstep(0.7, 1, f.swingU);
  }
  function post(P, ctx, A) {
    const breath = Math.sin(ctx.t * (ctx.moving ? 8 : 5));
    A.B[I.ribs].scale.setScalar(ctx.dead ? 1 : 1 + 0.03 * breath);
    // nose wiggle: the nose bone flicks up / sideways
    const tw = P[ch('twitch')];
    A.B[I.nose].rotateX(-0.12 * tw); A.B[I.nose].rotateY(0.05 * tw * Math.sin(ctx.t * 7));
  }
  function secondary(ctx, A) {
    // ears: restrained spring lag on the hop's vertical motion and on turns (base + tip segment)
    const dt = ctx.dt, B = A.B;
    const vy = (ctx.hopH || 0) - (A._lastH || 0); A._lastH = ctx.hopH || 0;
    const tgt = M.clamp(vy / Math.max(dt, 1e-4) * 0.35, -0.5, 0.5);
    const e1 = K.stepSpring(A.sp_('ear'), tgt, 180, 13, dt), e2 = K.stepSpring(A.sp_('ear2'), e1 * 1.4, 120, 10, dt);
    const ty = K.stepSpring(A.sp_('eary'), -M.clamp(ctx.turn * 0.08, -0.4, 0.4), 120, 12, dt);
    B[I.earL].rotateX(e1 * 0.35); B[I.earR].rotateX(e1 * 0.35);
    B[I.earLb].rotateX(e2 * 0.4); B[I.earRb].rotateX(e2 * 0.4);
    B[I.earL].rotateY(ty * 0.4); B[I.earR].rotateY(ty * 0.4);
  }
  // swinging hind legs that left IK (flight pose) never dip into the ground
  const HL_IX = { L: ['thL', 'shinL', 'metL', 'hpawL'].map((n) => I[n]), R: ['thR', 'shinR', 'metR', 'hpawR'].map((n) => I[n]) };
  const HL_END = { L: [tpl.local[I.shinL], tpl.local[I.metL], tpl.local[I.hpawL], new T.Vector3(...ends.hpawL).sub(tpl.world[I.hpawL])],
    R: [tpl.local[I.shinR], tpl.local[I.metR], tpl.local[I.hpawR], new T.Vector3(...ends.hpawR).sub(tpl.world[I.hpawR])] };
  function ground(ctx, A) {
    for (const sd of ['L', 'R']) if ((A['fkH' + sd] || 0) > 0.01 && !ctx.dead) K.groundChain(A, HL_IX[sd], HL_END[sd], [0.03, 0.025, 0.018, 0.012]);
  }
  function flinch(P, t, dir, pow) {
    const k = Math.exp(-t * 9) * Math.sin(Math.min(1, t * 12) * PI * 0.5) * pow;
    P[ch('body.px')] += dir[0] * 0.03 * k; P[ch('body.pz')] += dir[1] * 0.03 * k; P[ch('body.py')] -= 0.016 * k;
    P[ch('body.rz')] += -dir[0] * 0.22 * k; P[ch('chest.rx')] += 0.12 * k;
    P[ch('neck.rx')] -= 0.25 * k; P[ch('head.rx')] -= 0.15 * k;
    P[ch('earL.rx')] -= 0.9 * k; P[ch('earR.rx')] -= 0.9 * k; P[ch('earLb.rx')] -= 0.3 * k; P[ch('earRb.rx')] -= 0.3 * k;
    P[ch('tail.rx')] += 0.5 * k;
  }

  /* actions */
  const atk = D.attacks.kick, ph = atk.phases;
  const IKS = ['ikFL', 'ikFR', 'ikHL', 'ikHR'];
  const actions = {
    /* kick: hop-spin to put the rump toward the target, weight onto the forelegs, both hind legs coil and drive back
       through the active window, hold, then a second hop-spin back to face the target */
    kick: {
      kind: 'attack', dur: atk.dur, blendIn: 0.06, blendOut: 0.18, ground: true,
      track: (() => {
        const sp0 = 0.04, sp1 = ph.an, bk0 = ph.fo + 0.04, bk1 = 0.97;
        return (P, u, w) => {
          // spin out (0 -> pi) and back (pi -> 0) with a little hop each time
          const spin = M.ease.io(sstep(sp0, sp1, u)) * (1 - M.ease.io(sstep(bk0, bk1, u)));
          P[ch('body.ry')] += PI * spin * w;
          const hop = Math.sin(PI * clamp01((u - sp0) / (sp1 - sp0))) * (u < sp1 ? 1 : 0) + Math.sin(PI * clamp01((u - bk0) / (bk1 - bk0))) * (u > bk0 ? 1 : 0);
          P[ch('body.py')] += 0.045 * hop * w;
          // legs leave IK for the whole trick (bind-pose legs keep the paws at ground height while the body turns)
          const fk = sstep(0.0, sp0 + 0.02, u) * sstep(1.0, bk1, u) * w;
          for (const k of IKS) P[ch(k)] -= fk;
          // fore legs tuck in the hops, brace in between
          for (const s of ['L', 'R']) { P[ch('hum' + s + '.rx')] -= 0.5 * hop * w; P[ch('for' + s + '.rx')] += 0.9 * hop * w; P[ch('mc' + s + '.rx')] += 0.6 * hop * w; }
          // weight onto the forelegs: rump up and nose down about the shoulders
          const brace = sstep(sp1 - 0.05, ph.wu, u) * sstep(bk0 + 0.02, ph.fo - 0.02, u);
          K.pitchAbout(P, chan, 0.32 * brace * w, SHO[0], SHO[1]);
          // hind legs: coil (wind-up) -> explosive drive straight back (active) -> hold -> fold
          const coil = sstep(ph.an - 0.06, ph.wu, u) * (1 - sstep(ph.wu, ph.hit, u));
          const drive = sstep(ph.wu, ph.hit, u) * (1 - sstep(ph.fo - 0.04, bk0 + 0.06, u));
          for (const s of ['L', 'R']) {
            P[ch('th' + s + '.rx')] += (-0.55 * coil + 1.95 * drive) * w;
            P[ch('shin' + s + '.rx')] += (0.6 * coil - 1.45 * drive) * w;
            P[ch('met' + s + '.rx')] += (-0.4 * coil + 2.1 * drive) * w;
            P[ch('hpaw' + s + '.rx')] += (0.3 * drive) * w;
          }
          P[ch('pelvis.rx')] += (-0.15 * coil + 0.3 * drive) * w;
          // look back over the shoulder at the target during the kick, ears pinned back
          P[ch('neck.ry')] += 0.55 * brace * w; P[ch('head.ry')] += 0.35 * brace * w; P[ch('neck.rx')] -= 0.25 * brace * w;
          P[ch('earL.rx')] -= 0.8 * brace * w; P[ch('earR.rx')] -= 0.8 * brace * w;
          P[ch('tail.rx')] += 0.6 * drive * w;
        };
      })(),
    },
    twitch: {
      kind: 'special', dur: 1.6, blendIn: 0.1, blendOut: 0.25,
      track: (P, u, w) => {
        const env = sstep(0, 0.08, u) * sstep(1, 0.85, u) * w;
        // one ear swivels toward a sound, flicks twice, the other follows a little; the nose works hard
        const f1 = Math.max(0, Math.sin(clamp01((u - 0.1) / 0.18) * PI)), f2 = Math.max(0, Math.sin(clamp01((u - 0.45) / 0.14) * PI));
        P[ch('earL.ry')] += (0.55 * sstep(0.05, 0.2, u) - 0.25 * f2) * env; P[ch('earL.rx')] += (0.25 * f1 - 0.2 * f2) * env;
        P[ch('earR.ry')] -= 0.2 * sstep(0.15, 0.35, u) * env; P[ch('earLb.rx')] += 0.3 * f1 * env;
        P[ch('head.ry')] += 0.25 * sstep(0.1, 0.3, u) * env; P[ch('neck.rx')] -= 0.12 * env;
        P[ch('twitch')] += 1.4 * Math.max(0, Math.sin(u * 110)) * env;
      },
    },
    sit: {
      kind: 'special', dur: 3.2, blendIn: 0.3, blendOut: 0.35, ground: true,
      track: (P, u, w) => {
        // sits up on the haunches (pivot about the hips), fore paws off the ground and tucked, ears up, scanning
        const env = M.ease.io(sstep(0.0, 0.22, u)) * M.ease.io(sstep(1, 0.8, u)) * w;
        K.pitchAbout(P, chan, -0.85 * env, HIP[0], HIP[1]);
        P[ch('pelvis.rx')] += 0.3 * env; P[ch('chest.rx')] -= 0.15 * env;
        P[ch('neck.rx')] += 0.55 * env; P[ch('head.rx')] += 0.35 * env;
        P[ch('head.ry')] += 0.45 * Math.sin(u * 8) * sstep(0.25, 0.4, u) * env;
        P[ch('earL.rx')] += 0.2 * env; P[ch('earR.rx')] += 0.2 * env;
        P[ch('earL.ry')] += 0.3 * Math.sin(u * 11) * env; P[ch('earR.ry')] -= 0.3 * Math.sin(u * 9 + 1) * env;
        P[ch('twitch')] += 1.2 * Math.max(0, Math.sin(u * 80)) * env;
        const fk = sstep(0.05, 0.18, u) * sstep(0.92, 0.8, u) * w;
        P[ch('ikFL')] -= fk; P[ch('ikFR')] -= fk;
        for (const s of ['L', 'R']) { P[ch('hum' + s + '.rx')] -= 0.6 * env; P[ch('for' + s + '.rx')] += 1.4 * env; P[ch('mc' + s + '.rx')] += 0.9 * env; }
        P[ch('tail.rx')] -= 0.3 * env;
      },
    },
    groom: {
      kind: 'special', dur: 3.0, blendIn: 0.3, blendOut: 0.35, ground: true,
      track: (P, u, w) => {
        // sits back a little, both fore paws rub over the face in short strokes, head bobbing into them
        const env = M.ease.io(sstep(0.0, 0.2, u)) * M.ease.io(sstep(1, 0.82, u)) * w;
        K.pitchAbout(P, chan, -0.55 * env, HIP[0], HIP[1]);
        P[ch('neck.rx')] += 0.75 * env; P[ch('head.rx')] += 0.2 * env;
        const fk = sstep(0.06, 0.18, u) * sstep(0.92, 0.8, u) * w;
        P[ch('ikFL')] -= fk; P[ch('ikFR')] -= fk;
        const stroke = Math.sin(u * 34) * sstep(0.2, 0.3, u) * sstep(0.85, 0.75, u);
        for (const s of ['L', 'R']) {
          P[ch('hum' + s + '.rx')] -= (1.35 + 0.2 * stroke) * env; P[ch('for' + s + '.rx')] -= (0.55 + 0.35 * stroke) * env; P[ch('mc' + s + '.rx')] += 0.9 * env;
          P[ch('hum' + s + '.rz')] -= (s === 'L' ? 1 : -1) * 0.25 * env;
        }
        P[ch('head.rx')] += 0.18 * stroke * env;
        P[ch('earL.rx')] -= 0.35 * env; P[ch('earR.rx')] -= 0.35 * env;
      },
    },
    death: {
      kind: 'death', dur: 1.4, blendIn: 0.06, hold: true,
      track: (P, u, w, layer) => {
        const side = layer.data.side || 1;
        const fall = M.ease.io(sstep(0.0, 0.4, u)), kick = sstep(0.4, 0.48, u) * sstep(0.9, 0.6, u);
        P[ch('body.rz')] += side * 1.5 * fall * w;
        P[ch('body.py')] += -0.11 * fall * w; P[ch('body.px')] += -side * 0.06 * fall * w;
        P[ch('body.rx')] += 0.08 * fall * w; P[ch('pelvis.rx')] -= 0.2 * fall * w; P[ch('chest.rx')] += 0.1 * fall * w;
        P[ch('neck.rx')] += (0.35 * fall - 0.45 * sstep(0, 0.12, u) * sstep(0.32, 0.12, u)) * w; P[ch('head.rx')] += 0.25 * fall * w;
        const ikOff = sstep(0.06, 0.28, u) * w;
        for (const k of IKS) P[ch(k)] -= ikOff;
        for (const s of ['L', 'R']) {
          const top = s === (side > 0 ? 'L' : 'R') ? 1 : 0;
          P[ch('hum' + s + '.rx')] += (-0.3 - 0.3 * top) * fall * w; P[ch('for' + s + '.rx')] += (0.5 + 0.4 * top) * fall * w; P[ch('mc' + s + '.rx')] += 0.8 * fall * w;
          // hind legs stretch out behind (the classic rabbit death pose), with a last reflex kick
          P[ch('th' + s + '.rx')] += (0.9 + 0.2 * top + 0.35 * kick * Math.sin(u * 50 + (top ? 0 : 1.3))) * fall * w;
          P[ch('shin' + s + '.rx')] -= (0.4 + 0.2 * top) * fall * w; P[ch('met' + s + '.rx')] -= 0.35 * fall * w;
        }
        for (const e of ['earL', 'earR']) { P[ch(e + '.rx')] -= 1.1 * fall * w; P[ch(e + 'b.rx')] -= 0.3 * fall * w; }
        P[ch('earL.ry')] -= side * 0.3 * fall * w; P[ch('earR.ry')] -= side * 0.3 * fall * w;
        P[ch('tail.rx')] -= 0.3 * fall * w;
      },
    },
  };

  K.defineSpecies('rabbit', {
    rig: tpl, chan, build, lowQ: 0.48, animator: K.QuadAnimator, debugScale: 0.6,
    anim: { legs, gaits, offsets, select, base, distal, post, secondary, ground, flinch, actions, gaitOpts: { restTol: 0.05, idleStepDur: 0.18 }, groundFix: true },
    clips: ['idle', 'walk', 'run', 'kick', 'twitch', 'sit', 'groom', 'hit', 'death'],
    attackAction: { kick: 'kick' }, specials: ['twitch', 'sit', 'groom', 'twitch'],
    def: D,
  });
})();
