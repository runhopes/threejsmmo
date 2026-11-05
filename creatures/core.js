/* TDS MOBA - CreatureKit: the shared procedural creature framework (client / rendering side)
 *
 * Same art pipeline as the heroes (heromodel.js), applied to animals and small humanoids:
 *   - anatomy is SCULPTED, not assembled: bodies and heads are signed-distance fields of smooth-blended anatomical masses
 *     (rib cage, haunch, shoulder, skull, muzzle...) projected onto a clean quad grid that follows the spine / head axis,
 *     limbs / tails / ears / tusks are swept along their joint chains with keyed super-ellipse cross-sections + muscle bumps
 *   - one skinned surface per material slot, shading = vertex colour (countershading, AO-like creases, muzzle / belly
 *     regions, low-frequency fur breakup) on a handful of SHARED MeshStandardMaterials (no textures needed)
 *   - geometry is built once per species and LOD and shared by every instance; only the skeleton is per instance
 * Animation: pose buffers of per-bone euler offsets (+ body channels), additive one-shot layers with crossfades, a
 * foot-planting gait engine (stance / swing phases, predictive landing, idle re-stepping) solved with analytic
 * two-bone IK + species-controlled distal segments, spring-driven secondary motion (tails, ears), and a small priority
 * state machine (death is terminal).
 * Units: metres. Bind pose = all bone rotations 0. Creature frame: +X = left, +Y = up, +Z = forward (same as heroes).
 * three.js r128 (global THREE). No external models or animation files.
 */
