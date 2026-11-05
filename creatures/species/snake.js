/* Meadow Snake (levels 3-4): long tapering organic body (~2.6 m) with a flat belly, a distinct broad-jawed head on a
 * narrower neck, separate lower jaw for the strike gape, brow ridges (supraoculars), forked tongue.
 * Muted olive-brown with dark dorsal saddles and a postocular stripe, cream belly scutes.
 *
 * Animation model (own animator, same framework contracts as QuadAnimator):
 *   the body is a CENTRELINE sampled every 2.5 cm from the snout to the tail tip, composed from
 *     - a resting COIL (flat spiral, head resting on the coils) laid at a slowly re-orienting coil origin
 *     - a SLITHER path: the snout traces a sinusoid around the travel line and every body point follows the snout's
 *       recorded path (path-following = true lateral undulation, a wave that is stationary on the ground while the
 *       body slides through it - no sideways slipping). Starting to move re-seeds the path from the current coil,
 *       so the snake literally unwinds; stopping gathers it back into a coil, tail first
 *     - a LIFTED front section (raise / strike) integrated with exact arc length from an anchor on the ground shape
 *       using pitch / yaw profiles: threat S-posture, horizontal S-coil wind-up, explosive straightening strike
 *   then 26 spine bones (+ head, jaw, tongue) are placed on the centreline, oriented along its tangent; the skin is
 *   one continuous swept surface with envelope weights, so no segment ever shows.
 */
