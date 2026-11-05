/* Antlered Stag - Boynuzlu Geyik (levels 9-11): an aggressive rutting red stag of the hills.
 * Anatomy (authored at scale 1 in metres, shoulder 1.2 m; the game scale in the def makes it ~1.5 m at the shoulder):
 * tall and elegant - long slender legs on small cloven hooves with dewclaws, deep chest over a narrow tucked waist, an arched
 * muscular neck with a shaggy dark rut mane and throat locks, a refined long head with a dark nose pad and cream muzzle ring,
 * big mobile ears, big dark eyes, a short cream-rumped tail and the signature ANTLERS: main beams sweeping back and up with
 * brow, bez, trez and a two-pronged crown (bone-pale, darker at the burr).
 * Locomotion: lateral-sequence walk with a head bob -> diagonal trot -> bounding gallop with long flight phases; the head is
 * carried high and drops, antlers forward, in the charge.
 * Attacks: gore (rear-and-low wind-up, hooking sweep + thrust of the antlers) and charge (paws the ground, coils, lowers the
 * antlers and runs the target down). Specials: graze, alert, antler shake, stamp. Stagger, hit, death (collapses to the side). */
(function () {
  'use strict';
  /* ---------------- gameplay def (pure data, authored at scale 1; defs.js applies the game scale exactly once) ---------------- */
  const SPECIES = CREATURE_DEFS.SPECIES;
  const A = (dur, an, wu, hit, fo, active, o) => Object.assign({ dur, phases: { s: 0, an, wu, hit, fo, e: 1 }, active }, o);
  const D = SPECIES.stag || CREATURE_DEFS.addSpecies('stag', {
    scale: 1.22,
    name: 'Boynuzlu Geyik', en: 'Antlered Stag', levels: [9, 11], hp: 2300, hpLv: 260, exp: 1900, expLv: 220,
    radius: 0.5, front: 1.25, height: 1.62, mass: 1.4, poise: 0.5,
    speed: { walk: 1.2, run: 4.4, charge: 7.6 }, turn: 5.5,
    behavior: { type: 'charger', aggro: 7, assist: 0, leash: 19, roam: 5, pause: [2, 5], dash: [1.5, 3.5], chargeMin: 4, chargeMax: 11 },
    attacks: {
      gore: A(1.25, 0.24, 0.46, 0.54, 0.74, [0.48, 0.62], { reach: 1.5, cosArc: 0.3, dmg: [190, 230], dmgLv: 28, cd: 1.6, use: [0, 1.4], lunge: 0.4 }),
      charge: A(1.9, 0.2, 0.34, 0.5, 0.84, [0.34, 0.8], { reach: 1.3, cosArc: 0.2, dmg: [260, 310], dmgLv: 34, cd: 6.5, use: [4, 11], lunge: 7.5, charge: true, heavy: true }),
    },
    corpse: 12, respawn: [22, 32],
    loot: [{ id: 'stag_antler', name: 'Geyik Boynuzu', p: 0.3 }],
  });
  // pure-data part done: a headless authority (simtest / a server) loads this file without three.js or the creature kit
  if (typeof CreatureKit === 'undefined' || typeof THREE === 'undefined') return;

  const K = CreatureKit, T = THREE, M = K.math;
  const { sstep, gs, ga, lerp, clamp01, vnoise3, PI, TAU } = M;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  /* ---------------- skeleton (world bind positions, metres) ---------------- */
  // skull frame: the head hangs ~29 degrees nose-down from the poll; H(x, up, forward) maps skull-local coordinates to the world
  const HO = V(0, 1.44, 0.96), HPITCH = 0.6;
  const hF = V(0, -Math.sin(HPITCH), Math.cos(HPITCH)), hU = V(0, Math.cos(HPITCH), Math.sin(HPITCH));
  const H = (x, y, z) => V(x, 0, 0).addScaledVector(hU, y).addScaledVector(hF, z).add(HO);
  const Ha = (x, y, z) => H(x, y, z).toArray();
  const BODY_Y = 0.98;
  const bones = [
    ['body', null, 0, BODY_Y, 0.0],
    ['ribs', 'body', 0, 0.92, 0.2],
    ['pelvis', 'body', 0, 1.0, -0.45],
    ['tail0', 'pelvis', 0, 1.06, -0.8, 'tail1'], ['tail1', 'tail0', 0, 1.0, -0.865],
    ['chest', 'body', 0, 1.0, 0.32],
    ['neck', 'chest', 0, 1.08, 0.58, 'head'],
    ['head', 'neck', 0, 1.44, 0.96],
    ['jaw', 'head'].concat(Ha(0, -0.075, 0.09)),
    ['earL', 'head'].concat(Ha(0.062, 0.045, -0.015)), ['earR', 'head'].concat(Ha(-0.062, 0.045, -0.015)),
  ];
  for (const [s, k] of [['L', 1], ['R', -1]]) {
    bones.push(
      ['scap' + s, 'chest', k * 0.1, 1.1, 0.43, 'hum' + s],
      ['hum' + s, 'scap' + s, k * 0.13, 0.86, 0.5, 'for' + s],
      ['for' + s, 'hum' + s, k * 0.13, 0.65, 0.31, 'mc' + s],
      ['mc' + s, 'for' + s, k * 0.115, 0.315, 0.38, 'fpaw' + s],
      ['fpaw' + s, 'mc' + s, k * 0.11, 0.105, 0.4],
      ['th' + s, 'pelvis', k * 0.115, 0.98, -0.5, 'shin' + s],
      ['shin' + s, 'th' + s, k * 0.125, 0.73, -0.31, 'met' + s],
      ['met' + s, 'shin' + s, k * 0.105, 0.47, -0.56, 'hpaw' + s],
      ['hpaw' + s, 'met' + s, k * 0.105, 0.105, -0.52],
    );
  }
  const ends = {
    tail1: [0, 0.91, -0.9], head: Ha(0, -0.04, 0.43), jaw: Ha(0, -0.08, 0.37),
    earL: Ha(0.26, 0.15, -0.1), earR: Ha(-0.26, 0.15, -0.1),
    fpawL: [0.11, 0.019, 0.465], fpawR: [-0.11, 0.019, 0.465], hpawL: [0.105, 0.019, -0.455], hpawR: [-0.105, 0.019, -0.455],
    body: [0, 1.0, 0.32], pelvis: [0, 1.0, -0.8], chest: [0, 1.08, 0.58], ribs: [0, 0.92, 0.4],
  };
  const tpl = K.rigTemplate(bones, ends);
  const I = tpl.idx, W = (n) => tpl.world[I[n]].clone();
  const chan = K.channelMap(tpl, ['ikFL', 'ikFR', 'ikHL', 'ikHR', 'chew']);

  /* ---------------- palette (display-space vertex colours; upward faces render ~2.2x brighter) ---------------- */
  const C = {
    back: [0.19, 0.08, 0.04], side: [0.33, 0.145, 0.068], belly: [0.42, 0.3, 0.19], thighIn: [0.43, 0.31, 0.2],
    mane: [0.15, 0.072, 0.04], maneTip: [0.23, 0.115, 0.065], leg: [0.12, 0.068, 0.045], legHi: [0.2, 0.1, 0.06],
    rump: [0.56, 0.45, 0.29], rumpEdge: [0.075, 0.04, 0.026], stripe: [0.1, 0.045, 0.026],
    face: [0.17, 0.085, 0.05], muzzle: [0.5, 0.41, 0.3], chin: [0.54, 0.46, 0.35], nose: [0.026, 0.022, 0.022], lip: [0.06, 0.04, 0.036], mouth: [0.13, 0.05, 0.05],
    earOut: [0.2, 0.095, 0.052], earIn: [0.5, 0.4, 0.3], earRim: [0.06, 0.035, 0.026],
    eye: [0.03, 0.017, 0.012], eyeRing: [0.46, 0.38, 0.27],
    tail: [0.22, 0.1, 0.055], tailUnder: [0.6, 0.5, 0.36],
    hoof: [0.045, 0.036, 0.032],
    antBurr: [0.13, 0.09, 0.06], antBase: [0.2, 0.14, 0.095], antMid: [0.34, 0.285, 0.205], antTip: [0.5, 0.45, 0.34],
  };
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // coat: guard-hair streaks along the body + a finer speckle
  const grizzle = (p) => 0.86 + 0.16 * vnoise3(p.x * 26, p.y * 26, p.z * 7) + 0.1 * (vnoise3(p.x * 90, p.y * 90, p.z * 26) - 0.5);
  function furColor(p, n) {
    const up = n.y, dors = sstep(0.2, 0.9, up), ven = sstep(0.0, -0.6, up);
    let c = mix(C.side, C.back, dors);
    // dark dorsal stripe along the spine
    c = mix(c, C.stripe, 0.7 * gs(p.x, 0, 0.035) * dors * sstep(-0.62, -0.3, p.z) * sstep(0.62, 0.45, p.z));
    // cream belly, the flanks fade into it
    c = mix(c, C.belly, ven * 0.9);
    // dark neck mane: rich, shaggy, darkest on the crest and throat
    const neck = sstep(0.55, 0.72, p.z) * sstep(0.95, 1.05, p.y);
    c = mix(c, C.mane, neck * (0.7 + 0.25 * vnoise3(p.x * 40, p.y * 40, p.z * 40)));
    // pale rump patch with a dark border (and the tail's white flag)
    const rp = sstep(-0.58, -0.66, p.z) * sstep(0.84, 0.95, p.y) * sstep(0.2, 0.1, Math.abs(p.x));
    const rim = gs(p.z, -0.6, 0.03) * sstep(0.85, 0.95, p.y) * sstep(0.2, 0.12, Math.abs(p.x));
    c = mix(c, C.rumpEdge, 0.6 * rim);
    c = mix(c, C.rump, rp);
    // legs: darker brown below the elbow / stifle, pale inner thigh
    c = mix(c, C.legHi, 0.5 * sstep(0.62, 0.5, p.y) * sstep(0.45, 0.5, Math.abs(p.z + 0.1)));
    c = mix(c, C.leg, sstep(0.5, 0.3, p.y));
    return mul(c, grizzle(p));
  }

  /* ---------------- geometry ---------------- */
  const SPINE = [
    ['pelvis', V(0, 1.0, -0.74), V(0, 1.05, -0.3)], ['body', V(0, 1.05, -0.3), V(0, 1.0, 0.16)],
    ['chest', V(0, 1.0, 0.16), V(0, 1.05, 0.6)], ['neck', V(0, 1.08, 0.58), V(0, 1.42, 0.95)], ['head', V(0, 1.44, 0.96), H(0, 0, 0.1)],
  ].map((s) => [I[s[0]], s[1], s[2]]);
  function jointS(pts) { const d = [0]; for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + pts[i].distanceTo(pts[i - 1])); return d.map((x) => x / d[d.length - 1]); }
  const prof3 = (cv) => { const q = [0, 0, 0]; return (u, o) => { cv(u, q); o[0] = q[0]; o[1] = q[1]; o[2] = q[2]; o[3] = 2.15; o[4] = 0; o[5] = 0; return o; }; };
  const hash01 = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const AS = [0.9, 0.68, 0.8], TL = 0.72;                                  // antler size (x, y, z) and tine length factors
  const headM = new T.Matrix4().makeBasis(V(1, 0, 0), hU, hF).setPosition(HO), headInv = headM.clone().invert();

  function build(q) {
    const parts = { fur: [], skin: [], gloss: [], horn: [] };
    const nr = (n) => Math.max(6, Math.round(n * q)), nu = (n) => Math.max(8, Math.round(n * q / 2) * 2);

    /* body: deep chest, narrow tucked waist, croup, thick arched neck with crest + throat mane volume */
    const bodyBase = K.sdf([
      { e: [0, 1.0, -0.6], r: [0.17, 0.2, 0.24] },                                       // haunch / rump
      { e: [0, 1.07, -0.5], r: [0.115, 0.1, 0.26], k: 0.08 },                            // croup
      { e: [0, 1.0, -0.15], r: [0.145, 0.19, 0.3], k: 0.1 },                              // loin: tucked waist
      { e: [0.1, 0.84, -0.32], r: [0.07, 0.13, 0.16], k: 0.08 },                         // flank fold over the stifle
      { e: [-0.1, 0.84, -0.32], r: [0.07, 0.13, 0.16], k: 0.08 },
      { e: [0, 0.94, 0.15], r: [0.2, 0.25, 0.38], k: 0.1 },                              // rib cage
      { e: [0, 0.9, 0.42], r: [0.17, 0.22, 0.24], k: 0.1 },                              // deep chest / brisket
      { e: [0, 1.13, 0.38], r: [0.065, 0.09, 0.2], k: 0.08 },                            // withers
      { e: [0.125, 0.95, 0.45], r: [0.06, 0.18, 0.15], rot: [-0.25, 0, 0], k: 0.07 },    // shoulder muscle
      { e: [-0.125, 0.95, 0.45], r: [0.06, 0.18, 0.15], rot: [-0.25, 0, 0], k: 0.07 },
      { e: [0.115, 0.87, -0.55], r: [0.055, 0.17, 0.14], rot: [0.25, 0, 0], k: 0.12 },    // hams
      { e: [-0.115, 0.87, -0.55], r: [0.055, 0.17, 0.14], rot: [0.25, 0, 0], k: 0.12 },
      { e: [0, 1.14, -0.05], r: [0.07, 0.04, 0.6], k: 0.07 },                            // smooth top line
      { c: [0, 1.06, 0.5, 0, 1.4, 0.93], ra: 0.19, rb: 0.1, k: 0.08, sq: 0.95 },      // neck
      { e: [0, 1.27, 0.7], r: [0.12, 0.17, 0.2], rot: [-0.9, 0, 0], k: 0.09 },          // arched crest
      { e: [0, 1.1, 0.76], r: [0.125, 0.12, 0.17], rot: [-0.8, 0, 0], k: 0.09 },           // throat / dewlap mane
      { e: [0, 1.44, 0.94], r: [0.075, 0.075, 0.09], k: 0.08 },                           // nape fillet over the poll
    ]);
    // shaggy guard-hair break-up on the mane
    const ruffMask = (x, y, z) => sstep(0.46, 0.6, z) * sstep(1.0, 0.9, z) * sstep(0.9, 1.0, y);
    const bodySDF = (x, y, z) => { const m = ruffMask(x, y, z), d = bodyBase(x, y, z); return m > 0 ? d - 0.01 * m * (vnoise3(x * 16, y * 14, z * 16) - 0.35) : d; };
    const spine = new T.CatmullRomCurve3([V(0, 1.0, -0.74), V(0, 1.06, -0.5), V(0, 1.06, -0.12), V(0, 1.02, 0.22), V(0, 1.07, 0.5), V(0, 1.22, 0.72), V(0, 1.39, 0.93)], false, 'centripetal');
    const body = K.projectSDF({ sdf: bodySDF, curve: spine, rows: nr(52), nu: nu(32), cap0: 0.12, cap1: 0.07, rmax: 0.6 });
    const hip = { L: W('thL'), R: W('thR') }, sh = { L: W('humL'), R: W('humR') };
    K.skin(body, (p) => {
      const sd = p.x >= 0 ? 'L' : 'R';
      const ex = [
        [I['th' + sd], 0.55 * gs(p.distanceTo(hip[sd]), 0, 0.17) * sstep(0.02, 0.09, Math.abs(p.x)) * sstep(1.05, 0.85, p.y)],
        [I['scap' + sd], 0.5 * gs(p.distanceTo(sh[sd]), 0, 0.2) * sstep(0.02, 0.08, Math.abs(p.x))],
        [I.ribs, 0.5 * gs(p.z, 0.15, 0.22) * sstep(0.95, 0.72, p.y)],
      ];
      return K.envelope(SPINE, p, 4, ex);
    });
    K.paint(body, (p, n) => furColor(p, n));
    parts.fur.push(body);

    /* head (skull-local frame: x right, y up, z along the face, poll at the origin) */
    const skull = K.sdf([
      { e: [0, 0.005, 0.03], r: [0.068, 0.07, 0.1] },                                   // braincase
      { e: [0, 0.03, 0.02], r: [0.045, 0.035, 0.085], k: 0.04 },                         // forehead
      { e: [0.056, -0.045, 0.055], r: [0.04, 0.075, 0.1], k: 0.05 },                      // cheeks / masseters
      { e: [-0.056, -0.045, 0.055], r: [0.04, 0.075, 0.1], k: 0.05 },
      { c: [0, 0.0, 0.1, 0, -0.03, 0.4], ra: 0.064, rb: 0.03, k: 0.04, sq: 1.2 },   // long tapering face
      { e: [0, 0.02, 0.24], r: [0.026, 0.024, 0.16], k: 0.05 },                          // nasal bridge (slight roman line)
      { e: [0, -0.035, 0.425], r: [0.03, 0.024, 0.022], k: 0.03 },                         // nose pad
      { e: [0.03, -0.05, 0.37], r: [0.018, 0.02, 0.045], k: 0.03 },                      // upper lips
      { e: [-0.03, -0.05, 0.37], r: [0.018, 0.02, 0.045], k: 0.03 },
      { e: [0.058, 0.034, 0.118], r: [0.024, 0.024, 0.04], k: 0.03 },                   // orbital rims
      { e: [-0.058, 0.034, 0.118], r: [0.024, 0.024, 0.04], k: 0.03 },
      { e: [0.04, 0.06, -0.02], r: [0.027, 0.02, 0.027], k: 0.025 },                     // pedicles: antler seats
      { e: [-0.04, 0.06, -0.02], r: [0.027, 0.02, 0.027], k: 0.025 },
      { e: [0.07, 0.03, 0.128], r: [0.016, 0.0155, 0.017], k: 0.01, sub: true },        // eye sockets
      { e: [-0.07, 0.03, 0.128], r: [0.016, 0.0155, 0.017], k: 0.01, sub: true },
      { e: [0.016, -0.034, 0.447], r: [0.0075, 0.006, 0.01], k: 0.004, sub: true },      // nostrils
      { e: [-0.016, -0.034, 0.447], r: [0.0075, 0.006, 0.01], k: 0.004, sub: true },
    ]);
    const hv = new T.Vector3();
    const headSDF = (x, y, z) => { hv.set(x, y, z).applyMatrix4(headInv); return skull(hv.x, hv.y, hv.z); };
    const hAxis = new T.LineCurve3(H(0, 0.005, -0.06), H(0, -0.035, 0.43));
    const head = K.projectSDF({ sdf: headSDF, curve: hAxis, up: hU, rows: nr(34), nu: nu(28), cap0: 0.2, cap1: 0.12, rmax: 0.22 });
    K.skin(head, [[I.head, 1]]);
    const lp = new T.Vector3();
    const eyeL = [V(0.074, 0.03, 0.128), V(-0.074, 0.03, 0.128)];
    K.paint(head, (p, n) => {
      lp.copy(p).applyMatrix4(headInv);                                                    // skull-local position
      const nl = n.clone().transformDirection(headInv);
      let c = furColor(p, n);
      c = mix(c, C.face, 0.85);                                                            // dark brown face
      // cream muzzle ring around the nose + lips, cream chin and throat patch
      c = mix(c, C.muzzle, sstep(0.3, 0.4, lp.z) * (0.55 + 0.4 * sstep(0.1, -0.5, nl.y)));
      c = mix(c, C.chin, sstep(0.08, -0.5, nl.y) * sstep(0.12, 0.3, lp.z) * 0.9);
      c = mix(c, C.muzzle, 0.5 * sstep(0.28, 0.2, lp.z) * sstep(-0.3, -0.7, nl.y) * sstep(0.1, 0.2, lp.z));
      for (const e of eyeL) c = mix(c, C.eyeRing, 0.5 * gs(Math.hypot(lp.x - e.x, lp.y - e.y, lp.z - e.z), 0.034, 0.008));
      c = mix(c, C.nose, sstep(0.062, 0.042, Math.hypot(lp.x, lp.y + 0.037, (lp.z - 0.425) * 1.1)));
      c = mix(c, C.lip, gs(lp.y, -0.077, 0.006) * sstep(0.3, 0.4, lp.z) * sstep(0.2, -0.3, nl.y) * 0.7);
      return c;
    });
    parts.fur.push(head);
    const jawSDF = K.sdf([
      { c: [0, -0.066, 0.09, 0, -0.078, 0.37], ra: 0.038, rb: 0.023, sq: 1.15 },
      { e: [0, -0.072, 0.2], r: [0.03, 0.024, 0.1], k: 0.025 },
    ]);
    const jv = new T.Vector3();
    const jawW = (x, y, z) => { jv.set(x, y, z).applyMatrix4(headInv); return jawSDF(jv.x, jv.y, jv.z); };
    const jaw = K.projectSDF({ sdf: jawW, curve: new T.LineCurve3(H(0, -0.066, 0.08), H(0, -0.078, 0.375)), up: hU, rows: nr(16), nu: nu(16), cap0: 0.2, cap1: 0.2, rmax: 0.1 });
    K.skin(jaw, [[I.jaw, 1]]);
    K.paint(jaw, (p, n) => {
      lp.copy(p).applyMatrix4(headInv);
      let c = mix(mix(C.chin, C.muzzle, 0.5), C.face, 0.5 * sstep(0.22, 0.05, lp.z));
      c = mix(c, C.nose, 0.7 * sstep(0.35, 0.38, lp.z));
      return mix(c, C.mouth, sstep(0.3, 0.8, n.y) * sstep(0.12, 0.2, lp.z) * 0.8);
    });
    parts.fur.push(jaw);
    // big dark eyes, set in the sockets and looking forward-outward
    for (const s of [-1, 1]) {
      const eye = new T.SphereGeometry(0.0225, Math.max(8, Math.round(14 * q)), Math.max(6, Math.round(10 * q)));
      eye.scale(0.8, 0.92, 1); eye.rotateY(s * 0.5);
      eye.applyMatrix4(new T.Matrix4().makeTranslation(s * 0.075, 0.0305, 0.1285).premultiply(headM));
      parts.gloss.push(K.prim(eye, C.eye, I.head));
    }

    /* ears: big, leaf shaped, mobile, set wide of the antlers; dark outside, cream inside */
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      const pts = [H(s * 0.06, 0.04, -0.015), H(s * 0.13, 0.085, -0.04), H(s * 0.205, 0.135, -0.075), H(s * 0.26, 0.17, -0.105)];
      const e = K.sweep({
        pts, up: V(s * 0.3, 0.55, 0.78).normalize(),
        prof: (u, o) => { o[0] = 0.044 * Math.pow(Math.sin(PI * Math.min(1, 0.12 + 0.88 * u)), 0.7) * (1 - 0.35 * u) + 0.004; o[1] = o[2] = 0.0085 * (1 - 0.55 * u); o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        cup: (u) => -0.02 * Math.sin(PI * Math.min(1, u * 1.1)), rows: nr(12), nu: nu(16), cap0: 1, cap1: 3,
      });
      K.skin(e, (p, info) => { const t = info ? info.s : 0; return [[I['ear' + sd], sstep(0.12, 0.3, t)], [I.head, 1 - sstep(0.12, 0.3, t)]]; });
      K.paint(e, (p, n, info) => {
        const inner = sstep(-0.1, 0.5, n.z * 0.7 + n.y * 0.35 - n.x * s * 0.1);
        const u = info ? info.s : 0, edge = info ? Math.abs(Math.sin(info.a)) : 0;
        let c = mix(mul(C.earOut, grizzle(p)), C.earIn, inner * sstep(0.18, 0.32, u) * sstep(0.97, 0.7, edge));
        return mix(c, C.earRim, 0.75 * sstep(0.8, 1, edge) + 0.45 * sstep(0.92, 1, u));
      });
      parts.fur.push(e);
    }

    /* ANTLERS: main beam sweeping up and back, brow / bez / trez tines forward, a two-pronged crown; world-aligned offsets from
       the poll (the beam rises ~0.5 m behind the head) */
    for (const s of [-1, 1]) {
      const P0 = (x, y, z) => V(s * (0.052 + (x - 0.052) * AS[0]), HO.y + 0.058 + (y - 0.058) * AS[1], HO.z - 0.012 + (z + 0.012) * AS[2]);
      const beam = [P0(0.052, 0.058, -0.012), P0(0.09, 0.135, -0.04), P0(0.14, 0.235, -0.095), P0(0.172, 0.335, -0.185), P0(0.168, 0.425, -0.3), P0(0.135, 0.495, -0.42), P0(0.1, 0.545, -0.52), P0(0.078, 0.6, -0.565)];
      const tines = [
        { name: 'brow', pts: [beam[1], P0(0.105, 0.155, 0.04), P0(0.118, 0.19, 0.125), P0(0.112, 0.255, 0.19), P0(0.1, 0.32, 0.215)], r: 0.016, len: 1 },
        { name: 'bez', pts: [beam[2], P0(0.158, 0.26, -0.055), P0(0.168, 0.3, 0.02), P0(0.158, 0.37, 0.085), P0(0.142, 0.435, 0.11)], r: 0.014, len: 1 },
        { name: 'trez', pts: [beam[3], P0(0.2, 0.395, -0.15), P0(0.212, 0.46, -0.11), P0(0.205, 0.54, -0.085), P0(0.19, 0.6, -0.075)], r: 0.012, len: 1 },
        { name: 'crown1', pts: [beam[5], P0(0.142, 0.555, -0.425), P0(0.15, 0.625, -0.41), P0(0.142, 0.695, -0.39)], r: 0.0105, len: 1 },
        { name: 'crown2', pts: [beam[6], P0(0.1, 0.59, -0.5), P0(0.094, 0.655, -0.49), P0(0.085, 0.72, -0.475)], r: 0.0095, len: 1 },
      ];
      // tine tips are drawn in from the beam so the tines stay short and stout (their roots stay on the beam)
      for (const t of tines) { const b0 = t.pts[0].clone(); t.pts = t.pts.map((v, i) => (i ? b0.clone().add(v.clone().sub(b0).multiplyScalar(TL)) : b0.clone())); }
      const skinHead = [[I.head, 1]];
      const rbeam = M.curve([[0, 0.05], [0.07, 0.034], [0.3, 0.025], [0.6, 0.019], [0.85, 0.0145], [1, 0.011]]), rq = [0];
      const bm = K.sweep({
        pts: beam, up: V(s, 0.3, 0.1).normalize(),
        prof: (u, o) => { rbeam(u, rq); o[0] = rq[0] * 1.05; o[1] = o[2] = rq[0]; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => 0.0025 * (vnoise3(u * 30, Math.cos(a) * 3, Math.sin(a) * 3) - 0.45) * sstep(0.04, 0.2, u) + 0.0085 * gs(u, 0.01, 0.025),
        rows: nr(22), nu: nu(10), cap0: 1, cap1: 2,
      });
      K.skin(bm, skinHead);
      const antCol = (info, bias) => {
        const u = info ? info.s : 0;
        let c = mix(C.antBurr, C.antBase, sstep(0.0, 0.05, u + bias));
        c = mix(c, C.antMid, sstep(0.04, 0.3, u + bias));
        return mix(c, C.antTip, sstep(0.78, 1, u));
      };
      K.paint(bm, (p, n, info) => mul(antCol(info, 0), 0.92 + 0.14 * vnoise3(p.x * 70, p.y * 70, p.z * 70)));
      parts.horn.push(bm);
      for (const t of tines) {
        const tq = [0], tr = M.curve([[0, t.r * 1.5], [0.2, t.r * 1.25], [0.7, t.r * 0.75], [1, t.r * 0.32]]);
        const tg = K.sweep({
          pts: t.pts, up: V(s, 0.2, 0.2).normalize(),
          prof: (u, o) => { tr(u, tq); o[0] = tq[0]; o[1] = o[2] = tq[0] * 0.96; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
          detail: (u, a) => 0.002 * (vnoise3(u * 24, Math.cos(a) * 3, Math.sin(a) * 3 + t.r * 90) - 0.45) * sstep(0.05, 0.25, u),
          rows: nr(9), nu: nu(8), cap0: 1, cap1: 2,
        });
        K.skin(tg, skinHead);
        K.paint(tg, (p, n, info) => { const u = info ? info.s : 0; return mul(mix(C.antMid, C.antTip, sstep(0.35, 1, u)), 0.92 + 0.14 * vnoise3(p.x * 70, p.y * 70, p.z * 70)); });
        parts.horn.push(tg);
      }
    }

    /* mane: shaggy locks hanging from the throat and standing along the crest of the neck */
    {
      const march = (x, z, fromY, dir) => { let y = fromY; for (let i = 0; i < 220; i++) { const d = bodySDF(x, y, z); if (d < 0.0005) break; y += dir * Math.max(0.002, d * 0.9); } return y; };
      const lock = (base, dirv0, len, r0, bone, col, tipCol) => {
        const jx = hash01(base.x * 91 + base.z * 53) - 0.5, jz = hash01(base.x * 37 + base.z * 71) - 0.5, dirv = dirv0.clone().add(V(jx * 0.5, 0, jz * 0.45)).normalize();
        const pts = [base.clone().addScaledVector(dirv, -0.012), base.clone().addScaledVector(dirv, len * 0.5).add(V(0, -len * 0.04, -len * 0.06)), base.clone().addScaledVector(dirv, len).add(V(0, -len * 0.1, -len * 0.14))];
        const g = K.sweep({ pts, up: V(0, 0, 1), prof: (u, o) => { const r = lerp(r0, r0 * 0.3, Math.pow(u, 0.7)); o[0] = r * 1.3; o[1] = o[2] = r; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: q > 0.7 ? 4 : 3, nu: q > 0.7 ? 6 : 5, cap0: 0, cap1: 2 });
        K.skin(g, [[bone, 1]]);
        K.paint(g, (p, n, info) => mul(mix(col, tipCol, sstep(0.4, 1, info ? info.s : 0)), 0.9 + 0.2 * hash01(base.x * 31 + base.z * 17)));
        return g;
      };
      const NT = Math.max(7, Math.round(13 * Math.max(0.6, q)));
      for (let i = 0; i < NT; i++) {                                  // throat beard: dense locks hanging from the underside of the neck
        const t = i / (NT - 1), z = lerp(0.6, 0.97, t);
        for (const x of [-0.085, -0.045, 0, 0.045, 0.085]) {
          if (Math.abs(x) > 0.05 && (i + (x > 0 ? 1 : 0)) % 2) continue;
          const xs = x * (1 - 0.4 * t), y = march(xs, z, 0.45, 1) + 0.006;
          const len = (0.075 + 0.075 * Math.sin(PI * Math.min(1, t * 0.8 + 0.12))) * (1 - 0.35 * Math.abs(x) / 0.085);
          parts.fur.push(lock(V(xs, y, z), V(0, -1, -0.12).normalize(), len, 0.021, I.neck, C.mane, C.maneTip));
        }
      }
    }

    /* tail: short flag, pale underside */
    const tailPts = [V(0, 1.07, -0.76), W('tail0'), W('tail1'), V(0, 0.91, -0.9)];
    const tsegs = [['pelvis', 0, 1], ['tail0', 1, 2], ['tail1', 2, 3]].map((x) => [I[x[0]], tailPts[x[1]], tailPts[x[2]]]);
    const trc = M.curve([[0, 0.05], [0.25, 0.047], [0.7, 0.036], [1, 0.012]]), trq = [0];
    const tail = K.sweep({ pts: tailPts, prof: (u, o) => { trc(u, trq); o[0] = trq[0] * 0.85; o[1] = trq[0] * 0.8; o[2] = trq[0]; o[3] = 2; o[4] = 0; o[5] = 0; return o; },
      detail: (u, a) => 0.005 * sstep(0.2, 0.5, u) * (vnoise3(u * 20, Math.cos(a) * 2, Math.sin(a) * 2) - 0.45), rows: nr(12), nu: nu(10), cap0: 0, cap1: 3 });
    K.skin(tail, (p) => K.envelope(tsegs, p, 4));
    K.paint(tail, (p, n, info) => {
      const u = info ? info.s : 0;
      let c = mix(C.rump, C.tail, sstep(-0.1, 0.6, n.y) * sstep(0.1, 0.3, u));
      c = mix(c, C.tailUnder, sstep(0.0, -0.5, n.y) * 0.8);
      return mul(c, grizzle(p));
    });
    parts.fur.push(tail);

    /* legs + hooves (left built, right mirrored) */
    const legParts = [];
    const sd = 'L';
    // hind: haunch -> hip -> stifle -> gaskin -> hock -> cannon -> fetlock
    const hipIn = V(0.075, 1.0, -0.5);
    const hp = [hipIn, W('th' + sd), W('shin' + sd), W('met' + sd), W('hpaw' + sd)];
    const hs = jointS(hp);
    const hc = M.curve([
      [0, 0.07, 0.09, 0.1], [hs[1], 0.08, 0.1, 0.11], [lerp(hs[1], hs[2], 0.55), 0.058, 0.066, 0.09], [hs[2], 0.043, 0.047, 0.06],
      [lerp(hs[2], hs[3], 0.4), 0.036, 0.04, 0.062], [lerp(hs[2], hs[3], 0.8), 0.029, 0.03, 0.044], [hs[3], 0.028, 0.03, 0.044],
      [lerp(hs[3], 1, 0.35), 0.0215, 0.0215, 0.0255], [lerp(hs[3], 1, 0.85), 0.02, 0.02, 0.022], [1, 0.0235, 0.024, 0.024]]);
    const hind = K.sweep({ pts: hp, up: V(0, 0, 1), prof: prof3(hc), rows: nr(30), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.012 * gs(u, hs[3] - 0.01, 0.025) * ga(a, PI, 0.5) });
    K.skin(hind, (p) => K.envelope([[I.pelvis, hipIn, W('th' + sd)], [I['th' + sd], W('th' + sd), W('shin' + sd)], [I['shin' + sd], W('shin' + sd), W('met' + sd)], [I['met' + sd], W('met' + sd), W('hpaw' + sd)]], p, 4));
    K.paint(hind, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, C.thighIn, sstep(0.2, 0.8, -n.x) * sstep(0.85, 0.7, p.y) * 0.5);
      c = mix(c, mul(C.leg, grizzle(p)), sstep(0.62, 0.42, p.y));
      return mix(c, mul(C.hoof, 1.4), sstep(0.13, 0.08, p.y));
    });
    legParts.push(['fur', hind]);
    // fore: shoulder -> elbow -> forearm -> knee (carpus) -> cannon -> fetlock
    const shIn = V(0.085, 1.0, 0.4);
    const fp = [shIn, W('hum' + sd), W('for' + sd), W('mc' + sd), W('fpaw' + sd)];
    const fs = jointS(fp);
    const fc = M.curve([
      [0, 0.07, 0.085, 0.085], [fs[1], 0.076, 0.09, 0.095], [lerp(fs[1], fs[2], 0.6), 0.058, 0.065, 0.08], [fs[2], 0.046, 0.048, 0.062],
      [lerp(fs[2], fs[3], 0.3), 0.042, 0.046, 0.048], [lerp(fs[2], fs[3], 0.85), 0.027, 0.03, 0.028], [fs[3], 0.028, 0.032, 0.03],
      [lerp(fs[3], 1, 0.4), 0.0205, 0.0215, 0.021], [lerp(fs[3], 1, 0.85), 0.0195, 0.0205, 0.0205], [1, 0.0235, 0.024, 0.0235]]);
    const fore = K.sweep({ pts: fp, up: V(0, 0, 1), prof: prof3(fc), rows: nr(28), nu: nu(16), cap0: 2, cap1: 2,
      detail: (u, a) => 0.009 * gs(u, fs[2] + 0.005, 0.02) * ga(a, PI, 0.5) + 0.006 * gs(u, fs[3] - 0.01, 0.02) * ga(a, 0, 0.6) });
    K.skin(fore, (p) => K.envelope([[I['scap' + sd], shIn, W('hum' + sd)], [I['hum' + sd], W('hum' + sd), W('for' + sd)], [I['for' + sd], W('for' + sd), W('mc' + sd)], [I['mc' + sd], W('mc' + sd), W('fpaw' + sd)]], p, 4));
    K.paint(fore, (p, n) => {
      let c = furColor(p, n);
      c = mix(c, C.thighIn, sstep(0.2, 0.8, -n.x) * sstep(0.7, 0.55, p.y) * 0.5);
      c = mix(c, mul(C.leg, grizzle(p)), sstep(0.7, 0.45, p.y));
      return mix(c, mul(C.hoof, 1.4), sstep(0.13, 0.08, p.y));
    });
    legParts.push(['fur', fore]);
    // cloven hooves (fetlock -> hoof tip on the ground) and dewclaws
    for (const [pw, up] of [['fpaw' + sd, 'mc' + sd], ['hpaw' + sd, 'met' + sd]]) {
      const f = W(pw), tip = V(f.x, 0.019, f.z + 0.065);
      const hoof = K.sweep({ pts: [V(f.x, f.y + 0.02, f.z - 0.008), f.clone(), V(f.x, f.y - 0.05, f.z + 0.028), tip], up: V(0, 0.6, 1),
        prof: (u, o) => { const r = lerp(0.0235, 0.034, sstep(0.3, 0.8, u)) * (1 - 0.28 * sstep(0.88, 1, u)); o[0] = r * 1.05; o[1] = r * 0.9; o[2] = r * 0.86; o[3] = 2.4; o[4] = 0; o[5] = 0; return o; },
        detail: (u, a) => -0.011 * sstep(0.55, 0.78, u) * ga(a, 0, 0.14), rows: nr(14), nu: nu(16), cap0: 1, cap1: 2 });
      K.skin(hoof, (p) => K.envelope([[I[up], V(f.x, f.y + 0.1, f.z), f], [I[pw], f, tip]], p, 4));
      K.paint(hoof, (p, n, info) => { const hornK = sstep(0.5, 0.62, info ? info.s : 0); return mix(mul(C.leg, 1.05), mul(C.hoof, 0.95 + 0.1 * n.y), hornK); });
      legParts.push(['horn', hoof]);
      const dew = K.sweep({ pts: [V(f.x, f.y + 0.004, f.z - 0.02), V(f.x, f.y - 0.018, f.z - 0.034), V(f.x, f.y - 0.036, f.z - 0.036)], up: V(0, 0, 1), prof: (u, o) => { const r = lerp(0.0105, 0.0045, u); o[0] = r * 1.4; o[1] = r; o[2] = r; o[3] = 2; o[4] = 0; o[5] = 0; return o; }, rows: 4, nu: 8, cap0: 1, cap1: 2 });
      K.skin(dew, [[I[pw], 1]]); K.paint(dew, C.hoof); legParts.push(['horn', dew]);
    }
    const lr = {}; tpl.names.forEach((n, i) => { if (n.endsWith('L')) lr[i] = I[n.slice(0, -1) + 'R']; });
    for (const [slot, g] of legParts) { parts[slot].push(g); parts[slot].push(K.mirrorX(g, (b) => (lr[b] !== undefined ? lr[b] : b))); }
    return parts;
  }

  /* ---------------- animation profile ---------------- */
  const ch = (n) => chan[n];
  const TAILS = ['tail0', 'tail1'];
  const legs = [
    { key: 'FL', type: 'fore', side: 1, chain: ['humL', 'forL', 'mcL', 'fpawL'], padH: 0.105, toeLen: 0.065, lift: 0.14, curl: 0.5 },
    { key: 'FR', type: 'fore', side: -1, chain: ['humR', 'forR', 'mcR', 'fpawR'], padH: 0.105, toeLen: 0.065, lift: 0.14, curl: 0.5 },
    { key: 'HL', type: 'hind', side: 1, chain: ['thL', 'shinL', 'metL', 'hpawL'], padH: 0.105, toeLen: 0.065, lift: 0.12, curl: 0.45 },
    { key: 'HR', type: 'hind', side: -1, chain: ['thR', 'shinR', 'metR', 'hpawR'], padH: 0.105, toeLen: 0.065, lift: 0.12, curl: 0.45 },
  ];
  let curV = 0;
  const gaits = {
    walk: { stride: (v) => 0.85 + 0.38 * v, duty: 0.64, minV: 0.06 },
    trot: { stride: (v) => 1.3 + 0.2 * v, duty: 0.38, minV: 0.06, liftK: () => 1.1 },
    gallop: { stride: (v) => 2.2 + 0.4 * v, get duty() { return Math.min(0.34 - 0.025 * (curV - 3.6), 1.0 / (2.2 + 0.4 * curV)); }, get dutyF() { return Math.min(0.28 - 0.022 * (curV - 3.6), 0.8 / (2.2 + 0.4 * curV)); }, minV: 0.06, liftK: () => 1.3 },
  };
  // lateral-sequence walk, diagonal trot, rotary gallop (hind L->R, fore R->L)
  const offsets = {
    HL: { walk: 0, trot: 0.5, gallop: 0 }, FL: { walk: 0.25, trot: 0, gallop: 0.6 },
    HR: { walk: 0.5, trot: 0, gallop: 0.1 }, FR: { walk: 0.75, trot: 0.5, gallop: 0.48 },
  };
  const vT = 1.55, vG = 3.6;
  function select(v, cur) {
    curV = v;
    if (cur === 'gallop') return v < vG - 0.5 ? 'trot' : 'gallop';
    if (cur === 'trot') return v > vG ? 'gallop' : v < vT - 0.3 ? 'walk' : 'trot';
    return v > vT ? 'trot' : 'walk';
  }
  // pivots in the body bone's local frame (origin y 0.98): hips (dy 0, dz -0.5), shoulders (dy -0.1, dz 0.45)
  const HIP = [0.0, -0.5], SHO = [-0.1, 0.45];

  function base(P, ctx, A) {
    const dt = ctx.dt, v = ctx.v, t = ctx.t;
    ctx.mw = M.damp(ctx.mw || 0, ctx.moving ? Math.min(1, v / 0.6) : 0, 6, dt);
    const g = ctx.gaitName;
    ctx.gw = M.damp(ctx.gw || 0, g === 'gallop' ? 1 : 0, 5, dt);
    ctx.tw = M.damp(ctx.tw || 0, g === 'trot' ? 1 : 0, 5, dt);
    ctx.cw = M.damp(ctx.cw || 0, ctx.mode === 'charge' ? 1 : 0, 6, dt);
    ctx.aw = M.damp(ctx.aw || 0, ctx.alert ? 1 : 0, 4, dt);
    const mw = ctx.mw, idle = 1 - mw, gw = ctx.gw, tw = ctx.tw, cw = ctx.cw, aw = ctx.aw, ph = ctx.phase * TAU, walkW = Math.max(0, 1 - gw - tw);
    // vertical motion: walk / trot double bob, gallop one big bounding cycle
    P[ch('body.py')] += mw * (walkW * -0.012 * Math.cos(2 * ph) + tw * -0.025 * Math.cos(2 * ph) + gw * 0.07 * Math.sin(ph + 0.9)) - 0.03 * gw - 0.03 * cw;
    // gallop: the spine flexes (feet gathered) and extends (flight)
    const flex = gw * 0.2 * Math.sin(ph + 0.5);
    P[ch('pelvis.rx')] += flex; P[ch('chest.rx')] -= flex * 0.7;
    P[ch('body.rx')] += gw * (0.06 * Math.sin(ph + 2.1) + 0.03);
    // walk: hip drop and sway, rolling shoulders
    P[ch('pelvis.rz')] += mw * (walkW + tw * 0.5) * 0.04 * Math.sin(ph);
    P[ch('pelvis.ry')] += mw * walkW * 0.05 * Math.sin(ph + 0.4);
    P[ch('chest.rz')] += mw * walkW * 0.03 * Math.sin(ph + PI * 0.5);
    P[ch('chest.ry')] += mw * walkW * -0.04 * Math.sin(ph + 0.4);
    P[ch('body.rz')] += mw * walkW * 0.015 * Math.sin(ph);
    // bend into turns (the head leads)
    const tr = M.clamp(ctx.turn * 0.07, -0.3, 0.3);
    P[ch('chest.ry')] += tr; P[ch('pelvis.ry')] -= tr * 0.55; P[ch('neck.ry')] += tr * 0.8; P[ch('head.ry')] += tr * 0.4;
    // idle: proud head, slow look-around, ears swivel independently
    const look = (vnoise3(t * 0.25, 1.3, 0) - 0.5) * 1.5, lookY = (vnoise3(t * 0.22, 4.1, 2) - 0.5) * 0.6;
    P[ch('neck.ry')] += idle * look * 0.4; P[ch('head.ry')] += idle * look * 0.3;
    P[ch('neck.rx')] += idle * (lookY * 0.2 - 0.04); P[ch('head.rx')] += idle * (lookY * 0.2 + 0.03);
    P[ch('body.px')] += idle * 0.01 * Math.sin(t * 0.4);
    // alert (authority flag): head up, ears forward
    P[ch('neck.rx')] -= aw * 0.18; P[ch('head.rx')] -= aw * 0.06;
    // walk head bob (once per stride), head extended in the gallop and lowered in the charge; neck cancels body pitch
    const bodyPitch = P[ch('body.rx')] + P[ch('chest.rx')];
    P[ch('neck.rx')] += mw * walkW * 0.07 * Math.sin(2 * ph - 0.8) + mw * tw * 0.04 * Math.sin(2 * ph) + gw * 0.3 + cw * 0.3;
    P[ch('head.rx')] += mw * walkW * 0.05 * Math.sin(2 * ph - 1.6) - gw * 0.08 + cw * 0.15;
    P[ch('neck.rx')] -= bodyPitch * 0.8 + gw * 0.04; P[ch('head.rx')] -= bodyPitch * 0.15;
    // tail: hangs, flicks at rest, flags up in the gallop
    for (let i = 0; i < TAILS.length; i++) {
      P[ch(TAILS[i] + '.rx')] += (i === 0 ? 0.7 : 0.3) * gw + (i === 0 ? 0.25 : 0.1) * tw + idle * 0.06 * Math.sin(t * 1.3 - i);
      P[ch(TAILS[i] + '.ry')] += idle * 0.25 * Math.sin(t * 6 - i) * sstep(0.45, 0.7, vnoise3(t * 0.35, 9, 3)) + mw * walkW * 0.1 * Math.sin(ph - i * 0.7);
    }
    // ears: idle swivel, forward when alert, laid back at speed / in the charge
    const back = Math.max(gw * 0.9, cw, tw * 0.25);
    const fl = (vnoise3(t * 0.5, 9, 1) - 0.5), fr = (vnoise3(t * 0.5, 2, 7) - 0.5);
    P[ch('earL.ry')] += idle * 0.5 * fl + aw * 0.3; P[ch('earR.ry')] += idle * 0.5 * fr - aw * 0.3;
    P[ch('earL.rx')] += idle * 0.25 * fr + aw * 0.3 - back * 0.55; P[ch('earR.rx')] += idle * 0.25 * fl + aw * 0.3 - back * 0.55;
    P[ch('earL.rz')] -= back * 0.3; P[ch('earR.rz')] += back * 0.3;
    P[ch('earL.rz')] += idle * Math.max(0, Math.sin(t * 11)) * (vnoise3(t * 0.4, 3, 8) > 0.66 ? 0.35 : 0);       // occasional flick
    // scapulae glide with the fore steps
    const fL = A.gait.feet[0], fR = A.gait.feet[1];
    const sk = mw * (0.14 + 0.08 * gw);
    P[ch('scapL.rx')] += sk * scapSwing(fL); P[ch('scapR.rx')] += sk * scapSwing(fR);
  }
  function scapSwing(f) { return f.planted ? M.lerp(-0.5, 0.6, f.stanceU) : M.lerp(0.6, -0.5, M.ease.io(f.swingU)); }
  // cannon pitch: rolls over the planted hoof, folds back in the swing (carpal / hock flexion)
  function distal(Lg, f, ctx) {
    const mw = ctx.mw || 0;
    if (Lg.type === 'hind') {
      if (f.planted) return Lg.restDistal + 0.28 * (1 - 2 * f.stanceU) * mw;
      return Lg.restDistal - 0.85 * Math.sin(PI * Math.min(1, f.swingU * 1.05)) + 0.25 * sstep(0.6, 1, f.swingU) * mw;
    }
    if (f.planted) return Lg.restDistal + 0.32 * (1 - 2 * f.stanceU) * mw;
    return Lg.restDistal - 1.6 * Math.sin(PI * Math.min(1, f.swingU * 1.08)) + 0.35 * sstep(0.6, 1, f.swingU) * mw;
  }
  const PASTERN = Math.atan2(0.086, 0.065);                              // hoof pitch below horizontal at rest
  function toeExtra() { return PASTERN; }
  function post(P, ctx, A) {
    const breath = Math.sin(ctx.t * (ctx.moving ? 7.5 + 2 * (ctx.gw || 0) : 2.4));
    A.B[I.ribs].scale.setScalar(ctx.dead ? 1 : 1 + 0.022 * breath);
    if (P[ch('chew')]) A.B[I.jaw].rotateX(0.12 * P[ch('chew')]);
  }
  function secondary(ctx, A) {
    const dt = ctx.dt, B = A.B;
    const tgt = -M.clamp(ctx.turn * 0.1, -0.6, 0.6);
    B[I.tail1].rotateY(K.stepSpring(A.sp_('t1'), tgt * 0.5, 70, 7, dt) * 0.4);
    const ey = K.stepSpring(A.sp_('ear'), (B[I.body].position.y - BODY_Y) * -14, 300, 16, dt);
    B[I.earL].rotateX(ey * 0.25); B[I.earR].rotateX(ey * 0.25);
  }
  const TAIL_IX = TAILS.map((n) => I[n]);
  const TAIL_END = TAILS.map((n, k) => (k < TAILS.length - 1 ? tpl.local[I[TAILS[k + 1]]].clone() : new T.Vector3(...ends.tail1).sub(tpl.world[I.tail1])));
  const TAIL_MIN = [0.06, 0.05];
  function ground(ctx, A) { K.groundChain(A, TAIL_IX, TAIL_END, TAIL_MIN); }
  function flinch(P, t, dir, pow) {
    const k = Math.exp(-t * 8) * Math.sin(Math.min(1, t * 11) * PI * 0.5) * pow;
    P[ch('body.px')] += dir[0] * 0.06 * k; P[ch('body.pz')] += dir[1] * 0.06 * k; P[ch('body.py')] -= 0.03 * k;
    P[ch('body.rz')] += -dir[0] * 0.1 * k; P[ch('chest.rx')] += 0.08 * k;
    P[ch('neck.rx')] -= 0.28 * k; P[ch('head.rx')] -= 0.18 * k; P[ch('head.ry')] += dir[0] * 0.3 * k; P[ch('jaw.rx')] += 0.3 * k;
    P[ch('earL.rx')] -= 0.6 * k; P[ch('earR.rx')] -= 0.6 * k; P[ch('tail0.rx')] += 0.4 * k;
  }

  /* ---------------- actions (keyed on the authority's phase instants) ---------------- */
  function through(ph, vals) { const c = M.curve(['s', 'an', 'wu', 'hit', 'fo', 'e'].map((nm, i) => [ph[nm], vals[i]]).filter((x, i, a) => i === 0 || x[0] > a[i - 1][0] + 1e-6)), o = [0]; return (u) => c(u, o)[0]; }
  // one fore hoof paws the ground backwards (FK) between u = from..to
  function scrape(P, u, w, from, to, legKey, s, strokes) {
    const e = sstep(from, from + 0.05, u) * sstep(to, to - 0.05, u) * w;
    if (e <= 0) return;
    const cyc = (u - from) / (to - from) * (strokes || 2);
    const sw = Math.sin(cyc * TAU);
    P[ch(legKey)] -= e;
    P[ch('hum' + s + '.rx')] += (-0.55 + 0.4 * sw) * e; P[ch('for' + s + '.rx')] += (0.9 - 0.4 * sw) * e; P[ch('mc' + s + '.rx')] += (0.8 + 0.3 * Math.cos(cyc * TAU)) * e;
  }
  const actions = {};
  {
    const a = D.attacks.gore, ph = a.phases;
    const tr = K.track(chan, ph, {
      // s, an (weight back, head lifts to size the target), wu (low and cocked to the left, antlers aimed), hit (hooking sweep to the right + thrust), fo (overshoot), e
      'neck.rx': [0, -0.12, 0.55, 0.4, 0.05, 0], 'head.rx': [0, -0.1, 0.3, 0.2, -0.1, 0],
      'neck.ry': [0, 0.05, 0.55, -0.5, -0.6, 0], 'head.ry': [0, 0.04, 0.3, -0.3, -0.35, 0], 'head.rz': [0, 0, -0.2, 0.15, 0.1, 0],
      'chest.rx': [0, -0.07, 0.08, -0.04, -0.03, 0], 'chest.ry': [0, 0.04, 0.18, -0.2, -0.22, 0],
      'pelvis.rx': [0, 0.05, 0.12, -0.08, -0.02, 0], 'pelvis.ry': [0, -0.03, -0.1, 0.1, 0.1, 0],
      'jaw.rx': [0, 0.04, 0.1, 0.25, 0.1, 0],
      'earL.rx': [0, 0.2, -0.5, -0.6, -0.3, 0], 'earR.rx': [0, 0.2, -0.5, -0.6, -0.3, 0],
      'tail0.rx': [0, 0.25, 0.1, 0.35, 0.2, 0],
    });
    const pz = through(ph, [0, -0.1, -0.1, 0.13, 0.08, 0]), py = through(ph, [0, 0.0, -0.1, -0.02, -0.01, 0]);
    actions.gore = { kind: 'attack', dur: a.dur, blendIn: 0.1, blendOut: 0.25, track: (P, u, w) => {
      tr(P, u, w);
      P[ch('body.pz')] += pz(u) * w; P[ch('body.py')] += py(u) * w;
      // forequarters heave up into the hook
      const lift = sstep(ph.wu, ph.hit, u) * sstep(ph.fo + 0.1, ph.hit, u);
      K.pitchAbout(P, chan, -0.08 * lift * w, HIP[0], HIP[1]);
    } };
  }
  {
    const a = D.attacks.charge, ph = a.phases;
    const tr = K.track(chan, ph, {
      // s, an (head low, paws), wu (coiled, antlers down), hit (head-down impact posture, antlers forward), fo (skid, head tossed up), e
      'neck.rx': [0, 0.5, 0.72, 0.72, -0.2, 0], 'head.rx': [0, 0.25, 0.42, 0.45, -0.25, 0],
      'chest.rx': [0, 0.05, 0.08, 0.02, -0.06, 0],
      'earL.rx': [0, -0.5, -0.8, -0.8, -0.4, 0], 'earR.rx': [0, -0.5, -0.8, -0.8, -0.4, 0],
      'tail0.rx': [0, 0.3, 0.5, 0.6, 0.3, 0],
      'body.py': [0, -0.03, -0.07, -0.04, -0.02, 0],
      'jaw.rx': [0, 0.1, 0.18, 0.12, 0.2, 0],
    });
    actions.charge = { kind: 'attack', dur: a.dur, blendIn: 0.12, blendOut: 0.3, ground: true, track: (P, u, w) => {
      tr(P, u, w);
      scrape(P, u, w, 0.02, ph.an + 0.07, 'ikFL', 'L', 2);
      const sk = sstep(ph.fo - 0.08, ph.fo, u) * sstep(1, ph.fo + 0.05, u);        // skid: forequarters brace, rump drops
      K.pitchAbout(P, chan, 0.07 * sk * w, SHO[0], SHO[1]);
      P[ch('body.pz')] -= 0.05 * sk * w;
    } };
  }
  actions.stagger = { kind: 'stagger', dur: 0.9, blendIn: 0.06, blendOut: 0.3, ground: true, track: (P, u, w, layer) => {
    const side = (layer.data && layer.data.side) || 1;
    const e = sstep(0, 0.12, u) * sstep(1, 0.6, u) * w, wob = Math.sin(u * 20) * sstep(0.1, 0.3, u) * sstep(0.9, 0.4, u);
    P[ch('body.px')] += side * 0.14 * e; P[ch('body.rz')] += side * 0.26 * e + 0.06 * wob * w; P[ch('body.ry')] += side * 0.18 * e;
    P[ch('body.py')] -= 0.07 * e; P[ch('pelvis.rx')] -= 0.12 * e; P[ch('body.pz')] -= 0.06 * e;
    K.pitchAbout(P, chan, 0.12 * e, HIP[0], HIP[1]);
    P[ch('neck.rx')] += 0.4 * e; P[ch('head.ry')] += 0.35 * wob * w; P[ch('neck.ry')] -= 0.22 * wob * w; P[ch('jaw.rx')] += 0.25 * e;
    P[ch('earL.rx')] -= 0.6 * e; P[ch('earR.rx')] -= 0.6 * e; P[ch('tail0.rx')] += 0.3 * e;
  } };
  actions.graze = { kind: 'special', dur: 4.2, blendIn: 0.5, blendOut: 0.5, track: (P, u, w) => {
    // head down to the grass, tearing and chewing, a glance up now and then
    const e = M.ease.io(sstep(0, 0.14, u)) * M.ease.io(sstep(1, 0.86, u)) * w;
    const up = sstep(0.5, 0.56, u) * sstep(0.7, 0.62, u);
    const g = e * (1 - 0.9 * up);
    K.pitchAbout(P, chan, 0.12 * g, SHO[0], SHO[1]);
    P[ch('neck.rx')] += 1.0 * g; P[ch('head.rx')] += 0.5 * g; P[ch('body.pz')] += 0.06 * g; P[ch('body.py')] -= 0.04 * g;
    P[ch('neck.ry')] += 0.12 * Math.sin(u * 7) * g;
    P[ch('chew')] += (0.4 + 0.9 * Math.max(0, Math.sin(u * 70))) * g;
    P[ch('earL.rx')] += 0.1 * g; P[ch('earR.rx')] += 0.1 * g;
    P[ch('earL.ry')] += 0.3 * Math.sin(u * 17) * g * up; P[ch('tail0.rx')] += 0.2 * g; P[ch('tail0.ry')] += 0.15 * Math.sin(u * 25) * g;
  } };
  actions.alert = { kind: 'special', dur: 3.4, blendIn: 0.25, blendOut: 0.4, track: (P, u, w) => {
    // head high, ears swivelling to catch a sound, a slow turn of the head, tail flicks
    const e = M.ease.io(sstep(0, 0.12, u)) * M.ease.io(sstep(1, 0.85, u)) * w;
    const yaw = Math.sin(u * TAU) * 0.8;
    P[ch('neck.rx')] -= 0.2 * e; P[ch('head.rx')] += 0.1 * e; P[ch('chest.rx')] -= 0.04 * e;
    P[ch('neck.ry')] += yaw * 0.5 * e; P[ch('head.ry')] += yaw * 0.4 * e;
    P[ch('earL.rx')] += 0.4 * e; P[ch('earR.rx')] += 0.4 * e;
    P[ch('earL.ry')] += (0.5 * Math.sin(u * 19)) * e; P[ch('earR.ry')] += (0.5 * Math.sin(u * 13 + 1)) * e;
    P[ch('tail0.rx')] += 0.4 * e; P[ch('tail0.ry')] += 0.3 * Math.sin(u * 30) * e;
  } };
  actions.shake = { kind: 'special', dur: 2.0, blendIn: 0.2, blendOut: 0.3, track: (P, u, w) => {
    // antler shake: the head thrown side to side, the neck and shoulders following, ears flapping
    const e = sstep(0.05, 0.2, u) * sstep(0.95, 0.72, u) * w;
    const s1 = Math.sin(u * 34), s2 = Math.sin(u * 34 - 0.8);
    P[ch('head.ry')] += 0.5 * s1 * e; P[ch('neck.ry')] += 0.3 * s2 * e; P[ch('head.rz')] += 0.25 * Math.sin(u * 34 + 0.9) * e;
    P[ch('chest.ry')] += 0.1 * Math.sin(u * 34 - 1.5) * e; P[ch('chest.rz')] += 0.05 * s1 * e;
    P[ch('neck.rx')] += 0.2 * e; P[ch('head.rx')] += 0.1 * e;
    P[ch('earL.rz')] += 0.6 * Math.sin(u * 34 + 1) * e; P[ch('earR.rz')] += 0.6 * Math.sin(u * 34 + 1) * e;
    P[ch('tail0.ry')] += 0.3 * s2 * e;
  } };
  actions.stamp = { kind: 'special', dur: 2.6, blendIn: 0.3, blendOut: 0.4, ground: true, track: (P, u, w) => {
    // head lowered with the antlers forward, pawing and stamping the ground in challenge
    const e = M.ease.io(sstep(0, 0.12, u)) * M.ease.io(sstep(1, 0.88, u)) * w;
    P[ch('neck.rx')] += 0.45 * e; P[ch('head.rx')] += 0.3 * e; K.pitchAbout(P, chan, 0.03 * e, SHO[0], SHO[1]);
    P[ch('neck.ry')] += 0.1 * Math.sin(u * 9) * e;
    P[ch('earL.rx')] -= 0.4 * e; P[ch('earR.rx')] -= 0.4 * e;
    scrape(P, u, w, 0.14, 0.52, 'ikFL', 'L', 2);
    scrape(P, u, w, 0.5, 0.88, 'ikFR', 'R', 2);
  } };
  actions.death = { kind: 'death', dur: 2.0, blendIn: 0.06, hold: true, track: (P, u, w, layer) => {
    const side = (layer.data && layer.data.side) || 1;
    // fore knees buckle (chest drops, neck lowers), the hindquarters give way, the body rolls onto its side; a last kick
    const buckle = M.ease.io(sstep(0.0, 0.28, u)), fall = M.ease.io(sstep(0.2, 0.62, u)), kick = sstep(0.6, 0.66, u) * sstep(0.9, 0.66, u);
    K.pitchAbout(P, chan, 0.2 * buckle * (1 - fall) * w, HIP[0], HIP[1]);
    P[ch('body.py')] += (-0.2 * buckle - 0.3 * fall) * w;
    P[ch('body.rz')] += side * 1.45 * fall * w; P[ch('body.px')] += -side * 0.12 * fall * w;
    P[ch('chest.rx')] += 0.1 * fall * w; P[ch('pelvis.rx')] -= 0.1 * fall * w;
    P[ch('neck.rx')] += (0.55 * buckle - 0.1 * fall) * w; P[ch('head.rx')] += 0.2 * fall * w; P[ch('jaw.rx')] += 0.2 * fall * w;
    P[ch('neck.ry')] += side * 0.35 * fall * w; P[ch('head.rz')] -= side * 0.15 * fall * w;
    const ikF = sstep(0.04, 0.2, u) * w, ikH = sstep(0.2, 0.42, u) * w;
    P[ch('ikFL')] -= ikF; P[ch('ikFR')] -= ikF; P[ch('ikHL')] -= ikH; P[ch('ikHR')] -= ikH;
    for (const sd of ['L', 'R']) {
      const top = sd === (side > 0 ? 'L' : 'R') ? 1 : 0;
      P[ch('hum' + sd + '.rx')] += (-0.3 * buckle - 0.25 * top * fall + 0.1 * fall - 0.15 * kick * Math.sin(u * 50)) * w;
      P[ch('for' + sd + '.rx')] += (1.3 * buckle * (1 - fall) + (0.5 + 0.4 * top) * fall) * w;
      P[ch('mc' + sd + '.rx')] += (0.9 * buckle * (1 - fall) + (0.5 + 0.3 * top) * fall) * w;
      P[ch('th' + sd + '.rx')] += ((0.25 + 0.3 * top) * fall + 0.2 * kick * Math.sin(u * 45 + 1)) * w;
      P[ch('shin' + sd + '.rx')] -= (0.25 + 0.3 * top) * fall * w; P[ch('met' + sd + '.rx')] += (0.35 + 0.2 * top) * fall * w;
    }
    for (let i = 0; i < TAILS.length; i++) P[ch(TAILS[i] + '.ry')] += side * 0.3 * fall * w;
    P[ch('earL.rx')] -= 0.5 * fall * w; P[ch('earR.rx')] -= 0.5 * fall * w;
  } };

  K.defineSpecies('stag', {
    rig: tpl, chan, build, lowQ: 0.5, animator: K.QuadAnimator, debugScale: 2.2,
    anim: { legs, gaits, offsets, select, base, distal, toeExtra, post, secondary, ground, flinch, actions, gaitOpts: { restTol: 0.11, idleStepDur: 0.3, strainFrom: 0.45 }, groundFix: true },
    clips: ['idle', 'walk', 'run', 'charge', 'gore', 'graze', 'alert', 'shake', 'stamp', 'stagger', 'hit', 'death'],
    specials: ['graze', 'alert', 'graze', 'shake', 'stamp'],
    def: D,
  });
})();
