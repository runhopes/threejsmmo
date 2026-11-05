/* Wild Boar (levels 4-6) and Spikeback Boar (level 10 mini boss) - one parametric suid body, two species.
 * Anatomy (boar units, metres; the spikeback is the same anatomy scaled x1.45 with a bigger hump, larger tusks, thicker
 * legs and a ridge of hardened dorsal bristles): front-heavy barrel, massive shoulders with a bristly crest over the
 * withers, back sloping down to a narrower rump, short thick neck, long wedge skull ending in a flat disc snout,
 * small eyes, pointed ears, upward-curving lower tusks, slim legs on cloven hooves, thin tufted tail.
 * Locomotion: lateral-sequence walk -> trot -> transverse gallop. The charge posture comes from the authority's
 * movement mode (ctx.mode 'charge') and the charge attack track.
 * Boar: tusk, charge, stagger, death, specials root / shake.  Spikeback: sweep, stomp, charge, enrage, stagger, death,
 * specials root / shake / snort; bristles raise when enraged (crest bones stretch). */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

  /* ---------------- skeleton (boar units; scaled per species) ---------------- */
  function boneList() {
    const b = [
      ['body', null, 0, 0.62, 0.0],
      ['ribs', 'body', 0, 0.56, 0.08],
      ['pelvis', 'body', 0, 0.62, -0.36],
      ['tail0', 'pelvis', 0, 0.635, -0.565, 'tail1'], ['tail1', 'tail0', 0, 0.565, -0.615, 'tail2'], ['tail2', 'tail1', 0, 0.475, -0.64],
      ['chest', 'body', 0, 0.65, 0.26],
      ['neck', 'chest', 0, 0.665, 0.46, 'head'],
      ['head', 'neck', 0, 0.69, 0.6],
      ['jaw', 'head', 0, 0.535, 0.665],
      ['earL', 'head', 0.082, 0.79, 0.625], ['earR', 'head', -0.082, 0.79, 0.625],
      ['crest0', 'chest', 0, 0.84, 0.3], ['crest1', 'body', 0, 0.8, 0.0], ['crest2', 'pelvis', 0, 0.74, -0.3],
    ];
    for (const [s, f] of [['L', 1], ['R', -1]]) {
      b.push(
        ['scap' + s, 'chest', f * 0.11, 0.8, 0.29, 'hum' + s],
        ['hum' + s, 'scap' + s, f * 0.15, 0.52, 0.36, 'for' + s],
        ['for' + s, 'hum' + s, f * 0.152, 0.34, 0.25, 'mc' + s],       // elbow tucked back under the chest (reach slack)
        ['mc' + s, 'for' + s, f * 0.142, 0.165, 0.315, 'fpaw' + s],
        ['fpaw' + s, 'mc' + s, f * 0.14, 0.062, 0.335],
        ['th' + s, 'pelvis', f * 0.13, 0.6, -0.4, 'shin' + s],
        ['shin' + s, 'th' + s, f * 0.15, 0.385, -0.3, 'met' + s],
        ['met' + s, 'shin' + s, f * 0.142, 0.205, -0.445, 'hpaw' + s],
        ['hpaw' + s, 'met' + s, f * 0.14, 0.062, -0.405],
      );
    }
    return b;
  }
  const ENDS = {
    tail2: [0, 0.38, -0.655], head: [0, 0.42, 0.98], jaw: [0, 0.41, 0.915], earL: [0.14, 0.925, 0.65], earR: [-0.14, 0.925, 0.65],
    fpawL: [0.14, 0.012, 0.382], fpawR: [-0.14, 0.012, 0.382], hpawL: [0.14, 0.012, -0.358], hpawR: [-0.14, 0.012, -0.358],
    body: [0, 0.65, 0.26], pelvis: [0, 0.635, -0.565], chest: [0, 0.665, 0.46], ribs: [0, 0.56, 0.3],
    crest0: [0, 1.0, 0.25], crest1: [0, 0.95, -0.05], crest2: [0, 0.88, -0.35],
  };
  const TAILS = ['tail0', 'tail1', 'tail2'];
  const LEGKEYS = ['ikFL', 'ikFR', 'ikHL', 'ikHR'];

  /* ======================================================================================================== */
  function makeSuid(cfg) {
    const k = cfg.k, D = CREATURE_DEFS.SPECIES[cfg.id];
    const raw = boneList();
    const tplU = K.rigTemplate(raw, ENDS);                             // boar units: geometry + weights are authored here
    const scaled = raw.map((b) => [b[0], b[1], b[2] * k, b[3] * k, b[4] * k, b[5]]);
    const endsK = {}; for (const n in ENDS) endsK[n] = ENDS[n].map((x) => x * k);
    const tpl = K.rigTemplate(scaled, endsK);
    const I = tpl.idx, W = (n) => tplU.world[I[n]].clone();
    const chan = K.channelMap(tpl, LEGKEYS.concat(['nose', 'crest']));
    const ch = (n) => chan[n];
    const C = cfg.pal;

    /* ---------------- colour ---------------- */
    function hide(p, n) {
      // grizzled bristle coat: dark dorsal crest, slightly lighter flanks, dark lower legs; coarse breakup noise
      const up = n.y, dors = sstep(0.3, 0.95, up), ven = sstep(-0.2, -0.8, up);
      let c = mix(C.side, C.back, dors);
      c = mix(c, C.belly, ven * 0.8);
      c = mix(c, C.crest, gs(p.x, 0, 0.06) * sstep(0.74, 0.86, p.y) * sstep(-0.2, 0.1, p.z));
      c = mix(c, C.leg, sstep(0.36, 0.2, p.y));
      const g = 0.82 + 0.3 * vnoise3(p.x * 34, p.y * 34, p.z * 34) + 0.08 * (vnoise3(p.x * 120, p.y * 120, p.z * 120) - 0.5);
      return mul(c, g);
    }

    /* ---------------- geometry (boar units, scaled by k at the end) ---------------- */
    const H = cfg.hump, NK = cfg.neckK, LW = cfg.legW;
    const SPINE = [
      ['pelvis', V(0, 0.6, -0.66), V(0, 0.62, -0.18)], ['body', V(0, 0.62, -0.18), V(0, 0.645, 0.14)],
      ['chest', V(0, 0.645, 0.14), V(0, 0.66, 0.4)], ['neck', V(0, 0.66, 0.4), V(0, 0.675, 0.56)], ['head', V(0, 0.675, 0.56), V(0, 0.62, 0.72)],
    ].map((s) => [I[s[0]], s[1], s[2]]);
    function bodySDF() {
      return K.sdf([
        { e: [0, 0.6, -0.37], r: [0.165 * cfg.rumpK, 0.19 * cfg.rumpK, 0.2] },             // rump / haunches
        { e: [0, 0.57, -0.08], r: [0.2, 0.215, 0.3], k: 0.12 },                            // barrel
        { e: [0, 0.6, 0.22], r: [0.2 * NK, 0.255, 0.24], k: 0.12 },                        // deep chest
        { e: [0, 0.74 + 0.02 * H, 0.2], r: [0.13 * NK, 0.1 + 0.05 * H, 0.24 + 0.04 * H], k: 0.1 },   // withers hump (bristly crest)
        { e: [0, 0.72, -0.15], r: [0.1, 0.07, 0.24], k: 0.09 },                            // loin / back line sloping to the rump
        { e: [0.145, 0.6, 0.32], r: [0.085 * NK * cfg.shoulderK, 0.17 * cfg.shoulderK, 0.14 * cfg.shoulderK], k: 0.08 },   // shoulder muscles
        { e: [-0.145, 0.6, 0.32], r: [0.085 * NK * cfg.shoulderK, 0.17 * cfg.shoulderK, 0.14 * cfg.shoulderK], k: 0.08 },
        { e: [0.13, 0.53, -0.38], r: [0.075, 0.15, 0.13], rot: [0.3, 0, 0], k: 0.08 },    // hams
        { e: [-0.13, 0.53, -0.38], r: [0.075, 0.15, 0.13], rot: [0.3, 0, 0], k: 0.08 },
        { c: [0, 0.64, 0.36, 0, 0.655, 0.6], ra: 0.205 * NK, rb: 0.165 * NK, k: 0.1 },     // short thick neck
        { e: [0, 0.48, 0.42], r: [0.13 * NK, 0.13, 0.16], k: 0.1 },                        // brisket / throat
      ]);
    }
    function headSDF() {
      const hk = cfg.headK;
      return K.sdf([
        { e: [0, 0.69, 0.66], r: [0.12 * hk, 0.12, 0.15] },                                // cranium
        { e: [0.088, 0.585, 0.68], r: [0.075 * hk, 0.1, 0.12], k: 0.06 },                  // jowls / masseters
        { e: [-0.088, 0.585, 0.68], r: [0.075 * hk, 0.1, 0.12], k: 0.06 },
        { c: [0, 0.625, 0.72, 0, 0.43, 0.965], ra: 0.115 * hk, rb: 0.052, k: 0.06, sq: 1.08 },   // tapering snout
        { e: [0, 0.625, 0.83], r: [0.06, 0.05, 0.15], rot: [0.75, 0, 0], k: 0.05 },        // nasal ridge (straight top line)
        { e: [0, 0.418, 0.985], r: [0.052, 0.046, 0.022], rot: [0.67, 0, 0], k: 0.018 },   // the disc
        { e: [0, 0.745, 0.715], r: [0.1 * hk, 0.04, 0.06], k: 0.04 },                      // brow
        { e: [0, 0.515, 0.74], r: [0.08 * hk, 0.06, 0.12], k: 0.05 },                      // under-jaw outline
        { e: [0.05 * hk, 0.47, 0.875], r: [0.03, 0.03, 0.05], k: 0.03 },                   // tusk sockets (flews)
        { e: [-0.05 * hk, 0.47, 0.875], r: [0.03, 0.03, 0.05], k: 0.03 },
        { e: [0.086 * hk, 0.7, 0.745], r: [0.024, 0.019, 0.024], k: 0.012, sub: true },    // eye sockets (small eyes)
        { e: [-0.086 * hk, 0.7, 0.745], r: [0.024, 0.019, 0.024], k: 0.012, sub: true },
        { e: [0.018, 0.418, 1.0], r: [0.011, 0.011, 0.02], rot: [0.67, 0, 0], k: 0.006, sub: true },   // nostrils
        { e: [-0.018, 0.418, 1.0], r: [0.011, 0.011, 0.02], rot: [0.67, 0, 0], k: 0.006, sub: true },
      ]);
    }
    function build(q) {
      const parts = { fur: [], horn: [], gloss: [] };
      const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
      const bsdf = bodySDF();
      const spine = new T.CatmullRomCurve3([V(0, 0.6, -0.5), V(0, 0.625, -0.35), V(0, 0.64, -0.1), V(0, 0.655, 0.15), V(0, 0.665, 0.38), V(0, 0.68, 0.56)], false, 'centripetal');
      const body = K.projectSDF({ sdf: bsdf, curve: spine, rows: nr(52), nu: nu(34), cap0: 0.14, cap1: 0.1, rmax: 0.7 });
      const hip = { L: W('thL'), R: W('thR') }, sh = { L: W('humL'), R: W('humR') };
      K.skin(body, (p) => {
        const sd = p.x >= 0 ? 'L' : 'R';
        return K.envelope(SPINE, p, 4, [
          [I['th' + sd], 0.55 * gs(p.distanceTo(hip[sd]), 0, 0.13) * sstep(0.02, 0.1, Math.abs(p.x))],
          [I['scap' + sd], 0.5 * gs(p.distanceTo(sh[sd]), 0, 0.14) * sstep(0.02, 0.1, Math.abs(p.x))],
          [I.ribs, 0.5 * gs(p.z, 0.02, 0.2) * sstep(0.56, 0.42, p.y)],
        ]);
      });
      K.paint(body, hide);
      parts.fur.push(body);

      /* head + mandible */
      const hs = headSDF();
      const head = K.projectSDF({ sdf: hs, curve: new T.LineCurve3(V(0, 0.7, 0.585), V(0, 0.432, 0.962)), rows: nr(34), nu: nu(30), cap0: 0.22, cap1: 0.1, rmax: 0.3 });
      const disc = V(0, 0.418, 0.99);
      K.skin(head, [[I.head, 1]]);
      K.paint(head, (p, n) => {
        let c = hide(p, n);
        c = mix(c, C.snout, sstep(0.82, 0.92, p.z) * 0.7);
        c = mix(c, C.cheek, sstep(0.05, 0.1, Math.abs(p.x)) * gs(p.y, 0.6, 0.06) * gs(p.z, 0.72, 0.09) * 0.8);
        c = mix(c, C.disc, sstep(0.05, 0.03, p.distanceTo(disc)) * sstep(0.3, 0.7, n.z * 0.78 - n.y * 0.62));
        c = mix(c, C.mouth, sstep(0.78, 0.84, p.z) * sstep(-0.5, -0.85, n.y) * sstep(0.47, 0.45, p.y) * sstep(0.04, 0.02, Math.abs(p.x)));
        return c;
      });
      parts.fur.push(head);
      const jsdf = K.sdf([
        { c: [0, 0.53, 0.68, 0, 0.41, 0.915], ra: 0.07 * cfg.headK, rb: 0.033, sq: 1.18 },
        { e: [0, 0.5, 0.76], r: [0.06 * cfg.headK, 0.045, 0.12], k: 0.04 },
      ]);
      const jaw = K.projectSDF({ sdf: jsdf, curve: new T.LineCurve3(V(0, 0.525, 0.69), V(0, 0.415, 0.905)), rows: nr(16), nu: nu(18), cap0: 0.2, cap1: 0.2, rmax: 0.16 });
      K.skin(jaw, [[I.jaw, 1]]);
      K.paint(jaw, (p, n) => mix(mix(C.belly, C.snout, 0.5), C.mouth, sstep(0.3, 0.8, n.y) * sstep(0.74, 0.8, p.z)));
      parts.fur.push(jaw);

      /* tusks: lower canines curving out, up and back (the boar's signature); small upper whetters */
      const tk = cfg.tuskK;
      for (const s of [-1, 1]) {
        const base = V(s * 0.045 * cfg.headK, 0.455, 0.885);
        const pts = [base, V(s * (0.058 + 0.01 * tk), 0.47 + 0.03 * tk, 0.905 + 0.012 * tk), V(s * (0.075 + 0.025 * tk), 0.5 + 0.06 * tk, 0.9 + 0.005 * tk), V(s * (0.088 + 0.035 * tk), 0.53 + 0.075 * tk, 0.865 - 0.02 * tk)];
        const tusk = K.sweep({ pts, up: V(s, 0.3, 0.2), prof: (u, o) => { const r = lerp(0.017 * Math.sqrt(tk), 0.0025, Math.pow(u, 0.9)); o[0] = r * 0.85; o[1] = r; o[2] = r; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: nr(9), nu: nu(10), cap0: 1, cap1: 2 });
        K.skin(tusk, [[I.jaw, 1]]);
        K.paint(tusk, (p, n, info) => mix(C.tuskBase, C.tusk, sstep(0.05, 0.4, info ? info.s : 1)));
        parts.horn.push(tusk);
        const up = K.sweep({ pts: [V(s * 0.05 * cfg.headK, 0.49, 0.875), V(s * 0.068, 0.52, 0.875), V(s * 0.08, 0.545, 0.86)], up: V(s, 0, 0.3), prof: (u, o) => { const r = lerp(0.011 * Math.sqrt(tk), 0.002, u); o[0] = r * 0.85; o[1] = r; o[2] = r; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 5, nu: 8, cap0: 1, cap1: 2 });
        K.skin(up, [[I.head, 1]]); K.paint(up, C.tusk); parts.horn.push(up);
        const eye = new T.SphereGeometry(0.019, Math.max(8, Math.round(12 * q)), Math.max(6, Math.round(9 * q)));
        eye.translate(s * 0.087 * cfg.headK, 0.701, 0.748);
        parts.gloss.push(K.prim(eye, C.eye, I.head));
      }

      /* ears: pointed, upright, slightly cupped forward-out */
      for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
        const e = K.sweep({
          pts: [V(s * 0.07, 0.77, 0.63), V(s * 0.1, 0.85, 0.635), V(s * 0.14, 0.925, 0.65)], up: V(s * 0.6, 0.15, 0.78),
          prof: (u, o) => { o[0] = 0.062 * Math.pow(1 - u, 1.1) * (0.75 + 0.25 * sstep(0, 0.25, u)) + 0.004; o[1] = o[2] = 0.009 * (1 - 0.6 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; },
          cup: (u) => -0.022 * Math.sin(PI * Math.min(1, u * 1.1)), rows: nr(9), nu: nu(16), cap0: 1, cap1: 3,
        });
        K.skin(e, (p) => [[I['ear' + sd], sstep(0.79, 0.81, p.y)], [I.head, 1 - sstep(0.79, 0.81, p.y)]]);
        K.paint(e, (p, n) => mul(mix(C.back, C.earIn, sstep(0, 0.6, n.z * 0.83 + n.x * s * 0.55) * sstep(0.8, 0.84, p.y)), 0.9 + 0.2 * vnoise3(p.x * 50, p.y * 50, 1)));
        parts.fur.push(e);
      }

      /* tail: thin, hanging, with a tuft */
      const tp = [V(0, 0.64, -0.52), W('tail0'), W('tail1'), W('tail2'), V(0, 0.38, -0.655)];
      const tsegs = [['pelvis', 0, 1], ['tail0', 1, 2], ['tail1', 2, 3], ['tail2', 3, 4]].map((x) => [I[x[0]], tp[x[1]], tp[x[2]]]);
      const tc = M.curve([[0, 0.035], [0.15, 0.022], [0.6, 0.012], [0.78, 0.014], [0.9, 0.024], [1, 0.006]]), tq = [0];
      const tail = K.sweep({ pts: tp, prof: (u, o) => { tc(u, tq); o[0] = tq[0] * (u > 0.75 ? 0.7 : 1); o[1] = tq[0]; o[2] = tq[0]; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.004 * sstep(0.75, 0.85, u) * (vnoise3(a * 3, u * 40, 0) - 0.5), rows: nr(16), nu: nu(10), cap0: 0, cap1: 2 });
      K.skin(tail, (p) => K.envelope(tsegs, p, 4));
      K.paint(tail, (p, n, info) => mix(hide(p, n), C.crest, sstep(0.7, 0.85, info ? info.s : 0)));
      parts.fur.push(tail);

      /* bristle ridge (spikeback): graduated rows of tapered keratin blades swept back along the spine */
      if (cfg.bristles) {
        const top = (x, z) => { let y = 1.4; for (let i = 0; i < 200 && y > 0.3; i++) { const d = bsdf(x, y, z); if (d < 0.0005) break; y -= Math.max(0.002, d * 0.9); } return y; };
        const N = Math.max(12, Math.round(cfg.bristles * Math.max(0.6, q)));
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1), z = lerp(0.52, cfg.maneOnly ? -0.05 : -0.42, u);
          const hgt = cfg.bristleH * (0.35 + 0.65 * Math.pow(Math.sin(PI * Math.min(1, (u + 0.08) / 0.75)), 1.4)) * (u > 0.75 ? lerp(1, 0.45, (u - 0.75) / 0.25) : 1);
          const crest = z > 0.12 ? 'crest0' : z > -0.17 ? 'crest1' : 'crest2';
          for (const s of [-1, 0, 1]) {
            if (s && (hgt < 0.11 || i % 2 || cfg.maneOnly)) continue;
            const x = s * 0.04, h = hgt * (s ? 0.55 : 1), zz = z + (s ? 0.02 : 0);
            const y0 = top(x, zz) - 0.015, sweepBack = 0.85 + 0.3 * u;
            const pts = [V(x, y0, zz), V(x + s * 0.008, y0 + h * 0.55, zz - h * 0.25 * sweepBack), V(x + s * 0.016, y0 + h, zz - h * 0.62 * sweepBack)];
            const bw = cfg.maneOnly ? 0.6 : 1;
            const bl = K.sweep({ pts, up: V(0, 0, 1), prof: (t, o) => { const r = lerp(1, 0.04, Math.pow(t, 0.8)); o[0] = 0.015 * bw * r * (s ? 0.85 : 1); o[1] = o[2] = 0.034 * bw * r * Math.min(1, h / 0.12); o[3] = 2.2; o[4] = 0; o[5] = 0; return o; }, rows: cfg.maneOnly ? 4 : 5, nu: cfg.maneOnly ? 4 : 6, cap0: 0, cap1: 1 });
            K.skin(bl, [[I[crest], 1]]);
            K.paint(bl, (p, n, info) => mul(mix(C.bristle, C.bristleTip, sstep(0.45, 1, info ? info.s : 0)), 0.9 + 0.2 * hash01(i * 3 + s)));
            parts.fur.push(bl);
          }
        }
      }

      /* legs: built on the left, mirrored */
      const legParts = [];
      const s = 1, sd = 'L';
      const hipIn = V(0.085, 0.68, -0.36);
      const hpts = [hipIn, W('thL'), W('shinL'), V(0.147, 0.295, -0.375), W('metL'), V(0.141, 0.13, -0.425), W('hpawL')];
      const hc = M.curve([[0, 0.075, 0.1, 0.11], [0.2, 0.078, 0.11, 0.12], [0.4, 0.055, 0.06, 0.07], [0.55, 0.042, 0.04, 0.05], [0.68, 0.03, 0.026, 0.04], [0.85, 0.023, 0.022, 0.024], [1, 0.026, 0.028, 0.026]]), hq = [0, 0, 0];
      const hind = K.sweep({ pts: hpts, up: V(0, 0, 1), prof: (u, o) => { hc(u, hq); o[0] = hq[0] * LW; o[1] = hq[1] * LW; o[2] = hq[2] * LW; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.012 * LW * gs(u, 0.66, 0.035) * ga(a, PI, 0.5), rows: nr(30), nu: nu(16), cap0: 2, cap1: 0 });
      K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('thL')], [I.thL, W('thL'), W('shinL')], [I.shinL, W('shinL'), W('metL')], [I.metL, W('metL'), W('hpawL')]], p, 4));
      K.paint(hind, hide);
      legParts.push(['fur', hind]);
      const shIn = V(0.085, 0.72, 0.3);
      const fpts = [shIn, W('humL'), W('forL'), V(0.147, 0.252, 0.284), W('mcL'), V(0.141, 0.11, 0.326), W('fpawL')];
      const fc = M.curve([[0, 0.07, 0.09, 0.09], [0.25, 0.075, 0.09, 0.095], [0.45, 0.05, 0.05, 0.062], [0.62, 0.038, 0.036, 0.04], [0.74, 0.033, 0.034, 0.03], [0.86, 0.023, 0.022, 0.022], [1, 0.026, 0.027, 0.026]]), fq = [0, 0, 0];
      const fore = K.sweep({ pts: fpts, up: V(0, 0, 1), prof: (u, o) => { fc(u, fq); o[0] = fq[0] * LW; o[1] = fq[1] * LW; o[2] = fq[2] * LW; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.01 * LW * gs(u, 0.47, 0.04) * ga(a, PI, 0.5), rows: nr(30), nu: nu(16), cap0: 2, cap1: 0 });
      K.skin(fore, (p) => K.envelope([[I.scapL, shIn, W('humL')], [I.humL, W('humL'), W('forL')], [I.forL, W('forL'), W('mcL')], [I.mcL, W('mcL'), W('fpawL')]], p, 4));
      K.paint(fore, hide);
      legParts.push(['fur', fore]);
      // pasterns + cloven hooves (fetlock -> hoof tip on the ground) and dew claws
      for (const [pw, fpz] of [['fpawL', 1], ['hpawL', 1]]) {
        const f = W(pw), tip = V(f.x, 0.02, f.z + 0.045);
        const hoof = K.sweep({ pts: [V(f.x, f.y + 0.014, f.z - 0.006), V(f.x, f.y - 0.012, f.z + 0.008), V(f.x, 0.032, f.z + 0.026), tip], up: V(0, 0.6, 1),
          prof: (u, o) => { const r = lerp(0.025, 0.029, sstep(0.3, 0.75, u)) * LW * (1 - 0.3 * sstep(0.85, 1, u)); o[0] = r * 1.08; o[1] = r * 0.92; o[2] = r * 0.92; o[3] = 2.4; o[4] = 0; o[5] = 0; return o; },
          detail: (u, a) => -0.01 * LW * sstep(0.5, 0.72, u) * ga(a, 0, 0.14), rows: nr(12), nu: nu(16), cap0: 1, cap1: 2 });
        K.skin(hoof, (p) => K.envelope([[I[pw === 'fpawL' ? 'mcL' : 'metL'], V(f.x, f.y + 0.1, f.z), f], [I[pw], f, tip]], p, 4));
        K.paint(hoof, (p, n, info) => { const hornK = sstep(0.42, 0.55, info ? info.s : 0); return mix(mul(C.leg, 0.9), mul(C.hoof, 0.95 + 0.1 * n.y), hornK); });
        legParts.push(['horn', hoof]);
        const dew = K.sweep({ pts: [V(f.x, f.y + 0.004, f.z - 0.016), V(f.x, f.y - 0.012, f.z - 0.027), V(f.x, f.y - 0.022, f.z - 0.03)], up: V(0, 0, 1), prof: (u, o) => { const r = lerp(0.009, 0.004, u) * LW; o[0] = r * 1.5; o[1] = r; o[2] = r; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 8, cap0: 1, cap1: 2 });
        K.skin(dew, [[I[pw], 1]]); K.paint(dew, C.hoof); legParts.push(['horn', dew]);
      }
      const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
      for (const [slot, g] of legParts) { parts[slot].push(g); parts[slot].push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
      // boar units -> species size
      for (const sl in parts) for (const g of parts[sl]) g.scale(k, k, k);
      return parts;
    }

    /* ---------------- animation profile ---------------- */
    const legs = [
      { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: 0.062 * k, toeLen: 0.08 * k, lift: 0.1 * k, curl: 1.0 },
      { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: 0.062 * k, toeLen: 0.08 * k, lift: 0.1 * k, curl: 1.0 },
      { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: 0.062 * k, toeLen: 0.08 * k, lift: 0.09 * k, curl: 0.8 },
      { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: 0.062 * k, toeLen: 0.08 * k, lift: 0.09 * k, curl: 0.8 },
    ];
    const gaits = {
      walk: { stride: (v) => (0.4 + 0.28 * v / k) * k, duty: 0.62, minV: 0.06 },
      trot: { stride: (v) => (0.78 + 0.22 * v / k) * k, duty: 0.46, minV: 0.06 },
      // stance shortens with speed (charging ~9 m/s: duty ~0.2), so planted hooves stay within leg reach
      gallop: { stride: (v) => (0.95 + 0.16 * v / k) * k, get duty() { return M.clamp(0.34 - 0.03 * (curV / k - 3.8), 0.19, 0.34); }, get dutyF() { return M.clamp(0.28 - 0.025 * (curV / k - 3.8), 0.16, 0.28); }, minV: 0.06, liftK: () => 1.2 },
    };
    let curV = 0;
    const offsets = {
      HL: { walk: 0, trot: 0.5, gallop: 0 }, FL: { walk: 0.25, trot: 0, gallop: 0.58 },
      HR: { walk: 0.5, trot: 0, gallop: 0.1 }, FR: { walk: 0.75, trot: 0.5, gallop: 0.47 },
    };
    const vT = 1.55 * Math.sqrt(k), vG = 2.9 * Math.sqrt(k);
    function select(v, cur) {
      curV = v;
      if (cur === 'gallop') return v < vG - 0.4 ? 'trot' : 'gallop';
      if (cur === 'trot') return v > vG ? 'gallop' : v < vT - 0.3 ? 'walk' : 'trot';
      return v > vT ? 'trot' : 'walk';
    }
    // body bone local pivots (boar units * k): hips (dy -0.02, dz -0.4), shoulders (dy -0.1, dz 0.36)
    const HIP = [-0.02 * k, -0.4 * k], SHO = [-0.1 * k, 0.36 * k];
    const BODY_Y = 0.62 * k;

    function base(P, ctx, A) {
      const dt = ctx.dt, v = ctx.v, t = ctx.t;
      ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / (0.5 * k)) : 0, 6, dt);
      const mw = ctx.mw, idle = 1 - mw, run = sstep(vT, vG + 1, v), gal = ctx.gaitName === 'gallop' ? 1 : 0;
      ctx.gw = M.damp(ctx.gw || 0, gal, 5, dt);
      ctx.cw = M.damp(ctx.cw || 0, ctx.mode === 'charge' ? 0.35 : 0, 6, dt);
      ctx.ew = M.damp(ctx.ew || 0, ctx.enraged ? 1 : 0, 2, dt);
      const ph = ctx.phase * TAU, gw = ctx.gw, cw = ctx.cw;
      // weight: double bob for walk / trot (heavy), one rocking cycle for the gallop
      P[ch('body.py')] += mw * ((1 - gw) * (-0.012 - 0.008 * run) * Math.cos(2 * ph) + gw * 0.035 * Math.sin(ph + 0.7)) * k - 0.03 * run * k - 0.04 * cw * k;
      const flex = gw * 0.11 * Math.sin(ph + 0.4);
      P[ch('pelvis.rx')] += flex; P[ch('chest.rx')] -= flex * 0.7;
      P[ch('body.rx')] += gw * 0.05 * Math.sin(ph + 2.0) + 0.04 * run + 0.06 * cw;
      P[ch('body.rz')] += mw * (1 - gw) * 0.025 * Math.sin(ph);
      P[ch('pelvis.rz')] += mw * (1 - gw) * 0.05 * Math.sin(ph);
      P[ch('pelvis.ry')] += mw * (1 - gw) * 0.05 * Math.sin(ph + 0.5);
      P[ch('chest.ry')] += mw * (1 - gw) * -0.035 * Math.sin(ph + 0.5);
      P[ch('chest.rz')] += mw * (1 - gw) * -0.03 * Math.sin(ph + 0.3);       // shoulders counter-roll
      const tr = M.clamp(ctx.turn * 0.06, -0.25, 0.25);
      P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.5; P[ch('neck.ry')] += tr * 0.8;
      // idle: low head carriage, slow scanning, snout twitches; heavy breathing for the boss
      const look = (vnoise3(t * 0.25, 1.3, 0) - 0.5) * 1.1, lookY = (vnoise3(t * 0.22, 4.1, 2) - 0.5) * 0.5;
      P[ch('neck.ry')] += idle * look * 0.45; P[ch('head.ry')] += idle * look * 0.3;
      P[ch('neck.rx')] += idle * (lookY * 0.25 + 0.08); P[ch('head.rx')] += idle * lookY * 0.25;
      P[ch('nose')] += idle * Math.max(0, Math.sin(t * 13)) * (vnoise3(t * 0.7, 7, 1) > 0.58 ? 1 : 0);
      // charge / sprint: head low and level, ears pinned
      P[ch('neck.rx')] += 0.3 * cw + 0.1 * run; P[ch('head.rx')] += 0.1 * cw;
      const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
      P[ch('neck.rx')] -= bodyPitch * 0.7; P[ch('head.rx')] -= bodyPitch * 0.2;
      // tail: swishes when standing, streams out when galloping
      for (let i = 0; i < TAILS.length; i++) {
        P[ch(TAILS[i] + '.rx')] += run * (i === 0 ? 0.6 : 0.2) + idle * 0.05 * Math.sin(t * 1.3 - i);
        P[ch(TAILS[i] + '.ry')] += idle * (0.35 * Math.sin(t * 5.5 - i * 0.9) * sstep(0.4, 0.7, vnoise3(t * 0.4, 9, 3))) + mw * (1 - gw) * 0.15 * Math.sin(ph - i * 0.8);
      }
      // ears: flick at rest, pinned back when running / charging / enraged
      const back = Math.max(run * 0.7, cw, ctx.ew);
      P[ch('earL.rx')] -= back * 0.6; P[ch('earR.rx')] -= back * 0.6; P[ch('earL.rz')] -= back * 0.25; P[ch('earR.rz')] += back * 0.25;
      P[ch('earL.ry')] += idle * 0.4 * Math.max(0, Math.sin(t * 9)) * (vnoise3(t * 0.5, 2, 5) > 0.62 ? 1 : 0);
      // scapulae glide with the fore steps
      const fF = A.gait.feet[0], fR = A.gait.feet[1];
      P[ch('scapL.rx')] += mw * 0.16 * scapSwing(fF); P[ch('scapR.rx')] += mw * 0.16 * scapSwing(fR);
      // enraged: bristles stay raised, head carried higher, faster breathing
      P[ch('crest')] += ctx.ew * 0.25;
      P[ch('neck.rx')] -= ctx.ew * 0.12;
    }
    function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }
    // cannon / metatarsus pitch: rolls over the planted hoof through the stance (extra reach at touch-down and toe-off),
    // folds back in the swing (carpus / hock flexion)
    function distal(Lg, f, ctx) {
      const mw = ctx.mw || 0;
      if (Lg.type === 'hind') {
        if (f.planted) return Lg.restDistal + 0.3 * (1 - 2 * f.stanceU) * mw;
        return Lg.restDistal - 0.75 * Math.sin(PI * Math.min(1, f.swingU * 1.05)) + 0.3 * sstep(0.6, 1, f.swingU) * mw;
      }
      if (f.planted) return Lg.restDistal + 0.42 * (1 - 2 * f.stanceU) * mw;
      return Lg.restDistal - 1.55 * Math.sin(PI * Math.min(1, f.swingU * 1.08)) + 0.42 * sstep(0.6, 1, f.swingU) * mw;
    }
    const PASTERN = Math.atan2(0.05, 0.047);                        // hoof pitch below horizontal at rest (steep pig pastern)
    function toeExtra() { return PASTERN; }
    function post(P, ctx, A) {
      const fast = ctx.moving || ctx.enraged ? 1 : 0;
      const breath = Math.sin(ctx.t * (fast ? 7 : cfg.breathRate));
      A.B[I.ribs].scale.setScalar(ctx.dead ? 1 : 1 + cfg.breathAmp * breath);
      A.B[I.head].rotateX(-0.05 * P[ch('nose')]);
      const cr = Math.max(0.4, 1 + P[ch('crest')]);
      for (const c of ['crest0', 'crest1', 'crest2']) A.B[I[c]].scale.set(1, cr, 1 + 0.25 * (cr - 1));
      for (const c of ['crest0', 'crest1', 'crest2']) A.B[I[c]].rotateX(0.3 * (cr - 1));    // stand up from swept-back
    }
    function secondary(ctx, A) {
      const dt = ctx.dt, B = A.B;
      const tgt = -M.clamp(ctx.turn * 0.15, -0.8, 0.8);
      for (let i = 1; i < TAILS.length; i++) B[I[TAILS[i]]].rotateY(K.stepSpring(A.sp_('t' + i), tgt * (0.4 + 0.3 * i), 70, 7, dt) * 0.4);
      const ey = K.stepSpring(A.sp_('ear'), (B[I.body].position.y - BODY_Y) / k * -18, 220, 12, dt);
      B[I.earL].rotateX(ey * 0.25); B[I.earR].rotateX(ey * 0.25);
    }
    const TAIL_IX = TAILS.map((n) => I[n]);
    const TAIL_END = TAILS.map((n, j) => (j < TAILS.length - 1 ? tpl.local[I[TAILS[j + 1]]].clone() : new T.Vector3(...endsK.tail2).sub(tpl.world[I.tail2])));
    const TAIL_MIN = [0.05 * k, 0.04 * k, 0.03 * k];
    function ground(ctx, A) { K.groundChain(A, TAIL_IX, TAIL_END, TAIL_MIN); }
    function flinch(P, t, dir, pow) {
      const f = Math.exp(-t * 8) * Math.sin(Math.min(1, t * 11) * PI * 0.5) * pow * cfg.flinchK;
      P[ch('body.px')] += dir[0] * 0.05 * k * f; P[ch('body.pz')] += dir[1] * 0.05 * k * f; P[ch('body.py')] -= 0.02 * k * f;
      P[ch('body.rz')] += -dir[0] * 0.12 * f; P[ch('chest.rx')] += 0.08 * f;
      P[ch('neck.rx')] -= 0.22 * f; P[ch('head.rx')] -= 0.15 * f; P[ch('head.ry')] += dir[0] * 0.25 * f; P[ch('jaw.rx')] += 0.25 * f;
      P[ch('earL.rx')] -= 0.5 * f; P[ch('earR.rx')] -= 0.5 * f;
    }

    /* ---------------- actions (keyed on the authority's phase instants) ---------------- */
    const A_ = D.attacks;
    // weight-shift helper for attack tracks: piecewise ease through the named instants
    function through(ph, vals) { const c = M.curve(['s', 'an', 'wu', 'hit', 'fo', 'e'].map((nm, i) => [ph[nm], vals[i]]).filter((x, i, a) => i === 0 || x[0] > a[i - 1][0] + 1e-6)), o = [0]; return (u) => c(u, o)[0]; }
    function scrape(P, u, w, from, to, legKey, s) {     // one fore hoof paws the ground backwards (FK) between u = from..to
      const e = sstep(from, from + 0.05, u) * sstep(to, to - 0.05, u) * w;
      if (e <= 0) return;
      const cyc = (u - from) / (to - from) * 2;         // two strokes
      const sw = Math.sin(cyc * TAU);
      P[ch(legKey)] -= e;
      P[ch('hum' + s + '.rx')] += (-0.35 + 0.45 * sw) * e; P[ch('for' + s + '.rx')] += (0.7 - 0.4 * sw) * e; P[ch('mc' + s + '.rx')] += (0.6 + 0.3 * Math.cos(cyc * TAU)) * e;
    }
    const actions = {};
    if (A_.tusk) {
      const a = A_.tusk, ph = a.phases;
      const tr = K.track(chan, ph, {
        // s, an (head drops, weight back), wu (head low, cocked to the side), hit (upward hooking toss), fo (high), e
        'neck.rx': [0, 0.28, 0.34, -0.42, -0.2, 0], 'head.rx': [0, 0.18, 0.2, -0.38, -0.15, 0],
        'head.ry': [0, 0.08, 0.3, -0.22, -0.08, 0], 'neck.ry': [0, 0.05, 0.18, -0.15, -0.05, 0],
        'chest.rx': [0, 0.08, 0.12, -0.06, -0.02, 0], 'pelvis.rx': [0, -0.06, -0.08, 0.06, 0.02, 0],
        'jaw.rx': [0, 0.04, 0.12, 0.3, 0.08, 0],
        'earL.rx': [0, -0.4, -0.6, -0.5, -0.3, 0], 'earR.rx': [0, -0.4, -0.6, -0.5, -0.3, 0],
        'tail0.rx': [0, 0.1, 0.25, 0.35, 0.2, 0],
      });
      const pz = through(ph, [0, -0.06, -0.035, 0.09, 0.05, 0]), py = through(ph, [0, -0.04, -0.05, 0.02, 0.0, 0]);
      actions.tusk = { kind: 'attack', dur: a.dur, blendIn: 0.1, blendOut: 0.25, track: (P, u, w) => {
        tr(P, u, w);
        P[ch('body.pz')] += pz(u) * k * w; P[ch('body.py')] += py(u) * k * w;
        const lift = sstep(ph.wu, ph.hit, u) * sstep(ph.fo + 0.1, ph.hit, u);
        K.pitchAbout(P, chan, -0.1 * lift * w, HIP[0], HIP[1]);                  // forequarters heave up into the hook
      } };
    }
    if (A_.charge) {
      const a = A_.charge, ph = a.phases;
      const tr = K.track(chan, ph, {
        // s, an (paw scrape, head low), wu (coiled), hit (head-down impact posture), fo (skid, head up), e
        'neck.rx': [0, 0.22, 0.3, 0.3, -0.12, 0], 'head.rx': [0, 0.06, 0.1, 0.02, -0.15, 0],
        'chest.rx': [0, 0.04, 0.06, 0.0, -0.06, 0],
        'earL.rx': [0, -0.6, -0.8, -0.8, -0.4, 0], 'earR.rx': [0, -0.6, -0.8, -0.8, -0.4, 0],
        'tail0.rx': [0, 0.4, 0.6, 0.6, 0.3, 0],
        'body.py': [0, -0.03 * k, -0.06 * k, -0.04 * k, -0.02 * k, 0],
        'crest': [0, 0.3, 0.45, 0.45, 0.3, 0],
      });
      actions.charge = { kind: 'attack', dur: a.dur, blendIn: 0.12, blendOut: 0.3, ground: true, track: (P, u, w) => {
        tr(P, u, w);
        scrape(P, u, w, 0.02, ph.an + 0.06, 'ikFL', 'L');
        // skid at the end: forequarters brace, rump drops
        const sk = sstep(ph.fo - 0.08, ph.fo, u) * sstep(1, ph.fo + 0.05, u);
        K.pitchAbout(P, chan, 0.08 * sk * w, SHO[0], SHO[1]);
        P[ch('body.pz')] -= 0.05 * k * sk * w;
      } };
    }
    if (A_.sweep) {
      const a = A_.sweep, ph = a.phases;
      const tr = K.track(chan, ph, {
        // s, an (head swings wide right, telegraph), wu (lowered, coiled), hit (huge sweep left + hook), fo (overshoot), e
        'neck.ry': [0, 0.36, 0.4, -0.45, -0.55, 0], 'head.ry': [0, 0.22, 0.25, -0.35, -0.42, 0], 'chest.ry': [0, 0.18, 0.22, -0.2, -0.26, 0],
        'pelvis.ry': [0, -0.12, -0.15, 0.1, 0.15, 0],
        'neck.rx': [0, 0.15, 0.35, 0.05, -0.15, 0], 'head.rx': [0, 0.1, 0.2, -0.15, -0.2, 0],
        'body.rz': [0, 0.05, 0.08, -0.08, -0.1, 0],
        'jaw.rx': [0, 0.15, 0.2, 0.35, 0.2, 0],
        'earL.rx': [0, -0.5, -0.7, -0.7, -0.5, 0], 'earR.rx': [0, -0.5, -0.7, -0.7, -0.5, 0],
        'crest': [0, 0.25, 0.35, 0.4, 0.3, 0],
      });
      const px = through(ph, [0, 0.05, 0.06, -0.06, -0.08, 0]);
      actions.sweep = { kind: 'attack', dur: a.dur, blendIn: 0.12, blendOut: 0.3, track: (P, u, w) => {
        tr(P, u, w);
        P[ch('body.px')] += px(u) * k * w;
        P[ch('body.py')] += -0.05 * k * sstep(0, ph.wu, u) * sstep(1, ph.fo, u) * w;
      } };
    }
    if (A_.stomp) {
      const a = A_.stomp, ph = a.phases;
      const rear = through(ph, [0, -0.25, -0.55, 0.06, 0.03, 0]);       // pitch about the hips: up (neg) then slam
      const tr = K.track(chan, ph, {
        'neck.rx': [0, -0.15, -0.3, 0.18, 0.12, 0], 'head.rx': [0, -0.1, -0.25, 0.04, 0.04, 0],
        'jaw.rx': [0, 0.2, 0.45, 0.15, 0.1, 0],
        'pelvis.rx': [0, 0.08, 0.15, -0.05, 0, 0],
        'crest': [0, 0.3, 0.5, 0.5, 0.3, 0],
        'earL.rx': [0, -0.3, -0.5, -0.8, -0.5, 0], 'earR.rx': [0, -0.3, -0.5, -0.8, -0.5, 0],
        'tail0.rx': [0, 0.3, 0.5, 0.2, 0.1, 0],
      });
      actions.stomp = { kind: 'attack', dur: a.dur, blendIn: 0.15, blendOut: 0.3, ground: true, track: (P, u, w) => {
        tr(P, u, w);
        K.pitchAbout(P, chan, rear(u) * w, HIP[0], HIP[1]);
        // fore legs leave the ground while reared (FK tuck), slam back down at the hit instant
        const air = sstep(ph.an * 0.6, ph.an, u) * sstep(ph.hit, ph.wu + 0.01, u) * w;
        P[ch('ikFL')] -= air; P[ch('ikFR')] -= air;
        for (const s of ['L', 'R']) { P[ch('hum' + s + '.rx')] -= 0.7 * air; P[ch('for' + s + '.rx')] += 1.2 * air; P[ch('mc' + s + '.rx')] += 0.9 * air; }
        // impact compression after the slam
        const imp = sstep(ph.hit - 0.01, ph.hit + 0.02, u) * sstep(ph.fo + 0.1, ph.hit + 0.03, u);
        P[ch('body.py')] -= 0.07 * k * imp * w; P[ch('chest.rx')] += 0.08 * imp * w;
      } };
    }
    if (A_.enrage) {
      const a = A_.enrage, ph = a.phases;
      const tr = K.track(chan, ph, {
        // s, an (draws back), wu (head thrown up, roar opens), hit (full roar), fo (roar fades), e
        'neck.rx': [0, 0.2, -0.55, -0.6, -0.3, 0], 'head.rx': [0, 0.1, -0.45, -0.5, -0.25, 0],
        'jaw.rx': [0, 0.05, 0.55, 0.7, 0.4, 0],
        'chest.rx': [0, 0.05, -0.08, -0.1, -0.05, 0],
        'crest': [0, 0.2, 0.5, 0.6, 0.5, 0.0],
        'earL.rx': [0, -0.3, -0.9, -0.9, -0.6, 0], 'earR.rx': [0, -0.3, -0.9, -0.9, -0.6, 0],
        'tail0.rx': [0, 0.2, 0.7, 0.8, 0.6, 0],
      });
      actions.enrage = { kind: 'action', dur: a.dur, blendIn: 0.15, blendOut: 0.35, ground: true, track: (P, u, w) => {
        tr(P, u, w);
        K.pitchAbout(P, chan, -0.12 * sstep(ph.an, ph.wu, u) * sstep(1, ph.fo, u) * w, HIP[0], HIP[1]);
        P[ch('head.ry')] += 0.18 * Math.sin(u * 40) * sstep(ph.wu, ph.hit, u) * sstep(ph.fo, ph.hit, u) * w;   // roar shudder
        // alternating fore stamps after the roar
        scrape(P, u, w, ph.fo - 0.02, ph.fo + 0.1, 'ikFL', 'L');
        scrape(P, u, w, ph.fo + 0.08, 0.98, 'ikFR', 'R');
      } };
    }
    actions.stagger = { kind: 'stagger', dur: cfg.boss ? 1.6 : 0.9, blendIn: 0.06, blendOut: 0.3, ground: true, track: (P, u, w, layer) => {
      const side = (layer.data && layer.data.side) || 1;
      const e = sstep(0, 0.12, u) * sstep(1, 0.6, u) * w, wob = Math.sin(u * (cfg.boss ? 26 : 22)) * sstep(0.1, 0.3, u) * sstep(0.9, 0.4, u);
      P[ch('body.px')] += side * 0.13 * k * e; P[ch('body.rz')] += side * 0.22 * e + 0.05 * wob * w; P[ch('body.ry')] += side * 0.15 * e;
      P[ch('body.py')] -= 0.05 * k * e; P[ch('pelvis.rx')] -= 0.12 * e;
      K.pitchAbout(P, chan, 0.08 * e, HIP[0], HIP[1]);
      P[ch('neck.rx')] += 0.3 * e; P[ch('head.ry')] += 0.3 * wob * w; P[ch('neck.ry')] -= 0.2 * wob * w; P[ch('jaw.rx')] += 0.25 * e;
      P[ch('earL.rx')] -= 0.5 * e; P[ch('earR.rx')] -= 0.5 * e;
    } };
    actions.death = { kind: 'death', dur: cfg.boss ? 2.6 : 1.8, blendIn: 0.08, hold: true, track: (P, u, w, layer) => {
      const side = (layer.data && layer.data.side) || 1;
      // fore knees buckle first (drops onto the chest), then the heavy body rolls over onto its side
      const kneel = M.ease.io(sstep(0.0, 0.28, u)), roll = M.ease.io(sstep(0.22, 0.6, u)), kick = sstep(0.55, 0.62, u) * sstep(0.85, 0.65, u);
      K.pitchAbout(P, chan, 0.22 * kneel * (1 - roll) * w, HIP[0], HIP[1]);
      P[ch('body.py')] += (-0.16 * kneel - 0.22 * roll) * k * w;
      P[ch('body.rz')] += side * 1.45 * roll * w; P[ch('body.px')] += -side * 0.12 * k * roll * w;
      P[ch('chest.rx')] += 0.1 * roll * w; P[ch('pelvis.rx')] -= 0.12 * roll * w;
      P[ch('neck.rx')] += (0.35 * kneel - 0.15 * roll) * w; P[ch('head.rx')] += 0.2 * roll * w; P[ch('jaw.rx')] += 0.25 * roll * w;
      P[ch('neck.ry')] += side * 0.2 * roll * w;
      const ikF = sstep(0.04, 0.2, u) * w, ikH = sstep(0.2, 0.4, u) * w;
      P[ch('ikFL')] -= ikF; P[ch('ikFR')] -= ikF; P[ch('ikHL')] -= ikH; P[ch('ikHR')] -= ikH;
      for (const s of ['L', 'R']) {
        const up = s === (side > 0 ? 'L' : 'R') ? 1 : 0;
        P[ch('hum' + s + '.rx')] += (-0.35 * kneel + (-0.1 - 0.3 * up) * roll - 0.15 * kick * Math.sin(u * 50)) * w;
        P[ch('for' + s + '.rx')] += (1.3 * kneel * (1 - roll) + (0.4 + 0.4 * up) * roll) * w;
        P[ch('mc' + s + '.rx')] += (0.9 * kneel * (1 - roll) + 0.5 * roll) * w;
        P[ch('th' + s + '.rx')] += ((0.2 + 0.3 * up) * roll + 0.2 * kick * Math.sin(u * 45 + 1)) * w;
        P[ch('shin' + s + '.rx')] -= (0.25 + 0.35 * up) * roll * w; P[ch('met' + s + '.rx')] += 0.3 * roll * w;
      }
      for (let i = 0; i < TAILS.length; i++) P[ch(TAILS[i] + '.ry')] += side * 0.4 * roll * w;
      P[ch('earL.rx')] -= 0.4 * roll * w; P[ch('earR.rx')] -= 0.4 * roll * w;
      P[ch('crest')] -= 0.55 * roll * w;
    } };
    actions.root = { kind: 'special', dur: 3.2, blendIn: 0.35, blendOut: 0.4, track: (P, u, w) => {
      // snout to the ground, rhythmic rooting pushes, little snorts
      const e = M.ease.io(sstep(0, 0.15, u)) * M.ease.io(sstep(1, 0.85, u)) * w;
      const push = Math.max(0, Math.sin(u * 22)) * sstep(0.15, 0.25, u) * sstep(0.85, 0.75, u);
      // shoulders drop (fore legs flex under IK) so the snout reaches the ground AHEAD of the fore hooves
      P[ch('neck.rx')] += (0.42 + 0.06 * push) * e; P[ch('head.rx')] += (0.2 + 0.12 * push) * e;
      P[ch('head.ry')] += 0.12 * Math.sin(u * 7) * e; P[ch('body.pz')] += (0.03 + 0.025 * push) * k * e;
      K.pitchAbout(P, chan, 0.14 * e, HIP[0], HIP[1]);
      P[ch('nose')] += 1.2 * Math.max(0, Math.sin(u * 60)) * e;
      P[ch('earL.rx')] += 0.2 * e; P[ch('earR.rx')] += 0.2 * e;
    } };
    actions.shake = { kind: 'special', dur: 1.4, blendIn: 0.15, blendOut: 0.3, track: (P, u, w) => {
      // dog-like shake travelling from the head back along the body
      const e = sstep(0.05, 0.2, u) * sstep(0.95, 0.7, u) * w;
      P[ch('head.rz')] += 0.35 * Math.sin(u * 48) * e; P[ch('neck.rz')] += 0.2 * Math.sin(u * 48 - 0.6) * e;
      P[ch('chest.rz')] += 0.1 * Math.sin(u * 48 - 1.2) * e; P[ch('pelvis.rz')] += 0.07 * Math.sin(u * 48 - 1.8) * e;
      P[ch('earL.rz')] += 0.6 * Math.sin(u * 48 + 1) * e; P[ch('earR.rz')] += 0.6 * Math.sin(u * 48 + 1) * e;
      P[ch('crest')] += 0.2 * e;
    } };
    if (cfg.boss) actions.snort = { kind: 'special', dur: 2.0, blendIn: 0.2, blendOut: 0.3, track: (P, u, w) => {
      // head toss + a fore hoof pawing the ground: a threat display
      const e = sstep(0, 0.15, u) * sstep(1, 0.8, u) * w;
      P[ch('neck.rx')] += (-0.25 * Math.sin(u * 9) * sstep(0.1, 0.3, u) * sstep(0.5, 0.35, u) + 0.2) * e;
      P[ch('jaw.rx')] += 0.2 * Math.max(0, Math.sin(u * 9)) * e; P[ch('crest')] += 0.3 * e;
      scrape(P, u, w, 0.45, 0.9, 'ikFR', 'R');
    } };

    const attackIds = Object.keys(A_).filter((x) => actions[x]);
    const sp = {
      rig: tpl, chan, build, lowQ: 0.48, animator: SuidAnimator, debugScale: 2.2 * k,
      anim: { legs, gaits, offsets, select, base, distal, toeExtra, post, secondary, ground, flinch, actions, gaitOpts: { restTol: 0.1 * k, idleStepDur: 0.3 * Math.sqrt(k), strainFrom: 0.45 }, groundFix: true },
      clips: ['idle', 'walk', 'run', 'charge'].concat(attackIds.filter((x) => x !== 'charge'), ['stagger', 'hit', 'death'], cfg.boss ? ['root', 'shake', 'snort'] : ['root', 'shake']),
      specials: cfg.boss ? ['root', 'shake', 'snort'] : ['root', 'shake'],
      def: D,
    };
    K.defineSpecies(cfg.id, sp);
  }
  // per-instance hash for bristle tint variation
  function hash01(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
  // the authority's enraged flag reaches the animation through the movement-mode hook
  // (the missed-lift / over-stretch gait fixes this subclass used to patch in now live in core Gait)
  class SuidAnimator extends K.QuadAnimator {
    setMode(mode, rec) { super.setMode(mode, rec); this.ctx.enraged = !!(rec && rec.enraged); }
    reset() { super.reset(); this.ctx.enraged = false; this.ctx.ew = 0; }
  }

  /* ---------------- the two species ---------------- */
  makeSuid({
    id: 'boar', k: 1, hump: 0.5, neckK: 1, headK: 1, tuskK: 1, legW: 1.12, shoulderK: 1, rumpK: 1, bristles: 16, bristleH: 0.075, maneOnly: true, flinchK: 1, breathRate: 3.2, breathAmp: 0.025,
    pal: {
      back: [0.15, 0.12, 0.097], side: [0.24, 0.196, 0.152], belly: [0.29, 0.245, 0.2], crest: [0.09, 0.075, 0.064], leg: [0.11, 0.09, 0.077],
      snout: [0.19, 0.15, 0.125], cheek: [0.34, 0.3, 0.25], disc: [0.26, 0.16, 0.15], mouth: [0.12, 0.05, 0.05], earIn: [0.26, 0.17, 0.15],
      tusk: [0.62, 0.57, 0.46], tuskBase: [0.42, 0.37, 0.3], hoof: [0.07, 0.06, 0.055], eye: [0.025, 0.02, 0.018],
      bristle: [0.07, 0.058, 0.05], bristleTip: [0.24, 0.2, 0.16],
    },
  });
  makeSuid({
    id: 'spikeback', k: 1.45, hump: 1.9, neckK: 1.12, headK: 1.06, tuskK: 1.8, legW: 1.25, shoulderK: 1.22, rumpK: 0.92, bristles: 19, bristleH: 0.24, flinchK: 0.5, boss: true, breathRate: 2.2, breathAmp: 0.035,
    pal: {
      back: [0.11, 0.106, 0.1], side: [0.175, 0.166, 0.154], belly: [0.205, 0.195, 0.182], crest: [0.06, 0.057, 0.054], leg: [0.085, 0.08, 0.075],
      snout: [0.14, 0.125, 0.115], cheek: [0.27, 0.255, 0.235], disc: [0.2, 0.14, 0.13], mouth: [0.1, 0.04, 0.04], earIn: [0.2, 0.15, 0.14],
      tusk: [0.66, 0.62, 0.52], tuskBase: [0.38, 0.34, 0.28], hoof: [0.05, 0.045, 0.042], eye: [0.02, 0.016, 0.014],
      bristle: [0.075, 0.07, 0.064], bristleTip: [0.46, 0.42, 0.35],
    },
  });
})();
