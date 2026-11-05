/* =====================================================================================================
 *  village/forest.js  -  mystical giant forest (procedural, three.js r128; Poly Haven CC0 textures only)
 *
 *  - Giant trees: buttressed, twisting trunks (root flare lobes + bark grooves), surface roots that dive into
 *    the ground, arcing limbs and a canopy of painted leaf CARDS (alpha-tested quads with spherical normals,
 *    so the crown shades like one soft volume but keeps a leafy silhouette). 4 variants + a far LOD + a
 *    colossal landmark ("Kadim Ağaç") beyond the north wall. Everything is instanced.
 *  - The village's own trees (oak / linden / fruit crowns in props.js) switch from blobs to the same cards.
 *  - Undergrowth: ferns, glowing mushrooms, moss-covered logs and boulders.
 *  - Textures: Poly Haven bark / forest floor / meadow / mossy rock (village/phtex.js, painterly-filtered by
 *    tools/packvtex.mjs); leaf atlas painted on a canvas here (coverage-preserving mip chain, no fringes).
 *  ?atmo=0 keeps the old look (scene.js / props.js fall back to their own trees).
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const Q = new URLSearchParams(location.search);
  const F = V.Forest = { on: Q.get('atmo') !== '0' };
  if (!F.on) return;
  const PI = Math.PI, TAU = PI * 2;
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const { smooth, clamp } = V;

  /* creature camps / clearings (must match integrate.js SITES): no trunks inside, trees frame their edges */
  F.CLEARINGS = [[-17, 105, 11], [18, 99, 11], [-58, 121, 11], [66, 120, 9], [-82, 104, 13], [83, 105, 12], [-9, 138, 10]];

  /* ------------------------------------------ leaf atlas (2 x 2 painted clusters) ------------------------------------------ */
  function leafAtlas() {
    const S = 1024, h = S / 2;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const R = V.rng(4242);
    const leaf = (x, y, len, wid, ang, col, rib) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(-len * 0.5, 0);
      g.quadraticCurveTo(-len * 0.1, -wid, len * 0.5, 0);
      g.quadraticCurveTo(-len * 0.1, wid, -len * 0.5, 0);
      g.fillStyle = col; g.fill();
      if (rib) { g.strokeStyle = rib; g.lineWidth = Math.max(1, wid * 0.12); g.beginPath(); g.moveTo(-len * 0.45, 0); g.lineTo(len * 0.38, 0); g.stroke(); }
      g.restore();
    };
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2) * h, oy = Math.floor(q / 2) * h, cx = ox + h / 2, cy = oy + h / 2;
      // ragged mask = union of circles
      const blobs = [[cx, cy, 150]];
      for (let k = 0; k < 7; k++) { const a = R() * TAU, r = 60 + R() * 70; blobs.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 70 + R() * 70]); }
      const inside = (x, y) => blobs.some(([bx, by, br]) => (x - bx) * (x - bx) + (y - by) * (y - by) < br * br);
      g.save(); g.beginPath(); g.rect(ox + 2, oy + 2, h - 4, h - 4); g.clip();
      const N = 900;
      for (let i = 0; i < N; i++) {
        let x, y, tries = 0;
        do { x = ox + 18 + R() * (h - 36); y = oy + 18 + R() * (h - 36); tries++; } while (!inside(x, y) && tries < 30);
        if (tries >= 30) continue;
        const depth = i / N;                                    // later leaves = front = lighter
        const out = Math.atan2(y - cy, x - cx);
        const ang = out + (R() - 0.5) * 1.6;
        const len = 30 + R() * 22, wid = 9 + R() * 6;
        const k = 0.35 + 0.65 * depth, hv = (R() - 0.5) * 0.16;
        const r = Math.round((70 + 95 * k) * (1 + hv)), gg = Math.round(95 + 125 * k), b = Math.round((55 + 70 * k) * (1 - hv));
        leaf(x, y, len, wid, ang, 'rgb(' + r + ',' + gg + ',' + b + ')', depth > 0.55 ? 'rgba(40,60,30,0.35)' : null);
      }
      g.restore();
    }
    // un-premultiplied RGBA, colour dilated into the transparent texels (no dark fringes when filtered)
    const d = g.getImageData(0, 0, S, S).data;
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < S * S; i++) if (d[i * 4 + 3] > 200) { ar += d[i * 4]; ag += d[i * 4 + 1]; ab += d[i * 4 + 2]; an++; }
    ar /= an; ag /= an; ab /= an;
    for (let i = 0; i < S * S; i++) { const a = d[i * 4 + 3] / 255; if (a < 0.98) { d[i * 4] = d[i * 4] * a + ar * (1 - a); d[i * 4 + 1] = d[i * 4 + 1] * a + ag * (1 - a); d[i * 4 + 2] = d[i * 4 + 2] * a + ab * (1 - a); } }
    // mip chain: 2x2 box, alpha remapped so the share of texels above the alpha test stays the level-0 coverage
    const TH = 0.5;
    const cov0 = (() => { let n = 0; for (let i = 0; i < S * S; i++) if (d[i * 4 + 3] / 255 > TH) n++; return n / (S * S); })();
    const mips = [{ data: new Uint8Array(d.buffer.slice(0)), width: S, height: S }];
    let src = mips[0], w = S;
    while (w > 1) {
      const n = w / 2, o = new Uint8Array(n * n * 4), A = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let r = 0, gg = 0, b = 0, a = 0;
        for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = ((y * 2 + j) * w + x * 2 + i) * 4; r += src.data[k]; gg += src.data[k + 1]; b += src.data[k + 2]; a += src.data[k + 3]; }
        const k = (y * n + x) * 4; o[k] = r / 4; o[k + 1] = gg / 4; o[k + 2] = b / 4; A[y * n + x] = a / 4 / 255;
      }
      // find the alpha threshold that keeps the level-0 coverage, scale alpha so it lands on TH
      const sorted = Float32Array.from(A).sort(), t = sorted[Math.min(n * n - 1, Math.max(0, Math.floor((1 - cov0) * n * n)))] || TH;
      const sc = TH / Math.max(0.02, t);
      for (let i = 0; i < n * n; i++) o[i * 4 + 3] = clamp(A[i] * sc, 0, 1) * 255;
      src = { data: o, width: n, height: n }; mips.push(src); w = n;
    }
    const tex = new T.DataTexture(mips[0].data, S, S, T.RGBAFormat);
    tex.mipmaps = mips; tex.generateMipmaps = false;
    tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter;
    tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.anisotropy = V.maxAniso || 4;
    tex.flipY = false; tex.needsUpdate = true;
    return tex;
  }

  /* crown silhouettes seen from the sun, holes = sun flecks (2 x 2 atlas): the shadow proxies render with it */
  function dappleAtlas() {
    // per texel: a noisy crown silhouette, with organic gaps from thresholded fine noise (more gaps toward the rim)
    const S = 512, h = S / 2, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2) * h, oy = Math.floor(q / 2) * h, sd = 300 + q * 17;
      for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
        const u = (x + 0.5) / h * 2 - 1, v = (y + 0.5) / h * 2 - 1, r = Math.hypot(u, v);
        const edge = 0.8 + (V.fbm(x / 26 + sd, y / 26, 3, 0, sd) - 0.5) * 0.45;
        if (r > edge + 0.05) continue;
        const gap = V.fbm(x / 5.5 + sd * 3, y / 5.5, 3, 0, sd + 7) + 0.12 * V.vnoise(x / 2, y / 2, 0, sd + 9);
        // continuous field around the 0.5 threshold: bilinear filtering then gives smooth (not stair-stepped) fleck edges
        const a = Math.min(clamp(0.5 + (edge - r) * 14, 0, 1), clamp(0.5 + (0.62 - 0.13 * smooth(0.35, 1.0, r / edge) - gap) * 9, 0, 1));
        const i = ((oy + y) * S + ox + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    return t;
  }

  /* ------------------------------------------ Poly Haven textures ------------------------------------------ */
  function phTex(key, rep) {
    const P = window.VILLAGE_PH; if (!P || !P[key]) return null;
    const t = new T.Texture(); const img = new Image();
    img.onload = () => { t.image = img; t.needsUpdate = true; };
    img.src = P[key];
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = V.maxAniso || 4;
    if (rep) t.repeat.set(rep, rep);
    return t;
  }
  F.textures = function () {
    if (F.X) return F.X;
    F.X = {
      leaf: leafAtlas(), dapple: dappleAtlas(),
      bark: phTex('bark'), barkN: phTex('barkN'),
      floor: phTex('floor'), floorN: phTex('floorN'),
      meadow: phTex('meadow'), meadowN: phTex('meadowN'),
      mossrock: phTex('mossrock'), mossrockN: phTex('mossrockN'),
    };
    return F.X;
  };

  /* ------------------------------------------ materials ------------------------------------------ */
  const CANOPY_VERT = [
    '#include <begin_vertex>',
    '{ vec3 ip = vec3(0.0);',
    '#ifdef USE_INSTANCING',
    '  ip = instanceMatrix[3].xyz;',
    '#endif',
    '  float hh = max(0.0, transformed.y - 1.2);',
    '  float ph = dot(ip.xz, vec2(0.13, 0.17)) + dot(transformed.xz, vec2(0.23, 0.19));',
    '  float sw = sin(uVTime * 0.8 + ph) * 0.65 + sin(uVTime * 2.1 + ph * 1.7) * 0.25;',
    '  transformed.x += sw * 0.009 * hh; transformed.z += cos(uVTime * 0.6 + ph * 1.3) * 0.007 * hh;',
    '  transformed += normal * sin(uVTime * 3.1 + ph * 4.0 + transformed.y) * 0.035; }',
  ].join('\n');
  // double-sided cards keep their (spherical) normals on both faces: no flip, the crown shades as one volume
  const NORMAL_BEGIN = 'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;\nvec3 normal = normalize( vNormal );\nvec3 geometryNormal = normal;\n';
  const NEAR_FADE = '\n{ float dcam = distance(vFadeW, cameraPosition); if ((1.0 - smoothstep(7.0, 11.0, dcam)) > vBayer4(gl_FragCoord.xy) + 0.01) discard; }\n';
  F.materials = function (M) {
    if (M.leafCard) return M;
    const X = F.textures();
    // Lambert = per-vertex light (cheap under heavy card overdraw); the spherical normals make it shade like one volume.
    // Cards neither cast nor receive shadows: crown-wide dapple proxies cast them (see giant() / crownCards()).
    const leaf = new T.MeshLambertMaterial({ map: X.leaf, alphaTest: 0.5, side: T.DoubleSide, vertexColors: true });
    leaf.name = 'leafCard'; leaf.userData = { uv: 'local', uvScale: 1, ao: false };
    leaf.onBeforeCompile = (sh) => {
      V.injectFade(sh);
      sh.uniforms.uVTime = V.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uVTime;').replace('#include <begin_vertex>', CANOPY_VERT)
        // both faces get the front lighting (no inside-out patches) + a little light coming through the leaves
        .replace('#include <lights_lambert_vertex>', '#include <lights_lambert_vertex>\n vIndirectFront += vec3(0.07, 0.09, 0.06) * (0.6 + 0.4 * geometry.normal.y);\n#ifdef DOUBLE_SIDED\n vLightBack = vLightFront; vIndirectBack = vIndirectFront;\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>' + NEAR_FADE);
    };
    leaf.customProgramCacheKey = () => 'vleafcard';
    const leafDepth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: X.dapple, alphaTest: 0.5, side: T.DoubleSide });
    const ns = (s) => new T.Vector2(s, s);
    const bark = new T.MeshStandardMaterial({ map: X.bark || null, normalMap: X.barkN || null, normalScale: ns(1.3), vertexColors: true, roughness: 0.94, metalness: 0 });
    bark.name = 'giantBark'; bark.userData = { uv: 'local', uvScale: 1, ao: false };
    bark.onBeforeCompile = (sh) => { V.injectFade(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>' + NEAR_FADE); };
    bark.customProgramCacheKey = () => 'vgiantbark';
    const moss = new T.MeshStandardMaterial({ map: X.mossrock || null, normalMap: X.mossrockN || null, normalScale: ns(1.0), vertexColors: true, roughness: 0.95, metalness: 0 });
    moss.name = 'mossRock'; moss.userData = { uv: 'local', uvScale: 1, ao: false };
    moss.onBeforeCompile = V.injectFade; moss.customProgramCacheKey = () => 'vfade';
    const fern = new T.MeshStandardMaterial({ side: T.DoubleSide, vertexColors: true, roughness: 0.85, metalness: 0 });
    fern.name = 'fern'; fern.userData = { uv: 'local', uvScale: 1, ao: false };
    fern.onBeforeCompile = (sh) => {
      V.noIBL(sh); sh.uniforms.uVTime = V.time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uVTime;').replace('#include <begin_vertex>', CANOPY_VERT.replace('transformed.y - 1.2', 'transformed.y').replace('0.009 * hh', '0.05 * hh').replace('0.007 * hh', '0.04 * hh').replace('* 0.035', '* 0.0'));
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', NORMAL_BEGIN);
    };
    fern.customProgramCacheKey = () => 'vfern';
    const glow = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1.0 });
    glow.name = 'shroomGlow'; glow.userData = { uv: 'local', uvScale: 1, ao: false };
    // emissive follows the vertex colour (caps glow in their own hue, stems stay dark)
    glow.onBeforeCompile = (sh) => { V.noIBL(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb * smoothstep(0.35, 0.6, max(vColor.r, max(vColor.g, vColor.b))) * 1.25;'); };
    glow.customProgramCacheKey = () => 'vglow';
    // shadow-only proxy: never reaches the screen (every vertex is put outside the clip volume), the shadow pass uses leafDepth
    const shadowOnly = new T.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }', side: T.DoubleSide });
    shadowOnly.name = 'shadowOnly'; shadowOnly.userData = { uv: 'local', uvScale: 1, ao: false };
    Object.assign(M, { leafCard: leaf, giantBark: bark, mossRock: moss, fern, shroomGlow: glow, shadowOnly });
    M._leafDepth = leafDepth;
    M._all.push(leaf, bark, moss, fern, glow);
    return M;
  };

  /* ------------------------------------------ geometry helpers ------------------------------------------ */
  function finish(p, n, u, c, idx) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    if (n) g.setAttribute('normal', new T.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(u, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(c, 3));
    if (idx) g.setIndex(idx);
    if (!n) g.computeVertexNormals();
    return g;
  }
  // tube with a varying radius along a Catmull-Rom curve; col(t, y, side) -> [r,g,b]
  function tube(pts, rad, radial, tubular, col, groove) {
    const curve = new T.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const fr = curve.computeFrenetFrames(tubular, false), L = curve.getLength();
    const p = [], u = [], c = [], idx = [];
    for (let j = 0; j <= tubular; j++) {
      const t = j / tubular, P = curve.getPointAt(t), N = fr.normals[j], B = fr.binormals[j], r = rad(t);
      for (let i = 0; i <= radial; i++) {
        const a = i / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const gr = groove ? 1 + groove * (Math.sin(a * 5 + t * 3) * 0.6 + Math.sin(a * 11 - t * 7) * 0.4) : 1;
        const dx = N.x * ca + B.x * sa, dy = N.y * ca + B.y * sa, dz = N.z * ca + B.z * sa;
        p.push(P.x + dx * r * gr, P.y + dy * r * gr, P.z + dz * r * gr);
        u.push(i / radial * Math.max(1, Math.round(TAU * r / 1.4)), t * L / 2.0);
        const k = col(t, P.y + dy * r, dy); c.push(k[0], k[1], k[2]);
      }
    }
    for (let j = 0; j < tubular; j++) for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);   // outward normals (Frenet: T x B = -N)
    }
    return { geo: finish(p, null, u, c, idx), curve };
  }
  // one leaf-card cluster: n quads around `cc` (radius r), normals blended between the cluster and the whole crown
  function cards(out, R, cc, r, n, crownC, crownR, tint, lod) {
    const up = v3(0, 1, 0), tmp = v3(0, 0, 0);
    for (let k = 0; k < n; k++) {
      const off = v3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).multiplyScalar(r * 0.42);
      const cen = cc.clone().add(off);
      const outward = cc.clone().sub(crownC); outward.y *= 0.6; outward.normalize();
      const nrm = v3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize().add(outward.multiplyScalar(0.7)).add(up.clone().multiplyScalar(0.35)).normalize();
      const tA = Math.abs(nrm.y) < 0.9 ? up : v3(1, 0, 0);
      const ax = v3(0, 0, 0).crossVectors(tA, nrm).normalize(), ay = v3(0, 0, 0).crossVectors(nrm, ax);
      const roll = R() * TAU, cr = Math.cos(roll), sr = Math.sin(roll);
      const ex = ax.clone().multiplyScalar(cr).addScaledVector(ay, sr), ey = ax.clone().multiplyScalar(-sr).addScaledVector(ay, cr);
      const sz = r * (lod ? 1.25 : 1.0) * (0.85 + R() * 0.4);
      const q = Math.floor(R() * 4), u0 = (q % 2) * 0.5, v0 = Math.floor(q / 2) * 0.5;
      const corners = [[-1, -1, u0, v0], [1, -1, u0 + 0.5, v0], [1, 1, u0 + 0.5, v0 + 0.5], [-1, 1, u0, v0 + 0.5]];
      const base = out.p.length / 3;
      for (const [sx, sy, uu, vv] of corners) {
        const P = cen.clone().addScaledVector(ex, sx * sz).addScaledVector(ey, sy * sz);
        out.p.push(P.x, P.y, P.z);
        // spherical crown normal (soft volume) + a little of the cluster's own bulge
        tmp.subVectors(P, crownC); tmp.x /= crownR.x; tmp.y /= crownR.y; tmp.z /= crownR.z;
        const outer = clamp(tmp.length(), 0, 1.3);
        const nb = tmp.clone().normalize().multiplyScalar(0.62).add(P.clone().sub(cc).normalize().multiplyScalar(0.38)).normalize();
        out.n.push(nb.x, nb.y, nb.z);
        out.u.push(uu, vv);
        const top = smooth(-1, 1, (P.y - crownC.y) / crownR.y);
        const k = 0.42 + 0.42 * smooth(0.2, 1.05, outer) + 0.28 * top;
        out.c.push(tint[0] * k, tint[1] * k, tint[2] * k);
      }
      out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  F.crownCards = function (B, M, seed, n, cx, cy, cz, rx, ry, rz, rMin, rMax, colr) {
    // drop-in for props.js crown(): same cluster placement, painted cards instead of icosahedron blobs
    const Rr = V.rng(seed), out = { p: [], n: [], u: [], c: [], i: [] };
    const crownC = v3(cx, cy, cz), crownR = v3(rx + rMax, ry + rMax, rz + rMax), base = new T.Color(colr);
    for (let i = 0; i < n; i++) {
      const a = Rr() * TAU, e = (Rr() * 2 - 1) * 0.8, rr = Math.sqrt(Rr()) * 0.85;
      const x = cx + Math.cos(a) * Math.cos(e) * rx * rr, y = cy + Math.sin(e) * ry * rr * 0.8 + (i === 0 ? ry * 0.2 : 0), z = cz + Math.sin(a) * Math.cos(e) * rz * rr;
      const r = (rMin + Rr() * (rMax - rMin)) * 1.25, t = (0.9 + Rr() * 0.2) * 1.9;
      cards(out, Rr, v3(x, y, z), r, 7, crownC, crownR, [base.r * t, base.g * t, base.b * t]);
    }
    B.geo(M.leafCard, finish(out.p, out.n, out.u, out.c, out.i), null, {});
    // one crown-wide dapple quad casts the shadow (the cards themselves do not)
    const q = Math.floor(Rr() * 4), u0 = (q % 2) * 0.5, v0 = Math.floor(q / 2) * 0.5, hw = Math.max(rx, rz) + rMax * 0.9, a0 = Rr() * TAU, ca = Math.cos(a0) * hw, sa = Math.sin(a0) * hw;
    const Pq = [[cx - ca + sa, cz - sa - ca], [cx + ca + sa, cz + sa - ca], [cx + ca - sa, cz + sa + ca], [cx - ca - sa, cz - sa + ca]];
    B.geo(M.shadowOnly, finish(Pq.flatMap((p) => [p[0], cy, p[1]]), [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [u0, v0, u0 + 0.5, v0, u0 + 0.5, v0 + 0.5, u0, v0 + 0.5], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 2, 0, 2, 3]), null, {});
  };

  /* ------------------------------------------ the giant tree ------------------------------------------ */
  const BARK = [1.08, 0.98, 0.9], MOSS = [0.78, 1.0, 0.6];
  const barkCol = (y, moss) => { const m = clamp(moss, 0, 1), k = 0.72 + 0.28 * smooth(0, 14, y); return [(BARK[0] + (MOSS[0] - BARK[0]) * m) * k, (BARK[1] + (MOSS[1] - BARK[1]) * m) * k, (BARK[2] + (MOSS[2] - BARK[2]) * m) * k]; };
  function giant(B, M, seed, o) {
    const R = V.rng(seed);
    const H = o.h, r0 = o.r, NI = o.lod ? 10 : 16, NJ = o.lod ? 7 : 15;
    const nl = o.lobes, lobes = [];
    for (let k = 0; k < nl; k++) lobes.push([k / nl * TAU + (R() - 0.5) * 0.7, 0.7 + R() * 0.5]);
    const s1 = R() * TAU, s2 = R() * TAU;
    const center = (y) => { const t = y / H; return [Math.sin(t * 2.1 + s1) * o.bend * t * t + Math.sin(s1) * o.lean * t, Math.cos(t * 1.7 + s2) * o.bend * t * t + Math.cos(s1) * o.lean * t]; };
    const rAt = (y) => r0 * (1 - 0.48 * Math.pow(clamp(y / H, 0, 1), 0.8));
    const flare = (y) => Math.exp(-Math.max(0, y) / o.flareH);
    const lobeAt = (th) => { let s = 0; for (const [a, w] of lobes) s += w * Math.pow(Math.max(0, Math.cos(th - a)), 14); return s; };
    // trunk
    {
      const p = [], u = [], c = [], idx = [];
      for (let j = 0; j <= NJ; j++) {
        const t = j / NJ, y = -0.6 + t * (H + 0.6), [cx, cz] = center(y), rb = rAt(y), fl = flare(y), tw = t * o.twist;
        for (let i = 0; i <= NI; i++) {
          const th = i / NI * TAU, lb = lobeAt(th);
          const r = rb * (1 + fl * (0.12 + 2.3 * lb) + 0.1 * lb * (1 - fl)) * (1 + 0.07 * Math.sin(th * 7 + y * 0.7) + 0.045 * Math.sin(th * 13 - y * 1.3));
          const a = th + tw;
          p.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
          u.push(i / NI * Math.max(2, Math.round(TAU * r0 / 1.5)), y / 2.4);
          const k = barkCol(y, smooth(3.5, 0, y) * 0.75 + lb * fl * 0.35); c.push(k[0], k[1], k[2]);
        }
      }
      for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) { const a = j * (NI + 1) + i, b = a + NI + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      B.geo(M.giantBark, finish(p, null, u, c, idx), null, {});
    }
    // surface roots: from the buttress lobes outward, diving into the ground
    const roots = [];
    if (!o.lod) for (const [a, w] of lobes) {
      if (R() < 0.25) continue;
      const aa = a + (R() - 0.5) * 0.3, d = v3(Math.cos(aa), 0, Math.sin(aa)), side = v3(-d.z, 0, d.x).multiplyScalar((R() - 0.5) * 2.2);
      const L = r0 * (2.4 + R() * 1.6) + 2.5;
      const pts = [d.clone().multiplyScalar(r0 * 1.4).setY(1.3), d.clone().multiplyScalar(r0 * 2.2 + 0.8).add(side.clone().multiplyScalar(0.3)).setY(0.55),
        d.clone().multiplyScalar(r0 * 1.6 + L * 0.6).add(side.clone().multiplyScalar(0.7)).setY(0.28), d.clone().multiplyScalar(r0 * 1.2 + L).add(side).setY(-0.45)];
      const rr = r0 * 0.36 * w;
      B.geo(M.giantBark, tube(pts, (t) => rr * (1 - 0.72 * t) + 0.06, 6, 6, (t, y) => barkCol(y, 0.55 + 0.35 * t), 0.06).geo, null, {});
      roots.push({ x: pts[2].x, z: pts[2].z, r: rr * 0.7 + 0.25 });
    }
    // limbs + canopy
    const out = { p: [], n: [], u: [], c: [], i: [] };
    const top = H, ctr = center(top);
    const crownC = v3(ctr[0], top + o.lift * 0.62, ctr[1]), crownR = v3(o.spread, o.lift * 0.75 + 2, o.spread);
    const tint = o.tint;
    const clusters = [];
    const nlimb = o.limbs;
    for (let k = 0; k < nlimb; k++) {
      const az = k / nlimb * TAU + (R() - 0.5) * 0.8, d = v3(Math.cos(az), 0, Math.sin(az));
      const y0 = H * (0.66 + R() * 0.3), c0 = center(y0), r = rAt(y0);
      const start = v3(c0[0], y0, c0[1]).addScaledVector(d, r * 0.3);
      const L = o.spread * (0.62 + R() * 0.38), lift = o.lift * (0.45 + R() * 0.5);
      const pts = [start, start.clone().addScaledVector(d, L * 0.35).add(v3(0, lift * 0.55 + 1.2, 0)), start.clone().addScaledVector(d, L * 0.75).add(v3(0, lift * 0.85, 0)), start.clone().addScaledVector(d, L).add(v3(0, lift, 0))];
      const tb = tube(pts, (t) => r * 0.52 * (1 - 0.7 * t) + 0.12, o.lod ? 5 : 7, o.lod ? 4 : 7, (t, y) => barkCol(y, 0.1), 0.05);
      B.geo(M.giantBark, tb.geo, null, {});
      for (const t of [0.5, 0.78, 1.0]) clusters.push([tb.curve.getPointAt(t).add(v3(0, 1.1, 0)), o.cr * (0.75 + R() * 0.4)]);
      // a fork near the end
      if (!o.lod && R() < 0.8) {
        const e = tb.curve.getPointAt(0.7), d2 = d.clone().applyAxisAngle(v3(0, 1, 0), (R() < 0.5 ? -1 : 1) * (0.7 + R() * 0.5));
        const pts2 = [e, e.clone().addScaledVector(d2, L * 0.25).add(v3(0, 1.4, 0)), e.clone().addScaledVector(d2, L * 0.45).add(v3(0, 2.2, 0))];
        const tb2 = tube(pts2, (t) => r * 0.22 * (1 - 0.6 * t) + 0.08, 5, 4, (t, y) => barkCol(y, 0.05), 0);
        B.geo(M.giantBark, tb2.geo, null, {});
        clusters.push([pts2[2].clone().add(v3(0, 0.8, 0)), o.cr * (0.7 + R() * 0.3)]);
      }
    }
    // leader + fill clusters (dense crown, no sky holes from below)
    {
      const c1 = center(H);
      const tb = tube([v3(c1[0], H - 1, c1[1]), v3(c1[0], H + o.lift * 0.5, c1[1]), v3(c1[0] + 0.5, H + o.lift * 0.95, c1[1] - 0.3)], (t) => rAt(H) * 0.6 * (1 - 0.7 * t) + 0.1, o.lod ? 6 : 9, 5, (t, y) => barkCol(y, 0.05), 0);
      B.geo(M.giantBark, tb.geo, null, {});
      clusters.push([v3(c1[0] + 0.5, H + o.lift * 1.05, c1[1] - 0.3), o.cr * 1.1]);
    }
    for (let k = 0; k < o.fill; k++) {
      const a = R() * TAU, rr = Math.sqrt(R()) * 0.82, e = (R() * 2 - 1);
      clusters.push([v3(crownC.x + Math.cos(a) * crownR.x * rr, crownC.y + e * crownR.y * 0.55, crownC.z + Math.sin(a) * crownR.z * rr), o.cr * (0.8 + R() * 0.35)]);
    }
    for (const [cc, r] of clusters) {
      const hv = (R() - 0.5) * 0.12, k = 1.85 * (0.92 + R() * 0.16);
      cards(out, R, cc, r, o.lod ? 4 : o.cards, crownC, crownR, [tint[0] * k * (1 + hv), tint[1] * k, tint[2] * k * (1 - hv)], o.lod);
    }
    B.geo(M.leafCard, finish(out.p, out.n, out.u, out.c, out.i), null, {});
    {   // shadow proxy: two crown-wide horizontal quads with the dapple silhouette (2 layers instead of ~15 card layers)
      const sh = { p: [], n: [], u: [], c: [], i: [] }, up = v3(0, 1, 0);
      for (const [cc, r] of [[crownC.clone().add(v3(0, -crownR.y * 0.15, 0)), o.spread + o.cr * 0.5]]) {
        const a0 = R() * TAU, ax = v3(Math.cos(a0), 0, Math.sin(a0));
        const ay = v3(0, 0, 0).crossVectors(ax, up).normalize(), sz = r, cen = cc;
        const q = Math.floor(R() * 4), u0 = (q % 2) * 0.5, v0 = Math.floor(q / 2) * 0.5, b = sh.p.length / 3;
        for (const [sx, sy, uu, vv] of [[-1, -1, u0, v0], [1, -1, u0 + 0.5, v0], [1, 1, u0 + 0.5, v0 + 0.5], [-1, 1, u0, v0 + 0.5]]) { const P = cen.clone().addScaledVector(ax, sx * sz).addScaledVector(ay, sy * sz); sh.p.push(P.x, P.y, P.z); sh.n.push(0, 1, 0); sh.u.push(uu, vv); sh.c.push(1, 1, 1); }
        sh.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      B.geo(M.shadowOnly, finish(sh.p, sh.n, sh.u, sh.c, sh.i), null, {});
    }
    return { roots, crown: crownC, spread: o.spread, r0, lobes: lobes.map(([a]) => a) };
  }
  F.giant = giant;

  /* ------------------------------------------ instanced templates ------------------------------------------ */
  function template(fn) { const B = new V.Builder({ chunk: 1e7 }); const info = fn(B); return { map: B.toGeometries(), info }; }
  const GIANTS = [
    // WoW-like proportions: very thick trunk, crown base ~5 player heights up, crown wider than tall
    { seed: 11, h: 11.5, r: 1.7, lobes: 6, flareH: 2.2, twist: 0.8, bend: 1.4, lean: 0.5, limbs: 6, spread: 12, lift: 7.5, cr: 3.5, cards: 8, fill: 20, tint: [0.62, 0.78, 0.5] },
    { seed: 23, h: 10, r: 1.45, lobes: 5, flareH: 1.9, twist: -1.0, bend: 2.0, lean: 0.9, limbs: 6, spread: 10.5, lift: 6.5, cr: 3.2, cards: 8, fill: 16, tint: [0.56, 0.76, 0.6] },
  ];
  F.define = function (I, M) {
    F.materials(M);
    F.kinds = {};
    const add = (name, tpl, layer, cast) => {
      const parts = []; for (const [mat, geo] of tpl.map) parts.push({ geo, mat, cast: mat === M.leafCard ? !tpl.map.has(M.shadowOnly) : cast !== false });
      I.define(name, parts, { layer: layer || 'main', chunk: 80 });
      F.kinds[name] = tpl.info;
    };
    GIANTS.forEach((o, i) => add('giant' + i, template((B) => giant(B, M, o.seed, o))));
    add('giantFar', template((B) => giant(B, M, 57, Object.assign({}, GIANTS[0], { seed: 57, lod: true, fill: 10, cards: 4, tint: [0.6, 0.72, 0.62] }))));
    // the colossal landmark north of the keep
    add('titan', template((B) => giant(B, M, 99, { seed: 99, h: 26, r: 5.2, lobes: 8, flareH: 6, twist: 0.6, bend: 3, lean: 0.4, limbs: 9, spread: 30, lift: 18, cr: 8, cards: 9, fill: 34, tint: [0.58, 0.7, 0.8] })));
    // ferns: arching fronds made of leaflet pairs
    add('fern', template((B) => {
      const R = V.rng(71), p = [], u = [], c = [], idx = [];
      for (let f = 0; f < 9; f++) {
        const a = f / 9 * TAU + R() * 0.4, L = 0.9 + R() * 0.5, d = v3(Math.cos(a), 0, Math.sin(a)), s = v3(-d.z, 0, d.x);
        for (let k = 0; k < 7; k++) {
          const t = (k + 0.5) / 7, P = d.clone().multiplyScalar(t * L).setY(Math.sin(t * PI * 0.85) * 0.55 * L), w = 0.14 * (1 - t * 0.6) * L;
          for (const sg of [-1, 1]) {
            const b = p.length / 3, tip = P.clone().addScaledVector(s, sg * w * 1.6).addScaledVector(d, 0.05).setY(P.y - 0.06);
            p.push(P.x, P.y, P.z, P.x + d.x * 0.09, P.y + 0.01, P.z + d.z * 0.09, tip.x, tip.y, tip.z);
            const k2 = 0.55 + 0.45 * t; for (let q = 0; q < 3; q++) { c.push(0.36 * k2, 0.6 * k2, 0.3 * k2); u.push(0, 0); }
            idx.push(b, b + 1, b + 2);
          }
        }
      }
      const g = finish(p, null, u, c, idx); const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.3, 1, nn.getZ(i) * 0.3);
      g.attributes.normal.needsUpdate = true;
      B.geo(M.fern, g, null, {});
    }), 'detail', false);
    // glowing mushrooms: a cluster of capped stems (caps carry the glow colour, stems stay pale)
    add('shrooms', template((B) => {
      const R = V.rng(83);
      for (let k = 0; k < 6; k++) {
        const a = R() * TAU, rr = R() * 0.45, x = Math.cos(a) * rr, z = Math.sin(a) * rr, h = 0.18 + R() * 0.32, cr = 0.09 + R() * 0.1;
        B.cyl(M.shroomGlow, x, 0, z, 0.035, 0.028, h, 6, { color: 0x3a3c40, caps: '' });
        const g = new T.SphereGeometry(cr, 9, 5, 0, TAU, 0, PI * 0.5); g.scale(1, 0.6, 1); g.translate(x, h - 0.01, z);
        const cc = []; for (let i = 0; i < g.attributes.position.count; i++) cc.push(1, 1, 1);
        g.setAttribute('color', new T.Float32BufferAttribute(cc, 3));
        B.geo(M.shroomGlow, g, null, { color: 0xffffff });
      }
    }), 'detail', false);
    // moss-covered log (big, fallen) and boulder
    add('mosslog', template((B) => {
      const pts = [v3(-4.2, 0.55, 0), v3(-1.4, 0.62, 0.3), v3(1.6, 0.58, -0.2), v3(4.4, 0.5, 0.1)];
      B.geo(M.giantBark, tube(pts, (t) => 0.62 - 0.12 * t, 12, 8, (t, y, up) => barkCol(4, 0.25 + 0.7 * smooth(-0.2, 0.8, up)), 0.05).geo, null, {});
    }));
    add('mossboulder', template((B) => {
      const g = new T.IcosahedronGeometry(1, 2), p = g.attributes.position, cc = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + (V.vnoise(x * 2.2 + 7 + z * 1.3, y * 2.2 - z * 1.7, 0, 11) - 0.5) * 0.5;
        p.setXYZ(i, x * n * 1.3, Math.max(-0.2, y * n * 0.75), z * n);
      }
      g.computeVertexNormals();
      const nn = g.attributes.normal; for (let i = 0; i < p.count; i++) { const m = smooth(0.1, 0.8, nn.getY(i)); cc.push(0.7 - 0.25 * m, 0.72 + 0.05 * m, 0.66 - 0.25 * m); }
      g.setAttribute('color', new T.Float32BufferAttribute(cc, 3));
      const uv = []; for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 0.6 + p.getY(i) * 0.3, p.getZ(i) * 0.6 + p.getY(i) * 0.3);
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      B.geo(M.mossRock, g, null, {});
    }));
  };

  /* leaf cards cast alpha-tested shadows (dappled light) */
  F.afterBuild = function (meshes, M) {
    for (const m of meshes) {
      if (m.material === M.leafCard) { m.castShadow = false; m.receiveShadow = false; }
      else if (m.material === M.shadowOnly) { m.castShadow = true; m.receiveShadow = false; m.customDepthMaterial = M._leafDepth; }
    }
  };

  /* ------------------------------------------ placement ------------------------------------------ */
  // ctx: { I, col, SP, R, terrain, walk, region, inWalls, roadClear, c (wall centre line), detail }
  F.populate = function (ctx) {
    const { I, col, SP, R, terrain, walk, region, roadClear, c } = ctx;
    const placed = [];
    const glow = F.glowSpots = [];
    const clearOf = (x, z, extra) => !F.CLEARINGS.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + (extra || 0));
    const spaced = (x, z, d) => !placed.some((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < d * d);
    const wallClear = (x, z, m) => !(Math.abs(x) < c + m && Math.abs(z) < c + m);
    const tints = [0xffffff, 0xf2fff4, 0xe8f6ff, 0xfff6e0, 0xeae6ff, 0xffffff, 0xf2fff4, 0xd2c8ff];   // ~1 in 8 crowns lavender (mystic accent)
    const plant = (x, z, kind, sc, inside) => {
      const info = F.kinds[kind];
      const ry = R() * TAU, cs = Math.cos(ry), sn = Math.sin(ry);
      // instance rotation is about +y: local (lx, lz) -> world (lx*cos + lz*sin, -lx*sin + lz*cos)
      const W = (lx, lz) => [x + (lx * cs + lz * sn) * sc, z + (-lx * sn + lz * cs) * sc];
      I.add(kind, x, inside ? 0 : terrain.height(x, z) - 0.2, z, ry, sc, tints[Math.floor(R() * tints.length)]);
      placed.push({ x, z, kind, sc, info });
      if (inside) {
        col.circle(x, z, info.r0 * 1.75 * sc, 40, 'tree');
        for (const a of info.lobes) { const [lx, lz] = W(Math.cos(a) * info.r0 * 2.35, Math.sin(a) * info.r0 * 2.35); col.circle(lx, lz, 0.75 * sc, 1.6, 'tree'); }
        for (const rt of info.roots) { const [lx, lz] = W(rt.x, rt.z); col.circle(lx, lz, rt.r * sc, 0.9, 'tree'); }
      }
      // canopy shade + forest floor under the crown (baked: also valid outside the shadow map)
      const sp = info.spread * sc;
      SP.circle('ao', x, z, sp * 0.95, { blur: sp * 0.5, dark: 0.32 });
      SP.circle('ao', x, z, info.r0 * 3.2 * sc, { blur: 1.4, dark: 0.35 });
      SP.circle('forest', x, z, sp * 1.25, { blur: sp * 0.5, alpha: 0.9 });
    };
    // 1) walkable band outside the walls: giants with clearings for the camps, roads and fields kept open
    let n = 0;
    for (let k = 0; k < 2400 && n < 95; k++) {
      const x = V.lerp(walk.minX + 4, walk.maxX - 4, R()), z = V.lerp(walk.minZ + 4, walk.maxZ - 4, R());
      if (!wallClear(x, z, 14) || terrain.roadDist(x, z) < 9 || !roadClear(x, z, 5) || !clearOf(x, z, 1) || col.blocked(x, z, 5.5)) continue;
      const south = z > c + 10;
      if (!spaced(x, z, south ? 15 : 17)) continue;
      const kind = 'giant' + Math.floor(R() * GIANTS.length), sc = 0.85 + R() * 0.4;
      plant(x, z, kind, sc, true); n++;
    }
    F.stats = { giants: n };
    // the Meşe Korusu clearing gets a ring of giants right at its edge
    {
      const [gx, gz] = [66, 120];
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + 0.5, x = gx + Math.cos(a) * 15.5, z = gz + Math.sin(a) * 15.5; if (z > walk.maxZ - 3 || !spaced(x, z, 11) || col.blocked(x, z, 3)) continue; plant(x, z, 'giant' + (k % GIANTS.length), 0.95 + R() * 0.2, true); F.stats.giants++; }
    }
    // 2) beyond the boundary (hills): far LOD giants, denser with distance
    let far = 0;
    for (let k = 0; k < (ctx.world ? 0 : 3200) && far < 340; k++) {
      const x = V.lerp(region.minX - 70, region.maxX + 70, R()), z = V.lerp(walk.minZ - 110, walk.maxZ + 150, R());
      const ox = Math.max(walk.minX - x, 0, x - walk.maxX), oz = Math.max(walk.minZ - z, 0, z - walk.maxZ), out = Math.hypot(ox, oz);
      if (out < 4 || out > 150 || terrain.roadDist(x, z) < 8) continue;
      if (R() > V.smooth(2, 26, out) * (0.55 + 0.45 * V.ntab(x, z, 0.03))) continue;
      if (!spaced(x, z, out < 30 ? 15 : 19)) continue;
      const near = out < 12;
      const kind = near ? 'giant' + Math.floor(R() * GIANTS.length) : 'giantFar';
      plant(x, z, kind, 0.9 + R() * 0.45, false); far++;
    }
    F.stats.far = far;
    // 3) the colossal landmark beyond the north wall (seen over the keep when the camera tilts up)
    {
      const x = 46, z = walk.minZ - 46;
      I.add('titan', x, terrain.height(x, z) - 1.2, z, 0.8, 1.0, 0xf4f6ff);
      F.titan = { x, z, y: terrain.height(x, z) };
      for (let k = 0; k < 40; k++) { const a = R() * TAU, r = 8 + R() * 18; glow.push([x + Math.cos(a) * r, terrain.height(x, z) + 0.3 + R() * 2, z + Math.sin(a) * r, 1]); }
    }
    // 4) undergrowth around the giants of the walkable band: ferns, glowing mushrooms, moss logs / boulders
    for (const t of placed) {
      if (t.kind.startsWith('giantFar')) continue;
      const inside = t.x > walk.minX && t.x < walk.maxX && t.z > walk.minZ && t.z < walk.maxZ;
      const y0 = (x, z) => (inside ? 0 : terrain.height(x, z));
      const rr = t.info.r0 * t.sc;
      for (let k = 0; k < 7; k++) {
        const a = R() * TAU, r = rr * 2.6 + R() * 6, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        if (inside && (col.blocked(x, z, 0.6) || !roadClear(x, z, 1) || !clearOf(x, z, -2))) continue;
        I.add('fern', x, y0(x, z), z, R() * TAU, 0.8 + R() * 0.7, [0xffffff, 0xe6f6e0, 0xf4f0d8][k % 3]);
      }
      if (R() < 0.55) {
        const a = R() * TAU, r = rr * 2.1 + R() * 1.5, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        if (!inside || (!col.blocked(x, z, 0.4) && roadClear(x, z, 0.5))) {
          const hue = R() < 0.6 ? 0x5fe8d8 : R() < 0.5 ? 0x9a8cff : 0x8cf07a;
          I.add('shrooms', x, y0(x, z), z, R() * TAU, 0.9 + R() * 0.8, hue);
          glow.push([x, y0(x, z) + 0.35, z, 0, hue]);
        }
      }
      if (inside && R() < 0.22) {
        const a = R() * TAU, r = rr * 3 + 4 + R() * 3, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r, ry = R() * TAU;
        const ok = [-3.8, 0, 3.8].every((s) => { const px = x + Math.cos(ry) * s, pz = z - Math.sin(ry) * s; return !col.blocked(px, pz, 0.8) && roadClear(px, pz, 1.5) && clearOf(px, pz, -1); });
        if (ok) { I.add('mosslog', x, -0.12, z, ry, 1, 0xffffff); for (const s of [-3.2, -1.1, 1.1, 3.2]) col.circle(x + Math.cos(ry) * s, z - Math.sin(ry) * s, 0.7, 1.2, 'log'); }
      }
      if (R() < (inside ? 0.3 : 0.5)) {
        const a = R() * TAU, r = rr * 2.4 + 2 + R() * 4, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r, sc = 0.8 + R() * 1.1;
        if (!inside || (!col.blocked(x, z, sc * 1.3) && roadClear(x, z, sc + 0.5) && clearOf(x, z, -1))) { I.add('mossboulder', x, y0(x, z) - 0.1, z, R() * TAU, sc, 0xffffff); if (inside) col.circle(x, z, sc * 1.15, sc * 0.9, 'rock'); }
      }
    }
    F.placed = placed;
    return placed;
  };
})();
