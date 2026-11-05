/* TDS MOBA - Knight (SPIKE / throwaway)
 * Procedural low-poly knight: no external assets, everything is built from primitives.
 *
 * Rig:   root > spin > body > hips > spine > chest > { head, arms, cape }       (legs hang from hips)
 *        - two-part spine (waist + chest) so the torso twists / bends in an S-curve instead of as one block
 *        - legs are solved by two-bone IK: feet are authored as *ground targets* (planted, stepping, lifting)
 *        - sword arm is solved by two-bone IK: the hand follows a path and the blade follows its own direction path
 *
 * Sword swings: a swing is a hand path + a blade-direction path (+ edge direction), each a Catmull-Rom spline through a few
 * authored keys, driven by a timing curve (windup -> accelerating strike -> follow-through -> recovery).
 * The hand leads, the blade lags and whips through at impact. Hips -> spine -> chest -> arm -> blade fire in sequence.
 * Everything lives in "character frame" (X = knight's LEFT, Y up, Z forward), hand offsets are relative to the right shoulder.
 */
(function (global) {
  'use strict';
  const T = THREE;
  const PI = Math.PI;

  /* ---------- tiny animation helpers ---------- */
  const EASE = {
    io: (u) => u * u * (3 - 2 * u),
    in: (u) => u * u * u,
    out: (u) => 1 - Math.pow(1 - u, 3),
    lin: (u) => u,
    in2: (u) => u * u,
    out2: (u) => 1 - (1 - u) * (1 - u),
  };
  // keys: [[time, value, easeIntoThisKey?], ...]
  function seq(t, keys) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t < b[0]) {
        const u = (t - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * EASE[b[2] || 'io'](u);
      }
    }
    return keys[keys.length - 1][1];
  }
  const wrapAngle = (a) => { a = (a + PI) % (2 * PI); if (a < 0) a += 2 * PI; return a - PI; };
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  const V3 = (a) => new T.Vector3(a[0], a[1], a[2]);

  // uniform Catmull-Rom through points P at parameter s (0 .. P.length-1), written into out
  function catmull(P, s, out) {
    const n = P.length;
    s = clamp(s, 0, n - 1);
    const i = Math.min(Math.floor(s), n - 2), u = s - i, u2 = u * u, u3 = u2 * u;
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, n - 1)];
    for (const c of ['x', 'y', 'z']) {
      out[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3);
    }
    return out;
  }

  /* ---------- poses ---------- */
  /* ST = the ready stance. Every other pose is "ST + something", so animations always start and end in the same place.
   * Bladed fighting stance: shield foot forward, sword foot back and turned out, knees bent, torso turned a little to the sword side,
   * head looking at the opponent, sword held low in front of the belt with the point up and forward. */
  const ST = {
    // warrior idle: wide square stance, chest out, arms hanging away from the body
    'body.px': 0, 'body.py': -0.07, 'body.pz': 0, 'body.rx': 0, 'body.rz': 0, 'spin.ry': 0,
    'hips.rx': 0, 'hips.ry': -0.08, 'hips.rz': 0,
    'spine.rx': 0.03, 'spine.ry': -0.03, 'spine.rz': 0,
    'chest.rx': -0.02, 'chest.ry': -0.03, 'chest.rz': 0,
    'head.rx': 0.02, 'head.ry': 0.12, 'head.rz': 0,
    'fL.x': 0.3, 'fL.y': 0, 'fL.z': 0.06, 'fL.r': 0.22, 'fL.p': 0,
    'fR.x': -0.3, 'fR.y': 0, 'fR.z': -0.06, 'fR.r': -0.28, 'fR.p': 0,
    'leg.w': 1,
    'thL.rx': 0, 'thL.rz': 0, 'knL.rx': 0, 'thR.rx': 0, 'thR.rz': 0, 'knR.rx': 0,
    // sword arm (IK): hand offset from the right shoulder, blade direction, edge direction
    'ikL.w': 0,
    'ik.w': 1, 'ik.hx': -0.2, 'ik.hy': -0.57, 'ik.hz': 0.12, 'ik.bx': -0.55, 'ik.by': 0.7, 'ik.bz': 0.45, 'ik.tx': 0.35, 'ik.ty': -0.25, 'ik.tz': 0.9,
    // sword arm (FK, only used when ik.w is 0)
    'shR.rx': -0.5, 'shR.rz': -0.22, 'shR.ry': -0.3, 'elR.rx': -1.0, 'wristR.rx': 0.8,
    // free (left) arm (FK): hanging relaxed, away from the body, slight elbow bend
    'shL.rx': -0.06, 'shL.rz': 0.3, 'shL.ry': 0.1, 'elL.rx': -0.35,
    'plume.rx': 0,
  };
  const withPose = (base, d) => { const o = Object.assign({}, base); for (const k in d) o[k] = (o[k] || 0) + d[k]; return o; };

  // idle-only rest offsets (ST stays the attack base): relaxed contrapposto - weight over the front (left) foot, pelvis
  // up on that side, shoulders counter-tilted, head levelled, free arm closer to the body with a softer elbow
  const IDLE_REST = { 'body.px': 0.028, 'hips.rz': 0.045, 'spine.rz': -0.012, 'chest.rz': -0.035, 'head.rz': 0.015, 'shL.rz': -0.08, 'elL.rx': -0.1 };
  function idleOsc(t) {
    const b = Math.sin(t * 2.1), sw = Math.sin(t * 0.8), sw2 = Math.sin(t * 0.5 + 1.0), sh = Math.sin(t * 1.3 + 0.5);
    return {
      'body.py': b * 0.012 + sw * 0.006, 'body.px': sw * 0.018, 'body.pz': sw2 * 0.01,
      'hips.rz': sw * 0.02, 'hips.ry': sw2 * 0.035,
      'spine.rx': b * 0.014, 'spine.ry': sw2 * 0.02,
      'chest.rx': b * 0.022, 'chest.rz': -sw * 0.016, 'chest.ry': sw2 * 0.02,
      'head.ry': Math.sin(t * 0.55) * 0.1, 'head.rx': Math.sin(t * 0.4 + 2) * 0.03 - b * 0.012, 'head.rz': sw * 0.02,
      'ik.hy': b * 0.01 + sh * 0.006, 'ik.hz': sh * 0.01, 'ik.by': sh * 0.03, 'ik.bx': sw * 0.03,
      'shL.rx': b * 0.025, 'shL.rz': sw * 0.02,
      'fL.x': sw * 0.004, 'fR.z': sw * 0.004,
      'cape.rx': b * 0.03, 'cape2.rx': Math.sin(t * 2.1 - 0.8) * 0.05, 'plume.rx': Math.sin(t * 1.7) * 0.06,
    };
  }

  /* Run cycle (human running mechanics, one cycle = two steps, phase 0 = left foot touchdown):
   *  - duty factor ~0.38: each foot is on the ground 38% of the cycle -> two short FLIGHT phases per cycle
   *  - stance: the foot lands a little ahead of the hips, then moves back at exactly the ground speed (no skating
   *    at the matching move speed); heel-strike -> flat -> roll over the ball -> toe-off
   *  - swing: heel kicks up behind toward the backside, knee drives forward, shin reaches out, the foot is pulled
   *    back just before touchdown (less braking, no "stamp")
   *  - pelvis lowest at mid-stance, highest mid-flight (smooth wave, no cusp); pelvis and shoulders counter-rotate;
   *    lateral weight shift over the stance foot; slight forward lean, head stays level and on target
   *  - arms pump against the legs: sword hand drives forward/back at the hip, shield arm opposite */
  // proportions checked against a reference sword-and-shield run (leg-length units): ~30-33% ground contact,
  // landing ~0.3 ahead of the hips, toe-off ~0.45-0.5 behind, swing heel kicks up to ~0.5 behind (knee folds to
  // ~50-65 deg: THIS is what separates a run from a stiff-legged march), knee drives through, shin reaches, pull-back.
  const RUN_DUTY = 0.33;
  const RUN_LAND = 0.3, RUN_OFF = -0.45;           // stance travel 0.75 = 3.6 m/s * 0.33 * 0.628 s (cycle at full speed)
  const RUN_SW = {                                   // swing path, u = 0..1 from toe-off to touchdown
    z: hermite([0, 0.13, 0.22, 0.36, 0.45, 0.58, 0.72, 0.85, 0.93, 1], [RUN_OFF, -0.6, -0.64, -0.52, -0.38, -0.15, 0.08, 0.33, 0.37, RUN_LAND]),
    y: hermite([0, 0.13, 0.22, 0.36, 0.45, 0.58, 0.72, 0.85, 0.93, 1], [0, 0.2, 0.34, 0.48, 0.48, 0.36, 0.27, 0.15, 0.05, 0]),
    p: hermite([0, 0.3, 0.6, 0.85, 1], [0.55, 0.95, 0.3, -0.1, -0.1]),
  };
  const RUN_ST = { p: hermite([0, 0.15, 0.55, 1], [-0.12, 0, 0, 0.55]) };   // stance: heel strike -> flat -> toe-off
  /* WALK: retargeted mocap (locomotion.js -> KNIGHT_LOCO.walk), sampled per phase into our own channels.
   * Phase 0 = left foot touchdown, same as the run, so the two gaits blend frame-aligned. */
  const LOCO = (typeof window !== 'undefined' && window.KNIGHT_LOCO) || null;
  // run: speed 3.9 m/s; the stride stays the one the run pose was built for (3.6 m/s at 10 rad/s), so a faster run
  // means a quicker cadence (10.8 rad/s), not longer steps - the planted feet stay locked to the ground
  const RUN_SPEED = 3.9, RUN_CYCLE_STRIDE = 3.6 * (2 * PI / 10);
  const WALK_SPEED = LOCO ? LOCO.walk.speed : 1.7;
  const WALK_CYCLE_STRIDE = LOCO ? LOCO.walk.speed * LOCO.walk.dur : 1.65;
  function walkPose(ph) {
    const W = LOCO.walk, n = W.frames, f = ((ph / (2 * PI)) % 1 + 1) % 1, x = f * n;
    const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, u = x - Math.floor(x);
    const o = withPose(ST, {});
    for (const k in W.ch) { const a = W.ch[k]; o[k] = a[i0] + (a[i1] - a[i0]) * u; }
    o['fL.c'] = o['fL.c'] >= 0.5 ? 1 : 0; o['fR.c'] = o['fR.c'] >= 0.5 ? 1 : 0;
    // the hand follows the mocap arm swing; the sword is held upright, leaning forward (same grip as the run)
    o['ik.bx'] = 0.08; o['ik.by'] = 0.82; o['ik.bz'] = 0.55; o['ik.tx'] = 1; o['ik.ty'] = 0; o['ik.tz'] = 0;
    o['plume.rx'] = 0.05;
    return o;
  }
  // speed-driven gait: pure walk at WALK_SPEED, pure run at RUN_SPEED, frame-aligned blend in between
  function locoPose(ph, speed) {
    const run = runPose(ph);
    if (!LOCO) return run;
    const w = clamp01((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)), k = w * w * (3 - 2 * w);
    if (k >= 0.999) return run;
    const walk = walkPose(ph);
    if (k <= 0.001) return walk;
    for (const key in run) if (key in walk) walk[key] += (run[key] - walk[key]) * k; else walk[key] = run[key];
    walk['fL.c'] = k > 0.5 ? run['fL.c'] : walk['fL.c']; walk['fR.c'] = k > 0.5 ? run['fR.c'] : walk['fR.c'];
    return walk;
  }
  function runPose(ph) {
    const o = withPose(ST, {});
    const TAU2 = 2 * PI;
    const f = ((ph / TAU2) % 1 + 1) % 1;            // cycle phase 0..1
    const foot = (k, phi, sign) => {
      let z, y, p, c;
      if (phi < RUN_DUTY) {
        const s = phi / RUN_DUTY;
        z = RUN_LAND + (RUN_OFF - RUN_LAND) * s; y = 0; p = RUN_ST.p(s); c = 1;
      } else {
        const u = (phi - RUN_DUTY) / (1 - RUN_DUTY);
        z = RUN_SW.z(u); y = RUN_SW.y(u); p = RUN_SW.p(u); c = 0;
      }
      o['f' + k + '.z'] = z;
      o['f' + k + '.y'] = y + (p > 0 ? 0.13 * Math.sin(p) : 0);   // rolling over the ball lifts the ankle
      o['f' + k + '.p'] = p; o['f' + k + '.c'] = c;
      o['f' + k + '.x'] = sign * 0.1; o['f' + k + '.r'] = sign * 0.06;
    };
    foot('L', f, 1); foot('R', (f + 0.5) % 1, -1);
    const w = TAU2 * f;
    const c1 = Math.cos(w), s1 = Math.sin(w);
    // vertical: lowest at each mid-stance (f = DUTY/2 and DUTY/2 + 0.5), highest mid-flight
    const vb = Math.cos(2 * (w - PI * RUN_DUTY));
    // lateral: weight over the stance foot (left stance around f ~ 0.19)
    const lat = Math.cos(w - PI * RUN_DUTY);
    const yawH = -0.16 * c1, yawC = 0.2 * c1;      // left leg forward at f=0 -> pelvis turns its left side forward, shoulders oppose
    Object.assign(o, {
      'body.py': -0.1 - 0.04 * vb, 'body.pz': 0.05, 'body.px': 0.025 * lat,
      'hips.rx': 0.06, 'hips.ry': -0.03 + yawH, 'hips.rz': -0.05 * lat,
      'spine.rx': 0.13 + 0.02 * vb, 'spine.ry': 0.02 + yawC * 0.45, 'spine.rz': 0.03 * lat,
      'chest.rx': 0.06 - 0.02 * vb, 'chest.ry': 0.03 + yawC * 0.55, 'chest.rz': 0.02 * lat,
      'head.rx': -0.26 - 0.01 * vb, 'head.ry': -(yawH + yawC) * 0.9, 'head.rz': -0.03 * lat,
      // sword arm pumps at the right side, OUTSIDE the body line; the blade trails back, up and out (clear of torso/legs)
      'ik.hx': -0.185 + 0.095 * c1, 'ik.hy': -0.47 - 0.02 * vb, 'ik.hz': 0.22 + 0.1 * c1,
      'ik.bx': 0.1, 'ik.by': 0.8 + 0.06 * c1, 'ik.bz': 0.52 - 0.08 * c1, 'ik.tx': 1, 'ik.ty': 0, 'ik.tz': 0,
      // free arm pumps opposite the sword arm, elbow bent, more bent on the forward swing
      'shL.rx': -0.2 + 0.45 * c1, 'shL.ry': 0.05, 'shL.rz': 0.14, 'elL.rx': -1.25 - 0.3 * Math.max(0, -c1),
      'cape.rx': 0.18 + 0.03 * vb, 'cape2.rx': 0.16 + 0.05 * Math.sin(2 * w - 1.1), 'plume.rx': 0.12 + 0.05 * Math.sin(2 * w - 0.5),
    });
    return o;
  }



  /* =====================================================================================================
   *  PROCEDURAL MELEE ANIMATION SYSTEM
   *  -----------------------------------------------------------------------------------------------------
   *  AttackProfile             data only: key poses on a NORMALIZED timeline (0..1) + phases, hit windows,
   *                            buffer / chain / move-cancel windows, footwork, root motion. `dur` just scales it.
   *  ProceduralPoseGenerator   profilePose(): monotone cubic Hermite curves through the keys (C1-smooth: no
   *                            stop-and-go at every key, never overshoots a key), evaluated per body segment with
   *                            a time LEAD/LAG -> pelvis fires first, then spine, chest, hand, blade (kinetic chain).
   *  SwordTrajectoryController hand path + blade direction + edge direction curves, solved by two-bone arm IK
   *                            with wrist limits (the sword never rotates independently of the hand).
   *  FullBodyMotionSolver      two-bone leg IK; feet authored in WORLD terms (root motion is subtracted) so planted
   *                            feet stay locked; heel raise rolls over the ball; spin pivots about the planted foot.
   *  CombatAnimationBlender    snapshot cross-fade into every action (combo hits never snap back to idle).
   *  MeleeAnimationController  Knight.attack()/update(): idle/locomotion -> attack 1..4 -> chain / move-cancel /
   *                            hit / death, input buffering, combo reset timer. LOGICAL clock (gameplay) is never
   *                            frozen; the VISUAL clock is what hit-stop slows down.
   *  MeleeHitDetector          swept blade samples (5 points, >=240 Hz) vs target capsules on the logical clock,
   *                            once per target per hit window, + pure range/arc validation (server-compatible).
   *  WeaponTrailRenderer       speed-weighted ribbon from sub-stepped blade samples (only fast motion leaves a trail).
   * ===================================================================================================== */

  // Monotone cubic Hermite (Fritsch-Butland tangents). Flat neighbours -> flat; extremes -> zero slope.
  function hermite(ts, vs) {
    const n = ts.length, m = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const h0 = ts[i] - ts[i - 1], h1 = ts[i + 1] - ts[i];
      const d0 = (vs[i] - vs[i - 1]) / h0, d1 = (vs[i + 1] - vs[i]) / h1;
      if (d0 * d1 > 0) { const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[i] = (w1 + w2) / (w1 / d0 + w2 / d1); }
    }
    return (t) => {
      if (t <= ts[0]) return vs[0];
      if (t >= ts[n - 1]) return vs[n - 1];
      let i = 0;
      while (t > ts[i + 1]) i++;
      const h = ts[i + 1] - ts[i], s = (t - ts[i]) / h, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m[i] + (3 * s2 - 2 * s3) * vs[i + 1] + (s3 - s2) * h * m[i + 1];
    };
  }
  // Cubic through every key with Catmull-Rom (finite-difference) tangents. Unlike the monotone hermite it does NOT stop at a
  // component's local extremum, so a 3D path (hand position / blade direction) keeps its speed through the keys instead of
  // ticking key to key. Holds (a component equal to a neighbour) and the end keys get a zero tangent (no overshoot there).
  function cardinal(ts, vs) {
    const n = ts.length, m = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      if (Math.abs(vs[i + 1] - vs[i]) < 1e-6 || Math.abs(vs[i] - vs[i - 1]) < 1e-6) continue;
      m[i] = (vs[i + 1] - vs[i - 1]) / (ts[i + 1] - ts[i - 1]);
    }
    return (t) => {
      if (t <= ts[0]) return vs[0];
      if (t >= ts[n - 1]) return vs[n - 1];
      let i = 0;
      while (t > ts[i + 1]) i++;
      const h = ts[i + 1] - ts[i], s = (t - ts[i]) / h, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m[i] + (3 * s2 - 2 * s3) * vs[i + 1] + (s3 - s2) * h * m[i + 1];
    };
  }
  // A track is either one value per profile key ([v0, v1, ...]) or its own [[u, v], ...] pairs.
  function track(spec, keys, label) {
    if (Array.isArray(spec[0])) {
      for (let i = 1; i < spec.length; i++) if (!(spec[i][0] > spec[i - 1][0])) throw new Error('track ' + label + ': times must increase');
      return hermite(spec.map((k) => k[0]), spec.map((k) => k[1]));
    }
    if (spec.length !== keys.length) throw new Error('track ' + label + ': ' + spec.length + ' values for ' + keys.length + ' keys');
    return hermite(keys, spec);
  }

  // Kinetic chain: how far (seconds) each segment runs AHEAD of the hand. Pelvis initiates, blade arrives last.
  const LAG_S = { pelvis: 0.03, spine: 0.018, chest: 0.008, hand: 0, blade: -0.012 };
  function lagGroupOf(ch) {
    const j = ch.slice(0, ch.indexOf('.'));
    if (j === 'hips' || j === 'body') return 'pelvis';
    if (j === 'spine') return 'spine';
    if (j === 'chest' || j === 'shL' || j === 'elL') return 'chest';
    return null;
  }

  function attackProfile(o) {
    const K = o.keys, D = o.dur;
    const lag = Object.assign({}, LAG_S, o.lag || {});
    const def = {
      attack: true, profile: true, name: o.name, dur: D, keys: K, phases: o.phases, label: o.label,
      buffer: o.buffer, chain: o.chain, move: o.move, chainSkip: o.chainSkip || 0, blendIn: o.blendIn === undefined ? 0.1 : o.blendIn,
      power: o.power, reach: o.reach, cosArc: o.cosArc, hitstop: o.hitstop, shake: o.shake, trailColor: o.trailColor,
      headTrack: o.headTrack === undefined ? 0.7 : o.headTrack, shieldHold: o.shieldHold || 0, slam: !!o.slam,
      pivot: o.pivot || null,
      // gameplay-facing times in seconds of the base timeline
      impact: o.phases.contact * D, swingAt: o.phases.antic * D,
      hitWinN: o.hit, hitWin: o.hit.map((w) => [w[0] * D, w[1] * D]),
      // visible slash windows (default = the hit windows): the crescent is drawn over these, one per hit window
      slashWin: (o.slash || o.hit).map((w) => [w[0] * D, w[1] * D]),
      trail: { t0: o.trail[0] * D, t1: o.trail[1] * D },
      fx: o.fx ? Object.assign({}, o.fx, { t0: o.fx.t0 * D, t1: o.fx.t1 * D }) : null,
      curves: [], lunge: o.lunge ? track(o.lunge, K, 'lunge') : null,
    };
    for (const ch in o.body) { const g = lagGroupOf(ch); def.curves.push({ ch, f: track(o.body[ch], K, ch), lag: (g ? lag[g] : 0) / D }); }
    for (const ch in (o.feet || {})) def.curves.push({ ch, f: track(o.feet[ch], K, ch), lag: 0 });
    // path: 'smooth' = Catmull-Rom through the hand / blade / edge keys (a flowing arc); default = monotone per component
    const interp = o.path === 'smooth' ? cardinal : hermite;
    const vec = (arr, nm) => {
      if (arr.length !== K.length) throw new Error(o.name + '.' + nm + ': ' + arr.length + ' keys, expected ' + K.length);
      return [0, 1, 2].map((c) => interp(K, arr.map((v) => v[c])));
    };
    // edge keys: [x,y,z] explicit | null = the blade's direction of travel through that key (central difference)
    //            | '<' copy previous key | '=' copy next key (holds: the edge already faces the coming cut)
    const nb = o.blade.map((b) => V3(b).normalize());
    const ed = o.edge.map((e, i) => {
      if (e !== null) return e;
      const t = nb[Math.min(i + 1, nb.length - 1)].clone().sub(nb[Math.max(i - 1, 0)]);
      return t.lengthSq() > 1e-6 ? t.normalize().toArray() : [1, 0, 0];
    });
    for (let i = 1; i < ed.length; i++) if (ed[i] === '<') ed[i] = ed[i - 1];
    for (let i = ed.length - 2; i >= 0; i--) if (ed[i] === '=') ed[i] = ed[i + 1];
    def.hand = vec(o.hand, 'hand'); def.blade = vec(o.blade, 'blade'); def.edge = vec(ed, 'edge');
    if (o.handL) {                                              // second IK arm (archer bow hand)
      def.handL = vec(o.handL, 'handL'); def.bladeL = vec(o.bladeL, 'bladeL'); def.edgeL = vec(o.edgeL, 'edgeL');
      def.handRL = hermite(K, o.handL.map((v) => Math.hypot(v[0], v[1], v[2])));
    }
    def.ranged = !!o.ranged; def.volley = o.volley || 0;
    // hand distance from the shoulder is interpolated separately from its direction, so the hand travels on a true arc
    // (component-wise interpolation cuts the chord between keys and folds the elbow mid-swing)
    def.handR = hermite(K, o.hand.map((v) => Math.hypot(v[0], v[1], v[2])));
    def.lagHand = lag.hand / D; def.lagBlade = lag.blade / D;
    return def;
  }

  // ProceduralPoseGenerator: deterministic full-body pose of a profile at time t (seconds of its base timeline).
  function profilePose(def, t) {
    const u = clamp01(t / def.dur);
    const p = withPose(ST, {});
    const C = def.curves;
    for (let i = 0; i < C.length; i++) { const c = C[i]; p[c.ch] = (p[c.ch] || 0) + c.f(clamp01(u + c.lag)); }
    // head stabilisation: eyes stay on the opponent while the torso twists and bends underneath
    const yawD = (p['hips.ry'] - ST['hips.ry']) + (p['spine.ry'] - ST['spine.ry']) + (p['chest.ry'] - ST['chest.ry']);
    const pitchD = (p['hips.rx'] - ST['hips.rx']) + (p['spine.rx'] - ST['spine.rx']) + (p['chest.rx'] - ST['chest.rx']);
    p['head.ry'] -= yawD * def.headTrack;
    p['head.rx'] -= pitchD * def.headTrack * 0.55;
    if (def.shieldHold) p['shL.ry'] -= yawD * def.shieldHold;
    // sword: the hand path leads, the blade direction trails a few ms behind and whips through
    const uh = clamp01(u + def.lagHand), ub = clamp01(u + def.lagBlade);
    p['ik.w'] = 1;
    let hx = def.hand[0](uh), hy = def.hand[1](uh), hz = def.hand[2](uh);
    const hl = Math.hypot(hx, hy, hz);
    if (hl > 1e-4) { const s = def.handR(uh) / hl; hx *= s; hy *= s; hz *= s; }
    p['ik.hx'] = hx; p['ik.hy'] = hy; p['ik.hz'] = hz;
    p['ik.bx'] = def.blade[0](ub); p['ik.by'] = def.blade[1](ub); p['ik.bz'] = def.blade[2](ub);
    p['ik.tx'] = def.edge[0](ub); p['ik.ty'] = def.edge[1](ub); p['ik.tz'] = def.edge[2](ub);
    if (def.handL) {
      let lx = def.handL[0](uh), ly = def.handL[1](uh), lz = def.handL[2](uh);
      const ll = Math.hypot(lx, ly, lz);
      if (ll > 1e-4) { const sc = def.handRL(uh) / ll; lx *= sc; ly *= sc; lz *= sc; }
      p['ikL.w'] = 1; p['ikL.hx'] = lx; p['ikL.hy'] = ly; p['ikL.hz'] = lz;
      p['ikL.bx'] = def.bladeL[0](uh); p['ikL.by'] = def.bladeL[1](uh); p['ikL.bz'] = def.bladeL[2](uh);
      p['ikL.tx'] = def.edgeL[0](uh); p['ikL.ty'] = def.edgeL[1](uh); p['ikL.tz'] = def.edgeL[2](uh);
    }
    // footwork: authored in world terms -> subtract the root-motion lunge so planted feet stay locked
    const L = def.lunge ? def.lunge(u) : 0;
    for (const k of FEET) {
      p['f' + k + '.c'] = p['f' + k + '.y'] < 0.004 ? 1 : 0;           // ground contact flag (diagnostics / footplant events)
      p['f' + k + '.z'] -= L;
      const pitch = p['f' + k + '.p'];
      if (pitch > 0) p['f' + k + '.y'] += 0.13 * Math.sin(pitch);   // heel raise rolls over the ball of the foot
    }
    if (def.pivot) { p['spin.pvx'] = p['f' + def.pivot + '.x']; p['spin.pvz'] = p['f' + def.pivot + '.z']; }
    return p;
  }
  const FEET = ['L', 'R'];

  /* ---------- legacy swing helper (still used by the Q whirlwind skill) ---------- */
  function makeSwing(o) {
    const H = o.k.map((k) => V3(k.h));
    const B = o.k.map((k) => V3(k.b).normalize());
    const E = o.k.map((k) => V3(k.e).normalize());
    const h = new T.Vector3(), b = new T.Vector3(), e = new T.Vector3();
    return {
      keys: o.k.length,
      eval(t) {
        const sh = seq(t, o.sh), sb = o.sb ? seq(t, o.sb) : sh;
        catmull(H, sh, h); catmull(B, sb, b).normalize(); catmull(E, sb, e).normalize();
        return { 'ik.w': 1, 'ik.hx': h.x, 'ik.hy': h.y, 'ik.hz': h.z, 'ik.bx': b.x, 'ik.by': b.y, 'ik.bz': b.z, 'ik.tx': e.x, 'ik.ty': e.y, 'ik.tz': e.z };
      },
    };
  }
  const GUARD = { h: [-0.2, -0.57, 0.12], b: [-0.55, 0.7, 0.45], e: [0.35, -0.25, 0.9] };   // = the idle sword hold
  const G = GUARD;

  /* =====================================================================================================
   *  THE 4-HIT COMBO  (character frame: X = knight's LEFT, Y up, Z forward; hand = offset from the right shoulder)
   *  Every attack: anticipation -> acceleration -> contact -> follow-through -> recovery.
   *  The rear foot steps up DURING the follow-through, so the chain point (end of follow-through) already has the
   *  feet back in stance: the next hit flows out of the follow-through with no idle pose and no foot sliding.
   *  body values are deltas on the stance, one per key; feet / lunge use their own [u, value] keys (world terms).
   * ===================================================================================================== */

  // SWINGS v2 (2026-11-05): the v1 crescents kept the arm locked straight and the blade continuing it from start to end, so the
  // wrist sat on its clamp for ~80 % of every cut, the windup snapped back faster than the strike and then froze, and hips /
  // chest / hand all peaked together - it read as a robot swinging a stick. Each swing now:
  //   windup  - the hand rises CHAMBERED (elbow ~75-100 deg) while the blade cocks back over the shoulder (wrist bent ~100 deg)
  //   load    - a short, still-moving coil (hips keep turning away), no frozen pose
  //   drive   - pelvis fires first, then chest, then the arm extends; the blade still trails behind the hand
  //   whip    - the wrist turns over: the blade stands up OUT of the swing plane (never folds into the forearm line)
  //   contact - the arm is straight (~98 % reach) and the blade has overtaken the hand into the target
  //   follow  - the wide crescent continues (~280-300 deg), the elbow relaxes, the blade leads
  // The visible cut (slash crescent + ribbon trail) only covers the FRONT of the swing ('slash' / 'trail' windows, as Atherion's
  // knight_slash windows); drawn round the whole ~300 deg wrap it read as a forked loop from the game camera.
  // Hand / blade keys are written as directions round the right shoulder (HP / BD below) and interpolated as one smooth arc;
  // the wrist (blade vs hand) is authored per key, so the blade gets no extra time lag.
  const DEG = PI / 180;
  // hand offset from the right shoulder: az 0 = forward, +90 = the knight's left, +-180 = behind; el + = up; r = reach (0.68 = straight)
  const HP = (az, el, r) => [r * Math.cos(el * DEG) * Math.sin(az * DEG), r * Math.sin(el * DEG), r * Math.cos(el * DEG) * Math.cos(az * DEG)];
  const BD = (az, el) => HP(az, el, 1);                       // a unit direction (blade / edge) in the same terms
  // kinetic chain of the sword swings (seconds AHEAD of the hand): the pelvis fires ~85 ms early, the chest ~40 ms
  const SWING_LAG = { pelvis: 0.085, spine: 0.06, chest: 0.04, hand: 0, blade: 0 };

  // 1) RIGHT-TO-LEFT DIAGONAL CRESCENT. The hand lifts chambered beside the right ear with the blade cocked back over the
  //    shoulder, the hips keep coiling, then fire; the arm unfolds to straight at contact in front while the wrist turns the
  //    blade over and through, and the cut keeps going round to behind the left hip; the rear foot pivots, then steps up.
  const A1 = attackProfile({
    name: 'attack1', label: 'Diagonal crescent', dur: 0.95, path: 'smooth', lag: SWING_LAG,
    //        start lift  windup load  drive whip  CONTACT cut   follow far   settle end
    keys:    [0,    0.15, 0.29,  0.37, 0.42, 0.46, 0.5,    0.56, 0.64,  0.72, 0.86,  1],
    phases: { antic: 0.37, contact: 0.5, follow: 0.72 },
    hit: [[0.41, 0.62]], slash: [[0.42, 0.58]], trail: [0.41, 0.6],
    buffer: 0.25, chain: 0.74, move: 0.76, chainSkip: 0.08, blendIn: 0.12,
    power: 1.0, reach: 3.0, cosArc: 0.1, hitstop: 0.075, shake: 0.1, trailColor: 0xbfe4ff, shieldHold: 0, headTrack: 0.6,
    hand:  [G.h, HP(-80, -15, 0.48), HP(-125, 35, 0.4), HP(-140, 32, 0.43), HP(-100, 22, 0.55), HP(-60, 10, 0.625), HP(-12, -4, 0.668), HP(48, -15, 0.645), HP(98, -26, 0.58), HP(126, -36, 0.5), HP(40, -48, 0.55), G.h],
    blade: [G.b, BD(-120, 50), BD(170, 15), BD(158, -2), BD(-165, 20), BD(-70, 72), BD(40, 12), BD(100, 12), BD(150, 12), BD(178, 14), [0.3, 0.7, 0.65], G.b],
    edge:  [G.e, '=', null, null, null, null, null, null, null, '<', [0.9, -0.2, -0.3], G.e],
    body: {
      'hips.ry':  [0, -0.3, -0.52, -0.58, -0.22, 0.04, 0.28, 0.58, 0.72, 0.8, 0.22, 0],
      'spine.ry': [0, -0.22, -0.4, -0.44, -0.16, 0.03, 0.2, 0.44, 0.56, 0.62, 0.16, 0],
      'chest.ry': [0, -0.27, -0.48, -0.54, -0.2, 0.03, 0.22, 0.55, 0.68, 0.75, 0.2, 0],
      'hips.rx':  [0, -0.02, -0.05, -0.05, 0.0, 0.04, 0.07, 0.08, 0.06, 0.05, 0.02, 0],
      'spine.rx': [0, -0.08, -0.15, -0.14, 0.04, 0.15, 0.24, 0.26, 0.2, 0.16, 0.06, 0],
      'chest.rx': [0, -0.06, -0.12, -0.11, 0.02, 0.09, 0.14, 0.16, 0.12, 0.1, 0.04, 0],
      'spine.rz': [0, 0.04, 0.07, 0.07, 0.02, -0.03, -0.07, -0.1, -0.08, -0.07, -0.02, 0],
      'chest.rz': [0, 0.08, 0.14, 0.14, 0.04, -0.06, -0.14, -0.2, -0.16, -0.14, -0.04, 0],
      'body.py':  [0, -0.03, -0.06, -0.08, -0.11, -0.14, -0.16, -0.15, -0.13, -0.12, -0.04, 0],
      'body.pz':  [0, -0.06, -0.1, -0.1, -0.02, 0.03, 0.08, 0.09, 0.07, 0.06, 0.02, 0],
      'body.px':  [0, -0.04, -0.07, -0.07, -0.02, 0.01, 0.04, 0.06, 0.06, 0.05, 0.01, 0],
      'body.rz':  [0, -0.02, -0.03, -0.03, 0.0, 0.02, 0.04, 0.04, 0.03, 0.03, 0.01, 0],
      'shL.rx':   [0, -0.6, -0.85, -0.85, -0.45, -0.25, -0.05, 0.15, 0.2, 0.18, 0.05, 0],     // free arm: reach forward, then pull back
      'shL.rz':   [0, -0.15, -0.28, -0.28, -0.1, 0.01, 0.12, 0.22, 0.25, 0.22, 0.05, 0],
      'elL.rx':   [0, -0.25, -0.3, -0.35, -0.6, -0.75, -0.9, -0.95, -0.9, -0.8, -0.25, 0],
    },
    lunge: [[0, 0], [0.27, 0], [0.5, 0.32], [1, 0.32]],
    feet: {
      'fL.z': [[0, 0], [0.25, 0], [0.46, 0.32]],
      'fL.y': [[0, 0], [0.25, 0], [0.34, 0.09], [0.46, 0]],
      'fL.p': [[0, 0], [0.24, 0.18], [0.34, 0.05], [0.43, -0.2], [0.5, 0]],
      'fR.r': [[0, 0], [0.3, 0], [0.5, 0.45], [0.6, 0.55], [0.72, 0]],
      'fR.p': [[0, 0], [0.3, 0], [0.48, 0.35], [0.6, 0.3], [0.66, 0.1], [0.72, 0]],
      'fR.z': [[0, 0], [0.6, 0], [0.72, 0.32]],
      'fR.y': [[0, 0], [0.6, 0], [0.66, 0.07], [0.72, 0]],
    },
  });

  // 2) REVERSE (RISING) CRESCENT. Out of hit 1's follow-through: the hand is chambered low behind the left hip with the blade
  //    cocked back past it, the hips coil further left, fire right; the arm unfolds to straight in front, the wrist turns the
  //    blade up and over ahead of the hand, rising round to behind the right shoulder. Pelvis leads, then settles for balance.
  const A2 = attackProfile({
    name: 'attack2', label: 'Reverse crescent', dur: 0.92, path: 'smooth', lag: SWING_LAG,
    //        start windup load  drive  fr-lf whip  CONTACT right r-back far   wrap   settle end
    keys:    [0,    0.12,  0.21, 0.29,  0.34, 0.39, 0.43,   0.5,  0.57,  0.64, 0.71,  0.86,  1],
    phases: { antic: 0.21, contact: 0.43, follow: 0.73 },
    hit: [[0.3, 0.58]], slash: [[0.33, 0.52]], trail: [0.32, 0.54],
    buffer: 0.25, chain: 0.75, move: 0.78, chainSkip: 0.1, blendIn: 0.12,
    power: 1.1, reach: 3.0, cosArc: 0.1, hitstop: 0.075, shake: 0.11, trailColor: 0xcfeaff, shieldHold: 0, headTrack: 0.6,
    hand:  [G.h, HP(138, -36, 0.46), HP(150, -38, 0.44), HP(100, -24, 0.56), HP(62, -16, 0.62), HP(28, -10, 0.65), HP(-6, -4, 0.668), HP(-62, 8, 0.64), HP(-106, 22, 0.58), HP(-130, 32, 0.52), HP(-143, 36, 0.48), HP(-70, -42, 0.56), G.h],
    blade: [G.b, BD(178, -18), BD(-168, -24), BD(150, -22), BD(110, -8), BD(40, 70), BD(-48, 6), BD(-108, 20), BD(-150, 32), BD(-172, 38), BD(175, 40), [-0.6, 0.6, 0.5], G.b],
    edge:  [G.e, '=', null, null, null, null, null, null, null, null, '<', [0.85, 0.2, -0.45], G.e],
    body: {
      'hips.ry':  [0, 0.5, 0.66, 0.42, 0.2, 0.02, -0.2, -0.48, -0.62, -0.7, -0.74, -0.25, 0],
      'spine.ry': [0, 0.38, 0.5, 0.32, 0.16, 0.0, -0.16, -0.4, -0.52, -0.57, -0.6, -0.2, 0],
      'chest.ry': [0, 0.48, 0.64, 0.42, 0.2, 0.02, -0.2, -0.52, -0.66, -0.74, -0.8, -0.25, 0],
      'hips.rx':  [0, 0.04, 0.05, 0.04, 0.04, 0.035, 0.03, 0.0, -0.02, -0.02, -0.02, 0, 0],
      'spine.rx': [0, 0.16, 0.2, 0.15, 0.11, 0.08, 0.05, -0.04, -0.08, -0.08, -0.08, 0, 0],
      'chest.rx': [0, 0.08, 0.1, 0.07, 0.05, 0.02, 0.0, -0.06, -0.1, -0.1, -0.1, -0.02, 0],
      'spine.rz': [0, -0.05, -0.06, -0.04, -0.025, 0.0, 0.02, 0.04, 0.05, 0.05, 0.05, 0.01, 0],
      'chest.rz': [0, -0.12, -0.14, -0.09, -0.05, 0.0, 0.05, 0.1, 0.12, 0.12, 0.12, 0.02, 0],
      'body.py':  [0, -0.11, -0.14, -0.14, -0.135, -0.125, -0.12, -0.08, -0.05, -0.05, -0.05, -0.02, 0],
      'body.pz':  [0, -0.03, -0.05, -0.02, 0.02, 0.05, 0.07, 0.06, 0.04, 0.03, 0.03, 0.01, 0],
      'body.px':  [0, 0.06, 0.07, 0.05, 0.03, 0.0, -0.03, -0.07, -0.07, -0.07, -0.07, -0.02, 0],
      'body.rz':  [0, 0.02, 0.03, 0.02, 0.01, -0.01, -0.02, -0.04, -0.04, -0.04, -0.04, -0.01, 0],
      'shL.rx':   [0, 0.25, 0.35, 0.25, 0.08, -0.1, -0.25, -0.5, -0.6, -0.6, -0.55, -0.15, 0],   // free arm: back, then out front for balance
      'shL.rz':   [0, 0.1, 0.15, 0.15, 0.18, 0.23, 0.28, 0.38, 0.42, 0.42, 0.4, 0.1, 0],
      'elL.rx':   [0, -0.7, -0.8, -0.75, -0.65, -0.55, -0.45, -0.3, -0.25, -0.25, -0.25, -0.1, 0],
    },
    lunge: [[0, 0], [0.21, 0], [0.41, 0.28], [1, 0.28]],
    feet: {
      'fL.z': [[0, 0], [0.19, 0], [0.38, 0.28]],
      'fL.y': [[0, 0], [0.19, 0], [0.27, 0.08], [0.38, 0]],
      'fL.p': [[0, 0], [0.18, 0.15], [0.27, 0.05], [0.36, -0.18], [0.42, 0]],
      'fR.r': [[0, 0], [0.28, 0], [0.45, -0.3], [0.6, -0.38], [0.72, 0]],
      'fR.p': [[0, 0], [0.28, 0], [0.42, 0.3], [0.6, 0.25], [0.66, 0.08], [0.72, 0]],
      'fR.z': [[0, 0], [0.6, 0], [0.72, 0.28]],
      'fR.y': [[0, 0], [0.6, 0], [0.66, 0.06], [0.72, 0]],
    },
  });

  // 3) OVERHEAD HEAVY. The hand rises chambered above the head while the blade drops down the back (deep cock), the torso
  //    arches; the front foot steps, the trunk crunches forward, the arm unfolds over the top and the wrist throws the blade
  //    up, over and down: straight arm and a level blade at contact, front knee sinks, held pause, slow recovery.
  const A3 = attackProfile({
    name: 'attack3', label: 'Overhead strike', dur: 1.05, path: 'smooth', lag: SWING_LAG,
    //        start raise  cock  drive  over  CONTACT pause recover end
    keys:    [0,    0.22,  0.38, 0.45,  0.51, 0.57,   0.7,  0.86,   1],
    phases: { antic: 0.38, contact: 0.57, follow: 0.72 },
    hit: [[0.48, 0.64]], slash: [[0.49, 0.62]], trail: [0.48, 0.66],
    buffer: 0.3, chain: 0.8, move: 0.82, chainSkip: 0.06, blendIn: 0.14,
    power: 2.0, reach: 3.0, cosArc: 0.35, hitstop: 0.12, shake: 0.22, slam: true, trailColor: 0xffe2a0, shieldHold: 0, headTrack: 0.6,
    fx: { kind: 'ring', t0: 0.57, t1: 0.82, z: 1.9, grow: 1.4 },
    hand:  [G.h, HP(-30, 40, 0.48), HP(-30, 80, 0.42), HP(-20, 66, 0.52), HP(-12, 30, 0.62), HP(-6, -26, 0.668), HP(-5, -38, 0.63), HP(-40, -56, 0.58), G.h],
    blade: [G.b, BD(180, 60), BD(178, -45), BD(178, 30), BD(178, 85), BD(0, 14), BD(2, 2), [-0.3, 0.5, 0.8], G.b],
    edge:  [G.e, [0, -0.1, 0.99], BD(180, 45), null, null, null, '<', [0.5, -0.8, 0.1], G.e],
    body: {
      'body.py':  [0, -0.08, 0.0, -0.02, -0.1, -0.26, -0.27, -0.1, 0],
      'body.pz':  [0, -0.05, -0.13, -0.06, 0.04, 0.13, 0.13, 0.04, 0],
      'hips.rx':  [0, -0.03, -0.08, -0.04, 0.03, 0.1, 0.1, 0.03, 0],
      'spine.rx': [0, -0.1, -0.3, -0.18, 0.12, 0.5, 0.5, 0.15, 0],
      'chest.rx': [0, -0.08, -0.24, -0.14, 0.06, 0.3, 0.3, 0.08, 0],
      'hips.ry':  [0, -0.06, -0.1, -0.05, 0.08, 0.18, 0.18, 0.06, 0],
      'spine.ry': [0, -0.03, -0.05, -0.02, 0.04, 0.1, 0.1, 0.03, 0],
      'chest.ry': [0, 0.0, 0.02, 0.02, 0.07, 0.12, 0.12, 0.04, 0],
      'chest.rz': [0, 0.04, 0.06, 0.05, 0.02, -0.04, -0.04, -0.01, 0],
      'shL.rx':   [0, -0.55, -0.7, -0.6, -0.35, 0.05, 0.05, 0.02, 0],                  // free arm: reach forward/out, then drive down
      'shL.rz':   [0, 0.1, 0.18, 0.16, 0.18, 0.25, 0.25, 0.08, 0],
      'elL.rx':   [0, -0.3, -0.35, -0.55, -0.85, -1.1, -1.1, -0.4, 0],
    },
    lunge: [[0, 0], [0.38, 0], [0.57, 0.45], [1, 0.45]],
    feet: {
      'fL.z': [[0, 0], [0.36, 0], [0.54, 0.45]],
      'fL.y': [[0, 0], [0.36, 0], [0.45, 0.12], [0.54, 0]],
      'fL.p': [[0, 0], [0.35, 0.2], [0.45, 0.05], [0.52, -0.2], [0.58, 0]],
      'fR.p': [[0, 0], [0.22, 0], [0.38, 0.14], [0.57, 0.38], [0.66, 0.34], [0.72, 0.1], [0.78, 0]],
      'fR.z': [[0, 0], [0.66, 0], [0.78, 0.45]],
      'fR.y': [[0, 0], [0.66, 0], [0.72, 0.07], [0.78, 0]],
    },
  });

  // 4) SPINNING FINISHER. Big coil to the right, weight onto the rear (right) foot, which pivots on its ball while the
  //    whole body turns 360 deg about it (front foot tucked) with the arm and blade held fully out; shield arm opens
  //    for balance, head spots the turn; the body brakes, the arm whips through a last wide cross cut as the front
  //    foot lands in a wide, low stance.
  const TAU = 2 * PI;
  const A4 = attackProfile({
    name: 'attack4', label: 'Spinning finisher', dur: 1.15,
    //        start  coil   coil+  turn  turn  turn-end CONTACT follow settle end
    keys:    [0,     0.2,   0.3,   0.4,  0.51, 0.62,    0.7,    0.78,  0.9,   1],
    phases: { antic: 0.3, contact: 0.7, follow: 0.8 },
    hit: [[0.34, 0.62], [0.63, 0.78]], trail: [0.32, 0.8],
    buffer: 0.4, chain: 0.88, move: 0.88, chainSkip: 0.05, blendIn: 0.14,
    power: 1.6, reach: 3.1, cosArc: -1, hitstop: 0.09, shake: 0.18, trailColor: 0xffd98a, shieldHold: 0, pivot: 'R',
    hand:  [G.h, [-0.3, -0.28, -0.04], [-0.34, -0.3, -0.1], [-0.55, -0.05, 0.3], [-0.56, -0.04, 0.3], [-0.52, -0.04, 0.34], [0.18, -0.08, 0.63], [0.52, -0.3, 0.22], [0.16, -0.48, 0.3], G.h],
    blade: [G.b, [-0.55, 0.15, -0.82], [-0.58, 0.12, -0.8], [-0.82, 0.06, 0.57], [-0.85, 0.05, 0.52], [-0.85, 0.05, 0.5], [0.4, -0.12, 0.9], [0.85, -0.35, -0.25], [0.25, 0.45, 0.85], G.b],
    edge:  [G.e, '=', [-0.82, 0, 0.55], [0.57, 0, 0.82], '<', '<', null, null, [0.95, 0, -0.3], G.e],
    body: {
      'spin.ry':  [0, 0, 0, 1.2, 4.1, TAU, TAU, TAU, TAU, TAU],
      'hips.ry':  [0, -0.3, -0.38, 0.22, 0.18, 0.1, 0.3, 0.36, 0.08, 0],
      'spine.ry': [0, -0.26, -0.32, -0.02, 0.05, 0.08, 0.28, 0.34, 0.08, 0],
      'chest.ry': [0, -0.3, -0.38, -0.2, -0.04, 0.08, 0.32, 0.44, 0.1, 0],
      'hips.rx':  [0, 0.03, 0.04, 0.02, 0.02, 0.03, 0.08, 0.08, 0.02, 0],
      'spine.rx': [0, 0.1, 0.12, 0.06, 0.06, 0.1, 0.26, 0.26, 0.08, 0],
      'chest.rx': [0, 0.05, 0.06, 0.02, 0.02, 0.04, 0.12, 0.12, 0.04, 0],
      'chest.rz': [0, 0.08, 0.1, -0.08, -0.1, -0.06, -0.16, -0.18, -0.05, 0],
      'body.py':  [0, -0.1, -0.13, -0.05, -0.04, -0.08, -0.16, -0.15, -0.06, 0],
      'body.px':  [0, -0.06, -0.08, -0.04, -0.04, -0.02, 0.04, 0.05, 0.01, 0],
      'body.pz':  [0, -0.06, -0.08, 0, 0, 0.02, 0.08, 0.08, 0.02, 0],
      'shL.rz':   [0, 0.08, 0.12, 0.5, 0.55, 0.38, 0.08, 0.02, 0, 0],
      'shL.rx':   [0, -0.1, -0.14, -0.2, -0.2, -0.16, -0.26, -0.22, -0.05, 0],
      'elL.rx':   [0, 0, 0, 0.3, 0.3, 0.2, -0.05, -0.05, 0, 0],
      'head.ry':  [0, 0.05, 0.1, 0.45, 0.35, 0.15, 0, 0, 0, 0],
    },
    lunge: [[0, 0], [0.62, 0], [0.75, 0.42], [1, 0.42]],
    feet: {
      'fL.y': [[0, 0], [0.27, 0], [0.37, 0.14], [0.58, 0.12], [0.7, 0]],
      'fL.x': [[0, 0], [0.3, 0], [0.42, -0.08], [0.58, -0.08], [0.66, 0]],
      'fL.z': [[0, 0], [0.3, 0], [0.42, -0.12], [0.58, -0.05], [0.68, 0.42]],
      'fL.p': [[0, 0], [0.28, 0.2], [0.4, 0.3], [0.6, 0.1], [0.66, -0.15], [0.72, 0]],
      'fR.p': [[0, 0], [0.26, 0], [0.34, 0.4], [0.6, 0.4], [0.68, 0.3], [0.72, 0.25], [0.8, 0]],
      'fR.z': [[0, 0], [0.72, 0], [0.85, 0.42]],
      'fR.y': [[0, 0], [0.72, 0], [0.78, 0.07], [0.85, 0]],
    },
  });

  /* ============================== ARCHER ==============================
   * SHOT: turn side-on (left shoulder to the target), reach over the right shoulder into the quiver, draw an arrow,
   * bring it forward and nock it as the bow arm rises and locks out at the target, draw the string to the jaw with the
   * elbow high and behind, hold, RELEASE (contact), the draw hand flies back past the ear, bow arm recoils, lower.
   * Right hand = draw hand (ik.*), left hand = bow hand (ikL.*); 'bow.hold' / 'bow.arrow' drive the bow simulation. */
  // eL = bow edge while the bow is up (string to the archer); eLI = standing carry (bow hanging, string to the back)
  const GA = { h: [-0.14, -0.6, 0.06], b: [0, -0.1, 1], e: [1, 0, 0], hL: [0.1, -0.56, 0.14], bL: [0.06, -0.95, 0.3], eL: [-1, 0, 0], eLI: [0.96, 0, -0.28] };
  const SHOT_SPEC = {
    name: 'shot', label: 'Arrow shot', dur: 1.0,
    //        start reach grab  nock  draw  RELEASE follow lower end
    keys:    [0,    0.14,  0.24, 0.36, 0.52, 0.6,    0.66,  0.82,  1],
    phases: { antic: 0.36, contact: 0.6, follow: 0.68 },
    hit: [], trail: [2, 2], ranged: true,
    buffer: 0.4, chain: 0.66, move: 0.72, chainSkip: 0.1, blendIn: 0.1,
    power: 1.0, reach: 18, cosArc: 0.5, hitstop: 0.05, shake: 0.05, headTrack: 1.0, shieldHold: 0, trailColor: 0xcfeaff,
    hand:  [GA.h, [-0.02, 0.28, -0.1], [0.02, 0.36, -0.22], [0.22, 0.04, 0.56], [0.0, 0.22, 0.24], [0.0, 0.22, 0.235], [-0.07, 0.23, 0.1], [-0.08, -0.3, 0.1], GA.h],
    blade: [GA.b, [0, 1, 0.2], [0, 1, -0.2], [0, 0.2, 1], [0, 0.05, 1], [0, 0.05, 1], [0, 0.3, 1], [0, 0.4, 0.9], GA.b],
    edge:  [GA.e, GA.e, GA.e, GA.e, GA.e, GA.e, GA.e, GA.e, GA.e],
    handL: [GA.hL, [0.1, -0.45, 0.25], [0.02, -0.14, 0.36], [0.0, -0.06, 0.34], [-0.05, 0.03, 0.63], [-0.05, 0.03, 0.63], [-0.05, 0.0, 0.63], [0.05, -0.35, 0.4], GA.hL],
    bladeL: [GA.bL, [0.05, 0.95, 0.3], [0, 0.98, 0.15], [-0.1, 0.99, 0.02], [-0.12, 0.99, 0], [-0.12, 0.99, 0], [-0.05, 0.95, 0.3], [0.05, 0.9, 0.4], GA.bL],
    edgeL: [GA.eLI, GA.eL, GA.eL, GA.eL, GA.eL, GA.eL, GA.eL, GA.eL, GA.eLI],
    body: {
      'hips.ry':  [0, -0.3, -0.5, -0.65, -0.7, -0.7, -0.68, -0.4, 0],
      'spine.ry': [0, -0.1, -0.2, -0.25, -0.3, -0.3, -0.28, -0.15, 0],
      'chest.ry': [0, -0.05, -0.1, -0.2, -0.22, -0.22, -0.2, -0.1, 0],
      'spine.rx': [0, 0.04, 0.06, 0.02, 0.0, 0.0, 0.02, 0.03, 0],
      'chest.rz': [0, 0.03, 0.05, 0.04, 0.05, 0.05, 0.04, 0.02, 0],
      'body.py':  [0, -0.03, -0.04, -0.05, -0.06, -0.06, -0.05, -0.03, 0],
      // draw-arm elbow pole (character frame): down at rest, up and back while reaching / at full draw
      'ik.px': [-0.6, -0.6, -0.4, -0.6, -0.8, -0.8, -0.8, -0.6, -0.6],
      'ik.py': [-1, 0.2, 0.4, -0.5, -0.5, -0.5, -0.45, -0.8, -1],
      'ik.pz': [-0.3, -0.6, -0.8, -0.6, -0.6, -0.6, -0.6, -0.6, -0.3],
      // bow simulation: string held by the draw hand / arrow state (0 none, 1 in hand, 2 nocked)
      'bow.hold':  [[0, 0], [0.33, 0], [0.36, 1], [0.6, 1], [0.605, 0], [1, 0]],
      'bow.arrow': [[0, 0], [0.2, 0], [0.22, 1], [0.34, 1], [0.36, 2], [0.6, 2], [0.605, 0], [1, 0]],
      'bow.lay':   [[0, 0], [0.25, 0], [0.34, 1], [1, 1]],
    },
    feet: {
      // rear (right) foot steps back and turns out, front foot pivots on its ball: a side-on shooting stance
      'fR.z': [[0, 0], [0.05, 0], [0.2, -0.12], [0.86, -0.12], [0.98, 0]],
      'fR.x': [[0, 0], [0.05, 0], [0.2, -0.06], [0.86, -0.06], [0.98, 0]],
      'fR.y': [[0, 0], [0.05, 0], [0.12, 0.06], [0.2, 0], [0.86, 0], [0.92, 0.05], [0.98, 0]],
      'fR.r': [[0, 0], [0.05, 0], [0.2, -0.7], [0.86, -0.7], [0.98, 0]],
      'fL.r': [[0, 0], [0.08, 0], [0.22, -0.45], [0.84, -0.45], [0.97, 0]],
      'fL.p': [[0, 0], [0.08, 0], [0.15, 0.25], [0.22, 0], [0.84, 0], [0.9, 0.25], [0.97, 0]],
    },
  };
  const SHOT = attackProfile(SHOT_SPEC);
  // VOLLEY (Q): the same shot, three arrows in a fan on release (a skill: not part of the click chain)
  const VOLLEY = Object.assign({}, SHOT, { name: 'volley', label: 'Volley', volley: 3, attack: false, power: 0.8 });

  /* ============================== MAGE ==============================
   * Staff in the right hand (IK, staff-local +Y = orb end), free left hand (FK) shapes the spells.
   * MG: standing hold - forearm forward at the belt, staff upright beside the right foot, orb above the head.
   * CAST (left click, fireball): the free hand reaches out to aim while the staff coils back over the shoulder and the
   * orb charges (motes spiral in), then the hips/chest uncoil and the staff THRUSTS the orb at the target (release),
   * small recoil, settle. 'orb.glow' drives the orb (0 idle .. 1 full charge).
   * METEOR (Q): sink, raise the staff high over the head with the free arm (calling it down), then drive the orb down
   * at the target circle (release = the meteor is summoned), hold, recover. */
  const MG = { h: [-0.13, -0.4, 0.3], b: [0.02, 1, 0.08], e: [1, 0, 0] };
  const MGE = (n) => Array.from({ length: n }, () => MG.e);
  const CAST = attackProfile({
    name: 'cast', label: 'Fireball', dur: 0.95,
    //        start  reach  coil   charge RELEASE recoil settle end
    keys:    [0,     0.16,  0.3,   0.44,  0.52,   0.62,  0.8,   1],
    phases: { antic: 0.44, contact: 0.52, follow: 0.62 },
    hit: [], trail: [2, 2], ranged: true,
    buffer: 0.4, chain: 0.7, move: 0.74, chainSkip: 0.08, blendIn: 0.1,
    power: 1.0, reach: 20, cosArc: 0.5, hitstop: 0.04, shake: 0.05, headTrack: 1.0, shieldHold: 0, trailColor: 0xffa040,
    // STAFF STAYS UPRIGHT ON THE RIGHT SIDE (2026-11-05): the old cast laid the staff flat like a lance and swung it across the
    // chest (coil: orb over the shoulder, foot across the body; release: horizontal) - it read as a crossed bar. Now the staff
    // only tilts: ~16 deg back while the orb charges, ~30 deg forward on the release, hand outside the hip, never across the body.
    hand:  [MG.h, [-0.17, -0.36, 0.24], [-0.24, -0.23, 0.05], [-0.24, -0.2, 0.04], [-0.13, -0.14, 0.46], [-0.12, -0.17, 0.42], [-0.13, -0.32, 0.34], MG.h],
    blade: [MG.b, [-0.03, 0.99, 0.0], [-0.05, 0.96, -0.26], [-0.05, 0.95, -0.3], [-0.05, 0.86, 0.5], [-0.05, 0.9, 0.43], [-0.02, 0.98, 0.2], MG.b],
    edge:  MGE(8),
    body: {
      'hips.ry':  [0, -0.08, -0.26, -0.3, 0.12, 0.14, 0.05, 0],
      'spine.ry': [0, -0.05, -0.16, -0.2, 0.1, 0.1, 0.03, 0],
      'chest.ry': [0, -0.05, -0.2, -0.24, 0.14, 0.12, 0.04, 0],
      'spine.rx': [0, 0.02, -0.05, -0.07, 0.1, 0.08, 0.03, 0],
      'body.py':  [0, -0.02, -0.05, -0.06, -0.08, -0.07, -0.03, 0],
      // free hand: reaches forward to aim, then sweeps back and out as the staff drives through
      'shL.rx':   [0, -0.55, -1.15, -1.25, -0.35, -0.25, -0.1, 0],
      'shL.rz':   [0, 0.05, 0.0, 0.0, 0.25, 0.3, 0.1, 0],
      'shL.ry':   [0, -0.15, -0.3, -0.32, 0.1, 0.1, 0.0, 0],
      'elL.rx':   [0, -0.4, 0.2, 0.25, -0.5, -0.55, -0.3, 0],
      'orb.glow': [0, 0.15, 0.55, 1, 1, 0.45, 0.12, 0],
    },
    feet: {
      // weight shift: the front (left) foot slides a little forward into the thrust and back afterwards
      'fL.z': [[0, 0], [0.36, 0], [0.5, 0.12], [0.8, 0.12], [0.96, 0]],
      'fL.y': [[0, 0], [0.36, 0], [0.43, 0.05], [0.5, 0], [0.8, 0], [0.88, 0.04], [0.96, 0]],
    },
  });
  CAST.spell = 'fireball';
  const METEOR = attackProfile({
    name: 'meteor', label: 'Meteor', dur: 1.5,
    //        start  sink   raise  peak   SLAM   hold   recover end
    keys:    [0,     0.14,  0.32,  0.46,  0.56,  0.7,   0.86,   1],
    phases: { antic: 0.46, contact: 0.56, follow: 0.7 },
    hit: [], trail: [2, 2], ranged: true,
    buffer: 2, chain: 2, move: 2, chainSkip: 0, blendIn: 0.12,
    power: 1.6, reach: 20, cosArc: 0.5, hitstop: 0.05, shake: 0.08, headTrack: 0.35, shieldHold: 0, trailColor: 0xffa040,
    // staff raised high and upright, then driven forward to ~50 deg (orb towards the sky above the target) - never flat
    hand:  [MG.h, [-0.16, -0.46, 0.24], [-0.1, 0.3, 0.16], [-0.06, 0.56, 0.08], [-0.14, 0.02, 0.52], [-0.14, -0.02, 0.5], [-0.13, -0.3, 0.4], MG.h],
    blade: [MG.b, [-0.02, 1, 0.15], [-0.03, 1, 0.08], [-0.03, 0.98, -0.15], [0, 0.62, 0.78], [0, 0.66, 0.75], [-0.02, 0.9, 0.42], MG.b],
    edge:  MGE(8),
    body: {
      'body.py':  [0, -0.09, 0.0, 0.02, -0.11, -0.1, -0.04, 0],
      'spine.rx': [0, 0.12, -0.12, -0.16, 0.2, 0.18, 0.06, 0],
      'chest.rx': [0, 0.06, -0.1, -0.14, 0.12, 0.1, 0.03, 0],
      'head.rx':  [0, 0.04, -0.3, -0.4, 0.18, 0.14, 0.04, 0],
      'hips.ry':  [0, -0.05, -0.1, -0.12, 0.06, 0.06, 0.02, 0],
      'shL.rx':   [0, -0.3, -2.3, -2.75, -1.2, -1.1, -0.4, 0],    // free arm rises with the staff, then flings forward
      'shL.rz':   [0, 0.1, 0.25, 0.3, 0.12, 0.12, 0.05, 0],
      'elL.rx':   [0, -0.6, -0.3, -0.15, -0.15, -0.2, -0.3, 0],
      'orb.glow': [0, 0.25, 0.65, 1, 1, 0.55, 0.15, 0],
    },
    feet: {
      // widen the base before the overhead call, front foot plants forward on the slam
      'fL.z': [[0, 0], [0.12, 0], [0.26, 0.1], [0.84, 0.1], [0.98, 0]],
      'fL.x': [[0, 0], [0.12, 0], [0.26, 0.05], [0.84, 0.05], [0.98, 0]],
      'fL.y': [[0, 0], [0.12, 0], [0.19, 0.06], [0.26, 0], [0.84, 0], [0.91, 0.05], [0.98, 0]],
      'fR.z': [[0, 0], [0.16, 0], [0.3, -0.06], [0.84, -0.06], [0.98, 0]],
    },
  });
  Object.assign(METEOR, { spell: 'meteor', attack: false });

  /* ============================== SKILL MOVES ==============================
   * Extra profiles used by the skill bar (the HUD picks profile + play rate per skill). */

  // ARCHER - SKYSHOT: the shot pitched ~43 deg up (arrow rain): every arm target / weapon direction from the nock on is
  // rotated up about the shoulders, the torso leans back and the head looks up the arrow.
  const pitchKeys = (arr, w, ang) => arr.map((v, i) => {
    const a = ang * w[i], c = Math.cos(a), sn = Math.sin(a);
    return [v[0], v[1] * c + v[2] * sn, v[2] * c - v[1] * sn];
  });
  const SKY_W = [0, 0, 0.35, 1, 1, 1, 1, 0.5, 0], SKY_A = 0.75;
  const SKYSHOT = attackProfile(Object.assign({}, SHOT_SPEC, {
    name: 'skyshot', label: 'Sky shot', headTrack: 0.25,
    hand: pitchKeys(SHOT_SPEC.hand, SKY_W, SKY_A), blade: pitchKeys(SHOT_SPEC.blade, SKY_W, SKY_A),
    handL: pitchKeys(SHOT_SPEC.handL, SKY_W, SKY_A), bladeL: pitchKeys(SHOT_SPEC.bladeL, SKY_W, SKY_A),
    body: Object.assign({}, SHOT_SPEC.body, {
      'spine.rx': SHOT_SPEC.body['spine.rx'].map((v, i) => v - 0.2 * SKY_W[i]),
      'chest.rx': SKY_W.map((w) => -0.14 * w),
      'head.rx':  SKY_W.map((w) => -0.45 * w),
    }),
  }));
  SKYSHOT.attack = false;

  // ARCHER - HOP: disengage. Crouch, spring BACKWARDS ~3.2 m (both feet off the ground, bow kept up, free arm out for
  // balance), land on the balls of the feet and settle. Root motion = negative lunge; the feet travel with it.
  const HOP = attackProfile({
    name: 'hop', label: 'Back hop', dur: 0.78,
    //        start crouch  air   land  end
    keys:    [0,    0.14,   0.34, 0.56, 1],
    phases: { antic: 0.14, contact: 0.34, follow: 0.56 },
    hit: [], trail: [2, 2],
    buffer: 2, chain: 2, move: 0.7, chainSkip: 0, blendIn: 0.06,
    power: 0, reach: 0, cosArc: 1, hitstop: 0, shake: 0, headTrack: 0.8, shieldHold: 0,
    hand:  [GA.h, [-0.28, -0.4, 0.12], [-0.5, -0.05, 0.12], [-0.32, -0.4, 0.16], GA.h],
    blade: [GA.b, [0, -0.2, 1], [0.2, 0.3, 0.93], [0, -0.1, 1], GA.b],
    edge:  [GA.e, GA.e, GA.e, GA.e, GA.e],
    body: {
      'body.py':  [[0, 0], [0.14, -0.16], [0.36, 0.32], [0.56, -0.2], [0.72, -0.1], [1, 0]],
      'spine.rx': [0, 0.18, -0.12, 0.2, 0],
      'chest.rx': [0, 0.06, -0.08, 0.1, 0],
      'shL.rx':   [0, -0.3, -0.6, -0.4, 0],
    },
    lunge: [[0, 0], [0.15, 0], [0.56, -3.2], [1, -3.2]],
    feet: {
      'fL.z': [[0, 0], [0.13, 0], [0.56, -3.15], [1, -3.2]],
      'fL.y': [[0, 0], [0.13, 0], [0.3, 0.32], [0.5, 0.06], [0.56, 0]],
      'fR.z': [[0, 0], [0.16, 0], [0.58, -3.32], [0.82, -3.32], [0.96, -3.2]],
      'fR.y': [[0, 0], [0.16, 0], [0.32, 0.3], [0.52, 0.06], [0.58, 0], [0.82, 0], [0.89, 0.05], [0.96, 0]],
      'fL.p': [[0, 0], [0.1, 0.2], [0.16, 0], [0.52, 0], [0.56, 0.25], [0.66, 0]],
    },
  });
  HOP.attack = false;

  // ARCHER - FOCUS (Eagle eye buff): bow lifted upright before the face, draw hand resting on the string, head bowed,
  // a breath, then the bow comes back down.
  const ABUFF = attackProfile({
    name: 'abuff', label: 'Focus', dur: 0.95,
    keys:    [0, 0.26, 0.48, 0.72, 1],
    phases: { antic: 0.3, contact: 0.48, follow: 0.6 },
    hit: [], trail: [2, 2],
    buffer: 2, chain: 2, move: 0.8, chainSkip: 0, blendIn: 0.1,
    power: 0, reach: 0, cosArc: 1, hitstop: 0, shake: 0, headTrack: 0.2, shieldHold: 0,
    hand:  [GA.h, [0.12, 0.0, 0.3], [0.13, 0.04, 0.3], [0.1, -0.05, 0.28], GA.h],
    blade: [GA.b, [0, 0.4, 0.92], [0, 0.4, 0.92], [0, 0.3, 0.95], GA.b],
    edge:  [GA.e, GA.e, GA.e, GA.e, GA.e],
    handL: [GA.hL, [-0.02, -0.02, 0.42], [-0.03, 0.04, 0.42], [0.0, -0.06, 0.4], GA.hL],
    bladeL: [GA.bL, [0, 1, 0.08], [0, 1, 0.04], [0, 1, 0.1], GA.bL],
    edgeL: [GA.eLI, GA.eL, GA.eL, GA.eL, GA.eLI],
    body: {
      'head.rx':  [0, 0.22, 0.28, 0.1, 0],
      'spine.rx': [0, 0.04, 0.06, 0.02, 0],
      'body.py':  [0, -0.03, -0.04, -0.02, 0],
      'bow.hold': [0, 0, 0, 0, 0], 'bow.arrow': [0, 0, 0, 0, 0],
    },
  });
  ABUFF.attack = false;

  // WARRIOR - DASH: crouch with the sword drawn back low, explode forward ~4 m low over the ground (both feet off),
  // the sword driving out in a straight thrust, front foot lands in a deep lunge, hold, recover.
  const DASH = attackProfile({
    name: 'dash', label: 'Dash strike', dur: 0.9,
    //        start crouch launch land  hold  recover end
    keys:    [0,    0.16,  0.3,   0.44, 0.58, 0.78,   1],
    phases: { antic: 0.18, contact: 0.42, follow: 0.58 },
    hit: [[0.26, 0.5]], trail: [0.24, 0.52],
    buffer: 2, chain: 2, move: 0.74, chainSkip: 0, blendIn: 0.08,
    power: 1.6, reach: 2.6, cosArc: 0.6, hitstop: 0.09, shake: 0.14, trailColor: 0xcfe6ff, shieldHold: 0, headTrack: 0.8,
    hand:  [G.h, [-0.3, -0.42, -0.22], [-0.12, -0.12, 0.55], [-0.04, -0.06, 0.66], [-0.04, -0.07, 0.65], [-0.14, -0.4, 0.3], G.h],
    blade: [G.b, [-0.2, 0.12, -0.97], [-0.05, 0.02, 1], [0, 0.0, 1], [0, 0.02, 1], [-0.3, 0.6, 0.74], G.b],
    edge:  [G.e, [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], '<', G.e],
    body: {
      'body.py':  [[0, 0], [0.16, -0.2], [0.3, -0.04], [0.44, -0.26], [0.6, -0.24], [0.8, -0.08], [1, 0]],
      'spine.rx': [0, 0.28, 0.36, 0.3, 0.26, 0.08, 0],
      'chest.rx': [0, 0.08, 0.1, 0.08, 0.06, 0.02, 0],
      'hips.ry':  [0, -0.3, 0.1, 0.18, 0.18, 0.06, 0],
      'chest.ry': [0, -0.25, 0.12, 0.15, 0.15, 0.05, 0],
      'shL.rx':   [0, 0.4, 0.55, 0.5, 0.45, 0.1, 0],
      'shL.rz':   [0, 0.2, 0.35, 0.35, 0.3, 0.1, 0],
      'elL.rx':   [0, -0.6, -0.3, -0.3, -0.35, -0.2, 0],
    },
    lunge: [[0, 0], [0.17, 0], [0.43, 4.0], [1, 4.0]],
    feet: {
      'fL.z': [[0, 0], [0.16, 0], [0.43, 4.45], [0.78, 4.45], [0.94, 4.0]],
      'fL.y': [[0, 0], [0.16, 0], [0.26, 0.22], [0.4, 0.05], [0.43, 0], [0.78, 0], [0.86, 0.06], [0.94, 0]],
      'fR.z': [[0, 0], [0.18, 0], [0.47, 3.75], [1, 3.75]],
      'fR.y': [[0, 0], [0.18, 0], [0.3, 0.26], [0.44, 0.06], [0.47, 0]],
      'fR.p': [[0, 0], [0.47, 0], [0.52, 0.35], [0.78, 0.3], [0.9, 0]],
    },
  });

  // WARRIOR - LEAP SLAM: the overhead strike, but airborne. Deep crouch, jump ~1 m up and 3.5 m forward with the arm
  // straight up and the blade cocked behind the head, come down driving the blade into the ground on landing.
  const LEAP = attackProfile({
    name: 'leap', label: 'Leap slam', dur: 1.3,
    //        start crouch apex  over  front CONTACT pause recover end
    keys:    [0,    0.18,  0.36, 0.46, 0.52, 0.57,   0.7,  0.86,   1],
    phases: { antic: 0.4, contact: 0.57, follow: 0.72 },
    hit: [[0.5, 0.64]], trail: [0.44, 0.66],
    buffer: 2, chain: 2, move: 0.84, chainSkip: 0, blendIn: 0.1,
    power: 2.2, reach: 3.2, cosArc: 0.2, hitstop: 0.12, shake: 0.3, slam: true, trailColor: 0xffe2a0, shieldHold: 0, headTrack: 0.6,
    fx: { kind: 'ring', t0: 0.57, t1: 0.85, z: 1.9, grow: 2.2 },
    hand:  [G.h, [-0.2, -0.45, 0.05], [-0.1, 0.62, -0.14], [-0.06, 0.6, 0.25], [0.06, 0.14, 0.63], [0.14, -0.43, 0.46], [0.14, -0.46, 0.44], [0.06, -0.48, 0.36], G.h],
    blade: [G.b, [-0.3, 0.3, -0.9], [-0.25, -0.3, -0.92], [-0.3, 0.85, 0.42], [-0.05, 0.3, 0.95], [0.25, -0.55, 0.8], [0.27, -0.6, 0.75], [0.0, 0.15, 0.99], G.b],
    edge:  [G.e, [0, 0.9, -0.3], [0, 0.94, -0.35], null, null, null, '<', [0.5, -0.8, 0.1], G.e],
    body: {
      'body.py':  [[0, 0], [0.18, -0.24], [0.24, 0.05], [0.38, 0.95], [0.5, 0.35], [0.57, -0.28], [0.7, -0.28], [0.86, -0.1], [1, 0]],
      'spine.rx': [0, 0.3, -0.32, -0.12, 0.2, 0.5, 0.5, 0.15, 0],
      'chest.rx': [0, 0.1, -0.26, -0.1, 0.1, 0.3, 0.3, 0.08, 0],
      'hips.ry':  [0, -0.06, -0.08, 0.0, 0.1, 0.18, 0.18, 0.06, 0],
      'chest.ry': [0, 0.0, 0.02, 0.03, 0.08, 0.12, 0.12, 0.04, 0],
      'shL.rx':   [0, 0.3, -0.7, -0.55, -0.3, 0.05, 0.05, 0.02, 0],
      'shL.rz':   [0, 0.2, 0.35, 0.3, 0.2, 0.25, 0.25, 0.08, 0],
      'elL.rx':   [0, -0.5, -0.35, -0.6, -0.9, -1.1, -1.1, -0.4, 0],
    },
    lunge: [[0, 0], [0.2, 0], [0.56, 3.5], [1, 3.5]],
    feet: {
      // both feet leave the ground (tucked under the body), land a step apart, rear foot comes up into stance
      'fL.z': [[0, 0], [0.2, 0], [0.56, 3.9], [0.84, 3.9], [0.97, 3.5]],
      'fL.y': [[0, 0], [0.2, 0], [0.3, 0.55], [0.4, 0.95], [0.5, 0.35], [0.56, 0]],
      'fR.z': [[0, 0], [0.22, 0], [0.58, 3.2], [0.84, 3.2], [0.97, 3.5]],
      'fR.y': [[0, 0], [0.22, 0], [0.32, 0.6], [0.42, 0.95], [0.52, 0.3], [0.58, 0]],
      'fR.p': [[0, 0], [0.58, 0], [0.62, 0.35], [0.82, 0.3], [0.9, 0]],
    },
  });

  // WARRIOR - WAR CRY (and Iron body): gather low, then burst up - chest thrown out, arms flung wide and up (sword
  // raised out to the side), head back in a roar, front foot stamps; hold; settle.
  const WCRY = attackProfile({
    name: 'wcry', label: 'War cry', dur: 1.1,
    keys:    [0, 0.2, 0.38, 0.55, 0.78, 1],
    phases: { antic: 0.3, contact: 0.38, follow: 0.6 },
    hit: [], trail: [2, 2],
    buffer: 2, chain: 2, move: 0.8, chainSkip: 0, blendIn: 0.1,
    power: 0, reach: 0, cosArc: 1, hitstop: 0, shake: 0.12, shieldHold: 0, headTrack: 0, trailColor: 0xff8a6a,
    hand:  [G.h, [-0.22, -0.5, 0.12], [-0.55, 0.22, 0.05], [-0.55, 0.24, 0.05], [-0.42, -0.1, 0.12], G.h],
    blade: [G.b, [-0.3, 0.2, 0.93], [-0.55, 0.8, 0.2], [-0.55, 0.8, 0.2], [-0.5, 0.75, 0.42], G.b],
    edge:  [G.e, G.e, [0.15, 0.1, 0.98], [0.15, 0.1, 0.98], '<', G.e],
    body: {
      'spine.rx': [0, 0.3, -0.28, -0.3, -0.08, 0],
      'chest.rx': [0, 0.15, -0.22, -0.24, -0.05, 0],
      'head.rx':  [0, 0.25, -0.42, -0.45, -0.1, 0],
      'body.py':  [0, -0.16, 0.0, -0.02, -0.04, 0],
      'shL.rx':   [0, -0.3, -1.5, -1.55, -0.5, 0],
      'shL.rz':   [0, 0.1, 1.05, 1.1, 0.4, 0],
      'elL.rx':   [0, -1.3, -0.25, -0.2, -0.4, 0],
    },
    feet: {
      'fL.z': [[0, 0], [0.16, 0], [0.37, 0.14], [0.82, 0.14], [0.96, 0]],
      'fL.y': [[0, 0], [0.16, 0], [0.27, 0.13], [0.37, 0], [0.82, 0], [0.89, 0.05], [0.96, 0]],
    },
  });
  WCRY.attack = false;

  // MAGE - STAFF SLAM (fire nova / fire pillar): lift the staff upright high, then drive its foot into the ground
  // with a deep crouch, free arm flung out; the orb flares on the strike.
  const MSLAM = attackProfile({
    name: 'mslam', label: 'Staff slam', dur: 1.0,
    keys:    [0, 0.18, 0.36, 0.44, 0.5, 0.66, 0.84, 1],
    phases: { antic: 0.44, contact: 0.5, follow: 0.66 },
    hit: [], trail: [2, 2], ranged: true,
    buffer: 2, chain: 2, move: 0.84, chainSkip: 0, blendIn: 0.1,
    power: 1.4, reach: 20, cosArc: 1, hitstop: 0.05, shake: 0.12, headTrack: 0.5, shieldHold: 0, trailColor: 0xffa040,
    hand:  [MG.h, [-0.12, -0.3, 0.28], [-0.1, 0.3, 0.3], [-0.08, 0.36, 0.32], [-0.06, -0.3, 0.42], [-0.06, -0.32, 0.42], [-0.1, -0.38, 0.34], MG.h],
    blade: [MG.b, [0, 1, 0.1], [0, 1, 0.05], [0, 1, 0.05], [0, 1, 0.12], [0, 1, 0.12], [0.02, 1, 0.1], MG.b],
    edge:  MGE(8),
    body: {
      'body.py':  [0, -0.04, 0.03, 0.03, -0.2, -0.2, -0.06, 0],
      'spine.rx': [0, 0.0, -0.1, -0.12, 0.22, 0.2, 0.05, 0],
      'head.rx':  [0, 0, -0.1, -0.12, 0.15, 0.12, 0.03, 0],
      'shL.rx':   [0, -0.3, -0.9, -1.0, -0.4, -0.4, -0.1, 0],
      'shL.rz':   [0, 0.2, 0.6, 0.7, 1.0, 1.0, 0.4, 0],
      'elL.rx':   [0, -0.5, -0.4, -0.3, -0.1, -0.1, -0.2, 0],
      'orb.glow': [0, 0.3, 0.8, 1, 1, 0.5, 0.1, 0],
    },
    feet: {
      'fL.x': [[0, 0], [0.14, 0], [0.3, 0.08], [0.86, 0.08], [0.98, 0]],
      'fL.y': [[0, 0], [0.14, 0], [0.22, 0.06], [0.3, 0], [0.86, 0], [0.92, 0.05], [0.98, 0]],
    },
  });
  MSLAM.attack = false;

  // MAGE - CHANNEL (mana shield / blink): staff raised upright in front of the body, free hand drawn to the chest,
  // head lifts as the orb flares; release.
  const MBUFF = attackProfile({
    name: 'mbuff', label: 'Channel', dur: 0.9,
    keys:    [0, 0.22, 0.45, 0.7, 1],
    phases: { antic: 0.3, contact: 0.45, follow: 0.6 },
    hit: [], trail: [2, 2], ranged: true,
    buffer: 2, chain: 2, move: 0.75, chainSkip: 0, blendIn: 0.1,
    power: 0, reach: 20, cosArc: 1, hitstop: 0, shake: 0, headTrack: 0.3, shieldHold: 0, trailColor: 0xffa040,
    hand:  [MG.h, [-0.06, -0.12, 0.38], [-0.03, -0.02, 0.42], [-0.06, -0.12, 0.38], MG.h],
    blade: [MG.b, [0, 1, 0.05], [0, 1, 0.02], [0, 1, 0.05], MG.b],
    edge:  MGE(5),
    body: {
      'shL.rx':   [0, -0.9, -1.1, -0.8, 0],
      'shL.rz':   [0, -0.1, -0.15, -0.1, 0],
      'elL.rx':   [0, -1.25, -1.05, -1.1, 0],
      'head.rx':  [0, 0.1, -0.15, 0, 0],
      'body.py':  [0, -0.04, 0.0, -0.03, 0],
      'orb.glow': [0, 0.6, 1, 0.5, 0],
    },
  });
  MBUFF.attack = false;

  const COMBO = ['attack1', 'attack2', 'attack3'];   // 3-hit combo; attack4 (spin finisher) stays defined but is not in the chain

  // WHIRLWIND (Q): coil, step the rear foot in under the body, then TWO full revolutions pivoting on its ball with the
  // sword arm stretched out flat and the free arm opened for balance, head spotting; a hit window per revolution (the
  // slash VFX draws a crescent all the way around), brake, step back out into the stance.
  const SPECIAL = attackProfile({
    name: 'special', label: 'Whirlwind', dur: 1.35,
    //        start coil  coil+ rev   rev   rev   stop  settle end
    keys:    [0,    0.14, 0.22, 0.36, 0.5,  0.64, 0.78, 0.88,  1],
    phases: { antic: 0.22, contact: 0.5, follow: 0.8 },
    hit: [[0.24, 0.5], [0.5, 0.77]], trail: [0.24, 0.8],
    buffer: 2, chain: 2, move: 2, chainSkip: 0, blendIn: 0.12,
    power: 0.8, reach: 3.0, cosArc: -1, hitstop: 0.03, shake: 0.08, trailColor: 0xffd98a, shieldHold: 0, headTrack: 0.6, pivot: 'R',
    hand:  [G.h, [-0.3, -0.3, -0.06], [-0.34, -0.3, -0.1], [-0.62, -0.06, 0.2], [-0.62, -0.06, 0.2], [-0.62, -0.06, 0.2], [-0.56, -0.1, 0.25], [-0.22, -0.42, 0.25], G.h],
    blade: [G.b, [-0.55, 0.15, -0.82], [-0.58, 0.12, -0.8], [-0.9, 0.02, 0.42], [-0.9, 0.02, 0.42], [-0.9, 0.02, 0.42], [-0.85, 0.05, 0.5], [-0.45, 0.62, 0.62], G.b],
    edge:  [G.e, '=', [-0.82, 0, 0.55], [0.42, 0, 0.9], '<', '<', '<', [0.9, 0, -0.3], G.e],
    body: {
      'spin.ry':  [0, -0.05, -0.1, 2.6, 6.3, 10.0, 4 * PI, 4 * PI, 4 * PI],
      'hips.ry':  [0, -0.3, -0.38, 0.15, 0.12, 0.12, 0.06, 0.02, 0],
      'spine.ry': [0, -0.26, -0.32, -0.05, -0.05, -0.05, 0, 0, 0],
      'chest.ry': [0, -0.32, -0.4, -0.18, -0.15, -0.15, -0.05, 0, 0],
      'body.py':  [0, -0.1, -0.14, -0.17, -0.17, -0.17, -0.15, -0.06, 0],
      'spine.rx': [0, 0.08, 0.1, 0.14, 0.14, 0.14, 0.1, 0.03, 0],
      'chest.rz': [0, 0.06, 0.08, -0.06, -0.06, -0.06, -0.03, 0, 0],
      'shL.rz':   [0, 0.15, 0.2, 1.05, 1.1, 1.1, 0.85, 0.2, 0],
      'shL.rx':   [0, -0.1, -0.12, -0.12, -0.12, -0.12, -0.08, 0, 0],
      'elL.rx':   [0, -0.5, -0.55, -0.15, -0.15, -0.15, -0.3, -0.15, 0],
      'head.ry':  [0, 0.05, 0.1, 0.35, 0.35, 0.35, 0.15, 0, 0],
    },
    feet: {
      // rear (pivot) foot steps in under the body, pivots on its ball through both turns, steps back out
      'fR.x': [[0, 0], [0.04, 0], [0.14, 0.22], [0.86, 0.22], [0.95, 0]],
      'fR.y': [[0, 0], [0.04, 0], [0.09, 0.06], [0.14, 0], [0.86, 0], [0.905, 0.06], [0.95, 0]],
      'fR.p': [[0, 0], [0.16, 0], [0.24, 0.4], [0.78, 0.4], [0.86, 0]],
      // front foot tucks up while turning, lands when the turn ends
      'fL.y': [[0, 0], [0.18, 0], [0.26, 0.12], [0.76, 0.12], [0.84, 0]],
      'fL.x': [[0, 0], [0.2, 0], [0.28, -0.2], [0.74, -0.2], [0.82, 0]],
      'fL.z': [[0, 0], [0.2, 0], [0.28, -0.12], [0.74, -0.12], [0.82, 0]],
    },
  });
  SPECIAL.attack = false;                                       // a skill: not part of the click combo, no move-cancel

  // HIT REACTION: the impact snaps the head and chest back and twists the torso, both arms fling out, the body is
  // knocked back ~15 cm with a real step (rear foot first, then the front foot), then recovers into the guard.
  const HITR = attackProfile({
    name: 'hit', label: 'Hit reaction', dur: 0.55,
    keys:    [0, 0.12, 0.3, 0.62, 1],
    phases: { antic: 0.04, contact: 0.12, follow: 0.4 },
    hit: [], trail: [2, 2], buffer: 2, chain: 2, move: 2, blendIn: 0.05, headTrack: 0, shieldHold: 0,
    hand:  [G.h, [-0.3, -0.22, -0.06], [-0.26, -0.36, 0.04], [-0.21, -0.52, 0.1], G.h],
    blade: [G.b, [-0.7, 0.6, -0.4], [-0.62, 0.68, 0.15], [-0.56, 0.7, 0.42], G.b],
    edge:  [G.e, G.e, G.e, G.e, G.e],
    body: {
      'body.pz':  [0, -0.12, -0.08, -0.02, 0],
      'body.py':  [0, -0.06, -0.08, -0.03, 0],
      'spine.rx': [0, -0.28, -0.12, 0.02, 0],
      'chest.rx': [0, -0.2, -0.08, 0, 0],
      'chest.ry': [0, 0.25, 0.1, 0.02, 0],
      'hips.ry':  [0, 0.1, 0.05, 0, 0],
      'chest.rz': [0, 0.1, 0.05, 0, 0],
      'head.rx':  [0, -0.35, -0.1, 0.04, 0],
      'head.ry':  [0, -0.2, -0.08, 0, 0],
      'shL.rx':   [0, 0.45, 0.2, 0.05, 0],
      'shL.rz':   [0, 0.35, 0.2, 0.05, 0],
      'elL.rx':   [0, -0.6, -0.4, -0.1, 0],
    },
    lunge: [[0, 0], [0.04, 0], [0.28, -0.16], [1, -0.16]],
    feet: {
      'fR.z': [[0, 0], [0.04, 0], [0.24, -0.18]],
      'fR.y': [[0, 0], [0.04, 0], [0.13, 0.07], [0.24, 0]],
      'fL.z': [[0, 0], [0.28, 0], [0.48, -0.16]],
      'fL.y': [[0, 0], [0.28, 0], [0.38, 0.05], [0.48, 0]],
    },
  });
  Object.assign(HITR, { attack: false, flash: true, swingAt: undefined, impact: undefined });

  const ONE_SHOT = {
    attack1: A1,
    attack2: A2,
    attack3: A3,
    attack4: A4,
    special: SPECIAL,
    shot: SHOT,
    volley: VOLLEY,
    cast: CAST,
    meteor: METEOR,
    skyshot: SKYSHOT, hop: HOP, abuff: ABUFF,
    dash: DASH, leap: LEAP, wcry: WCRY,
    mslam: MSLAM, mbuff: MBUFF,
    hit: HITR,
    // DEATH: the blow staggers him back a step, the knees buckle and he drops to his knees, then topples forward onto
    // his face with a small bounce; arms fall forward, head turns to the side. (legacy key format, seconds)
    die: {
      dur: 2.0, hold: true, flash: true, blendIn: 0.06, noIdle: true,
      abs: {
        'ik.w': [[0, 1], [0.3, 0, 'io']],
        'ikL.w': [[0, 0], [0.01, 0]],
        'leg.w': [[0, 1], [0.9, 1], [1.3, 0, 'io']],
        'thL.rx': [[0, 0], [0.9, -1.25], [1.45, -0.08, 'io'], [2.0, -0.04]],
        'knL.rx': [[0, 0], [0.9, 2.1], [1.45, 0.35, 'io'], [2.0, 0.3]],
        'thR.rx': [[0, 0], [0.9, -1.05], [1.45, 0.04, 'io'], [2.0, 0.06]],
        'knR.rx': [[0, 0], [0.9, 1.9], [1.45, 0.2, 'io'], [2.0, 0.18]],
        'thL.rz': [[0, 0], [2.0, 0.12]], 'thR.rz': [[0, 0], [2.0, -0.14]],
      },
      tracks: {
        'spine.rx': [[0, 0], [0.12, -0.3, 'out'], [0.45, 0.12], [0.9, 0.35], [1.35, 0.08], [2.0, 0.04]],
        'chest.rx': [[0, 0], [0.12, -0.25, 'out'], [0.45, 0.05], [0.9, 0.25], [1.35, 0.04], [2.0, 0]],
        'chest.ry': [[0, 0], [0.12, 0.22, 'out'], [0.5, -0.08], [2.0, 0]],
        'head.rx': [[0, 0], [0.12, -0.45, 'out'], [0.55, 0.25], [0.95, 0.5], [1.35, -0.35], [2.0, -0.4]],
        'head.ry': [[0, 0], [1.2, 0], [1.5, 0.95], [2.0, 0.95]],
        'body.pz': [[0, 0], [0.12, -0.1, 'out'], [0.45, -0.24], [0.9, -0.18], [1.38, -0.68, 'in'], [2.0, -0.68]],
        'body.py': [[0, 0], [0.12, -0.05], [0.45, -0.18], [0.9, -0.58, 'in'], [1.15, -0.3], [1.38, 0.25, 'in'], [1.52, 0.31, 'out'], [1.7, 0.26, 'in'], [2.0, 0.27]],
        'body.rx': [[0, 0], [0.9, 0.1], [1.38, PI / 2 - 0.04, 'in'], [1.52, PI / 2 - 0.13, 'out'], [1.7, PI / 2 - 0.05, 'in'], [2.0, PI / 2 - 0.06]],
        'body.rz': [[0, 0], [0.9, 0], [1.4, 0.12], [2.0, 0.14]],
        'shR.rx': [[0, 0], [0.25, 0.6], [0.9, 0.35], [1.4, -1.5, 'in'], [2.0, -1.6]],
        'shR.rz': [[0, 0], [0.25, -0.3], [1.4, -0.45], [2.0, -0.45]],
        'elR.rx': [[0, 0], [0.3, -0.45], [1.4, -0.2], [2.0, -0.25]],
        'shL.rx': [[0, 0], [0.25, 0.7], [0.9, 0.4], [1.4, -1.7, 'in'], [2.0, -1.8]],          // arm ends up forward and out on the ground
        'shL.rz': [[0, 0], [0.25, 0.25], [1.4, 0.7], [2.0, 0.78]],
        'elL.rx': [[0, 0], [0.3, -0.5], [1.4, -0.35], [2.0, -0.4]],
        'fR.z': [[0, 0], [0.12, 0], [0.38, -0.22]],
        'fR.y': [[0, 0], [0.12, 0], [0.25, 0.07], [0.38, 0]],
        'plume.rx': [[0, 0], [0.15, -0.5], [1.4, 0.6], [2.0, 0.5]],
      },
    },
  };


  // Server-compatible validation: a hit reported by the swept blade test must also pass this pure range/arc rule.
  function validateMeleeHit(attacker, target, def) {
    const dx = target.x - attacker.x, dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dz);
    if (dist > def.reach + (target.radius || 0)) return false;
    if (def.cosArc <= -1 || dist < 0.35) return true;
    return (Math.sin(attacker.yaw) * dx + Math.cos(attacker.yaw) * dz) / dist >= def.cosArc;
  }

  // closest distance^2 between segments p1-q1 and p2-q2; writes the closest point on the first segment into c1
  function segSegDist2(p1, q1, p2, q2, c1, c2) {
    const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
    const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
    const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
    let s, t;
    if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
    else if (a <= 1e-9) { s = 0; t = clamp01(f / e); }
    else {
      const c = d1x * rx + d1y * ry + d1z * rz;
      if (e <= 1e-9) { t = 0; s = clamp01(-c / a); }
      else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
        s = den > 1e-9 ? clamp01((b * f - c * e) / den) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
      }
    }
    c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
    c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
    return c1.distanceToSquared(c2);
  }

  /* ---------- geometry helpers ---------- */
  const cyl = (rt, rb, h, n) => new T.CylinderGeometry(rt, rb, h, n || 8);
  const sph = (r, w, h) => new T.SphereGeometry(r, w || 7, h || 5);
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const cone = (r, h, n) => new T.ConeGeometry(r, h, n || 5);
  const lathe = (pts, n) => new T.LatheGeometry(pts.map((p) => new T.Vector2(p[0], p[1])), n || 10);
  // soft round glow (additive sprites: staff orb, charge motes). One shared canvas texture.
  let _glowTex = null;
  function glowTexture() {
    if (_glowTex) return _glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    _glowTex = new T.CanvasTexture(c);
    return _glowTex;
  }
  // box tapered (top width / bottom width), optional jagged hem
  function taperBox(wTop, wBot, h, d, segs, jag) {
    const g = new T.BoxGeometry(1, h, d, segs || 1, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0;
      p.setX(i, p.getX(i) * (top ? wTop : wBot));
      if (!top && jag) p.setY(i, p.getY(i) - jag * Math.abs(Math.sin(p.getX(i) * 9.5)));
    }
    g.computeVertexNormals();
    return g;
  }
  function shieldGeometry() {
    const s = new T.Shape();
    s.moveTo(-0.3, 0.4); s.lineTo(0.3, 0.4); s.lineTo(0.3, 0.02);
    s.quadraticCurveTo(0.29, -0.3, 0, -0.52);
    s.quadraticCurveTo(-0.29, -0.3, -0.3, 0.02); s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 5 });
    g.translate(0, 0, -0.025);
    return g;
  }
  // Blade: diamond cross-section (sharp edges along +/-X, central ridge along +/-Z), tapering to the point.
  // Built from many rows along its length so the bend physics (vertex offsets growing toward the tip) reads as a
  // smooth curve from the guard to the point - with only a few rows the bent blade looked like a rigid stick.
  function bladeGeometry() {
    const ROWS = 28, L = 1.03, pos = [], idx = [];
    const halfW = (y) => (y < 0.8 ? 0.052 - 0.008 * (y / 0.8) : 0.044 * Math.sqrt(Math.max(0, 1 - (y - 0.8) / (L - 0.8))));
    const halfT = (y) => (y < 0.8 ? 0.0135 - 0.003 * (y / 0.8) : 0.0105 * Math.max(0, 1 - (y - 0.8) / (L - 0.8)) + 0.0015);
    for (let r = 0; r <= ROWS; r++) {
      const u = r / ROWS, y = L * (1 - (1 - u) * (1 - u) * 0.35 - (1 - u) * 0.65);    // rows slightly denser toward the tip
      const w = halfW(y), t = halfT(y);
      pos.push(w, y, 0, 0, y, t, -w, y, 0, 0, y, -t);
    }
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < 4; k++) {
      const a = r * 4 + k, b = r * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
      idx.push(a, d, b, a, c, d);                                         // outward facing
    }
    idx.push(0, 1, 2, 0, 2, 3);                                         // base cap (inside the guard)
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const ng = g.toNonIndexed(); ng.computeVertexNormals();             // faceted steel (flat facets per quad)
    return ng;
  }

  /* ---------- sculpted head (procedural) ----------
   * One smooth mesh: an ellipsoid shaped into a skull (squared jaw, flatter face, nape), plus facial features added
   * as gaussian displacements along the surface normal (brow ridge, eye sockets, nose, lips, chin, cheekbones...).
   * Skin shading is painted into vertex colours (stubble shadow, darker sockets, lips). Hair is the same surface
   * offset outward above a hairline. Everything is in head-local units (the head group is scaled at build time). */
  const HEAD_C = [0, 0.17, 0], HEAD_R = [0.118, 0.142, 0.13];
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  // [dx, dy, sx, sy, amplitude(m)] on the front of the unit sphere (dx = right-left, dy = up-down)
  const FACE = [
    [0, 0.26, 0.42, 0.07, 0.01],                                          // brow ridge
    [-0.34, 0.13, 0.12, 0.075, -0.016], [0.34, 0.13, 0.12, 0.075, -0.016], // eye sockets
    [0, 0.1, 0.055, 0.12, 0.01],                                          // nose bridge
    [0, -0.05, 0.075, 0.1, 0.026],                                        // nose
    [0, -0.12, 0.055, 0.045, 0.012],                                      // nose tip
    [-0.085, -0.135, 0.05, 0.04, 0.008], [0.085, -0.135, 0.05, 0.04, 0.008], // nostril wings
    [0, -0.27, 0.16, 0.04, 0.006],                                        // upper lip
    [0, -0.315, 0.17, 0.012, -0.005],                                     // mouth line
    [0, -0.355, 0.12, 0.035, 0.005],                                      // lower lip
    [0, -0.42, 0.13, 0.03, -0.003],                                       // under-lip groove
    [0, -0.6, 0.17, 0.12, 0.014],                                         // chin
    [-0.48, 0.02, 0.13, 0.1, 0.009], [0.48, 0.02, 0.13, 0.1, 0.009],       // cheekbones
    [-0.42, -0.28, 0.12, 0.12, -0.0025], [0.42, -0.28, 0.12, 0.12, -0.0025], // cheek hollows
    [-0.8, 0.28, 0.15, 0.15, -0.006], [0.8, 0.28, 0.15, 0.15, -0.006],     // temples
  ];
  const g2 = (dx, dy, cx, cy, sx, sy) => { const ex = (dx - cx) / sx, ey = (dy - cy) / sy; return Math.exp(-(ex * ex + ey * ey)); };
  // surface point + outward normal for a unit direction d from the head centre
  function headPoint(d, out, nrm) {
    let x = d.x, y = d.y, z = d.z;
    x *= 1 - 0.08 * sstep(0.2, 0.55, -y) - 0.2 * sstep(0.6, 1.0, -y);          // jaw narrows to the chin, square corners
    z *= 1 - 0.28 * sstep(0.05, 0.95, -y) * sstep(0.0, -0.8, z);               // back of the skull curves into the nape
    if (y < -0.75) y = -0.75 + (y + 0.75) * 0.6;                               // flatter under the jaw
    z *= 1 - 0.06 * sstep(0.6, 1.0, d.z);                                      // a face is flatter than a sphere
    const n = nrm.set(d.x / HEAD_R[0], d.y / HEAD_R[1], d.z / HEAD_R[2]).normalize();
    const front = sstep(0.15, 0.6, d.z);
    let disp = 0;
    if (front > 0) for (let i = 0; i < FACE.length; i++) { const f = FACE[i]; disp += f[4] * g2(d.x, d.y, f[0], f[1], f[2], f[3]); }
    out.set(x * HEAD_R[0] + HEAD_C[0], y * HEAD_R[1] + HEAD_C[1], z * HEAD_R[2] + HEAD_C[2]).addScaledVector(n, disp * front);
    return out;
  }
  // 0..1 hair coverage: hairline high at the forehead, above the ears at the sides, down to the nape at the back
  function hairMask(d) {
    const line = d.z > 0 ? 0.15 + 0.3 * sstep(0.25, 0.85, d.z) : 0.15 - 0.7 * sstep(0.0, -0.85, d.z);
    let m = sstep(line - 0.03, line + 0.06, d.y + 0.025 * Math.sin(d.x * 23 + 1.3));
    const side = Math.abs(d.x);                                                 // sideburns in front of the ears
    m = Math.max(m, sstep(0.86, 0.93, side) * sstep(-0.14, -0.02, d.y) * sstep(-0.02, 0.06, d.z) * sstep(0.32, 0.22, d.z));
    return m;
  }
  const hairThick = (d, m) => m * (0.007 + 0.014 * sstep(0.2, 1.0, d.y));
  function headGeometries() {
    const d = new T.Vector3(), p = new T.Vector3(), n = new T.Vector3();
    // skin
    const skin = new T.SphereGeometry(1, 72, 54), sp = skin.attributes.position, col = [];
    for (let i = 0; i < sp.count; i++) {
      d.set(sp.getX(i), sp.getY(i), sp.getZ(i)).normalize();
      headPoint(d, p, n); sp.setXYZ(i, p.x, p.y, p.z);
      const front = sstep(0.1, 0.5, d.z);
      // stubble: jaw, chin, upper lip, sideburn area (not on the lips)
      const lips = g2(d.x, d.y, 0, -0.315, 0.15, 0.06);
      let stub = sstep(-0.25, -0.5, d.y) * sstep(-0.35, 0.1, d.z) * (1 - lips) + 0.6 * g2(d.x, d.y, 0, -0.23, 0.16, 0.04) * front;
      stub = clamp01(stub) * (1 - hairMask(d));
      const sock = (g2(d.x, d.y, -0.34, 0.13, 0.12, 0.08) + g2(d.x, d.y, 0.34, 0.13, 0.12, 0.08)) * front;
      const nostril = (g2(d.x, d.y, -0.05, -0.17, 0.03, 0.02) + g2(d.x, d.y, 0.05, -0.17, 0.03, 0.02)) * front;
      let r = 1, gg = 1, b = 1;
      r *= 1 - 0.16 * stub; gg *= 1 - 0.17 * stub; b *= 1 - 0.15 * stub;                    // light stubble shadow
      const shade = 1 - 0.18 * sock - 0.35 * nostril; r *= shade; gg *= shade; b *= shade;
      r = r * (1 - lips * front) + lips * front * 0.95; gg = gg * (1 - lips * front) + lips * front * 0.66; b = b * (1 - lips * front) + lips * front * 0.62;
      const blush = (g2(d.x, d.y, -0.45, -0.1, 0.15, 0.12) + g2(d.x, d.y, 0.45, -0.1, 0.15, 0.12)) * front * 0.06;
      col.push(r, gg * (1 - blush), b * (1 - blush));
    }
    skin.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    skin.computeVertexNormals();
    // hair: the same surface pushed outward where there is hair, hidden just under the skin elsewhere
    const hair = new T.SphereGeometry(1, 56, 40), hp = hair.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      d.set(hp.getX(i), hp.getY(i), hp.getZ(i)).normalize();
      headPoint(d, p, n);
      const m = hairMask(d);
      p.addScaledVector(n, m > 0.02 ? hairThick(d, m) + 0.0015 : -0.004);
      hp.setXYZ(i, p.x, p.y, p.z);
    }
    hair.computeVertexNormals();
    return { skin, hair };
  }
  // a strip that hugs the head (over hair where there is hair) between two heights: headband
  function headBandGeometry(dy0, dy1, lift) {
    const segs = 48, pos = [], idx = [], d = new T.Vector3(), p = new T.Vector3(), n = new T.Vector3();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * 2 * PI;
      for (const dy of [dy0, dy1]) {
        const r = Math.sqrt(1 - dy * dy);
        d.set(Math.sin(a) * r, dy, Math.cos(a) * r);
        headPoint(d, p, n);
        p.addScaledVector(n, hairThick(d, hairMask(d)) + lift);
        pos.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < segs; i++) { const k = 2 * i; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const dirFace = (dx, dy) => new T.Vector3(dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)));

  /* ---------- blade trail (world-space ribbon, additive) ---------- */
  /* WeaponTrailRenderer: a crescent "slash" ribbon.
   *  - shape: as a sample ages its inner edge slides toward the tip edge, so the ribbon is wide at the blade and tapers
   *    to a thin crescent tail
   *  - shading: soft inner gradient in the attack colour, a sharp near-white cutting edge along the tip path, wind streaks
   *    flowing along the arc (procedural noise), soft head (no hard cut at the blade), decaying tail
   *  - only fast blade motion contributes (speed weight per sample) */
  /* A ribbon's width (tip -> hilt) must stay PERPENDICULAR to the tip's travel. When the wrist turns the blade over (cock ->
   * whip -> lead) the raw hilt->tip segments rotate along the path, consecutive segments cross each other and the ribbon reads
   * as a forked, broken bow-tie. inner(): the tip->hilt vector with its along-path component removed, never collapsing to zero
   * (falls back to the previous one) and blended with it so it turns smoothly; the blade length is kept. */
  function ribbonInner(v, dir, prev, blend) {
    if (dir) v.addScaledVector(dir, -v.dot(dir));
    if (v.lengthSq() < 1e-8) { if (prev) v.copy(prev); else v.set(0, -1, 0); }
    v.normalize();
    if (prev) v.lerp(prev, blend).normalize();
    return v;
  }
  // whole path version (SlashVFX): stable hilt points for tip samples P / raw hilt samples H
  function stableHilts(P, H) {
    const n = P.length, V = T.Vector3, inn = [], len = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      const d = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]), dl = d.length();
      const v = H[i].clone().sub(P[i]);
      len.push(v.length());
      prev = ribbonInner(v, dl > 1e-6 ? d.multiplyScalar(1 / dl) : null, prev, 0);
      inn.push(prev.clone());
    }
    for (let pass = 0; pass < 2; pass++) {                       // [1 2 1] smoothing of the direction and the length
      const c = inn.map((v) => v.clone()), cl = len.slice();
      for (let i = 1; i < n - 1; i++) { inn[i].copy(c[i - 1]).addScaledVector(c[i], 2).add(c[i + 1]).normalize(); len[i] = (cl[i - 1] + 2 * cl[i] + cl[i + 1]) / 4; }
    }
    return P.map((p, i) => new V().copy(p).addScaledVector(inn[i], len[i]));
  }

  class Trail {
    constructor(max) {
      this.max = max || 200;
      this.pts = [];
      const n = this.max * 2;
      this.pos = new Float32Array(n * 3);
      this.age = new Float32Array(n);
      this.wgt = new Float32Array(n);
      this.edge = new Float32Array(n);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aAge', new T.BufferAttribute(this.age, 1).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aW', new T.BufferAttribute(this.wgt, 1).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aEdge', new T.BufferAttribute(this.edge, 1));
      const idx = [];
      for (let i = 0; i < this.max - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      for (let i = 0; i < this.max; i++) { this.edge[2 * i] = 0; this.edge[2 * i + 1] = 1; }
      g.setDrawRange(0, 0);
      this.mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uColor: { value: new T.Color(0xbfe4ff) }, uTime: { value: 0 } },
        vertexShader: 'attribute float aAge; attribute float aW; attribute float aEdge; varying float vAge; varying float vW; varying float vE;' +
          'void main(){ vAge=aAge; vW=aW; vE=aEdge; gl_Position=projectionMatrix*viewMatrix*vec4(position,1.0); }',
        fragmentShader: [
          'uniform vec3 uColor; uniform float uTime; varying float vAge; varying float vW; varying float vE;',
          'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
          'float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
          '  return mix(mix(h(i), h(i+vec2(1.0,0.0)), f.x), mix(h(i+vec2(0.0,1.0)), h(i+vec2(1.0,1.0)), f.x), f.y); }',
          'void main(){',
          '  float fade = pow(1.0 - vAge, 1.7) * smoothstep(0.0, 0.06, vAge);           // soft head, decaying tail',
          '  float body = smoothstep(0.0, 0.9, vE) * (1.0 - smoothstep(0.985, 1.0, vE)); // soft inner edge',
          '  float rim = smoothstep(0.84, 0.965, vE) * (1.0 - smoothstep(0.975, 1.0, vE)); // sharp cutting edge',
          '  float streak = 0.55 + 0.45 * n2(vec2(vE * 22.0, vAge * 7.0 - uTime * 3.0));   // wind streaks along the arc',
          '  float a = vW * fade * (body * 0.38 * streak + rim * 1.15) * 0.3;',
          '  vec3 col = mix(uColor, vec3(1.0), clamp(rim * 0.85 + pow(vE, 10.0) * 0.5, 0.0, 1.0));',
          '  gl_FragColor = vec4(col, a);',
          '}'].join(String.fromCharCode(10)),
      });
      this.mesh = new T.Mesh(g, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 20;
      this.geo = g;
    }
    clear() { this.pts.length = 0; this.geo.setDrawRange(0, 0); }
    // w: 0..1 weight from blade-tip speed, so only the fast part of a swing leaves a visible ribbon
    push(b, t, time) {
      const last = this.pts[this.pts.length - 1];
      let w = 1;
      // width vector kept perpendicular to the tip's travel and turned smoothly (see ribbonInner): no crossed segments
      const inner = b.clone().sub(t), len = inner.length();
      if (last) {
        const dtp = time - last.time, step = t.distanceTo(last.t);
        w = dtp > 1e-5 ? clamp01((step / dtp - 3.5) / 6.5) : last.w;
        w = w * w * (3 - 2 * w);
        const dir = step > 1e-6 ? t.clone().sub(last.t).multiplyScalar(1 / step) : null;
        ribbonInner(inner, dir, last.inner, 0.45);
      } else ribbonInner(inner, null, null, 0);
      const L = last ? last.len + (len - last.len) * 0.5 : len;
      this.pts.push({ b: t.clone().addScaledVector(inner, L), t: t.clone(), time, w, inner, len: L });
      if (this.pts.length > this.max) this.pts.shift();
    }
    update(now, life) {
      const pts = this.pts;
      while (pts.length && now - pts[0].time > life) pts.shift();
      const n = pts.length;
      this.mat.uniforms.uTime.value = now;
      for (let i = 0; i < n; i++) {
        const p = pts[i], k = 2 * i;
        const age = clamp01((now - p.time) / life), shrink = 0.72 * age * age * (3 - 2 * age);   // crescent taper
        this.pos[3 * k] = p.b.x + (p.t.x - p.b.x) * shrink; this.pos[3 * k + 1] = p.b.y + (p.t.y - p.b.y) * shrink; this.pos[3 * k + 2] = p.b.z + (p.t.z - p.b.z) * shrink;
        this.pos[3 * k + 3] = p.t.x; this.pos[3 * k + 4] = p.t.y; this.pos[3 * k + 5] = p.t.z;
        this.age[k] = age; this.age[k + 1] = age;
        const w = p.w === undefined ? 1 : p.w;
        this.wgt[k] = w; this.wgt[k + 1] = w;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAge.needsUpdate = true;
      this.geo.attributes.aW.needsUpdate = true;
      this.geo.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    }
  }


  /* ---------- SlashVFX: designed crescent "cut" effects laid along the real swing arc ----------
   * spawn(tipPath, hiltPath, color, dur, power): world-space blade tip / hilt samples over the attack's active window.
   * Layers (one geometry builder, different shaders):
   *   main  - crescent: hot white core on the cutting edge, coloured body with flowing streaks, thick middle / pointed ends
   *   glow  - wide soft halo around the arc
   *   wind  - two thin lines parallel to the arc (one outside, one inside), trailing slightly behind
   * Animation: the slash OPENS with the blade (bright leading front), expands a little, then dissolves from the tail with
   * a noisy eroding edge. Its clock is slowed by hit-stop like the rest of the presentation. */
  const SLASH_NOISE = [
    'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
    '  return mix(mix(h(i), h(i+vec2(1.0,0.0)), f.x), mix(h(i+vec2(0.0,1.0)), h(i+vec2(1.0,1.0)), f.x), f.y); }',
  ].join(String.fromCharCode(10));
  const SLASH_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const SLASH_COMMON = [
    'uniform vec3 uColor; uniform float uReveal; uniform float uFade; uniform float uTime; uniform float uLag; varying vec2 vUv;',
    SLASH_NOISE,
    'float masks(float u, float v, out float front){',
    '  float r = uReveal - uLag;',
    '  float head = smoothstep(r + 0.02, r - 0.07, u);                                  // opened part of the arc',
    '  front = exp(-pow((u - r) / 0.06, 2.0)) * step(0.0, r);                           // flash at the opening front',
    '  float n = n2(vec2(u * 12.0 - uTime * 1.5, v * 3.0));',
    '  float erode = smoothstep(uFade * 1.35 - 0.25, uFade * 1.35 - 0.05, u + n * 0.3 - 0.15 + (1.0 - v) * 0.12);   // dissolve from the tail',
    '  float ends = smoothstep(0.0, 0.07, u) * smoothstep(1.0, 0.9, u);',
    '  return head * erode * ends;',
    '}',
  ].join(String.fromCharCode(10));
  const SLASH_FS = {
    main: SLASH_COMMON + String.fromCharCode(10) + [
      'void main(){ float u = vUv.x, v = vUv.y, front; float m = masks(u, v, front);',
      '  float core = exp(-pow((v - 0.84) / 0.035, 2.0));                                  // hot cutting edge',
      '  float body = smoothstep(0.0, 0.8, v) * (1.0 - smoothstep(0.84, 1.0, v));',
      '  float streak = 0.55 + 0.45 * n2(vec2(u * 36.0 - uTime * 7.0, v * 9.0));',
      '  float a = (core * 1.5 + body * 0.6 * streak + front * body * 0.9) * m;',
      '  vec3 col = mix(uColor, vec3(1.0), clamp(core * 0.95 + front * 0.6 + pow(v, 6.0) * 0.3, 0.0, 1.0));',
      '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)); }'].join(String.fromCharCode(10)),
    glow: SLASH_COMMON + String.fromCharCode(10) + [
      'void main(){ float u = vUv.x, v = vUv.y, front; float m = masks(u, v, front);',
      '  float g = exp(-pow((v - 0.7) / 0.28, 2.0));',
      '  gl_FragColor = vec4(uColor, g * 0.32 * m * (1.0 + front)); }'].join(String.fromCharCode(10)),
    wind: SLASH_COMMON + String.fromCharCode(10) + [
      'void main(){ float u = vUv.x, v = vUv.y, front; float m = masks(u, v, front);',
      '  float line = exp(-pow((v - 0.5) / 0.22, 2.0));',
      '  float dash = smoothstep(0.25, 0.6, n2(vec2(u * 9.0 - uTime * 4.0, 0.5)));',
      '  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.6), line * 0.7 * m * (0.5 + 0.5 * dash)); }'].join(String.fromCharCode(10)),
  };
  // rows across the arc: [v, mode, a, b] -> point = P + (H - P) * a * w   (mode 'in')  or  P + out * a * w (mode 'out')
  const SLASH_LAYERS = {
    main: [[0, 'in', 0.6], [0.84, 'out', 0.0], [1, 'out', 0.09]],
    glow: [[0, 'in', 0.75], [0.7, 'out', 0.05], [1, 'out', 0.3]],
    windO: [[0, 'out', 0.17], [1, 'out', 0.2]],
    windI: [[0, 'in', 0.3], [1, 'in', 0.27]],
  };
  class SlashVFX {
    constructor(cols) {
      this.cols = cols || 48;
      this.group = new T.Group();
      this.items = [];
      for (let k = 0; k < 4; k++) {
        const layers = {};
        for (const name of Object.keys(SLASH_LAYERS)) {
          const rows = SLASH_LAYERS[name].length, n = (this.cols + 1) * rows;
          const g = new T.BufferGeometry(), uv = [], idx = [];
          g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
          for (let i = 0; i <= this.cols; i++) for (let r = 0; r < rows; r++) uv.push(i / this.cols, SLASH_LAYERS[name][r][0]);
          g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
          for (let i = 0; i < this.cols; i++) for (let r = 0; r < rows - 1; r++) {
            const a = i * rows + r, b = a + rows;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
          g.setIndex(idx);
          const kind = name.startsWith('wind') ? 'wind' : name;
          const mat = new T.ShaderMaterial({
            transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
            uniforms: { uColor: { value: new T.Color() }, uReveal: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uLag: { value: name.startsWith('wind') ? 0.08 : 0 } },
            vertexShader: SLASH_VS, fragmentShader: SLASH_FS[kind],
          });
          const mesh = new T.Mesh(g, mat);
          mesh.frustumCulled = false; mesh.renderOrder = kind === 'glow' ? 21 : 22; mesh.visible = false;
          this.group.add(mesh);
          layers[name] = mesh;
        }
        this.items.push({ layers, t: 0, life: 0, open: 0, power: 1, center: new T.Vector3(), alive: false });
      }
    }
    spawn(P, Hraw, color, open, power) {
      const H = stableHilts(P, Hraw);                             // crescent width perpendicular to the cut, no bow-ties
      const it = this.items.find((x) => !x.alive) || this.items.reduce((a, b) => (a.t > b.t ? a : b));
      const N = P.length - 1, V = T.Vector3, out = new V(), p = new V();
      it.center.set(0, 0, 0); P.forEach((q) => it.center.add(q)); it.center.multiplyScalar(1 / P.length);
      for (const name of Object.keys(SLASH_LAYERS)) {
        const rows = SLASH_LAYERS[name], mesh = it.layers[name], pos = mesh.geometry.attributes.position;
        for (let i = 0; i <= this.cols; i++) {
          const s = i / this.cols, f = s * N, i0 = Math.min(Math.floor(f), N - 1), fr = f - i0;
          const tip = P[i0].clone().lerp(P[i0 + 1], fr), hilt = H[i0].clone().lerp(H[i0 + 1], fr);
          out.copy(tip).sub(hilt).normalize();
          const w = Math.pow(Math.sin(PI * Math.pow(s, 0.9)), 0.75);          // crescent: thick middle, pointed ends
          for (let r = 0; r < rows.length; r++) {
            const [, mode, a] = rows[r];
            if (mode === 'in') p.copy(tip).lerp(hilt, a * w); else p.copy(tip).addScaledVector(out, a * w * 1.4);
            p.sub(it.center);                                                     // local to the slash centre (for the expansion)
            pos.setXYZ(i * rows.length + r, p.x, p.y, p.z);
          }
        }
        pos.needsUpdate = true;
        mesh.position.copy(it.center);
        mesh.material.uniforms.uColor.value.setHex(color || 0xbfe4ff);
        mesh.visible = true;
      }
      it.t = 0; it.open = Math.max(0.06, open); it.life = it.open + 0.24; it.power = power || 1; it.alive = true;
    }
    update(dt, time) {
      for (const it of this.items) {
        if (!it.alive) continue;
        it.t += dt;
        const reveal = Math.min(1.12, it.t / it.open * 1.12);
        const fade = clamp01((it.t - it.open * 0.55) / (it.life - it.open * 0.55));
        const sc = 1 + 0.08 * Math.sqrt(clamp01(it.t / it.life)) * it.power;   // slight outward expansion
        for (const name in it.layers) {
          const m = it.layers[name], U = m.material.uniforms;
          U.uReveal.value = reveal; U.uFade.value = fade; U.uTime.value = time;
          m.scale.setScalar(sc);
        }
        if (it.t >= it.life) { it.alive = false; for (const name in it.layers) it.layers[name].visible = false; }
      }
    }
  }

  const TEAMS = { blue: { cloth: 0x2f6bd1 }, red: { cloth: 0xc23a36 } };
  const ANKLE_H = 0.095;   // ankle joint height above the sole
  const LEG = 0.5;         // thigh and shin length
  const WRIST_MIN = 0.6;   // 34deg: a gripped blade never continues the forearm in a straight line (that read as a rigid stick);
                           // when a key asks for it the blade swings about the wrist and trails behind its cutting edge.
                           // (was 52deg: the old swings pinned the wrist there for most of every cut - the blade then moved
                           // as one rigid piece with the forearm; the swings now author their own wrist cock and snap)
  const WRIST_MAX = 2.6;   // 149deg: largest forearm-to-blade angle (blade folded back over the forearm)
  const ARM_SEG = 0.38;    // upper arm = forearm length
  const ARM_K = (2 * ARM_SEG) / 0.68;
  // blade bend profile along sword-local Y: 0 at the guard (0.15) -> 1 at the tip (1.18), cantilever-like (no kink at the hilt)
  const bendF = (y) => { const t = clamp01((y - 0.15) / 1.03); return t * t * (1.5 - 0.5 * t); };
  const FIST_D = 0.1;                    // grip centre below the wrist joint
  const FIST_TILT = 1.8 - PI / 2;        // fist axis tilt so it matches the sword grip axis (sword.rotation.x = 1.8)   // hand offsets are authored for a 0.68 arm; scale them so extension ratios hold

  /* ---------- the character ---------- */
  class Knight {
    constructor(opts) {
      const CLS = (opts && opts.cls) || 'warrior', ARCH = CLS === 'archer', MAGE = CLS === 'mage';
      this.cls = CLS;
      this.comboList = ARCH ? ['shot'] : MAGE ? ['cast'] : COMBO;
      const PAL = {
        warrior: { vest: 0x6b625c, pants: 0x4b5146, beltC: 0x9a6444, hair: 0x1b1512 },
        archer: { vest: 0x5d6b42, pants: 0x5f4d38, beltC: 0x6e4a2e, hair: 0x5b3a22 },
        mage: { vest: 0x6e1f2c, pants: 0x2c2832, beltC: 0x3a2619, hair: 0x2b2420 },     // deep crimson robe, dark trousers
      }[CLS] || {};
      const P = Object.assign({
        vest: PAL.vest, pants: PAL.pants, beltC: PAL.beltC,
        cloth: TEAMS.blue.cloth, skin: 0x9a5c3c, hair: PAL.hair,
        trim: 0xd9a940, dark: 0x1d2028, leather: 0x4a3020, blade: 0xe9f1f8, gem: 0xc8303c,
      }, opts || {});

      this.mats = [];
      const mk = (color, o) => {
        const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.2, flatShading: false }, o || {}));
        m.userData.e0 = m.emissive.clone();
        this.mats.push(m);
        return m;
      };
      // CC0 Poly Haven textures (textures.js); everything still renders without them (plain colours)
      const TX = global.KNIGHT_TEX || {};
      const texLoader = new T.TextureLoader();
      this._texPending = 0; this._texCbs = [];
      const tex = (name, rx, ry) => {
        if (!TX[name]) return null;
        this._texPending++;
        const done = () => { if (--this._texPending === 0) this._texCbs.splice(0).forEach((f) => f()); };
        const t = texLoader.load(TX[name], done, undefined, done);
        t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry || rx); t.anisotropy = 4;
        return t;
      };
      const mkT = (color, name, rep, o) => mk(color, Object.assign({ map: tex(name, rep), normalMap: tex(name + 'N', rep), normalScale: new T.Vector2(0.9, 0.9) }, o || {}));
      const M = {
        skin: mk(P.skin, { roughness: 0.55, metalness: 0 }),
        lip: mk(0x8a4e3a, { roughness: 0.6, metalness: 0 }),
        hair: mk(P.hair, { roughness: 0.8, metalness: 0 }),
        top: mkT(P.vest, 'brown_leather', 2, { roughness: 0.7, metalness: 0.05 }),        // dark sleeveless leather vest
        belt: mkT(P.beltC, 'brown_leather', 2, { roughness: 0.6, metalness: 0.05 }),
        cloth: mkT(P.cloth, 'leather_white', 1.4, { roughness: 0.6, metalness: 0, side: T.DoubleSide }),   // team colour
        pants: mkT(P.pants, 'rough_linen', 3, { roughness: 0.92, metalness: 0, side: T.DoubleSide }),
        greave: mkT(0xa23c2a, 'leather_white', 1.4, { roughness: 0.5, metalness: 0.05 }),
        metal: mkT(0xd0d0d0, 'metal_plate', 1, { roughness: 0.35, metalness: 0.75 }),
        glove: mkT(0x3b2a1f, 'brown_leather', 1.5, { roughness: 0.7, metalness: 0 }),          // archer's shooting glove
        wood: mkT(0x6a4527, 'brown_leather', 1, { roughness: 0.5, metalness: 0.05 }),          // bow limbs / arrow shafts
        string: mk(0xe8e0cc, { roughness: 0.6, metalness: 0 }),
        feather: mk(0xe9e1cf, { roughness: 0.85, metalness: 0, side: T.DoubleSide }),
        quiver: mkT(0x7a4c2c, 'brown_leather', 1.5, { roughness: 0.65, metalness: 0.05 }),
        wrap: mkT(0x9c8a72, 'rough_linen', 2, { roughness: 0.95, metalness: 0 }),
        robe: mkT(P.vest, 'rough_linen', 3, { roughness: 0.88, metalness: 0, side: T.DoubleSide }),                 // mage cloth
        mantle: mkT(0x2b2224, 'rough_linen', 3, { roughness: 0.9, metalness: 0, side: T.DoubleSide }),
        staff: mkT(0x4a2e1b, 'brown_leather', 1, { roughness: 0.55, metalness: 0.05 }),
        orb: mk(0xffd2a0, { roughness: 0.15, metalness: 0, emissive: 0xff6a1e, emissiveIntensity: 1.2, transparent: true, opacity: 0.92 }),
        boot: mkT(0x3a281e, 'brown_leather', 1.5, { roughness: 0.75, metalness: 0 }),
        // sword
        trim: mk(P.trim, { metalness: 0.7, roughness: 0.3, flatShading: true }),
        dark: mk(P.dark, { metalness: 0.15, roughness: 0.6 }),
        armorDark: mk(0x4d5d72, { metalness: 0.5, roughness: 0.45, flatShading: true }),
        leather: mk(P.leather, { metalness: 0, roughness: 0.95 }),
        blade: mk(P.blade, { metalness: 0.75, roughness: 0.18, emissive: 0x151d27, flatShading: true }),
        gem: mk(P.gem, { metalness: 0.1, roughness: 0.2, emissive: 0x6a0f1c }),
      };
      this.M = M;

      const add = (parent, geo, mat, x, y, z) => {
        const m = new T.Mesh(geo, mat);
        m.position.set(x || 0, y || 0, z || 0);
        m.castShadow = true;
        parent.add(m);
        return m;
      };
      const grp = (parent, x, y, z) => {
        const g = new T.Group();
        g.position.set(x || 0, y || 0, z || 0);
        parent.add(g);
        return g;
      };
      const S = (r, w, h) => new T.SphereGeometry(r, w || 16, h || 12);
      const L = (pts, n) => lathe(pts, n || 16);

      const J = {};
      const root = new T.Group();
      const spin = J.spin = grp(root);
      const body = J.body = grp(spin);
      const hips = J.hips = grp(body, 0, 1.15, 0);

      // ---------- pelvis: baggy trousers seat, wide studded belt, team-coloured leather flaps ----------
      add(hips, L([[0.15, -0.22], [0.19, -0.12], [0.212, -0.02], [0.205, 0.06]]), M.pants).scale.z = 0.8;
      add(hips, L([[0.222, -0.03], [0.236, 0.05], [0.232, 0.16]], 18), M.belt).scale.z = 0.8;
      if (MAGE) {
        add(hips, cyl(0.055, 0.055, 0.025, 20), M.trim, 0, 0.065, 0.19).rotation.x = PI / 2;          // round gold buckle
        add(hips, S(0.024, 12, 10), M.gem, 0, 0.065, 0.205);
        const tie = add(hips, taperBox(0.07, 0.04, 0.3, 0.012), M.belt, 0.08, -0.1, 0.195); tie.rotation.z = 0.12;   // sash end
      } else {
      add(hips, box(0.17, 0.13, 0.03), M.metal, 0, 0.065, 0.188);
      add(hips, S(0.026, 10, 8), M.gem, 0, 0.065, 0.205);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * 2 * PI;
        if (Math.abs(Math.sin(a)) < 0.35 && Math.cos(a) > 0) continue;   // leave the front plate clear
        add(hips, S(0.013, 6, 5), M.metal, Math.sin(a) * 0.238, 0.065, Math.cos(a) * 0.238 * 0.8);
      }
      const flap = add(hips, taperBox(0.2, 0.25, 0.36, 0.022), M.cloth, 0, -0.17, 0.2); flap.rotation.x = -0.06;
      add(hips, box(0.25, 0.025, 0.03), M.metal, 0, -0.35, 0.21);
      const flapB = add(hips, taperBox(0.24, 0.28, 0.3, 0.022), M.cloth, 0, -0.14, -0.19); flapB.rotation.x = 0.06;
      }

      // ---------- torso: abdomen + chest under a sleeveless leather vest, bare shoulders, neck ----------
      const spine = J.spine = grp(hips, 0, 0.1, 0);
      const CH = 0.2;
      const chest = J.chest = grp(spine, 0, CH, 0);
      const addC = (geo, mat, x, y, z) => add(chest, geo, mat, x || 0, (y || 0) - CH, z || 0);   // authored in "waist" coordinates
      if (MAGE) {
        // short shoulder mantle over the robe (stops above the deltoids so raised arms stay clear), gold hem, hood on the back
        addC(L([[0.29, 0.535], [0.272, 0.6], [0.225, 0.668], [0.172, 0.706], [0.13, 0.728]], 32), M.mantle).scale.z = 0.74;
        addC(L([[0.288, 0.522], [0.296, 0.534], [0.29, 0.548]], 32), M.trim).scale.z = 0.74;
        const hood = addC(S(1, 18, 12), M.mantle, 0, 0.66, -0.165); hood.scale.set(0.15, 0.09, 0.085);
        addC(S(0.024, 12, 10), M.gem, 0, 0.625, 0.188);
        addC(cyl(0.034, 0.034, 0.012, 16), M.trim, 0, 0.625, 0.18).rotation.x = PI / 2;               // clasp
      } else {
      for (const sd of [-1, 1]) {                                   // vest straps over the shoulders
        const st = addC(box(0.075, 0.026, 0.38), M.top, sd * 0.15, 0.672, 0); st.rotation.z = sd * 0.35;
        addC(S(0.016, 6, 5), M.metal, sd * 0.13, 0.62, 0.17);
      }
      const bal = addC(box(0.055, 0.62, 0.028), M.belt, 0.0, 0.43, 0.212); bal.rotation.z = ARCH ? -0.62 : 0.62;   // baldric / quiver strap across the chest
      addC(S(0.03, 10, 8), M.metal, 0.0, 0.43, 0.228);
      const balB = addC(box(0.055, 0.62, 0.028), M.belt, 0.0, 0.43, -0.205); balB.rotation.z = ARCH ? 0.62 : -0.62;
      }

      // ---------- head: face, strong jaw, short hair, team headband; "plume" joint = short ponytail ----------
      const head = J.head = grp(chest, 0, 0.71 - CH, 0);
      head.scale.setScalar(1.3);
      M.face = mk(P.skin, { roughness: 0.55, metalness: 0, vertexColors: true });   // vertex-painted skin
      M.lid = mk(0x84502f, { roughness: 0.6, metalness: 0 });
      M.eyeW = mk(0xe4ddd2, { roughness: 0.3, metalness: 0 });
      M.iris = mk(0x2b1a10, { roughness: 0.2, metalness: 0 });
      const HG = headGeometries();
      add(head, HG.skin, M.face);
      add(head, HG.hair, M.hair);
      const hp = new T.Vector3(), hn = new T.Vector3();
      for (const sd of [-1, 1]) {
        // eye: ball set into the socket, dark iris, hooded upper lid
        headPoint(dirFace(sd * 0.34, 0.13), hp, hn);
        const ec = hp.clone().addScaledVector(hn, -0.008);
        add(head, S(0.0145, 14, 10), M.eyeW, ec.x, ec.y, ec.z);
        add(head, S(0.0078, 12, 8), M.iris, ec.x + hn.x * 0.0105, ec.y + hn.y * 0.0105, ec.z + hn.z * 0.0105);
        const lid = add(head, new T.SphereGeometry(0.0162, 16, 8, 0, 2 * PI, 0, PI * 0.42), M.lid, ec.x, ec.y, ec.z);
        lid.rotation.set(0.38, sd * 0.3, 0);
        // eyebrow on the brow ridge, inner end lower (stern)
        headPoint(dirFace(sd * 0.31, 0.29), hp, hn);
        const br = add(head, box(0.05, 0.011, 0.014), M.hair, hp.x + hn.x * 0.004, hp.y + hn.y * 0.004, hp.z + hn.z * 0.004);
        br.rotation.set(-0.15, sd * 0.35, sd * 0.2);
        // ear
        headPoint(new T.Vector3(sd, 0.02, -0.1).normalize(), hp, hn);
        const ear = add(head, S(0.03, 12, 10), M.face, hp.x + sd * 0.004, hp.y, hp.z); ear.scale.set(0.38, 1.0, 0.62); ear.rotation.y = -sd * 0.3;
        ear.geometry.setAttribute('color', new T.Float32BufferAttribute(new Array(ear.geometry.attributes.position.count * 3).fill(1), 3));
        const earIn = add(head, S(0.017, 10, 8), M.lid, hp.x + sd * 0.012, hp.y, hp.z + 0.004); earIn.scale.set(0.3, 0.9, 0.6);
      }
      for (let k = 0; k < 6; k++) {                                 // a few tufts on top for volume
        const a = -0.75 + k * 0.3, dd = new T.Vector3(Math.sin(a) * 0.35, 0.92, 0.1 + Math.cos(a) * 0.15).normalize();
        headPoint(dd, hp, hn);
        const t = hairThick(dd, 1);
        const tuft = add(head, cone(0.03, 0.07, 6), M.hair, hp.x + hn.x * t, hp.y + hn.y * t, hp.z + hn.z * t); tuft.rotation.set(-0.7, 0, -a * 0.6);
      }
      if (MAGE) {
        add(head, headBandGeometry(0.3, 0.355, 0.006), M.trim);                                    // gold circlet
        headPoint(dirFace(0, 0.33), hp, hn);
        const ct = hairThick(dirFace(0, 0.33), 1) + 0.012;
        add(head, S(0.017, 12, 10), M.orb, hp.x + hn.x * ct, hp.y + hn.y * ct, hp.z + hn.z * ct);
      } else add(head, headBandGeometry(0.27, 0.4, 0.003), M.cloth);                               // team headband
      const plume = J.plume = grp(head, 0, 0.25, -0.13);
      const tailL = MAGE ? 0.42 : ARCH ? 0.36 : 0.24, tailG = cone(ARCH || MAGE ? 0.05 : 0.04, tailL, 8); tailG.translate(0, -tailL / 2, 0);   // base at the joint, hangs down
      const tail = add(plume, tailG, M.hair, 0, 0, 0); tail.rotation.x = 0.45;

      // ---------- arms: bare muscular skin, silver bracers, wrapped wrists, fists ----------
      const arm = (side, key) => {
        const sx = side * 0.33;
        const sh = J['sh' + key] = grp(chest, sx * 0.92, 0.6 - CH, 0);
        sh.rotation.order = 'YXZ';
        const A = (pts) => L(pts.map((q) => [q[0], q[1] * ARM_SEG / 0.34]));                 // profiles authored for a 0.34 segment
        const el = J['el' + key] = grp(sh, 0, -ARM_SEG, 0);
        if (MAGE) {
          // bell cuff: the sleeve flares from mid-forearm and ends just past the wrist, gold hem
          add(el, L([[0.132, -0.395], [0.122, -0.36], [0.104, -0.31], [0.09, -0.25], [0.084, -0.19]], 20), M.robe);
          add(el, L([[0.131, -0.41], [0.138, -0.398], [0.128, -0.388]], 20), M.trim);
        } else {
        add(el, A([[0.068, -0.31], [0.077, -0.24], [0.091, -0.15], [0.094, -0.12]]), ARCH ? M.belt : M.metal);   // bracer / arm guard
        for (const [y, r] of [[-0.3, 0.072], [-0.135, 0.097]]) add(el, cyl(r, r, 0.02, 16), M.belt, 0, y * ARM_SEG / 0.34, 0);
        }
        const hand = J['wrist' + key] = grp(el, 0, -ARM_SEG, 0);
        if (!MAGE) add(hand, cyl(0.056, 0.056, 0.05, 12), M.wrap, 0, 0.01, 0);
        // fist: built around the grip axis (the sword's own axis), 0.1 below the wrist joint.
        // fist-local: +Z = grip axis (index finger at +Z, next to the guard), +Y = towards the wrist, out = back of the hand
        const fist = grp(hand, 0, -FIST_D, 0);
        fist.rotation.x = FIST_TILT;
        (this._fists = this._fists || {})[key] = fist;
        const out = side, HM = ARCH && key === 'R' ? M.glove : M.skin, empty = key === 'L' && !ARCH;
        add(fist, S(1, 16, 12), HM, out * 0.012, 0.056, 0).scale.set(0.031, 0.056, 0.05);        // back of the hand
        add(fist, S(1, 14, 10), HM, -out * 0.016, 0.042, 0.004).scale.set(0.026, 0.045, 0.045);  // palm
        const curl = empty ? 0.72 : 1;                                                           // empty fist curls tighter
        const capsule = (a, b, r0, r1) => {                                                             // tapered segment + rounded end
          const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
          const c = add(fist, cyl(r1, r0, len, 10), HM, (A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
          c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
          add(fist, S(r1, 10, 8), HM, B.x, B.y, B.z);
        };
        // each finger = 3 phalanges bending at the joints around the grip: knuckle (top-outer) -> under the grip -> tip on the palm side.
        // Fingers are thick enough to touch, so the fist reads as a block of fingers with grooves, not separate rings.
        const joint = (deg, r, z) => { const a = deg * PI / 180; return [out * Math.cos(a) * r * curl, Math.sin(a) * r * curl, z]; };
        [[0.032, 1.0], [0.0105, 1.04], [-0.0105, 0.98], [-0.031, 0.88]].forEach(([z, k]) => {
          const mcp = joint(55, 0.047 * k, z), pip = joint(-25, 0.047 * k, z), dip = joint(-100, 0.043 * k, z), tip = joint(-160, 0.036 * k, z);
          add(fist, S(0.0145 * k, 10, 8), HM, mcp[0], mcp[1], mcp[2]);                                  // knuckle
          capsule(mcp, pip, 0.0135 * k, 0.0128 * k);                                                    // proximal phalanx
          capsule(pip, dip, 0.0128 * k, 0.0118 * k);                                                    // middle phalanx
          capsule(dip, tip, 0.0118 * k, 0.0105 * k);                                                    // distal phalanx
        });
        const thumb = (a, b, r) => capsule(a, b, r, r * 0.92);
        const tp = (x, y, z) => [x * curl, y * (empty ? 0.85 : 1), z];                            // thumb hugs the tighter empty fist
        thumb(tp(-out * 0.036, 0.05, 0.03), tp(-out * 0.05, 0.012, 0.045), 0.0135);                   // thumb wraps over the index finger
        thumb(tp(-out * 0.05, 0.012, 0.045), tp(-out * 0.03, -0.014, 0.05), 0.012);
        if (empty) add(fist, cyl(0.02, 0.02, 0.08, 12), M.skin, 0, 0, 0).rotation.x = PI / 2;          // closed fist core (no hilt)
        return hand;
      };
      const handR = arm(-1, 'R');
      arm(1, 'L');
      J.shieldPivot = grp(J.elL, 0.125, -0.17, 0);                   // kept (empty) so older pose channels stay harmless

      // arrow: shaft along +Z (nock at z = 0), broadhead in front, three fletches at the back
      const makeArrow = () => {
        const g = new T.Group();
        const sh = add(g, cyl(0.0062, 0.0062, 0.8, 6), M.wood, 0, 0, 0.4); sh.rotation.x = PI / 2;
        const hd = add(g, cone(0.017, 0.07, 4), M.metal, 0, 0, 0.83); hd.rotation.x = PI / 2; hd.scale.set(1, 1, 0.35);
        add(g, S(0.009, 6, 4), M.trim, 0, 0, 0.005);
        for (let i = 0; i < 3; i++) {
          const a = i * 2 * PI / 3;
          const f = add(g, new T.PlaneGeometry(0.022, 0.1), M.feather, Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.1);
          f.rotation.set(0, PI / 2, 0); f.rotateX(a);
        }
        return g;
      };
      this.makeArrowMesh = makeArrow;
      this.sword = null; this._bladeMeshes = []; this._bow = null; this._staff = null;
      if (ARCH) {
        // ---------- recurve bow in the left hand. Bow-local: +Y along the grip (= fist axis), the string side is -Z ----------
        const bow = grp(J.wristL, 0, -FIST_D, 0);
        bow.rotation.set(1.8, PI, 0);   // same grip tilt as the sword, turned about the grip so the string (-Z) faces the archer
        const limbGeo = (pts) => new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(([y, z]) => new T.Vector3(0, y, z))), 72, 0.016, 6, false);
        const rest = [[-0.74, -0.12], [-0.68, -0.16], [-0.58, -0.15], [-0.4, -0.08], [-0.15, -0.02], [0, 0], [0.15, -0.02], [0.4, -0.08], [0.58, -0.15], [0.68, -0.16], [0.74, -0.12]];
        const drawn = [[-0.68, -0.3], [-0.63, -0.32], [-0.55, -0.28], [-0.38, -0.15], [-0.15, -0.03], [0, 0], [0.15, -0.03], [0.38, -0.15], [0.55, -0.28], [0.63, -0.32], [0.68, -0.3]];
        const gRest = limbGeo(rest), gDrawn = limbGeo(drawn);
        const limbs = add(bow, gRest, M.wood);
        add(bow, cyl(0.026, 0.026, 0.18, 10), M.leather);                                      // leather-wrapped grip
        add(bow, box(0.038, 0.34, 0.05), M.wood, 0, 0, 0.012);                                  // riser
        add(bow, box(0.012, 0.03, 0.03), M.trim, 0, 0.11, -0.004);                              // arrow rest
        const tipT = add(bow, S(0.013, 8, 6), M.trim), tipB = add(bow, S(0.013, 8, 6), M.trim);
        const sg = cyl(0.0034, 0.0034, 1, 5); sg.translate(0, 0.5, 0);                           // unit string segment, base at origin
        const strT = add(bow, sg, M.string), strB = add(bow, sg.clone(), M.string);
        const arrowN = makeArrow(); bow.add(arrowN);                                             // nocked arrow
        const arrowH = makeArrow(); this._fists.R.add(arrowH); arrowH.position.set(0, 0, -0.18); // arrow drawn from the quiver
        arrowN.visible = arrowH.visible = false;
        this._bow = { group: bow, limbs, rest: Float32Array.from(gRest.attributes.position.array), drawn: Float32Array.from(gDrawn.attributes.position.array),
          tipRest: new T.Vector3(0, 0.72, -0.14), tipDrawn: new T.Vector3(0, 0.66, -0.3), restNock: new T.Vector3(0, 0, -0.14),
          nock: new T.Vector3(0, 0, -0.14), nockV: new T.Vector3(), tipT, tipB, strT, strB, arrowN, arrowH, draw: 0 };
        // ---------- quiver on the back, opening above the right shoulder ----------
        const qv = grp(chest, -0.12, 0.42 - CH, -0.25); qv.rotation.set(-0.18, 0, 0.38);
        this._bow.quiver = qv;
        add(qv, L([[0.05, -0.32], [0.066, -0.29], [0.074, 0.0], [0.078, 0.28], [0.082, 0.3]]), M.quiver);
        add(qv, S(0.055, 10, 8), M.quiver, 0, -0.31, 0).scale.set(1, 0.5, 1);
        add(qv, new T.CylinderGeometry(0.085, 0.085, 0.022, 16, 1, true), M.trim, 0, 0.3, 0);
        for (const y of [-0.2, 0.15]) add(qv, cyl(0.08, 0.08, 0.025, 14), M.belt, 0, y, 0);
        for (let i = 0; i < 9; i++) {                                                            // arrows, fletching up
          const a = i * 2.4, r = 0.018 + (i % 3) * 0.017, ar = makeArrow();
          ar.scale.setScalar(0.85); ar.rotation.x = PI / 2;
          ar.position.set(Math.cos(a) * r, 0.44 + (i % 4) * 0.025, Math.sin(a) * r * 0.9);
          qv.add(ar);
        }
        this._bladeBase = new T.Vector3(0, 0.4, 0); this._bladeTip = new T.Vector3(0, 1.15, 0);
      } else if (MAGE) {
        // ---------- staff in the right hand. Staff-local +Y along the grip (= fist axis), the orb end is +Y ----------
        const staff = grp(handR, 0, -FIST_D, 0);
        staff.rotation.x = 1.8;                                                                  // same mount as the sword
        add(staff, cyl(0.021, 0.026, 1.94, 10), M.staff, 0, -0.25, 0);                           // shaft: y -1.22 .. 0.72
        for (let k = 0; k < 5; k++) {                                                            // knots along the shaft
          const kn = add(staff, S(0.03, 8, 6), M.staff, 0, -1.0 + k * 0.33 + (k % 2) * 0.05, 0); kn.scale.set(1, 0.6, 0.85);
        }
        const fer = add(staff, cone(0.03, 0.09, 8), M.metal, 0, -1.25, 0); fer.rotation.x = PI;  // iron foot
        add(staff, cyl(0.031, 0.031, 0.26, 12), M.leather, 0, 0.0, 0);                          // leather grip
        for (const y of [-0.14, 0.14, 0.5, 0.68]) add(staff, cyl(0.033, 0.033, 0.022, 14), M.trim, 0, y, 0);
        // head: four gold claws curl up and around the orb
        for (let k = 0; k < 4; k++) {
          const a = k * PI / 2 + PI / 4, cx = Math.cos(a), cz = Math.sin(a);
          const pts = [[0.02, 0.69], [0.06, 0.76], [0.1, 0.86], [0.09, 0.95], [0.05, 1.01], [0.018, 1.03]].map(([r, y]) => new T.Vector3(cx * r, y, cz * r));
          add(staff, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 20, 0.011, 6, false), M.trim);
        }
        add(staff, cone(0.034, 0.06, 10), M.trim, 0, 0.73, 0);
        const orb = add(staff, S(0.066, 24, 16), M.orb, 0, 0.9, 0);
        orb.castShadow = false;
        const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(), color: 0xff8a3a, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        glow.position.set(0, 0.9, 0); glow.scale.setScalar(0.3); staff.add(glow);
        const motes = [];
        for (let k = 0; k < 9; k++) {                                                            // charge motes spiralling into the orb
          const m = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(), color: k % 3 ? 0xffa040 : 0xffe2a0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
          m.visible = false; staff.add(m); motes.push(m);
        }
        this._staff = { group: staff, orb, glow, motes, t: 0, glowV: 0 };
        this._bladeBase = new T.Vector3(0, 0.4, 0); this._bladeTip = new T.Vector3(0, 1.15, 0);
      } else {
      // ---------- sword (right hand). Blade axis = sword-local +Y ----------
      const sword = grp(handR, 0, -FIST_D, 0.0);
      sword.rotation.x = 1.8;                                         // grip axis = fist axis (FIST_TILT = 1.8 - PI/2)
      sword.scale.setScalar(1.22);
      add(sword, cyl(0.027, 0.027, 0.26, 8), M.leather, 0, -0.03, 0);
      for (const y of [-0.1, -0.03, 0.04]) add(sword, cyl(0.032, 0.032, 0.016, 8), M.dark, 0, y, 0);
      add(sword, sph(0.052, 8, 6), M.trim, 0, -0.18, 0);
      add(sword, box(0.1, 0.07, 0.1), M.trim, 0, 0.115, 0);
      add(sword, sph(0.028, 6, 5), M.gem, 0, 0.12, 0.058);
      for (const sd of [-1, 1]) {
        const wg = add(sword, box(0.16, 0.045, 0.07), M.trim, sd * 0.14, 0.13, 0);
        wg.rotation.z = sd * 0.33;
      }
      const bladeMesh = add(sword, bladeGeometry(), M.blade, 0, 0.15, 0);
      const fuller = add(sword, new T.BoxGeometry(0.02, 0.6, 0.04, 1, 12, 1), M.armorDark, 0, 0.58, 0);
      this._bladeMeshes = [bladeMesh, fuller].map((mesh) => ({ mesh, y0: mesh.position.y, base: Float32Array.from(mesh.geometry.attributes.position.array) }));
      this.sword = sword;
      this._bladeBase = new T.Vector3(0, 0.4, 0);    // trail starts mid-blade and tapers toward the tip path as it ages
      this._bladeTip = new T.Vector3(0, 1.15, 0);
      }

      // ---------- legs: baggy trousers, red leather greaves with knee guards, ankle wraps, leather shoes ----------
      const leg = (side, key) => {
        const th = J['th' + key] = grp(hips, side * 0.14, -0.06, 0);
        const kn = J['kn' + key] = grp(th, 0, -0.5, 0);
        if (MAGE) {
          add(kn, L([[0.07, -0.45], [0.08, -0.36], [0.088, -0.22], [0.094, -0.12], [0.104, -0.05]]), M.boot).scale.z = 1.05;   // tall soft boots
          add(kn, cyl(0.106, 0.1, 0.03, 16), M.trim, 0, -0.06, 0);
        } else {
        add(kn, L([[0.07, -0.45], [0.082, -0.36], [0.09, -0.22], [0.094, -0.12], [0.1, -0.07]]), M.greave).scale.z = 1.05;
        add(kn, S(0.075, 14, 10), M.greave, 0, -0.06, 0.06).scale.set(1, 0.85, 0.65);              // knee guard
        for (const y of [-0.15, -0.37]) add(kn, cyl(0.095, 0.095, 0.022, 16), M.metal, 0, y, 0);
        add(kn, box(0.028, 0.26, 0.025), M.greave, 0, -0.27, 0.09);                                 // shin ridge
        }
        const an = J['an' + key] = grp(kn, 0, -0.5, 0);
        add(an, cyl(0.066, 0.072, 0.1, 12), M.wrap, 0, 0.01, 0);
        add(an, box(0.12, 0.07, 0.22), M.boot, 0, -0.05, 0.05);
        add(an, S(0.062, 12, 8), M.boot, 0, -0.06, 0.15).scale.set(1, 0.6, 1.1);
        add(an, box(0.14, 0.025, 0.28), M.dark, 0, -0.082, 0.06);
      };
      leg(1, 'L');
      leg(-1, 'R');

      // ---------- skinned body: ONE continuous skin per region bound to the joints (linear-blend skinning) ----------
      // Vertices near a joint blend between the two bones, so shoulders, elbows, wrists, neck, waist, hips and knees
      // bend as a surface instead of opening gaps between rigid pieces. Bind pose = construction pose (all rotations 0).
      root.updateMatrixWorld(true);
      const BONES = [hips, spine, chest, head, J.shL, J.elL, J.wristL, J.shR, J.elR, J.wristR, J.thL, J.knL, J.thR, J.knR];
      const BI = new Map(BONES.map((b, i) => [b, i]));
      const skeleton = new T.Skeleton(BONES);
      const wpos = (o) => o.getWorldPosition(new T.Vector3());
      // weights along a vertical chain: joints = [{ y, w, above, below }] from the top down
      const chainW = (y, top, joints) => {
        let b = top;
        for (const j of joints) {
          const t = sstep(j.y + j.w, j.y - j.w, y);
          if (t <= 0) return [[b, 1]];
          if (t < 1) return [[b, 1 - t], [j.below, t]];
          b = j.below;
        }
        return [[b, 1]];
      };
      // profile points: [radius, y] or [radius, y, zScale]; resampled with Catmull-Rom so the surface is smooth.
      // shape(y, phi) optionally scales the radius around the tube (muscle bulges); phi = 0 faces forward (+Z).
      const skinTube = (profile, cx, cz, sx, sz, segs, top, joints, mat, shape) => {
        const pts = profile.slice().sort((u, v) => u[1] - v[1]);   // bottom -> top keeps the lathe faces pointing outward
        const R = [], Y = [], Z = [], sub = 5;
        for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < (i === pts.length - 2 ? sub + 1 : sub); k++) {
          const t = k / sub, a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], d = pts[Math.min(i + 2, pts.length - 1)];
          const cr = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t * t * t);
          R.push(Math.max(0, cr(0))); Y.push(cr(1));
          const zs = (q) => (q[2] === undefined ? sz : q[2]);
          Z.push(0.5 * (2 * zs(b) + (-zs(a) + zs(c)) * t + (2 * zs(a) - 5 * zs(b) + 4 * zs(c) - zs(d)) * t * t + (-zs(a) + 3 * zs(b) - 3 * zs(c) + zs(d)) * t * t * t));
        }
        const n = R.length;
        const g = new T.LatheGeometry(R.map((r, j) => new T.Vector2(r, Y[j])), segs);
        const pos = g.attributes.position, si = [], sw = [];
        for (let i = 0; i < pos.count; i++) {
          const j = i % n, phi = (Math.floor(i / n) / segs) * 2 * PI;
          const m = shape ? shape(Y[j], phi) : 1;
          pos.setXYZ(i, pos.getX(i) * sx * m + cx, pos.getY(i), pos.getZ(i) * Z[j] * m + cz);
          const w = chainW(pos.getY(i), top, joints);
          si.push(BI.get(w[0][0]), w[1] ? BI.get(w[1][0]) : 0, 0, 0);
          sw.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
        }
        g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
        g.computeVertexNormals();
        const mesh = new T.SkinnedMesh(g, mat);
        mesh.castShadow = true; mesh.frustumCulled = false;
        root.add(mesh);
        mesh.bind(skeleton, new T.Matrix4());
        return mesh;
      };
      const gs = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
      M.skinS = mk(new T.Color(P.skin).multiplyScalar(0.88).getHex(), { roughness: 0.55, metalness: 0, skinning: true });   // matches the shaded face
      M.topS = MAGE ? mkT(P.vest, 'rough_linen', 3, { roughness: 0.88, metalness: 0, skinning: true }) : mkT(P.vest, 'brown_leather', 2, { roughness: 0.7, metalness: 0.05, skinning: true });
      M.pantsS = mkT(P.pants, 'rough_linen', 3, { roughness: 0.92, metalness: 0, side: T.DoubleSide, skinning: true });
      M.sleeveS = MAGE ? mkT(P.vest, 'rough_linen', 3, { roughness: 0.88, metalness: 0, skinning: true }) : M.skinS;
      const yH = wpos(hips).y, yS = wpos(spine).y, yC = wpos(chest).y, yHd = wpos(head).y;
      // vest: hips -> spine -> chest, broad flat V-taper
      skinTube([[0.205, yS - 0.02], [0.214, yS + 0.1], [0.226, yS + 0.18], [0.25, yS + 0.3], [0.275, yS + 0.44], [0.284, yS + 0.54], [0.264, yS + 0.61], [0.21, yS + 0.665], [0.16, yS + 0.69]],
        0, 0, 1, 0.66, 32, chest, [{ y: yC, w: 0.08, below: spine }, { y: yS, w: 0.07, below: hips }], M.topS);
      // trapezius slopes OUT TO THE SIDES only (flat front/back), short thick neck set slightly forward, merging into the head
      skinTube([[0.205, yS + 0.585, 0.6], [0.2, yS + 0.63, 0.62], [0.178, yS + 0.68, 0.66], [0.145, yS + 0.715, 0.78],
        [0.122, yHd + 0.025, 0.92], [0.112, yHd + 0.09, 0.95], [0.06, yHd + 0.16, 0.9], [0.0, yHd + 0.17, 0.9]],
        0, 0.008, 1, 0.9, 32, head, [{ y: yHd + 0.02, w: 0.05, below: chest }], M.skinS);
      // arms: deltoid -> biceps -> elbow -> forearm -> wrist, one surface with muscle bulges
      for (const [key, side] of [['L', 1], ['R', -1]]) {
        const sP = wpos(J['sh' + key]), s0 = sP.y, e = ARM_SEG;
        const muscles = (y, phi) => {
          const fr = Math.cos(phi), out = side * Math.sin(phi);
          return 1 + 0.13 * gs(y, s0 - 0.19, 0.075) * Math.pow(Math.max(0, fr), 1.5)         // biceps
                   + 0.08 * gs(y, s0 - 0.14, 0.08) * Math.pow(Math.max(0, -fr), 1.5)         // triceps
                   + 0.07 * gs(y, s0 - 0.02, 0.06) * Math.pow(Math.max(0, out), 2)           // deltoid cap
                   + 0.04 * gs(y, s0 - e - 0.1, 0.06) * Math.pow(Math.max(0, 0.7 * fr + 0.7 * out), 1.5);   // forearm extensors
        };
        skinTube([[0.0, s0 + 0.1], [0.062, s0 + 0.092], [0.1, s0 + 0.058], [0.11, s0 + 0.0], [0.103, s0 - 0.07], [0.094, s0 - 0.15], [0.092, s0 - 0.21],
          [0.082, s0 - 0.29], [0.071, s0 - e + 0.02], [0.068, s0 - e - 0.01], [0.073, s0 - e - 0.05], [0.08, s0 - e - 0.12], [0.077, s0 - e - 0.19],
          [0.064, s0 - 2 * e + 0.08], [0.056, s0 - 2 * e + 0.01], [0.051, s0 - 2 * e - 0.02]],
          sP.x + side * 0.008, sP.z, 1, 0.94, 32, chest,
          [{ y: s0 - 0.02, w: 0.06, below: J['sh' + key] }, { y: s0 - e, w: 0.05, below: J['el' + key] }, { y: s0 - 2 * e, w: 0.025, below: J['wrist' + key] }], M.sleeveS, MAGE ? ((y, phi) => 1.1 + 0.5 * (muscles(y, phi) - 1)) : muscles);
      }
      // trouser legs: hip -> thigh -> knee, tucked into the greaves
      for (const [key, side] of [['L', 1], ['R', -1]]) {
        const tP = wpos(J['th' + key]), kY = wpos(J['kn' + key]).y;
        skinTube([[0.125, yH + 0.02], [0.132, tP.y - 0.01], [0.143, tP.y - 0.14], [0.146, tP.y - 0.25], [0.136, tP.y - 0.37], [0.122, kY + 0.04], [0.112, kY - 0.01], [0.104, kY - 0.06], [0.098, kY - 0.1]],
          tP.x, tP.z, MAGE ? 0.84 : 1, MAGE ? 0.84 : 1, 24, hips, [{ y: tP.y - 0.04, w: 0.07, below: J['th' + key] }, { y: kY, w: 0.06, below: J['kn' + key] }], M.pantsS);
      }

      if (MAGE) {
        // ROBE SKIRT: one cloth surface from the sash to below the knees. Each side hangs from its thigh (blending to the
        // hips at the waist and across the centre line), the lower BACK also follows the shin so a running heel kick
        // pushes the hem back instead of poking through it.
        const kL = wpos(J.knL).y, sk = [[0.238, yH + 0.06], [0.262, yH - 0.03], [0.3, yH - 0.16], [0.318, yH - 0.32], [0.33, yH - 0.48], [0.342, kL - 0.06], [0.352, kL - 0.2]];
        const segs = 40, rows = 24, pos = [], uv = [], si = [], sw = [], idx = [];
        const crv = (t) => {                                                                     // Catmull-Rom through the profile
          const f = t * (sk.length - 1), i = Math.min(Math.floor(f), sk.length - 2), u = f - i;
          const a = sk[Math.max(i - 1, 0)], b = sk[i], c = sk[i + 1], d = sk[Math.min(i + 2, sk.length - 1)];
          const cr = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u * u + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * u * u * u);
          return [cr(0), cr(1)];
        };
        const iH = BI.get(hips), iTL = BI.get(J.thL), iTR = BI.get(J.thR), iKL = BI.get(J.knL), iKR = BI.get(J.knR);
        for (let r = 0; r <= rows; r++) {
          const [rad, y] = crv(r / rows);
          for (let k = 0; k <= segs; k++) {
            const phi = (k / segs) * 2 * PI, x = Math.sin(phi) * rad, z = Math.cos(phi) * rad * 0.8;
            pos.push(x, y, z); uv.push(k / segs * 3, r / rows * 2);
            const tw = sstep(yH + 0.02, yH - 0.22, y);                                           // waist -> thighs
            const sL = sstep(-0.035, 0.035, x);                                                  // which leg (x > 0 = left): narrow centre seam
            const kw = sstep(kL + 0.12, kL - 0.12, y) * sstep(0.02, -0.18, z) * 0.75;            // lower back follows the shin
            const dom = sL >= 0.5, wDom = tw * (dom ? sL : 1 - sL), wOth = tw * (dom ? 1 - sL : sL);
            si.push(iH, dom ? iTL : iTR, dom ? iTR : iTL, dom ? iKL : iKR);
            sw.push(1 - tw, wDom * (1 - kw), wOth, wDom * kw);
          }
        }
        for (let r = 0; r < rows; r++) for (let k = 0; k < segs; k++) {
          const a = r * (segs + 1) + k, b = a + segs + 1;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
        g.setIndex(idx); g.computeVertexNormals();
        M.robeS = mkT(P.vest, 'rough_linen', 3, { roughness: 0.88, metalness: 0, side: T.DoubleSide, skinning: true });
        const skirt = new T.SkinnedMesh(g, M.robeS); skirt.castShadow = true; skirt.frustumCulled = false;
        root.add(skirt); skirt.bind(skeleton, new T.Matrix4());
        // gold hem band along the bottom edge (same skinning as the last rows)
        const hg = new T.BufferGeometry(), hp2 = [], hsi = [], hsw = [], hidx = [], base = (rows - 1) * (segs + 1);
        for (let r = 0; r < 2; r++) for (let k = 0; k <= segs; k++) {
          const src = base + r * (segs + 1) + k;
          const out = 1.012;
          hp2.push(pos[src * 3] * out, r ? pos[src * 3 + 1] : pos[src * 3 + 1] - 0.0, pos[src * 3 + 2] * out);
          for (let c = 0; c < 4; c++) { hsi.push(si[src * 4 + c]); hsw.push(sw[src * 4 + c]); }
        }
        for (let k = 0; k < segs; k++) hidx.push(k, k + 1, k + segs + 1, k + 1, k + segs + 2, k + segs + 1);
        hg.setAttribute('position', new T.Float32BufferAttribute(hp2, 3)); hg.setAttribute('skinIndex', new T.Uint16BufferAttribute(hsi, 4));
        hg.setAttribute('skinWeight', new T.Float32BufferAttribute(hsw, 4)); hg.setIndex(hidx); hg.computeVertexNormals();
        M.trimS = mk(P.trim, { metalness: 0.7, roughness: 0.3, side: T.DoubleSide, skinning: true });
        const hem = new T.SkinnedMesh(hg, M.trimS); hem.frustumCulled = false; root.add(hem); hem.bind(skeleton, new T.Matrix4());
      }

      // ---------- HeroModel (heromodel.js): anatomy v2 replaces the legacy body / clothing meshes above ----------
      // Same rig, joint names, pose channels, IK and weapons; it only sets bind-pose proportions (pelvis height, leg
      // length -> this.legLen, shoulder width, neck) and builds new skinned geometry. new Knight({ model: 'legacy' })
      // keeps the old meshes (side-by-side comparison: compare.html).
      this.legLen = LEG;
      this.model = 'legacy';
      if (global.HeroModel && P.model !== 'legacy') {
        global.HeroModel.build({ knight: this, J, M, P, cls: CLS, mk, mkT });
        this.model = global.HeroModel.version;
      }

      for (const k of ['hips', 'spine', 'chest', 'head']) J[k].rotation.order = 'YXZ';

      /* ---- fx ---- */
      this.fxRing = new T.Mesh(new T.RingGeometry(0.85, 1.1, 28), new T.MeshBasicMaterial({ color: 0xffd878, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
      this.fxRing.rotation.x = -PI / 2; this.fxRing.position.set(0, 0.04, 0);
      root.add(this.fxRing);
      this.trail = new Trail();
      this.slash = new SlashVFX();                             // designed slash effects (add knight.slash.group to the scene)

      this.root = root;
      this.J = J;
      this.base = {};
      for (const k in J) {
        const o = J[k];
        this.base[k] = { px: o.position.x, py: o.position.y, pz: o.position.z, rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z };
      }

      // state
      this.time = 0;
      this.realTime = 0;
      this.runPhase = 0;
      this.cur = {};
      this._prev = {};
      this._tmp = {};
      this.action = null;     // { name, def, t (logical), vt (visual), bt (blend time), blend, from (snapshot), hit: [Set per window] }
      this.buffered = false;  // attack press buffered for the chain point
      this.combo = -1;
      this.sinceAttack = 99;
      this.hitStopT = 0;      // VISUAL hit-stop only: gameplay (logical clock, windows, damage, movement) keeps running
      // configurable controller tuning
      this.attackSpeed = 1.08; // scales every attack uniformly (shape is authored on a normalized timeline)
      this.comboReset = 0.55; // seconds after an attack ends during which the next press continues the combo
      this.hitTargets = [];   // [{ id, pos: Vector3 (ground point), radius, height, alive?: () => bool }]
      this._out = {};
      this._sec = {
        yaw: 0, rp: new T.Vector3(), fwdSlow: 0, bpy: 0, init: false,
        cape: { x: 0, v: 0 }, cape2: { x: 0, v: 0 }, capeZ: { x: 0, v: 0 }, plume: { x: 0, v: 0 }, plumeY: { x: 0, v: 0 },
        shield: { x: 0, v: 0 }, recoil: { x: 0, v: 0 },
      };
      this._bl = { prev: [0, 1, 2, 3, 4].map(() => new T.Vector3()), now: [0, 1, 2, 3, 4].map(() => new T.Vector3()), c1: new T.Vector3(), c2: new T.Vector3(), a: new T.Vector3(), b: new T.Vector3(), d: new T.Vector3() };
      this._bladeY = [0.2, 0.45, 0.7, 0.95, 1.17];   // sample points along the blade (sword-local Y)
      this._contact = { L: 1, R: 1 };
      this.flash = 0;
      this.dead = false;
      this.onEvent = null;
      this.triangles = 0;
      this._v1 = new T.Vector3(); this._v2 = new T.Vector3();
      const V = () => new T.Vector3(), Q = () => new T.Quaternion();
      const ikScratch = () => ({
        S_b: V(), H_b: V(), B: V(), Tn: V(), d: V(), h: V(), pole: V(), u: V(), E: V(), Hact: V(), f: V(),
        X: V(), Y: V(), Z: V(), Xw: V(), Yw: V(), Zw: V(), m: new T.Matrix4(), inv: new T.Matrix4(),
        qS: Q(), qE: Q(), qEl: Q(), qSw: Q(), qH: Q(), qW: Q(), qa: Q(),
        ax: V().set(1, 0, 0),
        qSwordInv: new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -1.8),   // weapon mount on the fist axis
      });
      this._ik = ikScratch();
      this._ikL = ikScratch();
      this._lk = {
        invSpin: new T.Matrix4(), H: V(), A: V(), d: V(), h: V(), pole: V(), u: V(), K: V(), Aact: V(), f: V(),
        X: V(), Y: V(), Z: V(), m: new T.Matrix4(), qSp: Q(), qHp: Q(), qHrel: Q(), qThS: Q(), qTh: Q(), qKn: Q(), qFoot: Q(), qYaw: Q(), qPitch: Q(), qBend: Q(),
        ax: V().set(1, 0, 0), ay: V().set(0, 1, 0),
      };
      root.traverse((o) => {
        if (o.isMesh && o.geometry) {
          const g = o.geometry;
          this.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
        }
      });
      this._applyPose(this.evalPose('idle', 0));
    }

    // calls cb once every embedded texture has decoded (immediately if there are none)
    whenReady(cb) { if (this._texPending > 0) this._texCbs.push(cb); else cb(); }

    setTeam(name) { this.M.cloth.color.setHex((TEAMS[name] || TEAMS.blue).cloth); }

    /* ==================== MeleeAnimationController ==================== */

    get busy() { return !!this.action; }
    // movement input is allowed when idle, or in an attack's move-cancel window (unless a combo press is buffered)
    get canMove() {
      const a = this.action;
      if (this.dead) return false;
      if (!a) return true;
      return !!(a.def.attack && !this.buffered && a.t >= a.def.move * a.def.dur);
    }
    // { name, u, phase, active } for UI / debugging
    get attackState() {
      const a = this.action;
      if (!a || !a.def.profile) return null;
      const d = a.def, u = a.t / d.dur, P = d.phases;
      const phase = u < P.antic ? 'anticipation' : u < P.contact ? 'acceleration' : u < P.follow ? 'follow-through' : 'recovery';
      const active = d.hitWinN.some((w) => u >= w[0] && u <= w[1]);
      return { name: a.name, label: d.label, u, vu: a.vt / d.dur, phase, active, combo: this.combo, buffered: this.buffered };
    }

    play(name, opts) {
      if (name === 'special' && this.cls === 'archer') name = 'volley';
      if (name === 'special' && this.cls === 'mage') name = 'meteor';
      const def = ONE_SHOT[name];
      if (!def) return;
      if (this.dead && name !== 'die') return;
      if (name === 'die') this.dead = true;
      opts = opts || {};
      // CombatAnimationBlender: cross-fade from whatever the body is doing right now (never snap to idle)
      const from = Object.assign({}, this.cur);
      from['spin.ry'] = wrapAngle(from['spin.ry'] || 0);
      this.cur['spin.ry'] = from['spin.ry'];
      const t0 = (opts.skip || 0) * def.dur;
      this.action = {
        name, def, t: t0, vt: t0, bt: 0, from, slashed: {},
        blend: opts.blend !== undefined ? opts.blend : (def.blendIn !== undefined ? def.blendIn : 0.08),
        hit: (def.hitWin || []).map(() => new Set()), bladeWin: -1, bladeValid: false, hits: 0,
        rate: opts.rate || 1, tag: opts.tag || null,            // skill bar: play-rate multiplier + skill id (copied into events)
      };
      this.buffered = false;
      this.trail.mat.uniforms.uColor.value.setHex(def.trailColor || 0xbfe4ff);
      if (def.attack) this.sinceAttack = 0;
      this._fx(null, 0);
    }

    revive() { this.dead = false; this.action = null; this.buffered = false; this.trail.clear(); }

    // Attack button. Starts / continues the 4-hit combo. Returns true if a swing started now.
    attack() {
      if (this.dead) return false;
      const a = this.action;
      if (a) {
        const d = a.def;
        if (!d.attack || a.tag) return false;                // skills / hit reactions are not combo-cancellable
        const u = a.t / d.dur;
        if (u >= d.chain) { this._chain(); return true; }    // already past the chain point: go now
        if (u >= d.buffer) this.buffered = true;             // early press: remember it until the chain point
        return false;
      }
      const list = this.comboList || COMBO;
      this.combo = this.sinceAttack < this.comboReset ? (this.combo + 1) % list.length : 0;
      this.play(list[this.combo]);
      return true;
    }
    _chain() {
      const list = this.comboList || COMBO;
      this.combo = (this.combo + 1) % list.length;
      const name = list[this.combo];
      this.play(name, { skip: ONE_SHOT[name].chainSkip });
    }
    _endAction() {
      this.action = null;
      this.buffered = false;
      this.cur['spin.ry'] = wrapAngle(this.cur['spin.ry'] || 0);
      this._fx(null, 0);
    }

    // Deterministic target pose for an animation by name / local time (seconds of its base timeline).
    evalPose(name, t) {
      if (name === 'idle') return withPose(withPose(ST, IDLE_REST), idleOsc(t));
      if (name === 'run') return runPose(t * 11);
      if (name === 'walk') return LOCO ? walkPose(t * 2 * PI / LOCO.walk.dur) : runPose(t * 11);
      const def = ONE_SHOT[name];
      if (def.profile) return profilePose(def, t);
      const p = def.noIdle ? withPose(ST, {}) : withPose(ST, idleOsc(t));   // no breathing on a corpse
      for (const k in def.tracks) p[k] = (p[k] || 0) + seq(t, def.tracks[k]);
      if (def.abs) for (const k in def.abs) p[k] = seq(t, def.abs[k]);
      if (def.shieldHold) {
        const yaw = (p['hips.ry'] - ST['hips.ry']) + (p['spine.ry'] - ST['spine.ry']) + (p['chest.ry'] - ST['chest.ry']);
        p['shL.ry'] -= yaw * def.shieldHold;
      }
      if (def.swing) Object.assign(p, def.swing.eval(t));
      return p;
    }
    _lungeAt(def, t) { return def.profile && def.lunge ? def.lunge(clamp01(t / def.dur)) : 0; }

    // action pose at visual time vt, cross-faded from the entry snapshot during the first `blend` seconds
    _actionPose(a, vt, bt) {
      const p = this.evalPose(a.name, vt);
      if (!(a.blend > 0) || bt >= a.blend) return p;
      const u = clamp01(bt / a.blend), w = u * u * (3 - 2 * u), f = a.from;
      for (const k in p) { if (k in f) p[k] = f[k] + (p[k] - f[k]) * w; }
      return p;
    }

    // Snap to a pose instantly (debug / screenshots / thumbnails).
    debugPose(name, t) {
      this.cur = this.evalPose(name, t);
      const st0 = name === 'run' || name === 'walk' ? 'run' : (ONE_SHOT[name] ? 'action' : 'idle');
      if (this.cls === 'archer') this._archerArms(this.cur, st0);
      else if (this.cls === 'mage') this._mageArms(this.cur, st0);
      this._applyPose(this.cur); this._applyIK(this.cur);
      const def = ONE_SHOT[name];
      this._fx(def || null, t);
      this.flash = def && def.flash && t < 0.25 ? 1 : 0;
      this._flash();
    }
    // Draw the whole blade arc of an attack as a static trail (for tuning).
    debugArc(name, steps) {
      const def = ONE_SHOT[name];
      if (!def || !def.trail) return;
      this.trail.clear();
      this.trail.mat.uniforms.uColor.value.setHex(def.trailColor || 0xbfe4ff);
      const n = steps || 40;
      for (let i = 0; i <= n; i++) {
        const t = def.trail.t0 + (def.trail.t1 - def.trail.t0) * (i / n);
        this.cur = this.evalPose(name, t);
        this._applyPose(this.cur); this._applyIK(this.cur);
        this._sampleBlade(0);
      }
      this.trail.update(0, 999);
    }
    // Deterministic samples of a whole action in the ROOT frame at its start (root motion included):
    // [{ t, u, tip, base, hand, ankleL, ankleR, cL, cR }]. Used by the debug preview / analyzer.
    sampleTrajectory(name, n) {
      const def = ONE_SHOT[name];
      if (!def || !this.sword) return [];
      const r = this.root, p0 = r.position.clone(), ry = r.rotation.y, out = [], V = T.Vector3;
      r.position.set(0, 0, 0); r.rotation.y = 0;
      for (let i = 0; i <= n; i++) {
        const t = def.dur * i / n;
        r.position.z = this._lungeAt(def, t);
        const p = this.evalPose(name, t);
        this._applyPose(p); this._applyIK(p);
        out.push({
          t, u: t / def.dur,
          tip: this.sword.localToWorld(new V(0, 1.17, 0)), base: this.sword.localToWorld(new V(0, 0.2, 0)),
          hand: this.J.wristR.getWorldPosition(new V()), ankleL: this.J.anL.getWorldPosition(new V()), ankleR: this.J.anR.getWorldPosition(new V()),
          cL: p['fL.c'], cR: p['fR.c'],
        });
      }
      r.position.copy(p0); r.rotation.y = ry;
      this._applyPose(this.cur); this._applyIK(this.cur);
      return out;
    }

    bladeTipWorld(out) {
      if (!this.sword) return this.J.wristR.getWorldPosition(out);
      this.root.updateMatrixWorld(true);
      return this.sword.localToWorld(out.copy(this._bladeTip));
    }

    _sampleBlade(time) {
      if (!this.sword) return;
      this.root.updateMatrixWorld(true);
      const bd = this._bp ? this._bp.bend : null;
      const b = this.sword.localToWorld(this._v1.copy(this._bladeBase));
      const t = this.sword.localToWorld(this._v2.copy(this._bladeTip));
      if (bd) {   // re-sample the bent blade: base at its bend fraction, tip fully bent
        const fb = bendF(this._bladeBase.y), ft = bendF(this._bladeTip.y);
        b.copy(this.sword.localToWorld(this._v1.copy(this._bladeBase).add(new T.Vector3(bd.x * fb, 0, bd.z * fb))));
        t.copy(this.sword.localToWorld(this._v2.copy(this._bladeTip).add(new T.Vector3(bd.x * ft, 0, bd.z * ft))));
      }
      this.trail.push(b, t, time);
    }

    _emit(e) { if (e.skill === undefined) e.skill = this.action ? this.action.tag : null; if (this.onEvent) this.onEvent(e); }

    // world-space blade tip / hilt path over an attack's active window (deterministic pose replay incl. root motion)
    _slashArc(a, w) {
      const d = a.def, SW = d.slashWin || d.hitWin, ws = SW[w][0], we = SW[w][1], r = this.root, n = 40, V = T.Vector3;
      const p0 = r.position.clone(), fx = Math.sin(r.rotation.y), fz = Math.cos(r.rotation.y), L0 = this._lungeAt(d, a.vt);
      const P = [], H = [];
      for (let i = 0; i <= n; i++) {
        const t = ws + (we - ws) * i / n, L = this._lungeAt(d, t) - L0;
        r.position.set(p0.x + fx * L, p0.y, p0.z + fz * L);
        const pose = this.evalPose(a.name, t);
        this._applyPose(pose); this._applyIK(pose);
        P.push(this.sword.localToWorld(new V(0, 1.2, 0)));
        H.push(this.sword.localToWorld(new V(0, 0.25, 0)));
      }
      r.position.copy(p0);
      this._applyPose(this.cur); this._applyIK(this.cur);
      return { P, H };
    }

    // input: { move: 0..1 (run intensity) }
    update(dt, input) {
      input = input || {};
      this.realTime += dt;
      this.time += dt;
      const frozen = this.hitStopT > 0;                       // visual hit-stop this frame
      if (frozen) this.hitStopT = Math.max(0, this.hitStopT - dt);
      if (this.action && this.action.def.attack) this.sinceAttack = 0; else this.sinceAttack += dt;

      let target = null, rate = 12, direct = false, trailing = false;
      let vt0 = 0, bt0 = 0;
      const a = this.action;
      if (a) {
        const d = a.def, sp = (d.attack ? this.attackSpeed : 1) * (a.rate || 1);
        const t0 = a.t;
        // LOGICAL clock: gameplay timing (hit windows, buffer / chain / cancel windows, events). Never frozen.
        a.t = Math.min(a.t + dt * sp, d.dur);
        // VISUAL clock: slowed during hit-stop, then catches up (presentation only)
        vt0 = a.vt; bt0 = a.bt;
        if (frozen) { a.vt += dt * sp * 0.03; a.bt += dt * 0.03; }
        else { a.vt += dt * sp * (a.vt < a.t - 1e-4 ? 1.7 : 1); a.bt += dt; }
        a.vt = Math.min(a.vt, a.t);
        // root motion follows the visual clock so planted feet never slide on screen
        const dL = this._lungeAt(d, a.vt) - this._lungeAt(d, vt0);
        if (dL !== 0) {
          const yaw = this.root.rotation.y;
          this.root.position.x += Math.sin(yaw) * dL;
          this.root.position.z += Math.cos(yaw) * dL;
        }
        if (d.hitWin && this.hitTargets.length) this._detectHits(a, t0, a.t);
        if (d.profile && d.hitWin) for (let w = 0; w < d.hitWin.length; w++) {
          const SW = d.slashWin || d.hitWin, at = SW[w][0] - 0.02 * d.dur;
          if (!a.slashed[w] && a.vt >= at) {
            a.slashed[w] = true;
            const arc = this._slashArc(a, w);
            this.slash.spawn(arc.P, arc.H, d.trailColor, (SW[w][1] - SW[w][0]) / sp, d.power || 1);
          }
        }
        this._events(a, t0, a.t);
        target = this._actionPose(a, a.vt, a.bt);
        direct = true;
        this._fx(d, a.vt);
        if (d.flash && a.vt < 0.06) this.flash = 1;
        trailing = !!(d.trail && a.vt >= d.trail.t0 && vt0 <= d.trail.t1);
      } else if (input.move > 0.05) {
        // ground speed (m/s): drives both the gait blend and the cadence (the planted foot moves at ground speed)
        const speed = input.speed !== undefined ? input.speed : RUN_SPEED * input.move;
        const w = clamp01((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
        const stride = LOCO ? WALK_CYCLE_STRIDE + (RUN_CYCLE_STRIDE - WALK_CYCLE_STRIDE) * w : RUN_CYCLE_STRIDE;
        this.runPhase += dt * 2 * PI * Math.max(speed, 0.4) / stride;
        target = locoPose(this.runPhase, speed);
        rate = 16;
      } else {
        target = this.evalPose('idle', this.time);
      }
      // locomotion state timer: smoothing is only for the transition INTO a state; once settled the pose is exact
      // (a permanent filter makes stance feet lag their targets = foot skating at every touchdown)
      const lk = a ? 'action' : input.move > 0.05 ? 'run' : 'idle';
      if (lk !== this._locoKey) { this._locoKey = lk; this._locoT = 0; } else this._locoT += dt;
      if (this.cls === 'archer') this._archerArms(target, lk);
      else if (this.cls === 'mage') this._mageArms(target, lk);

      const cur = this.cur;
      if (direct) {   // actions are evaluated exactly (their entry cross-fade is already in the pose): no over-smoothing
        for (const key in target) cur[key] = target[key];
        const k = 1 - Math.exp(-20 * dt);
        for (const key in cur) if (!(key in target)) cur[key] += ((ST[key] || 0) - cur[key]) * k;
      } else {        // locomotion / idle: exponential follow while entering the state, fading to exact evaluation
        const settle = clamp01(this._locoT / 0.3), k = Math.max(1 - Math.exp(-rate * dt), settle * settle * (3 - 2 * settle));
        for (const key in target) {
          if (!(key in cur)) cur[key] = target[key];
          cur[key] += (target[key] - cur[key]) * k;
        }
        for (const key in cur) if (!(key in target)) cur[key] += ((ST[key] || 0) - cur[key]) * k;
      }

      // WeaponTrailRenderer: sub-step the true (curved) swing between last frame and this one
      if (trailing) {
        const n = 8;
        for (let s = 1; s <= n; s++) {
          const u = s / n;
          const p = this._actionPose(a, vt0 + (a.vt - vt0) * u, bt0 + (a.bt - bt0) * u);
          this._rotBlade(p);                                   // trail follows the simulated (physical) blade
          this._applyPose(p); this._applyIK(p);
          this._sampleBlade(this.realTime - dt + dt * u);
        }
      }

      // presentation layers on top of the animation: secondary motion, weapon accents
      const out = Object.assign({}, cur);
      this._secondary(dt, out, frozen);
      this._footLock(dt, out, !this.action);                   // locomotion: planted feet pinned to the ground
      this._footPlanner(dt, out, this._locoKey === 'idle');      // idle: feet stay put and STEP to their stance spots
      if (this.groundAt) this._footGround(dt, out);              // walkable hills: each foot rides the terrain under it (optional hook)
      this._applyPose(out); this._applyIK(out);
      this._bladePhysics(dt, out, frozen);                     // inertia / whip / settle of the blade (re-solves the arm)
      this._updateBow(dt, out, frozen);                         // archer: string / limbs / arrows
      this._updateStaff(dt, out, frozen);                       // mage: orb glow / charge motes
      this._footEvents(out);
      this.trail.update(this.realTime, 0.22);
      this.slash.update(frozen ? dt * 0.03 : dt, this.realTime);

      this.flash = Math.max(0, this.flash - dt * 7);
      this._flash();

      // state transitions (after the pose is composed, so the next action's snapshot is this frame's pose)
      if (a && this.action === a) {
        const d = a.def, u = a.t / d.dur;
        if (d.attack && this.buffered && u >= d.chain) this._chain();
        else if (d.attack && !this.buffered && input.move > 0.05 && u >= d.move) this._endAction();   // attack -> movement
        else if (a.t >= d.dur && !d.hold) { const q = this.buffered && d.attack; this._endAction(); if (q) this._chain(); }
      }
    }

    // gameplay events on the logical clock: 'swing' (wind-up released: whoosh), 'impact' (contact moment)
    _events(a, t0, t1) {
      const d = a.def;
      if (d.swingAt !== undefined && t0 < d.swingAt && t1 >= d.swingAt) {
        this._emit({ type: 'swing', name: a.name, def: d, combo: this.combo, sound: d.attack ? (d.power > 1.5 ? 'whoosh_heavy' : 'whoosh') : 'whoosh_spin' });
      }
      const imp = d.impact === undefined ? [] : (Array.isArray(d.impact) ? d.impact : [d.impact]);
      for (let k = 0; k < imp.length; k++) {
        if (t0 < imp[k] && t1 >= imp[k]) this._emit({ type: 'impact', name: a.name, def: d, index: k, count: imp.length, connected: a.hits > 0 });
      }
    }

    // footplant events (visual pose): dust / footstep sound hooks
    _footEvents(p) {
      for (const k of FEET) {
        const c = p['f' + k + '.c'] !== undefined ? p['f' + k + '.c'] : (p['f' + k + '.y'] < 0.004 ? 1 : 0);
        if (c && !this._contact[k] && this.action) {
          const pos = this.J['an' + k].getWorldPosition(new T.Vector3());
          pos.y = 0;
          this._emit({ type: 'footplant', foot: k, name: this.action.name, heavy: !!this.action.def.slam, position: pos, sound: 'step_plate' });
        }
        this._contact[k] = c;
      }
    }

    /* ==================== MeleeHitDetector ==================== */
    // Blade samples on the LOGICAL clock (deterministic pose eval), swept between samples at >= 240 Hz,
    // tested against vertical target capsules. Each target is hit at most once per hit window.
    _detectHits(a, t0, t1) {
      const d = a.def, W = d.hitWin, B = this._bl;
      for (let w = 0; w < W.length; w++) {
        const lo = Math.max(t0, W[w][0]), hi = Math.min(t1, W[w][1]);
        if (hi < lo) continue;
        if (a.bladeWin !== w) { a.bladeWin = w; a.bladeValid = false; }
        const n = Math.max(1, Math.ceil((hi - lo) * 240));
        for (let s = a.bladeValid ? 1 : 0; s <= n; s++) {
          const t = lo + (hi - lo) * (s / n);
          this._bladeAt(a, t, B.now);
          if (a.bladeValid) this._sweep(a, w, B.prev, B.now);
          const tmp = B.prev; B.prev = B.now; B.now = tmp;
          a.bladeValid = true;
        }
      }
      // restore the visual pose (detection moved the joints)
      this._applyPose(this.cur); this._applyIK(this.cur);
    }
    _bladeAt(a, t, out) {
      const p = this.evalPose(a.name, t);
      this._applyPose(p); this._applyIK(p);
      // logical root position: the root follows the visual clock, so add the root-motion difference back
      const dL = this._lungeAt(a.def, t) - this._lungeAt(a.def, a.vt), yaw = this.root.rotation.y;
      const ox = Math.sin(yaw) * dL, oz = Math.cos(yaw) * dL;
      for (let i = 0; i < out.length; i++) {
        this.sword.localToWorld(out[i].set(0, this._bladeY[i], 0));
        out[i].x += ox; out[i].z += oz;
      }
    }
    _sweep(a, w, P, Q) {
      const B = this._bl, d = a.def, rp = this.root.position;
      for (const tg of this.hitTargets) {
        if (a.hit[w].has(tg) || (tg.alive && !tg.alive())) continue;
        B.a.set(tg.pos.x, tg.pos.y, tg.pos.z);
        B.b.set(tg.pos.x, tg.pos.y + (tg.height || 2), tg.pos.z);
        const r2 = (tg.radius || 0.4) * (tg.radius || 0.4);
        let hitI = -1;
        for (let i = Q.length - 1; i >= 0 && hitI < 0; i--) if (segSegDist2(P[i], Q[i], B.a, B.b, B.c1, B.c2) <= r2) hitI = i;   // swept points
        if (hitI < 0 && segSegDist2(Q[0], Q[Q.length - 1], B.a, B.b, B.c1, B.c2) <= r2) hitI = Q.length - 1;                // blade overlap
        if (hitI < 0) continue;
        if (!validateMeleeHit({ x: rp.x, z: rp.z, yaw: this.root.rotation.y }, { x: tg.pos.x, z: tg.pos.z, radius: tg.radius || 0.4 }, d)) continue;
        a.hit[w].add(tg);
        a.hits++;
        const dir = B.d.copy(Q[hitI]).sub(P[hitI]);
        if (dir.lengthSq() < 1e-10) dir.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
        dir.normalize();
        this.hitStopT = Math.max(this.hitStopT, d.hitstop || 0);
        this._sec.recoil.v += 7 * Math.min(1.5, d.power || 1);
        this._bladeKick(dir, d.power);                       // blade rebounds off the target
        this._emit({ type: 'hit', name: a.name, def: d, target: tg, point: B.c1.clone(), dir: dir.clone(), power: d.power || 1, combo: this.combo, window: w, sound: d.slam ? 'impact_heavy' : 'impact' });
      }
    }

    /* ==================== archer: arms outside the shot, bow simulation, arrow launch ==================== */
    // Outside shot/volley the archer carries the bow at his left side (bow-arm IK) and lets the right hand hang free.
    _archerArms(p, state) {
      if (p['ikL.w'] > 0.5) return;                            // shot / volley drive both arms themselves
      p['ikL.w'] = p['ik.w'] === undefined ? 1 : p['ik.w'];    // the death fades both arms to FK together
      if (state === 'run') {
        // running: the bow arm pumps opposite the right leg like a free arm (elbow bent, hand forward-and-up on the
        // forward swing) and carries the bow diagonally - upper limb forward/up, lower limb back/down, clear of the legs
        const sw = -Math.cos(this.runPhase || 0);              // +1 = left arm fully forward (opposite the left leg)
        p['ikL.hx'] = 0.07 - 0.03 * sw; p['ikL.hy'] = -0.43 + 0.07 * Math.max(0, sw); p['ikL.hz'] = 0.08 + 0.17 * sw;
        p['ikL.bx'] = 0.08; p['ikL.by'] = 0.6 + 0.08 * sw; p['ikL.bz'] = 0.79; p['ikL.tx'] = -1; p['ikL.ty'] = 0; p['ikL.tz'] = 0;
        p['ikL.rpw'] = 1; p['ikL.rpx'] = 0.18; p['ikL.rpy'] = -0.5; p['ikL.rpz'] = -1;   // run pole: elbow back, close to the body
        // empty right hand: a runner's arm - elbow ~90deg pointing back, hand passing close by the hip, fist forward-up on
        // the forward swing and just behind the hip on the back swing (the warrior's sword carry kept the hand out wide)
        const sr = -sw;                                          // +1 = right arm forward
        p['ik.hx'] = 0.07 + 0.03 * sr; p['ik.hy'] = -0.43 + 0.08 * Math.max(0, sr); p['ik.hz'] = 0.07 + 0.19 * sr;
        p['ik.bx'] = 0.25; p['ik.by'] = 0.45 + 0.1 * sr; p['ik.bz'] = 0.85; p['ik.tx'] = 1; p['ik.ty'] = 0; p['ik.tz'] = 0;
        p['ik.rpw'] = 1; p['ik.rpx'] = -0.18; p['ik.rpy'] = -0.5; p['ik.rpz'] = -1;
      } else {
        // standing: bow upright along the hanging forearm (it is symmetric)
        p['ikL.hx'] = 0.1; p['ikL.hy'] = -0.56; p['ikL.hz'] = 0.14;
        p['ikL.bx'] = 0.06; p['ikL.by'] = -0.95; p['ikL.bz'] = 0.3; p['ikL.tx'] = GA.eLI[0]; p['ikL.ty'] = GA.eLI[1]; p['ikL.tz'] = GA.eLI[2];   // string to the back (the bow mesh is turned for the shot); the z part keeps run<->idle blends from passing through a zero edge
      }
      if (state === 'idle') {
        p['ik.hx'] = GA.h[0]; p['ik.hy'] = GA.h[1]; p['ik.hz'] = GA.h[2];
        p['ik.bx'] = GA.b[0]; p['ik.by'] = GA.b[1]; p['ik.bz'] = GA.b[2]; p['ik.tx'] = 1; p['ik.ty'] = 0; p['ik.tz'] = 0;
      }
      p['bow.hold'] = 0; p['bow.arrow'] = 0;
    }
    // String: held at the draw hand while drawing, otherwise a stiff damped spring back to brace height (it vibrates
    // after the release). Limbs flex with the draw. The nocked arrow rides the string; the drawn arrow sits in the hand.
    _updateBow(dt, p, frozen) {
      const Bw = this._bow;
      if (!Bw) return;
      const V = T.Vector3;
      this.root.updateMatrixWorld(true);                       // hands, quiver and bow all read world matrices below
      const hold = (p['bow.hold'] || 0) > 0.5, arrow = p['bow.arrow'] || 0;
      if (hold) {
        const loc = Bw.group.worldToLocal(this._fists.R.localToWorld(new V(0, 0, -0.02)));
        loc.x *= 0.25;                                          // the string stays close to the bow plane
        if (loc.z > -0.14) loc.z = -0.14;
        if (loc.length() > 0.92) loc.setLength(0.92);
        Bw.nock.copy(loc); Bw.nockV.set(0, 0, 0);
      } else if (!frozen && dt > 0) {
        const w = 70, z = 0.1, n = 8, h = Math.min(dt, 1 / 30) / n;
        for (let i = 0; i < n; i++) {
          const acc = Bw.restNock.clone().sub(Bw.nock).multiplyScalar(w * w).addScaledVector(Bw.nockV, -2 * z * w);
          Bw.nockV.addScaledVector(acc, h); Bw.nock.addScaledVector(Bw.nockV, h);
        }
      }
      const d = clamp01((-Bw.nock.z - 0.14) / 0.55);
      if (Math.abs(d - Bw.draw) > 1e-4) {                       // limbs flex with the draw
        const pos = Bw.limbs.geometry.attributes.position, A = pos.array;
        for (let i = 0; i < A.length; i++) A[i] = Bw.rest[i] + (Bw.drawn[i] - Bw.rest[i]) * d;
        pos.needsUpdate = true; Bw.limbs.geometry.computeVertexNormals();
        Bw.draw = d;
      }
      const tT = Bw.tipRest.clone().lerp(Bw.tipDrawn, d), tB = tT.clone(); tB.y = -tB.y;
      Bw.tipT.position.copy(tT); Bw.tipB.position.copy(tB);
      const seg = (m, a, b) => { const v = b.clone().sub(a); m.position.copy(a); m.scale.set(1, v.length(), 1); m.quaternion.setFromUnitVectors(new V(0, 1, 0), v.normalize()); };
      seg(Bw.strT, tT, Bw.nock); seg(Bw.strB, tB, Bw.nock);
      Bw.arrowH.visible = arrow > 0.5 && arrow < 1.5;
      if (Bw.arrowH.visible) {
        // the draw hand pinches the arrow just behind the fletching: it comes out of the quiver head-DOWN (as it sat),
        // then swings forward over the shoulder until the head points past the bow's arrow rest
        const fist = this._fists.R, lay = clamp01(p['bow.lay'] || 0), e = lay * lay * (3 - 2 * lay);
        const fw = fist.localToWorld(new V(0, 0, -0.01));
        const down = new V(0, -1, 0).transformDirection(Bw.quiver.matrixWorld);
        const toRest = Bw.group.localToWorld(new V(0, 0.07, 0)).sub(fw).normalize();
        const dir = down.multiplyScalar(1 - e).addScaledVector(toRest, e);
        if (dir.lengthSq() < 1e-6) dir.copy(toRest);
        dir.normalize();
        const qW = new T.Quaternion().setFromUnitVectors(new V(0, 0, 1), dir);
        const qF = fist.getWorldQuaternion(new T.Quaternion()).invert();
        Bw.arrowH.quaternion.copy(qF.multiply(qW));
        Bw.arrowH.position.copy(fist.worldToLocal(fw.addScaledVector(dir, -0.05)));   // nock 5 cm behind the pinch
      }
      Bw.arrowN.visible = arrow >= 1.5;
      if (Bw.arrowN.visible) {
        const dir = new V(0, 0.07, 0.0).sub(Bw.nock).normalize();   // nock -> arrow rest
        Bw.arrowN.position.copy(Bw.nock);
        Bw.arrowN.quaternion.setFromUnitVectors(new V(0, 0, 1), dir);
      }
    }
    // Mage outside his spells: staff upright at the right side (standing) or carried diagonally, top forward, swinging
    // with the run (the free left arm keeps the locomotion FK). Idle breathing offsets are kept.
    _mageArms(p, state) {
      if (state === 'action') {
        // the hit reaction is authored for the sword (blade flung back): on the mage it laid the staff flat across the body.
        // Keep the staff upright; the hand only follows half of the recoil and the staff tips back with it.
        const a = this.action;
        if (!a || a.name !== 'hit') return;
        const oy = (p['ik.hy'] - G.h[1]) * 0.5, oz = (p['ik.hz'] - G.h[2]) * 0.5;
        p['ik.hx'] = MG.h[0]; p['ik.hy'] = MG.h[1] + oy; p['ik.hz'] = MG.h[2] + oz;
        p['ik.bx'] = MG.b[0]; p['ik.by'] = MG.b[1]; p['ik.bz'] = MG.b[2] + oz * 1.2; p['ik.tx'] = MG.e[0]; p['ik.ty'] = MG.e[1]; p['ik.tz'] = MG.e[2];
        return;
      }
      if (state === 'run') {
        const c1 = Math.cos(this.runPhase || 0);              // +1 = right arm forward
        p['ik.hx'] = -0.15 + 0.02 * c1; p['ik.hy'] = -0.44 + 0.05 * Math.max(0, c1); p['ik.hz'] = 0.12 + 0.13 * c1;
        p['ik.bx'] = -0.06; p['ik.by'] = 0.62 + 0.06 * c1; p['ik.bz'] = 0.78; p['ik.tx'] = 1; p['ik.ty'] = 0; p['ik.tz'] = 0;
      } else {
        const oy = (p['ik.hy'] || ST['ik.hy']) - ST['ik.hy'], oz = (p['ik.hz'] || ST['ik.hz']) - ST['ik.hz'];
        p['ik.hx'] = MG.h[0]; p['ik.hy'] = MG.h[1] + oy; p['ik.hz'] = MG.h[2] + oz;
        p['ik.bx'] = MG.b[0]; p['ik.by'] = MG.b[1]; p['ik.bz'] = MG.b[2]; p['ik.tx'] = MG.e[0]; p['ik.ty'] = MG.e[1]; p['ik.tz'] = MG.e[2];
      }
      p['orb.glow'] = 0;
    }
    // Orb: a slow idle pulse, brightening with 'orb.glow'; while charging, motes spiral in from around the orb.
    _updateStaff(dt, p, frozen) {
      const S = this._staff;
      if (!S) return;
      if (!frozen) S.t += dt;
      const g = clamp01(p['orb.glow'] || 0), pulse = 0.5 + 0.5 * Math.sin(S.t * 3.1);
      S.glowV += (g - S.glowV) * (1 - Math.exp(-dt * 25));
      const G = S.glowV;
      S.glow.scale.setScalar(0.3 + 0.62 * G + 0.05 * pulse);
      S.glow.material.opacity = Math.min(1, 0.55 + 0.45 * G);
      S.orb.material.emissiveIntensity = 1.0 + 0.35 * pulse + 2.4 * G;
      S.motes.forEach((m, i) => {
        m.visible = G > 0.04;
        if (!m.visible) return;
        const f = ((S.t * 1.5 + i / S.motes.length) % 1), r = 0.34 * (1 - f) + 0.04, a = S.t * (4 + i * 0.37) + i * 2.1;
        m.position.set(Math.cos(a) * r, 0.9 + Math.sin(a * 1.3 + i) * r * 0.6, Math.sin(a) * r);
        m.scale.setScalar((0.035 + 0.03 * f) * (0.6 + G));
        m.material.opacity = G * Math.min(1, f * 3) * 0.9;
      });
    }
    // world position of the orb + the staff's pointing direction (the fireball is launched from here)
    staffLaunch() {
      if (!this._staff) return null;
      this.root.updateMatrixWorld(true);
      const pos = this._staff.orb.getWorldPosition(new T.Vector3());
      const dir = new T.Vector3(0, 1, 0).transformDirection(this._staff.group.matrixWorld);
      return { pos, dir };
    }
    // world position + direction of the nocked arrow (used to launch the projectile on release)
    arrowLaunch() {
      if (!this._bow) return null;
      this.root.updateMatrixWorld(true);
      const a = this._bow.arrowN, pos = a.getWorldPosition(new T.Vector3());
      const dir = new T.Vector3(0, 0, 1).transformDirection(a.matrixWorld);
      return { pos, dir };
    }

    /* ==================== idle foot planner ====================
     * Outside idle it only tracks where the feet really are. In idle the feet do not slide: each stays on its world spot,
     * and a foot that is off its stance spot / angle (or still in the air when the knight stops) takes a step there -
     * lift, carry, plant - one foot at a time. Also makes turning on the spot step instead of twisting the feet. */
    _footPlanner(dt, p, idle) {
      const V = T.Vector3, mk = () => ({ w: new V(), yaw: 0, y: 0, step: null, ideal: new V(), idealYaw: 0 });
      const FP = this._fp || (this._fp = { L: mk(), R: mk(), init: false });
      this.root.updateMatrixWorld(true);
      const M = this.root.matrixWorld, ry = this.root.rotation.y;
      if (!idle || !FP.init) {
        for (const k of FEET) {
          const F = FP[k];
          F.w.set(p['f' + k + '.x'], 0, p['f' + k + '.z']).applyMatrix4(M); F.w.y = 0;
          F.yaw = (p['f' + k + '.r'] || 0) + ry; F.y = Math.max(0, p['f' + k + '.y'] || 0); F.step = null;
        }
        FP.init = true;
        if (!idle) return;
      }
      for (const k of FEET) {
        const F = FP[k];
        F.ideal.set(p['f' + k + '.x'], 0, p['f' + k + '.z']).applyMatrix4(M); F.ideal.y = 0;
        F.idealYaw = (p['f' + k + '.r'] || 0) + ry;
      }
      if (!FEET.some((k) => FP[k].step)) {                     // one foot steps at a time: pick the one that needs it most
        let best = null, bestE = 0;
        for (const k of FEET) {
          const F = FP[k];
          const e = F.w.distanceTo(F.ideal) + 0.25 * Math.abs(wrapAngle(F.idealYaw - F.yaw)) + (F.y > 0.01 ? 1 : 0);
          if (e > bestE) { bestE = e; best = k; }
        }
        if (best && bestE > 0.05) { const F = FP[best]; F.step = { t: 0, dur: 0.26, from: F.w.clone(), fromYaw: F.yaw, fromY: F.y }; }
      }
      for (const k of FEET) {
        const F = FP[k];
        let pitch = 0;
        if (F.step) {
          const S = F.step; S.t += dt;
          const u = clamp01(S.t / S.dur), e = u * u * (3 - 2 * u);
          F.w.copy(S.from).lerp(F.ideal, e);
          F.yaw = S.fromYaw + wrapAngle(F.idealYaw - S.fromYaw) * e;
          F.y = S.fromY * (1 - e) + 0.08 * Math.sin(PI * u);
          pitch = 0.2 * Math.sin(PI * u) - 0.1 * sstep(0.7, 1, u) * (1 - u) * 4;
          if (u >= 1) { F.step = null; F.y = 0; }
          if (u >= 1 && this.onEvent && this.action === null) this._emit({ type: 'footplant', foot: k, name: 'idle', heavy: false, position: F.w.clone(), sound: 'step_plate' });
        }
        const loc = this.root.worldToLocal(F.w.clone());
        p['f' + k + '.x'] = loc.x; p['f' + k + '.z'] = loc.z; p['f' + k + '.y'] = F.y; p['f' + k + '.r'] = F.yaw - ry; p['f' + k + '.p'] = pitch;
      }
    }

    /* ==================== foot ground offset (walkable hills) ====================
     * Optional hook: knight.groundAt(x, z) = ground height in the SAME frame as root.position.y (the open world keeps the
     * hero at y = 0 and shifts the world, see village/scene.js). The rig plants feet in the character frame at y = 0 (flat
     * ground); here each foot target is raised / lowered by the slope under it (smoothed, clamped to what the legs can do).
     * Contact flags are fixed BEFORE the offset so footplant events / dust do not change. */
    _footGround(dt, p) {
      const g = this.groundAt, S = this._fgS || (this._fgS = { L: 0, R: 0 }), v = this._fgV || (this._fgV = new T.Vector3());
      this.root.updateMatrixWorld(true);
      const k1 = 1 - Math.exp(-dt * 20);
      for (const k of FEET) {
        const x = p['f' + k + '.x'], z = p['f' + k + '.z']; if (x === undefined) continue;
        if (p['f' + k + '.c'] === undefined) p['f' + k + '.c'] = (p['f' + k + '.y'] || 0) < 0.004 ? 1 : 0;
        v.set(x, 0, z).applyMatrix4(this.root.matrixWorld);
        const dy = Math.max(-0.2, Math.min(0.28, g(v.x, v.z) - this.root.position.y));
        S[k] += (dy - S[k]) * k1;
        p['f' + k + '.y'] = (p['f' + k + '.y'] || 0) + S[k];
      }
    }

    /* ==================== runtime foot locking (locomotion) ====================
     * A foot that touches down (pose contact flag) remembers its spot in the world and is pinned there while planted,
     * whatever the gait blend / cadence does; after lift-off the remaining offset fades out during the swing. */
    _footLock(dt, p, active) {
      const V = T.Vector3;
      const FL = this._fl || (this._fl = { L: { on: false, a: new V(), off: new V() }, R: { on: false, a: new V(), off: new V() } });
      this.root.updateMatrixWorld(true);
      for (const k of FEET) {
        const S = FL[k], c = active && p['f' + k + '.c'] > 0.5;
        if (p['f' + k + '.x'] === undefined) continue;
        const local = new V(p['f' + k + '.x'], 0, p['f' + k + '.z']);
        if (c && !S.on) S.a.copy(local).add(S.off).applyMatrix4(this.root.matrixWorld);   // plant: remember the world spot
        if (c) {
          const want = this.root.worldToLocal(S.a.clone());
          S.off.set(want.x - local.x, 0, want.z - local.z);
          if (S.off.length() > 0.4) { S.off.set(0, 0, 0); S.a.copy(local).applyMatrix4(this.root.matrixWorld); }   // teleport / sharp turn safety
        } else S.off.multiplyScalar(Math.exp(-dt * 12));                                    // release during the swing
        S.on = c;
        p['f' + k + '.x'] += S.off.x; p['f' + k + '.z'] += S.off.z;
      }
    }

    /* ==================== blade physics (presentation only) ====================
     * The blade BENDS: the tip is a damped spring-mass chasing the rigid tip position, and its offset (perpendicular
     * to the blade) is spread along the blade with a cantilever profile - zero at the hilt, full at the tip. While the
     * blade moves fast the tip trails its rigid position in proportion to its speed ("the tip arrives later"); when the
     * swing stops it catches up, overshoots and settles. Capped, frozen by hit-stop, hits add a rebound.
     * Hit detection keeps using the straight authored blade. */
    _bladePhysics(dt, p, frozen) {
      if (!this.sword) return;
      const V = T.Vector3;
      const B = this._bp || (this._bp = { Tp: new V(), V: new V(), q: new T.Quaternion(), wq: new T.Quaternion(), init: false, bend: new V(), maxBend: 0 });
      B.q.identity();
      if (!(p['ik.w'] > 0.5)) { B.init = false; B.bend.set(0, 0, 0); this._applyBend(); return; }
      const tgt = this.sword.localToWorld(this._bladeTip.clone());
      if (!B.init || B.Tp.distanceTo(tgt) > 1.2) { B.Tp.copy(tgt); B.V.set(0, 0, 0); B.bend.set(0, 0, 0); B.init = true; this._applyBend(); return; }
      if (!frozen && dt > 0) {
        // tip velocity expressed in the sword's own frame; only the part across the blade bends it
        const vW = tgt.clone().sub(B.Tp).divideScalar(Math.max(dt, 1e-4));
        this.sword.getWorldQuaternion(B.wq);
        const vL = vW.applyQuaternion(B.wq.invert()).divideScalar(this.sword.scale.x);
        const LAG = 0.0042, w = 22, z = 0.28;                    // tip trails by speed * LAG; bend spring (overshoot ~40%)
        const goal = new V(-vL.x * LAG, 0, -vL.z * LAG);
        const h = Math.min(dt, 1 / 30), steps = Math.max(1, Math.ceil(h / (1 / 240))), sub = h / steps;
        for (let i = 0; i < steps; i++) {
          const acc = goal.clone().sub(B.bend).multiplyScalar(w * w).addScaledVector(B.V, -2 * z * w);
          B.V.addScaledVector(acc, sub);
          B.bend.addScaledVector(B.V, sub);
        }
        const MAXB = 0.22;                                       // sword-local units (~0.27 m at the tip)
        if (B.bend.length() > MAXB) { B.bend.setLength(MAXB); B.V.multiplyScalar(0.5); }
        B.maxBend = Math.max(B.maxBend, B.bend.length() * this.sword.scale.x);
      }
      B.Tp.copy(tgt);
      this._applyBend();
    }
    // hit rebound: kick the bend opposite the blade's travel (world direction)
    _bladeKick(dirW, power) {
      if (!this._bp || !this._bp.init) return;
      const q = this.sword.getWorldQuaternion(new T.Quaternion()).invert();
      const d = dirW.clone().applyQuaternion(q); d.y = 0;
      this._bp.V.addScaledVector(d, 3.0 * Math.min(1.5, power || 1));
    }
    _applyBend() {
      const b = this._bp ? this._bp.bend : null;
      for (const m of this._bladeMeshes) {
        const pos = m.mesh.geometry.attributes.position, base = m.base;
        for (let i = 0; i < pos.count; i++) {
          const f = b ? bendF(base[3 * i + 1] + m.y0) : 0;
          pos.setXYZ(i, base[3 * i] + (b ? b.x * f : 0), base[3 * i + 1], base[3 * i + 2] + (b ? b.z * f : 0));
        }
        pos.needsUpdate = true;
      }
    }
    _rotBlade(p) {
      if (!this._bp || p['ik.bx'] === undefined) return;
      const q = this._bp.q, b = new T.Vector3(p['ik.bx'], p['ik.by'], p['ik.bz']).applyQuaternion(q), t = new T.Vector3(p['ik.tx'], p['ik.ty'], p['ik.tz']).applyQuaternion(q);
      p['ik.bx'] = b.x; p['ik.by'] = b.y; p['ik.bz'] = b.z; p['ik.tx'] = t.x; p['ik.ty'] = t.y; p['ik.tz'] = t.z;
    }

    /* ==================== secondary motion + weapon accents (presentation only) ==================== */
    _secondary(dt, p, frozen) {
      const S = this._sec;
      if (frozen) {   // hit-stop: everything holds, the weapon buzzes from the impact
        const j = 0.009 * (this.hitStopT > 0 ? 1 : 0);
        p['ik.hx'] += (Math.random() - 0.5) * j; p['ik.hy'] += (Math.random() - 0.5) * j; p['ik.hz'] += (Math.random() - 0.5) * j;
      } else if (dt > 0) {
        const yaw = this.root.rotation.y + (p['spin.ry'] || 0) + p['hips.ry'] + p['spine.ry'] + p['chest.ry'];
        const rp = this.root.position;
        if (!S.init) { S.yaw = yaw; S.rp.copy(rp); S.bpy = p['body.py']; S.bpz = p['body.pz']; S.init = true; }
        const yawRate = clamp(wrapAngle(yaw - S.yaw) / dt, -30, 30);
        const fy = this.root.rotation.y;
        const fwd = clamp(((rp.x - S.rp.x) * Math.sin(fy) + (rp.z - S.rp.z) * Math.cos(fy) + (p['body.pz'] - S.bpz)) / dt, -10, 10);
        const vy = clamp((p['body.py'] - S.bpy) / dt, -6, 6);
        S.yaw = yaw; S.rp.copy(rp); S.bpy = p['body.py']; S.bpz = p['body.pz'];
        S.fwdSlow += (fwd - S.fwdSlow) * (1 - Math.exp(-3 * dt));
        const surge = fwd - S.fwdSlow;                       // change in forward speed (lunges, stops)
        const spring = (s, target, w, z) => {                // semi-implicit damped spring
          s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * dt;
          s.x += s.v * dt;
        };
        spring(S.cape, clamp(0.04 * surge - 0.06 * vy, -0.3, 0.5), 13, 0.4);
        spring(S.cape2, clamp(0.06 * surge - 0.08 * vy, -0.3, 0.6), 9, 0.35);
        spring(S.capeZ, clamp(-0.022 * yawRate, -0.35, 0.35), 11, 0.45);
        spring(S.plume, clamp(0.035 * surge - 0.07 * vy, -0.35, 0.5), 15, 0.35);
        spring(S.plumeY, clamp(0.018 * yawRate, -0.4, 0.4), 14, 0.35);
        spring(S.shield, clamp(-0.02 * yawRate, -0.3, 0.3), 12, 0.5);
        spring(S.recoil, 0, 26, 0.45);
      }
      p['cape.rx'] = (p['cape.rx'] || 0) + S.cape.x;
      p['cape2.rx'] = (p['cape2.rx'] || 0) + S.cape2.x;
      p['cape.rz'] = (p['cape.rz'] || 0) + S.capeZ.x;
      p['plume.rx'] = (p['plume.rx'] || 0) + S.plume.x;
      p['plume.ry'] = (p['plume.ry'] || 0) + S.plumeY.x;
      p['shL.ry'] = (p['shL.ry'] || 0) + S.shield.x;
      if (p['ik.hz'] !== undefined) {                        // impact recoil: blade kicks back a little, chest absorbs it
        const r = S.recoil.x;
        p['ik.hz'] -= 0.06 * r; p['ik.hy'] += 0.03 * r; p['chest.rx'] -= 0.04 * r;
      }
    }

    _applyIK(p) {
      this.root.updateMatrixWorld(true);
      this._applyLegs(p);
      this._applyArm(p, 'R');
      if (p['ikL.w'] > 0.002) this._applyArm(p, 'L');           // bow arm (archer)
      // IK changed joint rotations after the world matrices were computed: refresh them, so anything reading world
      // positions right after a solve (swept hit detection, trajectory sampling) sees the solved pose, not the FK one.
      this.J.hips.updateMatrixWorld(true);
    }

    // Two-bone IK for both legs. Feet are ground targets in the character frame (root > spin): x/y/z, yaw r, pitch p (toes down).
    _applyLegs(p) {
      const w = p['leg.w'];
      if (!(w > 0.002)) return;
      const I = this._lk, J = this.J, LEG = this.legLen || 0.5;   // thigh = shin length of this model's rig
      J.spin.updateWorldMatrix(true, false);
      I.invSpin.copy(J.spin.matrixWorld).invert();
      J.spin.getWorldQuaternion(I.qSp);
      J.hips.getWorldQuaternion(I.qHp);
      I.qHrel.copy(I.qSp).invert().multiply(I.qHp).invert();   // inverse of the pelvis orientation expressed in the character frame
      for (const k of ['L', 'R']) {
        const th = J['th' + k], kn = J['kn' + k], an = J['an' + k];
        const yaw = p['f' + k + '.r'], pitch = p['f' + k + '.p'];
        th.rotation.set(p['th' + k + '.rx'] || 0, 0, p['th' + k + '.rz'] || 0); kn.rotation.set(p['kn' + k + '.rx'] || 0, 0, 0); an.rotation.set(0, 0, 0);
        I.H.setFromMatrixPosition(th.matrixWorld).applyMatrix4(I.invSpin);
        I.A.set(p['f' + k + '.x'], p['f' + k + '.y'] + ANKLE_H, p['f' + k + '.z']);
        I.d.copy(I.A).sub(I.H);
        let dist = I.d.length();
        if (dist < 1e-5) continue;
        I.h.copy(I.d).multiplyScalar(1 / dist);
        dist = clamp(dist, 0.3, 2 * LEG * 0.997);
        // knee points the way the foot points
        I.pole.set(Math.sin(yaw), 0, Math.cos(yaw));
        I.pole.addScaledVector(I.h, -I.pole.dot(I.h));
        if (I.pole.lengthSq() < 1e-6) I.pole.set(0, 0, 1);
        I.pole.normalize();
        const cosA = clamp(dist / (2 * LEG), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
        I.u.copy(I.h).multiplyScalar(cosA).addScaledVector(I.pole, sinA);          // thigh direction
        I.K.copy(I.H).addScaledVector(I.u, LEG);
        I.Aact.copy(I.H).addScaledVector(I.h, dist);
        I.f.copy(I.Aact).sub(I.K).normalize();                                     // shin direction
        const cosB = clamp(I.u.dot(I.f), -1, 1), beta = Math.acos(cosB);
        I.Z.copy(I.f).addScaledVector(I.u, -cosB).negate();
        if (I.Z.lengthSq() < 1e-8) { I.Z.copy(I.pole).addScaledVector(I.u, -I.pole.dot(I.u)); }
        I.Z.normalize();
        I.Y.copy(I.u).negate();
        I.X.crossVectors(I.Y, I.Z);
        I.m.makeBasis(I.X, I.Y, I.Z);
        I.qThS.setFromRotationMatrix(I.m);
        I.qTh.copy(I.qHrel).multiply(I.qThS);
        th.quaternion.slerp(I.qTh, w);
        kn.rotation.x += (beta - kn.rotation.x) * w;
        // foot: yaw + pitch in the character frame, un-rotated through the shin
        I.qBend.setFromAxisAngle(I.ax, beta);
        I.qKn.copy(I.qThS).multiply(I.qBend).invert();
        I.qYaw.setFromAxisAngle(I.ay, yaw);
        I.qPitch.setFromAxisAngle(I.ax, pitch);
        I.qFoot.copy(I.qKn).multiply(I.qYaw).multiply(I.qPitch);
        an.quaternion.slerp(I.qFoot, w);
      }
    }

    // Two-bone IK for the sword arm: the hand goes where the swing path says, the blade points along its own path.
    // Two-bone IK for an arm. side 'R' reads the ik.* channels (weapon hand), 'L' the ikL.* channels (bow hand).
    // Optional <prefix>.px/py/pz = elbow pole direction in the character frame (e.g. the archer's high draw elbow).
    _applyArm(p, side) {
      side = side || 'R';
      const pre = side === 'L' ? 'ikL' : 'ik', sgn = side === 'L' ? 1 : -1;
      const w = p[pre + '.w'];
      const I = side === 'L' ? this._ikL : this._ik, J = this.J;
      const sh = J['sh' + side], el = J['el' + side], hand = J['wrist' + side], chest = J.chest, spin = J.spin;
      sh.rotation.set(p['sh' + side + '.rx'] || 0, p['sh' + side + '.ry'] || 0, p['sh' + side + '.rz'] || 0);
      el.rotation.set(p['el' + side + '.rx'] || 0, 0, 0); hand.rotation.set(p['wrist' + side + '.rx'] || 0, 0, 0);
      if (!(w > 0.002) || p[pre + '.hx'] === undefined) return;
      // hand target: offset (character frame) from the actual shoulder -> chest space
      I.S_b.setFromMatrixPosition(sh.matrixWorld); spin.worldToLocal(I.S_b);
      I.H_b.set(p[pre + '.hx'], p[pre + '.hy'], p[pre + '.hz']).multiplyScalar(ARM_K).add(I.S_b);
      spin.localToWorld(I.H_b);
      I.inv.copy(chest.matrixWorld).invert();
      I.H_b.applyMatrix4(I.inv);
      const S = sh.position, H = I.H_b;
      I.B.set(p[pre + '.bx'], p[pre + '.by'], p[pre + '.bz']).transformDirection(spin.matrixWorld).transformDirection(I.inv);
      I.Tn.set(p[pre + '.tx'], p[pre + '.ty'], p[pre + '.tz']).transformDirection(spin.matrixWorld).transformDirection(I.inv);

      const L1 = ARM_SEG, L2 = ARM_SEG;
      I.d.copy(H).sub(S);
      let dist = I.d.length();
      if (dist < 1e-5) return;
      I.h.copy(I.d).multiplyScalar(1 / dist);
      dist = Math.min(Math.max(dist, 0.12), (L1 + L2) * 0.992);
      const up = Math.min(1, Math.max(0, (H.y - S.y) / 0.5));
      if (p[pre + '.px'] !== undefined) I.pole.set(p[pre + '.px'], p[pre + '.py'], p[pre + '.pz']).transformDirection(spin.matrixWorld).transformDirection(I.inv);
      else I.pole.set(sgn * (0.55 + 0.45 * up), -1 + 1.15 * up, -0.25 - 0.2 * up);
      // locomotion pole (archer run arms), blended over the pose's pole by its own weight that fades out after the run
      const rpw = p[pre + '.rpw'] || 0;
      if (rpw > 0.001) {
        I.u.set(p[pre + '.rpx'], p[pre + '.rpy'], p[pre + '.rpz']).transformDirection(spin.matrixWorld).transformDirection(I.inv);   // unit
        I.pole.normalize().multiplyScalar(1 - Math.min(1, rpw)).addScaledVector(I.u, Math.min(1, rpw));
      }
      I.pole.addScaledVector(I.h, -I.pole.dot(I.h));
      if (I.pole.lengthSq() < 1e-6) I.pole.set(sgn, 0, 0);
      I.pole.normalize();
      const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
      const sinA = Math.sqrt(1 - cosA * cosA);
      I.u.copy(I.h).multiplyScalar(cosA).addScaledVector(I.pole, sinA);
      I.E.copy(S).addScaledVector(I.u, L1);
      I.Hact.copy(S).addScaledVector(I.h, dist);
      I.f.copy(I.Hact).sub(I.E).normalize();
      // wrist limit: keep the forearm-to-blade angle inside [WRIST_MIN, WRIST_MAX] (not dead straight, not folded onto the arm).
      // Keep the angle between forearm and blade inside [WRIST_MIN, WRIST_MAX] by swinging the blade about the wrist.
      {
        const dotFB = clamp(I.f.dot(I.B), -1, 1), ang = Math.acos(dotFB);
        const lim = ang < WRIST_MIN ? WRIST_MIN : (ang > WRIST_MAX ? WRIST_MAX : 0);
        if (lim) {
          I.Y.copy(I.B).addScaledVector(I.f, -dotFB);                  // blade component perpendicular to the forearm
          if (lim === WRIST_MIN) {
            // blade (nearly) in line with the forearm: swing it about the wrist so it TRAILS behind its cutting edge -
            // the wrist leads the cut and the blade follows inside the swing plane. Near the cone boundary the blade
            // keeps its own direction (s -> 1), so the correction is continuous and never snaps.
            const s = clamp(ang / WRIST_MIN, 0, 1);
            if (I.Y.lengthSq() > 1e-8) I.Y.normalize();
            I.d.copy(I.Tn).addScaledVector(I.f, -I.Tn.dot(I.f));
            if (I.d.lengthSq() > 1e-6) { I.d.normalize(); I.Y.multiplyScalar(s * s).addScaledVector(I.d, -(1 - s * s) - 0.12); }
          }
          if (I.Y.lengthSq() < 1e-6) I.Y.copy(I.pole).addScaledVector(I.f, -I.pole.dot(I.f));
          I.Y.normalize();
          I.B.copy(I.f).multiplyScalar(Math.cos(lim)).addScaledVector(I.Y, Math.sin(lim));
        }
      }
      const cosT = Math.min(1, Math.max(-1, I.u.dot(I.f)));
      const theta = -Math.acos(cosT);
      I.Z.copy(I.f).addScaledVector(I.u, -cosT);
      if (I.Z.lengthSq() < 1e-6) I.Z.copy(I.pole);
      I.Z.normalize();
      I.Y.copy(I.u).negate();
      I.X.crossVectors(I.Y, I.Z);
      I.m.makeBasis(I.X, I.Y, I.Z);
      I.qS.setFromRotationMatrix(I.m);
      I.qE.setFromAxisAngle(I.ax, theta);
      I.qEl.copy(I.qS).multiply(I.qE);
      // desired sword frame (X = edge/travel direction, Y = blade)
      I.Yw.copy(I.B).normalize();
      I.Xw.copy(I.Tn).addScaledVector(I.Yw, -I.Tn.dot(I.Yw)).normalize();
      I.Zw.crossVectors(I.Xw, I.Yw);
      I.m.makeBasis(I.Xw, I.Yw, I.Zw);
      I.qSw.setFromRotationMatrix(I.m);
      I.qH.copy(I.qSw).multiply(I.qSwordInv);
      I.qW.copy(I.qEl).invert().multiply(I.qH);
      // blend with the FK pose
      I.qa.copy(sh.quaternion).slerp(I.qS, w); sh.quaternion.copy(I.qa);
      el.rotation.x = el.rotation.x + (theta - el.rotation.x) * w;
      hand.quaternion.slerp(I.qW, w);
    }

    _applyPose(p) {
      const J = this.J, B = this.base;
      for (const key in p) {
        const dot = key.indexOf('.');
        const j = key.slice(0, dot), prop = key.slice(dot + 1);
        const o = J[j];
        if (!o) continue;
        const b = B[j], v = p[key];
        switch (prop) {
          case 'rx': o.rotation.x = b.rx + v; break;
          case 'ry': o.rotation.y = b.ry + v; break;
          case 'rz': o.rotation.z = b.rz + v; break;
          case 'px': o.position.x = b.px + v; break;
          case 'py': o.position.y = b.py + v; break;
          case 'pz': o.position.z = b.pz + v; break;
        }
      }
      // spin about a pivot point (the planted foot) instead of the body centre: position = P - R(theta) * P
      const th = J.spin.rotation.y, px = p['spin.pvx'] || 0, pz = p['spin.pvz'] || 0;
      const c = Math.cos(th), s = Math.sin(th);
      J.spin.position.set(px - (px * c + pz * s), 0, pz - (-px * s + pz * c));
    }

    _flash() {
      const f = this.flash;
      for (const m of this.mats) {
        m.emissive.copy(m.userData.e0);
        m.emissive.r += f * 0.5; m.emissive.g += f * 0.12; m.emissive.b += f * 0.1;
      }
    }

    _fx(def, t) {
      this.fxRing.material.opacity = 0;
      if (!def || !def.fx) return;
      const f = def.fx;
      if (t < f.t0 || t > f.t1) return;
      const u = (t - f.t0) / (f.t1 - f.t0);
      this.fxRing.position.z = f.z || 0;
      this.fxRing.material.opacity = 0.9 * (1 - u * u);
      this.fxRing.scale.setScalar(0.4 + u * (f.grow || 2));
    }
  }

  global.Knight = Knight;
  global.KNIGHT_ANIMS = ['idle', 'walk', 'run', 'attack', 'special', 'hit', 'die'];
  global.KNIGHT_CLASSES = { warrior: { label: 'Savaşçı' }, archer: { label: 'Okçu' }, mage: { label: 'Büyücü' } };
  global.KNIGHT_DEFS = ONE_SHOT;
  global.KNIGHT_COMBO = COMBO;
  Knight.ARM_K = ARM_K;
  Knight.WALK_SPEED = WALK_SPEED; Knight.RUN_SPEED = RUN_SPEED;
  Knight.validateMeleeHit = validateMeleeHit;   // pure: usable by an authoritative server with the same def numbers
})(window);
