/* =====================================================================================================
 *  world/terrain.js  -  chunked terrain mesh, ground shader, rivers / lakes (water), world control maps
 *
 *  Height comes from layout.js (hgrid, 2 m). The mesh is built in 64 m chunks (frustum culled) that share one index
 *  buffer. One ground material blends, in world space: the village's own hi-res splat (inside its region), the
 *  world control map (roads, river banks, mud, forest floor, 2 m / px), the biome tint + snow map, and slope /
 *  altitude driven rock + snow. Walkable ground is flat y = 0; hills, cliffs and river gorges are scenery.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const W = V.World;
  if (!W || !W.on) return;
  const { clamp, smooth } = V;
  const B = W.bounds, G = W.G, NX = W.NX, NZ = W.NZ;

  /* ------------------------------------------------ Village.Terrain replacement ------------------------------------------------ */
  W.terrainFor = function (cfg, outsideRoads) {
    W.build();
    W.buildRoadGrid(outsideRoads);
    W.computeBridges(); W.scatterCamps();                     // random open-field groups (needs the road grid + bridges)
    const wt = cfg.wallThick, H = cfg.half;
    const walk = { minX: -(H + wt + cfg.outer), maxX: H + wt + cfg.outer, minZ: -(H + wt + cfg.outer), maxZ: H + wt + cfg.south };
    return { walk, height: W.heightAt, roadDist: W.roadDist };
  };

  /* ------------------------------------------------ road distance grid ------------------------------------------------ */
  W.buildRoadGrid = function (extra) {
    if (W.roadD) return;
    const N = NX * NZ, rd = new Float32Array(N).fill(80);
    W.roadD = rd;
    W.roadLines = [];
    for (const r of W.roads) W.roadLines.push({ id: r.id, w: r.w, kind: r.kind, line: W.spline(r.pts, 4) });
    for (const pts of extra || []) W.roadLines.push({ id: 'village', w: 4.4, kind: 'dirt', line: pts.map((p) => [p[0], p[1]]) });
    const reach = 40;
    for (const R of W.roadLines) {
      for (let s = 0; s < R.line.length - 1; s++) {
        const a = R.line[s], b = R.line[s + 1];
        const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - B.minX) / G)), i1 = Math.min(NX - 1, Math.ceil((Math.max(a[0], b[0]) + reach - B.minX) / G));
        const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - B.minZ) / G)), j1 = Math.min(NZ - 1, Math.ceil((Math.max(a[1], b[1]) + reach - B.minZ) / G));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const d = W.segDist(B.minX + i * G, B.minZ + j * G, a[0], a[1], b[0], b[1]) - R.w / 2, k = j * NX + i;
          if (d < rd[k]) rd[k] = d;
        }
      }
    }
  };
  W.roadDist = (x, z) => (W.roadD ? W.bil(W.roadD, x, z) + 0 : 80);

  /* ------------------------------------------------ biome tint / ground parameters ------------------------------------------------ */
  W.BIOMES = {
    meadow:   { tint: [1.0, 1.02, 0.95], snow: 0, mud: 0, bar: 0 },
    warren:   { tint: [1.08, 1.02, 0.82], snow: 0, mud: 0.05, bar: 0.04 },
    creek:    { tint: [0.9, 1.06, 0.96], snow: 0, mud: 0, bar: 0 },
    wolfwood: { tint: [0.74, 0.92, 0.74], snow: 0, mud: 0, bar: 0 },
    hills:    { tint: [1.18, 1.06, 0.74], snow: 0, mud: 0, bar: 0.3 },
    marsh:    { tint: [0.6, 0.78, 0.58], snow: 0, mud: 0.5, bar: 0 },
    canyon:   { tint: [1.4, 0.84, 0.58], snow: 0, mud: 0, bar: 0.92 },
    shadow:   { tint: [0.52, 0.7, 0.62], snow: 0, mud: 0.05, bar: 0 },
    frost:    { tint: [1.05, 1.14, 1.3], snow: 0.82, mud: 0, bar: 0.4 },
  };
  /* biome weights at a point: soft nearest-zone blend (exp falloff on distance outside the valley floor) */
  W.biomeBlend = function (x, z, out) {
    let tr = 0, tg = 0, tb = 0, sn = 0, mud = 0, bar = 0, ws = 0;
    for (const zn of W.zones) {
      let d = 1e9;
      for (const c of zn.caps) { const dd = W.segDist(x, z, c.x1, c.z1, c.x2, c.z2) - c.r; if (dd < d) d = dd; }
      const w = Math.exp(-Math.max(0, d + 20) / 38), b = W.BIOMES[zn.biome];
      tr += b.tint[0] * w; tg += b.tint[1] * w; tb += b.tint[2] * w; sn += b.snow * w; mud += b.mud * w; bar += b.bar * w; ws += w;
    }
    out.r = tr / ws; out.g = tg / ws; out.b = tb / ws; out.snow = sn / ws; out.mud = mud / ws; out.bar = bar / ws;
    return out;
  };

  /* ------------------------------------------------ world control maps ------------------------------------------------ */
  W.buildMaps = function () {
    if (W.maps) return W.maps;
    const t0 = performance.now();
    const N = NX * NZ, wc = new Uint8Array(N * 4);
    // R road, G river / lake bank (wet gravel), B mud, A forest floor (painted by scenery.js)
    for (const R of W.roadLines) {
      const half = R.w / 2, reach = half + 3.5, foot = R.kind === 'path' ? 0.8 : 1.0;
      for (let s = 0; s < R.line.length - 1; s++) {
        const a = R.line[s], b = R.line[s + 1];
        const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - B.minX) / G)), i1 = Math.min(NX - 1, Math.ceil((Math.max(a[0], b[0]) + reach - B.minX) / G));
        const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - B.minZ) / G)), j1 = Math.min(NZ - 1, Math.ceil((Math.max(a[1], b[1]) + reach - B.minZ) / G));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = B.minX + i * G, z = B.minZ + j * G, d = W.segDist(x, z, a[0], a[1], b[0], b[1]);
          const n = (V.ntab(x, z, 0.9) - 0.5) * 1.6;
          const v = 1 - smooth(half * 0.55 * foot, half + 1.2 + n, d);
          const k = (j * NX + i) * 4, c = v * 255;
          if (c > wc[k]) wc[k] = c;
        }
      }
    }
    const bio = {};
    const BS = 8, bnx = Math.ceil((B.maxX - B.minX) / BS), bnz = Math.ceil((B.maxZ - B.minZ) / BS), bt = new Uint8Array(bnx * bnz * 4), b2 = new Uint8Array(bnx * bnz * 4);
    for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) {
      const x = B.minX + (i + 0.5) * BS, z = B.minZ + (j + 0.5) * BS;
      W.biomeBlend(x, z, bio);
      const k = (j * bnx + i) * 4;
      bt[k] = clamp(bio.r / 2, 0, 1) * 255; bt[k + 1] = clamp(bio.g / 2, 0, 1) * 255; bt[k + 2] = clamp(bio.b / 2, 0, 1) * 255; bt[k + 3] = clamp(bio.snow, 0, 1) * 255;
      b2[k] = clamp(bio.bar, 0, 1) * 255; b2[k + 3] = 255;
      // mud tendency of the biome is baked into the control map below (cheap lookup via the same cell)
      W._mudCell = W._mudCell || new Float32Array(bnx * bnz); W._mudCell[j * bnx + i] = bio.mud;
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x = B.minX + i * G, z = B.minZ + j * G;
      wc[k * 4 + 1] = clamp(W.wet[k], 0, 1) * 255;
      const mc = W._mudCell[Math.min(bnz - 1, (j * G / BS) | 0) * bnx + Math.min(bnx - 1, (i * G / BS) | 0)];
      let mud = 0;
      if (mc > 0.02 && W.sd[k] < 0) { const n = V.ntab(x + 91, z - 40, 0.55); mud = smooth(0.52 - mc * 0.35, 0.7 - mc * 0.2, n) * Math.min(1, mc * 1.8); }
      wc[k * 4 + 2] = Math.max(mud * 255 * (1 - wc[k * 4] / 255), 0);
    }
    const tex = new T.DataTexture(wc, NX, NZ, T.RGBAFormat);
    tex.minFilter = T.LinearFilter; tex.magFilter = T.LinearFilter; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.flipY = false; tex.needsUpdate = true; tex.generateMipmaps = false;
    const btex = new T.DataTexture(bt, bnx, bnz, T.RGBAFormat);
    btex.minFilter = T.LinearFilter; btex.magFilter = T.LinearFilter; btex.wrapS = btex.wrapT = T.ClampToEdgeWrapping; btex.flipY = false; btex.needsUpdate = true; btex.generateMipmaps = false;
    const b2tex = new T.DataTexture(b2, bnx, bnz, T.RGBAFormat);
    b2tex.minFilter = T.LinearFilter; b2tex.magFilter = T.LinearFilter; b2tex.wrapS = b2tex.wrapT = T.ClampToEdgeWrapping; b2tex.flipY = false; b2tex.needsUpdate = true; b2tex.generateMipmaps = false;
    W.maps = { wc, tex, btex, b2tex, ms: performance.now() - t0 };
    return W.maps;
  };
  /* forest floor painter (scenery.js): soft disc into the A channel */
  W.paintForest = function (x, z, r, a) {
    const wc = W.maps.wc, R = r + 4, i0 = Math.max(0, Math.floor((x - R - B.minX) / G)), i1 = Math.min(NX - 1, Math.ceil((x + R - B.minX) / G));
    const j0 = Math.max(0, Math.floor((z - R - B.minZ) / G)), j1 = Math.min(NZ - 1, Math.ceil((z + R - B.minZ) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(B.minX + i * G - x, B.minZ + j * G - z), v = (1 - smooth(r * 0.45, r + 3, d)) * (a === undefined ? 1 : a) * 255;
      const k = (j * NX + i) * 4 + 3; if (v > wc[k]) wc[k] = v;
    }
  };
  W.finishMaps = function () { W.maps.tex.needsUpdate = true; };

  /* ------------------------------------------------ terrain mesh ------------------------------------------------ */
  W.buildTerrain = function (X, splat, region) {
    const t0 = performance.now();
    W.buildMaps();
    const hg = W.hgrid, CELLS = 32;
    const group = new T.Group(); group.name = 'world_terrain';
    const FX = V.Forest && V.Forest.on && V.Forest.X && V.Forest.X.meadow ? V.Forest.X : null;
    const mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    mat.envMapIntensity = 0.32;
    const U = {
      uSplat: { value: splat.splat }, uAO: { value: splat.ao },
      uGrass: { value: X.grass }, uDirt: { value: X.dirt }, uCobble: { value: X.cobble }, uPave: { value: X.pave }, uMacro: { value: X.macro },
      uRegion: { value: new T.Vector4(region.minX, region.minZ, region.maxX - region.minX, region.maxZ - region.minZ) },
      uWC: { value: W.maps.tex }, uWBio: { value: W.maps.btex }, uWBio2: { value: W.maps.b2tex },
      uWB: { value: new T.Vector4(B.minX, B.minZ, NX * G, NZ * G) },
    };
    if (FX) Object.assign(U, { uMeadow: { value: FX.meadow }, uFloor: { value: FX.floor }, uRock: { value: FX.mossrock || X.macro } });
    else Object.assign(U, { uRock: { value: X.macro } });
    mat.onBeforeCompile = (sh) => {
      V.noIBL(sh);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying vec3 vWN;\nuniform sampler2D uSplat, uAO, uGrass, uDirt, uCobble, uPave, uMacro, uWC, uWBio, uWBio2, uRock; uniform vec4 uRegion; uniform vec4 uWB;' + (FX ? '\nuniform sampler2D uMeadow, uFloor;' : ''))
        .replace('#include <map_fragment>', [
          'vec2 wxz = vTW.xz;',
          'vec2 suv = (wxz - uRegion.xy) / uRegion.zw; suv.y = 1.0 - suv.y;',
          'float inR = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);',
          'vec3 sp = texture2D(uSplat, clamp(suv, 0.0, 1.0)).rgb * inR;',
          'vec4 aoS = texture2D(uAO, clamp(suv, 0.0, 1.0)); float aoT = mix(1.0, aoS.r, inR);',
          'vec2 wuv = (wxz - uWB.xy) / uWB.zw;',
          'vec4 wc = texture2D(uWC, wuv); vec4 wb = texture2D(uWBio, wuv);',
          'vec3 tint = wb.rgb * 2.0;',
          'vec3 mac = texture2D(uMacro, wxz / 140.0).rgb;',
          'vec3 nW = normalize(vWN); float slope = 1.0 - nW.y;',
          'float wC = sp.r, wD = max(sp.g, wc.r * (1.0 - inR)), wP = sp.b;',
          'float wG = max(0.0, 1.0 - wC - wD - wP);',
          // ---- base grass (meadow) + forest floor (under the crowns: world map alpha / village forest mask) ----
          FX ? [
            'vec3 gr = texture2D(uMeadow, wxz / 4.5 + mac.rg * 0.7).rgb * vec3(0.78, 0.92, 0.58);',
            'gr *= mix(vec3(0.82, 0.95, 0.92), vec3(1.1, 1.05, 0.8), smoothstep(0.3, 0.75, mac.r));',
            'gr = mix(gr, gr * vec3(1.12, 1.0, 0.7), smoothstep(0.55, 0.8, mac.b) * 0.45);',
            'float fW = clamp(max(wc.a, aoS.b * inR) * (0.7 + 0.3 * mac.b), 0.0, 1.0);',
            'if (fW > 0.01) { vec3 fl = texture2D(uFloor, wxz / 3.6 + mac.gr * 0.6).rgb * vec3(0.74, 0.96, 0.7); fl = mix(fl, fl * vec3(0.7, 1.05, 0.95), smoothstep(0.4, 0.8, mac.g)); gr = mix(gr, fl, fW); }'
          ].join('\n') : 'vec3 gr = texture2D(uGrass, wxz / 4.0 + mac.rg * 0.6).rgb;',
          'gr *= mix(vec3(1.0), tint, 1.0 - inR * 0.8);',
          'float bar = texture2D(uWBio2, wuv).r * (1.0 - inR);',
          'if (bar > 0.01) { vec3 dr = texture2D(uDirt, wxz / 3.2 + mac.gr * 0.5).rgb * mix(vec3(1.0), tint * 0.5 + 0.5, 0.95) * mix(0.8, 1.1, mac.g); gr = mix(gr, dr, clamp(bar * (0.5 + 1.0 * mac.g), 0.0, 1.0)); }',
          'vec3 gcol = gr * wG; float wsum = wG;',
          'if (wD > 0.004) { vec3 di = texture2D(uDirt, wxz / 3.0 + mac.gr * 0.5).rgb * mix(0.9, 1.06, mac.g); di *= mix(vec3(1.0), tint * 0.5 + 0.5, 1.0 - inR); float w = wD * (0.75 + dot(di, vec3(0.1667))); gcol += di * w; wsum += w; }',
          'if (wC > 0.004) { vec3 co = texture2D(uCobble, wxz / 2.2).rgb * mix(0.84, 1.06, mac.g); float w = wC * (0.55 + dot(co, vec3(0.5333))); gcol += co * w; wsum += w; }',
          'if (wP > 0.004) { vec3 pv = texture2D(uPave, wxz / 3.4).rgb * mix(0.9, 1.05, mac.b); gcol += pv * wP; wsum += wP; }',
          'gcol /= max(1e-4, wsum);',
          // ---- river / lake banks (pale wet gravel) and mud (swamp) ----
          'if (wc.g > 0.01) { vec3 gv = texture2D(uDirt, wxz / 2.4 + mac.rb * 0.4).rgb * vec3(1.18, 1.12, 1.0) + vec3(0.04); gcol = mix(gcol, gv * mix(0.62, 0.9, 1.0 - wc.g * 0.5), clamp(wc.g * 1.15, 0.0, 1.0)); }',
          'if (wc.b > 0.01) { vec3 md = texture2D(uDirt, wxz / 2.8 + mac.gb * 0.4).rgb * vec3(0.5, 0.48, 0.38); gcol = mix(gcol, md, clamp(wc.b * 1.1, 0.0, 0.9)); }',
          // ---- rock: steep faces + high ground, tinted by the biome ----
          'float rk = smoothstep(0.2, 0.46, slope + (mac.g - 0.5) * 0.16 + smoothstep(25.0, 80.0, vTW.y) * 0.14);',
          'if (rk > 0.01) {',
          '  float ax = abs(nW.x), az = abs(nW.z); vec3 rc;',
          '  vec2 uvA = vTW.zy / 7.0, uvB = vTW.xy / 7.0;',
          '  rc = mix(texture2D(uRock, uvB).rgb, texture2D(uRock, uvA).rgb, ax / max(1e-4, ax + az));',
          '  rc *= vec3(0.78, 0.76, 0.72) * mix(vec3(1.0), tint * 0.55 + 0.45, 0.8);',
          '  gcol = mix(gcol, rc, rk);',
          '}',
          // ---- snow: frost biome + the highest peaks, thinner on the steepest faces ----
          'float sn = clamp(wb.a + smoothstep(70.0, 118.0, vTW.y) * 0.85, 0.0, 1.0) * (1.0 - smoothstep(0.42, 0.78, slope) * 0.55);',
          'sn *= smoothstep(0.25, 0.55, mac.b * 0.7 + 0.45 + (wb.a - 0.5) * 0.4);',
          'if (sn > 0.01) { float lum = dot(gcol, vec3(0.3333)); vec3 snc = vec3(0.8, 0.87, 0.97) * (0.5 + 1.1 * lum) * (0.9 + 0.16 * mac.r); gcol = mix(gcol, snc, clamp(sn * 1.25, 0.0, 1.0)); }',
          'diffuseColor.rgb *= gcol * (0.6 + 0.4 * aoT);',
        ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'worldterrain' + (FX ? 'F' : '');
    W.terrainMaterial = mat;
    const idxCache = new Map();
    const indexFor = (w, h) => {
      const key = w + 'x' + h; let ix = idxCache.get(key); if (ix) return ix;
      const a = new Uint16Array(w * h * 6); let p = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = j * (w + 1) + i;
        // CCW seen from above (+y): (k, k+w+1, k+1) and (k+1, k+w+1, k+w+2)
        a[p++] = k; a[p++] = k + w + 1; a[p++] = k + 1; a[p++] = k + 1; a[p++] = k + w + 1; a[p++] = k + w + 2;
      }
      ix = new T.BufferAttribute(a, 1); idxCache.set(key, ix); return ix;
    };
    const hAt = (i, j) => hg[clamp(j, 0, NZ - 1) * NX + clamp(i, 0, NX - 1)];
    let chunks = 0;
    for (let cz = 0; cz * CELLS < NZ - 1; cz++) for (let cx = 0; cx * CELLS < NX - 1; cx++) {
      const i0 = cx * CELLS, j0 = cz * CELLS, w = Math.min(CELLS, NX - 1 - i0), h = Math.min(CELLS, NZ - 1 - j0);
      const nv = (w + 1) * (h + 1), pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
      let y0 = 1e9, y1 = -1e9, p = 0;
      for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
        const gi = i0 + i, gj = j0 + j, y = hAt(gi, gj);
        pos[p] = B.minX + gi * G; pos[p + 1] = y; pos[p + 2] = B.minZ + gj * G;
        const dx = (hAt(gi - 1, gj) - hAt(gi + 1, gj)) / (2 * G), dz = (hAt(gi, gj - 1) - hAt(gi, gj + 1)) / (2 * G), l = Math.hypot(dx, 1, dz);
        nor[p] = dx / l; nor[p + 1] = 1 / l; nor[p + 2] = dz / l;
        if (y < y0) y0 = y; if (y > y1) y1 = y; p += 3;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setIndex(indexFor(w, h));
      g.boundingBox = new T.Box3(new T.Vector3(B.minX + i0 * G, y0, B.minZ + j0 * G), new T.Vector3(B.minX + (i0 + w) * G, y1, B.minZ + (j0 + h) * G));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new T.Sphere());
      const m = new T.Mesh(g, mat);
      m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = 1; m.name = 'terrain_' + cx + '_' + cz;
      group.add(m); chunks++;
    }
    W.terrainStats = { chunks, ms: performance.now() - t0 };
    return group;
  };

  /* ------------------------------------------------ water ------------------------------------------------ */
  let waterMat = null;
  function waterMaterial() {
    if (waterMat) return waterMat;
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0.0, transparent: true, depthWrite: false, vertexColors: true, side: T.DoubleSide });
    m.envMapIntensity = 0.5;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWT = V.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aW; varying vec3 vW; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vW = aW; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', [
        '#include <common>', 'uniform float uWT; varying vec3 vW; varying vec3 vWP;',
        'float whash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'float wnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), f.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), f.x), f.y); }',
      ].join('\n'))
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          'float wSpd = vW.z;',
          'vec2 wQ = vWP.xz * 0.35;',
          'float wR1 = wnoise(wQ * 2.3 + vec2(uWT * 0.35 * (0.3 + wSpd), uWT * 0.2));',
          'float wR2 = wnoise(wQ * 4.7 - vec2(uWT * 0.5 * (0.3 + wSpd), -uWT * 0.3));',
          'float wRip = wR1 * 0.6 + wR2 * 0.4;',
          'diffuseColor.rgb *= 0.78 + 0.5 * wRip;',
          'float wShore = smoothstep(0.55, 1.0, vW.y);',
          'float wFoam = smoothstep(0.62, 0.92, vW.y + (wRip - 0.5) * 0.5) * (wSpd > 0.0 ? 1.0 : 0.35);',
          'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.95), wFoam * 0.45);',
          'diffuseColor.a *= mix(vW.x, 0.25, wShore);',
        ].join('\n'))
        .replace('#include <normal_fragment_maps>', [
          '#include <normal_fragment_maps>',
          'normal = normalize(normal + vec3((wR1 - 0.5) * 0.22, (wR2 - 0.5) * 0.22, 0.0));',
        ].join('\n'));
    };
    m.customProgramCacheKey = () => 'worldwater';
    waterMat = m; return m;
  }
  const WCOL = { lake: [0.2, 0.42, 0.46], river: [0.22, 0.46, 0.5], pond: [0.22, 0.38, 0.3], swamp: [0.2, 0.28, 0.18], ice: [0.72, 0.84, 0.9] };
  W.buildWater = function () {
    const group = new T.Group(); group.name = 'world_water';
    const mat = waterMaterial();
    const WY = W.WATER_Y;
    const mesh = (pos, col, aw, idx, name) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.setAttribute('aW', new T.Float32BufferAttribute(aw, 3));
      g.setIndex(idx);
      const n = new Float32Array(pos.length / 3 * 3); for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
      g.setAttribute('normal', new T.BufferAttribute(n, 3));
      g.computeBoundingSphere();
      const m = new T.Mesh(g, mat); m.renderOrder = 3; m.name = name; m.receiveShadow = false; m.castShadow = false; m.matrixAutoUpdate = false;
      group.add(m); return m;
    };
    // river ribbons (split into pieces so frustum culling works)
    for (const r of W.rivers) {
      const half = r.hw + W.RIVER_BANK * 0.55 + 0.8, c = WCOL.river, L = r.line;
      const piece = 40;
      for (let s0 = 0; s0 < L.length - 1; s0 += piece) {
        const s1 = Math.min(L.length - 1, s0 + piece), pos = [], col = [], aw = [], idx = [];
        for (let s = s0; s <= s1; s++) {
          const a = L[Math.max(0, s - 1)], b = L[Math.min(L.length - 1, s + 1)];
          let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const nx = -tz, nz = tx, p = L[s];
          for (const sg of [-1, 0, 1]) {
            pos.push(p[0] + nx * half * sg, WY, p[1] + nz * half * sg);
            col.push(c[0], c[1], c[2]);
            aw.push(0.82, Math.abs(sg), 1.0);
          }
          if (s < s1) { const k = (s - s0) * 3; idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); }
        }
        mesh(pos, col, aw, idx, 'river_' + r.id + '_' + s0);
      }
    }
    // lakes: concentric rings
    for (const L of W.lakes) {
      const c = WCOL[L.kind] || WCOL.lake, rings = 7, seg = 56, pos = [], col = [], aw = [], idx = [];
      const cs = Math.cos(L.rot), sn = Math.sin(L.rot), m = Math.min(L.rx, L.rz);
      const grow = 3.2 / m;                                            // water edge sits under the wet margin
      const y = L.kind === 'ice' ? -0.2 : L.kind === 'swamp' ? -0.45 : WY;
      pos.push(L.x, y, L.z); col.push(c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); aw.push(L.kind === 'ice' ? 0.98 : 0.9, 0, 0.0);
      for (let r = 1; r <= rings; r++) {
        const f = (r / rings) * (1 + grow);
        for (let k = 0; k < seg; k++) {
          const a = k / seg * Math.PI * 2, lx = Math.cos(a) * L.rx * f, lz = Math.sin(a) * L.rz * f;
          pos.push(L.x + lx * cs - lz * sn, y, L.z + lx * sn + lz * cs);
          const e = Math.max(0, (r / rings - 0.6) / 0.4 * 1.0 + (r === rings ? 0.2 : 0));
          const dk = r < rings - 1 ? 0.92 : 1.0;
          col.push(c[0] * dk, c[1] * dk, c[2] * dk); aw.push(L.kind === 'ice' ? 0.98 : 0.88, Math.min(1, e), L.kind === 'ice' ? 0 : L.kind === 'swamp' ? 0.0 : 0.12);
        }
      }
      for (let k = 0; k < seg; k++) idx.push(0, 1 + (k + 1) % seg, 1 + k);
      for (let r = 1; r < rings; r++) for (let k = 0; k < seg; k++) {
        const a = 1 + (r - 1) * seg + k, b = 1 + (r - 1) * seg + (k + 1) % seg, c2 = 1 + r * seg + k, d = 1 + r * seg + (k + 1) % seg;
        idx.push(a, b, c2, b, d, c2);
      }
      mesh(pos, col, aw, idx, 'lake_' + L.id);
    }
    return group;
  };
})();

