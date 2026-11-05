/* =====================================================================================================
 *  magefx/ground.js  -  ground decals and indicators (the most important layer for top-down readability).
 *
 *  Kinds (one shader, compiled per kind with a define; materials + meshes are pooled):
 *    sigil  - telegraph / feet sigil: school sigil texture, a CRISP edge ring exactly at the gameplay radius with a
 *             dark halo (contrast on bright ground), danger fill, cast-progress disk, angular "draw-in" reveal.
 *    ring   - expanding shockwave band: sharp outer front, soft inner wash (also used dark for dust / char rings).
 *    scorch - burnt blot + glowing Voronoi cracks that cool down (fire / lightning aftermath, pre-eruption cracks).
 *    frost  - pale crystalline patch: angular facet lines, spokes, twinkling glints.
 *    glow   - soft disk: fake light pool on the ground (additive) or a soft shadow blob (dark).
 *  Every decal gets an update(d, dt) callback that animates its uniforms; return false to end it.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE, MFX = global.MageFX;
  const KIND = { sigil: 1, ring: 2, scorch: 3, frost: 4, glow: 5 };

  const VS = 'varying vec2 vP; void main(){ vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const FS = [
    'uniform sampler2D uMap; uniform vec3 uColor; uniform vec3 uColor2; uniform vec3 uAccent;',
    'uniform float uAlpha, uR, uW, uFill, uRot, uInner, uEdgeW, uFillA, uPulse, uHeat, uDark, uSeed, uTime, uAdd, uPow, uReveal, uInnerA, uHot, uTexA;',
    'varying vec2 vP;',
    MFX.GLSL_NOISE,
    'void main(){',
    '  float r = length(vP);',
    '  vec3 rgb = vec3(0.0); float a = 0.0;',
    '#if KIND == 1',
    '  if (r > 1.1) discard;',
    '  float ang = atan(vP.x, vP.y);',                                // 0 at 12 o\'clock (far side), clockwise reveal
    '  float f = fract(ang / 6.2831853 + 1.0);',
    '  float rev = 1.0 - smoothstep(uReveal - 0.025, uReveal, f);',
    '  float cs = cos(uRot), sn = sin(uRot);',
    '  vec2 q = vec2(cs * vP.x - sn * vP.y, sn * vP.x + cs * vP.y) / uInner;',
    '  vec4 tx = texture2D(uMap, clamp(q * 0.5 + 0.5, 0.0, 1.0)) * step(length(q), 1.0) * uTexA;',
    '  float ed = abs(r - (1.0 - uEdgeW * 0.6));',
    '  float edge = 1.0 - smoothstep(uEdgeW * 0.35, uEdgeW * 0.75, ed);',
    '  float halo = 1.0 - smoothstep(uEdgeW * 0.7, uEdgeW * 3.2, ed);',
    '  float inside = 1.0 - smoothstep(0.985, 1.0, r);',
    '  float fill = uFillA * (0.55 + 0.45 * r * r) * inside;',          // danger tint, stronger toward the rim
    '  float prog = 0.0;',
    '  if (uFill > 0.001) prog = (step(r, uFill) * 0.14 + (1.0 - smoothstep(0.0, 0.03, abs(r - uFill))) * 0.7 * step(uFill, 0.995)) * inside;',
    '  rgb = uColor * (tx.r + fill * 0.9 + prog) + uAccent * tx.g * 1.15 + uColor2 * edge * (1.3 + uPulse);',
    '  float cover = tx.r * 0.42 + tx.g * 0.45 + edge * 0.55 + prog * 0.35;',
    '  float shade = halo * 0.38 * (1.0 - edge) + fill * 0.55;',      // darkening behind lines / inside the zone
    '  a = clamp(max(cover, shade), 0.0, 0.9);',
    '  rgb *= uAlpha * rev; a *= uAlpha * rev;',
    '#elif KIND == 2',
    '  float x = (r - uR) / max(uW, 0.001);',
    '  float front = x > 0.0 ? exp(-x * x * 7.0) : exp(-x * x * 1.4);',
    '  float trail = r < uR ? exp((r - uR) * uPow) * uInnerA : 0.0;',
    '  float hot = smoothstep(0.55, 1.0, front) * uHot;',
    '  float lim = 1.0 - smoothstep(0.96, 1.0, r);',
    '  rgb = (mix(uColor, vec3(1.0), hot) * front * 1.35 + uColor2 * trail) * lim * uAlpha;',
    '  a = clamp(front * 0.55 + trail * 0.7, 0.0, 1.0) * lim * uAlpha * (1.0 - uAdd);',
    '#elif KIND == 3',
    '  float n = mfxFbm(vP * 2.6 + uSeed);',
    '  float blot = 1.0 - smoothstep(0.3, 1.0, r + (n - 0.5) * 0.6);',
    '  float ang = atan(vP.y, vP.x);',
    '  float rays = pow(abs(sin(ang * 4.0 + n * 5.0 + uSeed)), 7.0) * (1.0 - smoothstep(0.15, 1.0, r));',
    '  float e = mfxCellEdge(vP * 3.3 + uSeed * 1.7);',
    '  float crack = (1.0 - smoothstep(0.015, 0.06, e)) * (1.0 - smoothstep(0.25, 0.9, r + (n - 0.5) * 0.35));',
    '  float coreHeat = 1.0 - smoothstep(0.0, 0.6, r);',
    '  vec3 hot = mix(uColor2, uColor, uHeat);',
    '  rgb = hot * (crack * 1.7 + coreHeat * 0.4 * blot) * uHeat * uAlpha;',
    '  a = clamp((blot * 0.8 + rays * 0.3) * uDark, 0.0, 0.92) * (1.0 - smoothstep(0.92, 1.0, r)) * uAlpha;',
    '#elif KIND == 4',
    '  float n = mfxFbm(vP * 2.2 + uSeed);',
    '  float area = 1.0 - smoothstep(0.4, 1.0, r + (n - 0.5) * 0.65);',
    '  float e = mfxCellEdge(vP * 2.9 + uSeed);',
    '  float lines = (1.0 - smoothstep(0.012, 0.045, e)) * area;',
    '  float ang = atan(vP.y, vP.x);',
    '  float spokes = pow(abs(cos(ang * 3.0 + uSeed)), 42.0) * (1.0 - smoothstep(0.05, 0.95, r));',
    '  float h = mfxHash(floor(vP * 15.0) + uSeed);',
    '  float glint = step(0.94, h) * (0.5 + 0.5 * sin(uTime * 7.0 + h * 50.0)) * area;',
    '  rgb = (uColor * (area * 0.32 + lines * 0.95 + spokes * 0.8) + vec3(glint)) * uAlpha;',
    '  a = clamp(area * 0.45 + lines * 0.35 + spokes * 0.3, 0.0, 0.9) * uAlpha;',
    '#else',
    '  float f = pow(max(0.0, 1.0 - r), uPow);',
    '  rgb = uColor * f * uAlpha; a = f * uAlpha * (1.0 - uAdd);',
    '#endif',
    '  if (a < 0.002 && rgb.r + rgb.g + rgb.b < 0.003) discard;',
    '  gl_FragColor = vec4(rgb, a);',
    '}',
  ].join('\n');

  class Ground {
    constructor(scene, tex) {
      this.scene = scene; this.tex = tex;
      this.flat = new T.PlaneGeometry(1, 1); this.flat.rotateX(-Math.PI / 2);
      this.vert = new T.PlaneGeometry(1, 1);
      this.pools = {}; this.list = []; this.seq = 0; this.time = 0;
    }
    _make(kind) {
      const u = {};
      for (const k of ['uAlpha', 'uR', 'uW', 'uFill', 'uRot', 'uPulse', 'uHeat', 'uDark', 'uSeed', 'uTime', 'uAdd', 'uInnerA', 'uHot']) u[k] = { value: 0 };
      Object.assign(u, { uMap: { value: this.tex.sigils.fire }, uColor: { value: new T.Color() }, uColor2: { value: new T.Color() }, uAccent: { value: new T.Color() },
        uInner: { value: 0.94 }, uEdgeW: { value: 0.035 }, uFillA: { value: 0 }, uPow: { value: 2 }, uReveal: { value: 1.1 }, uTexA: { value: 1 } });
      const mat = new T.ShaderMaterial(MFX.premul({ uniforms: u, vertexShader: VS, fragmentShader: FS, defines: { KIND: KIND[kind] },
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
      const mesh = new T.Mesh(this.flat, mat);
      mesh.renderOrder = kind === 'glow' ? 6 : 5; mesh.frustumCulled = false;
      if (global.VfxConform) global.VfxConform.attach(mesh, { seg: 16 });   // [conform] own subdivided flat that lies on slopes (vfx/conform.js)
      return { mesh, u, kind, cflat: mesh.geometry };
    }
    /* add(kind, { x, z, r, y?, vertical?, life?, update(d, dt) -> false to end, ...uniform presets }) */
    add(kind, o) {
      const P = this.pools[kind] || (this.pools[kind] = []);
      const D = P.pop() || this._make(kind);
      const u = D.u;
      u.uAlpha.value = o.alpha === undefined ? 1 : o.alpha; u.uR.value = 0; u.uW.value = o.w || 0.06; u.uFill.value = 0; u.uRot.value = o.rot || 0;
      u.uPulse.value = 0; u.uHeat.value = o.heat === undefined ? 1 : o.heat; u.uDark.value = o.dark === undefined ? 0.8 : o.dark; u.uSeed.value = Math.random() * 40;
      u.uAdd.value = o.add === undefined ? 1 : o.add; u.uInnerA.value = o.innerA || 0; u.uHot.value = o.hot === undefined ? 0.8 : o.hot;
      u.uColor.value.setHex(o.color === undefined ? 0xffffff : o.color); u.uColor2.value.setHex(o.color2 === undefined ? (o.color === undefined ? 0xffffff : o.color) : o.color2);
      u.uAccent.value.setHex(o.accent === undefined ? 0xffffff : o.accent);
      u.uInner.value = o.inner || 0.94; u.uEdgeW.value = o.edgeW || 0.035; u.uFillA.value = o.fillA || 0; u.uPow.value = o.pow || 2;
      u.uReveal.value = o.reveal === undefined ? 1.1 : o.reveal; u.uTexA.value = o.texA === undefined ? 1 : o.texA;
      if (o.map) u.uMap.value = o.map;
      D.mesh.geometry = o.vertical ? this.vert : (D.cflat || this.flat);   // [conform] (cflat = this.flat without the open world)
      D.mesh.quaternion.identity();
      const y = o.y === undefined ? 0.022 + (this.seq++ % 10) * 0.0025 : o.y;
      D.mesh.position.set(o.x, y, o.z); D.mesh.scale.setScalar((o.r || 1) * 2);
      Object.assign(D, { x: o.x, z: o.z, r: o.r || 1, t: 0, life: o.life || 0, update: o.update || null, dead: false, data: o.data || {} });
      this.scene.add(D.mesh); this.list.push(D);
      return D;
    }
    resize(D, r) { D.r = r; D.mesh.scale.setScalar(r * 2); }
    move(D, x, z) { D.x = x; D.z = z; D.mesh.position.x = x; D.mesh.position.z = z; }
    kill(D) { D.dead = true; }
    update(dt, time) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const D = this.list[i];
        D.t += dt; D.u.uTime.value = time;
        let keep = !D.dead;
        if (keep && D.update) keep = D.update(D, dt) !== false;
        if (keep && D.life && D.t >= D.life) keep = false;
        if (!keep) { this.scene.remove(D.mesh); this.list.splice(i, 1); this.pools[D.kind].push(D); }
      }
    }
    get count() { return this.list.length; }
  }
  MFX.Ground = Ground;
})(typeof window !== 'undefined' ? window : globalThis);
