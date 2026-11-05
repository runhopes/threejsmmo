/* =====================================================================================================
 *  magefx/spells.js  -  the nine mage spells, each built from the same phase grammar:
 *      cast (anticipation, every frame until the animation's contact)  ->  release  ->  travel  ->  impact  ->  linger
 *  plus the shared building blocks every spell is assembled from (staff charge / release, impact kits, decals,
 *  afterburn, telegraphs) so all nine read as ONE class: same sigil construction, same white-hot release flare,
 *  same ring + scorch language at impact, colour by school (fire / frost / storm / arcane / ward).
 *
 *  Gameplay never lives here: the host passes callbacks (step = collision test, onHit, onImpact, onSweep, onTick)
 *  and the VFX calls them at the visual moment, so damage lands exactly when the effect hits.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE, MFX = global.MageFX, M = MFX.math, F = MFX.FRAME, PAL = MFX.PAL, DUST = MFX.DUST;
  const V3 = () => new T.Vector3();
  const _a = V3(), _b = V3(), _d = V3(), _e = V3(), _u = V3(), _w = V3(), UP = new T.Vector3(0, 1, 0), ZF = new T.Vector3(0, 0, 1);

  /* =====================================================================================================
   *  TUNING - every knob the test scene exposes. (G) = also drives gameplay timing through the callbacks.
   * ===================================================================================================== */
  MFX.TUNING_DEFAULT = {
    global:   { brightness: 1.0, lights: 1.0, density: 1.0 },
    fireball: { speed: 19, size: 1.0, trail: 0.2, impact: 1.0, scorch: 2.6 },
    meteor:   { fall: 0.7, size: 1.0, burn: 2.4, scorch: 3.8, shake: 1.0 },
    nova:     { expand: 0.42, height: 0.95, burn: 0.7 },
    ice:      { speed: 30, impact: 1.0, splinter: 1.6, frost: 2.8 },
    bolt:     { preflash: 0.07, flicker: 0.3, residue: 0.7 },
    pillar:   { delay: 0.1, duration: 1.5, height: 3.6, tick: 0.3 },
    blink:    { streak: 0.2, range: 8 },
    mshield:  { form: 0.32, absorb: 700, duration: 12 },
    storm:    { count: 6, interval: 0.22, fall: 0.6, size: 0.62, burn: 2.6 },
  };
  MFX.TUNING_META = {
    global:   { brightness: [0.4, 1.8, 0.05, 'Parlaklık'], lights: [0, 2, 0.05, 'Işık gücü'], density: [0.2, 1.5, 0.05, 'Parçacık yoğunluğu'] },
    fireball: { speed: [8, 40, 1, 'Hız m/s (G)'], size: [0.5, 1.8, 0.05, 'Boyut'], trail: [0.05, 0.5, 0.01, 'İz süresi s'], impact: [0.4, 2, 0.05, 'Patlama ölçeği'], scorch: [0.5, 6, 0.1, 'Yanık izi s'] },
    meteor:   { fall: [0.25, 1.4, 0.05, 'Düşüş süresi s (G)'], size: [0.6, 1.6, 0.05, 'Boyut'], burn: [0, 5, 0.1, 'Artçı yanma s'], scorch: [1, 10, 0.5, 'Krater izi s'], shake: [0, 2, 0.05, 'Sarsıntı'] },
    nova:     { expand: [0.2, 1.2, 0.02, 'Yayılma süresi s (G)'], height: [0.4, 1.8, 0.05, 'Alev yüksekliği m'], burn: [0, 2, 0.05, 'Söndürme s'] },
    ice:      { speed: [12, 50, 1, 'Hız m/s (G)'], impact: [0.4, 2, 0.05, 'Kırılma ölçeği'], splinter: [0.3, 4, 0.1, 'Buz dikenleri s'], frost: [0.5, 6, 0.1, 'Kırağı izi s'] },
    bolt:     { preflash: [0, 0.3, 0.01, 'Ön parlama s (G)'], flicker: [0.1, 0.8, 0.02, 'Titreşim s'], residue: [0, 2, 0.05, 'Kalıntı kıvılcım s'] },
    pillar:   { delay: [0, 0.5, 0.01, 'Fışkırma gecikmesi s (G)'], duration: [0.4, 4, 0.1, 'Süre s (G)'], height: [2, 9, 0.1, 'Yükseklik m'], tick: [0.1, 1, 0.05, 'Hasar aralığı s (G)'] },
    blink:    { streak: [0.05, 0.6, 0.01, 'İz süresi s'], range: [3, 14, 0.5, 'Menzil m (G)'] },
    mshield:  { form: [0.1, 1, 0.02, 'Oluşma süresi s'], absorb: [100, 2000, 50, 'Emilim (G)'], duration: [2, 30, 1, 'Süre s (G)'] },
    storm:    { count: [3, 12, 1, 'Meteor sayısı (G)'], interval: [0.08, 0.5, 0.01, 'Aralık s (G)'], fall: [0.25, 1.2, 0.05, 'Düşüş süresi s (G)'], size: [0.4, 1, 0.02, 'Küçük meteor ölçeği'], burn: [0, 5, 0.1, 'Son yanma s'] },
  };

  /* =====================================================================================================
   *  PARTICLE SPECS - a standard kit per school + school-specific extras. Built once per director.
   * ===================================================================================================== */
  function schoolKit(P) {
    const S = MFX.spec;
    return {
      flash: S({ frame: F.GLOW, life: [0.09, 0.11], size: [1, 1], grow: 1.25, c: [P.core, P.hot, P.flame], mid: 0.5, fin: 0, fout: 1.6, add: 1, hdr: 1.2 }),
      bloom: S({ frame: F.GLOW, life: [0.2, 0.26], size: [1, 1], grow: 1.5, c: [P.hot, P.flame, P.deep], mid: 0.35, fin: 0, fout: 1.4, add: 0.8, alpha: 0.7 }),
      star: S({ frame: F.STAR, life: [0.1, 0.13], size: [1, 1], grow: 0.55, c: [P.core, P.hot], fin: 0, fout: 1.3, add: 1, hdr: 1.3, rot: 0 }),
      ring: S({ frame: F.RING, life: [0.16, 0.2], size: [1, 1], grow: 2.6, c: [P.core, P.hot, P.flame], fin: 0, fout: 1.2, add: 1, rot: 0 }),
      mote: S({ frame: F.EMBER, life: [0.26, 0.4], size: [0.045, 0.075], grow: 0.4, c: [P.core, P.hot, P.flame], mid: 0.5, fin: 0.2, fout: 1, add: 1, drag: 2.5, attract: 26, hdr: 1.25 }),
      drift: S({ frame: F.EMBER, life: [0.35, 0.6], size: [0.05, 0.08], grow: 0.3, c: [P.core, P.hot, P.flame], mid: 0.4, fin: 0.05, fout: 1, add: 1, drag: 2.5, hdr: 1.25 }),
      spark: S({ frame: F.SPARK, life: [0.18, 0.34], size: [0.08, 0.11], aspect: 0.4, stretch: 0.045, c: [P.core, P.hot, P.flame], mid: 0.35, fin: 0, fout: 1, add: 1, drag: 1.6, grav: -9, bounce: true, hdr: 1.3 }),
      ember: S({ frame: F.EMBER, life: [0.6, 1.1], size: [0.04, 0.07], grow: 0.5, c: [P.core, P.ember, P.deep], mid: 0.3, fin: 0.05, fout: 1, add: 1, drag: 1.4, grav: 0.9, hdr: 1.2 }),
      rune: S({ frames: [F.RUNE_A, F.RUNE_B], life: [0.5, 0.8], size: [0.14, 0.2], grow: 0.8, c: [P.runeHi, P.rune, P.deep], mid: 0.5, fin: 0.2, fout: 1.3, add: 0.75, drag: 2, grav: 0.9, spin: [-0.6, 0.6], rot: 0 }),
      glint: S({ frame: F.STAR, life: [0.14, 0.26], size: [0.1, 0.18], grow: 0.3, c: [P.core, P.hot], fin: 0.2, fout: 1, add: 1, rot: 0, hdr: 1.2 }),
      shaft: S({ frame: F.GLOW, life: [0.24, 0.28], size: [0.6, 0.6], grow: 0.25, aspect: 0.55, stretch: 190, c: [P.core, P.hot, P.flame], fin: 0, fout: 1.3, add: 1, hdr: 1.2 }),   // world-vertical light shaft: spawn at y 2.5 with vel (0,+0.01,0) (stretch extends against the velocity)
      glowHeld: S({ frame: F.GLOW, c: [P.flame], add: 0.85 }),
      coreHeld: S({ frame: F.CORE, c: [P.core], add: 1, hdr: 1.3 }),
      cometHeld: S({ frame: F.SPARK, c: [P.hot], add: 0.7, stretch: 0.035, aspect: 0.85, hdr: 1.1 }),
      runeHeld: S({ frames: [F.RUNE_A], c: [P.runeHi], add: 0.75, rot: 0 }),
    };
  }
  function buildSpecs() {
    const S = MFX.spec, f = PAL.fire, i = PAL.frost, s = PAL.storm, a = PAL.arcane, w = PAL.ward;
    const kit = { fire: schoolKit(f), frost: schoolKit(i), storm: schoolKit(s), arcane: schoolKit(a), ward: schoolKit(w) };
    const sp = {
      fire: {
        flame: S({ frames: [F.FLAME_A, F.FLAME_B], life: [0.34, 0.52], size: [0.36, 0.52], grow: 1.7, c: [f.hot, f.flame, f.deep], mid: 0.32, fin: 0.05, fout: 1.3, add: 0.38, drag: 3.6, grav: 1.8, spin: [-1.6, 1.6], alpha: 0.95 }),
        fcore: S({ frames: [F.FLAME_A, F.FLAME_B], life: [0.16, 0.24], size: [0.5, 0.7], grow: 1.4, c: [f.core, f.hot, f.flame], mid: 0.45, fin: 0, fout: 1.4, add: 0.75, drag: 5, grav: 1, spin: [-2, 2], hdr: 1.15 }),
        lick: S({ frame: F.TONGUE, life: [0.22, 0.34], size: [0.3, 0.45], grow: 0.75, c: [f.core, f.hot, f.flame], mid: 0.35, fin: 0.12, fout: 1.2, add: 0.5, drag: 2.2, grav: 2.5, rot: 0, alpha: 0.95 }),
        tail: S({ frames: [F.FLAME_A, F.FLAME_B], life: [0.09, 0.15], size: [0.26, 0.34], grow: 0.35, c: [f.core, f.hot, f.flame], mid: 0.3, fin: 0, fout: 1.1, add: 0.6, drag: 4, spin: [-3, 3] }),
        smoke: S({ frames: [F.SMOKE_A, F.SMOKE_B], life: [0.9, 1.4], size: [0.36, 0.52], grow: 2.2, c: [0x4a3c34, f.smoke, f.smoke], mid: 0.3, fin: 0.2, fout: 1.2, alpha: 0.46, add: 0, drag: 1.8, grav: 0.9, layer: 0, spin: [-0.6, 0.6] }),
        dust: S({ frames: [F.SMOKE_A, F.SMOKE_B], life: [0.6, 1.0], size: [0.45, 0.65], grow: 2.2, c: [DUST.light, DUST.mid, DUST.dark], fin: 0.08, fout: 1.3, alpha: 0.5, add: 0, drag: 3.2, grav: 0.25, layer: 0, spin: [-0.4, 0.4] }),
        heat: S({ frame: F.GLOW, life: [0.4, 0.6], size: [0.4, 0.6], grow: 1.6, c: [0xfff0d0, 0xffd0a0], alpha: 0.07, add: 1, grav: 2, drag: 1 }),
        upEmber: S({ frame: F.EMBER, life: [0.35, 0.55], size: [0.05, 0.08], grow: 0.3, c: [f.core, f.hot, f.flame], fin: 0, fout: 1, add: 1, drag: 0.5, hdr: 1.3, stretch: 0.02, aspect: 0.6 }),
        fallSpark: S({ frame: F.SPARK, life: [0.3, 0.5], size: [0.1, 0.14], aspect: 0.4, stretch: 0.04, c: [f.core, f.hot, f.deep], mid: 0.3, fin: 0, fout: 1, add: 1, drag: 1, grav: -7, hdr: 1.2 }),
      },
      frost: {
        shardBit: S({ frame: F.SHARD, life: [0.32, 0.55], size: [0.09, 0.17], grow: 0.6, c: [i.core, i.hot, i.flame], mid: 0.4, fin: 0, fout: 1, add: 0.45, drag: 1.2, grav: -9, bounce: true, spin: [-12, 12] }),
        shardMote: S({ frame: F.SHARD, life: [0.26, 0.4], size: [0.06, 0.1], grow: 0.5, c: [i.core, i.hot], fin: 0.2, fout: 1, add: 0.7, drag: 2.5, attract: 30, spin: [-6, 6] }),
        snow: S({ frame: F.FLAKE, life: [0.5, 0.9], size: [0.05, 0.08], grow: 0.7, c: [i.core, i.hot], fin: 0.15, fout: 1, add: 0.7, drag: 1.5, grav: -0.7, spin: [-2, 2] }),
        bit: S({ frame: F.EMBER, life: [0.22, 0.36], size: [0.035, 0.06], grow: 0.4, c: [i.core, i.hot, i.flame], fin: 0, fout: 1, add: 1, drag: 2, hdr: 1.2 }),
        mist: S({ frames: [F.SMOKE_A, F.SMOKE_B], life: [0.8, 1.2], size: [0.3, 0.45], grow: 1.9, c: [0xeef8ff, 0xc8e2f6, 0xa6c6e2], fin: 0.15, fout: 1.2, alpha: 0.32, add: 0.1, drag: 2.6, grav: -0.25, layer: 0, spin: [-0.4, 0.4] }),
      },
      storm: {
        zap: S({ frame: F.ARC, life: [0.05, 0.1], size: [0.22, 0.4], grow: 1.1, c: [s.core, s.hot, s.flame], fin: 0, fout: 0.6, add: 1, hdr: 1.4 }),
        ozone: S({ frames: [F.SMOKE_A, F.SMOKE_B], life: [0.7, 1.0], size: [0.4, 0.6], grow: 1.8, c: [0xd8e0ff, 0xa8b4e0], alpha: 0.16, add: 0.4, drag: 2, grav: 0.4, layer: 0 }),
      },
      arcane: {
        dissolve: S({ frame: F.EMBER, life: [0.35, 0.6], size: [0.05, 0.09], grow: 0.3, c: [a.core, a.hot, a.flame], mid: 0.35, fin: 0, fout: 1, add: 1, drag: 2.5, hdr: 1.3 }),
        implode: S({ frame: F.EMBER, life: [0.2, 0.28], size: [0.05, 0.08], grow: 0.6, c: [a.flame, a.hot, a.core], mid: 0.5, fin: 0.15, fout: 0.8, add: 1, drag: 0.6, hdr: 1.3 }),
        streak: S({ frame: F.SPARK, life: [0.14, 0.24], size: [0.12, 0.16], aspect: 0.35, stretch: 0.03, c: [a.core, a.hot, a.flame], fin: 0, fout: 1, add: 1, drag: 1.5, hdr: 1.3 }),
      },
      ward: {
        shard: S({ frame: F.SHARD, life: [0.35, 0.6], size: [0.08, 0.15], grow: 0.6, c: [w.core, w.hot, w.flame], mid: 0.4, fin: 0, fout: 1, add: 0.6, drag: 1.5, grav: -7, bounce: true, spin: [-10, 10] }),
      },
    };
    return { kit, sp };
  }
  MFX._buildSpecs = buildSpecs;

  /* =====================================================================================================
   *  BUILDING BLOCKS
   * ===================================================================================================== */
  // spawn n particles of spec S from p. o: { dir (cone axis) + spread, hemi [yMin, yMax], off (spawn radius), vx/vy/vz add, sMul, lMul, anchor }
  const _ax = V3(), _bp = V3();
  function burst(c, S, p, n, smin, smax, o) {
    o = o || {};
    n = M.count(n * c.density);
    if (o.dir) _ax.copy(o.dir);                                   // copies: callers may pass the shared temps
    p = _bp.copy(p);
    for (let k = 0; k < n; k++) {
      if (o.dir) { M.sphere(_e); _d.copy(_ax).addScaledVector(_e, o.spread === undefined ? 0.5 : o.spread).normalize(); }
      else if (o.hemi) M.hemi(_d, o.hemi[0], o.hemi[1]);
      else M.sphere(_d);
      const sp = M.rand(smin, smax), off = o.off || 0;
      c.ps.spawn(S, p.x + _d.x * off, p.y + _d.y * off * (o.offY === undefined ? 1 : o.offY), p.z + _d.z * off,
        _d.x * sp + (o.vx || 0), _d.y * sp + (o.vy || 0), _d.z * sp + (o.vz || 0), o.sMul, o.lMul, o.anchor);
    }
  }
  const one = (c, S, p, size, lMul) => c.ps.spawn(S, p.x, p.y, p.z, 0, 0, 0, size, lMul);
  // expanding ground shock ring. o: { w (m), hot, innerA, pow, color, color2, add, r0, alpha }
  function ringDecal(c, p, school, maxR, dur, o) {
    o = o || {}; const P = PAL[school] || PAL.fire, r0 = o.r0 === undefined ? 0.06 : o.r0, al = o.alpha === undefined ? 1 : o.alpha;
    return c.ground.add('ring', { x: p.x, z: p.z, r: maxR, color: o.color === undefined ? P.hot : o.color, color2: o.color2 === undefined ? P.flame : o.color2,
      w: (o.w || 0.1) / maxR, hot: o.hot === undefined ? 1 : o.hot, innerA: o.innerA || 0, pow: o.pow || 5, add: o.add === undefined ? 0.85 : o.add,
      update: (D) => { const u = D.t / dur; D.u.uR.value = r0 + (1 - r0) * M.easeOut(u); D.u.uAlpha.value = al * Math.pow(Math.max(0, 1 - u), 1.2); return u < 1; } });
  }
  // burnt ground: dark blot + glowing cracks that cool. o: { life, cool, dark, color, color2, inT }
  const SCORCH_MAX = 8;
  function scorch(c, p, r, o) {
    o = o || {}; const life = o.life || 3, cool = o.cool || 1.5, dark = o.dark === undefined ? 0.8 : o.dark;
    const Q = c.scorches || (c.scorches = []);
    for (let i = Q.length - 1; i >= 0; i--) if (Q[i].dead || !Q[i].mesh.parent) Q.splice(i, 1);
    if (Q.length >= SCORCH_MAX) Q.shift().data.fast = true;
    const D = c.ground.add('scorch', { x: p.x, z: p.z, r, color: o.color === undefined ? PAL.fire.hot : o.color, color2: o.color2 === undefined ? PAL.fire.deep : o.color2, dark, heat: 1,
      update: (D, dt) => {
        const t = D.t; D.u.uHeat.value = Math.pow(Math.max(0, 1 - t / cool), 1.5);
        if (D.data.fast) { D.data.fk = (D.data.fk === undefined ? 1 : D.data.fk) - dt * 3; D.u.uAlpha.value *= Math.max(0, D.data.fk); return D.data.fk > 0; }
        D.u.uAlpha.value = Math.min(1, t / (o.inT || 0.06)) * Math.min(1, (life - t) / Math.min(1.2, life * 0.4)); return t < life;
      } });
    Q.push(D);
    return D;
  }
  // soft ground disk: additive light pool (add 1) or shadow blob (color 0, add 0)
  function glowDisk(c, p, r, color, I, dur, o) {
    o = o || {};
    return c.ground.add('glow', { x: p.x, z: p.z, r, color, add: o.add === undefined ? 1 : o.add, pow: o.pow || 1.6, alpha: I,
      update: o.update || ((D) => { const u = D.t / dur; D.u.uAlpha.value = I * Math.pow(Math.max(0, 1 - u), 2) * Math.min(1, D.t / 0.03); return u < 1; }) });
  }
  // a sigil drawn on the ground (feet sigils, markers). Fades via D.data.out = 'flare' | 'fade'
  function feetSigil(c, p, r, school, o) {
    o = o || {}; const P = PAL[school];
    const D = c.ground.add('sigil', { x: p.x, z: p.z, r, map: c.tex.sigils[school], color: P.rune, color2: P.runeHi, accent: o.accent || P.runeHi,
      edgeW: Math.min(0.09, 0.075 / r), fillA: o.fillA === undefined ? 0.08 : o.fillA, reveal: o.reveal === undefined ? 1.1 : o.reveal, alpha: 0,
      update: (D, dt) => {
        const d = D.data; d.spin = d.spin || o.spin || 0.6;
        D.u.uRot.value += dt * d.spin;
        if (!d.out) { D.u.uAlpha.value = Math.min(o.alpha || 0.95, D.u.uAlpha.value + dt * 6); return true; }
        d.ot = (d.ot || 0) + dt;
        const dur = d.out === 'flare' ? 0.42 : 0.2, u = d.ot / dur;
        if (d.out === 'flare') { D.u.uPulse.value = Math.max(0, 1 - u * 3) * 1.6; c.ground.resize(D, r * (1 + 0.35 * M.easeOut(u))); }
        D.u.uAlpha.value = (o.alpha || 0.95) * Math.max(0, 1 - u);
        return u < 1;
      } });
    return D;
  }
  // lingering fire on the ground after an impact
  function afterburn(c, p, r, dur, rate) {
    const S = c.sp.fire, K = c.kit.fire;
    c.run((dt, t) => {
      if (t > dur) return false;
      const k = 1 - t / dur;
      let n = M.count(rate * k * dt * c.density);
      while (n-- > 0) { const rr = Math.sqrt(Math.random()) * r, a = Math.random() * M.TAU; c.ps.spawn(S.lick, p.x + Math.cos(a) * rr, 0.04, p.z + Math.sin(a) * rr, 0, 0.4, 0, 0.35 + 0.55 * k * Math.random() + 0.2, 0.9); }
      n = M.count(rate * 0.5 * k * dt * c.density);
      while (n-- > 0) { const rr = Math.sqrt(Math.random()) * r, a = Math.random() * M.TAU; c.ps.spawn(K.ember, p.x + Math.cos(a) * rr, 0.1, p.z + Math.sin(a) * rr, M.rnd(0.4), M.rand(0.6, 1.6), M.rnd(0.4)); }
      if (Math.random() < rate * 0.12 * dt) c.ps.spawn(S.smoke, p.x + M.rnd(r * 0.6), 0.3, p.z + M.rnd(r * 0.6), 0, 0.5, 0, 0.8, 1.2);
      return true;
    });
  }
  // the staff gathers energy (anticipation). mote = optional spec override (frost shards)
  function staffCharge(c, h, school, power, mote) {
    const K = c.kit[school], o = h.orb, k = h.k;
    let n = M.count((16 + 44 * k) * power * h.dt * c.density);
    while (n-- > 0) {
      M.sphere(_d); const r = M.rand(0.3, 0.55);
      c.ps.spawn(mote || K.mote, o.x + _d.x * r, o.y + _d.y * r * 0.7, o.z + _d.z * r, -_d.z * 1.6 - _d.x * 0.5, -_d.y * 0.3, _d.x * 1.6 - _d.z * 0.5, 1, 1, c.A.orb);
    }
    if (k > 0.25 && Math.random() < 0.5) c.ps.spawn(K.flash, o.x, o.y, o.z, 0, 0, 0, (0.18 + 0.32 * k) * power, 0.7, c.A.orb);
  }
  // the release flare at the orb: same motif for every spell (class identity)
  function staffRelease(c, o, dir, school, power) {
    const K = c.kit[school];
    one(c, K.flash, o, 0.95 * power); one(c, K.star, o, 0.9 * power); one(c, K.ring, o, 0.32 * power);
    burst(c, K.spark, o, 7 * power, 3, 7, dir ? { dir, spread: 0.65 } : { hemi: [0.2, 1] });
    c.lights.flash(o, PAL[school].flame, 2.2 * power, 0.16, 6);
  }
  // flat direction from the camera to p (spells come in from the far side of the screen: readable streaks)
  function awayFromCam(c, p, out) { out.set(p.x - c.camera.position.x, 0, p.z - c.camera.position.z); if (out.lengthSq() < 1e-4) out.set(0, 0, -1); return out.normalize(); }
  function dispose(c, list) { for (const i of list) c.ps.drop(i); }

  /* =====================================================================================================
   *  TELEGRAPH - ground target indicator: crisp edge at the gameplay radius, school sigil, danger fill and a
   *  progress disk that reaches the edge exactly when the spell lands. tg.finish() / tg.cancel().
   * ===================================================================================================== */
  function telegraph(c, id, point, radius, lead) {
    const S = SPELLS[id], school = S.teleSchool || S.school, P = PAL[school], st = S.teleStyle || {};
    const tg = { id, point: point.clone().setY(0), radius, lead: Math.max(0.12, lead), t: 0, state: 0, ft: 0, fadeDur: 0.35, flash: 0, extra: [], data: {}, alphaK: 1, fill: S.teleFill !== false };
    tg.decal = c.ground.add('sigil', { x: point.x, z: point.z, r: radius, map: c.tex.sigils[st.sigil || school], color: P.rune, color2: st.edge || P.runeHi, accent: st.accent || P.runeHi,
      fillA: st.fillA === undefined ? 0.1 : st.fillA, edgeW: M.clamp(0.1 / radius, 0.02, 0.085), alpha: 0, update: (D, dt) => tickTele(c, tg, D, dt) });
    tg.finish = (dur) => { if (tg.state === 0) { tg.state = 1; tg.ft = 0; tg.fadeDur = dur || 0.35; } };
    tg.cancel = () => { if (tg.state === 0) { tg.state = 2; tg.ft = 0; } };
    tg.move = (p) => { tg.point.set(p.x, 0, p.z); c.ground.move(tg.decal, p.x, p.z); for (const e of tg.extra) c.ground.move(e, p.x, p.z); };
    if (S.teleStart) S.teleStart(c, tg);
    return tg;
  }
  function tickTele(c, tg, D, dt) {
    tg.t += dt;
    const u = D.u, ap = M.easeOut(Math.min(1, tg.t / 0.2));
    const fill = tg.fill ? M.clamp01(tg.t / tg.lead) : 0;
    tg.fillK = fill;
    u.uFill.value = fill;
    u.uRot.value += dt * (0.22 + fill * 0.5);
    tg.flash = Math.max(0, tg.flash - dt * 5);
    u.uPulse.value = Math.pow(Math.max(0, Math.sin(tg.t * (5 + fill * 12))), 6) * (0.25 + 0.6 * fill) + tg.flash;
    c.ground.resize(D, tg.radius * (0.82 + 0.18 * ap));
    let al = ap;
    if (tg.state === 1) { tg.ft += dt; al *= Math.max(0, 1 - tg.ft / tg.fadeDur); u.uPulse.value += Math.max(0, 1 - tg.ft / 0.12) * 1.4; u.uFill.value = 0; }
    else if (tg.state === 2) { tg.ft += dt; al *= Math.max(0, 1 - tg.ft / 0.2); }
    else if (tg.t > tg.lead + 8) tg.cancel();                     // safety: a telegraph nobody answered
    tg.alpha = al * tg.alphaK;
    u.uAlpha.value = tg.alpha;
    if (tg.tick && tg.state !== 2) tg.tick(c, tg, dt);
    const done = (tg.state === 1 && tg.ft >= tg.fadeDur) || (tg.state === 2 && tg.ft >= 0.2);
    if (done) { for (const e of tg.extra) e.dead = true; return false; }
    return true;
  }
  MFX._telegraph = telegraph;

  /* =====================================================================================================
   *  PROJECTILES (fireball, ice spear): shared flight - homing, host collision test, ground, range.
   *  a: { from, dir, speed?, range?, step(p0, p1) -> { point, ... } | null, home() -> Vector3 | null, onHit(hit, dir) }
   * ===================================================================================================== */
  function projectile(c, a, st) {
    const sp = a.speed || c.T[st.key].speed;
    const P = { pos: a.from.clone(), prev: a.from.clone(), vel: a.dir.clone().normalize().multiplyScalar(sp), life: 0, maxLife: (a.range || 14) / sp + 0.08, a, data: {} };
    st.launch(c, P);
    c.projectiles.push(P);
    c.run((dt) => {
      P.life += dt; P.prev.copy(P.pos);
      if (a.home) {
        const tgt = a.home();
        if (tgt) { const s = P.vel.length(); _d.copy(tgt).sub(P.pos).normalize(); _e.copy(P.vel).divideScalar(s).lerp(_d, Math.min(1, (st.homing || 9) * dt)).normalize(); P.vel.copy(_e).multiplyScalar(s); }
      }
      P.pos.addScaledVector(P.vel, dt);
      let hit = a.step ? a.step(P.prev, P.pos) : null, point = hit ? hit.point : null;
      if (!hit && P.pos.y < 0.1) { point = P.pos.clone().setY(0.1); hit = { ground: true, point }; }
      else if (!hit && P.life > P.maxLife) { point = P.pos.clone(); hit = { air: true, point }; }
      if (point && !hit.ground && !hit.air) point = point.clone().addScaledVector(P.vel, -(st.backoff || 0.45) / P.vel.length());   // burst wraps the FRONT of the target
      st.fly(c, P, dt, point);
      if (point) {
        st.end(c, P);
        c.projectiles.splice(c.projectiles.indexOf(P), 1);
        st.impact(c, P, point, hit);
        if (!hit.ground && !hit.air && a.onHit) a.onHit(hit, P.vel.clone().normalize());
        c.event('impact', { spell: st.key, point });
        return false;
      }
      return true;
    });
    return P;
  }

  /* =====================================================================================================
   *  IMPACT KITS
   * ===================================================================================================== */
  function fireImpact(c, p, s) {
    const S = c.sp.fire, K = c.kit.fire;
    one(c, K.flash, p, 1.1 * s); one(c, K.bloom, p, 0.9 * s); one(c, K.star, p, 1.2 * s);
    burst(c, S.fcore, p, 3, 0.3, 1.0, { sMul: 1.2 * s });
    burst(c, S.flame, p, 14 * s, 2.4 * s, 4.6 * s, { hemi: [-0.25, 0.9], sMul: 1.4 * s });
    burst(c, K.spark, p, 10 * s, 3.5, 8, { hemi: [0.1, 0.95] });
    burst(c, K.ember, p, 6 * s, 1, 3, { hemi: [0.2, 1] });
    burst(c, S.smoke, p, 3 * s, 0.3, 0.9, { hemi: [0.3, 1], sMul: s });
    if (p.y < 2.4) {
      const g = _b.set(p.x, 0, p.z);
      ringDecal(c, g, 'fire', 1.5 * s, 0.28, { w: 0.13, innerA: 0.35 });
      scorch(c, g, 0.7 * s, { life: c.T.fireball.scorch, cool: 1.1, dark: 0.62 });
      glowDisk(c, g, 2.2 * s, PAL.fire.flame, 0.85, 0.3);
    }
    c.lights.flash(p, PAL.fire.flame, 4 * s, 0.22, 8);
    c.feel(0.05 * s, 0.14 * s);
  }
  function iceImpact(c, p, dir) {
    const S = c.sp.frost, K = c.kit.frost, s = c.T.ice.impact, g = V3().set(p.x, 0, p.z);
    one(c, K.flash, p, 1.0 * s); one(c, K.star, p, 1.15 * s); one(c, K.ring, p, 0.5 * s);
    let n = M.count(14 * s * c.density);
    while (n-- > 0) {                                             // crystalline fragments: a cone continuing the spear + radial spray
      M.sphere(_e); _d.copy(dir).multiplyScalar(0.7).addScaledVector(_e, 0.85).normalize(); _d.y = Math.abs(_d.y) * 0.8 + 0.25; _d.normalize();
      c.ice.spawn({ p, v: _d.multiplyScalar(M.rand(3, 7.5)), size: M.rand(0.18, 0.34) * s, life: M.rand(0.8, 1.2), spin: M.rand(6, 14) });
    }
    burst(c, S.shardBit, p, 10 * s, 3, 7, { hemi: [0.1, 0.9] });
    burst(c, K.glint, p, 6, 0.4, 1.6, { off: 0.3 });
    burst(c, S.mist, _a.set(p.x, 0.15, p.z), 4, 0.6, 1.4, { hemi: [0, 0.25] });
    burst(c, S.snow, p, 8, 0.5, 2, { hemi: [0, 1] });
    ringDecal(c, g, 'frost', 1.4 * s, 0.22, { w: 0.08, hot: 1, innerA: 0.25 });
    const life = c.T.ice.frost;
    c.ground.add('frost', { x: g.x, z: g.z, r: 1.05 * s, color: PAL.frost.hot, alpha: 0,
      update: (D) => { D.u.uAlpha.value = Math.min(1, D.t / 0.08) * Math.min(1, (life - D.t) / Math.min(1, life * 0.4)); return D.t < life; } });
    const N = 6;                                                  // ice splinters planted in the ground around the impact
    for (let k = 0; k < N; k++) {
      const ang = k * M.TAU / N + M.rnd(0.4), rr = M.rand(0.12, 0.5), tilt = M.rand(0.35, 0.95), size = M.rand(0.42, 0.66) * s;
      _u.set(Math.cos(ang), 0, Math.sin(ang)); _d.copy(_u).multiplyScalar(Math.sin(tilt)).addScaledVector(UP, Math.cos(tilt)).normalize();
      c.ice.spawn({ p: _a.copy(g).addScaledVector(_u, rr).addScaledVector(_d, size * 0.12), dir: _d.clone(), size, life: c.T.ice.splinter, planted: true, grow: 0.06 + k * 0.012, sink: 0.25 });
    }
    c.lights.flash(p, PAL.frost.flame, 2.6, 0.18, 7);
    c.feel(0.06, 0.12);
  }
  function meteorImpact(c, p, s, o) {
    const S = c.sp.fire, K = c.kit.fire, pc = V3().set(p.x, 0.35 * s, p.z), small = s < 0.85;
    one(c, K.flash, pc, 4 * s); one(c, K.bloom, pc, 2.8 * s); one(c, K.star, pc, 3 * s);
    burst(c, S.fcore, pc, 4, 0.5, 1.5, { sMul: 1.8 * s });
    burst(c, S.flame, pc, 20 * s, 4 * s, 8 * s, { hemi: [0.05, 0.85], sMul: 1.8 * s });
    burst(c, S.flame, pc, 6 * s, 3, 6, { dir: UP, spread: 0.3, sMul: 2.0 * s, lMul: 1.3 });
    burst(c, K.spark, pc, 26 * s, 6, 13, { hemi: [0.15, 0.95], sMul: 1.3 });
    burst(c, K.ember, pc, 14 * s, 1.5, 4, { hemi: [0.3, 1], lMul: 1.6 });
    let n = M.count(9 * s * c.density);
    while (n-- > 0) { M.hemi(_d, 0.35, 0.95); c.rockBits.spawn({ p: pc, v: _d.multiplyScalar(M.rand(4, 9) * Math.sqrt(s)), size: M.rand(0.07, 0.16) * s, life: M.rand(1.1, 1.6), spin: M.rand(5, 12) }); }
    n = M.count(12 * s * c.density);
    for (let k = 0; k < n; k++) { const a = k / n * M.TAU + M.rnd(0.2); c.ps.spawn(S.dust, p.x + Math.cos(a) * 0.9 * s, 0.2, p.z + Math.sin(a) * 0.9 * s, Math.cos(a) * 6 * s, 0.6, Math.sin(a) * 6 * s, 1.3 * s); }
    n = M.count(7 * s * c.density);
    while (n-- > 0) c.ps.spawn(S.smoke, pc.x + M.rnd(0.5 * s), pc.y + M.rand(0, 0.6), pc.z + M.rnd(0.5 * s), M.rnd(0.3), M.rand(1, 2), M.rnd(0.3), 1.9 * s, 1.5);
    ringDecal(c, p, 'fire', 3.5 * s, 0.34, { w: 0.12, hot: 1, innerA: 0.4 });
    ringDecal(c, p, 'fire', 4.2 * s, 0.6, { w: 0.4, hot: 0, innerA: 0.25, color: DUST.mid, color2: DUST.dark, add: 0, alpha: 0.7 });
    glowDisk(c, p, 4 * s, PAL.fire.flame, 1.0, 0.45);
    scorch(c, p, 2.1 * s, { life: c.T.meteor.scorch * (small ? 0.75 : 1), cool: 2.6, dark: 0.85 });
    if (c.T.meteor.burn > 0) afterburn(c, p, 1.6 * s, c.T.meteor.burn * (small ? 0.6 : 1), 12 * s);
    c.lights.flash(pc, PAL.fire.flame, 7 * s, 0.5, 12);
    const sh = c.T.meteor.shake;
    if (small) c.feel(0.17 * sh, 0.4); else c.feel(0.4 * Math.max(0.6, s) * sh, 1 * sh);
    if (o.tele) o.tele.finish(0.4);
    if (o.onImpact) o.onImpact({ point: p.clone(), radius: o.radius, size: s });
    c.event('impact', { spell: o.spell || 'meteor', point: p.clone() });
  }
  // a meteor falling from the sky onto `to`. o: { to, size, fall, radius, tele, onImpact, spell, after }
  function meteorFall(c, o) {
    const S = c.sp.fire, K = c.kit.fire, s = o.size;
    const to = V3().set(o.to.x, 0.35 * s, o.to.z), ground = V3().set(o.to.x, 0, o.to.z);
    awayFromCam(c, to, _d); _u.set(-_d.z, 0, _d.x);                // _u = screen right on the ground
    // only ~3 m of air above a target is on screen from the game camera: come in diagonally from the side so the
    // streak crosses the screen instead of dropping out of nowhere
    const side = o.side || (Math.random() < 0.5 ? -1 : 1);
    const from = to.clone().addScaledVector(_u, side * M.rand(6.5, 7.8)).addScaledVector(_d, M.rand(-0.5, 0.8)).add(_a.set(0, M.rand(6.6, 7.6), 0));
    const R = { pos: from.clone(), prev: from.clone(), vel: V3(), t: 0 };
    const rock = c.getRock(); rock.scale.setScalar(0.48 * s); rock.position.copy(from);
    const h = [c.ps.hold(K.glowHeld, from.x, from.y, from.z), c.ps.hold(K.cometHeld, from.x, from.y, from.z), c.ps.hold(S.fcore, from.x, from.y, from.z), c.ps.hold(K.coreHeld, from.x, from.y, from.z)];
    c.ps.tint(h[2], MFX.rgb(PAL.fire.hot), 1);
    const tr = c.trails.get({ life: 0.5, width: 0.8 * s, c0: PAL.fire.hot, c1: PAL.fire.deep, add: 0.5, noise: 0.8, taper: 1.1, core: 0.6 });
    const shadow = glowDisk(c, ground, 1.6 * s, 0x000000, 0, 9, { add: 0, pow: 1.3, update: (D) => { const u = M.clamp01(R.t / o.fall); D.u.uAlpha.value = 0.5 * Math.pow(u, 1.5); c.ground.resize(D, (0.6 + 1.1 * u) * s); return !D.data.done; } });
    const glow = glowDisk(c, ground, 2.3 * s, PAL.fire.flame, 0, 9, { update: (D) => { const u = M.clamp01(R.t / o.fall); D.u.uAlpha.value = 0.15 + 0.7 * u * u; return !D.data.done; } });
    c.run((dt) => {
      R.t += dt;
      const u = Math.min(1, R.t / o.fall), e = u * (0.45 + 0.55 * u);
      R.prev.copy(R.pos); R.pos.lerpVectors(from, to, e);
      R.vel.copy(R.pos).sub(R.prev).divideScalar(Math.max(dt, 1e-4));
      const p = R.pos, sp = R.vel.length() || 1;
      rock.position.copy(p); rock.rotation.x += dt * 4; rock.rotation.y += dt * 6;
      rock.material.uniforms.uDir.value.copy(R.vel).divideScalar(sp);
      const fl = 0.9 + Math.random() * 0.2;
      _w.copy(c.camera.position).sub(p).normalize().multiplyScalar(0.42 * s);   // fire layers sit in front of the opaque rock: it burns INSIDE them
      const fx = p.x + _w.x, fy = p.y + _w.y, fz = p.z + _w.z;
      c.ps.place(h[0], fx, fy, fz, 2.4 * s * fl, 0.5); c.ps.place(h[1], fx, fy, fz, 1.2 * s, 1); c.ps.aim(h[1], R.vel.x * 0.12, R.vel.y * 0.12, R.vel.z * 0.12);
      c.ps.place(h[2], fx, fy, fz, 1.15 * s * fl, 0.55, R.t * 3); c.ps.place(h[3], fx, fy, fz, 0.45 * s * fl, 0.85);
      let n = M.count(5 * c.density);
      while (n-- > 0) { const t = Math.random(); c.ps.spawn(S.tail, R.prev.x + (p.x - R.prev.x) * t + M.rnd(0.15 * s), R.prev.y + (p.y - R.prev.y) * t + M.rnd(0.15 * s), R.prev.z + (p.z - R.prev.z) * t + M.rnd(0.15 * s), M.rnd(0.8), M.rnd(0.8), M.rnd(0.8), 2.6 * s, 1.6); }
      n = M.count(1.6 * c.density);
      while (n-- > 0) c.ps.spawn(S.smoke, p.x + M.rnd(0.2), p.y + M.rnd(0.2), p.z + M.rnd(0.2), M.rnd(0.3), 0.3, M.rnd(0.3), 1.4 * s, 0.9);
      n = M.count(2 * c.density);
      while (n-- > 0) c.ps.spawn(S.fallSpark, p.x, p.y, p.z, R.vel.x * 0.25 + M.rnd(2), R.vel.y * 0.25 + M.rnd(2), R.vel.z * 0.25 + M.rnd(2));
      tr.push(p.x, p.y, p.z);
      c.lights.want(p, PAL.fire.flame, 2 + 4 * u, 10);
      if (u >= 1) {
        dispose(c, h); tr.stop(); c.putRock(rock); shadow.data.done = true; glow.data.done = true;
        meteorImpact(c, ground, s, o);
        if (o.after) o.after();
        return false;
      }
      return true;
    });
  }

  /* =====================================================================================================
   *  THE NINE SPELLS
   *  cast(c, h)              every frame of the anticipation; h: { t, k (0..1 to contact), left (s), dt, orb, pos, dir, data }
   *  castEnd(c, h, released) anticipation ends (released = the spell fired, else interrupted)
   *  release(c, a)           the spell fires; a = host arguments (see each spell)
   *  lead(c)                 seconds from release to impact (telegraph progress fill)
   * ===================================================================================================== */
  const SPELLS = MFX.SPELLS = {};

  /* ---- 0. ATEŞ TOPU - fast compact fireball: hot core, flickering shell, swirling embers, circular burst + scorch ---- */
  const FIREBALL = {
    key: 'fireball',
    launch(c, P) {
      const K = c.kit.fire, k = c.T.fireball.size, p = P.pos;
      staffRelease(c, p, _d.copy(P.vel).normalize(), 'fire', 0.75);
      P.h = [c.ps.hold(K.glowHeld, p.x, p.y, p.z), c.ps.hold(K.cometHeld, p.x, p.y, p.z), c.ps.hold(c.sp.fire.fcore, p.x, p.y, p.z), c.ps.hold(K.coreHeld, p.x, p.y, p.z)];
      c.ps.tint(P.h[2], MFX.rgb(PAL.fire.flame), 1.1); c.ps.tint(P.h[1], MFX.rgb(PAL.fire.flame), 1.15);
      P.trail = c.trails.get({ life: c.T.fireball.trail, width: 0.32 * k, c0: PAL.fire.flame, c1: PAL.fire.deep, add: 0.55, noise: 0.65, taper: 1.2, core: 0.8 });
      P.data.ph = Math.random() * 6;
    },
    fly(c, P, dt, stop) {
      const S = c.sp.fire, K = c.kit.fire, k = c.T.fireball.size, e = stop || P.pos, v = P.vel, sp = v.length();
      _d.copy(v).divideScalar(sp);
      const fl = 0.85 + Math.random() * 0.3;
      c.ps.place(P.h[0], e.x, e.y, e.z, 1.1 * k * fl, 0.55);
      c.ps.place(P.h[1], e.x, e.y, e.z, 0.46 * k, 0.9); c.ps.aim(P.h[1], v.x * 0.7, v.y * 0.7, v.z * 0.7);
      c.ps.place(P.h[2], e.x, e.y, e.z, 0.55 * k * fl, 1, P.life * 9);
      c.ps.place(P.h[3], e.x, e.y, e.z, 0.17 * k * fl, 1);
      let n = M.count(4 * c.density);
      while (n-- > 0) { const t = Math.random(); c.ps.spawn(S.tail, P.prev.x + (e.x - P.prev.x) * t, P.prev.y + (e.y - P.prev.y) * t, P.prev.z + (e.z - P.prev.z) * t, -_d.x * 1.2 + M.rnd(0.4), -_d.y * 1.2 + M.rnd(0.4) + 0.3, -_d.z * 1.2 + M.rnd(0.4), k); }
      P.data.ph += dt * 24;                                       // swirling embers: a helix around the flight path
      _u.crossVectors(_d, UP); if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0); _u.normalize(); _w.crossVectors(_u, _d);
      for (let j = 0; j < 2; j++) {
        if (Math.random() > c.density) continue;
        const an = P.data.ph + j * Math.PI, ox = (_u.x * Math.cos(an) + _w.x * Math.sin(an)) * 0.14 * k, oy = (_u.y * Math.cos(an) + _w.y * Math.sin(an)) * 0.14 * k, oz = (_u.z * Math.cos(an) + _w.z * Math.sin(an)) * 0.14 * k;
        c.ps.spawn(K.ember, e.x + ox, e.y + oy, e.z + oz, -_d.x * 2 + ox * 9, -_d.y * 2 + oy * 9 + 0.5, -_d.z * 2 + oz * 9, 1, 0.6);
      }
      if (Math.random() < 0.22 * c.density) c.ps.spawn(S.smoke, e.x, e.y, e.z, 0, 0.4, 0, 0.6, 0.7);
      P.trail.push(e.x, e.y, e.z);
      c.lights.want(e, PAL.fire.flame, 2.4, 6);
    },
    end(c, P) { dispose(c, P.h); P.trail.stop(); },
    impact(c, P, p) { fireImpact(c, p, c.T.fireball.impact); },
  };
  SPELLS.fireball = {
    school: 'fire', label: 'Ateş Topu',
    cast(c, h) {
      staffCharge(c, h, 'fire', 0.6);
      if (h.k > 0.5 && Math.random() < 0.55) c.ps.spawn(c.sp.fire.lick, h.orb.x + M.rnd(0.04), h.orb.y + 0.02, h.orb.z + M.rnd(0.04), 0, 0.5, 0, 0.42, 0.8, c.A.orb);
    },
    // a: { from, dir, speed?, range?, step, home, onHit }
    release(c, a) { return projectile(c, a, FIREBALL); },
  };

  /* ---- 1. METEOR - telegraph, a molten rock streaking in from the sky, heavy blast, debris, crater + afterburn ---- */
  SPELLS.meteor = {
    school: 'fire', label: 'Meteor',
    lead: (c) => c.T.meteor.fall,
    teleStart(c, tg) {
      tg.tick = (c, tg, dt) => {
        let n = M.count((4 + 10 * (tg.fillK || 0)) * tg.radius * dt * c.density);
        while (n-- > 0) { const r = Math.sqrt(Math.random()) * tg.radius, a = Math.random() * M.TAU; c.ps.spawn(c.kit.fire.ember, tg.point.x + Math.cos(a) * r, 0.05, tg.point.z + Math.sin(a) * r, 0, M.rand(0.6, 1.4), 0, 0.9, 0.8); }
      };
    },
    cast(c, h) {
      staffCharge(c, h, 'fire', 1.0);
      if (h.k > 0.35 && Math.random() < 0.7 * c.density) c.ps.spawn(c.sp.fire.upEmber, h.orb.x + M.rnd(0.06), h.orb.y, h.orb.z + M.rnd(0.06), M.rnd(0.5), M.rand(6, 9), M.rnd(0.5));
    },
    // a: { point, radius, telegraph, from (orb), onImpact }
    release(c, a) {
      if (a.from) { staffRelease(c, a.from, UP, 'fire', 1.0); burst(c, c.sp.fire.upEmber, a.from, 7, 16, 24, { dir: UP, spread: 0.12 }); }
      meteorFall(c, { to: a.point, size: c.T.meteor.size, fall: c.T.meteor.fall, radius: a.radius, tele: a.telegraph, onImpact: a.onImpact, spell: 'meteor' });
    },
  };

  /* ---- 2. ALEV HALKASI - sigil at the feet, staff slam pulse, a real flame wall racing out to the radius ---- */
  SPELLS.nova = {
    school: 'fire', label: 'Alev Halkası',
    cast(c, h) {
      staffCharge(c, h, 'fire', 0.8);
      const p = h.pos, d = h.data;
      if (!d.sig) { d.sig = feetSigil(c, p, 1.15, 'fire', { reveal: 0, fillA: 0.14 }); d.glow = glowDisk(c, p, 1.8, PAL.fire.flame, 0, 9, { update: (D) => { D.u.uAlpha.value = d.glowA || 0; return !D.data.done; } }); }
      d.sig.u.uReveal.value = M.easeOut(Math.min(1, h.t / 0.3)) * 1.1;
      d.sig.data.spin = 0.8 + 5 * h.k;
      d.glowA = 0.55 * h.k;
      let n = M.count(34 * h.dt * c.density);
      while (n-- > 0) { const a = Math.random() * M.TAU; c.ps.spawn(c.kit.fire.drift, p.x + Math.cos(a) * 1.1, 0.06, p.z + Math.sin(a) * 1.1, -Math.cos(a) * 1.4, M.rand(0.8, 1.6), -Math.sin(a) * 1.4); }
    },
    castEnd(c, h, released) { const d = h.data; if (d.sig) d.sig.data.out = released ? 'flare' : 'fade'; if (d.glow) d.glow.data.done = true; },
    // a: { center, radius, onSweep(r0, r1), onImpact }
    release(c, a) {
      const S = c.sp.fire, K = c.kit.fire, Tn = c.T.nova, R = a.radius, p = V3().set(a.center.x, 0, a.center.z);
      glowDisk(c, p, 2.4, PAL.fire.core, 1.1, 0.2);
      one(c, K.star, _a.set(p.x, 0.3, p.z), 1.9); one(c, K.flash, _a, 1.4);
      ringDecal(c, p, 'fire', R * 0.55, 0.14, { w: 0.07, hot: 1, color: PAL.fire.core });
      let n = M.count(10 * c.density);
      for (let k = 0; k < n; k++) { const an = k / n * M.TAU; c.ps.spawn(S.dust, p.x + Math.cos(an) * 0.5, 0.15, p.z + Math.sin(an) * 0.5, Math.cos(an) * 4, 0.4, Math.sin(an) * 4, 0.9); }
      const wall = c.flames.get(PAL.fire, MFX.mesh.cylinder(1, 1, 72, 3), { speed: 2.8, scale: 2.1, add: 0.3, base: 0.6, shape: 1.45, solid: 0.45 });
      wall.mesh.position.copy(p); wall.mesh.scale.set(0.4, 0.01, 0.4);
      const RD = R * 1.08;
      const front = c.ground.add('ring', { x: p.x, z: p.z, r: RD, color: PAL.fire.hot, color2: PAL.fire.flame, w: 0.05 / RD * 1.6, hot: 1, innerA: 0.4, pow: RD / 0.25, add: 0.7 });
      const charB = c.ground.add('ring', { x: p.x, z: p.z, r: RD, color: PAL.fire.char, color2: PAL.fire.char, w: 0.15 / RD, hot: 0, innerA: 0.4, pow: RD / 0.6, add: 0, alpha: 0.5 });
      const shimmer = c.ground.add('ring', { x: p.x, z: p.z, r: RD, color: 0xfff0d8, color2: 0xfff0d8, w: 0.12 / RD, hot: 0, innerA: 0, add: 1, alpha: 0.12 });
      let rPrev = 0;
      c.run((dt, t) => {
        const u = Math.min(1, t / Tn.expand), r = 0.4 + (R - 0.4) * M.easeOut2(u);
        const tb = Math.max(0, t - Tn.expand), kb = Tn.burn > 0 ? Math.max(0, 1 - tb / Tn.burn) : (tb > 0 ? 0 : 1);
        const hgt = Tn.height * (1 - 0.45 * u) * Math.min(1, t / 0.06);
        wall.mesh.scale.set(r, Math.max(0.01, hgt * (0.5 + 0.5 * kb)), r);
        const wu = wall.mesh.material.uniforms;
        wu.uAlpha.value = (u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2 * 0.4) * kb; wu.uErode.value = (1 - kb) * 1.2;
        front.u.uR.value = r / RD; front.u.uAlpha.value = kb;
        charB.u.uR.value = r / RD; charB.u.uAlpha.value = 0.5 * Math.max(0, 1 - tb / (Tn.burn + 0.9));
        shimmer.u.uR.value = Math.min(1, (r + 0.3) / RD); shimmer.u.uAlpha.value = 0.12 * (1 - u);
        let m = M.count((u < 1 ? 95 : 45 * kb) * dt * c.density);
        while (m-- > 0) { const an = Math.random() * M.TAU, cx = Math.cos(an), cz = Math.sin(an); c.ps.spawn(S.lick, p.x + cx * r, 0.04, p.z + cz * r, cx * (u < 1 ? 1.8 : 0.3), M.rand(1.8, 3), cz * (u < 1 ? 1.8 : 0.3), (1.15 - 0.35 * u) * (0.5 + 0.5 * kb)); }
        m = M.count((u < 1 ? 45 : 12 * kb) * dt * c.density);
        while (m-- > 0) { const an = Math.random() * M.TAU, cx = Math.cos(an), cz = Math.sin(an); c.ps.spawn(K.ember, p.x + cx * r, 0.2, p.z + cz * r, cx * M.rand(1, 3), M.rand(1, 3), cz * M.rand(1, 3), 1, 0.8); }
        if (u < 1 && Math.random() < 14 * dt * c.density) { const an = Math.random() * M.TAU; c.ps.spawn(S.smoke, p.x + Math.cos(an) * r * 0.9, 0.3, p.z + Math.sin(an) * r * 0.9, 0, 0.6, 0, 0.9, 0.9); }
        if (a.onSweep && rPrev < R) a.onSweep(rPrev, r);
        rPrev = r;
        if (t > Tn.expand + Tn.burn + 0.05) { c.flames.put(wall); front.dead = true; shimmer.dead = true; charB.update = (D, dt2) => { D.u.uAlpha.value = Math.max(0, D.u.uAlpha.value - dt2 * 0.5); return D.u.uAlpha.value > 0; }; return false; }
        return true;
      });
      c.lights.flash(_a.set(p.x, 1, p.z), PAL.fire.flame, 5, 0.45, 10);
      c.feel(0.2, 0.35);
      if (a.onImpact) a.onImpact({ point: p.clone(), radius: R });
      c.event('impact', { spell: 'nova', point: p.clone() });
    },
  };

  /* ---- 3. BUZ MIZRAĞI - frost sigil "barrel" in front of the staff, crystal lance, crisp shatter + ground splinters ---- */
  const ICE = {
    key: 'ice', homing: 7,
    launch(c, P) {
      const K = c.kit.frost, p = P.pos; _d.copy(P.vel).normalize();
      staffRelease(c, p, _d, 'frost', 0.8);
      burst(c, K.glint, p, 6, 2, 5, { dir: _d, spread: 0.45 });
      P.mesh = c.getSpear(); P.mesh.position.copy(p);
      P.h = [c.ps.hold(K.glowHeld, p.x, p.y, p.z), c.ps.hold(K.cometHeld, p.x, p.y, p.z)];
      P.trail = c.trails.get({ life: 0.14, width: 0.12, c0: PAL.frost.core, c1: PAL.frost.flame, add: 0.8, noise: 0, taper: 1, core: 1 });
      P.trail2 = c.trails.get({ life: 0.1, width: 0.36, c0: PAL.frost.hot, c1: PAL.frost.deep, add: 0.85, alpha: 0.3, noise: 0.2, taper: 1, core: 0 });
      P.spin = 0;
    },
    fly(c, P, dt, stop) {
      const S = c.sp.frost, K = c.kit.frost, e = stop || P.pos;
      _d.copy(P.vel).normalize();
      P.spin += dt * 5;
      P.mesh.position.copy(e).addScaledVector(_d, -0.78);
      P.mesh.quaternion.setFromUnitVectors(ZF, _d); P.mesh.rotateZ(P.spin);
      c.ps.place(P.h[0], P.mesh.position.x, P.mesh.position.y, P.mesh.position.z, 0.9, 0.35);
      c.ps.place(P.h[1], e.x, e.y, e.z, 0.32, 0.8); c.ps.aim(P.h[1], P.vel.x, P.vel.y, P.vel.z);
      const tail = _a.copy(e).addScaledVector(_d, -1.25);
      P.trail.push(tail.x, tail.y, tail.z); P.trail2.push(tail.x, tail.y, tail.z);
      let n = M.count(2 * c.density);
      while (n-- > 0) { const t = Math.random() * 1.2; c.ps.spawn(S.bit, e.x - _d.x * t + M.rnd(0.05), e.y - _d.y * t + M.rnd(0.05), e.z - _d.z * t + M.rnd(0.05), M.rnd(0.5) - _d.x * 0.6, M.rnd(0.5), M.rnd(0.5) - _d.z * 0.6); }
      if (Math.random() < 0.5 * c.density) { const t = Math.random(); c.ps.spawn(K.glint, P.prev.x + (e.x - P.prev.x) * t, P.prev.y + (e.y - P.prev.y) * t, P.prev.z + (e.z - P.prev.z) * t, 0, 0, 0, 0.8); }
      if (Math.random() < 0.6 * c.density) c.ps.spawn(S.snow, tail.x, tail.y, tail.z, M.rnd(0.4), M.rnd(0.3), M.rnd(0.4));
      c.lights.want(e, PAL.frost.flame, 1.8, 6);
    },
    end(c, P) { c.putSpear(P.mesh); dispose(c, P.h); P.trail.stop(); P.trail2.stop(); },
    impact(c, P, p) { iceImpact(c, p, P.vel.clone().normalize()); },
  };
  SPELLS.ice = {
    school: 'frost', label: 'Buz Mızrağı',
    cast(c, h) {
      staffCharge(c, h, 'frost', 0.85, c.sp.frost.shardMote);
      if (Math.random() < 0.2 * c.density) c.ps.spawn(c.sp.frost.mist, h.orb.x, h.orb.y - 0.05, h.orb.z, M.rnd(0.1), -0.25, M.rnd(0.1), 0.45, 0.8);
      const d = h.data;
      if (h.k > 0.42 && !d.sig) {                                 // the frost sigil the spear is shot through
        d.sig = c.ground.add('sigil', { vertical: true, x: 0, z: 0, y: 0, r: 0.01, map: c.tex.sigils.frost, color: PAL.frost.rune, color2: PAL.frost.runeHi, accent: PAL.frost.core, edgeW: 0.08, fillA: 0.06, alpha: 0,
          update: (D, dt) => { D.u.uRot.value -= dt * 3; if (D.data.out) { D.data.ot = (D.data.ot || 0) + dt; D.u.uAlpha.value = Math.max(0, 1 - D.data.ot / 0.12); return D.data.ot < 0.12; } return true; } });
        d.sigT = 0;
      }
      if (d.sig) {
        d.sigT += h.dt;
        const g = M.easeOutBack(Math.min(1, d.sigT / 0.2), 2);
        d.sig.mesh.position.copy(h.orb).addScaledVector(h.aim, 0.42);
        d.sig.mesh.quaternion.setFromUnitVectors(ZF, h.aim);
        c.ground.resize(d.sig, 0.3 * g); d.sig.u.uAlpha.value = Math.min(1, d.sigT / 0.1);
      }
    },
    castEnd(c, h, released) {
      const d = h.data;
      if (!d.sig) return;
      d.sig.data.out = true;
      if (released) {                                             // the sigil shatters into shards in its own plane
        const o = d.sig.mesh.position, q = d.sig.mesh.quaternion;
        for (let k = 0; k < 9; k++) { const an = k / 9 * M.TAU; _d.set(Math.cos(an), Math.sin(an), 0).applyQuaternion(q); c.ps.spawn(c.sp.frost.shardBit, o.x + _d.x * 0.25, o.y + _d.y * 0.25, o.z + _d.z * 0.25, _d.x * 3 + h.aim.x * 2, _d.y * 3 + 1, _d.z * 3 + h.aim.z * 2, 0.8, 0.7); }
      }
    },
    // a: { from, dir, speed?, range?, step, home, onHit }
    release(c, a) { return projectile(c, a, ICE); },
  };

  /* ---- 4. YILDIRIM - storm telegraph with crawling static, pre-flash leader, branching bolt, ground arcs ---- */
  SPELLS.bolt = {
    school: 'storm', label: 'Yıldırım',
    lead: (c) => c.T.bolt.preflash,
    teleStart(c, tg) {
      tg.tick = (c, tg, dt) => {
        let n = M.count((10 + 30 * (tg.fillK || 0)) * dt * c.density);
        while (n-- > 0) { const a = Math.random() * M.TAU, r = tg.radius * (Math.random() < 0.7 ? 1 : Math.random()); c.ps.spawn(c.sp.storm.zap, tg.point.x + Math.cos(a) * r, 0.08, tg.point.z + Math.sin(a) * r, 0, 0, 0, 0.7); }
      };
    },
    cast(c, h) {
      staffCharge(c, h, 'storm', 0.9);
      let n = M.count((h.k > 0.25 ? 26 : 6) * h.dt * c.density);
      while (n-- > 0) { M.sphere(_d); const r = M.rand(0.1, 0.28); c.ps.spawn(c.sp.storm.zap, h.orb.x + _d.x * r, h.orb.y + _d.y * r, h.orb.z + _d.z * r, 0, 0, 0, 0.55, 1, c.A.orb); }
    },
    // a: { point, radius, telegraph, from, onImpact }
    release(c, a) {
      const Tb = c.T.bolt, p = V3().set(a.point.x, 0, a.point.z), tg = a.telegraph;
      if (a.from) { staffRelease(c, a.from, UP, 'storm', 0.8); burst(c, c.kit.storm.spark, a.from, 3, 12, 18, { dir: UP, spread: 0.1 }); }
      if (tg) tg.flash = 1.4;
      awayFromCam(c, p, _d); _u.set(-_d.z, 0, _d.x);
      const top = p.clone().addScaledVector(_d, 3).addScaledVector(_u, M.rnd(1.4)).setY(14);
      const pathOf = () => MFX.mesh.jagged(top, _a.set(p.x, 0.02, p.z), 5, 0.2, 0.25);
      const B = c.getBolt(), G = c.getBolt();
      B.uni.uCore.value.setHex(PAL.storm.core); B.uni.uGlow.value.setHex(PAL.storm.flame); G.uni.uCore.value.setHex(PAL.storm.core); G.uni.uGlow.value.setHex(PAL.storm.flame);
      B.uni.uAlpha.value = 0.5; B.build([{ pts: pathOf(), w: 0.022, i: 0.6 }], c.camera.position, 5);   // the leader
      glowDisk(c, p, 1.9, PAL.storm.hot, 0.5, Tb.preflash + 0.12);
      const shape = () => {
        const main = pathOf(), paths = [{ pts: main, w: 0.06, i: 1 }];
        for (let b = 0; b < 3; b++) { const s = main[4 + ((Math.random() * (main.length - 12)) | 0)], e = s.clone().add(_e.set(M.rnd(2.4), -M.rand(1.5, 3.2), M.rnd(2.4))); if (e.y < 0.05) e.y = 0.05; paths.push({ pts: MFX.mesh.jagged(s, e, 3, 0.3, 0.3), w: 0.034, i: 0.75 }); }
        B.build(paths, c.camera.position, 6);
      };
      const arcs = () => {
        const paths = [];
        for (let k = 0; k < 7; k++) {
          const an = k / 7 * M.TAU + M.rnd(0.35), L = M.rand(1.1, 1.9), e = _e.set(p.x + Math.cos(an) * L, 0.05, p.z + Math.sin(an) * L);
          const pts = MFX.mesh.jagged(_a.set(p.x, 0.06, p.z), e, 3, 0.3, 0.15); for (const q of pts) q.y = Math.max(0.03, Math.min(0.35, q.y));
          paths.push({ pts, w: 0.026, i: 0.9 });
        }
        G.build(paths, c.camera.position, 5);
      };
      c.after(Tb.preflash, () => {                                // ---- STRIKE ----
        const K = c.kit.storm, S = c.sp.storm, pc = _b.set(p.x, 0.5, p.z);
        shape(); arcs(); B.uni.uAlpha.value = 1; G.uni.uAlpha.value = 1;
        one(c, K.flash, pc, 2.6); one(c, K.star, pc, 2.4); one(c, K.bloom, pc, 1.6);
        burst(c, K.spark, pc, 22, 5, 11, { hemi: [0.1, 0.95] });
        burst(c, S.ozone, pc, 3, 0.3, 0.8, { hemi: [0.2, 1] });
        ringDecal(c, p, 'storm', 2.1, 0.22, { w: 0.08, hot: 1, innerA: 0.2 });
        scorch(c, p, 0.95, { color: PAL.storm.core, color2: PAL.storm.flame, dark: 0.72, cool: 1.1, life: 2.6 });
        c.lights.flash(pc, PAL.storm.hot, 6, 0.25, 9);
        c.feel(0.25, 0.5);
        if (a.onImpact) a.onImpact({ point: p.clone(), radius: a.radius });
        c.event('impact', { spell: 'bolt', point: p.clone() });
        if (tg) tg.finish(0.35);
        const f = Tb.flicker;
        let stage = 0;
        c.run((dt, t) => {                                        // flicker: on, off, re-strike (new shape), off, dim re-strike, fade
          const u = t / f;
          if (stage === 0 && u > 0.18) { stage = 1; B.mesh.visible = false; G.mesh.visible = false; }
          if (stage === 1 && u > 0.3) { stage = 2; shape(); arcs(); B.uni.uAlpha.value = 0.9; one(c, K.flash, pc, 1.6); }
          if (stage === 2 && u > 0.55) { stage = 3; B.mesh.visible = false; G.mesh.visible = false; }
          if (stage === 3 && u > 0.65) { stage = 4; shape(); B.uni.uAlpha.value = 0.6; G.mesh.visible = false; }
          if (stage === 4) B.uni.uAlpha.value = 0.6 * Math.max(0, 1 - (u - 0.65) / 0.35);
          if (u >= 1) { c.putBolt(B); c.putBolt(G); return false; }
          return true;
        });
        if (Tb.residue > 0) c.run((dt, t) => {                    // crackling residue
          if (t > Tb.residue) return false;
          const k = 1 - t / Tb.residue;
          let n = M.count(30 * k * dt * c.density);
          while (n-- > 0) { const an = Math.random() * M.TAU, r = Math.sqrt(Math.random()) * 1.1; c.ps.spawn(S.zap, p.x + Math.cos(an) * r, M.rand(0.04, 0.3), p.z + Math.sin(an) * r, 0, 0, 0, 0.5 + 0.4 * k); }
          return true;
        });
      });
    },
  };

  /* ---- 5. ATEŞ SÜTUNU - glowing cracks in the telegraph, ground swell, eruption, layered column, collapse ---- */
  SPELLS.pillar = {
    school: 'fire', label: 'Ateş Sütunu',
    lead: (c) => c.T.pillar.delay,
    teleStart(c, tg) {
      const D = c.ground.add('scorch', { x: tg.point.x, z: tg.point.z, r: tg.radius * 1.05, color: PAL.fire.hot, color2: PAL.fire.deep, dark: 0.32, heat: 0,
        update: (D, dt) => { D.data.flare = Math.max(0, (D.data.flare || 0) - dt * 3); const f = tg.fillK || 0; D.u.uHeat.value = Math.min(1, 0.15 + 0.85 * f * f + D.data.flare); D.u.uAlpha.value = tg.alpha === undefined ? 0 : tg.alpha; return true; } });
      tg.extra.push(D); tg.data.cracks = D;
      tg.tick = (c, tg, dt) => {
        let n = M.count((6 + 30 * (tg.fillK || 0)) * dt * c.density);
        while (n-- > 0) { const r = Math.sqrt(Math.random()) * tg.radius, a = Math.random() * M.TAU; c.ps.spawn(c.kit.fire.ember, tg.point.x + Math.cos(a) * r, 0.05, tg.point.z + Math.sin(a) * r, 0, M.rand(0.8, 2), 0, 0.9, 0.7); }
      };
    },
    cast(c, h) { staffCharge(c, h, 'fire', 0.9); },
    // a: { point, radius, telegraph, from, onTick, onImpact }
    release(c, a) {
      const Tp = c.T.pillar, R = a.radius, p = V3().set(a.point.x, 0, a.point.z), tg = a.telegraph, S = c.sp.fire, K = c.kit.fire;
      if (a.from) staffRelease(c, a.from, null, 'fire', 0.8);
      if (tg && tg.data.cracks) tg.data.cracks.data.flare = 1;
      let n = M.count(8 * c.density);
      for (let k = 0; k < n; k++) { const an = k / n * M.TAU; c.ps.spawn(S.dust, p.x + Math.cos(an) * R * 0.8, 0.15, p.z + Math.sin(an) * R * 0.8, Math.cos(an) * 2.5, 0.5, Math.sin(an) * 2.5, 0.8); }
      for (let k = 0; k < 3; k++) { M.hemi(_d, 0.7, 1); c.rockBits.spawn({ p: _a.set(p.x + M.rnd(0.5), 0.1, p.z + M.rnd(0.5)), v: _d.multiplyScalar(M.rand(2, 3.5)), size: M.rand(0.07, 0.12), life: 0.8, spin: 8 }); }
      c.feel(0.08, 0.1);
      c.after(Tp.delay, () => {                                   // ---- ERUPTION ----
        const pc = _b.set(p.x, 0.4, p.z);
        one(c, K.flash, pc, 2.2); burst(c, S.fcore, pc, 3, 0.5, 1.5, { sMul: 1.4 });
        burst(c, S.flame, pc, 10, 6, 10, { dir: UP, spread: 0.35, sMul: 1.3 });
        burst(c, K.spark, pc, 16, 6, 12, { dir: UP, spread: 0.6 });
        ringDecal(c, p, 'fire', R * 1.6, 0.26, { w: 0.1, hot: 1, innerA: 0.3 });
        const base = glowDisk(c, p, R * 1.5, PAL.fire.flame, 0, 99, { update: (D) => { D.u.uAlpha.value = D.data.a || 0; return !D.data.done; } });
        const outer = c.flames.get(PAL.fire, MFX.mesh.cylinder(0.55, 1.0, 40, 10), { speed: 3.2, scale: 1.7, add: 0.3, base: 0.35, shape: 1.4, solid: 0.12 });
        const core = c.flames.get({ core: PAL.fire.core, hot: PAL.fire.hot, flame: PAL.fire.flame }, MFX.mesh.cylinder(0.16, 0.36, 24, 10), { speed: 4.2, scale: 2.4, add: 0.5, base: 0.4, shape: 1.5, solid: 0.3, order: 29 });
        outer.mesh.position.copy(p); core.mesh.position.copy(p);
        let tick = 0;
        c.lights.flash(pc, PAL.fire.flame, 5, 0.3, 10);
        c.feel(0.15, 0.3);
        if (a.onImpact) a.onImpact({ point: p.clone(), radius: R });
        c.event('impact', { spell: 'pillar', point: p.clone() });
        c.run((dt, t) => {
          const D = Tp.duration, H = Tp.height, tc = t - D, k = tc > 0 ? Math.max(0, 1 - tc / 0.32) : 1;
          const rise = M.easeOutBack(Math.min(1, t / 0.16), 1.4), wob = 1 + 0.04 * Math.sin(t * 13);
          outer.mesh.scale.set(R * 0.78 * wob * (0.85 + 0.15 * k), Math.max(0.01, H * rise * (1 - 0.25 * (1 - k))), R * 0.78 * wob * (0.85 + 0.15 * k));
          core.mesh.scale.set(R * 0.75 * k + 0.05, Math.max(0.01, H * 0.92 * rise * k), R * 0.75 * k + 0.05);
          outer.mesh.material.uniforms.uErode.value = tc > 0 ? (1 - k) * 1.5 : 0.06 * Math.sin(t * 7);
          core.mesh.material.uniforms.uErode.value = tc > 0 ? (1 - k) * 1.8 : 0;
          base.data.a = 0.45 * k * (0.85 + 0.15 * Math.sin(t * 17)); outer.mesh.material.uniforms.uAlpha.value = 0.85; core.mesh.material.uniforms.uAlpha.value = 0.55;
          if (k > 0) {
            let m = M.count(55 * dt * c.density * k);
            while (m-- > 0) { const an = Math.random() * M.TAU, rr = R * M.rand(0.55, 0.8); c.ps.spawn(S.lick, p.x + Math.cos(an) * rr, M.rand(0, 0.6), p.z + Math.sin(an) * rr, Math.cos(an) * 0.5, M.rand(5, 8), Math.sin(an) * 0.5, 1.15); }
            m = M.count(40 * dt * c.density * k);
            while (m-- > 0) { const an = Math.random() * M.TAU, rr = M.rand(0.3, 0.8); c.ps.spawn(K.ember, p.x + Math.cos(an) * rr, M.rand(0.2, 2), p.z + Math.sin(an) * rr, -Math.sin(an) * 1.6, M.rand(4, 7), Math.cos(an) * 1.6, 1, 0.8); }
            if (Math.random() < 7 * dt * c.density * k) c.ps.spawn(S.smoke, p.x + M.rnd(0.3), H * M.rand(0.75, 1), p.z + M.rnd(0.3), M.rnd(0.3), 1.2, M.rnd(0.3), 1.3, 0.8);
            if (Math.random() < 5 * dt) c.ps.spawn(S.heat, p.x, H * 0.9, p.z, 0, 1, 0, 2);
            c.lights.want(_a.set(p.x, 1.6, p.z), PAL.fire.flame, 3 * k * (0.85 + Math.random() * 0.3), 10);
          }
          tick -= dt;
          if (tick <= 0 && t < D) { tick += Tp.tick; if (a.onTick) a.onTick({ point: p.clone(), radius: R }); }
          if (tc >= 0.32) {
            c.flames.put(outer); c.flames.put(core); base.data.done = true;
            scorch(c, p, R * 0.9, { life: 4, cool: 2.2, dark: 0.8 });
            c.run((dt2, t2) => { if (t2 > 1.4) return false; if (Math.random() < 10 * dt2 * c.density * (1 - t2 / 1.4)) c.ps.spawn(S.smoke, p.x + M.rnd(0.4), 0.3, p.z + M.rnd(0.4), 0, 0.9, 0, 0.9, 1); return true; });
            if (tg) tg.finish(0.4);
            return false;
          }
          return true;
        });
      });
    },
  };

  /* ---- 6. IŞINLANMA - departure + destination sigils, body dissolves into motes, streak, implosive arrival ---- */
  SPELLS.blink = {
    school: 'arcane', label: 'Işınlanma', teleFill: false, teleStyle: { fillA: 0.05 },
    teleStart(c, tg) {
      tg.alphaK = 0.8;
      tg.tick = (c, tg, dt) => { if (Math.random() < 20 * dt * c.density) { const an = Math.random() * M.TAU; c.ps.spawn(c.kit.arcane.drift, tg.point.x + Math.cos(an) * tg.radius, 0.06, tg.point.z + Math.sin(an) * tg.radius, 0, M.rand(1, 2), 0); } };
    },
    cast(c, h) {
      staffCharge(c, h, 'arcane', 0.7);
      const p = h.pos, d = h.data;
      if (!d.sig) d.sig = feetSigil(c, p, 0.85, 'arcane', { reveal: 0, spin: 2 });
      d.sig.u.uReveal.value = M.easeOut(Math.min(1, h.t / 0.16)) * 1.1;
      let n = M.count(70 * h.dt * c.density);
      while (n-- > 0) { const an = h.t * 12 + Math.random() * M.TAU, y = M.rand(0.05, 1.9); c.ps.spawn(c.kit.arcane.drift, p.x + Math.cos(an) * 0.42, y, p.z + Math.sin(an) * 0.42, -Math.sin(an) * 2, 1.2, Math.cos(an) * 2, 0.9, 0.7); }
    },
    castEnd(c, h, released) { if (h.data.sig) h.data.sig.data.out = released ? 'flare' : 'fade'; },
    // a: { from, to, telegraph }   (the host has already moved the hero to `to`)
    release(c, a) {
      const K = c.kit.arcane, S = c.sp.arcane, from = V3().set(a.from.x, 0, a.from.z), to = V3().set(a.to.x, 0, a.to.z);
      const dir = V3().subVectors(to, from), dist = dir.length(); if (dist > 1e-3) dir.divideScalar(dist); else dir.set(0, 0, 1);
      let n = M.count(40 * c.density);
      while (n-- > 0) { const an = Math.random() * M.TAU, r = 0.32 * Math.sqrt(Math.random()), y = M.rand(0.1, 1.85), s = M.rand(2, 5); c.ps.spawn(S.dissolve, from.x + Math.cos(an) * r, y, from.z + Math.sin(an) * r, dir.x * s + M.rnd(0.6), M.rand(0.5, 2), dir.z * s + M.rnd(0.6)); }
      burst(c, K.rune, _a.set(from.x, 0.8, from.z), 4, 0.5, 1.2, { hemi: [0.5, 1], off: 0.3 });
      c.ps.spawn(K.shaft, from.x, 2.5, from.z, 0, 0.01, 0, 1);
      ringDecal(c, from, 'arcane', 1.6, 0.3, { w: 0.1, hot: 1 });
      const tr = c.trails.get({ life: c.T.blink.streak, width: 0.5, c0: PAL.arcane.core, c1: PAL.arcane.flame, add: 0.9, noise: 0.3, core: 1.2, taper: 0.6 });
      tr.line(_a.set(from.x, 1.0, from.z), _b.set(to.x, 1.0, to.z), c.T.blink.streak * 0.55, Math.max(4, Math.round(dist / 0.35))); tr.stop();
      n = M.count(dist * 3 * c.density);
      while (n-- > 0) { const t = Math.random(); c.ps.spawn(S.streak, from.x + (to.x - from.x) * t, M.rand(0.5, 1.5), from.z + (to.z - from.z) * t, dir.x * 9, 0, dir.z * 9); }
      const chest = _b.set(to.x, 1.1, to.z);
      awayFromCam(c, to, _w); c.ps.spawn(K.shaft, to.x - _w.x * 0.55, 2.5, to.z - _w.z * 0.55, 0, 0.01, 0, 1.15);   // in front of the hero, not inside the body one(c, K.star, chest, 1.4); one(c, K.flash, chest, 1.2);
      n = M.count(26 * c.density);
      while (n-- > 0) { M.sphere(_d); const r = M.rand(0.9, 1.4); c.ps.spawn(S.implode, chest.x + _d.x * r, Math.max(0.1, chest.y + _d.y * r), chest.z + _d.z * r, -_d.x * M.rand(3.5, 5), -_d.y * M.rand(3.5, 5), -_d.z * M.rand(3.5, 5)); }
      if (a.telegraph) { a.telegraph.move(to); a.telegraph.flash = 1.5; a.telegraph.finish(0.65); }
      ringDecal(c, to, 'arcane', 1.9, 0.36, { w: 0.09, hot: 1 });
      burst(c, c.sp.fire.dust, _a.set(to.x, 0.1, to.z), 5, 1, 2.2, { hemi: [0, 0.3], sMul: 0.7 });
      c.lights.flash(chest, PAL.arcane.flame, 3, 0.22, 7);
      c.feel(0.03, 0.18);
      c.event('impact', { spell: 'blink', point: to.clone() });
    },
  };

  /* ---- 7. MANA KALKANI - drawn-in ward sigil, dome forms bottom->top, orbiting glyphs, hit ripples, weakening ---- */
  SPELLS.mshield = {
    school: 'ward', label: 'Mana Kalkanı',
    cast(c, h) {
      staffCharge(c, h, 'ward', 0.8);
      const p = h.pos, d = h.data;
      if (!d.sig) d.sig = feetSigil(c, p, 1.0, 'ward', { reveal: 0, spin: 1.2, fillA: 0.1 });
      d.sig.u.uReveal.value = Math.min(1.1, h.k * 1.15);
      if (Math.random() < 16 * h.dt * c.density) { const an = Math.random() * M.TAU; c.ps.spawn(c.kit.ward.rune, p.x + Math.cos(an), 0.08, p.z + Math.sin(an), 0, 1.2, 0, 0.9); }
    },
    castEnd(c, h, released) { if (h.data.sig) h.data.sig.data.out = released ? 'flare' : 'fade'; },
    // a: { follow: Object3D, state() -> { active, frac } }
    release(c, a) { c.shield.start(a); },
  };
  // the single active shield (needs a hit API, so it lives on the director as c.shield)
  MFX._shieldController = function (c) {
    const K = () => c.kit.ward, P = PAL.ward, mesh = c.shieldMesh, U = mesh.material.uniforms;
    let S = null;
    const center = V3();
    const api = {
      get active() { return !!S; },
      start(a) {
        if (S) api.stop(true);
        S = { a, t: 0, I: 1, hits: 0, end: null, et: 0, g: [], gl: [], sig: null };
        mesh.visible = true; U.uForm.value = 0; U.uDissolve.value = 1.2; U.uAlpha.value = 1; U.uIntegrity.value = 1; U.uFlash.value = 0;
        for (const H of U.uHits.value) H.w = -1;
        const p = a.follow.position;
        for (let i = 0; i < 3; i++) { S.g.push(c.ps.hold(K().runeHeld, p.x, p.y, p.z, 0.2)); S.gl.push(c.ps.hold(K().glowHeld, p.x, p.y, p.z, 0.4)); c.ps.tint(S.gl[i], MFX.rgb(P.flame), 1); }
        S.sig = feetSigil(c, p, 0.9, 'ward', { alpha: 0.42, spin: 0.35, fillA: 0.05 });
        center.set(p.x, 0.88, p.z);
        one(c, K().star, center, 1.3);
        ringDecal(c, p, 'ward', 1.7, 0.3, { w: 0.08, hot: 1 });
        burst(c, K().drift, center, 14, 1.5, 3, { off: 0.6 });
        c.lights.flash(center, P.flame, 2.5, 0.25, 6);
        c.event('impact', { spell: 'mshield', point: center.clone() });
      },
      hit(dirX, dirZ) {
        if (!S || S.end) return;
        if (dirX === undefined || (Math.abs(dirX) + Math.abs(dirZ)) < 1e-4) { const an = Math.random() * M.TAU; dirX = Math.cos(an); dirZ = Math.sin(an); }
        _d.set(dirX, 0.25, dirZ).normalize();
        const H = U.uHits.value[S.hits++ % 4]; H.set(_d.x, _d.y, _d.z, 0);
        U.uFlash.value = 1;
        const hp = _a.set(center.x + _d.x * 0.95, center.y + _d.y * 1.18, center.z + _d.z * 0.95);
        burst(c, c.sp.ward.shard, hp, 7, 2, 4.5, { dir: _d, spread: 0.7 });
        one(c, K().star, hp, 0.65);
        c.lights.flash(hp, P.flame, 1.6, 0.15, 5);
      },
      stop(instant) {
        if (!S) return;
        dispose(c, S.g); dispose(c, S.gl);
        if (S.sig) S.sig.data.out = 'fade';
        S = null;
        if (instant) mesh.visible = false;
      },
      update(dt, time) {
        U.uTime.value = time;
        if (!S) { mesh.visible = false; return; }
        S.t += dt;
        const p = S.a.follow.position; center.set(p.x, 0.88, p.z);
        mesh.position.copy(center);
        const st = S.a.state ? S.a.state() : { active: S.t < 12, frac: 1 };
        S.I += ((st.frac === undefined ? 1 : st.frac) - S.I) * Math.min(1, dt * 8);
        const f = Math.min(1, S.t / c.T.mshield.form), sc = 0.85 + 0.15 * M.easeOutBack(f, 2.2);
        U.uForm.value = M.easeOut(f); U.uIntegrity.value = S.I;
        U.uFlash.value = Math.max(0, U.uFlash.value - dt * 4);
        U.uPulse.value = Math.exp(-((S.t % 1.6) * 5));
        for (const H of U.uHits.value) if (H.w >= 0) { H.w += dt; if (H.w > 0.7) H.w = -1; }
        let alpha = (0.75 + 0.25 * S.I) * (S.I < 0.35 ? 0.72 + 0.28 * Math.abs(Math.sin(S.t * 23)) : 1);
        if (S.sig) c.ground.move(S.sig, p.x, p.z);
        if (!S.end && !st.active) { S.end = st.frac !== undefined && st.frac <= 0.001 ? 'break' : 'expire'; S.et = 0; if (S.end === 'break') api.shatter(); }
        if (S.end) {
          S.et += dt;
          if (S.end === 'break') { const u = S.et / 0.14; mesh.scale.set(0.95 * (1 + 0.12 * u), 1.18 * (1 + 0.12 * u), 0.95 * (1 + 0.12 * u)); alpha *= Math.max(0, 1 - u); if (u >= 1) { api.stop(true); return; } }
          else { U.uDissolve.value = 1.2 - 1.3 * Math.min(1, S.et / 0.5); if (S.et >= 0.5) { api.stop(true); return; } }
        } else mesh.scale.set(0.95 * sc, 1.18 * sc, 0.95 * sc);
        U.uAlpha.value = alpha;
        const nG = S.end ? 0 : S.I > 0.66 ? 3 : S.I > 0.33 ? 2 : 1;
        for (let i = 0; i < 3; i++) {                              // orbiting glyphs on a tilted ring
          const an = S.t * 1.7 + i * M.TAU / 3, x = center.x + Math.cos(an) * 0.98, z = center.z + Math.sin(an) * 0.98, y = center.y + 0.05 + Math.sin(an + 0.9) * 0.3;
          const on = i < nG ? Math.min(1, f * 2) : 0;
          c.ps.place(S.g[i], x, y, z, 0.2, 0.95 * on * alpha); c.ps.place(S.gl[i], x, y, z, 0.42, 0.35 * on * alpha);
        }
        if (!S.end && Math.random() < 6 * dt * c.density) { M.hemi(_d, 0, 1); c.ps.spawn(K().drift, center.x + _d.x * 0.95, center.y + _d.y * 1.15, center.z + _d.z * 0.95, 0, 0.5, 0, 0.8, 1.4); }
      },
      shatter() {
        let n = M.count(30 * c.density);
        while (n-- > 0) { M.hemi(_d, -0.2, 1); c.ps.spawn(c.sp.ward.shard, center.x + _d.x * 0.95, center.y + _d.y * 1.15, center.z + _d.z * 0.95, _d.x * M.rand(2, 4.5), _d.y * M.rand(1, 3) + 1, _d.z * M.rand(2, 4.5), 1.2); }
        ringDecal(c, _a.set(center.x, 0, center.z), 'ward', 2.0, 0.3, { w: 0.08, hot: 1 });
        one(c, K().flash, center, 1.6);
        burst(c, K().rune, center, 3, 0.5, 1.5, { hemi: [0, 0.5], off: 0.8 });
        c.lights.flash(center, PAL.ward.flame, 3, 0.25, 7);
        c.feel(0.06, 0.2);
      },
    };
    return api;
  };

  /* ---- 8. ATEŞ FIRTINASI - ultimate: big danger zone, a sequence of marked meteor strikes, finale blast + burning field ---- */
  SPELLS.storm = {
    school: 'fire', label: 'Ateş Fırtınası', teleStyle: { fillA: 0.12, edge: 0xffe0a0 },
    lead: (c) => c.T.storm.fall,
    teleStart(c, tg) {
      const D = glowDisk(c, tg.point, tg.radius * 1.05, PAL.fire.deep, 0, 99, { pow: 0.7, update: (D) => { D.u.uAlpha.value = (tg.alpha || 0) * (0.1 + 0.06 * Math.sin(tg.t * 7)); return true; } });
      tg.extra.push(D);
      tg.tick = (c, tg, dt) => {
        let n = M.count(22 * dt * c.density);
        while (n-- > 0) { const r = Math.sqrt(Math.random()) * tg.radius, a = Math.random() * M.TAU; c.ps.spawn(c.kit.fire.ember, tg.point.x + Math.cos(a) * r, 0.05, tg.point.z + Math.sin(a) * r, 0, M.rand(0.8, 1.8), 0); }
      };
    },
    cast(c, h) {
      staffCharge(c, h, 'fire', 1.25);
      if (h.k > 0.3) {
        if (Math.random() < 0.8 * c.density) c.ps.spawn(c.sp.fire.upEmber, h.orb.x + M.rnd(0.06), h.orb.y, h.orb.z + M.rnd(0.06), M.rnd(0.6), M.rand(7, 10), M.rnd(0.6));
        if (Math.random() < 0.4 * c.density) c.ps.spawn(c.sp.fire.lick, h.orb.x, h.orb.y + 0.05, h.orb.z, 0, 2.5, 0, 0.5, 0.8, c.A.orb);
      }
    },
    // a: { point, radius, telegraph, from, onImpact({ point, radius, index, final }) }
    release(c, a) {
      const Ts = c.T.storm, R = a.radius, ctr = V3().set(a.point.x, 0, a.point.z), tg = a.telegraph, N = Math.max(2, Math.round(Ts.count));
      if (a.from) { staffRelease(c, a.from, UP, 'fire', 1.2); burst(c, c.sp.fire.upEmber, a.from, 10, 16, 26, { dir: UP, spread: 0.15 }); }
      const off = Math.random() * M.TAU;
      for (let i = 0; i < N; i++) {
        const final = i === N - 1, ang = off + i * 2.39996, rr = final ? 0 : R * 0.72 * Math.sqrt((i + 0.6) / (N - 1));
        const pt = V3().set(ctr.x + Math.cos(ang) * rr, 0, ctr.z + Math.sin(ang) * rr);
        const size = final ? 1.0 : Ts.size, fall = Ts.fall * (final ? 1.15 : 1);
        c.after(i * Ts.interval, () => {
          const mr = 1.25 * size;                                   // landing marker: shrinks onto the impact point
          c.ground.add('ring', { x: pt.x, z: pt.z, r: mr, color: PAL.fire.runeHi, color2: PAL.fire.flame, w: 0.07 / mr, hot: 0.4, innerA: 0.25, pow: 4, add: 0.75,
            update: (D) => { const u = D.t / fall; D.u.uR.value = 1 - 0.7 * M.easeIn(u); D.u.uAlpha.value = 0.35 + 0.65 * u; return u < 1; } });
          meteorFall(c, { to: pt, size, fall, radius: final ? 2.8 : 2.0, spell: 'storm',
            onImpact: (info) => { if (a.onImpact) a.onImpact(Object.assign(info, { index: i, final })); },
            after: final ? () => stormFinale(c, ctr, R, tg) : null });
        });
      }
    },
  };
  function stormFinale(c, p, R, tg) {
    const Ts = c.T.storm;
    ringDecal(c, p, 'fire', R * 1.15, 0.45, { w: 0.14, hot: 1, innerA: 0.5, pow: 3 });
    ringDecal(c, p, 'fire', R * 1.4, 0.8, { w: 0.5, hot: 0, innerA: 0.3, color: DUST.mid, color2: DUST.dark, add: 0, alpha: 0.6 });
    glowDisk(c, p, R * 1.3, PAL.fire.flame, 1.1, 0.6);
    scorch(c, p, R * 0.9, { life: Ts.burn + 2.2, cool: Ts.burn + 0.8, dark: 0.42 });
    if (Ts.burn > 0) afterburn(c, p, R * 0.85, Ts.burn, 26);
    c.lights.flash(_a.set(p.x, 1, p.z), PAL.fire.flame, 6, 0.6, 14);
    c.feel(0.5, 1);
    if (tg) tg.finish(0.6);
  }

  MFX._kits = { burst, one, ringDecal, scorch, glowDisk, feetSigil, afterburn, staffCharge, staffRelease };
})(typeof window !== 'undefined' ? window : globalThis);
