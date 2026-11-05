/* =====================================================================================================
 *  magefx/trails.js  -  pooled ribbon trails: camera-facing tapered strips that follow a moving point.
 *  Time based: each sample remembers when it was laid; samples older than `life` are cut (with an
 *  interpolated tail, so the end never pops). After stop() the head stays put and the ribbon drains away.
 *  Shader: head -> tail colour ramp, hot core line, optional scrolling noise breakup (flame streaks).
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE, MFX = global.MageFX;

  const VS = 'attribute vec2 aUv; varying vec2 vUv; void main(){ vUv = aUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const FS = [
    'uniform vec3 uC0; uniform vec3 uC1; uniform float uAlpha; uniform float uAdd; uniform float uNoise; uniform float uTime; uniform float uCore; uniform float uSeed;',
    'varying vec2 vUv;',
    MFX.GLSL_NOISE,
    'void main(){',
    '  float u = vUv.x, across = 1.0 - abs(vUv.y * 2.0 - 1.0);',
    '  float body = smoothstep(0.0, 0.75, across);',
    '  float core = pow(across, 5.0) * uCore;',
    '  float n = mfxNoise(vec2(u * 10.0 - uTime * 9.0 + uSeed, vUv.y * 2.6 + uTime * 1.3));',
    '  float br = mix(1.0, smoothstep(0.2, 0.75, n * (1.25 - u) + 0.3 * (1.0 - u)), uNoise);',
    '  float a = body * pow(1.0 - u, 1.4) * br * uAlpha;',
    '  vec3 col = mix(uC1, uC0, pow(1.0 - u, 1.3)) + vec3(core * (1.0 - u));',
    '  gl_FragColor = vec4(col * a, a * (1.0 - uAdd));',
    '}',
  ].join('\n');

  class Trail {
    constructor(maxPts) {
      this.max = maxPts;
      this.px = new Float32Array(maxPts); this.py = new Float32Array(maxPts); this.pz = new Float32Array(maxPts); this.pt = new Float32Array(maxPts);
      this.n = 0;
      const geo = new T.BufferGeometry();
      this.posA = new T.BufferAttribute(new Float32Array(maxPts * 2 * 3), 3).setUsage(T.DynamicDrawUsage);
      this.uvA = new T.BufferAttribute(new Float32Array(maxPts * 2 * 2), 2).setUsage(T.DynamicDrawUsage);
      const idx = [];
      for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx); geo.setAttribute('position', this.posA); geo.setAttribute('aUv', this.uvA);
      this.uni = { uC0: { value: new T.Color() }, uC1: { value: new T.Color() }, uAlpha: { value: 1 }, uAdd: { value: 1 }, uNoise: { value: 0 }, uTime: { value: 0 }, uCore: { value: 1 }, uSeed: { value: 0 } };
      this.mesh = new T.Mesh(geo, new T.ShaderMaterial(MFX.premul({ uniforms: this.uni, vertexShader: VS, fragmentShader: FS, side: T.DoubleSide })));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 31; this.mesh.visible = false;
      this.live = false;
    }
    start(o, now) {
      this.n = 0; this.live = true; this.stopped = false;
      this.life = o.life || 0.2; this.width = o.width || 0.2; this.taper = o.taper === undefined ? 1 : o.taper; this.minDist = o.minDist || 0.08;
      this.uni.uC0.value.setHex(o.c0); this.uni.uC1.value.setHex(o.c1 === undefined ? o.c0 : o.c1);
      this.uni.uAlpha.value = o.alpha === undefined ? 1 : o.alpha; this.uni.uAdd.value = o.add === undefined ? 1 : o.add;
      this.uni.uNoise.value = o.noise || 0; this.uni.uCore.value = o.core === undefined ? 1 : o.core; this.uni.uSeed.value = Math.random() * 50;
      this.alphaMul = 1; this.now = now;
    }
    /* add the current head position; samples closer than minDist just move the head */
    push(x, y, z, now) {
      if (this.stopped) return;
      if (now === undefined) now = this.pool.now;
      if (this.n > 1) {
        const dx = x - this.px[1], dy = y - this.py[1], dz = z - this.pz[1];
        if (dx * dx + dy * dy + dz * dz < this.minDist * this.minDist) { this.px[0] = x; this.py[0] = y; this.pz[0] = z; this.pt[0] = now; return; }
      }
      const m = Math.min(this.n, this.max - 1);
      for (let i = m; i > 0; i--) { this.px[i] = this.px[i - 1]; this.py[i] = this.py[i - 1]; this.pz[i] = this.pz[i - 1]; this.pt[i] = this.pt[i - 1]; }
      this.px[0] = x; this.py[0] = y; this.pz[0] = z; this.pt[0] = now;
      this.n = Math.min(this.n + 1, this.max);
    }
    /* lay a whole line at once (instant streaks): from (older) -> to (newer) over `span` seconds of age */
    line(a, b, span, steps) {
      const now = this.pool.now; this.n = 0;
      for (let k = 0; k <= steps; k++) { const t = k / steps; this.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, now - span * (1 - t)); }
    }
    stop() { this.stopped = true; }
    build(cam, now) {
      // drop expired samples, keep one beyond the cut for the interpolated tail
      let n = this.n;
      while (n > 1 && now - this.pt[n - 2] > this.life) n--;
      this.n = n;
      if (n < 2 || (this.stopped && now - this.pt[0] > this.life)) { this.mesh.visible = false; if (this.stopped) this.live = false; return; }
      const P = this.posA.array, U = this.uvA.array;
      const tmp = MFX._tv || (MFX._tv = [new T.Vector3(), new T.Vector3(), new T.Vector3()]), tg = tmp[0], tc = tmp[1], sd = tmp[2];
      for (let i = 0; i < n; i++) {
        let x = this.px[i], y = this.py[i], z = this.pz[i], age = (now - this.pt[i]) / this.life;
        if (i === n - 1 && age > 1) {                               // interpolated tail exactly at age = life
          const ap = (now - this.pt[i - 1]) / this.life, f = (1 - ap) / Math.max(1e-4, age - ap);
          x = this.px[i - 1] + (x - this.px[i - 1]) * f; y = this.py[i - 1] + (y - this.py[i - 1]) * f; z = this.pz[i - 1] + (z - this.pz[i - 1]) * f; age = 1;
        }
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        tg.set(this.px[a] - this.px[b], this.py[a] - this.py[b], this.pz[a] - this.pz[b]);
        tc.set(cam.x - x, cam.y - y, cam.z - z);
        sd.crossVectors(tg, tc); const l = sd.length() || 1;
        const w = this.width * 0.5 * Math.pow(Math.max(0, 1 - age), this.taper) * Math.min(1, 0.45 + i * 0.35);
        sd.multiplyScalar(w / l);
        const o = i * 6;
        P[o] = x + sd.x; P[o + 1] = y + sd.y; P[o + 2] = z + sd.z; P[o + 3] = x - sd.x; P[o + 4] = y - sd.y; P[o + 5] = z - sd.z;
        const q = i * 4; U[q] = Math.min(1, age); U[q + 1] = 0; U[q + 2] = Math.min(1, age); U[q + 3] = 1;
      }
      this.posA.updateRange.offset = 0; this.posA.updateRange.count = n * 6; this.posA.needsUpdate = true;
      this.uvA.updateRange.offset = 0; this.uvA.updateRange.count = n * 4; this.uvA.needsUpdate = true;
      this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
      this.mesh.visible = true;
    }
  }

  class Trails {
    constructor(scene, camera, maxPts) {
      this.scene = scene; this.camera = camera; this.maxPts = maxPts; this.pool = []; this.list = []; this.now = 0;
    }
    get(o) {
      let tr = this.pool.pop();
      if (!tr) { tr = new Trail(this.maxPts); this.scene.add(tr.mesh); }
      tr.pool = this; tr.start(o, this.now); this.list.push(tr);
      return tr;
    }
    update(dt, time) {
      this.now += dt;
      const cam = this.camera.position;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const tr = this.list[i];
        tr.uni.uTime.value = time;
        tr.build(cam, this.now);
        if (!tr.live) { tr.mesh.visible = false; this.list.splice(i, 1); this.pool.push(tr); }
      }
    }
    get count() { return this.list.length; }
  }
  MFX.Trails = Trails;
})(typeof window !== 'undefined' ? window : globalThis);
