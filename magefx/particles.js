/* =====================================================================================================
 *  magefx/particles.js  -  pooled CPU particle simulation drawn as GPU-instanced billboards.
 *
 *  - Struct-of-arrays state, fixed capacity, free-list + dense active list (no allocation while playing).
 *  - Every particle is drawn by ONE of two instanced meshes (layer 0 = smoke / dust under, layer 1 = fire / glow
 *    over): the whole system costs 2 draw calls no matter how many spells are active.
 *  - Premultiplied blending with a per-particle "add" factor: 1 = pure additive glow, 0 = alpha-blended cover.
 *    Fire bodies sit in between so they keep their hue on the bright village sand instead of washing to white.
 *  - Billboards are camera facing with rotation, or stretched along their velocity (sparks, streaks).
 *  - Anchors: particles can ride along with a moving point (staff orb, body) and be pulled toward it (gathering).
 *  - Held particles: never age; the owner places them every frame (projectile heads, orbiting glyphs).
 *
 *  Specs (MageFX.spec) are built once and shared: life, size, colour gradient (3 stops), alpha envelope, drag,
 *  gravity, spin, atlas frames, additivity, stretch, layer.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE, MFX = global.MageFX;
  const d = (v, def) => (v === undefined ? def : v);

  MFX.spec = function (o) {
    const k = d(o.hdr, 1), cs = o.c || [0xffffff];
    return {
      life: o.life || [0.5, 0.5], size: o.size || [0.1, 0.1], grow: d(o.grow, 1),
      c0: MFX.rgb(cs[0], k), c1: MFX.rgb(d(cs[1], cs[0]), k), c2: MFX.rgb(d(cs[2], d(cs[1], cs[0])), k), mid: d(o.mid, 0.4),
      alpha: d(o.alpha, 1), fin: d(o.fin, 0.06), fout: d(o.fout, 1.2), drag: d(o.drag, 0), grav: d(o.grav, 0),
      spin: o.spin || [0, 0], rot: d(o.rot, null), frames: o.frames || [d(o.frame, 0)],
      add: d(o.add, 1), stretch: d(o.stretch, 0), layer: d(o.layer, 1), aspect: d(o.aspect, 1), bounce: !!o.bounce,
      attract: d(o.attract, 0), follow: d(o.follow, 1),
    };
  };

  const VS = [
    'attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iColor; attribute vec2 iSize; attribute vec4 iMisc;',
    'uniform float uCells;',
    'varying vec2 vUv; varying vec4 vColor; varying float vAdd;',
    'void main(){',
    '  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);',
    '  vec2 c = position.xy;',
    '  if (iMisc.w > 0.0) {',                                        // stretched along the on-screen velocity, head at the particle
    '    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;',
    '    vec2 ax = vv.xy; float L = length(ax);',
    '    ax = L > 1e-4 ? ax / L : vec2(0.0, 1.0);',
    '    vec2 pr = vec2(-ax.y, ax.x);',
    '    float len = iSize.y + L * iMisc.w;',
    '    mv.xy += pr * c.x * iSize.x + ax * (c.y - 0.5) * len;',
    '  } else {',
    '    vec2 sc = c * iSize; float s = sin(iMisc.x), co = cos(iMisc.x);',
    '    mv.xy += vec2(co * sc.x - s * sc.y, s * sc.x + co * sc.y);',
    '  }',
    '  gl_Position = projectionMatrix * mv;',
    '  float col = mod(iMisc.y, uCells), row = floor(iMisc.y / uCells + 0.001);',
    '  vUv = (vec2(col, uCells - 1.0 - row) + uv) / uCells;',
    '  vColor = iColor; vAdd = iMisc.z;',
    '}',
  ].join('\n');
  const FS = [
    'uniform sampler2D uMap; uniform float uBright;',
    'varying vec2 vUv; varying vec4 vColor; varying float vAdd;',
    'void main(){',
    '  vec4 t = texture2D(uMap, vUv);',
    '  float a = t.a * vColor.a;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vColor.rgb * t.rgb * a * uBright, a * (1.0 - vAdd));',
    '}',
  ].join('\n');

  class Particles {
    constructor(scene, atlas, capacity) {
      const N = this.N = capacity;
      this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
      this.life = new Float32Array(N); this.max = new Float32Array(N);
      this.s0 = new Float32Array(N); this.s1 = new Float32Array(N);
      this.rot = new Float32Array(N); this.spin = new Float32Array(N); this.frame = new Float32Array(N);
      this.spec = new Array(N); this.anc = new Int8Array(N).fill(-1);
      this.held = new Uint8Array(N); this.hA = new Float32Array(N); this.hC = new Float32Array(N * 3); this.hT = new Uint8Array(N);
      this.active = new Int32Array(N); this.slot = new Int32Array(N); this.nActive = 0;
      this.free = new Int32Array(N); for (let i = 0; i < N; i++) this.free[i] = N - 1 - i; this.nFree = N;
      this.anchors = [];
      this.uniforms = { uMap: { value: atlas }, uCells: { value: MFX.ATLAS_GRID }, uBright: { value: 1 } };
      this.batches = [0, 1].map((layer) => this._batch(scene, layer));
    }
    _batch(scene, layer) {
      const N = this.N, base = new T.PlaneGeometry(1, 1);
      const geo = new T.InstancedBufferGeometry();
      geo.setIndex(base.index); geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
      const A = (n) => new T.InstancedBufferAttribute(new Float32Array(N * n), n).setUsage(T.DynamicDrawUsage);
      const B = { pos: A(3), vel: A(3), col: A(4), size: A(2), misc: A(4), geo, n: 0 };
      geo.setAttribute('iPos', B.pos); geo.setAttribute('iVel', B.vel); geo.setAttribute('iColor', B.col); geo.setAttribute('iSize', B.size); geo.setAttribute('iMisc', B.misc);
      geo.instanceCount = 0;
      const mat = new T.ShaderMaterial(MFX.premul({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, depthTest: true }));
      B.mesh = new T.Mesh(geo, mat);
      B.mesh.frustumCulled = false; B.mesh.renderOrder = layer ? 32 : 30; B.mesh.visible = false;
      scene.add(B.mesh);
      return B;
    }

    /* ---- anchors: moving reference points (staff orb, body). Particles with an anchor move with it. ---- */
    anchor() { this.anchors.push({ x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 0, set: false }); return this.anchors.length - 1; }
    setAnchor(i, x, y, z) {
      const A = this.anchors[i];
      if (!A.set) { A.px = x; A.py = y; A.pz = z; A.set = true; }
      A.x = x; A.y = y; A.z = z;
    }

    get count() { return this.nActive; }

    spawn(S, x, y, z, vx, vy, vz, sMul, lMul, anchor) {
      if (this.nFree === 0) return -1;
      const i = this.free[--this.nFree];
      this.slot[i] = this.nActive; this.active[this.nActive++] = i;
      const i3 = i * 3;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx || 0; this.vel[i3 + 1] = vy || 0; this.vel[i3 + 2] = vz || 0;
      const L = (S.life[0] + Math.random() * (S.life[1] - S.life[0])) * (lMul || 1);
      this.life[i] = this.max[i] = L;
      const s = (S.size[0] + Math.random() * (S.size[1] - S.size[0])) * (sMul || 1);
      this.s0[i] = s; this.s1[i] = s * S.grow;
      this.rot[i] = S.rot === null ? Math.random() * 6.2832 : S.rot;
      this.spin[i] = S.spin[0] + Math.random() * (S.spin[1] - S.spin[0]);
      this.frame[i] = S.frames.length > 1 ? S.frames[(Math.random() * S.frames.length) | 0] : S.frames[0];
      this.spec[i] = S; this.anc[i] = anchor === undefined ? -1 : anchor; this.held[i] = 0; this.hT[i] = 0;
      return i;
    }
    kill(i) {
      const s = this.slot[i], last = this.active[--this.nActive];
      this.active[s] = last; this.slot[last] = s;
      this.free[this.nFree++] = i; this.held[i] = 0; this.anc[i] = -1; this.spec[i] = null;
    }
    /* ---- held particles: placed by their owner each frame ---- */
    hold(S, x, y, z, size) {
      const i = this.spawn(S, x, y, z, 0, 0, 0);
      if (i < 0) return -1;
      this.held[i] = 1; this.hA[i] = 0; this.s0[i] = size || this.s0[i];
      return i;
    }
    place(i, x, y, z, size, alpha, rot) {
      if (i < 0 || !this.held[i]) return;
      const i3 = i * 3; this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      if (size !== undefined) this.s0[i] = size;
      if (alpha !== undefined) this.hA[i] = alpha;
      if (rot !== undefined) this.rot[i] = rot;
    }
    aim(i, vx, vy, vz) { if (i < 0) return; const i3 = i * 3; this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz; }
    tint(i, rgb, k) { if (i < 0) return; const i3 = i * 3; k = k || 1; this.hC[i3] = rgb[0] * k; this.hC[i3 + 1] = rgb[1] * k; this.hC[i3 + 2] = rgb[2] * k; this.hT[i] = 1; }
    drop(i) { if (i >= 0 && this.held[i]) this.kill(i); return -1; }
    clear() { while (this.nActive) this.kill(this.active[this.nActive - 1]); }

    update(dt) {
      for (const A of this.anchors) { A.dx = A.x - A.px; A.dy = A.y - A.py; A.dz = A.z - A.pz; A.px = A.x; A.py = A.y; A.pz = A.z; }
      const P = this.pos, V = this.vel, B0 = this.batches[0], B1 = this.batches[1];
      let n0 = 0, n1 = 0;
      for (let k = 0; k < this.nActive; k++) {
        const i = this.active[k], S = this.spec[i], i3 = i * 3;
        let alpha, size, r, g, b;
        if (this.held[i]) {
          alpha = this.hA[i]; size = this.s0[i];
          if (this.hT[i]) { r = this.hC[i3]; g = this.hC[i3 + 1]; b = this.hC[i3 + 2]; } else { r = S.c0[0]; g = S.c0[1]; b = S.c0[2]; }
          if (alpha <= 0.001) continue;
        } else {
          const L = this.life[i] - dt;
          if (L <= 0) { this.kill(i); k--; continue; }
          this.life[i] = L;
          const u = 1 - L / this.max[i];
          let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
          if (S.drag) { const dr = Math.exp(-S.drag * dt); vx *= dr; vy *= dr; vz *= dr; }
          vy += S.grav * dt;
          let x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
          const an = this.anc[i];
          if (an >= 0) {
            const A = this.anchors[an];
            x += A.dx * S.follow; y += A.dy * S.follow; z += A.dz * S.follow;
            if (S.attract) { const f = S.attract * dt; vx += (A.x - x) * f; vy += (A.y - y) * f; vz += (A.z - z) * f; }
          }
          x += vx * dt; y += vy * dt; z += vz * dt;
          if (S.bounce && y < 0.02 && vy < 0) { y = 0.02; vy *= -0.32; vx *= 0.55; vz *= 0.55; }
          P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
          this.rot[i] += this.spin[i] * dt;
          const e = 1 - (1 - u) * (1 - u);
          size = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
          alpha = S.alpha * (u < S.fin ? u / S.fin : Math.pow(Math.max(0, 1 - (u - S.fin) / (1 - S.fin)), S.fout));
          const c0 = S.c0, c1 = S.c1, c2 = S.c2;
          if (u < S.mid) { const t = u / S.mid; r = c0[0] + (c1[0] - c0[0]) * t; g = c0[1] + (c1[1] - c0[1]) * t; b = c0[2] + (c1[2] - c0[2]) * t; }
          else { const t = (u - S.mid) / (1 - S.mid); r = c1[0] + (c2[0] - c1[0]) * t; g = c1[1] + (c2[1] - c1[1]) * t; b = c1[2] + (c2[2] - c1[2]) * t; }
        }
        const B = S.layer ? B1 : B0, n = S.layer ? n1++ : n0++;
        const o3 = n * 3, o4 = n * 4, o2 = n * 2;
        const bp = B.pos.array, bv = B.vel.array, bc = B.col.array, bs = B.size.array, bm = B.misc.array;
        bp[o3] = P[i3]; bp[o3 + 1] = P[i3 + 1]; bp[o3 + 2] = P[i3 + 2];
        bv[o3] = V[i3]; bv[o3 + 1] = V[i3 + 1]; bv[o3 + 2] = V[i3 + 2];
        bc[o4] = r; bc[o4 + 1] = g; bc[o4 + 2] = b; bc[o4 + 3] = alpha;
        bs[o2] = size * S.aspect; bs[o2 + 1] = size;
        bm[o4] = this.rot[i]; bm[o4 + 1] = this.frame[i]; bm[o4 + 2] = S.add; bm[o4 + 3] = S.stretch;
      }
      this._flush(B0, n0); this._flush(B1, n1);
    }
    _flush(B, n) {
      B.geo.instanceCount = n; B.mesh.visible = n > 0; B.n = n;
      if (!n) return;
      for (const [a, s] of [[B.pos, 3], [B.vel, 3], [B.col, 4], [B.size, 2], [B.misc, 4]]) { a.updateRange.offset = 0; a.updateRange.count = n * s; a.needsUpdate = true; }
    }
    dispose() { for (const B of this.batches) { B.mesh.parent && B.mesh.parent.remove(B.mesh); B.geo.dispose(); B.mesh.material.dispose(); } }
  }
  MFX.Particles = Particles;
})(typeof window !== 'undefined' ? window : globalThis);
