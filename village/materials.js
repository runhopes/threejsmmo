/* =====================================================================================================
 *  village/materials.js  -  procedural canvas textures (diffuse + derived normal maps) and the shared
 *  material library of the village. No image files: every texture is generated from seeded noise.
 *  Textures are near-neutral in hue; per-building tints come from vertex colours, so one material serves
 *  many buildings (few draw calls) while each house still gets its own plaster / timber / roof colour.
 *
 *  Occluder dithering ("camera-aware roof fading"): building materials discard a dithered share of the
 *  fragments that sit inside a cylinder between the camera and the hero, only in front of the hero and
 *  only above knee height. Nothing is made transparent, nothing changes when the hero is in the open.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const { fbm, vnoise, rng, clamp, smooth } = V;

  /* ---------------------------------------------- helpers ---------------------------------------------- */
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  // per-pixel generator: fn(x, y, out) fills out.r/g/b (0..1) and out.h (height 0..1)
  V.genTimes = [];
  function gen(size, fn) {
    const tg0 = performance.now();
    const c = canvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
    const H = new Float32Array(size * size), o = { r: 0, g: 0, b: 0, h: 0 };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      fn(x, y, o);
      const i = y * size + x;
      d[i * 4] = clamp(o.r, 0, 1) * 255; d[i * 4 + 1] = clamp(o.g, 0, 1) * 255; d[i * 4 + 2] = clamp(o.b, 0, 1) * 255; d[i * 4 + 3] = 255;
      H[i] = o.h;
    }
    ctx.putImageData(img, 0, 0);
    V.genTimes.push(Math.round(performance.now() - tg0));
    return { canvas: c, H, size };
  }
  function normalCanvas(H, size, strength) {
    const c = canvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
    const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  function tex(c, aniso) {
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = aniso || V.maxAniso || 4;
    return t;
  }
  const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /* ---------------------------------------------- generators ---------------------------------------------- */
  // coursed ashlar masonry: rows of rectangular blocks with mortar joints, chipped bevels and tonal variation
  function ashlar(size, meters, seed, o) {
    o = o || {};
    const R = rng(seed), pxm = size / meters;
    const courses = []; let y = 0;
    while (y < size) {
      let h = Math.round((o.ch[0] + R() * (o.ch[1] - o.ch[0])) * pxm);
      if (size - (y + h) < o.ch[0] * pxm * 0.8) h = size - y;
      courses.push([y, y + h]); y += h;
    }
    const courseOf = new Int16Array(size);
    courses.forEach((c, i) => { for (let k = c[0]; k < c[1]; k++) courseOf[k] = i; });
    const rows = courses.map((c, ci) => {
      const off = Math.floor(R() * size), map = new Int16Array(size), st = [], en = [], tone = [], hue = [];
      let x = 0, bi = 0;
      while (x < size) {
        let w = Math.round((o.bw[0] + R() * (o.bw[1] - o.bw[0])) * pxm);
        if (size - (x + w) < o.bw[0] * pxm * 0.7) w = size - x;
        for (let k = x; k < x + w; k++) map[k] = bi;
        st.push(x); en.push(x + w); tone.push(0.84 + R() * 0.26); hue.push(R()); x += w; bi++;
      }
      return { off, map, st, en, tone, hue };
    });
    const pal = (o.palette || [0xaaa497, 0xa29d92, 0xb2aa9a, 0x9b978d, 0xa89e8b, 0x9fa096]).map(hexRGB);
    const mortar = hexRGB(o.mortar || 0x7f796e), mw = (o.mortar_w || 0.022) * pxm, bev = (o.bevel || 0.05) * pxm;
    const P = size / 32;
    return gen(size, (x, y, out) => {
      const ci = courseOf[y], row = rows[ci], c = courses[ci];
      const ux = (x - row.off + size * 4) % size, bi = row.map[ux];
      const n1 = fbm(x / 32, y / 32, 4, P, seed), n2 = vnoise(x / 4, y / 4, size / 4, seed + 9);
      const chip = (fbm(x / 9, y / 9, 2, size / 9, seed + 3) - 0.5) * 5;
      const ex = Math.min(ux - row.st[bi], row.en[bi] - 1 - ux), ey = Math.min(y - c[0], c[1] - 1 - y);
      const e = Math.min(ex, ey) + chip;
      if (e < mw * 0.5) {
        const k = 0.86 + n2 * 0.2;
        out.r = mortar[0] * k; out.g = mortar[1] * k; out.b = mortar[2] * k; out.h = 0.08 + n2 * 0.05;
        return;
      }
      const base = pal[Math.floor(row.hue[bi] * pal.length) % pal.length];
      const sh = smooth(0, bev, e - mw * 0.5);
      const k = row.tone[bi] * (0.9 + 0.2 * n1) * (0.97 + 0.06 * n2) * (0.8 + 0.2 * sh);
      out.r = base[0] * k; out.g = base[1] * k; out.b = base[2] * k;
      out.h = 0.35 + 0.5 * sh + (n1 - 0.5) * 0.25;
    });
  }
  // voronoi stones: rubble walls, cobbles (tiles: wraps the jittered grid)
  function voronoi(size, cells, seed, o) {
    const R = rng(seed);
    const pts = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + 0.15 + R() * 0.7) / cells, (j + 0.15 + R() * 0.7) / cells, R(), R()]);
    const ax = o.ax || 1, gap = o.gap || 0.06, bev = o.bevel || 0.12;
    const pal = (o.palette).map(hexRGB), mortar = hexRGB(o.mortar);
    const P = size / 32;
    return gen(size, (x, y, out) => {
      const u = x / size, v = y / size;
      const gi = Math.floor(u * cells), gj = Math.floor(v * cells);
      let d1 = 9, d2 = 9, best = null;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (gi + di + cells) % cells, jj = (gj + dj + cells) % cells, p = pts[jj * cells + ii];
        let px = p[0] + Math.floor((gi + di) / cells) * 0 + (gi + di < 0 ? -1 : gi + di >= cells ? 1 : 0), py = p[1] + (gj + dj < 0 ? -1 : gj + dj >= cells ? 1 : 0);
        const dx = (u - px) * cells * ax, dy = (v - py) * cells, d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const n = fbm(x / 24, y / 24, 3, P * (32 / 24) | 0, seed + 5), n2 = vnoise(x / 3, y / 3, size / 3, seed + 7);
      const e = (d2 - d1) + (n - 0.5) * 0.08;
      if (e < gap) {
        const k = 0.8 + n2 * 0.3;
        out.r = mortar[0] * k; out.g = mortar[1] * k; out.b = mortar[2] * k; out.h = 0.05 + n * 0.1; return;
      }
      const base = pal[Math.floor(best[2] * pal.length) % pal.length];
      const sh = smooth(0, bev, e - gap), dome = 1 - Math.min(1, d1 * 0.9);
      const k = (0.82 + best[3] * 0.28) * (0.88 + 0.22 * n) * (0.96 + 0.08 * n2) * (0.82 + 0.18 * sh) * (0.94 + 0.08 * dome);
      out.r = base[0] * k; out.g = base[1] * k; out.b = base[2] * k;
      out.h = 0.3 + 0.45 * sh + 0.25 * dome + (n2 - 0.5) * 0.06;
    });
  }

  /* ---------------------------------------------- texture set ---------------------------------------------- */
  V.buildTextures = function (renderer) {
    V.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
    const X = {};
    const t0 = performance.now();
    const pack = (g, ns, name) => { X[name] = tex(g.canvas); X[name + 'N'] = tex(normalCanvas(g.H, g.size, ns)); };

    // castle / keep masonry: 512 px = 2.4 m
    pack(ashlar(512, 2.4, 11, { ch: [0.26, 0.42], bw: [0.42, 0.95], mortar: 0x847d71, bevel: 0.05 }), 5, 'ashlar');
    // flagstone paving for wall walks & stair treads (bigger, flatter slabs)
    pack(ashlar(512, 3.2, 23, { ch: [0.5, 0.8], bw: [0.55, 1.1], mortar: 0x6d675d, bevel: 0.03, palette: [0xa59f93, 0x9d988e, 0xaba395, 0x97928a] }), 3, 'flag');
    // rubble / fieldstone (house foundations, wells, low walls): 512 px = 2.6 m
    pack(voronoi(512, 9, 31, { ax: 0.72, gap: 0.075, bevel: 0.16, mortar: 0x6b655a, palette: [0x9c968a, 0x8f8a80, 0xa69e8e, 0x88857d, 0x9a9282, 0xa3a094] }), 6, 'rubble');
    // plaster: lime wash with trowel mottling and faint grime. 512 px = 3 m
    {
      const g = gen(512, (x, y, o) => {
        const n = fbm(x / 64, y / 64, 4, 8, 41), m = fbm(x / 12, y / 12, 3, 512 / 12 | 0, 43), f = vnoise(x / 2, y / 2, 256, 47);
        const blot = smooth(0.55, 0.8, fbm(x / 128, y / 128, 3, 4, 49));
        const k = 0.9 + 0.08 * n + 0.04 * m + 0.03 * f - 0.07 * blot;
        o.r = 0.93 * k; o.g = 0.9 * k; o.b = 0.84 * k; o.h = n * 0.6 + m * 0.3 + f * 0.1;
      });
      pack(g, 1.6, 'plaster');
    }
    // wood grain (beams, posts): grain runs along u. 512 px = 2 m (u) x 2 m (v)
    {
      const g = gen(512, (x, y, o) => {
        const warp = fbm(x / 90, y / 18, 3, 0, 51) * 7;
        const ring = 0.5 + 0.5 * Math.sin(y / 3.1 + warp * 2.6);
        const streak = fbm(x / 140, y / 2.2, 3, 0, 53);
        const plankEdge = smooth(0, 3, Math.min(y % 128, 127 - (y % 128)));
        const k = (0.78 + 0.12 * ring + 0.16 * streak) * (0.82 + 0.18 * plankEdge);
        o.r = 0.86 * k; o.g = 0.76 * k; o.b = 0.64 * k; o.h = ring * 0.4 + streak * 0.4 + plankEdge * 0.2;
      });
      pack(g, 2.2, 'wood');
    }
    // planks: boards with seams every 0.2 m (along v), staggered butt joints, nail heads. 512 px = 2 m
    {
      const R = rng(61), bh = 51.2, rows = [];
      for (let i = 0; i < 10; i++) rows.push({ j: Math.floor(R() * 512), t: 0.86 + R() * 0.24, s: R() * 100 });
      const g = gen(512, (x, y, o) => {
        const ri = Math.floor(y / bh), r = rows[ri], yy = y - ri * bh;
        const ux = (x + r.j) % 512;
        const seam = Math.min(yy, bh - 1 - yy), joint = Math.min(ux, 511 - ux, Math.abs(ux - 256));
        const grain = 0.5 + 0.5 * Math.sin(yy / 2.4 + fbm(ux / 70, yy / 9 + r.s, 3, 0, 63) * 9);
        const n = fbm(x / 40, y / 40, 3, 12, 65);
        let k = r.t * (0.8 + 0.12 * grain + 0.14 * n);
        const e = Math.min(seam, joint);
        k *= 0.62 + 0.38 * smooth(0, 3, e);
        const nail = (Math.hypot(ux % 256 - 12, yy - bh * 0.5) < 2.2) ? 0.55 : 1;
        o.r = 0.86 * k * nail; o.g = 0.75 * k * nail; o.b = 0.62 * k * nail; o.h = smooth(0, 3, e) * 0.7 + grain * 0.2 + n * 0.1;
      });
      pack(g, 2.6, 'planks');
    }
    // shingles / slates: rows of 0.2 m, butt edge at the bottom of each row casts a step. 512 px = 2 m
    {
      const R = rng(71), rowH = 51.2, rows = [];
      for (let i = 0; i < 10; i++) { const cuts = [0]; let x = 0; while (x < 512) { x += 26 + R() * 34; if (x > 500) x = 512; cuts.push(Math.round(x)); } const off = Math.floor(R() * 512); rows.push({ cuts, off, tones: cuts.map(() => 0.8 + R() * 0.32), moss: cuts.map(() => R()) }); }
      const g = gen(512, (x, y, o) => {
        const ri = Math.floor(y / rowH), r = rows[ri], yy = (y - ri * rowH) / rowH;     // yy: 0 top (up-slope) .. 1 butt edge (down-slope)
        const ux = (x + r.off) % 512;
        let si = 0; while (si < r.cuts.length - 2 && r.cuts[si + 1] <= ux) si++;
        const gap = Math.min(ux - r.cuts[si], r.cuts[si + 1] - 1 - ux);
        const n = fbm(x / 20, y / 20, 3, 25, 73), m = fbm(x / 70, y / 70, 3, 7, 75);
        let k = r.tones[si] * (0.86 + 0.18 * n) * (0.7 + 0.3 * smooth(0, 2.5, gap));
        k *= 0.66 + 0.34 * smooth(0, 0.35, yy) * (1 - 0.25 * smooth(0.85, 1, yy));
        const moss = smooth(0.62, 0.8, m) * (r.moss[si] > 0.55 ? 0.6 : 0.25);
        o.r = (0.8 * (1 - moss) + 0.62 * moss) * k; o.g = (0.78 * (1 - moss) + 0.68 * moss) * k; o.b = (0.75 * (1 - moss) + 0.46 * moss) * k;
        o.h = yy * 0.8 * smooth(0, 2.5, gap) + n * 0.15;
      });
      pack(g, 4.2, 'shingle');
    }
    // thatch: combed straw strands along the slope (v), layered courses. 512 px = 2 m
    {
      const g = gen(512, (x, y, o) => {
        const strand = fbm(x / 1.6, y / 40, 3, 0, 81), clump = fbm(x / 14, y / 30, 3, 0, 83);
        const course = (y % 102) / 102, band = 0.72 + 0.28 * smooth(0, 0.3, course);
        const n = fbm(x / 60, y / 60, 3, 8, 85);
        const k = (0.62 + 0.3 * strand + 0.18 * clump) * band * (0.9 + 0.15 * n);
        o.r = 0.8 * k; o.g = 0.74 * k; o.b = 0.62 * k; o.h = strand * 0.6 + clump * 0.2 + band * 0.2;
      });
      pack(g, 3.2, 'thatch');
    }
    // leaded diamond glass. 256 px = 0.6 m
    {
      const g = gen(256, (x, y, o) => {
        const s = 32, u = ((x + y) % s + s) % s, v = ((x - y) % s + s) % s;
        const lead = Math.min(u, s - u, v, s - v) < 1.6;
        const pane = Math.floor((x + y) / s) * 7 + Math.floor((x - y + 512) / s) * 13;
        const n = vnoise(pane, 0.5, 0, 91);
        const k = 0.17 + 0.12 * n + 0.05 * fbm(x / 20, y / 20, 2, 12, 93);
        if (lead) { o.r = 0.12; o.g = 0.12; o.b = 0.12; o.h = 1; } else { o.r = k * 0.9; o.g = k * 1.0; o.b = k * 1.05; o.h = 0.2; }
      });
      pack(g, 3, 'glass');
    }
    // canopy cloth atlas: 6 bands of stripes over a linen weave (u along the canopy, v selects the band)
    {
      const bands = [[0xcdc2a8, 0x7a3f34], [0xcbc1a8, 0x445968], [0xcdc3ab, 0x646a46], [0xc6baa0, 0x75603a], [0xcdc3ad, 0x5a4052], [0xbfb196, 0xbfb196]].map((p) => [hexRGB(p[0]), hexRGB(p[1])]);
      const g = gen(512, (x, y, o) => {
        const bi = Math.min(5, Math.floor(y / (512 / 6))), b = bands[bi];
        const stripe = Math.floor(x / 32) % 2 === 0;
        const weave = 0.9 + 0.06 * Math.sin(x * 1.9) * Math.sin(y * 1.7) + 0.06 * vnoise(x / 2, y / 2, 256, 101);
        const dirt = 0.9 + 0.1 * fbm(x / 50, y / 50, 3, 10, 103);
        const c = stripe ? b[1] : b[0], k = weave * dirt;
        o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.h = weave;
      });
      X.cloth = tex(g.canvas); X.clothN = tex(normalCanvas(g.H, 512, 1.2));
    }
    // heraldic banner: muted madder red field, ochre chevron with a tower-and-star device, bordure
    {
      const c = canvas(256, 512), g = c.getContext('2d');
      g.fillStyle = '#6a2a24'; g.fillRect(0, 0, 256, 512);
      g.strokeStyle = '#b08a4a'; g.lineWidth = 10; g.strokeRect(12, 12, 232, 488);
      g.fillStyle = '#b8924e';
      g.beginPath(); g.moveTo(24, 300); g.lineTo(128, 210); g.lineTo(232, 300); g.lineTo(232, 345); g.lineTo(128, 255); g.lineTo(24, 345); g.closePath(); g.fill();
      // tower
      g.fillRect(98, 90, 60, 90); for (let i = 0; i < 4; i++) g.fillRect(94 + i * 18, 72, 12, 22);
      g.fillStyle = '#6a2a24'; g.beginPath(); g.moveTo(118, 180); g.lineTo(118, 150); g.arc(128, 150, 10, Math.PI, 0); g.lineTo(138, 180); g.fill();
      // star
      g.fillStyle = '#b8924e'; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 11 : 26; g[i ? 'lineTo' : 'moveTo'](128 + Math.cos(a) * r, 410 + Math.sin(a) * r); }
      g.closePath(); g.fill();
      // cloth weave + grime
      const img = g.getImageData(0, 0, 256, 512), d = img.data;
      for (let y = 0; y < 512; y++) for (let x = 0; x < 256; x++) {
        const k = (0.86 + 0.08 * Math.sin(x * 2.1) * Math.sin(y * 1.9) + 0.08 * fbm(x / 30, y / 30, 3, 0, 111)) * (1 - 0.18 * (y / 512));
        const i = (y * 256 + x) * 4; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
      }
      g.putImageData(img, 0, 0);
      X.banner = tex(c); X.banner.wrapS = X.banner.wrapT = T.ClampToEdgeWrapping;
    }
    // sackcloth / burlap
    {
      const g = gen(128, (x, y, o) => {
        const w = 0.82 + 0.1 * Math.sin(x * 2.3) * Math.sin(y * 2.3) + 0.08 * vnoise(x / 2, y / 2, 64, 121);
        const k = w * (0.9 + 0.1 * fbm(x / 20, y / 20, 2, 6, 123));
        o.r = 0.8 * k; o.g = 0.72 * k; o.b = 0.56 * k; o.h = w;
      });
      pack(g, 2, 'burlap');
    }
    // foliage: soft leaf-cluster mottling (used with world uv on canopies / hedges)
    {
      const g = gen(256, (x, y, o) => {
        const n = fbm(x / 10, y / 10, 3, 25, 131), m = vnoise(x / 3, y / 3, 85, 133);
        const leaf = smooth(0.35, 0.75, n) * 0.6 + m * 0.4;
        const k = 0.72 + 0.4 * leaf;
        o.r = 0.9 * k; o.g = 1.0 * k; o.b = 0.82 * k; o.h = leaf;
      });
      pack(g, 3, 'leaf');
    }

    /* ---- terrain layers (colour carries the look; the splat shader mixes them in world space) ---- */
    // grass 512 px = 4 m: olive / sage with dry blades and darker clumps
    X.grass = tex(gen(512, (x, y, o) => {
      const big = fbm(x / 90, y / 90, 3, 5, 141), mid = fbm(x / 22, y / 22, 3, 23, 143), blade = vnoise(x / 1.3, y / 4.5, 0, 145), fine = vnoise(x / 2, y / 2, 256, 147);
      const dry = smooth(0.55, 0.8, mid);
      let c = mixC(hexRGB(0x4c5733), hexRGB(0x5f663b), big);
      c = mixC(c, hexRGB(0x7a7350), dry * 0.5);
      const k = 0.8 + 0.22 * blade + 0.1 * fine - 0.12 * smooth(0.6, 0.85, big * 0.5 + fine * 0.5);
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.h = 0;
    }).canvas);
    // packed earth 512 px = 3 m: tracks, pebbles, damp patches
    X.dirt = tex(gen(512, (x, y, o) => {
      const n = fbm(x / 40, y / 40, 4, 12, 151), m = fbm(x / 9, y / 9, 3, 56, 153), p = vnoise(x / 3.2, y / 3.2, 160, 155);
      const peb = smooth(0.78, 0.86, p);
      let c = mixC(hexRGB(0x62574a), hexRGB(0x716352), n);
      c = mixC(c, hexRGB(0x4d443a), smooth(0.6, 0.85, fbm(x / 110, y / 110, 3, 4, 157)) * 0.5);
      c = mixC(c, hexRGB(0x8a8274), peb * 0.6);
      const k = 0.86 + 0.2 * m;
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.h = 0;
    }).canvas);
    // cobbles 512 px = 2.2 m: rounded setts in soil joints
    X.cobble = tex(voronoi(512, 15, 161, { ax: 1.05, gap: 0.1, bevel: 0.22, mortar: 0x40392f, palette: [0x77736a, 0x6b675f, 0x7f776a, 0x625f58, 0x746b5e, 0x857f74, 0x5c5850] }).canvas);
    // flagstone paving for courtyards 512 px = 3.2 m (shared with walls' flag texture look)
    X.pave = tex(ashlar(512, 3.4, 171, { ch: [0.5, 0.85], bw: [0.55, 1.1], mortar: 0x4c463d, bevel: 0.035, palette: [0x8c867a, 0x847f75, 0x938b7d, 0x7d7973, 0x8a8274, 0x7a766c] }).canvas);
    // macro noise (single channel, tiles) for large-scale variation
    X.macro = tex(gen(256, (x, y, o) => { const n = fbm(x / 32, y / 32, 5, 8, 181); o.r = n; o.g = fbm(x / 16, y / 16, 4, 16, 183); o.b = vnoise(x / 4, y / 4, 64, 185); o.h = 0; }).canvas);
    V.texTime = performance.now() - t0;
    return X;
  };

  /* ---------------------------------------------- shader hooks ---------------------------------------------- */
  V.fade = {
    uFadeP: { value: new T.Vector3(0, -999, 0) },
    uFadeCam: { value: new T.Vector3(0, 10, 10) },
    uFadeR: { value: 2.3 },
    uFadeOn: { value: 0 },
  };
  V.time = { value: 0 };
  const FADE_FRAG_DECL = '\nvarying vec3 vFadeW; uniform vec3 uFadeP; uniform vec3 uFadeCam; uniform float uFadeR; uniform float uFadeOn;\n' +
    'float vBayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }\n' +
    'float vBayer4(vec2 a){ return vBayer2(0.5 * a) * 0.25 + vBayer2(a); }\n';
  const FADE_FRAG = '\nif (uFadeOn > 0.5) {\n' +
    '  vec3 cp = uFadeP - uFadeCam; float L = length(cp); vec3 dn = cp / max(L, 1e-3);\n' +
    '  vec3 cf = vFadeW - uFadeCam; float t = dot(cf, dn);\n' +
    '  if (t < L - 0.7) {\n' +
    '    float perp = length(cf - dn * t);\n' +
    '    float k = (1.0 - smoothstep(uFadeR * 0.5, uFadeR, perp)) * smoothstep(0.0, 1.6, L - 0.7 - t) * smoothstep(0.45, 1.3, vFadeW.y);\n' +
    '    if (min(1.0, k * 1.3) * 0.97 > vBayer4(gl_FragCoord.xy) + 0.004) discard;\n' +
    '  }\n' +
    '}\n';
  const FADE_VERT = '\n vec4 vfw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n vfw = instanceMatrix * vfw;\n#endif\n vFadeW = (modelMatrix * vfw).xyz;\n';
  V.noIBL = function (sh) { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', '').replace('#include <envmap_fragment>', ''); };
  function injectFade(sh) {
    V.noIBL(sh);
    Object.assign(sh.uniforms, V.fade);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFadeW;').replace('#include <project_vertex>', '#include <project_vertex>' + FADE_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + FADE_FRAG_DECL).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + FADE_FRAG);
  }
  function fadeCompile(sh) { injectFade(sh); }
  // cloth that hangs from its top edge: uv.y = 1 at the fixed edge, 0 at the free edge. GPU only (no CPU per frame)
  function waveCompile(sh) {
    injectFade(sh);
    sh.uniforms.uVTime = V.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uVTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_UV\n float vfree = 1.0 - uv.y;\n float vph = position.x * 0.31 + position.z * 0.27;\n transformed += normal * (sin(uVTime * 1.7 + vph + vfree * 3.4) * 0.075 + sin(uVTime * 2.9 + vph * 1.7 + vfree * 6.0) * 0.03) * vfree;\n#endif');
  }
  V.injectFade = injectFade;

  /* ---------------------------------------------- material library ---------------------------------------------- */
  V.buildMaterials = function (X) {
    const all = [];
    const std = (name, opt, ud, fade) => {
      const m = new T.MeshStandardMaterial(Object.assign({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true }, opt));
      m.name = name; m.userData = Object.assign({ uv: 'world', uvScale: 1, ao: true }, ud || {});
      m.envMapIntensity = opt.envMapIntensity !== undefined ? opt.envMapIntensity : 0.3;
      if (fade !== false) { m.onBeforeCompile = fadeCompile; m.customProgramCacheKey = () => 'vfade'; }
      else if (!opt.envMapIntensity || opt.envMapIntensity < 0.8) { m.onBeforeCompile = V.noIBL; m.customProgramCacheKey = () => 'vnoibl'; }
      all.push(m);
      return m;
    };
    const ns = (s) => new T.Vector2(s, s);
    const M = {
      stone: std('stone', { map: X.ashlar, normalMap: X.ashlarN, normalScale: ns(0.9), roughness: 0.9 }, { uvScale: 1 / 2.4 }),
      flag: std('flag', { map: X.flag, normalMap: X.flagN, normalScale: ns(0.6), roughness: 0.9 }, { uvScale: 1 / 3.2 }),
      rubble: std('rubble', { map: X.rubble, normalMap: X.rubbleN, normalScale: ns(1.0), roughness: 0.93 }, { uvScale: 1 / 2.6 }),
      plaster: std('plaster', { map: X.plaster, normalMap: X.plasterN, normalScale: ns(0.45), roughness: 0.94 }, { uvScale: 1 / 3 }),
      wood: std('wood', { map: X.wood, normalMap: X.woodN, normalScale: ns(0.55), roughness: 0.82 }, { uv: 'local', uvScale: 1 / 2 }),
      planks: std('planks', { map: X.planks, normalMap: X.planksN, normalScale: ns(0.7), roughness: 0.84 }, { uv: 'local', uvScale: 1 / 2 }),
      shingle: std('shingle', { map: X.shingle, normalMap: X.shingleN, normalScale: ns(1.0), roughness: 0.86 }, { uvScale: 1 / 2, ao: false }),
      thatch: std('thatch', { map: X.thatch, normalMap: X.thatchN, normalScale: ns(1.0), roughness: 0.97 }, { uvScale: 1 / 2, ao: false }),
      glass: std('glass', { map: X.glass, normalMap: X.glassN, normalScale: ns(0.5), roughness: 0.32, metalness: 0.1, envMapIntensity: 0.9 }, { uv: 'local', uvScale: 1 / 0.6, ao: false }),
      iron: std('iron', { roughness: 0.55, metalness: 0.55, envMapIntensity: 0.7 }, { ao: false }),
      dark: std('dark', { roughness: 1, color: 0xffffff }, { ao: false }),
      cloth: std('cloth', { map: X.cloth, normalMap: X.clothN, normalScale: ns(0.4), roughness: 0.95, side: T.DoubleSide }, { ao: false }),
      burlap: std('burlap', { map: X.burlap, normalMap: X.burlapN, normalScale: ns(0.6), roughness: 0.98 }, { uvScale: 1 / 0.6 }),
      leaf: std('leaf', { map: X.leaf, normalMap: X.leafN, normalScale: ns(0.8), roughness: 0.88 }, { uvScale: 1 / 1.6, ao: false }),
      bark: std('bark', { map: X.wood, normalMap: X.woodN, normalScale: ns(1.0), roughness: 0.95 }, { uv: 'local', uvScale: 1 / 1.2 }),
      straw: std('straw', { map: X.thatch, normalMap: X.thatchN, normalScale: ns(0.8), roughness: 0.97 }, { uvScale: 1 / 1.2 }),
      blade: std('blade', { roughness: 0.9, side: T.DoubleSide }, { ao: false }, false),
      ember: std('ember', { map: X.rubble, roughness: 0.95, emissive: 0x5a1e06, emissiveIntensity: 0.6, emissiveMap: X.rubble }, { ao: false, uvScale: 1 / 0.8 }, false),
      water: std('water', { roughness: 0.12, metalness: 0.2, color: 0x2a3a3c, envMapIntensity: 1.0 }, { ao: false }, false),
    };
    // banner: hangs and sways on the GPU
    const banner = new T.MeshStandardMaterial({ map: X.banner, roughness: 0.92, metalness: 0, side: T.DoubleSide, vertexColors: true });
    banner.name = 'banner'; banner.userData = { uv: 'local', uvScale: 1, ao: false }; banner.envMapIntensity = 0.35;
    banner.onBeforeCompile = waveCompile; banner.customProgramCacheKey = () => 'vwave';
    M.banner = banner; all.push(banner);
    // cloth canopies also sway a touch (same shader)
    const canopy = M.cloth.clone(); canopy.name = 'canopy'; canopy.userData = M.cloth.userData; canopy.onBeforeCompile = waveCompile; canopy.customProgramCacheKey = () => 'vwave'; canopy.envMapIntensity = 0.35;
    M.canopy = canopy; all.push(canopy);
    M._all = all;
    return M;
  };

  /* ---------------------------------------------- palettes (vertex tints) ---------------------------------------------- */
  V.PAL = {
    castle: [0xd9d3c6, 0xcfc8ba, 0xe0d8c8, 0xc8c3b8],          // fortification masonry tints
    keep: [0xddd4c3, 0xd3cbbb],
    found: [0xbfb6a6, 0xb3ab9c, 0xc6bca9],                      // house plinths
    plaster: [0xf0e6d2, 0xe9dcc0, 0xe4d9c7, 0xe6d3bb, 0xefe3cb, 0xddd4c4],
    timber: [0x5c4532, 0x524032, 0x64503c, 0x4c3c30],
    timberGrey: [0x6f6457, 0x75695a],
    slate: [0x62676d, 0x5c6066, 0x686a6e],
    shingle: [0x76644f, 0x6e5e4e, 0x7b6a58, 0x6c6257],
    tile: [0x93624b, 0x8a5e4a, 0x925f4e],
    thatch: [0xb3a07c, 0xab9a7a, 0xb8a684],
    door: [0x5a4232, 0x4e3a2c, 0x604634, 0x5b4a3a],
    shutter: [0x55654e, 0x4f6170, 0x6e4038, 0x6b5a3e, 0x5d5d55],
    iron: 0x3b3c3f,
  };
})();
