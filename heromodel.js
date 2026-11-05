/* TDS MOBA - HeroModel v2: procedural humanoid anatomy + class outfits for the Knight rig (knight.js)
 *
 * GEOMETRY ONLY. knight.js owns the rig (joint groups), pose channels, IK, weapons and every animation; this module
 *   1. sets the rig's bind-pose proportions (pelvis height, leg length, shoulder width/height, neck, head size) so the
 *      figure is ~7.4 heads tall with legs ~half the stature (the legacy body had a long torso and a 1.3x ball head)
 *   2. builds the body as continuous SKINNED surfaces lofted from anatomical cross-sections (no visible primitives):
 *        torso  crotch -> pelvis -> waist -> rib cage -> chest -> trapezius -> neck        (one surface)
 *        arms   deltoid -> biceps / triceps -> elbow -> forearm (pronation twist) -> wrist
 *        legs   hip -> thigh -> knee -> calf -> ankle
 *      plus rigid parts on their joints: SDF-sculpted head + hair, one merged mesh per hand, boots
 *   3. dresses it: garments are OFFSET SHELLS of the same section functions (so they follow the body volume), with
 *      soft masks: outside its mask a shell sinks under the body, so hems are clean curves and nothing z-fights
 * Units: metres-ish. Bind pose = all joint rotations 0, character frame X = left, Y = up, Z = forward.
 * Entry point: HeroModel.build(ctx) from the Knight constructor (see the hook there).
 */
