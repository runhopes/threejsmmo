/* =====================================================================================================
 *  world/scenery.js  -  vegetation, rocks, water edges and landmarks of the open world
 *
 *  W.populate(ctx) is called by village/scene.js (before the instancers are built). It
 *    - defines the extra instanced kinds (snow fir, dead tree, reeds, spires, burrows, tents, carrots, cactus ...)
 *    - scatters trees / bushes / rocks / grass per BIOME on the valley floor (colliders for everything solid),
 *      and cheap pines / far giants on the hill sides so the valleys read as enclosed
 *    - clears the creature camps, keeps roads open, paints the forest floor into the world control map
 *    - builds the landmarks: bridges, great plaza, farm + windmill, rabbit warren, goblin camps + fort, wolf den, ruined
 *      watchtower, standing stones, dock, holy-isle shrine, signposts, the Ancient Tree
 *    - the floor has relief (hills + swells): I.add here lifts every relative-y instance onto the terrain; landmarks that
 *      use the static Builder stand on dead-flat pads (W.pads in layout.js)
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const W = V.World;
  if (!W || !W.on) return;
  const { clamp, smooth, lerp } = V;
  const PI = Math.PI, TAU = PI * 2;
  const v3 = (x, y, z) => new T.Vector3(x, y, z);

  function tpl(fn) { const Bd = new V.Builder({ chunk: 1e7 }); fn(Bd); return Bd.toGeometries(); }
  function defineKind(I, name, fn, layer, cast, chunk) {
    const parts = []; for (const [mat, geo] of tpl(fn)) parts.push({ geo, mat, cast: cast !== false });
    I.define(name, parts, { layer: layer || 'main', chunk: chunk || 100 });
  }
  const colors = (g, fn) => {
    const p = g.attributes.position, n = g.attributes.normal, c = [];
    for (let i = 0; i < p.count; i++) { const k = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0); c.push(k[0], k[1], k[2]); }
    g.setAttribute('color', new T.Float32BufferAttribute(c, 3));
  };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /* ------------------------------------------------ extra instanced kinds ------------------------------------------------ */
  function defineKinds(I, M) {
    // dead tree (swamp, canyon)
    defineKind(I, 'deadtree', (Bd) => {
      const R = V.rng(61), c = 0x57514a;
      Bd.beam(M.bark, v3(0, 0, 0), v3(0.18, 2.6, 0.1), 0.34, 0.34, { color: c });
      Bd.beam(M.bark, v3(0.18, 2.6, 0.1), v3(-0.1, 4.4, 0.3), 0.2, 0.2, { color: c });
      for (let k = 0; k < 6; k++) {
        const y = 1.6 + R() * 2.4, a = R() * TAU, L = 1.0 + R() * 1.6, up = 0.4 + R() * 0.9, x0 = 0.12 * y / 2.6, z0 = 0.05 * y / 2.6;
        const p = v3(x0, y, z0), q = v3(x0 + Math.cos(a) * L, y + up, z0 + Math.sin(a) * L);
        Bd.beam(M.bark, p, q, 0.13, 0.13, { color: c });
        Bd.beam(M.bark, q, v3(q.x + Math.cos(a + 0.6) * 0.7, q.y + 0.5, q.z + Math.sin(a + 0.6) * 0.7), 0.07, 0.07, { color: c });
      }
    }, 'main', true, 90);
    // reed clump
    defineKind(I, 'reed', (Bd) => {
      const R = V.rng(73);
      for (let i = 0; i < 12; i++) {
        const a = R() * TAU, r0 = R() * 0.28, h = 0.9 + R() * 0.9, lean = (R() - 0.5) * 0.35, bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
        const px = -Math.sin(a) * 0.045, pz = Math.cos(a) * 0.045;
        Bd.poly(M.blade, [v3(bx - px, 0, bz - pz), v3(bx + px, 0, bz + pz), v3(bx + lean * 0.5 + px * 0.4, h * 0.6, bz + lean * 0.3), v3(bx + lean, h, bz + lean * 0.4)], { vcol: [0.75, 0.75, 1.25], color: i % 3 ? 0xa4b46a : 0xc4bc78 });
        if (i % 4 === 0) Bd.cyl(M.blade, bx + lean, h - 0.28, bz + lean * 0.4, 0.045, 0.045, 0.3, 5, { color: 0x4a3a2a });
      }
    }, 'detail', false, 48);
    // sharp rock pillar (canyon, frost, wolf den); tinted per instance
    defineKind(I, 'spire', (Bd) => {
      const R = V.rng(91);
      let y = 0, rb = 1.5;
      for (let k = 0; k < 4; k++) {
        const h = 1.8 + R() * 1.2, rt = rb * (0.62 + R() * 0.16), ox = (R() - 0.5) * 0.3, oz = (R() - 0.5) * 0.3;
        Bd.cyl(M.rubble, ox, y, oz, rb, rt, h, 7, { color: [0xc9bfae, 0xb8ad9c, 0xd2c8b6, 0xaa9f8e][k], flat: true, caps: k === 3 ? 't' : '' });
        y += h * 0.92; rb = rt;
      }
    }, 'main', true, 100);
    // burrow mound with a dark hole
    defineKind(I, 'burrow', (Bd) => {
      const g = new T.SphereGeometry(1, 11, 6, 0, TAU, 0, PI / 2); g.scale(1.5, 0.62, 1.4);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const n = 1 + (V.vnoise(p.getX(i) * 2.2 + 3, p.getZ(i) * 2.2, 0, 17) - 0.5) * 0.28; p.setXYZ(i, p.getX(i) * n, p.getY(i) * (0.85 + (n - 1) * 1.5), p.getZ(i) * n); }
      g.computeVertexNormals();
      colors(g, (x, y, z, ny) => mix3([0.74, 0.58, 0.4], [0.5, 0.62, 0.3], smooth(0.3, 0.95, ny) * 0.8));
      Bd.geo(M.rubble, g, null, { color: 0xffffff });
      const h = new T.CircleGeometry(0.42, 14); h.scale(1, 0.85, 1); h.rotateX(-0.28); h.translate(0, 0.33, 1.2);
      colors(h, () => [0.02, 0.015, 0.012]);
      Bd.geo(M.dark, h, null, { color: 0xffffff, flat: true });
      const rim = new T.TorusGeometry(0.45, 0.09, 6, 14); rim.scale(1, 0.9, 1); rim.rotateX(-0.28 - 0); rim.translate(0, 0.33, 1.19);
      colors(rim, () => [0.62, 0.48, 0.33]);
      Bd.geo(M.rubble, rim, null, { color: 0xffffff });
    }, 'main', true, 100);
    // carrot (leaf rosette + the orange top)
    defineKind(I, 'carrot', (Bd) => {
      const R = V.rng(97);
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU + R() * 0.4, len = 0.34 + R() * 0.16, tx = Math.cos(a) * len * 0.7, tz = Math.sin(a) * len * 0.7;
        const px = -Math.sin(a) * 0.03, pz = Math.cos(a) * 0.03;
        Bd.poly(M.blade, [v3(-px, 0.05, -pz), v3(px, 0.05, pz), v3(tx, len, tz)], { vcol: [0.5, 0.5, 1.1], color: 0x4e8a34 });
      }
      Bd.cyl(M.blade, 0, 0.0, 0, 0.07, 0.05, 0.1, 7, { color: 0xe0782a });
    }, 'detail', false, 36);
    // wheat
    defineKind(I, 'wheat', (Bd) => {
      const R = V.rng(99);
      for (let i = 0; i < 14; i++) {
        const a = R() * TAU, r0 = R() * 0.22, len = 0.7 + R() * 0.25, lean = (R() - 0.5) * 0.3, bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
        const px = -Math.sin(a) * 0.02, pz = Math.cos(a) * 0.02;
        Bd.poly(M.blade, [v3(bx - px, 0, bz - pz), v3(bx + px, 0, bz + pz), v3(bx + lean, len, bz + lean * 0.5)], { vcol: [0.7, 0.7, 1.1], color: i % 2 ? 0xc6a64c : 0xb89a44 });
        Bd.cyl(M.blade, bx + lean, len - 0.12, bz + lean * 0.5, 0.03, 0.02, 0.16, 5, { color: 0xd8b858 });
      }
    }, 'detail', false, 36);
    // goblin hide tent
    defineKind(I, 'tent', (Bd) => {
      const g = new T.ConeGeometry(2.2, 2.9, 9, 1, true); g.translate(0, 1.45, 0);
      colors(g, (x, y) => mix3([0.34, 0.26, 0.17], [0.5, 0.4, 0.27], smooth(0, 2.9, y) * 0.6 + V.vnoise(x * 3, y * 3, 0, 21) * 0.3));
      Bd.geo(M.cloth, g, null, { color: 0xffffff });
      Bd.poly(M.dark, [v3(-0.5, 0, 2.07), v3(0.5, 0, 2.07), v3(0.0, 1.6, 1.1)], { color: 0x15110d });
      Bd.beam(M.wood, v3(0, 2.7, 0), v3(0, 3.8, 0), 0.1, 0.1, { color: 0x5a4636 });
      Bd.box(M.cloth, 0.3, 3.55, 0, 0.6, 0.35, 0.04, { color: 0x8a2c22 });
    }, 'main', true, 100);
    // lily pads
    defineKind(I, 'lily', (Bd) => {
      const g = new T.CircleGeometry(0.55, 9); g.rotateX(-PI / 2); colors(g, () => [0.24, 0.42, 0.2]);
      Bd.geo(M.blade, g, null, { color: 0xffffff });
      const f = new T.CircleGeometry(0.1, 6); f.rotateX(-PI / 2); f.translate(0.1, 0.02, 0.05); colors(f, () => [0.9, 0.7, 0.8]);
      Bd.geo(M.blade, f, null, { color: 0xffffff });
    }, 'detail', false, 70);
    // totem pole (goblin camps)
    defineKind(I, 'totem', (Bd) => {
      Bd.cyl(M.wood, 0, 0, 0, 0.22, 0.2, 3.6, 8, { color: 0x4f3d2e });
      for (const [y, s] of [[1.3, 0.34], [2.3, 0.3]]) {
        const g = new T.SphereGeometry(s, 8, 6); g.scale(1, 1.1, 1); g.translate(0, y, 0.22); colors(g, () => [0.72, 0.68, 0.58]); Bd.geo(M.rubble, g, null, { color: 0xffffff });
        Bd.box(M.dark, -0.1, y + 0.02, 0.5, 0.08, 0.1, 0.04, { color: 0x15110d }); Bd.box(M.dark, 0.1, y + 0.02, 0.5, 0.08, 0.1, 0.04, { color: 0x15110d });
      }
      Bd.beam(M.wood, v3(-0.7, 3.2, 0), v3(0.7, 3.2, 0), 0.12, 0.12, { color: 0x4f3d2e });
      Bd.box(M.cloth, 0.55, 2.85, 0, 0.3, 0.7, 0.03, { color: 0x7a2a20 }); Bd.box(M.cloth, -0.55, 2.85, 0, 0.3, 0.6, 0.03, { color: 0x3a3a50 });
    }, 'main', true, 100);
    // camp fire
    defineKind(I, 'campfire', (Bd) => {
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; const g = new T.IcosahedronGeometry(0.2, 0); g.scale(1, 0.7, 1); g.translate(Math.cos(a) * 0.62, 0.12, Math.sin(a) * 0.62); colors(g, () => [0.5, 0.48, 0.44]); Bd.geo(M.rubble, g, null, { color: 0xffffff, flat: true }); }
      for (let k = 0; k < 4; k++) { const a = k * 0.8 + 0.3; Bd.beam(M.wood, v3(Math.cos(a) * 0.45, 0.12, Math.sin(a) * 0.45), v3(-Math.cos(a) * 0.1, 0.42, -Math.sin(a) * 0.1), 0.12, 0.12, { color: 0x3a2e24 }); }
      const f = new T.ConeGeometry(0.34, 0.9, 7, 1, true); f.translate(0, 0.62, 0); colors(f, (x, y) => mix3([1.0, 0.5, 0.12], [1.0, 0.85, 0.35], smooth(0.2, 1.0, y)));
      Bd.geo(M.ember, f, null, { color: 0xffffff });
    }, 'main', false, 100);
  }

  /* ------------------------------------------------ placement helpers ------------------------------------------------ */
  function makePlacement(R, FOREST) {
    const H = 14, hash = new Map();
    const key = (x, z) => ((x / H) | 0) * 7919 + ((z / H) | 0);
    const kx = (x) => Math.floor(x / H), kz = (z) => Math.floor(z / H);
    const P = {
      add(x, z, r) { const k = kx(x) * 100003 + kz(z); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push(x, z, r); },
      free(x, z, r) {
        for (let i = kx(x) - 1; i <= kx(x) + 1; i++) for (let j = kz(z) - 1; j <= kz(z) + 1; j++) {
          const a = hash.get(i * 100003 + j); if (!a) continue;
          for (let q = 0; q < a.length; q += 3) { const dx = a[q] - x, dz = a[q + 1] - z, rr = a[q + 2] + r; if (dx * dx + dz * dz < rr * rr) return false; }
        }
        return true;
      },
    };
    return P;
  }

  /* zone index grid (8 m): cheap biome lookups */
  function zoneGrid() {
    const B = W.bounds, S = 8, nx = Math.ceil((B.maxX - B.minX) / S), nz = Math.ceil((B.maxZ - B.minZ) / S), g = new Int8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const zn = W.zoneAt(B.minX + (i + 0.5) * S, B.minZ + (j + 0.5) * S); g[j * nx + i] = zn ? W.zones.indexOf(zn) : 0;
    }
    return (x, z) => W.zones[g[clamp(Math.floor((z - B.minZ) / S), 0, nz - 1) * nx + clamp(Math.floor((x - B.minX) / S), 0, nx - 1)]];
  }

  /* ------------------------------------------------ biome tables ------------------------------------------------ */
  // densities are per m2 on the valley floor; clumping noise multiplies them (groves / clearings)
  const BI = {
    meadow:   { giant: 0.0005, t: 0.0010, trees: ['oakF', 'lindenF'], b: 0.004, r: 0.0007, tuft: 0.34, fl: 0.12, hillTrees: ['pine', 'oakF'], hill: 0.5 },
    warren:   { giant: 0.0005, t: 0.0006, trees: ['oakF', 'lindenF'], b: 0.0035, r: 0.0005, tuft: 0.34, fl: 0.22, hillTrees: ['oakF', 'lindenF'], hill: 0.45 },
    creek:    { t: 0.0016, trees: ['lindenF', 'oakF'], giant: 0.0030, b: 0.0055, r: 0.0008, tuft: 0.32, fl: 0.14, hillTrees: ['giantFar', 'pine'], hill: 0.7 },
    wolfwood: { giant: 0.0058, t: 0.0011, trees: ['greatpine', 'greatpine', 'oakF'], b: 0.003, r: 0.0008, tuft: 0.15, fern: 0.0026, shroom: 0.0003, log: 0.0004, moss: 0.0006, hillTrees: ['giantFar', 'pine'], hill: 0.95 },
    hills:    { giant: 0.0024, t: 0.0014, trees: ['greatpine', 'greatpine', 'oakF'], b: 0.002, r: 0.0024, tuft: 0.24, fl: 0.06, hillTrees: ['pine', 'oakF'], hill: 0.4 },
    marsh:    { dead: 0.0013, giant: 0.0009, b: 0.0042, r: 0.0005, tuft: 0.14, fern: 0.0012, shroom: 0.0007, moss: 0.0004, reed: 0.0013, hillTrees: ['pine', 'deadtree'], hill: 0.35 },
    shadow:   { giant: 0.0085, t: 0.0010, trees: ['greatpine'], fern: 0.0042, shroom: 0.001, log: 0.0007, moss: 0.0009, b: 0.0025, r: 0.0006, tuft: 0.1, hillTrees: ['giantFar', 'pine'], hill: 1.0 },
  };
  // the first pass looked empty from the game camera: scale the authored densities up
  // ?giants=<k>: density multiplier of the ancient trees (0.5 = half as many, for slow GPUs); phones default to 0.6
  const GIANT_K = Math.max(0, Math.min(2, +(new URLSearchParams(location.search).get('giants') || (window.__MOBILE ? 0.6 : 1))));
  const MUL = { t: 2.0, b: 2.1, r: 1.8, tuft: 1.9, fir: 2.6, dead: 1.8, spire: 1.8, cactus: 2.2, fern: 1.5, shroom: 1.6, log: 1.3, moss: 1.4, giant: 1.12 * GIANT_K };
  for (const k in BI) for (const f in MUL) if (BI[k][f]) BI[k][f] = Math.min(f === 'tuft' ? 0.9 : 1, BI[k][f] * MUL[f]);
  const ROCK_TINT = { hills: [0xcfc7b4, 0xc2bba8, 0xd8d0bc], default: [0xbdb7ab, 0xaaa597, 0xc8c2b4] };

  /* ------------------------------------------------ populate ------------------------------------------------ */
  W.populate = function (ctx) {
    const t0 = performance.now();
    const { B, M, col, R, FOREST } = ctx;
    const Iraw = ctx.I;                       // raw instancer: callers pass ABSOLUTE heights (hill sides, water)
    W.build(); W.buildMaps();
    defineKinds(Iraw, M);
    const zoneOf = zoneGrid();
    const placed = makePlacement(R, FOREST);
    const stats = { giants: 0, trees: 0, hill: 0, bushes: 0, rocks: 0, tufts: 0, reeds: 0, props: 0 };
    const glow = (FOREST && FOREST.glowSpots) || [];
    const camps = W.camps;
    const fi = (n) => FOREST && FOREST.kinds && FOREST.kinds[n];
    const roadD = (x, z) => W.roadDist(x, z);
    const inside = (x, z, m) => W.sdAt(x, z) < -m;
    const campClear = (x, z, extra, f) => { for (const c of camps) if (Math.hypot(x - c.cx, z - c.cz) < c.r * (f === undefined ? 1 : f) + extra) return false; return true; };
    const noise = (x, z, s, o) => V.ntab(x + (o || 0), z - (o || 0) * 0.7, s);
    const clump = (x, z) => 0.25 + 1.5 * smooth(0.36, 0.72, noise(x, z, 0.33));
    const yAt = (x, z) => W.heightAt(x, z);
    const slopeAt = (x, z) => Math.hypot(W.heightAt(x + 3, z) - W.heightAt(x - 3, z), W.heightAt(x, z + 3) - W.heightAt(x, z - 3)) / 6;
    /* the walkable floor has relief now: everything placed on it with a RELATIVE y (0 = ground) is lifted onto the terrain */
    const I = Object.create(Iraw); I.add = (k, x, y, z, ry, sc, tint) => Iraw.add(k, x, y + yAt(x, z), z, ry, sc, tint);
    const tintTree = [0xffffff, 0xf2fff4, 0xe8f6ff, 0xfff6e0, 0xeae6ff, 0xffffff];

    const solid = (x, z, r, top, tag) => col.circle(x, z, r, top === undefined ? 6 : top, tag || 'tree');
    /* ROAD CLEARANCE (user rule): nothing solid in a road corridor. roadD = distance to the road EDGE, so a collider of reach r needs roadD > r + ROAD_GAP.
       A giant's reach = trunk core, buttress lobes and surface roots (they used to poke 1-3 m into the road: placement only checked the centre). */
    const ROAD_GAP = 1.2;
    const giantReach = (info, sc) => { let m = info.r0 * 1.75; if (info.lobes && info.lobes.length) m = Math.max(m, info.r0 * 2.35 + 0.75); for (const rt of info.roots || []) m = Math.max(m, Math.hypot(rt.x, rt.z) + rt.r); return m * sc; };
    const plantGiant = (x, z, kind, sc, onFloor) => {
      const info = fi(kind); if (!info) return;
      if (onFloor && roadD(x, z) < giantReach(info, sc) + ROAD_GAP) return;
      const ry = R() * TAU, cs = Math.cos(ry), sn = Math.sin(ry);
      FOREST.addGiant(Iraw, kind, x, yAt(x, z) - (onFloor ? 0.1 + Math.min(1.4, 4 * slopeAt(x, z)) : 0.2), z, ry, sc, tintTree[Math.floor(R() * tintTree.length)]);
      placed.add(x, z, info.r0 * 1.9 * sc + 1.0);
      if (onFloor) {
        const Wp = (lx, lz) => [x + (lx * cs + lz * sn) * sc, z + (-lx * sn + lz * cs) * sc];
        solid(x, z, info.r0 * 1.75 * sc, 40);
        for (const a of info.lobes) { const [lx, lz] = Wp(Math.cos(a) * info.r0 * 2.35, Math.sin(a) * info.r0 * 2.35); col.circle(lx, lz, 0.75 * sc, 1.6, 'tree'); }
        for (const rt of info.roots) { const [lx, lz] = Wp(rt.x, rt.z); col.circle(lx, lz, rt.r * sc, 0.9, 'tree'); }
        W.paintForest(x, z, info.spread * sc * 1.15, 0.95);
        stats.giants++;
      }
    };
    const plantTree = (x, z, kind, sc) => {
      I.add(kind, x, 0, z, R() * TAU, sc, tintTree[Math.floor(R() * tintTree.length)]);
      solid(x, z, kind === 'pine' || kind === 'snowfir' ? 0.4 : 0.45, 6);
      placed.add(x, z, kind === 'pine' || kind === 'snowfir' ? 2.2 : 3.2); stats.trees++;
    };
    const plantRock = (x, z, sc, zone) => {
      const tint = ROCK_TINT[zone.biome] || ROCK_TINT.default;
      I.add('rock', x, -0.1, z, R() * TAU, sc, tint[Math.floor(R() * tint.length)]);
      solid(x, z, sc * 0.62, sc * 0.9, 'rock'); placed.add(x, z, sc * 0.7); stats.rocks++;
    };

    /* --- 1) valley floor, biome by biome --- */
    const bnd = W.region, STEP = 5;
    for (let z = bnd.minZ; z < bnd.maxZ; z += STEP) for (let x = bnd.minX; x < bnd.maxX; x += STEP) {
      const jx = x + R() * STEP, jz = z + R() * STEP;
      if (!inside(jx, jz, 2.4)) continue;
      if (jx > -104 && jx < 104 && jz > -104 && jz < 146) continue;         // the village band is dressed by the village
      const zn = zoneOf(jx, jz), bi = BI[zn.biome], rd = roadD(jx, jz), cl = clump(jx, jz);
      // the starter area stays open: no trees on the great plaza, the gate road or the ring of meadow round them
      const calm = Math.hypot(jx, jz - 180) < 62 || (Math.abs(jx) < 30 && jz > 100 && jz < 215), tall = rd > 3.2 && !calm && campClear(jx, jz, 2.5, 1);
      if (!bi) continue;
      if (R() < 0.06 && rd > 1.2) { const tt = ROCK_TINT[zn.biome] || ROCK_TINT.default; I.add('rock', jx, -0.04, jz, R() * 6, 0.16 + R() * 0.3, tt[Math.floor(R() * tt.length)]); }
      let u = R(), acc = 0;
      const pick = (p) => { acc += p * STEP * STEP; return u < acc; };
      if (tall && bi.giant && FOREST && pick(bi.giant * cl)) {
        const kind = 'giant' + Math.floor(R() * FOREST.GIANT_COUNT), sc = 0.9 + R() * 0.6, info = fi(kind);
        if (info && placed.free(jx, jz, info.r0 * 1.9 * sc + 1.0) && placed.free(jx, jz, 0)) plantGiant(jx, jz, kind, sc, true);
        continue;
      }
      if (tall && bi.t && pick(bi.t * cl)) {
        let kind = bi.trees[Math.floor(R() * bi.trees.length)];
        if (kind === 'greatpine' && !FOREST) kind = 'pine';   // ?atmo=0: old look
        if (kind === 'greatpine') { const k2 = 'greatpine' + Math.floor(R() * FOREST.PINE_COUNT), sc = 0.85 + R() * 0.55, info = fi(k2); if (info && placed.free(jx, jz, info.r0 * 1.9 * sc + 1.0)) plantGiant(jx, jz, k2, sc, true); }
        else if (placed.free(jx, jz, 3.4)) plantTree(jx, jz, kind, 0.85 + R() * 0.35);
        continue;
      }
      if (tall && bi.fir && pick(bi.fir * cl)) { if (placed.free(jx, jz, 3.0)) plantTree(jx, jz, 'snowfir', 0.9 + R() * 0.4); continue; }
      if (tall && bi.dead && pick(bi.dead * cl)) { if (placed.free(jx, jz, 3)) { I.add('deadtree', jx, 0, jz, R() * TAU, 0.8 + R() * 0.6, 0xffffff); solid(jx, jz, 0.4, 5); placed.add(jx, jz, 2.5); stats.trees++; } continue; }
      if (tall && bi.spire && pick(bi.spire * cl)) {
        const sc = 1.2 + R() * 2.2, tint = ROCK_TINT[zn.biome] || ROCK_TINT.default;
        if (placed.free(jx, jz, sc * 1.8) && rd > sc * 1.35 + ROAD_GAP) { I.add('spire', jx, -0.2, jz, R() * TAU, sc, tint[Math.floor(R() * tint.length)]); solid(jx, jz, sc * 1.35, 40, 'rock'); placed.add(jx, jz, sc * 1.8); stats.rocks++; }
        continue;
      }
      if (tall && bi.cactus && pick(bi.cactus * cl)) { if (placed.free(jx, jz, 2)) { I.add('cactus', jx, 0, jz, R() * TAU, 0.8 + R() * 0.6, 0xffffff); solid(jx, jz, 0.5, 3); placed.add(jx, jz, 1.6); } continue; }
      if (bi.r && rd > 2.2 && campClear(jx, jz, 0, 0.55) && pick(bi.r * (0.5 + cl * 0.6))) { const sc = 0.7 + Math.pow(R(), 2.2) * 2.4; if (placed.free(jx, jz, sc * 0.7) && rd > sc * 0.62 + ROAD_GAP) plantRock(jx, jz, sc, zn); continue; }
      if (bi.b && rd > 1.6 && campClear(jx, jz, 0, 0.5) && pick(bi.b * cl)) { I.add('bush', jx, 0, jz, R() * 6, 0.7 + R() * 0.7, [0xffffff, 0xe8f0d8, 0xf0ecd8][Math.floor(R() * 3)]); if (R() < 0.35) solid(jx, jz, 0.5, 1.2, 'bush'); stats.bushes++; continue; }
      if (bi.fern && FOREST && pick(bi.fern * cl)) { I.add('fern', jx, 0, jz, R() * TAU, 0.8 + R() * 0.7, [0xffffff, 0xe6f6e0, 0xf4f0d8][Math.floor(R() * 3)]); continue; }
      if (bi.shroom && FOREST && rd > 3 && pick(bi.shroom * cl)) { const hue = R() < 0.6 ? 0x5fe8d8 : R() < 0.5 ? 0x9a8cff : 0x8cf07a; I.add('shrooms', jx, 0, jz, R() * TAU, 0.9 + R() * 0.8, hue); glow.push([jx, yAt(jx, jz) + 0.35, jz, 0, hue]); continue; }
      if (bi.moss && FOREST && rd > 3 && pick(bi.moss * cl)) { const sc = 0.8 + R() * 1.1; if (placed.free(jx, jz, sc * 1.4)) { I.add('mossboulder', jx, -0.1, jz, R() * TAU, sc, 0xffffff); solid(jx, jz, sc * 1.15, sc * 0.9, 'rock'); placed.add(jx, jz, sc * 1.4); } continue; }
      if (bi.log && FOREST && rd > 3.5 && campClear(jx, jz, 4, 1) && pick(bi.log * cl)) {
        const ry = R() * TAU, ok = [-3.8, 0, 3.8].every((s) => inside(jx + Math.cos(ry) * s, jz - Math.sin(ry) * s, 2) && placed.free(jx + Math.cos(ry) * s, jz - Math.sin(ry) * s, 0.8));
        if (ok) { I.add('mosslog', jx, -0.12, jz, ry, 1, 0xffffff); for (const s of [-3.2, -1.1, 1.1, 3.2]) { col.circle(jx + Math.cos(ry) * s, jz - Math.sin(ry) * s, 0.7, 1.2, 'log'); placed.add(jx + Math.cos(ry) * s, jz - Math.sin(ry) * s, 1); } }
      }
    }

    /* --- 2) grass tufts + flowers (detail layer, cheap) --- */
    for (let z = bnd.minZ; z < bnd.maxZ; z += 2.9) for (let x = bnd.minX; x < bnd.maxX; x += 2.9) {
      const jx = x + R() * 2.9, jz = z + R() * 2.9;
      if (!inside(jx, jz, 1.2) || (jx > -104 && jx < 104 && jz > -104 && jz < 146)) continue;
      const zn = zoneOf(jx, jz), bi = BI[zn.biome]; if (!bi || !bi.tuft) continue;
      const n = V.ntab(jx, jz, 0.08);
      if (R() > bi.tuft * (0.25 + n * 1.3)) continue;
      if (roadD(jx, jz) < 0.4) continue;
      const wetk = W.bil(W.wet, jx, jz); if (wetk > 0.5) continue;
      if (bi.fl && R() < bi.fl) I.add('flowers', jx, 0, jz, R() * 6, 0.8 + R() * 0.5, [0xd9d0b0, 0xc9b85a, 0xb5a0c8, 0xd8c8b8, 0xe8a0a0][Math.floor(R() * 5)]);
      else I.add('tuft', jx, 0, jz, R() * 6, 0.7 + R() * 0.8, zn.biome === 'hills' || zn.biome === 'warren' ? 0xf0e0a0 : zn.biome === 'canyon' ? 0xe8c890 : zn.biome === 'frost' ? 0xdfe8ee : [0xffffff, 0xf2eedc, 0xe4ecd2][Math.floor(R() * 3)]);
      stats.tufts++;
    }

    /* --- 3) hill sides: pines, far giants, snow firs (backdrop; no colliders - nobody can get there) --- */
    for (let z = bnd.minZ; z < bnd.maxZ; z += 6) for (let x = bnd.minX; x < bnd.maxX; x += 6) {
      const jx = x + R() * 6, jz = z + R() * 6, s = W.sdAt(jx, jz);
      if (s < 3 || s > 150) continue;
      if (jx > -112 && jx < 112 && jz > -112 && jz < 150) continue;
      const zn = zoneOf(jx, jz), bi = BI[zn.biome]; if (!bi || !bi.hillTrees.length || !bi.hill) continue;
      const hy = yAt(jx, jz), sl = slopeAt(jx, jz);
      if (hy > 70 || sl > 1.15 || hy < -0.2) continue;
      const dens = bi.hill * (0.18 + 0.82 * smooth(3, 28, s)) * (0.35 + 1.1 * noise(jx, jz, 0.3, 40)) * (1 - smooth(55, 80, hy));
      if (R() > dens * 0.7) continue;
      const kind = bi.hillTrees[Math.floor(R() * bi.hillTrees.length)];
      const far = kind === 'giantFar';
      if (far && !FOREST) continue;   // ?atmo=0: no giant kinds
      if (!placed.free(jx, jz, far ? 11 : 2.2)) continue;
      if (far) { Iraw.add('giantFar', jx, hy - 0.3, jz, R() * TAU, 1.3 + R() * 0.8, tintTree[Math.floor(R() * tintTree.length)]); placed.add(jx, jz, 12); }
      else { Iraw.add(kind, jx, hy - 0.15, jz, R() * TAU, (kind === 'pine' ? 1.5 : 0.9) + R() * 0.8, kind === 'deadtree' ? 0xffffff : tintTree[Math.floor(R() * tintTree.length)]); placed.add(jx, jz, 2.2); }
      stats.hill++;
    }
    // island hills carry a few trees too
    for (const isl of W.islands) for (let k = 0; k < isl.r * 0.9; k++) {
      const a = R() * TAU, r = Math.sqrt(R()) * isl.r * 0.8, x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r, zn = zoneOf(x, z), bi = BI[zn.biome];
      if (!bi || !bi.hillTrees.length || isl.tower) continue;
      const kind = bi.hillTrees[Math.floor(R() * bi.hillTrees.length)]; if (kind === 'giantFar' || kind === 'deadtree') continue;
      Iraw.add(kind, x, yAt(x, z) - 0.15, z, R() * TAU, 0.7 + R() * 0.5, 0xffffff);
    }

    /* --- 4) water edges: reeds along rivers / ponds, lily pads --- */
    for (const rv of W.rivers) for (let s = 2; s < rv.line.length - 2; s++) {
      if (R() > 0.28) continue;
      const a = rv.line[s - 1], b = rv.line[s + 1]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const side = R() < 0.5 ? -1 : 1, off = rv.hw + 2.6 + R() * 1.6, x = rv.line[s][0] - tz * off * side, z = rv.line[s][1] + tx * off * side;
      if (inside(x, z, 0.4) || W.sdAt(x, z) < -0.1 - 4) { if (roadD(x, z) > 1.5 && campClear(x, z, 0, 0.4)) { I.add('reed', x, -0.05, z, R() * 6, 0.9 + R() * 0.8, 0xffffff); stats.reeds++; } }
    }
    for (const L of W.lakes) {
      const swamp = L.kind === 'swamp' || L.kind === 'pond', n = Math.round(Math.PI * (L.rx + L.rz) / (swamp ? 1.8 : 4.2));
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + R() * 0.2, f = 1 + (4.2 + R() * 2.5) / Math.min(L.rx, L.rz), cs = Math.cos(L.rot), sn = Math.sin(L.rot);
        const lx = Math.cos(a) * L.rx * f, lz = Math.sin(a) * L.rz * f, x = L.x + lx * cs - lz * sn, z = L.z + lx * sn + lz * cs;
        if (!inside(x, z, 0.6) || roadD(x, z) < 1.5 || L.kind === 'ice' || R() > (swamp ? 0.85 : 0.4)) continue;
        I.add('reed', x, -0.05, z, R() * 6, 0.9 + R() * 0.9, 0xffffff); stats.reeds++;
      }
      if (swamp || L.kind === 'lake') for (let k = 0; k < Math.min(90, L.rx * L.rz / 40); k++) {
        const a = R() * TAU, r = Math.sqrt(R()) * 0.82, cs = Math.cos(L.rot), sn = Math.sin(L.rot), lx = Math.cos(a) * L.rx * r, lz = Math.sin(a) * L.rz * r;
        Iraw.add('lily', L.x + lx * cs - lz * sn, W.WATER_Y + 0.04, L.z + lx * sn + lz * cs, R() * 6, 0.7 + R() * 0.7, 0xffffff);
      }
    }

    /* --- 5) landmarks --- */
    landmarks({ I, B, M, col, R, zoneOf, solid, placed, glow, stats, inside, yAt, FOREST });

    // grass under the big canopies is painted; tell the ground it changed
    W.finishMaps();
    W.sceneryStats = stats; W.populateMs = performance.now() - t0;
    if (FOREST) FOREST.placedWorld = stats;
  };

  /* ------------------------------------------------ landmarks ------------------------------------------------ */
  function landmarks(c) {
    const { I, B, M, col, R, solid, glow, stats, yAt, FOREST } = c;
    const ry2 = (dx, dz) => Math.atan2(dx, dz);
    const post = (x, y0, z, h, w, color) => B.boxY(M.wood, x, y0, z, w || 0.16, h, w || 0.16, { color: color || 0x5a4636 });

    /* bridges: planked deck at y ~ 0, rails, piles; the deck corridor is walkable in the floor mask */
    for (const br of W.computeBridges()) {
      const ry = ry2(br.dx, br.dz), L = br.L, Wd = br.W;
      B.push(br.x, 0, br.z, ry);
      B.boxY(M.planks, 0, -0.22, 0, Wd, 0.24, L, { color: 0x8a6c4c });
      for (let s = -L / 2 + 1; s <= L / 2; s += 2) {
        for (const sx of [-1, 1]) post(sx * (Wd / 2 - 0.12), -0.2, s, 1.2, 0.16);
        B.beam(M.wood, v3(-(Wd / 2) + 0.1, -0.5, s), v3(Wd / 2 - 0.1, -0.5, s), 0.22, 0.22, { color: 0x4f3d2e });
      }
      for (const sx of [-1, 1]) {
        B.beam(M.wood, v3(sx * (Wd / 2 - 0.12), 1.0, -L / 2 + 1), v3(sx * (Wd / 2 - 0.12), 1.0, L / 2), 0.1, 0.14, { color: 0x6e5844 });
        B.beam(M.wood, v3(sx * (Wd / 2 - 0.12), 0.55, -L / 2 + 1), v3(sx * (Wd / 2 - 0.12), 0.55, L / 2), 0.08, 0.1, { color: 0x6e5844 });
      }
      for (const sz of [-0.34, 0.34]) for (const sx of [-1, 1]) B.cyl(M.rubble, sx * (Wd / 2 - 0.5), -1.5, sz * L * 0.62, 0.5, 0.42, 1.55, 8, { color: 0xb0a898 });
      B.pop();
      stats.props++;
    }

    /* signposts at the forks */
    const sign = (x, z, ry, arms) => {
      B.push(x, yAt(x, z), z, ry); post(0, 0, 0, 2.7, 0.2);
      arms.forEach((a, i) => { B.box(M.planks, a.dir * 0.55, 2.35 - i * 0.5, 0, 1.3, 0.34, 0.07, { color: 0x7d6446, ry: a.dir * 0.0 }); B.box(M.dark, a.dir * 1.18, 2.35 - i * 0.5, 0, 0.18, 0.22, 0.08, { color: 0x3a2e24 }); });
      B.pop(); col.circle(x, z, 0.3, 3, 'props');
    };
    sign(14, 150, 0.1, [{ dir: -1 }, { dir: 1 }]);                                           // the gate road
    for (const [px, py, ry, arms] of [[84, 366, 0.5, [{ dir: -1 }, { dir: 1 }]], [188, 230, 0.2, [{ dir: -1 }, { dir: 1 }, { dir: 1 }]], [154, 436, 0.1, [{ dir: -1 }, { dir: 1 }]], [338, 350, 0.3, [{ dir: -1 }, { dir: 1 }]], [78, 236, 0.6, [{ dir: -1 }, { dir: 1 }]]]) { const q = W.P(px, py); sign(q[0] + 6, q[1], ry, arms); }

    /* helper: a simple pitched-roof building (w across x, d along z), door on +z */
    const building = (x, z, ry, w, d, h, wallMat, wallCol, roofCol) => {
      B.push(x, 0, z, ry);
      B.boxY(wallMat, 0, 0, 0, w, h, d, { color: wallCol });
      const rh = Math.min(w, d) * 0.5 * 0.85, ov = 0.35;
      // gable roof along z: two sloped quads + gable triangles
      const a = v3(-w / 2 - ov, h, -d / 2 - ov), b = v3(0, h + rh, -d / 2 - ov), cc = v3(w / 2 + ov, h, -d / 2 - ov), a2 = v3(-w / 2 - ov, h, d / 2 + ov), b2 = v3(0, h + rh, d / 2 + ov), c2 = v3(w / 2 + ov, h, d / 2 + ov);
      B.poly(M.shingle, [a, a2, b2, b], { color: roofCol, uvScale: 0.5 }); B.poly(M.shingle, [b, b2, c2, cc], { color: roofCol, uvScale: 0.5 });
      B.poly(M.shingle, [a, b, b2, a2].reverse(), { color: roofCol, uvScale: 0.5 }); B.poly(M.shingle, [b, cc, c2, b2].reverse(), { color: roofCol, uvScale: 0.5 });
      B.poly(M.plaster, [v3(-w / 2, h, d / 2), v3(w / 2, h, d / 2), v3(0, h + rh - 0.1, d / 2)], { color: wallCol });
      B.poly(M.plaster, [v3(w / 2, h, -d / 2), v3(-w / 2, h, -d / 2), v3(0, h + rh - 0.1, -d / 2)], { color: wallCol });
      B.box(M.dark, 0, 1.0, d / 2 + 0.01, 1.0, 2.0, 0.06, { color: 0x2c2118 });
      B.box(M.dark, w * 0.28, 1.5, d / 2 + 0.01, 0.6, 0.6, 0.05, { color: 0x1a1612 });
      B.pop();
      col.boxLocal(x, z, ry, 0, 0, w / 2, d / 2, h + rh, 'building');
    };

    /* farm: house, barn, windmill, fields, scarecrows */
    {
      const [fx, fz] = W.sites.farm;
      building(fx - 14, fz - 8, 0.15, 7, 10, 3.0, M.plaster, 0xe4d6bc, 0x6c5648);
      building(fx + 12, fz - 6, -0.1, 9, 13, 4.2, M.planks, 0x8a6a4c, 0x5a4a3c);
      // windmill
      const wx = fx + 2, wz = fz + 26;
      B.cyl(M.stone, wx, 0, wz, 3.4, 2.1, 9, 12, { color: 0xd8cdb8 });
      B.cyl(M.shingle, wx, 9, wz, 2.7, 0.1, 3.4, 12, { color: 0x6c5648 });
      B.push(wx, 8.2, wz + 2.3, 0.0);
      for (let k = 0; k < 4; k++) {
        const a = k * PI / 2 + 0.5, ex = Math.cos(a) * 7.2, ey = Math.sin(a) * 7.2;
        B.beam(M.wood, v3(0, 0, 0), v3(ex, ey, 0), 0.22, 0.22, { color: 0x4f3d2e });
        const nx = -Math.sin(a), ny = Math.cos(a);
        B.poly(M.cloth, [v3(Math.cos(a) * 1.6 + nx * 0.2, Math.sin(a) * 1.6 + ny * 0.2, 0.05), v3(ex + nx * 0.2, ey + ny * 0.2, 0.05), v3(ex + nx * 1.8, ey + ny * 1.8, 0.05), v3(Math.cos(a) * 1.6 + nx * 1.8, Math.sin(a) * 1.6 + ny * 1.8, 0.05)], { color: 0xe8dcc4 });
      }
      B.cyl(M.iron, 0, 0, 0.05, 0.4, 0.4, 0.5, 8, { color: 0x3a3a3c, flat: true }); B.pop();
      col.circle(wx, wz, 3.5, 12, 'building');
      // crop fields
      for (const [cx, cz, w, d, kind] of [[fx - 4, fz + 54, 26, 16, 'wheat'], [fx + 26, fz + 40, 18, 22, 'wheat'], [fx - 36, fz + 40, 16, 14, 'carrot']]) {
        for (let x = -w / 2; x < w / 2; x += 1.15) for (let z = -d / 2; z < d / 2; z += 1.05) I.add(kind, cx + x + (R() - 0.5) * 0.3, 0, cz + z + (R() - 0.5) * 0.3, R() * 6, 0.85 + R() * 0.3, 0xffffff);
        V.Props.fence(B, M, col, [[cx - w / 2 - 1.2, cz - d / 2 - 1.2], [cx + w / 2 + 1.2, cz - d / 2 - 1.2], [cx + w / 2 + 1.2, cz + d / 2 + 1.2], [cx - w / 2 - 1.2, cz + d / 2 + 1.2], [cx - w / 2 - 1.2, cz - d / 2 - 1.2]], { kind: 'rail', h: 0.95, seed: 9 + (cx | 0) });
      }
      for (const [sx, sz] of [[fx - 4, fz + 54], [fx + 26, fz + 40]]) { post(sx, 0, sz, 2.3, 0.14); B.box(M.wood, sx, 1.9, sz, 1.6, 0.1, 0.1, { color: 0x5a4636 }); B.cyl(M.burlap, sx, 2.15, sz, 0.2, 0.18, 0.4, 7, { color: 0xc8b48a }); col.circle(sx, sz, 0.3, 2.5, 'props'); }
      stats.props += 6;
    }

    /* mill at the main bridge */
    {
      const [mx, mz] = W.sites.mill;
      building(mx + 14, mz - 13, 0.0, 8, 10, 3.6, M.stone, 0xc8bca4, 0x6a5444);
      B.push(mx + 9.6, 0, mz - 13, 0); B.cyl(M.wood, 0, 1.6, 0, 2.2, 2.2, 0.5, 14, { color: 0x4f3d2e, a0: 0, a1: TAU }); B.pop();
      V.Props.fence(B, M, col, [[mx + 14, mz - 5], [mx + 14, mz - 2], [mx + 6, mz - 2]], { kind: 'picket', h: 0.8, seed: 5 });   // (was mx + 20: the fence ran into the main road)
    }

    /* rabbit warren: burrows around the rabbit camps + the heart mound with a giant hole, carrot gardens, wooden sign */
    for (const cp of W.camps.filter((q) => q.species.startsWith('rabbit'))) {
      const n = cp.species === 'rabbit_king' ? 0 : 5;
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + R() * 0.6, r = cp.r * (0.45 + R() * 0.5), x = cp.cx + Math.cos(a) * r, z = cp.cz + Math.sin(a) * r;
        if (!c.inside(x, z, 2) || W.roadDist(x, z) < 1.15 + 1.2) continue;
        I.add('burrow', x, -0.05, z, a + PI + (R() - 0.5) * 0.5, 0.9 + R() * 0.7, 0xffffff); solid(x, z, 1.15, 0.9, 'rock'); stats.props++;
      }
    }
    {
      const [hx, hz] = W.sites.warrenHeart;
      I.add('burrow', hx, -0.05, hz + 9, 0, 2.1, 0xffffff); solid(hx, hz + 9, 2.6, 1.5, 'rock');
      /* carrot gardens: slide a garden sideways when a road would run through its fence */
      const gardenSpot = ([gx0, gz0, w0, d0]) => { const need = Math.hypot(w0, d0) / 2 + 3.5; for (const [ox, oz] of [[0, 0], [-16, 0], [16, 0], [0, 16], [0, -16], [-30, 0], [30, 0], [-16, 16], [16, -16], [-16, -16], [16, 16]]) if (W.roadDist(gx0 + ox, gz0 + oz) > need && W.sdAt(gx0 + ox, gz0 + oz) < -4) return [gx0 + ox, gz0 + oz, w0, d0]; return null; };
      for (const [gx, gz, w, d] of [[hx - 46, hz + 32, 14, 9], [hx + 30, hz - 48, 12, 8], [hx + 62, hz + 30, 10, 12]].map(gardenSpot).filter(Boolean)) {
        for (let x = -w / 2; x < w / 2; x += 1.0) for (let z = -d / 2; z < d / 2; z += 0.95) if (c.inside(gx + x, gz + z, 2)) I.add('carrot', gx + x, 0, gz + z, R() * 6, 0.9 + R() * 0.3, 0xffffff);
        V.Props.fence(B, M, col, [[gx - w / 2 - 1, gz - d / 2 - 1], [gx + w / 2 + 1, gz - d / 2 - 1], [gx + w / 2 + 1, gz + d / 2 + 1], [gx - w / 2 - 1, gz + d / 2 + 1], [gx - w / 2 - 1, gz - d / 2 - 1]], { kind: 'picket', h: 0.7, seed: 21 + (gx | 0), gaps: [[0, 3]] });
      }
      // giant carrot signpost at the warren entrance
      const sx = 178, sz = 66;                                           // (a flat pad, see layout.js)
      post(sx, 0, sz, 2.4, 0.18); B.cyl(M.blade, sx, 2.4, sz, 0.45, 0.02, 1.5, 8, { color: 0xe0782a }); B.cyl(M.leaf, sx, 3.8, sz, 0.1, 0.5, 0.5, 6, { color: 0x4e8a34 }); col.circle(sx, sz, 0.35, 4, 'props');
    }

    /* goblin camps: tents, fire, totem, crates; the fort ring */
    for (const cp of W.camps.filter((q) => q.species.startsWith('goblin') && q.id.indexOf('boss') < 0)) {
      const frost = cp.species === 'goblin_frost';
      const nt = cp.count > 5 ? 3 : 2;
      for (let k = 0; k < nt; k++) {
        const a = k / nt * TAU + 0.6 + R() * 0.3, r = cp.r * 0.78, x = cp.cx + Math.cos(a) * r, z = cp.cz + Math.sin(a) * r;
        if (!c.inside(x, z, 3) || W.roadDist(x, z) < 1.9 + 1.2) continue;
        I.add('tent', x, 0, z, a + PI * 0.5, 0.9 + R() * 0.2, frost ? 0xaec4d8 : [0xffffff, 0xe8d0b0, 0xd8c0a0][k % 3]); solid(x, z, 1.9, 3, 'building'); stats.props++;
      }
      if (W.roadDist(cp.cx, cp.cz) > 3) { I.add('campfire', cp.cx, 0, cp.cz, 0, 1, 0xffffff); col.circle(cp.cx, cp.cz, 0.8, 0.5, 'props'); glow.push([cp.cx, yAt(cp.cx, cp.cz) + 0.8, cp.cz, 0, 0xff9a3a]); }
      if (W.roadDist(cp.cx + 3.2, cp.cz - 4.2) > 2) { I.add('totem', cp.cx + 3.2, 0, cp.cz - 4.2, 0.4, 1, 0xffffff); col.circle(cp.cx + 3.2, cp.cz - 4.2, 0.35, 4, 'props'); }
      for (let k = 0; k < 3; k++) { const a = R() * TAU, r = 2.5 + R() * 2.5; I.add(k % 2 ? 'crate' : 'barrel', cp.cx + Math.cos(a) * r, 0, cp.cz + Math.sin(a) * r, R() * 6, 1, 0xffffff); }
    }
    {   // Goblin fortress (Kemikkıran): palisade ring with a north gate, four watch posts, torches, banners, throne
      const [fx, fz] = W.sites.fort, Rr = 34, seg = 40, gate = [-PI / 2 - 0.16, -PI / 2 + 0.16];
      for (let k = 0; k < seg; k++) {
        const a = k / seg * TAU, a2 = (k + 1) / seg * TAU, am = (a + a2) / 2;
        const ang = ((am + PI / 2 + TAU) % TAU) - PI; if (Math.abs(ang) < 0.2) continue;                  // gate gap faces north (-z)
        const x = fx + Math.cos(am) * Rr, z = fz + Math.sin(am) * Rr;
        if (!c.inside(x, z, 0.5)) continue;
        const len = 2 * Rr * Math.sin(PI / seg) + 0.15, ry = -am + PI / 2;
        B.push(x, 0, z, ry);
        for (let j = -Math.floor(len / 0.5 / 2); j <= Math.floor(len / 0.5 / 2); j++) {
          const h = 3.6 + (V.hash2(k, j, 5) - 0.5) * 1.1;
          B.cyl(M.bark, j * 0.5, 0, 0, 0.27, 0.2, h, 6, { color: 0x6a5642, caps: '' }); B.cyl(M.wood, j * 0.5, h, 0, 0.2, 0.0, 0.45, 6, { color: 0x5a4636, caps: '' });
        }
        B.beam(M.wood, v3(-len / 2, 1.2, 0.2), v3(len / 2, 1.2, 0.2), 0.12, 0.16, { color: 0x4f3d2e }); B.beam(M.wood, v3(-len / 2, 2.4, 0.2), v3(len / 2, 2.4, 0.2), 0.12, 0.16, { color: 0x4f3d2e });
        B.pop();
        col.boxLocal(x, z, ry, 0, 0, len / 2, 0.35, 5, 'wall');
      }
      for (const a of [PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]) {
        const x = fx + Math.cos(a) * (Rr + 0.5), z = fz + Math.sin(a) * (Rr + 0.5); if (!c.inside(x, z, 1)) continue;
        for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) B.cyl(M.bark, x + dx, 0, z + dz, 0.26, 0.22, 6.2, 6, { color: 0x5e4a38, caps: '' });
        B.boxY(M.planks, x, 5.2, z, 3.2, 0.2, 3.2, { color: 0x6e5844 }); B.boxY(M.planks, x, 5.4, z, 3.2, 0.9, 0.12, { color: 0x6e5844 });
        col.circle(x, z, 2.0, 7, 'building');
        I.add('campfire', x, 5.4, z, 0, 0.55, 0xffffff);
      }
      for (const s of [-1, 1]) { const x = fx + s * 4.2, z = fz - Rr; I.add('totem', x, 0, z + 1.0, 0, 1.25, 0xffffff); col.circle(x, z + 1.0, 0.4, 4, 'props'); I.add('campfire', fx + s * 7, 0, fz - Rr + 3, 0, 0.9, 0xffffff); glow.push([fx + s * 7, 0.8, fz - Rr + 3, 0, 0xff9a3a]); }
      // throne: stone chair + bone heap
      B.boxY(M.stone, fx + 8, 0, fz + 2, 3.2, 0.6, 3.2, { color: 0x8a8070 }); B.boxY(M.stone, fx + 8, 0.6, fz + 3.2, 2.4, 2.8, 0.7, { color: 0x7a7060 }); B.boxY(M.stone, fx + 6.8, 0.6, fz + 2, 0.5, 1.3, 2.0, { color: 0x7a7060 }); B.boxY(M.stone, fx + 9.2, 0.6, fz + 2, 0.5, 1.3, 2.0, { color: 0x7a7060 });
      col.box(fx + 8, fz + 2.4, 1.7, 1.8, 0, 3.4, 'props');
      for (const [dx, dz] of [[-9, 4], [-4, -8], [6, -9], [-12, -6]]) { I.add('tent', fx + dx, 0, fz + dz, R() * 6, 1.15, 0xffffff); solid(fx + dx, fz + dz, 2.3, 3, 'building'); }
      glow.push([fx + 8, 1.5, fz + 2, 0, 0xff6a3a]);
      stats.props += 20;
    }

    /* wolf den: a rock arch + bones at the Kurt İni camp */
    {
      const [dx, dz] = W.sites.wolfDen;
      for (const s of [-1, 1]) { I.add('spire', dx + s * 5, -0.2, dz, R() * 6, 2.4, 0xb0a898); solid(dx + s * 5, dz, 3.0, 40, 'rock'); }
      B.box(M.rubble, dx, 9.6, dz, 12.5, 2.2, 4.0, { color: 0xa8a090, rz: 0.04 });
      B.box(M.rubble, dx, 11.2, dz, 8.0, 1.8, 3.2, { color: 0xb4ac9c, rz: -0.05 });
      B.box(M.dark, dx, 3.6, dz - 0.6, 8.4, 7.4, 1.0, { color: 0x0e0c0a });
      for (let k = 0; k < 8; k++) { const a = R() * TAU, r = 3 + R() * 6; B.beam(M.rubble, v3(dx + Math.cos(a) * r, 0.1, dz + 6 + Math.sin(a) * r * 0.5), v3(dx + Math.cos(a) * r + 0.6, 0.18, dz + 6 + Math.sin(a) * r * 0.5 + 0.2), 0.1, 0.1, { color: 0xd8d0bc }); }
      glow.push([dx, 3, dz + 3, 0, 0xffd27a]);
    }

    /* ruined watchtower on the hill, standing stone circle */
    {
      const [tx, tz] = W.sites.tower, ty = yAt(tx, tz) - 0.6;
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * TAU, h = 3.4 + V.hash2(k, 3, 9) * 5.5 * (k > 4 && k < 9 ? 0.4 : 1) + (k % 4 === 0 ? 3 : 0);
        B.push(tx + Math.cos(a) * 4.6, ty, tz + Math.sin(a) * 4.6, -a);
        B.boxY(M.stone, 0, 0, 0, 2.0, h, 1.5, { color: 0xb8ae9a, rz: (V.hash2(k, 9, 3) - 0.5) * 0.05 });
        B.pop();
      }
      B.boxY(M.stone, tx, ty, tz, 6, 0.5, 6, { color: 0x8a8272 });
      for (let k = 0; k < 7; k++) { const a = R() * TAU, r = 6 + R() * 5; I.add('rock', tx + Math.cos(a) * r, ty + 0.1, tz + Math.sin(a) * r, R() * 6, 0.6 + R() * 0.8, 0xbdb7ab); }
      glow.push([tx, ty + 2.5, tz, 0, 0xffd27a]);
      const [sx, sz] = W.sites.stones;
      for (let k = 0; k < 9; k++) {
        const a = k / 9 * TAU, x = sx + Math.cos(a) * 7.5, z = sz + Math.sin(a) * 7.5, h = 3.0 + V.hash2(k, 4, 2) * 1.4;
        if (!c.inside(x, z, 1)) continue;
        B.push(x, 0, z, -a); B.boxY(M.rubble, 0, -0.1, 0, 1.3, h, 0.8, { color: 0xb2aa98, top: [0.7, 0.6], rx: (V.hash2(k, 2, 7) - 0.5) * 0.06 }); B.pop();
        col.circle(x, z, 0.8, h, 'rock');
      }
      B.boxY(M.stone, sx, 0, sz, 2.6, 0.5, 2.6, { color: 0xa09886 }); col.circle(sx, sz, 1.5, 0.5, 'props');
    }

    /* dock + hut at Aynagöl */
    {
      const [dx, dz] = W.sites.dock;
      B.push(dx, 0, dz, PI / 2);
      B.boxY(M.planks, 0, 0.0, 0, 2.6, 0.16, 18, { color: 0x8a6c4c });
      for (let s = 0; s <= 18; s += 3) for (const sx of [-1, 1]) B.boxY(M.wood, sx * 1.2, -1.4, s - 0.2, 0.2, 1.6, 0.2, { color: 0x4f3d2e });
      B.pop();
      building(dx - 15, dz - 8, 0.4, 5, 6.5, 2.7, M.planks, 0x7d6446, 0x5a4a3c);
      for (let k = 0; k < 3; k++) { I.add('barrel', dx - 8 - k * 0.9, 0, dz - 2, R() * 6, 1, 0xffffff); }
    }

    /* Ancient Tree */
    {
      const [tx, tz] = W.sites.titan;
      if (FOREST) I.add('titan', tx, -1.2, tz, 0.6, 1.0, 0xf4f6ff);   // (?atmo=0: no colossal tree)
      for (let k = 0; k < 30; k++) { const a = R() * TAU, r = 8 + R() * 20; glow.push([tx + Math.cos(a) * r, 0.3 + R() * 2.4, tz + Math.sin(a) * r, 1]); }
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; solid(tx + Math.cos(a) * 6.4, tz + Math.sin(a) * 6.4, 2.8, 40, 'tree'); }
      solid(tx, tz, 5.2, 40, 'tree');
    }

    /* the great plaza: a round stone dais with a waystone obelisk and four lamp posts */
    {
      const [px, pz] = W.sites.plaza;
      B.cyl(M.stone, px, 0, pz, 4.6, 4.2, 0.45, 20, { color: 0x9a9080 }); B.cyl(M.stone, px, 0.45, pz, 3.4, 3.2, 0.3, 20, { color: 0xa89e8c });
      B.cyl(M.stone, px, 0.75, pz, 1.1, 0.7, 6.4, 8, { color: 0xb8ae9a, flat: true }); B.cyl(M.stone, px, 7.15, pz, 0.7, 0.0, 1.1, 8, { color: 0xc4baa6, flat: true, caps: '' });
      B.box(M.glass, px, 5.2, pz + 0.72, 0.28, 0.9, 0.06, { color: 0x9fd8ff });
      col.circle(px, pz, 4.4, 7, 'props'); glow.push([px, 5.2, pz + 1.2, 0, 0x9fd8ff]);
      for (let k = 0; k < 4; k++) {
        const a = k / 4 * TAU + PI / 4, x = px + Math.cos(a) * 11, z = pz + Math.sin(a) * 11;
        post(x, 0, z, 2.6, 0.16); B.box(M.iron, x, 2.7, z, 0.36, 0.42, 0.36, { color: 0x2f2f31 }); B.box(M.ember, x, 2.7, z, 0.24, 0.3, 0.24, { color: 0xffffff });
        col.circle(x, z, 0.3, 3, 'props'); glow.push([x, 2.7, z, 0, 0xffb060]);
      }
      stats.props += 6;
    }

    /* holy isle shrine: a ring of standing stones round an altar, blue light */
    {
      const [sx, sz] = W.sites.shrine;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, x = sx + Math.cos(a) * 9, z = sz + Math.sin(a) * 9, h = 3.6 + V.hash2(k, 5, 3) * 1.8;
        if (!c.inside(x, z, 1)) continue;
        B.push(x, 0, z, -a); B.boxY(M.rubble, 0, -0.1, 0, 1.5, h, 0.9, { color: 0xb8b0a0, top: [0.7, 0.6], rx: (V.hash2(k, 3, 7) - 0.5) * 0.06 }); B.pop();
        col.circle(x, z, 0.9, h, 'rock');
      }
      B.cyl(M.stone, sx, 0, sz, 2.4, 2.2, 0.5, 14, { color: 0x8f8776 }); B.boxY(M.stone, sx, 0.5, sz, 1.6, 1.0, 1.0, { color: 0xa09886 });
      col.circle(sx, sz, 1.8, 1.5, 'props'); glow.push([sx, 1.8, sz, 0, 0x7fd8ff]);
      for (let k = 0; k < 14; k++) { const a = R() * TAU, r = 3 + R() * 13; glow.push([sx + Math.cos(a) * r, 0.4 + R() * 1.8, sz + Math.sin(a) * r, 1]); }
      stats.props += 10;
    }

    /* camp lanterns along the main road: a post with an ember every ~140 m (cheap sense of a travelled road) */
    const main = W.roadLines.find((r) => r.id === 'main');
    if (main) for (let s = 6, acc = 0, last = 0; s < main.line.length; s++) {
      const p = main.line[s]; acc = p[2] - last; if (acc < 130) continue; last = p[2];
      const q = main.line[Math.min(s + 1, main.line.length - 1)], o = main.line[s - 1], tl = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1;     // offset along the road's NORMAL (a fixed +x offset landed in the road on bends)
      const x = p[0] - (q[1] - o[1]) / tl * 4.0, z = p[1] + (q[0] - o[0]) / tl * 4.0, gy = yAt(x, z);
      post(x, gy, z, 2.4, 0.14); B.box(M.iron, x, gy + 2.5, z, 0.34, 0.4, 0.34, { color: 0x2f2f31 }); B.box(M.ember, x, gy + 2.5, z, 0.22, 0.3, 0.22, { color: 0xffffff });
      col.circle(x, z, 0.3, 3, 'props'); glow.push([x, gy + 2.5, z, 0, 0xffb060]);
    }
  }
})();
