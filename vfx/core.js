/* =====================================================================================================
 *  vfx/core.js  -  VFXKit: pooled, batched building blocks for combat effects (three.js r128, no texture files)
 *
 *    const kit = VFXKit.create({ scene, camera, quality: 'high' })
 *    kit.emit(preset, x, y, z, vx, vy, vz, over)   one particle. Presets pick one of four instanced batches:
 *                                                   'add' / 'norm' (camera-facing) and 'gadd' / 'gnorm' (lying on
 *                                                   the ground). Sparks stretch along their velocity on screen.
 *    kit.trail(style)  -> Trail                     camera-facing ribbon, time-based length (batched per blend)
 *    kit.flat(mode, o) -> Flat                      procedural quad: ring, disc, scorch, splat, reticle, telegraph
 *    kit.beam(o)       -> Beam                      axial billboard (or ground-flat) line: tracers, streaks, aim lines
 *    kit.later(t, fn)                               callback on the effect clock
 *    kit.n(count, mul)                              count scaled by quality density (stochastic rounding)
 *    kit.update(dt)                                 once per frame, after everything for this frame was emitted
 *
 *  Draw calls: 4 particle batches + 2 trail batches + live flats / beams (pooled, a few at a time).
 *  Nothing allocates GPU memory after create(): every pool is pre-sized; when a pool is full the request is dropped.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = THREE;
  const TAU = Math.PI * 2;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ------------------------------------------------ atlas ------------------------------------------------------
     2x2 alpha shapes (RGB stays white; colour comes from the particle, "hot" cores are derived from alpha^3):
     0 glow (soft radial)   1 spark (tight hot dot, becomes a streak when stretched)
     2 puff (lumpy soft blob, dust / smoke / mist)   3 ring (thin soft ring, hit pings) */
  const SHAPE = { glow: 0, spark: 1, puff: 2, ring: 3 };
  function makeAtlas() {
    const S = 256, H = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const radial = (cx, cy, r, stops) => {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (const [o, a] of stops) gr.addColorStop(o, 'rgba(255,255,255,' + a + ')');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    };
    radial(64, 64, 58, [[0, 1], [0.16, 0.85], [0.42, 0.32], [0.7, 0.08], [1, 0]]);                   // glow
    radial(H + 64, 64, 58, [[0, 1], [0.1, 0.95], [0.24, 0.45], [0.5, 0.1], [1, 0]]);                  // spark
    let seed = 11; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    radial(64, H + 64, 46, [[0, 0.55], [0.6, 0.3], [1, 0]]);                                          // puff: lumpy blob
    for (let i = 0; i < 9; i++) {
      const a = R() * TAU, d = 8 + R() * 18, r = 18 + R() * 16;
      radial(64 + Math.cos(a) * d, H + 64 + Math.sin(a) * d, r, [[0, 0.32], [0.55, 0.16], [1, 0]]);
    }
    g.lineWidth = 9; g.strokeStyle = 'rgba(255,255,255,1)'; g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = 7;   // ring
    g.beginPath(); g.arc(H + 64, H + 64, 46, 0, TAU); g.stroke();
    const t = new T.CanvasTexture(c);
    t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter;
    return t;
  }

  /* -------------------------------------------- particle batch ---------------------------------------------------
     Instanced quads. CPU state in typed arrays (packed: live particles are [0, n), killing swaps in the last one).
     Per instance: iA = pos.xyz + size, iB = vel.xyz + stretch (s), iC = rgba, iD = rotation, shape, hot. */
  const PVERT_BB = [
    'attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD;',
    'varying vec2 vUv; varying vec4 vC; varying float vHot;',
    'void main(){',
    '  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);',
    '  float size = iA.w, len = iA.w;',
    '  vec2 ax = vec2(cos(iD.x), sin(iD.x));',
    '  if (iB.w > 0.0) {',                                     // stretch: quad from the head back to where it was iB.w s ago
    '    vec3 vv = (viewMatrix * vec4(iB.xyz, 0.0)).xyz;',
    '    vec3 tl = mv.xyz - vv * iB.w;',
    '    vec2 txy = tl.xy * (mv.z / min(tl.z, -0.05));',
    '    vec2 d = mv.xy - txy; float dl = length(d);',
    '    if (dl > 1e-4) { ax = d / dl; len = size + dl; mv.xy -= d * 0.5; }',
    '  }',
    '  vec2 pp = vec2(-ax.y, ax.x);',
    '  mv.xy += ax * position.x * len + pp * position.y * size;',
    '  gl_Position = projectionMatrix * mv;',
    '  vUv = (uv + vec2(mod(iD.y, 2.0), 1.0 - floor(iD.y * 0.5))) * 0.5;',   // canvas rows are flipped (flipY): shape row 0 = top
    '  vC = iC; vHot = iD.z;',
    '}'].join('\n');
  const PVERT_FLAT = [                                         // lying on the ground (XZ plane); stretch along the xz velocity
    'attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD;',
    'varying vec2 vUv; varying vec4 vC; varying float vHot;',
    'void main(){',
    '  float size = iA.w, len = iA.w;',
    '  vec2 ax = vec2(cos(iD.x), sin(iD.x));',
    '  vec3 c = iA.xyz;',
    '  if (iB.w > 0.0) { vec2 v = iB.xz * iB.w; float vl = length(v); if (vl > 1e-4) { ax = v / vl; len = size + vl; c.xz -= v * 0.5; } }',
    '  vec2 pp = vec2(-ax.y, ax.x);',
    '  vec2 o = ax * position.x * len + pp * position.y * size;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(c.x + o.x, c.y + o.x * iB.y + o.y * iD.w, c.z + o.y, 1.0);',   // [conform] tilted on the slope
    '  vUv = (uv + vec2(mod(iD.y, 2.0), 1.0 - floor(iD.y * 0.5))) * 0.5;',   // canvas rows are flipped (flipY): shape row 0 = top
    '  vC = iC; vHot = iD.z;',
    '}'].join('\n');
  const PFRAG = [
    'uniform sampler2D uMap; varying vec2 vUv; varying vec4 vC; varying float vHot;',
    'void main(){',
    '  float t = texture2D(uMap, vUv).a;',
    '  float a = t * vC.a; if (a < 0.004) discard;',
    '  vec3 c = mix(vC.rgb, vec3(1.0), clamp(t * t * t * vHot, 0.0, 1.0));',
    '  gl_FragColor = vec4(c, a);',
    '}'].join('\n');

  const F32 = (n) => new Float32Array(n);
  const CF = global.VfxConform || null;                       // [conform] vfx/conform.js (absent: unchanged flat behaviour)
  class ParticleBatch {
    constructor(scene, map, cap, additive, flat, order) {
      this.cap = cap; this.n = 0; this.dropped = 0;
      this.p = F32(cap * 3); this.v = F32(cap * 3); this.age = F32(cap); this.life = F32(cap);
      this.s0 = F32(cap); this.s1 = F32(cap); this.c0 = F32(cap * 3); this.c1 = F32(cap * 3); this.a0 = F32(cap);
      this.drag = F32(cap); this.grav = F32(cap); this.str = F32(cap); this.rot = F32(cap); this.rotV = F32(cap);
      this.shape = F32(cap); this.hot = F32(cap); this.fin = F32(cap); this.fpow = F32(cap); this.floor = F32(cap); this.cpow = F32(cap);
      const g = new T.InstancedBufferGeometry(), q = new T.PlaneGeometry(1, 1);
      g.setIndex(q.index); g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
      const ia = (k) => { const a = new T.InstancedBufferAttribute(F32(cap * k), k); a.setUsage(T.DynamicDrawUsage); return a; };
      this.iA = ia(4); this.iB = ia(4); this.iC = ia(4); this.iD = ia(4);
      g.setAttribute('iA', this.iA); g.setAttribute('iB', this.iB); g.setAttribute('iC', this.iC); g.setAttribute('iD', this.iD);
      g.instanceCount = 0;
      const mat = new T.ShaderMaterial({
        uniforms: { uMap: { value: map } }, vertexShader: flat ? PVERT_FLAT : PVERT_BB, fragmentShader: PFRAG,
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, side: T.DoubleSide,
        polygonOffset: flat, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.mesh = new T.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
      this.geo = g; scene.add(this.mesh); this.flat = !!flat;
    }
    spawn() {                                                  // returns a slot index to fill, or -1 when full
      if (this.n >= this.cap) { this.dropped++; return -1; }
      return this.n++;
    }
    kill(i) {
      const j = --this.n; if (i === j) return;
      const cp3 = (A) => { A[i * 3] = A[j * 3]; A[i * 3 + 1] = A[j * 3 + 1]; A[i * 3 + 2] = A[j * 3 + 2]; };
      const cp1 = (A) => { A[i] = A[j]; };
      cp3(this.p); cp3(this.v); cp3(this.c0); cp3(this.c1);
      cp1(this.age); cp1(this.life); cp1(this.s0); cp1(this.s1); cp1(this.a0); cp1(this.drag); cp1(this.grav); cp1(this.str);
      cp1(this.rot); cp1(this.rotV); cp1(this.shape); cp1(this.hot); cp1(this.fin); cp1(this.fpow); cp1(this.floor); cp1(this.cpow);
    }
    update(dt) {
      const P = this.p, V = this.v, A = this.iA.array, B = this.iB.array, Cc = this.iC.array, D = this.iD.array;
      for (let i = 0; i < this.n; i++) {
        if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
        const i3 = i * 3, dr = this.drag[i];
        if (dr > 0) { const k = Math.exp(-dr * dt); V[i3] *= k; V[i3 + 1] *= k; V[i3 + 2] *= k; }
        V[i3 + 1] += this.grav[i] * dt;
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        const fl = this.floor[i];
        if (fl > -100 && P[i3 + 1] < fl) { P[i3 + 1] = fl; V[i3 + 1] *= -0.25; V[i3] *= 0.45; V[i3 + 2] *= 0.45; }
        this.rot[i] += this.rotV[i] * dt;
        const u = clamp01(this.age[i] / this.life[i]);
        const e = 1 - (1 - u) * (1 - u);                         // sizes ease out
        const fin = this.fin[i], fp = this.fpow[i];
        let a = this.a0[i];
        if (fp > 0) a *= u < fin ? u / fin : Math.pow(clamp01(1 - (u - fin) / (1 - fin)), fp);
        const cu = this.cpow[i] === 1 ? u : Math.pow(u, this.cpow[i]);
        const C0 = this.c0, C1 = this.c1;
        const i4 = i * 4;
        A[i4] = P[i3]; A[i4 + 1] = P[i3 + 1]; A[i4 + 2] = P[i3 + 2]; A[i4 + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
        B[i4] = V[i3]; B[i4 + 1] = V[i3 + 1]; B[i4 + 2] = V[i3 + 2]; B[i4 + 3] = this.str[i];
        if (this.flat) {                                         // [conform] lying particles: y is the height above the terrain, the quad follows its slope
          let gx = 0, gz = 0;
          if (CF && CF.active) {
            const x = P[i3], z = P[i3 + 2], r = Math.max(0.3, A[i4 + 3] * 0.5), h0 = CF.groundY(x, z);
            gx = (CF.groundY(x + r, z) - CF.groundY(x - r, z)) / (2 * r); gz = (CF.groundY(x, z + r) - CF.groundY(x, z - r)) / (2 * r);
            A[i4 + 1] += h0 + Math.min(0.15, (Math.abs(gx) + Math.abs(gz)) * r * 0.2);
          }
          B[i4 + 1] = gx; D[i4 + 3] = gz;
        }
        Cc[i4] = C0[i3] + (C1[i3] - C0[i3]) * cu; Cc[i4 + 1] = C0[i3 + 1] + (C1[i3 + 1] - C0[i3 + 1]) * cu; Cc[i4 + 2] = C0[i3 + 2] + (C1[i3 + 2] - C0[i3 + 2]) * cu; Cc[i4 + 3] = a;
        D[i4] = this.rot[i]; D[i4 + 1] = this.shape[i]; D[i4 + 2] = this.hot[i];
        this.age[i] += dt;
      }
      const n = this.n;
      this.geo.instanceCount = n;
      for (const at of [this.iA, this.iB, this.iC, this.iD]) { at.updateRange.offset = 0; at.updateRange.count = n * 4; at.needsUpdate = true; }
    }
    clear() { this.n = 0; this.geo.instanceCount = 0; }
  }

  /* ----------------------------------------------- trails ------------------------------------------------------
     Time-based ribbons: the owner pushes its position every frame; a new point is kept every life/(K-2) seconds,
     the head point follows the owner in between, points older than `life` fall off (the tail is interpolated, so
     the ribbon shortens smoothly). Built camera-facing on the CPU into one batched geometry per blend mode. */
  const TVERT = [
    'attribute vec4 color4; attribute float side; attribute float core;',
    'varying vec4 vC; varying float vS; varying float vK;',
    'void main(){ vC = color4; vS = side; vK = core; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'].join('\n');
  const TFRAG = [
    'varying vec4 vC; varying float vS; varying float vK;',
    'void main(){',
    '  float e = 1.0 - abs(vS);',                                // 1 on the centre line, 0 at the edges
    '  float soft = smoothstep(0.0, 0.6, e);',
    '  float k = pow(e, 6.0) * vK;',                              // thin white-hot centre line (per-trail strength)
    '  float a = vC.a * (soft + k * 0.4); if (a < 0.003) discard;',
    '  gl_FragColor = vec4(mix(vC.rgb, vec3(1.0), clamp(k, 0.0, 1.0)), a);',
    '}'].join('\n');
  class TrailBatch {
    constructor(scene, cap, K, additive, order) {
      this.cap = cap; this.K = K; this.list = [];
      const nv = cap * K * 2;
      const g = new T.BufferGeometry();
      this.pos = new T.BufferAttribute(F32(nv * 3), 3); this.pos.setUsage(T.DynamicDrawUsage);
      this.col = new T.BufferAttribute(F32(nv * 4), 4); this.col.setUsage(T.DynamicDrawUsage);
      this.cor = new T.BufferAttribute(F32(nv), 1); this.cor.setUsage(T.DynamicDrawUsage);
      const side = F32(nv); for (let i = 0; i < nv; i++) side[i] = i % 2 ? 1 : -1;
      const idx = [];
      for (let s = 0; s < cap; s++) for (let k = 0; k < K - 1; k++) {
        const a = (s * K + k) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx); g.setAttribute('position', this.pos); g.setAttribute('color4', this.col); g.setAttribute('core', this.cor);
      g.setAttribute('side', new T.BufferAttribute(side, 1));
      g.setDrawRange(0, 0);
      this.mesh = new T.Mesh(g, new T.ShaderMaterial({
        vertexShader: TVERT, fragmentShader: TFRAG,
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, side: T.DoubleSide,
      }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.geo = g;
      scene.add(this.mesh);
    }
  }
  class Trail {
    constructor(batch, style, now) {
      this.batch = batch; this.K = batch.K; this.pts = F32(this.K * 4); this.n = 0; this.style = style;
      this.detached = false; this.dead = false; this.lastKeep = -1; this.born = now; this.side = new T.Vector3(1, 0, 0);
    }
    push(x, y, z, now) {
      if (this.detached) return;
      const P = this.pts, K = this.K, keepEvery = this.style.life / Math.max(2, K - 2);
      if (this.n === 0 || now - this.lastKeep >= keepEvery) {   // keep a new point: shift the history back
        P.copyWithin(4, 0, (K - 1) * 4);
        this.n = Math.min(K, this.n + 1); this.lastKeep = now;
      }
      P[0] = x; P[1] = y; P[2] = z; P[3] = now;
      if (this.n === 1) { P[4] = x; P[5] = y; P[6] = z; P[7] = now; this.n = 2; }
    }
    detach() { this.detached = true; }
  }

  /* ----------------------------------------------- flats --------------------------------------------------------
     One program, per-instance uniforms. Plane in XY (local), uv centred; laid on the ground by the caller or
     oriented freely (shock rings across a flight path). Modes: */
  const FLAT = { ring: 0, disc: 1, scorch: 2, splat: 3, reticle: 4, telegraph: 5 };
  const FVERT = 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const FFRAG = [
    'uniform int uMode; uniform vec3 uColor; uniform vec3 uColor2; uniform float uAlpha; uniform vec4 uP; uniform vec4 uQ;',
    'varying vec2 vUv;',
    'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float line(float d, float w, float aa){ return 1.0 - smoothstep(w, w + aa, d); }',
    'void main(){',
    '  float r = length(vUv); if (r > 1.0) discard;',
    '  float ang = atan(vUv.y, vUv.x);',
    '  float aa = max(fwidth(r) * 1.2, 0.002);',
    '  vec3 col = uColor; float a = 0.0;',
    '  if (uMode == 0) {',                                         // ring: centre radius uP.x, half width uP.y
    '    a = line(abs(r - uP.x), uP.y, aa + uP.z);',
    '    col = mix(uColor, vec3(1.0), a * uP.w);',
    '  } else if (uMode == 1) {',                                  // soft disc: solid to uP.x, fades out to 1
    '    a = 1.0 - smoothstep(uP.x, 1.0, r);',
    '  } else if (uMode == 2) {',                                  // scorch: dark blot, noisy edge, embers (uP.w)
    '    float n = vn(vUv * 3.5 + uQ.xy) * 0.6 + vn(vUv * 9.0 + uQ.yx) * 0.4;',
    '    a = (1.0 - smoothstep(0.25, 0.95, r + (n - 0.5) * 0.35)) * 0.8;',
    '    float e = smoothstep(0.62, 0.86, vn(vUv * 7.0 + uQ.zw)) * (1.0 - smoothstep(0.3, 0.75, r)) * uP.w;',
    '    col = mix(uColor, uColor2, clamp(e * 1.6, 0.0, 1.0)); a = max(a, e);',
    '  } else if (uMode == 3) {',                                  // splat: irregular blob with a lighter rim + satellite drops
    '    float er = 0.6 + 0.18 * vn(vec2(ang * 1.6 + uQ.x, uQ.y)) + 0.1 * vn(vec2(ang * 4.0 + uQ.y, uQ.x));',
    '    float body = 1.0 - smoothstep(er - 0.07, er, r);',
    '    float drops = smoothstep(0.78, 0.84, vn(vUv * 5.0 + uQ.zw)) * step(er, r) * (1.0 - smoothstep(0.8, 1.0, r));',
    '    float rim = smoothstep(er - 0.24, er - 0.05, r) * body;',
    '    a = max(body, drops) * 0.75; col = mix(uColor, uColor2, rim * 0.8);',
    '  } else if (uMode == 4) {',                                  // reticle: outer ring, 4 inward ticks (rotating), dashed inner ring
    '    float ring = line(abs(r - 0.93), 0.012, aa);',
    '    float ra = ang - uQ.z; float sector = TAU_ / 4.0;',
    '    float da = abs(mod(ra + sector * 0.5, sector) - sector * 0.5) * r;',
    '    float tick = line(da, 0.012, aa) * step(0.72, r) * step(r, 0.93);',
    '    float notch = line(abs(mod(ra, sector) - sector * 0.5) * r, 0.05, aa) * line(abs(r - 0.985), 0.008, aa);',
    '    float dash = step(0.5, fract((ang + uQ.z * 0.5) * 24.0 / TAU_)) * line(abs(r - 0.6), 0.008, aa) * 0.6;',
    '    a = max(max(ring, tick), max(notch, dash)) + (1.0 - smoothstep(0.0, 0.93, r)) * uP.w;',
    '    col = mix(uColor, vec3(1.0), ring * 0.25);',
    '  } else {',                                                   // telegraph: edge (+ dark contrast rim), inward ticks, fill, sweep ring, pulse
    '    float edge = line(abs(r - 0.962), 0.02, aa);',
    '    float rim = line(abs(r - 0.992), 0.007, aa) * (1.0 - edge);',
    '    float N = uQ.x, sector = TAU_ / N;',
    '    float da = abs(mod(ang + sector * 0.5, sector) - sector * 0.5) * r;',
    '    float tick = line(da, 0.007, aa) * step(0.88, r) * step(r, 0.952);',
    '    float fill = uP.x * (1.0 - smoothstep(0.85, 1.0, r)) + uP.y * (1.0 - r * 0.6);',
    '    float sweep = uQ.y > 0.001 ? line(abs(r - uQ.y), 0.01, aa) * 0.75 : 0.0;',
    '    float inner = line(abs(r - 0.25), 0.006, aa) * 0.35;',
    '    a = edge * 0.95 + tick * 0.7 + fill + sweep + inner + rim * 0.45;',
    '    col = mix(uColor, vec3(1.0), clamp(edge * 0.3 + sweep * 0.4, 0.0, 1.0));',
    '    col = mix(col, vec3(0.07, 0.055, 0.03), rim);',
    '  }',
    '  a *= uAlpha; if (a < 0.003) discard;',
    '  gl_FragColor = vec4(col, a);',
    '}'].join('\n').replace(/TAU_/g, '6.2831853');

  /* ------------------------------------------------ beams -------------------------------------------------------
     Unit quad from x = 0 (tail) to x = 1 (head); oriented every frame so it faces the camera around its axis
     (or lies flat on the ground). Soft across, white core, fades at both ends, optional travelling highlight. */
  const BVERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const BFRAG = [
    'uniform vec3 uColor; uniform float uAlpha; uniform float uCore; uniform vec4 uF; varying vec2 vUv;',
    'void main(){',
    '  float y = abs(vUv.y * 2.0 - 1.0), x = vUv.x;',
    '  float across = 1.0 - smoothstep(0.25, 1.0, y);',
    '  float core = pow(1.0 - y, 7.0) * uCore;',
    '  float along = smoothstep(0.0, max(uF.x, 1e-3), x) * (1.0 - smoothstep(1.0 - max(uF.y, 1e-3), 1.0, x));',
    '  float sw = uF.w > 0.0 ? exp(-pow((x - uF.z) / uF.w, 2.0)) : 0.0;',
    '  float a = (across * (0.6 + 0.8 * sw) + core) * along * uAlpha;',
    '  if (a < 0.003) discard;',
    '  gl_FragColor = vec4(mix(uColor, vec3(1.0), clamp(core + sw * 0.35, 0.0, 1.0)), a);',
    '}'].join('\n');

  const QUALITY = {
    low:    { density: 0.42, trailK: 8,  extras: false, smoke: false, lights: false },
    medium: { density: 0.7,  trailK: 11, extras: true,  smoke: true,  lights: true },
    high:   { density: 1.0,  trailK: 14, extras: true,  smoke: true,  lights: true },
  };

  /* ------------------------------------------------- presets ----------------------------------------------------
     b: batch, life [min,max] s, size [start,end] m, c0 -> c1 colour (cpow = colour curve), a alpha, drag 1/s,
     grav m/s^2 (+ rises), stretch s (screen streak length = speed * stretch), shape, hot (white core), rot random
     start angle, rotV [min,max] rad/s, fin fade-in fraction, fpow fade-out power (0 = constant), floor y (bounce). */
  const PRESETS = {
    flash:   { b: 'add', shape: 'glow', life: [0.06, 0.07], size: [0.3, 0.5], c0: 0xffffff, c1: 0xffe2a8, a: 0.9, hot: 1, fpow: 1.3 },
    ping:    { b: 'add', shape: 'ring', life: [0.15, 0.16], size: [0.15, 0.8], c0: 0xffffff, c1: 0xffdca0, a: 0.75, fpow: 1.6 },
    glint:   { b: 'add', shape: 'glow', life: [0, 0], size: [0.1, 0.1], c0: 0xffffff, c1: 0xffffff, a: 0.4, hot: 1, fpow: 0 },
    spark:   { b: 'add', shape: 'spark', life: [0.12, 0.26], size: [0.034, 0.018], c0: 0xfff4d2, c1: 0xff9a3c, a: 1, hot: 0.8, stretch: 0.03, grav: -12, drag: 1.5, floor: 0.02 },
    ember:   { b: 'add', shape: 'glow', life: [0.5, 0.9], size: [0.05, 0.02], c0: 0xffe6a8, c1: 0xff5a10, a: 1, hot: 0.6, stretch: 0.016, grav: -5, drag: 1.2 },
    wind:    { b: 'add', shape: 'glow', life: [0.1, 0.14], size: [0.024, 0.014], c0: 0xffffff, c1: 0xd6e4ff, a: 0.3, stretch: 0.06, drag: 4 },
    mote:    { b: 'add', shape: 'glow', life: [0.5, 0.8], size: [0.035, 0.018], c0: 0xfff2c0, c1: 0xf0c060, a: 0.6, grav: 0.6, drag: 1 },
    flameHot:{ b: 'add', shape: 'glow', life: [0.08, 0.14], size: [0.09, 0.14], c0: 0xfff0b0, c1: 0xff7a20, a: 0.7, hot: 0.5, grav: 1 },
    flame:   { b: 'norm', shape: 'puff', life: [0.12, 0.2], size: [0.12, 0.22], c0: 0xffb040, c1: 0xc03008, a: 0.85, drag: 2, grav: 1.2, rot: true, rotV: [-3, 3], fin: 0.05 },
    dust:    { b: 'norm', shape: 'puff', life: [0.45, 0.7], size: [0.22, 0.6], c0: 0xc8b898, c1: 0xb0a080, a: 0.32, drag: 3, grav: 0.4, rot: true, rotV: [-1, 1], fin: 0.1 },
    smoke:   { b: 'norm', shape: 'puff', life: [0.8, 1.2], size: [0.3, 0.9], c0: 0x40362f, c1: 0x5c544c, a: 0.28, drag: 1.5, grav: 0.6, rot: true, rotV: [-0.6, 0.6], fin: 0.15 },
    chip:    { b: 'norm', shape: 'spark', life: [0.3, 0.5], size: [0.04, 0.03], c0: 0x7a5a35, c1: 0x5a4028, a: 1, stretch: 0.02, grav: -11, drag: 0.6, floor: 0.02 },
    drop:    { b: 'norm', shape: 'spark', life: [0.35, 0.5], size: [0.045, 0.03], c0: 0x7fae2a, c1: 0x3c5a12, a: 0.95, stretch: 0.025, grav: -10, drag: 0.5, floor: 0.02 },
    gring:   { b: 'gadd', shape: 'ring', life: [0.28, 0.3], size: [0.3, 1.6], c0: 0xffffff, c1: 0xffffff, a: 0.6, fpow: 1.4 },
    gdisc:   { b: 'gnorm', shape: 'glow', life: [0.2, 0.2], size: [0.2, 0.2], c0: 0x000000, c1: 0x000000, a: 0.35, fin: 0.6, fpow: 0.5 },
  };

  function create(opts) {
    const scene = opts.scene, camera = opts.camera;
    const map = makeAtlas();
    const root = new T.Group(); root.name = 'vfx'; scene.add(root);
    const kit = { scene, camera, root, time: 0, lifeMul: 1, quality: 'high', Q: QUALITY.high, PRESETS, SHAPE, FLAT };
    const cap = opts.caps || {};
    kit.batches = {
      add: new ParticleBatch(root, map, cap.add || 1400, true, false, 32),
      norm: new ParticleBatch(root, map, cap.norm || 700, false, false, 30),
      gadd: new ParticleBatch(root, map, cap.gadd || 220, true, true, 12),
      gnorm: new ParticleBatch(root, map, cap.gnorm || 300, false, true, 11),
    };
    const TK = 16;                                             // allocated points per trail; quality uses fewer
    kit.trailBatches = { add: new TrailBatch(root, cap.trailsAdd || 72, TK, true, 31), norm: new TrailBatch(root, cap.trailsNorm || 28, TK, false, 29) };

    kit.setQuality = function (q) { kit.quality = QUALITY[q] ? q : 'high'; kit.Q = QUALITY[kit.quality]; };
    kit.setQuality(opts.quality || 'high');
    // stochastic rounding: 2.4 -> 2 (60%) or 3 (40%); keeps averages right at low density
    kit.n = function (count, mul) { const x = count * kit.Q.density * (mul === undefined ? 1 : mul); const f = Math.floor(x); return f + (Math.random() < x - f ? 1 : 0); };

    /* ---- particles ---- */
    const hexR = (h) => ((h >> 16) & 255) / 255, hexG = (h) => ((h >> 8) & 255) / 255, hexB = (h) => (h & 255) / 255;
    kit.emit = function (pr, x, y, z, vx, vy, vz, o) {
      const B = kit.batches[(o && o.b) || pr.b], i = B.spawn(); if (i < 0) return -1;
      const i3 = i * 3;
      B.p[i3] = x; B.p[i3 + 1] = y; B.p[i3 + 2] = z; B.v[i3] = vx || 0; B.v[i3 + 1] = vy || 0; B.v[i3 + 2] = vz || 0;
      const L = (o && o.life !== undefined) ? o.life : rand(pr.life[0], pr.life[1]);
      B.age[i] = 0; B.life[i] = L > 0 ? L * kit.lifeMul : 1e-4;
      const sc = (o && o.scale) || 1;
      B.s0[i] = ((o && o.s0 !== undefined) ? o.s0 : pr.size[0]) * sc; B.s1[i] = ((o && o.s1 !== undefined) ? o.s1 : pr.size[1]) * sc;
      const c0 = (o && o.c0 !== undefined) ? o.c0 : pr.c0, c1 = (o && o.c1 !== undefined) ? o.c1 : pr.c1;
      B.c0[i3] = hexR(c0); B.c0[i3 + 1] = hexG(c0); B.c0[i3 + 2] = hexB(c0); B.c1[i3] = hexR(c1); B.c1[i3 + 1] = hexG(c1); B.c1[i3 + 2] = hexB(c1);
      B.a0[i] = (o && o.a !== undefined) ? o.a : pr.a;
      B.drag[i] = (o && o.drag !== undefined) ? o.drag : (pr.drag || 0);
      B.grav[i] = (o && o.grav !== undefined) ? o.grav : (pr.grav || 0);
      B.str[i] = (o && o.stretch !== undefined) ? o.stretch : (pr.stretch || 0);
      B.rot[i] = (o && o.rot !== undefined) ? o.rot : (pr.rot ? Math.random() * TAU : 0);
      B.rotV[i] = pr.rotV ? rand(pr.rotV[0], pr.rotV[1]) : 0;
      B.shape[i] = SHAPE[pr.shape] || 0; B.hot[i] = (o && o.hot !== undefined) ? o.hot : (pr.hot || 0);
      B.fin[i] = (o && o.fin !== undefined) ? o.fin : (pr.fin || 0); B.fpow[i] = (o && o.fpow !== undefined) ? o.fpow : (pr.fpow === undefined ? 1 : pr.fpow);
      B.floor[i] = (o && o.floor !== undefined) ? o.floor : (pr.floor === undefined ? -1000 : pr.floor);
      B.cpow[i] = pr.cpow || 1;
      return i;
    };

    /* ---- trails ---- */
    kit.trails = [];
    kit.trail = function (style) {
      const TB = kit.trailBatches[style.b === 'norm' ? 'norm' : 'add'];
      if (TB.list.length >= TB.cap) return null;
      const tr = new Trail(TB, style, kit.time);
      tr.K = Math.min(TB.K, kit.Q.trailK);
      TB.list.push(tr); kit.trails.push(tr);
      return tr;
    };
    const _cam = new T.Vector3(), _t = new T.Vector3(), _v = new T.Vector3(), _s = new T.Vector3(), _q = new T.Vector3();
    const C0 = new T.Color(), C1 = new T.Color();
    function buildTrails(TB) {
      const now = kit.time, K = TB.K, pos = TB.pos.array, col = TB.col.array, cor = TB.cor.array;
      let slot = 0;
      for (let j = TB.list.length - 1; j >= 0; j--) {
        const tr = TB.list[j];
        if (tr.n < 2 || (tr.detached && now - tr.pts[3] > tr.style.life)) { tr.dead = true; TB.list.splice(j, 1); continue; }
      }
      for (const tr of TB.list) {
        const S = tr.style, life = Math.max(1e-3, S.life), P = tr.pts, base = slot * K * 2;
        // live points (newest first), the last one clipped to exactly `life` seconds old
        let m = 0;
        const xs = TrailScratch.x, ys = TrailScratch.y, zs = TrailScratch.z, us = TrailScratch.u;
        for (let k = 0; k < tr.n; k++) {
          const age = now - P[k * 4 + 3], u = age / life;
          if (u < 1) { xs[m] = P[k * 4]; ys[m] = P[k * 4 + 1]; zs[m] = P[k * 4 + 2]; us[m] = u; m++; continue; }
          if (m > 0) {                                         // interpolate the tail to u = 1
            const uPrev = us[m - 1], f = (1 - uPrev) / Math.max(1e-5, u - uPrev);
            xs[m] = xs[m - 1] + (P[k * 4] - xs[m - 1]) * f; ys[m] = ys[m - 1] + (P[k * 4 + 1] - ys[m - 1]) * f; zs[m] = zs[m - 1] + (P[k * 4 + 2] - zs[m - 1]) * f; us[m] = 1; m++;
          }
          break;
        }
        if (m < 2) { m = 0; }
        C0.setHex(S.c0); C1.setHex(S.c1);
        _cam.copy(kit.camera.position);
        for (let k = 0; k < K; k++) {
          const kk = Math.min(k, Math.max(0, m - 1));
          const o3 = (base + k * 2) * 3, o4 = (base + k * 2) * 4;
          const o1 = base + k * 2;
          cor[o1] = cor[o1 + 1] = S.core || 0;
          if (m === 0) { for (let q = 0; q < 6; q++) pos[o3 + q] = 0; for (let q = 0; q < 8; q++) col[o4 + q] = 0; continue; }
          const x = xs[kk], y = ys[kk], z = zs[kk], u = us[kk];
          const a0 = Math.max(0, kk - 1), a1 = Math.min(m - 1, kk + 1);
          _t.set(xs[a0] - xs[a1], ys[a0] - ys[a1], zs[a0] - zs[a1]);
          _v.set(_cam.x - x, _cam.y - y, _cam.z - z);
          _s.crossVectors(_t, _v);
          if (_s.lengthSq() > 1e-10) { _s.normalize(); tr.side.copy(_s); } else _s.copy(tr.side);
          const taper = Math.pow(1 - u, S.taper === undefined ? 0.8 : S.taper);
          const head = S.headIn ? clamp01(u / S.headIn) : 1;
          const w = S.w * 0.5 * taper * (0.35 + 0.65 * head) * (k >= m ? 0 : 1);
          pos[o3] = x - _s.x * w; pos[o3 + 1] = y - _s.y * w; pos[o3 + 2] = z - _s.z * w;
          pos[o3 + 3] = x + _s.x * w; pos[o3 + 4] = y + _s.y * w; pos[o3 + 5] = z + _s.z * w;
          const cu = Math.pow(u, S.cpow || 0.7);
          const r = C0.r + (C1.r - C0.r) * cu, g = C0.g + (C1.g - C0.g) * cu, b = C0.b + (C1.b - C0.b) * cu;
          const a = S.a * Math.pow(1 - u, S.fpow === undefined ? 1.3 : S.fpow) * head * (S.alphaMul === undefined ? 1 : S.alphaMul);
          col[o4] = r; col[o4 + 1] = g; col[o4 + 2] = b; col[o4 + 3] = a;
          col[o4 + 4] = r; col[o4 + 5] = g; col[o4 + 6] = b; col[o4 + 7] = a;
        }
        slot++;
      }
      TB.geo.setDrawRange(0, slot * (K - 1) * 6);
      TB.pos.updateRange.offset = 0; TB.pos.updateRange.count = slot * K * 2 * 3; TB.pos.needsUpdate = true;
      TB.col.updateRange.offset = 0; TB.col.updateRange.count = slot * K * 2 * 4; TB.col.needsUpdate = true;
      TB.cor.updateRange.offset = 0; TB.cor.updateRange.count = slot * K * 2; TB.cor.needsUpdate = true;
    }
    const TrailScratch = { x: F32(TK + 1), y: F32(TK + 1), z: F32(TK + 1), u: F32(TK + 1) };

    /* ---- flats ---- */
    const flatGeo = new T.PlaneGeometry(1, 1);
    const flatMat = new T.ShaderMaterial({
      uniforms: { uMode: { value: 0 }, uColor: { value: new T.Color() }, uColor2: { value: new T.Color() }, uAlpha: { value: 1 }, uP: { value: new T.Vector4() }, uQ: { value: new T.Vector4() } },
      vertexShader: FVERT, fragmentShader: FFRAG, transparent: true, depthWrite: false, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, extensions: { derivatives: true },
    });
    const flatPool = [], flats = [];
    for (let i = 0; i < (cap.flats || 48); i++) {                // stress test (5 archers + rain) peaks at ~27 live
      const m = new T.Mesh(flatGeo, flatMat.clone()); m.visible = false; m.frustumCulled = false; root.add(m);
      if (global.VfxConform) global.VfxConform.attach(m, { seg: 16 });   // [conform] ground flats lie on slopes (vfx/conform.js)
      flatPool.push(m);
    }
    /* kit.flat(mode, { pos, radius, ground: true (default) | quaternion, color, color2, alpha, add, order, update(F, dt) })
       F = { m, u (uniforms), t, radius, alive, free() }; the caller animates it through update() (return false = done) */
    kit.flat = function (mode, o) {
      const m = flatPool.pop(); if (!m) return null;
      const U = m.material.uniforms;
      U.uMode.value = FLAT[mode] !== undefined ? FLAT[mode] : mode;
      U.uColor.value.setHex(o.color === undefined ? 0xffffff : o.color); U.uColor2.value.setHex(o.color2 === undefined ? 0xffffff : o.color2);
      U.uAlpha.value = o.alpha === undefined ? 1 : o.alpha; U.uP.value.set(0.85, 0.06, 0, 0); U.uQ.value.set(Math.random() * 50, Math.random() * 50, Math.random() * 50, Math.random() * 50);
      m.material.blending = o.add ? T.AdditiveBlending : T.NormalBlending;
      m.renderOrder = o.order === undefined ? 10 : o.order;
      m.scale.setScalar((o.radius || 1) * 2);
      if (o.quaternion) { m.position.copy(o.pos); m.quaternion.copy(o.quaternion); }
      else { m.position.set(o.pos.x, o.y === undefined ? 0.03 : o.y, o.pos.z); m.rotation.set(-Math.PI / 2, 0, 0); }   // ground: walkable ground is y = 0
      if (global.VfxConform) global.VfxConform.enable(m, !o.quaternion);   // [conform] y = height above the terrain; oriented rings stay flat
      m.visible = true;
      const F = { m, u: U, t: 0, radius: o.radius || 1, alive: true, update: o.update || null, data: o.data || {},
        free() { if (!F.alive) return; F.alive = false; m.visible = false; flatPool.push(m); } };
      flats.push(F);
      return F;
    };

    /* ---- beams ---- */
    const beamGeo = new T.PlaneGeometry(1, 1); beamGeo.translate(0.5, 0, 0);
    const beamMat = new T.ShaderMaterial({
      uniforms: { uColor: { value: new T.Color() }, uAlpha: { value: 1 }, uCore: { value: 0.8 }, uF: { value: new T.Vector4(0.1, 0.1, 0, 0) } },
      vertexShader: BVERT, fragmentShader: BFRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    });
    const beamPool = [], beams = [];
    for (let i = 0; i < (cap.beams || 32); i++) {
      const m = new T.Mesh(beamGeo, beamMat.clone()); m.visible = false; m.frustumCulled = false; m.renderOrder = 28; root.add(m);
      if (global.VfxConform) global.VfxConform.attach(m, { seg: 16, segY: 1 });   // [conform] ground-flat beams (aim guides) lie on slopes
      beamPool.push(m);
    }
    /* kit.beam({ p0, p1 (Vector3, copied unless follow), width, color, alpha, core, life, fade: [tail, head], sweep: speed,
                 flat: false, norm: false, grow: s (head extends from p0 over s seconds), update(B, u, dt) }) */
    kit.beam = function (o) {
      const m = beamPool.pop(); if (!m) return null;
      const U = m.material.uniforms;
      U.uColor.value.setHex(o.color === undefined ? 0xffffff : o.color); U.uCore.value = o.core === undefined ? 0.8 : o.core;
      U.uF.value.set((o.fade && o.fade[0]) || 0.15, (o.fade && o.fade[1]) || 0.1, 0, o.sweep ? 0.12 : 0);
      m.material.blending = o.norm ? T.NormalBlending : T.AdditiveBlending;
      m.renderOrder = o.order === undefined ? 28 : o.order;
      m.visible = true;
      if (global.VfxConform) global.VfxConform.enable(m, !!o.flat);   // [conform] only the ground-flat ones
      const B = { m, u: U, t: 0, life: (o.life || 0.1) * kit.lifeMul, p0: o.p0.clone(), p1: o.p1.clone(), width: o.width || 0.05, alpha: o.alpha === undefined ? 1 : o.alpha,
        flat: !!o.flat, grow: o.grow || 0, sweep: o.sweep || 0, update: o.update || null, alive: true, hold: !!o.hold, wcurve: o.wcurve === undefined ? 0.5 : o.wcurve,
        free() { if (!B.alive) return; B.alive = false; m.visible = false; beamPool.push(m); } };
      beams.push(B);
      return B;
    };
    const _x = new T.Vector3(), _y = new T.Vector3(), _z = new T.Vector3(), _mm = new T.Matrix4(), _p1 = new T.Vector3();
    const UPV = new T.Vector3(0, 1, 0);
    function placeBeam(B, w) {
      _p1.copy(B.p1);
      if (B.grow > 0) _p1.lerpVectors(B.p0, B.p1, Math.min(1, B.t / B.grow));
      _x.subVectors(_p1, B.p0); const len = _x.length();
      if (len < 1e-4) { B.m.visible = false; return; }
      B.m.visible = true; _x.divideScalar(len);
      if (B.flat) _y.crossVectors(UPV, _x);
      else { _z.subVectors(kit.camera.position, B.p0); _y.crossVectors(_z, _x); }
      if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0); _y.normalize();
      _z.crossVectors(_x, _y);
      _mm.makeBasis(_x, _y, _z); B.m.quaternion.setFromRotationMatrix(_mm);
      B.m.position.copy(B.p0); B.m.scale.set(len, Math.max(1e-4, w), 1);
    }

    /* ---- scheduler ---- */
    const timers = [];
    kit.later = function (t, fn) { timers.push({ t: kit.time + Math.max(0, t), fn }); };

    /* ---- per frame: begin (clock + timers) -> emitters of the frame -> end (simulate + upload) ---- */
    kit.begin = function (dt) {
      kit.time += dt;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= kit.time) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    };
    kit.update = function (dt) { kit.begin(dt); kit.end(dt); };
    kit.end = function (dt) {
      for (let i = flats.length - 1; i >= 0; i--) {
        const F = flats[i];
        if (!F.alive) { flats.splice(i, 1); continue; }
        F.t += dt;
        if (F.update && F.update(F, dt) === false) { F.free(); flats.splice(i, 1); }
      }
      for (let i = beams.length - 1; i >= 0; i--) {
        const B = beams[i];
        if (!B.alive) { beams.splice(i, 1); continue; }
        B.t += dt;
        const u = B.hold ? 0 : B.t / B.life;
        if (u >= 1) { B.free(); beams.splice(i, 1); continue; }
        let w = B.width * (1 - u * B.wcurve), a = B.alpha * Math.pow(1 - u, 1.4);
        if (B.update) { const r = B.update(B, u, dt); if (r === false) { B.free(); beams.splice(i, 1); continue; } if (r && r.w !== undefined) { w = r.w; a = r.a; } }
        if (B.sweep) B.u.uF.value.z = -0.15 + (B.t * B.sweep);
        B.u.uAlpha.value = a;
        placeBeam(B, w);
      }
      for (const k in kit.batches) kit.batches[k].update(dt);
      buildTrails(kit.trailBatches.add); buildTrails(kit.trailBatches.norm);
      for (let i = kit.trails.length - 1; i >= 0; i--) if (kit.trails[i].dead) kit.trails.splice(i, 1);
    };

    kit.stats = function () {
      const b = kit.batches;
      return { add: b.add.n, norm: b.norm.n, gadd: b.gadd.n, gnorm: b.gnorm.n, dropped: b.add.dropped + b.norm.dropped + b.gadd.dropped + b.gnorm.dropped,
        trails: kit.trailBatches.add.list.length + kit.trailBatches.norm.list.length, flats: flats.length, beams: beams.length, timers: timers.length };
    };
    kit.clear = function () {
      for (const k in kit.batches) kit.batches[k].clear();
      for (const k in kit.trailBatches) { kit.trailBatches[k].list.length = 0; kit.trailBatches[k].geo.setDrawRange(0, 0); }
      kit.trails.length = 0;
      for (const F of flats.slice()) F.free(); flats.length = 0;
      for (const B of beams.slice()) B.free(); beams.length = 0;
      timers.length = 0;
    };
    return kit;
  }

  global.VFXKit = { create, PRESETS, SHAPE, FLAT, QUALITY };
})(window);