(function (global) {
  'use strict';
  const T = global.THREE;
  const PI = Math.PI, TAU = 2 * PI;

  /* ============================== math ============================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const gs = (x, c, s) => { const e = (x - c) / s; return Math.exp(-e * e); };
  const gs2 = (x, c, lo, hi) => gs(x, c, x < c ? lo : hi);
  const angD = (a, c) => Math.atan2(Math.sin(a - c), Math.cos(a - c));
  const ga = (a, c, s) => { const e = angD(a, c) / s; return Math.exp(-e * e); };
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), ux), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy);
  }
  const vnoise3 = (x, y, z) => 0.5 * (vnoise(x + 0.31 * z, y - 0.17 * z) + vnoise(y + 1.7 * z, x * 0.9 + 3.1));
  const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = clamp01(0.5 + 0.5 * (b - a) / k); return lerp(b, a, h) - k * h * (1 - h); };
  const smax = (a, b, k) => -smin(-a, -b, k);
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const frac = (x) => x - Math.floor(x);
  const ease = {
    io: (t) => { t = clamp01(t); return t * t * (3 - 2 * t); },
    out: (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t); },
    in: (t) => { t = clamp01(t); return t * t; },
    out3: (t) => { t = clamp01(t); return 1 - Math.pow(1 - t, 3); },
  };
  // piecewise cubic Hermite through keys [[x, v0, v1, ...], ...] (non-uniform Catmull-Rom tangents) - same as heromodel
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
  // radius of a super-ellipse toward angle a (0 = +Y "top" of the section frame, pi/2 = +X): half-width xr, top yt, bottom yb
  function seR(a, xr, yt, yb, n) {
    const s = Math.abs(Math.sin(a)), c = Math.cos(a), yr = c >= 0 ? yt : yb;
    if (xr < 1e-6 || yr < 1e-6) return 0;
    return 1 / Math.pow(Math.pow(s / xr, n) + Math.pow(Math.abs(c) / yr, n), 1 / n);
  }

  /* ============================== signed distance sculpting ============================== */
  /* sdf([...prims]) -> (x, y, z) => distance. Prims are applied in order; the first must be additive.
   *   { e: [cx, cy, cz], r: [rx, ry, rz], rot?: [ex, ey, ez], k: blend, sub?: true }   ellipsoid (iq's approximation)
   *   { c: [ax, ay, az, bx, by, bz], ra, rb, k, sub?, sq?: lateral squash }             round cone (exact)
   * k = smooth-union radius (organic transitions between masses), sub = smooth subtraction (sockets, grooves). */
  function sdf(prims) {
    const P = prims.map((q) => {
      const o = { k: q.k || 0, sub: !!q.sub };
      if (q.e) {
        o.t = 0; o.cx = q.e[0]; o.cy = q.e[1]; o.cz = q.e[2];
        o.ix = 1 / q.r[0]; o.iy = 1 / q.r[1]; o.iz = 1 / q.r[2]; o.mr = Math.min(q.r[0], q.r[1], q.r[2]);
        if (q.rot) { const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(q.rot[0], q.rot[1], q.rot[2])).invert(); o.m = m.elements.slice(); }
      } else {
        o.t = 1; const c = q.c;
        o.ax = c[0]; o.ay = c[1]; o.az = c[2]; o.bax = c[3] - c[0]; o.bay = c[4] - c[1]; o.baz = c[5] - c[2];
        o.l2 = o.bax * o.bax + o.bay * o.bay + o.baz * o.baz; o.r1 = q.ra; o.r2 = q.rb; o.rr = q.ra - q.rb;
        o.a2 = o.l2 - o.rr * o.rr; o.il2 = 1 / o.l2; o.sq = q.sq || 1;
      }
      return o;
    });
    function ell(o, x, y, z) {
      let X = x - o.cx, Y = y - o.cy, Z = z - o.cz;
      if (o.m) { const m = o.m, a = m[0] * X + m[4] * Y + m[8] * Z, b = m[1] * X + m[5] * Y + m[9] * Z, c = m[2] * X + m[6] * Y + m[10] * Z; X = a; Y = b; Z = c; }
      const k0 = Math.sqrt(X * X * o.ix * o.ix + Y * Y * o.iy * o.iy + Z * Z * o.iz * o.iz);
      const k1 = Math.sqrt(X * X * o.ix ** 4 + Y * Y * o.iy ** 4 + Z * Z * o.iz ** 4);
      return k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -o.mr;
    }
    function cone(o, x, y, z) {
      const px = (x - o.ax) * o.sq, py = y - o.ay, pz = z - o.az;
      const yy = px * o.bax + py * o.bay + pz * o.baz, zz = yy - o.l2;
      const xvx = px * o.l2 - o.bax * yy, xvy = py * o.l2 - o.bay * yy, xvz = pz * o.l2 - o.baz * yy;
      const x2 = xvx * xvx + xvy * xvy + xvz * xvz, y2 = yy * yy * o.l2, z2 = zz * zz * o.l2;
      const k = Math.sign(o.rr) * o.rr * o.rr * x2;
      if (Math.sign(zz) * o.a2 * z2 > k) return Math.sqrt(x2 + z2) * o.il2 - o.r2;
      if (Math.sign(yy) * o.a2 * y2 < k) return Math.sqrt(x2 + y2) * o.il2 - o.r1;
      return (Math.sqrt(x2 * o.a2 * o.il2) + yy * o.rr) * o.il2 - o.r1;
    }
    return function (x, y, z) {
      let d = 0;
      for (let i = 0; i < P.length; i++) {
        const o = P[i], e = o.t === 0 ? ell(o, x, y, z) : cone(o, x, y, z);
        d = i === 0 ? e : o.sub ? smax(d, -e, o.k) : smin(d, e, o.k);
      }
      return d;
    };
  }

  /* ============================== geometry core ============================== */
  // grid of rows x columns; point(j, i, out) gives the vertex; columns wrap (closed) unless open = true
  function gridGeo(nr, nu, point, o) {
    o = o || {};
    const nc = nu + 1, cnt = nr * nc, pos = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
    const p = new T.Vector3(), extra = o.extra ? new Array(cnt) : null;
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      const k = j * nc + i;
      const info = point(j, i, p);
      pos[3 * k] = p.x; pos[3 * k + 1] = p.y; pos[3 * k + 2] = p.z;
      uv[2 * k] = i / nu; uv[2 * k + 1] = j / Math.max(1, nr - 1);
      if (extra) extra[k] = info;
    }
    const idx = [];
    for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nu; i++) {
      const a = j * nc + i, b = a + 1, c = a + nc + 1, d = a + nc;
      idx.push(a, b, c, a, c, d);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.userData.extra = extra;
    return g;
  }
  // make triangles face away from `inside(k)` (a point known to be inside the surface for vertex k)
  function orient(g, insideOf) {
    const P = g.attributes.position, I = g.index.array, a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), q = new T.Vector3();
    let vote = 0;
    for (let t = 0; t < I.length; t += 3 * 7) {
      a.fromBufferAttribute(P, I[t]); b.fromBufferAttribute(P, I[t + 1]); c.fromBufferAttribute(P, I[t + 2]);
      n.subVectors(b, a).cross(q.subVectors(c, a));
      if (n.lengthSq() < 1e-14) continue;
      insideOf(I[t], q); a.sub(q);
      vote += n.dot(a) > 0 ? 1 : -1;
    }
    if (vote < 0) for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
    g.index.needsUpdate = true;
    return g;
  }
  function weldNormals(g) {
    const P = g.attributes.position, N = g.attributes.normal, map = new Map(), v = new T.Vector3();
    for (let i = 0; i < P.count; i++) {
      const key = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
      const l = map.get(key); if (l) l.push(i); else map.set(key, [i]);
    }
    for (const l of map.values()) {
      if (l.length < 2) continue;
      v.set(0, 0, 0);
      for (const i of l) { v.x += N.getX(i); v.y += N.getY(i); v.z += N.getZ(i); }
      v.normalize();
      for (const i of l) N.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  }
  function finish(g, insideOf) {
    orient(g, insideOf);
    g.computeVertexNormals();
    weldNormals(g);
    return g;
  }
  // evenly spaced rows by surface arc length: sample(u) -> array of points (a few angles) for u in [0, 1]
  function arcParams(sample, n, dense) {
    const S = dense || 300, cum = [0];
    let prev = sample(0).map((p) => p.clone());
    for (let i = 1; i <= S; i++) {
      const cur = sample(i / S);
      let d = 0;
      for (let k = 0; k < cur.length; k++) d = Math.max(d, cur[k].distanceTo(prev[k]));
      cum.push(cum[i - 1] + d + 1e-6);
      prev = cur.map((p) => p.clone());
    }
    const out = [];
    let i = 1;
    for (let j = 0; j <= n; j++) {
      const s = cum[S] * j / n;
      while (i < S && cum[i] < s) i++;
      const f = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      out.push((i - 1 + clamp01(f)) / S);
    }
    return out;
  }

  /* SDF surface projected along an axis curve (spine, head axis). Origins move along the curve; rays are perpendicular
   * to it in the middle and sweep onto the axis at both ends (rounded caps). The ray marches in from outside, so the
   * visible outer surface is captured and the grid stays a clean quad topology aligned with the anatomy.
   *   o.sdf, o.curve (THREE.Curve, bind space), o.up (section 'top' reference, default +Y), o.rows, o.nu,
   *   o.cap0 / o.cap1 = fraction of the rows spent on the back / front cap (0 = open end), o.rmax
   *   o.info(p, s, a) per vertex (stored for weights / colour) */
  function projectSDF(o) {
    const C = o.curve, up = o.up || new T.Vector3(0, 1, 0), cap0 = o.cap0 === undefined ? 0.12 : o.cap0, cap1 = o.cap1 === undefined ? 0.12 : o.cap1;
    const rmax = o.rmax || 1, f = o.sdf, O = new T.Vector3(), Tg = new T.Vector3(), X = new T.Vector3(), Y = new T.Vector3(), D = new T.Vector3();
    const mapU = (u) => {                                  // u -> [s, phi] (phi = angle of the ray off the axis; pi/2 = radial)
      if (u < cap0) return [0, (u / cap0) * PI / 2, -1];
      if (u > 1 - cap1) return [1, ((1 - u) / cap1) * PI / 2, 1];
      return [(u - cap0) / Math.max(1e-6, 1 - cap0 - cap1), PI / 2, 0];
    };
    const ray = (u, a, out) => {
      const [s, phi, end] = mapU(u);
      C.getPointAt(clamp01(s), O); C.getTangentAt(clamp01(s), Tg);
      Y.copy(up).addScaledVector(Tg, -up.dot(Tg)).normalize(); X.crossVectors(Y, Tg);
      D.copy(Y).multiplyScalar(Math.cos(a)).addScaledVector(X, Math.sin(a)).multiplyScalar(Math.sin(phi));
      if (end) D.addScaledVector(Tg, end * Math.cos(phi));
      D.normalize();
      let r = rmax;
      for (let it = 0; it < 90; it++) {
        const d = f(O.x + D.x * r, O.y + D.y * r, O.z + D.z * r);
        if (Math.abs(d) < 1e-5) break;
        r -= d * 0.8;
        if (r < 0.002) { r = 0.002; break; }
      }
      return out.copy(O).addScaledVector(D, r);
    };
    const angs = [0, PI / 2, PI, -PI / 2], tmp = angs.map(() => new T.Vector3());
    const U = arcParams((u) => angs.map((a, k) => ray(u, a, tmp[k])), o.rows - 1, 240);
    const nu = o.nu, origins = [];
    const g = gridGeo(U.length, nu, (j, i, out) => {
      const a = -PI + TAU * i / nu;
      ray(U[j], a, out);
      const s = mapU(U[j])[0];
      return { s, a, u: U[j] };
    }, { extra: true });
    const P = new T.Vector3();
    const ex = g.userData.extra;
    finish(g, (k, out) => { C.getPointAt(clamp01(ex[k].s), out); return out; });
    void origins; void P;
    return g;
  }

  /* Swept tube along a Catmull-Rom path with keyed sections (limbs, tails, ears, tusks, snake bodies).
   *   o.pts: Vector3[] (bind space), o.prof(s) -> [halfWidth, top, bottom, n, dx, dy] (s = 0..1 arc length),
   *   o.up: section 'top' reference (default +Y; legs use +Z so top = front), o.detail(s, a) radial offset,
   *   o.rows, o.nu, o.cap0 / o.cap1 = rounded cap rows at the start / end (0 = none), o.closed = closed path */
  function sweep(o) {
    const cv = o.curve || new T.CatmullRomCurve3(o.pts, !!o.closed, 'centripetal');
    const up = o.up || new T.Vector3(0, 1, 0), P = new T.Vector3(), Tg = new T.Vector3(), X = new T.Vector3(), Y = new T.Vector3();
    const prof = o.prof, q = [0, 0, 0, 2, 0, 0], c0 = o.cap0 === undefined ? 3 : o.cap0, c1 = o.cap1 === undefined ? 3 : o.cap1;
    const frameAt = (s) => {
      cv.getPointAt(clamp01(s), P); cv.getTangentAt(clamp01(s), Tg);
      const uu = o.upAt ? o.upAt(s) : up;
      Y.copy(uu).addScaledVector(Tg, -uu.dot(Tg)); if (Y.lengthSq() < 1e-8) Y.set(1, 0, 0).addScaledVector(Tg, -Tg.x); Y.normalize(); X.crossVectors(Y, Tg);
    };
    // parametric super-ellipse (even vertex spread on flat sections: ears, blades, tusks), detail pushes radially
    const spow = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));
    const secPt = (s, a, sc, off, out) => {
      frameAt(s); prof(s, q);
      const e = 2 / (q[3] || 2), sa = Math.sin(a), ca = Math.cos(a);
      let xx = Math.max(q[0], 0) * spow(sa, e), yy = (ca >= 0 ? Math.max(q[1], 0) : Math.max(q[2], 0)) * spow(ca, e);
      if (o.detail) { const r = Math.hypot(xx, yy); if (r > 1e-6) { const k = Math.max(0.05, (r + o.detail(s, a, q)) / r); xx *= k; yy *= k; } }
      xx *= sc; yy *= sc;
      const rm = Math.max(q[0], q[1], q[2]);
      const cup = o.cup ? o.cup(s) * (1 - Math.pow(clamp01(Math.abs(xx) / Math.max(1e-5, q[0])), 2)) * sc : 0;
      return out.copy(P).addScaledVector(X, (q[4] || 0) * sc + xx).addScaledVector(Y, (q[5] || 0) * sc + yy + cup).addScaledVector(Tg, off * rm);
    };
    const angs = [0, PI / 2, PI, -PI / 2], tmp = angs.map(() => new T.Vector3());
    const S = arcParams((s) => angs.map((a, k) => secPt(s, a, 1, 0, tmp[k])), (o.rows || 20) - 1, 200);
    const rows = [];
    for (let k = c0; k >= 1; k--) { const qq = k / c0 * PI / 2; rows.push([0, Math.cos(qq), -Math.sin(qq)]); }
    for (const s of S) rows.push([s, 1, 0]);
    for (let k = 1; k <= c1; k++) { const qq = k / c1 * PI / 2; rows.push([1, Math.cos(qq), Math.sin(qq)]); }
    const nu = o.nu || 12;
    const g = gridGeo(rows.length, nu, (j, i, out) => {
      const [s, sc, off] = rows[j], a = -PI + TAU * i / nu;
      secPt(s, a, sc, off, out);
      return { s, a, cap: sc < 1 };
    }, { extra: true });
    const ex = g.userData.extra;
    finish(g, (k, out) => { frameAt(ex[k].s); prof(ex[k].s, q); return out.copy(P).addScaledVector(X, q[4] || 0).addScaledVector(Y, q[5] || 0); });
    g.userData.curve = cv;
    return g;
  }

  /* per-vertex attributes from callbacks: colour fn(p, n, info) -> [r,g,b], weights fn(p, info) -> [[bone, w]...] */
  function paint(g, fn) {
    const P = g.attributes.position, N = g.attributes.normal, n = P.count, col = new Float32Array(n * 3), p = new T.Vector3(), nn = new T.Vector3();
    const ex = g.userData.extra;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(P, i); nn.fromBufferAttribute(N, i);
      const c = typeof fn === 'function' ? fn(p, nn, ex ? ex[i] : null) : fn;
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  }
  function putW(si, sw, k, ws) {
    // keep the 4 strongest influences, normalised
    let b0 = -1, b1 = -1, b2 = -1, b3 = -1, w0 = 0, w1 = 0, w2 = 0, w3 = 0;
    const acc = putW._m || (putW._m = new Map()); acc.clear();
    for (let i = 0; i < ws.length; i++) { const w = ws[i][1]; if (w > 1e-5) acc.set(ws[i][0], (acc.get(ws[i][0]) || 0) + w); }
    for (const [b, w] of acc) {
      if (w > w0) { b3 = b2; w3 = w2; b2 = b1; w2 = w1; b1 = b0; w1 = w0; b0 = b; w0 = w; }
      else if (w > w1) { b3 = b2; w3 = w2; b2 = b1; w2 = w1; b1 = b; w1 = w; }
      else if (w > w2) { b3 = b2; w3 = w2; b2 = b; w2 = w; }
      else if (w > w3) { b3 = b; w3 = w; }
    }
    const s = w0 + w1 + w2 + w3 || 1;
    si[4 * k] = Math.max(b0, 0); si[4 * k + 1] = Math.max(b1, 0); si[4 * k + 2] = Math.max(b2, 0); si[4 * k + 3] = Math.max(b3, 0);
    sw[4 * k] = w0 / s; sw[4 * k + 1] = w1 / s; sw[4 * k + 2] = w2 / s; sw[4 * k + 3] = w3 / s;
    if (b0 < 0) { si[4 * k] = 0; sw[4 * k] = 1; }
  }
  function skin(g, fn) {
    const P = g.attributes.position, n = P.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), p = new T.Vector3();
    const ex = g.userData.extra;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(P, i);
      putW(si, sw, i, typeof fn === 'function' ? fn(p, ex ? ex[i] : null) : fn);
    }
    g.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    return g;
  }
  /* envelope skinning: weights from the distance to bone segments [[boneIndex, A, B], ...] (A, B = Vector3 bind points).
   * Inverse-distance^k falloff -> clean 50/50 splits across joint planes; keeps the 2-3 nearest segments. */
  const _ea = new T.Vector3(), _eb = new T.Vector3();
  function segDist(p, A, B) {
    _ea.subVectors(B, A); const l2 = _ea.lengthSq();
    const t = l2 > 1e-12 ? clamp01(_eb.subVectors(p, A).dot(_ea) / l2) : 0;
    return _eb.copy(A).addScaledVector(_ea, t).distanceTo(p);
  }
  function envelope(segs, p, k, extra) {
    k = k || 4;
    const out = [];
    let best = 1e9;
    for (const s of segs) { const d = segDist(p, s[1], s[2]) + (s[3] || 0); out.push([s[0], d]); if (d < best) best = d; }
    let sum = 0;
    for (const o of out) { o[1] = 1 / Math.pow(Math.max(o[1], 1e-4) / Math.max(best, 1e-4), k); sum += o[1]; }
    let rest = 1;
    if (extra) for (const e of extra) rest -= Math.max(0, e[1]);
    rest = Math.max(0, rest);
    for (const o of out) o[1] *= rest / sum;
    if (extra) for (const e of extra) if (e[1] > 0) out.push([e[0], e[1]]);
    return out;
  }
  // body pitch about a pivot (hips / shoulders) expressed in the body bone's local y/z: adds rx + the position fix
  function pitchAbout(P, map, th, py, pz) {
    const c = Math.cos(th), s = Math.sin(th);
    P[map['body.rx']] += th;
    P[map['body.py']] += py - (py * c - pz * s);
    P[map['body.pz']] += pz - (py * s + pz * c);
  }
  // primitive helper geometry (eyes, small studs): a three.js geometry made compatible for merging
  function prim(geo, color, bone) {
    const g = geo.index ? geo : geo;   // r128 primitives are indexed
    g.userData.extra = null;
    if (!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    paint(g, color);
    if (bone !== undefined) skin(g, [[bone, 1]]);
    return g;
  }
  function merge(list) {
    list = list.filter(Boolean);
    const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].filter((n) => list.every((g) => g.attributes[n]));
    const out = new T.BufferGeometry(), idx = [];
    let base = 0;
    const arrays = {}; for (const n of names) arrays[n] = [];
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
    out.computeBoundingSphere();
    return out;
  }
  // mirror a geometry across X (left -> right side parts), fixing winding; remaps skin indices with map(boneIndex)
  function mirrorX(g, map) {
    const c = g.clone();
    const P = c.attributes.position, N = c.attributes.normal;
    for (let i = 0; i < P.count; i++) { P.setX(i, -P.getX(i)); if (N) N.setX(i, -N.getX(i)); }
    const I = c.index.array; for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
    if (map && c.attributes.skinIndex) { const S = c.attributes.skinIndex.array; for (let i = 0; i < S.length; i++) S[i] = map(S[i]); }
    c.userData.extra = g.userData.extra;
    return c;
  }

  /* ============================== shared materials ============================== */
  // One small set for EVERY creature: colour lives in vertex colours, so species / regions never need their own material.
  // Each base has quantised hit-flash twins (see flashPatch) - swapped in while a hit flash fades, so materials stay shared across instances.
  const MATS = {};
  const MAT_DEF = {
    fur: { roughness: 0.86, metalness: 0 },                   // pelts, hides, scales (matte, like the heroes' cloth)
    skin: { roughness: 0.72, metalness: 0 },                  // bare skin, noses, rat tails, goblin skin (heroes' skin is 0.68)
    gloss: { roughness: 0.26, metalness: 0 },                 // eyes, wet nose leather
    horn: { roughness: 0.48, metalness: 0 },                  // tusks, claws, hooves, teeth
    leather: { roughness: 0.6, metalness: 0.04, tex: 'brown_leather', rep: 1.2 },   // goblin gear: SAME leather as the heroes
    cloth: { roughness: 0.9, metalness: 0, tex: 'rough_linen', rep: 1.5 },
    iron: { roughness: 0.42, metalness: 0.62 },
  };
  let texLoader = null; const texCache = {};
  let texPending = 0; const texWaiters = [];
  // calls cb once every texture requested so far has decoded (screenshots / first frame)
  function whenTexturesReady(cb) { if (texPending <= 0) cb(); else texWaiters.push(cb); }
  const texDone = () => { if (--texPending <= 0) { texPending = 0; texWaiters.splice(0).forEach((f) => f()); } };
  function tex(name, rep) {
    const TX = global.KNIGHT_TEX || {};
    if (!TX[name]) return null;
    const key = name + '@' + rep;
    if (!texCache[key]) {
      texLoader = texLoader || new T.TextureLoader();
      texPending++;
      const t = texLoader.load(TX[name], texDone, undefined, texDone); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
      texCache[key] = t;
    }
    return texCache[key];
  }
  /* Hit flash (Atherion hit_flash.gd: an unshaded blend_mix overlay pass, ALPHA = flash, colour MobGlobalConfig.hit_flash_color):
     the lit result is mixed toward the steel tone by the flash strength. The strength lives in quantised twins (FLASH_LEVELS
     steps of FLASH_STEP) so materials stay shared across instances; every level, 0 included, runs the SAME patched program
     (one onBeforeCompile source -> one cache key), so the first hit never compiles a shader. */
  const FLASH_LEVELS = 8, FLASH_STEP = 0.5 / FLASH_LEVELS;               // up to Atherion's crit strength 0.50
  const FLASH_COLOR = new T.Color(0.92, 0.94, 0.96);                      // hit_flash_color (0.788, 0.839, 0.878) as Atherion's screen shows it
  function flashPatch(shader) {
    shader.uniforms.uHitFlash = this.userData.hitFlash;
    shader.fragmentShader = 'uniform vec4 uHitFlash;\n' + shader.fragmentShader.replace('#include <tonemapping_fragment>',
      'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHitFlash.rgb, uHitFlash.a);\n#include <tonemapping_fragment>');
  }
  const flashKey = () => 'creature-hitflash';
  /* Variant tint (CreatureKit.defineVariant): the material colour multiplies the vertex colours, so a tinted copy of the
     shared material recolours a whole species with zero new geometry. Eyes (gloss) and metal (iron) keep their colour, teeth /
     claws / horn take half the tint. Tinted copies are cached per (slot, flash level, tint) and keep the SAME patched program. */
  const TINT_SLOT = { fur: 1, skin: 1, leather: 1, cloth: 1, horn: 0.5 };
  const tintKey = (tint) => tint.map((v) => v.toFixed(3)).join(',');
  function material(slot, flash, tint) {
    const lvl = flash === true ? FLASH_LEVELS : Math.max(0, Math.min(FLASH_LEVELS, flash | 0));
    const tw = tint ? TINT_SLOT[slot] || 0 : 0, tk = tw ? '@' + tintKey(tint) : '';
    const key = slot + (lvl ? '#f' + lvl : '') + tk;
    if (MATS[key]) return MATS[key];
    const d = MAT_DEF[slot];
    const o = { color: 0xffffff, roughness: d.roughness, metalness: d.metalness, vertexColors: true, skinning: true };
    if (d.tex) { o.map = tex(d.tex, d.rep); o.normalMap = tex(d.tex + 'N', d.rep); if (o.normalMap) o.normalScale = new T.Vector2(0.8, 0.8); }
    const m = new T.MeshStandardMaterial(o);
    if (tw) m.color.setRGB(1 + (tint[0] - 1) * tw, 1 + (tint[1] - 1) * tw, 1 + (tint[2] - 1) * tw);
    m.userData.hitFlash = { value: new T.Vector4(FLASH_COLOR.r, FLASH_COLOR.g, FLASH_COLOR.b, lvl * FLASH_STEP) };
    m.onBeforeCompile = flashPatch; m.customProgramCacheKey = flashKey;
    m.name = 'creature/' + key;
    MATS[key] = m;
    return m;
  }

  /* ============================== rig ============================== */
  /* Rig template: [[name, parentName|null, x, y, z, aimChildName?], ...] with WORLD bind positions (rotations = 0).
   * The template is shared; every instance gets its own Bone objects. */
  function rigTemplate(list, ends) {
    const names = list.map((b) => b[0]), idx = {}; names.forEach((n, i) => { idx[n] = i; });
    const world = list.map((b) => new T.Vector3(b[2], b[3], b[4]));
    const parent = list.map((b) => (b[1] ? idx[b[1]] : -1));
    const local = world.map((w, i) => (parent[i] < 0 ? w.clone() : w.clone().sub(world[parent[i]])));
    // aim axis (toward the aim child / end point) for IK and look-at, bind space == bone local space at rest
    const aim = list.map((b, i) => {
      let to = null;
      if (b[5] && idx[b[5]] !== undefined) to = world[idx[b[5]]];
      else if (ends && ends[b[0]]) to = new T.Vector3().fromArray(ends[b[0]]);
      else { const c = parent.indexOf(i); if (c >= 0) to = world[c]; }
      return to ? to.clone().sub(world[i]).normalize() : new T.Vector3(0, -1, 0);
    });
    const len = list.map((b, i) => {
      if (b[5] && idx[b[5]] !== undefined) return world[idx[b[5]]].distanceTo(world[i]);
      if (ends && ends[b[0]]) return new T.Vector3().fromArray(ends[b[0]]).distanceTo(world[i]);
      return 0;
    });
    const inverses = world.map((w) => new T.Matrix4().makeTranslation(-w.x, -w.y, -w.z));
    // rest basis for aiming: e1 = aim, e2 = lateral (+X) made orthogonal
    const restQ = aim.map((e1) => basisQuat(e1, new T.Vector3(1, 0, 0), new T.Quaternion()));
    return { names, idx, world, parent, local, aim, len, inverses, restQ, n: list.length };
  }
  function instantiateRig(tpl) {
    const bones = tpl.names.map((n, i) => { const b = new T.Bone(); b.name = n; b.position.copy(tpl.local[i]); return b; });
    let top = null;
    bones.forEach((b, i) => { if (tpl.parent[i] < 0) top = top || b; else bones[tpl.parent[i]].add(b); });
    bones.forEach((b, i) => { if (tpl.parent[i] < 0 && b !== top) top.add(b); });
    const skeleton = new T.Skeleton(bones, tpl.inverses);
    return { bones, top, skeleton };
  }
  // quaternion of the basis (e1 = dir, e2 = side made orthogonal, e3 = e1 x e2) relative to the canonical axes
  const _b1 = new T.Vector3(), _b2 = new T.Vector3(), _b3 = new T.Vector3(), _bm = new T.Matrix4();
  function basisQuat(dir, side, out) {
    _b1.copy(dir).normalize();
    _b2.copy(side).addScaledVector(_b1, -side.dot(_b1));
    if (_b2.lengthSq() < 1e-10) _b2.set(0, 0, 1).addScaledVector(_b1, -_b1.z);
    _b2.normalize(); _b3.crossVectors(_b1, _b2);
    _bm.makeBasis(_b1, _b2, _b3);
    return out.setFromRotationMatrix(_bm);
  }

  /* ============================== IK ============================== */
  const _q1 = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion(), _qi = new T.Quaternion();
  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _v4 = new T.Vector3(), _v5 = new T.Vector3();
  /* world rotation that points bone i's aim axis along `dir`, with its lateral axis toward `side` */
  function aimWorld(tpl, i, dir, side, out) {
    basisQuat(dir, side, _q1);
    _qi.copy(tpl.restQ[i]).invert();
    return out.copy(_q1).multiply(_qi);
  }
  // local quaternion from desired world rotation and the parent's world rotation
  function toLocal(parentWorldQ, worldQ, out) { return out.copy(parentWorldQ).invert().multiply(worldQ); }
  /* analytic two-bone IK: joint A, lengths a, b, target Tt, bend toward pole -> knee position K (and clamped target) */
  function twoBone(A, a, b, Tt, pole, K, Tout) {
    const d = _v1.subVectors(Tt, A); let c = d.length();
    const cmin = Math.abs(a - b) + 1e-4, cmax = (a + b) * 0.9995;
    if (c < 1e-6) { d.set(0, -1, 0); c = cmin; } else d.divideScalar(c);
    c = clamp(c, cmin, cmax);
    Tout.copy(A).addScaledVector(d, c);
    const n = _v2.copy(pole).addScaledVector(d, -pole.dot(d));
    if (n.lengthSq() < 1e-10) n.set(0, 0, 1).addScaledVector(d, -d.z);
    n.normalize();
    const ca = clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1), sa = Math.sqrt(1 - ca * ca);
    return K.copy(A).addScaledVector(d, a * ca).addScaledVector(n, a * sa);
  }

  /* ============================== springs (secondary motion) ============================== */
  function spring() { return { x: 0, v: 0 }; }
  function stepSpring(s, target, k, c, dt) {            // critically-ish damped spring toward target
    const n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
    for (let i = 0; i < n; i++) { s.v += (k * (target - s.x) - c * s.v) * h; s.x += s.v * h; }
    return s.x;
  }

  /* ============================== pose buffers ============================== */
  /* Channels: per bone rx, ry, rz (euler offsets, order YXZ) then body px, py, pz and named scalars (IK weights etc.).
   * A Pose object is a Float32Array; channel(name) resolves 'bone.rx' / 'body.py' / scalar names to an index. */
  function channelMap(tpl, scalars) {
    const map = {}, n = tpl.n;
    tpl.names.forEach((nm, i) => { map[nm + '.rx'] = 3 * i; map[nm + '.ry'] = 3 * i + 1; map[nm + '.rz'] = 3 * i + 2; });
    map['body.px'] = 3 * n; map['body.py'] = 3 * n + 1; map['body.pz'] = 3 * n + 2;
    (scalars || []).forEach((s, k) => { map[s] = 3 * n + 3 + k; });
    map._size = 3 * n + 3 + (scalars || []).length;
    map._scalar0 = 3 * n + 3;
    return map;
  }
  /* action track: keyed by NAMED INSTANTS of the gameplay timeline, so the animation is driven by the same phase
   * numbers the authoritative simulation uses for its hit window.
   *   instants: { s: 0, an: antic peak, wu: wind-up end, hit: active, fo: follow-through end, e: 1 } (normalised u)
   *   chans: { 'head.rx': [v_s, v_an, v_wu, v_hit, v_fo, v_e] or {k: [[u, v], ...]} } */
  function track(map, instants, chans, order) {
    order = order || ['s', 'an', 'wu', 'hit', 'fo', 'e'];
    const us = order.map((k) => instants[k]);
    const list = [];
    for (const name in chans) {
      const i = map[name];
      if (i === undefined) { console.warn('creature track: unknown channel ' + name); continue; }
      const v = chans[name];
      const keys = Array.isArray(v) ? v.map((x, k) => [us[k], x]) : v.k;
      // de-duplicate equal u keys (instants may coincide)
      const clean = []; for (const k of keys) { if (clean.length && Math.abs(clean[clean.length - 1][0] - k[0]) < 1e-6) clean[clean.length - 1] = k; else clean.push(k); }
      list.push({ i, f: curve(clean), scalar: i >= map._scalar0 });
    }
    const o = [0];
    return (P, u, w) => { for (const c of list) { c.f(u, o); P[c.i] += o[0] * w; } };
  }

  /* ============================== gait engine (foot planting) ============================== */
  /* Feet: [{ key, hip: boneIndex (IK root joint), rest: Vector3 ground point in ROOT space, off: {gaitName: phase} }]
   * Gaits: { name: { stride(v), duty, lift, minV } } chosen by speed with hysteresis. Each foot: stance (world-locked)
   * then swing (lift arc to a predicted landing point so it lands centred under its hip at mid-stance). Below the
   * walking threshold the phase stops; swinging feet finish and planted feet re-step one at a time when they drift
   * from their rest spot (turning in place, attack lunges). */
  class Gait {
    constructor(feet, gaits, select, opts) {
      this.gaits = gaits; this.select = select; this.opts = opts || {};
      this.feet = feet.map((f) => ({
        key: f.key, rest: f.rest.clone(), off: f.off, side: f.side || 0, pair: f.pair, fore: !!f.fore,
        pos: new T.Vector3(), from: new T.Vector3(), to: new T.Vector3(), planted: true, t: 0, dur: 0.2, u: 0,
        lift: 0, idleStep: false, liftH: f.liftH || 0.1, init: false, swingU: 0, stanceU: 0.5, landT: 0,
      }));
      this.phase = 0; this.gait = Object.keys(gaits)[0]; this.speed = 0; this.blend = 0;
      this._r = new T.Vector3(); this._w = new T.Vector3(); this._vel = new T.Vector3();
    }
    restWorld(f, root, out) { return out.copy(f.rest).applyMatrix4(root.matrixWorld).setY(0); }
    reset(root) {
      root.updateMatrixWorld(true);
      for (const f of this.feet) { this.restWorld(f, root, f.pos); f.planted = true; f.init = true; f.lift = 0; }
      this.phase = 0;
    }
    update(dt, root, vel, turnRate) {
      // gaits are authored at scale 1: a creature scaled by s moving at v strides like the original at v / s
      const sc = root.scale.x || 1, v = Math.hypot(vel.x, vel.z), vn = v / sc;
      this.speed = v;
      const gname = this.select(vn, this.gait); this.gait = gname;
      const G = this.gaits[gname];
      const moving = vn > (G.minV || 0.05);
      const stride = G.stride(vn) * sc, freq = moving ? v / Math.max(0.05 * sc, stride) : 0;
      const duty = G.duty;
      const prev = this.phase;
      if (moving) this.phase = frac(this.phase + freq * dt);
      for (const f of this.feet) {
        if (!f.init) { this.restWorld(f, root, f.pos); f.init = true; }
        const off = f.off[gname] || 0;
        const p0 = frac(prev + off), p1 = frac(this.phase + off);
        if (moving) {
          // stance phase [0, duty), swing [duty, 1)
          const fd = f.fore && G.dutyF ? G.dutyF : duty;            // fore feet may have a shorter stance (bounds, gallops)
          const crossed = (p0 < fd && p1 >= fd) || (p1 < p0 && p1 >= fd);
          if (crossed && f.planted) this._lift(f, (1 - fd) / Math.max(0.2, freq), false);
          // over-stretched planted foot (would have to drag): step now instead of sliding
          // over-stretched planted foot: step instead of dragging (late in stance, or any time while motion is just starting)
          else if (f.planted && f.strain && p1 < fd && (p1 > fd * (this.opts.strainFrom || 0.45) || this.moveT < 0.6)) this._lift(f, (1 - fd) / Math.max(0.2, freq) + (fd - p1) / Math.max(0.2, freq), false);
          // missed lift (motion start, gait switch): planted although its phase is mid-swing -> swing for the rest of it
          else if (f.planted && p1 >= fd + 0.04 && p1 < 0.92 && f.landT > 0.5 * fd / Math.max(0.2, freq)) this._lift(f, (1 - p1) / Math.max(0.2, freq), false);
          f.stanceU = p1 < fd ? p1 / fd : 1;
        }
        if (!f.planted) {
          f.t += dt;
          const u = clamp01(f.t / f.dur);
          // predictive landing: rest spot under the hip, advanced by velocity for the remaining swing + half a stance
          const remain = f.dur - f.t + (moving ? 0.5 * (f.fore && G.dutyF ? G.dutyF : duty) / Math.max(0.2, freq) : 0);
          this.restWorld(f, root, this._r);
          this._r.x += vel.x * remain; this._r.z += vel.z * remain;
          f.to.lerp(this._r, 1 - Math.exp(-dt * 25));
          const e = ease.io(u);
          f.pos.lerpVectors(f.from, f.to, e);
          f.lift = Math.sin(PI * Math.pow(u, 0.85)) * f.liftH * (f.idleStep ? 0.6 : 1) * (G.liftK ? G.liftK(vn) : 1);
          f.swingU = u;
          if (u >= 1) { f.planted = true; f.lift = 0; f.pos.copy(f.to); f.pos.y = 0; f.stanceU = 0; f.landT = 0; if (this.onPlant) this.onPlant(f); }
        }
      }
      for (const f of this.feet) { f.strain = false; if (f.planted) f.landT += dt; }
      this.moveT = moving ? (this.moveT || 0) + dt : 0;
      if (!moving) {
        // settle: finish swings, then re-step the worst-placed foot (one at a time, diagonal pairs never together)
        let worst = null, wd = 0;
        const busy = this.feet.some((f) => !f.planted);
        if (!busy) for (const f of this.feet) {
          this.restWorld(f, root, this._r);
          const d = Math.hypot(this._r.x - f.pos.x, this._r.z - f.pos.z);
          if (d > (this.opts.restTol || 0.12) * sc && d > wd) { wd = d; worst = f; }
        }
        if (worst) { this._lift(worst, this.opts.idleStepDur || 0.22, true); }
      }
      this.moving = moving;
    }
    _lift(f, dur, idle) {
      f.planted = false; f.t = 0; f.dur = Math.max(0.08, dur); f.from.copy(f.pos); f.to.copy(f.pos); f.idleStep = idle; f.swingU = 0; f.landT = 0;
    }
    // re-anchor a foot to an arbitrary world point (e.g. after FK took over during a leap)
    plantAt(f, p) { f.pos.copy(p).setY(0); f.planted = true; f.lift = 0; f.landT = 0; }
  }

  /* ============================== state machine ============================== */
  /* Priorities: DEATH 100 (terminal) > STAGGER 50 > HIT 40 > ATTACK / special actions 30 > IDLE-SPECIALS 10 > LOCO 0.
   * Actions are additive layers on top of locomotion/idle, cross-faded in and out; a new action of equal or higher
   * priority replaces the current one (the old one keeps fading out on its own clock); lower priority requests are
   * refused while it plays. Once DEATH started nothing else is accepted until reset() (pool reuse on respawn). */
  const PRIO = { loco: 0, special: 10, attack: 30, action: 30, hit: 40, stagger: 50, death: 100 };
  class StateMachine {
    constructor() { this.cur = null; this.fading = []; this.dead = false; }
    reset() { this.cur = null; this.fading.length = 0; this.dead = false; }
    can(def) { if (this.dead) return false; if (!this.cur) return true; return (PRIO[def.kind] || 0) >= (PRIO[this.cur.def.kind] || 0) || this.cur.done; }
    play(name, def, opts) {
      if (!this.can(def)) return false;
      opts = opts || {};
      if (this.cur) { this.cur.fadeOut = Math.min(this.cur.fadeOut || 1e9, def.blendIn || 0.12); this.cur.fadingT = 0; this.fading.push(this.cur); }
      this.cur = { name, def, t: opts.t || 0, rate: opts.rate || 1, w: opts.instant ? 1 : 0, done: false, ext: opts.ext || null, data: opts.data || {} };
      if (def.kind === 'death') this.dead = true;
      return true;
    }
    stop(name) { if (this.cur && (!name || this.cur.name === name) && !this.dead) { this.cur.fadeOut = this.cur.def.blendOut || 0.18; this.cur.fadingT = 0; this.fading.push(this.cur); this.cur = null; } }
    update(dt) {
      const c = this.cur;
      if (c) {
        if (c.ext) c.t = c.ext(dt, c.t); else c.t += dt * c.rate;            // ext = authoritative clock (attacks)
        c.w = Math.min(1, c.w + dt / Math.max(0.01, c.def.blendIn || 0.12));
        const u = c.t / c.def.dur;
        if (u >= 1) {
          if (c.def.kind === 'death' || c.def.hold) { c.t = c.def.dur; c.done = true; }
          else { c.fadeOut = c.def.blendOut || 0.2; c.fadingT = 0; this.fading.push(c); this.cur = null; c.t = c.def.dur; c.done = true; }
        }
      }
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const f = this.fading[i];
        f.fadingT += dt;
        if (!f.done) { f.t = Math.min(f.def.dur, f.t + dt * f.rate); }
        f.wOut = Math.max(0, 1 - f.fadingT / Math.max(0.01, f.fadeOut));
        if (f.wOut <= 0) this.fading.splice(i, 1);
      }
    }
    // visit active layers: fn(layer, u, weight)
    each(fn) {
      for (const f of this.fading) fn(f, clamp01(f.t / f.def.dur), f.w * f.wOut);
      if (this.cur) fn(this.cur, clamp01(this.cur.t / this.cur.def.dur), ease.io(this.cur.w));
    }
  }

  /* ============================== species registry + view ============================== */
  const SPECIES = {};
  const GEO_CACHE = {};
  function defineSpecies(id, sp) { sp.id = id; SPECIES[id] = sp; return sp; }
  /* A VARIANT is a base species wearing a colour tint at another size, with its own gameplay entry in CREATURE_DEFS.SPECIES
     (derived in defs.js). It delegates rig / channels / build / animator / clips / specials / attack animations to the base
     through the prototype chain, so CreatureView(id) works unchanged; geometry is built once per BASE (speciesGeometry
     resolves geoOf) and shared. o: { tint: [r, g, b] (multiplies the vertex colours, >1 allowed) }. The view scale comes from
     the variant's own def (game scale x variant multiplier). Returns null while the base species is not loaded. */
  function defineVariant(id, baseId, o) {
    const base = SPECIES[baseId];
    if (!base) return null;
    const v = Object.create(base);
    v.id = id; v.base = base; v.baseId = baseId; v.geoOf = base.geoOf || baseId;
    v.def = (global.CREATURE_DEFS && global.CREATURE_DEFS.SPECIES[id]) || base.def;
    v.tint = o && o.tint ? o.tint.slice() : null;
    SPECIES[id] = v;
    return v;
  }
  // build (once) and cache a species' geometry for a LOD level: { slots: { fur: geo, gloss: geo, ... }, tris }
  function speciesGeometry(id, lod) {
    const sp0 = SPECIES[id];
    if (sp0 && sp0.geoOf) id = sp0.geoOf;                           // variants share their base's geometry
    const key = id + '@' + lod;
    if (GEO_CACHE[key]) return GEO_CACHE[key];
    const sp = SPECIES[id], t0 = performance.now();
    const parts = sp.build(lod === 0 ? 1 : sp.lowQ || 0.5, sp.rig);
    if (lod > 0) {                     // distant LOD: all untextured slots share one material -> ONE draw call per creature
      const into = parts.fur && parts.fur.length ? 'fur' : parts.skin && parts.skin.length ? 'skin' : null;
      if (into) for (const s of ['fur', 'skin', 'gloss', 'horn']) if (s !== into && parts[s] && parts[s].length) { parts[into] = parts[into].concat(parts[s]); delete parts[s]; }
    }
    const slots = {}; let tris = 0;
    for (const s in parts) {
      const list = parts[s].filter(Boolean); if (!list.length) continue;
      slots[s] = merge(list);
      tris += slots[s].index.count / 3;
    }
    const out = { slots, tris, ms: performance.now() - t0 };
    GEO_CACHE[key] = out;
    return out;
  }

  /* CreatureView: one rendered instance (rig + skinned meshes + animator). Pure client-side presentation: it is driven
   * by authoritative snapshots (position, yaw, state, attack clock) and never creates gameplay events itself. */
  let uid = 0;
  class CreatureView {
    constructor(speciesId, opts) {
      opts = opts || {};
      const sp = SPECIES[speciesId];
      if (!sp) throw new Error('unknown species ' + speciesId);
      this.sp = sp; this.id = ++uid;
      this.tpl = sp.rig;
      this.root = new T.Object3D(); this.root.name = 'creature:' + speciesId;
      const R = instantiateRig(this.tpl);
      this.bones = R.bones; this.skeleton = R.skeleton; this.root.add(R.top);
      this.scale = opts.scale || (sp.def && sp.def.scale) || 1;          // game scale (defs.js; variants: base x multiplier)
      this.tint = sp.tint || null;
      this.root.scale.setScalar(this.scale);
      this.meshes = {}; this.lod = -1;
      this.lodMeshes = [[], []];
      for (let L = 0; L < 2; L++) {
        const G = speciesGeometry(speciesId, L);
        for (const s in G.slots) {
          const m = new T.SkinnedMesh(G.slots[s], material(s, 0, this.tint));
          m.bind(this.skeleton, new T.Matrix4());
          m.frustumCulled = false;            // culled per creature (bounding sphere of the animated root) by the world
          m.castShadow = L === 0; m.receiveShadow = false;
          m.userData.slot = s; m.visible = false;
          this.root.add(m); this.lodMeshes[L].push(m);
        }
      }
      this.setLOD(0);
      this.map = sp.chan;
      this.P = new Float32Array(this.map._size);
      this.sm = new StateMachine();
      this.anim = sp.animator ? new sp.animator(this, opts) : null;
      this.flashT = 0; this.flashDur = 0.1; this.flashStr = 0; this.flashOn = 0;
      this.time = Math.random() * 10;
      this.vel = new T.Vector3(); this._lastPos = new T.Vector3(); this._first = true;
      this.speedSm = 0; this.turnRate = 0; this._lastYaw = 0;
      this.debug = null;
    }
    setLOD(L) {
      if (L === this.lod) return;
      this.lod = L;
      for (let k = 0; k < 2; k++) for (const m of this.lodMeshes[k]) m.visible = k === L;
    }
    setShadow(on) { for (const m of this.lodMeshes[0]) m.castShadow = on; }
    // hit flash (Atherion hit_flash.play): peak `strength` (mix toward the steel tone), linear fade over `duration` s.
    // Defaults = MobGlobalConfig normal hit (0.34 / 0.10 s); crit is 0.50 / 0.16 s. A weaker flash never cuts a stronger one.
    flash(duration, strength) {
      const d = duration || 0.1, s = strength === undefined ? 0.34 : strength;
      if (s >= this._flashNow()) { this.flashT = d; this.flashDur = d; this.flashStr = s; }
    }
    _flashNow() { return this.flashT > 0 ? this.flashStr * (this.flashT / this.flashDur) : 0; }
    _applyFlash(dt) {
      this.flashT = Math.max(0, this.flashT - dt);
      const lvl = Math.round(this._flashNow() / FLASH_STEP);
      if (lvl === this.flashOn) return;
      this.flashOn = lvl;
      for (let k = 0; k < 2; k++) for (const m of this.lodMeshes[k]) m.material = material(m.userData.slot, lvl, this.tint);
    }
    // state machine front door (the species animator owns the action definitions)
    play(name, opts) { return this.anim ? this.anim.play(name, opts) : false; }
    get dead() { return this.sm.dead; }
    // place without animation history (spawn / respawn / pool reuse)
    teleport(x, z, yaw) {
      this.root.position.set(x, 0, z); this.root.rotation.y = yaw || 0;
      this._lastPos.copy(this.root.position); this._lastYaw = this.root.rotation.y; this.vel.set(0, 0, 0); this.speedSm = 0;
      this.root.updateMatrixWorld(true);
      if (this.anim && this.anim.reset) this.anim.reset();
    }
    /* per-frame: dt = real step, quality: 2 full, 1 reduced (no secondary springs / cheaper IK), 0 = clock only */
    update(dt, quality) {
      this.time += dt;
      const rp = this.root.position;
      if (this._first) { this._lastPos.copy(rp); this._lastYaw = this.root.rotation.y; this._first = false; }
      if (dt > 1e-5) {
        const ivx = (rp.x - this._lastPos.x) / dt, ivz = (rp.z - this._lastPos.z) / dt;
        const k = 1 - Math.exp(-dt * 14);
        this.vel.x += (ivx - this.vel.x) * k; this.vel.z += (ivz - this.vel.z) * k;
        const tr = angD(this.root.rotation.y, this._lastYaw) / dt;
        this.turnRate += (tr - this.turnRate) * (1 - Math.exp(-dt * 8));
      }
      this._lastPos.copy(rp); this._lastYaw = this.root.rotation.y;
      this.speedSm = Math.hypot(this.vel.x, this.vel.z);
      this._applyFlash(dt);
      this.sm.update(dt);
      if (quality <= 0 || !this.anim) return;
      this.P.fill(0);
      this.anim.update(dt, quality);
      if (this.debug) this.debug.update();
    }
    dispose() { this.root.parent && this.root.parent.remove(this.root); }
  }

  /* ============================== quadruped animator ============================== */
  /* Generic four-legged animator used by every quadruped species. The species profile provides:
   *   legs: [{ key:'FL', type:'fore'|'hind', side:+1/-1, chain:[upper, mid, distal, toe] bone names, padH, toeLen }]
   *   gaits / select / offsets, body (bob, pitch, roll amplitudes...), base(P, ctx) for its idle/loco FK flavour,
   *   distal(leg, ctx) -> distal segment pitch (pastern / hock angle), actions { name: def with track(P, u, w) } */
  const _m4 = new T.Matrix4(), _wq = new T.Quaternion(), _pq = new T.Quaternion(), _e = new T.Euler(0, 0, 0, 'YXZ');
  // vertex sample of a species (all slots, LOD1, up to ~1500 per slot) with skin data, for CPU ground-contact checks;
  // only evaluated while a creature is dying or in a ground-contact action
  function groundSamples(sp) {
    const own = sp.geoOf ? SPECIES[sp.geoOf] : sp;                    // variants share the base's samples
    if (own._gs) return own._gs;
    const G = speciesGeometry(own.id, 1), p = [], ii = [], ww = [];
    for (const s in G.slots) {
      const g = G.slots[s], P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
      const step = Math.max(1, Math.round(P.count / 1500));        // dense: sparse samples missed contact points (shoulders) on big bodies
      for (let i = 0; i < P.count; i += step) { p.push(P.getX(i), P.getY(i), P.getZ(i)); for (let j = 0; j < 4; j++) { ii.push(SI.array[4 * i + j]); ww.push(SW.array[4 * i + j]); } }
    }
    own._gs = { p: new Float32Array(p), i: new Uint16Array(ii), w: new Float32Array(ww), n: p.length / 3 };
    return own._gs;
  }
  class QuadAnimator {
    constructor(view, opts) {
      this.v = view; const sp = view.sp; this.sp = sp; this.prof = sp.anim; this.map = sp.chan;
      const tpl = view.tpl, B = view.bones;
      this.B = B; this.tpl = tpl;
      this.ix = tpl.idx;
      this.legs = this.prof.legs.map((L) => {
        const c = L.chain.map((n) => tpl.idx[n]);
        const w = (i) => tpl.world[c[i]];
        return Object.assign({}, L, {
          c, a: w(0).distanceTo(w(1)), b: w(1).distanceTo(w(2)), cLen: w(2).distanceTo(w(3)),
          restDistal: Math.atan2(w(3).z - w(2).z, -(w(3).y - w(2).y)),     // distal segment pitch off vertical (+ = forward)
          ikW: 1, fkHold: false, chW: this.map['ik' + L.key],
        });
      });
      this.feetHome = this.legs.map((L) => { const p = tpl.world[L.c[3]]; return new T.Vector3(p.x, 0, p.z + (L.toeLen || 0) * 0.35); });
      this.gait = new Gait(this.legs.map((L, i) => ({ key: L.key, rest: this.feetHome[i], off: this.prof.offsets[L.key], liftH: L.lift || 0.08, side: L.side, fore: L.type === 'fore' })),
        this.prof.gaits, this.prof.select, this.prof.gaitOpts);
      this.springs = {};
      this.ctx = { t: 0, v: 0, gait: this.gait, view, look: 0, lookY: 0, alert: 0, rng: Math.random() };
      this.idleState = { t: 0, next: 2 + Math.random() * 3, act: null };
      this._tmp = { A: new T.Vector3(), K: new T.Vector3(), W: new T.Vector3(), Tt: new T.Vector3(), P: new T.Vector3(), side: new T.Vector3(), fwd: new T.Vector3(), up: new T.Vector3(0, 1, 0), pole: new T.Vector3(), d: new T.Vector3(), toe: new T.Vector3() };
      this._q = { up: new T.Quaternion(), mid: new T.Quaternion(), dist: new T.Quaternion(), toe: new T.Quaternion(), par: new T.Quaternion(), loc: new T.Quaternion(), fk: new T.Quaternion() };
      this.actionDefs = this.prof.actions;
    }
    // movement mode from the authority ('walk' | 'run' | 'stalk' | 'charge' | null when standing): species base() reads ctx.mode
    setMode(mode, rec) { this.ctx.mode = mode; this.ctx.enraged = !!(rec && rec.enraged); this.ctx.alert = !!(rec && rec.alert); }
    reset() { this.v.sm.reset(); this.gait.reset(this.v.root); this.idleState.act = null; this.gfix = 0; for (const k in this.springs) { this.springs[k].x = 0; this.springs[k].v = 0; } }
    play(name, opts) {
      const def = this.actionDefs[name];
      if (!def) return false;
      return this.v.sm.play(name, def, opts);
    }
    sp_(k) { return this.springs[k] || (this.springs[k] = spring()); }
    update(dt, quality) {
      const V = this.v, P = V.P, map = this.map, prof = this.prof, ctx = this.ctx;
      ctx.t += dt; ctx.dt = dt; ctx.v = V.speedSm / V.scale; ctx.turn = V.turnRate;   // speed in body-size units ctx.dead = V.sm.dead; ctx.quality = quality;
      // locomotion gait (feet) - frozen once dead
      if (!V.sm.dead) this.gait.update(dt, V.root, V.vel, V.turnRate);
      ctx.moving = this.gait.moving; ctx.gaitName = this.gait.gait; ctx.phase = this.gait.phase;
      // default IK weights = 1
      for (const L of this.legs) P[L.chW] = 0;
      // base: species idle + locomotion flavour (FK of spine, neck, head, tail, body offsets)
      prof.base(P, ctx, this);
      // terminal death: the living layer (breathing, look-around, gait sway) fades out completely - corpses stay still
      if (V.sm.dead) {
        this.deadT = (this.deadT || 0) + dt;
        const k = Math.max(0, 1 - this.deadT / 0.35);
        if (k < 1) for (let i = 0; i < P.length; i++) P[i] *= k;
      } else this.deadT = 0;
      // one-shot layers (additive), IK weights are stored as negative offsets from 1
      V.sm.each((layer, u, w) => { if (layer.def.track) layer.def.track(P, u, w, layer, ctx, this); });
      // hit flinch (additive, decays)
      if (this.hitT !== undefined && this.hitT < 0.45) { this.hitT += dt; if (prof.flinch) prof.flinch(P, this.hitT, this.hitDir, this.hitPow || 1, this); }
      this.apply(P, quality);
    }
    hit(dirLocalX, dirLocalZ, power) { this.hitT = 0; this.hitDir = [dirLocalX, dirLocalZ]; this.hitPow = power; }
    // pose -> bones, then leg IK, then springs
    apply(P, quality) {
      const B = this.B, n = this.tpl.n, ixb = this.ix.body;
      for (let i = 0; i < n; i++) {
        _e.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
        B[i].quaternion.setFromEuler(_e);
      }
      const body = B[ixb], m = this.map;
      body.position.copy(this.tpl.local[ixb]);
      body.position.x += P[m['body.px']]; body.position.y += P[m['body.py']] + (this.gfix || 0) / this.v.scale; body.position.z += P[m['body.pz']];
      if (this.prof.post) this.prof.post(P, this.ctx, this);
      this.v.root.updateMatrixWorld(true);
      for (let li = 0; li < this.legs.length; li++) this.solveLeg(this.legs[li], li, P);
      if (this.prof.secondary && quality >= 2) this.prof.secondary(this.ctx, this);
      if (this.prof.ground) this.prof.ground(this.ctx, this);
      if (this.prof.groundFix && (this.v.sm.dead || (this.v.sm.cur && this.v.sm.cur.def.ground))) this.groundFix();
    }
    /* death / ground-contact actions: CPU-skin a sparse vertex sample, then lift the body out of the ground and, once
       the collapse is under way, let it settle down onto it (no floating corpses, no sinking through the terrain) */
    groundFix() {
      const S = groundSamples(this.sp), B = this.B, inv = this.tpl.inverses, n = this.tpl.n;
      const Mw = this._gm || (this._gm = new Float32Array(n * 4)), tm = _m4;
      for (let i = 0; i < n; i++) { tm.multiplyMatrices(B[i].matrixWorld, inv[i]); const e = tm.elements; Mw[4 * i] = e[1]; Mw[4 * i + 1] = e[5]; Mw[4 * i + 2] = e[9]; Mw[4 * i + 3] = e[13]; }
      // lowest point of the BODY: the very lowest few percent of the sample (a dangling tail tip / leg tip) may poke into the
      // ground - pinning them to it used to hold dead rats ~1 m in the air by their tail
      const ys = this._gy && this._gy.length === S.n ? this._gy : (this._gy = new Float32Array(S.n));
      for (let k = 0; k < S.n; k++) {
        let y = 0;
        for (let j = 0; j < 4; j++) { const w = S.w[4 * k + j]; if (w <= 0) continue; const b = 4 * S.i[4 * k + j]; y += w * (Mw[b] * S.p[3 * k] + Mw[b + 1] * S.p[3 * k + 1] + Mw[b + 2] * S.p[3 * k + 2] + Mw[b + 3]); }
        ys[k] = y;
      }
      const sorted = ys.slice().sort();
      // species with a long dangling tail (rat) ignore the lowest few percent: a hanging tail tip must not hold the body in the air
      const pf = this.prof.groundPct || 0, m = pf > 0 ? sorted[Math.min(S.n - 1, Math.floor(S.n * pf))] : sorted[0];
      const cur = this.v.sm.cur, u = cur ? cur.t / cur.def.dur : 1;
      const settle = this.v.sm.dead && u > 0.45;
      const dt = this.ctx.dt || 0.016;
      let corr = 0;
      if (m < 0) corr = -m;                                    // never below the ground
      else if (settle) corr = -Math.min(m, 0.6 * dt);          // fall the rest of the way (gravity-ish, capped)
      this.gfix = (this.gfix || 0) + corr;
      if (Math.abs(corr) > 1e-6) { const body = B[this.ix.body]; body.position.y += corr / this.v.scale; body.updateMatrixWorld(true); }
      this.lastMinY = m + corr;
    }
    solveLeg(L, li, P) {
      const w = clamp01(1 + P[L.chW]);
      L.ikW = w;
      if (w <= 0.001) { L.wasFK = true; return; }
      const B = this.B, tpl = this.tpl, t = this._tmp, q = this._q, root = this.v.root;
      const foot = this.gait.feet[li];
      if (L.wasFK) {                                         // IK fading back in: re-plant where the FK paw is now
        L.wasFK = false;
        B[L.c[3]].getWorldPosition(t.P); t.P.y = 0;
        if (foot.planted) this.gait.plantAt(foot, t.P);
      }
      // body frame axes (world)
      root.getWorldQuaternion(_wq);
      t.fwd.set(0, 0, 1).applyQuaternion(_wq); t.side.set(1, 0, 0).applyQuaternion(_wq);
      const sc = this.v.scale;
      // target paw joint: foot ground point + pad height (+ lift during swing)
      t.Tt.copy(foot.pos); t.Tt.y = (foot.lift + (L.padH || 0.02)) * 1;
      t.Tt.y *= sc;
      // distal segment direction from the species (pastern / hock angle as a function of the step)
      const ang = this.prof.distal ? this.prof.distal(L, foot, this.ctx, this) : L.restDistal;
      t.d.set(0, -Math.cos(ang), 0).addScaledVector(t.fwd, Math.sin(ang)).normalize();
      t.W.copy(t.Tt).addScaledVector(t.d, -L.cLen * sc);   // wrist / hock target
      B[L.c[0]].getWorldPosition(t.A);
      if (foot.planted && t.A.distanceTo(t.W) > (L.a + L.b) * sc * 0.985) foot.strain = true;   // gait steps it next update
      t.pole.copy(t.fwd).multiplyScalar(L.type === 'hind' ? 1 : -1).addScaledVector(t.up, -0.15);
      twoBone(t.A, L.a * sc, L.b * sc, t.W, t.pole, t.K, t.W);
      // world rotations of upper / mid / distal / toe, then local
      const side = t.side;
      aimWorld(tpl, L.c[0], _v3.subVectors(t.K, t.A), side, q.up);
      aimWorld(tpl, L.c[1], _v3.subVectors(t.W, t.K), side, q.mid);
      aimWorld(tpl, L.c[2], _v3.subVectors(t.Tt, t.W), side, q.dist);
      // toe: flat on the ground in stance, curled during swing
      const curl = (foot.planted ? 0 : Math.sin(PI * foot.swingU) * (L.curl || 0.9)) + (this.prof.toeExtra ? this.prof.toeExtra(L, foot, this.ctx) : 0);
      t.toe.copy(t.fwd).multiplyScalar(Math.cos(curl)).addScaledVector(t.up, -Math.sin(curl));
      aimWorld(tpl, L.c[3], t.toe, side, q.toe);
      const parentIdx = tpl.parent[L.c[0]];
      B[parentIdx].getWorldQuaternion(q.par);
      const chain = [q.up, q.mid, q.dist, q.toe];
      let par = q.par;
      for (let k = 0; k < 4; k++) {
        toLocal(par, chain[k], q.loc);
        const bone = B[L.c[k]];
        if (w < 0.999) { q.fk.copy(bone.quaternion); bone.quaternion.copy(q.fk).slerp(q.loc, w); }
        else bone.quaternion.copy(q.loc);
        par = chain[k];
      }
      B[L.c[0]].updateMatrixWorld(true);
    }
  }

  /* keep a bone chain (tail, snake body, ears) above the ground: each bone whose far end would dip below minY[i] is
   * pitched back up about its own lateral axis (no floating, no terrain clipping) */
  const _gc = { a: new T.Vector3(), b: new T.Vector3(), q: new T.Quaternion(), r: new T.Quaternion(), ax: new T.Vector3(), d: new T.Vector3() };
  function groundChain(A, idxs, ends, minY) {
    const B = A.B, tpl = A.tpl;
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k], bone = B[i];
      bone.updateMatrixWorld(true);
      bone.getWorldPosition(_gc.a);
      _gc.b.copy(ends[k]).applyMatrix4(bone.matrixWorld);           // far end of this bone (bone-local point)
      const my = typeof minY === 'number' ? minY : minY[k];
      if (_gc.b.y >= my) continue;
      const len = _gc.a.distanceTo(_gc.b); if (len < 1e-5) continue;
      _gc.d.subVectors(_gc.b, _gc.a).divideScalar(len);
      const want = Math.min(0.99, Math.max(-0.99, (my - _gc.a.y) / len));
      const ang = Math.asin(want) - Math.asin(Math.max(-1, Math.min(1, _gc.d.y)));
      // rotate about the world axis perpendicular to the bone direction and up
      _gc.ax.set(_gc.d.z, 0, -_gc.d.x); if (_gc.ax.lengthSq() < 1e-8) continue; _gc.ax.normalize();
      bone.parent.getWorldQuaternion(_gc.q);
      _gc.ax.applyQuaternion(_gc.q.invert());
      bone.quaternion.premultiply(_gc.r.setFromAxisAngle(_gc.ax, -ang));
      bone.updateMatrixWorld(true);
    }
  }

  /* ============================== debug helpers (showcase) ============================== */
  function debugRig(view, scene) {
    const tpl = view.tpl, B = view.bones;
    const pts = new Float32Array(tpl.n * 6);
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pts, 3));
    const lines = new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0xffe08a, depthTest: false, transparent: true, opacity: 0.9 }));
    lines.renderOrder = 30; lines.frustumCulled = false;
    const dots = new T.InstancedMesh(new T.OctahedronGeometry(0.012 * (view.sp.debugScale || 1)), new T.MeshBasicMaterial({ color: 0xff5040, depthTest: false }), tpl.n);
    dots.renderOrder = 31; dots.frustumCulled = false;
    scene.add(lines, dots);
    const p = new T.Vector3(), c = new T.Vector3(), m = new T.Matrix4();
    return {
      lines, dots,
      update() {
        for (let i = 0; i < tpl.n; i++) {
          B[i].getWorldPosition(c);
          const pi = tpl.parent[i];
          if (pi >= 0) B[pi].getWorldPosition(p); else p.copy(c);
          pts.set([p.x, p.y, p.z, c.x, c.y, c.z], 6 * i);
          m.makeTranslation(c.x, c.y, c.z); dots.setMatrixAt(i, m);
        }
        geo.attributes.position.needsUpdate = true; dots.instanceMatrix.needsUpdate = true;
      },
      dispose() { scene.remove(lines, dots); geo.dispose(); },
    };
  }

  global.CreatureKit = {
    math: { clamp, clamp01, sstep, lerp, gs, gs2, ga, angD, vnoise, vnoise3, smin, smax, damp, frac, ease, curve, seR, hash, PI, TAU },
    sdf, projectSDF, sweep, paint, skin, prim, merge, mirrorX, gridGeo, finish, envelope, segDist, pitchAbout,
    material, MAT_DEF, whenTexturesReady, rigTemplate, instantiateRig, basisQuat, aimWorld, toLocal, twoBone,
    spring, stepSpring, channelMap, track, Gait, StateMachine, PRIO, groundChain, groundSamples,
    defineSpecies, defineVariant, SPECIES, speciesGeometry, CreatureView, QuadAnimator, debugRig,
  };
})(typeof window !== 'undefined' ? window : globalThis);
