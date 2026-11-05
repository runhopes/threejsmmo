/* =====================================================================================================
 *  vfx/archer.js  -  ArcherVFX: the archer's skill effects, built on VFXKit (vfx/core.js)
 *
 *    const AV = ArcherVFX.create({ scene, camera, arrowTemplate, hooks, tuning, quality })
 *    AV.bindArcher(knight)           draw / charge effects read from the archer's real bow (draw amount, nocked arrow),
 *                                    the back hop is tracked from the 'hop' action
 *    AV.shoot(style, { pos, dir, count, spread, power, home, index, final, feet, range })
 *                                    release effect at the bow + pooled projectile(s) with trails
 *    AV.rainMark(center, radius)     ground telegraph (cast)          AV.rain(mark, opts)   sky shot follow-up: volleys
 *    AV.poison(anchor, seconds)      DoT status visuals on a target   AV.poisonTick(anchor)  one damage tick pulse
 *    AV.eagle(seconds)               focus buff: activation + persistent reticle; shots get a sharper release
 *    AV.update(dt)                   once per frame (after the knight's update)
 *
 *  Styles: basic (Ok Atışı) · volley (Yelpaze Atışı) · pierce (Delici Ok) · fire (Ateşli Ok) · poison (Zehirli Ok)
 *          rapid (Seri Atış) · sky + rain (Ok Sağanağı); hop (Geri Sıçrayış) and eagle (Kartal Gözü) are not projectiles.
 *
 *  The module only draws. Gameplay stays with the host through hooks:
 *    hitTest(a, b, P) -> { point, surface: 'flesh'|'wood'|'stone'|'ground', target, attach, stick } | null
 *                         first thing the arrow head segment a -> b enters (skip targets in P.hitSet). The y = 0 ground
 *                         plane is handled here. Pierce arrows pass through targets (not stone / ground).
 *    onHit(P, hit, pass)  damage / hit reactions (P.style, P.power, P.index, P.data)
 *    targetsIn(c, r)      [{ pos, height, radius }] inside the rain circle (one arrow per volley is aimed at each)
 *    onRainWave(c, r, i)  a rain volley lands (area damage belongs here, not in onHit for 'rain' arrows)
 *    light(pos, hex, intensity), shake(amount), event(type, data)   presentation side-channels
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = THREE, V3 = T.Vector3;
  const TAU = Math.PI * 2, ZF = new V3(0, 0, 1), UP = new V3(0, 1, 0);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const rand = (a, b) => a + Math.random() * (b - a);
  const rs = (a) => (Math.random() * 2 - 1) * a;

  /* ---------------------------------------------- palette ------------------------------------------------------
     physical = neutral cool white · pierce = cold white-cyan · fire = ember orange/red · poison = dirty olive green
     archer class accent (rain telegraph, eagle focus) = pale hunter gold - never green, so poison stays unambiguous */
  const C = {
    steel: 0xf2f6ff, steelTail: 0x8ea6c2, warm: 0xfff3dc, spark0: 0xfff4d2, spark1: 0xff9a3c,
    wood: 0xc9a46a, woodDark: 0x6e5034, straw: 0xdcc68e, dust: 0xc4b596, dirt: 0x6d5a40, stone: 0xb0aba0, stoneDark: 0x6f6a62,
    pierce: 0x5fb6e8, pierceHi: 0xdff6ff,
    fire0: 0xfff1b8, fire1: 0xffb04a, fire2: 0xc8380a, smoke: 0x3a322c,
    pois0: 0xc8e070, pois1: 0x7d9a34, pois2: 0x34481a, poisDark: 0x24320c,
    gold: 0xf6d98e, goldHi: 0xfff0c8, goldDeep: 0xd9a948,
  };

  /* --------------------------------------------- projectile looks ---------------------------------------------
     speed m/s, grav m/s^2 (drop), scale of the arrow mesh, trail (ribbon: w width m, life s = length, c0 head -> c1
     tail, a alpha, core = white centre line), glint [size, colour, alpha] = bright point on the arrowhead (what the
     eye tracks at gameplay distance), impact kind, lite = impact multiplier. */
  const STYLES = {
    basic:  { speed: 36, grav: 2.5, scale: 1, impact: 'physical',
      trail: { w: 0.05, life: 0.09, c0: C.steel, c1: C.steelTail, a: 0.55, core: 0.7, fpow: 1.4 }, glint: [0.11, 0xeef4ff, 0.38] },
    volley: { speed: 36, grav: 2.5, scale: 1, impact: 'physical',
      trail: { w: 0.05, life: 0.09, c0: C.warm, c1: 0xb09a74, a: 0.55, core: 0.7, fpow: 1.4 }, glint: [0.11, 0xfff2d8, 0.38] },
    rapid:  { speed: 40, grav: 2.0, scale: 1, impact: 'physical', lite: 0.6,
      trail: { w: 0.042, life: 0.065, c0: 0xfff8e6, c1: 0xc8b070, a: 0.6, core: 0.8 }, glint: [0.09, 0xfff4d8, 0.4] },
    pierce: { speed: 46, grav: 1.0, scale: 1.22, impact: 'pierce', pierce: true, wake: 1.8,
      trail: { w: 0.1, life: 0.17, c0: 0xf2fbff, c1: C.pierce, a: 0.7, core: 0.8, fpow: 1.1 }, glint: [0.22, 0xcfeeff, 0.6] },
    // element colours ride on NORMAL blending (additive orange / green turns white on bright ground); a thin additive
    // core keeps them hot / wet
    fire:   { speed: 34, grav: 2.5, scale: 1, impact: 'fire', flame: true,
      trail: { b: 'norm', w: 0.09, life: 0.12, c0: 0xffa030, c1: 0xa82a08, a: 0.75, core: 0, fpow: 1.2, cpow: 0.6 },
      trail2: { w: 0.026, life: 0.07, c0: 0xfff0b0, c1: 0xff8a30, a: 0.65, core: 0.5, at: 0.9 }, glint: [0.17, 0xffb04a, 0.55] },
    poison: { speed: 36, grav: 2.5, scale: 1, impact: 'poison', drip: true,
      trail: { b: 'norm', w: 0.08, life: 0.14, c0: 0x8aac3a, c1: 0x3d5418, a: 0.62, core: 0, fpow: 1.1 },
      trail2: { w: 0.022, life: 0.07, c0: 0xd6ec86, c1: 0x7a9a30, a: 0.32, core: 0.4, at: 0.5 }, glint: [0.1, C.pois0, 0.32] },
    rain:   { speed: 34, grav: 0, scale: 1, impact: 'rain',
      trail: { w: 0.04, life: 0.075, c0: 0xfff4d6, c1: 0xb39860, a: 0.55, core: 0.6 }, glint: null },
    sky:    { speed: 44, grav: 0, scale: 1, impact: null, maxLife: 0.6,
      trail: { w: 0.055, life: 0.14, c0: 0xfff4d6, c1: C.goldDeep, a: 0.6, core: 0.7 }, glint: [0.13, C.gold, 0.45] },
  };
  /* draw / anticipation per style: string = bowstring glow at full draw, nock = glint at the nocking point,
     guide = ground aim guide (volley fan / pierce line), plus the arrowhead treatments (ignite / coat / gather) */
  const DRAW = {
    basic:  { string: 0.16, color: 0xe8f0ff, nock: 0.22 },
    volley: { string: 0.2, color: 0xfff0d0, nock: 0.25, guide: 'fan' },
    rapid:  { string: 0.14, color: 0xfff0d0, nock: 0.2 },
    pierce: { string: 0.95, color: 0xbfeaff, nock: 0.45, guide: 'line', gather: true },
    fire:   { string: 0.25, color: 0xffb060, nock: 0, ignite: true },
    poison: { string: 0, color: 0x9fc24a, nock: 0, coat: true },
    sky:    { string: 0.3, color: C.gold, nock: 0.3 },
  };
  /* global tuning (the test bench sliders): every value 1 = authored look */
  const TUNING = {
    trail: 1,      // trail strength: width (sqrt), alpha, length
    impact: 1,     // impact intensity: particle counts, flash / ping size (sqrt)
    charge: 1,     // draw / charge glows, aim guides, buff aura
    release: 1,    // release flash + streak
    linger: 1,     // aftermath durations (stuck arrows, scorch, splat)
    life: 1,       // every particle / beam lifetime (overall effect timing)
    quality: 'high',
    volleySpread: 0.16,
    rain: { waves: 5, perWave: 6, interval: 0.2, lead: 0.55, height: 10, speed: 34, dots: true },
  };

  /* fallback arrow when the host has no template: shaft along +Z, nock at z = 0, head at z ~ 0.85 */
  function buildArrow() {
    const g = new T.Group();
    const wood = new T.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.8 }), metal = new T.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 });
    const feather = new T.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9, side: T.DoubleSide });
    const sh = new T.CylinderGeometry(0.0062, 0.0062, 0.8, 6); sh.rotateX(Math.PI / 2); sh.translate(0, 0, 0.4);
    const hd = new T.ConeGeometry(0.017, 0.07, 4); hd.rotateX(Math.PI / 2); hd.scale(1, 0.35, 1); hd.translate(0, 0, 0.83);
    g.add(new T.Mesh(sh, wood), new T.Mesh(hd, metal));
    const fg = new T.PlaneGeometry(0.022, 0.1);
    for (let i = 0; i < 3; i++) { const f = new T.Mesh(fg, feather), a = i * TAU / 3; f.position.set(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.1); f.rotation.set(0, Math.PI / 2, 0); f.rotateX(a); g.add(f); }
    return g;
  }

  function create(opts) {
    const scene = opts.scene, camera = opts.camera;
    const kit = opts.kit || VFXKit.create({ scene, camera, quality: opts.quality || 'high' });
    const ownKit = !opts.kit, PR = VFXKit.PRESETS;
    const hooks = Object.assign({ hitTest: null, onHit: null, targetsIn: null, onRainWave: null, light: null, shake: null, event: null }, opts.hooks || {});
    const tuning = JSON.parse(JSON.stringify(TUNING));
    if (opts.tuning) for (const k in opts.tuning) tuning[k] = (typeof opts.tuning[k] === 'object') ? Object.assign(tuning[k] || {}, opts.tuning[k]) : opts.tuning[k];
    const AV = { kit, tuning, STYLES, DRAW, C, projectiles: [], hooks, archer: null };
    const ev = (type, data) => { if (hooks.event) hooks.event(type, data || {}); };
    const shake = (s) => { if (hooks.shake) hooks.shake(s); };
    const _a = new V3(), _b = new V3(), _h = new V3(), _w = new V3(), _d = new V3(), _s = new V3(), _q = new T.Quaternion(), _m = new V3(), _n = new V3();

    /* ------------------------------------------- pooled arrows ---------------------------------------------- */
    const tpl = opts.arrowTemplate || buildArrow();
    const ARROW_LEN = opts.arrowLength || 0.86;
    const pool = [];
    for (let i = 0; i < 24; i++) pool.push(tpl.clone());            // clones share geometry + materials
    const getArrow = () => { const m = pool.pop() || tpl.clone(); m.visible = true; m.scale.setScalar(1); scene.add(m); return m; };
    const putArrow = (m) => { if (m.parent) m.parent.remove(m); m.visible = false; pool.push(m); };
    AV.poolSize = () => pool.length;

    /* ------------------------------------------- small builders --------------------------------------------- */
    // ground ring (particle, lying flat): radius r0 -> r1 metres. The atlas ring sits at 0.36 of the quad size.
    function groundRing(x, z, r0, r1, life, color, a, normal) {
      kit.emit(PR.gring, x, 0.035, z, 0, 0, 0, { b: normal ? 'gnorm' : 'gadd', s0: r0 / 0.36, s1: r1 / 0.36, life, c0: color, c1: color, a });
    }
    // ring across a direction (shock / wake rings): procedural flat oriented with its normal along `dir`
    function shockRing(pos, dir, r0, r1, life, color, a, width) {
      _q.setFromUnitVectors(ZF, dir);
      const L = life * kit.lifeMul;
      const F = kit.flat('ring', { pos, quaternion: _q, radius: r0, color, alpha: a, add: true, order: 27,
        update(F) { const u = F.t / L; if (u >= 1) return false; const e = 1 - Math.pow(1 - u, 3); F.m.scale.setScalar(2 * (r0 + (r1 - r0) * e)); F.u.uAlpha.value = a * Math.pow(1 - u, 1.5); } });
      if (F) F.u.uP.value.set(0.82, width || 0.07, 0.02, 0.5);
    }
    // a ground decal that fades in, holds, then fades out (scorch / poison splat)
    function decal(mode, pos, radius, color, color2, alpha, life, ember) {
      const L = life * tuning.linger;
      const F = kit.flat(mode, { pos, radius, color, color2, alpha: 0, order: 9,
        update(F) {
          const u = F.t / L; if (u >= 1) return false;
          F.u.uAlpha.value = alpha * Math.min(1, F.t / 0.12) * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
          if (ember) F.u.uP.value.w = Math.exp(-F.t * 1.7);
        } });
      return F;
    }
    const sideOf = (dir, out) => out.set(-dir.z, 0, dir.x).normalize();
    // hit points lie on / inside the target's capsule: hit confirmation is drawn a little toward the camera so the
    // body it struck does not swallow it (particles are depth-tested); sparks start at the surface
    const _fxp = new V3();
    const toCam = (pt, k, out) => (out || _fxp).copy(camera.position).sub(pt).normalize().multiplyScalar(k).add(pt);

    /* -------------------------------------------- projectiles ----------------------------------------------- */
    let pid = 0, groupId = 0;
    const E = { on: false, t: 0, dur: 0, F: null, endT: 0, moteT: 0 };    // eagle focus state (affects shots)
    function trailStyle(base, P) {
      const t = tuning.trail, boost = P.eagle ? 1.18 : 1;
      return Object.assign({}, base, { w: base.w * Math.sqrt(t) * (P.eagle ? 1.08 : 1), life: base.life * (0.5 + 0.5 * t), a: Math.min(1, base.a * Math.min(t, 1.6) * boost) });
    }
    function spawnArrow(style, pos, vel, o) {
      const S = STYLES[style];
      const m = getArrow(); m.scale.setScalar(S.scale);
      const P = { id: ++pid, style, S, m, pos: pos.clone(), vel: vel.clone(), prev: pos.clone(), dir: vel.clone().normalize(),
        grav: o.grav !== undefined ? o.grav : S.grav, life: 0, maxLife: o.maxLife || S.maxLife || 1.15, power: o.power || 1,
        group: o.group || 0, index: o.index || 0, final: !!o.final, home: o.home || null, homeRate: o.homeRate || 12,
        hitSet: null, stuck: 0, stuckMax: 0, stick: o.stick, alive: true, data: o.data || null, eagle: E.on,
        wakeD: 0, emT: 0, emT2: 0, emT3: 0, baseScale: null, trail: null, trail2: null, noHit: !!o.noHit };
      P.trail = kit.trail(trailStyle(S.trail, P));
      if (S.trail2) P.trail2 = kit.trail(trailStyle(S.trail2, P));
      orient(P); pushTrail(P);
      AV.projectiles.push(P);
      return P;
    }
    function orient(P) { P.m.position.copy(P.pos); P.m.quaternion.setFromUnitVectors(ZF, P.dir); }
    function pushTrail(P) {
      if (P.trail) P.trail.push(P.pos.x, P.pos.y, P.pos.z, kit.time);
      if (P.trail2) { const L = ARROW_LEN * P.S.scale * (P.S.trail2.at || 0.5); P.trail2.push(P.pos.x + P.dir.x * L, P.pos.y + P.dir.y * L, P.pos.z + P.dir.z * L, kit.time); }
    }
    function despawn(P, i) {
      if (!P.alive) return;
      if (P.trail) P.trail.detach(); if (P.trail2) P.trail2.detach();
      putArrow(P.m); P.alive = false;
      const k = i !== undefined ? i : AV.projectiles.indexOf(P); if (k >= 0) AV.projectiles.splice(k, 1);
    }
    function steer(P, dt) {                                        // homing (creature lock-on): keeps the speed
      const tgt = P.home.aim ? P.home.aim(_h) : null;
      if (!tgt) { P.home = null; return false; }
      const sp = P.vel.length(); if (sp < 1e-4) return false;
      _w.copy(tgt).sub(P.pos).normalize();
      _d.copy(P.vel).divideScalar(sp).lerp(_w, Math.min(1, P.homeRate * dt)).normalize();
      P.vel.copy(_d).multiplyScalar(sp);
      return true;
    }
    function headOf(P, out, f) { return out.copy(P.pos).addScaledVector(P.dir, ARROW_LEN * P.S.scale * (f === undefined ? 0.97 : f)); }

    function travelFX(P, dt) {                                     // per-style emitters while flying
      const S = P.S, tr = Math.min(1, tuning.trail);
      const hd = headOf(P, _h);
      if (S.glint && tr > 0) kit.emit(PR.glint, hd.x, hd.y, hd.z, 0, 0, 0, { s0: S.glint[0] * (P.eagle ? 1.15 : 1), s1: S.glint[0], c0: S.glint[1], c1: S.glint[1], a: S.glint[2] * tr });
      if (S.flame) {                                              // burning head: flame body + hot core, shed embers, thin smoke
        P.emT += dt;
        while (P.emT > 0.016) {
          P.emT -= 0.016;
          kit.emit(PR.flame, hd.x + rs(0.02), hd.y + rs(0.02), hd.z + rs(0.02), -P.dir.x * 1.2 + rs(0.4), 0.5 + rs(0.3), -P.dir.z * 1.2 + rs(0.4), { scale: 1.0, life: rand(0.12, 0.18) });
          if (Math.random() < 0.5) kit.emit(PR.flameHot, hd.x, hd.y, hd.z, -P.dir.x, 0.3, -P.dir.z, { scale: 0.9 });
        }
        P.emT2 += dt;
        while (P.emT2 > 0.035) { P.emT2 -= 0.035; kit.emit(PR.ember, hd.x, hd.y, hd.z, -P.dir.x * 2 + rs(1.4), 1 + rs(0.8), -P.dir.z * 2 + rs(1.4), { life: rand(0.3, 0.5), scale: 0.75 }); }
        if (kit.Q.smoke) { P.emT3 += dt; while (P.emT3 > 0.07) { P.emT3 -= 0.07; kit.emit(PR.smoke, P.pos.x, P.pos.y, P.pos.z, rs(0.2), 0.4, rs(0.2), { scale: 0.32, a: 0.16, life: rand(0.4, 0.6) }); } }
      } else if (S.drip) {                                         // poisoned head: falling drips + faint mist
        P.emT += dt;
        while (P.emT > 0.06) { P.emT -= 0.06; kit.emit(PR.drop, hd.x, hd.y - 0.02, hd.z, P.vel.x * 0.22 + rs(0.3), -0.6, P.vel.z * 0.22 + rs(0.3), { scale: 0.75 }); }
        P.emT2 += dt;
        while (P.emT2 > 0.075) { P.emT2 -= 0.075; kit.emit(PR.dust, hd.x, hd.y, hd.z, rs(0.2), 0.25, rs(0.2), { c0: C.pois1, c1: 0x4a5e22, a: 0.2, s0: 0.08, s1: 0.24, life: rand(0.3, 0.42) }); }
      } else if (S.wake && kit.Q.extras && tuning.trail > 0) {     // pierce: wake rings along the path
        P.wakeD += P.vel.length() * dt;
        if (P.wakeD > S.wake) { P.wakeD -= S.wake; shockRing(headOf(P, _m, 0.5), P.dir, 0.1, 0.42, 0.22, C.pierceHi, 0.32 * tr, 0.06); }
      }
    }

    function updateProjectiles(dt) {
      for (let i = AV.projectiles.length - 1; i >= 0; i--) {
        const P = AV.projectiles[i];
        if (P.stuck > 0) { updateStuck(P, dt, i); continue; }
        P.life += dt;
        P.prev.copy(P.pos);
        if (!(P.home && steer(P, dt))) P.vel.y -= P.grav * dt;
        P.pos.addScaledVector(P.vel, dt);
        P.dir.copy(P.vel).normalize();
        orient(P); pushTrail(P);
        travelFX(P, dt);
        if (!P.noHit && P.S.impact) {                              // (the sky shot just leaves the screen)
          const L = ARROW_LEN * P.S.scale;
          _a.copy(P.prev).addScaledVector(P.dir, L); _b.copy(P.pos).addScaledVector(P.dir, L);   // the head this frame
          let hit = hooks.hitTest ? hooks.hitTest(_a, _b, P) : null;
          // walkable ground: the y = 0 plane, or the terrain when the host sets AV.groundY(x, z) (open world, vertical frame)
          const gA = AV.groundY ? AV.groundY(_a.x, _a.z) : 0, gB = AV.groundY ? AV.groundY(_b.x, _b.z) : 0;
          if (_b.y < gB + 0.02 && _a.y >= gA + 0.02) {
            const da = _a.y - gA - 0.02, db = _b.y - gB - 0.02, f = da / Math.max(1e-6, da - db), gp = new V3().lerpVectors(_a, _b, f); gp.y = AV.groundY ? AV.groundY(gp.x, gp.z) : 0;
            if (!hit || hit.point.distanceToSquared(_a) > gp.distanceToSquared(_a)) hit = { point: gp, surface: 'ground' };
          } else if (_b.y < gB + 0.02 && !hit) hit = { point: _b.clone().setY(gB), surface: 'ground' };
          if (hit && resolveHit(P, hit, i)) continue;
        }
        if (P.life > P.maxLife) despawn(P, i);
      }
    }
    function resolveHit(P, hit, i) {                               // true = the projectile stopped
      const pass = !!(P.S.pierce && hit.target && hit.surface !== 'stone' && hit.surface !== 'ground');
      if (hit.target) (P.hitSet || (P.hitSet = new Set())).add(hit.target);
      if (hooks.onHit) hooks.onHit(P, hit, pass);
      impactFX(P, hit, pass);
      ev('impact', { style: P.style, surface: hit.surface, target: !!hit.target, pass, index: P.index, point: hit.point });
      if (pass) return false;
      stick(P, hit, i);
      return true;
    }
    function stick(P, hit, i) {
      const L = ARROW_LEN * P.S.scale;
      const depth = hit.surface === 'ground' ? 0.2 : hit.surface === 'stone' ? 0.04 : 0.16;
      let t = hit.stick !== undefined ? hit.stick : P.stick !== undefined ? P.stick : hit.surface === 'ground' ? 1.6 : 2.5;
      if (P.trail) P.trail.detach(); if (P.trail2) P.trail2.detach();
      if (t <= 0.02 || hit.surface === 'stone' && Math.random() < 0.5) { despawn(P, i); return; }   // stone: half of them shatter / bounce off
      P.m.position.copy(hit.point).addScaledVector(P.dir, -(L - depth));
      P.m.quaternion.setFromUnitVectors(ZF, P.dir);
      if (hit.attach) hit.attach.attach(P.m);
      P.baseScale = P.m.scale.clone();
      P.stuck = P.stuckMax = t * (P.style === 'rain' ? 1 : tuning.linger);
      P.pos.copy(hit.point);
    }
    function updateStuck(P, dt, i) {
      P.stuck -= dt;
      const age = P.stuckMax - P.stuck;
      if (P.style === 'fire' && age < 0.9) {                        // the arrow keeps burning a moment where it sits
        P.emT += dt;
        while (P.emT > 0.03) {
          P.emT -= 0.03;
          P.m.localToWorld(_h.set(0, 0, 0.62));
          const k = 1 - age / 0.9;
          kit.emit(PR.flame, _h.x + rs(0.03), _h.y, _h.z + rs(0.03), rs(0.2), 0.6, rs(0.2), { scale: 0.5 * k + 0.15, life: rand(0.12, 0.2) });
          if (Math.random() < 0.15) kit.emit(PR.ember, _h.x, _h.y, _h.z, rs(0.6), 1.2, rs(0.6), { life: 0.5, scale: 0.6 });
        }
      } else if (P.style === 'poison' && age < 1.2 && Math.random() < dt * 5) {
        P.m.localToWorld(_h.set(0, 0, 0.6));
        kit.emit(PR.drop, _h.x, _h.y, _h.z, rs(0.1), -0.3, rs(0.1), { scale: 0.6 });
      }
      if (P.stuck < 0.25 && P.baseScale) P.m.scale.copy(P.baseScale).multiplyScalar(Math.max(0.01, P.stuck / 0.25));
      if (P.stuck <= 0) despawn(P, i);
    }

    /* ------------------------------------------------ release ------------------------------------------------ */
    function releaseFX(style, pos, dir, o) {
      const R = tuning.release * (E.on ? 1.2 : 1); if (R <= 0) return;
      const sR = Math.sqrt(R), gold = E.on && (style === 'basic' || style === 'rapid' || style === 'volley');
      const streak = (d, len, w, color, a, life) => kit.beam({ p0: _m.copy(pos).addScaledVector(d, 0.12), p1: _n.copy(pos).addScaledVector(d, 0.12 + len * (E.on ? 1.3 : 1)),
        width: w * sR, color, alpha: Math.min(1, a * R), core: 0.9, life, grow: 0.025, fade: [0.55, 0.12] });
      const wisps = (n, spd) => {
        sideOf(dir, _s);
        for (let k = 0; k < n; k++) { const sd = k % 2 ? 1 : -1; kit.emit(PR.wind, pos.x + dir.x * 0.3, pos.y + dir.y * 0.3, pos.z + dir.z * 0.3, dir.x * spd + _s.x * sd * rand(1.1, 2), dir.y * spd + rand(0.1, 0.6), dir.z * spd + _s.z * sd * rand(1.1, 2), { a: 0.3 * Math.min(1, R) }); }
      };
      switch (style) {
        case 'basic': case 'rapid': case 'volley': {
          const rapid = style === 'rapid';
          kit.emit(PR.flash, pos.x, pos.y, pos.z, 0, 0, 0, { s0: 0.12 * sR, s1: (rapid ? 0.22 : 0.27) * sR, life: 0.055, c1: gold ? C.gold : 0xdfe8ff, a: 0.7 });
          const dirs = (o && o.dirs) || [dir];
          for (const d of dirs) streak(d, rapid ? 0.7 : 1.0, rapid ? 0.034 : 0.04, gold ? 0xffe6a8 : 0xeef4ff, 0.55, rapid ? 0.07 : 0.09);
          wisps(rapid ? 1 : 2, 7);
          if (gold) kit.emit(PR.ping, pos.x, pos.y, pos.z, 0, 0, 0, { s0: 0.1, s1: 0.45, c0: C.goldHi, c1: C.gold, a: 0.5, life: 0.12 });
          if (rapid && o && o.feet) kit.emit(PR.dust, o.feet.x + dir.x * 0.25, 0.06, o.feet.z + dir.z * 0.25, rs(0.6) - dir.x * 0.6, 0.3, rs(0.6) - dir.z * 0.6, { scale: 0.55, a: 0.22 });
          break;
        }
        case 'pierce': {
          kit.emit(PR.flash, pos.x, pos.y, pos.z, 0, 0, 0, { s0: 0.25 * sR, s1: 0.62 * sR, life: 0.08, c0: 0xffffff, c1: 0xbfeaff, a: 0.95 });
          shockRing(_m.copy(pos).addScaledVector(dir, 0.5), dir, 0.08, 0.62 * sR, 0.2, C.pierceHi, 0.6 * Math.min(1, R), 0.06);
          shockRing(_m.copy(pos).addScaledVector(dir, 1.5), dir, 0.05, 0.4 * sR, 0.16, C.pierceHi, 0.4 * Math.min(1, R), 0.05);
          const range = (o && o.range) || 18;
          kit.beam({ p0: pos, p1: _n.copy(pos).addScaledVector(dir, range), width: 0.075 * sR, color: 0xcfeeff, alpha: 0.42 * Math.min(1, R), core: 1, life: 0.34,   // force-line: the path it will pierce
            fade: [0.02, 0.3], sweep: STYLES.pierce.speed / range, wcurve: 0.7 });
          kit.beam({ p0: pos, p1: _n.copy(pos).addScaledVector(dir, range * 0.6), width: 0.022, color: 0xffffff, alpha: 0.7 * Math.min(1, R), core: 1, life: 0.16, fade: [0.02, 0.5] });
          wisps(4, 9);
          if (o && o.feet) for (let k = 0; k < kit.n(4); k++) kit.emit(PR.dust, o.feet.x + rs(0.25), 0.06, o.feet.z + rs(0.25), -dir.x * rand(1.6, 3) + rs(0.5), rand(0.2, 0.5), -dir.z * rand(1.6, 3) + rs(0.5), { scale: 0.8, a: 0.3 });
          shake(0.07);
          break;
        }
        case 'fire': {
          kit.emit(PR.flash, pos.x, pos.y, pos.z, 0, 0, 0, { s0: 0.15 * sR, s1: 0.34 * sR, life: 0.07, c1: 0xffb060, a: 0.8 });
          streak(dir, 0.8, 0.04, 0xffc070, 0.45, 0.09);
          for (let k = 0; k < kit.n(6); k++) kit.emit(PR.ember, pos.x, pos.y, pos.z, dir.x * rand(2, 5) + rs(1.4), rand(0.4, 1.8), dir.z * rand(2, 5) + rs(1.4), { life: rand(0.3, 0.55), scale: 0.8 });
          for (let k = 0; k < 2; k++) kit.emit(PR.flame, pos.x, pos.y, pos.z, dir.x * 2 + rs(0.5), 0.6, dir.z * 2 + rs(0.5), { scale: 0.8 });
          break;
        }
        case 'poison': {
          kit.emit(PR.flash, pos.x, pos.y, pos.z, 0, 0, 0, { s0: 0.08 * sR, s1: 0.2 * sR, life: 0.06, c0: 0xe8ffb0, c1: C.pois0, a: 0.4 });
          streak(dir, 0.7, 0.03, 0xb8d070, 0.26, 0.08);
          for (let k = 0; k < kit.n(4); k++) kit.emit(PR.drop, pos.x, pos.y, pos.z, dir.x * rand(2, 4) + rs(0.8), rand(0.2, 1.2), dir.z * rand(2, 4) + rs(0.8), { scale: 0.8 });
          break;
        }
        case 'sky': {
          kit.emit(PR.flash, pos.x, pos.y, pos.z, 0, 0, 0, { s0: 0.14 * sR, s1: 0.34 * sR, life: 0.07, c1: C.gold, a: 0.8 });
          streak(dir, 2.0, 0.05, C.goldHi, 0.6, 0.12);
          wisps(3, 8);
          if (o && o.feet) for (let k = 0; k < kit.n(3); k++) kit.emit(PR.dust, o.feet.x + rs(0.3), 0.06, o.feet.z + rs(0.3), rs(1.2), 0.35, rs(1.2), { scale: 0.7, a: 0.25 });
          break;
        }
      }
    }

    /* ------------------------------------------------ impacts ------------------------------------------------ */
    // Where the hit reads: on a target, the confirmation sits on its CAMERA-FACING surface (axis at the hit height +
    // radius + margin, leaning toward the shooter) - the host's hit point lies inside the capsule and would be hidden
    // by the body it struck. On walls / ground the point is lifted just off the surface.
    const _fa = new V3(), _fb = new V3();
    function fxPoint(hit, d, margin, out) {
      const T = hit.target, p = hit.point; out = out || new V3();
      if (!T || !T.pos || !T.radius) return toCam(p, 0.08, out);
      _fa.set(T.pos.x, p.y, T.pos.z);
      _fb.copy(camera.position).sub(_fa).normalize().multiplyScalar(0.6).addScaledVector(d, -0.4).normalize();
      return out.copy(_fa).addScaledVector(_fb, T.radius + margin);
    }
    const groups = new Map();                                      // volley multi-hit: group -> Map(target -> count)
    function confirm(fp, I, P, heavy, tint) {                       // hit confirmation: flash + crisp ring ping
      const sI = Math.sqrt(I);
      kit.emit(PR.flash, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.3 * sI, s1: 0.58 * sI, life: 0.075, c1: tint || 0xffe2a8, a: 0.9 });
      let ping = (heavy ? 1.25 : 1) * 0.95 * sI;
      if (P && P.style === 'rapid') ping *= 0.72 * (1 + 0.1 * P.index);   // rapid: each hit of the burst rings a bit wider
      kit.emit(PR.ping, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.14, s1: ping, c0: 0xffffff, c1: tint || 0xffdca0, a: 0.8 });
      if (P && P.final) kit.emit(PR.flash, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.36, s1: 0.85 * sI, life: 0.1, c1: 0xfff0c0, a: 0.8 });
    }
    function physicalHit(hit, fp, d, I, P, heavy, tint) {
      const surf = hit.surface || 'ground', tgt = !!hit.target, stone = surf === 'stone';
      if (tgt) confirm(fp, I, P, heavy, tint);
      const ns = kit.n((tgt ? 5 : 3) * (stone ? 1.8 : 1) + (P && P.final ? 3 : 0), I);
      for (let k = 0; k < ns; k++) {
        const sp = rand(3, stone ? 9 : 7);
        _w.set(-d.x * 0.55 + rs(0.7), rand(0.15, 0.8), -d.z * 0.55 + rs(0.7)).normalize();
        kit.emit(PR.spark, fp.x, fp.y, fp.z, _w.x * sp, _w.y * sp, _w.z * sp, { c0: tint ? 0xfff6e0 : PR.spark.c0, c1: tint || PR.spark.c1, s0: 0.042, stretch: 0.034 });
      }
      if (surf === 'wood') {                                       // straw + wood: splinters and a straw puff
        for (let k = 0; k < kit.n(4, I); k++) kit.emit(PR.chip, fp.x, fp.y, fp.z, -d.x * 1.5 + rs(2.2), rand(1.2, 3), -d.z * 1.5 + rs(2.2), { c0: C.wood, c1: C.woodDark, scale: 1.2 });
        for (let k = 0; k < kit.n(2, I); k++) kit.emit(PR.dust, fp.x, fp.y, fp.z, -d.x * 0.8 + rs(0.5), rand(0.2, 0.6), -d.z * 0.8 + rs(0.5), { c0: C.straw, c1: 0xb8a070, a: 0.36, scale: 0.8 });
      } else if (surf === 'flesh') {
        for (let k = 0; k < kit.n(1, I); k++) kit.emit(PR.dust, fp.x, fp.y, fp.z, -d.x * 0.6, 0.4, -d.z * 0.6, { c0: 0xd8cfc0, c1: 0xb0a898, a: 0.26, scale: 0.65 });
      } else if (stone) {                                          // stone: more / bouncier sparks, grey grit
        for (let k = 0; k < kit.n(2, I); k++) kit.emit(PR.dust, fp.x, fp.y, fp.z, -d.x * 1 + rs(0.5), rand(0.2, 0.6), -d.z * 1 + rs(0.5), { c0: C.stone, c1: C.stoneDark, a: 0.36, scale: 0.8 });
        for (let k = 0; k < kit.n(3, I); k++) kit.emit(PR.chip, fp.x, fp.y, fp.z, -d.x * 2 + rs(2), rand(1, 3), -d.z * 2 + rs(2), { c0: C.stone, c1: C.stoneDark, scale: 1.2 });
      } else {                                                     // ground: dust kicked back along the shot + dirt
        const p = hit.point;
        for (let k = 0; k < kit.n(3, I); k++) kit.emit(PR.dust, p.x + rs(0.1), 0.06, p.z + rs(0.1), -d.x * 0.8 + rs(0.9), rand(0.35, 0.8), -d.z * 0.8 + rs(0.9), { scale: 0.9, a: 0.38 });
        for (let k = 0; k < kit.n(3, I); k++) kit.emit(PR.chip, p.x, 0.05, p.z, -d.x * 1.2 + rs(1.6), rand(1.2, 2.6), -d.z * 1.2 + rs(1.6), { c0: C.dirt, c1: 0x4a3a28, scale: 1.2 });
      }
    }
    function pierceThrough(hit, fp, d, I) {
      const sI = Math.sqrt(I), T = hit.target, r = (T && T.radius) || 0.4;
      const ex = new V3(T ? T.pos.x : hit.point.x, hit.point.y, T ? T.pos.z : hit.point.z).addScaledVector(d, r + 0.15);   // exit: the far side
      kit.emit(PR.flash, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.34 * sI, s1: 0.72 * sI, life: 0.08, c0: 0xffffff, c1: 0xcfeeff, a: 0.95 });
      kit.emit(PR.ping, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.15, s1: 1.1 * sI, c0: 0xffffff, c1: 0xbfeaff, a: 0.75 });
      for (let k = 0; k < kit.n(10, I); k++) {                       // exit cone: the force carries on through
        const sp = rand(6, 11);
        _w.set(d.x + rs(0.3), d.y + rand(-0.05, 0.3), d.z + rs(0.3)).normalize();
        kit.emit(PR.spark, ex.x, ex.y, ex.z, _w.x * sp, _w.y * sp, _w.z * sp, { c0: 0xf2fbff, c1: C.pierce, stretch: 0.04, grav: -6, s0: 0.045 });
      }
      shockRing(ex, d, 0.12, 0.9 * sI, 0.22, C.pierceHi, 0.7, 0.08);
      kit.beam({ p0: ex, p1: _n.copy(ex).addScaledVector(d, 1.8), width: 0.07 * sI, color: 0xcfeeff, alpha: 0.7, core: 1, life: 0.14, grow: 0.05, fade: [0.05, 0.4] });
      shake(0.05);
    }
    function firePop(hit, fp, d, I) {                              // compact circular fire pop, embers, smoke wisp, light scorch
      const sI = Math.sqrt(I), g = hit.target && hit.target.pos ? hit.target.pos : hit.point, pt = fp;
      kit.emit(PR.flash, pt.x, pt.y, pt.z, 0, 0, 0, { s0: 0.4 * sI, s1: 1.1 * sI, life: 0.1, c0: 0xffffff, c1: 0xffc060, a: 0.95 });
      for (let k = 0; k < kit.n(5, I); k++) kit.emit(PR.flameHot, pt.x, pt.y, pt.z, rs(2.2), rs(1.6) + 0.6, rs(2.2), { scale: 1.6 * sI });
      for (let k = 0; k < kit.n(4, I); k++) kit.emit(PR.flame, pt.x + rs(0.1), pt.y, pt.z + rs(0.1), rs(0.8), rand(1.2, 2.2), rs(0.8), { life: rand(0.3, 0.42), s0: 0.26 * sI, s1: 0.5 * sI, c0: 0xffc050, c1: 0xb8300a });   // compact body
      const n = Math.max(6, kit.n(11, I)), a0 = Math.random() * TAU;   // circular pop: a ring of flame racing out horizontally
      for (let k = 0; k < n; k++) {
        const a = a0 + (k + rand(-0.25, 0.25)) / n * TAU, sp = rand(3, 4.2) * sI;
        kit.emit(PR.flame, pt.x, pt.y, pt.z, Math.cos(a) * sp, rand(-0.2, 0.5), Math.sin(a) * sp, { life: rand(0.28, 0.38), s0: 0.24 * sI, s1: 0.6 * sI, drag: 6, c0: 0xffd060, c1: 0xc8380a });
        if (k % 2 === 0) kit.emit(PR.flameHot, pt.x, pt.y, pt.z, Math.cos(a) * sp * 0.9, rand(0, 0.4), Math.sin(a) * sp * 0.9, { life: rand(0.16, 0.22), scale: 1.5 * sI, drag: 6 });   // hot tongue inside each flame
      }
      groundRing(g.x, g.z, 0.15, 1.15 * sI, 0.32, 0xff7a20, 0.8, true);
      for (let k = 0; k < kit.n(9, I); k++) { randUp(_w); const sp = rand(2, 4.5); kit.emit(PR.ember, pt.x, pt.y, pt.z, _w.x * sp, _w.y * sp, _w.z * sp); }
      if (kit.Q.smoke) for (let k = 0; k < kit.n(3, I); k++) kit.emit(PR.smoke, pt.x + rs(0.15), pt.y, pt.z + rs(0.15), rs(0.4), rand(0.4, 0.8), rs(0.4), { scale: 0.8 * sI });
      if (hooks.light && kit.Q.lights) hooks.light(pt, 0xff9040, 2.6 * sI);
      const sc = toCam(_m.set(g.x, 0, g.z), hit.target ? (hit.target.radius || 0.4) * 0.6 : 0, new V3()); sc.y = 0;
      decal('scorch', sc, 0.6 * sI, 0x120a06, 0xff6a1a, 0.85, 2.2, true);   // light scorch + ember speckle that cools
      for (let k = 0; k < kit.n(3, I); k++) kit.emit(PR.glint, sc.x + rs(0.35), 0.06, sc.z + rs(0.35), 0, 0, 0, { b: 'gadd', life: rand(0.7, 1.2), s0: 0.09, s1: 0.04, c0: 0xffa040, c1: 0xff4a10, a: 0.7, fpow: 1.5 });
      shake(0.05);
    }
    function poisonSplash(hit, fp, d, I) {                         // dirty splash: drops, sickly mist, "applied" ring, splat
      const sI = Math.sqrt(I), pt = fp;
      kit.emit(PR.flash, pt.x, pt.y, pt.z, 0, 0, 0, { s0: 0.12, s1: 0.34 * sI, life: 0.07, c0: 0xe8ffb0, c1: C.pois0, a: 0.5 });
      for (let k = 0; k < kit.n(9, I); k++) kit.emit(PR.drop, pt.x, pt.y, pt.z, -d.x * rand(1, 2.5) + rs(1.8), rand(1, 3.2), -d.z * rand(1, 2.5) + rs(1.8), { scale: 1.35 * sI });
      for (let k = 0; k < kit.n(4, I); k++) kit.emit(PR.dust, pt.x + rs(0.12), pt.y + rs(0.12), pt.z + rs(0.12), rs(0.7), rand(0.15, 0.45), rs(0.7), { c0: 0x7a9a30, c1: 0x52682a, a: 0.48, s0: 0.4 * sI, s1: 1.2 * sI, life: rand(0.9, 1.3), drag: 2 });
      kit.emit(PR.dust, pt.x, pt.y, pt.z, 0, 0.2, 0, { c0: C.poisDark, c1: 0x3a4a18, a: 0.45, s0: 0.3, s1: 0.75 * sI, life: 0.75 });
      const tp = hit.target && hit.target.pos ? hit.target.pos : hit.point;
      if (hit.target) groundRing(tp.x, tp.z, 0.25, 0.95 + (hit.target.radius || 0.4), 0.42, 0x5d8a22, 0.72, true);   // "poison applied" at the feet
      const sp = toCam(_m.set(tp.x, 0, tp.z), hit.target ? (hit.target.radius || 0.4) * 0.7 : 0, new V3()); sp.y = 0;
      decal('splat', sp, 0.55 * sI, 0x2a3a0e, 0x6f8f2a, 0.85, 2.4);
    }
    function rainHit(hit, fp, I) {
      if (hit.target) {
        kit.emit(PR.flash, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.16, s1: 0.34 * Math.sqrt(I), c1: 0xffe2a8, a: 0.8 });
        for (let k = 0; k < kit.n(2, I); k++) kit.emit(PR.spark, fp.x, fp.y, fp.z, rs(3), rand(1, 3), rs(3));
        return;
      }
      const p = hit.point;
      for (let k = 0; k < kit.n(2, I); k++) kit.emit(PR.dust, p.x + rs(0.06), 0.05, p.z + rs(0.06), rs(0.8), rand(0.3, 0.6), rs(0.8), { scale: 0.6, a: 0.36 });
      for (let k = 0; k < kit.n(2, I); k++) kit.emit(PR.chip, p.x, 0.05, p.z, rs(1.4), rand(1.2, 2.2), rs(1.4), { c0: C.dirt, c1: 0x4a3a28 });
      if (Math.random() < 0.6 * I) kit.emit(PR.spark, p.x, 0.06, p.z, rs(2), rand(1, 2.5), rs(2), { c0: 0xfff4d6, c1: C.goldDeep, life: 0.14 });
    }
    const randUp = (out) => { do { out.set(rs(1), Math.random(), rs(1)); } while (out.lengthSq() > 1 || out.lengthSq() < 0.05); out.y = out.y * 0.8 + 0.25; return out.normalize(); };
    function impactFX(P, hit, pass) {
      const S = P.S, I = tuning.impact * (S.lite || 1); if (I <= 0) return;
      const d = P.dir, fp = fxPoint(hit, d, 0.14);
      switch (S.impact) {
        case 'physical': physicalHit(hit, fp, d, I, P); break;
        case 'pierce': if (pass) pierceThrough(hit, fp, d, I); else physicalHit(hit, fp, d, I * 1.3, P, true, 0xcfeeff); break;
        case 'fire': physicalHit(hit, fp, d, I * 0.45, P, false, 0xffb060); firePop(hit, fp, d, I); break;
        case 'poison': physicalHit(hit, fp, d, I * 0.4, P, false, C.pois0); poisonSplash(hit, fp, d, I); break;
        case 'rain': rainHit(hit, fp, I); break;
      }
      if (hit.target && P.group && P.style === 'volley') {          // several fan arrows on one target: one wider ring
        let G = groups.get(P.group); if (!G) { G = { t: kit.time, m: new Map() }; groups.set(P.group, G); }
        const c = (G.m.get(hit.target) || 0) + 1; G.m.set(hit.target, c);
        if (c >= 2) kit.emit(PR.ping, fp.x, fp.y, fp.z, 0, 0, 0, { s0: 0.3, s1: (1.2 + 0.25 * (c - 2)) * Math.sqrt(I), c0: 0xffffff, c1: C.gold, a: 0.65, life: 0.2 });
      }
    }

    /* ------------------------------------------------- shoot ------------------------------------------------- */
    AV.shoot = function (style, o) {
      const S = STYLES[style]; if (!S) return [];
      const n = o.count || 1, spread = o.spread === undefined ? tuning.volleySpread : o.spread;
      const dirs = [];
      for (let k = 0; k < n; k++) dirs.push(o.dir.clone().applyAxisAngle(UP, n > 1 ? (k - (n - 1) / 2) * spread : 0));
      releaseFX(style, o.pos, o.dir, { dirs, feet: o.feet, range: o.range });
      if (BT.guide) guideEnd(true);
      const group = ++groupId, sp = o.speed || S.speed;
      const out = dirs.map((d, k) => spawnArrow(style, o.pos, d.clone().multiplyScalar(sp), { power: o.power, group, index: o.index, final: o.final,
        home: k === (n - 1) / 2 ? o.home : null, maxLife: o.maxLife, data: o.data }));
      ev('release', { style, count: n, index: o.index || 0 });
      return out;
    };
    AV.release = releaseFX;
    AV.impact = function (style, point, dir, surface, o) { impactFX({ S: STYLES[style], style, dir, index: 0, group: 0 }, { point, surface, target: o && o.target }, !!(o && o.pass)); };
    AV.groundRing = groundRing;
    AV.shockRing = shockRing;

    /* ------------------------------------------------- rain -------------------------------------------------- */
    AV.rainMark = function (center, radius) {
      // handle also speaks the host's circle dialect: .point, and a numeric .fade >= 0 means "fade out now"
      const H = { center: center.clone().setY(0), radius, started: false, fading: false, fadeT: 0, pulse: 0, tStart: 0, lead: tuning.rain.lead, fade: -1 };
      H.point = H.center;
      H.end = () => { H.fading = true; };
      H.F = kit.flat('telegraph', { pos: H.center, radius, color: C.gold, alpha: 0, order: 11,
        update(F, dt) {
          const appear = Math.min(1, F.t / 0.18), e = 1 - Math.pow(1 - appear, 3);
          let a = e * Math.min(1, 0.55 + 0.45 * tuning.charge), s = 1.12 - 0.12 * e;
          if ((!H.started && F.t > 2.8) || H.fade >= 0) H.fading = true;   // never answered (cast interrupted) / host asked

          if (H.fading) { H.fadeT += dt; const v = H.fadeT / 0.35; if (v >= 1) { H.F = null; return false; } a *= 1 - v; s *= 1 + 0.06 * v; }
          let sweep = 0;
          if (H.started) { const u = (kit.time - H.tStart) / H.lead; sweep = u < 1 ? 0.06 + 0.912 * smooth(u) : 0; }
          H.pulse *= Math.exp(-dt * 7);
          F.u.uP.value.set(0.055, 0.12 * H.pulse, 0, 0); F.u.uQ.value.x = 16; F.u.uQ.value.y = sweep;
          F.m.scale.setScalar(2 * radius * s); F.u.uAlpha.value = a;
        } });
      ev('mark', { radius });
      return H;
    };
    AV.rain = function (H, o) {
      o = o || {};
      const R = Object.assign({}, tuning.rain, o);
      if (!H || !H.F || !H.F.alive) H = AV.rainMark((H && (H.center || H.point)) || o.center, (H && (H.radius || H.R)) || o.radius || 2.6);
      H.started = true; H.tStart = kit.time; H.lead = R.lead;
      const k = AV.archer;
      _d.set(H.center.x - (k ? k.root.position.x : H.center.x), 0, H.center.z - (k ? k.root.position.z : H.center.z - 1));
      if (_d.lengthSq() < 1e-4) _d.set(0, 0, -1);
      const slant = new V3().copy(_d.normalize()).multiplyScalar(0.3).add(new V3(0, -1, 0)).normalize();   // one shared angle: a coordinated volley
      const flight = R.height / -slant.y / R.speed;
      const last = R.lead + (R.waves - 1) * R.interval;
      for (let w = 0; w < R.waves; w++) {
        const tLand = R.lead + w * R.interval;
        kit.later(Math.max(0, tLand - flight), () => rainVolley(H, w, R, slant, last - tLand + 0.9 * tuning.linger));
        kit.later(tLand, () => { H.pulse = 1; if (hooks.onRainWave) hooks.onRainWave(H.center, H.radius, w); ev('rainWave', { wave: w }); });
      }
      kit.later(last + 0.3, () => H.end());
      return H;
    };
    function rainVolley(H, w, R, slant, stickT) {
      const spots = [], c = H.center, rad = H.radius;
      const tg = hooks.targetsIn ? hooks.targetsIn(c, rad) : [];
      for (const t of tg) spots.push([t.pos.x + rs(0.1), t.pos.z + rs(0.1)]);
      const nFill = Math.max(2, kit.n(R.perWave) - Math.min(tg.length, 2)), rot = w * 2.39996;   // stratified by angle, golden-angle offset per wave
      for (let j = 0; j < nFill; j++) {
        const a = rot + (j + rand(0.15, 0.85)) / nFill * TAU, r = rad * Math.sqrt(rand(0.03, 0.9));
        spots.push([c.x + Math.cos(a) * r, c.z + Math.sin(a) * r]);
      }
      const len = R.height / -slant.y, flight = len / R.speed;
      for (const [x, z] of spots) {
        const start = new V3(x, 0, z).addScaledVector(slant, -len);
        spawnArrow('rain', start, slant.clone().multiplyScalar(R.speed), { stick: stickT, maxLife: flight + 0.25 });
        if (R.dots && kit.Q.extras) kit.emit(PR.gdisc, x, 0.03, z, 0, 0, 0, { life: flight * 0.95, s0: 0.1, s1: 0.3, c0: 0x1c150a, c1: 0x1c150a, a: 0.34, fin: 0.85, fpow: 2 });   // landing shadow: darkest just before the hit
      }
    }

    /* ---------------------------------------------- poison DoT ----------------------------------------------- */
    const statuses = [];
    AV.poison = function (anchor, dur) {
      let S = statuses.find((s) => s.anchor === anchor || (anchor.key && s.anchor.key === anchor.key));
      if (!S) { S = { anchor, t: 0, wT: 0, dT: 0 }; statuses.push(S); }
      S.t = dur;
    };
    AV.poisonTick = function (anchor) {                            // one DoT tick: bubbles pop off the body + a pulse at the feet
      const p = anchor.pos, h = anchor.height || 1.8, c = toCam(_m.set(p.x, h * 0.6, p.z), (anchor.radius || 0.4) + 0.1, new V3());
      for (let k = 0; k < kit.n(4); k++) kit.emit(PR.drop, c.x + rs(0.2), c.y + rs(0.25), c.z + rs(0.2), rs(0.7), rand(0.9, 1.8), rs(0.7), { scale: 0.95 });
      kit.emit(PR.dust, c.x, c.y, c.z, 0, 0.3, 0, { c0: 0x7a9a30, c1: 0x4a5e22, a: 0.4, s0: 0.35, s1: 0.95, life: 0.75 });
      kit.emit(PR.glint, c.x, c.y, c.z, 0, 0, 0, { life: 0.09, s0: 0.16, s1: 0.34, c0: 0xd8f08a, c1: C.pois1, a: 0.4, fpow: 1.5 });
      groundRing(p.x, p.z, 0.3, 0.8, 0.45, 0x5d8a22, 0.5, true);
    };
    function updateStatuses(dt) {
      for (let i = statuses.length - 1; i >= 0; i--) {
        const S = statuses[i], A = S.anchor;
        S.t -= dt;
        if (S.t <= 0 || (A.alive && !A.alive())) { statuses.splice(i, 1); continue; }
        const p = A.pos, h = A.height || 1.8, r = (A.radius || 0.4) + 0.08;
        const ca = Math.atan2(camera.position.z - p.z, camera.position.x - p.x);   // emit on the camera-facing half of the body
        S.wT += dt;                                                // dirty wisps curling off the body (the debuff stays readable)
        while (S.wT > 0.08) { S.wT -= 0.08; const a = ca + rs(1.5); kit.emit(PR.dust, p.x + Math.cos(a) * r, h * rand(0.3, 0.85), p.z + Math.sin(a) * r, Math.cos(a) * 0.15, rand(0.35, 0.6), Math.sin(a) * 0.15, { c0: 0x5f9420, c1: 0x34480f, a: 0.5, s0: 0.2, s1: 0.55, life: rand(0.7, 1), drag: 1 }); }
        S.bT = (S.bT || 0) + dt;                                   // small toxic bubbles popping on the skin (wet, not glowing)
        while (S.bT > 0.2) { S.bT -= 0.2; const a = ca + rs(1.2); kit.emit(PR.glint, p.x + Math.cos(a) * r, h * rand(0.35, 0.8), p.z + Math.sin(a) * r, 0, 0.3, 0, { life: rand(0.1, 0.16), s0: 0.05, s1: 0.11, c0: 0xd8f07a, c1: 0x9fc24a, a: 0.5, fpow: 1.3 }); }
        S.dT += dt;
        while (S.dT > 0.25) { S.dT -= 0.25; const a = ca + rs(1.3); kit.emit(PR.drop, p.x + Math.cos(a) * r, h * rand(0.45, 0.7), p.z + Math.sin(a) * r, rs(0.1), -0.2, rs(0.1), { scale: 0.85 }); }
      }
    }
    AV.statuses = statuses;

    /* ---------------------------------------------- eagle focus ---------------------------------------------- */
    AV.eagle = function (dur) {
      const k = AV.archer; dur = dur || 10;
      const wasOn = E.on;
      E.on = true; E.t = dur; E.dur = dur; E.endT = 0;
      const p = k ? k.root.position : new V3(), A = tuning.charge;
      const hy = 1.72;
      kit.emit(PR.flash, p.x, hy, p.z, 0, 0, 0, { s0: 0.15, s1: 0.5, life: 0.14, c0: 0xffffff, c1: C.gold, a: 0.85 * Math.min(1, A) });
      kit.emit(PR.ping, p.x, hy, p.z, 0, 0, 0, { s0: 0.1, s1: 0.6, c0: C.goldHi, c1: C.gold, a: 0.55, life: 0.2 });
      for (let i = 0; i < kit.n(10); i++) {                         // focus streaks: rise past the head, converging
        const a = i / 10 * TAU + rs(0.2), r = rand(0.42, 0.6);
        kit.emit(PR.wind, p.x + Math.cos(a) * r, rand(0.1, 0.5), p.z + Math.sin(a) * r, -Math.cos(a) * 0.8, rand(6, 8), -Math.sin(a) * 0.8, { life: rand(0.22, 0.3), s0: 0.03, s1: 0.015, c0: C.goldHi, c1: C.gold, a: 0.55 * Math.min(1, A), stretch: 0.05 });
      }
      for (let i = 0; i < kit.n(8); i++) { const a = Math.random() * TAU; kit.emit(PR.mote, p.x + Math.cos(a) * 0.4, rand(0.3, 1.6), p.z + Math.sin(a) * 0.4, -Math.sin(a) * 0.8, rand(0.6, 1.2), Math.cos(a) * 0.8, { a: 0.6 }); }
      groundRing(p.x, p.z, 0.3, 1.7, 0.42, C.goldDeep, 0.6 * Math.min(1, A), true);
      if (!E.F) E.F = kit.flat('reticle', { pos: p, radius: 0.95, color: 0xe8c46a, alpha: 0, order: 12, update: eagleReticle });   // normal blend: stays gold on any ground
      else E.F.t = 0;
      ev('buff', { id: 'eagle', on: true, refresh: wasOn });
    };
    AV.eagleEnd = function () { if (E.on) { E.on = false; E.endT = 0; ev('buff', { id: 'eagle', on: false }); } };
    AV.eagleActive = () => E.on;
    function eagleReticle(F, dt) {
      const k = AV.archer; if (k) F.m.position.set(k.root.position.x, 0.035, k.root.position.z);
      const e = 1 - Math.pow(1 - Math.min(1, F.t / 0.22), 3), A = Math.min(1.5, tuning.charge);
      let a, s;
      if (E.on) {
        const breathe = 0.34 + 0.06 * Math.sin(kit.time * 3.1);
        a = (F.t < 0.22 ? 0.85 * e : breathe + (0.85 - breathe) * Math.exp(-(F.t - 0.22) * 4)) * A;
        s = 1.45 - 0.45 * e;
        if (E.t < 1.5) a *= 0.6 + 0.4 * Math.abs(Math.sin(kit.time * 9));   // expiring: flicker
      } else {
        E.endT += dt; const v = E.endT / 0.3;
        if (v >= 1) { E.F = null; return false; }
        a = 0.3 * (1 - v) * A; s = 1 - 0.3 * v;
      }
      F.u.uQ.value.z += dt * 0.35; F.u.uP.value.w = 0.035;
      F.m.scale.setScalar(2 * 0.95 * s); F.u.uAlpha.value = a;
    }
    function updateEagle(dt) {
      if (!E.on) return;
      E.t -= dt;
      if (E.t <= 0) { AV.eagleEnd(); const k = AV.archer; if (k) groundRing(k.root.position.x, k.root.position.z, 0.9, 0.3, 0.3, C.goldDeep, 0.45, true); return; }
      const k = AV.archer; if (!k || !k._bow) return;
      E.moteT += dt;
      if (E.moteT > 0.3) {
        E.moteT -= 0.3;
        k._bow.group.localToWorld(_h.set(0, rs(0.5), 0));
        kit.emit(PR.mote, _h.x + rs(0.12), _h.y, _h.z + rs(0.12), rs(0.15), rand(0.4, 0.7), rs(0.15), { a: 0.45 * Math.min(1, tuning.charge), s0: 0.03, s1: 0.012 });
      }
    }

    /* ------------------------------------------- bow / body tracker ------------------------------------------ */
    const BT = { action: null, style: null, lit: false, pulsed: false, nocked: false, gT: 0, dT: 0, sT: 0, hopU: 0, guide: null, glow: null, glowA: 0 };
    function styleOf(a) {
      if (!a || !a.def.ranged) return null;
      if (a.name === 'volley') return 'volley';
      if (a.name === 'skyshot') return 'sky';
      switch (a.tag) { case 'pierce': return 'pierce'; case 'farrow': return 'fire'; case 'parrow': return 'poison'; case 'rapid': return 'rapid'; case 'volley': return 'volley'; case 'rain': return 'sky'; }
      return 'basic';
    }
    AV.styleOf = opts.styleOf || styleOf;
    AV.bindArcher = function (k) {
      AV.archer = k;
      if (!k || !k._bow) return;
      const Bw = k._bow;
      if (!Bw._vfxGlow) {                                          // bowstring glow: additive sleeves over the two string segments
        const g = new T.CylinderGeometry(1, 1, 1, 6, 1, true); g.translate(0, 0.5, 0);
        const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
        const a = new T.Mesh(g, mat), b = new T.Mesh(g, mat); a.visible = b.visible = false; a.renderOrder = b.renderOrder = 26;
        Bw.group.add(a, b); Bw._vfxGlow = { a, b, mat };
      }
      BT.glow = Bw._vfxGlow;
    };
    function guideStart(kind) {
      const mk = () => kit.beam({ p0: _m.set(0, 0, 0), p1: _n.set(0, 0, 0.01), flat: true, hold: true, width: kind === 'line' ? 0.05 : 0.035, color: kind === 'line' ? 0xcfeeff : C.goldHi, core: 0.6, fade: [0.25, 0.45], order: 13,
        update: (B) => ({ w: B.width, a: B.alpha }) });
      BT.guide = { kind, beams: kind === 'line' ? [mk()] : [mk(), mk(), mk()] };
    }
    function guideEnd(flash) {
      if (!BT.guide) return;
      for (const B of BT.guide.beams) if (B) { B.hold = false; B.t = 0; B.life = (flash ? 0.16 : 0.1) * kit.lifeMul; B.update = null; if (flash) B.alpha = Math.min(1, B.alpha * 2.2 + 0.1); }
      BT.guide = null;
    }
    function updateGuide(k, draw) {
      const G = BT.guide, yaw = k.root.rotation.y, p = k.root.position, line = G.kind === 'line';
      const len = line ? 0.8 + 8.5 * smooth(draw) : 0.6 + 2.8 * smooth(draw), off = 0.7;
      const alpha = (line ? 0.2 : 0.3) * Math.min(1.5, tuning.charge) * smooth((draw - 0.15) / 0.6);
      G.beams.forEach((B, i) => {
        if (!B) return;
        const ang = yaw + (line ? 0 : (i - 1) * tuning.volleySpread), sx = Math.sin(ang), sz = Math.cos(ang);
        B.p0.set(p.x + sx * off, 0.035, p.z + sz * off); B.p1.set(p.x + sx * (off + len), 0.035, p.z + sz * (off + len));
        B.alpha = alpha;
      });
    }
    function trackBow(dt) {
      const k = AV.archer; if (!k || !k._bow || !k.root.parent) return;
      const Bw = k._bow, a = k.action;
      if (a !== BT.action) {
        BT.action = a; BT.style = AV.styleOf(a); BT.lit = false; BT.pulsed = false; BT.hopU = 0;
        if (BT.guide) guideEnd(false);
      }
      const st = BT.style, D = st ? DRAW[st] : null, draw = Bw.draw, nocked = Bw.arrowN.visible, ch = tuning.charge;
      if (nocked && !BT.nocked && st) ev('nock', { style: st });
      BT.nocked = nocked;
      Bw.group.updateMatrixWorld(true);
      // bowstring glow
      let gs = 0, gc = D ? D.color : C.gold;
      if (D && nocked) gs = D.string * smooth((draw - 0.3) / 0.7) * (st === 'pierce' && draw > 0.95 ? 0.8 + 0.2 * Math.sin(kit.time * 34) : 1);
      if (E.on) { const eg = 0.14 + (D && nocked ? 0.22 * draw : 0); if (eg > gs || st === 'basic' || st === 'rapid') { gc = C.gold; gs = Math.max(gs, eg); } }
      gs *= ch;
      BT.glowA += (gs - BT.glowA) * (1 - Math.exp(-dt * 18));
      const G = BT.glow;
      if (G) {
        const vis = BT.glowA > 0.01;
        G.a.visible = G.b.visible = vis;
        if (vis) {
          G.mat.opacity = Math.min(1, BT.glowA); G.mat.color.setHex(gc);
          const r = 0.006 + 0.012 * Math.min(1, BT.glowA);
          for (const [g, s] of [[G.a, Bw.strT], [G.b, Bw.strB]]) { g.position.copy(s.position); g.quaternion.copy(s.quaternion); g.scale.set(r, s.scale.y, r); }
        }
      }
      // aim guides (volley fan / pierce line)
      if (D && D.guide && nocked) { if (!BT.guide) guideStart(D.guide); updateGuide(k, draw); }
      else if (BT.guide && !nocked) guideEnd(false);
      // arrowhead treatments
      if (D && nocked) {
        const hd = Bw.arrowN.localToWorld(_h.set(0, 0, 0.84));
        if (D.nock && draw > 0.55) {
          Bw.group.localToWorld(_m.copy(Bw.nock));
          kit.emit(PR.glint, _m.x, _m.y, _m.z, 0, 0, 0, { s0: 0.05 + 0.07 * draw, s1: 0.05, c0: gc, c1: gc, a: D.nock * ch * smooth((draw - 0.55) / 0.45) });
        }
        if (D.ignite) {                                            // fire: the head catches with a small whoomp, burns brighter with the draw
          if (!BT.lit) {
            BT.lit = true;
            kit.emit(PR.flash, hd.x, hd.y, hd.z, 0, 0, 0, { s0: 0.08, s1: 0.3 * Math.sqrt(ch || 1), life: 0.1, c1: 0xffa040, a: 0.85 * Math.min(1, ch) });
            for (let i = 0; i < kit.n(5); i++) kit.emit(PR.ember, hd.x, hd.y, hd.z, rs(1.6), rand(0.8, 2.2), rs(1.6), { life: rand(0.3, 0.5), scale: 0.7 });
            if (hooks.light && kit.Q.lights) hooks.light(hd, 0xff8a3a, 1.2);
          }
          BT.gT += dt;
          while (BT.gT > 0.018) {
            BT.gT -= 0.018;
            kit.emit(PR.flame, hd.x + rs(0.015), hd.y, hd.z + rs(0.015), rs(0.25), rand(0.5, 0.9), rs(0.25), { scale: (0.7 + 0.45 * draw) * Math.min(1.4, 0.5 + 0.5 * ch), life: rand(0.12, 0.2) });
            if (Math.random() < 0.4) kit.emit(PR.flameHot, hd.x, hd.y, hd.z, 0, 0.5, 0, { scale: 0.8 + 0.4 * draw });
            if (Math.random() < 0.12) kit.emit(PR.ember, hd.x, hd.y, hd.z, rs(0.5), rand(0.8, 1.6), rs(0.5), { life: 0.5, scale: 0.6 });
          }
        } else if (D.coat) {                                        // poison: dull wet glint + slow drips (no glow: dirty, not magical)
          kit.emit(PR.glint, hd.x, hd.y, hd.z, 0, 0, 0, { s0: 0.07, s1: 0.07, c0: 0xa8c850, c1: 0xa8c850, a: 0.22 * Math.min(1, ch) });
          BT.dT += dt;
          while (BT.dT > 0.12) { BT.dT -= 0.12; kit.emit(PR.drop, hd.x, hd.y - 0.015, hd.z, rs(0.05), -0.2, rs(0.05), { scale: 0.7 }); }
          BT.sT += dt;
          while (BT.sT > 0.16) { BT.sT -= 0.16; kit.emit(PR.dust, hd.x, hd.y, hd.z, rs(0.1), 0.2, rs(0.1), { c0: C.pois1, c1: 0x4a5e22, a: 0.16, s0: 0.05, s1: 0.16, life: 0.45 }); }
        } else if (D.gather) {                                      // pierce: cold motes converge on the head, glint grows, a pulse at full draw
          const cd = smooth(draw);
          kit.emit(PR.glint, hd.x, hd.y, hd.z, 0, 0, 0, { s0: (0.06 + 0.2 * cd), s1: 0.06 + 0.2 * cd, c0: 0xdff6ff, c1: 0xdff6ff, a: (0.3 + 0.5 * cd) * Math.min(1, ch) });
          BT.gT += dt;
          while (BT.gT > 0.022) {
            BT.gT -= 0.022;
            randUp(_w); _w.y -= 0.4; _w.normalize();
            const r = rand(0.45, 0.8), px = hd.x + _w.x * r, py = hd.y + _w.y * r, pz = hd.z + _w.z * r, T0 = 0.2;
            kit.emit(PR.spark, px, py, pz, (hd.x - px) / T0, (hd.y - py) / T0, (hd.z - pz) / T0, { life: T0, grav: 0, drag: 0, floor: -1000, stretch: 0.045, c0: 0xffffff, c1: 0xbfeaff, a: (0.35 + 0.5 * cd) * Math.min(1, ch), s0: 0.025, s1: 0.012 });
          }
          if (draw > 0.96 && !BT.pulsed) {
            BT.pulsed = true;
            kit.emit(PR.ping, hd.x, hd.y, hd.z, 0, 0, 0, { s0: 0.08, s1: 0.5, c0: 0xffffff, c1: 0xbfeaff, a: 0.6 * Math.min(1, ch), life: 0.18 });
          }
          if (draw > 0.5) {
            BT.dT += dt;
            const kp = k.root.position;
            while (BT.dT > 0.12) { BT.dT -= 0.12; const ang = Math.random() * TAU; kit.emit(PR.dust, kp.x + Math.cos(ang) * 0.35, 0.05, kp.z + Math.sin(ang) * 0.35, Math.cos(ang) * 0.9, 0.1, Math.sin(ang) * 0.9, { scale: 0.55, a: 0.16 }); }
          }
        }
      }
      if (a && a.name === 'hop') trackHop(a, k, dt);
    }
    function trackHop(a, k, dt) {
      const u = a.vt / a.def.dur, u0 = BT.hopU; BT.hopU = u;
      const p = k.root.position, yaw = k.root.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), I = tuning.impact;   // hops along -forward
      sideOf(_d.set(fx, 0, fz), _s);
      if (u0 < 0.15 && u >= 0.15) {                                // take-off: dust kicked forward by the push-off, dirt chips, scuff ring
        for (let i = 0; i < kit.n(7, I); i++) { const sp = rand(1.4, 3), sd = rs(1); kit.emit(PR.dust, p.x + fx * 0.15 + rs(0.15), 0.06, p.z + fz * 0.15 + rs(0.15), fx * sp + _s.x * sd, rand(0.3, 0.8), fz * sp + _s.z * sd, { scale: 1.15, a: 0.5 }); }
        for (let i = 0; i < kit.n(5, I); i++) kit.emit(PR.chip, p.x, 0.05, p.z, fx * rand(2, 4) + rs(1), rand(2, 3.4), fz * rand(2, 4) + rs(1), { c0: C.dirt, c1: 0x4a3a28, scale: 1.2 });
        groundRing(p.x, p.z, 0.15, 0.8, 0.32, 0xb8a888, 0.5, true);
        ev('hop', { phase: 'takeoff' });
      }
      if (u >= 0.15 && u <= 0.56 && tuning.trail > 0) {             // airborne: speed lines at the body edges, moving with the hero
        BT.sT += dt;
        while (BT.sT > 0.016) {
          BT.sT -= 0.016;
          const sd = Math.random() < 0.5 ? -1 : 1, off = rand(0.25, 0.42);
          kit.emit(PR.wind, p.x + _s.x * sd * off, rand(0.35, 1.65), p.z + _s.z * sd * off, -fx * 10, 0, -fz * 10, { life: rand(0.1, 0.14), stretch: 0.065, a: 0.55 * Math.min(1.4, tuning.trail), s0: 0.042, s1: 0.02 });
        }
      }
      if (u0 < 0.56 && u >= 0.56) {                                // landing: radial dust, a short skid back along the hop, scuff ring
        for (let i = 0; i < kit.n(10, I); i++) { const ang = i / 10 * TAU + rs(0.3), sp = rand(1.2, 2); kit.emit(PR.dust, p.x + Math.cos(ang) * 0.2, 0.05, p.z + Math.sin(ang) * 0.2, Math.cos(ang) * sp, rand(0.15, 0.4), Math.sin(ang) * sp, { scale: 1.0, a: 0.45, drag: 3.5 }); }
        for (let i = 0; i < kit.n(3, I); i++) kit.emit(PR.dust, p.x - fx * 0.3, 0.05, p.z - fz * 0.3, -fx * rand(2, 3) + rs(0.4), 0.2, -fz * rand(2, 3) + rs(0.4), { scale: 0.9, a: 0.4 });
        for (let i = 0; i < kit.n(3, I); i++) kit.emit(PR.chip, p.x, 0.05, p.z, rs(1.5) - fx, rand(1.4, 2.4), rs(1.5) - fz, { c0: C.dirt, c1: 0x4a3a28, scale: 1.2 });
        groundRing(p.x, p.z, 0.2, 1.0, 0.34, 0xb8a888, 0.48, true);
        shake(0.03);
        ev('hop', { phase: 'land' });
      }
      if (u0 < 0.7 && u >= 0.7 && k._bow) {                         // bow back up: a small readiness glint on the upper limb
        k._bow.tipT.getWorldPosition(_h);
        kit.emit(PR.flash, _h.x, _h.y, _h.z, 0, 0, 0, { s0: 0.05, s1: 0.16, life: 0.09, c1: 0xeef4ff, a: 0.5 * Math.min(1, tuning.charge) });
      }
    }

    /* ------------------------------------------------- frame ------------------------------------------------- */
    AV.update = function (dt) {
      if (ownKit) kit.begin(dt);
      kit.lifeMul = tuning.life;
      if (kit.quality !== tuning.quality) kit.setQuality(tuning.quality);
      trackBow(dt);
      updateProjectiles(dt);
      updateStatuses(dt);
      updateEagle(dt);
      for (const [g, G] of groups) if (kit.time - G.t > 1.5) groups.delete(g);
      if (ownKit) kit.end(dt);
    };
    AV.clear = function () {
      for (let i = AV.projectiles.length - 1; i >= 0; i--) despawn(AV.projectiles[i], i);
      statuses.length = 0; groups.clear();
      if (BT.guide) guideEnd(false);
      E.on = false; E.F = null;
      kit.clear();
    };
    AV.stats = function () { return Object.assign({ projectiles: AV.projectiles.filter((p) => p.stuck <= 0).length, stuck: AV.projectiles.filter((p) => p.stuck > 0).length, pool: pool.length, statuses: statuses.length }, kit.stats()); };
    return AV;
  }

  global.ArcherVFX = { create, STYLES, DRAW, TUNING, COLORS: C };
})(window);
