/* =====================================================================================================
 *  world/nav.js  -  walkable-floor push-back, big-world navigation grid, bridges
 *
 *    W.keepInside(p, r)      slide a circle back onto the walkable floor (valley boundary, rivers, lakes, hill mounds)
 *    W.makeNav(col)          1 m NavGrid over the whole world, rasterised from the floor mask + the collision shapes
 *    W.compositeNav(v, b, walk)  village (0.5 m) + wilderness (1 m) behind the NavGrid API the game uses
 *    W.bridges               river x road crossings (stamped into the floor mask by layout.js, built by scenery.js)
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const W = V.World;
  if (!W || !W.on) return;

  /* ------------------------------------------------ bridges (road x river) ------------------------------------------------ */
  W.DECK_W = 6;
  W.computeBridges = function () {
    if (W.bridges) return W.bridges;
    const out = [], rivers = W.rivers;
    const roads = W.roads.filter((r) => r.kind === 'dirt').map((r) => ({ id: r.id, w: r.w, line: W.spline(r.pts, 6) }));
    for (const rd of roads) for (const rv of rivers) {
      for (let i = 0; i < rd.line.length - 1; i++) {
        const a = rd.line[i], b = rd.line[i + 1];
        for (let j = 0; j < rv.line.length - 1; j++) {
          const c = rv.line[j], d = rv.line[j + 1];
          const r1x = b[0] - a[0], r1z = b[1] - a[1], r2x = d[0] - c[0], r2z = d[1] - c[1], den = r1x * r2z - r1z * r2x;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((c[0] - a[0]) * r2z - (c[1] - a[1]) * r2x) / den, u = ((c[0] - a[0]) * r1z - (c[1] - a[1]) * r1x) / den;
          if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
          const x = a[0] + r1x * t, z = a[1] + r1z * t;
          if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 40)) continue;
          const rl = Math.hypot(r1x, r1z), dx = r1x / rl, dz = r1z / rl, tl = Math.hypot(r2x, r2z), tx = r2x / tl, tz = r2z / tl;
          const sin = Math.max(0.45, Math.abs(dx * tz - dz * tx)), half = rv.hw + 0.75 * W.RIVER_BANK;
          out.push({ id: 'br_' + rv.id + '_' + rd.id, river: rv.id, road: rd.id, x, z, dx, dz, tx, tz, L: 2 * half / sin + 6, W: W.DECK_W, half });
        }
      }
    }
    W.bridges = out;
    return out;
  };
  /* stamp a walkable corridor (the deck) into the floor mask: a river band stays blocked beside it = the rails */
  W.stampBridges = function () {
    const B = W.bounds, G = W.G, sd = W.sd;
    const deck = W.deck || (W.deck = new Uint8Array(W.NX * W.NZ));         // cells under a bridge deck: walk height = deck height (0), not the river bed
    for (const br of W.computeBridges()) {
      const R = br.L / 2 + br.W + 2, i0 = Math.max(0, Math.floor((br.x - R - B.minX) / G)), i1 = Math.min(W.NX - 1, Math.ceil((br.x + R - B.minX) / G));
      const j0 = Math.max(0, Math.floor((br.z - R - B.minZ) / G)), j1 = Math.min(W.NZ - 1, Math.ceil((br.z + R - B.minZ) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = B.minX + i * G, z = B.minZ + j * G, ox = x - br.x, oz = z - br.z;
        const along = ox * br.dx + oz * br.dz, across = Math.abs(-ox * br.dz + oz * br.dx);
        if (Math.abs(along) > br.L / 2 + 3 || across > br.W / 2) continue;
        const v = -(br.W / 2 - across) - 0.2;
        const k = j * W.NX + i; if (v < sd[k]) sd[k] = v;
        if (across < br.W / 2 - 0.2) deck[k] = 1;
      }
    }
  };

  /* ------------------------------------------------ floor push-back ------------------------------------------------ */
  const _g = { x: 0, z: 0 };
  W.keepInside = function (p, r) {
    const m = (r || 0.42) + 0.3;
    let moved = false;
    for (let it = 0; it < 14; it++) {
      const s = W.sdAt(p.x, p.z);
      if (s <= -m) break;
      W.sdGrad(p.x, p.z, _g);
      const k = Math.min(s + m + 0.02, 25);                        // far inside rock / water (teleports, blink bugs): walk out in big steps
      p.x -= _g.x * k; p.z -= _g.z * k; moved = true;
    }
    return moved;
  };

  /* ------------------------------------------------ big navigation grid ------------------------------------------------ */
  W.makeNav = function (col, radius) {
    const t0 = performance.now(), cell = 1.0, G = W.G;
    // bounds: where the floor exists, plus a margin
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const B = W.bounds;
    for (let j = 0; j < W.NZ; j += 2) for (let i = 0; i < W.NX; i += 2) if (W.sd[j * W.NX + i] < 0) {
      const x = B.minX + i * G, z = B.minZ + j * G; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const bounds = { minX: Math.floor(x0 - 8), maxX: Math.ceil(x1 + 8), minZ: Math.floor(z0 - 8), maxZ: Math.ceil(z1 + 8) };
    const R = radius || 0.47;
    const fill = (block, nav) => {
      const w = nav.w, h = nav.h;
      for (let j = 0; j < h; j++) {
        const z = nav.minZ + (j + 0.5) * cell;
        for (let i = 0; i < w; i++) block[j * w + i] = W.sdAt(nav.minX + (i + 0.5) * cell, z) > -0.9 ? 1 : 0;
      }
      for (const s of col.shapes) {
        if (s.tag === 'bounds') continue;
        if (s.t === 1) {
          const rr = s.r + R, i0 = Math.max(0, Math.floor((s.x - rr - nav.minX) / cell)), i1 = Math.min(w - 1, Math.floor((s.x + rr - nav.minX) / cell));
          const j0 = Math.max(0, Math.floor((s.z - rr - nav.minZ) / cell)), j1 = Math.min(h - 1, Math.floor((s.z + rr - nav.minZ) / cell));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const dx = nav.minX + (i + 0.5) * cell - s.x, dz = nav.minZ + (j + 0.5) * cell - s.z;
            if (dx * dx + dz * dz < rr * rr) block[j * w + i] = 1;
          }
        } else {
          const ex = Math.abs(s.c) * s.hx + Math.abs(s.s) * s.hz + R, ez = Math.abs(s.s) * s.hx + Math.abs(s.c) * s.hz + R;
          const i0 = Math.max(0, Math.floor((s.x - ex - nav.minX) / cell)), i1 = Math.min(w - 1, Math.floor((s.x + ex - nav.minX) / cell));
          const j0 = Math.max(0, Math.floor((s.z - ez - nav.minZ) / cell)), j1 = Math.min(h - 1, Math.floor((s.z + ez - nav.minZ) / cell));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const dx = nav.minX + (i + 0.5) * cell - s.x, dz = nav.minZ + (j + 0.5) * cell - s.z;
            const lx = dx * s.c - dz * s.s, lz = dx * s.s + dz * s.c;
            const qx = Math.max(-s.hx, Math.min(s.hx, lx)), qz = Math.max(-s.hz, Math.min(s.hz, lz));
            if ((lx - qx) * (lx - qx) + (lz - qz) * (lz - qz) < R * R) block[j * w + i] = 1;
          }
        }
      }
    };
    const nav = new V.NavGrid(col, bounds, cell, R, null, fill);
    nav.buildMs = performance.now() - t0;
    return nav;
  };

  /* ------------------------------------------------ composite navigation ------------------------------------------------ */
  W.compositeNav = function (vNav, bNav, walk) {
    const inV = (x, z) => x > walk.minX + 1 && x < walk.maxX - 1 && z > walk.minZ + 1 && z < walk.maxZ - 1;
    const GI = { x: 0, z: walk.maxZ - 4 }, GO = { x: 0, z: walk.maxZ + 6 };
    const comp = {
      // debug overlay (colliders / blocked cells) shows the village grid
      cell: vNav.cell, minX: vNav.minX, minZ: vNav.minZ, w: vNav.w, h: vNav.h, block: vNav.block, village: vNav, wild: bNav,
      cellOf: (x, z) => (inV(x, z) ? vNav : bNav).cellOf(x, z),
      free: (x, z) => (inV(x, z) ? vNav.free(x, z) : bNav.free(x, z)),
      los(ax, az, bx, bz) {
        const a = inV(ax, az), b = inV(bx, bz);
        if (a && b) return vNav.los(ax, az, bx, bz);
        if (!a && !b) return bNav.los(ax, az, bx, bz);
        const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.4);
        for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; if (!comp.free(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
        return true;
      },
      findPath(sx, sz, tx, tz) {
        const a = inV(sx, sz), b = inV(tx, tz);
        if (a && b) return vNav.findPath(sx, sz, tx, tz);
        if (!a && !b) return bNav.findPath(sx, sz, tx, tz);
        if (a) {                                   // village -> wilderness: through the south gate
          const p1 = vNav.findPath(sx, sz, GI.x, GI.z), p2 = bNav.findPath(GO.x, GO.z, tx, tz);
          return p1 && p2 ? p1.concat(p2) : null;
        }
        const p1 = bNav.findPath(sx, sz, GO.x, GO.z), p2 = vNav.findPath(GI.x, GI.z, tx, tz);
        return p1 && p2 ? p1.concat(p2) : null;
      },
    };
    return comp;
  };
})();
