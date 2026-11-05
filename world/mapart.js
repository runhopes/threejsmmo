/* =====================================================================================================
 *  world/mapart.js  -  the world map / minimap as a hand-drawn SKETCH (kroki), painted from the world data
 *
 *  W.paintMap(x0, x1, z0, z1, px, py) -> canvas   (north = -z up, like the old 3D capture)
 *
 *  No 3D capture any more (that showed every tree as a green blob). The sketch reads the same fields the game uses:
 *  floor mask (sd), heights (hillshade + contour lines), river / lake / sea distance, wetness (sand banks), road distance,
 *  the forest-floor map painted by scenery.js (forests = darker, dappled green), bridges, the village walls.
 *  Palette: warm parchment greens, teal water, tan roads, ink outlines on cliffs and shores.
 * ===================================================================================================== */
(function () {
  'use strict';
  const V = window.Village, W = V && V.World;
  if (!W || !W.on) return;
  const { clamp, smooth } = V;
  const PAL = {                                   // biome -> [r, g, b] of open ground (forest tint is derived)
    meadow: [176, 202, 104], warren: [192, 198, 112], creek: [150, 190, 106], wolfwood: [118, 164, 94],
    hills: [190, 190, 110], marsh: [136, 152, 96], shadow: [94, 140, 96],
  };
  const FOREST = { meadow: [88, 142, 78], warren: [96, 146, 80], creek: [76, 134, 78], wolfwood: [58, 112, 70], hills: [84, 134, 76], marsh: [78, 112, 70], shadow: [44, 90, 66] };
  const INK = [52, 46, 38], SAND = [228, 212, 156], ROAD = [226, 202, 144], ROAD_EDGE = [132, 100, 62], WATER = [96, 164, 200], SEA = [80, 152, 196], ROCK = [170, 160, 142], STONE = [196, 188, 170];
  let biomeIdx = null, biomeNames = null;

  function zoneIndexGrid() {                      // 8 m grid of zone indexes
    if (biomeIdx) return biomeIdx;
    const B = W.bounds, S = 8, nx = Math.ceil((B.maxX - B.minX) / S), nz = Math.ceil((B.maxZ - B.minZ) / S), g = new Int8Array(nx * nz);
    biomeNames = W.zones.map((z) => z.biome);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const zn = W.zoneAt(B.minX + (i + 0.5) * S, B.minZ + (j + 0.5) * S); g[j * nx + i] = zn ? W.zones.indexOf(zn) : 0; }
    // smooth the zone borders: colour grids blurred over a 5x5 window, then bilinear in the painter
    const base = new Float32Array(nx * nz * 6);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let a0 = 0, a1 = 0, a2 = 0, f0 = 0, f1 = 0, f2 = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = Math.min(nx - 1, Math.max(0, i + di)), jj = Math.min(nz - 1, Math.max(0, j + dj)), bn = biomeNames[g[jj * nx + ii]], pa = PAL[bn] || PAL.meadow, pf = FOREST[bn] || FOREST.meadow;
        a0 += pa[0]; a1 += pa[1]; a2 += pa[2]; f0 += pf[0]; f1 += pf[1]; f2 += pf[2]; n++;
      }
      const k = (j * nx + i) * 6; base[k] = a0 / n; base[k + 1] = a1 / n; base[k + 2] = a2 / n; base[k + 3] = f0 / n; base[k + 4] = f1 / n; base[k + 5] = f2 / n;
    }
    biomeIdx = { g, nx, nz, S, base };
    return biomeIdx;
  }
  const mix = (a, b, t) => a + (b - a) * t;

  W.paintMap = function (x0, x1, z0, z1, px, py) {
    W.build(); if (W.buildMaps) W.buildMaps();
    const Z = zoneIndexGrid(), B = W.bounds, G = W.G, NX = W.NX, bil = W.bil;
    const cv = document.createElement('canvas'); cv.width = px; cv.height = py;
    const g = cv.getContext('2d'), img = g.createImageData(px, py), d = img.data;
    const mx = (x1 - x0) / px, mz = (z1 - z0) / py, mpp = Math.max(mx, mz);        // metres per pixel
    const wc = W.maps ? W.maps.wc : null, roadD = W.roadD, wet = W.wet, sd = W.sd, hg = W.hgrid, rivD = W.riverD, lakD = W.lakeD;
    const vb = W.village, wallH = (V.CONFIG ? V.CONFIG.half : 75) + (V.CONFIG ? V.CONFIG.wallThick : 3.2) / 2;
    const bridges = W.bridges || [];
    const bl = (((window.__village || window.__world || {}).buildings) || []).filter((q) => q.info && q.info.w).map((q) => ({ x: q.x, z: q.z, c: Math.cos(q.ry || 0), s: Math.sin(q.ry || 0), hw: q.info.w / 2, hd: q.info.d / 2, k: V.hash2 ? V.hash2(q.x | 0, q.z | 0, 5) : 0.5 }));
    const forestAt = (x, z) => {                   // bilinear A channel of the world control map (forest floor under the crowns)
      if (!wc) return 0;
      let fx = (x - B.minX) / G, fz = (z - B.minZ) / G;
      fx = clamp(fx, 0, NX - 1.001); fz = clamp(fz, 0, W.NZ - 1.001);
      const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = (iz * NX + ix) * 4 + 3;
      const a = wc[k], b = wc[k + 4], c = wc[k + NX * 4], e = wc[k + NX * 4 + 4];
      return (a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz) / 255;
    };
    const mudAt = (x, z) => { if (!wc) return 0; const i = clamp(Math.round((x - B.minX) / G), 0, NX - 1), j = clamp(Math.round((z - B.minZ) / G), 0, W.NZ - 1); return wc[(j * NX + i) * 4 + 2] / 255; };
    const e = Math.max(G * 0.8, mpp * 0.8);
    for (let j = 0; j < py; j++) {
      const z = z0 + (j + 0.5) * mz;
      for (let i = 0; i < px; i++) {
        const x = x0 + (i + 0.5) * mx, o = (j * px + i) * 4;
        const s = bil(sd, x, z), h = bil(hg, x, z);
        const hE = bil(hg, x + e, z), hW = bil(hg, x - e, z), hS = bil(hg, x, z + e), hN = bil(hg, x, z - e);
        const gx = (hE - hW) / (2 * e), gz = (hS - hN) / (2 * e), gm = Math.hypot(gx, gz);
        // hillshade: light from the north-west
        const nl = 1 / Math.sqrt(gx * gx + 1 + gz * gz), lam = (-gx * -0.55 + 0.75 + -gz * -0.38) * nl;
        let shade = clamp(0.8 + (lam - 0.78) * 1.05, 0.55, 1.25);
        const rv = bil(rivD, x, z), lk = bil(lakD, x, z), water = Math.min(rv, lk);
        const zi = Z.g[clamp(Math.floor((z - B.minZ) / Z.S), 0, Z.nz - 1) * Z.nx + clamp(Math.floor((x - B.minX) / Z.S), 0, Z.nx - 1)], bio = biomeNames[zi];
        const noise = V.ntab ? V.ntab(x, z, 0.35) - 0.5 : 0;
        let r, gg, b;
        if (water < 0) {                           // water: deeper toward the middle, paler at the shore
          const base = lk < 0 && lk <= rv ? SEA : WATER, dep = smooth(0, -Math.min(14, Math.max(4, mpp * 4)), water);
          const wob = 0.96 + (V.ntab ? V.ntab(x * 1.3, z * 1.3, 0.05) - 0.5 : 0) * 0.14;
          r = base[0] * mix(1.08, 0.82, dep) * wob; gg = base[1] * mix(1.06, 0.86, dep) * wob; b = base[2] * mix(1.04, 0.9, dep) * wob;
          const shore = 1 - smooth(0, Math.max(0.9, mpp * 1.1), -water); r = mix(r, INK[0], shore * 0.5); gg = mix(gg, INK[1] + 24, shore * 0.5); b = mix(b, INK[2] + 40, shore * 0.5);
        } else if (s > 0.02 && water >= 7) {    // mountains / rock mounds: grey-brown, strongly hillshaded, lighter up high
          const hh = clamp(h / 70, 0, 1), sh = clamp(0.88 + (lam - 0.75) * 1.1, 0.64, 1.18);
          r = mix(ROCK[0], 206, hh * 0.6) * sh; gg = mix(ROCK[1], 200, hh * 0.6) * sh; b = mix(ROCK[2], 190, hh * 0.6) * sh;
          // forested lower slopes
          const fs = (1 - smooth(4, 34, s)) * 0.55 * (1 - smooth(18, 46, h));
          if (fs > 0.01) { const f = FOREST[bio] || FOREST.meadow; r = mix(r, f[0] * sh, fs); gg = mix(gg, f[1] * sh, fs); b = mix(b, f[2] * sh, fs); }
          const edge = 1 - smooth(0, Math.max(1.3, mpp * 1.5), s);          // ink cliff line where the walkable floor ends
          r = mix(r, INK[0], edge * 0.7); gg = mix(gg, INK[1], edge * 0.7); b = mix(b, INK[2], edge * 0.7);
        } else {                                   // walkable floor
          let bx = (x - B.minX) / Z.S - 0.5, bz = (z - B.minZ) / Z.S - 0.5; bx = clamp(bx, 0, Z.nx - 1.001); bz = clamp(bz, 0, Z.nz - 1.001);
          const bi = bx | 0, bj = bz | 0, ux = bx - bi, uz = bz - bj, k0 = (bj * Z.nx + bi) * 6, k1 = k0 + 6, k2 = k0 + Z.nx * 6, k3 = k2 + 6, BS = Z.base, bc = [0, 0, 0, 0, 0, 0];
          for (let q = 0; q < 6; q++) bc[q] = (BS[k0 + q] * (1 - ux) + BS[k1 + q] * ux) * (1 - uz) + (BS[k2 + q] * (1 - ux) + BS[k3 + q] * ux) * uz;
          const base = [bc[0], bc[1], bc[2]], fo = [bc[3], bc[4], bc[5]], fr = smooth(0.12, 0.8, forestAt(x, z)) * 0.88;
          r = mix(base[0], fo[0], fr); gg = mix(base[1], fo[1], fr); b = mix(base[2], fo[2], fr);
          const dap = 1 + noise * (0.16 + 0.22 * fr);                         // painted dapple: open ground = soft patches, forest = leafy blotches
          r *= dap; gg *= dap; b *= dap;
          const mud = mudAt(x, z); if (mud > 0.02) { r = mix(r, 112, mud * 0.7); gg = mix(gg, 96, mud * 0.7); b = mix(b, 66, mud * 0.7); }
          // hills: lit / shaded sides + lighter tops
          const sh2 = 1 + (shade - 0.8) * 1.5; r *= sh2; gg *= sh2; b *= sh2;
          const hl = smooth(4, 16, h) * 0.18; r += hl * 40; gg += hl * 34; b += hl * 10;
          // contour lines every 3.5 m (a surveyor's sketch), only where the ground really rises
          if (h > 0.9 && gm > 0.02) { const c = Math.abs(h - Math.round(h / 3.5) * 3.5) / Math.max(gm, 0.02); if (c < Math.max(0.5, mpp * 0.5)) { const k = 0.16 * (1 - c / Math.max(0.5, mpp * 0.5)); r = mix(r, INK[0] + 40, k); gg = mix(gg, INK[1] + 30, k); b = mix(b, INK[2] + 16, k); } }
          // sandy banks / beach
          const wt = bil(wet, x, z); if (wt > 0.28) { const k = smooth(0.28, 0.8, wt) * 0.9; r = mix(r, SAND[0], k); gg = mix(gg, SAND[1], k); b = mix(b, SAND[2], k); }
          // river / sea shore ink
          if (water < Math.max(1.4, mpp * 1.6)) { const k = (1 - smooth(0, Math.max(1.4, mpp * 1.6), water)) * 0.45; r = mix(r, INK[0], k); gg = mix(gg, INK[1], k); b = mix(b, INK[2], k); }
        }
        // village: walls + stone ground
        if (x > vb.minX && x < vb.maxX && z > vb.minZ && z < vb.maxZ) {
          const ax = Math.abs(x), az = Math.abs(z), inside = ax < wallH && az < wallH;
          if (inside) { r = STONE[0] * (0.92 + noise * 0.1); gg = STONE[1] * (0.92 + noise * 0.1); b = STONE[2] * (0.92 + noise * 0.1); }
          const wd = Math.abs(Math.max(ax, az) - wallH), gate = z > 0 && ax < 5.5 && az >= ax;
          if (!gate && wd < Math.max(2.4, mpp * 1.6)) { const k = 1 - smooth(0, Math.max(2.4, mpp * 1.6), wd); r = mix(r, INK[0] + 30, k * 0.9); gg = mix(gg, INK[1] + 26, k * 0.9); b = mix(b, INK[2] + 22, k * 0.9); }
        }
        if (x > vb.minX && x < vb.maxX && z > vb.minZ && z < vb.maxZ) {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {      // corner towers
            const td = Math.hypot(x - sx * wallH, z - sz * wallH);
            if (td < 6.5) { const k = td > 6.5 - Math.max(1.1, mpp * 1.0); r = k ? INK[0] + 30 : 150; gg = k ? INK[1] + 26 : 142; b = k ? INK[2] + 22 : 126; }
          }
          for (let q = 0; q < bl.length; q++) {                   // buildings: terracotta roofs with an ink outline
            const bb = bl[q], ox = x - bb.x, oz = z - bb.z;
            if (ox > 30 || ox < -30 || oz > 30 || oz < -30) continue;
            const lx = ox * bb.c - oz * bb.s, lz = ox * bb.s + oz * bb.c;
            if (Math.abs(lx) < bb.hw && Math.abs(lz) < bb.hd) {
              const edge = Math.abs(lx) > bb.hw - Math.max(0.55, mpp * 0.55) || Math.abs(lz) > bb.hd - Math.max(0.55, mpp * 0.55), ridge = Math.abs(lx) < Math.max(0.3, mpp * 0.35);
              const t = 0.9 + bb.k * 0.22;
              r = edge ? INK[0] + 20 : (ridge ? 150 : 190) * t; gg = edge ? INK[1] + 16 : (ridge ? 96 : 124) * t; b = edge ? INK[2] + 10 : (ridge ? 70 : 96) * t;
            }
          }
        }
        // roads: tan ribbon with a dark edge (kept at least ~2 px wide so they stay readable on the world map)
        if (roadD) {
          const rd = bil(roadD, x, z) - mpp * 0.55;
          if (rd < 0.6 && water >= 0) {
            const ink = smooth(-0.1, 0.6, rd) * (1 - smooth(0.6, 1.6, rd)) * 0 + (1 - smooth(-Math.max(0.5, mpp * 0.5), 0.1, rd));
            const body = 1 - smooth(-0.7, 0.2, rd), edgeK = (1 - smooth(0, Math.max(0.5, mpp * 0.7), Math.abs(rd + 0.2))) * 0.55;
            r = mix(r, ROAD[0], body * 0.95); gg = mix(gg, ROAD[1], body * 0.95); b = mix(b, ROAD[2], body * 0.95);
            r = mix(r, ROAD_EDGE[0], edgeK); gg = mix(gg, ROAD_EDGE[1], edgeK); b = mix(b, ROAD_EDGE[2], edgeK);
            if (ink < -1) r = 0;
          }
        }
        // bridges: wooden deck rectangles
        for (let q = 0; q < bridges.length; q++) {
          const br = bridges[q], ox = x - br.x, oz = z - br.z;
          if (ox > 40 || ox < -40 || oz > 40 || oz < -40) continue;
          const along = ox * br.dx + oz * br.dz, across = -ox * br.dz + oz * br.dx;
          const hl2 = br.L / 2 + 1, hw = Math.max(br.W / 2, mpp * 0.9);
          if (Math.abs(along) < hl2 && Math.abs(across) < hw) {
            const edge = Math.abs(across) > hw - Math.max(0.5, mpp * 0.45) || Math.abs(along) > hl2 - Math.max(0.5, mpp * 0.45);
            r = edge ? INK[0] + 40 : 168; gg = edge ? INK[1] + 24 : 124; b = edge ? INK[2] + 6 : 80;
          }
        }
        // paper grain
        const gr = (V.hash2 ? V.hash2(i, j, 17) - 0.5 : 0) * 7;
        d[o] = clamp(r + gr, 0, 255); d[o + 1] = clamp(gg + gr, 0, 255); d[o + 2] = clamp(b + gr, 0, 255); d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  };
})();
