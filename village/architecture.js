/* =====================================================================================================
 *  village/architecture.js  -  MedievalHouseBuilder + service buildings + KeepBuilder
 *
 *  One architectural kit shared by every building so the village reads as one family:
 *    A.wall      thick wall run with real openings (reveals = wall thickness)
 *    A.window    recessed leaded window: frame, mullion/transom, sill, lintel, optional shutters / flower box
 *    A.door      recessed plank door with iron straps and a timber or stone surround
 *    A.timber    close-studded timber framing on a plaster wall (posts at openings, braces, rails)
 *    A.roof      gable / half-hip / hip roof with real thickness, eave + verge overhangs, soffits,
 *                fascias, ridge + hip caps, optional ridge sag (old houses), gable infill walls
 *    A.chimney   exterior gable chimney with weathered shoulder, or ridge stack, with cap + pots
 *    A.dormer    small gabled dormer on a roof slope
 *  Building frame: origin = footprint centre on the ground, +X along the facade, +Z = front (door side).
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const A = V.Arch = {};
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
  const DEG = Math.PI / 180;

  /* ------------------------------------------- walls & openings ------------------------------------------- */
  // wall frame: runs along x in [-len/2, len/2], outer face z = 0 (facing +z), inner face z = -t, y in [0, h]
  A.wall = function (B, mat, len, h, t, ops, o) {
    o = o || {};
    const s = (ops || []).filter((p) => p.y1 > p.y0).slice().sort((a, b) => a.x - b.x);
    const seg = (x0, x1, y0, y1) => { if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return; B.box(mat, (x0 + x1) / 2, (y0 + y1) / 2, -t / 2, x1 - x0, y1 - y0, t, { color: o.color, skip: o.skip || 'b', uvOff: o.uvOff }); };
    let x = -len / 2;
    for (const op of s) {
      const a = op.x - op.w / 2, b = op.x + op.w / 2;
      seg(x, a, 0, h); seg(a, b, 0, op.y0); seg(a, b, op.y1, h);
      x = b;
    }
    seg(x, len / 2, 0, h);
  };
  A.window = function (B, M, op, t, o) {
    o = o || {};
    const x = op.x, w = op.w, y0 = op.y0, y1 = op.y1, h = y1 - y0, zr = o.surface ? 0.06 : -Math.min(0.14, t * 0.45);
    const fc = o.frame || 0x5a4634, fw = 0.075;
    B.quad(M.glass, v3(x - w / 2, y0, zr - 0.03), v3(x + w / 2, y0, zr - 0.03), v3(x + w / 2, y1, zr - 0.03), v3(x - w / 2, y1, zr - 0.03), { uv: 'local' });
    B.box(M.wood, x - w / 2 + fw / 2, (y0 + y1) / 2, zr, fw, h, 0.09, { color: fc });
    B.box(M.wood, x + w / 2 - fw / 2, (y0 + y1) / 2, zr, fw, h, 0.09, { color: fc });
    B.box(M.wood, x, y1 - fw / 2, zr, w, fw, 0.09, { color: fc });
    B.box(M.wood, x, y0 + fw / 2, zr, w, fw, 0.09, { color: fc });
    if (w > 0.6) B.box(M.wood, x, (y0 + y1) / 2, zr - 0.005, 0.05, h, 0.06, { color: fc });
    if (h > 0.8) B.box(M.wood, x, y0 + h * 0.64, zr - 0.005, w, 0.05, 0.06, { color: fc });
    // sill
    const sm = o.sillMat || M.wood;
    B.box(sm, x, y0 - 0.045, 0.04, w + 0.2, 0.09, 0.2 + Math.max(0, t * 0.0), { color: o.sillColor || (sm === M.wood ? fc : 0xcfc6b5), skip: 'b' });
    if (o.lintel) B.box(o.lintel === 'stone' ? M.stone : M.wood, x, y1 + 0.1, -0.03, w + 0.34, 0.2, 0.12, { color: o.lintel === 'stone' ? 0xe4dccd : fc, skip: 'b' });
    if (o.shutter) {
      const sw = w / 2 + 0.02;
      for (const sd of [-1, 1]) {
        const cx = x + sd * (w / 2 + sw / 2 + 0.05);
        B.box(M.planks, cx, (y0 + y1) / 2, 0.035, sw, h + 0.04, 0.045, { color: o.shutter, uvOff: [x * 0.3, 0] });
        B.box(M.iron, cx, y0 + h * 0.22, 0.062, sw * 0.8, 0.04, 0.012, { color: V.PAL.iron });
        B.box(M.iron, cx, y1 - h * 0.22, 0.062, sw * 0.8, 0.04, 0.012, { color: V.PAL.iron });
      }
    }
    if (o.flowers) {   // flower box: planks + mounded greens with small blossoms
      B.box(M.planks, x, y0 - 0.2, 0.2, w + 0.1, 0.2, 0.22, { color: o.shutter || 0x5c4a3a });
      for (let i = 0; i < 5; i++) {
        const fx = x - w / 2 + 0.08 + (w - 0.16) * i / 4;
        B.box(M.leaf, fx, y0 - 0.04, 0.2, 0.2, 0.16, 0.18, { color: 0x5e7040 + 0, rx: 0.2 * i, ry: 0.5 * i });
        B.box(M.dark, fx + 0.04, y0 + 0.05, 0.25, 0.06, 0.06, 0.06, { color: [0xc9b04a, 0xb5584a, 0xd9d3c4, 0x9a6fa0][i % 4] });
      }
    }
  };
  A.door = function (B, M, op, t, o) {
    o = o || {};
    const x = op.x, w = op.w, y0 = op.y0, y1 = op.y1, h = y1 - y0, zr = -t * 0.5;
    const dc = o.color || 0x5a4232, fc = o.frame || 0x4e3c2e;
    if (o.double) {
      for (const sd of [-1, 1]) B.box(M.planks, x + sd * w / 4, (y0 + y1) / 2, zr, w / 2 - 0.01, h, 0.08, { color: dc, uvOff: [sd * 0.37, 0] });
    } else B.box(M.planks, x, (y0 + y1) / 2, zr, w, h, 0.08, { color: dc });
    B.box(M.dark, x, (y0 + y1) / 2, zr - 0.06, w, h, 0.02, { color: 0x1a1612 });
    for (const yy of [y0 + 0.32, y0 + h * 0.5, y1 - 0.34]) {
      if (yy === y0 + h * 0.5 && h < 2.6) continue;
      if (o.double) { for (const sd of [-1, 1]) B.box(M.iron, x + sd * (w / 4 + 0.05), yy, zr + 0.05, w / 2 * 0.8, 0.07, 0.016, { color: V.PAL.iron }); }
      else B.box(M.iron, x - w * 0.12, yy, zr + 0.05, w * 0.72, 0.07, 0.016, { color: V.PAL.iron });
    }
    B.box(M.iron, x + (o.double ? 0.12 : w * 0.32), y0 + 1.0, zr + 0.06, 0.07, 0.14, 0.04, { color: V.PAL.iron });
    if (o.stone) {
      B.box(M.stone, x - w / 2 - 0.13, (y0 + y1) / 2, 0.0, 0.26, h, 0.12, { color: 0xe2d9c8, skip: 'b' });
      B.box(M.stone, x + w / 2 + 0.13, (y0 + y1) / 2, 0.0, 0.26, h, 0.12, { color: 0xe2d9c8, skip: 'b' });
      B.box(M.stone, x, y1 + 0.15, 0.0, w + 0.56, 0.3, 0.14, { color: 0xe6ddcc, skip: 'b' });
    } else {
      B.box(M.wood, x - w / 2 - 0.06, (y0 + y1) / 2, 0.02, 0.13, h, 0.1, { color: fc, skip: 'b' });
      B.box(M.wood, x + w / 2 + 0.06, (y0 + y1) / 2, 0.02, 0.13, h, 0.1, { color: fc, skip: 'b' });
      B.box(M.wood, x, y1 + 0.08, 0.025, w + 0.4, 0.16, 0.12, { color: fc, skip: 'b' });
    }
  };
  // close-studded timber framing on the outer face of a wall frame
  A.timber = function (B, M, len, h, ops, o) {
    o = o || {};
    const R = o.rng || Math.random, col = o.color || 0x5a4634, bw = 0.17, dz = 0.012, dep = 0.1;
    const posts = [-len / 2 + bw / 2, len / 2 - bw / 2];
    for (const op of ops || []) { posts.push(op.x - op.w / 2 - bw / 2, op.x + op.w / 2 + bw / 2); }
    posts.sort((a, b) => a - b);
    const P = [];
    for (let i = 0; i < posts.length; i++) {
      if (P.length && posts[i] - P[P.length - 1] < bw * 1.2) continue;
      if (P.length) { const gap = posts[i] - P[P.length - 1]; const n = Math.floor(gap / 1.35); for (let k = 1; k <= n; k++) P.push(P[P.length - 1] + gap / (n + 1) * 1); }
      P.push(posts[i]);
    }
    const S = Array.from(new Set(P.map((p) => +p.toFixed(3)))).sort((a, b) => a - b);
    B.box(M.wood, 0, bw / 2, dz, len, bw, dep, { color: col });
    B.box(M.wood, 0, h - bw / 2, dz, len, bw, dep, { color: col });
    for (const px of S) B.box(M.wood, px, h / 2, dz, bw * 0.92, h - bw * 2, dep, { color: col });
    for (let i = 0; i < S.length - 1; i++) {
      const x0 = S[i] + bw / 2, x1 = S[i + 1] - bw / 2; if (x1 - x0 < 0.25) continue;
      const op = (ops || []).find((p) => p.x > x0 - 0.01 && p.x < x1 + 0.01);
      if (op) {
        if (op.y0 > bw * 2) B.box(M.wood, (x0 + x1) / 2, op.y0 - bw / 2, dz, x1 - x0, bw * 0.9, dep, { color: col });
        if (op.y1 < h - bw * 2) B.box(M.wood, (x0 + x1) / 2, op.y1 + bw / 2, dz, x1 - x0, bw * 0.9, dep, { color: col });
        if (op.y0 > 0.9) {   // braces under the window: St Andrew's cross
          const yA = bw, yB = op.y0 - bw;
          B.beam(M.wood, v3(x0, yA, dz), v3(x1, yB, dz), dep * 0.9, bw * 0.8, { color: col });
          B.beam(M.wood, v3(x1, yA, dz), v3(x0, yB, dz), dep * 0.85, bw * 0.8, { color: col });
        }
        continue;
      }
      const r = R();
      const edge = i === 0 || i === S.length - 2;
      if (edge || r < 0.35) {   // corner brace rising toward the end post
        const left = i === 0 ? true : i === S.length - 2 ? false : r < 0.17;
        B.beam(M.wood, v3(left ? x1 : x0, bw, dz), v3(left ? x0 : x1, h - bw, dz), dep * 0.9, bw * 0.85, { color: col });
      } else if (r < 0.6) {
        B.box(M.wood, (x0 + x1) / 2, h * 0.5, dz, x1 - x0, bw * 0.85, dep, { color: col });
      } else {
        B.box(M.wood, (x0 + x1) / 2, h * 0.5, dz, x1 - x0, bw * 0.85, dep, { color: col });
        B.beam(M.wood, v3(x0, bw, dz), v3(x1, h * 0.5 - bw / 2, dz), dep * 0.85, bw * 0.75, { color: col });
      }
    }
  };

  /* ------------------------------------------- roof ------------------------------------------- */
  // ridge along local x. o: w, d (outer wall extents), y (wall top), pitch (deg), oe, og (overhangs), hip 0..1,
  //   thick, sag, mat, color, soffit color, gable: { mat, color, t, timber }, ridge: 'cap' | 'roll' | null
  A.roof = function (B, M, o) {
    const w = o.w, d = o.d, y = o.y, p = o.pitch * DEG, tp = Math.tan(p), cp = Math.cos(p), sp = Math.sin(p);
    const oe = o.oe === undefined ? 0.55 : o.oe, og = o.og === undefined ? 0.42 : o.og, hip = o.hip || 0;
    const th = o.thick || 0.16, sag = o.sag || 0, mat = o.mat, col = o.color;
    const W = w / 2 + og, D = d / 2 + oe;
    const ridgeY = y + (d / 2) * tp, eaveY = y - oe * tp;
    const yk = ridgeY - hip * (ridgeY - eaveY), zk = hip * D;
    const a = Math.max(0, W - hip * D);
    const tv = th / cp;
    const s = (mat.userData && mat.userData.uvScale) || 0.5;
    const sagR = (x) => (a > 0 ? sag * (1 - (x / a) * (x / a)) : 0);
    const sagE = (x) => sag * 0.35 * Math.max(0, 1 - (x / W) * (x / W));
    const soff = o.soffit || 0x4a3b2e;
    const castOpt = { cast: true };
    const dedupe = (pts) => pts.filter((q, i) => { const n = pts[(i + 1) % pts.length]; return Math.abs(q[0] - n[0]) + Math.abs(q[1] - n[1]) + Math.abs(q[2] - n[2]) > 1e-5; });
    const emit = (pts, uvf, mirrorZ, mirrorX) => {   // pts listed CCW from outside for the +z / +x side
      let P = dedupe(pts); if (P.length < 3) return;
      if (mirrorZ) P = P.map((q) => [q[0], q[1], -q[2]]).reverse();
      if (mirrorX) P = P.map((q) => [-q[0], q[1], q[2]]).reverse();
      const top = P.map((q) => v3(q[0], q[1], q[2]));
      B.poly(mat, top, Object.assign({ color: col, uvs: P.map(uvf) }, castOpt));
      const bot = P.map((q) => v3(q[0], q[1] - tv, q[2])).reverse();
      B.poly(M.planks, bot, { color: soff, uv: 'world', uvScale: 0.5 });
    };
    const fascia = (p0, p1, mirrorZ, mirrorX) => {   // edge p0 -> p1 (left -> right seen from outside)
      let q = [[p0[0], p0[1] - tv, p0[2]], [p1[0], p1[1] - tv, p1[2]], [p1[0], p1[1], p1[2]], [p0[0], p0[1], p0[2]]];
      if (mirrorZ) q = q.map((r) => [r[0], r[1], -r[2]]).reverse();
      if (mirrorX) q = q.map((r) => [-r[0], r[1], r[2]]).reverse();
      B.poly(M.planks, q.map((r) => v3(r[0], r[1], r[2])), { color: o.fasciaColor || soff, uv: 'local', uvScale: 0.5 });
    };
    const uvFront = (q) => [q[0] * s, (D - Math.abs(q[2])) / cp * s];
    const uvSide = (q) => [q[2] * s, (W - Math.abs(q[0])) / cp * s];
    const n = Math.max(1, Math.round((2 * a) / 1.25));
    for (const mz of [false, true]) {
      for (let i = 0; i < n; i++) {
        const x0 = -a + (2 * a * i) / n, x1 = -a + (2 * a * (i + 1)) / n;
        const e0 = [x0, eaveY - sagE(x0), D], e1 = [x1, eaveY - sagE(x1), D];
        emit([e0, e1, [x1, ridgeY - sagR(x1), 0], [x0, ridgeY - sagR(x0), 0]], uvFront, mz, false);
        fascia(e0, e1, mz, false);
      }
      if (hip > 0 && a < W - 1e-4) {
        emit([[-W, eaveY, D], [-a, eaveY - sagE(-a), D], [-a, ridgeY, 0], [-W, yk, zk]], uvFront, mz, false);
        emit([[a, eaveY - sagE(a), D], [W, eaveY, D], [W, yk, zk], [a, ridgeY, 0]], uvFront, mz, false);
        fascia([-W, eaveY, D], [-a, eaveY - sagE(-a), D], mz, false);
        fascia([a, eaveY - sagE(a), D], [W, eaveY, D], mz, false);
      }
    }
    for (const mx of [false, true]) {
      if (hip > 0) emit([[W, yk, zk], [W, yk, -zk], [a, ridgeY, 0]], uvSide, false, mx);
      if (hip > 0) fascia([W, yk, zk], [W, yk, -zk], false, mx);
      if (hip < 1) {   // verge boards (front and back halves)
        fascia([W, eaveY, D], [W, yk, zk], false, mx);
        fascia([W, yk, -zk], [W, eaveY, -D], false, mx);
      }
    }
    // ridge cap (inverted V riding on the ridge) and hip caps
    const capC = o.ridgeColor || col, capM = o.ridgeMat || mat, L = o.ridge === 'roll' ? 0.36 : 0.24, lift = o.ridge === 'roll' ? 0.1 : 0.045;
    if (o.ridge !== null && a > 0) {
      for (let i = 0; i < n; i++) {
        const x0 = -a + (2 * a * i) / n, x1 = -a + (2 * a * (i + 1)) / n, r0 = ridgeY - sagR(x0) + lift, r1 = ridgeY - sagR(x1) + lift;
        const dz = L * cp, dy = L * sp;
        B.quad(capM, v3(x0, r0 - dy, dz), v3(x1, r1 - dy, dz), v3(x1, r1, 0), v3(x0, r0, 0), { color: capC, uvs: [[x0 * s, 0], [x1 * s, 0], [x1 * s, L * s], [x0 * s, L * s]] });
        B.quad(capM, v3(x1, r1 - dy, -dz), v3(x0, r0 - dy, -dz), v3(x0, r0, 0), v3(x1, r1, 0), { color: capC, uvs: [[x1 * s, 0], [x0 * s, 0], [x0 * s, L * s], [x1 * s, L * s]] });
      }
      for (const sx of [-1, 1]) {
        const r0 = ridgeY + lift, dz = L * cp, dy = L * sp;
        const pts = sx > 0 ? [v3(a, r0 - dy, dz), v3(a, r0 - dy, -dz), v3(a, r0, 0)].reverse() : [v3(-a, r0 - dy, dz), v3(-a, r0, 0), v3(-a, r0 - dy, -dz)].reverse();
        if (hip === 0) B.poly(capM, pts, { color: capC });
      }
    }
    if (hip > 0) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        B.beam(capM, v3(sx * a, ridgeY + lift * 0.7, 0), v3(sx * W, yk + lift * 0.7, sz * zk), 0.26, 0.08, { color: capC, uv: 'world' });
      }
    }
    // gable infill walls (in the wall planes x = +-w/2)
    if (hip < 1 && o.gable !== false) {
      const G = o.gable || {}, gt = G.t || 0.3, gm = G.mat || M.plaster;
      let yc = ridgeY - tv;
      if (hip > 0) yc = Math.min(yc, yk + og * tp - tv);
      const zc = (d / 2) * (1 - (yc - y) / (ridgeY - tv - y));
      for (const sx of [1, -1]) {
        const xo = sx * w / 2, xi = sx * (w / 2 - gt);
        const outline = yc < ridgeY - tv - 1e-3 ? [[d / 2, y], [-d / 2, y], [-zc, yc], [zc, yc]] : [[d / 2, y], [-d / 2, y], [0, yc]];
        let outer = outline.map((q) => v3(xo, q[1], q[0]));
        let inner = outline.map((q) => v3(xi, q[1], q[0])).reverse();
        if (sx < 0) { outer = outline.map((q) => v3(xo, q[1], -q[0])); inner = outline.map((q) => v3(xi, q[1], -q[0])).reverse(); }
        B.poly(gm, outer, { color: G.color });
        B.poly(gm, inner, { color: G.color });
        if (G.timber) {   // tie beam, collar, king post, struts
          const tc = G.timberColor || 0x5a4634, fx = xo + sx * 0.012, dep = 0.1;
          const P = (z, yy) => v3(fx, yy, z);
          const hh = yc - y, colY = y + hh * 0.5, colZ = (d / 2) * (1 - (colY - y) / (ridgeY - tv - y));
          B.beam(M.wood, P(-d / 2, y + 0.09), P(d / 2, y + 0.09), dep, 0.18, { color: tc });
          B.beam(M.wood, P(-colZ + 0.1, colY), P(colZ - 0.1, colY), dep, 0.16, { color: tc });
          if (!G.window) B.beam(M.wood, P(0, y + 0.15), P(0, Math.min(yc, ridgeY - tv) - 0.05), dep, 0.16, { color: tc });
          B.beam(M.wood, P(-d / 4, y + 0.15), P(-colZ * 0.35, colY - 0.08), dep * 0.9, 0.14, { color: tc });
          B.beam(M.wood, P(d / 4, y + 0.15), P(colZ * 0.35, colY - 0.08), dep * 0.9, 0.14, { color: tc });
          if (G.window && colY + 1.05 < yc) {
            B.push(xo, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
            A.window(B, M, { x: 0, w: 0.58, y0: colY + 0.18, y1: colY + Math.min(0.95, yc - colY - 0.35) }, gt, { frame: tc, surface: true });
            B.pop();
          }
        }
      }
    }
    return { ridgeY, eaveY, W, D, a, tp, tv, top: (x, z) => Math.min(eaveY + (D - Math.abs(z)) * tp, hip > 0 ? yk + (W - Math.abs(x)) * tp : 1e9) };
  };
  // gable window placed in a gable wall frame (helper used by houses with attic windows)
  A.gableWindow = function (B, M, sx, w, y, t, o) {
    B.push(sx * w / 2, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    A.window(B, M, { x: 0, w: 0.62, y0: y, y1: y + 0.8 }, t, o || {});
    B.pop();
  };
  // single slope (lean-to) roof: high edge at zHigh, low edge at zLow, spanning x0..x1
  A.shed = function (B, M, x0, x1, zHigh, zLow, yHigh, yLow, o) {
    o = o || {};
    const mat = o.mat || M.shingle, col = o.color, th = o.thick || 0.12, s = 0.5;
    const L = Math.hypot(zLow - zHigh, yHigh - yLow);
    const sgn = zLow > zHigh ? 1 : -1;
    const pts = sgn > 0 ? [v3(x0, yLow, zLow), v3(x1, yLow, zLow), v3(x1, yHigh, zHigh), v3(x0, yHigh, zHigh)] : [v3(x1, yLow, zLow), v3(x0, yLow, zLow), v3(x0, yHigh, zHigh), v3(x1, yHigh, zHigh)];
    const uvs = sgn > 0 ? [[x0 * s, 0], [x1 * s, 0], [x1 * s, L * s], [x0 * s, L * s]] : [[x1 * s, 0], [x0 * s, 0], [x0 * s, L * s], [x1 * s, L * s]];
    B.poly(mat, pts, { color: col, uvs });
    B.poly(M.planks, pts.map((q) => v3(q.x, q.y - th, q.z)).reverse(), { color: 0x4a3b2e, uv: 'world', uvScale: 0.5 });
    const f = (a, b) => B.quad(M.planks, v3(a.x, a.y - th, a.z), v3(b.x, b.y - th, b.z), b, a, { color: 0x4a3b2e });
    f(pts[0], pts[1]); f(pts[2], pts[3]); f(pts[1], pts[2]); f(pts[3], pts[0]);
  };

  /* ------------------------------------------- chimneys & dormers ------------------------------------------- */
  A.chimney = function (B, M, x, z, y0, yTop, o) {
    o = o || {};
    const sx = o.sx || 0.85, sz = o.sz || 0.7, col = o.color || 0xd2c9b8, mat = o.mat || M.rubble;
    if (o.shoulder) {   // wide breast up to the shoulder, then the stack
      const bx = sx * 1.55, bz = sz * 1.25, ys = o.shoulder;
      B.boxY(mat, x, y0, z, bx, ys - y0, bz, { color: col, skip: 'b' });
      B.box(mat, x, ys + 0.25, z, bx, 0.5, bz, { color: col, top: [sx / bx, sz / bz], skip: 'b' });
      B.boxY(mat, x, ys + 0.5, z, sx, yTop - ys - 0.5, sz, { color: col, skip: 'b' });
    } else B.boxY(mat, x, y0, z, sx, yTop - y0, sz, { color: col, skip: 'b' });
    B.boxY(M.stone, x, yTop, z, sx + 0.18, 0.12, sz + 0.18, { color: 0xc9c0b0 });
    B.box(M.dark, x, yTop + 0.125, z, sx - 0.22, 0.01, sz - 0.22, { color: 0x14110e });
    if (o.pots) for (const dx of [-0.17, 0.17]) B.cyl(M.dark, x + dx * (sx / 0.85), yTop + 0.12, z, 0.1, 0.085, 0.3, 8, { color: 0x8a5a44, caps: '' });
  };
  // dormer on the front slope of a roof built by A.roof (r = its return value)
  A.dormer = function (B, M, r, x, zFront, wd, hd, o) {
    o = o || {};
    const tp = r.tp, y0 = r.eaveY + (r.D - zFront) * tp - 0.05, y1 = y0 + hd;
    const zBack = r.D - (y1 - r.eaveY) / tp;
    const pc = o.pitch || 50, tpd = Math.tan(pc * DEG), yr = y1 + (wd / 2) * tpd;
    const zRidge = r.D - (yr - r.eaveY) / tp;
    const wc = o.wallColor || 0xe8dcc4;
    // front wall + window
    B.push(x, y0, zFront, 0);
    A.wall(B, M.plaster, wd, hd, 0.2, [{ x: 0, w: wd * 0.5, y0: 0.2, y1: hd - 0.12 }], { color: wc });
    A.window(B, M, { x: 0, w: wd * 0.5, y0: 0.2, y1: hd - 0.12 }, 0.2, { frame: o.frame });
    // gable triangle above
    B.poly(M.plaster, [v3(-wd / 2, hd, 0), v3(wd / 2, hd, 0), v3(0, hd + (wd / 2) * tpd, 0)], { color: wc });
    B.pop();
    // cheeks
    for (const sx of [-1, 1]) {
      const pts = [v3(x + sx * wd / 2, y0, zFront), v3(x + sx * wd / 2, y1, zFront), v3(x + sx * wd / 2, y1, zBack)];
      B.poly(M.plaster, sx > 0 ? pts.reverse() : pts, { color: wc });
    }
    // little gable roof (ridge along z)
    const oh = 0.18, ye = y1 - oh * tpd;
    const zBe = r.D - (ye - r.eaveY) / tp;
    const mat = o.mat, col = o.color, s = 0.5;
    for (const sx of [-1, 1]) {
      const xe = x + sx * (wd / 2 + oh);
      let P = [v3(xe, ye, zFront + oh), v3(x, yr, zFront + oh), v3(x, yr, zRidge), v3(xe, ye, zBe)];
      if (sx < 0) P = P.reverse();
      const L = Math.hypot(wd / 2 + oh, yr - ye);
      B.poly(mat, P, { color: col, uvs: P.map((q) => [q.z * s, (Math.abs(q.x - x) < 1e-4 ? L : 0) * s]) });
      B.poly(M.planks, P.map((q) => v3(q.x, q.y - 0.12, q.z)).reverse(), { color: 0x4a3b2e });
    }
  };

  /* ------------------------------------------- house recipe ------------------------------------------- */
  /* spec: { w, d, floors: [{ h, wall: 'stone'|'rubble'|'plaster'|'timber', jetty }], roof: { pitch, hip, mat, color, sag, ridge },
             door: { side: 'front'|'left'|'right', x, w, double }, chimney: 'gable-l'|'gable-r'|'ridge'|null, dormers: [x...],
             seed, plaster, timber, shutter, attic, annex: {...} }
     returns { ridgeY, doors: [{ x, z, nx, nz }] (local), footprint }                                                    */
  A.house = function (B, M, spec) {
    const R = V.rng(spec.seed || 1);
    const P = V.PAL;
    const w = spec.w, d = spec.d;
    const plinth = spec.plinth === undefined ? 0.36 : spec.plinth;
    const timberC = spec.timber || pick(P.timber, R), plasterC = spec.plaster || pick(P.plaster, R);
    const foundC = pick(P.found, R), shutterC = spec.shutter === undefined ? pick(P.shutter, R) : spec.shutter;
    const doorC = spec.doorColor || pick(P.door, R);
    const doors = [];
    // plinth
    B.boxY(M.rubble, 0, 0, 0, w + 0.24, plinth, d + 0.24, { color: foundC, skip: 'b' });
    // floor visible through the cutaway
    B.boxY(M.planks, 0, plinth, 0, w - 0.3, 0.03, d - 0.3, { color: 0x4d3d30, cast: false });
    let y = plinth, ow = w, od = d;
    spec.floors.forEach((F, fi) => {
      const jet = F.jetty || 0;
      if (jet) {
        // jetty: the storey overhangs front and back (and the sides when asked); bressummer + joist ends below
        const jw = ow + (F.jettySides ? jet * 2 : 0);
        for (const sz of [-1, 1]) {
          B.box(M.wood, 0, y - 0.09, sz * (od / 2 + jet - 0.1), jw, 0.18, 0.2, { color: timberC });
          for (let k = -ow / 2 + 0.3; k < ow / 2; k += 0.55) B.box(M.wood, k, y - 0.25, sz * (od / 2 + jet / 2 - 0.08), 0.13, 0.13, jet + 0.16, { color: timberC });
        }
        if (F.jettySides) for (const sx of [-1, 1]) B.box(M.wood, sx * (ow / 2 + jet - 0.1), y - 0.09, 0, 0.2, 0.18, od + jet * 2, { color: timberC });
        B.box(M.planks, 0, y - 0.21, 0, jw - 0.1, 0.04, od + jet * 2 - 0.1, { color: 0x4a3b2e, cast: false });
        ow = jw; od += jet * 2;
      }
      const fh = F.h, t = F.wall === 'stone' || F.wall === 'rubble' ? 0.45 : 0.28;
      const wm = F.wall === 'stone' ? M.stone : F.wall === 'rubble' ? M.rubble : M.plaster;
      const wc = F.wall === 'stone' ? 0xdcd4c4 : F.wall === 'rubble' ? foundC : plasterC;
      const sides = [
        { id: 'front', x: 0, z: od / 2, ry: 0, len: ow },
        { id: 'back', x: 0, z: -od / 2, ry: Math.PI, len: ow },
        { id: 'right', x: ow / 2, z: 0, ry: Math.PI / 2, len: od - 2 * t },
        { id: 'left', x: -ow / 2, z: 0, ry: -Math.PI / 2, len: od - 2 * t },
      ];
      for (const S of sides) {
        const ops = [];
        const isGround = fi === 0;
        const n = Math.max(0, Math.floor((S.len - 0.6) / 2.1));
        let doorX = null;
        if (isGround && spec.door && (spec.door.side || 'front') === S.id) {
          doorX = spec.door.x !== undefined ? spec.door.x : 0;
          ops.push({ x: doorX, w: spec.door.w || 1.05, y0: 0, y1: spec.door.h || 2.05, kind: 'door' });
        }
        const winW = F.winW || (isGround ? 0.78 : 0.82), wy0 = isGround ? 0.95 : 0.75, wy1 = isGround ? 1.95 : Math.min(fh - 0.35, 1.9);
        const slots = [];
        if (S.id === 'front' || S.id === 'back') { for (let k = 0; k < n; k++) slots.push(-S.len / 2 + (k + 0.5) * S.len / n); }
        else if (S.len > 3.2) slots.push(S.len > 6 ? -S.len * 0.22 : 0, ...(S.len > 6 ? [S.len * 0.22] : []));
        for (const sx of slots) {
          if (doorX !== null && Math.abs(sx - doorX) < 1.25) continue;
          if (S.id === 'back' && R() < 0.35) continue;
          if (spec.chimney && ((spec.chimney === 'gable-r' && S.id === 'right') || (spec.chimney === 'gable-l' && S.id === 'left')) && Math.abs(sx) < 1.1) continue;
          ops.push({ x: sx, w: winW, y0: wy0, y1: wy1, kind: 'window' });
        }
        B.push(S.x, y, S.z, S.ry);
        A.wall(B, wm, S.len, fh, t, ops, { color: wc, uvOff: [R() * 3, 0] });
        if (F.wall === 'timber') A.timber(B, M, S.len, fh, ops, { rng: R, color: timberC });
        for (const op of ops) {
          if (op.kind === 'door') {
            A.door(B, M, op, t, { color: doorC, frame: timberC, stone: F.wall === 'stone', double: spec.door.double });
            if (S.id === 'front') doors.push({ x: S.x + op.x, z: S.z + 0.1, nx: 0, nz: 1 });
          } else {
            const sh = shutterC && (F.wall !== 'timber' || R() < 0.5) && R() < 0.85 ? shutterC : null;
            A.window(B, M, op, t, { frame: timberC, shutter: sh, lintel: F.wall === 'stone' || F.wall === 'rubble' ? (F.wall === 'stone' ? 'stone' : 'wood') : null, sillMat: F.wall === 'timber' || F.wall === 'plaster' ? M.wood : M.stone, flowers: !isGround && S.id === 'front' && R() < (spec.flowers || 0.25) });
          }
        }
        B.pop();
      }
      // floor band between storeys
      if (fi < spec.floors.length - 1 && !spec.floors[fi + 1].jetty) B.box(M.wood, 0, y + fh - 0.08, 0, ow + 0.06, 0.16, od + 0.06, { color: timberC, skip: 'b' });
      y += fh;
    });
    // roof
    const Rf = spec.roof;
    const roofMat = Rf.mat === 'thatch' ? M.thatch : M.shingle;
    const roofCol = Rf.color || (Rf.mat === 'thatch' ? pick(P.thatch, R) : Rf.mat === 'slate' ? pick(P.slate, R) : Rf.mat === 'tile' ? pick(P.tile, R) : pick(P.shingle, R));
    const topF = spec.floors[spec.floors.length - 1];
    const gableTimber = topF.wall === 'timber' || topF.wall === 'plaster';
    const r = A.roof(B, M, {
      w: ow, d: od, y, pitch: Rf.pitch, hip: Rf.hip || 0, sag: Rf.sag || 0, mat: roofMat, color: roofCol,
      thick: Rf.mat === 'thatch' ? 0.36 : 0.15, oe: Rf.mat === 'thatch' ? 0.62 : 0.5, og: Rf.mat === 'thatch' ? 0.45 : 0.38,
      ridge: Rf.mat === 'thatch' ? 'roll' : 'cap', ridgeColor: Rf.mat === 'thatch' ? 0x9c8a62 : undefined,
      gable: { mat: gableTimber ? M.plaster : (topF.wall === 'stone' ? M.stone : M.rubble), color: gableTimber ? plasterC : (topF.wall === 'stone' ? 0xdcd4c4 : foundC), t: 0.3, timber: gableTimber, timberColor: timberC, window: spec.attic },
    });
    // chimney
    if (spec.chimney === 'gable-r' || spec.chimney === 'gable-l') {
      const sx = spec.chimney === 'gable-r' ? 1 : -1;
      A.chimney(B, M, sx * (ow / 2 + 0.36), spec.chimneyZ || 0, 0, r.ridgeY + 0.75, { shoulder: y - 0.4, color: foundC, pots: R() < 0.5 });
    } else if (spec.chimney === 'ridge') {
      const cx = spec.chimneyX !== undefined ? spec.chimneyX : (R() - 0.5) * ow * 0.4;
      A.chimney(B, M, cx, -0.25, r.ridgeY - 1.6, r.ridgeY + 0.85, { color: foundC, pots: R() < 0.6, mat: M.rubble });
    }
    for (const dx of spec.dormers || []) A.dormer(B, M, r, dx, r.D - 1.25, 1.25, 1.15, { mat: roofMat, color: roofCol, wallColor: plasterC, frame: timberC });
    return { ridgeY: r.ridgeY, eaveY: r.eaveY, doors, w: ow, d: od, roof: r, top: y, colors: { timberC, plasterC, foundC, roofCol, doorC } };
  };

  /* ------------------------------------------- KeepBuilder ------------------------------------------- */
  // main hall block 18 x 14 with a jettied timber storey, two front towers with pyramid roofs, a round stair
  // turret, a raised entrance on a stone stair with parapets. Front faces +z.
  A.keep = function (B, M, o) {
    o = o || {};
    const sc = 0xddd4c3, sc2 = 0xd2c9b8, slate = 0x686e75, tim = 0x4f3e30, pl = 0xe7dcc6;
    const w = 18, d = 14, h1 = 10.6;
    // battered plinth + masonry body
    B.boxY(M.stone, 0, 0, 0, w + 1.2, 1.5, d + 1.2, { color: sc2, top: [(w + 0.2) / (w + 1.2), (d + 0.2) / (d + 1.2)], skip: 'b' });
    B.boxY(M.stone, 0, 1.5, 0, w, h1 - 1.5, d, { color: sc, skip: 'b' });
    B.boxY(M.stone, 0, 5.3, 0, w + 0.24, 0.24, d + 0.24, { color: 0xcfc6b5 });           // string course
    // quoins (alternating long / short corner stones, lighter)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let k = 0, yy = 1.6; yy < h1 - 0.5; k++, yy += 0.62) {
        const lx = k % 2 ? 0.9 : 0.5, lz = k % 2 ? 0.5 : 0.9;
        B.box(M.stone, sx * (w / 2 - lx / 2 + 0.03), yy + 0.28, sz * (d / 2 - lz / 2 + 0.03), lx, 0.56, lz, { color: 0xebe3d3 });
      }
    }
    // windows: arrow slits below, round-headed pairs above
    const slit = (x, y0, z, face) => { B.push(x, 0, z, face); B.box(M.dark, 0, y0 + 0.6, 0.01, 0.16, 1.2, 0.04, { color: 0x15120f }); B.box(M.stone, 0, y0 + 0.6, 0.0, 0.42, 1.5, 0.06, { color: 0xe6ddcc }); B.pop(); };
    const win2 = (x, y0, z, face) => {
      B.push(x, 0, z, face);
      for (const dx of [-0.42, 0.42]) {
        B.box(M.glass, dx, y0 + 0.75, 0.0, 0.62, 1.5, 0.05, { uv: 'local' });
        A.archHead(B, M.glass, dx, y0 + 1.5, 0.026, 0.31, 0, {});
      }
      B.box(M.stone, 0, y0 + 0.78, 0.035, 0.12, 1.56, 0.06, { color: 0xe6ddcc });
      B.box(M.stone, 0, y0 - 0.06, 0.08, 1.95, 0.14, 0.24, { color: 0xe6ddcc });
      B.box(M.stone, 0, y0 + 1.92, 0.02, 2.0, 0.26, 0.08, { color: 0xe6ddcc });
      B.pop();
    };
    for (const x of [-5.5, 5.5]) { slit(x, 2.4, d / 2, 0); win2(x, 6.6, d / 2, 0); }
    for (const x of [-6, 0, 6]) { slit(x, 2.4, -d / 2, Math.PI); win2(x, 6.6, -d / 2, Math.PI); }
    for (const z of [-3.5, 3.5]) for (const sx of [-1, 1]) { slit(sx * w / 2, 2.4, z, sx * Math.PI / 2); win2(sx * w / 2, 6.6, z, sx * Math.PI / 2); }
    // jettied timber storey
    const jw = w + 0.8, jd = d + 0.8, h2 = 3.8, y2 = h1;
    B.boxY(M.wood, 0, y2 - 0.22, 0, jw + 0.1, 0.24, jd + 0.1, { color: tim });
    for (let k = -jw / 2 + 0.3; k < jw / 2; k += 0.6) for (const sz of [-1, 1]) B.box(M.wood, k, y2 - 0.36, sz * (d / 2 + 0.2), 0.14, 0.14, 0.62, { color: tim });
    const sides = [{ x: 0, z: jd / 2, ry: 0, len: jw }, { x: 0, z: -jd / 2, ry: Math.PI, len: jw }, { x: jw / 2, z: 0, ry: Math.PI / 2, len: jd - 0.6 }, { x: -jw / 2, z: 0, ry: -Math.PI / 2, len: jd - 0.6 }];
    const R = V.rng(77);
    for (const S of sides) {
      const ops = []; const n = Math.floor(S.len / 2.6);
      for (let k = 0; k < n; k++) { const xx = -S.len / 2 + (k + 0.5) * S.len / n; if (S.ry === 0 && Math.abs(xx) > 6.2) continue; ops.push({ x: xx, w: 0.95, y0: 0.9, y1: 2.6 }); }
      B.push(S.x, y2, S.z, S.ry);
      A.wall(B, M.plaster, S.len, h2, 0.3, ops, { color: pl });
      A.timber(B, M, S.len, h2, ops, { rng: R, color: tim });
      for (const op of ops) A.window(B, M, op, 0.3, { frame: tim, shutter: 0x5a3a32 });
      B.pop();
    }
    // main roof: half-hipped slate, with a small timber lantern on the ridge
    const r = A.roof(B, M, { w: jw, d: jd, y: y2 + h2, pitch: 44, hip: 0.42, mat: M.shingle, color: slate, thick: 0.2, oe: 0.7, og: 0.6, gable: { mat: M.plaster, color: pl, timber: true, timberColor: tim } });
    {
      const ly = r.ridgeY - 0.6, ls = 2.6;
      B.boxY(M.wood, 0, ly, 0, ls, 2.0, ls, { color: tim, skip: 'b' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.boxY(M.wood, sx * (ls / 2), ly, sz * (ls / 2), 0.2, 2.1, 0.2, { color: 0x3f3226 });
      for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { B.push(0, ly, 0, f); B.box(M.dark, 0, 1.1, ls / 2 + 0.01, 1.4, 1.0, 0.02, { color: 0x15120f }); B.pop(); }
      A.roof(B, M, { w: ls, d: ls, y: ly + 2.0, pitch: 58, hip: 1, mat: M.shingle, color: slate, thick: 0.12, oe: 0.4, og: 0.4, gable: false });
      B.cyl(M.iron, 0, ly + 2.0 + 1.3 * Math.tan(58 * DEG) - 0.2, 0, 0.04, 0.02, 1.4, 6, { color: 0x2e2f31 });
    }
    // front towers
    const tw = 6.4, th = 17.6, tz = d / 2 - 1.6;
    for (const sx of [-1, 1]) {
      const tx = sx * (w / 2 + 0.4);
      B.boxY(M.stone, tx, 0, tz, tw + 0.8, 1.6, tw + 0.8, { color: sc2, top: [(tw + 0.1) / (tw + 0.8), (tw + 0.1) / (tw + 0.8)], skip: 'b' });
      B.boxY(M.stone, tx, 1.6, tz, tw, th - 1.6, tw, { color: sc, skip: 'b' });
      B.boxY(M.stone, tx, 5.3, tz, tw + 0.24, 0.24, tw + 0.24, { color: 0xcfc6b5 });
      for (const ssx of [-1, 1]) for (const ssz of [-1, 1]) for (let k = 0, yy = 1.6; yy < th - 1.2; k++, yy += 0.62) {
        const lx = k % 2 ? 0.8 : 0.45, lz = k % 2 ? 0.45 : 0.8;
        B.box(M.stone, tx + ssx * (tw / 2 - lx / 2 + 0.03), yy + 0.28, tz + ssz * (tw / 2 - lz / 2 + 0.03), lx, 0.56, lz, { color: 0xebe3d3 });
      }
      slit(tx, 3.0, tz + tw / 2, 0); slit(tx, 8.8, tz + tw / 2, 0); win2(tx, 12.4, tz + tw / 2, 0);
      slit(tx + sx * tw / 2, 6.0, tz, sx * Math.PI / 2); slit(tx + sx * tw / 2, 11.0, tz, sx * Math.PI / 2);
      // corbelled parapet with crenels
      for (let k = 0; k < 9; k++) for (const f of [0, 1, 2, 3]) {
        const ang = f * Math.PI / 2; B.push(tx, 0, tz, ang);
        B.box(M.stone, -tw / 2 + 0.4 + k * (tw - 0.8) / 8, th - 0.15, tw / 2 + 0.15, 0.28, 0.4, 0.32, { color: sc2, top: [1, 0.4] });
        B.pop();
      }
      B.boxY(M.stone, tx, th, tz, tw + 0.6, 0.7, tw + 0.6, { color: sc, skip: 'b' });
      for (const f of [0, 1, 2, 3]) {
        B.push(tx, th + 0.7, tz, f * Math.PI / 2);
        for (let k = 0; k < 4; k++) B.boxY(M.stone, -tw / 2 + 0.75 + k * (tw - 0.9) / 3.0, 0, tw / 2 + 0.05, 0.85, 0.8, 0.5, { color: sc, skip: 'b' });
        B.pop();
      }
      // pyramid roof rising inside the parapet
      A.roof(B, M, { w: tw - 0.6, d: tw - 0.6, y: th + 0.9, pitch: 60, hip: 1, mat: M.shingle, color: slate, thick: 0.16, oe: 0.25, og: 0.25, gable: false });
      const apex = th + 0.9 + (tw - 0.6) / 2 * Math.tan(60 * DEG);
      B.cyl(M.iron, tx, apex - 0.3, tz, 0.05, 0.03, 1.6, 6, { color: 0x2e2f31 });
      // banner hanging on the tower front
      A.banner(B, M, tx, 13.6, tz + tw / 2 + 0.06, 0, 1.5, 4.6);
    }
    // round stair turret at the back-right
    {
      const cx = w / 2 - 1.2, cz = -d / 2 - 0.6, rr = 2.3, hh = 19.2;
      B.cyl(M.stone, cx, 0, cz, rr + 0.35, rr, 1.6, 16, { color: sc2, caps: '' });
      B.cyl(M.stone, cx, 1.6, cz, rr, rr, hh - 1.6, 16, { color: sc, caps: '' });
      for (let k = 0; k < 5; k++) { const a = -0.6 + k * 0.5, y0 = 3 + k * 3; B.push(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr, Math.PI / 2 - a); B.box(M.dark, 0, y0 + 0.5, 0.0, 0.14, 1.0, 0.05, { color: 0x15120f }); B.pop(); }
      B.cyl(M.stone, cx, hh, cz, rr + 0.3, rr + 0.3, 0.45, 16, { color: sc2 });
      B.cyl(M.shingle, cx, hh + 0.45, cz, rr + 0.55, 0.05, 4.4, 16, { color: slate, caps: '', uvScale: 0.5 });
      B.cyl(M.iron, cx, hh + 4.6, cz, 0.04, 0.02, 1.2, 6, { color: 0x2e2f31 });
    }
    // raised entrance: landing + stair with parapets, round-headed door with voussoirs
    const ly = 2.0, lz0 = d / 2, lz1 = d / 2 + 2.4, sw = 4.4;
    B.boxY(M.stone, 0, 0, (lz0 + lz1) / 2, sw + 0.9, ly, lz1 - lz0, { color: sc2, skip: 'b' });
    B.boxY(M.flag, 0, ly - 0.02, (lz0 + lz1) / 2, sw + 0.9, 0.04, lz1 - lz0, { color: 0xd8d0c0 });
    const steps = 8, run = 0.46, rise = ly / steps;
    for (let i = 0; i < steps; i++) {
      const z0 = lz1 + i * run;
      B.boxY(M.flag, 0, 0, z0 + run / 2, sw, ly - i * rise, run, { color: i % 2 ? 0xd2cab9 : 0xcbc3b2, skip: 'b' });
    }
    const stairEnd = lz1 + steps * run;
    for (const sx of [-1, 1]) {   // stepped side parapets following the stair
      const xx = sx * (sw / 2 + 0.25);
      B.boxY(M.stone, xx, 0, (lz0 + lz1) / 2, 0.5, ly + 0.95, lz1 - lz0, { color: sc, skip: 'b' });
      for (let i = 0; i < steps; i++) B.boxY(M.stone, xx, 0, lz1 + i * run + run / 2, 0.5, ly - i * rise + 0.9, run, { color: sc, skip: 'b' });
      B.boxY(M.stone, xx, 0, stairEnd + 0.3, 0.7, 1.2, 0.7, { color: sc2, skip: 'b' });
      B.boxY(M.stone, xx, 1.2, stairEnd + 0.3, 0.85, 0.15, 0.85, { color: 0xcfc6b5 });
    }
    // doorway
    const dw = 2.2, dh = 3.0;
    B.push(0, ly, d / 2 + 0.02, 0);
    B.box(M.planks, 0, dh / 2 - 0.3, 0.06, dw, dh - 0.6, 0.1, { color: 0x4a3426 });
    A.archHead(B, M.planks, 0, dh - 0.6, 0.111, dw / 2, 0, { color: 0x4a3426 });
    for (let k = 0; k < 4; k++) B.box(M.iron, 0, 0.35 + k * 0.62, 0.12, dw * 0.92, 0.07, 0.02, { color: V.PAL.iron });
    B.box(M.iron, 0.45, 1.2, 0.14, 0.1, 0.18, 0.05, { color: V.PAL.iron });
    for (let k = 0; k <= 10; k++) {   // voussoirs
      const aa = Math.PI * k / 10, cx = Math.cos(aa) * (dw / 2 + 0.24), cy = dh - 0.6 + Math.sin(aa) * (dw / 2 + 0.24);
      B.box(M.stone, cx, cy, 0.14, 0.3, 0.5, 0.26, { rz: aa - Math.PI / 2, color: k === 5 ? 0xf0e8d8 : 0xe2d9c8 });
    }
    for (const sx of [-1, 1]) B.box(M.stone, sx * (dw / 2 + 0.24), (dh - 0.6) / 2, 0.14, 0.4, dh - 0.6, 0.26, { color: 0xe2d9c8 });
    B.pop();
    // wall-mounted iron lanterns (unlit) beside the door
    for (const sx of [-1, 1]) { B.box(M.iron, sx * 2.0, ly + 2.4, d / 2 + 0.15, 0.06, 0.06, 0.3, { color: 0x2e2f31 }); B.box(M.iron, sx * 2.0, ly + 2.2, d / 2 + 0.32, 0.22, 0.32, 0.22, { color: 0x34363a }); }
    return {
      ridgeY: r.ridgeY, door: { x: 0, z: stairEnd + 0.6 },
      colliders: [[0, 0, w / 2 + 0.6, d / 2 + 0.6], [-(w / 2 + 0.4), tz, tw / 2 + 0.4, tw / 2 + 0.4], [(w / 2 + 0.4), tz, tw / 2 + 0.4, tw / 2 + 0.4], [0, (lz0 + stairEnd) / 2 + 0.2, sw / 2 + 0.55, (stairEnd - lz0) / 2 + 0.3], [w / 2 - 1.2, -d / 2 - 0.6, 2.7, 2.7]],
      stairEnd,
    };
  };

  // flat semicircular arch head facing +z (window / door tops)
  A.archHead = function (B, mat, x, y, z, r, unused, o) {
    const pts = []; const n = 10;
    for (let k = 0; k <= n; k++) { const a = Math.PI * k / n; pts.push(v3(x + Math.cos(a) * r, y + Math.sin(a) * r, z)); }
    B.poly(mat, pts, Object.assign({ uv: 'local' }, o || {}));
  };

  /* ------------------------------------------- banners ------------------------------------------- */
  // hanging banner on a short iron pole, centre x, top y, plane facing +z (rotated by ry)
  A.banner = function (B, M, x, yTop, z, ry, bw, bh) {
    B.push(x, yTop, z, ry);
    B.box(M.iron, 0, 0.05, 0.12, bw + 0.3, 0.06, 0.06, { color: 0x2e2f31 });
    for (const sx of [-1, 1]) B.box(M.iron, sx * (bw / 2 + 0.12), 0.05, 0.06, 0.05, 0.05, 0.14, { color: 0x2e2f31 });
    // subdivided cloth with a swallow-tail bottom: uv.y = 1 at the pole
    const nx = 4, ny = 8, pts = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = 1 - j / ny;
      let yy = -j / ny * bh;
      if (j === ny) yy += Math.abs(u - 0.5) < 0.01 ? bh * 0.12 : 0;
      pts.push([(u - 0.5) * bw, yy, 0.13, u, v]);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = pts[j * (nx + 1) + i], b = pts[j * (nx + 1) + i + 1], c = pts[(j + 1) * (nx + 1) + i + 1], d = pts[(j + 1) * (nx + 1) + i];
      B.poly(M.banner, [v3(d[0], d[1], d[2]), v3(c[0], c[1], c[2]), v3(b[0], b[1], b[2]), v3(a[0], a[1], a[2])], { uvs: [[d[3], d[4]], [c[3], c[4]], [b[3], b[4]], [a[3], a[4]]], normals: [v3(0, 0, 1), v3(0, 0, 1), v3(0, 0, 1), v3(0, 0, 1)], cast: false });
    }
    B.pop();
  };
})();
