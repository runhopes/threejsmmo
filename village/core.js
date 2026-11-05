/* =====================================================================================================
 *  village/core.js  -  foundation of the castle-village starter zone (three r128, plain globals, no modules)
 *
 *    Village.CONFIG      tunable dimensions in meters (hero ~1.95 m tall, runs 3.9 m/s, camera ~10 m away)
 *    Village.rng/fbm     seeded random + periodic value noise (textures tile, layouts are deterministic)
 *    Village.Builder     static geometry batcher: every static piece is merged per material per 32 m chunk
 *                        (few draw calls, frustum + shadow culling still work per chunk)
 *    Village.Instancer   InstancedMesh batches for repeated props, chunked with per-chunk bounding spheres
 *    Village.Collision   2D oriented boxes / circles with heights (movement + projectile blocking), spatial hash
 *    Village.NavGrid     0.5 m walkability grid inflated by the hero radius, A* + string pulling
 *    Village.Registry    player spawns, NPC placement points, world transitions, waypoint
 *
 *  The hero is ALWAYS at y = 0 (the foot IK in knight.js plants feet at y = 0). The village itself is flat; in the open world
 *  (world/*.js) the ground has walkable relief and hills: village/scene.js shifts the whole world group by -World.yBase each
 *  frame (vertical frame), so the hero stays at y = 0. True height = World.heightAt(x, z); height in the frame = World.frameY(x, z).
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village = window.Village || {};
  const Q = new URLSearchParams(location.search);

  V.CONFIG = {
    half: Math.max(60, Math.min(110, +(Q.get('vsize') || 150) / 2)),   // interior half size (150 m square inside walls)
    wallThick: 3.2,        // curtain wall body, inner face -> outer face
    wallH: 8.2,            // wall-walk height
    chunk: 32,             // static batch chunk size
    detailDist: 72,        // clutter chunks farther than this from the hero are hidden
    playerRadius: 0.42,
    navCell: 0.5,
    outer: 24,             // walkable band outside the walls (east / west / north)
    south: 66,             // walkable meadow south of the gate
    shadowExtent: 30,
    shadowMap: +(Q.get('vshadow') || 4096),
    seed: 20261104,
  };

  /* ---------------------------------------------- random / noise ---------------------------------------------- */
  V.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // permutation-table lattice hash (fast; period 256 per axis, which is far beyond any feature size used)
  const PERM = new Uint8Array(512), VAL = new Float32Array(256);
  {
    const r = (function (seed) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(9157);
    const p = []; for (let i = 0; i < 256; i++) { p.push(i); VAL[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  }
  function hash2(x, y, s) { return VAL[PERM[PERM[PERM[x & 255] + (y & 255)] + (s & 255)]]; }
  V.hash2 = hash2;
  // value noise; p = lattice period (0 = none) so canvas textures tile seamlessly
  V.vnoise = function (x, y, p, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
    if (p) { x0 = ((x0 % p) + p) % p; x1 = ((x1 % p) + p) % p; y0 = ((y0 % p) + p) % p; y1 = ((y1 % p) + p) % p; }
    const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  V.fbm = function (x, y, oct, p, s) {
    let t = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { t += amp * V.vnoise(x * f, y * f, p ? p * f : 0, (s || 0) + i * 31); n += amp; amp *= 0.5; f *= 2; }
    return t / n;
  };
  V.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  V.smooth = (a, b, x) => { const t = V.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  V.lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------ Builder ---------------------------------------------------
   *  Emits polygons in a local frame (push/pop transforms), writes world-space triangles into buckets keyed by
   *  material + chunk + shadow flag + layer. UV modes:
   *    'world'  vertical faces: u = distance along the face's horizontal tangent, v = height; horizontal faces: x/z
   *             -> masonry courses stay level and continuous across pieces at any rotation
   *    'local'  the same projection in the piece's own frame (wood grain follows the beam)
   *    explicit o.uvs (roofs, canopies, banners)
   * ------------------------------------------------------------------------------------------------------------- */
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _n = new T.Vector3(), _ln = new T.Vector3();
  const _m4 = new T.Matrix4(), _e = new T.Euler(), _col = new T.Color();
  const _W = [], _L = [];
  for (let i = 0; i < 64; i++) { _W.push(new T.Vector3()); _L.push(new T.Vector3()); }

  class Builder {
    constructor(opt) {
      opt = opt || {};
      this.chunk = opt.chunk || V.CONFIG.chunk;
      this.buckets = new Map();
      this.M = new T.Matrix4();
      this.stack = [];
      this.tris = 0;
      this.layer = 'main';
      this.cast = true;
      this.tint = null;          // optional global color multiplier for the current scope
    }
    push(x, y, z, ry) {
      this.stack.push([this.M.clone(), this.tint, this.cast, this.layer]);
      _m4.makeRotationY(ry || 0); _m4.setPosition(x || 0, y || 0, z || 0);
      this.M.multiply(_m4);
      return this;
    }
    pushMatrix(m) { this.stack.push([this.M.clone(), this.tint, this.cast, this.layer]); this.M.multiply(m); return this; }
    pop() { const s = this.stack.pop(); this.M.copy(s[0]); this.tint = s[1]; this.cast = s[2]; this.layer = s[3]; return this; }
    local(x, y, z, out) { return (out || new T.Vector3()).set(x, y, z).applyMatrix4(this.M); }

    _bucket(mat, x, z, cast, layer) {
      const cx = Math.floor(x / this.chunk), cz = Math.floor(z / this.chunk);
      const key = mat.uuid + '|' + cx + '|' + cz + '|' + (cast ? 1 : 0) + '|' + layer;
      let b = this.buckets.get(key);
      if (!b) { b = { mat, cx, cz, cast, layer, p: [], n: [], u: [], c: [] }; this.buckets.set(key, b); }
      return b;
    }

    /* polygon (convex, CCW seen from the outside) in the current local frame.
       o: color (hex | Color | [r,g,b]), uvs [[u,v]...], uv ('world'|'local'), uvScale, uvOff [du,dv], normals [Vector3 local],
          cast, layer, ao (bool), alpha... */
    poly(mat, pts, o) {
      o = o || {};
      const n = pts.length; if (n < 3) return;
      const ud = mat.userData || {};
      const M = this.M;
      for (let i = 0; i < n; i++) { _L[i].copy(pts[i]); _W[i].copy(pts[i]).applyMatrix4(M); }
      // face normal (Newell) in world and local
      _n.set(0, 0, 0); _ln.set(0, 0, 0);
      for (let i = 0; i < n; i++) {
        const p = _W[i], q = _W[(i + 1) % n];
        _n.x += (p.y - q.y) * (p.z + q.z); _n.y += (p.z - q.z) * (p.x + q.x); _n.z += (p.x - q.x) * (p.y + q.y);
        const lp = _L[i], lq = _L[(i + 1) % n];
        _ln.x += (lp.y - lq.y) * (lp.z + lq.z); _ln.y += (lp.z - lq.z) * (lp.x + lq.x); _ln.z += (lp.x - lq.x) * (lp.y + lq.y);
      }
      if (_n.lengthSq() < 1e-14) return;
      _n.normalize(); _ln.normalize();
      // uv
      const mode = o.uv || ud.uv || 'world', s = o.uvScale || ud.uvScale || 1;
      const off = o.uvOff || null;
      const uvs = o.uvs ? null : [];
      if (!o.uvs) {
        const P = mode === 'local' ? _L : _W, N = mode === 'local' ? _ln : _n;
        if (Math.abs(N.y) > 0.72) {
          for (let i = 0; i < n; i++) uvs.push(P[i].x * s, P[i].z * s * (N.y > 0 ? -1 : 1));
        } else {
          let tx = N.z, tz = -N.x; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          for (let i = 0; i < n; i++) uvs.push((P[i].x * tx + P[i].z * tz) * s, P[i].y * s);
        }
        if (mode === 'local' && o.grainY) for (let i = 0; i < n; i++) { const t = uvs[i * 2]; uvs[i * 2] = uvs[i * 2 + 1]; uvs[i * 2 + 1] = t; }
        if (off) for (let i = 0; i < n; i++) { uvs[i * 2] += off[0]; uvs[i * 2 + 1] += off[1]; }
      }
      // color
      let cr = 1, cg = 1, cb = 1;
      if (o.color !== undefined && o.color !== null) {
        if (typeof o.color === 'number') { _col.setHex(o.color); cr = _col.r; cg = _col.g; cb = _col.b; }
        else if (Array.isArray(o.color)) { cr = o.color[0]; cg = o.color[1]; cb = o.color[2]; }
        else { cr = o.color.r; cg = o.color.g; cb = o.color.b; }
      }
      if (this.tint) { cr *= this.tint[0]; cg *= this.tint[1]; cb *= this.tint[2]; }
      const ao = o.ao !== undefined ? o.ao : ud.ao;
      // smooth normals
      let NW = null;
      if (o.normals) { NW = []; _m4.copy(M).setPosition(0, 0, 0); for (let i = 0; i < n; i++) NW.push(_a.copy(o.normals[i]).applyMatrix4(_m4).normalize().clone()); }
      // chunk by centroid
      let sx = 0, sz = 0; for (let i = 0; i < n; i++) { sx += _W[i].x; sz += _W[i].z; }
      const B = this._bucket(mat, sx / n, sz / n, o.cast !== undefined ? o.cast : this.cast, o.layer || this.layer);
      for (let i = 1; i < n - 1; i++) {
        for (const k of [0, i, i + 1]) {
          const w = _W[k];
          B.p.push(w.x, w.y, w.z);
          if (NW) B.n.push(NW[k].x, NW[k].y, NW[k].z); else B.n.push(_n.x, _n.y, _n.z);
          if (o.uvs) B.u.push(o.uvs[k][0], o.uvs[k][1]); else B.u.push(uvs[k * 2], uvs[k * 2 + 1]);
          let f = 1;
          if (ao) { const y = w.y; f = y < 1.6 ? 0.66 + 0.34 * V.smooth(0, 1.6, y) : 1; }
          if (o.vcol) { const vc = o.vcol[k]; B.c.push(cr * vc * f, cg * vc * f, cb * vc * f); }
          else B.c.push(cr * f, cg * f, cb * f);
        }
        this.tris++;
      }
    }
    quad(mat, a, b, c, d, o) { this.poly(mat, [a, b, c, d], o); }
    tri(mat, a, b, c, o) { this.poly(mat, [a, b, c], o); }

    /* box centred at (cx,cy,cz); o.ry/rx/rz rotate around the centre; o.skip: 'b' 't' 'n' 's' 'e' 'w' faces;
       o.top = [sxTop, szTop] scale of the top face (battered walls, tapered posts) */
    box(mat, cx, cy, cz, sx, sy, sz, o) {
      o = o || {};
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const tx = o.top ? o.top[0] : 1, tz = o.top ? o.top[1] : 1;
      const rot = o.ry || o.rx || o.rz;
      if (rot) { _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m4.makeRotationFromEuler(_e); }
      const P = (x, y, z) => { const v = new T.Vector3(x, y, z); if (rot) v.applyMatrix4(_m4); v.x += cx; v.y += cy; v.z += cz; return v; };
      const b0 = P(-hx, -hy, -hz), b1 = P(hx, -hy, -hz), b2 = P(hx, -hy, hz), b3 = P(-hx, -hy, hz);
      const t0 = P(-hx * tx, hy, -hz * tz), t1 = P(hx * tx, hy, -hz * tz), t2 = P(hx * tx, hy, hz * tz), t3 = P(-hx * tx, hy, hz * tz);
      const sk = o.skip || '';
      const lo = Object.assign({}, o);
      if ((o.uv || (mat.userData && mat.userData.uv)) === 'local' && !o.uvs) {
        // grain along the longest axis of the box: emit faces with explicit uvs in meters
        const s = o.uvScale || (mat.userData && mat.userData.uvScale) || 1;
        const off = o.uvOff || [0, 0];
        const along = sx >= sy && sx >= sz ? 'x' : sy >= sz ? 'y' : 'z';
        const fu = (a1, a2, l1, l2) => {        // face spanning local axes a1/a2 with lengths l1/l2 -> 4 uvs (corner order matches)
          const g = along === a1 || (along !== a2 && l1 >= l2);
          return g ? [[0, 0], [l1, 0], [l1, l2], [0, l2]] : [[0, 0], [0, l1], [l2, l1], [l2, 0]];
        };
        const S = (arr) => arr.map((q) => [q[0] * s + off[0], q[1] * s + off[1]]);
        if (!sk.includes('t')) this.poly(mat, [t3, t2, t1, t0], Object.assign(lo, { uvs: S(fu('x', 'z', sx, sz)) }));
        if (!sk.includes('b')) this.poly(mat, [b0, b1, b2, b3], Object.assign(lo, { uvs: S(fu('x', 'z', sx, sz)) }));
        if (!sk.includes('s')) this.poly(mat, [b3, b2, t2, t3], Object.assign(lo, { uvs: S(fu('x', 'y', sx, sy)) }));
        if (!sk.includes('n')) this.poly(mat, [b1, b0, t0, t1], Object.assign(lo, { uvs: S(fu('x', 'y', sx, sy)) }));
        if (!sk.includes('e')) this.poly(mat, [b2, b1, t1, t2], Object.assign(lo, { uvs: S(fu('z', 'y', sz, sy)) }));
        if (!sk.includes('w')) this.poly(mat, [b0, b3, t3, t0], Object.assign(lo, { uvs: S(fu('z', 'y', sz, sy)) }));
        return;
      }
      if (!sk.includes('t')) this.poly(mat, [t3, t2, t1, t0], lo);
      if (!sk.includes('b')) this.poly(mat, [b0, b1, b2, b3], lo);
      if (!sk.includes('s')) this.poly(mat, [b3, b2, t2, t3], lo);   // +z
      if (!sk.includes('n')) this.poly(mat, [b1, b0, t0, t1], lo);   // -z
      if (!sk.includes('e')) this.poly(mat, [b2, b1, t1, t2], lo);   // +x
      if (!sk.includes('w')) this.poly(mat, [b0, b3, t3, t0], lo);   // -x
    }
    // box from its bottom centre
    boxY(mat, cx, y0, cz, sx, h, sz, o) { this.box(mat, cx, y0 + h / 2, cz, sx, h, sz, o); }
    // axis-aligned box from min/max corners
    slab(mat, x0, y0, z0, x1, y1, z1, o) { this.box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), o); }
    // beam between two local points with a square section (w x h), section 'up' stays vertical-ish
    beam(mat, p, q, w, h, o) {
      const d = new T.Vector3().subVectors(q, p), L = d.length(); if (L < 1e-5) return;
      const mid = new T.Vector3().addVectors(p, q).multiplyScalar(0.5);
      const m = new T.Matrix4();
      const xA = d.clone().normalize();
      let up = Math.abs(xA.y) > 0.95 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
      const zA = new T.Vector3().crossVectors(xA, up).normalize();
      const yA = new T.Vector3().crossVectors(zA, xA).normalize();
      m.makeBasis(xA, yA, zA); m.setPosition(mid);
      this.pushMatrix(m);
      this.box(mat, 0, 0, 0, L, h, w, Object.assign({ uv: 'local' }, o));
      this.pop();
    }
    /* cylinder / frustum / cone; u = arc length (m), v = height (m) so masonry courses wrap the tower */
    cyl(mat, cx, y0, cz, rb, rt, h, seg, o) {
      o = o || {};
      const s = o.uvScale || (mat.userData && mat.userData.uvScale) || 1;
      const ph = o.phase || 0, flat = !!o.flat, a0 = o.a0 || 0, a1 = o.a1 === undefined ? Math.PI * 2 : o.a1;
      const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
      const slope = (rb - rt) / h;
      const lo = Object.assign({}, o);
      for (let i = 0; i < seg; i++) {
        const u0 = a0 + (a1 - a0) * i / seg + ph, u1 = a0 + (a1 - a0) * (i + 1) / seg + ph;
        const c0 = Math.cos(u0), s0 = Math.sin(u0), c1 = Math.cos(u1), s1 = Math.sin(u1);
        const p0 = new T.Vector3(cx + c0 * rb, y0, cz + s0 * rb), p1 = new T.Vector3(cx + c1 * rb, y0, cz + s1 * rb);
        const p2 = new T.Vector3(cx + c1 * rt, y0 + h, cz + s1 * rt), p3 = new T.Vector3(cx + c0 * rt, y0 + h, cz + s0 * rt);
        const arc0 = (u0 - ph) * rb, arc1 = (u1 - ph) * rb;
        const uvs = [[-arc0 * s, y0 * s], [-arc1 * s, y0 * s], [-arc1 * s, (y0 + h) * s], [-arc0 * s, (y0 + h) * s]];
        if (o.uvOff) for (const q of uvs) { q[0] += o.uvOff[0]; q[1] += o.uvOff[1]; }
        lo.uvs = uvs;
        if (!flat) {
          const nm = (c, sn) => new T.Vector3(c, slope, sn).normalize();
          lo.normals = [nm(c0, s0), nm(c1, s1), nm(c1, s1), nm(c0, s0)];
        }
        if (rt < 1e-6) { lo.uvs = [uvs[0], uvs[1], [(-(arc0 + arc1) / 2) * s, (y0 + h) * s]]; if (lo.normals) { const mn = new T.Vector3(Math.cos((u0 + u1) / 2), slope, Math.sin((u0 + u1) / 2)).normalize(); lo.normals = [lo.normals[0], lo.normals[1], mn]; } this.poly(mat, [p1, p0, p2], Object.assign({}, lo, { uvs: [lo.uvs[1], lo.uvs[0], lo.uvs[2]], normals: lo.normals ? [lo.normals[1], lo.normals[0], lo.normals[2]] : undefined })); }
        else this.poly(mat, [p1, p0, p3, p2], Object.assign({}, lo, { uvs: [uvs[1], uvs[0], uvs[3], uvs[2]], normals: lo.normals ? [lo.normals[1], lo.normals[0], lo.normals[3], lo.normals[2]] : undefined }));
      }
      const caps = o.caps === undefined ? 't' : o.caps;
      if (full && caps.includes('t') && rt > 1e-6) {
        const pts = []; for (let i = seg - 1; i >= 0; i--) { const u = (a1 - a0) * i / seg + ph + a0; pts.push(new T.Vector3(cx + Math.cos(u) * rt, y0 + h, cz + Math.sin(u) * rt)); }
        this.poly(mat, pts.reverse().reverse(), { color: o.color, uv: 'world', uvScale: s, cast: o.cast, layer: o.layer, ao: o.ao });
      }
      if (full && caps.includes('b')) {
        const pts = []; for (let i = 0; i < seg; i++) { const u = (a1 - a0) * i / seg + ph + a0; pts.push(new T.Vector3(cx + Math.cos(u) * rb, y0, cz + Math.sin(u) * rb)); }
        this.poly(mat, pts, { color: o.color, uv: 'world', uvScale: s, cast: o.cast, layer: o.layer, ao: o.ao });
      }
    }
    /* vertical prism from a 2D outline [[x,z],...] (any winding, may be concave) */
    prism(mat, pts2, y0, y1, o) {
      o = o || {};
      let area = 0; for (let i = 0; i < pts2.length; i++) { const a = pts2[i], b = pts2[(i + 1) % pts2.length]; area += a[0] * b[1] - b[0] * a[1]; }
      const P = area < 0 ? pts2.slice() : pts2.slice().reverse();   // make CCW in (x, z) = clockwise seen from +y... normalise below
      // sides
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        this.poly(mat, [new T.Vector3(a[0], y0, a[1]), new T.Vector3(b[0], y0, b[1]), new T.Vector3(b[0], y1, b[1]), new T.Vector3(a[0], y1, a[1])], o);
      }
      const caps = o.caps === undefined ? 't' : o.caps;
      const contour = P.map((p) => new T.Vector2(p[0], p[1]));
      const tris = T.ShapeUtils.triangulateShape(contour, []);
      for (const t of tris) {
        const A = P[t[0]], Bp = P[t[1]], C = P[t[2]];
        if (caps.includes('t')) this.poly(mat, [new T.Vector3(A[0], y1, A[1]), new T.Vector3(C[0], y1, C[1]), new T.Vector3(Bp[0], y1, Bp[1])].sort(() => 0), Object.assign({}, o, { uvs: undefined, normals: undefined, _cap: 1 }));
        if (caps.includes('b')) this.poly(mat, [new T.Vector3(A[0], y0, A[1]), new T.Vector3(Bp[0], y0, Bp[1]), new T.Vector3(C[0], y0, C[1])], o);
      }
    }
    /* any THREE.BufferGeometry, transformed by matrix m (local frame), keeps its normals / uvs */
    geo(mat, g, m, o) {
      o = o || {};
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, ci = g.attributes.color;
      const idx = g.index ? g.index.array : null;
      const cnt = idx ? idx.length : pos.count;
      const full = new T.Matrix4().multiplyMatrices(this.M, m || new T.Matrix4());
      const nmat = new T.Matrix3().getNormalMatrix(full);
      let cr = 1, cg = 1, cb = 1;
      if (o.color !== undefined) { _col.set(o.color); cr = _col.r; cg = _col.g; cb = _col.b; }
      if (this.tint) { cr *= this.tint[0]; cg *= this.tint[1]; cb *= this.tint[2]; }
      const s = o.uvScale || 1;
      const ud = mat.userData || {};
      const ao = o.ao !== undefined ? o.ao : ud.ao;
      for (let t = 0; t < cnt; t += 3) {
        const ids = idx ? [idx[t], idx[t + 1], idx[t + 2]] : [t, t + 1, t + 2];
        const W = ids.map((i) => new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(full));
        const cxz = [(W[0].x + W[1].x + W[2].x) / 3, (W[0].z + W[1].z + W[2].z) / 3];
        const B = this._bucket(mat, cxz[0], cxz[1], o.cast !== undefined ? o.cast : this.cast, o.layer || this.layer);
        let fn = null;
        if (!nor || o.flat) { fn = new T.Vector3().subVectors(W[1], W[0]).cross(new T.Vector3().subVectors(W[2], W[0])).normalize(); }
        for (let k = 0; k < 3; k++) {
          const i = ids[k], w = W[k];
          B.p.push(w.x, w.y, w.z);
          if (fn) B.n.push(fn.x, fn.y, fn.z);
          else { _a.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(nmat).normalize(); B.n.push(_a.x, _a.y, _a.z); }
          if (uv) B.u.push(uv.getX(i) * s, uv.getY(i) * s); else B.u.push(w.x * s, w.z * s);
          let f = 1; if (ao) f = w.y < 1.6 ? 0.66 + 0.34 * V.smooth(0, 1.6, w.y) : 1;
          if (ci) B.c.push(cr * ci.getX(i) * f, cg * ci.getY(i) * f, cb * ci.getZ(i) * f);
          else B.c.push(cr * f, cg * f, cb * f);
        }
        this.tris++;
      }
    }
    /* collapse everything emitted so far into one BufferGeometry per material (for instanced prop templates) */
    toGeometries() {
      const out = new Map();
      for (const b of this.buckets.values()) {
        let e = out.get(b.mat); if (!e) { e = { p: [], n: [], u: [], c: [] }; out.set(b.mat, e); }
        e.p.push(...b.p); e.n.push(...b.n); e.u.push(...b.u); e.c.push(...b.c);
      }
      const res = new Map();
      for (const [m, e] of out) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(e.p, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(e.n, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(e.u, 2));
        g.setAttribute('color', new T.Float32BufferAttribute(e.c, 3));
        g.computeBoundingSphere();
        res.set(m, g);
      }
      this.buckets.clear();
      return res;
    }
    /* finalize: one Mesh per bucket */
    build(group, registerDetail) {
      const meshes = [];
      for (const b of this.buckets.values()) {
        if (!b.p.length) continue;
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(b.p, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2));
        g.setAttribute('color', new T.Float32BufferAttribute(b.c, 3));
        g.computeBoundingSphere();
        const m = new T.Mesh(g, b.mat);
        m.castShadow = b.cast; m.receiveShadow = true;
        m.matrixAutoUpdate = false; m.updateMatrix();
        m.userData.layer = b.layer; m.userData.chunk = [b.cx, b.cz];
        m.name = 'vb_' + (b.mat.name || 'mat') + '_' + b.cx + '_' + b.cz;
        group.add(m); meshes.push(m);
        if (registerDetail && b.layer === 'detail') registerDetail(m);
      }
      this.buckets.clear();
      return meshes;
    }
  }
  V.Builder = Builder;

  /* ------------------------------------------------ Instancer --------------------------------------------------- */
  class Instancer {
    constructor(chunk) { this.kinds = {}; this.chunk = chunk || 40; this.count = 0; }
    define(name, parts, opt) { this.kinds[name] = { parts, items: [], layer: (opt && opt.layer) || 'main', chunk: (opt && opt.chunk) || this.chunk }; return this; }
    add(name, x, y, z, ry, s, color) { const k = this.kinds[name]; if (!k) throw new Error('Instancer: unknown kind ' + name); k.items.push([x, y, z, ry || 0, s === undefined ? 1 : s, color]); this.count++; }
    build(group, registerDetail) {
      const out = [];
      const m = new T.Matrix4(), qt = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), up = new T.Vector3(0, 1, 0), col = new T.Color();
      for (const name in this.kinds) {
        const K = this.kinds[name];
        const by = new Map();
        for (const it of K.items) {
          const key = Math.floor(it[0] / K.chunk) + ',' + Math.floor(it[2] / K.chunk);
          if (!by.has(key)) by.set(key, []); by.get(key).push(it);
        }
        for (const [key, items] of by) {
          // bounding sphere covering every instance
          let cx = 0, cy = 0, cz = 0; for (const it of items) { cx += it[0]; cy += it[1]; cz += it[2]; }
          cx /= items.length; cy /= items.length; cz /= items.length;
          for (const part of K.parts) {
            const src = part.geo;
            if (!src.boundingSphere) src.computeBoundingSphere();
            const g = new T.BufferGeometry();
            if (src.index) g.setIndex(src.index);
            for (const a in src.attributes) g.setAttribute(a, src.attributes[a]);
            let r = 0;
            for (const it of items) {
              const s = Array.isArray(it[4]) ? Math.max(it[4][0], it[4][1], it[4][2]) : it[4];
              r = Math.max(r, Math.hypot(it[0] - cx, it[1] - cy, it[2] - cz) + (src.boundingSphere.radius + src.boundingSphere.center.length()) * s);
            }
            g.boundingSphere = new T.Sphere(new T.Vector3(cx, cy, cz), r);
            const im = new T.InstancedMesh(g, part.mat, items.length);
            items.forEach((it, i) => {
              ps.set(it[0], it[1], it[2]); qt.setFromAxisAngle(up, it[3]);
              if (Array.isArray(it[4])) sc.set(it[4][0], it[4][1], it[4][2]); else sc.setScalar(it[4]);
              m.compose(ps, qt, sc); im.setMatrixAt(i, m);
              col.set(it[5] === undefined || it[5] === null ? 0xffffff : it[5]);
              if (part.tint) col.multiply(part.tint);
              im.setColorAt(i, col);
            });
            im.instanceMatrix.needsUpdate = true;
            im.castShadow = part.cast !== false; im.receiveShadow = true;
            im.matrixAutoUpdate = false; im.updateMatrix();
            im.name = 'vi_' + name + '_' + key; im.userData.layer = K.layer;
            group.add(im); out.push(im);
            if (registerDetail && K.layer === 'detail') registerDetail(im);
          }
        }
      }
      return out;
    }
  }
  V.Instancer = Instancer;

  /* ------------------------------------------------ Collision --------------------------------------------------- */
  class Collision {
    constructor(cell) { this.cell = cell || 8; this.shapes = []; this.grid = new Map(); this._stamp = 1; }
    _insert(s, minX, minZ, maxX, maxZ) {
      const c = this.cell;
      for (let gx = Math.floor(minX / c); gx <= Math.floor(maxX / c); gx++)
        for (let gz = Math.floor(minZ / c); gz <= Math.floor(maxZ / c); gz++) {
          const k = gx * 73856 + gz; let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); } a.push(s);
        }
      this.shapes.push(s);
      return s;
    }
    /* oriented box: centre, half extents, rotation (same sense as Object3D.rotation.y), top height (projectiles), tag */
    box(cx, cz, hx, hz, rot, top, tag) {
      const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
      const s0 = { t: 0, x: cx, z: cz, hx, hz, c, s, rot: rot || 0, top: top === undefined ? 50 : top, tag: tag || '', mark: 0 };
      const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
      return this._insert(s0, cx - ex, cz - ez, cx + ex, cz + ez);
    }
    // box given in a local frame (building origin + rotation)
    boxLocal(ox, oz, ry, lx, lz, hx, hz, top, tag) {
      const c = Math.cos(ry), s = Math.sin(ry);
      return this.box(ox + lx * c + lz * s, oz - lx * s + lz * c, hx, hz, ry, top, tag);
    }
    circle(x, z, r, top, tag) { return this._insert({ t: 1, x, z, r, top: top === undefined ? 50 : top, tag: tag || '', mark: 0 }, x - r, z - r, x + r, z + r); }
    near(x, z, r, fn) {
      const c = this.cell, st = ++this._stamp;
      for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
        for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
          const a = this.grid.get(gx * 73856 + gz); if (!a) continue;
          for (const s of a) { if (s.mark === st) continue; s.mark = st; if (fn(s) === true) return true; }
        }
      return false;
    }
    // push vector for a circle vs one shape (or null)
    _push(s, x, z, r) {
      if (s.t === 1) {
        const dx = x - s.x, dz = z - s.z, d2 = dx * dx + dz * dz, R = s.r + r;
        if (d2 >= R * R) return null;
        const d = Math.sqrt(d2) || 1e-6; return [dx / d * (R - d), dz / d * (R - d)];
      }
      const dx = x - s.x, dz = z - s.z;
      const lx = dx * s.c - dz * s.s, lz = dx * s.s + dz * s.c;
      const qx = V.clamp(lx, -s.hx, s.hx), qz = V.clamp(lz, -s.hz, s.hz);
      let px, pz;
      const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
      if (d2 > 1e-12) {
        if (d2 >= r * r) return null;
        const d = Math.sqrt(d2); px = ex / d * (r - d); pz = ez / d * (r - d);
      } else {
        const penX = s.hx - Math.abs(lx), penZ = s.hz - Math.abs(lz);
        if (penX < penZ) { px = (lx >= 0 ? 1 : -1) * (penX + r); pz = 0; } else { px = 0; pz = (lz >= 0 ? 1 : -1) * (penZ + r); }
      }
      return [px * s.c + pz * s.s, -px * s.s + pz * s.c];
    }
    /* slide a hero-sized circle out of everything it overlaps; p = Vector3 (x, z used) */
    resolve(p, r) {
      let moved = false;
      for (let it = 0; it < 5; it++) {
        let any = false;
        this.near(p.x, p.z, r + 0.6, (s) => {
          const v = this._push(s, p.x, p.z, r);
          if (v) { p.x += v[0]; p.z += v[1]; any = true; }
        });
        if (!any) break; moved = true;
      }
      return moved;
    }
    blocked(x, z, r) { return this.near(x, z, r + 0.6, (s) => !!this._push(s, x, z, r)); }
    /* projectile segment a -> b (Vector3s): first hit {t, point, normal-ish, shape} against shapes taller than the segment */
    segment(a, b) {
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, rr = Math.hypot(maxX - minX, maxZ - minZ) / 2;
      let best = null;
      this.near(cx, cz, rr + 1, (s) => {
        let t = -1;
        if (s.t === 1) {
          const dx = b.x - a.x, dz = b.z - a.z, fx = a.x - s.x, fz = a.z - s.z;
          const A = dx * dx + dz * dz, Bq = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - s.r * s.r;
          if (C <= 0) t = 0; else if (A > 1e-9) { const D = Bq * Bq - 4 * A * C; if (D >= 0) { const t0 = (-Bq - Math.sqrt(D)) / (2 * A); if (t0 >= 0 && t0 <= 1) t = t0; } }
        } else {
          const ax = (a.x - s.x) * s.c - (a.z - s.z) * s.s, az = (a.x - s.x) * s.s + (a.z - s.z) * s.c;
          const bx = (b.x - s.x) * s.c - (b.z - s.z) * s.s, bz = (b.x - s.x) * s.s + (b.z - s.z) * s.c;
          const dx = bx - ax, dz = bz - az;
          let t0 = 0, t1 = 1;
          const clip = (p, q) => { if (Math.abs(p) < 1e-12) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
          if (clip(-dx, ax + s.hx) && clip(dx, s.hx - ax) && clip(-dz, az + s.hz) && clip(dz, s.hz - az)) t = t0;
        }
        if (t < 0) return;
        const y = a.y + (b.y - a.y) * t;
        if (y > s.top || y < -0.5) return;
        if (!best || t < best.t) best = { t, shape: s, point: new T.Vector3().lerpVectors(a, b, t) };
      });
      return best;
    }
  }
  V.Collision = Collision;

  /* ------------------------------------------------ NavGrid ----------------------------------------------------- */
  class NavGrid {
    constructor(col, bounds, cell, radius, inside, fill) {
      this.cell = cell; this.minX = bounds.minX; this.minZ = bounds.minZ;
      this.w = Math.ceil((bounds.maxX - bounds.minX) / cell); this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
      const N = this.w * this.h;
      this.block = new Uint8Array(N);
      if (fill) fill(this.block, this);                      // world/nav.js: rasterised (fast) instead of one query per cell
      else for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
        const x = this.minX + (i + 0.5) * cell, z = this.minZ + (j + 0.5) * cell;
        this.block[j * this.w + i] = (inside && !inside(x, z)) || col.blocked(x, z, radius) ? 1 : 0;
      }
      this.g = new Float32Array(N); this.par = new Int32Array(N); this.seen = new Uint32Array(N); this.done = new Uint32Array(N);
      this.heap = new Int32Array(N); this.hf = new Float32Array(N); this.run = 0;
    }
    cellOf(x, z) { const i = Math.floor((x - this.minX) / this.cell), j = Math.floor((z - this.minZ) / this.cell); return (i < 0 || j < 0 || i >= this.w || j >= this.h) ? -1 : j * this.w + i; }
    free(x, z) { const k = this.cellOf(x, z); return k >= 0 && !this.block[k]; }
    center(k, out) { out.x = this.minX + ((k % this.w) + 0.5) * this.cell; out.z = this.minZ + (Math.floor(k / this.w) + 0.5) * this.cell; return out; }
    nearestFree(k, maxR) {
      if (k >= 0 && !this.block[k]) return k;
      if (k < 0) return -1;
      const ci = k % this.w, cj = Math.floor(k / this.w);
      for (let r = 1; r <= (maxR || 40); r++) {
        let best = -1, bd = 1e9;
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const kk = j * this.w + i; if (this.block[kk]) continue;
          const d = di * di + dj * dj; if (d < bd) { bd = d; best = kk; }
        }
        if (best >= 0) return best;
      }
      return -1;
    }
    // straight walk test (sampled at a quarter cell)
    los(ax, az, bx, bz) {
      const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (this.cell * 0.25));
      for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; if (!this.free(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
      return true;
    }
    findPath(sx, sz, tx, tz) {
      let s = this.nearestFree(this.cellOf(sx, sz), 6), t = this.nearestFree(this.cellOf(tx, tz), 60);
      if (s < 0 || t < 0) return null;
      const tgt = this.center(t, { x: 0, z: 0 });
      if (t === this.cellOf(tx, tz)) { tgt.x = tx; tgt.z = tz; }
      if (this.free(sx, sz) && this.los(sx, sz, tgt.x, tgt.z)) return [tgt];
      const W = this.w, run = ++this.run, g = this.g, par = this.par, seen = this.seen, done = this.done, heap = this.heap, hf = this.hf;
      const ti = t % W, tj = Math.floor(t / W);
      const hfun = (k) => { const dx = Math.abs(k % W - ti), dz = Math.abs(Math.floor(k / W) - tj); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
      let hn = 0;
      const push = (k, f) => { let i = hn++; heap[i] = k; hf[i] = f; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; const tk = heap[p], tf = hf[p]; heap[p] = heap[i]; hf[p] = hf[i]; heap[i] = tk; hf[i] = tf; i = p; } };
      const pop = () => { const k = heap[0]; hn--; if (hn > 0) { heap[0] = heap[hn]; hf[0] = hf[hn]; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hn && hf[l] < hf[m]) m = l; if (r < hn && hf[r] < hf[m]) m = r; if (m === i) break; const tk = heap[m], tf = hf[m]; heap[m] = heap[i]; hf[m] = hf[i]; heap[i] = tk; hf[i] = tf; i = m; } } return k; };
      g[s] = 0; seen[s] = run; par[s] = -1; push(s, hfun(s));
      const B = this.block, H = this.h;
      let found = false, iter = 0;
      while (hn > 0 && iter++ < 260000) {
        const k = pop();
        if (done[k] === run) continue; done[k] = run;
        if (k === t) { found = true; break; }
        const i = k % W, j = (k - i) / W;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nk = nj * W + ni; if (B[nk] || done[nk] === run) continue;
          if (di && dj && (B[j * W + ni] || B[nj * W + i])) continue;   // no corner cutting
          const ng = g[k] + (di && dj ? Math.SQRT2 : 1);
          if (seen[nk] !== run || ng < g[nk]) { seen[nk] = run; g[nk] = ng; par[nk] = k; push(nk, ng + hfun(nk) * 1.001); }
        }
      }
      if (!found) return null;
      const cells = []; for (let k = t; k >= 0; k = par[k]) cells.push(k); cells.reverse();
      const pts = cells.map((k) => this.center(k, { x: 0, z: 0 }));
      pts[pts.length - 1] = tgt;
      // string pulling
      const out = []; let cx = sx, cz = sz, i = 0;
      while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && !this.los(cx, cz, pts[j].x, pts[j].z)) j--;
        out.push(pts[j]); cx = pts[j].x; cz = pts[j].z; i = j;
      }
      if (!out.length) out.push(tgt);
      return out;
    }
  }
  V.NavGrid = NavGrid;

  /* ------------------------------------------------ Registry ---------------------------------------------------- */
  V.Registry = function () {
    return {
      spawns: {},          // id -> { position: Vector3, yaw, note }
      npcs: [],            // { id, role, position, yaw, district, note }
      guards: [],          // guard posts (subset of npcs with role 'guard' also listed here)
      transitions: [],     // { id, center, radius, target, note }
      dummies: [],         // interactive training dummies { x, z, yaw }
      targets: [],         // archery butts { x, z, yaw, y, radius }
      waypoint: null,
      npc(id, role, x, z, yaw, district, note) { const n = { id, role, position: new T.Vector3(x, 0, z), yaw: yaw || 0, district, note: note || '' }; this.npcs.push(n); if (role === 'guard') this.guards.push(n); return n; },
      spawn(id, x, z, yaw, note) { this.spawns[id] = { id, position: new T.Vector3(x, 0, z), yaw, note: note || '' }; },
    };
  };
})();
