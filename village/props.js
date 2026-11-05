/* =====================================================================================================
 *  village/props.js  -  PropFactory + VegetationBuilder
 *
 *  Unique set pieces (wagon, well, stalls, forge, notice board, racks, fences...) are emitted into the static
 *  Builder (merged per chunk). Small repeated props (barrels, crates, sacks, hay, logs, rocks, bushes, trees,
 *  grass tufts, flowers, cabbages) are InstancedMesh templates built once with the same kit.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const A = V.Arch;
  const P = V.Props = {};
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const IRON = 0x34363a;

  /* ------------------------------------------ instanced templates ------------------------------------------ */
  function template(fn) { const B = new V.Builder({ chunk: 1e7 }); fn(B); return B.toGeometries(); }
  function blob(detail, r, seed, squash, jitter) {
    const g = new T.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + (V.vnoise(x * 3.1 + seed, z * 3.1 - y * 2.3, 0, seed) - 0.5) * (jitter === undefined ? 0.35 : jitter);
      p.setXYZ(i, x * n, y * n * (squash || 1), z * n);
    }
    g.computeVertexNormals();
    if (detail > 0 && !blob.flat) {   // soften: blend the facet normal toward the radial direction
      const n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i) / (squash || 1), z = p.getZ(i), l = Math.hypot(x, y, z) || 1; const nx = n.getX(i) * 0.35 + x / l * 0.65, ny = n.getY(i) * 0.35 + y / l * 0.65, nz = n.getZ(i) * 0.35 + z / l * 0.65, m = Math.hypot(nx, ny, nz) || 1; n.setXYZ(i, nx / m, ny / m, nz / m); }
    }
    // colour: darker underneath (self-shadowed canopy), lighter crown
    const c = [];
    for (let i = 0; i < p.count; i++) { const t = V.smooth(-r, r, p.getY(i)); c.push(0.62 + 0.45 * t, 0.66 + 0.4 * t, 0.62 + 0.38 * t); }
    g.setAttribute('color', new T.Float32BufferAttribute(c, 3));
    return g;
  }
  P.defineInstanced = function (I, M) {
    const CH = { tuft: 36, flowers: 36, cabbage: 48 };
    const add = (name, map, layer, cast) => {
      const parts = []; for (const [mat, geo] of map) parts.push({ geo, mat, cast: cast !== false });
      I.define(name, parts, { layer, chunk: CH[name] || 110 });
    };
    // barrel 0.62 x 0.95
    add('barrel', template((B) => {
      const prof = [[0.27, 0], [0.32, 0.18], [0.34, 0.47], [0.32, 0.77], [0.27, 0.95]];
      for (let i = 0; i < prof.length - 1; i++) B.cyl(M.planks, 0, prof[i][1], 0, prof[i][0], prof[i + 1][0], prof[i + 1][1] - prof[i][1], 12, { color: 0x8a6a4c, caps: '', uvScale: 0.5 });
      B.cyl(M.planks, 0, 0.9, 0, 0.255, 0.255, 0.02, 12, { color: 0x6a5240 });
      for (const y of [0.1, 0.3, 0.64, 0.84]) { const r = y < 0.2 || y > 0.8 ? 0.295 : 0.34; B.cyl(M.iron, 0, y, 0, r + 0.012, r + 0.012, 0.05, 12, { color: IRON, caps: '' }); }
    }), 'main');
    // crate 0.7 cube with darker edge battens
    add('crate', template((B) => {
      B.boxY(M.planks, 0, 0, 0, 0.7, 0.7, 0.7, { color: 0x9c8064 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.boxY(M.wood, sx * 0.33, 0, sz * 0.33, 0.08, 0.7, 0.08, { color: 0x6c5644 });
      for (const sy of [0.04, 0.66]) { B.box(M.wood, 0, sy, 0.345, 0.66, 0.08, 0.02, { color: 0x6c5644 }); B.box(M.wood, 0, sy, -0.345, 0.66, 0.08, 0.02, { color: 0x6c5644 }); B.box(M.wood, 0.345, sy, 0, 0.02, 0.08, 0.66, { color: 0x6c5644 }); B.box(M.wood, -0.345, sy, 0, 0.02, 0.08, 0.66, { color: 0x6c5644 }); }
    }), 'main');
    // grain sack
    add('sack', template((B) => {
      const g = blob(1, 0.32, 3, 1.25, 0.18); g.translate(0, 0.36, 0);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05) p.setY(i, 0.05 + (p.getY(i) - 0.05) * 0.2);
      g.computeVertexNormals();
      B.geo(M.burlap, g, null, { color: 0xc9b38e });
      B.cyl(M.burlap, 0, 0.7, 0, 0.09, 0.05, 0.18, 6, { color: 0xb8a07a });
    }), 'main');
    // rectangular hay bale with twine
    add('hay', template((B) => {
      B.boxY(M.straw, 0, 0, 0, 1.0, 0.48, 0.5, { color: 0xd9c48e });
      for (const x of [-0.25, 0.25]) B.boxY(M.dark, x, -0.005, 0, 0.03, 0.49, 0.51, { color: 0x7a6040 });
    }), 'main');
    // single log
    add('log', template((B) => {
      const m = new T.Matrix4().makeRotationZ(Math.PI / 2);
      B.pushMatrix(m); B.cyl(M.bark, 0, -0.6, 0, 0.17, 0.16, 1.2, 8, { color: 0x6a5642, caps: 'tb' }); B.pop();
    }), 'main');
    // rocks
    add('rock', template((B) => { blob.flat = true; const g = blob(1, 0.6, 9, 0.6, 0.55); blob.flat = false; g.translate(0, 0.12, 0); B.geo(M.rubble, g, null, { color: 0xb8b2a6, flat: true }); }), 'main');
    // bushes
    add('bush', template((B) => {
      for (const [x, y, z, r] of [[0, 0.45, 0, 0.62], [0.42, 0.35, 0.15, 0.45], [-0.38, 0.32, -0.12, 0.48], [0.05, 0.3, 0.42, 0.4], [-0.1, 0.62, -0.25, 0.38]]) { const g = blob(0, r, x * 7 + 3, 0.85, 0.3); g.translate(x, y, z); B.geo(M.leaf, g, null, { color: 0x5f6e44 }); }
    }), 'main');
    // grass tuft: a fan of tapered blades (double-sided, no shadows, detail layer)
    add('tuft', template((B) => {
      const R = V.rng(5);
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2 + R() * 0.6, r0 = 0.03 + R() * 0.06, len = 0.18 + R() * 0.22, lean = 0.08 + R() * 0.16;
        const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0, tx = Math.cos(a) * (r0 + lean), tz = Math.sin(a) * (r0 + lean);
        const px = -Math.sin(a) * 0.026, pz = Math.cos(a) * 0.026;
        B.poly(M.blade, [v3(bx - px, 0, bz - pz), v3(bx + px, 0, bz + pz), v3(tx, len, tz)], { vcol: [0.5, 0.5, 1.12], color: i % 3 ? 0x6e7a45 : 0x8a8456 });
      }
    }), 'detail', false);
    // flower clump: tuft + blossoms
    add('flowers', template((B) => {
      const R = V.rng(17);
      for (let i = 0; i < 7; i++) { const a = i * 0.9, r = 0.06 + R() * 0.12, h = 0.22 + R() * 0.18; const px = -Math.sin(a) * 0.03, pz = Math.cos(a) * 0.03, x = Math.cos(a) * r, z = Math.sin(a) * r; B.poly(M.blade, [v3(x - px, 0, z - pz), v3(x + px, 0, z + pz), v3(x * 1.2, h, z * 1.2)], { vcol: [0.6, 0.6, 1.1], color: 0x7d8c50 }); }
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1 + 0.3, r = 0.05 + R() * 0.12, fx = Math.cos(a) * r * 1.2, fz = Math.sin(a) * r * 1.2, fy = 0.26 + R() * 0.16, pr = 0.045;
        const pts = []; for (let k = 0; k < 10; k++) { const t = k / 10 * Math.PI * 2 + a, rr = k % 2 ? pr * 0.45 : pr; pts.push(v3(fx + Math.cos(t) * rr, fy, fz + Math.sin(t) * rr)); }
        for (let k = 0; k < 10; k++) B.poly(M.blade, [v3(fx, fy + 0.008, fz), pts[(k + 1) % 10], pts[k]], { color: 0xffffff });
      }
    }), 'detail', false);
    // cabbage
    add('cabbage', template((B) => { const g = blob(0, 0.2, 21, 0.75, 0.2); g.translate(0, 0.13, 0); B.geo(M.leaf, g, null, { color: 0x7f9460 }); const g2 = blob(0, 0.12, 23, 0.8, 0.2); g2.translate(0, 0.21, 0); B.geo(M.leaf, g2, null, { color: 0x93a872 }); }), 'detail', false);
    // trees
    const tree = (name, fn) => add(name, template(fn), 'main');
    const crown = (B, seed, n, cx, cy, cz, rx, ry, rz, rMin, rMax, colr, det) => {
      if (M.leafCard && V.Forest && V.Forest.on) return V.Forest.crownCards(B, M, seed, n, cx, cy, cz, rx, ry, rz, rMin, rMax, colr);   // forest.js: painted leaf cards instead of blobs
      const Rr = V.rng(seed);
      for (let i = 0; i < n; i++) {
        const a = Rr() * Math.PI * 2, e = (Rr() * 2 - 1) * 0.8, rr = Math.sqrt(Rr()) * 0.85;
        const x = cx + Math.cos(a) * Math.cos(e) * rx * rr, y = cy + Math.sin(e) * ry * rr * 0.8 + (i === 0 ? ry * 0.2 : 0), z = cz + Math.sin(a) * Math.cos(e) * rz * rr;
        const r = rMin + Rr() * (rMax - rMin);
        const g = blob(det === undefined ? 1 : det, r, seed * 7 + i * 13, 0.85, det === 0 ? 0.3 : 0.42); g.translate(x, y, z);
        const t = 0.9 + Rr() * 0.2;
        B.geo(M.leaf, g, null, { color: new THREE.Color(colr).multiplyScalar(t) });
      }
    };
    tree('oak', (B) => {
      B.cyl(M.bark, 0, 0, 0, 0.34, 0.22, 3.0, 8, { color: 0x5e5042, caps: '' });
      B.beam(M.bark, v3(0, 2.4, 0), v3(1.0, 3.7, 0.3), 0.2, 0.2, { color: 0x5e5042 });
      B.beam(M.bark, v3(0, 2.6, 0), v3(-0.9, 3.8, -0.4), 0.17, 0.17, { color: 0x5e5042 });
      B.beam(M.bark, v3(0, 2.8, 0), v3(0.1, 4.1, 0.9), 0.15, 0.15, { color: 0x5e5042 });
      crown(B, 11, 11, 0, 4.4, 0, 2.2, 1.4, 2.1, 0.85, 1.3, 0x5a6c3e);
    });
    tree('oakF', (B) => {
      B.cyl(M.bark, 0, 0, 0, 0.34, 0.22, 3.2, 6, { color: 0x5e5042, caps: '' });
      crown(B, 11, 8, 0, 4.4, 0, 2.1, 1.3, 2.0, 1.0, 1.45, 0x56683c, 0);
    });
    tree('lindenF', (B) => {
      B.cyl(M.bark, 0, 0, 0, 0.24, 0.16, 3.6, 6, { color: 0x625648, caps: '' });
      crown(B, 23, 7, 0, 5.3, 0, 1.4, 1.9, 1.4, 0.85, 1.2, 0x627248, 0);
    });
    tree('linden', (B) => {
      B.cyl(M.bark, 0, 0, 0, 0.24, 0.16, 3.6, 7, { color: 0x625648, caps: '' });
      crown(B, 23, 10, 0, 5.2, 0, 1.45, 2.0, 1.45, 0.7, 1.05, 0x65764a);
      crown(B, 29, 3, 0, 6.9, 0, 0.5, 0.4, 0.5, 0.55, 0.75, 0x6b7c4c);
    });
    tree('fruit', (B) => {
      B.cyl(M.bark, 0, 0, 0, 0.16, 0.11, 1.6, 7, { color: 0x6a5846, caps: '' });
      B.beam(M.bark, v3(0, 1.4, 0), v3(0.6, 2.1, 0.2), 0.1, 0.1, { color: 0x6a5846 });
      B.beam(M.bark, v3(0, 1.5, 0), v3(-0.5, 2.2, -0.3), 0.1, 0.1, { color: 0x6a5846 });
      crown(B, 37, 7, 0, 2.45, 0, 1.2, 0.6, 1.2, 0.55, 0.8, 0x5f7442);
      const R = V.rng(31);
      for (let i = 0; i < 14; i++) { const a = R() * 6.28, rr = 0.7 + R() * 0.4, y = 2.0 + R() * 0.9; B.box(M.blade, Math.cos(a) * rr, y, Math.sin(a) * rr, 0.09, 0.09, 0.09, { color: i % 3 ? 0xa8442e : 0xc2a23c }); }
    });
    tree('pine', (B) => {
      B.cyl(M.bark, 0, 0, 0, 0.26, 0.12, 2.2, 7, { color: 0x5e4c3c, caps: '' });
      const tiers = [[1.6, 2.0, 3.0], [2.8, 1.65, 2.6], [3.9, 1.3, 2.3], [4.9, 0.95, 2.0], [5.8, 0.6, 1.6]];
      for (const [y, r, h] of tiers) {
        const g = new T.ConeGeometry(r, h, 9, 2, true); g.translate(0, y + h / 2, 0);
        const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (V.hash2(i, y * 10 | 0, 3) - 0.5) * 0.18; if (p.getY(i) < y + h * 0.1) p.setXYZ(i, p.getX(i) * k, p.getY(i) - 0.15 * V.hash2(i, 2, 5), p.getZ(i) * k); }
        g.computeVertexNormals();
        const c = []; for (let i = 0; i < p.count; i++) { const t = V.smooth(y, y + h, p.getY(i)); c.push(0.55 + 0.35 * t, 0.62 + 0.32 * t, 0.58 + 0.3 * t); }
        g.setAttribute('color', new T.Float32BufferAttribute(c, 3));
        B.geo(M.leaf, g, null, { color: 0x4c5f3e });
      }
    });
  };

  /* ------------------------------------------ static set pieces ------------------------------------------ */
  // post-and-rail fence along a polyline; gaps: [[t0, t1]] in metres along the path
  P.fence = function (B, M, col, pts, o) {
    o = o || {};
    const h = o.h || 1.05, kind = o.kind || 'rail', R = V.rng(o.seed || 3), gaps = o.gaps || [], c0 = o.color || 0x6e5a46;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, ry = Math.atan2(dx, dz) - Math.PI / 2;
      const n = Math.max(1, Math.round(L / (kind === 'picket' ? 1.8 : 2.2)));
      for (let k = 0; k <= n; k++) {
        const t = acc + (L * k) / n;
        const inGap = gaps.some((g) => t > g[0] - 0.05 && t < g[1] + 0.05);
        const x = a[0] + dx * L * k / n, z = a[1] + dz * L * k / n;
        if (k < n || i === pts.length - 2) if (!inGap || gaps.some((g) => Math.abs(t - g[0]) < 0.1 || Math.abs(t - g[1]) < 0.1)) B.boxY(M.wood, x, 0, z, 0.13, h + 0.12, 0.13, { color: c0, rx: (R() - 0.5) * 0.06, rz: (R() - 0.5) * 0.06, skip: 'b' });
        if (k === n) continue;
        const tm = acc + L * (k + 0.5) / n;
        if (gaps.some((g) => tm > g[0] && tm < g[1])) continue;
        const mx = x + dx * L / n / 2, mz = z + dz * L / n / 2, seg = L / n;
        if (kind === 'wattle') {
          B.box(M.wood, mx, h * 0.48, mz, seg - 0.1, h * 0.86, 0.09, { ry, color: 0x7d6b55, uvScale: 2.6 });
        } else {
          for (const yy of kind === 'picket' ? [0.28, h - 0.2] : [0.45, h - 0.08]) B.box(M.wood, mx, yy, mz, seg + 0.05, 0.09, 0.07, { ry, color: c0, rz: (R() - 0.5) * 0.04 });
          if (kind === 'picket') { const np = Math.floor(seg / 0.16); for (let q = 0; q < np; q++) { const tt = (q + 0.5) / np - 0.5; B.boxY(M.planks, mx + dx * seg * tt, 0.04, mz + dz * seg * tt, 0.08, h - 0.04 - (q % 2) * 0.06, 0.03, { ry, color: 0x8e7a62, top: [0.5, 1] }); } }
        }
        if (col) col.box(mx, mz, seg / 2 + 0.05, 0.08, ry, h, 'fence');
      }
      acc += L;
    }
  };
  P.bench = function (B, M, x, z, ry, len) {
    len = len || 1.8;
    B.push(x, 0, z, ry);
    B.boxY(M.planks, 0, 0.42, 0, len, 0.07, 0.38, { color: 0x8a6e52 });
    for (const sx of [-1, 1]) B.boxY(M.wood, sx * (len / 2 - 0.2), 0, 0, 0.1, 0.42, 0.32, { color: 0x6a5442 });
    B.pop();
  };
  P.table = function (B, M, x, z, ry, len, o) {
    len = len || 1.9; o = o || {};
    B.push(x, 0, z, ry);
    B.boxY(M.planks, 0, 0.74, 0, len, 0.07, 0.82, { color: 0x86694e });
    for (const sx of [-1, 1]) { B.boxY(M.wood, sx * (len / 2 - 0.25), 0, 0, 0.1, 0.74, 0.6, { color: 0x664f3e }); }
    B.box(M.wood, 0, 0.22, 0, len - 0.4, 0.08, 0.08, { color: 0x664f3e });
    for (const sz of [-1, 1]) { B.boxY(M.planks, 0, 0.42, sz * 0.72, len, 0.06, 0.3, { color: 0x86694e }); for (const sx of [-1, 1]) B.boxY(M.wood, sx * (len / 2 - 0.25), 0, sz * 0.72, 0.08, 0.42, 0.26, { color: 0x664f3e }); }
    if (o.mugs) for (let i = 0; i < o.mugs; i++) { const mx = -len / 2 + 0.35 + i * (len - 0.7) / Math.max(1, o.mugs - 1); B.cyl(M.planks, mx, 0.81, (i % 2 ? 0.2 : -0.18), 0.05, 0.055, 0.13, 7, { color: 0x7a5c40 }); }
    B.pop();
  };
  P.lamp = function (B, M, x, z, h) {
    h = h || 3.1;
    B.cyl(M.stone, x, 0, z, 0.24, 0.2, 0.35, 8, { color: 0xcfc6b5 });
    B.cyl(M.iron, x, 0.35, z, 0.06, 0.05, h - 0.35, 6, { color: 0x2e2f31, caps: '' });
    B.box(M.iron, x + 0.28, h - 0.06, z, 0.56, 0.05, 0.05, { color: 0x2e2f31 });
    B.boxY(M.iron, x + 0.5, h - 0.62, z, 0.28, 0.06, 0.28, { color: 0x2e2f31 });
    B.boxY(M.glass, x + 0.5, h - 0.56, z, 0.22, 0.32, 0.22, { color: 0xb0a080 });
    B.box(M.iron, x + 0.5, h - 0.18, z, 0.32, 0.1, 0.32, { color: 0x2e2f31, top: [0.3, 0.3] });
  };
  // stacked woodpile between end posts, optional lean-to cover
  P.woodpile = function (B, M, x, z, ry, len, rows, o) {
    o = o || {};
    len = len || 2.2; rows = rows || 3;
    const R = V.rng(o.seed || 13);
    B.push(x, 0, z, ry);
    const rr = 0.13, nPer = Math.floor(len / (rr * 2.05));
    for (let r = 0; r < rows; r++) for (let k = 0; k < nPer - (r % 2); k++) {
      const lx = -len / 2 + rr + k * rr * 2.05 + (r % 2) * rr, ly = rr + r * rr * 1.75;
      B.pushMatrix(new T.Matrix4().makeRotationX(Math.PI / 2).setPosition(lx, ly, 0));
      B.cyl(M.bark, 0, -0.5, 0, rr * (0.9 + R() * 0.2), rr, 1.0, 7, { color: 0x6b5843, caps: 'tb', ao: false });
      B.pop();
      B.box(M.wood, lx, ly, 0.505, rr * 1.6, rr * 1.6, 0.01, { color: 0xc8aa82, ao: false });
    }
    for (const sx of [-1, 1]) B.boxY(M.wood, sx * (len / 2 + 0.06), 0, 0, 0.1, rows * rr * 1.75 + 0.3, 0.1, { color: 0x5e4a3a });
    if (o.roof) A.shed(B, M, -len / 2 - 0.25, len / 2 + 0.25, -0.75, 0.8, rows * rr * 1.75 + 0.75, rows * rr * 1.75 + 0.45, { color: 0x7a6856 });
    B.pop();
  };
  P.trough = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    B.boxY(M.planks, 0, 0.0, 0, 1.8, 0.55, 0.55, { color: 0x6e5a46 });
    B.boxY(M.water, 0, 0.5, 0, 1.66, 0.02, 0.42, { color: 0x30403f });
    B.pop();
  };
  P.well = function (B, M, x, z) {
    B.push(x, 0, z, 0.3);
    const ro = 1.15, ri = 0.82, h = 0.85;
    B.cyl(M.rubble, 0, 0, 0, ro + 0.06, ro, h, 16, { color: 0xc2baa9, caps: '' });
    B.cyl(M.rubble, 0, 0.2, 0, ri, ri, h - 0.2, 14, { color: 0x8a8378, caps: '' });   // inner face (seen from above)
    // inner faces need to face inward: emit reversed ring
    for (let k = 0; k < 14; k++) {
      const a0 = k / 14 * Math.PI * 2, a1 = (k + 1) / 14 * Math.PI * 2;
      B.quad(M.rubble, v3(Math.cos(a0) * ri, 0.2, Math.sin(a0) * ri), v3(Math.cos(a1) * ri, 0.2, Math.sin(a1) * ri), v3(Math.cos(a1) * ri, h, Math.sin(a1) * ri), v3(Math.cos(a0) * ri, h, Math.sin(a0) * ri), { color: 0x7a746a });
    }
    // capstones ring
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; B.push(Math.cos(a) * (ri + ro) / 2, h, Math.sin(a) * (ri + ro) / 2, -a); B.boxY(M.stone, 0, 0, 0, 0.36, 0.14, 0.62, { color: 0xd8d0c0 }); B.pop(); }
    B.cyl(M.water, 0, 0.35, 0, ri, ri, 0.01, 14, { color: 0x283436 });
    // posts, beam, windlass, roof
    for (const sx of [-1, 1]) B.boxY(M.wood, sx * (ro - 0.05), 0, 0, 0.16, 2.35, 0.16, { color: 0x5e4a3a });
    B.box(M.wood, 0, 2.35, 0, ro * 2 + 0.3, 0.14, 0.14, { color: 0x5e4a3a });
    B.pushMatrix(new T.Matrix4().makeRotationZ(Math.PI / 2).setPosition(-ro + 0.1, 1.55, 0)); B.cyl(M.wood, 0, 0, 0, 0.11, 0.11, ro * 2 - 0.2, 8, { color: 0x6e5844, caps: 'tb' }); B.pop();
    B.box(M.iron, ro - 0.02, 1.4, 0.2, 0.04, 0.3, 0.04, { color: 0x2e2f31 });
    B.box(M.dark, 0.1, 1.2, 0, 0.025, 0.7, 0.025, { color: 0x6a5a44 });
    B.cyl(M.planks, 0.1, 0.72, 0, 0.13, 0.16, 0.28, 8, { color: 0x6e5844 });
    A.roof(B, M, { w: ro * 2 + 0.6, d: 1.3, y: 2.35, pitch: 42, hip: 0, mat: M.shingle, color: 0x7c6a58, thick: 0.08, oe: 0.25, og: 0.2, gable: false, ridge: 'cap' });
    B.pop();
  };
  P.noticeBoard = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    for (const sx of [-1, 1]) B.boxY(M.wood, sx * 1.0, 0, 0, 0.16, 2.6, 0.16, { color: 0x5e4a3a });
    B.boxY(M.planks, 0, 0.95, 0.02, 1.85, 1.2, 0.08, { color: 0x7a6048 });
    B.box(M.wood, 0, 2.18, 0.04, 2.1, 0.1, 0.14, { color: 0x5e4a3a });
    B.box(M.wood, 0, 0.92, 0.04, 2.1, 0.1, 0.14, { color: 0x5e4a3a });
    const R = V.rng(41);
    const notes = [[-0.55, 1.75, 0.42, 0.5], [0.1, 1.8, 0.36, 0.42], [0.62, 1.68, 0.38, 0.55], [-0.35, 1.22, 0.5, 0.36], [0.35, 1.25, 0.4, 0.44]];
    for (const [nx, ny, w, h] of notes) {
      const tint = [0xe8dcc0, 0xe2d4b4, 0xd9cba8][Math.floor(R() * 3)];
      B.box(M.plaster, nx, ny, 0.07, w, h, 0.01, { color: tint, rz: (R() - 0.5) * 0.12, uvScale: 2 });
      B.box(M.dark, nx, ny + h / 2 - 0.05, 0.08, 0.04, 0.04, 0.01, { color: 0x3a3028 });
      for (let l = 0; l < 3; l++) B.box(M.dark, nx - w * 0.05, ny + h * 0.2 - l * h * 0.18, 0.078, w * 0.6, 0.012, 0.004, { color: 0x6a5c4c });
    }
    A.roof(B, M, { w: 2.2, d: 0.9, y: 2.6, pitch: 35, hip: 0, mat: M.shingle, color: 0x7c6a58, thick: 0.06, oe: 0.2, og: 0.15, gable: false });
    B.pop();
  };
  // hanging shop sign on a wall bracket; symbol drawn with simple shapes on the board
  P.hangingSign = function (B, M, x, y, z, ry, symbol) {
    B.push(x, y, z, ry);
    B.box(M.iron, 0, 0, 0.45, 0.05, 0.05, 0.9, { color: 0x2e2f31 });
    B.beam(M.iron, v3(0, -0.35, 0.02), v3(0, -0.02, 0.6), 0.04, 0.04, { color: 0x2e2f31 });
    B.box(M.iron, 0, -0.12, 0.62, 0.03, 0.22, 0.03, { color: 0x2e2f31 });
    B.box(M.planks, 0, -0.55, 0.62, 0.06, 0.6, 0.72, { color: 0x6e563e });
    const s = (yy, zz, w, h, c, rot) => { for (const sx of [-1, 1]) B.box(M.dark, sx * 0.035, -0.55 + yy, 0.62 + zz, 0.01, h, w, { color: c, rx: rot || 0 }); };
    if (symbol === 'mug') { s(-0.02, -0.05, 0.26, 0.3, 0xc9a45a); s(0.0, 0.14, 0.08, 0.18, 0xc9a45a); s(0.16, -0.05, 0.3, 0.06, 0xe8e0d0); }
    else if (symbol === 'leaf') { s(0, 0, 0.12, 0.36, 0x7d9a5a, 0.6); s(0, 0, 0.12, 0.36, 0x7d9a5a, -0.6); s(-0.05, 0, 0.32, 0.04, 0xe8e0d0); s(0, 0, 0.04, 0.4, 0xe8e0d0); }
    else if (symbol === 'anvil') { s(0.05, 0, 0.38, 0.08, 0x9aa0a6); s(-0.05, 0, 0.12, 0.14, 0x9aa0a6); s(-0.14, 0, 0.26, 0.06, 0x9aa0a6); }
    else if (symbol === 'horse') { s(0, 0, 0.3, 0.14, 0xc9a45a); s(0.1, 0.13, 0.08, 0.2, 0xc9a45a, -0.5); s(-0.12, -0.08, 0.04, 0.14, 0xc9a45a); s(-0.12, 0.08, 0.04, 0.14, 0xc9a45a); }
    B.pop();
  };
  P.signpost = function (B, M, x, z, dirs) {
    B.boxY(M.wood, x, 0, z, 0.16, 2.6, 0.16, { color: 0x5e4a3a });
    dirs.forEach((ang, i) => {
      B.push(x, 2.2 - i * 0.34, z, ang);
      B.box(M.planks, 0, 0, 0.62, 0.05, 0.22, 1.05, { color: 0x7a6048 });
      B.poly(M.planks, [v3(0.026, -0.11, 1.15), v3(0.026, -0.11, 1.15), v3(0.026, 0.11, 1.15), v3(0.026, 0, 1.32)].slice(1), { color: 0x7a6048 });
      B.pop();
    });
  };
  // wooden cart / supply wagon. o.cover: canvas hoops; cargo emitted by the caller as instanced props
  P.wagon = function (B, M, x, z, ry, o) {
    o = o || {};
    B.push(x, 0, z, ry);
    const L = 3.4, W = 1.6, bedY = 0.95;
    B.boxY(M.planks, 0, bedY, 0, W, 0.1, L, { color: 0x7e6248 });
    for (const sx of [-1, 1]) B.boxY(M.planks, sx * (W / 2 - 0.04), bedY + 0.1, 0, 0.08, 0.5, L, { color: 0x75593f });
    B.boxY(M.planks, 0, bedY + 0.1, -L / 2 + 0.04, W, 0.5, 0.08, { color: 0x75593f });
    for (const sx of [-1, 1]) B.box(M.wood, sx * 0.45, bedY - 0.12, 0, 0.12, 0.14, L - 0.2, { color: 0x5e4a3a });
    // wheels with spokes
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const wr = sz > 0 ? 0.52 : 0.62, wx = sx * (W / 2 + 0.12), wz = sz * (L / 2 - 0.6);
      B.pushMatrix(new T.Matrix4().makeRotationZ(Math.PI / 2).setPosition(wx, wr, wz));
      B.cyl(M.wood, 0, -0.06, 0, wr, wr, 0.12, 14, { color: 0x5a4636, caps: '' });
      B.cyl(M.wood, 0, -0.065, 0, wr - 0.08, wr - 0.08, 0.13, 14, { color: 0x4a3a2e, caps: '' });
      B.cyl(M.iron, 0, -0.07, 0, wr + 0.02, wr + 0.02, 0.1, 14, { color: IRON, caps: '' });
      B.cyl(M.wood, 0, -0.12, 0, 0.11, 0.11, 0.24, 8, { color: 0x4a3a2e });
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B.box(M.wood, Math.cos(a) * wr * 0.5, 0, Math.sin(a) * wr * 0.5, 0.06, 0.07, wr - 0.1, { ry: -a + Math.PI / 2, color: 0x5a4636 }); }
      B.pop();
    }
    // shafts forward, resting on the ground
    for (const sx of [-1, 1]) B.beam(M.wood, v3(sx * 0.5, bedY - 0.1, L / 2 - 0.2), v3(sx * 0.6, 0.12, L / 2 + 2.2), 0.09, 0.09, { color: 0x5e4a3a });
    B.box(M.wood, 0, 0.35, L / 2 + 1.6, 1.25, 0.08, 0.08, { color: 0x5e4a3a });
    if (o.cover) {   // canvas over hoops (back two thirds)
      const r = W / 2 + 0.06, z0 = -L / 2 + 0.1, z1 = L / 2 - 1.0, n = 8;
      for (let k = 0; k < n; k++) {
        const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n;
        const p = (a, zz) => v3(Math.cos(a) * r, bedY + 0.55 + Math.sin(a) * r * 0.95, zz);
        B.quad(M.cloth, p(a1, z1), p(a0, z1), p(a0, z0), p(a1, z0), { color: 0xcfc4ac, uvs: [[0.95, 0.03], [0.05, 0.03], [0.05, 0.14], [0.95, 0.14]] });
      }
      for (const zz of [z0, (z0 + z1) / 2, z1]) for (let k = 0; k < n; k++) { const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n; B.beam(M.wood, v3(Math.cos(a0) * (r + 0.02), bedY + 0.55 + Math.sin(a0) * r * 0.95, zz), v3(Math.cos(a1) * (r + 0.02), bedY + 0.55 + Math.sin(a1) * r * 0.95, zz), 0.05, 0.05, { color: 0x5e4a3a }); }
    }
    B.pop();
    return { bedY, L, W };
  };
  // market stall: posts, counter with cloth skirt, sagging striped canopy with scalloped valance, goods
  P.stall = function (B, M, I, x, z, ry, kind, band) {
    B.push(x, 0, z, ry);
    const w = 3.3, d = 2.0, hf = 2.35, hb = 2.85;
    for (const sx of [-1, 1]) { B.boxY(M.wood, sx * w / 2, 0, d / 2, 0.12, hf, 0.12, { color: 0x5e4a3a }); B.boxY(M.wood, sx * w / 2, 0, -d / 2, 0.12, hb, 0.12, { color: 0x5e4a3a }); }
    B.box(M.wood, 0, hf - 0.05, d / 2, w + 0.1, 0.1, 0.1, { color: 0x5e4a3a });
    B.box(M.wood, 0, hb - 0.05, -d / 2, w + 0.1, 0.1, 0.1, { color: 0x5e4a3a });
    // counter
    B.boxY(M.planks, 0, 0.0, d / 2 - 0.35, w - 0.1, 0.92, 0.6, { color: 0x7e6248 });
    B.boxY(M.planks, 0, 0.92, d / 2 - 0.32, w + 0.05, 0.06, 0.72, { color: 0x8c6e52 });
    const v0 = 1 - (band + 0.05) / 6, v1 = 1 - (band + 0.95) / 6;
    B.quad(M.cloth, v3(-w / 2 + 0.05, 0.25, d / 2 + 0.06), v3(w / 2 - 0.05, 0.25, d / 2 + 0.06), v3(w / 2 - 0.05, 0.9, d / 2 + 0.06), v3(-w / 2 + 0.05, 0.9, d / 2 + 0.06), { uvs: [[0, v1], [1, v1], [1, v0], [0, v0]] });
    // back shelf
    B.boxY(M.planks, 0, 1.0, -d / 2 + 0.25, w - 0.2, 0.06, 0.4, { color: 0x8c6e52 });
    B.boxY(M.planks, 0, 0.3, -d / 2 + 0.25, w - 0.2, 0.06, 0.4, { color: 0x8c6e52 });
    // canopy: 6 x 4 grid, sagging, overhanging the front
    const nx = 6, nz = 4, zb = -d / 2 - 0.15, zf = d / 2 + 0.55;
    const Y = (i, j) => { const u = i / nx, t = j / nz; return hb + 0.08 + (hf + 0.02 - hb) * t - Math.sin(Math.PI * u) * Math.sin(Math.PI * t) * 0.14; };
    const Pt = (i, j) => v3(-w / 2 - 0.15 + (w + 0.3) * i / nx, Y(i, j), zb + (zf - zb) * j / nz);
    const UV = (i, j) => [i / nx, v1 + (v0 - v1) * (1 - j / nz) * 0.98];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) B.poly(M.cloth, [Pt(i, j + 1), Pt(i + 1, j + 1), Pt(i + 1, j), Pt(i, j)], { uvs: [UV(i, j + 1), UV(i + 1, j + 1), UV(i + 1, j), UV(i, j)] });
    // scalloped valance along the front edge
    for (let i = 0; i < nx * 2; i++) {
      const xa = -w / 2 - 0.15 + (w + 0.3) * i / (nx * 2), xb = -w / 2 - 0.15 + (w + 0.3) * (i + 1) / (nx * 2), ya = Y(i / 2, nz), yb = Y((i + 1) / 2, nz);
      B.poly(M.cloth, [v3(xa, ya, zf), v3((xa + xb) / 2, Math.min(ya, yb) - 0.32, zf), v3(xb, yb, zf)].reverse(), { uvs: [[i / 12, v0], [(i + 0.5) / 12, v1], [(i + 1) / 12, v0]].reverse() });
    }
    // goods
    const R = V.rng(band * 17 + 3);
    const C = (lx, ly, lz) => { const s = Math.sin(ry), c = Math.cos(ry); return [x + lx * c + lz * s, ly, z - lx * s + lz * c]; };
    const crate = (lx, lz, open) => { const p = C(lx, 0.98, lz); B.boxY(M.planks, lx, 0.98, lz, 0.6, 0.2, 0.42, { color: 0x9c8064 }); return p; };
    if (kind === 'produce') {
      for (let k = 0; k < 4; k++) {
        const lx = -1.15 + k * 0.76, lz = d / 2 - 0.32; crate(lx, lz);
        const col = [0xa8442e, 0x8fa36a, 0xc2873c, 0xb8a040][k];
        for (let q = 0; q < 9; q++) B.box(M.blade, lx - 0.2 + (q % 3) * 0.2, 1.21, lz - 0.12 + Math.floor(q / 3) * 0.12, 0.13, 0.11, 0.11, { color: col, ry: q });
      }
      for (let k = 0; k < 3; k++) { const p = C(-1 + k, 0, -d / 2 + 0.6); I.add('crate', p[0], 0, p[2], ry + R() * 0.3, 0.75); }
      const sp = C(1.6, 0, 0.4); I.add('sack', sp[0], 0, sp[2], R() * 6, 1);
    } else if (kind === 'baker') {
      for (let k = 0; k < 10; k++) B.box(M.planks, -1.3 + (k % 5) * 0.62, 1.03, d / 2 - (k < 5 ? 0.45 : 0.18), 0.4, 0.15, 0.2, { color: 0xb27c46, ry: (R() - 0.5) * 0.4 });
      for (let k = 0; k < 6; k++) B.cyl(M.straw, -1.2 + k * 0.48, 1.06, -d / 2 + 0.25, 0.17, 0.2, 0.16, 8, { color: 0xc8a870 });
      for (let k = 0; k < 6; k++) B.box(M.planks, -1.2 + k * 0.48, 1.16, -d / 2 + 0.25, 0.22, 0.09, 0.14, { color: 0xa66e3c, ry: k });
      const sp = C(-1.7, 0, -0.2); I.add('sack', sp[0], 0, sp[2], 1, 1); const sp2 = C(-1.75, 0, 0.35); I.add('sack', sp2[0], 0, sp2[2], 2, 0.9);
    } else if (kind === 'potter') {
      for (let k = 0; k < 7; k++) { const h = 0.22 + R() * 0.22, r = 0.1 + R() * 0.07; B.cyl(M.rubble, -1.35 + k * 0.45, 0.98, d / 2 - 0.35, r * 0.7, r, h * 0.5, 9, { color: 0xb07a5a, caps: '' }); B.cyl(M.rubble, -1.35 + k * 0.45, 0.98 + h * 0.5, d / 2 - 0.35, r, r * 0.55, h * 0.5, 9, { color: 0xb07a5a }); }
      for (let k = 0; k < 6; k++) B.cyl(M.rubble, -1.2 + k * 0.48, 1.06, -d / 2 + 0.25, 0.14, 0.18, 0.26, 9, { color: k % 2 ? 0x9a6a50 : 0x8a7a68 });
      for (let k = 0; k < 4; k++) B.cyl(M.rubble, -1.2 + k * 0.7, 0.36, -d / 2 + 0.25, 0.2, 0.24, 0.4, 9, { color: 0xa87458 });
    } else if (kind === 'cloth') {
      const cols = [0x6b3a34, 0x3f5568, 0x6e6b4a, 0x8a7350, 0x5d4a5e, 0xb5a98e];
      for (let k = 0; k < 6; k++) { B.boxY(M.burlap, -1.25 + k * 0.5, 0.98, d / 2 - 0.35, 0.42, 0.12 + (k % 3) * 0.04, 0.5, { color: cols[k] }); }
      for (let k = 0; k < 5; k++) B.boxY(M.burlap, -1.2 + k * 0.6, 1.06, -d / 2 + 0.25, 0.5, 0.3, 0.32, { color: cols[(k + 2) % 6] });
      for (let k = 0; k < 3; k++) B.box(M.burlap, -0.9 + k * 0.9, hb - 0.6, -d / 2 + 0.05, 0.6, 0.9, 0.02, { color: cols[(k + 4) % 6] });
    } else if (kind === 'herbs') {
      for (let k = 0; k < 8; k++) B.cyl(M.planks, -1.35 + k * 0.38, 0.98, d / 2 - 0.35, 0.12, 0.13, 0.12, 8, { color: 0x8a6e52 });
      const hc = [0x9a5a3a, 0xb8902e, 0x6e7a3e, 0x7a4a3a, 0xa8a080, 0x5a6a3a, 0xb06a2a, 0x8a8a5a];
      for (let k = 0; k < 8; k++) B.cyl(M.burlap, -1.35 + k * 0.38, 1.1, d / 2 - 0.35, 0.1, 0.1, 0.02, 8, { color: hc[k] });
      for (let k = 0; k < 7; k++) B.box(M.leaf, -1.3 + k * 0.42, hb - 0.45, -d / 2 + 0.1, 0.14, 0.4, 0.1, { color: 0x7f8a54 });
      for (let k = 0; k < 2; k++) { const sp = C(-1.0 + k * 1.8, 0, -d / 2 - 0.5); I.add('sack', sp[0], 0, sp[2], k * 2, 0.9); }
    }
    B.pop();
  };
  // forge: stone hearth with coal bed, hood + chimney, bellows; anvil on a stump; quench tub; grindstone
  P.forge = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    B.boxY(M.rubble, 0, 0, 0, 2.0, 0.85, 1.3, { color: 0xb5ad9e });
    B.boxY(M.stone, 0, 0.85, 0, 2.08, 0.1, 1.38, { color: 0xcfc6b5 });
    B.boxY(M.ember, 0.0, 0.94, 0.05, 1.0, 0.05, 0.7, { color: 0x3a2a24 });
    B.boxY(M.dark, 0, 0.93, 0.05, 1.2, 0.03, 0.85, { color: 0x221a14 });
    B.box(M.stone, 0, 2.15, -0.2, 1.9, 0.9, 1.1, { color: 0xc3baa9, top: [0.45, 0.55] });
    B.boxY(M.rubble, 0, 2.6, -0.3, 0.85, 3.0, 0.7, { color: 0xb5ad9e });
    B.boxY(M.stone, 0, 5.6, -0.3, 1.05, 0.12, 0.9, { color: 0xcfc6b5 });
    for (const sx of [-1, 1]) B.boxY(M.rubble, sx * 0.85, 0.85, -0.45, 0.3, 1.0, 0.4, { color: 0xb5ad9e });
    // bellows
    B.box(M.burlap, 1.45, 1.0, 0.1, 0.5, 0.25, 0.9, { color: 0x6e5440, rz: 0.15 });
    B.beam(M.wood, v3(1.45, 1.15, -0.4), v3(1.45, 1.6, -1.0), 0.07, 0.07, { color: 0x5e4a3a });
    // anvil on a stump
    B.cyl(M.bark, 0.2, 0, 1.7, 0.36, 0.32, 0.55, 9, { color: 0x6b5843 });
    B.boxY(M.iron, 0.2, 0.55, 1.7, 0.34, 0.12, 0.22, { color: 0x3a3c40 });
    B.boxY(M.iron, 0.2, 0.67, 1.7, 0.2, 0.14, 0.14, { color: 0x3a3c40 });
    B.boxY(M.iron, 0.2, 0.81, 1.7, 0.62, 0.14, 0.24, { color: 0x45474b });
    B.box(M.iron, 0.6, 0.88, 1.7, 0.22, 0.08, 0.12, { color: 0x45474b, top: [0.2, 0.6] });
    B.box(M.iron, -0.05, 0.96, 1.75, 0.28, 0.04, 0.04, { color: 0x2a2b2e, ry: 0.4 });
    // quench tub
    B.cyl(M.planks, -1.4, 0, 1.3, 0.42, 0.38, 0.6, 12, { color: 0x6e5844, caps: '' });
    B.cyl(M.water, -1.4, 0.52, 1.3, 0.38, 0.38, 0.01, 12, { color: 0x2a3436 });
    for (const y of [0.12, 0.48]) B.cyl(M.iron, -1.4, y, 1.3, 0.425, 0.43, 0.05, 12, { color: IRON, caps: '' });
    B.pop();
  };
  P.grindstone = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    for (const sx of [-1, 1]) B.boxY(M.wood, sx * 0.3, 0, 0, 0.1, 0.9, 0.12, { color: 0x5e4a3a });
    B.pushMatrix(new T.Matrix4().makeRotationZ(Math.PI / 2).setPosition(-0.1, 0.85, 0)); B.cyl(M.stone, 0, 0, 0, 0.42, 0.42, 0.2, 14, { color: 0xbab2a2, caps: 'tb' }); B.pop();
    B.box(M.wood, 0, 0.85, 0, 0.75, 0.06, 0.06, { color: 0x5e4a3a });
    B.pop();
  };
  P.worktable = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    B.boxY(M.planks, 0, 0.82, 0, 2.0, 0.1, 0.8, { color: 0x7a5e44 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.boxY(M.wood, sx * 0.88, 0, sz * 0.32, 0.1, 0.82, 0.1, { color: 0x5e4a3a });
    B.box(M.iron, -0.5, 0.95, 0.05, 0.5, 0.03, 0.06, { color: 0x45474b, ry: 0.2 });
    B.box(M.iron, 0.1, 0.94, -0.1, 0.3, 0.05, 0.1, { color: 0x3a3c40 });
    B.box(M.wood, 0.1, 0.94, 0.05, 0.05, 0.05, 0.35, { color: 0x6e5844 });
    B.box(M.iron, 0.55, 0.95, 0.15, 0.08, 0.05, 0.45, { color: 0x45474b, ry: -0.3 });
    // tool rack on the back
    B.boxY(M.wood, 0, 0.92, -0.38, 2.0, 0.9, 0.06, { color: 0x6a5442 });
    for (let k = 0; k < 6; k++) B.box(M.iron, -0.8 + k * 0.32, 1.45, -0.32, 0.06, 0.5, 0.03, { color: k % 2 ? 0x45474b : 0x5a5d62 });
    B.pop();
  };
  // weapon rack: A-frame with practice swords, spears, round shields
  P.weaponRack = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    for (const sx of [-1, 1]) { B.beam(M.wood, v3(sx * 1.1, 0, 0.35), v3(sx * 1.1, 1.6, 0), 0.1, 0.1, { color: 0x5e4a3a }); B.beam(M.wood, v3(sx * 1.1, 0, -0.35), v3(sx * 1.1, 1.6, 0), 0.1, 0.1, { color: 0x5e4a3a }); }
    B.box(M.wood, 0, 1.55, 0, 2.4, 0.1, 0.1, { color: 0x5e4a3a });
    B.box(M.wood, 0, 0.55, 0.22, 2.3, 0.08, 0.08, { color: 0x5e4a3a });
    for (let k = 0; k < 5; k++) { const sx = -0.8 + k * 0.4; B.beam(M.wood, v3(sx, 0.05, 0.3), v3(sx + 0.05, 1.5, 0.06), 0.06, 0.04, { color: 0x8a7050 }); B.box(M.wood, sx + 0.02, 0.55, 0.26, 0.25, 0.05, 0.06, { color: 0x6a5442 }); }
    for (let k = 0; k < 3; k++) { const sx = -1.0 + k * 1.0; B.beam(M.wood, v3(sx + 0.3, 0.02, -0.28), v3(sx + 0.35, 2.3, -0.02), 0.05, 0.05, { color: 0x7a6046 }); B.cyl(M.iron, sx + 0.35, 2.3, -0.02, 0.04, 0.0, 0.25, 4, { color: 0x6a6e74, caps: '' }); }
    for (const sx of [-0.55, 0.55]) { B.pushMatrix(new T.Matrix4().makeRotationX(Math.PI / 2 - 0.15).setPosition(sx, 0.95, -0.42)); B.cyl(M.planks, 0, 0, 0, 0.36, 0.36, 0.05, 12, { color: sx < 0 ? 0x6e3a30 : 0x3f5568, caps: 'tb' }); B.cyl(M.iron, 0, 0.05, 0, 0.09, 0.07, 0.05, 8, { color: IRON }); B.pop(); }
    B.pop();
  };
  // archery butt on a wooden stand, face toward +z (local). Returns the boss centre height / radius
  P.archeryTarget = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    const cy = 1.25, r = 0.62;
    B.beam(M.wood, v3(-0.55, 0, 0.35), v3(-0.3, 1.95, -0.05), 0.09, 0.09, { color: 0x5e4a3a });
    B.beam(M.wood, v3(0.55, 0, 0.35), v3(0.3, 1.95, -0.05), 0.09, 0.09, { color: 0x5e4a3a });
    B.beam(M.wood, v3(0, 0, -0.85), v3(0, 1.9, -0.1), 0.09, 0.09, { color: 0x5e4a3a });
    B.box(M.wood, 0, 0.62, 0.22, 1.3, 0.08, 0.1, { color: 0x5e4a3a });
    B.pushMatrix(new T.Matrix4().makeRotationX(Math.PI / 2 - 0.12).setPosition(0, cy, 0.12));
    B.cyl(M.straw, 0, -0.14, 0, r, r, 0.28, 18, { color: 0xd6c08a, caps: 'tb' });
    const rings = [[0.58, 0xd9cfb5], [0.46, 0x9a3b2e], [0.34, 0xd9cfb5], [0.22, 0x9a3b2e], [0.1, 0xc9a24a]];
    rings.forEach(([rr, c], i) => B.cyl(M.dark, 0, 0.14 + i * 0.003, 0, rr, rr, 0.002, 18, { color: c, caps: 't' }));
    B.pop();
    B.pop();
    return { cy, r };
  };
  // decorative training post (pell): a stout stake with notches
  P.pell = function (B, M, x, z) {
    B.cyl(M.bark, x, 0, z, 0.2, 0.18, 1.8, 8, { color: 0x6b5843 });
    for (let k = 0; k < 4; k++) B.cyl(M.dark, x, 0.6 + k * 0.3, z, 0.185, 0.185, 0.03, 8, { color: 0x4a3a2c, caps: '' });
  };
  P.herbBed = function (B, M, I, x, z, ry, w, d, seed) {
    B.push(x, 0, z, ry);
    B.boxY(M.planks, 0, 0, 0, w, 0.36, d, { color: 0x6e5a46 });
    B.boxY(M.dark, 0, 0.36, 0, w - 0.12, 0.01, d - 0.12, { color: 0x3e3226 });
    B.pop();
    const R = V.rng(seed || 1), s = Math.sin(ry), c = Math.cos(ry);
    const n = Math.round(w * d * 4);
    const greens = [0x7f9a58, 0x8a9a62, 0x6e8a5a, 0x96a070, 0x7a8e66];
    for (let k = 0; k < n; k++) {
      const lx = (R() - 0.5) * (w - 0.35), lz = (R() - 0.5) * (d - 0.35);
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      if (R() < 0.35) I.add('flowers', wx, 0.36, wz, R() * 6, 0.8 + R() * 0.4, [0xb59ad0, 0xe8dcb0, 0xd9c35a, 0xc0a0c8][k % 4]);
      else I.add('bush', wx, 0.33, wz, R() * 6, 0.22 + R() * 0.12, greens[k % 5]);
    }
  };
  P.dryingRack = function (B, M, x, z, ry) {
    B.push(x, 0, z, ry);
    for (const sx of [-1, 1]) { B.beam(M.wood, v3(sx * 0.9, 0, 0.4), v3(sx * 0.9, 1.9, 0), 0.07, 0.07, { color: 0x5e4a3a }); B.beam(M.wood, v3(sx * 0.9, 0, -0.4), v3(sx * 0.9, 1.9, 0), 0.07, 0.07, { color: 0x5e4a3a }); }
    B.box(M.wood, 0, 1.85, 0, 1.95, 0.07, 0.07, { color: 0x5e4a3a });
    const cols = [0x7f8a54, 0x8a8a5a, 0x9a7a4a, 0x6e7a4a, 0x8f8460];
    for (let k = 0; k < 9; k++) { B.box(M.leaf, -0.8 + k * 0.2, 1.62, 0, 0.12, 0.42, 0.12, { color: cols[k % 5], ry: k }); B.box(M.dark, -0.8 + k * 0.2, 1.84, 0, 0.02, 0.06, 0.02, { color: 0x8a7a5a }); }
    B.pop();
  };
  P.planter = function (B, M, I, x, z, r) {
    B.cyl(M.stone, x, 0, z, r, r - 0.08, 0.55, 10, { color: 0xd2cab9 });
    B.cyl(M.dark, x, 0.55, z, r - 0.1, r - 0.1, 0.01, 10, { color: 0x3e3226 });
    I.add('bush', x, 0.45, z, x * 3, 0.7, 0x8a9a62);
  };
  P.brazier = function (B, M, x, z) {
    for (let k = 0; k < 3; k++) { const a = k * 2.094; B.beam(M.iron, v3(x + Math.cos(a) * 0.3, 0, z + Math.sin(a) * 0.3), v3(x + Math.cos(a) * 0.12, 0.9, z + Math.sin(a) * 0.12), 0.04, 0.04, { color: 0x2e2f31 }); }
    B.cyl(M.iron, x, 0.85, z, 0.22, 0.38, 0.28, 10, { color: 0x34363a, caps: '' });
    B.cyl(M.dark, x, 1.0, z, 0.36, 0.36, 0.01, 10, { color: 0x1e1814 });
  };
  /* interactive training dummy model: identical look to the game's original dummy (index.html) so all yard
     dummies match. Returns { g, piv, mats }; piv is the sprung pivot the game wobbles on hits. */
  let dummyGeo = null;
  P.makeDummy = function () {
    if (!dummyGeo) dummyGeo = {
      base: new T.CylinderGeometry(0.75, 0.85, 0.16, 12), band: new T.CylinderGeometry(0.78, 0.78, 0.04, 12), post: new T.CylinderGeometry(0.1, 0.12, 1.9, 7),
      arm: new T.BoxGeometry(1.25, 0.12, 0.12), body: new T.CylinderGeometry(0.34, 0.3, 0.85, 8), r3: new T.CylinderGeometry(0.3, 0.3, 0.03, 14),
      r2: new T.CylinderGeometry(0.2, 0.2, 0.03, 14), r1: new T.CylinderGeometry(0.1, 0.1, 0.03, 14), head: new T.SphereGeometry(0.27, 8, 6), hoop: new T.CylinderGeometry(0.36, 0.36, 0.06, 8), hoop2: new T.CylinderGeometry(0.31, 0.31, 0.06, 8),
    };
    const G = dummyGeo, g = new T.Group();
    const mat = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0, flatShading: true }, o || {}));
    const wood = mat(0x7b5233), straw = mat(0xd2b26d), red = mat(0xb5382f), white = mat(0xf0e6ce), iron = mat(0x4a5564, { metalness: 0.5, roughness: 0.5 });
    const add = (p, geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
    add(g, G.base, wood, 0, 0.08, 0); add(g, G.band, iron, 0, 0.18, 0);
    const piv = new T.Group(); piv.position.y = 0.16; g.add(piv);
    add(piv, G.post, wood, 0, 0.95, 0); add(piv, G.arm, wood, 0, 1.6, 0);
    add(piv, G.body, straw, 0, 1.3, 0).scale.z = 0.8;
    for (const [geo, m, z] of [[G.r3, red, 0.28], [G.r2, white, 0.285], [G.r1, red, 0.29]]) add(piv, geo, m, 0, 1.35, z).rotation.x = Math.PI / 2;
    add(piv, G.head, straw, 0, 2.0, 0);
    add(piv, G.hoop, iron, 0, 0.95, 0).scale.z = 0.8; add(piv, G.hoop2, iron, 0, 1.64, 0).scale.z = 0.8;
    return { g, piv, mats: [wood, straw, red, white, iron] };
  };
  P.haystack = function (B, M, x, z, r, h) {
    B.cyl(M.straw, x, 0, z, r, r * 0.95, h * 0.45, 14, { color: 0xcdb680, caps: '', uvScale: 0.8 });
    B.cyl(M.straw, x, h * 0.45, z, r * 0.95, 0.12, h * 0.55, 14, { color: 0xc4ad78, caps: '', uvScale: 0.8 });
  };
})();