/* ------------------------------------------------ distance culling ------------------------------------------------ */
/* The fog hides everything past ~175 m, so meshes farther than CULL_DIST never reach the GPU. Covers terrain chunks,
   water ribbons, static chunks (vb_*) and the main-layer instanced chunks (vi_*); the village's own LOD keeps handling the
   'detail' layer. W.cullOff(true) shows everything (minimap capture). */
(function () {
  'use strict';
  const T = THREE, V = window.Village, W = V && V.World;
  if (!W || !W.on) return;
  const CULL_DIST = 235, CULL_TERRAIN = 470;     // terrain stays longer: its far edge would show the sky dome's dark underside
  let list = [], t = 0, off = false;
  W.registerCull = function (group) {
    list = [];
    group.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.userData.layer === 'detail') return;
      const n = o.name || '';
      if (!(n.startsWith('terrain_') || n.startsWith('river_') || n.startsWith('lake_') || n.startsWith('vb_') || n.startsWith('vi_'))) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      list.push({ m: o, x: bs.center.x, z: bs.center.z, r: bs.radius, d: n.startsWith('terrain_') || n.startsWith('river_') || n.startsWith('lake_') ? CULL_TERRAIN : CULL_DIST });
    });
    W.cullCount = list.length;
  };
  W.cull = function (p, dt) {
    if (off || !p) return;
    t -= dt || 0.016; if (t > 0) return; t = 0.2;
    for (const e of list) { const dx = e.x - p.x, dz = e.z - p.z; e.m.visible = Math.hypot(dx, dz) - e.r < e.d; }
  };
  W.cullOff = function (on) { off = !!on; if (off) for (const e of list) e.m.visible = true; else t = 0; };
})();
