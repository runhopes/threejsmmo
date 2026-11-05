/* =====================================================================================================
 *  vfx/progress.js  -  ProgressFX: Atherion's EXP orb (exp_orb.gd) and level-up effect (level_up_effect.gd), procedural
 *                      (three.js r128, no texture files; spec: vfx/impact-spec.md)
 *
 *    const pg = ProgressFX.create({ scene, camera, light(pos, hex, k) })
 *    pg.orb(from, target, amount, onAbsorb, delay)   a mob died: one orb carries the WHOLE kill reward. from = corpse feet {x,y,z};
 *                                             target = { pos(out) -> feet Vector3 }; onAbsorb(amount) credits it (offline
 *                                             Atherion: the orb is the EXP authority). Over the live cap the reward is credited
 *                                             at once (ExpOrb.spawn fallback) - nothing is ever lost.
 *    pg.flush()                               absorb every live orb now (scene change / class switch)
 *    pg.levelUp(root)                         column + rim + pulse around root (x/z followed), 1.5 s hold, 1.0 s fade
 *    pg.update(dt)
 *
 *  Atherion world units -> metres by the hero height (26.1 u body = 1.95 m), the same mapping as ui/feedback.js.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE;
  const PI = Math.PI, TAU = PI * 2;
  const U = 1.95 / 26.1;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const moveToward = (a, b, d) => (Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d);

  /* ------------------------------------------------ exp_orb.gd ------------------------------------------------ */
  const ORB = {
    BIRTH: 0.38, LIFT_MIN: 1.05, LIFT_MAX: 1.45, ARC: 0.42, SCATTER_MIN: 0.35, SCATTER_MAX: 0.95, SIDE: 0.18, BIRTH_Y: 0.85,
    TARGET_H: 1.45, SWIRL: 0.62, SWIRL_R_END: 1.08, SWIRL_BOB: 0.38,
    FLY_START: 12, FLY_MAX: 120, FLY_ACCEL: 180, FLY_DIST_K: 6, FLY_TGT_K: 1.15, TURN: 13,
    SWAY_AMP: 0.72, SWAY_FREQ: 2.15, SWAY_FADE_D: 4.5, SWAY_SPEED_FADE: 42,
    ABSORB_D: 0.72, ABSORB_TIMEOUT: 1.35, SNAP_D: 28,
    TRAIL_MAX: 32, TRAIL_MIN_D: 0.08, TRAIL_W: 0.28, TRAIL_CORE_W: 0.085,
    LIVE_CAP: 16,
  };
  // Atherion's orb numbers predate its 14x world rescale: at the hero-height mapping (U) the orb was ~2 cm and flew at ankle
  // height (invisible from the game camera). Motion is scaled x8 (chest-high target, visible hop and swirl), the orb x3.5
  // (~16 cm glowing core, ~0.5 m aura); timings are unchanged.
  const UO = U * 8, UG = U * 3.5;
  const FRES_VS = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
  const SHELL_FS = 'uniform float uTime; varying vec3 vN; varying vec3 vV; void main(){ float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);' +
    ' float fresnel = pow(1.0 - facing, 2.55); float pulse = 0.94 + sin(uTime * 5.2) * 0.06; vec3 color = mix(vec3(1.0, 0.78, 0.22), vec3(0.32, 0.95, 1.0), fresnel * 0.62);' +
    ' gl_FragColor = vec4(color * (0.18 + fresnel * 0.68) * pulse, 1.0); }';
  const AURA_FS = 'uniform float uTime; varying vec3 vN; varying vec3 vV; void main(){ float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);' +
    ' float fresnel = pow(1.0 - facing, 3.1); float breathe = 0.78 + sin(uTime * 3.4) * 0.10; vec3 color = mix(vec3(1.0, 0.82, 0.28), vec3(0.26, 0.92, 1.0), fresnel);' +
    ' gl_FragColor = vec4(color * fresnel * 0.48 * breathe, 1.0); }';
  const UV_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const FLARE_FS = 'varying vec2 vUv; void main(){ vec2 c = vUv * 2.0 - 1.0; float d = length(c); float glow = pow(1.0 - smoothstep(0.0, 1.0, d), 2.2);' +
    ' float core = pow(1.0 - smoothstep(0.0, 0.34, d), 2.0); vec3 color = mix(vec3(0.26, 0.92, 1.0), vec3(1.0, 0.86, 0.28), core);' +
    ' gl_FragColor = vec4(color * (glow * 0.48 + core * 0.42), 1.0); }';
  const RING_FS = 'uniform float uTime; varying vec2 vUv; void main(){ float thread = 0.72 + sin((vUv.x + uTime * 0.22) * 18.849) * 0.28;' +
    ' vec3 color = mix(vec3(0.48, 1.0, 0.95), vec3(1.0, 0.86, 0.34), smoothstep(0.2, 1.0, vUv.x)); gl_FragColor = vec4(color * 0.30 * thread, 1.0); }';
  const TRAIL_FS = 'uniform float uCore; varying vec2 vUv; void main(){ float u = vUv.x; float v = abs(vUv.y - 0.5) * 2.0; vec3 c; float a;' +
    ' if (uCore > 0.5) { float tail = smoothstep(0.0, 0.20, u); float head = 1.0 - smoothstep(0.985, 1.0, u) * 0.35; float center = exp(-v * v * 14.0);' +
    '   c = mix(vec3(0.72, 1.0, 0.96), vec3(1.0, 0.94, 0.54), smoothstep(0.15, 1.0, u)); a = tail * head * center * 0.46; }' +
    ' else { float tail = smoothstep(0.0, 0.18, u); float head = 1.0 - smoothstep(0.985, 1.0, u) * 0.45; float silk = pow(1.0 - smoothstep(0.12, 1.0, v), 1.55);' +
    '   float thread = exp(-v * v * 6.5); c = mix(vec3(0.18, 0.82, 1.0), vec3(1.0, 0.78, 0.24), smoothstep(0.1, 1.0, u)); a = tail * head * (silk * 0.23 + thread * 0.12); }' +
    ' gl_FragColor = vec4(c * a, 1.0); }';
  const addMat = (vs, fs, uniforms, side) => new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: uniforms || {}, transparent: true, depthWrite: false,
    blending: T.AdditiveBlending, side: side || T.FrontSide });

  /* ------------------------------------------------ level_up_effect.gd ------------------------------------------------ */
  // three BinbunVFX magic areas (lift / rim / pulse) at LIFT (7, 11.2, 7) / RIM 10 / PULSE 10; main loop at alpha 1 for HOLD 1.5 s,
  // then alpha_multiplier 1 -> 0 over FADE 1.0 s; one light (energy 3). Palette primary (1, .918, .8), secondary (1, .906, 0).
  const LVL = { HOLD: 1.5, FADE: 1.0, LIFT: [7, 11.2, 7], RIM: 10, PULSE: 10, LIGHT: 0xffc35a };   // warm HUD amber instead of the vendor's acid yellow (#FFE700)
  const AREA_VS = 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  // the vendor masks are noise / gradient textures scrolled by TIME; here the same layers are built from value noise.
  // mode: 0 lift column, 1 lift ground, 2 rim ground ring, 3 rim glow, 4 rim extra glow, 5 rim upward band, 6 pulse rings, 7 lift upward bands
  const AREA_FS = [
    'uniform float uTime; uniform float uAlpha; uniform float uMode; uniform vec4 uP; varying vec2 vUv; varying vec3 vP;',
    'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
    // wrapped noise around a cylinder: x in [0,1) periodic with `per` cells
    'float vnw(vec2 p, float per){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float i1 = mod(i.x + 1.0, per); float i0 = mod(i.x, per);',
    '  return mix(mix(h21(vec2(i0, i.y)), h21(vec2(i1, i.y)), f.x), mix(h21(vec2(i0, i.y + 1.0)), h21(vec2(i1, i.y + 1.0)), f.x), f.y); }',
    'float band(float x, float a, float b, float c){ return x <= a ? 0.0 : x < b ? (x - a) / (b - a) : x < c ? 1.0 - (x - b) / (c - b) : 0.0; }',
    'void main(){',
    '  float m = 0.0; vec2 c = vUv - 0.5; float r = length(c) * 2.0; float ang = atan(c.x, c.y) / 6.2831853;',
    '  if (uMode < 0.5) {',                                     // lift: streak noise rising (scroll .15-.4/s), faded to the top
    '    float per = uP.x; float n = vnw(vec2(vUv.x * per, vUv.y * uP.y - uTime * uP.z), per);',
    '    float n2 = vnw(vec2(vUv.x * per * 2.0 + 3.0, vUv.y * uP.y * 0.5 - uTime * uP.z * 0.6), per * 2.0);',
    '    m = smoothstep(0.42, 0.9, n * 0.7 + n2 * 0.5) * pow(1.0 - vUv.y, uP.w) * smoothstep(0.0, 0.05, vUv.y) * 0.95;',
    '  } else if (uMode < 1.5) {',                              // lift ground: soft disc with a slow radial shimmer
    '    float n = vn(vec2(ang * 16.0, r * 3.0 - uTime * 0.1));',
    '    m = pow(max(0.0, 1.0 - r), 2.2) * (0.8 + 0.3 * n) * 0.5;',
    '  } else if (uMode < 2.5) {',                              // rim ground: ring at .85 r with drifting angular noise
    '    float n = vn(vec2(ang * 24.0 + uTime * 0.05 * 24.0, r * 4.0 - uTime * 0.05));',
    '    m = band(r, 0.42, 0.85, 1.0) * (0.45 + 0.55 * n) * 0.8;',
    '  } else if (uMode < 3.5) {',                              // rim glow (.48 peak, 68 %)
    '    float n = vn(vec2(ang * 10.0 - uTime * 0.01 * 10.0, r * 2.0 - uTime * 0.05));',
    '    m = band(r, 0.0, 0.48, 1.0) * 0.68 * (0.4 + 0.6 * n) * 0.6;',
    '  } else if (uMode < 4.5) {',                              // rim extra glow (.52 peak, 75 %)
    '    m = band(r, 0.42, 0.52, 0.68) * 0.75;',
    '  } else if (uMode < 5.5) {',                              // rim upward: gradient fade with noise scrolling up (.1/s)
    '    float n = vnw(vec2(vUv.x * 12.0, vUv.y * 2.0 - uTime * 0.1), 12.0);',
    '    m = clamp(1.0 - vUv.y / 0.656, 0.0, 1.0) * (0.5 + 0.5 * n);',
    '  } else if (uMode < 6.5) {',                              // pulse: fine rings (uP.x per radius) crawling, noise, annulus window
    '    float rr = r * 0.5 * uP.x - uTime * -1.0; float saw = fract(rr); float ring = band(saw, 0.0, 0.244681, 1.0);',
    '    float n = vn(vUv * 6.0 * uP.y);',
    '    m = ring * mix(1.0, n * 1.6, 0.5) * band(r, 0.0, 0.520833, 1.0);',
    '  } else {',                                               // lift upward: gradient bands (x4) rising .4/s, faded to the top
    '    float b = band(fract(vUv.y * uP.y - uTime * uP.z), 0.0, 0.771277, 1.0);',
    '    m = b * b * pow(1.0 - vUv.y, uP.w) * smoothstep(0.0, 0.05, vUv.y) * 0.8;',
    '  }',
    '  vec3 col = mix(vec3(1.0, 0.70, 0.26), vec3(1.0, 0.93, 0.78), smoothstep(0.35, 0.95, m));',
    '  float a = clamp(min(m, 0.977) * uAlpha, 0.0, 1.0); if (a < 0.003) discard;',
    '  gl_FragColor = vec4(min(col * 1.1, vec3(1.0)), a);',
    '}'].join('\n');

  function create(opts) {
    const scene = opts.scene, camera = opts.camera, light = opts.light || null;
    let time = 0;
    const camP = new T.Vector3();

    /* ---------------- orbs (pooled, LIVE_CAP 16) ---------------- */
    const shared = {
      core: new T.MeshBasicMaterial({ color: new T.Color(1.0, 0.93, 0.56) }),
      shell: addMat(FRES_VS, SHELL_FS, { uTime: { value: 0 } }),
      aura: addMat(FRES_VS, AURA_FS, { uTime: { value: 0 } }, T.DoubleSide),
      flare: addMat(UV_VS, FLARE_FS, {}, T.DoubleSide),
      ring: addMat(UV_VS, RING_FS, { uTime: { value: 0 } }, T.DoubleSide),
      trail: addMat(UV_VS, TRAIL_FS, { uCore: { value: 0 } }, T.DoubleSide),
      trailCore: addMat(UV_VS, TRAIL_FS, { uCore: { value: 1 } }, T.DoubleSide),
    };
    const g = {
      core: new T.SphereGeometry(0.30 * UG, 24, 12), shell: new T.SphereGeometry(0.58 * UG, 32, 16), aura: new T.SphereGeometry(0.98 * UG, 32, 16),
      flare: new T.PlaneGeometry(1.45 * UG, 1.45 * UG),
      ringA: new T.TorusGeometry((0.67 + 0.715) * 0.5 * UG, (0.715 - 0.67) * 0.5 * UG, 8, 42), ringB: new T.TorusGeometry((0.43 + 0.465) * 0.5 * UG, (0.465 - 0.43) * 0.5 * UG, 8, 42),
    };
    // Godot TorusMesh lies in XZ; three's Torus lies in XY -> pre-rotate
    g.ringA.rotateX(PI / 2); g.ringB.rotateX(PI / 2);
    function trailMesh(mat) {
      const geo = new T.BufferGeometry();
      const pos = new Float32Array(ORB.TRAIL_MAX * 2 * 3), uv = new Float32Array(ORB.TRAIL_MAX * 2 * 2), idx = [];
      for (let i = 0; i < ORB.TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2).setUsage(T.DynamicDrawUsage));
      const m = new T.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 34; m.visible = false; scene.add(m);
      return m;
    }
    const pool = [], live = [];
    function makeOrb() {
      const root = new T.Group(), vis = new T.Group(); root.add(vis);
      const core = new T.Mesh(g.core, shared.core), shell = new T.Mesh(g.shell, shared.shell), aura = new T.Mesh(g.aura, shared.aura), flare = new T.Mesh(g.flare, shared.flare);
      const ringA = new T.Mesh(g.ringA, shared.ring), ringB = new T.Mesh(g.ringB, shared.ring);
      for (const m of [core, shell, aura, flare, ringA, ringB]) { m.renderOrder = 35; vis.add(m); }
      ringA.rotation.set(64 * PI / 180, 0, 18 * PI / 180); ringB.rotation.set(-22 * PI / 180, 38 * PI / 180, 72 * PI / 180);
      root.visible = false; scene.add(root);
      return { root, vis, core, shell, aura, flare, ringA, ringB, trail: trailMesh(shared.trail), trailCore: trailMesh(shared.trailCore), pts: [], vel: new T.Vector3(), tp: new T.Vector3(), last: new T.Vector3(), start: new T.Vector3(), peak: new T.Vector3(), side: new T.Vector3() };
    }
    for (let i = 0; i < ORB.LIVE_CAP; i++) pool.push(makeOrb());
    const _tp = new T.Vector3(), _d = new T.Vector3();

    function targetPos(O, out) { O.target.pos(out); out.y += ORB.TARGET_H * UO; return out; }
    const pending = [];                                    // death_reward_delay: the orb leaves the corpse .3 s after the death
    function orb(from, target, amount, onAbsorb, delay) {
      if (delay > 0) { pending.push({ t: delay, from: { x: from.x, y: from.y || 0, z: from.z }, target, amount, onAbsorb }); return true; }
      if (live.length >= ORB.LIVE_CAP || !pool.length) { if (onAbsorb) onAbsorb(amount); return false; }   // live cap: credit at once
      const O = pool.pop();
      O.target = target; O.amount = amount; O.cb = onAbsorb; O.phase = 0; O.timer = 0; O.life = 0; O.fly = ORB.FLY_START; O.vel.set(0, 0, 0); O.hasLast = false;
      O.root.position.set(from.x, (from.y || 0) + ORB.BIRTH_Y * UO, from.z);
      O.start.copy(O.root.position);
      const a = Math.random() * TAU, d = rand(ORB.SCATTER_MIN, ORB.SCATTER_MAX) * UO;
      O.peak.set(O.start.x + Math.cos(a) * d, O.start.y + rand(ORB.LIFT_MIN, ORB.LIFT_MAX) * UO, O.start.z + Math.sin(a) * d);
      O.side.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(rand(-ORB.SIDE, ORB.SIDE) * UO);
      O.pts.length = 0; O.pts.push(O.root.position.clone());
      O.root.visible = true; O.trail.visible = O.trailCore.visible = true;
      live.push(O);
      return true;
    }
    function absorb(O) {
      const i = live.indexOf(O); if (i >= 0) live.splice(i, 1);
      O.root.visible = false; O.trail.visible = O.trailCore.visible = false;
      pool.push(O);
      const cb = O.cb; O.cb = null; O.target = null;
      if (cb) cb(O.amount);
    }
    function flush() { for (const P of pending.splice(0)) if (P.onAbsorb) P.onAbsorb(P.amount); for (const O of live.slice()) absorb(O); }
    function stepOrb(O, dt) {
      O.life += dt; O.timer += dt;
      const p = O.root.position;
      if (O.phase === 0) {                                   // BIRTH: eased arc to a scattered peak
        const t = Math.min(O.timer / ORB.BIRTH, 1), e = 1 - Math.pow(1 - t, 3), arc = Math.sin(t * PI);
        p.lerpVectors(O.start, O.peak, e); p.y += arc * ORB.ARC * UO; p.addScaledVector(O.side, arc);
        if (t >= 1) {
          O.phase = 1; O.timer = 0; O.sw0 = p.clone(); targetPos(O, _tp);
          let ox = p.x - _tp.x, oz = p.z - _tp.z; if (ox * ox + oz * oz < 0.01 * UO * UO) { ox = 1; oz = 0; }
          O.swA = Math.atan2(oz, ox); O.swR = Math.max(Math.hypot(ox, oz), (ORB.SWIRL_R_END + 0.1) * UO); O.swD = Math.random() >= 0.5 ? 1 : -1; O.vel.set(0, 0, 0);
        }
      } else if (O.phase === 1) {                            // SWIRL: half a turn around the target, radius shrinking
        const t = Math.min(O.timer / ORB.SWIRL, 1), e = 0.5 - Math.cos(t * PI) * 0.5;
        targetPos(O, _tp);
        const ang = O.swA + O.swD * PI * e, rad = O.swR + (ORB.SWIRL_R_END * UO - O.swR) * e;
        p.set(_tp.x + Math.cos(ang) * rad, O.sw0.y + (_tp.y - O.sw0.y) * e + Math.sin(t * PI) * ORB.SWIRL_BOB * UO, _tp.z + Math.sin(ang) * rad);
        if (t >= 1) {
          O.phase = 2; O.timer = 0; O.fly = ORB.FLY_START; O.last.copy(_tp); O.hasLast = true;
          _d.subVectors(_tp, p); if (_d.lengthSq() > 1e-6 * UO * UO) O.vel.copy(_d.normalize()).multiplyScalar(O.fly * UO);
        }
      } else {                                               // ABSORB: homing flight (all speeds in Atherion u/s)
        targetPos(O, _tp);
        _d.subVectors(_tp, p); const dist = _d.length() / UO;
        if (dist <= ORB.ABSORB_D) { absorb(O); return; }
        if (O.timer >= ORB.ABSORB_TIMEOUT || dist >= ORB.SNAP_D) { p.copy(_tp); absorb(O); return; }
        let ts = 0;
        if (O.target.speed) ts = O.target.speed() / UO;
        if (O.hasLast && dt > 0) ts = Math.max(ts, Math.hypot(_tp.x - O.last.x, _tp.z - O.last.z) / UO / dt);
        O.last.copy(_tp); O.hasLast = true;
        _d.divideScalar(dist * UO);                           // unit direction
        let sx = -_d.z, sz = _d.x; const sl = Math.hypot(sx, sz);
        if (sl > 0.001) {
          sx /= sl; sz /= sl;
          const sway = Math.sin(O.timer * ORB.SWAY_FREQ * TAU) * ORB.SWAY_AMP * clamp01(dist / ORB.SWAY_FADE_D) * (1 - clamp01(ts / ORB.SWAY_SPEED_FADE));
          _d.x += sx * sway; _d.z += sz * sway; _d.normalize();
        }
        const want = Math.min(ORB.FLY_MAX, Math.max(ORB.FLY_START, ORB.FLY_START + dist * ORB.FLY_DIST_K + ts * ORB.FLY_TGT_K));
        O.fly = moveToward(O.fly, want, ORB.FLY_ACCEL * dt);
        const k = clamp01(ORB.TURN * dt);
        O.vel.lerp(_d.multiplyScalar(O.fly * UO), k);
        const step = O.vel.length() * dt;
        if (step >= dist * UO) { p.copy(_tp); absorb(O); return; }
        p.addScaledVector(O.vel, dt);
      }
    }
    function orbVisuals(O, dt) {
      const pulse = 1 + Math.sin(O.life * 5.6) * 0.035 + Math.sin(O.life * 11) * 0.012, charge = clamp01(O.vel.length() / UO / ORB.FLY_MAX) * 0.08;
      O.vis.scale.setScalar(pulse + charge);
      O.core.rotation.y += dt * 1.7; O.shell.rotation.y -= dt * 0.55; O.aura.rotation.y += dt * 0.38;
      O.flare.quaternion.copy(camera.quaternion);
      O.ringA.rotation.x = 64 * PI / 180 + Math.sin(O.life * 1.7) * 0.07; O.ringA.rotation.y += dt * 2.35;
      O.ringB.rotation.y -= dt * 2.9; O.ringB.rotation.z = 72 * PI / 180 + Math.cos(O.life * 1.45) * 0.08;
      // trail: points every .08 u, at most 32, rebuilt as camera-facing ribbons (RibbonTrail.rebuild)
      const P = O.pts, pos = O.root.position, last = P[P.length - 1];
      if (last.distanceTo(pos) >= ORB.TRAIL_MIN_D * UO) P.push(pos.clone()); else last.copy(pos);
      while (P.length > ORB.TRAIL_MAX) P.shift();
      ribbon(O.trail, P, ORB.TRAIL_W * UG); ribbon(O.trailCore, P, ORB.TRAIL_CORE_W * UG);
    }
    const _rt = new T.Vector3(), _rv = new T.Vector3(), _rs = new T.Vector3();
    function ribbon(mesh, P, w) {
      const geo = mesh.geometry, pa = geo.attributes.position, ua = geo.attributes.uv, n = P.length;
      if (n < 2) { geo.setDrawRange(0, 0); return; }
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        _rt.subVectors(b, a); _rv.subVectors(camP, P[i]); _rs.crossVectors(_rt, _rv);
        if (_rs.lengthSq() < 1e-12) _rs.set(0, 1, 0); _rs.normalize().multiplyScalar(w * 0.5);
        pa.setXYZ(i * 2, P[i].x - _rs.x, P[i].y - _rs.y, P[i].z - _rs.z); pa.setXYZ(i * 2 + 1, P[i].x + _rs.x, P[i].y + _rs.y, P[i].z + _rs.z);
        const u = i / (n - 1); ua.setXY(i * 2, u, 0); ua.setXY(i * 2 + 1, u, 1);
      }
      pa.needsUpdate = true; ua.needsUpdate = true; geo.setDrawRange(0, (n - 1) * 6);
    }

    /* ---------------- level-up (one effect at a time; a new one replaces the old, like PlayerController) ---------------- */
    const areaGeo = (kind, a, b, h) => {
      const geo = kind === 'cyl' ? new T.CylinderGeometry(a, b, h, 40, 1, true) : new T.PlaneGeometry(a, a);
      if (kind !== 'cyl') geo.rotateX(-PI / 2);
      return geo;
    };
    function area(geo, mode, P, y, sx, sy, order) {
      const mat = new T.ShaderMaterial({ vertexShader: AREA_VS, fragmentShader: AREA_FS, transparent: true, depthWrite: false, side: T.DoubleSide,
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uMode: { value: mode }, uP: { value: new T.Vector4(P[0], P[1], P[2], P[3]) } } });
      const m = new T.Mesh(geo, mat); m.position.y = y; m.scale.set(sx, sy, sx); m.renderOrder = order || 20;
      return m;
    }
    const L = { root: new T.Group(), parts: [], t: -1, target: null };
    L.root.visible = false; scene.add(L.root);
    (function buildLevelUp() {
      const ls = LVL.LIFT.map((v) => v * U), rs = LVL.RIM * U, ps = LVL.PULSE * U;
      // lift_area_vfx_01: Lift_01 (r 1.3 -> 1.4, h 3, y 1.5), Lift_02 (r 1.2, h 4, y 2), Upward (r 1.3, h 3, y 1.5), Ground plane 3.7
      L.parts.push(area(areaGeo('cyl', 1.4, 1.3, 3), 0, [24, 6, 0.15, 1.6], 1.5 * ls[1], ls[0], ls[1], 22));
      L.parts.push(area(areaGeo('cyl', 1.2, 1.2, 4), 0, [24, 9, 0.4, 1.2], 2.0 * ls[1], ls[0], ls[1], 23));
      L.parts.push(area(areaGeo('cyl', 1.3, 1.3, 3), 7, [1, 4, 0.4, 2.2], 1.5 * ls[1], ls[0], ls[1], 24));
      L.parts.push(area(areaGeo('quad', 3.7), 1, [0, 0, 0, 0], 0.01 * ls[1], ls[0], 1, 18));
      // rim_area_vfx_01: Ground 3.4, Glow 6, ExtraGlow 5, Upward_01 (r 1.3-1.4, h 1.4, y .7), Upward_02 (r 1.25-1.3, h 1.8, y .9)
      L.parts.push(area(areaGeo('quad', 3.4), 2, [0, 0, 0, 0], 0.012 * rs, rs, 1, 19));
      L.parts.push(area(areaGeo('quad', 6), 3, [0, 0, 0, 0], 0.014 * rs, rs, 1, 18));
      L.parts.push(area(areaGeo('quad', 5), 4, [0, 0, 0, 0], 0.016 * rs, rs, 1, 19));
      L.parts.push(area(areaGeo('cyl', 1.4, 1.3, 1.4), 5, [0, 0, 0, 0], 0.7 * rs, rs, rs, 21));
      L.parts.push(area(areaGeo('cyl', 1.3, 1.25, 1.8), 5, [0, 0, 0, 0], 0.9 * rs, rs, rs, 21));
      // pulse_area_vfx_01: Ripple_01 (radial x12, scroll -1), Ripple_02 (radial x8, noise x2), quads 4.5
      L.parts.push(area(areaGeo('quad', 4.5), 6, [12, 1, 0, 0], 0.018 * ps, ps, 1, 19));
      L.parts.push(area(areaGeo('quad', 4.5), 6, [8, 2, 0, 0], 0.02 * ps, ps, 1, 19));
      for (const m of L.parts) L.root.add(m);
    })();
    function levelUp(root) {
      L.target = root; L.t = 0; L.root.visible = true;
      L.root.position.set(root.position.x, root.position.y, root.position.z);
    }
    function stepLevelUp(dt) {
      if (L.t < 0) return;
      L.t += dt;
      const a = L.t < LVL.HOLD ? 1 : 1 - (L.t - LVL.HOLD) / LVL.FADE;
      if (a <= 0) { L.t = -1; L.root.visible = false; L.target = null; return; }
      if (L.target) { L.root.position.x = L.target.position.x; L.root.position.z = L.target.position.z; }
      for (const m of L.parts) { m.material.uniforms.uAlpha.value = a; m.material.uniforms.uTime.value = L.t; }
      if (light) light(L.root.position, LVL.LIGHT, 2.2 * a);
    }

    function update(dt) {
      time += dt;
      camera.updateMatrixWorld(); camP.setFromMatrixPosition(camera.matrixWorld);
      for (let i = pending.length - 1; i >= 0; i--) { const P = pending[i]; P.t -= dt; if (P.t <= 0) { pending.splice(i, 1); orb(P.from, P.target, P.amount, P.onAbsorb, 0); } }
      shared.shell.uniforms.uTime.value = time; shared.aura.uniforms.uTime.value = time; shared.ring.uniforms.uTime.value = time;
      for (let i = live.length - 1; i >= 0; i--) {
        const O = live[i];
        if (!O.target) { absorb(O); continue; }
        stepOrb(O, dt);
        if (live.indexOf(O) >= 0) orbVisuals(O, dt);
      }
      stepLevelUp(dt);
    }

    // VFXWarmup: compile the orb / trail / level-up programs at load (one pooled orb + the level-up parts shown for one compile)
    function warm(renderer) {
      const O = pool[pool.length - 1], vis = [O.root.visible, O.trail.visible, O.trailCore.visible, L.root.visible];
      O.root.visible = O.trail.visible = O.trailCore.visible = L.root.visible = true;
      renderer.compile(scene, camera);
      [O.root.visible, O.trail.visible, O.trailCore.visible, L.root.visible] = vis;
    }
    return { orb, flush, levelUp, update, warm, UNIT: U, get liveOrbs() { return live; }, get levelUpOn() { return L.t >= 0; }, stats() { return { orbs: live.length, levelUp: L.t }; } };
  }

  global.ProgressFX = { create, UNIT: U };
})(window);
