/* =====================================================================================================
 *  village/atmosphere.js  -  mystic forest atmosphere (colour, air, light) for the village zone
 *
 *  Reference analysis (2026-11-05, relit "Classic+" MMO screenshots): the look comes from the AIR, not the
 *  models - per-zone tinted depth fog that eats the distance early, ground mist pockets you walk through,
 *  warm low sun against cool blue-teal shadows, god rays in the mist, soft painted sky, glowing life in the
 *  dark under the canopy, and a vignette that keeps the eye in the middle.
 *
 *  - Global fog chunk patch (built-in materials only, no custom shader uses the fog chunks): depth fog with
 *    a sun-scatter tint + analytic exponential HEIGHT fog (ground mist) whose density drifts in pockets and
 *    is thicker outside the walls. Shared uniforms are injected into ShaderLib with self-returning clone()
 *    so every material reads the same live values.
 *  - Painted sky dome (zenith / horizon / sun glow / slow cloud bands) that meets the fog colour exactly.
 *  - Light grade: hemisphere, sun, rim colours / intensities; lower golden sun (longer, dappled shadows).
 *  - Fireflies + mushroom glows (one Points draw), god-ray shafts (one InstancedMesh), CSS vignette.
 *  ?atmo=0 = the old look.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const Q = new URLSearchParams(location.search);
  const A = V.Atmosphere = { on: Q.get('atmo') !== '0' };
  if (!A.on) return;
  const TAU = Math.PI * 2;

  /* ------------------------------------------ palette ------------------------------------------ */
  const P = A.P = {
    zenith: 0x2f5f8e, horizon: 0x93b3bf, below: 0x4a6458,       // sky dome
    fog: 0x8aaab6, fogNear: 22, fogFar: 175,                     // depth fog (= horizon haze)
    sunScatter: 0xffd3a0, scatterPow: 5.0,                      // warm haze toward the sun
    mist: 0x86aab8, mistDensity: 0.07, mistFalloff: 0.25, mistPockets: 0.75,   // ground mist (height fog)
    hemiSky: 0x9fc0e6, hemiGround: 0x47583a, hemiI: 0.74,      // bright, blue-tinted shade (painted look, never black)
    sun: 0xffd9a6, sunI: 0.95, rim: 0x86a6e8, rimI: 0.36,
  };
  A.SUN_DIR = new T.Vector3(-0.58, 0.6, 0.55).normalize();   // toward the sun: low golden afternoon from the south-west

  /* ------------------------------------------ fog chunk patch ------------------------------------------ */
  class SharedV4 extends T.Vector4 { clone() { return this; } }
  const U = A.uniforms = {
    atmoA: { value: new SharedV4() },   // sun dir xyz, time
    atmoB: { value: new SharedV4() },   // mist density, falloff, pocket strength, village half size
    atmoC: { value: new SharedV4() },   // sun scatter rgb, scatter power
    atmoD: { value: new SharedV4() },   // mist rgb, enabled
  };
  A.install = function () {
    if (A.installed) return; A.installed = true;
    const C = T.ShaderChunk;
    C.fog_pars_vertex = '#ifdef USE_FOG\n varying float fogDepth;\n varying vec3 vFogWorld;\n#endif\n';
    C.fog_vertex = '#ifdef USE_FOG\n fogDepth = - mvPosition.z;\n vFogWorld = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif\n';
    C.fog_pars_fragment = [
      '#ifdef USE_FOG',
      ' uniform vec3 fogColor;', ' varying float fogDepth;', ' varying vec3 vFogWorld;',
      ' uniform vec4 atmoA; uniform vec4 atmoB; uniform vec4 atmoC; uniform vec4 atmoD;',
      ' #ifdef FOG_EXP2', '  uniform float fogDensity;', ' #else', '  uniform float fogNear;', '  uniform float fogFar;', ' #endif',
      '#endif',
    ].join('\n');
    C.fog_fragment = [
      '#ifdef USE_FOG',
      ' #ifdef FOG_EXP2',
      '  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );',
      ' #else',
      '  float fogFactor = smoothstep( fogNear, fogFar, fogDepth );',
      ' #endif',
      ' if ( atmoD.w > 0.5 ) {',
      '  vec3 rv = vFogWorld - cameraPosition; float dist = length( rv ); vec3 rd = rv / max( dist, 1e-3 );',
      '  float sunA = pow( max( dot( rd, atmoA.xyz ), 0.0 ), atmoC.w );',
      // depth fog: softer start, eats the distance into the horizon haze, warm toward the sun
      '  float df = 1.0 - exp( - pow( max( fogDepth - fogNear, 0.0 ) / max( fogFar - fogNear, 1.0 ), 1.35 ) * 2.6 );',
      // ground mist: analytic exponential height fog along the view ray; density drifts in pockets and is
      // thicker in the forest outside the walls (pockets you walk through)
      '  vec2 wp = vFogWorld.xz; float t = atmoA.w;',
      '  float pk = 0.5 + 0.28 * sin( wp.x * 0.061 + t * 0.07 ) * sin( wp.y * 0.053 - t * 0.05 ) + 0.22 * sin( wp.x * 0.017 - wp.y * 0.021 + t * 0.03 );',
      '  float outW = smoothstep( 0.0, 26.0, max( abs( wp.x ), abs( wp.y ) ) - atmoB.w );',
      '  float dens = atmoB.x * mix( 0.35, 1.0, outW ) * mix( 1.0 - atmoB.z * 0.5, 1.0 + atmoB.z * 0.6, pk );',
      '  float b = atmoB.y, k = b * rd.y;',
      '  float hint = abs( k ) < 1e-4 ? dist : ( 1.0 - exp( - dist * k ) ) / k;',
      '  float hf = 1.0 - exp( - dens * exp( - b * max( cameraPosition.y, 0.0 ) ) * hint );',
      '  hf = min( hf, 0.62 ) * smoothstep( 3.0, 34.0, dist );',
      '  vec3 fogCol = mix( fogColor, atmoC.rgb, sunA * 0.55 );',
      '  vec3 mistCol = mix( atmoD.rgb, atmoC.rgb, sunA * 0.35 );',
      '  gl_FragColor.rgb = mix( gl_FragColor.rgb, mistCol, hf );',
      '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, df );',
      ' } else {',
      '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
      ' }',
      '#endif',
    ].join('\n');
    for (const k in T.ShaderLib) { const S = T.ShaderLib[k]; if (S.uniforms && S.uniforms.fogColor) Object.assign(S.uniforms, U); }
  };

  /* ------------------------------------------ sky dome ------------------------------------------ */
  function sky() {
    const g = new T.SphereGeometry(400, 48, 24);   // inside camera.far (520)
    const mat = new T.ShaderMaterial({
      uniforms: { uZen: { value: new T.Color(P.zenith) }, uHor: { value: new T.Color(P.horizon) }, uBelow: { value: new T.Color(P.below) },
        uSun: { value: new T.Color(P.sunScatter) }, uSunDir: { value: A.SUN_DIR }, uTime: V.time },
      // at the far plane and drawn after the opaque world: early-z skips every pixel that is not sky (the cloud fbm is not free)
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: [
        'uniform vec3 uZen, uHor, uBelow, uSun, uSunDir; uniform float uTime; varying vec3 vDir;',
        'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
        'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
        'float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }',
        'void main(){',
        ' vec3 d = normalize(vDir); float y = d.y;',
        ' vec3 col = y > 0.0 ? mix(uHor, uZen, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHor, uBelow, clamp(-y * 5.0, 0.0, 1.0));',
        ' float s = max(dot(d, uSunDir), 0.0);',
        ' col += uSun * (pow(s, 5.0) * 0.32 + pow(s, 48.0) * 0.45 + pow(s, 900.0) * 1.6);',
        // painted cloud bands: stretched fbm on the dome, lit warm toward the sun, cool on the far side
        ' vec2 cp = d.xz / (y + 0.22) * vec2(0.9, 2.2) + vec2(uTime * 0.006, uTime * 0.002);',
        ' float c = fbm(cp * 1.4); c = smoothstep(0.5, 0.82, c) * smoothstep(0.0, 0.18, y) * (1.0 - smoothstep(0.55, 0.95, y));',
        ' vec3 cc = mix(uHor * 1.08 + 0.04, uSun * 1.05, pow(s, 3.0) * 0.8);',
        ' col = mix(col, cc, c * 0.6);',
        ' gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
      side: T.BackSide, depthWrite: false, fog: false,
    });
    const m = new T.Mesh(g, mat);
    m.renderOrder = 50; m.name = 'village_sky'; m.frustumCulled = false;
    m.onBeforeRender = function (r, sc, cam) { this.position.copy(cam.position); if (this.parent) this.position.y -= this.parent.position.y; this.updateMatrixWorld(); };   // (vertical frame: cancel the group's -yBase shift)
    return m;
  }

  /* ------------------------------------------ fireflies + glows (one Points draw) ------------------------------------------ */
  function motes(spots, field, R) {
    const pos = [], seed = [], col = [];
    const cA = new T.Color(0x9cf7e8), cB = new T.Color(0xffd98a), tmp = new T.Color();
    // drifting fireflies in the forest band
    for (const p of field) { pos.push(p[0], p[1], p[2]); seed.push(R() * TAU, 0.35 + R() * 0.6, 0.6 + R() * 1.6, 0); tmp.copy(R() < 0.7 ? cA : cB); col.push(tmp.r, tmp.g, tmp.b); }
    // static glows over mushroom clusters / titan roots (kind 1 = bigger, slow pulse)
    for (const s of spots) { pos.push(s[0], s[1], s[2]); seed.push(R() * TAU, 0.6 + R() * 0.5, 0, 1); tmp.set(s[4] !== undefined ? s[4] : 0x7fe8ff); col.push(tmp.r, tmp.g, tmp.b); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new T.Float32BufferAttribute(seed, 4));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    const mat = new T.ShaderMaterial({
      uniforms: { uTime: V.time, uScale: { value: 600 } },
      vertexShader: [
        'attribute vec4 aSeed; attribute vec3 color; uniform float uTime; uniform float uScale; varying vec3 vCol; varying float vA;',
        'void main(){',
        ' float t = uTime * aSeed.y + aSeed.x;',
        ' vec3 p = position;',
        ' if (aSeed.w < 0.5) p += vec3(sin(t) * aSeed.z, sin(t * 1.7) * 0.35 + sin(t * 0.45) * 0.5, cos(t * 0.8) * aSeed.z);',
        ' vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        ' float d = -mv.z;',
        ' float tw = aSeed.w < 0.5 ? smoothstep(-0.2, 0.9, sin(t * 2.3 + aSeed.x * 3.0)) : 0.75 + 0.25 * sin(t * 1.3);',
        ' vA = tw * smoothstep(2.0, 5.0, d) * (1.0 - smoothstep(38.0, 62.0, d));',
        ' vCol = color;',
        ' gl_PointSize = (aSeed.w < 0.5 ? 0.16 : 0.9) * uScale / max(d, 0.5);',
        ' gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vCol; varying float vA;',
        'void main(){ vec2 q = gl_PointCoord - 0.5; float r2 = dot(q, q) * 4.0; float a = exp(-r2 * 3.5) * vA; float core = exp(-r2 * 18.0);',
        ' gl_FragColor = vec4(vCol * (0.75 + core * 0.9), a); }   // AdditiveBlending = SRC_ALPHA, ONE: colour is not premultiplied',
      ].join('\n'),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    });
    const pts = new T.Points(g, mat);
    pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'atmo_motes';
    return pts;
  }

  /* ------------------------------------------ god rays (crossed quads tilted along the sun) ------------------------------------------ */
  function shafts(spots) {
    const g = new T.BufferGeometry();
    const p = [], uv = [];
    for (const a of [0, Math.PI / 2]) {           // two crossed planes, 1 x 1, base at y = 0
      const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
      p.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 0, -cz, cx, 1, cz, -cx, 1, -cz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    const mat = new T.ShaderMaterial({
      uniforms: { uTime: V.time, uCol: { value: new T.Color(0xffe2b0) }, uSunDir: { value: A.SUN_DIR } },
      vertexShader: [
        'uniform float uTime; varying vec2 vUv; varying float vF; varying float vSeed;',
        'void main(){',
        ' vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);',
        ' vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
        ' vUv = uv; vSeed = fract(ip.x * 0.137 + ip.z * 0.311);',
        ' float dc = distance(wp.xyz, cameraPosition);',
        ' vF = smoothstep(4.0, 12.0, dc) * (1.0 - smoothstep(55.0, 95.0, dc));',
        ' gl_Position = projectionMatrix * viewMatrix * wp;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime; uniform vec3 uCol; varying vec2 vUv; varying float vF; varying float vSeed;',
        'void main(){',
        ' float edge = sin(vUv.x * 3.14159); edge *= edge;',
        ' float v = vUv.y; float along = smoothstep(0.0, 0.18, v) * (1.0 - smoothstep(0.62, 1.0, v));',
        ' float streak = 0.55 + 0.45 * sin(vUv.x * 19.0 + vSeed * 30.0 + uTime * 0.25) * sin(vUv.x * 7.0 - uTime * 0.17 + vSeed * 11.0);',
        ' float pulse = 0.7 + 0.3 * sin(uTime * 0.3 + vSeed * 40.0);',
        ' float a = edge * along * streak * pulse * vF * 0.2;',
        ' gl_FragColor = vec4(uCol, a);',
        '}',
      ].join('\n'),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    });
    const im = new T.InstancedMesh(g, mat, spots.length);
    // tilt the column so its top points toward the sun (light falls along -SUN_DIR)
    const up = new T.Vector3(0, 1, 0), q = new T.Quaternion().setFromUnitVectors(up, A.SUN_DIR.clone()), qy = new T.Quaternion(), m = new T.Matrix4(), s = new T.Vector3(), pp = new T.Vector3();
    spots.forEach((sp, i) => {
      qy.setFromAxisAngle(up, sp[3]);
      const qq = q.clone().multiply(qy);
      s.set(sp[4], sp[5], sp[4]); pp.set(sp[0], sp[1], sp[2]);
      m.compose(pp, qq, s); im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.renderOrder = 6; im.name = 'atmo_shafts';
    return im;
  }

  /* ------------------------------------------ vignette (DOM, under the HUD) ------------------------------------------ */
  function vignette() {
    if (document.getElementById('atmo-vignette')) return;
    const d = document.createElement('div'); d.id = 'atmo-vignette';
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;' +
      'background:radial-gradient(ellipse 75% 70% at 50% 46%, rgba(0,0,0,0) 58%, rgba(10,22,30,0.22) 82%, rgba(6,14,22,0.5) 100%);';
    const cv = document.querySelector('canvas'); if (cv && cv.parentNode) cv.parentNode.insertBefore(d, cv.nextSibling); else document.body.appendChild(d);
  }

  /* ------------------------------------------ apply to a scene ------------------------------------------ */
  // ctx: { scene, group, lights {hemi, sun, rim}, camera, cfg, forest (placed giants), walk, terrain, R }
  A.apply = function (ctx) {
    A.install();
    const { scene, group, lights } = ctx;
    scene.background = new T.Color(P.horizon);
    scene.fog = new T.Fog(P.fog, P.fogNear, P.fogFar);
    U.atmoA.value.set(A.SUN_DIR.x, A.SUN_DIR.y, A.SUN_DIR.z, 0);
    U.atmoB.value.set(P.mistDensity, P.mistFalloff, P.mistPockets, ctx.cfg.half + ctx.cfg.wallThick + 4);
    const sc = new T.Color(P.sunScatter), mc = new T.Color(P.mist);
    U.atmoC.value.set(sc.r, sc.g, sc.b, P.scatterPow);
    U.atmoD.value.set(mc.r, mc.g, mc.b, 1);
    group.add(sky());
    if (lights.hemi) { lights.hemi.color.setHex(P.hemiSky); lights.hemi.groundColor.setHex(P.hemiGround); lights.hemi.intensity = P.hemiI; }
    if (lights.sun) { lights.sun.color.setHex(P.sun); lights.sun.intensity = P.sunI; }
    if (lights.rim) { lights.rim.color.setHex(P.rim); lights.rim.intensity = P.rimI; }
    // fireflies: forest band outside the walls (denser in the southern hunting grounds), a few in the gardens
    const R = ctx.R, walk = ctx.walk, c = ctx.cfg.half + ctx.cfg.wallThick / 2;
    const field = [];
    for (let k = 0; k < 9000 && field.length < 1500; k++) {
      const x = V.lerp(walk.minX - 20, walk.maxX + 20, R()), z = V.lerp(walk.minZ - 20, walk.maxZ + 30, R());
      const outside = !(Math.abs(x) < c + 6 && Math.abs(z) < c + 6);
      if (!outside && R() > 0.06) continue;
      if (z < c && R() > 0.5) continue;                        // hunting grounds (south) get the most
      const hy = ctx.terrain.height(x, z);
      const high = R() < 0.18;
      field.push([x, hy + (high ? 6 + R() * 12 : 0.5 + R() * 3.2), z]);
    }
    const spots = (V.Forest && V.Forest.glowSpots) || [];
    const mo = motes(spots, field, R);
    group.add(mo);
    // god rays: in the forest band, under the crowns' edges (where light breaks through)
    const rays = [];
    const trees = (V.Forest && V.Forest.placed) || [];
    for (const t of trees) {
      if (rays.length >= 70) break;
      if (t.kind.startsWith('giantFar') || R() < 0.35) continue;
      const a = R() * TAU, r = t.info.spread * t.sc * (0.55 + R() * 0.5);
      const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      rays.push([x, ctx.terrain.height(x, z) - 0.5, z, R() * TAU, 2.2 + R() * 3.2, 22 + R() * 10]);
    }
    if (rays.length) group.add(shafts(rays));
    vignette();
    A.objects = { motes: mo };
    A.mapHide = [mo].concat(group.children.filter((o) => o.name === 'atmo_shafts'));
  };
  A.update = function () {
    U.atmoA.value.w = V.time.value;
    if (A.objects) A.objects.motes.material.uniforms.uScale.value = window.innerHeight * 0.75 * (window.devicePixelRatio > 1 ? Math.min(window.devicePixelRatio, 2) : 1);
  };
})();
