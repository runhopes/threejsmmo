/* =====================================================================================================
 *  magefx/meshes.js  -  mesh-based effects (where billboards would turn into blobs):
 *    FlameSurface  - open cylinders with a world-space scrolling-noise flame shader (fire pillar, nova wall).
 *                    Fake volume: double-sided, softened silhouettes, eroded top edge, white-hot ground contact.
 *    ShieldDome    - fresnel rim + hex cells (stereographic, no pole pinch), rising energy bands, hit ripples (4),
 *                    integrity (cells drop out / flicker as it weakens), bottom -> top formation sweep.
 *    BoltMesh      - lightning: camera-facing ribbons along jagged polylines (core + glow in one draw call).
 *    crystal / rock geometry + materials (instancing-aware), ShardBurst (instanced flying / planted shards).
 *    LightPool     - a fixed set of point lights (created up front: adding lights later recompiles every
 *                    material); flashes and continuous requests compete, the strongest win. Can share host lights.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE, MFX = global.MageFX, M = MFX.math;

  /* ---------------- flame surface ---------------- */
  const FLAME_VS = [
    'varying vec2 vUv; varying vec3 vW; varying float vFacing;',
    'void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;',
    '  vec3 n = normalize(mat3(modelMatrix) * normal); vFacing = abs(dot(n, normalize(cameraPosition - w.xyz)));',
    '  gl_Position = projectionMatrix * viewMatrix * w; }',
  ].join('\n');
  const FLAME_FS = [
    'uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform float uTime, uAlpha, uErode, uSpeed, uScale, uAdd, uBase, uShape, uSolid;',
    'varying vec2 vUv; varying vec3 vW; varying float vFacing;',
    MFX.GLSL_NOISE,
    'void main(){',
    '  float h = vUv.y;',
    '  vec3 p = vec3(vW.x * uScale, vW.y * uScale * 0.42 - uTime * uSpeed, vW.z * uScale);',   // stretched vertically = flame streaks
    '  float n = mfxFbm3(p);',
    '  float n2 = mfxNoise3(p * 2.6 + vec3(0.0, -uTime * uSpeed * 0.9, 0.0));',
    // vertical streaks: thin tongues with gaps between them (never a solid cone), fewer gaps near the base
    '  float st = mfxNoise3(vec3(vW.x * uScale * 2.4, vW.y * uScale * 0.2 - uTime * uSpeed * 1.35, vW.z * uScale * 2.4));',
    '  float shape = (1.0 - h) * uShape - uErode + (n - 0.5) * 1.15 + (n2 - 0.5) * 0.38;',
    '  float streak = smoothstep(0.3, 0.7, st + (1.0 - h) * 0.3 - 0.05);',
    '  float a = smoothstep(0.0, 0.32, shape) * mix(streak, 1.0, uSolid);',
    '  float heat = clamp(shape * 0.72 + (st - 0.5) * 0.35 - h * 0.25, 0.0, 1.0);',
    '  vec3 col = mix(uC2, uC1, smoothstep(0.1, 0.5, heat));',
    '  col = mix(col, uC0, smoothstep(0.66, 1.0, heat));',
    '  col += uC0 * uBase * (1.0 - smoothstep(0.0, 0.12, h)) * 0.7;',
    '  a *= mix(0.22, 1.0, vFacing) * (gl_FrontFacing ? 1.0 : 0.6);',
    '  a *= smoothstep(-0.02, 0.05, h) * uAlpha;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(col * a * 1.05, a * (1.0 - uAdd));',
    '}',
  ].join('\n');
  function flameMaterial(pal, o) {
    o = o || {};
    const u = { uC0: { value: new T.Color(pal.core) }, uC1: { value: new T.Color(pal.hot) }, uC2: { value: new T.Color(pal.flame) },
      uTime: { value: 0 }, uAlpha: { value: 1 }, uErode: { value: 0 }, uSpeed: { value: o.speed || 2.2 }, uScale: { value: o.scale || 1.6 },
      uAdd: { value: o.add === undefined ? 0.45 : o.add }, uBase: { value: o.base === undefined ? 0.6 : o.base }, uShape: { value: o.shape || 1.35 }, uSolid: { value: o.solid === undefined ? 0.35 : o.solid } };
    return new T.ShaderMaterial(MFX.premul({ uniforms: u, vertexShader: FLAME_VS, fragmentShader: FLAME_FS, side: T.DoubleSide }));
  }
  const _cylCache = {};
  function cylinder(rTop, rBot, segs, hSegs) {
    const k = rTop + ':' + rBot + ':' + segs;
    if (!_cylCache[k]) { const g = new T.CylinderGeometry(rTop, rBot, 1, segs, hSegs || 8, true); g.translate(0, 0.5, 0); _cylCache[k] = g; }
    return _cylCache[k];
  }
  // a pooled flame surface: { mesh, mat } ; geometry chosen per use
  class FlameSurfaces {
    constructor(scene) { this.scene = scene; this.pool = []; this.list = []; }
    get(pal, geo, o) {
      const F = this.pool.pop() || { mesh: new T.Mesh(geo, flameMaterial(pal, o)) };
      const u = F.mesh.material.uniforms;
      u.uC0.value.setHex(pal.core); u.uC1.value.setHex(pal.hot); u.uC2.value.setHex(pal.flame);
      o = o || {};
      u.uSpeed.value = o.speed || 2.2; u.uScale.value = o.scale || 1.6; u.uAdd.value = o.add === undefined ? 0.45 : o.add;
      u.uBase.value = o.base === undefined ? 0.6 : o.base; u.uShape.value = o.shape || 1.35; u.uSolid.value = o.solid === undefined ? 0.35 : o.solid; u.uErode.value = 0; u.uAlpha.value = 1;
      F.mesh.geometry = geo; F.mesh.renderOrder = o.order || 28; F.mesh.frustumCulled = false;
      F.mesh.position.set(0, 0, 0); F.mesh.scale.set(1, 1, 1); F.mesh.rotation.set(0, 0, 0);
      this.scene.add(F.mesh); this.list.push(F);
      return F;
    }
    put(F) { this.scene.remove(F.mesh); const i = this.list.indexOf(F); if (i >= 0) this.list.splice(i, 1); this.pool.push(F); }
    update(time) { for (const F of this.list) F.mesh.material.uniforms.uTime.value = time; }
  }

  /* ---------------- shield dome ---------------- */
  const SHIELD_VS = [
    'varying vec3 vN; varying vec3 vV; varying vec3 vL;',
    'void main(){ vL = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0);',
    '  vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
  ].join('\n');
  const SHIELD_FS = [
    'uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform float uTime, uAlpha, uForm, uIntegrity, uFlash, uPulse, uDissolve;',
    'uniform vec4 uHits[4];',
    'varying vec3 vN; varying vec3 vV; varying vec3 vL;',
    'float hexDist(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }',
    'vec4 hexCoords(vec2 uv){ vec2 r = vec2(1.0, 1.7320508), h = r * 0.5; vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;',
    '  vec2 gv = dot(a, a) < dot(b, b) ? a : b; return vec4(gv, uv - gv); }',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  float fres = pow(1.0 - abs(dot(n, normalize(vV))), 2.3);',
    '  vec2 sp = vL.xz / (1.0 + vL.y + 0.45) * 4.6;',
    '  vec4 hx = hexCoords(sp);',
    '  float edgeD = 0.5 - hexDist(hx.xy);',
    '  float edge = 1.0 - smoothstep(0.0, 0.07, edgeD);',
    '  float cellH = fract(sin(dot(hx.zw, vec2(12.9898, 78.233))) * 43758.5453);',
    '  float broken = step(uIntegrity * 1.15 + 0.02, cellH);',
    '  float flick = 0.6 + 0.4 * step(0.5, fract(uTime * 9.0 + cellH * 13.0));',
    '  float band = pow(0.5 + 0.5 * sin(vL.y * 9.0 - uTime * 2.4), 8.0);',
    '  float hit = 0.0;',
    '  for (int i = 0; i < 4; i++) { vec4 H = uHits[i]; if (H.w >= 0.0 && H.w < 0.7) {',
    '    float dd = acos(clamp(dot(vL, H.xyz), -1.0, 1.0)); float k = 1.0 - H.w / 0.7;',
    '    hit += (exp(-pow((dd - H.w * 4.2) * 6.0, 2.0)) * 0.8 + exp(-dd * dd * 14.0) * 1.2) * k; } }',
    '  float hgt = vL.y * 0.5 + 0.5;',
    '  float lim = uForm * 1.15;',
    '  float vis = 1.0 - smoothstep(lim - 0.05, lim, hgt);',
    '  float front = exp(-pow((hgt - lim) * 14.0, 2.0)) * step(uForm, 0.999);',
    '  float dis = 1.0 - smoothstep(uDissolve - 0.08, uDissolve, 1.0 - hgt + (cellH - 0.5) * 0.12);',   // top-down dissolve
    '  float lines = edge * (0.18 + 0.55 * fres) * (1.0 - broken * 0.9) * flick;',
    '  float I = fres * 1.05 + lines + band * fres * 0.5 + hit * (0.5 + edge * 1.2) + uFlash * (0.35 + fres) + uPulse * (fres * 0.6 + edge * 0.25);',
    '  vec3 col = mix(uC1, uC0, clamp(fres * 0.8 + hit * 0.6, 0.0, 1.0)) * I + uC2 * (front * 1.6 + hit * edge * 0.5);',
    '  float back = gl_FrontFacing ? 1.0 : 0.45;',
    '  float m = uAlpha * back * dis;',
    '  float a = (fres * 0.28 + lines * 0.18 + hit * 0.25 + front * 0.35) * m * vis;',
    '  col *= m * min(1.0, vis + front);',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 0.55));',
    '}',
  ].join('\n');
  function shieldMesh(pal) {
    const u = { uC0: { value: new T.Color(pal.core) }, uC1: { value: new T.Color(pal.flame) }, uC2: { value: new T.Color(pal.runeHi) },
      uTime: { value: 0 }, uAlpha: { value: 0 }, uForm: { value: 0 }, uIntegrity: { value: 1 }, uFlash: { value: 0 }, uPulse: { value: 0 }, uDissolve: { value: 1.2 },
      uHits: { value: [0, 1, 2, 3].map(() => new T.Vector4(0, 1, 0, -1)) } };
    const m = new T.Mesh(new T.SphereGeometry(1, 44, 28), new T.ShaderMaterial(MFX.premul({ uniforms: u, vertexShader: SHIELD_VS, fragmentShader: SHIELD_FS, side: T.DoubleSide })));
    m.renderOrder = 29; m.frustumCulled = false; m.visible = false;
    return m;
  }

  /* ---------------- lightning ribbons ---------------- */
  const BOLT_VS = 'attribute float aV; attribute float aL; attribute float aI; varying float vV; varying float vL; varying float vI; void main(){ vV = aV; vL = aL; vI = aI; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const BOLT_FS = [
    'uniform vec3 uCore; uniform vec3 uGlow; uniform float uAlpha;',
    'varying float vV; varying float vL; varying float vI;',
    'void main(){ float x = vV * 2.0 - 1.0;',
    '  float core = exp(-x * x * 7.0), glow = exp(-x * x * 2.6);',
    '  vec3 col = vL > 0.5 ? uCore * core * 1.7 : uGlow * glow * 0.75;',
    '  float a = (vL > 0.5 ? core * 0.35 : glow * 0.12) * vI * uAlpha;',
    '  gl_FragColor = vec4(col * vI * uAlpha, a); }',
  ].join('\n');
  class BoltMesh {
    constructor(maxSeg) {
      this.maxSeg = maxSeg;
      const nV = maxSeg * 2 * 4, geo = new T.BufferGeometry();
      this.P = new T.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(T.DynamicDrawUsage);
      this.V = new T.BufferAttribute(new Float32Array(nV), 1); this.L = new T.BufferAttribute(new Float32Array(nV), 1).setUsage(T.DynamicDrawUsage); this.I = new T.BufferAttribute(new Float32Array(nV), 1).setUsage(T.DynamicDrawUsage);
      const idx = [];
      for (let q = 0; q < maxSeg * 2; q++) { const a = q * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); for (let k = 0; k < 4; k++) this.V.array[a + k] = k & 1; }
      geo.setIndex(idx); geo.setAttribute('position', this.P); geo.setAttribute('aV', this.V); geo.setAttribute('aL', this.L); geo.setAttribute('aI', this.I);
      this.uni = { uCore: { value: new T.Color(0xffffff) }, uGlow: { value: new T.Color(0x7a9cff) }, uAlpha: { value: 1 } };
      this.mesh = new T.Mesh(geo, new T.ShaderMaterial(MFX.premul({ uniforms: this.uni, vertexShader: BOLT_VS, fragmentShader: BOLT_FS, side: T.DoubleSide })));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 33; this.mesh.visible = false;
    }
    /* paths: [{ pts: [Vector3...], w: width, i: intensity }] ; glow width = w * glowK */
    build(paths, cam, glowK) {
      const P = this.P.array, L = this.L.array, I = this.I.array;
      const d = new T.Vector3(), tc = new T.Vector3(), s = new T.Vector3();
      let q = 0;
      for (const path of paths) {
        const pts = path.pts;
        for (let k = 0; k < pts.length - 1 && q < this.maxSeg * 2 - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          d.subVectors(b, a); tc.subVectors(cam, a); s.crossVectors(d, tc).normalize();
          for (const layer of [0, 1]) {
            const w = layer ? path.w : path.w * (glowK || 6), o = q * 4;
            const ext = d.clone().normalize().multiplyScalar(w * 0.5);            // overlap the joints a little
            const a0 = a.clone().sub(ext), b0 = b.clone().add(ext);
            const sx = s.x * w, sy = s.y * w, sz = s.z * w;
            const V = [[a0.x + sx, a0.y + sy, a0.z + sz], [a0.x - sx, a0.y - sy, a0.z - sz], [b0.x + sx, b0.y + sy, b0.z + sz], [b0.x - sx, b0.y - sy, b0.z - sz]];
            for (let m = 0; m < 4; m++) { P[(o + m) * 3] = V[m][0]; P[(o + m) * 3 + 1] = V[m][1]; P[(o + m) * 3 + 2] = V[m][2]; L[o + m] = layer; I[o + m] = path.i; }
            q++;
          }
        }
      }
      this.P.needsUpdate = true; this.L.needsUpdate = true; this.I.needsUpdate = true;
      this.mesh.geometry.setDrawRange(0, q * 6);
      this.mesh.visible = q > 0;
    }
  }
  // jagged polyline by midpoint displacement (disp = fraction of segment length; yK scales the vertical jitter)
  function jagged(a, b, depth, disp, yK, out) {
    out = out || [a.clone()];
    const rec = (p, q, dd) => {
      if (dd === 0) { out.push(q.clone()); return; }
      const m = p.clone().lerp(q, 0.5 + M.rnd(0.12)), L = p.distanceTo(q) * disp;
      m.x += M.rnd(L); m.y += M.rnd(L * yK); m.z += M.rnd(L);
      rec(p, m, dd - 1); rec(m, q, dd - 1);
    };
    rec(a, b, depth);
    return out;
  }

  /* ---------------- crystal + rock geometry / materials ---------------- */
  function bipyramid(len, rad, sides, front, jitter, seed) {
    let s = seed || 1; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const ring = [];
    for (let k = 0; k < sides; k++) { const a = k / sides * M.TAU + (R() - 0.5) * jitter, r = rad * (1 + (R() - 0.5) * jitter); ring.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const tip = [0, 0, len * front], tail = [0, 0, -len * (1 - front)], P = [];
    for (let k = 0; k < sides; k++) {
      const a = ring[k], b = ring[(k + 1) % sides];
      P.push(a[0], a[1], 0, b[0], b[1], 0, ...tip);
      P.push(b[0], b[1], 0, a[0], a[1], 0, ...tail);
    }
    return P;
  }
  function geoFrom(arrs) {
    const all = [].concat(...arrs), g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(all, 3)); g.computeVertexNormals();
    return g;
  }
  function transformed(P, m) { const v = new T.Vector3(), out = []; for (let i = 0; i < P.length; i += 3) { v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(m); out.push(v.x, v.y, v.z); } return out; }
  // the ice spear: a long faceted lance (+Z forward) with three small crystals splayed at the back like fletching
  function spearGeometry() {
    const main = bipyramid(1.45, 0.12, 6, 0.62, 0.25, 7), parts = [main];
    for (let k = 0; k < 3; k++) {
      const m = new T.Matrix4().makeRotationZ(k * M.TAU / 3).multiply(new T.Matrix4().makeTranslation(0.05, 0, -0.32)).multiply(new T.Matrix4().makeRotationY(-0.42));
      parts.push(transformed(bipyramid(0.5, 0.055, 5, 0.6, 0.3, 11 + k), m));
    }
    return geoFrom(parts);
  }
  const shardGeometry = () => geoFrom([bipyramid(1, 0.22, 5, 0.6, 0.35, 23)]);
  function rockGeometry(seed) {
    const g = new T.IcosahedronGeometry(1, 1).toNonIndexed(), p = g.attributes.position, v = new T.Vector3();
    let s = seed || 3; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const off = {}; // same displacement for shared corners
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const k = v.x.toFixed(3) + v.y.toFixed(3) + v.z.toFixed(3);
      if (!off[k]) off[k] = 0.78 + R() * 0.38;
      v.multiplyScalar(off[k]); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }
  const INST_VS = [
    'varying vec3 vN; varying vec3 vV; varying vec3 vO; varying vec3 vC;',
    'void main(){ mat4 m = modelMatrix;',
    '#ifdef USE_INSTANCING',
    '  m = modelMatrix * instanceMatrix;',
    '#endif',
    '  vec4 w = m * vec4(position, 1.0); vO = position; vN = normalize(mat3(m) * normal); vV = normalize(cameraPosition - w.xyz); vC = vec3(1.0);',
    '#ifdef USE_INSTANCING_COLOR',
    '  vC = instanceColor;',
    '#endif',
    '  gl_Position = projectionMatrix * viewMatrix * w; }',
  ].join('\n');
  const CRYSTAL_FS = [
    'uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uRim; uniform float uAlpha; uniform float uGlow;',
    'varying vec3 vN; varying vec3 vV; varying vec3 vO; varying vec3 vC;',
    'void main(){ vec3 n = normalize(vN); float f = 1.0 - abs(dot(n, vV));',
    '  vec3 L = normalize(vec3(-0.4, 0.85, 0.35)); float d = max(dot(n, L), 0.0);',
    '  float spec = pow(max(dot(reflect(-L, n), vV), 0.0), 20.0);',
    '  vec3 col = mix(uDeep, uMid, d * 0.85 + 0.15) + uRim * pow(f, 1.6) * 1.3 + vec3(spec) * 1.1 + uMid * uGlow;',
    '  col *= vC; float a = uAlpha * (0.8 + 0.2 * f);',
    '  gl_FragColor = vec4(col * a, a); }',
  ].join('\n');
  const ROCK_FS = [
    'uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uDir; uniform float uHeat;',
    'varying vec3 vN; varying vec3 vV; varying vec3 vO; varying vec3 vC;',
    MFX.GLSL_NOISE,
    'void main(){ vec3 n = normalize(vN); float f = 1.0 - abs(dot(n, vV));',
    '  vec3 L = normalize(vec3(-0.4, 0.85, 0.35)); float d = max(dot(n, L), 0.0);',
    '  float cr = abs(mfxNoise3(vO * 5.5) - 0.5); float crack = 1.0 - smoothstep(0.015, 0.05, cr);',
    '  float heat = uHeat * vC.r; float lead = max(dot(n, uDir), 0.0);',
    '  vec3 rock = vec3(0.13, 0.09, 0.075) * (0.3 + 0.7 * d);',
    '  vec3 hot = mix(uC1, uC0, crack);',
    '  vec3 col = rock + hot * heat * (crack * 1.7 + pow(lead, 2.0) * 0.9 + pow(f, 2.0) * 0.5);',
    '  gl_FragColor = vec4(col, 1.0); }',
  ].join('\n');
  function crystalMaterial(pal) {
    return new T.ShaderMaterial(MFX.premul({ vertexShader: INST_VS, fragmentShader: CRYSTAL_FS, depthWrite: true,
      uniforms: { uDeep: { value: new T.Color(pal.deep) }, uMid: { value: new T.Color(pal.flame) }, uRim: { value: new T.Color(pal.core) }, uAlpha: { value: 0.92 }, uGlow: { value: 0.25 } } }));
  }
  function rockMaterial(pal) {
    return new T.ShaderMaterial({ vertexShader: INST_VS, fragmentShader: ROCK_FS,
      uniforms: { uC0: { value: new T.Color(pal.hot) }, uC1: { value: new T.Color(pal.deep) }, uDir: { value: new T.Vector3(0, -1, 0) }, uHeat: { value: 1 } } });
  }

  /* ---------------- instanced shard bursts (ice fragments, rock debris, planted ice splinters) ---------------- */
  const _q = new T.Quaternion(), _q2 = new T.Quaternion(), _m = new T.Matrix4(), _s = new T.Vector3(), _p = new T.Vector3(), _z = new T.Vector3(0, 0, 1), _c = new T.Color();
  class ShardBurst {
    constructor(scene, geo, mat, cap, opts) {
      this.cap = cap; this.opts = opts || {};
      this.mesh = new T.InstancedMesh(geo, mat, cap);
      this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
      this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = this.opts.order || 27;
      scene.add(this.mesh);
      this.items = [];
    }
    /* o: { p, v, size, life, spin, planted (dir), heat } */
    spawn(o) {
      if (this.items.length >= this.cap) return;
      const q0 = new T.Quaternion();
      if (o.dir) q0.setFromUnitVectors(_z, o.dir); else q0.setFromEuler(new T.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
      const axis = new T.Vector3(M.rnd(1), M.rnd(1), M.rnd(1)).normalize();
      this.items.push({ p: o.p.clone(), v: o.v ? o.v.clone() : new T.Vector3(), q0, axis, ang: 0, spin: o.spin || 0, size: o.size, life: o.life, t: 0,
        planted: !!o.planted, grow: o.grow || 0.07, bounces: 0, heat: o.heat === undefined ? 1 : o.heat, sink: o.sink || 0 });
    }
    update(dt) {
      const L = this.items, g = this.opts.grav === undefined ? -11 : this.opts.grav;
      let n = 0;
      for (let i = 0; i < L.length; i++) {
        const it = L[i]; it.t += dt;
        if (it.t >= it.life) continue;
        const u = it.t / it.life;
        let sc;
        if (it.planted) {
          sc = it.size * (it.t < it.grow ? M.easeOutBack(it.t / it.grow, 2.2) : 1) * (u > 0.75 ? 1 - M.easeIn((u - 0.75) / 0.25) * 0.85 : 1);
          _p.copy(it.p); if (u > 0.75) _p.y -= it.sink * (u - 0.75) / 0.25;
          _q.copy(it.q0);
        } else {
          it.v.y += g * dt;
          it.p.addScaledVector(it.v, dt);
          const floor = it.size * 0.25;
          if (it.p.y < floor && it.v.y < 0) {
            it.p.y = floor; it.bounces++;
            if (it.bounces < 2) { it.v.y *= -0.32; it.v.x *= 0.5; it.v.z *= 0.5; it.spin *= 0.5; } else { it.v.set(it.v.x * 0.3, 0, it.v.z * 0.3); it.spin *= 0.2; }
          }
          if (it.bounces >= 2) it.v.multiplyScalar(Math.exp(-6 * dt));
          it.ang += it.spin * dt;
          _q2.setFromAxisAngle(it.axis, it.ang); _q.copy(it.q0).premultiply(_q2);
          sc = it.size * Math.min(1, it.t / 0.04) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
          _p.copy(it.p);
        }
        _s.set(sc, sc, sc * (this.opts.stretch || 1));
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        const h = it.heat * (this.opts.cool ? Math.max(0, 1 - u * 1.4) : 1);
        this.mesh.setColorAt(n, _c.setRGB(h, h, h));
        L[n] = it; n++;
      }
      L.length = n;
      this.mesh.count = n;
      if (n) { this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
    }
    get count() { return this.items.length; }
  }

  /* ---------------- light pool ---------------- */
  class LightPool {
    constructor(scene, shared, n) {
      this.shared = !!shared;
      this.L = shared ? shared.slice(0, n) : Array.from({ length: n }, () => { const l = new T.PointLight(0xffffff, 0, 8, 2); scene.add(l); return l; });
      this.flashes = []; this.wants = []; this.k = 1; this.mine = this.L.map(() => -1);
    }
    flash(p, color, I, dur, dist) { this.flashes.push({ x: p.x, y: p.y, z: p.z, c: color, I, dur, t: 0, dist: dist || 8 }); }
    want(p, color, I, dist) { this.wants.push({ x: p.x, y: p.y, z: p.z, c: color, I, dist: dist || 7 }); }
    update(dt, maxLights) {
      const C = [];
      for (let i = this.flashes.length - 1; i >= 0; i--) {
        const F = this.flashes[i]; F.t += dt;
        if (F.t >= F.dur) { this.flashes.splice(i, 1); continue; }
        C.push({ x: F.x, y: F.y, z: F.z, c: F.c, I: F.I * Math.pow(1 - F.t / F.dur, 2), dist: F.dist });
      }
      for (const W of this.wants) C.push(W);
      this.wants.length = 0;
      C.sort((a, b) => b.I - a.I);
      for (let i = 0; i < this.L.length; i++) {
        const l = this.L[i], c = i < maxLights ? C[i] : null;
        // shared host lights: a host that drives them itself resets them every frame; if it does not (value still the one
        // we set last frame), we switch our own light back off when we no longer need it
        const ours = this.mine[i] >= 0 && Math.abs(l.intensity - this.mine[i]) < 1e-6;
        if (c && (!this.shared || ours || c.I * this.k > l.intensity)) { l.position.set(c.x, c.y, c.z); l.color.setHex(c.c); l.intensity = c.I * this.k; l.distance = c.dist; this.mine[i] = l.intensity; }
        else { if (!this.shared || ours) l.intensity = 0; this.mine[i] = -1; }
      }
    }
  }

  MFX.mesh = { flameMaterial, cylinder, FlameSurfaces, shieldMesh, BoltMesh, jagged, spearGeometry, shardGeometry, rockGeometry, crystalMaterial, rockMaterial, ShardBurst, LightPool };
})(typeof window !== 'undefined' ? window : globalThis);
