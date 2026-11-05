/* =====================================================================================================
 *  village/fortifications.js  -  WallBuilder, TowerBuilder, GatehouseBuilder
 *
 *  Curtain walls are built bay by bay (not one stretched cube): battered rubble footing on the outer face,
 *  ashlar body, corbel table carrying an overhanging crenellated parapet, paved wall-walk, low inner parapet,
 *  inner buttresses, drain spouts, arrow slits, occasional repair patches and per-bay stone tone variation.
 *  Corner towers are round with conical roofs inside crenellated parapets; two square watchtowers carry
 *  timber galleries; the south gatehouse has two drum towers, a vaulted 6 m passage, opened iron-strapped
 *  doors lying against the passage walls, a raised portcullis, voussoirs and a roofed gate room.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const A = V.Arch;
  const F = V.Fort = {};
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const DEG = Math.PI / 180;

  /* ------------------------------------------ curtain wall ------------------------------------------ */
  // local frame: wall along x in [x0, x1], outward = +z, centre line z = 0, body from -wt/2 .. wt/2
  F.curtain = function (B, M, x0, x1, cfg, o) {
    o = o || {};
    const wt = cfg.wallThick, h = cfg.wallH, R = V.rng(o.seed || 7);
    const L = x1 - x0, nb = Math.max(1, Math.round(L / 10));
    const bay = L / nb;
    for (let b = 0; b < nb; b++) {
      const bx0 = x0 + b * bay, bx1 = bx0 + bay, bc = (bx0 + bx1) / 2;
      const tone = V.PAL.castle[Math.floor(R() * V.PAL.castle.length)];
      const t2 = R() < 0.3 ? 0xc9c3b6 : tone;
      // body
      B.slab(M.stone, bx0, 0, -wt / 2, bx1, h, wt / 2, { color: tone, skip: 'b', uvOff: [R() * 2, 0] });
      // rubble footing: battered on the outside, a low course on the inside
      const bo = wt / 2, bt = 2.3, bd = 0.95;
      B.quad(M.rubble, v3(bx0, 0, bo + bd), v3(bx1, 0, bo + bd), v3(bx1, bt, bo + 0.01), v3(bx0, bt, bo + 0.01), { color: 0xc4bcae });
      B.box(M.rubble, bc, 0.5, -wt / 2 - 0.06, bay, 1.0, 0.12, { color: 0xc1b9ab, skip: 'b' });
      if (b === 0 || b === nb - 1) {
        const ex = b === 0 ? bx0 : bx1, sg = b === 0 ? -1 : 1;
        const tri = [v3(ex, 0, bo), v3(ex, 0, bo + bd), v3(ex, bt, bo)];
        B.poly(M.rubble, sg < 0 ? tri : tri.reverse(), { color: 0xc4bcae });
      }
      // repair patch
      if (R() < 0.35) { const px = bx0 + 1.5 + R() * (bay - 4), py = 2.6 + R() * 3; B.box(M.rubble, px, py, bo + 0.03, 1.6 + R() * 1.6, 1.0 + R() * 1.2, 0.08, { color: 0xbab3a6 }); }
      // arrow slits
      for (const fx of [0.3, 0.7]) { const sx = bx0 + bay * fx; B.box(M.dark, sx, 4.6, bo + 0.02, 0.14, 1.15, 0.04, { color: 0x14110e }); B.box(M.stone, sx, 4.6, bo + 0.01, 0.42, 1.45, 0.05, { color: 0xe4dccd }); }
      // corbel table + overhanging parapet
      for (let cx = bx0 + 0.45; cx < bx1 - 0.2; cx += 0.9) B.box(M.stone, cx, h - 0.38, bo + 0.14, 0.26, 0.5, 0.28, { color: t2 });
      B.slab(M.stone, bx0, h - 0.12, bo - 0.55, bx1, h + 0.95, bo + 0.3, { color: tone, uvOff: [R(), 0] });
      // crenellations: merlons with sloped caps
      const nm = Math.max(2, Math.round(bay / 2.05));
      for (let k = 0; k < nm; k++) {
        const mx = bx0 + (k + 0.5) * bay / nm;
        B.boxY(M.stone, mx, h + 0.95, bo - 0.12, 1.15, 0.9, 0.84, { color: tone, skip: 'b' });
        B.boxY(M.stone, mx, h + 1.85, bo - 0.12, 1.25, 0.12, 0.92, { color: 0xd2cbbd, top: [0.85, 0.7] });
        if (k % 2 === 0) B.box(M.dark, mx, h + 1.3, bo + 0.3, 0.1, 0.5, 0.03, { color: 0x14110e });
      }
      // wall-walk paving + inner parapet
      B.slab(M.flag, bx0, h, -wt / 2 + 0.38, bx1, h + 0.06, bo - 0.55, { color: 0xd8d1c3 });
      B.slab(M.stone, bx0, h, -wt / 2, bx1, h + 0.72, -wt / 2 + 0.38, { color: tone });
      B.slab(M.stone, bx0, h + 0.72, -wt / 2 - 0.03, bx1, h + 0.82, -wt / 2 + 0.41, { color: 0xd2cbbd });
      // inner buttress
      if (b > 0 || nb === 1) {
        B.boxY(M.stone, bx0 + (nb === 1 ? bay / 2 : 0), 0, -wt / 2 - 0.45, 1.25, h - 1.6, 0.9, { color: tone, skip: 'b' });
        B.box(M.stone, bx0 + (nb === 1 ? bay / 2 : 0), h - 1.25, -wt / 2 - 0.3, 1.25, 0.7, 0.6, { color: tone, top: [1, 0.15] });
      }
      // drain spout
      if (b % 2 === 1) B.box(M.stone, bc, h - 0.9, bo + 0.32, 0.26, 0.22, 0.75, { color: 0xcfc8b9 });
    }
  };
  // straight stair flight against the inner face of a curtain (local frame of F.curtain); goes up toward +x
  F.wallStair = function (B, M, xStart, cfg, run) {
    const h = cfg.wallH, wt = cfg.wallThick, steps = Math.round(h / 0.3), rise = h / steps, dx = run / steps, wdt = 1.5;
    const z = -wt / 2 - wdt / 2 - 0.02;
    for (let i = 0; i < steps; i++) {
      const sx = xStart + i * dx;
      B.boxY(M.flag, sx + dx / 2, 0, z, dx, (i + 1) * rise, wdt, { color: i % 2 ? 0xd2cab9 : 0xcac2b1, skip: 'b' });
    }
    // stringer wall under the outer edge
    B.quad(M.stone, v3(xStart, 0, z - wdt / 2 - 0.001), v3(xStart + run, 0, z - wdt / 2 - 0.001), v3(xStart + run, h, z - wdt / 2 - 0.001), v3(xStart + dx, rise, z - wdt / 2 - 0.001), { color: 0xd0c9bb });
    return { x0: xStart, x1: xStart + run, z, w: wdt };
  };

  /* ------------------------------------------ towers ------------------------------------------ */
  F.roundTower = function (B, M, x, z, r, h, o) {
    o = o || {};
    const seg = o.seg || 20, tone = o.tone || 0xd9d3c6, slate = o.slate || 0x6a7077;
    B.cyl(M.rubble, x, 0, z, r + 0.95, r + 0.02, 2.5, seg, { color: 0xc4bcae, caps: '' });
    B.cyl(M.stone, x, 2.5, z, r, r, h - 3.1, seg, { color: tone, caps: '' });
    B.cyl(M.stone, x, 5.4, z, r + 0.12, r + 0.12, 0.22, seg, { color: 0xd0c9ba, caps: '' });
    // arrow slits around
    for (let lv = 0; lv < 2; lv++) for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + lv * 0.6 + (o.phase || 0);
      B.push(x + Math.cos(a) * r, 0, z + Math.sin(a) * r, Math.PI / 2 - a);
      B.box(M.dark, 0, 3.6 + lv * 3.4, 0.02, 0.15, 1.1, 0.05, { color: 0x14110e });
      B.box(M.stone, 0, 3.6 + lv * 3.4, 0.0, 0.44, 1.4, 0.06, { color: 0xe4dccd });
      B.pop();
    }
    // corbel ring + overhanging parapet + merlons
    const nc = Math.round((Math.PI * 2 * r) / 0.95);
    for (let k = 0; k < nc; k++) {
      const a = (k / nc) * Math.PI * 2;
      B.push(x + Math.cos(a) * (r + 0.14), 0, z + Math.sin(a) * (r + 0.14), Math.PI / 2 - a);
      B.box(M.stone, 0, h - 0.95, 0, 0.26, 0.52, 0.3, { color: 0xd0c9ba });
      B.pop();
    }
    B.cyl(M.stone, x, h - 0.7, z, r + 0.32, r + 0.32, 1.3, seg, { color: tone, caps: 't' });
    const nm = Math.round((Math.PI * 2 * r) / 2.1);
    for (let k = 0; k < nm; k++) {
      const a = (k / nm) * Math.PI * 2;
      B.push(x + Math.cos(a) * (r + 0.02), 0, z + Math.sin(a) * (r + 0.02), Math.PI / 2 - a);
      B.boxY(M.stone, 0, h + 0.6, 0, 1.15, 0.85, 0.6, { color: tone, skip: 'b' });
      B.boxY(M.stone, 0, h + 1.45, 0, 1.24, 0.12, 0.7, { color: 0xd2cbbd, top: [0.85, 0.7] });
      B.pop();
    }
    if (o.roof !== false) {
      const dr = r - 1.25;
      B.cyl(M.stone, x, h + 0.6, z, dr, dr, 1.8, seg, { color: 0xd0c9ba, caps: '' });
      for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.4; B.push(x + Math.cos(a) * dr, 0, z + Math.sin(a) * dr, Math.PI / 2 - a); B.box(M.dark, 0, h + 1.5, 0.02, 0.5, 0.8, 0.04, { color: 0x14110e }); B.pop(); }
      const rr = dr + 0.55, ch = rr * Math.tan((o.pitch || 58) * DEG);
      B.cyl(M.shingle, x, h + 2.4, z, rr, 0.04, ch, seg, { color: slate, caps: '', uvScale: 0.5 });
      B.cyl(M.planks, x, h + 2.25, z, rr, rr - 0.05, 0.15, seg, { color: 0x4a3b2e, caps: 'b' });
      B.cyl(M.iron, x, h + 2.4 + ch - 0.25, z, 0.05, 0.03, 1.5, 6, { color: 0x2e2f31, caps: '' });
      B.cyl(M.iron, x, h + 2.4 + ch + 0.6, z, 0.11, 0.11, 0.16, 8, { color: 0x2e2f31 });
      return h + 2.4 + ch;
    }
    return h + 1.5;
  };
  // square watchtower with an open timber gallery and hipped roof; frame: +z outward
  F.watchTower = function (B, M, s, h, o) {
    o = o || {};
    const tone = o.tone || 0xd9d3c6, tim = 0x4f3e30;
    B.boxY(M.rubble, 0, 0, 0, s + 1.6, 2.4, s + 1.6, { color: 0xc4bcae, top: [(s + 0.1) / (s + 1.6), (s + 0.1) / (s + 1.6)], skip: 'b' });
    B.boxY(M.stone, 0, 2.4, 0, s, h - 2.4, s, { color: tone, skip: 'b' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0, yy = 2.4; yy < h - 0.6; k++, yy += 0.6) {
      const lx = k % 2 ? 0.8 : 0.45, lz = k % 2 ? 0.45 : 0.8;
      B.box(M.stone, sx * (s / 2 - lx / 2 + 0.03), yy + 0.27, sz * (s / 2 - lz / 2 + 0.03), lx, 0.54, lz, { color: 0xe8e0d0 });
    }
    for (const f of [0, Math.PI / 2, -Math.PI / 2]) { B.push(0, 0, 0, f); B.box(M.dark, 0, 5.0, s / 2 + 0.02, 0.15, 1.2, 0.04, { color: 0x14110e }); B.box(M.stone, 0, 5.0, s / 2 + 0.01, 0.44, 1.5, 0.05, { color: 0xe4dccd }); B.pop(); }
    // gallery floor on projecting joists
    const gs = s + 1.0;
    B.boxY(M.planks, 0, h, 0, gs, 0.18, gs, { color: 0x5a4636 });
    for (let k = -gs / 2 + 0.3; k < gs / 2; k += 0.7) for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { B.push(0, 0, 0, f); B.box(M.wood, k, h - 0.1, s / 2 + 0.3, 0.14, 0.14, 0.7, { color: tim }); B.pop(); }
    const gh = 2.3;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) { if (!sx && !sz) continue; B.boxY(M.wood, sx * (gs / 2 - 0.1), h + 0.18, sz * (gs / 2 - 0.1), 0.2, gh, 0.2, { color: tim }); }
    for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      B.push(0, 0, 0, f);
      B.box(M.planks, 0, h + 0.18 + 0.5, gs / 2 - 0.08, gs - 0.2, 0.9, 0.08, { color: 0x5e4a38, uvOff: [f, 0] });
      B.box(M.wood, 0, h + 0.18 + 1.0, gs / 2 - 0.08, gs, 0.12, 0.14, { color: tim });
      B.pop();
    }
    A.roof(B, M, { w: gs, d: gs, y: h + 0.18 + gh, pitch: 48, hip: 1, mat: M.shingle, color: o.slate || 0x6a7077, thick: 0.16, oe: 0.55, og: 0.55, gable: false });
    const apex = h + 0.18 + gh + (gs / 2) * Math.tan(48 * DEG);
    B.cyl(M.iron, 0, apex - 0.2, 0, 0.05, 0.03, 1.2, 6, { color: 0x2e2f31, caps: '' });
    return apex;
  };

  /* ------------------------------------------ gatehouse ------------------------------------------ */
  // frame: gate passage along z, outward = +z, centre of the block at the origin
  F.gatehouse = function (B, M, cfg, o) {
    o = o || {};
    const tone = 0xdcd5c7, tone2 = 0xd0c9bb, slate = 0x686e75, tim = 0x4f3e30;
    const bw = 4.7, bd = 4.9, top = 11.2, pw = 3.0, spring = 4.4, ar = pw, crown = spring + ar;
    // piers
    for (const sx of [-1, 1]) {
      B.slab(M.stone, sx * pw, 0, -bd, sx * bw, top, bd, { color: tone, skip: 'b' });
      B.box(M.rubble, sx * (pw + 0.06), 0.45, 0, 0.12, 0.9, bd * 2, { color: 0xc1b9ab, skip: 'b' });     // worn plinth course in the passage
    }
    // vault + spandrels
    const n = 14;
    const ay = (x) => spring + Math.sqrt(Math.max(0, ar * ar - x * x));
    for (let i = 0; i < n; i++) {
      const xa = -pw + (2 * pw * i) / n, xb = -pw + (2 * pw * (i + 1)) / n, ya = ay(xa), yb = ay(xb);
      B.quad(M.stone, v3(xa, ya, bd), v3(xb, yb, bd), v3(xb, top, bd), v3(xa, top, bd), { color: tone });
      B.quad(M.stone, v3(xb, yb, -bd), v3(xa, ya, -bd), v3(xa, top, -bd), v3(xb, top, -bd), { color: tone });
      B.quad(M.stone, v3(xa, ya, -bd), v3(xb, yb, -bd), v3(xb, yb, bd), v3(xa, ya, bd), { color: 0xc8c1b3, uv: 'world' });
    }
    B.slab(M.flag, -bw, top, -bd, bw, top + 0.08, bd, { color: 0xd4ccbd });
    // voussoirs + keystone on both faces, imposts
    for (const fz of [1, -1]) {
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI * k / 12, cx = Math.cos(a) * (ar + 0.36), cy = spring + Math.sin(a) * (ar + 0.36);
        B.box(M.stone, cx, cy, fz * (bd + 0.08), 0.48, 0.78, 0.2, { rz: a - Math.PI / 2, color: k === 6 ? 0xf2eadb : 0xe4dccd });
      }
      for (const sx of [-1, 1]) B.box(M.stone, sx * (pw + 0.2), spring - 0.12, fz * (bd + 0.06), 0.6, 0.26, 0.16, { color: 0xe4dccd });
    }
    // machicolation gallery over the outer arch + carved plaque
    for (let k = -3; k <= 3; k++) B.box(M.stone, k * 0.95, 8.55, bd + 0.35, 0.3, 0.6, 0.7, { color: tone2 });
    B.slab(M.stone, -bw + 0.4, 8.85, bd + 0.05, bw - 0.4, 10.1, bd + 0.75, { color: tone });
    B.box(M.stone, 0, 9.2 - 1.5, bd + 0.05, 2.0, 1.05, 0.12, { color: 0xe8e0d0 });
    B.box(M.stone, 0, 9.2 - 1.5, bd + 0.12, 1.4, 0.62, 0.06, { color: 0x9a8f7c });
    // crenellated parapet around the gate top
    for (const f of [0, Math.PI]) {
      B.push(0, top, 0, f);
      for (let k = 0; k < 4; k++) { const mx = -bw + 0.75 + k * (2 * bw - 1.5) / 3; B.boxY(M.stone, mx, 0, bd - 0.3, 1.1, 1.0, 0.6, { color: tone, skip: 'b' }); B.boxY(M.stone, mx, 1.0, bd - 0.3, 1.2, 0.12, 0.7, { color: 0xd2cbbd, top: [0.85, 0.7] }); }
      B.pop();
    }
    // roofed gate room on top (timber frame on a stone base), hip roof
    {
      const rw = 6.2, rd = 5.6, yb = top + 0.08, rh = 2.6, R = V.rng(919);
      B.boxY(M.stone, 0, yb, 0, rw, 0.8, rd, { color: tone2, skip: 'b' });
      const sides = [{ x: 0, z: rd / 2, ry: 0, len: rw }, { x: 0, z: -rd / 2, ry: Math.PI, len: rw }, { x: rw / 2, z: 0, ry: Math.PI / 2, len: rd - 0.56 }, { x: -rw / 2, z: 0, ry: -Math.PI / 2, len: rd - 0.56 }];
      for (const S of sides) {
        const ops = S.len > 5 ? [{ x: -1.4, w: 0.7, y0: 0.7, y1: 1.7 }, { x: 1.4, w: 0.7, y0: 0.7, y1: 1.7 }] : [{ x: 0, w: 0.7, y0: 0.7, y1: 1.7 }];
        B.push(S.x, yb + 0.8, S.z, S.ry);
        A.wall(B, M.plaster, S.len, rh, 0.28, ops, { color: 0xe6dac4 });
        A.timber(B, M, S.len, rh, ops, { rng: R, color: tim });
        for (const op of ops) A.window(B, M, op, 0.28, { frame: tim, shutter: 0x5a3a32 });
        B.pop();
      }
      A.roof(B, M, { w: rw, d: rd, y: yb + 0.8 + rh, pitch: 46, hip: 0.6, mat: M.shingle, color: slate, thick: 0.16, oe: 0.55, og: 0.5, gable: { mat: M.plaster, color: 0xe6dac4, timber: true, timberColor: tim } });
    }
    // drum towers flanking the outer face
    const tR = 4.4, tX = bw + tR - 1.9, tZ = bd - 1.4, tH = 13.4;
    for (const sx of [-1, 1]) {
      F.roundTower(B, M, sx * tX, tZ, tR, tH, { seg: 20, tone, slate, phase: sx > 0 ? 0.3 : 2.4 });
      A.banner(B, M, sx * tX, 10.4, tZ + tR + 0.02, 0, 1.6, 4.4);
    }
    // gate doors opened back against the passage walls (inward), hinged 1.1 m inside the outer arch
    const hz = bd - 1.1, lw = pw;
    for (const sx of [-1, 1]) {
      const x = sx * (pw - 0.14), thk = 0.24;
      const prof = [];  // outline in (z, y): bottom edge from the hinge inward, then the arched top back to the hinge
      prof.push([hz, 0], [hz - lw, 0]);
      for (let k = 0; k <= 8; k++) { const s = lw * (1 - k / 8), xx = pw - s; prof.push([hz - s, spring + Math.sqrt(Math.max(0, ar * ar - (pw - s) * (pw - s))) * 0.98 - 0.08]); }
      const face = (xf, flip) => { let P = prof.map((q) => v3(xf, q[1], q[0])); if (flip) P = P.reverse(); B.poly(M.planks, P, { color: 0x4f3a2a, uv: 'local', grainY: false }); };
      // inner face (toward the passage centre) and outer face (against the wall)
      face(x - sx * thk / 2, sx > 0);
      face(x + sx * thk / 2, sx < 0);
      // top and free edges
      for (let k = 1; k < prof.length - 1; k++) {
        const p0 = prof[k], p1 = prof[k + 1];
        const q = [v3(x - thk / 2, p0[1], p0[0]), v3(x + thk / 2, p0[1], p0[0]), v3(x + thk / 2, p1[1], p1[0]), v3(x - thk / 2, p1[1], p1[0])];
        B.poly(M.planks, sx > 0 ? q.reverse() : q, { color: 0x45331f });
      }
      // iron straps + studs on the visible face
      const fx = x - sx * (thk / 2 + 0.012);
      for (const yy of [0.7, 2.2, 3.7]) { B.box(M.iron, fx, yy, hz - lw / 2, 0.02, 0.14, lw * 0.96, { color: V.PAL.iron }); }
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) B.box(M.iron, fx - sx * 0.01, 1.45 + r * 1.5 * 0.5 + (r > 1 ? 0.75 : 0), hz - 0.4 - c * (lw - 0.8) / 3, 0.03, 0.07, 0.07, { color: 0x2f3033 });
      B.box(M.iron, fx - sx * 0.02, 2.0, hz - lw + 0.35, 0.04, 0.3, 0.06, { color: 0x2f3033 });
    }
    // raised portcullis: only the spiked bottom shows under the crown
    const pz = bd - 0.55;
    for (let k = -5; k <= 5; k++) {
      const x = k * 0.4, yb2 = ay(x); if (yb2 - 6.35 < 0.1) continue;
      B.box(M.iron, x, (6.35 + yb2) / 2 + 0.05, pz, 0.08, yb2 - 6.35 + 0.1, 0.08, { color: 0x2c2d30 });
      B.cyl(M.iron, x, 6.12, pz, 0.005, 0.05, 0.24, 4, { color: 0x2c2d30, caps: '' });
    }
    B.box(M.iron, 0, 6.85, pz, 4.2, 0.09, 0.09, { color: 0x2c2d30 });
    // inner face details: small door to the tower stair, iron lanterns
    for (const sx of [-1, 1]) {
      B.push(sx * 3.9, 0, -bd, Math.PI);
      B.box(M.planks, 0, 1.05, -0.02, 0.95, 2.1, 0.06, { color: 0x4f3a2a });
      B.box(M.stone, 0, 2.25, 0.04, 1.35, 0.3, 0.12, { color: 0xe4dccd });
      B.pop();
      B.box(M.iron, sx * 2.3, 3.6, bd + 0.2, 0.05, 0.05, 0.3, { color: 0x2e2f31 });
      B.box(M.iron, sx * 2.3, 3.4, bd + 0.36, 0.22, 0.32, 0.22, { color: 0x34363a });
    }
    return { tX, tZ, tR, bw, bd, pw, hz, lw, top };
  };

  /* ------------------------------------------ whole perimeter ------------------------------------------ */
  F.build = function (B, M, col, cfg, reg) {
    const H = cfg.half, wt = cfg.wallThick, c = H + wt / 2, h = cfg.wallH;
    const ctR = 5.6, ctH = 12.4;
    const gate = { x: 0, z: c };
    const sides = [
      { id: 'S', ox: 0, oz: c, ry: 0 },
      { id: 'N', ox: 0, oz: -c, ry: Math.PI },
      { id: 'E', ox: c, oz: 0, ry: Math.PI / 2 },
      { id: 'W', ox: -c, oz: 0, ry: -Math.PI / 2 },
    ];
    // watchtowers: local x positions along E / W walls (local +x on E = world -z, on W = world +z)
    const wtE = 16, wtW = 10, wtS = 7.6;
    const segs = {
      S: [[-c + ctR * 0.6, -4.7], [4.7, c - ctR * 0.6]],
      N: [[-c + ctR * 0.6, c - ctR * 0.6]],
      E: [[-c + ctR * 0.6, wtE - wtS / 2 + 0.4], [wtE + wtS / 2 - 0.4, c - ctR * 0.6]],
      W: [[-c + ctR * 0.6, wtW - wtS / 2 + 0.4], [wtW + wtS / 2 - 0.4, c - ctR * 0.6]],
    };
    let seed = 100;
    for (const S of sides) {
      B.push(S.ox, 0, S.oz, S.ry);
      for (const sg of segs[S.id]) {
        F.curtain(B, M, sg[0], sg[1], cfg, { seed: seed++ });
        // collider (in world): body + footing + buttresses
        const cxl = (sg[0] + sg[1]) / 2, hl = (sg[1] - sg[0]) / 2;
        col.boxLocal(S.ox, S.oz, S.ry, cxl, 0.05, hl, wt / 2 + 1.0, h + 1.9, 'wall');
      }
      B.pop();
    }
    // wall stairs inside, either side of the gate (south wall local frame), and one by the north-east tower
    B.push(0, 0, c, 0);
    const run = 9.6;
    F.wallStair(B, M, 13.5, cfg, run);
    B.pop();
    // mirrored stair on the west side: build with a flipped direction (goes up toward -x)
    B.push(0, 0, c, 0);
    {
      const steps = Math.round(h / 0.3), rise = h / steps, dx = run / steps, wdt = 1.5, z = -wt / 2 - wdt / 2 - 0.02, xs = -13.5;
      for (let i = 0; i < steps; i++) B.boxY(M.flag, xs - i * dx - dx / 2, 0, z, dx, (i + 1) * rise, wdt, { color: i % 2 ? 0xd2cab9 : 0xcac2b1, skip: 'b' });
      B.quad(M.stone, v3(xs - run, 0, z - wdt / 2 - 0.001), v3(xs, 0, z - wdt / 2 - 0.001), v3(xs - dx, rise, z - wdt / 2 - 0.001), v3(xs - run, h, z - wdt / 2 - 0.001), { color: 0xd0c9bb });
    }
    B.pop();
    col.box(13.5 + run / 2, c - wt / 2 - 0.77, run / 2 + 0.1, 0.8, 0, h, 'stair');
    col.box(-13.5 - run / 2, c - wt / 2 - 0.77, run / 2 + 0.1, 0.8, 0, h, 'stair');

    // corner towers
    const corners = [[-c, -c], [c, -c], [c, c], [-c, c]];
    corners.forEach((p, i) => {
      F.roundTower(B, M, p[0], p[1], ctR, ctH, { seg: 22, phase: i * 1.3, tone: V.PAL.castle[i % 4] });
      col.circle(p[0], p[1], ctR + 0.95, ctH + 2, 'tower');
      reg.npc('guard_tower_' + i, 'guard', p[0] * 0.995, p[1] * 0.995, Math.atan2(p[0], p[1]), 'walls', 'Lookout on the corner tower top (elevated, y = ' + (ctH + 0.1).toFixed(1) + ' m)').position.y = ctH + 0.1;
    });
    // watchtowers on E and W walls, protruding outward
    const wtPlace = [{ ox: c + 1.4, oz: -wtE, ry: Math.PI / 2, id: 'east' }, { ox: -c - 1.4, oz: wtW, ry: -Math.PI / 2, id: 'west' }];
    for (const P of wtPlace) {
      B.push(P.ox, 0, P.oz, P.ry);
      F.watchTower(B, M, wtS, 12.2, { tone: 0xd6d0c2 });
      B.pop();
      col.box(P.ox, P.oz, wtS / 2 + 0.8, wtS / 2 + 0.8, 0, 14.5, 'watchtower');
      reg.npc('guard_watch_' + P.id, 'guard', P.ox, P.oz, P.ry, 'walls', 'Watchtower gallery (elevated, y = 12.4 m)').position.y = 12.4;
    }
    // gatehouse
    B.push(0, 0, c, 0);
    const G = F.gatehouse(B, M, cfg);
    B.pop();
    for (const sx of [-1, 1]) {
      // piers (passage walls), with the opened door leaves inside the collider
      col.box(sx * (G.pw + G.bw) / 2, c, (G.bw - G.pw) / 2, G.bd, 0, G.top + 1.2, 'gate');
      col.box(sx * (G.pw - 0.2), c + G.hz - G.lw / 2, 0.2, G.lw / 2, 0, 7, 'gatedoor');
      col.circle(sx * G.tX, c + G.tZ, G.tR + 0.95, 14.5, 'gatetower');
    }
    reg.npc('guard_gate_out_w', 'guard', -4.2, c + G.bd + 2.0, 0, 'gate', 'Outside the gate, west side, facing the road');
    reg.npc('guard_gate_out_e', 'guard', 4.2, c + G.bd + 2.0, 0, 'gate', 'Outside the gate, east side, facing the road');
    reg.npc('guard_gate_in_w', 'guard', -4.0, c - G.bd - 1.6, Math.PI, 'gate', 'Inside the gate, west side');
    reg.npc('guard_gate_in_e', 'guard', 4.0, c - G.bd - 1.6, Math.PI, 'gate', 'Inside the gate, east side');
    reg.npc('guard_gate_top', 'guard', 0, c + G.bd - 0.6, 0, 'gate', 'Gate parapet (elevated, y = ' + (G.top + 0.1).toFixed(1) + ' m)').position.y = G.top + 0.1;
    // banners hung from the outer parapet beside the gate and on the inner face
    B.push(0, 0, c, 0);
    for (const x of [-22, 22]) A.banner(B, M, x, h + 0.2, wt / 2 + 0.32, 0, 1.4, 3.6);
    B.pop();
    B.push(0, 0, c - G.bd, Math.PI);
    A.banner(B, M, 0, 10.0, 0.1, 0, 1.6, 2.6);
    B.pop();
    return { gate, gateInfo: G, c, ctR, ctH };
  };
})();