(function (global) {
  'use strict';
  const T = global.THREE;
  const PI = Math.PI, TAU = 2 * PI;

  /* ============================== small math ============================== */
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const gs = (x, c, s) => { const e = (x - c) / s; return Math.exp(-e * e); };
  const gs2 = (x, c, lo, hi) => gs(x, c, x < c ? lo : hi);                     // asymmetric gaussian
  const angD = (a, c) => Math.atan2(Math.sin(a - c), Math.cos(a - c));
  const ga = (a, c, s) => { const e = angD(a, c) / s; return Math.exp(-e * e); };   // gaussian on an angle
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), ux), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy);
  }
  const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = clamp01(0.5 + 0.5 * (b - a) / k); return lerp(b, a, h) - k * h * (1 - h); };
  const smax = (a, b, k) => -smin(-a, -b, k);

  // Piecewise cubic Hermite through keys [[x, v0, v1, ...], ...] (non-uniform Catmull-Rom tangents)
  function curve(keys) {
    const n = keys.length, dim = keys[0].length - 1, X = keys.map((k) => k[0]);
    const m = keys.map((k, i) => {
      const a = keys[Math.max(i - 1, 0)], b = keys[Math.min(i + 1, n - 1)], dx = b[0] - a[0], o = [];
      for (let j = 1; j <= dim; j++) o.push(dx > 0 ? (b[j] - a[j]) / dx : 0);
      return o;
    });
    return function (x, out) {
      out = out || new Array(dim);
      if (x <= X[0]) { for (let j = 0; j < dim; j++) out[j] = keys[0][j + 1]; return out; }
      if (x >= X[n - 1]) { for (let j = 0; j < dim; j++) out[j] = keys[n - 1][j + 1]; return out; }
      let i = 0; while (i < n - 2 && x > X[i + 1]) i++;
      const a = keys[i], b = keys[i + 1], h = X[i + 1] - X[i], t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      for (let j = 0; j < dim; j++) out[j] = h00 * a[j + 1] + h10 * h * m[i][j] + h01 * b[j + 1] + h11 * h * m[i + 1][j];
      return out;
    };
  }
  // radius of a super-ellipse (side half-width xr, front zf, back zb, exponent n) toward angle a (0 = +Z, pi/2 = +X)
  function seR(a, xr, zf, zb, n) {
    const s = Math.abs(Math.sin(a)), c = Math.cos(a), zr = c >= 0 ? zf : zb;
    if (xr < 1e-6 || zr < 1e-6) return 0;
    return 1 / Math.pow(Math.pow(s / xr, n) + Math.pow(Math.abs(c) / zr, n), 1 / n);
  }
  // rows along [v0, v1] spaced evenly by silhouette arc length (dense where the profile changes fast: shoulders, crotch)
  function arcRows(prof, v0, v1, n) {
    const S = 500, cum = [0];
    let prev = prof(v0);
    for (let i = 1; i <= S; i++) {
      const r = prof(v0 + (v1 - v0) * i / S);
      let dr = 0;
      for (let k = 0; k < r.length; k++) dr = Math.max(dr, Math.abs(r[k] - prev[k]));
      cum.push(cum[i - 1] + Math.hypot((v1 - v0) / S, dr));
      prev = r;
    }
    const out = [];
    let i = 1;
    for (let j = 0; j <= n; j++) {
      const s = cum[S] * j / n;
      while (i < S && cum[i] < s) i++;
      const f = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      out.push(v0 + (v1 - v0) * (i - 1 + clamp01(f)) / S);
    }
    return out;
  }
  const evenRows = (v0, v1, n) => Array.from({ length: n + 1 }, (_, j) => v0 + (v1 - v0) * j / n);

  /* ============================== geometry core ============================== */
  function putW(si, sw, k, ws) {
    const m = new Map();
    for (const [b, w] of ws) if (w > 1e-5) m.set(b, (m.get(b) || 0) + w);
    const e = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    let s = 0; for (const x of e) s += x[1];
    for (let i = 0; i < 4; i++) { si[4 * k + i] = i < e.length ? e[i][0] : 0; sw[4 * k + i] = i < e.length && s > 0 ? e[i][1] / s : 0; }
  }
  // average normals of coincident vertices (UV seams, poles) so smooth surfaces show no seam lines
  function weldNormals(g) {
    const P = g.attributes.position, N = g.attributes.normal, map = new Map();
    for (let i = 0; i < P.count; i++) {
      const key = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
      const l = map.get(key); if (l) l.push(i); else map.set(key, [i]);
    }
    const v = new T.Vector3();
    for (const l of map.values()) {
      if (l.length < 2) continue;
      v.set(0, 0, 0);
      for (const i of l) v.x += N.getX(i), v.y += N.getY(i), v.z += N.getZ(i);
      v.normalize();
      for (const i of l) N.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  }
  /* Lofted grid. rows: values of the along-parameter; columns: angles a0..a1 (full circle when a1 is omitted).
   * o.point(v, a, out, info) -> position (bind / local space). Optional o.weights(p, v, a, info) -> [[bone, w]...],
   * o.color(p, v, a, info) -> [r, g, b]. flip reverses the winding (use when the outward normal comes out inward). */
  function grid(o) {
    const R = o.rows, nr = R.length, nu = o.nu, a0 = o.a0 || 0, a1 = o.a1 === undefined ? a0 + TAU : o.a1;
    const nc = nu + 1, cnt = nr * nc;
    const pos = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2), col = new Float32Array(cnt * 3).fill(1);
    const si = o.weights ? new Uint16Array(cnt * 4) : null, sw = o.weights ? new Float32Array(cnt * 4) : null;
    const p = new T.Vector3(), info = {};
    const trim = !!o.trim, mA = trim ? new Float32Array(cnt) : null, nA = trim ? new Float32Array(cnt * 3) : null, dA = trim ? new Float32Array(cnt) : null;
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      const k = j * nc + i, a = a0 + (a1 - a0) * i / nu;
      info.m = 1; info.j = j; info.i = i; info.wp = null; info.n = null; info.depth = 0;
      o.point(R[j], a, p, info);
      pos[3 * k] = p.x; pos[3 * k + 1] = p.y; pos[3 * k + 2] = p.z;
      uv[2 * k] = (o.su || 1) * i / nu; uv[2 * k + 1] = (o.sv || 1) * j / Math.max(1, nr - 1);
      if (o.color) { const c = o.color(p, R[j], a, info); if (c) { col[3 * k] = c[0]; col[3 * k + 1] = c[1]; col[3 * k + 2] = c[2]; } }
      if (si) putW(si, sw, k, o.weights(info.wp || p, R[j], a, info));   // garments weigh at their body point
      if (trim) { mA[k] = info.m; dA[k] = info.depth; if (info.n) { nA[3 * k] = info.n.x; nA[3 * k + 1] = info.n.y; nA[3 * k + 2] = info.n.z; } }
    }
    const closed = Math.abs(a1 - a0 - TAU) < 1e-6;
    if (trim) {
      // garment edge = the mask's 0.5 contour: every outside vertex next to an inside one slides along that grid edge
      // onto the contour, so hems are clean curves at any grid resolution (no stair-stepping)
      const src = pos.slice(), NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const k = j * nc + i;
        if (mA[k] >= 0.5) continue;
        let n = 0, sx = 0, sy = 0, sz = 0, sd = 0;
        for (const [di, dj] of NB) {                       // average of the contour crossings on all edges to inside neighbours
          let ii = i + di; const jj = j + dj;
          if (closed) { if (ii < 0) ii = nu - 1; else if (ii > nu) ii = 1; }
          if (jj < 0 || jj >= nr || ii < 0 || ii > nu) continue;
          const kk = jj * nc + ii;
          if (mA[kk] < 0.5) continue;
          const f = (0.5 - mA[k]) / (mA[kk] - mA[k]);
          sx += src[3 * k] + (src[3 * kk] - src[3 * k]) * f; sy += src[3 * k + 1] + (src[3 * kk + 1] - src[3 * k + 1]) * f; sz += src[3 * k + 2] + (src[3 * kk + 2] - src[3 * k + 2]) * f;
          sd += dA[k] + (dA[kk] - dA[k]) * f; n++;
        }
        if (!n) continue;
        pos[3 * k] = sx / n; pos[3 * k + 1] = sy / n; pos[3 * k + 2] = sz / n; dA[k] = sd / n;
      }
    }
    const idx = [], keep = (x, y, z) => !trim || mA[x] >= 0.5 || mA[y] >= 0.5 || mA[z] >= 0.5;
    for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nu; i++) {
      const a = j * nc + i, b = a + 1, c = a + nc + 1, d = a + nc;
      if (o.flip) { if (keep(a, c, b)) idx.push(a, c, b); if (keep(a, d, c)) idx.push(a, d, c); }
      else { if (keep(a, b, c)) idx.push(a, b, c); if (keep(a, c, d)) idx.push(a, c, d); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (si) { g.setAttribute('skinIndex', new T.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4)); }
    g.setIndex(idx);
    g.computeVertexNormals();
    if (o.weld !== false) weldNormals(g);
    return trim ? addRims(g, nA, dA, nc, nu, closed) : g;
  }
  /* Rim strip along every open edge of a trimmed garment: the edge drops along -normal by its depth (down to the
   * layer underneath), so the cloth / leather shows its thickness instead of ending as a paper-thin sheet. */
  function addRims(g, nA, dA, nc, nu, closed) {
    const idx = g.index.array, canon = (k) => (closed && k % nc === nu ? k - nu : k), cnt = new Map(), dir = new Map();
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const u = idx[t + e], v = idx[t + (e + 1) % 3], cu = canon(u), cv = canon(v), key = cu < cv ? cu + '_' + cv : cv + '_' + cu;
      cnt.set(key, (cnt.get(key) || 0) + 1); dir.set(key, [u, v]);
    }
    const edges = [];
    for (const [key, c] of cnt) if (c === 1) edges.push(dir.get(key));
    if (!edges.length) return g;
    const A = g.attributes, n0 = A.position.count, n1 = n0 + edges.length * 4;
    const grow = (attr, Ty) => { const a = new Ty(n1 * attr.itemSize); a.set(attr.array); return a; };
    const P = grow(A.position, Float32Array), N = grow(A.normal, Float32Array), UV = grow(A.uv, Float32Array), C = grow(A.color, Float32Array);
    const SI = A.skinIndex ? grow(A.skinIndex, Uint16Array) : null, SW = A.skinWeight ? grow(A.skinWeight, Float32Array) : null;
    const ix = Array.from(idx), e1 = new T.Vector3(), e2 = new T.Vector3(), fn = new T.Vector3();
    let w = n0;
    const copyV = (dst, srcK, drop) => {
      for (let c = 0; c < 3; c++) P[3 * dst + c] = P[3 * srcK + c] - nA[3 * srcK + c] * drop;
      UV[2 * dst] = UV[2 * srcK]; UV[2 * dst + 1] = UV[2 * srcK + 1] + (drop ? 0.02 : 0);
      const k = drop ? 0.55 : 0.75;
      for (let c = 0; c < 3; c++) C[3 * dst + c] = C[3 * srcK + c] * k;
      if (SI) for (let c = 0; c < 4; c++) { SI[4 * dst + c] = SI[4 * srcK + c]; SW[4 * dst + c] = SW[4 * srcK + c]; }
    };
    for (const [u, v] of edges) {
      const U = w, V = w + 1, U2 = w + 2, V2 = w + 3; w += 4;
      copyV(U, u, 0); copyV(V, v, 0); copyV(U2, u, dA[u]); copyV(V2, v, dA[v]);
      ix.push(U, U2, V2, U, V2, V);
      e1.set(P[3 * U2] - P[3 * U], P[3 * U2 + 1] - P[3 * U + 1], P[3 * U2 + 2] - P[3 * U + 2]);
      e2.set(P[3 * V2] - P[3 * U], P[3 * V2 + 1] - P[3 * U + 1], P[3 * V2 + 2] - P[3 * U + 2]);
      fn.crossVectors(e1, e2).normalize();
      for (const q of [U, V, U2, V2]) { N[3 * q] = fn.x; N[3 * q + 1] = fn.y; N[3 * q + 2] = fn.z; }
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(P, 3)); out.setAttribute('normal', new T.BufferAttribute(N, 3));
    out.setAttribute('uv', new T.BufferAttribute(UV, 2)); out.setAttribute('color', new T.BufferAttribute(C, 3));
    if (SI) { out.setAttribute('skinIndex', new T.BufferAttribute(SI, 4)); out.setAttribute('skinWeight', new T.BufferAttribute(SW, 4)); }
    out.setIndex(ix);
    return out;
  }
  // concatenate geometries (indexed or not) that share position/normal/uv/color (+ optional skin attributes)
  function merge(list) {
    list = list.filter(Boolean);
    const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].filter((n) => list.every((g) => g.attributes[n]));
    const out = new T.BufferGeometry(), idx = [];
    let base = 0;
    const arrays = {};
    for (const n of names) arrays[n] = [];
    for (const g of list) {
      const cnt = g.attributes.position.count;
      for (const n of names) arrays[n].push(g.attributes[n].array);
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
      else for (let i = 0; i < cnt; i++) idx.push(i + base);
      base += cnt;
    }
    for (const n of names) {
      const it = list[0].attributes[n].itemSize, A = n === 'skinIndex' ? Uint16Array : Float32Array;
      const tot = arrays[n].reduce((s, a) => s + a.length, 0), arr = new A(tot);
      let o = 0; for (const a of arrays[n]) { arr.set(a, o); o += a.length; }
      out.setAttribute(n, new T.BufferAttribute(arr, it));
    }
    out.setIndex(idx);
    return out;
  }
  // give a geometry a uniform colour attribute (and uv if missing) so it can be merged / used with vertexColors
  function paint(g, c) {
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2]; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  }
  // point + outward unit normal of a parametric surface fn(v, a, out); sgn = +1 when v runs upward, -1 downward
  const _f = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];
  function frame(fn, v, a, P, N, sgn, dv) {
    fn(v, a, P);
    const A = _f[0], B = _f[1], C = _f[2], D = _f[3];
    fn(v + dv, a, A); fn(v - dv, a, B); fn(v, a + 0.02, C); fn(v, a - 0.02, D);
    A.sub(B); C.sub(D);
    N.crossVectors(C, A).multiplyScalar(sgn);
    const l = N.length();
    if (l < 1e-10) N.set(0, sgn, 0); else N.multiplyScalar(1 / l);
  }
  /* Garment shell over a body surface. cloth(v, a, out) = the smooth base it is offset from, body(...) = the visible
   * skin it sinks under where the mask is 0. mask(p, v, a) 0..1 (soft edges = rolled hems), thick(p, v, a) = offset. */
  function shell(o) {
    const P = new T.Vector3(), N = new T.Vector3(), WP = new T.Vector3(), NN = new T.Vector3(), dv = o.dv || 0.004;
    return grid({
      rows: o.rows, nu: o.nu, a0: o.a0, a1: o.a1, flip: o.sgn < 0, su: o.su, sv: o.sv, weights: o.weights, color: o.color, trim: true,
      point: (v, a, out, info) => {
        frame(o.cloth, v, a, P, N, o.sgn, dv);
        info.m = o.mask ? o.mask(P, v, a) : 1;
        info.wp = WP.copy(P); info.n = NN.copy(N);
        const t = o.thick(P, v, a, N);
        info.depth = t - (o.under || 0) + 0.005;                  // rim reaches just under the layer below
        return out.copy(P).addScaledVector(N, t);
      },
    });
  }
  /* Smooth tube through control points (Catmull-Rom). rad[i] = r or [r along `side`, r across]. Rounded caps.
   * Used for fingers, thumb, palm, hems, brows, the ear rim. */
  function tube(pts, rad, o) {
    o = o || {};
    const n = o.segs || 16, m = o.around || 10, cap = o.closed ? 0 : o.cap === undefined ? 3 : o.cap;
    const cv = new T.CatmullRomCurve3(pts, !!o.closed, 'catmullrom', 0.5), K = o.closed ? pts.length : pts.length - 1;
    const RR = (t) => {
      const f = t * K, i = Math.min(Math.floor(f), K - 1), u = f - i, s = u * u * (3 - 2 * u), j = (i + 1) % rad.length;
      const A = Array.isArray(rad[i]) ? rad[i] : [rad[i], rad[i]], B = Array.isArray(rad[j]) ? rad[j] : [rad[j], rad[j]];
      return [lerp(A[0], B[0], s), lerp(A[1], B[1], s)];
    };
    const rows = [];
    for (let k = cap; k >= 1; k--) { const q = k / cap * PI / 2; rows.push([0, Math.cos(q), -Math.sin(q)]); }
    for (let s = 0; s <= n; s++) rows.push([s / n, 1, 0]);
    for (let k = 1; k <= cap; k++) { const q = k / cap * PI / 2; rows.push([1, Math.cos(q), Math.sin(q)]); }
    const P = new T.Vector3(), Tg = new T.Vector3(), X = new T.Vector3(), Y = new T.Vector3();
    const g = grid({
      rows: rows.map((_, i) => i), nu: m, color: o.color,
      point: (j, a, out) => {
        const [t, sc, off] = rows[j];
        cv.getPoint(t, P); cv.getTangent(t, Tg);
        if (o.side) X.copy(o.side); else { X.set(0, 1, 0); if (Math.abs(Tg.y) > 0.9) X.set(1, 0, 0); }
        X.addScaledVector(Tg, -X.dot(Tg)).normalize();
        Y.crossVectors(Tg, X);
        const r = RR(t);
        out.copy(P).addScaledVector(X, Math.cos(a) * r[0] * sc).addScaledVector(Y, Math.sin(a) * r[1] * sc).addScaledVector(Tg, off * Math.max(r[0], r[1]));
      },
    });
    if (!o.color) paint(g, o.col || [1, 1, 1]);
    return g;
  }

  /* ============================== class specs ============================== */
  // Torso cross-sections for the warrior: [y, half-width, front depth, back depth, centre z, super-ellipse n]
  // (bind pose, pelvis joint at 1.20, hip joints 1.14, chest joint 1.50, shoulder joints 1.83, head joint 2.00)
  const TORSO = [
    [1.040, 0.000, 0.000, 0.000, -0.010, 2.0],
    [1.048, 0.125, 0.072, 0.082, -0.010, 2.0],
    [1.075, 0.222, 0.104, 0.118, -0.010, 2.3],
    [1.120, 0.244, 0.115, 0.130, -0.010, 2.5],
    [1.175, 0.244, 0.119, 0.130, -0.008, 2.6],
    [1.235, 0.230, 0.121, 0.119, -0.005, 2.5],
    [1.300, 0.210, 0.121, 0.107, -0.001, 2.4],
    [1.375, 0.196, 0.123, 0.102, 0.002, 2.4],
    [1.450, 0.204, 0.128, 0.107, 0.004, 2.4],
    [1.525, 0.222, 0.137, 0.117, 0.004, 2.5],
    [1.600, 0.238, 0.147, 0.126, 0.004, 2.6],
    [1.665, 0.248, 0.151, 0.130, 0.002, 2.7],
    [1.725, 0.250, 0.145, 0.130, 0.000, 2.8],
    [1.785, 0.245, 0.129, 0.126, -0.004, 2.9],
    [1.840, 0.231, 0.105, 0.112, -0.008, 2.8],
    [1.880, 0.195, 0.084, 0.094, -0.010, 2.5],
    [1.910, 0.136, 0.070, 0.080, -0.010, 2.2],
    [1.935, 0.088, 0.063, 0.070, -0.006, 2.1],
    [1.965, 0.071, 0.059, 0.064, 0.000, 2.0],
    [2.010, 0.066, 0.056, 0.060, 0.008, 2.0],
    [2.060, 0.060, 0.050, 0.056, 0.014, 2.0],
    [2.080, 0.000, 0.000, 0.000, 0.016, 2.0],
  ];
  // Arm sections, d = distance below the shoulder joint: [d, lateral half-width, front-back half-depth, centre z, centre shift outward]
  const ARM = [
    [-0.074, 0.000, 0.000, 0.000, -0.032],
    [-0.066, 0.038, 0.044, 0.000, -0.029],
    [-0.046, 0.070, 0.076, 0.000, -0.019],
    [-0.015, 0.093, 0.095, 0.000, -0.007],
    [0.030, 0.101, 0.098, 0.000, 0.000],
    [0.090, 0.095, 0.092, 0.000, 0.002],
    [0.150, 0.085, 0.087, 0.002, 0.000],
    [0.215, 0.078, 0.084, 0.004, 0.000],
    [0.280, 0.073, 0.076, 0.004, 0.000],
    [0.340, 0.068, 0.065, 0.000, 0.000],
    [0.380, 0.068, 0.061, -0.002, 0.000],
    [0.420, 0.073, 0.065, 0.000, 0.000],
    [0.470, 0.075, 0.065, 0.004, 0.000],
    [0.550, 0.067, 0.055, 0.004, 0.000],
    [0.630, 0.057, 0.046, 0.002, 0.000],
    [0.700, 0.051, 0.039, 0.000, 0.000],
    [0.760, 0.049, 0.035, 0.000, 0.000],
    [0.792, 0.043, 0.030, 0.000, 0.000],
    [0.806, 0.000, 0.000, 0.000, 0.000],
  ];
  // Leg sections (trouser surface), d = distance below the hip joint:
  // [d, outer half-width, inner half-width, front, back, centre z, centre shift outward]
  const LEG = [
    [-0.105, 0.000, 0.000, 0.000, 0.000, 0.000, -0.01],
    [-0.090, 0.055, 0.048, 0.058, 0.062, 0.000, -0.01],
    [-0.050, 0.088, 0.084, 0.098, 0.104, 0.000, -0.004],
    [0.000, 0.102, 0.098, 0.112, 0.118, 0.002, 0.002],
    [0.080, 0.106, 0.103, 0.117, 0.116, 0.008, 0.002],
    [0.180, 0.104, 0.101, 0.113, 0.106, 0.012, 0.000],
    [0.300, 0.096, 0.094, 0.104, 0.095, 0.012, -0.004],
    [0.410, 0.087, 0.090, 0.094, 0.084, 0.010, -0.008],
    [0.480, 0.080, 0.084, 0.088, 0.076, 0.012, -0.008],
    [0.530, 0.076, 0.077, 0.086, 0.070, 0.014, -0.006],
    [0.590, 0.072, 0.072, 0.074, 0.072, 0.008, -0.004],
    [0.670, 0.073, 0.075, 0.062, 0.086, 0.002, -0.004],
    [0.760, 0.066, 0.068, 0.056, 0.076, 0.002, -0.002],
    [0.860, 0.057, 0.057, 0.052, 0.060, 0.004, 0.000],
    [0.950, 0.050, 0.052, 0.048, 0.051, 0.006, 0.000],
    [0.985, 0.000, 0.000, 0.000, 0.000, 0.006, 0.000],
  ];
  const SPECS = {
    warrior: {
      rig: { hipY: 1.20, leg: 0.525, hipX: 0.14, shX: 0.28, shY: 0.33, headY: 0.50, headScale: 1.0 },
      t: { chest: 1.06, waist: 1.03, hip: 1, depth: 1.04, neck: 1.1 }, armK: 0.88, armMus: 1, legK: 1.02,
      det: { pec: 0.022, scap: 0.012, lat: 0.010, glute: 0.016, clav: 0.005, scm: 0.005, sternum: 0.008, abs: 0.006, alba: 0.004, spine: 0.010, adam: 0.005 },
      skin: 0x9c5f44, hair: 0x241b16, iris: 0x2e1e14,
      face: { jaw: 1.08, chin: 1.12, brow: 1.2, nose: 1.0, noseW: 1.08, cheek: 1.0, lip: 1.0, sock: 1.0, tilt: -0.06 },
      hairStyle: 'short', beard: 'stubble', browSet: -0.004,
    },
    archer: {
      rig: { hipY: 1.20, leg: 0.525, hipX: 0.14, shX: 0.265, shY: 0.33, headY: 0.495, headScale: 0.975 },
      t: { chest: 0.9, waist: 0.86, hip: 0.93, depth: 0.9, neck: 0.92 }, armK: 0.75, armMus: 0.7, legK: 0.92,
      det: { pec: 0.012, scap: 0.010, lat: 0.008, glute: 0.012, clav: 0.006, scm: 0.005, sternum: 0.006, abs: 0.005, alba: 0.004, spine: 0.009, adam: 0.004 },
      skin: 0xa8765a, hair: 0x5a3c25, iris: 0x3d4a2a,
      face: { jaw: 0.93, chin: 0.95, brow: 0.95, nose: 1.04, noseW: 0.92, cheek: 1.25, lip: 0.92, sock: 1.0, tilt: 0.0 },
      hairStyle: 'tied', beard: 'none', browSet: 0.002,
    },
    mage: {
      rig: { hipY: 1.20, leg: 0.525, hipX: 0.135, shX: 0.26, shY: 0.33, headY: 0.495, headScale: 0.97 },
      t: { chest: 0.86, waist: 0.86, hip: 0.92, depth: 0.88, neck: 0.88 }, armK: 0.7, armMus: 0.5, legK: 0.9,
      det: { pec: 0.008, scap: 0.008, lat: 0.006, glute: 0.012, clav: 0.006, scm: 0.006, sternum: 0.005, abs: 0.003, alba: 0.003, spine: 0.008, adam: 0.006 },
      skin: 0x936550, hair: 0x2e2622, iris: 0x2c3540,
      face: { jaw: 0.94, chin: 1.0, brow: 1.05, nose: 1.12, noseW: 0.95, cheek: 1.1, lip: 0.9, sock: 1.15, tilt: 0.04 },
      hairStyle: 'swept', beard: 'beard', browSet: -0.001,
    },
  };

  /* ============================== rig proportions ============================== */
  function applyRig(knight, J, S) {
    const r = S.rig;
    J.hips.position.y = r.hipY;
    J.spine.position.y = 0.1; J.chest.position.y = 0.2;
    for (const [k, s] of [['L', 1], ['R', -1]]) {
      J['th' + k].position.set(s * r.hipX, -0.06, 0);
      J['kn' + k].position.set(0, -r.leg, 0);
      J['an' + k].position.set(0, -r.leg, 0);
      J['sh' + k].position.set(s * r.shX, r.shY, 0);
    }
    J.head.position.set(0, r.headY, 0);
    J.head.scale.setScalar(r.headScale);
    J.plume.position.set(0, 0.215, -0.1);
    knight.legLen = r.leg;                                        // knight.js leg IK uses this length
    J.spin.parent.updateMatrixWorld(true);
    const w = (o) => o.getWorldPosition(new T.Vector3());
    const R = {
      hipY: w(J.hips).y, hipJ: w(J.thL).y, hipX: r.hipX, spineY: w(J.spine).y, chestY: w(J.chest).y,
      shY: w(J.shL).y, shX: r.shX, headY: w(J.head).y, kneeY: w(J.knL).y, ankleY: w(J.anL).y, leg: r.leg, armSeg: -J.elL.position.y,
    };
    R.beltY = R.hipY + 0.088;                                     // belt centre (just above the iliac crest)
    return R;
  }
  // remove the legacy body / clothing meshes (joint groups, weapons and helper groups stay)
  function strip(knight, J, root) {
    const kill = (o) => { o.parent.remove(o); if (o.geometry) o.geometry.dispose(); };
    for (const k in J) for (const c of J[k].children.slice()) if (c.isMesh) kill(c);
    for (const k in knight._fists || {}) for (const c of knight._fists[k].children.slice()) if (c.isMesh) kill(c);
    for (const c of root.children.slice()) if (c.isSkinnedMesh) kill(c);
  }

  /* ============================== body surfaces ============================== */
  function torsoDetail(S, R, y, a, layer) {
    const D = S.det, lo = layer ? 0.6 : 1, yPec = R.chestY + 0.158, yClav = R.shY + 0.035;
    let r = 0;
    for (const s of [-1, 1]) {
      r += D.pec * lo * ga(a, s * 0.45, 0.42) * gs2(y, yPec, 0.028, 0.075);                   // pectorals: soft top, defined lower edge
      r += D.scap * lo * ga(a, PI - s * 0.62, 0.36) * gs(y, yPec + 0.085, 0.07);              // shoulder blades
      r += D.lat * lo * ga(a, s * (PI / 2 + 0.32), 0.36) * gs(y, yPec - 0.03, 0.09);          // lats
      r += D.glute * ga(a, PI - s * 0.5, 0.45) * gs2(y, R.hipJ - 0.005, 0.045, 0.075);          // glutes (also under cloth)
      if (!layer) {
        r += D.clav * ga(a, s * 0.62, 0.4) * gs(y, yClav, 0.012);                             // collar bones
        r += D.scm * ga(a, s * 0.7, 0.3) * gs(y, R.headY - 0.045, 0.03);                      // neck muscles
        r += 0.004 * ga(a, s * 1.1, 0.35) * gs(y, R.hipY + 0.06, 0.03);                        // iliac crest
      }
    }
    if (!layer) {
      r -= D.sternum * ga(a, 0, 0.09) * sstep(yPec - 0.11, yPec - 0.04, y) * sstep(yClav + 0.01, yClav - 0.05, y);
      r += D.abs * ga(a, 0, 0.42) * gs(y, R.hipY + 0.22, 0.075) - D.alba * ga(a, 0, 0.07) * gs(y, R.hipY + 0.26, 0.1);
      r -= D.spine * ga(a, PI, 0.1) * sstep(R.hipY + 0.06, R.hipY + 0.14, y) * sstep(yClav + 0.04, yClav - 0.04, y);
      r += D.adam * ga(a, 0, 0.14) * gs(y, R.headY - 0.02, 0.013);
    }
    return r;
  }
  function makeTorso(S, R) {
    const t = S.t, sh = R.shX / 0.28;
    const keys = TORSO.map((k) => {
      const y = k[0];
      const wk = y < 1.3 ? lerp(t.hip, t.waist, sstep(1.17, 1.33, y)) : y < 1.55 ? lerp(t.waist, t.chest, sstep(1.42, 1.58, y)) : lerp(t.chest, sh, sstep(1.74, 1.82, y));
      const fk = y > 1.92 ? t.neck : wk;
      const dk = y > 1.92 ? t.neck : lerp(t.depth, 1, sstep(1.85, 1.92, y) * 0.5);
      return [y, k[1] * fk, k[2] * dk, k[3] * dk, k[4], k[5]];
    });
    const tab = curve(keys), q = [0, 0, 0, 0, 0];
    const fn = (layer, extra) => (y, a, out) => {
      tab(y, q);
      const W = Math.max(q[0], 0), F = Math.max(q[1], 0), B = Math.max(q[2], 0);
      let r = seR(a, W, F, B, q[4]);
      if (r > 1e-5) r = Math.max(0.0005, r + (torsoDetail(S, R, y, a, layer) + (extra ? extra(y, a) : 0)) * sstep(0.0, 0.05, Math.min(W, F, B)));
      return out.set(Math.sin(a) * r, y, q[3] + Math.cos(a) * r);
    };
    fn.prof = (y) => { tab(y, q); return [q[0], q[1], q[2]]; };
    fn.y0 = TORSO[0][0]; fn.y1 = TORSO[TORSO.length - 1][0];
    return fn;
  }
  function armDetail(S, side, d, ph) {
    const A = S.armMus, o = side * PI / 2;
    return A * (0.014 * ga(ph, 0, 0.75) * gs(d, 0.215, 0.075)                       // biceps
      + 0.011 * ga(ph, PI - side * 0.35, 0.8) * gs(d, 0.15, 0.085)                   // triceps
      + 0.007 * ga(ph, o, 0.9) * gs(d, 0.04, 0.06)                                   // deltoid
      + 0.010 * ga(ph, side * (PI / 2 - 0.6), 0.65) * gs(d, 0.465, 0.07)             // brachioradialis / extensors
      + 0.007 * ga(ph, side * (-PI / 2 + 0.5), 0.7) * gs(d, 0.48, 0.08))             // flexors
      + 0.007 * ga(ph, PI, 0.4) * gs(d, 0.385, 0.02);                                // olecranon
  }
  function makeArm(S, R, side) {
    const K = S.armK, keys = ARM.map((k) => [k[0], k[1] * K, k[2] * K, k[3], k[4]]);
    const tab = curve(keys), q = [0, 0, 0, 0], sx = side * R.shX, s0 = R.shY;
    const fn = (layer, extra) => (d, a, out) => {
      tab(d, q);
      // forearm pronation: the flat axis turns from the elbow's X to the wrist's Z (thumb forward, back of the hand out)
      const ph = a + side * (PI / 2) * sstep(0.44, 0.74, d);
      let r = seR(ph, Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[1], 0), 2.1);
      if (r > 1e-5) r += ((layer ? 0.6 : 1) * armDetail(S, side, d, ph) + (extra ? extra(d, ph) : 0)) * sstep(0, 0.03, Math.min(q[0], q[1]));
      return out.set(sx + side * q[3] + Math.sin(a) * r, s0 - d, q[2] + Math.cos(a) * r);
    };
    fn.prof = (d) => { tab(d, q); return [q[0], q[1]]; };
    fn.d0 = keys[0][0]; fn.d1 = keys[keys.length - 1][0];
    return fn;
  }
  function makeLeg(S, R, side) {
    const K = S.legK, keys = LEG.map((k) => [k[0], k[1] * K, k[2] * K, k[3] * K, k[4] * K, k[5], k[6]]);
    const tab = curve(keys), q = [0, 0, 0, 0, 0, 0], hx = side * R.hipX, h0 = R.hipJ;
    const fn = (layer, extra) => (d, a, out) => {
      tab(d, q);
      const s = Math.sin(a), c = Math.cos(a), outer = s * side >= 0;
      let r = seR(a, Math.max(outer ? q[0] : q[1], 0), Math.max(q[2], 0), Math.max(q[3], 0), 2.15);
      if (r > 1e-5) r += (0.006 * ga(a, 0, 0.5) * gs(d, R.leg + 0.005, 0.03) + (extra ? extra(d, a) : 0)) * sstep(0, 0.03, Math.min(q[0], q[2]));
      return out.set(hx + side * q[5] + s * r, h0 - d, q[4] + c * r);
    };
    fn.prof = (d) => { tab(d, q); return [q[0], q[1], q[2], q[3]]; };
    fn.d0 = keys[0][0]; fn.d1 = keys[keys.length - 1][0];
    return fn;
  }

  /* ---------- skin weights ---------- */
  function torsoWeights(kit) {
    const R = kit.R, B = kit.B;
    return (p) => {
      const y = p.y, ax = Math.abs(p.x), L = p.x >= 0;
      const a = sstep(R.spineY - 0.07, R.spineY + 0.05, y), b = sstep(R.chestY - 0.08, R.chestY + 0.06, y), c = sstep(R.headY - 0.075, R.headY + 0.005, y);
      let wh = 1 - a, wsp = a * (1 - b), wc = b * (1 - c);
      const sh = 0.26 * sstep(0.12, 0.24, ax) * gs(y, R.shY + 0.01, 0.085);          // shoulder girdle rides along with its arm
      const tw = 0.6 * sstep(R.hipJ + 0.03, R.hipJ - 0.09, y), sL = sstep(-0.05, 0.05, p.x);   // lower pelvis follows the thighs
      const o = [[L ? B.shL : B.shR, wc * sh], [B.thL, wh * tw * sL], [B.thR, wh * tw * (1 - sL)]];
      wc *= 1 - sh; wh *= 1 - tw;
      o.push([B.hips, wh], [B.spine, wsp], [B.chest, wc], [B.head, c]);
      return o;
    };
  }
  function armWeights(kit, side) {
    const B = kit.B, k = side > 0 ? 'L' : 'R', A = kit.R.armSeg;
    return (p, d, a) => {
      const wch = 0.8 * sstep(0.035, -0.08, d);                                     // deltoid top stays with the chest
      const e = sstep(A - 0.05, A + 0.05, d - 0.016 * Math.cos(a));                  // elbow: crease side stays with the upper arm
      const w = 0.3 * sstep(2 * A - 0.04, 2 * A + 0.02, d);
      return [[B.chest, wch], [B['sh' + k], (1 - wch) * (1 - e)], [B['el' + k], (1 - wch) * e * (1 - w)], [B['wrist' + k], (1 - wch) * e * w]];
    };
  }
  function legWeights(kit, side) {
    const B = kit.B, k = side > 0 ? 'L' : 'R', L = kit.R.leg;
    return (p, d, a) => {
      const wh = 0.95 * sstep(0.06, -0.07, d);
      const e = sstep(L - 0.06, L + 0.06, d + 0.02 * Math.cos(a));                   // knee: back crease stays with the thigh
      const an = 0.75 * sstep(2 * L - 0.08, 2 * L - 0.01, d);
      return [[B.hips, wh], [B['th' + k], (1 - wh) * (1 - e)], [B['kn' + k], (1 - wh) * e * (1 - an)], [B['an' + k], (1 - wh) * e * an]];
    };
  }

  /* ---------- body builders ---------- */
  function addSkinned(kit, geo, mat) {
    if (kit.record) kit.record.push({ skinned: true, geo, mat: matKey(kit, mat) });
    const m = new T.SkinnedMesh(geo, mat);
    m.castShadow = true; m.frustumCulled = false;
    kit.root.add(m); m.bind(kit.skeleton, new T.Matrix4());
    kit.meshes.push(m);
    return m;
  }
  // three r128 compiles a material's program once: a skinning material on a plain Mesh (or the reverse) breaks one of
  // them. Rigid parts therefore get a non-skinning twin that shares the colour object (setTeam / tints still apply).
  function rigidMat(kit, mat) {
    if (!mat.skinning) return mat;
    kit.rigid = kit.rigid || new Map();
    let c = kit.rigid.get(mat);
    if (!c) {
      c = mat.clone(); c.skinning = false; c.color = mat.color;
      c.userData = { e0: c.emissive.clone() };
      kit.knight.mats.push(c); kit.rigid.set(mat, c);
    }
    return c;
  }
  // skin a geometry authored in bind space with a weight function (trims, rolls, straps that ride a skinned surface)
  function skinGeo(geo, wfn) {
    const P = geo.attributes.position, n = P.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), p = new T.Vector3();
    for (let i = 0; i < n; i++) { p.set(P.getX(i), P.getY(i), P.getZ(i)); putW(si, sw, i, wfn(p)); }
    geo.setAttribute('skinIndex', new T.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    return geo;
  }
  const matKey = (kit, mat) => (Array.isArray(mat) ? mat.map((m) => matKey(kit, m)) : Object.keys(kit.mats).find((k) => kit.mats[k] === mat));
  function parentKey(kit, o) {
    for (const k in kit.J) if (kit.J[k] === o) return 'J.' + k;
    for (const k in kit.knight._fists) if (kit.knight._fists[k] === o) return 'F.' + k;
    return null;
  }
  function addRigid(kit, parent, geo, mat) {
    if (kit.record) kit.record.push({ skinned: false, parent: parentKey(kit, parent), geo, mat: matKey(kit, mat) });
    const m = new T.Mesh(geo, rigidMat(kit, mat));
    m.castShadow = true; parent.add(m); kit.meshes.push(m);
    return m;
  }
  // torso: one surface, o.split = y below which the low material is used (trouser seat), above it the skin
  function bodyTorso(kit, o) {
    const fn = kit.torso(0), R = kit.R;
    const rows = arcRows(kit.torso.prof, kit.torso.y0, kit.torso.y1, o.rows || 56);
    const col = o.color || ((p) => {
      const ax = Math.abs(p.x);
      const k = 1 - 0.14 * sstep(0.13, 0.21, ax) * gs(p.y, R.shY - 0.13, 0.06) - 0.08 * gs(p.y, R.headY - 0.03, 0.03) * sstep(-0.02, 0.05, p.z);
      return [k, k * 0.985, k * 0.975];
    });
    const g = grid({ rows, nu: o.nu || 36, point: (y, a, out) => fn(y, a, out), weights: torsoWeights(kit), color: col, su: 3, sv: 2 });
    let mat = o.highMat;
    if (o.split !== undefined) {
      const nc = (o.nu || 36) + 1;
      let js = rows.findIndex((y) => y > o.split); if (js < 1) js = 1;
      const cut = (js - 1) * (nc - 1) * 6;
      g.addGroup(0, cut, 0); g.addGroup(cut, g.index.count - cut, 1);
      mat = [o.lowMat, o.highMat];
    }
    return addSkinned(kit, g, mat);
  }
  function bodyArm(kit, side, mat, o) {
    o = o || {};
    const A = kit.arm[side], fn = A(0, o.extra);
    const rows = arcRows(A.prof, A.d0, o.d1 || A.d1, o.rows || 44);
    const R = kit.R;
    const col = o.color || ((p, d, a) => {
      const k = 1 - 0.06 * gs(d, R.armSeg, 0.03) * ga(a, 0, 0.6) + 0.02 * gs(d, 0.04, 0.06);
      const red = 0.03 * gs(d, R.armSeg + 0.005, 0.025) * ga(a, PI, 0.5);
      return [k, k * (1 - red), k * (1 - red * 1.2)];
    });
    return addSkinned(kit, grid({ rows, nu: o.nu || 20, flip: true, point: (d, a, out) => fn(d, a, out), weights: armWeights(kit, side), color: col, su: 1.5, sv: 2 }), mat);
  }
  function bodyLeg(kit, side, mat, o) {
    o = o || {};
    const Lg = kit.leg[side], fn = Lg(0, o.extra);
    const rows = arcRows(Lg.prof, Lg.d0, o.d1 || Lg.d1, o.rows || 40);
    const col = o.color || ((p, d, a) => { const k = 1 - 0.1 * gs(d, -0.02, 0.05) * sstep(0.3, -0.5, Math.sin(a) * side) - 0.06 * gs(d, kit.R.leg + 0.02, 0.03) * ga(a, PI, 0.6); return [k, k, k]; });
    return addSkinned(kit, grid({ rows, nu: o.nu || 20, flip: true, point: (d, a, out) => fn(d, a, out), weights: legWeights(kit, side), color: col, su: 1.5, sv: 2.5 }), mat);
  }
  // garment shell on the torso
  function torsoShell(kit, o) {
    const T0 = kit.torso, R = kit.R;
    const rows = arcRows(T0.prof, o.y0, o.y1, o.rows || 40);
    return addSkinned(kit, shell({
      rows, nu: o.nu || 36, sgn: 1, cloth: T0(1, o.extra), body: T0(0), mask: o.mask, thick: o.thick, under: o.under,
      weights: torsoWeights(kit), color: o.color, su: 3, sv: 2,
    }), o.mat);
  }
  function armShell(kit, side, o) {
    const A = kit.arm[side];
    const rows = arcRows(A.prof, o.d0, o.d1, o.rows || 24);
    return addSkinned(kit, shell({
      rows, nu: o.nu || 20, sgn: -1, under: o.under, cloth: A(o.layer === undefined ? 1 : o.layer, o.extra), body: A(0), mask: o.mask && ((p, d, a) => o.mask(p, d, a, side)),
      thick: (p, d, a) => o.thick(p, d, a, side), weights: armWeights(kit, side), color: o.color && ((p, d, a, i) => o.color(p, d, a, i, side)), su: 1.5, sv: 1.5,
    }), o.mat);
  }
  function legShell(kit, side, o) {
    const Lg = kit.leg[side];
    const rows = arcRows(Lg.prof, o.d0, o.d1, o.rows || 22);
    const lw = legWeights(kit, side);
    return addSkinned(kit, shell({
      rows, nu: o.nu || 20, sgn: -1, under: o.under, cloth: Lg(1, o.extra), body: Lg(0), mask: o.mask && ((p, d, a) => o.mask(p, d, a, side)),
      thick: (p, d, a) => o.thick(p, d, a, side), weights: o.weights ? o.weights(lw, side) : lw, color: o.color && ((p, d, a, i) => o.color(p, d, a, i, side)), su: 1.5, sv: 1.5,
    }), o.mat);
  }

  /* ============================== head (SDF sculpt) ============================== */
  // Head-local units: pivot (top of the neck) at the origin, chin ~ -0.03, eyes 0.124, brow 0.15, crown 0.27.
  function headSDF(F) {
    const P = [];
    const add = (c, r, k, s) => P.push([c[0], c[1], c[2], 1 / (r[0] * r[0]), 1 / (r[1] * r[1]), 1 / (r[2] * r[2]), Math.min(r[0], r[1], r[2]), k, s]);
    const both = (c, r, k, s) => { add([c[0], c[1], c[2]], r, k, s); add([-c[0], c[1], c[2]], r, k, s); };
    add([0, 0.150, -0.010], [0.094, 0.120, 0.118], 0, 1);                                   // cranium
    add([0, 0.088, 0.036], [0.078 * F.cheek ** 0.2, 0.078, 0.079], 0.035, 1);              // mid face / maxilla
    add([0, 0.030, 0.030], [0.064 * F.jaw, 0.048, 0.072], 0.03, 1);                          // mandible
    add([0, -0.002, 0.080], [0.027 * F.chin, 0.028, 0.022], 0.02, 1);                         // chin
    both([0.056 * F.jaw, 0.026, -0.004], [0.017, 0.03, 0.03], 0.028, 1);                     // jaw angles
    both([0.057, 0.103, 0.06], [0.027, 0.014 * F.cheek, 0.028], 0.024, 1);                 // cheekbones
    add([0, 0.150, 0.085], [0.07, 0.016 * F.brow, 0.022 * F.brow], 0.014, 1);               // brow ridge
    add([0, 0.120, 0.105], [0.0105 * F.noseW, 0.028, 0.013], 0.012, 1);                    // nose bridge
    add([0, 0.086, 0.119], [0.0135 * F.noseW, 0.034 * F.nose, 0.019 * F.nose], 0.01, 1);   // nose
    add([0, 0.066, 0.131 + 0.004 * (F.nose - 1)], [0.0132 * F.noseW, 0.0128, 0.0122], 0.006, 1);   // nose tip
    both([0.0145 * F.noseW, 0.064, 0.117], [0.0102, 0.0094, 0.0108], 0.006, 1);            // nostril wings
    add([0, 0.037, 0.105], [0.025 * F.lip, 0.0092, 0.0118], 0.008, 1);                       // upper lip
    add([0, 0.022, 0.101], [0.021 * F.lip, 0.0085, 0.0118], 0.008, 1);                       // lower lip
    both([0.034, 0.124, 0.110], [0.021, 0.0155 * F.sock, 0.02], 0.01, -1);                   // eye sockets
    add([0, 0.0296, 0.116], [0.021 * F.lip, 0.0011, 0.011], 0.0025, -1);                      // mouth line
    both([0.09, 0.142, 0.052], [0.015, 0.024, 0.026], 0.025, -1);                             // temples
    add([0, 0.012, 0.118], [0.03, 0.006, 0.014], 0.008, -1);                                 // groove under the lower lip
    return (x, y, z) => {
      let d = 0;
      for (let i = 0; i < P.length; i++) {
        const q = P[i], X = x - q[0], Y = y - q[1], Z = z - q[2];
        const k0 = Math.sqrt(X * X * q[3] + Y * Y * q[4] + Z * Z * q[5]);
        const k1 = Math.sqrt(X * X * q[3] * q[3] + Y * Y * q[4] * q[4] + Z * Z * q[5] * q[5]);
        const e = k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -q[6];
        d = i === 0 ? e : q[8] > 0 ? smin(d, e, q[7]) : smax(d, -e, q[7]);
      }
      return d;
    };
  }
  const HEAD_C = [0, 0.115, 0.004];
  // head surface on a grid: rows = polar angle from the crown, columns = azimuth (0 = face, seam at the back of the head)
  function projectHead(sdf, nu, nr, color) {
    const dir = new T.Vector3();
    return grid({
      rows: evenRows(0, PI, nr), nu, a0: -PI, a1: PI, flip: true, color,
      point: (th, ph, out) => {
        dir.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
        let r = 0.36;
        for (let it = 0; it < 80; it++) {
          const d = sdf(HEAD_C[0] + dir.x * r, HEAD_C[1] + dir.y * r, HEAD_C[2] + dir.z * r);
          if (Math.abs(d) < 2e-5) break;
          r -= d * 0.85;
          if (r < 0.01) { r = 0.01; break; }
        }
        return out.set(HEAD_C[0] + dir.x * r, HEAD_C[1] + dir.y * r, HEAD_C[2] + dir.z * r);
      },
    });
  }
  // z of the face surface at (x, y), marching forward from inside
  function faceZ(sdf, x, y) {
    let z = 0.02;
    while (z < 0.2 && sdf(x, y, z) < 0) z += 0.002;
    let lo = z - 0.002, hi = z;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (sdf(x, y, m) < 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  const g3 = (p, c, s) => { const x = (p.x - c[0]) / s[0], y = (p.y - c[1]) / s[1], z = (p.z - c[2]) / s[2]; return Math.exp(-(x * x + y * y + z * z)); };
  // hairline height by direction around the head (psi = 0 front, +-pi back), per style
  function hairLine(psi, style) {
    const a = Math.abs(psi);
    const k = style === 'swept'
      ? [[0, 0.232], [0.45, 0.205], [0.9, 0.19], [1.2, 0.13], [1.45, 0.16], [1.9, 0.11], [2.4, 0.04], [PI, -0.02]]
      : style === 'tied'
        ? [[0, 0.236], [0.45, 0.218], [0.9, 0.195], [1.2, 0.12], [1.45, 0.155], [1.9, 0.11], [2.4, 0.06], [PI, 0.035]]
        : [[0, 0.238], [0.45, 0.21], [0.9, 0.19], [1.2, 0.105], [1.45, 0.16], [1.9, 0.12], [2.4, 0.07], [PI, 0.04]];
    for (let i = 0; i < k.length - 1; i++) if (a <= k[i + 1][0]) { const u = (a - k[i][0]) / (k[i + 1][0] - k[i][0]); return lerp(k[i][1], k[i + 1][1], u * u * (3 - 2 * u)); }
    return k[k.length - 1][1];
  }
  function hairAmount(p, S) {
    const psi = Math.atan2(p.x, p.z), line = hairLine(psi, S.hairStyle);
    const wob = 0.0012 * Math.cos(psi * 26);
    let m = sstep(line - 0.01, line + 0.014, p.y + wob);
    const aps = Math.abs(psi);
    if (aps > 1.2 && aps < 1.75) m *= 1 - sstep(0.16, 0.12, p.y) * sstep(1.25, 1.35, aps) * sstep(1.75, 1.62, aps);   // clear the ears
    return m;
  }
  function hairThickness(p, S) {
    const top = sstep(0.15, 0.27, p.y);
    if (S.hairStyle === 'swept') return 0.011 + 0.016 * top + 0.012 * sstep(0.0, -0.1, p.z) * sstep(0.22, 0.08, p.y);
    if (S.hairStyle === 'tied') return 0.009 + 0.012 * top;
    return 0.0055 + 0.011 * top + 0.004 * sstep(0.02, 0.09, p.z) * top;
  }
  function beardAmount(p, S) {
    if (S.beard !== 'beard') return 0;
    const psi = Math.atan2(p.x, p.z), aps = Math.abs(psi);
    const below = sstep(0.05, 0.035, p.y + 0.012 * sstep(0.2, 0.9, aps)) * sstep(1.45, 1.2, aps);
    const lips = g3(p, [0, 0.03, 0.108], [0.03, 0.011, 0.03]);
    const must = g3(p, [0, 0.047, 0.11], [0.03, 0.006, 0.03]) * sstep(0.004, 0.012, Math.abs(p.x));
    const side = sstep(1.0, 1.25, aps) * sstep(1.45, 1.3, aps) * sstep(0.13, 0.1, p.y) * sstep(0.02, 0.05, p.y);
    return clamp01(Math.max(below * (1 - lips * 1.4), must, side));
  }
  function buildHead(kit) {
    const S = kit.S, F = S.face, M = kit.mats, J = kit.J;
    const sdf = headSDF(F);
    const NU = 52, NR = 40, skin = projectHead(sdf, NU, NR), P = skin.attributes.position, N = skin.attributes.normal;
    const n = P.count, col = new Float32Array(n * 3), p = new T.Vector3();
    const stubble = S.beard === 'stubble';
    for (let i = 0; i < n; i++) {
      p.set(P.getX(i), P.getY(i), P.getZ(i));
      const front = sstep(0.02, 0.07, p.z);
      let r = 1, g = 1, b = 1;
      const lips = g3(p, [0, 0.03, 0.108], [0.024, 0.011, 0.03]) * front;
      const sock = (g3(p, [0.034, 0.123, 0.104], [0.022, 0.017, 0.03]) + g3(p, [-0.034, 0.123, 0.104], [0.022, 0.017, 0.03])) * front;
      const blush = (g3(p, [0.055, 0.082, 0.085], [0.03, 0.03, 0.04]) + g3(p, [-0.055, 0.082, 0.085], [0.03, 0.03, 0.04])) * front;
      const nost = (g3(p, [0.012, 0.058, 0.122], [0.006, 0.004, 0.01]) + g3(p, [-0.012, 0.058, 0.122], [0.006, 0.004, 0.01]));
      const under = sstep(0.01, -0.035, p.y) * sstep(-0.06, 0.04, p.z);
      r *= 1 - 0.12 * sock - 0.12 * under - 0.4 * nost; g *= 1 - 0.15 * sock - 0.12 * under - 0.45 * nost; b *= 1 - 0.14 * sock - 0.1 * under - 0.45 * nost;
      g *= 1 - 0.07 * blush; b *= 1 - 0.07 * blush;
      r = lerp(r, 0.88, lips * 0.6); g = lerp(g, 0.68, lips * 0.6); b = lerp(b, 0.63, lips * 0.6);
      if (stubble) {
        const psi = Math.abs(Math.atan2(p.x, p.z));
        let st = sstep(0.07, 0.045, p.y) * sstep(1.5, 1.15, psi) * (1 - lips * 1.2) + 0.7 * g3(p, [0, 0.047, 0.11], [0.03, 0.006, 0.03]);
        st = clamp01(st) * 0.9;
        r *= 1 - 0.2 * st; g *= 1 - 0.19 * st; b *= 1 - 0.14 * st;
      }
      // the forehead / scalp under the hair is darker so thin hair edges never show bare skin
      const hm = hairAmount(p, S);
      r *= 1 - 0.35 * hm; g *= 1 - 0.38 * hm; b *= 1 - 0.38 * hm;
      col[3 * i] = r; col[3 * i + 1] = g; col[3 * i + 2] = b;
    }
    skin.setAttribute('color', new T.BufferAttribute(col, 3));
    // ears: helix rim + concha, flaring back from the side of the head
    const ears = [];
    for (const s of [-1, 1]) {
      const E = (u, v, flare) => new T.Vector3(s * (0.084 + flare), 0.104 + v, -0.012 + u);
      const rim = [E(0.012, 0.016, 0.004), E(0.004, 0.03, 0.008), E(-0.01, 0.034, 0.013), E(-0.022, 0.024, 0.016), E(-0.027, 0.006, 0.016), E(-0.022, -0.012, 0.013), E(-0.012, -0.024, 0.009), E(-0.002, -0.027, 0.006), E(0.004, -0.018, 0.004)];
      ears.push(tube(rim, [0.0035, 0.0045, 0.005, 0.005, 0.005, 0.0048, 0.0058, 0.006, 0.004], { segs: 16, around: 6, col: [0.97, 0.88, 0.85], side: new T.Vector3(s, 0, 0) }));
      const con = new T.SphereGeometry(1, 10, 8); con.scale(0.006, 0.022, 0.014); con.translate(s * 0.087, 0.104, -0.022);
      ears.push(paint(con, [0.8, 0.66, 0.62]));
    }
    const head = J.head;
    addRigid(kit, head, merge([skin, ...ears]), M.skin);
    // hair (and beard): a trimmed shell over the head surface, so the hairline is a clean curve with real thickness
    const nc = NU + 1, NN = new T.Vector3(), PP = new T.Vector3();
    const hair = grid({
      rows: evenRows(0, PI, NR), nu: NU, a0: -PI, a1: PI, flip: true, trim: true,
      point: (th, ph, out, info) => {
        const k = info.j * nc + info.i;
        PP.set(P.getX(k), P.getY(k), P.getZ(k)); NN.set(N.getX(k), N.getY(k), N.getZ(k));
        const hm = hairAmount(PP, S), bd = beardAmount(PP, S);
        info.m = Math.max(hm, bd); info.n = NN;
        const t = hm >= bd ? hairThickness(PP, S) : 0.006 + 0.01 * sstep(0.04, -0.03, PP.y) * sstep(-0.01, 0.06, PP.z);
        info.depth = t + 0.003;
        return out.copy(PP).addScaledVector(NN, t);
      },
      color: (q, th, ph, info) => {
        const psi = Math.atan2(q.x, q.z), k = (0.82 + 0.18 * vnoise(psi * 26, q.y * 9) + 0.06 * vnoise(psi * 70, q.y * 30));
        return [k, k, k];
      },
    });
    const hairParts = [hair];
    // eyebrows: short flattened tubes laid on the brow ridge
    for (const s of [-1, 1]) {
      const pts = [[0.014, 0.139 + S.browSet], [0.03, 0.145], [0.046, 0.146], [0.059, 0.139]].map(([x, y]) => new T.Vector3(s * x, y, faceZ(sdf, s * x, y) + 0.0018));
      hairParts.push(tube(pts, [[0.0042, 0.0018], [0.0048, 0.0022], [0.0042, 0.002], [0.0024, 0.0014]], { segs: 10, around: 6, side: new T.Vector3(0, 1, 0), col: [0.9, 0.9, 0.9] }));
    }
    if (S.hairStyle === 'tied') {                              // tie at the back of the head (the tail itself hangs from the plume joint)
      const tie = new T.TorusGeometry(0.017, 0.006, 6, 12); tie.translate(0, 0.17, -0.118); hairParts.push(paint(tie, [0.55, 0.5, 0.45]));
    }
    addRigid(kit, head, merge(hairParts), M.hair);
    // eyes: ball in the socket, iris, hooded upper lid + lower lid
    const eyes = [], irises = [], lids = [];
    for (const s of [-1, 1]) {
      const x = s * 0.0335, y = 0.1235, zs = faceZ(sdf, x, y), c = new T.Vector3(x, y, zs - 0.0125 + 0.0016);
      const ball = new T.SphereGeometry(0.0125, 14, 10); ball.translate(c.x, c.y, c.z); eyes.push(paint(ball, [1, 1, 1]));
      const ir = new T.SphereGeometry(0.0068, 12, 8); ir.scale(1, 1, 0.42); ir.translate(c.x - s * 0.0005, c.y + 0.0003, c.z + 0.0116); irises.push(paint(ir, [1, 1, 1]));
      const up = new T.SphereGeometry(0.0134, 16, 6, 0, TAU, 0, 1.2); up.rotateX(0.12); up.translate(c.x, c.y, c.z); lids.push(paint(up, [0.84, 0.76, 0.72]));
      const lo = new T.SphereGeometry(0.0131, 16, 5, 0, TAU, PI - 0.95, 0.95); lo.translate(c.x, c.y, c.z); lids.push(paint(lo, [0.9, 0.82, 0.78]));
    }
    addRigid(kit, head, merge(eyes), M.eye);
    addRigid(kit, head, merge(irises), M.iris);
    addRigid(kit, head, merge(lids), M.skin);
    kit.sdf = sdf;
  }

  /* ============================== hands ============================== */
  // Fist frame (knight.js): origin = grip centre, +Z = grip axis (index finger side), +Y = toward the wrist,
  // +X*out = back of the hand. 'grip' wraps a handle (sword / bow / staff), 'relaxed' = loose half-curled empty hand.
  function handGeometry(out, mode, col) {
    const V = (x, y, z) => new T.Vector3(x, y, z), parts = [];
    const opt = (n) => ({ segs: n || 10, around: 7, col });
    // palm block from the wrist to the knuckles (elliptic section: wide across the fingers, thin through the palm)
    parts.push(tube([V(out * 0.0, 0.102, -0.019), V(out * 0.006, 0.075, -0.01), V(out * 0.015, 0.046, 0.0)],
      [[0.03, 0.021], [0.039, 0.021], [0.043, 0.02]], { segs: 6, around: 10, col, side: V(0, 0, 1), cap: 3 }));
    if (mode === 'grip' || mode === 'fist') {
      const curl = mode === 'fist' ? 0.72 : 1;
      const jt = (deg, r, z) => { const a = deg * PI / 180; return V(out * Math.cos(a) * r * curl, Math.sin(a) * r * curl, z); };
      [[0.032, 1.0], [0.0105, 1.04], [-0.0105, 0.98], [-0.031, 0.88]].forEach(([z, k]) => {
        const mcp = jt(55, 0.047 * k, z), pip = jt(-25, 0.047 * k, z), dip = jt(-100, 0.043 * k, z), tip = jt(-160, 0.036 * k, z);
        const base = mcp.clone().add(mcp.clone().sub(pip).multiplyScalar(0.45));
        parts.push(tube([base, mcp, pip, dip, tip], [0.0138 * k, 0.0145 * k, 0.0132 * k, 0.0121 * k, 0.0106 * k], opt(12)));
      });
      const tp = (x, y, z) => V(x * curl, y * (mode === 'fist' ? 0.85 : 1), z);
      parts.push(tube([tp(-out * 0.008, 0.088, 0.006), tp(-out * 0.03, 0.062, 0.026), tp(-out * 0.05, 0.016, 0.044), tp(-out * 0.031, -0.014, 0.05)],
        [0.019, 0.0155, 0.0128, 0.0112], opt(11)));
    } else {
      // relaxed: knuckles on the back of the hand, fingers hang and curl toward the palm by joint angles
      const fingers = [[0.03, 0.97, [16, 28, 18]], [0.0105, 1.04, [22, 36, 22]], [-0.0105, 0.99, [28, 42, 26]], [-0.03, 0.86, [34, 48, 30]]];
      for (const [z, k, ang] of fingers) {
        const pts = [V(out * 0.012, 0.062, z * 0.8), V(out * 0.02, 0.036, z)];
        let a = 0.12, P = pts[1].clone();
        [0.047, 0.031, 0.025].forEach((len, i) => {
          a += ang[i] * PI / 180;
          P = P.clone().add(V(-out * Math.sin(a) * len * k, -Math.cos(a) * len * k, z * 0.06));
          pts.push(P);
        });
        parts.push(tube(pts, [0.0135 * k, 0.0142 * k, 0.0128 * k, 0.0116 * k, 0.0102 * k], opt(12)));
      }
      parts.push(tube([V(-out * 0.006, 0.09, 0.008), V(-out * 0.026, 0.066, 0.03), V(-out * 0.036, 0.036, 0.044), V(-out * 0.03, 0.01, 0.05)],
        [0.0185, 0.015, 0.0125, 0.011], opt(11)));
    }
    return merge(parts);
  }
  function buildHands(kit, modes) {
    for (const [k, out] of [['L', 1], ['R', -1]]) {
      const m = modes[k];
      addRigid(kit, kit.knight._fists[k], handGeometry(out, m.mode, m.col || [1, 1, 1]), m.mat);
    }
  }

  /* ============================== feet (rigid on the ankle) ============================== */
  // ankle-local: sole bottom at -0.095, heel back -0.08, toe +0.235
  const FOOT = [   // z, half-width, centre y, half-height
    [-0.082, 0.000, -0.045, 0.000],
    [-0.074, 0.032, -0.040, 0.038],
    [-0.052, 0.045, -0.028, 0.056],
    [-0.010, 0.049, -0.012, 0.074],
    [0.040, 0.051, -0.026, 0.060],
    [0.090, 0.055, -0.043, 0.042],
    [0.140, 0.056, -0.053, 0.030],
    [0.188, 0.049, -0.057, 0.024],
    [0.218, 0.036, -0.060, 0.019],
    [0.236, 0.000, -0.062, 0.000],
  ];
  function footGeometry(o) {
    const tab = curve(FOOT), q = [0, 0, 0], yb = -0.075;
    const up = grid({
      rows: evenRows(-0.082, 0.236, 22), nu: 18, su: 1, sv: 1.5,
      point: (z, a, out) => {
        tab(z, q);
        const c = Math.cos(a), s = Math.sin(a), n = 2.6;
        const r = 1 / Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), 1 / n);
        let y = q[1] + s * r * q[2];
        if (y < yb) y = yb + (y - yb) * 0.15;                    // flat underside
        return out.set(c * r * q[0] * (1 + 0.04 * Math.sin(a) * (z > 0.05 ? 1 : 0)), y, z);
      },
      color: (p) => { const k = 1 - 0.15 * sstep(-0.06, -0.075, p.y) + 0.05 * sstep(0.1, 0.2, p.z) * sstep(-0.06, -0.04, p.y); return [k, k, k]; },
    });
    // sole: outline extruded down, slightly proud of the upper, heel block
    const sh = new T.Shape(), outline = [];
    for (let i = 0; i <= 24; i++) { const z = -0.08 + (0.316) * i / 24; tab(z, q); outline.push([q[0] + 0.006, z]); }
    sh.moveTo(outline[0][0] * 0.5, outline[0][1] - 0.004);
    for (const [x, z] of outline) sh.lineTo(x, z);
    for (let i = outline.length - 1; i >= 0; i--) sh.lineTo(-outline[i][0], outline[i][1]);
    sh.closePath();
    const sole = new T.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
    sole.rotateX(PI / 2); sole.translate(0, -0.073, 0);
    const heel = new T.BoxGeometry(0.084, 0.012, 0.07); heel.translate(0, -0.089, -0.042);
    return { upper: up, sole: merge([paint(sole, [1, 1, 1]), paint(heel, [0.85, 0.85, 0.85])]) };
  }
  function buildFeet(kit, mat, soleMat) {
    for (const k of ['L', 'R']) {
      const f = footGeometry();
      addRigid(kit, kit.J['an' + k], f.upper, mat);
      addRigid(kit, kit.J['an' + k], f.sole, soleMat);
    }
  }

  /* ============================== shared outfit pieces ============================== */
  // boot shaft over the lower leg: rolled cuff at the top, tight at the ankle, bottom rows ride the ankle
  function bootShaft(kit, side, o) {
    const L = kit.R.leg;
    return legShell(kit, side, {
      d0: o.top, d1: 2 * L - 0.012, rows: 22, mat: o.mat,
      mask: (p, d) => sstep(o.top, o.top + 0.012, d),
      thick: (p, d) => 0.011 + (o.cuff || 0) * gs2(d, o.top + 0.03, 0.02, 0.025) + 0.003 * sstep(2 * L - 0.1, 2 * L - 0.02, d),
      weights: (lw) => (p, d, a) => { const w = lw(p, d, a); const an = 0.8 * sstep(2 * L - 0.11, 2 * L - 0.02, d); return w.map(([b, x]) => [b, x * (1 - an)]).concat([[kit.B['an' + (side > 0 ? 'L' : 'R')], an]]); },
      color: (p, d, a, i) => { const k = 0.82 + 0.18 * sstep(0.1, 0.8, i.m) - 0.07 * gs(d, o.top + 0.05, 0.012) + 0.05 * vnoise(a * 4, d * 18); return [k, k, k]; },
    });
  }
  // belt band: outer face + top / bottom faces wrapped on the garment surface at y0..y1
  function beltBand(kit, o) {
    const fn = kit.torso(1), P = new T.Vector3(), N = new T.Vector3();
    const prof = [[o.y0, o.t0], [o.y0, o.t1], [o.y1, o.t1], [o.y1, o.t0]];
    const g = grid({
      rows: [0, 1, 2, 3], nu: 48, su: 6, sv: 0.3, weld: false,
      point: (j, a, out) => { const [y, t] = prof[j]; frame(fn, y, a, P, N, 1, 0.004); return out.copy(P).addScaledVector(N, t); },
      weights: torsoWeights(kit),
      color: (p, j) => (j === 1 || j === 2 ? [1, 1, 1] : [0.7, 0.7, 0.7]),
    });
    return addSkinned(kit, g, o.mat);
  }
  // front point of the garment surface at height y, offset t (bind space) + its normal
  function frontPoint(kit, y, a, t) {
    const P = new T.Vector3(), N = new T.Vector3();
    frame(kit.torso(1), y, a, P, N, 1, 0.004);
    return { p: P.addScaledVector(N, t), n: N };
  }
  // hanging cloth panel (tabard skirt) from under the belt over the thighs; lower rows follow the thighs
  function hangPanel(kit, o) {
    const R = kit.R, fn = kit.torso(1), P = new T.Vector3(), N = new T.Vector3(), Q = new T.Vector3();
    const back = o.back ? -1 : 1, aC = o.back ? PI : 0;
    const yHang = R.hipJ + 0.04;
    const rows = evenRows(o.yTop, o.yBot, o.rows || 16);
    const g = grid({
      rows, nu: o.nu || 12, a0: aC - o.half, a1: aC + o.half, su: 1, sv: 1.6, weld: false, flip: true,
      point: (y, a, out) => {
        const yy = Math.max(y, yHang);
        frame(fn, yy, a, P, N, 1, 0.004); P.addScaledVector(N, o.t);
        if (y >= yHang) return out.copy(P);
        const u = sstep(yHang, yHang - 0.12, y), x = P.x * (1 + 0.22 * (yHang - y));
        const zh = back * (o.hang - 0.85 * x * x);
        Q.set(x, y, lerp(P.z, zh, u));
        return out.copy(Q);
      },
      weights: (p, y) => {
        const tw = 0.55 * sstep(yHang + 0.02, yHang - 0.2, y), sL = sstep(-0.06, 0.06, p.x);
        return [[kit.B.hips, 1 - tw], [kit.B.thL, tw * sL], [kit.B.thR, tw * (1 - sL)]];
      },
      color: o.color,
    });
    const m = addSkinned(kit, g, o.mat);
    // hem: a thin rolled edge along the bottom (same skinning as the last row)
    const Pn = g.attributes.position, nc = (o.nu || 12) + 1, last = (rows.length - 1) * nc, hp = [];
    for (let i = 0; i < nc; i++) hp.push(new T.Vector3(Pn.getX(last + i), Pn.getY(last + i), Pn.getZ(last + i)));
    const hem = tube(hp, hp.map(() => 0.0055), { segs: 24, around: 6, col: [0.75, 0.75, 0.75] });
    const W = g.attributes.skinIndex, Wt = g.attributes.skinWeight, hc = hem.attributes.position.count;
    const si = new Uint16Array(hc * 4), sw = new Float32Array(hc * 4);
    for (let i = 0; i < hc; i++) {
      // nearest bottom-row vertex by x
      const x = hem.attributes.position.getX(i);
      let best = 0, bd = 1e9;
      for (let c = 0; c < nc; c++) { const dd = Math.abs(Pn.getX(last + c) - x); if (dd < bd) { bd = dd; best = last + c; } }
      for (let c = 0; c < 4; c++) { si[4 * i + c] = W.array[4 * best + c]; sw[4 * i + c] = Wt.array[4 * best + c]; }
    }
    hem.setAttribute('skinIndex', new T.BufferAttribute(si, 4)); hem.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    addSkinned(kit, hem, o.mat);
    return m;
  }
  // padded roll along a neck opening: for each angle find the height where the garment surface reaches radius rN
  function collarRoll(kit, o) {
    const fn = kit.torso(1), P = new T.Vector3(), N = new T.Vector3(), pts = [], R = kit.R;
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * TAU;
      let lo = R.shY - 0.05, hi = kit.R.headY - 0.02;                  // radius shrinks with height near the neck
      for (let k = 0; k < 24; k++) {
        const m = (lo + hi) / 2; fn(m, a, P);
        if (Math.hypot(P.x, (P.z + 0.004) * 1.08) > o.rN(P)) lo = m; else hi = m;
      }
      frame(fn, (lo + hi) / 2, a, P, N, 1, 0.003);
      pts.push(P.clone().addScaledVector(N, o.t));
    }
    const g = tube(pts, pts.map(() => o.r), { closed: true, segs: 60, around: 8, side: new T.Vector3(0, 1, 0), col: [0.9, 0.9, 0.9] });
    return addSkinned(kit, skinGeo(g, torsoWeights(kit)), o.mat);
  }

  /* ============================== outfits ============================== */
  function outfitWarrior(kit) {
    const { R, mats: Mt } = kit;
    bodyTorso(kit, { split: R.beltY - 0.01, lowMat: Mt.pants, highMat: Mt.skin });
    for (const s of [1, -1]) {
      bodyArm(kit, s, Mt.skin);
      bodyLeg(kit, s, Mt.pants, { extra: (d) => 0.012 * gs(d, 0.565, 0.03) + 0.002 * Math.sin(d * 90) * sstep(0.45, 0.55, d) * sstep(0.6, 0.55, d) });
    }
    // fitted leather cuirass, sleeveless, molded (half-strength chest), collar scoop
    const hole = (p) => {
      const hx = (Math.abs(p.x) - R.shX) / 0.112, hy = (p.y - (R.shY - 0.04)) / 0.135, hz = p.z / 0.14;
      return Math.sqrt(hx * hx + hy * hy + hz * hz);
    };
    // neck opening: a ring around the neck (radius grows toward the front = shallow scoop)
    const rN = (p) => 0.104 + 0.022 * sstep(0.0, 0.1, p.z);
    const nearNeck = (p) => sstep(R.shY - 0.06, R.shY - 0.02, p.y);         // the radial test only applies around the neck
    const neckOpen = (p, e) => 1 - nearNeck(p) * (1 - sstep(rN(p) - e, rN(p) + e, Math.hypot(p.x, (p.z + 0.004) * 1.08)));
    torsoShell(kit, {
      y0: R.hipY + 0.005, y1: R.shY + 0.115, rows: 40, mat: Mt.leather,
      mask: (p) => sstep(0.95, 1.07, hole(p)) * neckOpen(p, 0.006) * sstep(R.hipY + 0.005, R.hipY + 0.022, p.y),
      thick: (p) => 0.014 + 0.004 * gs(p.y, R.beltY, 0.05),
      color: (p, y, a, i) => {
        const edge = sstep(0.05, 0.85, i.m), k = 0.7 + 0.3 * edge;
        const seam = 1 - 0.18 * gs(Math.abs(p.x), 0.0, 0.004) * sstep(R.chestY - 0.1, R.chestY, p.y);   // centre lacing seam
        const wear = 1 + 0.08 * ga(a, 0.45, 0.3) * gs(p.y, R.chestY + 0.15, 0.04) + 0.08 * ga(a, -0.45, 0.3) * gs(p.y, R.chestY + 0.15, 0.04);
        const v = k * seam * wear * (0.94 + 0.06 * vnoise(a * 9, p.y * 20));
        return [v, v, v];
      },
    });
    // team surcoat: front + back panels joined by straps over the shoulders
    torsoShell(kit, {
      y0: R.hipY + 0.04, y1: R.shY + 0.115, rows: 34, mat: Mt.cloth,
      mask: (p) => {
        const hw = lerp(0.142, 0.168, sstep(R.shY - 0.06, R.shY + 0.03, p.y));
        const neck = 1 - nearNeck(p) * (1 - sstep(rN(p) + 0.008, rN(p) + 0.02, Math.hypot(p.x, (p.z + 0.004) * 1.08)));
        return sstep(hw + 0.006, hw - 0.006, Math.abs(p.x)) * neck * sstep(R.hipY + 0.045, R.hipY + 0.06, p.y);
      },
      thick: () => 0.026, under: 0.016,
      color: (p, y, a, i) => {
        const ax = Math.abs(p.x), border = gs(ax, lerp(0.128, 0.154, sstep(R.shY - 0.06, R.shY + 0.03, p.y)), 0.005);
        const k = (0.72 + 0.28 * sstep(0.05, 0.8, i.m)) * (1 - 0.3 * border) * (0.94 + 0.06 * vnoise(a * 7, p.y * 14));
        return [k, k, k];
      },
    });
    // padded collar roll along the cuirass neck edge
    collarRoll(kit, { rN, t: 0.012, r: [0.013, 0.011], mat: Mt.leather2 });
    // tabard skirt panels, front and back, hemmed
    const flapCol = (p, y, a) => { const e = Math.abs(angD(a, p.z < 0 ? PI : 0)) / 0.62, k = (1 - 0.25 * gs(e, 0.9, 0.05)) * (0.9 + 0.1 * sstep(R.hipY, R.hipY - 0.1, y)) * (0.94 + 0.06 * vnoise(a * 8, y * 10)); return [k, k, k]; };
    hangPanel(kit, { yTop: R.beltY, yBot: R.hipJ - 0.31, half: 0.62, t: 0.03, hang: 0.165, mat: Mt.cloth, color: flapCol });
    hangPanel(kit, { yTop: R.beltY, yBot: R.hipJ - 0.29, half: 0.62, t: 0.03, hang: 0.18, back: true, mat: Mt.cloth, color: flapCol });
    // wide belt + brass buckle
    beltBand(kit, { y0: R.beltY - 0.032, y1: R.beltY + 0.03, t0: 0.024, t1: 0.042, mat: Mt.belt });
    const fp = frontPoint(kit, R.beltY, 0, 0.044);
    const bk = new T.Shape(); bk.moveTo(-0.04, -0.036); bk.lineTo(0.04, -0.036); bk.lineTo(0.04, 0.036); bk.lineTo(-0.04, 0.036); bk.closePath();
    const hl = new T.Path(); hl.moveTo(-0.027, -0.023); hl.lineTo(-0.027, 0.023); hl.lineTo(0.027, 0.023); hl.lineTo(0.027, -0.023); hl.closePath(); bk.holes.push(hl);
    const bg = new T.ExtrudeGeometry(bk, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
    const prong = new T.BoxGeometry(0.006, 0.05, 0.006); prong.translate(0, 0, 0.004);
    const buckle = merge([paint(bg, [1, 1, 1]), paint(prong, [0.9, 0.9, 0.9])]);
    buckle.translate(fp.p.x, fp.p.y - R.hipY, fp.p.z - 0.002);
    addRigid(kit, kit.J.hips, buckle, Mt.brass);
    // spaulders: two leather lames moulded on the deltoid (offset shells of the arm surface, outer side only) + bracers
    for (const s of [1, -1]) {
      const outA = s * PI / 2;
      armShell(kit, s, {
        d0: -0.074, d1: 0.1, rows: 18, mat: Mt.leather2, layer: 1,
        mask: (p, d, a) => sstep(2.05, 1.7, Math.abs(angD(a, outA))) * sstep(0.1, 0.085, d + 0.02 * Math.abs(Math.sin(a * 2))),
        thick: (p, d) => 0.016 + 0.006 * sstep(-0.02, 0.08, d),
        color: (p, d, a, i) => { const k = (0.66 + 0.34 * sstep(0.05, 0.85, i.m)) * (0.92 + 0.08 * vnoise(a * 6, d * 30)); return [k, k, k]; },
      });
      armShell(kit, s, {
        d0: 0.05, d1: 0.165, rows: 12, mat: Mt.leather2, layer: 1,
        mask: (p, d, a) => sstep(1.9, 1.55, Math.abs(angD(a, outA))) * sstep(0.05, 0.065, d) * sstep(0.165, 0.15, d + 0.015 * Math.abs(Math.sin(a * 2))),
        thick: (p, d) => 0.024 + 0.006 * sstep(0.06, 0.15, d), under: 0.008,
        color: (p, d, a, i) => { const k = (0.66 + 0.34 * sstep(0.05, 0.85, i.m)) * (0.92 + 0.08 * vnoise(a * 6, d * 30)); return [k, k, k]; },
      });
      armShell(kit, s, {
        d0: 0.45, d1: 0.785, rows: 22, mat: Mt.leather, layer: 0,
        mask: (p, d) => sstep(0.45, 0.462, d) * sstep(0.785, 0.772, d),
        thick: (p, d) => 0.006 + 0.005 * sstep(0.6, 0.77, d) + 0.003 * (gs(d, 0.52, 0.007) + gs(d, 0.7, 0.007)),
        color: (p, d, a, i) => { const k = (0.72 + 0.28 * sstep(0.1, 0.8, i.m)) * (1 - 0.25 * (gs(d, 0.52, 0.008) + gs(d, 0.7, 0.008))); return [k, k, k]; },
      });
      // boots (rolled cuff) + steel shin greave + knee cop
      bootShaft(kit, s, { top: 0.6, cuff: 0.012, mat: Mt.boot });
      legShell(kit, s, {
        d0: 0.62, d1: 0.965, rows: 20, mat: Mt.metal,
        mask: (p, d, a) => sstep(-0.25, 0.1, Math.cos(a)) * sstep(0.62, 0.635, d) * sstep(0.965, 0.95, d),
        thick: (p, d, a) => 0.021 + 0.006 * ga(a, 0, 0.3) * sstep(0.62, 0.7, d),
        color: (p, d, a, i) => { const k = 0.7 + 0.3 * sstep(0.1, 0.8, i.m) - 0.15 * (gs(d, 0.7, 0.006) + gs(d, 0.9, 0.006)); return [k, k, k]; },
      });
      legShell(kit, s, {
        d0: 0.44, d1: 0.64, rows: 14, mat: Mt.metal,
        mask: (p, d, a) => sstep(1.0, 0.82, Math.hypot((d - R.leg - 0.008) / 0.082, angD(a, 0) / 0.95)),
        thick: (p, d, a) => 0.017 + 0.009 * Math.max(0, 1 - Math.hypot((d - R.leg - 0.008) / 0.082, angD(a, 0) / 0.95)), under: 0,
        weights: (lw) => (p, d, a) => [[kit.B['th' + (s > 0 ? 'L' : 'R')], 0.35], [kit.B['kn' + (s > 0 ? 'L' : 'R')], 0.65]],
        color: (p, d, a, i) => { const k = 0.75 + 0.25 * sstep(0.1, 0.8, i.m); return [k, k, k]; },
      });
    }
    buildHands(kit, { L: { mode: 'relaxed', mat: Mt.skin }, R: { mode: 'grip', mat: Mt.skin } });
    buildFeet(kit, Mt.boot, Mt.sole);
  }

  function outfitArcher(kit) {
    const { R, mats: Mt } = kit;
    bodyTorso(kit, { split: R.beltY - 0.01, lowMat: Mt.pants, highMat: Mt.skin });
    for (const s of [1, -1]) {
      bodyArm(kit, s, Mt.skin);
      bodyLeg(kit, s, Mt.pants, { extra: (d) => 0.01 * gs(d, 0.6, 0.03) });
    }
    // linen shirt: torso + sleeves to above the elbow (rolled cuffs)
    torsoShell(kit, {
      y0: R.hipY - 0.02, y1: R.shY + 0.12, rows: 44, mat: Mt.shirt,
      mask: (p) => { const c = R.shY + 0.072 - 0.03 * sstep(0.0, 0.08, p.z) * sstep(0.06, 0.0, Math.abs(p.x)); return sstep(c + 0.006, c - 0.006, p.y); },
      thick: () => 0.008,
      color: (p, y, a, i) => { const k = (0.8 + 0.2 * sstep(0.1, 0.8, i.m)) * (0.93 + 0.07 * vnoise(a * 10, y * 25)); return [k, k, k]; },
    });
    // fitted leather jerkin over the shirt: sleeveless, laced front
    const hole = (p) => { const hx = (Math.abs(p.x) - R.shX) / 0.118, hy = (p.y - (R.shY - 0.045)) / 0.14, hz = p.z / 0.14; return Math.sqrt(hx * hx + hy * hy + hz * hz); };
    torsoShell(kit, {
      y0: R.hipY - 0.03, y1: R.shY + 0.1, rows: 44, mat: Mt.leather,
      mask: (p) => {
        const c = R.shY + 0.055 - 0.05 * sstep(0.0, 0.1, p.z) * sstep(0.08, 0.0, Math.abs(p.x));
        const slit = 1 - sstep(0.012, 0.004, Math.abs(p.x)) * sstep(0.0, 0.05, p.z) * sstep(R.chestY + 0.1, R.chestY + 0.2, p.y);
        return sstep(0.95, 1.07, hole(p)) * sstep(c + 0.006, c - 0.006, p.y) * sstep(R.hipY - 0.03, R.hipY - 0.012, p.y) * slit;
      },
      thick: () => 0.016,
      color: (p, y, a, i) => {
        const lace = gs(Math.abs(p.x), 0.016, 0.003) * sstep(-0.02, 0.05, p.z) * (0.5 + 0.5 * Math.sin(p.y * 260)) * sstep(R.chestY + 0.32, R.chestY + 0.2, p.y);
        const k = (0.72 + 0.28 * sstep(0.05, 0.85, i.m)) * (1 - 0.25 * lace) * (0.93 + 0.07 * vnoise(a * 9, y * 18));
        return [k, k, k];
      },
    });
    // hooded capelet in team colour: covers the top of the shoulders, stops short of the deltoids (raised draw arm stays clear)
    torsoShell(kit, {
      y0: R.chestY + 0.14, y1: R.shY + 0.12, rows: 26, mat: Mt.cloth,
      mask: (p) => {
        // V-pointed hem front and back, rising over the shoulders; stops before the deltoid
        const ax = Math.abs(p.x), hem = R.shY - 0.035 - 0.11 * Math.max(0, 1 - ax / 0.15) + 0.02 * sstep(0.14, 0.2, ax);
        const c = R.shY + 0.085 - 0.03 * sstep(0.0, 0.08, p.z);
        return sstep(hem - 0.004, hem + 0.006, p.y) * sstep(0.218, 0.2, ax) * sstep(c + 0.008, c - 0.004, p.y);
      },
      thick: (p) => 0.027 + 0.005 * sstep(0.1, 0.2, Math.abs(p.x)), under: 0.017,
      color: (p, y, a, i) => { const k = (0.7 + 0.3 * sstep(0.05, 0.8, i.m)) * (0.92 + 0.08 * vnoise(a * 8, y * 14)); return [k, k, k]; },
    });
    // lowered hood: soft bunched roll around the back of the neck, resting on the capelet
    {
      const fn = kit.torso(1), P = new T.Vector3(), N = new T.Vector3(), pts = [], rad = [];
      for (let i = 0; i <= 10; i++) {
        const a = lerp(1.25, TAU - 1.25, i / 10), u = Math.sin(PI * i / 10);
        frame(fn, R.shY + 0.055 + 0.012 * u, a, P, N, 1, 0.003);
        pts.push(P.clone().addScaledVector(N, 0.032 + 0.012 * u).add(new T.Vector3(0, 0.006 * u, 0)));
        rad.push([0.022 + 0.014 * u, 0.018 + 0.012 * u]);
      }
      const roll = tube(pts, rad, { segs: 24, around: 9, side: new T.Vector3(0, 1, 0), color: (q) => { const k = 0.82 + 0.1 * vnoise(q.x * 60, q.y * 40); return [k, k, k]; } });
      addSkinned(kit, skinGeo(roll, torsoWeights(kit)), Mt.cloth);
    }
    // leather jerkin skirt: front and back tassets over the trouser seat
    const tassetCol = (p, y, a) => { const e = Math.abs(angD(a, p.z < 0 ? PI : 0)) / 0.7, k = (1 - 0.3 * gs(e, 0.92, 0.05)) * (0.88 + 0.12 * sstep(R.hipY - 0.02, R.hipY - 0.12, y)) * (0.93 + 0.07 * vnoise(a * 9, y * 12)); return [k, k, k]; };
    hangPanel(kit, { yTop: R.beltY - 0.01, yBot: R.hipJ - 0.16, half: 0.72, t: 0.026, hang: 0.15, mat: Mt.leather, color: tassetCol, nu: 10, rows: 10 });
    hangPanel(kit, { yTop: R.beltY - 0.01, yBot: R.hipJ - 0.15, half: 0.72, t: 0.026, hang: 0.165, back: true, mat: Mt.leather, color: tassetCol, nu: 10, rows: 10 });
    beltBand(kit, { y0: R.beltY - 0.022, y1: R.beltY + 0.02, t0: 0.02, t1: 0.03, mat: Mt.belt });
    for (const s of [1, -1]) {
      // rolled shirt sleeve over the upper arm
      armShell(kit, s, {
        d0: -0.09, d1: 0.36, rows: 26, mat: Mt.shirt, layer: 1,
        mask: (p, d) => sstep(0.36, 0.345, d),
        thick: (p, d) => 0.009 + 0.012 * gs(d, 0.33, 0.018) + 0.003 * Math.sin(d * 70 + p.x * 40) * sstep(0.1, 0.3, d),
        color: (p, d, a, i) => { const k = (0.78 + 0.22 * sstep(0.1, 0.8, i.m)) * (1 - 0.15 * gs(d, 0.315, 0.006)); return [k, k, k]; },
      });
      // bracer on the bow arm, plain leather wrap on the draw arm
      armShell(kit, s, {
        d0: s > 0 ? 0.44 : 0.6, d1: 0.785, rows: 20, mat: Mt.leather, layer: 0,
        mask: (p, d) => sstep(s > 0 ? 0.44 : 0.6, (s > 0 ? 0.44 : 0.6) + 0.012, d) * sstep(0.785, 0.772, d),
        thick: (p, d) => 0.008 + 0.004 * sstep(0.6, 0.77, d) + (s > 0 ? 0.003 * Math.max(0, Math.sin(d * 120)) : 0),
        color: (p, d, a, i) => { const k = 0.72 + 0.28 * sstep(0.1, 0.8, i.m); return [k, k, k]; },
      });
      // soft boots + linen leg wraps above them
      bootShaft(kit, s, { top: 0.72, cuff: 0.006, mat: Mt.boot });
      legShell(kit, s, {
        d0: 0.56, d1: 0.76, rows: 18, mat: Mt.wrap,
        mask: (p, d) => sstep(0.56, 0.572, d),
        thick: (p, d, a) => 0.009 + 0.003 * Math.abs(Math.sin((d * 34 + a * 0.35) * PI)),
        color: (p, d, a, i) => { const k = (0.75 + 0.25 * sstep(0.1, 0.8, i.m)) * (0.85 + 0.15 * Math.abs(Math.sin((d * 34 + a * 0.35) * PI))); return [k, k, k]; },
      });
    }
    buildHands(kit, { L: { mode: 'grip', mat: Mt.skin }, R: { mode: 'grip', mat: Mt.glove } });
    buildFeet(kit, Mt.boot, Mt.sole);
    // ponytail from the plume joint
    const tail = tube([new T.Vector3(0, 0, 0), new T.Vector3(0, -0.06, -0.025), new T.Vector3(0, -0.15, -0.03), new T.Vector3(0, -0.24, -0.012)],
      [0.022, 0.025, 0.018, 0.006], { segs: 14, around: 8, col: [0.9, 0.9, 0.9] });
    addRigid(kit, kit.J.plume, tail, kit.mats.hair).rotation.x = 0.25;
  }

  function outfitMage(kit) {
    const { R, mats: Mt } = kit;
    bodyTorso(kit, { split: R.beltY - 0.01, lowMat: Mt.pants, highMat: Mt.skin });
    for (const s of [1, -1]) {
      bodyArm(kit, s, Mt.robe, { extra: (d) => 0.008 });               // robe sleeve base (cloth over the arm)
      bodyLeg(kit, s, Mt.pants, {});
    }
    // robe bodice: high collar, crossed front (wrap line), shoulders covered
    const wrapLine = (p) => p.x + 0.55 * (p.y - (R.chestY + 0.02));
    torsoShell(kit, {
      y0: R.hipY - 0.04, y1: R.headY - 0.025, rows: 50, mat: Mt.robe,
      mask: (p) => sstep(R.headY - 0.03, R.headY - 0.045, p.y),
      thick: (p) => 0.012 + 0.012 * sstep(R.shY + 0.05, R.shY + 0.1, p.y),
      color: (p, y, a, i) => {
        const w = wrapLine(p), trimL = gs(w, 0.0, 0.007) * sstep(-0.01, 0.06, p.z) * sstep(R.beltY, R.beltY + 0.04, p.y);
        const k = (0.75 + 0.25 * sstep(0.05, 0.8, i.m)) * (1 - 0.3 * trimL) * (0.93 + 0.07 * vnoise(a * 8, y * 16));
        return [k, k, k];
      },
    });
    // short shoulder mantle with a gold-edged hem (stops above the deltoids)
    torsoShell(kit, {
      y0: R.chestY + 0.15, y1: R.headY - 0.02, rows: 28, mat: Mt.mantle,
      mask: (p) => { const ax = Math.abs(p.x), hem = R.shY - 0.03 - 0.03 * sstep(0.1, 0.0, ax); return sstep(hem - 0.006, hem + 0.008, p.y) * sstep(0.235, 0.21, ax) * sstep(R.headY - 0.035, R.headY - 0.05, p.y); },
      thick: (p) => 0.03 + 0.006 * sstep(0.12, 0.2, Math.abs(p.x)),
      color: (p, y, a, i) => { const k = (0.7 + 0.3 * sstep(0.05, 0.8, i.m)) * (0.93 + 0.07 * vnoise(a * 9, y * 12)); return [k, k, k]; },
    });
    // team stole: two bands from behind the neck down the chest
    torsoShell(kit, {
      y0: R.hipY - 0.05, y1: R.headY - 0.015, rows: 44, mat: Mt.cloth,
      mask: (p) => {
        const ax = Math.abs(p.x), cx = lerp(0.075, 0.06, sstep(R.shY + 0.03, R.chestY, p.y));
        const band = sstep(0.034, 0.026, Math.abs(ax - cx)) * sstep(-0.03, 0.02, p.z);
        const neck = sstep(R.shY + 0.03, R.shY + 0.06, p.y) * sstep(R.headY - 0.03, R.headY - 0.045, p.y);
        return Math.max(band * sstep(R.hipY - 0.045, R.hipY - 0.03, p.y), neck * sstep(-0.01, -0.03, p.z) * sstep(0.1, 0.06, ax)) * sstep(R.headY - 0.03, R.headY - 0.045, p.y);
      },
      thick: (p) => 0.044 + 0.016 * sstep(R.shY + 0.05, R.shY + 0.1, p.y),
      color: (p, y, a, i) => { const k = (0.72 + 0.28 * sstep(0.05, 0.8, i.m)) * (0.93 + 0.07 * vnoise(a * 9, y * 12)); return [k, k, k]; },
    });
    // robe skirt: from the sash to mid-shin, each side follows its thigh, the lower back follows the shin
    {
      const yTop = R.beltY + 0.02, kL = R.kneeY, sk = [[0.218, yTop], [0.232, R.hipY - 0.0], [0.262, R.hipJ - 0.06], [0.286, R.hipJ - 0.22], [0.302, kL + 0.08], [0.318, kL - 0.06], [0.33, kL - 0.24]];
      const prof = curve(sk.map(([r, y]) => [-y, r]));
      const B = kit.B, rows = evenRows(yTop, kL - 0.24, 26);
      const g = grid({
        rows, nu: 44, su: 4, sv: 3, flip: true,
        point: (y, a, out) => {
          const r = prof(-y)[0] * kit.S.t.hip * (1 + 0.035 * Math.sin(a * 9) * sstep(R.hipJ - 0.1, kL, y));
          return out.set(Math.sin(a) * r, y, Math.cos(a) * r * 0.82 - 0.005);
        },
        weights: (p, y) => {
          const tw = sstep(R.hipY + 0.02, R.hipY - 0.2, y), sL = sstep(-0.035, 0.035, p.x);
          const kw = sstep(kL + 0.12, kL - 0.12, y) * sstep(0.02, -0.18, p.z) * 0.75, dom = sL >= 0.5, wD = tw * (dom ? sL : 1 - sL), wO = tw * (dom ? 1 - sL : sL);
          return [[B.hips, 1 - tw], [dom ? B.thL : B.thR, wD * (1 - kw)], [dom ? B.thR : B.thL, wO], [dom ? B.knL : B.knR, wD * kw]];
        },
        color: (p, y, a, i) => {
          const fold = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(a * 9 + 1.6)) * sstep(R.hipJ - 0.1, kL, y);
          const hem = gs(y, kL - 0.215, 0.012), k = fold * (1 - 0.2 * hem) * (0.94 + 0.06 * vnoise(a * 6, y * 9));
          return [k, k, k];
        },
      });
      addSkinned(kit, g, Mt.robeD);
      // gold hem band along the bottom edge (same skinning)
      const P = g.attributes.position, nc = 45, last = (rows.length - 1) * nc, hp = [];
      for (let i = 0; i < nc; i++) hp.push(new T.Vector3(P.getX(last + i), P.getY(last + i), P.getZ(last + i)));
      const W = g.attributes.skinIndex, Wt = g.attributes.skinWeight, band = [], si = [], sw = [], idx = [];
      for (let r = 0; r < 2; r++) for (let i = 0; i < nc; i++) {
        const v = hp[i], k = 1 + 0.012;
        band.push(v.x * k, v.y + r * 0.03, v.z * k);
        const src = last - r * nc * 1 + i;
        for (let c = 0; c < 4; c++) { si.push(W.array[4 * (r ? src : last + i) + c]); sw.push(Wt.array[4 * (r ? src : last + i) + c]); }
      }
      for (let i = 0; i < nc - 1; i++) idx.push(i, i + nc, i + 1, i + 1, i + nc, i + nc + 1);
      const hg = new T.BufferGeometry();
      hg.setAttribute('position', new T.Float32BufferAttribute(band, 3)); hg.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4)); hg.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
      hg.setIndex(idx); hg.computeVertexNormals(); paint(hg, [1, 1, 1]);
      addSkinned(kit, hg, Mt.trimD);
    }
    // sash
    beltBand(kit, { y0: R.beltY - 0.03, y1: R.beltY + 0.035, t0: 0.03, t1: 0.042, mat: Mt.sash });
    // bell sleeves: flare from mid forearm, gold cuff
    for (const s of [1, -1]) {
      armShell(kit, s, {
        d0: 0.3, d1: 0.79, rows: 26, mat: Mt.robeD, layer: 1,
        mask: (p, d) => sstep(0.3, 0.33, d),
        thick: (p, d) => 0.01 + 0.06 * sstep(0.45, 0.79, d) ** 1.5,
        color: (p, d, a, i) => { const k = (0.8 + 0.2 * sstep(0.05, 0.8, i.m)) * (1 - 0.25 * gs(d, 0.775, 0.008)) * (0.92 + 0.08 * Math.sin(a * 5 + d * 10)); return [k, k, k]; },
      });
      bootShaft(kit, s, { top: 0.66, cuff: 0.004, mat: Mt.boot });
    }
    buildHands(kit, { L: { mode: 'relaxed', mat: Mt.skin }, R: { mode: 'grip', mat: Mt.skin } });
    buildFeet(kit, Mt.boot, Mt.sole);
    // gold circlet with a small ember stone
    {
      const sdf = kit.sdf, pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = i / 40 * TAU, y = 0.205 + 0.016 * Math.cos(a);
        let r = 0.05; const dx = Math.sin(a), dz = Math.cos(a);
        while (r < 0.2 && sdf(dx * r, y, dz * r) < 0) r += 0.002;
        const p = new T.Vector3(dx * r, y, dz * r), hm = hairAmount(p, kit.S);
        pts.push(new T.Vector3(dx * (r + hairThickness(p, kit.S) * Math.sqrt(hm) + 0.004), y, dz * (r + hairThickness(p, kit.S) * Math.sqrt(hm) + 0.004)));
      }
      pts.pop();
      const ring = tube(pts.concat([pts[0], pts[1]]), pts.concat([pts[0], pts[1]]).map(() => [0.0045, 0.0022]), { segs: 80, around: 6, side: new T.Vector3(0, 1, 0), cap: 0 });
      addRigid(kit, kit.J.head, ring, Mt.brass);
      const gem = new T.SphereGeometry(0.009, 12, 8); gem.translate(pts[0].x, pts[0].y, pts[0].z + 0.004);
      addRigid(kit, kit.J.head, paint(gem, [1, 1, 1]), Mt.ember).castShadow = false;
    }
    // hair falls to the nape at the back (rigid on the head)
    const back = tube([new T.Vector3(0, 0.13, -0.1), new T.Vector3(0, 0.05, -0.115), new T.Vector3(0, -0.03, -0.1)], [[0.06, 0.03], [0.058, 0.028], [0.045, 0.018]], { segs: 10, around: 12, side: new T.Vector3(1, 0, 0), col: [0.88, 0.88, 0.88] });
    addRigid(kit, kit.J.head, back, kit.mats.hair);
  }
  const OUTFITS = { warrior: outfitWarrior, archer: outfitArcher, mage: outfitMage };

  /* ============================== materials ============================== */
  function makeMaterials(ctx, S) {
    const mk = ctx.mk, mkT = ctx.mkT, M = ctx.M, P = ctx.P;
    const sk = { skinning: true, vertexColors: true };
    const o = (x) => Object.assign({}, sk, x);
    const pal = {
      warrior: { leather: 0x5a412f, leather2: 0x4a3426, pants: 0x4a4b44, boot: 0x553a28, belt: 0x6c472e },
      archer: { leather: 0x5a5034, leather2: 0x4c3a28, pants: 0x5e4a34, boot: 0x553a26, belt: 0x5e3f27, shirt: 0x9c7a55, wrap: 0x8a7458, glove: 0x3d2c20 },
      mage: { robe: 0x6a2230, mantle: 0x2c2428, pants: 0x2a2730, boot: 0x2f241e, sash: 0x3a2a22 },
    }[ctx.cls] || {};
    const Mt = {
      skin: mk(S.skin, o({ roughness: 0.68, metalness: 0 })),
      hair: mk(S.hair, { roughness: 0.72, metalness: 0, vertexColors: true }),
      eye: mk(0xa59a8c, { roughness: 0.35, metalness: 0, vertexColors: true }),
      iris: mk(S.iris, { roughness: 0.25, metalness: 0, vertexColors: true }),
      pants: mkT(pal.pants || 0x4a4b44, 'rough_linen', 1, o({ roughness: 0.92, metalness: 0 })),
      leather: mkT(pal.leather || 0x5a412f, 'brown_leather', 1, o({ roughness: 0.62, metalness: 0.04 })),
      leather2: mkT(pal.leather2 || 0x4a3426, 'brown_leather', 1, o({ roughness: 0.55, metalness: 0.05 })),
      boot: mkT(pal.boot || 0x3c2b20, 'brown_leather', 1, o({ roughness: 0.7, metalness: 0.02 })),
      belt: mkT(pal.belt || 0x6c472e, 'brown_leather', 1, o({ roughness: 0.58, metalness: 0.04 })),
      sole: mk(0x1e1712, { roughness: 0.9, metalness: 0, vertexColors: true }),
      metal: mk(0xaeb3b9, o({ roughness: 0.36, metalness: 0.72 })),   // plain brushed steel (the tread-plate texture reads industrial)
      brass: mk(0xb08848, { roughness: 0.34, metalness: 0.8, vertexColors: true }),
    };
    if (ctx.cls === 'archer') {
      Mt.shirt = mkT(pal.shirt, 'rough_linen', 1, o({ roughness: 0.92, metalness: 0 }));
      Mt.wrap = mkT(pal.wrap, 'rough_linen', 1, o({ roughness: 0.95, metalness: 0 }));
      Mt.glove = mkT(pal.glove, 'brown_leather', 1, o({ roughness: 0.66, metalness: 0 }));
    }
    if (ctx.cls === 'mage') {
      Mt.robe = mkT(pal.robe, 'rough_linen', 1, o({ roughness: 0.86, metalness: 0 }));
      Mt.robeD = mkT(pal.robe, 'rough_linen', 1, o({ roughness: 0.86, metalness: 0, side: T.DoubleSide }));
      Mt.mantle = mkT(pal.mantle, 'rough_linen', 1, o({ roughness: 0.9, metalness: 0 }));
      Mt.sash = mkT(pal.sash, 'brown_leather', 1, o({ roughness: 0.7, metalness: 0 }));
      Mt.trimD = mk(0xb08848, o({ roughness: 0.34, metalness: 0.8, side: T.DoubleSide }));
      Mt.ember = mk(0xffc890, { roughness: 0.2, metalness: 0, emissive: 0xff5a14, emissiveIntensity: 1.1, vertexColors: true });
    }
    // team colour: one cloth material for every team-coloured part, so knight.setTeam() keeps working
    Mt.cloth = mkT(P.cloth, 'rough_linen', 1, o({ roughness: 0.88, metalness: 0, side: T.DoubleSide }));
    M.cloth = Mt.cloth;
    return Mt;
  }

  /* ============================== entry ============================== */
  function build(ctx) {
    const knight = ctx.knight, J = ctx.J, cls = SPECS[ctx.cls] ? ctx.cls : 'warrior', S = SPECS[cls];
    const root = J.spin.parent;                                   // knight.root is assigned after this hook
    const R = applyRig(knight, J, S);
    strip(knight, J, root);
    root.updateMatrixWorld(true);
    const BONES = [J.hips, J.spine, J.chest, J.head, J.shL, J.elL, J.wristL, J.shR, J.elR, J.wristR, J.thL, J.knL, J.anL, J.thR, J.knR, J.anR];
    const names = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'wristL', 'shR', 'elR', 'wristR', 'thL', 'knL', 'anL', 'thR', 'knR', 'anR'];
    const B = {}; names.forEach((n, i) => { B[n] = i; });
    const kit = { S, R, B, J, knight, root, skeleton: new T.Skeleton(BONES), meshes: [], cls };
    kit.mats = makeMaterials(Object.assign({ cls }, ctx), S);
    kit.torso = makeTorso(S, R);
    kit.arm = { 1: makeArm(S, R, 1), '-1': makeArm(S, R, -1) };
    kit.leg = { 1: makeLeg(S, R, 1), '-1': makeLeg(S, R, -1) };
    const cached = CACHE[cls];
    if (cached) {
      // same class built before: geometry is identical (only materials / team colour are per hero) -> share it
      const mat = (k) => (Array.isArray(k) ? k.map((x) => kit.mats[x]) : kit.mats[k]);
      for (const e of cached) {
        if (e.skinned) addSkinned(kit, e.geo, mat(e.mat));
        else addRigid(kit, e.parent[0] === 'J' ? J[e.parent.slice(2)] : knight._fists[e.parent.slice(2)], e.geo, mat(e.mat));
      }
    } else {
      kit.record = [];
      buildHead(kit);
      OUTFITS[cls](kit);
      if (kit.record.every((e) => e.mat !== undefined && (e.skinned || e.parent))) CACHE[cls] = kit.record;
      kit.record = null;
    }
    // body-mounted weapon parts that depend on the torso volume
    if (knight._bow && knight._bow.quiver) knight._bow.quiver.position.set(-0.11, R.shY - R.chestY - 0.13, -0.2);
    knight.heroModel = { version: VERSION, cls, landmarks: R, meshes: kit.meshes.length };
    return kit;
  }
  const VERSION = 'v2', CACHE = {};
  global.HeroModel = { version: VERSION, build, SPECS, _internal: { curve, grid, tube, merge, headSDF } };
})(typeof window !== 'undefined' ? window : globalThis);
