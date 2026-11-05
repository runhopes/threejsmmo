/* Goblin Raider (levels 8-9): small wiry humanoid (~1.3 m), hunched, long arms, big hands and feet, head ~1/5.5 of the
 * stature. Same pipeline as the heroes: SDF-sculpted torso projected along the spine, SDF head (long hooked nose, heavy
 * brow, deep-set eyes, sharp cheekbones, wide thin mouth with small lower tusks, big swept-back ears), limbs swept with
 * muscle bumps. Gear: leather cuirass band + shoulder straps + layered pauldron (the heroes' brown_leather), belt and
 * pouch, rough-linen loincloth and foot wraps, leather bracers, short iron dagger with a wrapped grip.
 * Animation: BipedAnimator (QuadAnimator foot-planting IK + gait with two feet) - heel-toe roll, pelvis yaw / hip drop,
 * shoulder counter-rotation, arm swing, weight shift; twitchy head looks and ear flicks; stab / slash keyed on the
 * gameplay timeline (defs.js), hit / stagger, death (knees -> side), taunt / look idle specials. */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- skeleton (world bind positions, metres; arms in a slight A-pose) ---------------- */
  const bones = [
    ['body', null, 0, 0.66, 0],
    ['pelvis', 'body', 0, 0.66, 0],
    ['spine', 'body', 0, 0.75, -0.005, 'chest'],
    ['chest', 'spine', 0, 0.88, 0.015, 'neck'],
    ['ribs', 'chest', 0, 0.86, 0.04],
    ['neck', 'chest', 0, 1.0, 0.06, 'head'],
    ['head', 'neck', 0, 1.085, 0.115],
    ['jaw', 'head', 0, 1.11, 0.11],
    ['earL', 'head', 0.08, 1.165, 0.085], ['earR', 'head', -0.08, 1.165, 0.085],
  ];
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    bones.push(
      ['th' + k, 'pelvis', s * 0.085, 0.61, 0.0, 'shin' + k],
      ['shin' + k, 'th' + k, s * 0.1, 0.34, 0.04, 'foot' + k],
      ['foot' + k, 'shin' + k, s * 0.108, 0.075, -0.015, 'toe' + k],
      ['toe' + k, 'foot' + k, s * 0.114, 0.026, 0.092],
      ['clav' + k, 'chest', s * 0.025, 0.985, 0.05, 'up' + k],
      ['up' + k, 'clav' + k, s * 0.168, 0.97, 0.03, 'lo' + k],
      ['lo' + k, 'up' + k, s * 0.235, 0.74, 0.0, 'hand' + k],
      ['hand' + k, 'lo' + k, s * 0.265, 0.52, 0.04],
    );
  }
  const ends = {
    head: [0, 1.27, 0.12], jaw: [0, 1.06, 0.22], earL: [0.19, 1.222, 0.004], earR: [-0.19, 1.222, 0.004], body: [0, 0.75, -0.005], pelvis: [0, 0.55, 0],
    ribs: [0, 0.86, 0.12], toeL: [0.117, 0.018, 0.148], toeR: [-0.117, 0.018, 0.148], handL: [0.272, 0.43, 0.06], handR: [-0.272, 0.43, 0.06],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikL', 'ikR', 'jawO']);

  /* ---------------- palette (display-space vertex colours; upward faces render ~2.2x brighter) ---------------- */
  const C = {
    skin: [0.17, 0.182, 0.128], skinD: [0.128, 0.135, 0.095], skinL: [0.205, 0.205, 0.15], lip: [0.13, 0.095, 0.075], nose: [0.2, 0.16, 0.115],
    earIn: [0.2, 0.14, 0.11], eye: [0.045, 0.028, 0.016], tusk: [0.6, 0.55, 0.43], nail: [0.16, 0.13, 0.09], mouth: [0.11, 0.05, 0.05],
    leather: [0.34, 0.24, 0.17], leatherD: [0.22, 0.155, 0.105], belt: [0.2, 0.14, 0.095], cloth: [0.33, 0.22, 0.15], wrap: [0.27, 0.235, 0.185],
    iron: [0.5, 0.51, 0.53], ironD: [0.3, 0.29, 0.28], rust: [0.4, 0.28, 0.2], grip: [0.26, 0.18, 0.12],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const noise = (p, f) => vnoise3(p.x * f, p.y * f, p.z * f);
  function skinColor(p, n) {
    const up = n.y;
    let c = mix(C.skin, C.skinD, sstep(0.2, 0.9, up) * 0.6);          // tops of shoulders / head a touch darker (no washed-out highlights)
    c = mix(c, C.skinL, sstep(-0.2, -0.8, up) * 0.5);
    return mul(c, 0.9 + 0.16 * noise(p, 38));
  }
  function scaleUV(g, su, sv) { const U = g.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * su, U.getY(i) * sv); return g; }

  /* ---------------- torso SDF (shared by the body surface and the gear shells) ---------------- */
  const torsoSDF = K.sdf([
    { e: [0, 0.65, -0.01], r: [0.128, 0.085, 0.09] },                                // pelvis
    { e: [0.055, 0.615, -0.06], r: [0.063, 0.072, 0.055], k: 0.04 },                // glutes
    { e: [-0.055, 0.615, -0.06], r: [0.063, 0.072, 0.055], k: 0.04 },
    { e: [0.085, 0.6, 0.0], r: [0.058, 0.068, 0.062], k: 0.04 },                    // hip joints (legs emerge here)
    { e: [-0.085, 0.6, 0.0], r: [0.058, 0.068, 0.062], k: 0.04 },
    { e: [0, 0.75, 0.022], r: [0.105, 0.095, 0.09], k: 0.05 },                       // lean belly
    { e: [0, 0.875, 0.01], r: [0.12, 0.118, 0.098], k: 0.05 },                       // rib cage
    { e: [0.052, 0.912, 0.066], r: [0.052, 0.042, 0.032], k: 0.035 },               // pectorals
    { e: [-0.052, 0.912, 0.066], r: [0.052, 0.042, 0.032], k: 0.035 },
    { e: [0.062, 0.93, -0.068], r: [0.058, 0.07, 0.034], k: 0.04 },                 // shoulder blades (hunched back)
    { e: [-0.062, 0.93, -0.068], r: [0.058, 0.07, 0.034], k: 0.04 },
    { e: [0, 0.985, -0.01], r: [0.125, 0.042, 0.062], k: 0.05 },                     // trapezius / shoulder girdle
    { e: [0.152, 0.962, 0.025], r: [0.046, 0.05, 0.048], k: 0.04 },                 // deltoid caps
    { e: [-0.152, 0.962, 0.025], r: [0.046, 0.05, 0.048], k: 0.04 },
    { c: [0, 0.965, 0.03, 0, 1.1, 0.12], ra: 0.05, rb: 0.042, k: 0.04 },            // neck, thrust forward
    { e: [0, 0.84, -0.098], r: [0.011, 0.15, 0.014], k: 0.012, sub: true },          // spine groove
  ]);
  const spineCurve = new T.CatmullRomCurve3([V(0, 0.578, -0.01), V(0, 0.66, 0), V(0, 0.78, 0.01), V(0, 0.9, 0.015), V(0, 0.99, 0.045), V(0, 1.075, 0.105)], false, 'centripetal');
  // spine centre z at height y (for horizontal-ray shells)
  const czAt = (() => { const tab = []; for (let i = 0; i <= 200; i++) { const p = spineCurve.getPointAt(i / 200); tab.push([p.y, p.z]); } return (y) => { if (y <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (tab[i][0] >= y) { const a = tab[i - 1], b = tab[i], t = (y - a[0]) / Math.max(1e-6, b[0] - a[0]); return lerp(a[1], b[1], t); } return tab[tab.length - 1][1]; }; })();
  // point on the torso surface (+ offset) by a horizontal ray from the spine at height y, angle a (0 = front, +pi/2 = left)
  function surf(y, a, off, out) {
    const cz = czAt(y), dx = Math.sin(a), dz = Math.cos(a);
    let r = 0.4;
    for (let it = 0; it < 80; it++) { const d = torsoSDF(dx * r, y, cz + dz * r) - off; if (Math.abs(d) < 1e-5) break; r -= d * 0.8; if (r < 0.005) { r = 0.005; break; } }
    return (out || new T.Vector3()).set(dx * r, y, cz + dz * r);
  }
  /* thick garment band around the torso between yb(a) and yt(a): outer layer at `off`, rims folded back to `inner` */
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

  /* ---------------- geometry ---------------- */
  function build(q) {
    const parts = { skin: [], leather: [], cloth: [], iron: [], gloss: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    const segs = (list) => list.map((s) => [I[s[0]], s[1], s[2]]);

    /* torso: one surface from the crotch to inside the skull */
    const torso = K.projectSDF({ sdf: torsoSDF, curve: spineCurve, up: V(0, 0, 1), rows: nr(37), nu: nu(28), cap0: 0.12, cap1: 0.06, rmax: 0.4 });
    const TS = segs([['pelvis', V(0, 0.5, 0), V(0, 0.7, 0)], ['spine', V(0, 0.7, 0), V(0, 0.8, 0.005)], ['chest', V(0, 0.8, 0.005), V(0, 0.985, 0.04)], ['neck', V(0, 0.985, 0.04), V(0, 1.065, 0.1)], ['head', V(0, 1.065, 0.1), V(0, 1.12, 0.12)]]);
    const torsoW = (p) => {
      const k = p.x >= 0 ? 'L' : 'R', s = p.x >= 0 ? 1 : -1;
      return K.envelope(TS, p, 4, [
        [I['th' + k], 0.6 * gs(p.distanceTo(W('th' + k)), 0, 0.065) * sstep(0.67, 0.6, p.y)],
        [I['up' + k], 0.5 * gs(p.distanceTo(W('up' + k)), 0, 0.05) * sstep(0.1, 0.15, Math.abs(p.x))],
        [I['clav' + k], 0.35 * gs(p.distanceTo(V(s * 0.1, 0.99, 0.02)), 0, 0.055)],
        [I.ribs, 0.4 * gs(p.y, 0.865, 0.07) * sstep(-0.03, 0.05, p.z)],
      ]);
    };
    K.skin(torso, torsoW);
    K.paint(torso, (p, n) => {
      let c = skinColor(p, n);
      const rib = 0.06 * sstep(0.08, 0.11, Math.abs(p.x)) * gs(p.y, 0.85, 0.06) * (0.5 + 0.5 * Math.sin(p.y * 160));   // faint ribs on the flanks
      return mul(c, 1 - rib - 0.08 * gs(p.y, 0.6, 0.03) * sstep(0.04, 0.0, Math.abs(p.x)));
    });
    parts.skin.push(torso);

    /* head: skull, face and hooked nose sculpted along the head axis; mandible on the jaw bone */
    const headSDF = K.sdf([
      { e: [0, 1.183, 0.108], r: [0.077, 0.083, 0.092] },                              // cranium
      { e: [0, 1.17, 0.055], r: [0.064, 0.064, 0.05], k: 0.04 },                        // long occiput
      { e: [0, 1.135, 0.165], r: [0.066, 0.07, 0.07], k: 0.04 },                        // face / maxilla
      { e: [0.057, 1.152, 0.185], r: [0.026, 0.018, 0.032], k: 0.016 },                 // sharp cheekbones
      { e: [-0.057, 1.152, 0.185], r: [0.026, 0.018, 0.032], k: 0.016 },
      { e: [0, 1.095, 0.19], r: [0.056, 0.03, 0.055], k: 0.03 },                        // upper lip / muzzle
      { e: [0, 1.205, 0.192], r: [0.072, 0.02, 0.03], k: 0.02 },                        // heavy brow ridge
      { e: [0.05, 1.198, 0.183], r: [0.03, 0.018, 0.026], k: 0.014 },
      { e: [-0.05, 1.198, 0.183], r: [0.03, 0.018, 0.026], k: 0.014 },
      { c: [0, 1.195, 0.205, 0, 1.162, 0.252], ra: 0.013, rb: 0.016, k: 0.012 },        // nose bridge
      { c: [0, 1.162, 0.252, 0, 1.131, 0.287], ra: 0.016, rb: 0.011, k: 0.008 },        // long nose
      { e: [0, 1.124, 0.282], r: [0.012, 0.014, 0.012], k: 0.008 },                     // drooping hooked tip
      { e: [0.017, 1.134, 0.252], r: [0.011, 0.01, 0.013], k: 0.008 },                  // nostril wings
      { e: [-0.017, 1.134, 0.252], r: [0.011, 0.01, 0.013], k: 0.008 },
      { e: [0.034, 1.17, 0.207], r: [0.021, 0.015, 0.021], k: 0.01, sub: true },         // deep eye sockets
      { e: [-0.034, 1.17, 0.207], r: [0.021, 0.015, 0.021], k: 0.01, sub: true },
      { e: [0, 1.091, 0.235], r: [0.044, 0.0035, 0.026], k: 0.004, sub: true },          // wide thin mouth line
      { e: [0.087, 1.2, 0.15], r: [0.02, 0.03, 0.03], k: 0.02, sub: true },               // temples
      { e: [-0.087, 1.2, 0.15], r: [0.02, 0.03, 0.03], k: 0.02, sub: true },
    ]);
    const head = K.projectSDF({ sdf: headSDF, curve: new T.LineCurve3(V(0, 1.17, 0.03), V(0, 1.15, 0.215)), rows: nr(39), nu: nu(30), cap0: 0.2, cap1: 0.34, rmax: 0.22 });
    K.skin(head, [[I.head, 1]]);
    const g3 = (p, c, s) => { const x = (p.x - c[0]) / s[0], y = (p.y - c[1]) / s[1], z = (p.z - c[2]) / s[2]; return Math.exp(-(x * x + y * y + z * z)); };
    K.paint(head, (p, n) => {
      let c = skinColor(p, n);
      const sock = g3(p, [0.034, 1.17, 0.205], [0.024, 0.018, 0.02]) + g3(p, [-0.034, 1.17, 0.205], [0.024, 0.018, 0.02]);
      c = mul(c, 1 - 0.35 * Math.min(1, sock));                                      // shadowed sockets under the brow
      c = mix(c, C.nose, g3(p, [0, 1.13, 0.28], [0.02, 0.025, 0.02]) * 0.7);
      c = mix(c, C.lip, g3(p, [0, 1.092, 0.232], [0.045, 0.008, 0.02]) * 0.8);
      c = mul(c, 1 - 0.18 * sstep(-0.3, -0.85, n.y) * sstep(1.12, 1.08, p.y));      // under the jaw line
      return mix(c, C.mouth, sstep(-0.4, -0.85, n.y) * sstep(0.2, 0.225, p.z) * sstep(1.1, 1.085, p.y));
    });
    parts.skin.push(head);
    const jawSDF = K.sdf([
      { e: [0, 1.072, 0.165], r: [0.051, 0.027, 0.055] },
      { e: [0, 1.06, 0.213], r: [0.026, 0.022, 0.022], k: 0.02 },                    // jutting chin
      { e: [0.045, 1.088, 0.128], r: [0.013, 0.023, 0.02], k: 0.018 },               // jaw angles
      { e: [-0.045, 1.088, 0.128], r: [0.013, 0.023, 0.02], k: 0.018 },
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 1.076, 0.12), V(0, 1.063, 0.205)), rows: nr(16), nu: nu(20), cap0: 0.25, cap1: 0.25, rmax: 0.12 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => mix(mix(skinColor(p, n), C.lip, g3(p, [0, 1.087, 0.23], [0.04, 0.008, 0.02]) * 0.7), C.mouth, sstep(0.4, 0.85, n.y) * sstep(0.15, 0.19, p.z)));
    parts.skin.push(jaw);
    // eyes, angry upper lids, lower tusks
    for (const s of [-1, 1]) {
      const eye = new T.SphereGeometry(0.0098, nu(12), nr(8)); eye.translate(s * 0.034, 1.17, 0.196);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
      const lid = new T.SphereGeometry(0.0112, nu(12), nr(5), 0, TAU, 0, 1.3); lid.rotateX(0.4); lid.rotateZ(s * 0.32); lid.translate(s * 0.034, 1.17, 0.196);
      parts.skin.push(K.prim(lid, mul(C.skinD, 0.9), I.head));
      const tusk = K.sweep({ pts: [V(s * 0.029, 1.074, 0.21), V(s * 0.032, 1.097, 0.218), V(s * 0.038, 1.116, 0.214)], up: V(0, 0, 1), rows: 5, nu: 7, cap0: 1, cap1: 2,
        prof: (u, o) => { o[0] = o[1] = o[2] = lerp(0.0068, 0.0018, u); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(tusk, [[I.jaw, 1]]); K.paint(tusk, (p) => mix(C.tusk, mul(C.tusk, 0.7), sstep(1.09, 1.075, p.y)));
      parts.gloss.push(tusk);
    }
    /* ears: long, pointed, swept back and out, cupped forward-outward */
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const e = K.sweep({
        pts: [V(s * 0.072, 1.166, 0.09), V(s * 0.118, 1.186, 0.06), V(s * 0.157, 1.203, 0.032), V(s * 0.193, 1.224, 0.004)], up: V(s * 0.45, 0.12, 0.88),
        prof: (u, o) => { o[0] = (0.028 + 0.012 * Math.sin(Math.min(1, u * 2.2) * PI * 0.5)) * Math.pow(1 - u, 0.75) + 0.0015; o[1] = o[2] = 0.0042 * (1 - 0.5 * u) + 0.001; o[3] = 2; o[4] = 0; o[5] = 0.006 * Math.sin(PI * u); return o; },
        cup: (u) => -0.01 * Math.sin(PI * Math.min(1, u * 1.3)) * (1 - u * 0.5), rows: nr(12), nu: nu(12), cap0: 2, cap1: 2,
      });
      K.skin(e, (p) => { const w = sstep(0.09, 0.12, Math.abs(p.x)); return [[I['ear' + k], w], [I.head, 1 - w]]; });
      K.paint(e, (p, n) => mix(skinColor(p, n), C.earIn, sstep(0.0, 0.6, n.z * 0.88 + n.x * s * 0.45) * sstep(0.09, 0.12, Math.abs(p.x)) * 0.8));
      parts.skin.push(e);
    }

    /* limbs (left built, right mirrored) */
    const left = { skin: [], leather: [], cloth: [] };
    // arm
    const aPts = [V(0.162, 1.005, 0.03), W('upL'), W('loL'), W('handL')];
    const aCurve = new T.CatmullRomCurve3(aPts, false, 'centripetal');
    const aTab = M.curve([[0, 0.036, 0.038, 0.04], [0.08, 0.047, 0.046, 0.048], [0.32, 0.034, 0.039, 0.036], [0.55, 0.029, 0.03, 0.032], [0.68, 0.035, 0.033, 0.029], [0.85, 0.028, 0.025, 0.024], [1, 0.023, 0.019, 0.019]]), aq = [0, 0, 0];
    const armProf = (u, o) => { aTab(u, aq); o[0] = aq[0]; o[1] = aq[1]; o[2] = aq[2]; o[3] = 2.1; o[4] = 0; o[5] = 0; return o; };
    const arm = K.sweep({ curve: aCurve, up: V(0, 0, 1), prof: armProf, rows: nr(22), nu: nu(12), cap0: 2, cap1: 2,
      detail: (u, a) => 0.006 * gs(u, 0.3, 0.08) * ga(a, 0, 0.8) + 0.006 * gs(u, 0.28, 0.1) * ga(a, PI, 0.9) + 0.005 * gs(u, 0.66, 0.07) * ga(a, PI / 2, 0.8) + 0.004 * gs(u, 0.57, 0.02) * ga(a, PI, 0.4) });
    const AS = segs([['clavL', aPts[0], aPts[1]], ['upL', aPts[1], aPts[2]], ['loL', aPts[2], aPts[3]], ['handL', aPts[3], V(0.272, 0.43, 0.06)]]);
    K.skin(arm, (p) => K.envelope(AS, p, 4));
    K.paint(arm, (p, n) => skinColor(p, n));
    left.skin.push(arm);
    // bracer: shell over the forearm (sampled from the arm curve), stitched straps
    const b0 = 0.66, b1 = 0.96, bPts = []; for (let i = 0; i <= 4; i++) bPts.push(aCurve.getPointAt(lerp(b0, b1, i / 4)));
    const bracer = K.sweep({ pts: bPts, up: V(0, 0, 1), rows: nr(8), nu: nu(14), cap0: 1, cap1: 1,
      prof: (u, o) => { armProf(lerp(b0, b1, u), o); o[0] += 0.009; o[1] += 0.009; o[2] += 0.009; return o; } });
    K.skin(bracer, (p) => K.envelope(AS, p, 4));
    K.paint(bracer, (p, n, info) => { const u = info ? info.s : 0.5; return mul(C.leather, (0.85 + 0.15 * n.y * 0.5) * (1 - 0.35 * (gs(u, 0.22, 0.05) + gs(u, 0.75, 0.05)))); });
    left.leather.push(scaleUV(bracer, 0.6, 0.6));
    // leg
    const lPts = [V(0.078, 0.685, -0.005), W('thL'), W('shinL'), W('footL')];
    const lTab = M.curve([[0, 0.062, 0.062, 0.067], [0.12, 0.066, 0.07, 0.074], [0.35, 0.057, 0.064, 0.06], [0.55, 0.043, 0.047, 0.043], [0.7, 0.043, 0.039, 0.058], [0.88, 0.033, 0.031, 0.037], [1, 0.028, 0.026, 0.029]]), lq = [0, 0, 0];
    const leg = K.sweep({ pts: lPts, up: V(0, 0, 1), rows: nr(22), nu: nu(12), cap0: 2, cap1: 2,
      prof: (u, o) => { lTab(u, lq); o[0] = lq[0]; o[1] = lq[1]; o[2] = lq[2]; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.006 * gs(u, 0.55, 0.03) * ga(a, 0, 0.5) + 0.004 * gs(u, 0.32, 0.1) * ga(a, 0.4, 0.8) });
    const LS = segs([['pelvis', lPts[0], lPts[1]], ['thL', lPts[1], lPts[2]], ['shinL', lPts[2], lPts[3]], ['footL', lPts[3], W('toeL')]]);
    K.skin(leg, (p) => K.envelope(LS, p, 4));
    K.paint(leg, (p, n) => skinColor(p, n));
    left.skin.push(leg);
    // foot: wrapped heel / arch (cloth) + bare long toes with dark nails (skin)
    const FS = segs([['shinL', V(0.104, 0.2, 0.02), W('footL')], ['footL', W('footL'), W('toeL')], ['toeL', W('toeL'), V(0.117, 0.018, 0.148)]]);
    const wrap = K.sweep({ pts: [V(0.105, 0.15, -0.012), V(0.108, 0.075, -0.03), V(0.108, 0.047, -0.058), V(0.109, 0.043, 0.0), V(0.113, 0.037, 0.068)], up: V(0, 1, 0), rows: nr(11), nu: nu(12), cap0: 1, cap1: 2,
      prof: (u, o) => { o[0] = lerp(0.031, 0.044, sstep(0.3, 1, u)); o[1] = lerp(0.031, 0.026, sstep(0.3, 1, u)); o[2] = lerp(0.031, 0.022, sstep(0.25, 0.6, u)); o[3] = 2.4; o[4] = 0; o[5] = 0.01 * sstep(0.35, 0.6, u); return o; } });
    K.skin(wrap, (p) => K.envelope(FS, p, 4));
    K.paint(wrap, (p, n) => mul(C.wrap, (0.85 + 0.15 * Math.sin((p.y * 1.4 + p.z) * 160)) * (0.9 + 0.1 * n.y)));
    left.cloth.push(scaleUV(wrap, 0.8, 0.8));
    const toes = K.sweep({ pts: [V(0.11, 0.04, 0.035), V(0.114, 0.032, 0.095), V(0.117, 0.023, 0.146)], up: V(0, 1, 0), rows: nr(9), nu: nu(12), cap0: 1, cap1: 3,
      prof: (u, o) => { o[0] = lerp(0.04, 0.037, u) * (1 - 0.22 * sstep(0.8, 1, u)); o[1] = lerp(0.024, 0.015, u); o[2] = lerp(0.02, 0.012, u); o[3] = 2.3; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.0035 * sstep(0.55, 0.85, u) * Math.pow(Math.abs(Math.cos(a * 2.0)), 4) * ga(a, 0, 1.3) });
    K.skin(toes, (p) => K.envelope(FS, p, 4));
    K.paint(toes, (p, n, info) => mix(skinColor(p, n), C.nail, sstep(0.82, 0.95, info ? info.s : 0) * sstep(-0.2, 0.4, n.y)));
    left.skin.push(toes);
    // left hand: palm + half-curled clawed fingers + thumb
    const HS = segs([['loL', W('loL'), W('handL')], ['handL', W('handL'), V(0.272, 0.43, 0.06)]]);
    const palm = K.sweep({ pts: [V(0.265, 0.535, 0.042), V(0.27, 0.488, 0.052), V(0.273, 0.447, 0.058)], up: V(1, 0, 0), rows: nr(7), nu: nu(12), cap0: 1, cap1: 1,
      prof: (u, o) => { o[0] = lerp(0.025, 0.034, u); o[1] = 0.012; o[2] = 0.011; o[3] = 2.4; o[4] = 0; o[5] = 0; return o; } });
    K.skin(palm, (p) => K.envelope(HS, p, 4)); K.paint(palm, (p, n) => skinColor(p, n));
    left.skin.push(palm);
    const finger = (pts, r0, slot, list) => {
      const f = K.sweep({ pts, up: V(0, 0, 1), rows: nr(6), nu: 6, cap0: 1, cap1: 2, prof: (u, o) => { o[0] = o[1] = o[2] = lerp(r0, r0 * 0.62, u); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
      K.skin(f, [[I[slot], 1]]); K.paint(f, (p, n, info) => mix(skinColor(p, n), C.nail, sstep(0.82, 0.96, info ? info.s : 0)));
      list.push(f);
    };
    for (const [zf, len] of [[0.03, 0.85], [0.047, 1], [0.064, 1], [0.081, 0.92]]) {
      finger([V(0.273, 0.448, zf), V(0.276, 0.448 - 0.034 * len, zf + 0.004), V(0.266, 0.448 - 0.062 * len, zf + 0.012), V(0.252, 0.448 - 0.07 * len, zf + 0.012)], 0.0085, 'handL', left.skin);
    }
    finger([V(0.262, 0.505, 0.07), V(0.257, 0.468, 0.09), V(0.249, 0.444, 0.096)], 0.0092, 'handL', left.skin);
    // mirror everything on the left to the right side
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    const remap = (b) => (lr[b] !== undefined ? lr[b] : b);
    for (const slot in left) for (const g of left[slot]) { parts[slot].push(g); }
    for (const slot of ['skin', 'leather', 'cloth']) for (const g of left[slot]) {
      if (g === palm || left.skin.indexOf(g) > left.skin.indexOf(palm)) continue;     // the right hand is built separately (it grips)
      parts[slot].push(K.mirrorX(g, remap));
    }
    parts.skin.push(K.mirrorX(palm, remap));
    // right hand: fingers wrapped around the dagger grip (grip axis along +Z at x -0.256, y 0.425)
    const RH = [];
    for (const [zf, k] of [[0.03, 0.9], [0.047, 1], [0.064, 1], [0.081, 0.95]]) {
      finger([V(-0.273, 0.448, zf), V(-0.277, 0.426, zf + 0.002), V(-0.27, 0.405, zf + 0.004), V(-0.25, 0.402, zf + 0.004), V(-0.238, 0.418 + 0.004 * k, zf + 0.002)], 0.0088, 'handR', RH);
    }
    finger([V(-0.262, 0.505, 0.07), V(-0.25, 0.462, 0.096), V(-0.24, 0.438, 0.104)], 0.0095, 'handR', RH);
    parts.skin.push(...RH);

    /* dagger: wrapped grip (leather), pommel + guard + short leaf blade (iron) - all on the right hand */
    const GX = -0.256, GY = 0.425;
    const grip = K.sweep({ pts: [V(GX, GY, -0.004), V(GX, GY, 0.06), V(GX, GY, 0.116)], up: V(0, 1, 0), rows: nr(10), nu: nu(10), cap0: 1, cap1: 1,
      prof: (u, o) => { o[0] = o[1] = o[2] = 0.0108 + 0.0012 * Math.abs(Math.sin(u * PI * 7)); o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
    K.skin(grip, [[I.handR, 1]]); K.paint(grip, (p) => mul(C.grip, 0.8 + 0.2 * Math.abs(Math.sin(p.z * 140))));
    parts.leather.push(scaleUV(grip, 0.3, 0.3));
    const pommel = new T.SphereGeometry(0.0155, nu(10), nr(8)); pommel.scale(1, 1, 0.75); pommel.translate(GX, GY, -0.012);
    parts.iron.push(K.prim(pommel, C.ironD, I.handR));
    const guard = K.sweep({ pts: [V(GX, GY - 0.036, 0.12), V(GX, GY, 0.123), V(GX, GY + 0.036, 0.12)], up: V(0, 0, 1), rows: 5, nu: nu(8), cap0: 2, cap1: 2,
      prof: (u, o) => { o[0] = 0.0075; o[1] = o[2] = 0.0058; o[3] = 2.5; o[4] = 0; o[5] = 0; return o; } });
    K.skin(guard, [[I.handR, 1]]); K.paint(guard, C.ironD); parts.iron.push(guard);
    const blade = K.sweep({ pts: [V(GX, GY, 0.124), V(GX, GY + 0.002, 0.22), V(GX, GY + 0.003, 0.32)], up: V(0, 1, 0), rows: nr(10), nu: nu(10), cap0: 1, cap1: 1,
      prof: (u, o) => { const w = 0.0165 * (1 - Math.pow(u, 2.2)) * (1 + 0.15 * Math.sin(u * PI)); o[0] = 0.0036 * (1 - 0.7 * u); o[1] = w; o[2] = w; o[3] = 1.35; o[4] = 0; o[5] = 0; return o; } });
    K.skin(blade, [[I.handR, 1]]);
    K.paint(blade, (p, n) => { const edge = sstep(0.4, 0.9, Math.abs(n.y)); const rust = sstep(0.55, 0.75, noise(p, 90)) * 0.6 * sstep(0.2, 0.13, p.z); return mix(mix(C.iron, mul(C.iron, 1.18), edge), C.rust, rust); });
    parts.iron.push(blade);

    /* cuirass: thick leather band (lower in front, under the arms at the sides), shoulder straps, studs */
    const cuirass = band({ yb: (a) => 0.715 - 0.03 * Math.pow(Math.max(0, Math.cos(a)), 2), yt: (a) => 0.9 + 0.055 * Math.pow(Math.cos(a), 2), off: 0.013, inner: 0.001, rows: nr(10), nu: nu(30) });
    K.skin(cuirass, torsoW);
    K.paint(cuirass, (p, n, info) => {
      const t = info ? info.t : 0.5, hem = sstep(0.12, 0.0, t) + sstep(0.88, 1, t) + (info && info.rim ? 1 : 0);
      const seam = gs(Math.sin(info ? info.a : 0) * 3, 0, 0.12) * 0.25;         // side lacing seams
      return mul(mix(C.leather, C.leatherD, Math.min(1, hem * 0.8 + seam)), 0.88 + 0.16 * noise(p, 22));
    });
    parts.leather.push(scaleUV(cuirass, 2.6, 0.8));
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const pts = [surf(0.9, s * 0.55, 0.018), surf(0.965, s * 0.95, 0.016), surf(0.997, s * 1.45, 0.016), surf(0.97, s * (PI - 1.0), 0.016), surf(0.9, s * (PI - 0.55), 0.018)];
      const ctr = (y) => V(0, y, czAt(y));
      const strap = K.sweep({ pts, rows: nr(14), nu: 6, cap0: 1, cap1: 1, upAt: (u) => { const p = new T.CatmullRomCurve3(pts).getPointAt(u); return p.sub(ctr(p.y)).normalize().lerp(V(0, 1, 0), 0.25).normalize(); },
        prof: (u, o) => { o[0] = 0.016; o[1] = o[2] = 0.0035; o[3] = 3; o[4] = 0; o[5] = 0; return o; } });
      K.skin(strap, torsoW); K.paint(strap, (p, n) => mul(C.leatherD, 0.85 + 0.15 * n.y));
      parts.leather.push(scaleUV(strap, 0.3, 2));
      for (const y of [0.93]) { const st = new T.SphereGeometry(0.0075, 8, 6); st.scale(1, 1, 0.6); const sp = surf(y, s * 0.55, 0.018); st.lookAt(V(sp.x, 0, sp.z)); st.translate(sp.x, sp.y, sp.z); parts.iron.push(K.skin(K.prim(st, C.ironD), torsoW)); }
    }
    // pauldron (left shoulder): two overlapping cupped leather plates riding the clavicle / upper arm
    const PS = segs([['clavL', V(0.025, 0.985, 0.05), W('upL')], ['upL', W('upL'), W('loL')]]);
    for (const [y0, y1, w0, off] of [[1.012, 0.905, 0.072, 0], [0.94, 0.862, 0.06, 0.012]]) {
      const pl = K.sweep({ pts: [V(0.13 + off, y0, 0.03), V(0.195 + off, (y0 + y1) / 2 + 0.014, 0.03), V(0.236 + off, y1, 0.03)], up: V(0.72, 0.68, 0), rows: nr(9), nu: nu(14), cap0: 1, cap1: 1,
        prof: (u, o) => { o[0] = w0 * (0.75 + 0.25 * Math.sin(PI * Math.min(1, u * 1.2))); o[1] = o[2] = 0.0045; o[3] = 2; o[4] = 0; o[5] = 0.021; return o; },
        cup: () => 0.026 });
      K.skin(pl, (p) => K.envelope(AS, p, 4));
      K.paint(pl, (p, n, info) => mul(mix(C.leather, C.leatherD, sstep(0.8, 1, Math.abs((info ? info.a : 0)) / PI) + sstep(0.85, 1, info ? info.s : 0)), 0.9 + 0.12 * noise(p, 30)));
      parts.leather.push(scaleUV(pl, 0.5, 0.5));
    }
    const stud = new T.SphereGeometry(0.008, 8, 6); stud.translate(0.168, 1.016, 0.03); parts.iron.push(K.skin(K.prim(stud, C.iron), (p) => K.envelope(AS, p, 4)));

    /* belt + buckle + pouch */
    const belt = band({ yb: () => 0.638, yt: () => 0.688, off: 0.017, inner: 0.002, rows: nr(3), nu: nu(30) });
    K.skin(belt, torsoW); K.paint(belt, (p, n, info) => mul(C.belt, info && info.rim ? 0.75 : 0.95 + 0.1 * noise(p, 40)));
    parts.leather.push(scaleUV(belt, 2.6, 0.25));
    const bp = surf(0.663, 0, 0.022);
    const buckle = K.sweep({ pts: [V(-0.02, -0.018, 0), V(0.02, -0.018, 0), V(0.02, 0.018, 0), V(-0.02, 0.018, 0)].map((v) => v.add(bp)), closed: true, up: V(0, 0, 1), rows: 12, nu: 6, cap0: 0, cap1: 0,
      prof: (u, o) => { o[0] = o[1] = o[2] = 0.0032; o[3] = 2; o[4] = 0; o[5] = 0; return o; } });
    K.skin(buckle, torsoW); K.paint(buckle, C.ironD); parts.iron.push(buckle);
    const pp = surf(0.62, -1.75, 0.02);
    const pouch = K.sweep({ pts: [V(pp.x, 0.665, pp.z), V(pp.x - 0.012, 0.615, pp.z), V(pp.x - 0.006, 0.57, pp.z)], up: V(-0.98, 0, 0.18), rows: nr(7), nu: nu(12), cap0: 2, cap1: 3,
      prof: (u, o) => { o[0] = 0.034 * (0.85 + 0.15 * Math.sin(PI * u)); o[1] = 0.022; o[2] = 0.012; o[3] = 2.3; o[4] = 0; o[5] = 0; return o; } });
    K.skin(pouch, torsoW); K.paint(pouch, (p, n) => mul(C.leather, 0.8 + 0.2 * n.y)); parts.leather.push(scaleUV(pouch, 0.4, 0.4));

    /* loincloth: front and back panels hanging from the belt; lower rows follow both thighs (no leg poking through) */
    for (const back of [false, true]) {
      const sz = back ? -1 : 1, top = surf(0.665, back ? PI : 0, 0.019);
      const pts = back ? [top, V(0, 0.58, top.z - 0.022), V(0, 0.5, top.z - 0.018)] : [top, V(0, 0.56, top.z + sz * 0.018), V(0, 0.44, top.z + sz * 0.012)];
      const panel = K.sweep({ pts, up: V(0, 0, sz), rows: nr(9), nu: nu(10), cap0: 1, cap1: 1,
        prof: (u, o) => { o[0] = (back ? lerp(0.1, 0.09, u) : lerp(0.085, 0.07, u)) + 0.004 * Math.sin(u * 30); o[1] = o[2] = 0.0035; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.002 * Math.sin(Math.sin(a) * 20) * u });
      K.skin(panel, (p) => { const w = sstep(0.64, 0.46, p.y); return [[I.pelvis, 1 - w], [I.thL, w * 0.5], [I.thR, w * 0.5]]; });
      K.paint(panel, (p, n, info) => mul(C.cloth, (0.92 + 0.12 * noise(p, 26)) * (1 - 0.3 * sstep(0.75, 1, info ? info.s : 0))));
      parts.cloth.push(scaleUV(panel, 0.6, 0.8));
    }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const D = CREATURE_DEFS.SPECIES.goblin;
  const ch = (n) => chan[n];
  const add = (P, n, v) => { P[chan[n]] += v; };
  const legs = [
    { key: 'L', type: 'hind', side: 1, chain: ['thL', 'shinL', 'footL', 'toeL'], padH: 0.012, toeLen: 0.07, lift: 0.075, curl: 0.35 },
    { key: 'R', type: 'hind', side: -1, chain: ['thR', 'shinR', 'footR', 'toeR'], padH: 0.012, toeLen: 0.07, lift: 0.075, curl: 0.35 },
  ];
  const gaits = {
    walk: { stride: (v) => 0.42 + 0.34 * v, duty: 0.6, minV: 0.06 },
    run: { stride: (v) => 0.62 + 0.19 * v, duty: 0.34, minV: 0.06, liftK: (v) => 1.4 },
  };
  const offsets = { L: { walk: 0, run: 0 }, R: { walk: 0.5, run: 0.5 } };
  const select = (v, cur) => (cur === 'run' ? (v < 2.0 ? 'walk' : 'run') : (v > 2.4 ? 'run' : 'walk'));

  // ready stance shared by idle / locomotion (crouched, hunched, dagger forward)
  function stance(P, k) {
    add(P, 'body.py', -0.058 * k); add(P, 'spine.rx', 0.16 * k); add(P, 'chest.rx', 0.1 * k);
    add(P, 'neck.rx', -0.22 * k); add(P, 'head.rx', -0.05 * k);
    add(P, 'upL.rx', -0.22 * k); add(P, 'upL.rz', -0.12 * k); add(P, 'loL.rx', -0.6 * k); add(P, 'handL.rx', -0.15 * k);
    add(P, 'upR.rx', -0.32 * k); add(P, 'upR.rz', 0.1 * k); add(P, 'loR.rx', -1.1 * k); add(P, 'handR.rx', 0.62 * k); add(P, 'handR.rz', -0.1 * k);
    add(P, 'clavL.rz', 0.06 * k); add(P, 'clavR.rz', -0.06 * k);                       // shoulders slightly raised (wary)
  }
  function base(P, ctx, A) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.6) : 0, 6, dt);
    ctx.rw = M.damp(ctx.rw || 0, ctx.gaitName === 'run' ? 1 : 0, 5, dt);
    const mw = ctx.mw, idle = 1 - mw, rw = ctx.rw, ww = mw * (1 - rw), rr = mw * rw, ph = ctx.phase * TAU;
    stance(P, 1);
    // ---- walk: inverted-pendulum bob (high at mid-stance), weight over the stance foot, pelvis yaw + hip drop,
    //      shoulders counter-rotate, arms swing opposite to the legs (dagger arm less)
    add(P, 'body.py', ww * 0.016 * Math.cos(2 * ph - 2 * TAU * 0.3) - 0.01 * ww);
    add(P, 'body.px', ww * 0.022 * Math.cos(ph - TAU * 0.3));
    add(P, 'pelvis.ry', -(ww * 0.17 + rr * 0.24) * Math.cos(ph));
    add(P, 'pelvis.rz', ww * 0.055 * Math.cos(ph - TAU * 0.3));
    add(P, 'spine.ry', (ww * 0.07 + rr * 0.08) * Math.cos(ph));
    add(P, 'chest.ry', (ww * 0.1 + rr * 0.16) * Math.cos(ph));
    add(P, 'chest.rz', -ww * 0.03 * Math.cos(ph - TAU * 0.3));
    // ---- run: lowest at mid-stance, airborne between steps, stronger forward lean, pumping arms
    add(P, 'body.py', rr * (-0.045 - 0.03 * Math.cos(2 * ph - 2 * TAU * 0.17)));
    add(P, 'spine.rx', rr * 0.2 + ww * 0.04); add(P, 'chest.rx', rr * 0.06);
    const S = ww * 0.4 + rr * 0.55;
    add(P, 'upL.rx', S * Math.cos(ph)); add(P, 'upR.rx', -S * 0.5 * Math.cos(ph));
    add(P, 'loL.rx', -rr * 0.9 - 0.35 * mw * Math.max(0, -Math.cos(ph))); add(P, 'loR.rx', -rr * 0.35);
    add(P, 'upL.rz', -rr * 0.1); add(P, 'upR.rz', rr * 0.08);
    // bend into turns, look where it is going
    const tr = M.clamp(ctx.turn * 0.06, -0.3, 0.3);
    add(P, 'spine.ry', tr * 0.5); add(P, 'chest.ry', tr * 0.4); add(P, 'neck.ry', tr * 0.8);
    // ---- idle: slow weight shifting between the feet, breathing, twitchy head looks (animator state), ear flicks
    const sway = Math.sin(t * 0.55) * 0.6 + Math.sin(t * 0.21 + 1) * 0.4;
    add(P, 'body.px', idle * 0.02 * sway); add(P, 'pelvis.rz', idle * 0.035 * sway); add(P, 'chest.rz', -idle * 0.02 * sway);
    add(P, 'body.py', idle * 0.006 * Math.sin(t * 0.9));
    add(P, 'chest.rx', idle * 0.025 * Math.sin(t * 2.3));
    add(P, 'upR.rx', idle * 0.05 * Math.sin(t * 1.3)); add(P, 'loR.rx', idle * 0.06 * Math.sin(t * 1.1 + 1));    // dagger hand never quite still
    const L = A.look;
    add(P, 'neck.ry', L.y * 0.45 * (0.4 + 0.6 * idle)); add(P, 'head.ry', L.y * 0.55 * (0.4 + 0.6 * idle));
    add(P, 'neck.rx', L.p * 0.4 * idle); add(P, 'head.rx', L.p * 0.6 * idle);
    add(P, 'head.rz', L.y * -0.15 * idle);
    // head stabilisation: the neck cancels the trunk pitch so the eyes stay level
    const trunk = P[ch('spine.rx')] + P[ch('chest.rx')] - 0.26;
    add(P, 'neck.rx', -trunk * 0.55); add(P, 'head.rx', -trunk * 0.2);
    // ears pin back when running, perk with alert looks
    add(P, 'earL.ry', -rr * 0.35); add(P, 'earR.ry', rr * 0.35); add(P, 'earL.rz', -rr * 0.15); add(P, 'earR.rz', rr * 0.15);
    add(P, 'jawO', 0.04 + 0.03 * Math.sin(t * 2.3) * idle + 0.12 * rr);
  }
  // heel-toe roll: heel lifts through late stance, toe pushes off, the foot dorsiflexes before landing
  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0, r = Lg.restDistal;
    if (f.planted) return r - 0.85 * sstep(0.55, 1, f.stanceU) * mw;
    const u = f.swingU;
    return r - 0.85 * (1 - sstep(0.0, 0.5, u)) + 0.22 * sstep(0.45, 0.75, u) * sstep(1.0, 0.85, u);
  }
  function post(P, ctx, A) {
    const B = A.B;
    B[I.ribs].scale.setScalar(1 + 0.028 * A.alive() * Math.sin(ctx.t * (ctx.moving ? 7 : 2.4)));
    B[I.jaw].rotateX(Math.max(0, P[ch('jawO')]) * 0.8);
  }
  function secondary(ctx, A) {
    const dt = ctx.dt, B = A.B, lk = A.look, k = A.alive();              // corpses stay still
    if (k <= 0) return;
    // ears: lag behind head turns and the bob, plus the occasional flick
    const by = (B[I.body].position.y - tpl.local[I.body].y) * -12;
    const ex = K.stepSpring(A.sp_('ex'), by + lk.vy * 0.04, 140, 9, dt);
    const ey = K.stepSpring(A.sp_('ey'), -lk.vy * 0.06, 120, 8, dt);
    B[I.earL].rotateX((ex * 0.5 + A.flickL) * k); B[I.earR].rotateX((ex * 0.5 + A.flickR) * k);
    B[I.earL].rotateY(ey * 0.5 * k); B[I.earR].rotateY(ey * 0.5 * k);
  }
  function flinch(P, t, dir, pow) {
    const k = Math.exp(-t * 8) * Math.sin(Math.min(1, t * 14) * PI * 0.5) * Math.min(1.4, pow);
    add(P, 'body.px', dir[0] * 0.05 * k); add(P, 'body.pz', dir[1] * 0.05 * k); add(P, 'body.py', -0.02 * k);
    add(P, 'spine.rx', -0.22 * k); add(P, 'chest.rx', -0.12 * k); add(P, 'spine.rz', -dir[0] * 0.2 * k);
    add(P, 'neck.rx', -0.25 * k); add(P, 'head.rx', -0.25 * k); add(P, 'jawO', 0.5 * k);
    add(P, 'upL.rx', -0.4 * k); add(P, 'loL.rx', -0.5 * k); add(P, 'upR.rz', 0.2 * k);
    add(P, 'earL.rx', -0.5 * k); add(P, 'earR.rx', -0.5 * k);
  }

  /* attacks keyed on the gameplay timeline (s, an, wu, hit, fo, e) */
  const stabA = D.attacks.stab, slashA = D.attacks.slash;
  const actions = {
    // STAB: weight back + right shoulder drawn back, then hips -> chest -> arm drive a straight thrust, left arm counters
    stab: {
      kind: 'attack', dur: stabA.dur, blendIn: 0.08, blendOut: 0.22,
      track: K.track(chan, stabA.phases, {
        'body.py': [0, -0.05, -0.04, -0.035, -0.04, 0], 'body.pz': [0, -0.035, -0.05, 0.09, 0.07, 0],
        'spine.rx': [0, 0.06, -0.02, 0.14, 0.12, 0], 'spine.ry': [0, -0.14, -0.32, 0.22, 0.18, 0], 'chest.ry': [0, -0.1, -0.28, 0.3, 0.22, 0],
        'pelvis.ry': [0, -0.1, -0.2, 0.16, 0.1, 0], 'chest.rx': [0, 0, -0.04, -0.1, -0.06, 0],
        'upR.rx': [0, 0.2, 0.55, -1.42, -1.25, 0], 'upR.rz': [0, 0.08, 0.14, 0.12, 0.1, 0], 'upR.ry': [0, 0.05, 0.12, -0.5, -0.4, 0],   // aims at the target despite the trunk twist
        'loR.rx': [0, -0.25, -0.55, 1.02, 0.92, 0], 'handR.rx': [0, 0.05, 0.15, 0.85, 0.72, 0],      // wrist tips the blade in line with the forearm
        'upL.rx': [0, -0.2, -0.38, 0.4, 0.3, 0], 'loL.rx': [0, -0.2, -0.35, 0.1, 0.05, 0],
        'neck.rx': [0, 0.08, 0.02, -0.08, -0.06, 0], 'neck.ry': [0, 0.1, 0.22, -0.2, -0.15, 0],
        'jawO': [0, 0.1, 0.25, 0.4, 0.22, 0], 'earL.rx': [0, -0.2, -0.4, -0.3, -0.2, 0], 'earR.rx': [0, -0.2, -0.4, -0.3, -0.2, 0],
      }),
    },
    // SLASH (alternate): wind the torso left with the dagger arm across the chest, then a wide backhand sweep to the right
    slash: {
      kind: 'attack', dur: slashA.dur, blendIn: 0.1, blendOut: 0.25,
      track: K.track(chan, slashA.phases, {
        'body.py': [0, -0.04, -0.065, -0.045, -0.035, 0], 'body.pz': [0, -0.02, -0.03, 0.06, 0.05, 0],
        'pelvis.ry': [0, 0.14, 0.24, -0.06, -0.14, 0], 'spine.ry': [0, 0.28, 0.48, -0.06, -0.24, 0], 'chest.ry': [0, 0.2, 0.38, -0.1, -0.2, 0],
        'spine.rx': [0, 0.05, 0.1, 0.12, 0.08, 0],
        'upR.rx': [0, -0.45, -0.85, -1.25, -1.0, 0], 'upR.rz': [0, 0.4, 0.8, -0.35, -0.8, 0],
        'loR.rx': [0, -0.45, -0.9, 0.85, 0.85, 0], 'handR.ry': [0, 0.3, 0.5, -0.1, -0.25, 0], 'handR.rx': [0, 0.1, 0.25, 0.75, 0.7, 0],
        'upL.rx': [0, 0.15, 0.3, -0.2, -0.3, 0], 'upL.rz': [0, -0.15, -0.3, 0.25, 0.38, 0], 'loL.rx': [0, -0.2, -0.3, -0.1, -0.1, 0],
        'neck.ry': [0, -0.2, -0.32, 0.1, 0.28, 0], 'head.ry': [0, -0.1, -0.15, 0.05, 0.12, 0],
        'jawO': [0, 0.1, 0.35, 0.5, 0.3, 0], 'earL.rx': [0, -0.25, -0.5, -0.4, -0.2, 0], 'earR.rx': [0, -0.25, -0.5, -0.4, -0.2, 0],
      }),
    },
    stagger: {
      kind: 'stagger', dur: 1.0, blendIn: 0.06, blendOut: 0.3,
      track: (P, u, w) => {
        const k = Math.sin(PI * Math.min(1, u * 1.1)) * w, wob = Math.sin(u * 22) * sstep(0, 0.2, u) * sstep(0.8, 0.4, u) * w;
        add(P, 'body.pz', -0.1 * k); add(P, 'body.py', -0.05 * k); add(P, 'spine.rx', -0.3 * k); add(P, 'chest.rx', -0.15 * k);
        add(P, 'spine.rz', 0.12 * wob); add(P, 'neck.rx', -0.2 * k); add(P, 'head.rz', 0.2 * wob); add(P, 'jawO', 0.6 * k);
        add(P, 'upL.rx', -0.8 * k); add(P, 'upL.rz', 0.5 * k); add(P, 'loL.rx', -0.6 * k); add(P, 'upR.rz', -0.5 * k); add(P, 'upR.rx', -0.3 * k);
      },
    },
    // DEATH: recoil, buckle to the knees, then topple onto the side and go limp
    death: {
      kind: 'death', dur: 1.9, blendIn: 0.06, hold: true,
      track: (P, u, w, layer, ctx, A) => {
        const side = (layer.data && layer.data.side) || 1;
        stance(P, (1 - A.alive()) * w);                                                    // the base layer fades after death: keep its crouch here
        const rec = sstep(0, 0.08, u) * sstep(0.22, 0.1, u), kn = M.ease.io(sstep(0.08, 0.42, u)), fall = M.ease.io(sstep(0.42, 0.72, u)), lim = sstep(0.7, 1, u);
        add(P, 'spine.rx', (-0.35 * rec + 0.45 * kn - 0.35 * fall) * w); add(P, 'neck.rx', (-0.3 * rec + 0.25 * kn) * w); add(P, 'head.rx', (0.3 * kn - 0.2 * fall) * w);
        add(P, 'body.py', (-0.36 * kn - 0.16 * fall) * w); add(P, 'body.pz', (-0.04 * rec + 0.05 * kn) * w);
        add(P, 'body.rz', side * 1.45 * fall * w); add(P, 'body.rx', 0.25 * fall * w);
        const ik = sstep(0.06, 0.2, u) * w;
        add(P, 'ikL', -ik); add(P, 'ikR', -ik);
        for (const [k, s] of [['L', 1], ['R', -1]]) {
          const low = (s === -1) === (side === 1);                                           // the arm / leg that ends up underneath
          add(P, 'th' + k + '.rx', (-0.2 * kn - (low ? 0.35 : 0.75) * fall) * w); add(P, 'shin' + k + '.rx', (1.5 * kn - (low ? 0.95 : 0.6) * fall) * w); add(P, 'foot' + k + '.rx', (0.55 * kn - 0.3 * fall) * w);
          add(P, 'th' + k + '.rz', s * 0.1 * kn * w);
          add(P, 'up' + k + '.rx', (0.2 * kn - (low ? 1.15 : 0.55) * fall) * w); add(P, 'up' + k + '.rz', (s * -0.1 * kn - s * (low ? 0.25 : -0.15) * fall) * w);
          add(P, 'lo' + k + '.rx', (0.4 * kn + (low ? -0.2 : 0.5) * fall + 0.3 * lim) * w); add(P, 'hand' + k + '.rx', (0.3 * kn + (k === 'R' ? -0.6 : 0.2) * fall) * w);
          add(P, 'ear' + k + '.rx', -0.5 * kn * w);
        }
        add(P, 'neck.rz', -side * 0.3 * fall * w); add(P, 'jawO', (0.3 * kn + 0.2 * lim) * w);
      },
    },
    look: {
      kind: 'special', dur: 2.8, blendIn: 0.3, blendOut: 0.4,
      track: (P, u, w) => {
        const env = sstep(0, 0.12, u) * sstep(1, 0.86, u) * w, scan = Math.sin(u * TAU * 1.0 + 0.4);
        add(P, 'neck.ry', 0.55 * scan * env); add(P, 'head.ry', 0.35 * scan * env); add(P, 'spine.ry', 0.12 * scan * env);
        add(P, 'neck.rx', -0.12 * env); add(P, 'body.py', -0.03 * env);
        add(P, 'upL.rx', -0.7 * env); add(P, 'loL.rx', -0.5 * env);                       // hand raised, ready
        add(P, 'earL.rx', 0.2 * env); add(P, 'earR.rx', 0.2 * env);
      },
    },
    taunt: {
      kind: 'special', dur: 2.3, blendIn: 0.2, blendOut: 0.35,
      track: (P, u, w) => {
        const env = sstep(0, 0.12, u) * sstep(1, 0.82, u) * w, b = Math.abs(Math.sin(u * PI * 6));
        add(P, 'body.py', (-0.04 + 0.03 * b) * env);                                      // bounces on bent knees
        add(P, 'upR.rx', -1.8 * env); add(P, 'upR.rz', -0.3 * env); add(P, 'loR.rx', (0.3 + 0.5 * Math.sin(u * PI * 8)) * env);   // dagger waved overhead
        add(P, 'handR.rx', -0.6 * env);
        add(P, 'upL.rx', -0.3 * env); add(P, 'upL.rz', 0.3 * env); add(P, 'loL.rx', -1.0 * env);
        add(P, 'spine.rx', -0.1 * env); add(P, 'neck.rx', -0.25 * env); add(P, 'head.rz', 0.15 * Math.sin(u * PI * 6) * env);
        add(P, 'jawO', (0.25 + 0.3 * b) * env);                                           // cackling
      },
    },
  };

  /* BipedAnimator: the shared foot-planting / IK animator with two plantigrade legs, plus a goblin's nervous system
     (saccadic head looks, ear flicks). */
  class BipedAnimator extends K.QuadAnimator {
    constructor(view, opts) {
      super(view, opts);
      this.look = { y: 0, p: 0, ty: 0, tp: 0, t: 0, vy: 0 };
      this.flickL = 0; this.flickR = 0; this.flickT = 1 + Math.random() * 2;
    }
    // 1 while alive, fades to 0 over 0.35 s after death (same curve QuadAnimator applies to the base layer)
    alive() { return this.v.sm.dead ? Math.max(0, 1 - (this.deadT || 0) / 0.35) : 1; }
    update(dt, quality) {
      const L = this.look;
      if (this.v.sm.dead) { this.flickL = this.flickR = 0; L.ty = L.y; L.tp = L.p; L.t = 99; }
      L.t -= dt;
      if (L.t <= 0) { L.ty = (Math.random() - 0.5) * 1.2; L.tp = (Math.random() - 0.5) * 0.35; L.t = 0.35 + Math.random() * 1.8; }
      const py = L.y;
      L.y = M.damp(L.y, L.ty, 16, dt); L.p = M.damp(L.p, L.tp, 12, dt);       // quick, bird-like head snaps
      L.vy = (L.y - py) / Math.max(dt, 1e-4);
      this.flickT -= dt;
      if (this.flickT <= 0) { this.flickT = 1.2 + Math.random() * 3.5; if (Math.random() < 0.5) this.flickL = 0.5; else this.flickR = 0.5; }
      this.flickL = M.damp(this.flickL, 0, 10, dt); this.flickR = M.damp(this.flickR, 0, 10, dt);
      super.update(dt, quality);
    }
  }

  K.defineSpecies('goblin', {
    rig: tpl, chan, build, lowQ: 0.45, animator: BipedAnimator, debugScale: 1.4,
    anim: { legs, gaits, offsets, select, base, distal, post, secondary, flinch, actions, gaitOpts: { restTol: 0.08, idleStepDur: 0.24 }, groundFix: true },
    clips: ['idle', 'walk', 'run', 'stab', 'slash', 'look', 'taunt', 'hit', 'death'],
    attackAction: { stab: 'stab', slash: 'slash' }, specials: ['look', 'taunt'],
    def: D,
  });
})();
