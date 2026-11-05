/* =====================================================================================================
 *  village/terrain.js  -  TerrainBuilder, RoadBuilder (splat painter), PlazaBuilder
 *
 *  - The walkable area (inside the walls + a band around them + the southern meadow) is exactly y = 0.
 *    Hills rise only beyond the walkable boundary; road corridors are carved into valleys so the roads
 *    visibly continue toward future hunting grounds.
 *  - Ground look = one terrain material that mixes grass / packed earth / cobbles / flagstones in world space
 *    from a painted splat map (roads, yards, wear) plus a soft contact-shadow map around buildings.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const { fbm, smooth, clamp } = V;

  /* -------------------------------------------- noise table (fast lookups) -------------------------------------------- */
  const NT = 256, NTAB = new Float32Array(NT * NT), NTAB2 = new Float32Array(NT * NT);
  for (let y = 0; y < NT; y++) for (let x = 0; x < NT; x++) { NTAB[y * NT + x] = fbm(x / 32, y / 32, 4, 8, 701); NTAB2[y * NT + x] = fbm(x / 8, y / 8, 3, 32, 703); }
  function ntab(tab, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    const a = tab[y0 * NT + x0], b = tab[y0 * NT + x1], c = tab[y1 * NT + x0], d = tab[y1 * NT + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  V.ntab = (x, z, s) => ntab(NTAB, x * s, z * s);

  /* -------------------------------------------- Splat painter (RoadBuilder) -------------------------------------------- */
  class Splat {
    constructor(region, mpp, aoMpp) {
      this.reg = region; this.mpp = mpp;
      this.W = Math.ceil((region.maxX - region.minX) / mpp); this.H = Math.ceil((region.maxZ - region.minZ) / mpp);
      this.ch = {};
      for (const k of ['cob', 'dirt', 'pave', 'wear']) {
        const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
        const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H);
        this.ch[k] = { c, g };
      }
      this.aoMpp = aoMpp;
      const ac = document.createElement('canvas'); ac.width = Math.ceil((region.maxX - region.minX) / aoMpp); ac.height = Math.ceil((region.maxZ - region.minZ) / aoMpp);
      const ag = ac.getContext('2d'); ag.fillStyle = '#fff'; ag.fillRect(0, 0, ac.width, ac.height);
      this.ao = { c: ac, g: ag };
      // forest floor mask (forest.js paints it under the giant crowns), same grid as the AO map, packed into its blue channel
      const fc = document.createElement("canvas"); fc.width = ac.width; fc.height = ac.height;
      const fg = fc.getContext("2d"); fg.fillStyle = "#000"; fg.fillRect(0, 0, fc.width, fc.height);
      this.forest = { c: fc, g: fg };
      this.roads = [];
    }
    _ctx(ch) { return ch === 'ao' ? this.ao : ch === 'forest' ? this.forest : this.ch[ch]; }
    _s(ch) { return ch === 'ao' || ch === 'forest' ? this.aoMpp : this.mpp; }
    _px(ch, x, z) { const s = this._s(ch); return [(x - this.reg.minX) / s, (z - this.reg.minZ) / s]; }
    _style(g, ch, o) {
      const s = this._s(ch);
      g.filter = o.blur ? 'blur(' + (o.blur / s).toFixed(2) + 'px)' : 'none';
      const a = o.alpha === undefined ? 1 : o.alpha;
      const v = ch === 'ao' ? Math.round(255 * (1 - (o.dark || 0.5))) : 255;
      g.fillStyle = g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + a + ')';
    }
    line(ch, pts, width, o) {
      o = o || {}; const { g } = this._ctx(ch); this._style(g, ch, o);
      g.lineWidth = width / this._s(ch); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); pts.forEach((p, i) => { const q = this._px(ch, p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke();
      g.filter = 'none';
    }
    rect(ch, cx, cz, w, d, rot, o) {
      o = o || {}; const { g } = this._ctx(ch); this._style(g, ch, o);
      const s = this._s(ch), q = this._px(ch, cx, cz);
      g.save(); g.translate(q[0], q[1]); g.rotate(-(rot || 0));
      if (o.round) { const r = o.round / s, W = w / s, D = d / s; g.beginPath(); g.moveTo(-W / 2 + r, -D / 2); g.arcTo(W / 2, -D / 2, W / 2, D / 2, r); g.arcTo(W / 2, D / 2, -W / 2, D / 2, r); g.arcTo(-W / 2, D / 2, -W / 2, -D / 2, r); g.arcTo(-W / 2, -D / 2, W / 2, -D / 2, r); g.fill(); }
      else g.fillRect(-w / 2 / s, -d / 2 / s, w / s, d / s);
      g.restore(); g.filter = 'none';
    }
    circle(ch, x, z, r, o) {
      o = o || {}; const { g } = this._ctx(ch); this._style(g, ch, o);
      const q = this._px(ch, x, z); g.beginPath(); g.arc(q[0], q[1], r / this._s(ch), 0, Math.PI * 2); g.fill(); g.filter = 'none';
    }
    poly(ch, pts, o) {
      o = o || {}; const { g } = this._ctx(ch); this._style(g, ch, o);
      g.beginPath(); pts.forEach((p, i) => { const q = this._px(ch, p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); g.filter = 'none';
    }
    /* a road: cobble or dirt core + worn earth verges + wear down the middle */
    road(pts, width, kind) {
      this.roads.push({ pts, width, kind });
      if (kind === 'cobble') {
        this.line('dirt', pts, width + 2.6, { blur: 1.2, alpha: 0.85 });
        this.line('cob', pts, width, { blur: 0.35 });
        this.line('wear', pts, width * 0.35, { blur: 1.2, alpha: 0.5 });
      } else if (kind === 'dirt') {
        this.line('dirt', pts, width + 1.4, { blur: 0.9, alpha: 0.75 });
        this.line('dirt', pts, width, { blur: 0.4 });
      } else {   // footpath
        this.line('dirt', pts, width, { blur: 0.6, alpha: 0.9 });
      }
    }
    finalize() {
      const W = this.W, H = this.H, mpp = this.mpp, reg = this.reg;
      const get = (k) => this.ch[k].g.getImageData(0, 0, W, H).data;
      const C = get('cob'), D = get('dirt'), P = get('pave'), R = get('wear');
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const og = out.getContext('2d'), img = og.createImageData(W, H), d = img.data;
      for (let y = 0; y < H; y++) {
        const wz = reg.minZ + y * mpp;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, wx = reg.minX + x * mpp;
          const n1 = ntab(NTAB, wx * 0.35, wz * 0.35), n2 = ntab(NTAB2, wx * 0.6, wz * 0.6);
          const c = C[i] / 255, dd = D[i] / 255, p = P[i] / 255, wr = R[i] / 255;
          const wP = smooth(0.4, 0.6, p + (n2 - 0.5) * 0.12);
          let wC = smooth(0.4, 0.62, c + (n1 - 0.5) * 0.42 - wr * 0.15 * n2);
          let wD = smooth(0.22, 0.7, dd + (n2 - 0.5) * 0.55) * (0.7 + 0.3 * n1);
          wC *= 1 - wP;
          wD = Math.min(wD, 1 - wP - wC) + wC * wr * 0.35 * smooth(0.4, 0.7, n2);   // worn middle of busy roads shows earth between setts
          d[i] = clamp(wC, 0, 1) * 255; d[i + 1] = clamp(wD, 0, 1) * 255; d[i + 2] = wP * 255; d[i + 3] = 255;
        }
      }
      og.putImageData(img, 0, 0);
      const t = new T.CanvasTexture(out); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = V.maxAniso || 4;
      {   // forest mask -> AO blue channel
        const w = this.ao.c.width, h = this.ao.c.height, ai = this.ao.g.getImageData(0, 0, w, h), fd = this.forest.g.getImageData(0, 0, w, h).data;
        for (let i = 0; i < w * h; i++) ai.data[i * 4 + 2] = fd[i * 4];
        this.ao.g.putImageData(ai, 0, 0); this.forest.c.width = 1;
      }
      const ta = new T.CanvasTexture(this.ao.c); ta.wrapS = ta.wrapT = T.ClampToEdgeWrapping;
      this.splatTex = t; this.aoTex = ta;
      for (const k in this.ch) { this.ch[k].c.width = 1; }   // free the channel canvases
      return { splat: t, ao: ta };
    }
  }
  V.Splat = Splat;

  /* -------------------------------------------- terrain -------------------------------------------- */
  V.Terrain = function (cfg, outsideRoads) {
    if (V.World && V.World.on && V.World.terrainFor) return V.World.terrainFor(cfg, outsideRoads);   // world/terrain.js: the open world around the village
    const H = cfg.half, wt = cfg.wallThick;
    const walk = { minX: -(H + wt + cfg.outer), maxX: H + wt + cfg.outer, minZ: -(H + wt + cfg.outer), maxZ: H + wt + cfg.south };
    const segDist = (px, pz, a, b) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = L2 ? clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / L2, 0, 1) : 0;
      return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
    };
    const roadDist = (x, z) => {
      let d = 1e9;
      for (const r of outsideRoads) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDist(x, z, r[i], r[i + 1]));
      return d;
    };
    function height(x, z) {
      const ox = Math.max(walk.minX - x, 0, x - walk.maxX), oz = Math.max(walk.minZ - z, 0, z - walk.maxZ);
      const out = Math.hypot(ox, oz);
      if (out <= 1.5) return 0;
      const rise = smooth(1.5, 46, out);
      let h = fbm(x / 95 + 3.1, z / 95 - 1.7, 4, 0, 711) * 34 - 6 + fbm(x / 23, z / 23, 3, 0, 713) * 5;
      h = Math.max(h, 1.5 + fbm(x / 40, z / 40, 2, 0, 715) * 3);
      const rd = roadDist(x, z), valley = 1 - smooth(5, 26, rd);
      return rise * h * (1 - 0.9 * valley) + valley * rise * 0.6;
    }
    return { walk, height, roadDist };
  };

  V.buildTerrainMesh = function (terrain, X, splat, region) {
    const SX = 900, SZ = 980, cx = 0, cz = 40;
    const g = new T.PlaneGeometry(SX, SZ, 225, 245);
    g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, terrain.height(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    mat.envMapIntensity = 0.32;
    const U = {
      uSplat: { value: splat.splat }, uAO: { value: splat.ao },
      uGrass: { value: X.grass }, uDirt: { value: X.dirt }, uCobble: { value: X.cobble }, uPave: { value: X.pave }, uMacro: { value: X.macro },
      uRegion: { value: new T.Vector4(region.minX, region.minZ, region.maxX - region.minX, region.maxZ - region.minZ) },
    };
    // forest.js: Poly Haven meadow + forest floor (painterly) replace the procedural grass outside / under the giants
    const FX = V.Forest && V.Forest.on && V.Forest.X && V.Forest.X.meadow ? V.Forest.X : null;
    if (FX) Object.assign(U, { uMeadow: { value: FX.meadow }, uFloor: { value: FX.floor } });
    mat.onBeforeCompile = (sh) => {
      V.noIBL(sh);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nuniform sampler2D uSplat, uAO, uGrass, uDirt, uCobble, uPave, uMacro; uniform vec4 uRegion;' + (FX ? '\nuniform sampler2D uMeadow, uFloor;' : ''))
        .replace('#include <map_fragment>', [
          'vec2 wxz = vTW.xz;',
          'vec2 suv = (wxz - uRegion.xy) / uRegion.zw; suv.y = 1.0 - suv.y;',
          'float inR = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);',
          'vec3 sp = texture2D(uSplat, clamp(suv, 0.0, 1.0)).rgb * inR;',
          'vec4 aoS = texture2D(uAO, clamp(suv, 0.0, 1.0)); float aoT = mix(1.0, aoS.r, inR);',
          // one macro fetch drives large-scale tint and de-tiling; layers are only sampled where they have weight
          'vec3 mac = texture2D(uMacro, wxz / 140.0).rgb;',
          'float wC = sp.r, wD = sp.g, wP = sp.b, wG = max(0.0, 1.0 - wC - wD - wP);',
          'vec3 gcol = vec3(0.0); float wsum = 0.0;',
          FX ? [   // forest.js: Poly Haven meadow (cool / warm / dry golden patches) + forest floor under the crowns
            'if (wG > 0.004) { vec3 gr = texture2D(uMeadow, wxz / 4.5 + mac.rg * 0.7).rgb * vec3(0.78, 0.92, 0.58);',
            '  gr *= mix(vec3(0.82, 0.95, 0.92), vec3(1.1, 1.05, 0.8), smoothstep(0.3, 0.75, mac.r));',
            '  gr = mix(gr, gr * vec3(1.12, 1.0, 0.7), smoothstep(0.55, 0.8, mac.b) * 0.45);',
            // forest floor: painted under the crowns (AO blue), and everywhere on the hills beyond the region
            '  float fW = clamp(mix(smoothstep(0.6, 4.0, vTW.y), aoS.b, inR) * (0.7 + 0.3 * mac.b), 0.0, 1.0);',
            '  if (fW > 0.01) { vec3 fl = texture2D(uFloor, wxz / 3.6 + mac.gr * 0.6).rgb * vec3(0.74, 0.96, 0.7);',
            '    fl = mix(fl, fl * vec3(0.7, 1.05, 0.95), smoothstep(0.4, 0.8, mac.g)); gr = mix(gr, fl, fW); }'].join('\n') : [
            'if (wG > 0.004) { vec3 gr = texture2D(uGrass, wxz / 4.0 + mac.rg * 0.6).rgb;',
            '  gr *= mix(vec3(0.88, 0.94, 0.84), vec3(1.04, 1.02, 0.92), smoothstep(0.25, 0.75, mac.r));',
            '  gr = mix(gr, gr * vec3(1.1, 1.02, 0.84), smoothstep(0.55, 0.8, mac.b) * 0.5);'].join('\n'),
          '  gcol += gr * wG; wsum += wG; }',
          'if (wD > 0.004) { vec3 di = texture2D(uDirt, wxz / 3.0 + mac.gr * 0.5).rgb * mix(0.9, 1.06, mac.g); float w = wD * (0.75 + dot(di, vec3(0.1667))); gcol += di * w; wsum += w; }',
          'if (wC > 0.004) { vec3 co = texture2D(uCobble, wxz / 2.2).rgb * mix(0.84, 1.06, mac.g); float w = wC * (0.55 + dot(co, vec3(0.5333))); gcol += co * w; wsum += w; }',
          'if (wP > 0.004) { vec3 pv = texture2D(uPave, wxz / 3.4).rgb * mix(0.9, 1.05, mac.b); gcol += pv * wP; wsum += wP; }',
          'gcol /= max(1e-4, wsum);',
          'diffuseColor.rgb *= gcol * (0.6 + 0.4 * aoT);',
        ].join('\n'));
    };
    mat.customProgramCacheKey = () => (FX ? 'vterrainF' : 'vterrain');
    const m = new T.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
    m.renderOrder = 1;            // drawn after the other opaques: early-z rejects the costly ground shading under plaza / buildings / props
    m.name = 'village_terrain';
    return m;
  };

  /* -------------------------------------------- spawn plaza (engraved octagon) -------------------------------------------- */
  V.buildPlaza = function (apothem, innerR) {
    const Rc = apothem / Math.cos(Math.PI / 8);            // octagon circumradius (flat sides face N/E/S/W)
    const SIZE = 2048, ext = Rc * 2 + 0.6, ppm = SIZE / ext;
    const c = document.createElement('canvas'); c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const hc = document.createElement('canvas'); hc.width = hc.height = 1024;
    const hg = hc.getContext('2d');
    const R = V.rng(911);
    g.translate(SIZE / 2, SIZE / 2); g.scale(ppm, ppm);
    hg.translate(512, 512); hg.scale(ppm / 2, ppm / 2);
    g.fillStyle = '#4e483f'; g.fillRect(-ext, -ext, ext * 2, ext * 2);
    hg.fillStyle = '#000'; hg.fillRect(-ext, -ext, ext * 2, ext * 2);
    const oct = (r) => { const p = []; for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; };
    const pathPoly = (ctx, pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); };
    // the star inlay (8 points) and its grooves
    const star = []; for (let k = 0; k < 16; k++) { const a = -Math.PI / 2 + k * Math.PI / 8, r = k % 2 ? innerR + 1.4 : innerR + 6.0; star.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const tone = () => { const t = 0.84 + R() * 0.26, warm = R() < 0.3 ? 1.022 : R() < 0.3 ? 0.985 : 1; return 'rgb(' + Math.round(122 * t * warm) + ',' + Math.round(117 * t) + ',' + Math.round(106 * t / warm) + ')'; };
    // rings of slabs between the dais and the octagon edge
    const rings = [innerR];
    let r = innerR; while (r < Rc + 1) { r += 0.78 + R() * 0.32; rings.push(r); }
    const J = 0.03;
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i] + J, r1 = rings[i + 1] - J, rm = (r0 + r1) / 2;
      const n = Math.max(8, Math.round(Math.PI * 2 * rm / (0.62 + R() * 0.36)));
      const off = R() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a0 = off + k * Math.PI * 2 / n + J / rm, a1 = off + (k + 1) * Math.PI * 2 / n - J / rm;
        const slab = (ctx) => { ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.closePath(); };
        g.save(); slab(g); g.clip();
        g.fillStyle = tone(); g.fillRect(-ext, -ext, ext * 2, ext * 2);
        // the inlay: darker blue-grey stone, cut along the same joints
        pathPoly(g, star); g.fillStyle = 'rgba(78,82,86,0.9)'; g.fill();
        // dark ring band
        g.beginPath(); g.arc(0, 0, innerR + 6.9, 0, Math.PI * 2); g.arc(0, 0, innerR + 6.3, 0, Math.PI * 2, true); g.fillStyle = 'rgba(78,82,86,0.85)'; g.fill();
        // per-slab wear: lighter centre, darker rim
        const gr = g.createRadialGradient(Math.cos((a0 + a1) / 2) * rm, Math.sin((a0 + a1) / 2) * rm, 0, Math.cos((a0 + a1) / 2) * rm, Math.sin((a0 + a1) / 2) * rm, 0.9);
        gr.addColorStop(0, 'rgba(255,250,240,0.04)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)');
        g.fillStyle = gr; g.fillRect(-ext, -ext, ext * 2, ext * 2);
        g.restore();
        slab(hg); hg.fillStyle = '#fff'; hg.fill();
      }
    }
    // engraved grooves: star outline + ring (dark cut with a light lip on one side)
    const groove = (draw, w) => {
      g.save(); g.lineJoin = 'round';
      g.translate(0.025, 0.025); draw(); g.strokeStyle = 'rgba(220,210,190,0.18)'; g.lineWidth = w; g.stroke();
      g.translate(-0.04, -0.04); draw(); g.strokeStyle = 'rgba(30,27,23,0.7)'; g.lineWidth = w; g.stroke();
      g.restore();
      hg.save(); draw.call(null, hg); hg.restore();
    };
    const starPath = (ctx) => { ctx = ctx || g; pathPoly(ctx, star); };
    groove(() => starPath(g), 0.06);
    groove(() => { g.beginPath(); g.arc(0, 0, innerR + 6.6, 0, Math.PI * 2); }, 0.05);
    groove(() => { const s2 = star.map((q) => [q[0] * 0.8, q[1] * 0.8]); pathPoly(g, s2); }, 0.035);
    hg.lineWidth = 0.07; hg.strokeStyle = '#000'; pathPoly(hg, star); hg.stroke();
    hg.beginPath(); hg.arc(0, 0, innerR + 6.6, 0, Math.PI * 2); hg.stroke();
    // octagon border: long kerb stones
    const o0 = oct(Rc), o1 = oct(Rc - 1.05);
    for (let k = 0; k < 8; k++) {
      const A = o0[k], B = o0[(k + 1) % 8], A1 = o1[k], B1 = o1[(k + 1) % 8];
      const n = 7 + Math.floor(R() * 3);
      for (let s = 0; s < n; s++) {
        const t0 = s / n + 0.004, t1 = (s + 1) / n - 0.004;
        const L = (P, Q, t) => [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
        const q = [L(A, B, t0), L(A, B, t1), L(A1, B1, t1 + 0.004), L(A1, B1, t0 - 0.004)];
        const sh = (q2) => [q2[0] * 0.995, q2[1] * 0.995];
        pathPoly(g, q.map(sh)); g.fillStyle = 'rgb(' + Math.round(120 + R() * 16) + ',' + Math.round(115 + R() * 12) + ',' + Math.round(104 + R() * 10) + ')'; g.fill();
        pathPoly(hg, q.map(sh)); hg.fillStyle = '#fff'; hg.fill();
      }
    }
    // grime: darker toward the rim, lighter worn ring around the dais where people walk
    g.setTransform(1, 0, 0, 1, 0, 0);
    const img = g.getImageData(0, 0, SIZE, SIZE), d = img.data;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const wx = (x - SIZE / 2) / ppm, wz = (y - SIZE / 2) / ppm, rr = Math.hypot(wx, wz);
      const n = ntab(NTAB, wx * 3, wz * 3), n2 = ntab(NTAB2, wx * 9, wz * 9);
      const k = (0.86 + 0.16 * n + 0.07 * n2) * (1 - 0.1 * smooth(Rc - 4, Rc, rr)) * (1 + 0.05 * (1 - smooth(0, 3, Math.abs(rr - innerR - 2.5))));
      const i = (y * SIZE + x) * 4; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    // height -> normal map (1024)
    const himg = hg.getImageData(0, 0, 1024, 1024).data, HH = new Float32Array(1024 * 1024);
    for (let i = 0; i < HH.length; i++) HH[i] = himg[i * 4] / 255;
    // soften the slab edges a touch (two box passes)
    const tmp = new Float32Array(HH.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < 1024; y++) for (let x = 1; x < 1023; x++) tmp[y * 1024 + x] = (HH[y * 1024 + x - 1] + HH[y * 1024 + x] + HH[y * 1024 + x + 1]) / 3;
      for (let y = 1; y < 1023; y++) for (let x = 0; x < 1024; x++) HH[y * 1024 + x] = (tmp[(y - 1) * 1024 + x] + tmp[y * 1024 + x] + tmp[(y + 1) * 1024 + x]) / 3;
    }
    const nc = document.createElement('canvas'); nc.width = nc.height = 1024;
    {
      const ng = nc.getContext('2d'), ni = ng.createImageData(1024, 1024), nd = ni.data;
      for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        const at = (xx, yy) => HH[clamp(yy, 0, 1023) * 1024 + clamp(xx, 0, 1023)];
        const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
        let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz);
        const i = (y * 1024 + x) * 4; nd[i] = (nx / l * 0.5 + 0.5) * 255; nd[i + 1] = (ny / l * 0.5 + 0.5) * 255; nd[i + 2] = (nz / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
      }
      ng.putImageData(ni, 0, 0);
    }
    const map = new T.CanvasTexture(c); map.anisotropy = V.maxAniso || 4;
    const nmap = new T.CanvasTexture(nc);
    const mat = new T.MeshStandardMaterial({ map, normalMap: nmap, normalScale: new T.Vector2(0.8, 0.8), roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.envMapIntensity = 0.35; mat.onBeforeCompile = V.noIBL; mat.customProgramCacheKey = () => 'vnoibl';
    // geometry: octagon fan, uv from world xz
    const pts = oct(Rc), pos = [], uv = [], nor = [];
    const U = (x, z) => [(x + ext / 2) / ext, 1 - (z + ext / 2) / ext];
    for (let k = 0; k < 8; k++) {
      const a = pts[k], b = pts[(k + 1) % 8];
      pos.push(0, 0, 0, b[0], 0, b[1], a[0], 0, a[1]);
      uv.push(...U(0, 0), ...U(b[0], b[1]), ...U(a[0], a[1]));
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    const mesh = new T.Mesh(geo, mat);
    mesh.position.y = 0.012; mesh.receiveShadow = true; mesh.renderOrder = 0;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.name = 'village_plaza';
    return { mesh, Rc, octagon: pts };
  };
})();
