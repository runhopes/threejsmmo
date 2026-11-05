/* =====================================================================================================
 *  vfx/impact.js  -  ImpactFX: the hit / kill feedback of the user's Godot game Atherion, ported procedurally
 *                    (three.js r128, no texture files; spec: vfx/impact-spec.md)
 *
 *    const fx = ImpactFX.create({ scene, camera, light(pos, hex, k) })
 *    fx.hit(o)     one accepted hit on a body (Atherion MobHitFx.spawn: four layers)
 *                    o.root   Object3D the effects follow (mob root; null = o.x/o.z fixed)    o.x, o.z  feet when no root
 *                    o.r      Atherion body radius in m (effect size + anchor height; fx.bodyRadius(height) maps a height)
 *                    o.surf   horizontal body radius for the contact / clamp (default r)     o.depth  extra depth bias (m)
 *                    o.point  world impact point (projectiles / AoE: HitAnchor.stash)         o.from  {x, z} attacker
 *                    o.kind   'blade' | 'arrow' | null (HitFxCode: knight / archer / mage)     o.heavy  knockdown hit
 *                    o.crit   o.self (the local player's own body: red palette, no sparks)    o.flash(dur, str, rgb)
 *    fx.kill(o)    death burst + rising smoke at the feet (DeathBurst + ExplosionSmoke x2)  o.x, o.z
 *    fx.update(dt) once per frame (real time: Atherion's hit fx are not slowed by the hit-stop)
 *    fx.bindFlash(root) / fx.flashRoot(root, dur, str, rgb)   body flash for meshes this module does not own (the hero)
 *
 *  Layers of one hit (mob_hit_fx.gd): 1 ember burst (vendor VFXHit_07: glow, star burst, 2 four-point stars, flare ring,
 *  8 spindle sparks, light) - 2 impact mark (hit_spark.gdshader: CROSS / SHATTER) - 3 body flash - 4 impact sparks
 *  (impact_sparks.gd). All of them start at ONE anchor (hit_anchor.gd + MobHitFx._resolve_anchor).
 *  Draw calls: 4 instanced batches (mark quads, ember quads, segments, puffs). Nothing allocates after create().
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE;
  const TAU = Math.PI * 2, PI = Math.PI;
  const U = 1.95 / 26.1;                                   // one Atherion world unit in metres (body 26.1 u = hero 1.95 m, as ui/feedback.js)
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const rand = (a, b) => a + Math.random() * (b - a);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const hash11 = (n) => { const s = Math.sin(n * 127.1 + 3.7) * 43758.5453; return s - Math.floor(s); };
  const outCubic = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
  const outQuint = (x) => { const m = 1 - x; return 1 - m * m * m * m * m; };

  // Godot Curve (bezier between points, tangents from the .tscn) baked into a table: [[x, y, leftTan, rightTan], ...]
  function curve(pts, n) {
    n = n || 96;
    const tab = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const x = k / n;
      let i = 0; while (i < pts.length - 2 && x > pts[i + 1][0]) i++;
      const a = pts[i], b = pts[i + 1], d = b[0] - a[0];
      if (x <= a[0] || d <= 0) { tab[k] = a[1]; continue; }
      if (x >= b[0]) { tab[k] = b[1]; continue; }
      const t = (x - a[0]) / d, s = 1 - t, p1 = a[1] + a[3] * d / 3, p2 = b[1] - b[2] * d / 3;
      tab[k] = s * s * s * a[1] + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * b[1];
    }
    return (u) => { const f = clamp01(u) * n, i = Math.floor(f), r = f - i; return i >= n ? tab[n] : tab[i] + (tab[i + 1] - tab[i]) * r; };
  }

  /* ------------------------------------------------ Atherion numbers ------------------------------------------------ */
  const MOB = {                                            // mob_hit_fx.gd
    SCALE_PER_R: 2.6, HEAVY_BOOST: 1.35, HEIGHT_PER_R: 2.0, DEPTH_PUSH_PER_R: 1.0, IMPACT_PUSH_PER_R: 0.35,
    FALLBACK_R: 6.3 * U, SELF_MAX_LIVE: 3,
    PRIMARY: [1.00, 0.90, 0.55], SECONDARY: [1.00, 0.30, 0.05], LIGHT: 0xff731f,           // ember palette ("Kor")
    SELF_PRIMARY: [1.00, 0.10, 0.07], SELF_SECONDARY: [0.88, 0.02, 0.02], SELF_LIGHT: 0xff140d,
  };
  const ANCHOR = { MIN_Y_PER_R: 0.35, MAX_Y_PER_R: 3.65 };     // hit_anchor.gd clamp_to_body
  const MARK = {                                           // hit_spark.gd
    SCALE_PER_R: 2.60, HEAVY_BOOST: 1.15, CRIT_BOOST: 1.30, NORMAL_W: 1.0, CRIT_W: 1.55, R: 0.34,
    CROSS_LIFE: 0.320, SHATTER_LIFE: 0.520, INTENSITY: 1.6, SPREAD_MIN: 1.02, SPREAD_MAX: 1.40, MAX_PER_MOB: 3,
    CORE: [1, 1, 1], EDGE: [0.788, 0.839, 0.878], ICE: [0.588, 0.753, 0.886],
    SELF_CORE: [1.00, 0.16, 0.13], SELF_EDGE: [0.96, 0.10, 0.08], SELF_ICE: [0.72, 0.03, 0.05],
    HALF_CROSS: 1.75, HALF_SHATTER: 2.94,                  // drawn quad half-size in design radii (sparks are segments here)
  };
  const SPARK = {                                          // impact_sparks.gd tier table: NONE, NORMAL, CRIT, HEAVY, ARROW
    COUNT: [[0, 0], [5, 6], [7, 8], [9, 10], [2, 3]],
    LIFE: [[0, 0], [120, 180], [160, 220], [180, 260], [90, 140]],
    LEN: [[0, 0], [4.13, 5.40], [4.76, 6.35], [5.08, 6.98], [3.17, 4.44]],
    LOBE: [0, 0.79, 0.96, 0.96, 0.52], GRAV: [0, 1.0, 1.0, 1.2, 0.8],
    REACH_P_MAX: 0.90, CORE_W: 0.025, HALO_W: 0.08, GAIN: 1.0,
    HOT: [1.0, 0.925, 0.745], WARM: [1.0, 0.745, 0.373], EMBER: [0.902, 0.329, 0.102],
  };
  const FLASH = {                                          // MobGlobalConfig hit_flash_* (screen tones; see creatures/core.js)
    NORMAL: [0.34, 0.10], CRIT: [0.50, 0.16], STEEL: [0.92, 0.94, 0.96], SELF: [0.95, 0.27, 0.27],
  };
  // VFXHit_07 particle curves (vfx_hit_07.tscn)
  const C_SPARK_SCALE = curve([[0, 1, 0, 0], [1, 0, 0, 0]]);
  const C_STREAK_SCALE = curve([[0, 0.764045, 0, 0.8244758], [1, 1, 0, 0]]);
  const C_STREAK_ALPHA = curve([[0, 1, 0, 0], [1, 0, -0.105191775, 0]]);
  const C_STAR_SCALE = curve([[0, 0, 0, 23.387634], [1e-5, 0.9, -2.953988, -2.953988], [0.1, 0.6, 0, 0], [0.7, 0.6, 0, 0], [1, 1, 2.3242369, 0]], 400);
  const C_STAR_ALPHA = curve([[0, 1, 0, -2.4959135], [0.2, 0.7, 0, 0], [0.5, 0.7, 0, 0], [1, 0, -3.9318385, 0]]);
  const C_FLARE_SCALE = curve([[0, 0.55056185, 0, 0.8972241], [1, 1, 0, 0]]);
  const C_FLARE_ALPHA = curve([[0, 0.8988764, 0, -1.8710108], [1, 0, -0.14926313, 0]]);
  // DeathBurst (death_burst.gd): add_point() = flat tangents
  const C_DB_SCALE = curve([[0, 0.2, 0, 0], [0.15, 0.7, 0, 0], [0.4, 1.0, 0, 0], [0.7, 1.2, 0, 0], [1, 0.6, 0, 0]]);
  const C_DB_ALPHA = curve([[0, 0, 0, 0], [0.03, 0.9, 0, 0], [0.15, 0.7, 0, 0], [0.5, 0.35, 0, 0], [1, 0, 0, 0]]);
  const rampDB = (u) => (u < 0.3 ? mix(0.9, 0.7, u / 0.3) : u < 0.7 ? mix(0.7, 0.3, (u - 0.3) / 0.4) : mix(0.3, 0, (u - 0.7) / 0.3));

  /* ------------------------------------------------ shared GLSL ------------------------------------------------ */
  // depth push: the quad keeps its screen position and size, only its depth moves `push` metres toward the camera, so the
  // struck body never hides the effect (Atherion pushes the anchor itself along the camera ray for the same reason)
  const DEPTH_PUSH = 'vec4 ifxClip(vec4 mv, float push){ vec4 c = projectionMatrix * mv; float pz = min(push, -mv.z - 0.15);' +
    ' vec4 cz = projectionMatrix * vec4(mv.xy, mv.z + max(pz, 0.0), 1.0); c.z = cz.z / cz.w * c.w; return c; }';
  // Atherion renders these additive HDR layers through Filmic + glow; here they are compressed once so hot cores saturate
  // softly instead of clipping (an emission 4 orange reads orange, not white)
  const COMPRESS = 'vec3 ifxTone(vec3 c){ return vec3(1.0) - exp(-c * 1.1); }';

  /* ---- 1) impact mark: hit_spark.gdshader (sparks moved to the segment batch) ---- */
  const MARK_VS = [
    'attribute vec4 iP; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;',
    'varying vec2 vQ; varying vec4 vA; varying vec4 vB; varying vec4 vC;', DEPTH_PUSH,
    'void main(){',
    '  vQ = position.xy; vA = iA; vB = iB; vC = iC;',
    '  vec4 mv = viewMatrix * vec4(iP.xyz, 1.0);',
    '  mv.xy += position.xy * iP.w;',
    '  gl_Position = ifxClip(mv, iB.w);',
    '}'].join('\n');
  const MARK_FS = [
    'varying vec2 vQ; varying vec4 vA; varying vec4 vB; varying vec4 vC;', COMPRESS,
    'const float PI2 = 6.2831853; const float R = 0.34;',
    'float weight;',
    'vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }',
    'float hash11(float n){ return fract(sin(n * 127.1 + 3.7) * 43758.5453); }',
    'float out_cubic(float x){ float m = 1.0 - x; return 1.0 - m * m * m; }',
    'float out_quint(float x){ float m = 1.0 - x; return 1.0 - m * m * m * m * m; }',
    'float out_expo(float x){ return x >= 1.0 ? 1.0 : 1.0 - exp2(-10.0 * x); }',
    'float win(float t, float a, float b){ if (t < a || t > b) return -1.0; return (t - a) / max(b - a, 0.001); }',
    'float fade_out(float u, float hold, float e){ if (u < hold) return 1.0; return pow(max(0.0, 1.0 - (u - hold) / max(1.0 - hold, 1e-4)), e); }',
    'float core_star(vec2 p, float rad, float k, float ar, float rot){',
    '  k = min(k * weight, 0.85);',
    '  vec2 q = rot2(p, -rot) / max(rad, 1e-4); q.y /= max(ar, 0.02);',
    '  float s = pow(pow(abs(q.x), k) + pow(abs(q.y), k), 1.0 / max(k, 1e-3));',
    '  float body = pow(clamp(1.0 - s, 0.0, 1.0), 1.6); float hot = pow(clamp(1.0 - s * 2.2, 0.0, 1.0), 2.0);',
    '  return body * 0.75 + hot * 1.35; }',
    'float blade(vec2 p, float ang, float half_len, float th, float bow){',
    '  vec2 q = rot2(p, -ang);',
    '  vec2 tip = rot2(vec2(half_len * 0.92, bow * 0.08), ang);',
    '  float tip_glow = exp(-dot(p - tip, p - tip) / max(th * th * 8.8, 1e-6)) * 0.7;',
    '  float xn = q.x / max(half_len, 1e-4);',
    '  if (abs(xn) > 1.0) return tip_glow;',
    '  float prof = 1.0 - xn * xn; float dy = abs(q.y - bow * prof);',
    '  float e = clamp(1.0 - dy / max(th * prof, 1e-4), 0.0, 1.0);',
    '  return pow(e, 1.5) * 0.55 + pow(e, 9.0) * 1.25 + tip_glow; }',
    'float shock_ring(vec2 p, float rad, float w){ float d = length(p) - rad; return exp(-(d * d) / max(w * w, 1e-6)); }',
    'float shards(vec2 p, float t01, float sd){',
    '  float acc = 0.0; float e = out_cubic(t01);',
    '  for (int i = 0; i < 9; i++) {',
    '    float fi = float(i); float h1 = hash11(fi + sd * 7.0); float h2 = hash11(fi + sd * 7.0 + 19.3);',
    '    float a = (fi / 9.0) * PI2 + (h1 - 0.5) * 1.1;',
    '    float d = R * (0.34 + (0.75 + h2 * 1.15) * e * 0.95);',
    '    vec2 c = vec2(cos(a), sin(a)) * d + vec2(0.0, R * t01 * t01 * 0.40);',
    '    float sz = R * (0.08 + h1 * 0.13) * (1.0 - t01 * 0.42);',
    '    vec2 rel = p - c; if (dot(rel, rel) > (sz * 1.7) * (sz * 1.7)) continue;',
    '    vec2 q = rot2(rel, -(h2 * PI2 + (h1 - 0.5) * 11.0 * t01));',
    '    q.x /= max(sz * (0.5 + h2 * 1.1), 1e-4); q.y /= max(sz * 0.35, 1e-4);',
    '    float m = clamp(1.0 - max(abs(q.x), abs(q.y)), 0.0, 1.0); acc += pow(m, 1.4);',
    '  }',
    '  return acc * pow(max(0.0, 1.0 - t01), 1.5); }',
    'float glare(vec2 p, float ang, float w, float h){ vec2 q = rot2(p, -ang); float ex = q.x / max(w, 1e-4); float ey = q.y / max(h, 1e-4); return exp(-(ex * ex + ey * ey) * 3.2); }',
    'void main(){',
    '  if (dot(vQ, vQ) > 1.0) discard;',
    '  vec2 p = vec2(vQ.x, -vQ.y) * vB.z * R;',                 // Atherion p-space: +y DOWN (QuadMesh UV)
    '  float t = vA.x, spin = vA.z, seed = vA.w, spread = vB.x; weight = vB.y;',
    '  float tilt = 0.31416;',
    '  vec3 core_color = vC.x > 0.5 ? vec3(1.00, 0.16, 0.13) : vec3(1.0);',
    '  vec3 edge_color = vC.x > 0.5 ? vec3(0.96, 0.10, 0.08) : vec3(0.788, 0.839, 0.878);',
    '  vec3 ice_color = vC.x > 0.5 ? vec3(0.72, 0.03, 0.05) : vec3(0.588, 0.753, 0.886);',
    '  vec3 rgb = vec3(0.0); float lum = 0.0; float u;',
    '  if (vA.y < 0.5) {',                                       // ---- CROSS (320 ms)
    '    float a0 = spin - spread * 0.5; float a1 = spin + spread * 0.5;',
    '    u = win(t, 0.0, 195.0);',
    '    if (u >= 0.0) { float grow = out_quint(min(1.0, u * 5.2)); float fade = fade_out(u, 0.20, 2.0);',
    '      float m = blade(p, a0, R * 2.55 * 0.5 * grow, R * 0.075 * weight * (1.0 - u * 0.30), R * 0.13);',
    '      rgb += mix(edge_color, core_color, 0.55) * m * fade; lum += m * fade; }',
    '    u = win(t, 48.0, 243.0);',
    '    if (u >= 0.0) { float grow = out_quint(min(1.0, u * 5.2)); float fade = fade_out(u, 0.20, 2.0);',
    '      float m = blade(p, a1, R * 2.20 * 0.5 * grow, R * 0.065 * weight * (1.0 - u * 0.30), R * -0.15);',
    '      rgb += mix(edge_color, core_color, 0.55) * m * fade; lum += m * fade; }',
    '    u = win(t, 48.0, 183.0);',
    '    if (u >= 0.0) { float s = 0.42 + 0.74 * out_quint(min(1.0, u * 3.4)); float fade = fade_out(u, 0.18, 2.1);',
    '      float m = core_star(p, R * 0.58 * s, 0.42, 0.50, spin + tilt);',
    '      rgb += mix(edge_color, core_color, 0.75) * m * fade; lum += m * fade; }',
    '    u = win(t, 48.0, 238.0);',
    '    if (u >= 0.0) { float e = out_expo(u);',
    '      float m = shock_ring(p, R * (0.22 + 0.93 * e), R * 0.055 * weight * (1.0 - e * 0.82) + 0.002);',
    '      float fade = 0.45 * pow(max(0.0, 1.0 - u), 1.7); rgb += edge_color * m * fade; lum += m * fade; }',
    '  } else {',                                                // ---- SHATTER (520 ms)
    '    u = win(t, 0.0, 125.0);',
    '    if (u >= 0.0) { float fade = pow(max(0.0, 1.0 - u), 2.4); float w = R * 2.2 * (0.46 + 0.62 * out_quint(min(1.0, u * 2.8)));',
    '      float m = glare(p, spin + tilt, w, R * 0.085 * weight * (1.0 - u * 0.55) + 0.002); rgb += core_color * m * fade; lum += m * fade; }',
    '    u = win(t, 0.0, 125.0);',
    '    if (u >= 0.0) { float s = 0.42 + 0.74 * out_quint(min(1.0, u * 3.4)); float fade = fade_out(u, 0.46, 2.1);',
    '      float m = core_star(p, R * 1.0 * s, 0.46, 0.55, spin + tilt); rgb += mix(edge_color, core_color, 0.75) * m * fade; lum += m * fade; }',
    '    u = win(t, 0.0, 300.0);',
    '    if (u >= 0.0) { float e = out_expo(u); float m = shock_ring(p, R * (0.22 + 1.63 * e), R * 0.055 * weight * (1.0 - e * 0.82) + 0.002);',
    '      float fade = 0.85 * pow(max(0.0, 1.0 - u), 1.7); rgb += edge_color * m * fade; lum += m * fade; }',
    '    u = win(t, 66.0, 411.0);',
    '    if (u >= 0.0) { float e = out_expo(u); float m = shock_ring(p, R * (0.22 + 2.23 * e), R * 0.032 * weight * (1.0 - e * 0.82) + 0.002);',
    '      float fade = 0.32 * pow(max(0.0, 1.0 - u), 1.7); rgb += ice_color * m * fade; lum += m * fade; }',
    '    u = win(t, 72.0, 507.0);',
    '    if (u >= 0.0) { float m = shards(p, u, seed); rgb += edge_color * m; lum += m; }',
    '  }',
    '  if (lum < 0.004) discard;',
    '  gl_FragColor = vec4(ifxTone(rgb * 1.6) * vC.y, 1.0);',
    '}'].join('\n');

  /* ---- 2) ember burst quads (VFXHit_07: glow / streaks / four_point_star / flare shaders) ---- */
  const EMB_VS = [
    'attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;',
    'varying vec2 vUv; varying vec4 vP; varying float vK;', DEPTH_PUSH,
    'void main(){',
    '  vUv = position.xy * 0.5 + 0.5; vP = iC; vK = iA.w;',
    '  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);',
    '  vec2 q = position.xy * iB.xy; float c = cos(iB.z), s = sin(iB.z);',
    '  mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);',
    '  gl_Position = ifxClip(mv, iB.w);',
    '}'].join('\n');
  const EMB_FS = [
    'varying vec2 vUv; varying vec4 vP; varying float vK;', COMPRESS,
    'float overlay(float b, float l){ return mix(2.0 * b * l, 1.0 - 2.0 * (1.0 - b) * (1.0 - l), step(0.5, b)); }',
    'void main(){',
    '  bool self = vP.w > 0.5;',
    '  vec3 prim = self ? vec3(1.00, 0.10, 0.07) : vec3(1.00, 0.90, 0.55);',
    '  vec3 sec = self ? vec3(0.88, 0.02, 0.02) : vec3(1.00, 0.30, 0.05);',
    '  vec2 c = vUv - 0.5; float rad = length(c) * 2.0; vec3 col = vec3(0.0);',
    '  if (vK < 0.5) {',                                         // glow sphere, seen head-on: fresnel = pow(N.V, 8)
    '    if (rad >= 1.0) discard;',
    '    float f = pow(1.0 - rad * rad, 4.0); col = mix(sec, prim, f) * 2.0 * f;',
    '  } else if (vK < 1.5) {',                                  // radial streak burst (streaks.gdshader)
    '    float ang = atan(c.x, c.y);',
    '    float s1 = sin(ang * 15.0 + 3.14159 + vP.y); float s2 = sin(ang * 21.0 - 3.14159 - vP.y);',
    '    float v = overlay(s1, s2); v -= (1.0 - rad) * 0.72; v *= 1.0 - rad;',
    '    float mask = max(1.0 - rad, 0.0); v *= mask; v = min(v, mask); v = smoothstep(0.1, 1.0, v);',
    '    v *= pow(clamp((rad - 0.25) / (0.41 - 0.25), 0.0, 1.0), 4.0);',
    '    if (v <= 0.002) discard;',
    '    col = mix(sec, prim, v) * 4.0 * v * vP.x;',
    '  } else if (vK < 2.5) {',                                  // four-point star (four_point_star.gdshader, decay = alpha curve)
    '    vec2 uv = abs(vUv * 2.0 - 1.0); float k = max(0.6 * vP.x, 1e-3);',
    '    float v = clamp(pow(uv.x, k) + pow(uv.y, k), 0.0, 2.0); v = smoothstep(0.95, 0.45, v);',
    '    if (v <= 0.002) discard;',
    '    col = mix(sec, prim, v) * 2.0 * v;',
    '  } else {',                                                // flare ring (flare.gdshader, ring gradient .425-.575-1)
    '    float g = rad <= 0.4251497 ? 0.0 : rad < 0.5748503 ? (rad - 0.4251497) / 0.1497006 : max(0.0, 1.0 - (rad - 0.5748503) / 0.4251497);',
    '    float fl = pow(g, 8.0) * 0.8; float ang = atan(c.x, c.y) + vP.y;',
    '    float st = pow(cos(ang * 12.0) * 0.5 + 0.5, 16.0) * (sin(ang * 32.0) * 0.5 + 0.5);',
    '    float v = overlay(fl, st); v = max(v, fl * 0.5); v *= 0.5 + (sin(ang * 5.0 + vP.y) * 0.5 + 0.5) * 0.5; v = smoothstep(0.0, 1.0, v);',
    '    if (v <= 0.002) discard;',
    '    col = mix(sec, prim, v) * 4.0 * vP.x * v;',
    '  }',
    '  gl_FragColor = vec4(ifxTone(col), 1.0);',
    '}'].join('\n');

  /* ---- 3) segments: impact sparks (impact_sparks), the mark's spark fan (hit_spark sparks()) and the ember's spindles ---- */
  const SEG_VS = [
    'attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD; attribute vec4 iE;',
    'uniform float uPx;',                                        // world size of one screen pixel at 1 m depth
    'varying vec3 vL; varying vec4 vC; varying vec4 vD; varying vec4 vE; varying float vT;', DEPTH_PUSH,
    'void main(){',
    '  vec4 a = viewMatrix * vec4(iA.xyz, 1.0), b = viewMatrix * vec4(iB.xyz, 1.0);',
    '  vec2 d = b.xy - a.xy; float L = length(d); vec2 ax = L > 1e-6 ? d / L : vec2(1.0, 0.0); vec2 pp = vec2(-ax.y, ax.x);',
    '  float px = max(-0.5 * (a.z + b.z), 0.2) * uPx;',
    '  float hw = iA.w < 0.5 ? iD.w : iA.w < 1.5 ? max(iE.y, px * 3.5) * 2.6 : iD.w;',   // half width of the quad
    '  float pad = iA.w < 0.5 ? 0.0 : iA.w < 1.5 ? hw : 0.0;',
    '  vec4 mv = mix(a, b, position.x * 0.5 + 0.5);',
    '  mv.xy += ax * position.x * pad + pp * position.y * hw;',
    '  vL = vec3((position.x * 0.5 + 0.5) * L + position.x * pad, position.y * hw, L);',
    '  vC = iC; vD = iD; vE = vec4(iE.x, iE.y, px, 0.0); vT = iA.w;',
    '  gl_Position = ifxClip(mv, iB.w);',
    '}'].join('\n');
  const SEG_FS = [
    'varying vec3 vL; varying vec4 vC; varying vec4 vD; varying vec4 vE; varying float vT;', COMPRESS,
    'void main(){',
    '  float L = max(vL.z, 1e-5); float s = clamp(vL.x / L, 0.0, 1.0); vec3 col;',
    '  if (vT < 0.5) {',                                         // mark spark: tapered core, brightness grows to the head
    '    float th = vD.w * mix(0.35, 1.0, s); float e = clamp(1.0 - abs(vL.y) / max(th, 1e-5), 0.0, 1.0);',
    '    float m = pow(e, 1.5) * s * vC.a; if (m <= 0.002) discard; col = vC.rgb * m;',
    '  } else if (vT < 1.5) {',                                  // impact spark: hot core + cooling halo (impact_sparks())
    '    float d = length(vec2(vL.x - clamp(vL.x, 0.0, L), vL.y));',
    '    float cw = max(vE.x * mix(0.40, 1.0, s), vE.z * 0.7); float core = pow(clamp(1.0 - d / cw, 0.0, 1.0), 1.5);',
    '    float hw = max(vE.y, vE.z * 3.5); float halo = exp(-(d * d) / (hw * hw));',
    '    vec3 tip = mix(vC.rgb, vec3(1.0, 0.925, 0.745), smoothstep(0.70, 1.0, s));',
    '    col = (tip * core * 1.35 + vD.rgb * halo * 0.45) * vC.a * pow(s, 1.2); if (col.r + col.g + col.b < 0.004) discard;',
    '  } else {',                                                // ember spindle (sphere mesh aligned to velocity, glow shader)
    '    vec2 q = vec2(s * 2.0 - 1.0, vL.y / max(vD.w, 1e-5)); float r2 = dot(q, q); if (r2 >= 1.0) discard;',
    '    float f = pow(1.0 - r2, 4.0); col = mix(vD.rgb, vC.rgb, f) * 2.0 * f;',
    '  }',
    '  gl_FragColor = vec4(ifxTone(col), 1.0);',
    '}'].join('\n');

  /* ---- 4) puffs: DeathBurst cloud (Y-billboard, blend_mix, unshaded) + ExplosionSmoke (gray, lit from above) ---- */
  const PUFF_VS = [
    'attribute vec4 iA; attribute vec4 iB;',
    'varying vec2 vUv; varying vec4 vB;',
    'void main(){',
    '  vUv = position.xy * 0.5 + 0.5; vB = iB;',
    '  vec4 mv;',
    '  if (iB.y < 0.5) {',                                       // Y-axis billboard (death_burst cloud shader)
    '    vec3 r = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));',
    '    mv = viewMatrix * vec4(iA.xyz + r * position.x * iA.w + vec3(0.0, 1.0, 0.0) * position.y * iA.w, 1.0);',
    '  } else {',
    '    mv = viewMatrix * vec4(iA.xyz, 1.0); float c = cos(iB.z), s = sin(iB.z);',
    '    mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iA.w;',
    '  }',
    '  gl_Position = projectionMatrix * mv;',
    '}'].join('\n');
  const PUFF_FS = [
    'varying vec2 vUv; varying vec4 vB;',
    'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'void main(){',
    '  vec2 c = vUv * 2.0 - 1.0; float dist = length(c);',
    '  if (vB.y < 0.5) {',
    '    float n1 = sin(c.x * 5.0 + c.y * 3.5) * 0.5 + 0.5; float n2 = sin(c.x * 9.0 - c.y * 7.0 + 1.5) * 0.5 + 0.5;',
    '    float n3 = sin(c.x * 14.0 + c.y * 11.0 - 2.5) * 0.5 + 0.5; float cloud = mix(mix(n1, n2, 0.5), n3, 0.3);',
    '    float a = smoothstep(1.0, 0.1, dist) * (0.4 + cloud * 0.6) * vB.x; if (a < 0.003) discard;',
    '    gl_FragColor = vec4(vec3(0.85 + cloud * 0.2), a);',
    '  } else {',                                                // smoke: lumpy density, gray albedo ramp .35 -> 1, light from above
    '    vec2 q = c * 2.2 + vB.w * 17.0;',
    '    float n = vnoise(q) * 0.55 + vnoise(q * 2.1 + 3.1) * 0.3 + vnoise(q * 4.3 - 1.7) * 0.15;',
    '    float dens = clamp((1.0 - dist) * 1.6 * (0.55 + n * 0.9) - 0.15, 0.0, 1.0);',
    '    float a = dens * vB.x; if (a < 0.003) discard;',
    '    float lit = 0.62 + 0.38 * clamp(0.5 - c.y * 0.6 + (n - 0.5) * 0.8, 0.0, 1.0);',
    '    gl_FragColor = vec4(vec3(mix(0.35, 1.0, dens) * 0.62 * lit), a);',
    '  }',
    '}'].join('\n');

  /* ------------------------------------------------ instanced batch ------------------------------------------------ */
  function batch(scene, cap, attrs, vs, fs, opts) {
    const g = new T.InstancedBufferGeometry();
    const base = new T.PlaneGeometry(2, 2);
    g.setIndex(base.index); g.setAttribute('position', base.attributes.position);
    const arr = {};
    for (const name of attrs) { arr[name] = new Float32Array(cap * 4); const a = new T.InstancedBufferAttribute(arr[name], 4); a.setUsage(T.DynamicDrawUsage); g.setAttribute(name, a); }
    g.instanceCount = 0;
    const mat = new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: opts.uniforms || {}, transparent: true, depthWrite: false, depthTest: true,
      blending: opts.blending === undefined ? T.AdditiveBlending : opts.blending, side: T.DoubleSide });
    const mesh = new T.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = opts.order || 30; mesh.visible = false; mesh.name = 'impactfx:' + (opts.name || 'batch');
    scene.add(mesh);
    let n = 0;
    return {
      mesh, mat, cap, arr,
      begin() { n = 0; },
      push() { return n < cap ? n++ : -1; },
      set(name, i, a, b, c, d) { const o = i * 4, A = arr[name]; A[o] = a; A[o + 1] = b; A[o + 2] = c; A[o + 3] = d; },
      end() {
        g.instanceCount = n; mesh.visible = n > 0;
        if (n) for (const name of attrs) { const a = g.attributes[name]; a.updateRange.offset = 0; a.updateRange.count = n * 4; a.needsUpdate = true; }
      },
      get count() { return n; },
    };
  }

  function create(opts) {
    const scene = opts.scene, camera = opts.camera;
    const light = opts.light || null;
    const marks = batch(scene, 96, ['iP', 'iA', 'iB', 'iC'], MARK_VS, MARK_FS, { order: 32, name: 'marks' });
    const embers = batch(scene, 256, ['iA', 'iB', 'iC'], EMB_VS, EMB_FS, { order: 31, name: 'embers' });
    const segU = { uPx: { value: 0.001 } };
    const segs = batch(scene, 1024, ['iA', 'iB', 'iC', 'iD', 'iE'], SEG_VS, SEG_FS, { order: 33, uniforms: segU, name: 'segments' });
    const puffs = batch(scene, 640, ['iA', 'iB'], PUFF_VS, PUFF_FS, { order: 29, blending: T.NormalBlending, name: 'puffs' });

    const hits = [];                                       // live hit records (mark + ember + sparks share the anchor)
    const deaths = [];
    const hitPool = [], deathPool = [];
    const camR = new T.Vector3(), camU = new T.Vector3(), camP = new T.Vector3();
    const _w = new T.Vector3(), _a = new T.Vector3();
    let clock = 0;

    /* ---------- anchor (hit_anchor.gd + MobHitFx._resolve_anchor) ---------- */
    // offsets are kept in the body's yaw frame (Atherion parents the effects to the mob: they ride along when it moves / turns)
    function toLocal(H, wx, wy, wz) {
      const dx = wx - H.bx, dz = wz - H.bz, c = Math.cos(-H.yaw0), s = Math.sin(-H.yaw0);
      H.ox = dx * c + dz * s; H.oz = -dx * s + dz * c; H.oy = wy - H.by;
    }
    function anchorWorld(H, out) {
      let bx = H.bx, by = H.by, bz = H.bz, dy = 0;
      if (H.root) { bx = H.root.position.x; by = H.root.position.y; bz = H.root.position.z; dy = H.root.rotation.y - H.yaw0; }
      const c = Math.cos(dy), s = Math.sin(dy);
      return out.set(bx + H.ox * c + H.oz * s, by + H.oy, bz - H.ox * s + H.oz * c);
    }
    function pushTowardCamera(H, push) {            // MobHitFx._push_toward_camera: along the camera ray, capped at half the distance
      anchorWorld(H, _w);
      _a.copy(camP).sub(_w); const dist = _a.length(); if (dist < 0.001 || push <= 0) return;
      _a.multiplyScalar(Math.min(push, dist * 0.5) / dist);
      toLocal(H, _w.x + _a.x, _w.y + _a.y, _w.z + _a.z);
    }
    function resolveAnchor(H, o) {
      const r = H.r, surf = H.surf;
      if (o.point) {                                       // 1. projectile / AoE point, clamped onto the body capsule
        let lx = o.point.x - H.bx, lz = o.point.z - H.bz, ly = Math.min(Math.max(o.point.y - H.by, r * ANCHOR.MIN_Y_PER_R), r * ANCHOR.MAX_Y_PER_R);
        const d = Math.hypot(lx, lz); if (d > surf) { lx *= surf / d; lz *= surf / d; }
        toLocal(H, H.bx + lx, H.by + ly, H.bz + lz);
        pushTowardCamera(H, r * MOB.IMPACT_PUSH_PER_R);
        return 'point';
      }
      if (H.kind && o.from) {                              // 2. contact: the capsule surface facing the attacker, at 2r
        let ax = H.bx - o.from.x, az = H.bz - o.from.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
        const cx = H.bx - ax * surf, cz = H.bz - az * surf, cy = H.by + r * MOB.HEIGHT_PER_R;
        if (-ax * (camP.x - cx) + -az * (camP.z - cz) >= 0) {   // facing away from the camera -> body path
          toLocal(H, cx, cy, cz);
          pushTowardCamera(H, r * MOB.IMPACT_PUSH_PER_R);
          return 'contact';
        }
      }
      toLocal(H, H.bx, H.by + r * MOB.HEIGHT_PER_R, H.bz);  // 3. body centre, pushed one radius toward the camera
      pushTowardCamera(H, r * MOB.DEPTH_PUSH_PER_R);
      return 'body';
    }
    // spark lobe screen angle (MobHitFx._spark_axis -> ImpactSparks.world_axis + axis_2d); p-space +y is DOWN
    function sparkAxis(H, o) {
      if (!H.kind || !o.from) return -PI * 0.5;
      let ax = H.bx - o.from.x, az = H.bz - o.from.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;   // attacker -> target
      let wx, wy, wz;
      if (H.kind === 'blade') {
        const sg = Math.random() < 0.5 ? 1 : -1, tx = az, tz = -ax;              // tangent = UP x away
        wx = ax * 0.85 + tx * sg * 0.7; wy = 0.5; wz = az * 0.85 + tz * sg * 0.7;
      } else { wx = -ax * 0.95; wy = 0.3; wz = -az * 0.95; }
      const px = wx * camR.x + wy * camR.y + wz * camR.z, py = -(wx * camU.x + wy * camU.y + wz * camU.z);
      return Math.hypot(px, py) < 0.15 ? -PI * 0.5 : Math.atan2(py, px);
    }
    function liveOn(root, key) { let n = 0; if (root) for (const H of hits) if (H.root === root && H[key]) n++; return n; }

    function bodyRadius(height) { return height * (6.3 / 26.75); }     // typical Atherion mob: radius 6.3 u for a 26.75 u tall body

    /* ---------- hit ---------- */
    function hit(o) {
      camera.updateMatrixWorld();
      camP.setFromMatrixPosition(camera.matrixWorld); camR.setFromMatrixColumn(camera.matrixWorld, 0); camU.setFromMatrixColumn(camera.matrixWorld, 1);
      const self = !!o.self;
      const kind = self ? null : o.kind || null;
      const heavy = !!o.heavy, crit = !!o.crit;
      // 3) body flash first (it lives in the first 100 ms)
      const fl = crit ? FLASH.CRIT : FLASH.NORMAL, fc = self ? FLASH.SELF : FLASH.STEEL;
      if (o.flash) o.flash(fl[1], fl[0], fc);
      const H = hitPool.pop() || {};
      H.root = o.root || null;
      H.bx = H.root ? H.root.position.x : o.x || 0; H.by = H.root ? H.root.position.y : 0; H.bz = H.root ? H.root.position.z : o.z || 0;
      H.yaw0 = H.root ? H.root.rotation.y : 0;
      H.r = o.r > 0 ? o.r : MOB.FALLBACK_R; H.surf = o.surf > 0 ? o.surf : H.r; H.kind = kind;
      H.depth = (o.depth || H.surf) + 0.1;
      H.how = resolveAnchor(H, o);
      H.age = 0; H.self = self; H.heavy = heavy; H.crit = crit;
      // 2) impact mark (+4 sparks) - capped per body
      H.mark = liveOn(H.root, 'mark') < MARK.MAX_PER_MOB;
      if (H.mark) {
        H.variant = heavy ? 1 : 0;
        H.markLife = heavy ? MARK.SHATTER_LIFE : MARK.CROSS_LIFE;
        H.designR = H.r * MARK.SCALE_PER_R * (heavy ? MARK.HEAVY_BOOST : 1) * (crit ? MARK.CRIT_BOOST : 1);
        H.spin = Math.random() * PI; H.seed = Math.random(); H.spread = rand(MARK.SPREAD_MIN, MARK.SPREAD_MAX);
        H.weight = crit ? MARK.CRIT_W : MARK.NORMAL_W;
        const tier = kind === 'blade' ? (heavy ? 3 : crit ? 2 : 1) : kind === 'arrow' ? 4 : 0;
        const cr = SPARK.COUNT[tier];
        H.tier = tier; H.sparkN = tier ? cr[0] + Math.min(cr[1] - cr[0], Math.floor(Math.random() * (cr[1] - cr[0] + 1))) : 0;
        H.axis = sparkAxis(H, o);
      }
      // 1) ember burst (vendor VFXHit_07) - on your own body at most SELF_MAX_LIVE at once
      H.ember = !(self && liveOn(H.root, 'ember') >= MOB.SELF_MAX_LIVE);
      if (H.ember) {
        H.S = H.r * MOB.SCALE_PER_R * (heavy ? MOB.HEAVY_BOOST : 1);
        H.sp = H.sp || [];
        for (let i = 0; i < 8; i++) {                       // spread 180: any direction, 4-7 local u/s, scale .7-1.3
          const z = rand(-1, 1), a = Math.random() * TAU, q = Math.sqrt(1 - z * z), v = rand(4, 7);
          H.sp[i] = H.sp[i] || {}; const s = H.sp[i]; s.x = q * Math.cos(a) * v; s.y = z * v; s.z = q * Math.sin(a) * v; s.k = rand(0.7, 1.3);
        }
        H.star = [rand(3, 5), Math.random() * TAU, rand(3, 5), Math.random() * TAU];
        H.flareK = rand(1, 2); H.flareRot = Math.random() * TAU; H.streakPh = Math.random() * TAU;
        if (light) { anchorWorld(H, _w); light(_w, self ? MOB.SELF_LIGHT : MOB.LIGHT, heavy ? 1.6 : 1.1); }
      }
      if (!H.mark && !H.ember) { hitPool.push(H); return H.how; }
      hits.push(H);
      return H.how;
    }

    /* ---------- kill (DeathBurst + ExplosionSmoke.spawn(x2)) ---------- */
    function kill(o) {
      const D = deathPool.pop() || { p: [], s: [] };
      D.x = o.x; D.z = o.z; D.y = o.y || 0; D.age = 0;
      for (let i = 0; i < 50; i++) {                        // ring emission r .3, flat radial burst 8-13 u/s, damping 2-4, scale 1.5-3
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * 0.3;
        D.p[i] = D.p[i] || {}; const p = D.p[i];
        p.x = Math.cos(a) * rr; p.z = Math.sin(a) * rr; p.y = 0.1 + rand(-0.05, 0.05); p.dx = Math.cos(a); p.dz = Math.sin(a);
        p.v = rand(8, 13); p.d = rand(2, 4); p.k = rand(1.5, 3);
      }
      for (let i = 0; i < 8; i++) {                         // rise preset: box (1.1, .7, 1.1), cone 30 deg up, 2.5-4.5 u/s, buoyancy 1.4, scale 3-5; x2 spread
        D.s[i] = D.s[i] || {}; const s = D.s[i];
        s.x = rand(-1.1, 1.1) * 2; s.y = 1.5 + rand(-0.7, 0.7) * 2; s.z = rand(-1.1, 1.1) * 2;   // HEIGHT_OFFSET on the node, box x2
        const th = Math.random() * TAU, ph = Math.random() * (30 * PI / 180), v = rand(2.5, 4.5) * 2;
        s.vx = Math.sin(ph) * Math.cos(th) * v; s.vy = Math.cos(ph) * v; s.vz = Math.sin(ph) * Math.sin(th) * v;
        s.k = rand(3, 5); s.rot = rand(-1, 1) * PI / 180; s.w = rand(-10, 10) * PI / 180; s.seed = Math.random(); s.t0 = (1 - 0.91) * Math.random() * 1.9;
      }
      deaths.push(D);
    }

    /* ---------- per-frame ---------- */
    const mixc = (a, b, t, out) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };
    const _c1 = [0, 0, 0], _c2 = [0, 0, 0], _c3 = [0, 0, 0];
    // p-space (quad plane, +y down) -> world around the anchor A, k = metres per p unit
    function pw(A, px, py, k, out) { return out.set(A.x + (camR.x * px - camU.x * py) * k, A.y + (camR.y * px - camU.y * py) * k, A.z + (camR.z * px - camU.z * py) * k); }
    const _t = new T.Vector3(), _h = new T.Vector3();
    function seg(type, tail, head, push, c1r, c1g, c1b, a, c2r, c2g, c2b, w, e0, e1) {
      const i = segs.push(); if (i < 0) return;
      segs.set('iA', i, tail.x, tail.y, tail.z, type); segs.set('iB', i, head.x, head.y, head.z, push);
      segs.set('iC', i, c1r, c1g, c1b, a); segs.set('iD', i, c2r, c2g, c2b, w); segs.set('iE', i, e0 || 0, e1 || 0, 0, 0);
    }
    // hit_spark sparks(): the mark's own fan (CROSS: clustered on the two blade axes; SHATTER: full circle)
    function markSparks(H, A) {
      const t = H.age * 1000, R = MARK.R, k = H.designR / R;
      let u, speed, axisN;
      if (H.variant === 0) { if (t < 6 || t > 304) return; u = (t - 6) / 298; speed = 1.15; axisN = 4; } else { if (t < 58 || t > 403) return; u = (t - 58) / 345; speed = 0.95; axisN = 0; }
      const a0 = H.spin - H.spread * 0.5, a1 = H.spin + H.spread * 0.5;
      const ice = H.self ? MARK.SELF_ICE : MARK.ICE, core = H.self ? MARK.SELF_CORE : MARK.CORE;
      mixc(ice, core, 0.7, _c1);
      for (let i = 0; i < 12; i++) {
        const h1 = hash11(i + H.seed * 13), h2 = hash11(i + H.seed * 13 + 37.7);
        let ca, delay = 0;
        if (axisN) { const g = i % 4; ca = (g === 0 ? a0 : g === 1 ? a0 + PI : g === 2 ? a1 : a1 + PI) + (h1 - 0.5) * 0.65; delay = g >= 2 ? 0.161 : 0; }
        else ca = (i / 12) * TAU + h1 * 0.55;
        const lt = (u - delay - h1 * 0.16) / (0.58 + h2 * 0.42);
        if (lt <= 0 || lt >= 1) continue;
        const e = outCubic(lt), head = R * (0.16 + speed * (0.42 + h2) * e * 1.28), len = R * (0.26 + h1 * 0.52) * (1 - lt * 0.45);
        const gy = R * 0.9 * lt * lt * 0.55, dx = Math.cos(ca), dy = Math.sin(ca);
        pw(A, dx * (head - len), dy * (head - len) + gy, k, _t); pw(A, dx * head, dy * head + gy, k, _h);
        const thick = R * (0.012 + h2 * 0.020) * H.weight * (1 - lt * 0.5) * k, b = Math.pow(1 - lt, 1.6) * MARK.INTENSITY;
        seg(0, _t, _h, H.depth, _c1[0] * b, _c1[1] * b, _c1[2] * b, 1, 0, 0, 0, thick);
      }
    }
    // impact_sparks(): the 4th layer, 2/3 forward lobe (along the spark axis) + 1/3 back lobe, fan inside each lobe
    function impactSparks(H, A) {
      if (!H.sparkN) return;
      const t = H.age * 1000, tier = H.tier, n = H.sparkN, half = H.designR / MARK.R;
      const lr = SPARK.LEN[tier], lenMax = Math.min(lr[1] * H.r, SPARK.REACH_P_MAX * half), lenMin = Math.min(lr[0] * H.r, lenMax);
      const life = SPARK.LIFE[tier], lobe = SPARK.LOBE[tier], grav = SPARK.GRAV[tier];
      const nBack = n >= 3 ? Math.floor((n - 3) / 3) + 1 : 0;
      for (let i = 0; i < n; i++) {
        const b0 = i * 0.53 + H.seed * 3.1;
        const h1 = hash11(b0 + 0.17), h2 = hash11(b0 + 0.41), h3 = hash11(b0 + 0.67), h4 = hash11(b0 + 0.89);
        const lf = mix(life[0], life[1], h2), lt = (t - h1 * 24) / Math.max(lf, 1);
        if (lt <= 0 || lt >= 1) continue;
        const back = i % 3 === 2, m = back ? nBack : n - nBack, kk = back ? Math.floor(i / 3) : i - Math.floor((i + 1) / 3), mf = Math.max(m, 1);
        const ca = H.axis + (back ? PI : 0) + mix(-lobe, lobe, (kk + 0.5) / mf) + (h3 - 0.5) * (2 * lobe / mf) * 0.55;
        const dx = Math.cos(ca), dy = Math.sin(ca), reach = mix(lenMin, lenMax, h2);
        const l0 = Math.max(0, lt - 40 / Math.max(lf, 1)), g = reach * 0.22 * grav;
        const hq = reach * outQuint(lt), tq = reach * outQuint(l0);
        pw(A, dx * tq, dy * tq + g * l0 * l0, 1, _t); pw(A, dx * hq, dy * hq + g * lt * lt, 1, _h);
        const pwr = 0.55 + 0.45 * Math.pow(h4, 1.5), flk = 0.78 + 0.22 * hash11(Math.floor(t / 17) * 0.37 + i * 0.29 + H.seed * 1.7);
        const fade = lt < 0.30 ? 1 : Math.pow(Math.max(0, 1 - (lt - 0.30) / 0.70), 1.6), a = fade * pwr * flk * SPARK.GAIN * MARK.INTENSITY;
        if (lt < 0.45) mixc(SPARK.HOT, SPARK.WARM, smooth(0.10, 0.45, lt), _c2); else mixc(SPARK.WARM, SPARK.EMBER, smooth(0.45, 0.85, lt), _c2);
        mixc(SPARK.HOT, _c2, 0.30, _c3);
        seg(1, _t, _h, H.depth, _c3[0], _c3[1], _c3[2], a, _c2[0], _c2[1], _c2[2], 0, SPARK.CORE_W * H.r, SPARK.HALO_W * H.r);
      }
    }
    function emberLayers(H, A) {
      const t = H.age, S = H.S, pal = H.self ? 1 : 0;
      let i;
      if (t < 0.2) {                                        // Glow: sphere r .5, scale 3 -> 0 in .2 s (transition .5 = ease-out)
        const u = t / 0.2, rr = 0.5 * 3 * (1 - u) * (1 - u) * S;
        if (rr > 0.002 && (i = embers.push()) >= 0) { embers.set('iA', i, A.x, A.y, A.z, 0); embers.set('iB', i, rr, rr, 0, H.depth); embers.set('iC', i, 1, 0, 0, pal); }
      }
      if (t < 0.3 && (i = embers.push()) >= 0) {            // streak burst: 1 particle, quad 3, scale .76 -> 1, alpha 1 -> 0, .3 s
        const u = t / 0.3, hh = 1.5 * C_STREAK_SCALE(u) * S;
        embers.set('iA', i, A.x, A.y, A.z, 1); embers.set('iB', i, hh, hh, 0, H.depth); embers.set('iC', i, C_STREAK_ALPHA(u), H.streakPh + clock, 0, pal);
      }
      if (t < 0.6) {                                        // HitCore: 2 four-point stars, quad .7 x .3, scale 3-5 x curve, .6 s
        const u = t / 0.6, sc = C_STAR_SCALE(u), al = C_STAR_ALPHA(u);
        for (let k = 0; k < 2; k++) {
          if ((i = embers.push()) < 0) break;
          const z = H.star[k * 2] * sc * S;
          embers.set('iA', i, A.x, A.y, A.z, 2); embers.set('iB', i, 0.35 * z, 0.15 * z, H.star[k * 2 + 1], H.depth); embers.set('iC', i, al, 0, 0, pal);
        }
      }
      if (t < 0.8 && (i = embers.push()) >= 0) {            // flare ring: quad 1.2, scale 1-2 x (.55 -> 1), alpha .9 -> 0, .8 s
        const u = t / 0.8, hh = 0.6 * H.flareK * C_FLARE_SCALE(u) * S;
        embers.set('iA', i, A.x, A.y, A.z, 3); embers.set('iB', i, hh, hh, 0, H.depth); embers.set('iC', i, C_FLARE_ALPHA(u), H.flareRot, 0, pal);
      }
      if (t < 0.3) {                                        // 8 spindle sparks (sphere r .05 h .6, aligned to velocity), gravity -10
        const prim = H.self ? MOB.SELF_PRIMARY : MOB.PRIMARY, sec = H.self ? MOB.SELF_SECONDARY : MOB.SECONDARY;
        const sk = C_SPARK_SCALE(t / 0.3);
        for (let k = 0; k < 8; k++) {
          const s = H.sp[k];
          const px = s.x * t, py = s.y * t - 5 * t * t, pz = s.z * t;
          const vx = s.x, vy = s.y - 10 * t, vz = s.z, vl = Math.hypot(vx, vy, vz) || 1;
          const hl = 0.3 * s.k * sk * S, w = 0.05 * s.k * sk * S;
          if (hl < 0.002) continue;
          const cx = A.x + px * S, cy = A.y + py * S, cz = A.z + pz * S;
          _t.set(cx - vx / vl * hl, cy - vy / vl * hl, cz - vz / vl * hl); _h.set(cx + vx / vl * hl, cy + vy / vl * hl, cz + vz / vl * hl);
          seg(2, _t, _h, H.depth, prim[0], prim[1], prim[2], 1, sec[0], sec[1], sec[2], w);
        }
      }
    }
    function deathLayers(D) {
      const t = D.age;
      const tau = t * 1.5;                                   // DeathBurst speed_scale 1.5, lifetime 1.0
      if (tau < 1) {
        const al = C_DB_ALPHA(tau) * rampDB(tau), sc = C_DB_SCALE(tau);
        for (const p of D.p) {
          const i = puffs.push(); if (i < 0) break;
          const r = p.v * tau - 0.5 * p.d * tau * tau;
          puffs.set('iA', i, D.x + (p.x + p.dx * r) * U, D.y + (p.y - 0.15 * tau * tau) * U, D.z + (p.z + p.dz * r) * U, 1.25 * p.k * sc * U);
          puffs.set('iB', i, al, 0, 0, 0);
        }
      }
      for (const s of D.s) {                                // ExplosionSmoke rise: lifetime 1.9, speed_scale 1.3, scale .4 -> 1
        const st = t * 1.3 - s.t0, u = st / 1.9;
        if (st <= 0 || u >= 1) continue;
        const i = puffs.push(); if (i < 0) break;
        const al = Math.min(1, u / 0.08) * Math.pow(1 - u, 1.3) * 0.62;
        puffs.set('iA', i, D.x + (s.x + s.vx * st) * U, D.y + (s.y + s.vy * st + 0.7 * st * st) * U, D.z + (s.z + s.vz * st) * U, 2.5 * s.k * mix(0.4, 1, u) * U);
        puffs.set('iB', i, al, 1, s.rot + s.w * st, s.seed);
      }
    }
    const _A = new T.Vector3();
    function update(dt) {
      clock += dt;
      camera.updateMatrixWorld();
      camP.setFromMatrixPosition(camera.matrixWorld); camR.setFromMatrixColumn(camera.matrixWorld, 0); camU.setFromMatrixColumn(camera.matrixWorld, 1);
      const vh = (opts.viewportHeight && opts.viewportHeight()) || global.innerHeight || 720;
      segU.uPx.value = 2 * Math.tan(camera.fov * PI / 360) / vh;
      marks.begin(); embers.begin(); segs.begin(); puffs.begin();
      for (let j = hits.length - 1; j >= 0; j--) {
        const H = hits[j];
        H.age += dt;
        if (H.mark && H.age >= H.markLife) H.mark = false;
        if (H.ember && H.age >= 0.8) H.ember = false;
        if (!H.mark && !H.ember) { hits[j] = hits[hits.length - 1]; hits.pop(); H.root = null; hitPool.push(H); continue; }
        const A = anchorWorld(H, _A);
        if (H.ember) emberLayers(H, A);
        if (H.mark) {
          const i = marks.push();
          if (i >= 0) {
            const halfQ = (H.variant ? MARK.HALF_SHATTER : MARK.HALF_CROSS);
            marks.set('iP', i, A.x, A.y, A.z, halfQ * H.designR);
            marks.set('iA', i, H.age * 1000, H.variant, H.spin, H.seed);
            marks.set('iB', i, H.spread, H.weight, halfQ, H.depth);
            marks.set('iC', i, H.self ? 1 : 0, 1, 0, 0);
          }
          markSparks(H, A);
          impactSparks(H, A);
        }
      }
      for (let j = deaths.length - 1; j >= 0; j--) {
        const D = deaths[j];
        D.age += dt;
        if (D.age > 2.0) { deaths[j] = deaths[deaths.length - 1]; deaths.pop(); deathPool.push(D); continue; }
        deathLayers(D);
      }
      updateFlashes(dt);
      marks.end(); embers.end(); segs.end(); puffs.end();
    }

    /* ---------- body flash for meshes this module does not own (the hero): hit_flash.gd overlay as a material patch ---------- */
    const flashMats = new Map();                           // root -> { mats: [], t, dur, str }
    function flashPatch(shader) {
      shader.uniforms.uIfxFlash = this.userData.ifxFlash;
      shader.fragmentShader = 'uniform vec4 uIfxFlash;\n' + shader.fragmentShader.replace('#include <tonemapping_fragment>',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, uIfxFlash.rgb, uIfxFlash.a);\n#include <tonemapping_fragment>');
    }
    const flashKey = () => 'ifx-hitflash';
    function bindFlash(root) {
      if (!root || flashMats.has(root)) return;
      const mats = [];
      root.traverse((m) => {
        if (!m.isMesh || !m.material) return;
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
          if (mats.includes(mt) || mt.isShaderMaterial || !mt.isMaterial) continue;
          if (!mt.userData.ifxFlash) {
            if (mt.onBeforeCompile && mt.onBeforeCompile.toString() !== T.Material.prototype.onBeforeCompile.toString()) continue;
            mt.userData.ifxFlash = { value: new T.Vector4(1, 1, 1, 0) };
            mt.onBeforeCompile = flashPatch; mt.customProgramCacheKey = flashKey; mt.needsUpdate = true;
          }
          mats.push(mt);
        }
      });
      flashMats.set(root, { mats, t: 0, dur: 0.1, str: 0 });
    }
    function flashRoot(root, dur, str, rgb) {
      const F = flashMats.get(root); if (!F) return;
      const now = F.t > 0 ? F.str * F.t / F.dur : 0;
      if (str < now) return;
      F.t = F.dur = dur; F.str = str;
      for (const mt of F.mats) mt.userData.ifxFlash.value.set(rgb[0], rgb[1], rgb[2], str);
    }
    function updateFlashes(dt) {
      for (const F of flashMats.values()) {
        if (F.t <= 0) continue;
        F.t = Math.max(0, F.t - dt);
        const a = F.str * F.t / F.dur;
        for (const mt of F.mats) mt.userData.ifxFlash.value.w = a;
      }
    }

    // VFXWarmup: compile the four batch programs (and the hero flash patch) at load, not on the first hit
    function warm(renderer) {
      const all = [marks, embers, segs, puffs];
      for (const b of all) b.mesh.visible = true;
      renderer.compile(scene, camera);
      for (const b of all) b.mesh.visible = b.count > 0;
    }

    return {
      hit, kill, update, warm, bodyRadius, bindFlash, flashRoot,
      UNIT: U, NUMBER_Y: 6.0 * U, TAKEN_Y: 8.4 * U,            // damage_number.gd MOB_HIT_HEIGHT / TAKEN_HIT_HEIGHT above the feet
      FLASH,
      stats() { return { hits: hits.length, deaths: deaths.length, marks: marks.count, embers: embers.count, segs: segs.count, puffs: puffs.count }; },
      get liveHits() { return hits; },
    };
  }

  global.ImpactFX = { create, UNIT: U };
})(window);
