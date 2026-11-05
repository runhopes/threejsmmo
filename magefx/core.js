/* =====================================================================================================
 *  magefx/core.js  -  MageFX foundation: colour logic per school, quality presets, math helpers, the procedural
 *  particle atlas + school sigils (no image files), a shared GLSL noise chunk and premultiplied blending.
 *  Nothing here touches the scene. Load order: core, particles, trails, ground, meshes, spells, director.
 * ===================================================================================================== */
(function (global) {
  'use strict';
  const T = global.THREE;
  const MFX = global.MageFX = global.MageFX || {};

  /* ---------- colour logic: one palette per school, every spell of a school draws from the same entries ----------
     core = white-hot centre, hot = bright body, flame = main hue, deep = cooled edge, ember = small bright bits,
     smoke = residue, char = burnt ground, rune = sigil lines, runeHi = sigil edge / glyph accent */
  MFX.PAL = {
    fire:   { core: 0xfff3d2, hot: 0xffc04a, flame: 0xff7418, deep: 0xb82a08, ember: 0xff8a2a, smoke: 0x2c231f, char: 0x120a06, rune: 0xff7a22, runeHi: 0xffd27a },
    frost:  { core: 0xf6fdff, hot: 0xc4f0ff, flame: 0x7cd0ff, deep: 0x2a6fd0, ember: 0xe4f8ff, smoke: 0xb4d4ec, char: 0x0c2036, rune: 0x5cc0ff, runeHi: 0xd8f6ff },
    storm:  { core: 0xffffff, hot: 0xdce6ff, flame: 0x9ab4ff, deep: 0x5462f0, ember: 0xd2e0ff, smoke: 0x8c96b8, char: 0x0a0c1a, rune: 0x86a8ff, runeHi: 0xeef3ff },
    arcane: { core: 0xf8f0ff, hot: 0xdcc8ff, flame: 0xa880ff, deep: 0x5836cc, ember: 0xe8dcff, smoke: 0x6a5a92, char: 0x110a22, rune: 0xa486ff, runeHi: 0xf0e6ff },
    ward:   { core: 0xeef6ff, hot: 0xbcd4ff, flame: 0x6c98ff, deep: 0x2c4cc4, ember: 0xd8e6ff, smoke: 0x5a6a92, char: 0x0a1226, rune: 0x78a4ff, runeHi: 0xffd98a },
  };
  MFX.DUST = { light: 0xc2b291, mid: 0x9c8b6b, dark: 0x6e6150 };   // matches the village's sandy ground

  /* ---------- scalable performance: particle budget, spawn density, trail resolution, lights, instanced shards ---------- */
  MFX.QUALITY = {
    low:    { density: 0.45, maxParticles: 1400, trailPts: 14, lights: 1, shards: 32, decalDetail: 0 },
    medium: { density: 0.75, maxParticles: 2600, trailPts: 22, lights: 2, shards: 56, decalDetail: 1 },
    high:   { density: 1.0,  maxParticles: 4000, trailPts: 30, lights: 2, shards: 80, decalDetail: 1 },
  };

  /* ---------- math ---------- */
  const TAU = Math.PI * 2;
  const M = MFX.math = {
    TAU,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    clamp01: (v) => (v < 0 ? 0 : v > 1 ? 1 : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    rnd: (a) => (Math.random() * 2 - 1) * a,
    pick: (arr) => arr[(Math.random() * arr.length) | 0],
    smooth: (a, b, x) => { const t = M.clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); },
    easeOut: (t) => 1 - Math.pow(1 - M.clamp01(t), 3),
    easeOut2: (t) => 1 - Math.pow(1 - M.clamp01(t), 2),
    easeIn: (t) => { t = M.clamp01(t); return t * t; },
    easeOutBack: (t, s) => { s = s === undefined ? 1.7 : s; const u = M.clamp01(t) - 1; return 1 + u * u * ((s + 1) * u + s); },
    // probabilistic rounding: 2.3 -> 2 (70%) or 3 (30%), so low densities still spawn the right average
    count: (n) => { const f = Math.floor(n); return f + (Math.random() < n - f ? 1 : 0); },
    // uniform random direction (out = Vector3)
    sphere: (out) => { const z = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - z * z); return out.set(r * Math.cos(a), z, r * Math.sin(a)); },
    // random direction biased upward: y in [yMin, yMax]
    hemi: (out, yMin, yMax) => { const y = M.rand(yMin, yMax), a = Math.random() * TAU, r = Math.sqrt(Math.max(0, 1 - y * y)); return out.set(r * Math.cos(a), y, r * Math.sin(a)); },
  };

  /* ---------- premultiplied blending: rgb is ADDED, alpha only DARKENS what is behind. One material can then be
     additive (alpha 0), alpha-blended (alpha = coverage) or anything in between, per pixel. ---------- */
  MFX.premul = (params) => Object.assign({
    transparent: true, depthWrite: false,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
  }, params);

  /* ---------- shared GLSL: value noise 2D/3D, fbm, cellular edge distance (cracks), hash ---------- */
  MFX.GLSL_NOISE = [
    'float mfxHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float mfxNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mfxHash(i), mfxHash(i + vec2(1.0, 0.0)), u.x), mix(mfxHash(i + vec2(0.0, 1.0)), mfxHash(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float mfxFbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * mfxNoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s / 0.9375; }',
    'float mfxHash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float mfxNoise3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(mfxHash3(i), mfxHash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(mfxHash3(i + vec3(0.0, 1.0, 0.0)), mfxHash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
    '             mix(mix(mfxHash3(i + vec3(0.0, 0.0, 1.0)), mfxHash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(mfxHash3(i + vec3(0.0, 1.0, 1.0)), mfxHash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }',
    'float mfxFbm3(vec3 p){ return 0.55 * mfxNoise3(p) + 0.3 * mfxNoise3(p * 2.07 + vec3(3.1)) + 0.15 * mfxNoise3(p * 4.13 + vec3(7.7)); }',
    'vec2 mfxHash22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }',
    // distance to the nearest Voronoi cell border (straight-edged cells = cracks / crystal facets)
    'float mfxCellEdge(vec2 x){ vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0); float md = 8.0;',
    '  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec2 r = g + mfxHash22(n + g) - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }',
    '  md = 8.0;',
    '  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 g = mg + vec2(float(i), float(j)); vec2 r = g + mfxHash22(n + g) - f;',
    '    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }',
    '  return md; }',
  ].join('\n');

  /* ---------- JS value noise for texture generation ---------- */
  function makeNoise(seed) {
    const P = new Float32Array(512); let s = (seed * 9301 + 49297) % 233280 + 1;
    for (let i = 0; i < 512; i++) { s = (s * 16807) % 2147483647; P[i] = s / 2147483647; }
    const h = (x, y) => P[(((x * 73856093) ^ (y * 19349663)) >>> 0) & 511];
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y, o) => { let sum = 0, a = 0.5, f = 1, norm = 0; for (let i = 0; i < (o || 4); i++) { sum += a * n(x * f + i * 17.3, y * f + i * 9.1); norm += a; a *= 0.5; f *= 2.03; } return sum / norm; };
    return { n, fbm };
  }

  /* ---------- glyph alphabet: the mage's arcane script. Every sigil, orbiting rune and rune particle uses these
     strokes, so all nine spells read as one class. Polylines in a [-1, 1] box (y up); {c:[x,y,r]} = circle ---------- */
  const GLYPHS = [
    [[[-0.6, -0.8], [0, 0.85], [0.6, -0.8]], [[-0.32, -0.12], [0.32, -0.12]]],
    [[[0, -0.9], [0, 0.9]], [[-0.6, 0.55], [0, 0.1], [0.6, 0.55]]],
    [[[-0.6, 0.8], [0.6, 0.8], [-0.6, -0.8], [0.6, -0.8]]],
    [[[-0.45, -0.9], [-0.45, 0.9], [0.5, 0.35], [-0.45, 0.0]]],
    [[[0, 0.9], [0.65, 0], [0, -0.9], [-0.65, 0], [0, 0.9]], [[0, 0.32], [0, -0.32]]],
    [[[-0.65, 0.65], [0, -0.75], [0.65, 0.65]], [[0, -0.75], [0, 0.9]]],
    [[[-0.55, -0.85], [-0.55, 0.85]], [[0.55, -0.85], [0.55, 0.85]], [[-0.55, -0.15], [0.55, 0.35]]],
    [[[0.6, 0.8], [-0.4, 0.8], [-0.4, -0.8], [0.6, -0.8]], [[-0.4, 0], [0.3, 0]]],
    [[[-0.7, -0.6], [0, 0.8], [0.7, -0.6], [-0.7, -0.6]], { c: [0, -0.1, 0.18] }],
    [[[0, -0.9], [0, 0.9]], [[-0.6, 0.9], [0.6, 0.9]], [[-0.42, -0.3], [0.42, -0.3]]],
    [{ c: [0, 0.35, 0.42] }, [[0, -0.07], [0, -0.9]], [[-0.45, -0.55], [0.45, -0.55]]],
    [[[-0.7, 0.2], [-0.25, 0.75], [0.25, -0.75], [0.7, -0.2]]],
  ];
  MFX.GLYPHS = GLYPHS;
  function drawGlyph(g, idx, x, y, size, rot) {
    const G = GLYPHS[((idx % GLYPHS.length) + GLYPHS.length) % GLYPHS.length];
    const lw = g.lineWidth;                                         // line width is in canvas px, not glyph units
    g.save(); g.translate(x, y); g.rotate(rot || 0); g.scale(size, -size); g.lineWidth = lw / size;
    for (const s of G) {
      g.beginPath();
      if (s.c) g.arc(s.c[0], s.c[1], s.c[2], 0, TAU);
      else s.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
    }
    g.restore();
  }

  /* =====================================================================================================
   *  PARTICLE ATLAS: 4 x 4 cells of 128 px, built procedurally into a DataTexture (exact alpha, no canvas
   *  premultiply loss). Luminance in rgb gives internal shading, alpha is the shape. Tinted by particle colour.
   * ===================================================================================================== */
  const CELL = 128, GRID = 4;
  MFX.ATLAS_GRID = GRID;
  const F = MFX.FRAME = { GLOW: 0, CORE: 1, SPARK: 2, FLAME_A: 3, FLAME_B: 4, TONGUE: 5, SMOKE_A: 6, SMOKE_B: 7,
                          EMBER: 8, SHARD: 9, STAR: 10, RING: 11, RUNE_A: 12, RUNE_B: 13, ARC: 14, FLAKE: 15 };
  function buildAtlas() {
    const W = CELL * GRID, data = new Uint8Array(W * W * 4);
    const cl = M.clamp01, sm = M.smooth;
    const put = (frame, fn) => {
      const col = frame % GRID, rowTop = Math.floor(frame / GRID), oy = (GRID - 1 - rowTop) * CELL, ox = col * CELL;
      for (let py = 0; py < CELL; py++) {                          // py counted from the cell's BOTTOM (DataTexture rows go up)
        const y = (py + 0.5) / CELL * 2 - 1;
        for (let px = 0; px < CELL; px++) {
          const x = (px + 0.5) / CELL * 2 - 1, r = fn(x, y, Math.hypot(x, y));
          const k = ((oy + py) * W + ox + px) * 4, L = cl(r[0]) * 255;
          data[k] = L; data[k + 1] = L; data[k + 2] = L; data[k + 3] = cl(r[1]) * 255;
        }
      }
    };
    const nA = makeNoise(3), nB = makeNoise(11), nC = makeNoise(29);
    put(F.GLOW, (x, y, r) => [1, Math.pow(Math.max(0, 1 - r), 1.9)]);
    put(F.CORE, (x, y, r) => [1, 1 - sm(0.3, 0.92, r)]);
    put(F.SPARK, (x, y) => [1, Math.exp(-x * x / 0.06) * Math.pow(cl((y + 1) / 1.85), 1.5) * (1 - sm(0.82, 1.0, y))]);
    for (const [fr, N, s] of [[F.FLAME_A, nA, 0], [F.FLAME_B, nB, 5.3]]) {
      put(fr, (x, y, r) => {
        const n = N.fbm(x * 1.7 + s, y * 1.7 - s, 3), rr = r + (n - 0.5) * 0.6 - y * 0.06;
        const a = (1 - sm(0.38, 0.92, rr)) * (0.86 + 0.14 * N.fbm(x * 3.2 + s, y * 3.2, 2));
        return [0.68 + 0.32 * (1 - sm(0, 0.75, r)), a];
      });
    }
    put(F.TONGUE, (x, y) => {
      const t = (y + 1) / 2, w = 0.6 * Math.pow(1 - t, 0.8) * Math.sqrt(Math.min(1, t * 4)) + 1e-3;
      const wig = (nC.n(t * 3.2, 0.5) - 0.5) * 0.3 * t, xx = Math.abs(x - wig) / w;
      return [0.66 + 0.34 * (1 - t), (1 - sm(0.5, 1.0, xx)) * (1 - sm(0.86, 1.0, t)) * sm(0.0, 0.1, t)];
    });
    for (const [fr, N, s] of [[F.SMOKE_A, nB, 2], [F.SMOKE_B, nC, 7.7]]) {
      put(fr, (x, y, r) => {
        const n = N.fbm(x * 1.5 + s, y * 1.5 + s, 3), n2 = N.fbm(x * 3 - s, y * 3, 3);
        return [0.8 + 0.2 * n, (1 - sm(0.2, 0.95, r + (n - 0.5) * 0.7)) * (0.55 + 0.45 * n2)];
      });
    }
    put(F.EMBER, (x, y, r) => [1, Math.exp(-r * r / 0.03) + 0.32 * Math.exp(-r * r / 0.16)]);
    put(F.SHARD, (x, y) => {                                     // crisp elongated crystal, lit facet on the right, ridge line
      const d = Math.abs(x) / 0.34 + Math.abs(y) / 0.96;
      let L = x > 0 ? 1 : 0.6; L = Math.max(L, Math.exp(-x * x / 0.0016) * 1.0, sm(0.78, 0.96, d));
      return [L, 1 - sm(0.92, 1.0, d)];
    });
    put(F.STAR, (x, y, r) => {
      const ax = Math.abs(x), ay = Math.abs(y);
      return [1, (Math.max(Math.exp(-ax * 15) * Math.exp(-ay * 2.4), Math.exp(-ay * 15) * Math.exp(-ax * 2.4)) * (1 - sm(0.85, 1, r)) + Math.exp(-r * r / 0.02))];
    });
    put(F.RING, (x, y, r) => [1, Math.exp(-Math.pow((r - 0.8) / 0.07, 2)) + 0.3 * Math.exp(-Math.pow((r - 0.8) / 0.2, 2))]);
    // stroke-drawn cells (runes, arc, snowflake) on a scratch canvas, copied in flipped
    const strokeCell = (frame, draw) => {
      const c = document.createElement('canvas'); c.width = c.height = CELL;
      const g = c.getContext('2d'); g.translate(CELL / 2, CELL / 2); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 9; draw(g); g.shadowBlur = 0; draw(g);
      const src = g.getImageData(0, 0, CELL, CELL).data;
      const col = frame % GRID, rowTop = Math.floor(frame / GRID), oy = (GRID - 1 - rowTop) * CELL, ox = col * CELL;
      for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
        const s = ((CELL - 1 - py) * CELL + px) * 4, k = ((oy + py) * W + ox + px) * 4;
        data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = src[s + 3];
      }
    };
    strokeCell(F.RUNE_A, (g) => { g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 54, 0, TAU); g.stroke(); g.lineWidth = 7.5; drawGlyph(g, 4, 0, 0, 30, 0); });
    strokeCell(F.RUNE_B, (g) => { g.lineWidth = 8; drawGlyph(g, 1, 0, 0, 44, 0); });
    strokeCell(F.ARC, (g) => {
      let seed = 5; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
      g.lineWidth = 5; g.beginPath(); g.moveTo(-56, 10);
      for (let i = 1; i <= 7; i++) g.lineTo(-56 + i * 16, 10 - i * 3 + R() * 34);
      g.stroke(); g.lineWidth = 3; g.beginPath(); g.moveTo(-8, 2); g.lineTo(6, 26); g.lineTo(16, 38); g.stroke();
    });
    strokeCell(F.FLAKE, (g) => {
      g.lineWidth = 6;
      for (let k = 0; k < 6; k++) {
        g.save(); g.rotate(k * Math.PI / 3); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -54);
        for (const d of [22, 38]) { g.moveTo(0, -d); g.lineTo(-12, -d - 12); g.moveTo(0, -d); g.lineTo(12, -d - 12); }
        g.stroke(); g.restore();
      }
    });
    const tex = new T.DataTexture(data, W, W, T.RGBAFormat, T.UnsignedByteType);
    tex.generateMipmaps = true; tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /* =====================================================================================================
   *  SCHOOL SIGILS (512 px canvas): the same construction for every school - double outer ring, glyph band,
   *  inner ring, school geometry - so they read as one mage's magic. Red channel = lines, green = glyph accents
   *  (the shader colours them separately: lines in the school hue, glyphs in its highlight).
   *  The crisp OUTER EDGE that marks the gameplay radius is drawn by the decal shader, not the texture.
   * ===================================================================================================== */
  function buildSigil(kind) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d'); g.translate(256, 256); g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    const R = 248, LINE = 'rgba(255,0,0,1)', ACC = 'rgba(0,255,0,1)';
    const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };
    const poly = (n, r, rot, w) => { g.lineWidth = w; g.beginPath(); for (let k = 0; k <= n; k++) { const a = rot + k * TAU / n; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); };
    const star = (n, step, r, rot, w) => { g.lineWidth = w; g.beginPath(); for (let k = 0; k <= n; k++) { const a = rot + (k * step % n) * TAU / n; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); };
    const pass = (glow) => {
      g.shadowBlur = glow ? 14 : 0;
      g.strokeStyle = g.fillStyle = g.shadowColor = LINE; g.globalAlpha = glow ? 0.55 : 1;
      ring(R * 0.97, 5); ring(R * 0.915, 2.5); ring(R * 0.7, 3.5);
      for (let k = 0; k < 36; k++) {                              // tick marks between the outer rings
        const a = k * TAU / 36; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.915, Math.sin(a) * R * 0.915); g.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97); g.stroke();
      }
      if (kind === 'fire') {
        poly(3, R * 0.69, -Math.PI / 2, 4); poly(3, R * 0.69, Math.PI / 2, 4); poly(6, R * 0.36, -Math.PI / 2, 3); ring(R * 0.18, 3);
        for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * TAU / 6; g.lineWidth = 3; g.beginPath(); g.arc(Math.cos(a) * R * 0.69, Math.sin(a) * R * 0.69, R * 0.045, 0, TAU); g.stroke(); }
        for (let k = 0; k < 12; k++) { const a = k * TAU / 12; g.lineWidth = 2.5; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22); g.lineTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3); g.stroke(); }
      } else if (kind === 'frost') {
        poly(6, R * 0.69, 0, 4); poly(6, R * 0.3, Math.PI / 6, 3);
        for (let k = 0; k < 6; k++) {
          g.save(); g.rotate(k * Math.PI / 3); g.lineWidth = 3.5; g.beginPath(); g.moveTo(R * 0.1, 0); g.lineTo(R * 0.66, 0);
          for (const d of [0.34, 0.5]) { g.moveTo(R * d, 0); g.lineTo(R * (d + 0.08), R * 0.08); g.moveTo(R * d, 0); g.lineTo(R * (d + 0.08), -R * 0.08); }
          g.stroke(); g.restore();
        }
      } else if (kind === 'storm') {
        poly(3, R * 0.69, -Math.PI / 2, 4); ring(R * 0.24, 3); ring(R * 0.5, 1.5);
        for (let k = 0; k < 3; k++) {
          g.save(); g.rotate(-Math.PI / 2 + k * TAU / 3); g.lineWidth = 4; g.beginPath(); g.moveTo(R * 0.24, 0);
          g.lineTo(R * 0.36, R * 0.07); g.lineTo(R * 0.44, -R * 0.06); g.lineTo(R * 0.56, R * 0.06); g.lineTo(R * 0.67, 0); g.stroke(); g.restore();
        }
      } else {                                                    // arcane / ward: 8-point star, ring of dots
        star(8, 3, R * 0.69, 0, 3.5); ring(R * 0.42, 3); ring(R * 0.12, 3);
        for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + TAU / 16; g.beginPath(); g.arc(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, 6, 0, TAU); g.fill(); }
      }
      g.strokeStyle = g.fillStyle = g.shadowColor = ACC;          // glyph band (accent channel)
      const N = kind === 'fire' ? 18 : 16;
      for (let k = 0; k < N; k++) { const a = k * TAU / N; g.lineWidth = 3.4; drawGlyph(g, k * 7 + kind.length, Math.cos(a) * R * 0.808, Math.sin(a) * R * 0.808, R * 0.052, a + Math.PI / 2); }
      g.globalAlpha = 1;
    };
    pass(true); pass(false);
    return c;
  }

  /* ---------- texture cache (built once per page) ---------- */
  let cache = null;
  MFX.textures = function (renderer) {
    if (cache) return cache;
    const aniso = renderer && renderer.capabilities ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    // premultiplyAlpha: the canvas glow (shadowBlur) leaves huge areas of alpha ~1/255; un-premultiplied they would upload
    // as FULL-strength red / green and fill the whole sigil. Premultiplied, channel = coverage.
    const sig = (k) => { const t = new T.CanvasTexture(buildSigil(k)); t.anisotropy = aniso; t.minFilter = T.LinearMipmapLinearFilter; t.premultiplyAlpha = true; return t; };
    cache = { atlas: buildAtlas(), sigils: { fire: sig('fire'), frost: sig('frost'), storm: sig('storm'), arcane: sig('arcane') } };
    cache.sigils.ward = cache.sigils.arcane;
    return cache;
  };

  /* ---------- colour helpers ---------- */
  MFX.rgb = (hex, k) => { const c = new T.Color(hex); k = k === undefined ? 1 : k; return [c.r * k, c.g * k, c.b * k]; };
})(typeof window !== 'undefined' ? window : globalThis);