(function () {
  'use strict';
  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, lerp, clamp01, vnoise3, angD, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const D = CREATURE_DEFS.SPECIES.snake;

  /* ---------------- body proportions (s = arc length from the snout tip, metres) ---------------- */
  const LEN = 2.6;
  // [s, half-width, top extent, bottom extent] - flat belly (bottom < top), distinct neck behind the jaw angles
  const PROF = M.curve([
    [0.0, 0.012, 0.012, 0.012], [0.02, 0.026, 0.022, 0.02], [0.06, 0.036, 0.03, 0.02], [0.09, 0.032, 0.026, 0.02],
    [0.13, 0.022, 0.019, 0.015], [0.22, 0.027, 0.023, 0.017], [0.45, 0.036, 0.031, 0.022], [0.9, 0.043, 0.037, 0.026],
    [1.45, 0.043, 0.037, 0.026], [1.85, 0.039, 0.034, 0.024], [2.08, 0.031, 0.027, 0.019], [2.3, 0.021, 0.019, 0.013],
    [2.48, 0.011, 0.01, 0.0075], [2.6, 0.003, 0.003, 0.003],
  ]);
  const _pq = [0, 0, 0];
  const prof = (s) => PROF(s, _pq);
  const yc = (s) => PROF(s, _pq)[2];                       // centreline height when lying on the belly
  // vertical extent below the centreline for a section rolled by rho (belly-up shows the back on the ground)
  function ext(s, rho) {
    const q = PROF(s, _pq), c = Math.cos(rho), sn = Math.sin(rho);
    return Math.hypot(q[0] * sn, (c >= 0 ? q[2] : q[1]) * c);
  }

  /* ---------------- skeleton ---------------- */
  const NB = 26, SB = [];
  for (let i = 0; i < NB; i++) SB.push(0.13 + i * (2.48 - 0.13) / (NB - 1));
  const CH = SB.map((s, i) => (i === 8 ? 'body' : 'c' + i));      // 'body' = arrows stick here (world.attachPoint)
  const S_HEAD = 0.09;
  const bones = [
    ['base', null, 0, 0, 0],
    ['head', 'base', 0, yc(S_HEAD), -S_HEAD],
    ['jaw', 'head', 0, 0.012, -0.086],
    ['tongue', 'head', 0, 0.015, -0.03],
  ];
  CH.forEach((n, i) => bones.push([n, 'base', 0, yc(SB[i]), -SB[i], i < NB - 1 ? CH[i + 1] : undefined]));
  const ends = { head: [0, 0.022, 0], jaw: [0, 0.008, -0.006], tongue: [0, 0.015, 0.04], [CH[NB - 1]]: [0, 0.002, -LEN], base: [0, 0, 1] };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx;
  const chan = K.channelMap(tpl, ['raise', 'sS', 'sE', 'sP', 'jaw', 'tongue', 'limp', 'writhe', 'roll']);

  /* ---------------- palette (display-space vertex colours, calibrated like the rat) ---------------- */
  const C = {
    back: [0.155, 0.15, 0.09], side: [0.19, 0.185, 0.108], saddle: [0.085, 0.072, 0.05], spot: [0.1, 0.088, 0.058],
    belly: [0.42, 0.38, 0.27], bellyDark: [0.34, 0.3, 0.21], crown: [0.13, 0.12, 0.075], stripe: [0.07, 0.06, 0.045],
    lip: [0.44, 0.4, 0.29], mouth: [0.42, 0.27, 0.26], eye: [0.035, 0.03, 0.02], tongue: [0.16, 0.035, 0.05],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // body colour from arc length s and section angle a (0 = dorsal, +-pi = ventral): independent of pose / roll
  function scaleColor(s, a, p) {
    const dors = Math.cos(a), ven = sstep(-0.35, -0.75, dors);
    // dorsal saddles (alternating blotches, wider on the back) + small lateral spots
    const ph = s / 0.15, rag = 0.12 * (vnoise3(s * 40, a * 3, 1) - 0.5);
    const sad = sstep(0.42, 0.72, Math.sin(ph * TAU) * 0.5 + 0.5 + rag) * sstep(0.25 + rag, 0.7, dors) * sstep(0.1, 0.22, s) * sstep(2.5, 2.25, s);
    const latSpot = sstep(0.6, 0.85, Math.sin((ph + 0.5) * TAU) * 0.5 + 0.5 + rag) * gs(dors, -0.05, 0.25) * sstep(0.12, 0.25, s) * sstep(2.4, 2.1, s);
    let c = mix(C.side, C.back, sstep(0.2, 0.9, dors));
    c = mix(c, C.saddle, sad * 0.85);
    c = mix(c, C.spot, latSpot * 0.6);
    // belly: cream ventral scutes with faint banding (one scute ~ 2.2 cm), darkening toward the tail
    const band = 0.92 + 0.08 * Math.sin(s / 0.022 * TAU);
    const bel = mix(C.belly, C.bellyDark, sstep(1.6, 2.5, s));
    c = mix(c, mul(bel, band), ven);
    const k = 0.92 + 0.12 * vnoise3(p.x * 90, p.y * 90, p.z * 90);
    return mul(c, k);
  }

  /* ---------------- geometry ---------------- */
  function build(q) {
    const parts = { skin: [], gloss: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);
    /* body: one continuous swept surface from inside the head to the tail tip */
    const S0 = 0.075, pts = [];
    for (let s = S0; s <= LEN + 1e-6; s += 0.05) pts.push(V(0, yc(s), -s));
    const body = K.sweep({
      pts, up: V(0, 1, 0),
      prof: (u, o) => { const s = S0 + u * (LEN - S0), w = prof(s); o[0] = w[0]; o[1] = w[1]; o[2] = w[2]; o[3] = 2.5; o[4] = 0; o[5] = 0; return o; },
      rows: nr(130), nu: nu(16), cap0: 2, cap1: 2,
    });
    // envelope weights along the spine segments (head + 26 bones)
    const segs = [[I.head, V(0, yc(0.02), -0.02), V(0, yc(S_HEAD), -S_HEAD)]];
    for (let i = 0; i < NB; i++) segs.push([I[CH[i]], V(0, yc(SB[i]), -SB[i]), i < NB - 1 ? V(0, yc(SB[i + 1]), -SB[i + 1]) : V(0, 0.002, -LEN)]);
    K.skin(body, (p) => K.envelope(segs, p, 4));
    K.paint(body, (p, n, info) => { const s = info ? S0 + info.s * (LEN - S0) : -p.z; return scaleColor(s, info ? info.a : 0, p); });
    parts.skin.push(body);

    /* head: broad jaw angles behind the eyes, flat crown, rounded snout, supraocular ridges */
    const headSDF = K.sdf([
      { e: [0, 0.026, -0.064], r: [0.032, 0.019, 0.044] },                              // skull / crown
      { e: [0.021, 0.022, -0.074], r: [0.019, 0.017, 0.03], k: 0.018 },                  // jaw angles (wider than the neck)
      { e: [-0.021, 0.022, -0.074], r: [0.019, 0.017, 0.03], k: 0.018 },
      { c: [0, 0.025, -0.06, 0, 0.021, -0.012], ra: 0.024, rb: 0.012, sq: 0.78, k: 0.02 }, // snout (wider than tall)
      { e: [0, 0.019, -0.03], r: [0.022, 0.012, 0.03], k: 0.012 },                       // upper lip line / labials
      { e: [0.019, 0.041, -0.05], r: [0.011, 0.0055, 0.017], rot: [0, 0.25, 0], k: 0.008 }, // supraocular brow ridges
      { e: [-0.019, 0.041, -0.05], r: [0.011, 0.0055, 0.017], rot: [0, -0.25, 0], k: 0.008 },
      { e: [0.0245, 0.034, -0.047], r: [0.0085, 0.0075, 0.0085], k: 0.004, sub: true },   // eye sockets
      { e: [-0.0245, 0.034, -0.047], r: [0.0085, 0.0075, 0.0085], k: 0.004, sub: true },
      { e: [0.0075, 0.026, -0.006], r: [0.003, 0.0025, 0.004], k: 0.002, sub: true },     // nostrils
      { e: [-0.0075, 0.026, -0.006], r: [0.003, 0.0025, 0.004], k: 0.002, sub: true },
    ]);
    const head = K.projectSDF({ sdf: headSDF, curve: new T.LineCurve3(V(0, 0.025, -0.1), V(0, 0.022, -0.012)), rows: nr(30), nu: nu(28), cap0: 0.24, cap1: 0.16, rmax: 0.08 });
    K.skin(head, [[I.head, 1]]);
    K.paint(head, (p, n) => {
      const up = n.y;
      let c = mix(C.side, C.crown, sstep(0.1, 0.7, up));
      // crown pattern: a darker chevron toward the neck
      c = mix(c, C.saddle, sstep(0.4, 0.8, up) * gs(Math.abs(p.x) * 2.2 + (p.z + 0.09) * 1.2, 0.0, 0.03) * 0.8);
      // postocular stripe: eye -> jaw angle
      const sx = Math.abs(p.x), along = (-0.047 - p.z), stripe = gs(p.y - (0.033 - along * 0.28), 0, 0.0045) * sstep(-0.004, 0.006, along) * sstep(0.055, 0.04, along) * sstep(0.015, 0.025, sx);
      c = mix(c, C.stripe, stripe * 0.9);
      // cream labial scales on the lower face, mouth lining on the underside of the upper jaw
      c = mix(c, C.lip, sstep(0.024, 0.016, p.y) * sstep(-0.1, 0.25, -up + 0.3));
      c = mix(c, C.mouth, sstep(-0.55, -0.9, up) * sstep(0.013, 0.009, p.y));
      return mul(c, 0.93 + 0.1 * vnoise3(p.x * 160, p.y * 160, p.z * 160));
    });
    parts.skin.push(head);
    /* lower jaw: V-shaped mandible (cream chin, pink lining on top) */
    const jawSDF = K.sdf([
      { e: [0, 0.0105, -0.052], r: [0.026, 0.0075, 0.042] },
      { e: [0.019, 0.012, -0.08], r: [0.013, 0.008, 0.018], k: 0.012 },
      { e: [-0.019, 0.012, -0.08], r: [0.013, 0.008, 0.018], k: 0.012 },
    ]);
    const jaw = K.projectSDF({ sdf: jawSDF, curve: new T.LineCurve3(V(0, 0.011, -0.092), V(0, 0.0105, -0.016)), rows: nr(16), nu: nu(18), cap0: 0.22, cap1: 0.2, rmax: 0.05 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => mix(C.lip, C.mouth, sstep(0.2, 0.7, n.y) * sstep(0.012, 0.016, p.y)));
    parts.skin.push(jaw);
    /* eyes (round pupils, dark glossy), forked tongue */
    for (const s of [-1, 1]) {
      const eye = new T.SphereGeometry(0.0074, Math.max(8, Math.round(12 * q)), Math.max(6, Math.round(9 * q)));
      eye.translate(s * 0.0236, 0.0342, -0.0468);
      parts.gloss.push(K.prim(eye, C.eye, I.head));
    }
    const tg = [];
    const tprof = (r0, r1) => (u, o) => { const r = lerp(r0, r1, u); o[0] = r; o[1] = r * 0.55; o[2] = r * 0.55; o[3] = 2; o[4] = 0; o[5] = 0; return o; };
    tg.push(K.sweep({ pts: [V(0, 0.015, -0.045), V(0, 0.015, -0.01), V(0, 0.0152, 0.022)], prof: tprof(0.0028, 0.0018), rows: 6, nu: 6, cap0: 1, cap1: 1 }));
    for (const s of [-1, 1]) tg.push(K.sweep({ pts: [V(0, 0.0152, 0.02), V(s * 0.004, 0.0153, 0.032), V(s * 0.008, 0.0155, 0.041)], prof: tprof(0.0016, 0.0005), rows: 4, nu: 5, cap0: 1, cap1: 1 }));
    for (const g of tg) { K.skin(g, [[I.tongue, 1]]); K.paint(g, C.tongue); parts.gloss.push(g); }
    return parts;
  }

  /* ---------------- resting coil (coil-local: snout at (0, y, 0.31), coil centre (0, -0.05)) ---------------- */
  const DS = 0.025, NS = Math.round(LEN / DS) + 1;
  const COIL = (function () {
    const cp = [V(0.0, 0.072, 0.31), V(0.0, 0.094, 0.22), V(0.022, 0.08, 0.155), V(0.075, 0.034, 0.075), V(0.135, 0.02, 0.005)];
    const cx = 0, cz = -0.05, r0 = 0.16, b = 0.112 / TAU;
    for (let ph = PI / 2 + 0.2; ph < PI / 2 + 13; ph += 0.1) { const r = r0 + b * (ph - PI / 2); cp.push(V(cx + r * Math.sin(ph), 0, cz + r * Math.cos(ph))); }
    const cv = new T.CatmullRomCurve3(cp, false, 'centripetal'), n = 1600, P = [], cum = [0];
    for (let i = 0; i <= n; i++) { P.push(cv.getPoint(i / n)); if (i) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1])); }
    const x = new Float32Array(NS), y = new Float32Array(NS), z = new Float32Array(NS);
    let k = 1;
    for (let j = 0; j < NS; j++) {
      const s = j * DS;
      while (k < n && cum[k] < s) k++;
      const f = clamp01((s - cum[k - 1]) / Math.max(1e-9, cum[k] - cum[k - 1])), A = P[k - 1], B = P[k];
      x[j] = lerp(A.x, B.x, f); z[j] = lerp(A.z, B.z, f); y[j] = Math.max(yc(s), lerp(A.y, B.y, f));
    }
    return { x, y, z };
  })();

  /* ---------------- actions (additive scalar tracks keyed on the gameplay instants) ---------------- */
  const atk = D.attacks.strike, ph = atk.phases;
  const actions = {
    strike: {
      kind: 'attack', dur: atk.dur, blendIn: 0.1, blendOut: 0.3,
      track: K.track(chan, ph, {
        // s, an (S-coil gathers), wu (pulled back, cocked), hit (straightened, jaws shut), fo, e
        raise: [0.55, 0.8, 0.75, 0.15, 0.3, 0.55],
        sS: [0, 0.85, 1.0, 0.0, 0.0, 0],
        sE: [0, 0, 0, 1.0, 0.85, 0],
        sP: [0, 0.08, -0.2, 0.32, 0.2, 0],
        jaw: { k: [[0, 0], [ph.an, 0.05], [ph.wu, 0.35], [ph.hit - 0.035, 1.1], [ph.hit + 0.015, 0.08], [ph.fo, 0.2], [1, 0]] },
      }),
    },
    raise: {
      kind: 'special', dur: 2.4, blendIn: 0.3, blendOut: 0.45,
      track: K.track(chan, { s: 0, e: 1 }, { raise: { k: [[0, 0], [0.22, 1], [0.82, 1], [1, 0]] }, sP: { k: [[0, 0], [0.3, -0.12], [0.6, 0.05], [1, 0]] }, tongue: { k: [[0, 0], [0.35, 0], [0.42, 1], [0.6, 1], [0.66, 0], [1, 0]] } }, ['s', 'e']),
    },
    flick: {
      kind: 'special', dur: 1.3, blendIn: 0.2, blendOut: 0.3,
      track: K.track(chan, { s: 0, e: 1 }, { raise: { k: [[0, 0], [0.25, 0.18], [0.75, 0.18], [1, 0]] }, tongue: { k: [[0, 0], [0.18, 0], [0.26, 1], [0.48, 1], [0.54, 0], [0.62, 0], [0.68, 1], [0.82, 1], [0.88, 0], [1, 0]] } }, ['s', 'e']),
    },
    death: {
      kind: 'death', dur: 2.4, blendIn: 0.06, hold: true,
      track: K.track(chan, { s: 0, e: 1 }, {
        writhe: { k: [[0, 0], [0.06, 1], [0.45, 0.75], [0.8, 0.08], [1, 0]] },
        roll: { k: [[0, 0], [0.25, 0.5], [0.6, 1.7], [0.85, 2.1], [1, 2.15]] },
        limp: { k: [[0, 0], [0.12, 1], [1, 1]] },
        jaw: { k: [[0, 0], [0.2, 0.55], [1, 0.32]] },
        tongue: { k: [[0, 0], [0.55, 0], [0.75, 0.55], [1, 0.5]] },
      }, ['s', 'e']),
    },
  };

  /* ---------------- animator ---------------- */
  const CAP = 420;
  const _v = new T.Vector3(), _w = new T.Vector3(), _t = new T.Vector3(), _up = new T.Vector3(), _sd = new T.Vector3(), _m = new T.Matrix4(), _q = new T.Quaternion();
  const Q_BIND = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), PI);   // bind frame (side, up, back) = R_y(pi)
  const _qr = new T.Quaternion(), _ax = new T.Vector3();
  class SnakeAnimator {
    constructor(view) {
      this.v = view; this.sp = view.sp; this.tpl = view.tpl; this.B = view.bones; this.map = chan; this.ix = I;
      this.actionDefs = actions;
      const F = () => new Float32Array(NS);
      this.gx = F(); this.gy = F(); this.gz = F();        // ground shape (root-local)
      this.fx = F(); this.fy = F(); this.fz = F();        // final centreline (root-local)
      this.lx = F(); this.ly = F(); this.lz = F();        // lifted front
      this.rl = F();                                      // roll per sample
      this.gr = F();                                      // 1 = sample lies on the ground (belly flat)
      this.tx = new Float32Array(CAP); this.tz = new Float32Array(CAP); this.tn = 0; this.ti = -1;
      this.ctx = { t: Math.random() * 10, mode: null, rec: null, dt: 0 };
      this.reset();
    }
    setMode(mode, rec) { this.ctx.mode = mode; this.ctx.rec = rec || null; }
    play(name, opts) { const def = actions[name]; if (!def) return false; return this.v.sm.play(name, def, opts); }
    hit(dx, dz, pow) { this.hitT = 0; this.hitDir = [dx, dz]; this.hitPow = pow || 1; }
    reset() {
      this.v.sm.reset();
      this.init = false; this.ws = 0; this.ph = 0; this.tn = 0; this.ti = -1;
      this.hitT = 9; this.flickT = 1.5 + Math.random() * 3; this.flick = 0; this.combat = 0; this.live = 1; this.gfix = 0; this.deadT = 0;
    }
    _push(x, z) { this.ti = (this.ti + 1) % CAP; this.tx[this.ti] = x; this.tz[this.ti] = z; this.tn = Math.min(CAP, this.tn + 1); }
    // root frame helpers (world <-> root-local, yaw only)
    _toLocal(x, z, out) {
      const r = this.v.root, S = r.scale.x || 1, c = Math.cos(r.rotation.y), s = Math.sin(r.rotation.y), dx = x - r.position.x / S, dz = z - r.position.z / S;   // path space = world / scale
      out.x = dx * c - dz * s; out.z = dx * s + dz * c; return out;
    }
    _toWorld(lx, lz, out) {
      const r = this.v.root, S = r.scale.x || 1, c = Math.cos(r.rotation.y), s = Math.sin(r.rotation.y);
      out.x = r.position.x / S + lx * c + lz * s; out.z = r.position.z / S - lx * s + lz * c; return out;
    }
    // re-seed the travelled path from the current body (tail first): the snake unwinds along its own coil
    _reseed() {
      this.tn = 0; this.ti = -1;
      for (let j = NS - 1; j >= 1; j--) { this._toWorld(this.fx[j], this.fz[j], _v); this._push(_v.x, _v.z); }
      this.ph = 0;
    }
    update(dt, quality) {
      const V_ = this.v, P = V_.P, root = V_.root, ctx = this.ctx, m = this.map;
      ctx.t += dt; ctx.dt = dt;
      const sm = V_.sm, dead = sm.dead;
      if (!this.init) {
        this.init = true;
        this.co = { x: root.position.x, z: root.position.z, yaw: root.rotation.y };
        for (let j = 0; j < NS; j++) { this.fx[j] = COIL.x[j]; this.fy[j] = COIL.y[j]; this.fz[j] = COIL.z[j]; }
        this._last = { x: root.position.x, z: root.position.z };
      }
      sm.each((layer, u, w) => { if (layer.def.track) layer.def.track(P, u, w, layer, ctx, this); });
      // after death every living motion fades out within ~0.3 s; the corpse only follows its death track
      if (dead) this.deadT += dt;
      this.live = dead ? Math.max(0, 1 - this.deadT / 0.3) : 1;
      const live = this.live;
      const attacking = !!(sm.cur && sm.cur.def.kind === 'attack');
      const SC = root.scale.x || 1, v = V_.speedSm / SC, moving = !dead && !attacking && v > 0.08;   // body-size units
      const rp = root.position, yaw = root.rotation.y;
      const moved = Math.hypot(rp.x - this._last.x, rp.z - this._last.z) / SC;
      this._last.x = rp.x; this._last.z = rp.z;

      /* ---- slither path: snout weaves around the travel line, the body follows its recorded path ---- */
      if (moving && this.ws < 0.05) this._reseed();
      if (moving) this.ws = Math.min(1, this.ws + dt * 4);
      else this.ws = Math.max(0, this.ws - dt * (dead ? 0 : 0.65));
      const run = sstep(1.0, 2.2, v), lam = 0.95 + 0.3 * run, amp = (0.12 + 0.03 * run) * sstep(0.05, 0.6, v);
      if (moving || (attacking && this.ws > 0.05)) this.ph += moved / lam;
      const lat = amp * Math.sin(this.ph * TAU) * (moving ? 1 : 0.5);
      const ZS = 0.31;
      const hx = rp.x / SC + Math.sin(yaw) * ZS + Math.cos(yaw) * lat, hz = rp.z / SC + Math.cos(yaw) * ZS - Math.sin(yaw) * lat;
      if ((moving || attacking) && this.ws > 0.02) {
        if (this.tn === 0) this._push(hx, hz);
        else { const dx = hx - this.tx[this.ti], dz = hz - this.tz[this.ti]; if (dx * dx + dz * dz > 0.012 * 0.012) this._push(hx, hz); }
      }
      // coil origin: position rides with the root, orientation re-aligns slowly (the coil does not spin with the head)
      if (!dead) {
        this.co.x = rp.x; this.co.z = rp.z;
        this.co.yaw += angD(yaw, this.co.yaw) * (moving ? 1 : 1 - Math.exp(-dt * 0.9));
      }
      /* ---- ground shape: coil <-> path blend (head leads when unwinding, tail gathers first when coiling) ---- */
      const gx = this.gx, gy = this.gy, gz = this.gz;
      let ax = hx, az = hz, k = 0, acc = 0, bx = hx, bz = hz, segL = 0;
      const nextSeg = () => {
        const px = ax, pz = az; ax = bx; az = bz;
        if (k < this.tn) { const idx = (this.ti - k + CAP) % CAP; bx = this.tx[idx]; bz = this.tz[idx]; k++; }
        else {                                                            // ran out of recorded path: continue straight
          let dx = ax - px, dz = az - pz, l = Math.hypot(dx, dz);
          if (l < 1e-6) { dx = -Math.sin(yaw); dz = -Math.cos(yaw); l = 1; }
          bx = ax + dx / l * 0.1; bz = az + dz / l * 0.1;
        }
        segL = Math.hypot(bx - ax, bz - az);
      };
      if (this.ws > 0.001) nextSeg();
      const cc = Math.cos(this.co.yaw - yaw), cs = Math.sin(this.co.yaw - yaw);
      for (let j = 0; j < NS; j++) {
        const s = j * DS;
        // coil sample -> root-local (rotate by the coil's yaw offset)
        const cxl = COIL.x[j] * cc + COIL.z[j] * cs, czl = -COIL.x[j] * cs + COIL.z[j] * cc, cyl = COIL.y[j];
        const wj = clamp01(this.ws * 1.6 - 0.6 * s / LEN);
        if (wj > 0.001) {
          while (acc + segL < s) { acc += segL; nextSeg(); }
          const f = segL > 1e-6 ? (s - acc) / segL : 0;
          this._toLocal(lerp(ax, bx, f), lerp(az, bz, f), _v);
          gx[j] = lerp(cxl, _v.x, wj); gz[j] = lerp(czl, _v.z, wj); gy[j] = lerp(cyl, yc(s), wj);
        } else { gx[j] = cxl; gz[j] = czl; gy[j] = cyl; }
      }
      /* ---- lifted front: raise posture, S-coil wind-up, straightening strike ---- */
      const rec = ctx.rec;
      const wantCombat = !dead && rec && (rec.target || rec.alert > 0) ? (moving ? 0.3 : 1) : 0;
      this.combat = M.damp(this.combat, wantCombat, 3, dt);
      const limp = clamp01(P[m.limp]);
      const raise = Math.max(P[m.raise], this.combat), sS = clamp01(P[m.sS]), sE = clamp01(P[m.sE]);
      const liftW = clamp01(Math.max(raise, sS, sE)) * (1 - limp);
      const fx = this.fx, fy = this.fy, fz = this.fz;
      const A0 = 0.8 + 0.1 * clamp01(sS) + 0.3 * sE, k0 = Math.min(NS - 2, Math.round(A0 / DS));
      if (liftW > 0.001) {
        const lx = this.lx, ly = this.ly, lz = this.lz;
        lx[k0] = gx[k0]; ly[k0] = gy[k0]; lz[k0] = gz[k0];
        const thg = Math.atan2(gx[k0 - 1] - gx[k0 + 1], gz[k0 - 1] - gz[k0 + 1]), dth = angD(0, thg);
        for (let j = k0 - 1; j >= 0; j--) {
          const u = (A0 - j * DS) / A0;
          const aR = 1.0 * Math.sin(PI * Math.min(1, u / 0.78)) - 0.2 * sstep(0.76, 1, u);
          const aS = 0.3 * Math.sin(PI * u);
          const aE = 0.32 * Math.sin(PI * Math.min(1, u / 0.55)) - 0.3 * sstep(0.55, 1, u);
          const al = lerp(clamp01(raise) * aR + sS * aS, aE, sE);
          const be = thg + dth * sstep(0, 0.5, u) + (1 - sE) * sS * 1.25 * Math.sin(TAU * u) * (1 - 0.35 * u);
          const ca = Math.cos(al);
          lx[j] = lx[j + 1] + Math.sin(be) * ca * DS; ly[j] = ly[j + 1] + Math.sin(al) * DS; lz[j] = lz[j + 1] + Math.cos(be) * ca * DS;
        }
        for (let j = 0; j < NS; j++) {
          if (j >= k0) { fx[j] = gx[j]; fy[j] = gy[j]; fz[j] = gz[j]; continue; }
          const u = (A0 - j * DS) / A0, w = liftW * sstep(0, 0.12, u);
          fx[j] = lerp(gx[j], lx[j], w); fy[j] = lerp(gy[j], ly[j], w); fz[j] = lerp(gz[j], lz[j], w);
        }
      } else for (let j = 0; j < NS; j++) { fx[j] = gx[j]; fy[j] = gy[j]; fz[j] = gz[j]; }
      /* ---- additive motion: idle coil breathing sway, hit flinch, death writhe ---- */
      const t = ctx.t, writhe = P[m.writhe], rollK = P[m.roll];
      let hitK = 0;
      if (this.hitT < 0.6) { this.hitT += dt; hitK = Math.exp(-this.hitT * 7) * Math.sin(Math.min(1, this.hitT * 14) * PI * 0.5) * this.hitPow * live; }
      for (let j = 1; j < NS - 1; j++) {
        const s = j * DS;
        // perpendicular (horizontal) to the local tangent
        let tx = fx[j - 1] - fx[j + 1], tz = fz[j - 1] - fz[j + 1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = tz, nz = -tx;
        let off = 0;
        off += live * (1 - this.ws) * 0.006 * Math.sin(t * 0.9 - s * 2.2) * sstep(0.5, 1.2, s);       // the resting coil shifts a little
        if (writhe > 0.001) off += writhe * 0.075 * Math.sin(s * 9.5 - this.deadT * 15) * (0.45 + 0.55 * (1 - s / LEN));
        if (hitK > 0) {                                                    // flinch away from the blow, a wave runs down the body
          const away = -(this.hitDir[0] * nx + this.hitDir[1] * nz) >= 0 ? 1 : -1;
          off += hitK * (0.07 * away * gs(s, 0.35, 0.4) + 0.025 * Math.sin(s * 11 - this.hitT * 32) * sstep(0.2, 0.6, s));
        }
        fx[j] += nx * off; fz[j] += nz * off;
      }
      if (hitK > 0) for (let j = 0; j < Math.round(0.4 / DS); j++) fy[j] += hitK * 0.04 * (1 - j * DS / 0.4);
      // roll (death: front half turns belly-up) + ground contact for every grounded sample
      for (let j = 0; j < NS; j++) {
        const s = j * DS, rho = rollK * (1 - 0.65 * s / LEN) + (rollK > 0 ? 0.25 * Math.sin(s * 3.1) * clamp01(rollK) : 0);
        this.rl[j] = rho;
        const e = ext(s, rho);
        fy[j] = Math.max(e, fy[j] + e - yc(s));                          // rolled sections rest on their new lowest side
        this.gr[j] = 1 - sstep(0.004, 0.03, fy[j] - e);                  // lying flat -> bone frame kept horizontal
      }
      this._pose(P, dt);
    }
    // centreline sample at arc length s (linear)
    _at(s, out) {
      const f = Math.min(NS - 1.0001, Math.max(0, s / DS)), j = Math.floor(f), u = f - j;
      return out.set(lerp(this.fx[j], this.fx[j + 1], u), lerp(this.fy[j], this.fy[j + 1], u), lerp(this.fz[j], this.fz[j + 1], u));
    }
    _rollAt(s) { const f = Math.min(NS - 1.0001, Math.max(0, s / DS)), j = Math.floor(f); return lerp(this.rl[j], this.rl[j + 1], f - j); }
    // bone frame from the centreline: back = toward the tail, up = world up made orthogonal, then rolled
    _frame(bone, s, pitch) {
      this._at(Math.min(LEN, s + 0.035), _w); this._at(Math.max(0, s - 0.035), _t);
      _w.sub(_t).normalize();                                              // back
      const f = Math.min(NS - 1.0001, Math.max(0, s / DS)), jj = Math.floor(f), g = lerp(this.gr[jj], this.gr[jj + 1], f - jj);
      if (g > 0) { _w.y *= 1 - g; _w.normalize(); }                        // a belly on the ground never pitches into it
      if (pitch) { _sd.set(0, 1, 0).cross(_w).normalize(); _w.applyAxisAngle(_sd, pitch); }
      _up.set(0, 1, 0).addScaledVector(_w, -_w.y); if (_up.lengthSq() < 1e-6) _up.set(0, 0, 1); _up.normalize();
      const rho = this._rollAt(s);
      if (rho) _up.applyAxisAngle(_w, rho);
      _sd.crossVectors(_up, _w);
      _m.makeBasis(_sd, _up, _w);
      bone.quaternion.setFromRotationMatrix(_m).multiply(Q_BIND);
    }
    _pose(P, dt) {
      const B = this.B, m = this.map, t = this.ctx.t, live = this.live;
      // spine bones on the centreline (+ gentle breathing of the trunk while alive)
      const br = live * 0.022 * Math.sin(t * 2.3);
      for (let i = 0; i < NB; i++) {
        const b = B[I[CH[i]]];
        this._at(SB[i], b.position); b.position.y += this.gfix;
        this._frame(b, SB[i], 0);
        const k = 1 + br * gs(SB[i], 0.8, 0.45);
        b.scale.set(k, k, 1);
      }
      // head: its own frame from the snout-neck chord, stabilised toward the travel direction while slithering
      const hb = B[I.head];
      this._at(S_HEAD, hb.position);
      this._at(0, _v);
      _w.subVectors(hb.position, _v).normalize();
      hb.position.y += this.gfix;
      const stab = 0.55 * this.ws * (1 - clamp01(P[m.sE])) * live;
      if (stab > 0) { _t.set(0, 0, -1); _w.lerp(_t.multiplyScalar(1), stab * (1 - Math.abs(_w.y))).normalize(); }
      _sd.set(0, 1, 0).cross(_w); if (_sd.lengthSq() < 1e-8) _sd.set(1, 0, 0); _sd.normalize();
      const pitch = P[m.sP] - 0.05 * clamp01(P[m.raise]);
      _w.applyAxisAngle(_sd, -pitch);
      _up.set(0, 1, 0).addScaledVector(_w, -_w.y).normalize();
      const rho = this._rollAt(0.05);
      if (rho) _up.applyAxisAngle(_w, rho);
      _sd.crossVectors(_up, _w);
      _m.makeBasis(_sd, _up, _w);
      hb.quaternion.setFromRotationMatrix(_m).multiply(Q_BIND);
      // jaw gape
      B[I.jaw].quaternion.setFromAxisAngle(_ax.set(1, 0, 0), Math.max(0, P[m.jaw]));
      // tongue: idle flicks (alive only) + tracked flicks; retracted it sits inside the mouth
      if (live > 0.5) { this.flickT -= dt; if (this.flickT <= 0) { this.flick = 0.55; this.flickT = 2.5 + Math.random() * 4.5; } }
      this.flick = Math.max(0, this.flick - dt);
      const auto = this.flick > 0 ? sstep(0.55, 0.47, this.flick) * sstep(0, 0.08, this.flick) : 0;
      const tau = clamp01(Math.max(P[m.tongue], auto * live) * (1 - clamp01(P[m.sE]) * (1 - P[m.limp])));
      const tb = B[I.tongue];
      tb.position.copy(this.tpl.local[I.tongue]); tb.position.z -= 0.035 * (1 - tau);
      tb.scale.setScalar(Math.max(0.02, tau));
      // flicks sweep up and down ABOVE the jaw line (a head lying on the ground never pushes its tongue into it)
      tb.quaternion.setFromAxisAngle(_ax.set(1, 0, 0), (-(0.1 + 0.3 * (0.5 + 0.5 * Math.sin(t * 46))) * live + 0.12 * P[m.limp]) * tau);
      // death: rest exactly on the ground (CPU-skinned sample), never through it
      if (this.v.sm.dead) this._groundFix(dt);
    }
    _groundFix(dt) {
      const root = this.v.root; root.updateMatrixWorld(true);
      const S = K.groundSamples(this.sp), B = this.B, inv = this.tpl.inverses, n = this.tpl.n;
      const Mw = this._gm || (this._gm = new Float32Array(n * 4)), tm = _m;
      for (let i = 0; i < n; i++) { tm.multiplyMatrices(B[i].matrixWorld, inv[i]); const e = tm.elements; Mw[4 * i] = e[1]; Mw[4 * i + 1] = e[5]; Mw[4 * i + 2] = e[9]; Mw[4 * i + 3] = e[13]; }
      let mn = 1e9;
      for (let k = 0; k < S.n; k++) {
        let y = 0;
        for (let j = 0; j < 4; j++) { const w = S.w[4 * k + j]; if (w <= 0) continue; const b = 4 * S.i[4 * k + j]; y += w * (Mw[b] * S.p[3 * k] + Mw[b + 1] * S.p[3 * k + 1] + Mw[b + 2] * S.p[3 * k + 2] + Mw[b + 3]); }
        if (y < mn) mn = y;
      }
      const cur = this.v.sm.cur, u = cur ? cur.t / cur.def.dur : 1;
      let corr = 0;
      if (mn < 0) corr = -mn; else if (u > 0.5) corr = -Math.min(mn, 0.4 * dt);
      corr /= root.scale.x || 1;                                     // world metres -> bone-local units
      if (Math.abs(corr) > 1e-6) { this.gfix += corr; for (let i = 0; i < n; i++) if (this.tpl.parent[i] === I.base) B[i].position.y += corr; }
    }
  }

  K.defineSpecies('snake', {
    rig: tpl, chan, build, lowQ: 0.56, animator: SnakeAnimator, debugScale: 0.7,
    anim: { actions },
    clips: ['idle', 'walk', 'run', 'raise', 'strike', 'flick', 'hit', 'death'],
    attackAction: { strike: 'strike' }, specials: ['flick'],
    def: D,
  });
})();
