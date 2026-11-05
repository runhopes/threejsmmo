/* Steppe Wolf (levels 6-8): lean, athletic digitigrade hunter - deep narrow chest, tucked abdomen, distinct croup and
 * muscular "breeches", heavy neck ruff, long muzzle with a defined stop and brow, erect triangular ears, amber eyes,
 * long straight forelegs, compact oval paws, bushy tail carried low. Steppe colouring: dark grizzled saddle over
 * tawny-grey flanks, cream underside / legs / muzzle mask, dark tail tip.
 * Locomotion: lateral-sequence walk -> trot -> rotary gallop (spine flexion), plus a STALK gait (body low, head low
 * and level, slow deliberate steps, rolling shoulders) used by the authority while the wolf circles its prey.
 * Attack: lunge bite (crouch -> gather -> leap 1.5 m with the jaws snapping on the strike -> head shake -> recover).
 * Idle specials: sniff (nose to the ground), scan (ears pricked, looks around), howl. */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- skeleton (world bind positions, metres) ---------------- */
  const BODY_Y = 0.66;
  const bones = [
    ['body', null, 0, BODY_Y, 0.0],
    ['ribs', 'body', 0, 0.6, 0.18],
    ['pelvis', 'body', 0, 0.68, -0.28],
    ['tail0', 'pelvis', 0, 0.69, -0.45, 'tail1'], ['tail1', 'tail0', 0, 0.615, -0.555, 'tail2'], ['tail2', 'tail1', 0, 0.515, -0.63, 'tail3'],
    ['tail3', 'tail2', 0, 0.405, -0.675, 'tail4'], ['tail4', 'tail3', 0, 0.295, -0.695],
    ['chest', 'body', 0, 0.66, 0.26],
    ['neck', 'chest', 0, 0.72, 0.44, 'head'],
    ['head', 'neck', 0, 0.87, 0.64],
    ['jaw', 'head', 0, 0.835, 0.7],
    ['earL', 'head', 0.052, 0.93, 0.662], ['earR', 'head', -0.052, 0.93, 0.662],
  ];
  for (const [s, k] of [['L', 1], ['R', -1]]) {
    bones.push(
      ['scap' + s, 'chest', k * 0.065, 0.8, 0.27, 'hum' + s],
      ['hum' + s, 'scap' + s, k * 0.1, 0.6, 0.4, 'for' + s],
      ['for' + s, 'hum' + s, k * 0.1, 0.42, 0.3, 'mc' + s],
      ['mc' + s, 'for' + s, k * 0.086, 0.12, 0.33, 'fpaw' + s],
      ['fpaw' + s, 'mc' + s, k * 0.084, 0.034, 0.36],
      ['th' + s, 'pelvis', k * 0.085, 0.62, -0.36, 'shin' + s],
      ['shin' + s, 'th' + s, k * 0.1, 0.42, -0.26, 'met' + s],
      ['met' + s, 'shin' + s, k * 0.09, 0.19, -0.42, 'hpaw' + s],
      ['hpaw' + s, 'met' + s, k * 0.086, 0.036, -0.38],
    );
  }
  const ends = {
    tail4: [0, 0.19, -0.7], head: [0, 0.828, 0.94], jaw: [0, 0.785, 0.9], earL: [0.081, 1.06, 0.652], earR: [-0.081, 1.06, 0.652],
    fpawL: [0.085, 0.016, 0.435], fpawR: [-0.085, 0.016, 0.435], hpawL: [0.087, 0.016, -0.305], hpawR: [-0.087, 0.016, -0.305],
    body: [0, 0.66, 0.26], pelvis: [0, 0.69, -0.45], chest: [0, 0.72, 0.44], ribs: [0, 0.6, 0.35],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikFL', 'ikFR', 'ikHL', 'ikHR', 'sniff']);

  /* ---------------- palette (display-space vertex colours; upward faces render ~2.2x brighter) ---------------- */
  const C = {
    saddle: [0.115, 0.104, 0.092], back: [0.235, 0.2, 0.158], side: [0.37, 0.3, 0.205], cream: [0.5, 0.455, 0.375],
    leg: [0.34, 0.285, 0.205], paw: [0.25, 0.212, 0.168], pad: [0.05, 0.045, 0.045], claw: [0.08, 0.075, 0.07],
    muzzleTop: [0.29, 0.25, 0.2], mask: [0.48, 0.44, 0.37], lip: [0.05, 0.045, 0.045], nose: [0.035, 0.032, 0.032], mouth: [0.11, 0.045, 0.048],
    earOut: [0.25, 0.21, 0.165], earRim: [0.09, 0.08, 0.07], earIn: [0.44, 0.4, 0.34], tail: [0.27, 0.24, 0.2], tailTip: [0.07, 0.065, 0.06],
    eye: [0.46, 0.28, 0.07], pupil: [0.015, 0.012, 0.01], tooth: [0.6, 0.56, 0.47],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // grizzled fur: two noise scales (guard-hair streaks run along the body)
  const grizzle = (p) => 0.88 + 0.12 * vnoise3(p.x * 34, p.y * 34, p.z * 9) + 0.1 * (vnoise3(p.x * 90, p.y * 90, p.z * 30) - 0.5);
  function furColor(p, n) {
    const up = n.y, dors = sstep(0.25, 0.9, up), ven = sstep(-0.1, -0.7, up);
    let c = mix(C.side, C.back, dors);
    // dark saddle over the shoulders / back, fading toward the croup and the flanks
    const sad = sstep(0.05, 0.6, up) * sstep(-0.42, -0.18, p.z) * sstep(0.6, 0.34, p.z) * sstep(0.17, 0.05, Math.abs(p.x));
    c = mix(c, C.saddle, Math.min(1, sad * 1.2 + 0.35 * gs(Math.abs(p.x), 0, 0.03) * dors));
    // pale underside, inner thighs and forechest
    c = mix(c, C.cream, Math.max(ven * 0.95, 0.85 * gs(p.z, 0.44, 0.07) * sstep(0.66, 0.5, p.y)));
    return mul(c, grizzle(p));
  }

  /* ---------------- geometry ---------------- */
  const SPINE = [
    ['pelvis', V(0, 0.68, -0.5), V(0, 0.7, -0.16)], ['body', V(0, 0.7, -0.16), V(0, 0.68, 0.12)],
    ['chest', V(0, 0.68, 0.12), V(0, 0.7, 0.4)], ['neck', V(0, 0.7, 0.4), V(0, 0.84, 0.6)], ['head', V(0, 0.84, 0.6), V(0, 0.88, 0.7)],
  ].map((s) => [I[s[0]], s[1], s[2]]);
  // normalised arc-length positions of the joint points along a limb path (to key the section profile on joints)
  function jointS(pts) { const d = [0]; for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + pts[i].distanceTo(pts[i - 1])); return d.map((x) => x / d[d.length - 1]); }
  const prof3 = (cv) => { const q = [0, 0, 0]; return (u, o) => { cv(u, q); o[0] = q[0]; o[1] = q[1]; o[2] = q[2]; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; }; };

  function build(q) {
    const parts = { fur: [], skin: [], gloss: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    /* body: SDF masses projected along the spine (withers -> back -> loin -> croup), ruffed neck */
    const bodyBase = K.sdf([
      { e: [0, 0.605, 0.2], r: [0.122, 0.2, 0.25] },                                   // deep, narrow rib cage
      { e: [0, 0.54, 0.39], r: [0.1, 0.12, 0.095], k: 0.07 },                          // brisket / forechest
      { e: [0.07, 0.66, 0.33], r: [0.068, 0.15, 0.115], rot: [-0.45, 0, 0], k: 0.06 }, // shoulder blades + triceps
      { e: [-0.07, 0.66, 0.33], r: [0.068, 0.15, 0.115], rot: [-0.45, 0, 0], k: 0.06 },
      { e: [0, 0.675, -0.12], r: [0.098, 0.105, 0.2], k: 0.09 },                       // loin, tucked abdomen
      { e: [0, 0.668, -0.33], r: [0.112, 0.104, 0.14], k: 0.07 },                      // croup / pelvis (below the withers)
      { e: [0, 0.8, 0.26], r: [0.06, 0.042, 0.11], k: 0.05 },                          // withers
      { e: [0.082, 0.56, -0.33], r: [0.058, 0.13, 0.11], rot: [0.28, 0, 0], k: 0.06 }, // thighs (breeches)
      { e: [-0.082, 0.56, -0.33], r: [0.058, 0.13, 0.11], rot: [0.28, 0, 0], k: 0.06 },
      { e: [0, 0.765, 0.02], r: [0.066, 0.038, 0.44], k: 0.07 },                       // smooth top line
      { c: [0, 0.69, 0.34, 0, 0.84, 0.61], ra: 0.13, rb: 0.088, k: 0.06 },              // neck
      { e: [0, 0.79, 0.49], r: [0.125, 0.125, 0.14], rot: [-0.6, 0, 0], k: 0.09 },      // mane over the crest of the neck
      { e: [0, 0.695, 0.51], r: [0.122, 0.13, 0.115], k: 0.09 },                        // ruff (throat + sides of the neck)
      { e: [0, 0.872, 0.645], r: [0.078, 0.076, 0.088], k: 0.08 },                      // nape fillet over the occiput (no head/neck crease)
      { e: [0, 0.655, 0.53], r: [0.085, 0.09, 0.1], k: 0.05 },                          // throat
    ]);
    // shaggy guard-hair break-up on the mane / ruff only (silhouette, not just colour)
    const ruffMask = (x, y, z) => sstep(0.3, 0.42, z) * sstep(0.7, 0.6, z) * sstep(0.6, 0.7, y);
    const bodySDF = (x, y, z) => { const m = ruffMask(x, y, z), d = bodyBase(x, y, z); return m > 0 ? d - 0.012 * m * (vnoise3(x * 15, y * 13, z * 15) - 0.35) : d; };
    const spine = new T.CatmullRomCurve3([V(0, 0.672, -0.42), V(0, 0.692, -0.26), V(0, 0.7, -0.02), V(0, 0.675, 0.22), V(0, 0.73, 0.44), V(0, 0.835, 0.6)], false, 'centripetal');
    const body = K.projectSDF({ sdf: bodySDF, curve: spine, rows: nr(50), nu: nu(32), cap0: 0.14, cap1: 0.08, rmax: 0.5 });
    const hip = { L: W('thL'), R: W('thR') }, sh = { L: W('humL'), R: W('humR') };
    K.skin(body, (p) => {
      const sd = p.x >= 0 ? 'L' : 'R';
      const ex = [
        [I['th' + sd], 0.55 * gs(p.distanceTo(hip[sd]), 0, 0.15) * sstep(0.02, 0.09, Math.abs(p.x)) * sstep(0.72, 0.58, p.y)],
        [I['scap' + sd], 0.5 * gs(p.distanceTo(sh[sd]), 0, 0.17) * sstep(0.02, 0.08, Math.abs(p.x))],
        [I.ribs, 0.5 * gs(p.z, 0.15, 0.2) * sstep(0.62, 0.48, p.y)],
      ];
      return K.envelope(SPINE, p, 4, ex);
    });
    K.paint(body, (p, n) => furColor(p, n));
    parts.fur.push(body);

    /* head: braincase, zygomatic arches, stop + brow, long muzzle, nose leather; separate mandible */
    const headSDF = K.sdf([
      { e: [0, 0.886, 0.664], r: [0.084, 0.069, 0.106] },                              // broad, flat-topped braincase
      { e: [0, 0.918, 0.656], r: [0.05, 0.028, 0.09], k: 0.04 },                        // sagittal crown
      { e: [0.07, 0.862, 0.722], r: [0.041, 0.037, 0.056], k: 0.035 },                  // wide zygomatic arches
      { e: [-0.07, 0.862, 0.722], r: [0.041, 0.037, 0.056], k: 0.035 },
      { e: [0.084, 0.846, 0.684], r: [0.042, 0.064, 0.056], rot: [0, 0, -0.45], k: 0.065 }, // cheek-fur ruffs flaring behind the eyes
      { e: [-0.084, 0.846, 0.684], r: [0.042, 0.064, 0.056], rot: [0, 0, 0.45], k: 0.065 },
      { c: [0, 0.851, 0.745, 0, 0.833, 0.906], ra: 0.061, rb: 0.037, k: 0.03, sq: 1.1 }, // shorter, deeper muzzle (flatter top line)
      { e: [0, 0.905, 0.756], r: [0.062, 0.027, 0.04], k: 0.024 },                      // brow ridge / stop
      { e: [0, 0.873, 0.828], r: [0.034, 0.028, 0.078], k: 0.03 },                      // heavy nasal bridge
      { e: [0.025, 0.81, 0.836], r: [0.027, 0.027, 0.068], k: 0.022 },                  // deep upper lips (flews)
      { e: [-0.025, 0.81, 0.836], r: [0.027, 0.027, 0.068], k: 0.022 },
      { e: [0, 0.833, 0.918], r: [0.024, 0.02, 0.018], k: 0.012 },                      // nose leather
      { e: [0, 0.804, 0.718], r: [0.05, 0.036, 0.066], k: 0.035 },                      // under-cheek line
      { e: [0.05, 0.884, 0.776], r: [0.02, 0.0135, 0.018], k: 0.01, sub: true },       // eye sockets
      { e: [-0.05, 0.884, 0.776], r: [0.02, 0.0135, 0.018], k: 0.01, sub: true },
      { e: [0.0145, 0.838, 0.931], r: [0.0065, 0.0055, 0.008], k: 0.004, sub: true },  // nostrils
      { e: [-0.0145, 0.838, 0.931], r: [0.0065, 0.0055, 0.008], k: 0.004, sub: true },
    ]);
    const hAxis = new T.LineCurve3(V(0, 0.885, 0.6), V(0, 0.833, 0.912));
    const head = K.projectSDF({ sdf: headSDF, curve: hAxis, rows: nr(32), nu: nu(28), cap0: 0.22, cap1: 0.12, rmax: 0.22 });
    K.skin(head, [[I.head, 1]]);
    const eyeC = [V(0.051, 0.885, 0.779), V(-0.051, 0.885, 0.779)];
    K.paint(head, (p, n) => {
      let c = furColor(p, n);
      const front = sstep(0.73, 0.8, p.z);
      // tawny forehead / muzzle top, pale cream mask on cheeks, lips and throat
      c = mix(c, C.muzzleTop, front * sstep(0.2, 0.7, n.y));
      const mask = Math.max(sstep(0.3, -0.3, n.y) * sstep(0.7, 0.76, p.z), gs(Math.abs(p.x), 0.055, 0.03) * sstep(0.89, 0.85, p.y) * sstep(0.7, 0.75, p.z),
        0.8 * sstep(0.07, 0.1, Math.abs(p.x)) * sstep(0.88, 0.83, p.y) * sstep(0.62, 0.68, p.z));                // pale cheek ruffs
      c = mix(c, C.mask, mask * 0.85);
      // pale "eyebrow" spots, dark eye liner
      for (const e of eyeC) {
        c = mix(c, C.mask, 0.6 * gs(p.distanceTo(V(e.x * 0.92, e.y + 0.028, e.z - 0.004)), 0, 0.012));
        c = mix(c, C.lip, 0.85 * gs(p.distanceTo(e), 0.016, 0.004));
      }
      c = mix(c, C.nose, sstep(0.036, 0.026, p.distanceTo(V(0, 0.834, 0.918))));
      const lipLine = sstep(0.76, 0.8, p.z) * gs(p.y, 0.787, 0.012) * sstep(0.2, -0.3, n.y);
      c = mix(c, C.lip, lipLine);
      const mouth = sstep(0.78, 0.82, p.z) * sstep(-0.3, -0.7, n.y) * sstep(0.797, 0.787, p.y);
      return mix(c, C.mouth, mouth);
    });
    parts.fur.push(head);
    const jawSDF = K.sdf([
      { c: [0, 0.83, 0.7, 0, 0.794, 0.866], ra: 0.047, rb: 0.024, sq: 1.25 },          // strong mandible
      { e: [0, 0.8, 0.752], r: [0.046, 0.028, 0.066], k: 0.028 },
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 0.825, 0.7), V(0, 0.794, 0.862)), rows: nr(16), nu: nu(18), cap0: 0.2, cap1: 0.2, rmax: 0.1 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => {
      let c = mix(mul(C.mask, 0.92), C.side, 0.25);
      c = mix(c, C.lip, Math.min(1, 0.55 * sstep(0.84, 0.865, p.z) + 0.7 * gs(p.y, 0.806, 0.007) * sstep(0.76, 0.82, p.z)));
      return mix(c, C.mouth, sstep(0.2, 0.75, n.y) * sstep(0.74, 0.78, p.z));
    });
    parts.fur.push(jaw);
    // canines (upper on the head, lower on the jaw) - seen when the jaws open
    const fang = (pts, r, bone) => {
      const g = K.sweep({ pts, prof: (u, o) => { o[0] = r * (1 - 0.8 * u); o[1] = o[2] = r * 0.85 * (1 - 0.8 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 6, cap0: 1, cap1: 1, up: V(0, 0, 1) });
      K.skin(g, [[bone, 1]]); K.paint(g, C.tooth); return g;
    };
    for (const s of [-1, 1]) {
      parts.gloss.push(fang([V(s * 0.023, 0.81, 0.866), V(s * 0.024, 0.798, 0.869), V(s * 0.023, 0.787, 0.866)], 0.0054, I.head));
      parts.gloss.push(fang([V(s * 0.019, 0.79, 0.842), V(s * 0.02, 0.8, 0.845), V(s * 0.019, 0.807, 0.843)], 0.0047, I.jaw));
      // amber eyes with a dark pupil, set in the sockets, looking forward-outward
      const eye = new T.SphereGeometry(0.0145, Math.max(8, Math.round(14 * q)), Math.max(6, Math.round(10 * q)));
      eye.scale(1, 0.7, 1); eye.rotateY(s * 0.38); eye.translate(s * 0.0495, 0.8845, 0.776);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
      const pup = new T.SphereGeometry(0.0062, 8, 6); pup.scale(1, 1.15, 0.45);
      pup.rotateY(s * 0.38); pup.translate(s * (0.0495 + 0.005), 0.8848, 0.776 + 0.0123);
      parts.gloss.push(K.prim(pup, C.pupil, I.head));
    }

    /* ears: erect triangles on ear bones, thick at the base, cupped forward, dark rims, pale inner fur */
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      const e = K.sweep({
        pts: [V(s * 0.068, 0.905, 0.648), V(s * 0.085, 0.962, 0.643), V(s * 0.102, 1.026, 0.636)], up: V(s * 0.66, 0.05, 0.75),
        prof: (u, o) => { o[0] = 0.05 * Math.pow(1 - u, 0.85) + 0.002; o[1] = o[2] = 0.011 * (1 - 0.6 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        cup: (u) => -0.024 * Math.sin(PI * Math.min(1, u * 1.1)), rows: nr(10), nu: nu(16), cap0: 1, cap1: 2,
      });
      K.skin(e, (p) => [[I['ear' + sd], sstep(0.912, 0.928, p.y)], [I.head, 1 - sstep(0.912, 0.928, p.y)]]);
      K.paint(e, (p, n, info) => {
        const inner = sstep(-0.1, 0.45, n.z * 0.75 + n.x * s * 0.66);
        let c = mix(mul(C.earOut, grizzle(p)), C.earIn, inner * sstep(0.925, 0.94, p.y) * sstep(0.2, 0.1, info ? Math.abs(Math.sin(info.a)) - 0.85 : 0));
        return mix(c, C.earRim, sstep(0.82, 1, info ? Math.abs(Math.sin(info.a)) : 0) * 0.7 + 0.5 * sstep(0.995, 1.02, p.y));
      });
      parts.fur.push(e);
    }

    /* tail: bushy brush, tufted silhouette, dark tip, pale underside */
    const tailPts = [V(0, 0.695, -0.41), W('tail0'), W('tail1'), W('tail2'), W('tail3'), W('tail4'), V(0, 0.19, -0.7)];
    const tailSegs = [['pelvis', 0, 1], ['tail0', 1, 2], ['tail1', 2, 3], ['tail2', 3, 4], ['tail3', 4, 5], ['tail4', 5, 6]].map((s) => [I[s[0]], tailPts[s[1]], tailPts[s[2]]]);
    const rc = M.curve([[0, 0.042], [0.12, 0.045], [0.4, 0.062], [0.7, 0.058], [0.9, 0.038], [1, 0.012]]), rq = [0];
    const tail = K.sweep({ pts: tailPts, prof: (u, o) => { rc(u, rq); o[0] = rq[0] * 0.92; o[1] = rq[0]; o[2] = rq[0] * 1.05; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.008 * sstep(0.1, 0.3, u) * (vnoise3(u * 22, Math.cos(a) * 2, Math.sin(a) * 2) - 0.45),
      rows: nr(30), nu: nu(14), cap0: 0, cap1: 3 });
    K.skin(tail, (p) => K.envelope(tailSegs, p, 4));
    K.paint(tail, (p, n, info) => {
      const u = info ? info.s : 0;
      let c = mix(furColor(p, n), mul(C.tail, grizzle(p)), sstep(0.05, 0.2, u));
      c = mix(c, C.cream, sstep(0.2, 0.75, n.z * -1) * 0.45 * sstep(0.1, 0.3, u));       // underside faces the legs (+Z)
      c = mix(c, C.saddle, 0.5 * sstep(0.25, 0.45, u) * gs(u, 0.35, 0.06));             // dark gland spot on top
      return mix(c, C.tailTip, sstep(0.8, 0.93, u));
    });
    parts.fur.push(tail);

    /* legs + paws (left built, right mirrored) */
    const legParts = [];
    const s = 1, sd = 'L';
    // hind: haunch -> hip -> stifle -> gaskin -> hock (point of hock) -> metatarsus -> paw joint
    const hipIn = V(s * 0.055, 0.69, -0.3);
    const hp = [hipIn, W('th' + sd), W('shin' + sd), W('met' + sd), W('hpaw' + sd)];
    const hs = jointS(hp);
    const hc = M.curve([
      [0, 0.064, 0.085, 0.095], [hs[1], 0.07, 0.098, 0.11], [lerp(hs[1], hs[2], 0.55), 0.06, 0.07, 0.1], [hs[2], 0.046, 0.05, 0.068],
      [lerp(hs[2], hs[3], 0.35), 0.04, 0.042, 0.066], [lerp(hs[2], hs[3], 0.75), 0.028, 0.026, 0.044], [hs[3], 0.025, 0.024, 0.036],
      [lerp(hs[3], 1, 0.4), 0.022, 0.022, 0.024], [1, 0.025, 0.025, 0.024]]);
    const hind = K.sweep({ pts: hp, up: V(0, 0, 1), prof: prof3(hc), rows: nr(26), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.012 * gs(u, hs[3] - 0.01, 0.025) * ga(a, PI, 0.5) });                              // point of hock
    K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('th' + sd)], [I['th' + sd], W('th' + sd), W('shin' + sd)], [I['shin' + sd], W('shin' + sd), W('met' + sd)], [I['met' + sd], W('met' + sd), W('hpaw' + sd)]], p, 4));
    K.paint(hind, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, mul(C.leg, grizzle(p)), sstep(0.42, 0.3, p.y));
      c = mix(c, C.cream, sstep(0.3, 0.75, -n.x * s) * sstep(0.62, 0.48, p.y) * 0.7);                       // inner thigh
      return mix(c, mul(C.paw, grizzle(p)), sstep(0.12, 0.06, p.y));
    });
    legParts.push(['fur', hind]);
    // fore: buried upper arm -> elbow -> straight forearm -> carpus -> pastern
    const shIn = V(s * 0.06, 0.73, 0.3);
    const fp = [shIn, W('hum' + sd), W('for' + sd), W('mc' + sd), W('fpaw' + sd)];
    const fs = jointS(fp);
    const fc = M.curve([
      [0, 0.055, 0.066, 0.066], [fs[1], 0.058, 0.07, 0.074], [lerp(fs[1], fs[2], 0.6), 0.053, 0.058, 0.07], [fs[2], 0.046, 0.046, 0.062],
      [lerp(fs[2], fs[3], 0.25), 0.045, 0.051, 0.046], [lerp(fs[2], fs[3], 0.8), 0.03, 0.033, 0.03], [fs[3], 0.028, 0.031, 0.03],
      [lerp(fs[3], 1, 0.5), 0.023, 0.024, 0.022], [1, 0.025, 0.025, 0.023]]);
    const fore = K.sweep({ pts: fp, up: V(0, 0, 1), prof: prof3(fc), rows: nr(24), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.008 * gs(u, fs[2] + 0.005, 0.02) * ga(a, PI, 0.5) + 0.006 * gs(u, fs[3] - 0.01, 0.02) * ga(a, PI, 0.6) });   // elbow + accessory carpal pad
    K.skin(fore, (p) => K.envelope([[I['scap' + sd], shIn, W('hum' + sd)], [I['hum' + sd], W('hum' + sd), W('for' + sd)], [I['for' + sd], W('for' + sd), W('mc' + sd)], [I['mc' + sd], W('mc' + sd), W('fpaw' + sd)]], p, 4));
    K.paint(fore, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, mul(C.leg, grizzle(p)), sstep(0.5, 0.38, p.y));
      c = mix(c, C.cream, sstep(0.0, 0.6, -n.x * s) * sstep(0.45, 0.3, p.y) * 0.6);                           // pale inner forearm
      return mix(c, mul(C.paw, grizzle(p)), sstep(0.13, 0.07, p.y));
    });
    legParts.push(['fur', fore]);
    // paws: compact ovals, four toe pads up front, dark pads underneath, short dark claws
    const paw = (x0, z0, len, wid, bone, end) => {
      const pts = [V(x0, 0.04, z0 - 0.022), V(x0, 0.032, z0 + 0.008), V(x0, 0.024, z0 + len * 0.6), V(x0 + 0.001, 0.017, z0 + len)];
      const g = K.sweep({ pts, up: V(0, 1, 0),
        prof: (u, o) => { o[0] = lerp(wid * 0.7, wid, sstep(0.1, 0.55, u)) * (1 - 0.35 * sstep(0.78, 1, u)); o[1] = lerp(0.024, 0.017, u); o[2] = lerp(0.018, 0.014, u); o[3] = 2.4; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.0045 * sstep(0.55, 0.85, u) * Math.pow(Math.abs(Math.cos(a * 2)), 4) * ga(a, 0, 1.25), rows: nr(12), nu: nu(14), cap0: 2, cap1: 2 });
      K.skin(g, (p) => K.envelope([[I['mc' + sd] === bone ? bone : bone, V(x0, 0.06, z0 - 0.03), V(x0, 0.034, z0)], [I[end], V(x0, 0.034, z0), V(x0, 0.016, z0 + len)]], p, 4));
      K.paint(g, (p, n) => mix(mul(C.paw, grizzle(p)), C.pad, sstep(-0.2, -0.65, n.y)));
      return g;
    };
    const fpw = paw(s * 0.085, 0.358, 0.08, 0.034, I['mc' + sd], 'fpaw' + sd);
    const hpw = paw(s * 0.087, -0.382, 0.074, 0.031, I['met' + sd], 'hpaw' + sd);
    legParts.push(['fur', fpw], ['fur', hpw]);
    if (q >= 0.99) {                                                                               // claws: LOD0 only
      for (const [x0, z0, len, end] of [[s * 0.085, 0.358, 0.08, 'fpaw' + sd], [s * 0.087, -0.382, 0.074, 'hpaw' + sd]]) {
        for (const dx of [-0.019, -0.0065, 0.0065, 0.019]) {
          const zt = z0 + len * (0.93 - 0.1 * Math.abs(dx) / 0.019);
          const cl = K.sweep({ pts: [V(x0 + dx, 0.016, zt - 0.006), V(x0 + dx * 1.05, 0.011, zt + 0.006), V(x0 + dx * 1.08, 0.004, zt + 0.012)], up: V(0, 1, 0),
            prof: (u, o) => { o[0] = 0.0035 * (1 - 0.75 * u); o[1] = o[2] = 0.003 * (1 - 0.75 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 3, nu: 6, cap0: 1, cap1: 1 });
          K.skin(cl, [[I[end], 1]]); K.paint(cl, C.claw);
          legParts.push(['gloss', cl]);
        }
      }
    }
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    for (const [slot, g] of legParts) { parts[slot].push(g); parts[slot].push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const D = CREATURE_DEFS.SPECIES.wolf;
  const ch = (n) => chan[n];
  const TAILS = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'];
  const legs = [
    { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: 0.034, toeLen: 0.075, lift: 0.11, curl: 0.7 },
    { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: 0.034, toeLen: 0.075, lift: 0.11, curl: 0.7 },
    { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: 0.036, toeLen: 0.075, lift: 0.1, curl: 0.55 },
    { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: 0.036, toeLen: 0.075, lift: 0.1, curl: 0.55 },
  ];
  const gaits = {
    walk: { stride: (v) => 0.5 + 0.3 * v, duty: 0.63, minV: 0.06 },
    stalk: { stride: (v) => 0.42 + 0.2 * v, duty: 0.72, minV: 0.06, liftK: () => 0.7 },
    trot: { stride: (v) => 0.75 + 0.24 * v, duty: 0.44, minV: 0.06 },
    gallop: { stride: (v) => 0.95 + 0.2 * v, duty: 0.26, dutyF: 0.22, minV: 0.06, liftK: () => 1.25 },
  };
  // lateral-sequence walk / stalk, diagonal trot, rotary gallop (hind L->R, fore R->L)
  const offsets = {
    HL: { walk: 0, stalk: 0, trot: 0.5, gallop: 0 }, FL: { walk: 0.25, stalk: 0.25, trot: 0, gallop: 0.62 },
    HR: { walk: 0.5, stalk: 0.5, trot: 0, gallop: 0.1 }, FR: { walk: 0.75, stalk: 0.75, trot: 0.5, gallop: 0.5 },
  };
  // called by the Gait as a method: `this` is the gait (its _mode is fed from ctx.mode in base())
  function select(v, cur) {
    if (this && this._mode === 'stalk' && v < 2.6) return 'stalk';
    if (cur === 'gallop') return v < 3.5 ? 'trot' : 'gallop';
    if (cur === 'trot') return v > 4.0 ? 'gallop' : v < 1.45 ? 'walk' : 'trot';
    return v > 1.75 ? 'trot' : 'walk';
  }
  // body bone local: hips at (y -0.04, z -0.36), shoulders at (y -0.06, z +0.4)
  const HIP = [-0.04, -0.36], SHO = [-0.06, 0.4];

  function base(P, ctx, A) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    A.gait._mode = ctx.mode;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.6) : 0, 6, dt);
    const g = ctx.gaitName;
    ctx.gw = M.damp(ctx.gw || 0, g === 'gallop' ? 1 : 0, 5, dt);
    ctx.tw = M.damp(ctx.tw || 0, g === 'trot' ? 1 : 0, 5, dt);
    ctx.sw = M.damp(ctx.sw || 0, ctx.mode === 'stalk' ? 1 : 0, 3, dt);
    const mw = ctx.mw, idle = 1 - mw, gw = ctx.gw, tw = ctx.tw, sw = ctx.sw, ph = ctx.phase * TAU, walkW = Math.max(0, 1 - gw - tw);
    // vertical motion: walk / trot double bob, gallop one big flight cycle; stalk = crouched low
    P[ch('body.py')] += mw * (walkW * -0.012 * Math.cos(2 * ph) + tw * -0.022 * Math.cos(2 * ph) + gw * 0.045 * Math.sin(ph + 0.9)) - 0.02 * gw - 0.1 * sw;
    // gallop: spine flexes (feet gathered) and extends (flight), the chest pitches over the leading fore
    const flex = gw * 0.2 * Math.sin(ph + 0.5);
    P[ch('pelvis.rx')] += flex; P[ch('chest.rx')] -= flex * 0.7;
    P[ch('body.rx')] += gw * (0.05 * Math.sin(ph + 2.1) + 0.04) + sw * 0.04;
    // walk / stalk: hip drop and sway, rolling shoulders (strong while stalking)
    P[ch('pelvis.rz')] += mw * (walkW + tw * 0.5) * 0.05 * Math.sin(ph);
    P[ch('pelvis.ry')] += mw * walkW * 0.06 * Math.sin(ph + 0.4);
    P[ch('chest.rz')] += mw * (walkW * 0.035 + sw * 0.07) * Math.sin(ph + PI * 0.5);
    P[ch('chest.ry')] += mw * walkW * -0.045 * Math.sin(ph + 0.4);
    P[ch('body.rz')] += mw * walkW * 0.018 * Math.sin(ph);
    // bend into turns (spine curves toward the turn, the head leads)
    const tr = M.clamp(ctx.turn * 0.09, -0.3, 0.3);
    P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.55; P[ch('neck.ry')] += tr * 0.8; P[ch('head.ry')] += tr * 0.4;
    // idle: slow look-around, weight shifts, ears swivel (specials add more)
    const look = (vnoise3(t * 0.25, 1.3, 0) - 0.5) * 1.5, lookY = (vnoise3(t * 0.22, 4.1, 2) - 0.5) * 0.6;
    P[ch('neck.ry')] += idle * look * 0.4; P[ch('head.ry')] += idle * look * 0.35;
    P[ch('neck.rx')] += idle * (lookY * 0.25 - 0.08); P[ch('head.rx')] += idle * (lookY * 0.3 + 0.05);
    P[ch('body.px')] += idle * 0.012 * Math.sin(t * 0.4);
    P[ch('earL.ry')] += idle * 0.35 * (vnoise3(t * 0.5, 9, 1) - 0.5); P[ch('earR.ry')] += idle * 0.35 * (vnoise3(t * 0.5, 2, 7) - 0.5);
    // stalk: head dropped to the line of the back and held level, ears pricked forward, tail low and still
    P[ch('neck.rx')] += sw * 0.62; P[ch('head.rx')] -= sw * 0.42;
    P[ch('earL.rx')] += sw * 0.25; P[ch('earR.rx')] += sw * 0.25;
    // head stabilisation: the neck cancels most of the body pitch + bob so the head glides
    const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
    P[ch('neck.rx')] -= bodyPitch * 0.8 - gw * 0.12 - tw * 0.06; P[ch('head.rx')] -= bodyPitch * 0.15 + gw * 0.08;
    P[ch('neck.rx')] += mw * (gw * 0.02 - walkW * 0.02) * Math.cos(2 * ph);
    // tail: hangs low at rest, streams out behind in the gallop, sways with the hips at a walk
    for (let i = 0; i < TAILS.length; i++) {
      P[ch(TAILS[i] + '.rx')] += (i === 0 ? 0.55 : 0.22) * gw + (i === 0 ? 0.18 : 0.06) * tw - (i === 0 ? 0.15 : 0.02) * sw - flex * 0.2;   // + = up
      P[ch(TAILS[i] + '.ry')] += mw * walkW * 0.07 * Math.sin(ph - 0.6 - i * 0.6) + idle * 0.05 * Math.sin(t * 0.7 - i * 0.5);
    }
    // ears fold back at speed
    const back = gw * 0.9 + tw * 0.25;
    P[ch('earL.rx')] -= back * 0.55; P[ch('earR.rx')] -= back * 0.55; P[ch('earL.rz')] -= back * 0.2; P[ch('earR.rz')] += back * 0.2;
    // scapulae glide with the fore steps (shoulders visibly roll while stalking)
    const fL = A.gait.feet[0], fR = A.gait.feet[1];
    const sk = mw * (0.14 + 0.1 * sw + 0.08 * gw);
    P[ch('scapL.rx')] += sk * scapSwing(fL); P[ch('scapR.rx')] += sk * scapSwing(fR);
  }
  function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }

  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0;
    if (Lg.type === 'hind') {
      if (f.planted) return Lg.restDistal - 0.3 * sstep(0.55, 1, f.stanceU) * mw;                  // hock extends on push-off
      return Lg.restDistal - 0.85 * Math.sin(PI * Math.min(1, f.swingU * 1.05));                   // hock flexes in swing
    }
    if (f.planted) return Lg.restDistal + 0.25 * sstep(0.6, 1, f.stanceU) * mw;                    // pastern rolls over
    return Lg.restDistal - 1.75 * Math.sin(PI * Math.min(1, f.swingU * 1.08));                     // carpus folds
  }
  function post(P, ctx, A) {
    const breath = Math.sin(ctx.t * (ctx.moving ? 7.5 + 2 * (ctx.gw || 0) : 2.6));
    A.B[I.ribs].scale.setScalar(ctx.dead ? 1 : 1 + 0.022 * breath);
    if (P[ch('sniff')]) A.B[I.head].rotateX(-0.05 * P[ch('sniff')]);
  }
  function secondary(ctx, A) {
    const dt = ctx.dt, B = A.B;
    const tgt = -M.clamp(ctx.turn * 0.1, -0.6, 0.6);
    for (let i = 1; i < TAILS.length; i++) {
      const s = A.sp_('t' + i), x = K.stepSpring(s, tgt * (0.35 + 0.18 * i), 70 - i * 9, 7, dt);
      B[I[TAILS[i]]].rotateY(x * 0.35);
    }
    const bob = K.stepSpring(A.sp_('tb'), (A.B[I.body].position.y - BODY_Y) * -8, 80, 8, dt);
    B[I.tail1].rotateX(bob * 0.25); B[I.tail3].rotateX(bob * 0.2);
    const ey = K.stepSpring(A.sp_('ear'), (A.B[I.body].position.y - BODY_Y) * -12, 300, 16, dt);
    B[I.earL].rotateX(ey * 0.2); B[I.earR].rotateX(ey * 0.2);
  }
  const TAIL_IX = TAILS.map((n) => I[n]);
  const TAIL_END = TAILS.map((n, k) => (k < TAILS.length - 1 ? tpl.local[I[TAILS[k + 1]]].clone() : new T.Vector3(...ends.tail4).sub(tpl.world[I.tail4])));
  const TAIL_MIN = [0.06, 0.06, 0.055, 0.045, 0.03];
  function ground(ctx, A) { K.groundChain(A, TAIL_IX, TAIL_END, TAIL_MIN); }
  function flinch(P, t, dir, pow) {
    const k = Math.exp(-t * 8) * Math.sin(Math.min(1, t * 11) * PI * 0.5) * pow;
    P[ch('body.px')] += dir[0] * 0.06 * k; P[ch('body.pz')] += dir[1] * 0.06 * k; P[ch('body.py')] -= 0.03 * k;
    P[ch('body.rz')] += -dir[0] * 0.12 * k; P[ch('chest.rx')] += 0.1 * k;
    P[ch('neck.rx')] -= 0.25 * k; P[ch('head.rx')] -= 0.15 * k; P[ch('head.ry')] += dir[0] * 0.3 * k; P[ch('jaw.rx')] += 0.3 * k;
    P[ch('earL.rx')] -= 0.6 * k; P[ch('earR.rx')] -= 0.6 * k; P[ch('tail0.rx')] -= 0.3 * k;
  }

  /* actions: additive tracks keyed on the gameplay timeline instants (same numbers as the authority's hit window) */
  const atk = D.attacks.lunge, ph = atk.phases;
  const actions = {
    lunge: {
      kind: 'attack', dur: atk.dur, blendIn: 0.1, blendOut: 0.25,
      track: (() => {
        const tr = K.track(chan, ph, {
          // s, an (crouch, eyes on the prey), wu (gathered, jaws parting), hit (leap: neck up+out, jaws snap), fo (land, shake), e
          'body.py': [0, -0.085, -0.11, 0.08, -0.03, 0],
          'body.rx': [0, 0.06, -0.04, -0.1, 0.08, 0],
          'pelvis.rx': [0, -0.18, -0.26, 0.2, 0.06, 0],
          'chest.rx': [0, 0.1, 0.06, -0.12, 0.08, 0],
          'neck.rx': [0, 0.22, 0.05, -0.38, 0.1, 0],
          'head.rx': [0, -0.15, -0.12, 0.14, 0.08, 0],
          'jaw.rx': [0, 0.06, 0.55, 0.0, 0.1, 0],
          'tail0.rx': [0, -0.25, -0.1, 0.35, 0.1, 0],
          'tail1.rx': [0, -0.05, 0.05, 0.15, 0.05, 0],
          'earL.rx': [0, 0.25, -0.2, -0.6, -0.3, 0], 'earR.rx': [0, 0.25, -0.2, -0.6, -0.3, 0],
        });
        const fkOn = (u) => sstep(ph.wu, ph.wu + 0.05, u) * sstep(ph.hit + 0.13, ph.hit + 0.07, u);   // fore paws airborne (body up)
        const reach = (u) => sstep(ph.wu + 0.01, ph.hit, u) * sstep(ph.hit + 0.12, ph.hit + 0.04, u);
        return (P, u, w) => {
          tr(P, u, w);
          // weight shift: back over the hind legs, then thrown forward past the shoulders, then caught on landing
          const pz = u < ph.an ? -0.07 * M.ease.io(u / ph.an) : u < ph.hit ? lerp(-0.07, 0.12, M.ease.io((u - ph.an) / (ph.hit - ph.an))) : lerp(0.12, 0, M.ease.io((u - ph.hit) / (1 - ph.hit)));
          P[ch('body.pz')] += pz * w;
          const air = fkOn(u) * w, r = reach(u) * w;
          P[ch('ikFL')] -= air; P[ch('ikFR')] -= air;
          for (const sd of ['L', 'R']) {               // forelegs thrown forward to meet the prey, then reaching for the ground
            P[ch('hum' + sd + '.rx')] -= 0.78 * r; P[ch('for' + sd + '.rx')] -= 0.12 * r; P[ch('mc' + sd + '.rx')] += 0.75 * r;
          }
          // bite-and-shake follow-through
          const sh = sstep(ph.hit, ph.hit + 0.05, u) * sstep(ph.fo + 0.08, ph.fo - 0.02, u);
          P[ch('head.ry')] += Math.sin((u - ph.hit) * 55) * 0.24 * sh * w; P[ch('neck.ry')] += Math.sin((u - ph.hit) * 55 - 0.7) * 0.12 * sh * w;
          P[ch('head.rz')] += Math.sin((u - ph.hit) * 55 + 0.4) * 0.12 * sh * w;
        };
      })(),
    },
    stagger: {
      kind: 'stagger', dur: 0.8, blendIn: 0.05, blendOut: 0.25,
      track: (P, u, w) => {
        const k = Math.sin(PI * Math.min(1, u * 1.4)) * sstep(1, 0.6, u) * w;
        P[ch('body.pz')] -= 0.08 * k; P[ch('body.py')] -= 0.06 * k; P[ch('body.rz')] += 0.1 * Math.sin(u * 18) * k;
        P[ch('neck.rx')] -= 0.35 * k; P[ch('head.ry')] += 0.35 * Math.sin(u * 14) * k; P[ch('jaw.rx')] += 0.25 * k;
        P[ch('earL.rx')] -= 0.7 * k; P[ch('earR.rx')] -= 0.7 * k; P[ch('tail0.rx')] -= 0.4 * k;
      },
    },
    sniff: {
      kind: 'special', dur: 3.0, blendIn: 0.35, blendOut: 0.4,
      track: (P, u, w) => {
        // nose down to the ground, working along a scent line
        const env = M.ease.io(sstep(0, 0.2, u)) * M.ease.io(sstep(1, 0.82, u)) * w;
        P[ch('neck.rx')] += 0.95 * env; P[ch('head.rx')] += 0.35 * env; P[ch('body.py')] -= 0.03 * env; P[ch('chest.rx')] += 0.08 * env;
        P[ch('neck.ry')] += 0.3 * Math.sin(u * 6.5) * env; P[ch('head.ry')] += 0.2 * Math.sin(u * 6.5 - 0.6) * env;
        P[ch('sniff')] += 1.2 * Math.max(0, Math.sin(u * 80)) * env;
        P[ch('earL.rx')] += 0.2 * env; P[ch('earR.rx')] += 0.2 * env;
        for (let i = 0; i < TAILS.length; i++) P[ch(TAILS[i] + '.ry')] += 0.12 * Math.sin(u * 9 - i * 0.7) * env;
      },
    },
    scan: {
      kind: 'special', dur: 3.2, blendIn: 0.3, blendOut: 0.4,
      track: (P, u, w) => {
        // head up, ears pricked, a slow look to one side then the other
        const env = M.ease.io(sstep(0, 0.15, u)) * M.ease.io(sstep(1, 0.85, u)) * w;
        P[ch('neck.rx')] -= 0.35 * env; P[ch('head.rx')] += 0.08 * env;
        const yaw = Math.sin(u * PI * 2) * 0.7;
        P[ch('neck.ry')] += yaw * 0.55 * env; P[ch('head.ry')] += yaw * 0.45 * env;
        P[ch('earL.rx')] += 0.35 * env; P[ch('earR.rx')] += 0.35 * env;
        P[ch('earL.ry')] += yaw * 0.4 * env; P[ch('earR.ry')] += yaw * 0.4 * env;
        P[ch('tail0.rx')] += 0.12 * env;
      },
    },
    howl: {
      kind: 'special', dur: 3.6, blendIn: 0.4, blendOut: 0.5,
      track: (P, u, w) => {
        // muzzle to the sky, jaws working with the call, weight settles back onto the haunches
        const env = M.ease.io(sstep(0, 0.2, u)) * M.ease.io(sstep(1, 0.8, u)) * w;
        K.pitchAbout(P, chan, -0.14 * env, HIP[0], HIP[1]);
        P[ch('body.py')] -= 0.03 * env;
        P[ch('neck.rx')] -= 0.85 * env; P[ch('head.rx')] -= 0.5 * env;
        const call = sstep(0.22, 0.3, u) * sstep(0.85, 0.75, u);
        P[ch('jaw.rx')] += (0.18 + 0.12 * Math.sin(u * 9)) * call * w;
        P[ch('earL.rx')] -= 0.08 * env; P[ch('earR.rx')] -= 0.08 * env;
        P[ch('tail0.rx')] -= 0.15 * env;
      },
    },
    death: {
      kind: 'death', dur: 1.8, blendIn: 0.06, hold: true,
      track: (P, u, w, layer) => {
        const side = layer.data.side || 1;
        // forelegs buckle first (chest drops), then the body rolls onto its side and settles, a last kick
        const buckle = M.ease.io(sstep(0.0, 0.28, u)), fall = M.ease.io(sstep(0.15, 0.55, u)), kick = sstep(0.55, 0.62, u) * sstep(0.9, 0.62, u);
        P[ch('body.rx')] += (0.32 * buckle - 0.22 * fall) * w;
        P[ch('body.rz')] += side * 1.45 * fall * w;
        P[ch('body.py')] += (-0.14 * buckle - 0.33 * fall) * w; P[ch('body.px')] += -side * 0.12 * fall * w;
        P[ch('chest.rx')] += 0.12 * fall * w; P[ch('pelvis.rx')] -= 0.12 * fall * w;
        P[ch('neck.rx')] += (0.55 * buckle - 0.15 * fall) * w; P[ch('head.rx')] += 0.25 * fall * w; P[ch('jaw.rx')] += 0.18 * fall * w;
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

  K.defineSpecies('wolf', {
    rig: tpl, chan, build, lowQ: 0.6, animator: K.QuadAnimator, debugScale: 2.2,
    anim: { legs, gaits, offsets, select, base, distal, post, secondary, ground, flinch, actions, gaitOpts: { restTol: 0.11, idleStepDur: 0.3 }, groundFix: true },
    clips: ['idle', 'walk', 'stalk', 'run', 'lunge', 'sniff', 'scan', 'howl', 'hit', 'death'],
    attackAction: { lunge: 'lunge' }, specials: ['sniff', 'scan', 'howl'],
    def: D,
  });
})();
