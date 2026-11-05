/* =====================================================================================================
 *  village/scene.js  -  CastleVillageScene: layout + assembly + runtime (fade, LOD, sun, debug)
 *
 *  Layout (meters, +x east, +z south; the default camera looks north):
 *    spawn plaza (octagon, apothem 16) at the origin; keep + courtyard on the north; south gatehouse;
 *    market + tavern east of the plaza; healer + residential west / north-west around a well courtyard;
 *    blacksmith on the south road; training yard south-east; stable + storage courtyard south-west;
 *    residential + orchard north-east. Roads radiate from the plaza; the south road leaves through the gate
 *    and forks toward future hunting grounds.
 *  Anchors scale with CONFIG.half (vsize); buildings keep their real size.
 * ===================================================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const V = window.Village;
  const A = V.Arch, P = V.Props;
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const PI = Math.PI;

  V.create = function (ctx) {
    const t0 = performance.now();
    const { renderer, scene, camera } = ctx;
    const cfg = V.CONFIG, H = cfg.half, s = H / 75, wt = cfg.wallThick;
    const S = (x, z) => [x * s, z * s];
    const R = V.rng(cfg.seed);

    const X = V.buildTextures(renderer);
    const M = V.buildMaterials(X);
    const WORLD = V.World && V.World.on ? V.World : null;                 // world/*.js: the open world around the village (?wild=0 = village only)
    const FOREST = V.Forest && V.Forest.on ? V.Forest : null, ATMO = V.Atmosphere && V.Atmosphere.on ? V.Atmosphere : null;   // forest.js / atmosphere.js (?atmo=0 = old look)
    if (FOREST) FOREST.materials(M);
    const col = new V.Collision(8);
    const reg = V.Registry();
    const B = new V.Builder();
    const I = new V.Instancer(40);
    P.defineInstanced(I, M);
    if (FOREST) FOREST.define(I, M);                           // giant trees, ferns, glowing mushrooms, moss logs / boulders
    const group = new T.Group(); group.name = 'CastleVillage';
    const detail = [];

    /* ------------------------------------------ roads & open areas ------------------------------------------ */
    const c = H + wt / 2;
    const gateZ = c;
    const plazaA = 16, plazaRc = plazaA / Math.cos(PI / 8);
    const keepZ = -H + 12;                                     // keep main block centre
    const courtFront = keepZ + 23;                             // front wall of the keep courtyard
    const roads = [];
    const road = (pts, w, kind) => { roads.push({ pts, w, kind }); return pts; };
    const crossZ = gateZ + 41;
    const southOut = road([[0, H + 230], [0, crossZ], [0, gateZ + 6]], 6, 'cobble');
    road([[0, gateZ + 6], [0, gateZ - 6], [0, plazaA - 1]], 6, 'cobble');
    road([[0, -plazaA + 1], [0, courtFront + 1.5]], 6, 'cobble');
    const swOut = road([[0, crossZ], [-30, crossZ + 16], [-72, crossZ + 46], [-125, crossZ + 92]], 4.4, 'dirt');   // world: ends in the farm yard (it used to run on into the carrot field at (-190, 268))
    const seOut = road([[0, crossZ], [32, crossZ + 13], [68, crossZ + 33], [115, crossZ + 72], [175, crossZ + 125]], 4.4, 'dirt');
    road([[plazaA - 1, 0], S(36, 0), S(52, -1), S(66, -12), [H - 3, -16 * s]], 5, 'cobble');            // east road: market -> east watchtower
    road([[-plazaA + 1, 0], S(-30, 1), S(-47, 1.5), S(-66, 7), [-H + 3, 10 * s]], 5, 'cobble');       // west road: residential -> west watchtower
    road([[-11, -11], S(-20, -20), S(-31, -30), S(-42, -40)], 3.6, 'dirt');                              // NW lane to the well courtyard
    road([S(-42, -40), S(-50, -48), S(-52, -66)], 3.0, 'path');
    road([S(-47, 1.5), S(-45, -18), S(-42, -40)], 3.2, 'dirt');                                           // residential north-south lane
    road([S(-47, 1.5), S(-50, 22), S(-56, 34), S(-56, 44)], 3.2, 'dirt');                                 // to the storage courtyard
    road([[3, 44 * s], S(-22, 43.5), S(-40, 44)], 4.2, 'dirt');                                           // south-west lane (main road -> storage / stable)
    road([[11, 11], S(21, 21), S(28.5, 29.5)], 3.8, 'dirt');                                             // south-east lane to the training yard
    road([S(50, -1), S(51, -20), S(47, -44), S(41, -62)], 3.4, 'dirt');                                  // north-east lane
    const areas = [];   // paved / earth open areas (no grass tufts)
    const area = (kind, cx, cz, w, d, rot, round) => { areas.push({ kind, cx, cz, w, d, rot: rot || 0, round }); };
    area('cob', 0, gateZ - 10, 28, 13, 0, 1.5);                       // gate square
    area('cob', ...S(37, -2), 31, 22, 0, 3);                          // market square
    area('pave', 0, courtFront - 6.5, 38, 13, 0, 0.5);                // keep courtyard
    area('dirt', ...S(48, 44), 41, 39, 0, 2);                         // training yard
    area('dirt', ...S(-45, 52), 27, 21, 0, 3);                        // storage courtyard
    area('pave', ...S(-42, -40), 15, 15, 0.12, 7);                    // well courtyard (round)
    area('dirt', ...S(9, 34), 10, 11, 0, 1.5);                        // forge yard
    area('dirt', ...S(-12, 56), 15, 18, 0, 2);                        // paddock

    const terrain = V.Terrain(cfg, [southOut.slice(0, 2), swOut, seOut]);
    const walk = terrain.walk;
    const region = { minX: walk.minX - 34, maxX: walk.maxX + 34, minZ: walk.minZ - 34, maxZ: H + 250 };
    const SP = new V.Splat(region, 0.2, 0.4);
    for (const r of roads) SP.road(r.pts, r.w, r.kind);
    for (const a of areas) {
      if (a.kind === 'cob') { SP.rect('dirt', a.cx, a.cz, a.w + 2, a.d + 2, a.rot, { blur: 1.0, alpha: 0.7, round: a.round + 1 }); SP.rect('cob', a.cx, a.cz, a.w, a.d, a.rot, { blur: 0.3, round: a.round }); }
      else if (a.kind === 'pave') { if (a.round > 5) { SP.circle('dirt', a.cx, a.cz, a.w / 2 + 1.2, { blur: 0.8, alpha: 0.6 }); SP.circle('pave', a.cx, a.cz, a.w / 2, { blur: 0.2 }); } else { SP.rect('dirt', a.cx, a.cz, a.w + 1.5, a.d + 1.5, a.rot, { blur: 0.8, alpha: 0.6 }); SP.rect('pave', a.cx, a.cz, a.w, a.d, a.rot, { blur: 0.15 }); } }
      else { SP.rect('dirt', a.cx, a.cz, a.w, a.d, a.rot, { blur: 0.8, round: a.round }); }
    }
    // plaza underlay + worn ring
    {
      const oct = []; for (let k = 0; k < 8; k++) { const a = PI / 8 + k * PI / 4; oct.push([Math.cos(a) * (plazaRc + 1.2), Math.sin(a) * (plazaRc + 1.2)]); }
      SP.poly('dirt', oct, { blur: 1.0, alpha: 0.8 });
      SP.circle('ao', 0, 0, 3.4, { blur: 1.2, dark: 0.3 });
    }
    const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; const t = L2 ? V.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1) : 0; return [Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t), a[0] + dx * t, a[1] + dz * t]; };
    function roadClear(x, z, margin) {
      for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) if (segDist(x, z, r.pts[i], r.pts[i + 1])[0] < r.w / 2 + margin) return false;
      for (const a of areas) { const dx = x - a.cx, dz = z - a.cz, cs = Math.cos(a.rot), sn = Math.sin(a.rot); const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; if (Math.abs(lx) < a.w / 2 + margin && Math.abs(lz) < a.d / 2 + margin) return false; }
      if (Math.hypot(x, z) < plazaRc + margin + 0.5) return false;
      return true;
    }
    function nearestRoad(x, z) {
      let best = null;
      for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) { const d = segDist(x, z, r.pts[i], r.pts[i + 1]); if (!best || d[0] < best[0]) best = [d[0] - r.w / 2, d[1], d[2]]; }
      return best;
    }

    /* ------------------------------------------ helpers ------------------------------------------ */
    const W = (x, z, ry, lx, lz) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)];
    const buildings = [];
    // ground treatment around a footprint: worn earth halo, contact shadow, stone apron + footpath at the door
    function groundAround(x, z, ry, w, d, doorLocal, opt) {
      opt = opt || {};
      SP.rect('dirt', x, z, w + 1.8, d + 1.8, ry, { blur: 0.7, alpha: 0.55 });
      SP.rect('ao', x, z, w + 0.5, d + 0.5, ry, { blur: 1.1, dark: 0.5 });
      if (doorLocal) {
        const [dx, dz] = W(x, z, ry, doorLocal[0], doorLocal[1] + 0.7);
        SP.rect('pave', dx, dz, 1.9, 1.3, ry, { blur: 0.12 });
        if (!opt.noPath) {
          const nr = nearestRoad(dx, dz);
          if (nr && nr[0] > 0.6 && nr[0] < 28) SP.line('dirt', [[dx, dz], [nr[1], nr[2]]], 1.5, { blur: 0.4, alpha: 0.9 });
        }
      }
    }
    function house(x, z, ry, spec, extra) {
      B.push(x, 0, z, ry);
      const info = A.house(B, M, spec);
      if (extra) extra(info);
      B.pop();
      col.boxLocal(x, z, ry, 0, 0, info.w / 2 + 0.22, info.d / 2 + 0.22, info.ridgeY, 'building');
      if (spec.chimney === 'gable-r' || spec.chimney === 'gable-l') col.boxLocal(x, z, ry, (spec.chimney === 'gable-r' ? 1 : -1) * (info.w / 2 + 0.36), spec.chimneyZ || 0, 0.8, 0.6, info.ridgeY, 'building');
      const door = info.doors[0];
      groundAround(x, z, ry, info.w, info.d, door ? [door.x, door.z] : null, { noPath: spec.noPath });
      const rec = { x, z, ry, info, spec, door: door ? W(x, z, ry, door.x, door.z + 1.2) : null };
      buildings.push(rec);
      return rec;
    }
    const scatter = (kind, x, z, n, rad, sc, colr) => { for (let k = 0; k < n; k++) { const a = R() * PI * 2, r = Math.sqrt(R()) * rad; I.add(kind, x + Math.cos(a) * r, 0, z + Math.sin(a) * r, R() * PI * 2, sc * (0.8 + R() * 0.4), colr); } };
    const barrelCluster = (x, z, n, rot) => {
      const pts = [[0, 0], [0.68, 0.05], [0.32, 0.6], [-0.36, 0.55], [1.0, 0.65], [-0.66, -0.05]];
      for (let k = 0; k < Math.min(n, pts.length); k++) { const p = W(x, z, rot || 0, pts[k][0], pts[k][1]); I.add('barrel', p[0], 0, p[1], R() * 6, 1, [0xffffff, 0xe8e0d8, 0xd8d0c8][k % 3]); }
      col.circle(x + 0.2, z + 0.3, 0.9, 1, 'props');
    };
    const crateStack = (x, z, rot, n) => {
      const p0 = W(x, z, rot, 0, 0), p1 = W(x, z, rot, 0.74, 0.02), p2 = W(x, z, rot, 0.3, 0.05);
      I.add('crate', p0[0], 0, p0[1], rot + 0.05, 1); if (n > 1) I.add('crate', p1[0], 0, p1[1], rot - 0.08, 0.95);
      if (n > 2) I.add('crate', p2[0], 0.7, p2[1], rot + 0.3, 0.85);
      col.circle(...W(x, z, rot, 0.37, 0), 0.85, 1.4, 'props');
    };

    /* ------------------------------------------ fortifications ------------------------------------------ */
    const fort = V.Fort.build(B, M, col, cfg, reg);

    /* ------------------------------------------ plaza + waystone ------------------------------------------ */
    const plaza = V.buildPlaza(plazaA, 2.9);
    group.add(plaza.mesh);
    {
      for (const [r, h, y0] of [[2.75, 0.2, 0], [2.2, 0.2, 0.2], [1.62, 0.22, 0.4]]) {
        B.cyl(M.flag, 0, y0, 0, r, r, h, 8, { phase: PI / 8, flat: true, color: 0xd8d0c0, caps: 't' });
      }
      // tapered standing stone with carved panels, pyramidion and an iron ring crown
      B.cyl(M.stone, 0, 0.62, 0, 0.62, 0.44, 3.3, 4, { phase: PI / 4, flat: true, color: 0xe2d9c8, caps: '' });
      B.cyl(M.stone, 0, 3.92, 0, 0.46, 0.46, 0.18, 4, { phase: PI / 4, flat: true, color: 0xd6cdbc });
      B.cyl(M.stone, 0, 4.1, 0, 0.44, 0.02, 0.62, 4, { phase: PI / 4, flat: true, color: 0xe2d9c8, caps: '' });
      for (let f = 0; f < 4; f++) {
        B.push(0, 0, 0, f * PI / 2);
        const fz = (y) => 0.438 - 0.0385 * (y - 0.62) + 0.006;
        B.quad(M.stone, v3(-0.27, 1.3, fz(1.3)), v3(0.27, 1.3, fz(1.3)), v3(0.22, 3.0, fz(3.0)), v3(-0.22, 3.0, fz(3.0)), { color: 0xa79f90 });
        // simple relief: tower + star, as on the banners
        B.box(M.stone, 0, 2.15, fz(2.15) + 0.015, 0.2, 0.42, 0.04, { color: 0xe4dccb, rx: 0.038 });
        for (let k = 0; k < 3; k++) B.box(M.stone, -0.07 + k * 0.07, 2.4, fz(2.4) + 0.015, 0.045, 0.08, 0.04, { color: 0xe4dccb, rx: 0.038 });
        B.box(M.stone, 0, 1.65, fz(1.65) + 0.012, 0.12, 0.12, 0.03, { color: 0xe4dccb, rz: PI / 4 });
        B.pop();
      }
      for (let k = 0; k < 16; k++) { const a0 = k / 16 * PI * 2, a1 = (k + 1) / 16 * PI * 2; B.beam(M.iron, v3(Math.cos(a0) * 0.42, 4.55, Math.sin(a0) * 0.42), v3(Math.cos(a1) * 0.42, 4.55, Math.sin(a1) * 0.42), 0.05, 0.05, { color: 0x3a3a36 }); }
      B.cyl(M.iron, 0, 4.66, 0, 0.035, 0.02, 0.5, 6, { color: 0x3a3a36 });
      col.circle(0, 0, 2.8, 4.6, 'waystone');
      reg.waypoint = { id: 'waystone_central', position: v3(0, 0, 0), radius: 3.2, note: 'Central waystone: bind / teleport point' };
      // ring of furniture between the eight radial routes
      const items = { '-22.5': 'bench', '-67.5': 'lamp', '-112.5': 'lamp', '-157.5': 'bench', '157.5': 'planter', '112.5': 'lamp', '67.5': 'lamp', '22.5': 'planter' };
      for (const k in items) {
        const th = +k * PI / 180, r = 13.6, x = Math.cos(th) * r, z = Math.sin(th) * r;
        if (items[k] === 'bench') { P.bench(B, M, x, z, -th - PI / 2, 2.2); col.box(x, z, 1.15, 0.3, -th - PI / 2, 0.5, 'props'); }
        else if (items[k] === 'lamp') { P.lamp(B, M, x, z, 3.2); col.circle(x, z, 0.3, 3, 'props'); }
        else { P.planter(B, M, I, x, z, 0.95); I.add('linden', x, 0.5, z, R() * 6, 0.62, 0xe8f0e0); col.circle(x, z, 1.0, 4, 'props'); }
      }
      // quest notice board at the north-east edge, facing the plaza
      const nb = [9.6, -10.8], nry = Math.atan2(-nb[0], -nb[1]);
      P.noticeBoard(B, M, nb[0], nb[1], nry);
      col.box(nb[0], nb[1], 1.15, 0.25, nry, 3, 'props');
      reg.npc('quest_giver', 'quest_giver', ...W(nb[0], nb[1], nry, 1.8, 0.9), nry, 'plaza', 'Beside the notice board; quests are not implemented yet');
    }
    reg.spawn('plaza', 0, 7.5, PI, 'Default spawn: south of the waystone, facing north toward the keep');
    reg.spawn('gate_inner', 0, gateZ - 12, PI, 'Arrival from the south road, inside the gate');
    reg.spawn('gate_outer', 0, gateZ + 14, PI, 'Outside the gate (return point from the hunting grounds)');

    /* ------------------------------------------ keep + courtyard ------------------------------------------ */
    {
      B.push(0, 0, keepZ, 0);
      const K = A.keep(B, M);
      B.pop();
      for (const c2 of K.colliders) col.box(c2[0], keepZ + c2[1], c2[2], c2[3], 0, K.ridgeY, 'keep');
      SP.rect('ao', 0, keepZ, 20, 16, 0, { blur: 1.6, dark: 0.55 });
      SP.rect('dirt', 0, keepZ, 21, 17, 0, { blur: 1.0, alpha: 0.6 });
      // courtyard enclosure: low rubble walls with stone coping, gate piers with iron lanterns
      const cw = 20, cz0 = courtFront, gap = 3.6;
      const lowWall = (x0, z0, x1, z1) => {
        const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) - PI / 2, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        B.box(M.rubble, mx, 0.7, mz, L, 1.4, 0.6, { ry, color: 0xc8c0b0, skip: 'b' });
        B.box(M.stone, mx, 1.47, mz, L + 0.1, 0.14, 0.76, { ry, color: 0xd8d0c0 });
        col.box(mx, mz, L / 2, 0.38, ry, 1.5, 'lowwall');
        SP.line('ao', [[x0, z0], [x1, z1]], 1.6, { blur: 0.6, dark: 0.35 });
      };
      lowWall(-cw, cz0, -gap, cz0); lowWall(gap, cz0, cw, cz0);
      lowWall(-cw, cz0, -cw, -H - 0.2); lowWall(cw, cz0, cw, -H - 0.2);
      for (const sx of [-1, 1]) {
        B.boxY(M.stone, sx * gap, 0, cz0, 0.9, 2.5, 0.9, { color: 0xd6cebd, skip: 'b' });
        B.boxY(M.stone, sx * gap, 2.5, cz0, 1.05, 0.16, 1.05, { color: 0xccc3b2 });
        B.boxY(M.iron, sx * gap, 2.66, cz0, 0.32, 0.42, 0.32, { color: 0x34363a });
        B.boxY(M.glass, sx * gap, 2.7, cz0, 0.26, 0.32, 0.26, { color: 0xb0a080 });
        col.box(sx * gap, cz0, 0.5, 0.5, 0, 2.6, 'lowwall');
        // braziers and benches flanking the stair foot
        P.brazier(B, M, sx * 4.4, keepZ + 14.0); col.circle(sx * 4.4, keepZ + 14.0, 0.45, 1.1, 'props');
        P.bench(B, M, sx * 13.5, cz0 - 5.5, PI / 2, 2.0); col.box(sx * 13.5, cz0 - 5.5, 0.3, 1.05, 0, 0.5, 'props');
        P.planter(B, M, I, sx * 9.5, cz0 - 2.2, 0.9); I.add('linden', sx * 9.5, 0.5, cz0 - 2.2, sx, 0.68, 0xe8f0e0); col.circle(sx * 9.5, cz0 - 2.2, 1.0, 4, 'props');
        // tall banner poles at the courtyard gate
        B.cyl(M.wood, sx * 5.4, 0, cz0 - 0.9, 0.09, 0.07, 6.2, 8, { color: 0x5e4a3a });
        B.cyl(M.iron, sx * 5.4, 6.2, cz0 - 0.9, 0.1, 0.0, 0.3, 6, { color: 0x34363a });
        A.banner(B, M, sx * 5.4, 5.9, cz0 - 0.9 + 0.02, 0, 1.0, 3.0);
        col.circle(sx * 5.4, cz0 - 0.9, 0.25, 6, 'props');
      }
      P.weaponRack(B, M, -15.5, cz0 - 10.5, PI / 2); col.box(-15.5, cz0 - 10.5, 0.5, 1.3, PI / 2, 2, 'props');
      barrelCluster(16.0, cz0 - 11.5, 3, 0.4);
      // side gardens of the keep: hedges + trees (walkable around, enclosed by the courtyard walls)
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 4; k++) I.add('bush', sx * (16.5 + R()), 0, keepZ - 6 + k * 3.6, R() * 6, 1.1 + R() * 0.3, 0xe0e8d8);
        I.add('oak', sx * 16.8, 0, keepZ - 10.5, R() * 6, 0.8, 0xe8f0e0); col.circle(sx * 16.8, keepZ - 10.5, 0.45, 5, 'tree');
      }
      reg.npc('guard_keep_l', 'guard', -3.2, keepZ + K.stairEnd + 1.2, 0, 'keep', 'Keep stair foot, west');
      reg.npc('guard_keep_r', 'guard', 3.2, keepZ + K.stairEnd + 1.2, 0, 'keep', 'Keep stair foot, east');
      reg.npc('guard_court_gate', 'guard', -2.2, cz0 + 1.6, 0, 'keep', 'Courtyard gate');
      reg.npc('steward', 'steward', 6.5, cz0 - 6.0, -PI / 2, 'keep', 'Keep steward (optional role)');
    }

    /* ------------------------------------------ market + tavern (east) ------------------------------------------ */
    {
      const st = [[27, -7.2, 0, 'produce', 0], [35.6, -7.6, 0, 'baker', 3], [44.2, -7.2, 0, 'cloth', 1], [31.2, 7.4, PI, 'potter', 2], [40.4, 7.6, PI, 'herbs', 4]];
      for (const [x0, z0, ry, kind, band] of st) {
        const [x, z] = S(x0, z0);
        P.stall(B, M, I, x, z, ry, kind, band);
        col.boxLocal(x, z, ry, 0, -0.05, 1.75, 1.1, 2.9, 'stall');
        SP.rect('ao', x, z, 3.6, 2.4, ry, { blur: 0.8, dark: 0.3 });
        reg.npc('merchant_' + kind, 'merchant', ...W(x, z, ry, 0.3, -0.35), ry, 'market', 'Behind the ' + kind + ' stall counter');
      }
      barrelCluster(...S(49.5, 4.5), 4, 0.3); crateStack(...S(22.8, 5.2), 0.2, 3);
      // tavern / inn
      const [tx, tz] = S(36, -25.5);
      const tav = house(tx, tz, 0, { seed: 501, w: 15.2, d: 9.6, plinth: 0.4,
        floors: [{ h: 3.3, wall: 'stone' }, { h: 2.85, wall: 'timber', jetty: 0.5, jettySides: true }],
        roof: { pitch: 50, mat: 'shingle', sag: 0.05, color: 0x7a6656 }, chimney: 'gable-l', door: { x: 0, w: 1.9, h: 2.45, double: true },
        dormers: [-4.6, 0, 4.6], plaster: 0xeee2c8, timber: 0x4f3d2e, shutter: 0x6a3a32, flowers: 0.8, noPath: true }, (info) => {
        A.chimney(B, M, 4.2, -1.2, info.ridgeY - 1.6, info.ridgeY + 0.9, { color: info.colors.foundC, pots: true });
        // pentice roof over the door on carved brackets
        A.shed(B, M, -2.0, 2.0, info.d / 2 - 0.4 + 0.05, info.d / 2 + 0.6, 3.15, 2.85, { color: 0x6e5c4c, thick: 0.08 });
        for (const sx of [-1, 1]) B.beam(M.wood, v3(sx * 1.7, 2.3, 4.75), v3(sx * 1.7, 2.85, 5.5), 0.1, 0.1, { color: 0x4f3d2e });
        P.hangingSign(B, M, 2.6, 3.7, info.d / 2 + 0.55, 0, 'mug');
      });
      SP.rect('pave', tx, tz + 8.6, 15.5, 6.6, 0, { blur: 0.15 });
      reg.npc('innkeeper', 'innkeeper', tav.door[0], tav.door[1] + 0.4, 0, 'market', 'Tavern door');
      // outdoor seating under a trellis
      for (const [lx, lz] of [[-4.6, 6.9], [0, 8.4], [4.6, 6.9]]) {
        P.table(B, M, tx + lx, tz + lz + 0.6, 0, 1.9, { mugs: 3 });
        col.box(tx + lx, tz + lz + 0.6, 1.0, 0.95, 0, 0.8, 'props');
      }
      for (const sx of [-1, 1]) { B.boxY(M.wood, tx + sx * 7.0, 0, tz + 9.6, 0.14, 2.6, 0.14, { color: 0x4f3d2e }); col.circle(tx + sx * 7.0, tz + 9.6, 0.2, 2.6, 'props'); }
      for (let k = 0; k < 9; k++) B.box(M.wood, tx - 7 + k * 1.75, 2.62, tz + 7.6, 0.1, 0.1, 4.2, { color: 0x4f3d2e });
      B.box(M.wood, tx, 2.55, tz + 9.6, 14.3, 0.12, 0.14, { color: 0x4f3d2e });
      for (let k = 0; k < 16; k++) I.add('bush', tx - 6.9 + k * 0.92, 2.55, tz + 7.6 + (k % 3 - 1) * 1.1, k * 1.7, [0.62, 0.22, 0.75], 0xd0e0c0);
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) I.add('bush', tx + sx * 7.0, 0.5 + k * 0.75, tz + 9.6, k, [0.32, 0.55, 0.32], 0xd8e4c8);
      barrelCluster(tx + 9.2, tz + 2.6, 5, 0.2);
      crateStack(tx - 9.4, tz + 1.2, -0.1, 3);
      P.woodpile(B, M, tx - 9.2, tz - 2.6, PI / 2, 2.6, 4, { roof: true, seed: 7 }); col.box(tx - 9.2, tz - 2.6, 0.6, 1.4, 0, 1.2, 'props');
    }

    /* ------------------------------------------ healer (north-west of the plaza) ------------------------------------------ */
    {
      const [hx, hz] = S(-33, -22.5);
      const ry = 1.02;
      const he = house(hx, hz, ry, { seed: 601, w: 7.8, d: 5.6, floors: [{ h: 2.9, wall: 'timber' }], roof: { pitch: 53, mat: 'thatch', hip: 0.35, sag: 0.08 }, chimney: 'gable-r', door: { x: -1.2 }, plaster: 0xeae4d4, shutter: 0x55654e, attic: true }, (info) => {
        P.hangingSign(B, M, -2.3, 2.75, info.d / 2 + 0.05, 0, 'leaf');
      });
      // herb planters + drying rack in front
      const bed = (lx, lz, w, d, sd) => { const [bx, bz] = W(hx, hz, ry, lx, lz); P.herbBed(B, M, I, bx, bz, ry, w, d, sd); col.boxLocal(hx, hz, ry, lx, lz, w / 2 + 0.05, d / 2 + 0.05, 0.6, 'props'); };
      bed(1.6, 5.0, 2.4, 1.0, 11); bed(-2.6, 5.2, 2.0, 1.0, 12);
      { const [rx, rz] = W(hx, hz, ry, -5.4, 0.6); P.dryingRack(B, M, rx, rz, ry + PI / 2); col.boxLocal(hx, hz, ry, -5.4, 0.6, 0.5, 1.05, 2, 'props'); }
      { const [bx, bz] = W(hx, hz, ry, 2.6, 3.4); P.bench(B, M, bx, bz, ry, 1.6); col.boxLocal(hx, hz, ry, 2.6, 3.4, 0.85, 0.25, 0.5, 'props'); }
      reg.npc('healer', 'healer', he.door[0], he.door[1], ry, 'healer', 'In front of the healer cottage door, by the herb beds');
      const fpts = [[-4.4, 2.9], [-4.4, 6.3], [-1.2, 6.3]].map((p) => W(hx, hz, ry, p[0], p[1]));
      P.fence(B, M, col, fpts, { kind: 'wattle', h: 0.8, seed: 61 });
    }

    /* ------------------------------------------ residential: west road, well courtyard, north-east ------------------------------------------ */
    const homes = [];
    {
      // west road (north side faces south, south side faces north)
      homes.push(house(...S(-26.5, -10.8), 0, { seed: 11, w: 8.2, d: 6.2, floors: [{ h: 3.0, wall: 'rubble' }, { h: 2.7, wall: 'timber', jetty: 0.42 }], roof: { pitch: 52, mat: 'shingle', sag: 0.06 }, chimney: 'gable-r', door: { x: -1.5 }, flowers: 0.6 }));
      homes.push(house(...S(-56, -11.4), 0, { seed: 12, w: 11.6, d: 6.0, floors: [{ h: 3.05, wall: 'timber' }], roof: { pitch: 50, hip: 0.42, mat: 'thatch', sag: 0.12 }, chimney: 'ridge', chimneyX: 1.2, door: { x: 1.8 }, attic: false }, (info) => {
        // woodshed lean-to on the west gable
        A.shed(B, M, -info.w / 2 - 2.0, -info.w / 2 - 0.05, -1.6, 1.6, 2.6, 2.0, { color: 0x7c6a58 });
        for (const lz of [-1.5, 1.5]) B.boxY(M.wood, -info.w / 2 - 1.85, 0, lz, 0.14, 2.05, 0.14, { color: 0x5a4636 });
        P.woodpile(B, M, -info.w / 2 - 1.0, 0, PI / 2, 2.6, 4, { seed: 5 });
      }));
      col.boxLocal(...S(-56, -11.4), 0, -5.8 - 1.0, 0, 1.1, 1.8, 2.6, 'props');
      homes.push(house(...S(-34.5, 11.6), PI, { seed: 13, w: 7.4, d: 5.4, floors: [{ h: 2.8, wall: 'rubble' }], roof: { pitch: 54, mat: 'thatch', hip: 0.35, sag: 0.1 }, chimney: 'gable-l', door: { x: 0.9 } }));
      homes.push(house(...S(-58.5, 13.2), PI / 2, { seed: 14, w: 9.0, d: 6.2, floors: [{ h: 3.0, wall: 'stone' }, { h: 2.6, wall: 'timber', jetty: 0.35 }], roof: { pitch: 56, mat: 'tile', sag: 0.03 }, chimney: 'ridge', chimneyX: -1.6, door: { side: 'right', x: 0.6 }, attic: true }));
      // north-west well courtyard
      const [wx, wz] = S(-42, -40);
      P.well(B, M, wx, wz); col.circle(wx, wz, 1.45, 2.6, 'well');
      SP.circle('ao', wx, wz, 1.9, { blur: 0.6, dark: 0.4 });
      for (const a of [0.6, 2.3, 4.2]) { const bx = wx + Math.cos(a) * 5.4, bz = wz + Math.sin(a) * 5.4, bry = -a - PI / 2; P.bench(B, M, bx, bz, bry, 1.8); col.box(bx, bz, 0.95, 0.25, bry, 0.5, 'props'); }
      I.add('oak', wx + 5.2, 0, wz - 4.6, 1.2, 1.0, 0xffffff); col.circle(wx + 5.2, wz - 4.6, 0.5, 6, 'tree');
      homes.push(house(...S(-42.5, -53.2), 0, { seed: 15, w: 9.2, d: 6.3, floors: [{ h: 3.0, wall: 'rubble' }, { h: 2.7, wall: 'timber', jetty: 0.4 }], roof: { pitch: 50, mat: 'slate' }, chimney: 'gable-l', door: { x: 0.8 }, dormers: [-2.4, 2.4], flowers: 0.7 }, (info) => {
        // rear wing (L-plan) with its own cross gable
        B.push(2.4, 0, -info.d / 2 - 2.0, PI / 2);
        A.house(B, M, { seed: 151, w: 4.6, d: 4.4, plinth: 0.36, floors: [{ h: 2.9, wall: 'rubble' }], roof: { pitch: 50, mat: 'slate' }, chimney: null, door: null, shutter: null });
        B.pop();
      }));
      col.boxLocal(...S(-42.5, -53.2), 0, 2.4, -3.15 - 2.0, 2.45, 2.55, 7, 'building');
      homes.push(house(...S(-28.2, -41.6), -PI / 2, { seed: 16, w: 8.0, d: 5.6, floors: [{ h: 3.1, wall: 'stone' }], roof: { pitch: 46, hip: 0.55, mat: 'shingle', sag: 0.05 }, chimney: 'ridge', door: { x: -1.0 } }));
      homes.push(house(...S(-56.5, -37.4), PI / 2, { seed: 17, w: 8.0, d: 6.0, floors: [{ h: 3.0, wall: 'rubble' }, { h: 2.6, wall: 'timber', jetty: 0.4 }], roof: { pitch: 48, mat: 'shingle', sag: 0.07 }, chimney: 'ridge', door: { x: 1.4 }, flowers: 0.8 }));
      // north-east
      homes.push(house(...S(31.5, -43.5), 0, { seed: 18, w: 8.6, d: 6.4, floors: [{ h: 3.0, wall: 'rubble' }, { h: 2.7, wall: 'timber', jetty: 0.4 }], roof: { pitch: 52, mat: 'tile' }, chimney: 'gable-r', door: { x: -1.6 }, dormers: [1.8] }));
      homes.push(house(...S(59.5, -37.5), -PI / 2, { seed: 19, w: 11.0, d: 5.8, floors: [{ h: 3.0, wall: 'timber' }], roof: { pitch: 49, hip: 0.45, mat: 'thatch', sag: 0.1 }, chimney: 'ridge', door: { x: -2.2 } }, (info) => {
        A.shed(B, M, info.w / 2 + 0.05, info.w / 2 + 2.2, -1.5, 1.5, 2.6, 2.0, { color: 0x7c6a58 });
        for (const lz of [-1.4, 1.4]) B.boxY(M.wood, info.w / 2 + 2.05, 0, lz, 0.14, 2.05, 0.14, { color: 0x5a4636 });
      }));
      col.boxLocal(...S(59.5, -37.5), -PI / 2, 5.5 + 1.1, 0, 1.15, 1.6, 2.6, 'props');
      homes.push(house(...S(29.5, -62), PI / 2, { seed: 20, w: 7.2, d: 5.3, floors: [{ h: 2.8, wall: 'rubble' }], roof: { pitch: 55, mat: 'thatch', sag: 0.1 }, chimney: 'gable-l', door: { x: 0.8 } }));
      // yards and gardens (picket fences on selected properties)
      const yard = (h, pts, gaps, kind) => P.fence(B, M, col, pts.map((p) => W(h.x, h.z, h.ry, p[0], p[1])), { kind: kind || 'picket', gaps, seed: h.spec.seed });
      yard(homes[0], [[-4.1, -3.4], [-4.1, -7.2], [4.1, -7.2], [4.1, -3.4]]);                                  // back garden (north)
      yard(homes[2], [[-3.8, -3.0], [-3.8, -8.4], [3.8, -8.4], [3.8, -3.0]], null, 'wattle');                 // cottage garden (south, toward camera)
      yard(homes[4], [[-4.6, 3.3], [-4.6, 6.0], [-1.0, 6.0]], null);
      yard(homes[7], [[-4.4, -3.5], [-4.4, -10.5], [4.4, -10.5], [4.4, -3.5]]);
      yard(homes[9], [[-3.6, 2.9], [-3.6, 8.5], [3.6, 8.5], [3.6, 2.9]], [[5.6 + 2.3, 5.6 + 4.9]], 'wattle');   // gate = the whole middle panel in front of the door
      // vegetable plots inside the yards
      const plot = (h, lx, lz, w, d, rows) => {
        const [px, pz] = W(h.x, h.z, h.ry, lx, lz);
        SP.rect('dirt', px, pz, w, d, h.ry, { blur: 0.2 });
        for (let r = 0; r < rows; r++) for (let k = 0; k < Math.floor(w / 0.6); k++) { const [cx2, cz2] = W(h.x, h.z, h.ry, lx - w / 2 + 0.3 + k * 0.6, lz - d / 2 + (r + 0.5) * d / rows); I.add('cabbage', cx2, 0, cz2, R() * 6, 0.9 + R() * 0.3, r % 2 ? 0xd8e8c8 : 0xffffff); }
      };
      plot(homes[0], -1.5, -5.3, 4.2, 2.6, 3); plot(homes[2], 0.5, -5.8, 5.0, 3.8, 4); plot(homes[7], 1.0, -7.0, 6.0, 5.0, 5); plot(homes[9], -2.0, 5.8, 2.6, 4.0, 4);
      for (const h of homes) {   // a woodpile or barrels beside selected homes, bushes against the walls
        const r = V.rng(h.spec.seed * 3);
        if (r() < 0.5) { const [bx, bz] = W(h.x, h.z, h.ry, -h.info.w / 2 - 0.9, h.info.d / 2 - 1.2); barrelCluster(bx, bz, 2, h.ry); }
        for (let k = 0; k < 3; k++) { const [bx, bz] = W(h.x, h.z, h.ry, (r() - 0.5) * h.info.w, h.info.d / 2 + 0.55); if (h.door && Math.hypot(bx - h.door[0], bz - h.door[1]) < 2.2) continue; I.add('bush', bx, 0, bz, r() * 6, 0.55 + r() * 0.3, 0xe8f0e0); }
      }
    }

    /* ------------------------------------------ blacksmith (south road, east side) ------------------------------------------ */
    {
      const [bx, bz] = S(16.5, 34), ry = -PI / 2;
      const bs = house(bx, bz, ry, { seed: 701, w: 9.6, d: 7.0, floors: [{ h: 3.4, wall: 'rubble' }], roof: { pitch: 40, mat: 'slate' }, chimney: null, door: { x: 2.6, w: 1.6, h: 2.3, double: true }, shutter: null }, (info) => {
        // open forge shed on the road side
        const z0 = info.d / 2, z1 = z0 + 5.0;
        A.shed(B, M, -info.w / 2 + 0.2, info.w / 2 - 0.2, z0 - 0.1, z1 + 0.4, 3.35, 2.45, { mat: M.shingle, color: 0x6a6e72 });
        for (const lx of [-info.w / 2 + 0.4, -1.0, info.w / 2 - 0.4]) B.boxY(M.wood, lx, 0, z1, 0.22, 2.55, 0.22, { color: 0x4f3d2e });
        B.box(M.wood, 0, 2.5, z1, info.w - 0.4, 0.2, 0.24, { color: 0x4f3d2e });
        for (const lx of [-info.w / 2 + 0.4, info.w / 2 - 0.4]) B.beam(M.wood, v3(lx, 1.8, z1), v3(lx, 2.45, z1 - 0.7), 0.12, 0.12, { color: 0x4f3d2e });
        P.forge(B, M, -2.0, z0 + 0.9, 0);
        P.worktable(B, M, 2.6, z0 + 0.7, 0);
        P.grindstone(B, M, 3.7, z1 - 1.6, 0.3);
        P.hangingSign(B, M, info.w / 2 - 0.2, 2.4, z1 - 0.1, PI / 2, 'anvil');
      });
      // shed contents (world colliders)
      col.boxLocal(bx, bz, ry, -2.0, 3.5 + 0.9, 1.15, 0.8, 5.8, 'forge');
      col.boxLocal(bx, bz, ry, -1.8, 3.5 + 2.6, 0.45, 0.45, 1, 'props');     // anvil
      col.boxLocal(bx, bz, ry, -3.4, 3.5 + 2.2, 0.45, 0.45, 0.7, 'props');   // quench tub
      col.boxLocal(bx, bz, ry, 2.6, 3.5 + 0.7, 1.05, 0.5, 1.8, 'props');     // worktable
      col.boxLocal(bx, bz, ry, 3.7, 3.5 + 3.4, 0.5, 0.35, 1, 'props');
      for (const lx of [-4.4, -1.0, 4.4]) col.boxLocal(bx, bz, ry, lx, 8.5, 0.15, 0.15, 2.5, 'props');
      SP.rect('ao', ...W(bx, bz, ry, 0, 6), 9.6, 5.0, ry, { blur: 0.8, dark: 0.3 });
      SP.rect('dirt', ...W(bx, bz, ry, 0, 6), 10, 6, ry, { blur: 0.3 });
      P.woodpile(B, M, ...W(bx, bz, ry, -5.6, -0.5), ry + PI / 2, 3.0, 5, { roof: true, seed: 9 }); col.boxLocal(bx, bz, ry, -5.6, -0.5, 0.6, 1.6, 1.4, 'props');
      barrelCluster(...W(bx, bz, ry, 5.6, 2.6), 3, ry);
      crateStack(...W(bx, bz, ry, 5.8, 0.4), ry, 2);
      reg.npc('blacksmith', 'blacksmith', ...W(bx, bz, ry, -1.0, 3.5 + 2.7), ry, 'service', 'At the anvil, facing the south road');
    }

    /* ------------------------------------------ training yard (south-east) ------------------------------------------ */
    const yard = { x0: 28 * s, x1: 68 * s, z0: 24 * s, z1: 64 * s };
    {
      const { x0, x1, z0, z1 } = yard;
      // practice fence with the entrance on the west side (z 27..33) and a back gate on the south
      P.fence(B, M, col, [[x0, z0 + 3.2], [x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0 + 9.5]], { kind: 'rail', seed: 81, gaps: [] });
      // dummies (interactive ones are created by the game; positions live in the registry)
      const T0 = [38 * s, 38 * s];                               // dev quick-start spawn
      const D = [[T0[0] + 2, T0[1] - 3.8], [47 * s, 30.8 * s], [54.5 * s, 35 * s], [61.5 * s, 30.8 * s]];
      for (const [dx, dz] of D) { reg.dummies.push({ x: dx, z: dz, yaw: 0 }); col.circle(dx, dz, 0.6, 0.3, 'dummy'); SP.circle('dirt', dx, dz, 1.6, { blur: 0.6 }); SP.circle('ao', dx, dz, 1.3, { blur: 0.8, dark: 0.35 }); }
      reg.spawn('training', T0[0], T0[1], PI - 0.5, 'Training yard: dev quick-start (?cls=); dummy #1 sits at +2/-3.8 like the old test arena');
      // archery range: the game camera looks north, so archers shoot north (up the screen) and always see the butts.
      // Shooting line on the south side, three lanes, butts 16 m ahead, a hay-bale backstop behind them that also
      // shields the melee dummies further north.
      const lineZ = 55.5 * s, tgtZ = 44 * s, lanes = [48 * s, 53.5 * s, 59 * s];
      reg.spawn('archery', 53.5 * s, lineZ + 0.9, PI, 'Archery range shooting line, facing the butts (north)');
      for (const tx of lanes) {
        const info = P.archeryTarget(B, M, tx, tgtZ, 0);
        reg.targets.push({ x: tx, z: tgtZ, yaw: 0, cy: info.cy, r: info.r });
        col.box(tx, tgtZ - 0.15, 0.7, 0.45, 0, 2.0, 'target');
        SP.circle('dirt', tx, tgtZ, 1.4, { blur: 0.5 });
        SP.line('dirt', [[tx, lineZ - 1], [tx, tgtZ + 1]], 1.2, { blur: 0.6, alpha: 0.5 });   // worn lanes
        SP.circle('dirt', tx, lineZ + 0.9, 1.1, { blur: 0.4 });                                  // trampled standing spot
      }
      for (let k = 0; k < 8; k++) { const hx = 45.5 * s + k * 2.05; I.add('hay', hx, 0, tgtZ - 3.2, (R() - 0.5) * 0.1, 1, 0xffffff); if (k % 4 !== 3) I.add('hay', hx + 0.5, 0.48, tgtZ - 3.2, (R() - 0.5) * 0.1, 1, 0xf0f0e8); }
      col.box(53.5 * s, tgtZ - 3.2, 8.3, 0.35, 0, 1.0, 'hay');
      for (const lx of [45.6 * s, 50.8 * s, 56.2 * s, 61.4 * s]) { B.boxY(M.wood, lx, 0, lineZ, 0.12, 0.9, 0.12, { color: 0x5e4a3a }); col.circle(lx, lineZ, 0.12, 0.9, 'props'); }
      B.box(M.dark, 53.5 * s, 0.8, lineZ, 15.8 * s, 0.025, 0.025, { color: 0x8a7a5a });   // rope along the line
      SP.line('pave', [[45 * s, lineZ - 0.6], [62 * s, lineZ - 0.6]], 0.35, { blur: 0.05 });
      // equipment along the north fence and by the entrance
      P.weaponRack(B, M, x0 + 3.2, z0 + 12.6, PI / 2); col.box(x0 + 3.2, z0 + 12.6, 0.5, 1.3, PI / 2, 2, 'props');
      P.bench(B, M, x0 + 2.0, z0 + 17.2, PI / 2, 2.0); col.box(x0 + 2.0, z0 + 17.2, 0.3, 1.05, 0, 0.5, 'props');
      for (const pz of [z0 + 27, z0 + 30.5]) { P.pell(B, M, x1 - 2.6, pz); col.circle(x1 - 2.6, pz, 0.25, 1.8, 'props'); }
      barrelCluster(x0 + 2.0, z1 - 2.4, 3, 0);
      crateStack(x1 - 2.2, z0 + 2.0, 0.3, 2);
      I.add('oak', x0 - 3.5, 0, z0 + 20.0, 2.0, 1.05, 0xffffff); col.circle(x0 - 3.5, z0 + 20.0, 0.5, 6, 'tree');
      I.add('oak', x1 + 3.0, 0, z0 + 6.0, 0.4, 0.95, 0xf0f8e8); col.circle(x1 + 3.0, z0 + 6.0, 0.5, 6, 'tree');
      for (let k = 0; k < 90; k++) { const x = x0 + 1 + R() * (x1 - x0 - 2), z = z0 + 1 + R() * (z1 - z0 - 2); if (R() < 0.6 && Math.abs(x - x0) > 4 && Math.abs(x - x1) > 4 && Math.abs(z - z0) > 4 && Math.abs(z - z1) > 4) continue; I.add('tuft', x, 0, z, R() * 6, 0.6 + R() * 0.5, 0xf4e2b0); }   // trampled straw-coloured tufts, mostly along the fences
      reg.npc('trainer', 'trainer', x0 + 3.6, z0 + 8.6, -PI / 2 + 0.4, 'training', 'Combat trainer at the yard entrance, between the rack and the dummies');
    }

    /* ------------------------------------------ stable + storage courtyard (south-west) ------------------------------------------ */
    {
      // stable: open front stalls facing west onto the courtyard
      const [sx, sz] = S(-25.5, 54), ry = -PI / 2, w = 16, d = 7.4;
      B.push(sx, 0, sz, ry);
      B.boxY(M.rubble, 0, 0, 0, w + 0.24, 0.3, d + 0.24, { color: 0xbfb6a6, skip: 'b' });
      const tim = 0x4f3d2e;
      for (const side of [{ x: 0, z: -d / 2, ry: PI, len: w }, { x: w / 2, z: 0, ry: PI / 2, len: d - 0.5 }, { x: -w / 2, z: 0, ry: -PI / 2, len: d - 0.5 }]) {
        B.push(side.x, 0.3, side.z, side.ry);
        A.wall(B, M.planks, side.len, 3.2, 0.25, side.len > 10 ? [{ x: -4, w: 0.7, y0: 1.6, y1: 2.3 }, { x: 4, w: 0.7, y0: 1.6, y1: 2.3 }] : [], { color: 0x7a634c });
        B.box(M.wood, 0, 0.1, 0.02, side.len, 0.2, 0.1, { color: tim });
        B.box(M.wood, 0, 3.1, 0.02, side.len, 0.2, 0.1, { color: tim });
        for (let k = -side.len / 2 + 0.1; k <= side.len / 2; k += side.len / Math.round(side.len / 2.6)) B.boxY(M.wood, k, 0, 0.02, 0.18, 3.2, 0.1, { color: tim });
        B.pop();
      }
      // front: posts, stall partitions, half doors, hay rack
      const nst = 6;
      for (let k = 0; k <= nst; k++) {
        const lx = -w / 2 + 0.1 + k * (w - 0.2) / nst;
        B.boxY(M.wood, lx, 0.3, d / 2 - 0.1, 0.22, 3.2, 0.22, { color: tim });
        if (k > 0 && k < nst) B.boxY(M.planks, lx, 0.3, 0, 0.1, 1.6, d - 0.6, { color: 0x6e5844 });
        if (k < nst) {
          const mx = lx + (w - 0.2) / nst / 2;
          if (k % 3 !== 1) B.boxY(M.planks, mx, 0.3, d / 2 - 0.12, (w - 0.2) / nst - 0.3, 1.2, 0.07, { color: 0x6a5240 });
          B.box(M.dark, mx, 1.9, -d / 2 + 0.6, (w - 0.2) / nst - 0.3, 2.6, 0.05, { color: 0x221c16 });
          B.boxY(M.straw, mx, 0.3, 0, (w - 0.2) / nst - 0.25, 0.08, d - 0.7, { color: 0xb8a070 });
        }
      }
      B.box(M.wood, 0, 3.35, d / 2 - 0.1, w + 0.2, 0.26, 0.26, { color: tim });
      A.roof(B, M, { w: w + 0.2, d: d + 0.2, y: 3.5, pitch: 48, hip: 0.45, mat: M.thatch, color: 0xc0a676, thick: 0.34, oe: 0.7, og: 0.5, sag: 0.12, ridge: 'roll', ridgeColor: 0x9c8a62, gable: { mat: M.planks, color: 0x7a634c, t: 0.25 } });
      P.hangingSign(B, M, w / 2 - 0.6, 2.9, d / 2 + 0.1, 0, 'horse');
      B.pop();
      col.boxLocal(sx, sz, ry, 0, 0, w / 2 + 0.25, d / 2 + 0.25, 8, 'building');
      groundAround(sx, sz, ry, w, d, null);
      SP.rect('dirt', ...W(sx, sz, ry, 0, d / 2 + 3), w + 2, 6, ry, { blur: 0.6 });
      P.trough(B, M, ...W(sx, sz, ry, -3, d / 2 + 1.6), ry); col.boxLocal(sx, sz, ry, -3, d / 2 + 1.6, 0.95, 0.35, 0.6, 'props');
      P.haystack(B, M, ...S(-14, 64), 2.0, 3.6); col.circle(...S(-14, 64), 2.1, 3.6, 'props');
      for (let k = 0; k < 4; k++) I.add('hay', ...W(sx, sz, ry, 5.6 + (k % 2) * 1.05, d / 2 + 1.2).slice(0, 1), (k > 1 ? 0.48 : 0), W(sx, sz, ry, 5.6 + (k % 2) * 1.05, d / 2 + 1.2)[1], ry, 1);
      col.boxLocal(sx, sz, ry, 6.1, d / 2 + 1.2, 1.1, 0.4, 1, 'props');
      // paddock east of the stable (toward the main road)
      const [px0, pz0, px1, pz1] = [-19 * s, 47 * s, -5 * s, 65 * s];
      P.fence(B, M, col, [[px0, pz0 + 4], [px0, pz0], [px1, pz0], [px1, pz1], [px0, pz1], [px0, pz1 - 4]], { kind: 'rail', seed: 91, gaps: [] });
      P.trough(B, M, (px0 + px1) / 2, pz0 + 1.2, 0); col.box((px0 + px1) / 2, pz0 + 1.2, 0.95, 0.35, 0, 0.6, 'props');
      reg.npc('stablehand', 'stablehand', ...W(sx, sz, ry, 2.6, d / 2 + 1.8), ry, 'stable', 'In front of the stalls (optional role)');
      // storage buildings
      const st1 = house(...S(-46, 37.2), 0, { seed: 801, w: 11.0, d: 7.0, floors: [{ h: 3.3, wall: 'stone' }, { h: 2.5, wall: 'timber' }], roof: { pitch: 44, mat: 'shingle', color: 0x6f6458 }, chimney: null, door: { x: -1.5, w: 2.4, h: 2.7, double: true }, shutter: null }, (info) => {
        // loading hoist: beam with pulley above an upper door
        B.box(M.wood, 2.4, 6.0, info.d / 2 + 0.6, 0.22, 0.22, 1.6, { color: 0x4f3d2e });
        B.cyl(M.wood, 2.4, 5.75, info.d / 2 + 1.25, 0.14, 0.14, 0.1, 10, { color: 0x5e4a3a });
        B.box(M.dark, 2.4, 4.5, info.d / 2 + 1.3, 0.025, 2.4, 0.025, { color: 0x7a6a50 });
        B.box(M.iron, 2.4, 3.3, info.d / 2 + 1.3, 0.12, 0.16, 0.05, { color: 0x34363a });
        B.box(M.planks, 2.4, 4.6, info.d / 2 + 0.02, 1.2, 1.6, 0.08, { color: 0x5a4232 });
      });
      const st2 = house(...S(-63.4, 53), PI / 2, { seed: 802, w: 10.4, d: 6.6, floors: [{ h: 3.7, wall: 'timber' }], roof: { pitch: 42, mat: 'shingle', sag: 0.08 }, chimney: null, door: { x: 0, w: 2.6, h: 2.9, double: true }, shutter: null, plaster: 0xd9cdb6 });
      // courtyard clutter: organised along the walls, not in the middle
      const [cx0, cz0] = S(-45, 52);
      crateStack(cx0 - 10.0, cz0 - 6.6, 0.1, 3); crateStack(cx0 - 10.2, cz0 - 4.6, -0.05, 2);
      barrelCluster(cx0 + 3.6, cz0 - 9.2, 5, 0.0);
      for (let k = 0; k < 5; k++) I.add('sack', cx0 - 9.6 + (k % 3) * 0.55, (k > 2 ? 0.45 : 0), cz0 + 3.6 + (k % 2) * 0.4, R() * 6, 1);
      col.circle(cx0 - 9.0, cz0 + 3.8, 1.0, 1.2, 'props');
      P.woodpile(B, M, cx0 + 0.5, cz0 + 9.4, 0, 3.6, 5, { roof: true, seed: 21 }); col.box(cx0 + 0.5, cz0 + 9.4, 2.0, 0.65, 0, 1.4, 'props');
      // supply wagon with cargo
      const wry = 0.5, [wgx, wgz] = [cx0 - 2.0, cz0 + 1.0];
      P.wagon(B, M, wgx, wgz, wry, { cover: true });
      col.boxLocal(wgx, wgz, wry, 0, 0.6, 1.05, 2.9, 2.2, 'wagon');
      { const p = W(wgx, wgz, wry, -0.35, -1.3); I.add('crate', p[0], 1.05, p[1], wry, 0.8); const p2 = W(wgx, wgz, wry, 0.35, -1.25); I.add('barrel', p2[0], 1.05, p2[1], 1, 0.85); const p3 = W(wgx, wgz, wry, 0, -0.5); I.add('sack', p3[0], 1.05, p3[1], 2, 0.9); }
      reg.npc('quartermaster', 'merchant', cx0 - 6.0, cz0 + 0.5, PI / 2, 'storage', 'Supply clerk by the wagon (optional role)');
      void st1; void st2;
    }

    /* ------------------------------------------ gate square + south road furniture ------------------------------------------ */
    {
      // guard shelter inside the gate
      const [gx, gz] = [10.5, gateZ - 11.5];
      B.push(gx, 0, gz, -PI / 2);
      B.boxY(M.rubble, 0, 0, 0, 3.4, 0.25, 2.6, { color: 0xbfb6a6 });
      for (const [lx, lz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) B.boxY(M.wood, lx, 0.25, lz, 0.18, 2.5, 0.18, { color: 0x4f3d2e });
      B.push(0, 0.25, -1.25, PI); A.wall(B, M.planks, 3.4, 2.3, 0.12, [], { color: 0x6e5844 }); B.pop();
      A.roof(B, M, { w: 3.6, d: 2.8, y: 2.75, pitch: 38, hip: 0, mat: M.shingle, color: 0x6a6e72, thick: 0.1, oe: 0.35, og: 0.3, gable: { mat: M.planks, color: 0x6e5844, t: 0.1 } });
      P.bench(B, M, 0, -0.6, 0, 2.6);
      B.pop();
      col.box(gx, gz, 1.45, 1.85, 0, 4, 'building');
      for (const sx of [-1, 1]) { P.lamp(B, M, sx * 5.2, gateZ - 8.5, 3.2); col.circle(sx * 5.2, gateZ - 8.5, 0.3, 3, 'props'); }
      barrelCluster(-11.5, gateZ - 9.0, 4, 0.6); crateStack(-12.0, gateZ - 12.4, 0.2, 3);
      // hitching rail
      B.boxY(M.wood, -8.6, 0, gateZ - 15, 0.14, 1.1, 0.14, { color: 0x5e4a3a }); B.boxY(M.wood, -8.6, 0, gateZ - 18.2, 0.14, 1.1, 0.14, { color: 0x5e4a3a });
      B.box(M.wood, -8.6, 1.0, gateZ - 16.6, 0.1, 0.1, 3.4, { color: 0x5e4a3a }); col.box(-8.6, gateZ - 16.6, 0.15, 1.7, 0, 1.1, 'props');
      // lamp posts along the south road
      for (let z = gateZ - 26; z > plazaA + 6; z -= 18) { const side = (Math.round(z) / 18) % 2 ? 1 : -1; P.lamp(B, M, side * 4.3, z, 3.1); col.circle(side * 4.3, z, 0.3, 3, 'props'); }
    }

    /* ------------------------------------------ north-east orchard + gardens ------------------------------------------ */
    {
      const [ox0, oz0, ox1, oz1] = [51 * s, -71 * s, 70 * s, -52 * s];
      P.fence(B, M, col, [[ox0, oz1 - 3], [ox0, oz0], [ox1, oz0], [ox1, oz1], [ox0 + 4, oz1]], { kind: 'wattle', h: 0.9, seed: 33 });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
        const tx = ox0 + 3.2 + i * 6.0 + (R() - 0.5), tz = oz0 + 2.8 + j * 4.6 + (R() - 0.5);
        I.add('fruit', tx, 0, tz, R() * 6, 0.9 + R() * 0.25, 0xffffff); col.circle(tx, tz, 0.3, 3, 'tree');
      }
      for (let k = 0; k < 6; k++) I.add('hay', ox1 - 2 - k * 0.3, 0, oz1 - 1.2 - k * 1.1, 0.2, [0.5, 0.25, 0.5], 0xe8dcc0);
      // beehive-like skeps + bench by the orchard gate
      for (let k = 0; k < 3; k++) { P.haystack(B, M, ox0 + 2.2 + k * 1.2, oz1 - 1.4, 0.38, 0.75); col.circle(ox0 + 2.2 + k * 1.2, oz1 - 1.4, 0.4, 0.8, 'props'); }
    }

    /* ------------------------------------------ outside the walls ------------------------------------------ */
    {
      const sp = [3.4, crossZ + 3.4];
      P.signpost(B, M, sp[0], sp[1], [PI * 0.8, -PI * 0.25, PI * 0.35]); col.circle(sp[0], sp[1], 0.2, 2.6, 'props');
      // milestone + roadside fence remnants + farm fields with haystacks
      B.boxY(M.stone, -4.0, 0, gateZ + 22, 0.5, 0.9, 0.35, { color: 0xcfc6b5, top: [0.8, 0.8] }); col.circle(-4.0, gateZ + 22, 0.4, 0.9, 'props');
      const field = (fx, fz, w, d, ry, crops) => {
        SP.rect('dirt', fx, fz, w, d, ry, { blur: 0.5, alpha: 0.85 });
        for (let r = 0; r < Math.floor(d / 1.1); r++) {
          SP.line('ao', [W(fx, fz, ry, -w / 2 + 0.4, -d / 2 + 0.55 + r * 1.1), W(fx, fz, ry, w / 2 - 0.4, -d / 2 + 0.55 + r * 1.1)], 0.35, { dark: 0.3, blur: 0.15 });
          if (crops) for (let k = 0; k < Math.floor(w / 0.9); k++) { if (R() < 0.15) continue; const p = W(fx, fz, ry, -w / 2 + 0.6 + k * 0.9, -d / 2 + 0.55 + r * 1.1); I.add('cabbage', p[0], 0, p[1], R() * 6, 0.9 + R() * 0.3, 0xe0ecc8); }
        }
        P.fence(B, M, col, [W(fx, fz, ry, -w / 2 - 0.6, -d / 2 - 0.6), W(fx, fz, ry, w / 2 + 0.6, -d / 2 - 0.6), W(fx, fz, ry, w / 2 + 0.6, d / 2 + 0.6), W(fx, fz, ry, -w / 2 - 0.6, d / 2 + 0.6), W(fx, fz, ry, -w / 2 - 0.6, -d / 2 + 2)], { kind: 'rail', seed: fx | 0 });
      };
      field(-30, gateZ + 34, 22, 14, 0.12, true);
      field(34, gateZ + 30, 18, 12, -0.1, true);
      field(-58, gateZ + 18, 16, 12, -0.25, false);
      P.haystack(B, M, -58, gateZ + 18, 2.4, 4.0); col.circle(-58, gateZ + 18, 2.5, 4, 'props');
      P.haystack(B, M, 54, gateZ + 52, 2.2, 3.6); col.circle(54, gateZ + 52, 2.3, 3.6, 'props');
      // hunting grounds south of the gate (creature camps are re-sited here by integrate.js): set dressing only
      const rocksAt = (x, z, n, rad, big) => { for (let k = 0; k < n; k++) { const a = R() * PI * 2, r = Math.sqrt(R()) * rad, sc = (big ? 1.2 : 0.5) + R() * (big ? 1.4 : 0.8); const rx = x + Math.cos(a) * r, rz = z + Math.sin(a) * r; I.add('rock', rx, -0.05, rz, R() * 6, sc, 0xffffff); if (sc > 0.9) col.circle(rx, rz, sc * 0.55, sc, 'rock'); } };
      {   // reedy pond (snakes)
        const [px, pz, pr] = [-58, 121, 4.6];
        SP.circle('dirt', px, pz, pr + 1.8, { blur: 1.0 }); SP.circle('ao', px, pz, pr + 0.8, { blur: 0.8, dark: 0.55 });
        const wg = new T.CircleGeometry(pr, 30); wg.rotateX(-PI / 2);
        { const p3 = wg.attributes.position; for (let i = 1; i < p3.count; i++) { const a = Math.atan2(p3.getZ(i), p3.getX(i)), k = 1 + 0.15 * Math.sin(a * 2 + 0.5) + 0.07 * Math.sin(a * 5); p3.setXYZ(i, p3.getX(i) * k, 0, p3.getZ(i) * k); } }
        B.geo(M.water, wg, new T.Matrix4().makeTranslation(px, 0.035, pz), { color: 0x34443f, cast: false });
        for (let k = 0; k < 60; k++) { const a = R() * PI * 2, r = pr * (1 + 0.15 * Math.sin(a * 2 + 0.5)) + R() * 1.6 - 0.3; I.add('tuft', px + Math.cos(a) * r, 0, pz + Math.sin(a) * r, R() * 6, [1.4, 3.6 + R() * 2, 1.4], 0xc8d0a0); }
        rocksAt(px, pz, 8, pr + 1.5, false);
        col.circle(px, pz, pr + 0.4, 0.3, 'pond');
      }
      {   // oak grove (boars)
        const [gx, gz] = [66, 120];
        if (!FOREST) for (let k = 0; k < 9; k++) { const a = k / 9 * PI * 2 + R() * 0.4, r = 6 + R() * 5, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r; if (x > walk.maxX - 2 || z > walk.maxZ - 2) continue; I.add('oak', x, 0, z, R() * 6, 0.9 + R() * 0.35, 0xe8eedc); col.circle(x, z, 0.5, 6, 'tree'); SP.circle('ao', x, z, 2.6, { blur: 1.4, dark: 0.25 }); }
        for (let k = 0; k < 5; k++) I.add('log', gx + (R() - 0.5) * 8, 0.14, gz + (R() - 0.5) * 8, R() * 6, [1.6, 1, 1], 0xd8d0c0);
        SP.circle('dirt', gx, gz, 7, { blur: 2.5, alpha: 0.5 });
      }
      {   // goblin camp: crude hide tents, fire pit, sharpened stakes, plunder
        const [cx4, cz4] = [83, 105];
        SP.circle('dirt', cx4, cz4, 8, { blur: 1.5 });
        for (const [a, r] of [[0.4, 4.2], [2.2, 4.6], [4.1, 4.0]]) {
          const tx = cx4 + Math.cos(a) * r, tz = cz4 + Math.sin(a) * r;
          B.cyl(M.burlap, tx, 0, tz, 1.7, 0.06, 2.5, 7, { color: 0x8a7458, caps: '', uvScale: 1.5 });
          for (let k = 0; k < 4; k++) { const b = k * PI / 2 + a; B.beam(M.wood, v3(tx + Math.cos(b) * 1.6, 0, tz + Math.sin(b) * 1.6), v3(tx, 2.85, tz), 0.06, 0.06, { color: 0x4a3a2c }); }
          B.push(tx, 0, tz, Math.atan2(cx4 - tx, cz4 - tz)); B.poly(M.dark, [v3(-0.45, 0.02, 1.62), v3(0.45, 0.02, 1.62), v3(0, 1.2, 1.15)], { color: 0x15110e }); B.pop();
          col.circle(tx, tz, 1.75, 2.6, 'tent');
        }
        for (let k = 0; k < 9; k++) { const a = k / 9 * PI * 2; I.add('rock', cx4 + Math.cos(a) * 0.95, -0.08, cz4 + Math.sin(a) * 0.95, a, 0.32, 0xb0a898); }
        for (let k = 0; k < 4; k++) B.beam(M.bark, v3(cx4 + Math.cos(k * 1.6) * 0.6, 0.05, cz4 + Math.sin(k * 1.6) * 0.6), v3(cx4 - Math.cos(k * 1.6) * 0.15, 0.35, cz4 - Math.sin(k * 1.6) * 0.15), 0.1, 0.1, { color: 0x3a2e24 });
        B.cyl(M.ember, cx4, 0.02, cz4, 0.55, 0.45, 0.06, 10, { color: 0x6a2a10 });
        col.circle(cx4, cz4, 1.2, 0.5, 'firepit');
        for (let k = 0; k < 11; k++) { const a = 2.6 + k * 0.17, r = 8.4; const sx = cx4 + Math.cos(a) * r, sz = cz4 + Math.sin(a) * r; B.beam(M.bark, v3(sx, 0, sz), v3(sx - Math.cos(a) * 0.5, 1.7 + (k % 3) * 0.25, sz - Math.sin(a) * 0.5), 0.14, 0.14, { color: 0x4e3e30 }); col.circle(sx, sz, 0.25, 1.8, 'stake'); }
        crateStack(cx4 + 5.2, cz4 - 3.2, 0.7, 3); barrelCluster(cx4 - 4.5, cz4 - 4.5, 2, 0.3);
      }
      rocksAt(-82, 104, 9, 9, true);                       // wolf steppe: weathered boulders
      if (!WORLD) {   // spikeback den: boulder mouth (legacy village hunting ground; in the open world the den is the boss_spike camp and this cluttered the gate exit)
        const [dx2, dz2] = [-9, 138];
        rocksAt(dx2 - 4, dz2 + 1, 6, 3, true); rocksAt(dx2 + 4, dz2 + 2, 5, 3, true);
        SP.circle('dirt', dx2, dz2, 5, { blur: 1.5 }); SP.circle('ao', dx2, dz2 + 2, 3, { blur: 1.5, dark: 0.5 });
      }
      for (let k = 0; k < 12; k++) { const a = R() * PI * 2, r = 2 + R() * 6; SP.circle('dirt', 18 + Math.cos(a) * r, 99 + Math.sin(a) * r, 0.45, { blur: 0.2 }); I.add('rock', 18 + Math.cos(a) * r, -0.2, 99 + Math.sin(a) * r, R() * 6, 0.3, 0x9a8a70); }   // warren burrows
      for (let k = 0; k < 120; k++) { const a = R() * PI * 2, r = Math.sqrt(R()) * 8; I.add('tuft', -17 + Math.cos(a) * r, 0, 105 + Math.sin(a) * r, R() * 6, [1.2, 1.8 + R(), 1.2], 0xe8e0b0); }   // rat meadow: tall grass

      // world transitions where the roads cross the walkable boundary
      const cross = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if ((a[1] - walk.maxZ) * (b[1] - walk.maxZ) <= 0 && Math.abs(a[0]) < walk.maxX && Math.abs(b[0]) < walk.maxX + 60) { const t = (walk.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, walk.maxZ]; } if ((Math.abs(a[0]) - walk.maxX) * (Math.abs(b[0]) - walk.maxX) <= 0) { const t = (walk.maxX - Math.abs(a[0])) / (Math.abs(b[0]) - Math.abs(a[0])); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } } return null; };
      const tr = [['south_road', southOut.slice().reverse()], ['southwest_road', swOut], ['southeast_road', seOut]];
      for (const [id, pts] of tr) { const p = cross(pts); if (p) reg.transitions.push({ id, center: v3(p[0], 0, p[1] - 3), radius: 4, target: 'hunting_grounds_' + id.split('_')[0], note: 'Placeholder exit trigger toward future hunting areas' }); }
    }

    /* ------------------------------------------ village life: gardens, green, sheds, yards ------------------------------------------ */
    {
      const tree = (kind, x, z, sc, tint) => {
        if (col.blocked(x, z, 1.1) || !roadClear(x, z, 1.2)) return false;
        I.add(kind, x, 0, z, R() * 6, sc || (0.85 + R() * 0.3), tint || [0xffffff, 0xf0f4e4, 0xf4f0e0][Math.floor(R() * 3)]);
        col.circle(x, z, kind === 'pine' ? 0.4 : 0.45, 6, 'tree');
        SP.circle('ao', x, z, 2.4, { blur: 1.4, dark: 0.22 });
        return true;
      };
      // street trees framing the approaches (skipped automatically where something already stands)
      for (const z of [21, 27.5, 44, 56]) for (const sx of [-1, 1]) tree('linden', sx * 7.2, z * s, 0.78);
      for (const z of [-21.5, -29, -36]) for (const sx of [-1, 1]) tree('linden', sx * 7.0, z * s, 0.74);
      for (const [x, z] of [[-19, 6.5], [-19, -6.5], [-41, 7.5], [-41, -6.5], [22, -5.5], [56, 8.5]]) tree('linden', x * s, z * s, 0.8);

      // lean-to sheds against the curtain wall (wood, lumber, hay, barrels)
      const wallShed = (x, z, ry, w, d, fill) => {
        B.push(x, 0, z, ry);
        for (const lx of [-w / 2 + 0.15, 0, w / 2 - 0.15]) B.boxY(M.wood, lx, 0, d / 2 - 0.15, 0.18, 2.35, 0.18, { color: 0x4f3d2e });
        B.box(M.wood, 0, 2.35, d / 2 - 0.15, w, 0.18, 0.2, { color: 0x4f3d2e });
        for (const sx of [-1, 1]) B.quad(M.planks, v3(sx * w / 2, 0, -d / 2), v3(sx * w / 2, 0, d / 2 - 0.2), v3(sx * w / 2, 2.35, d / 2 - 0.2), v3(sx * w / 2, 3.2, -d / 2), { color: 0x6e5844, uv: 'local' });
        B.quad(M.planks, v3(w / 2, 0, -d / 2), v3(-w / 2, 0, -d / 2), v3(-w / 2, 3.2, -d / 2), v3(w / 2, 3.2, -d / 2), { color: 0x5e4a3a, uv: 'local' });
        A.shed(B, M, -w / 2 - 0.25, w / 2 + 0.25, -d / 2 - 0.1, d / 2 + 0.45, 3.3, 2.4, { color: 0x6e6050 });
        B.pop();
        col.boxLocal(x, z, ry, 0, 0, w / 2 + 0.1, d / 2 + 0.1, 3.3, 'building');
        SP.rect('dirt', ...W(x, z, ry, 0, d / 2 + 1), w + 1, 2.4, ry, { blur: 0.5, alpha: 0.7 });
        SP.rect('ao', x, z, w + 0.4, d + 0.4, ry, { blur: 0.8, dark: 0.35 });
        const P2 = (lx, lz) => W(x, z, ry, lx, lz);
        if (fill === 'wood') { P.woodpile(B, M, ...P2(-w / 4, -0.2), ry, w / 2 - 0.4, 5, { seed: x | 0 }); P.woodpile(B, M, ...P2(w / 4, -0.2), ry, w / 2 - 0.4, 4, { seed: z | 0 }); }
        else if (fill === 'hay') { for (let k = 0; k < 6; k++) I.add('hay', ...P2(-w / 2 + 1 + (k % 3) * 1.05, -0.4).slice(0, 1), (k > 2 ? 0.48 : 0), P2(-w / 2 + 1 + (k % 3) * 1.05, -0.4)[1], ry + PI / 2, 1); barrelCluster(...P2(w / 4, 0), 3, ry); }
        else { barrelCluster(...P2(-w / 4, -0.2), 5, ry); crateStack(...P2(w / 4 - 0.4, -0.3), ry, 3); }
      };
      const wz = H + wt / 2 - wt / 2 - 0.9 - 1.6;   // shed centre line, back against the buttresses
      wallShed(-35 * s, -wz, 0, 8, 3.1, 'wood');
      wallShed(wz, 12 * s, -PI / 2, 9, 3.1, 'goods');
      wallShed(46 * s, wz, PI, 10, 3.1, 'hay');
      wallShed(-wz, -26 * s, PI / 2, 8, 3.1, 'goods');
      wallShed(-wz, 31 * s, PI / 2, 7, 3.1, 'wood');

      // allotment gardens between the west road and the stable lane
      {
        const plots = [];
        for (const pz of [25, 33.2]) for (const px of [-36.5, -27.5, -18.5]) plots.push([px * s, pz * s]);
        plots.forEach(([px, pz], i) => {
          const w = 7.2, d = 6.0, rr = V.rng(400 + i);
          SP.rect('dirt', px, pz, w - 0.6, d - 0.6, 0, { blur: 0.25 });
          const kind = i % 3 === 1 ? 'wattle' : 'picket';
          const gate = [w + d / 2 - 0.7, w + d / 2 + 0.7];
          P.fence(B, M, col, [[px - w / 2, pz + d / 2], [px - w / 2, pz - d / 2], [px + w / 2, pz - d / 2], [px + w / 2, pz + d / 2], [px - w / 2, pz + d / 2]], { kind, h: kind === 'wattle' ? 0.75 : 0.85, seed: 410 + i, gaps: [[w + d + 2.4, w + d + 3.8]] });
          void gate;
          const crop = i % 3;
          for (let r = 0; r < 5; r++) for (let k = 0; k < 10; k++) {
            if (rr() < 0.12) continue;
            const cx2 = px - w / 2 + 0.7 + k * 0.62, cz2 = pz - d / 2 + 0.8 + r * 1.05;
            if (crop === 0) I.add('cabbage', cx2, 0, cz2, rr() * 6, 0.85 + rr() * 0.3, r % 2 ? 0xd8e8c8 : 0xffffff);
            else if (crop === 1) I.add('bush', cx2, 0, cz2, rr() * 6, 0.32 + rr() * 0.1, 0xd0e0b0);
            else I.add('flowers', cx2, 0, cz2, rr() * 6, 1.1, [0xe0d0a0, 0xc8b060, 0xd8d0c0][r % 3]);
          }
          SP.line('ao', [[px - w / 2 + 0.5, pz], [px + w / 2 - 0.5, pz]], 0.3, { dark: 0.2, blur: 0.1 });
        });
        // tool shed, water butts, compost heap
        const [tsx, tsz] = S(-11.6, 22.5);
        B.push(tsx, 0, tsz, -PI / 2);
        B.boxY(M.rubble, 0, 0, 0, 2.8, 0.2, 2.2, { color: 0xbfb6a6 });
        for (const S2 of [{ x: 0, z: 1.0, ry: 0, len: 2.6 }, { x: 0, z: -1.0, ry: PI, len: 2.6 }, { x: 1.3, z: 0, ry: PI / 2, len: 1.8 }, { x: -1.3, z: 0, ry: -PI / 2, len: 1.8 }]) {
          B.push(S2.x, 0.2, S2.z, S2.ry);
          A.wall(B, M.planks, S2.len, 2.1, 0.1, S2.z > 0 ? [{ x: 0.4, w: 0.8, y0: 0, y1: 1.8 }] : [], { color: 0x6e5844 });
          if (S2.z > 0) A.door(B, M, { x: 0.4, w: 0.8, y0: 0, y1: 1.8 }, 0.1, { color: 0x5a4636 });
          B.pop();
        }
        A.shed(B, M, -1.6, 1.6, -1.35, 1.45, 2.6, 2.25, { color: 0x6e6050 });
        B.pop();
        col.box(tsx, tsz, 1.25, 1.55, 0, 2.6, 'building');
        barrelCluster(tsx - 0.4, tsz + 2.4, 2, 0);
        P.haystack(B, M, tsx + 0.2, tsz + 5.0, 1.0, 1.2); col.circle(tsx + 0.2, tsz + 5.0, 1.1, 1.2, 'props');
        reg.npc('gardener', 'villager', ...S(-14.5, 29), -PI / 2, 'gardens', 'Allotment gardener (optional ambient role)');
      }

      // village green: old linden with a ring bench, a duck pond with reeds south of it
      {
        const [gx, gz] = S(22, 12.5);
        I.add('oak', gx, 0, gz, 1.0, 1.25, 0xf0f4e4); col.circle(gx, gz, 1.95, 2, 'props');
        for (let k = 0; k < 8; k++) {   // octagonal ring bench around the trunk
          const a = k * PI / 4 + PI / 8, r = 1.45;
          B.push(gx + Math.cos(a) * r, 0, gz + Math.sin(a) * r, -a + PI / 2);
          B.boxY(M.planks, 0, 0.42, 0, 1.2, 0.07, 0.42, { color: 0x86694e });
          B.boxY(M.wood, 0, 0, 0, 0.1, 0.42, 0.36, { color: 0x664f3e });
          B.pop();
        }
        SP.circle('dirt', gx, gz, 3.3, { blur: 0.8, alpha: 0.8 });
        SP.circle('ao', gx, gz, 3.6, { blur: 1.4, dark: 0.3 });
        for (const a of [2.2, 4.2]) { const bx = gx + Math.cos(a) * 5.6, bz = gz + Math.sin(a) * 5.6; P.bench(B, M, bx, bz, -a - PI / 2, 1.8); col.box(bx, bz, 0.95, 0.25, -a - PI / 2, 0.5, 'props'); }
        const [px, pz] = S(15, 50.5), pr = 3.9;
        SP.circle('dirt', px, pz, pr + 1.4, { blur: 0.8 });
        SP.circle('ao', px, pz, pr + 0.6, { blur: 0.6, dark: 0.55 });
        const wg = new T.CircleGeometry(pr, 28); wg.rotateX(-PI / 2);
        { const p3 = wg.attributes.position; for (let i = 1; i < p3.count; i++) { const a = Math.atan2(p3.getZ(i), p3.getX(i)), k = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7); p3.setXYZ(i, p3.getX(i) * k, 0, p3.getZ(i) * k); } }
        B.geo(M.water, wg, new T.Matrix4().makeTranslation(px, 0.035, pz), { color: 0x3a4a48, cast: false });
        for (let k = 0; k < 26; k++) {
          const a = R() * PI * 2, r = pr * (1 + 0.12 * Math.sin(a * 3 + 1)) + 0.1 + R() * 0.6, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
          if (R() < 0.55) I.add('tuft', x, 0, z, R() * 6, [1.6, 3.2, 1.6], 0xd8e4b8); else I.add('rock', x, -0.05, z, R() * 6, 0.25 + R() * 0.35, 0xe0dcd0);
        }
        col.circle(px, pz, pr + 0.35, 0.3, 'pond');
        P.bench(B, M, px - 5.6, pz - 1.0, PI / 2, 1.8); col.box(px - 5.6, pz - 1.0, 0.25, 0.95, 0, 0.5, 'props');
      }

      // dovecote by the north-east lane (a strong little silhouette for the skyline)
      {
        const [dx, dz] = S(57.5, -22);
        B.cyl(M.rubble, dx, 0, dz, 2.05, 1.9, 4.4, 14, { color: 0xc8bfae, caps: '' });
        B.cyl(M.plaster, dx, 4.4, dz, 1.9, 1.9, 1.3, 14, { color: 0xe8dcc4, caps: '' });
        for (let k = 0; k < 10; k++) { const a = k / 10 * PI * 2; B.push(dx + Math.cos(a) * 1.92, 0, dz + Math.sin(a) * 1.92, PI / 2 - a); B.box(M.dark, 0, 5.05, 0.0, 0.16, 0.16, 0.04, { color: 0x1a1612 }); B.box(M.wood, 0, 4.92, 0.08, 0.32, 0.04, 0.16, { color: 0x5e4a3a }); B.pop(); }
        B.cyl(M.wood, dx, 5.7, dz, 2.0, 2.0, 0.14, 14, { color: 0x4f3d2e, caps: '' });
        B.cyl(M.shingle, dx, 5.84, dz, 2.55, 0.05, 2.9, 14, { color: 0x6c6257, caps: '', uvScale: 0.5 });
        B.cyl(M.planks, dx, 5.7, dz, 2.55, 2.5, 0.14, 14, { color: 0x4a3b2e, caps: 'b' });
        B.cyl(M.iron, dx, 8.6, dz, 0.04, 0.02, 0.9, 6, { color: 0x2e2f31 });
        B.push(dx, 0, dz, -PI / 2); B.box(M.planks, 0, 0.95, 2.02, 0.8, 1.7, 0.08, { color: 0x5a4636 }); B.pop();
        col.circle(dx, dz, 2.2, 8.6, 'building');
        SP.circle('ao', dx, dz, 2.6, { blur: 0.8, dark: 0.45 });
        SP.circle('dirt', dx, dz, 3.4, { blur: 0.8, alpha: 0.6 });
      }

      // woodcutter's yard in the north-west corner
      {
        const [yx, yz] = S(-61, -63);
        SP.rect('dirt', yx, yz, 12, 9, 0.1, { blur: 0.8, round: 2 });
        for (let r = 0; r < 4; r++) for (let k = 0; k < 7 - r; k++) I.add('log', yx - 3.5 + k * 0.36 + r * 0.18, 0.16 + r * 0.29, yz - 2.4, PI / 2, [2.4, 1.0, 1.0], 0xe8e0d0);
        col.box(yx - 2.4, yz - 2.4, 1.6, 1.4, 0, 1.3, 'props');
        // sawhorse with a log, chopping block with an axe
        B.push(yx + 1.5, 0, yz + 0.8, 0.4);
        for (const sx of [-0.7, 0.7]) { B.beam(M.wood, v3(sx, 0, -0.4), v3(sx, 0.85, 0.15), 0.08, 0.08, { color: 0x5e4a3a }); B.beam(M.wood, v3(sx, 0, 0.5), v3(sx, 0.85, -0.05), 0.08, 0.08, { color: 0x5e4a3a }); }
        B.pushMatrix(new T.Matrix4().makeRotationZ(PI / 2).setPosition(-1.2, 0.95, 0.05)); B.cyl(M.bark, 0, 0, 0, 0.17, 0.17, 2.4, 8, { color: 0x6b5843, caps: 'tb' }); B.pop();
        B.pop();
        col.circle(yx + 1.5, yz + 0.8, 1.2, 1.1, 'props');
        B.cyl(M.bark, yx + 3.6, 0, yz - 1.4, 0.36, 0.34, 0.6, 9, { color: 0x6b5843 });
        B.box(M.wood, yx + 3.6, 0.95, yz - 1.4, 0.05, 0.75, 0.05, { color: 0x6e5844, rz: 0.3 });
        B.box(M.iron, yx + 3.48, 0.66, yz - 1.4, 0.06, 0.2, 0.2, { color: 0x45474b, rz: 0.3 });
        col.circle(yx + 3.6, yz - 1.4, 0.45, 0.7, 'props');
        P.woodpile(B, M, yx + 1.2, yz + 4.0, 0.1, 3.2, 5, { roof: true, seed: 77 }); col.box(yx + 1.2, yz + 4.0, 1.8, 0.65, 0.1, 1.4, 'props');
        reg.npc('woodcutter', 'villager', yx + 2.6, yz - 0.4, 0.3, 'residential', 'Woodcutter (optional ambient role)');
      }

      // chicken coop with a fenced run (south-west)
      {
        const [cx3, cz3] = S(-66, 22);
        B.push(cx3, 0, cz3, PI / 2);
        for (const [lx, lz] of [[-0.9, -0.7], [0.9, -0.7], [-0.9, 0.7], [0.9, 0.7]]) B.boxY(M.wood, lx, 0, lz, 0.12, 0.7, 0.12, { color: 0x4f3d2e });
        B.boxY(M.planks, 0, 0.7, 0, 2.1, 1.2, 1.7, { color: 0x6e5844 });
        A.roof(B, M, { w: 2.1, d: 1.7, y: 1.9, pitch: 40, hip: 0, mat: M.shingle, color: 0x6e6050, thick: 0.06, oe: 0.2, og: 0.15, gable: { mat: M.planks, color: 0x6e5844, t: 0.06 } });
        B.beam(M.planks, v3(0.4, 0.75, 0.85), v3(0.4, 0.02, 1.9), 0.4, 0.04, { color: 0x6e5844 });
        B.box(M.dark, 0.4, 0.95, 0.86, 0.32, 0.36, 0.02, { color: 0x1a1612 });
        B.pop();
        col.box(cx3, cz3, 1.2, 1.2, 0, 2.6, 'building');
        P.fence(B, M, col, [[cx3 - 1.4, cz3 - 2.6], [cx3 + 3.8, cz3 - 2.6], [cx3 + 3.8, cz3 + 2.6], [cx3 - 1.4, cz3 + 2.6]], { kind: 'picket', h: 0.8, seed: 501 });
        SP.rect('dirt', cx3 + 1.2, cz3, 5.6, 5.6, 0, { blur: 0.4 });
      }

      // small groves and hedgerows that break up the open lawns
      const groves = [[-66, -44, 3], [-64, -22, 2], [-66, 46, 3], [-24, 66, 2], [26, 58, 3], [64, 22, 2], [44, -14, 2], [-6, -64, 0], [26, -72, 2], [-30, -70, 2], [64, 66, 2], [-66, 64, 2], [10, 22, 1], [-14, 44, 1]];
      for (const [gx0, gz0, n] of groves) {
        const gx = gx0 * s, gz = gz0 * s;
        let placed = 0;
        for (let k = 0; k < n * 4 && placed < n; k++) { const a = R() * PI * 2, r = 1.5 + R() * 4; if (tree(R() < 0.25 ? 'pine' : R() < 0.5 ? 'linden' : 'oak', gx + Math.cos(a) * r, gz + Math.sin(a) * r)) placed++; }
        for (let k = 0; k < 7; k++) { const a = R() * PI * 2, r = 2 + R() * 5, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r; if (!col.blocked(x, z, 0.6) && roadClear(x, z, 0.8)) I.add('bush', x, 0, z, R() * 6, 0.6 + R() * 0.5, 0xe8f0d8); }
      }
      const hedge = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < L; t += 1.1) { const x = (a[0] + (b[0] - a[0]) * t / L) * s, z = (a[1] + (b[1] - a[1]) * t / L) * s; if (!col.blocked(x, z, 0.5) && roadClear(x, z, 0.6)) { I.add('bush', x, 0, z, R() * 6, 0.75 + R() * 0.25, 0xe0e8d0); } } } };
      hedge([[-9.5, 18], [-9.5, 40]]); hedge([[9.5, 42], [9.5, 56]]); hedge([[24, 22], [24, 40]]); hedge([[-60, -17], [-48, -17]]);
    }

    /* ------------------------------------------ vegetation ------------------------------------------ */
    {
      const inWalls = (x, z) => Math.abs(x) < H - 1 && Math.abs(z) < H - 1;
      // trees inside: along lanes / between districts (hand-placed anchors + jitter)
      const insideTrees = [[-14, -27, 'oak'], [14, -30, 'linden'], [-62, -24, 'oak'], [-66, -64, 'pine'], [-30, -66, 'oak'], [-60, 30, 'oak'], [-68, 40, 'pine'], [22, 52, 'linden'], [6, 66, 'oak'], [66, 10, 'linden'], [68, 18, 'oak'], [24, -66, 'pine'], [64, -24, 'oak'], [-36, -6.5, 'linden'], [-66, -6.5, 'oak'], [58, 12, 'oak'], [24, 34, 'oak']];
      for (const [x0, z0, kind] of insideTrees) {
        const x = x0 * s, z = z0 * s;
        if (col.blocked(x, z, 1.2) || !roadClear(x, z, 1.5)) continue;
        I.add(kind, x, 0, z, R() * 6, 0.85 + R() * 0.3, [0xffffff, 0xf0f4e4, 0xf4f0e0][Math.floor(R() * 3)]);
        col.circle(x, z, kind === 'pine' ? 0.4 : 0.45, 6, 'tree');
        SP.circle('ao', x, z, 2.6, { blur: 1.5, dark: 0.22 });
      }
      // bushes along the inner foot of the walls and around buildings
      for (let k = 0; k < 160; k++) {
        const side = k % 4, t = (R() * 2 - 1) * (H - 8);
        const x = side === 0 ? t : side === 1 ? t : side === 2 ? H - 2.2 - R() * 1.5 : -(H - 2.2 - R() * 1.5);
        const z = side === 0 ? -(H - 2.2 - R() * 1.5) : side === 1 ? H - 2.2 - R() * 1.5 : t;
        if (col.blocked(x, z, 0.5) || !roadClear(x, z, 1)) continue;
        I.add('bush', x, 0, z, R() * 6, 0.7 + R() * 0.6, [0xffffff, 0xe8f0d8, 0xf0ecd8][k % 3]);
      }
      // forest.js: giant trees + undergrowth outside the walls (before the tufts, so no grass grows inside the trunks)
      if (FOREST) FOREST.populate({ I, col, SP, R, terrain, walk, region, roadClear, c, world: !!WORLD });
      if (WORLD) WORLD.populate({ I, B, M, col, R, SP, terrain, walk, FOREST, X });
      // grass tufts + flowers on open ground (noise-clumped), detail layer
      let tufts = 0;
      const tryTuft = (x, z, dens) => {
        const n = V.ntab(x, z, 0.08);
        if (R() > dens * (0.3 + n * 1.2)) return;
        if (!roadClear(x, z, 0.35) || col.blocked(x, z, 0.25)) return;
        if (R() < 0.08) I.add('flowers', x, 0, z, R() * 6, 0.8 + R() * 0.5, [0xd9d0b0, 0xc9b85a, 0xb5a0c8, 0xd8c8b8][Math.floor(R() * 4)]);
        else I.add('tuft', x, 0, z, R() * 6, 0.7 + R() * 0.7, [0xffffff, 0xf2eedc, 0xe4ecd2][Math.floor(R() * 3)]);
        tufts++;
      };
      for (let k = 0; k < 9000; k++) tryTuft((R() * 2 - 1) * (H - 1), (R() * 2 - 1) * (H - 1), 0.75);
      for (let k = 0; k < 7000; k++) { const x = V.lerp(walk.minX, walk.maxX, R()), z = V.lerp(walk.minZ, walk.maxZ, R()); if (inWalls(x, z) || (Math.abs(x) < c + 3 && Math.abs(z) < c + 3)) continue; tryTuft(x, z, 0.55); }
      // meadow + forest outside: scattered trees in the walkable band, dense forest on the hills beyond
      const outsideOK = (x, z) => !(Math.abs(x) < c + 9 && Math.abs(z) < c + 9) && terrain.roadDist(x, z) > 7 && roadClear(x, z, 3);
      if (!FOREST) for (let k = 0; k < 70; k++) {
        const x = V.lerp(walk.minX + 3, walk.maxX - 3, R()), z = V.lerp(walk.minZ + 3, walk.maxZ - 3, R());
        if (!outsideOK(x, z) || col.blocked(x, z, 2.5)) continue;
        const kind = R() < 0.6 ? 'oakF' : R() < 0.5 ? 'lindenF' : 'pine';
        I.add(kind, x, 0, z, R() * 6, 0.85 + R() * 0.35, 0xffffff); col.circle(x, z, 0.45, 6, 'tree');
        if (R() < 0.5) I.add('rock', x + 2 + R() * 2, 0, z + R() * 2, R() * 6, 0.5 + R() * 0.8, 0xffffff);
      }
      if (!FOREST) for (let k = 0; k < 2600; k++) {
        const x = V.lerp(region.minX - 60, region.maxX + 60, R()), z = V.lerp(walk.minZ - 90, H + 260, R());
        const ox = Math.max(walk.minX - x, 0, x - walk.maxX), oz = Math.max(walk.minZ - z, 0, z - walk.maxZ);
        const out = Math.hypot(ox, oz);
        if (out < 3 || out > 120) continue;
        if (terrain.roadDist(x, z) < 6) continue;
        const dens = V.smooth(3, 22, out) * (0.45 + 0.55 * V.ntab(x, z, 0.03));
        if (R() > dens) continue;
        const kind = R() < 0.62 ? 'pine' : R() < 0.6 ? 'oakF' : 'lindenF';
        I.add(kind, x, terrain.height(x, z) - 0.15, z, R() * 6, 0.9 + R() * 0.5, [0xffffff, 0xe8eedc, 0xdfe8d8][Math.floor(R() * 3)]);
      }
      for (let k = 0; k < 260; k++) {
        const x = V.lerp(walk.minX - 40, walk.maxX + 40, R()), z = V.lerp(walk.minZ - 40, walk.maxZ + 60, R());
        if (inWalls(x, z) || (Math.abs(x) < c + 5 && Math.abs(z) < c + 5) || terrain.roadDist(x, z) < 4 || !roadClear(x, z, 1)) continue;
        const inside = x > walk.minX && x < walk.maxX && z > walk.minZ && z < walk.maxZ;
        if (inside && col.blocked(x, z, 1.2)) continue;
        const kind = R() < 0.55 ? 'bush' : 'rock';
        const sc = kind === 'rock' ? 0.5 + R() * 1.4 : 0.7 + R() * 0.8;
        I.add(kind, x, terrain.height(x, z), z, R() * 6, sc, 0xffffff);
        if (inside && sc > 0.9) col.circle(x, z, kind === 'rock' ? sc * 0.55 : sc * 0.6, sc, kind);
      }
      V.stats_tufts = tufts;
    }

    /* ------------------------------------------ boundary, terrain, meshes ------------------------------------------ */
    if (!WORLD) {
      const pad = 8;
      col.box((walk.minX + walk.maxX) / 2, walk.minZ - pad, (walk.maxX - walk.minX) / 2 + pad * 2, pad, 0, 99, 'bounds');
      col.box((walk.minX + walk.maxX) / 2, walk.maxZ + pad, (walk.maxX - walk.minX) / 2 + pad * 2, pad, 0, 99, 'bounds');
      col.box(walk.minX - pad, (walk.minZ + walk.maxZ) / 2, pad, (walk.maxZ - walk.minZ) / 2 + pad * 2, 0, 99, 'bounds');
      col.box(walk.maxX + pad, (walk.minZ + walk.maxZ) / 2, pad, (walk.maxZ - walk.minZ) / 2 + pad * 2, 0, 99, 'bounds');
    }
    // contact shadows under the curtain walls / towers
    {
      const r2 = H + wt / 2;
      for (const [x0, z0, x1, z1] of [[-r2, -r2, r2, -r2], [-r2, r2, r2, r2], [-r2, -r2, -r2, r2], [r2, -r2, r2, r2]]) { SP.line('ao', [[x0, z0], [x1, z1]], wt + 3.2, { blur: 1.4, dark: 0.45 }); SP.line('dirt', [[x0, z0], [x1, z1]], wt + 3.6, { blur: 1.0, alpha: 0.5 }); }
      for (const [x, z] of [[-r2, -r2], [r2, -r2], [r2, r2], [-r2, r2]]) SP.circle('ao', x, z, 7.8, { blur: 1.6, dark: 0.45 });
    }
    const splat = SP.finalize();
    const terrainMesh = WORLD ? WORLD.buildTerrain(X, splat, region) : V.buildTerrainMesh(terrain, X, splat, region);
    group.add(terrainMesh);
    if (WORLD) group.add(WORLD.buildWater());
    const staticMeshes = B.build(group, (m) => detail.push(m));
    const instMeshes = I.build(group, (m) => detail.push(m));
    if (FOREST) FOREST.afterBuild(instMeshes, M);              // leaf cards cast alpha-tested (dappled) shadows
    // invisible raycast ground for click-to-move (walkable ground is exactly y = 0)
    const pickPlane = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshBasicMaterial({ visible: false }));
    pickPlane.rotation.x = -PI / 2; pickPlane.updateMatrixWorld(); pickPlane.name = 'village_pick';
    scene.add(group);
    if (WORLD) WORLD.registerCull(group);                       // distance culling (the fog hides everything past ~175 m)

    /* ------------------------------------------ navigation ------------------------------------------ */
    const tn = performance.now();
    const navB = { minX: walk.minX, maxX: walk.maxX, minZ: walk.minZ, maxZ: walk.maxZ };
    const vnav = new V.NavGrid(col, navB, cfg.navCell, cfg.playerRadius + 0.05, (x, z) => x > walk.minX + 0.5 && x < walk.maxX - 0.5 && z > walk.minZ + 0.5 && z < walk.maxZ - 0.5);
    const wildNav = WORLD ? WORLD.makeNav(col, cfg.playerRadius + 0.05) : null;
    const nav = WORLD ? WORLD.compositeNav(vnav, wildNav, walk) : vnav;
    if (WORLD && WORLD.pruneUnreachableCamps) WORLD.pruneUnreachableCamps(wildNav);     // world: drop random mob packs fenced into unreachable pockets
    const navMs = performance.now() - tn;

    /* ------------------------------------------ lighting + sky ------------------------------------------ */
    const SKY_H = new T.Color(0xc3cbcd), SKY_Z = new T.Color(0x7393b2);
    if (!ATMO) { scene.background = SKY_H.clone(); scene.fog = new T.Fog(SKY_H.getHex(), 140, 420); }
    if (!ATMO) {
      const g = new T.SphereGeometry(900, 32, 16), p = g.attributes.position, colA = [];
      const lo = new T.Color(0x9da59c);
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 900; const cc = y > 0 ? SKY_H.clone().lerp(SKY_Z, Math.pow(y, 0.6)) : SKY_H.clone().lerp(lo, Math.min(1, -y * 3)); colA.push(cc.r, cc.g, cc.b); }
      g.setAttribute('color', new T.Float32BufferAttribute(colA, 3));
      const sky = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -10; sky.name = 'village_sky'; sky.frustumCulled = false;
      sky.onBeforeRender = function (r, sc, cam) { this.position.copy(cam.position); this.position.y -= this.parent.position.y; this.updateMatrixWorld(); };   // (vertical frame: cancel the group's -yBase shift)
      group.add(sky);
    }
    const lights = ctx.lights || {};
    if (lights.hemi) { lights.hemi.color.setHex(0xd8e0e6); lights.hemi.groundColor.setHex(0x5e5444); lights.hemi.intensity = 0.48; }
    if (lights.sun) {
      const sun = lights.sun;
      sun.color.setHex(0xffecd4); sun.intensity = 1.0;
      sun.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      const sc = sun.shadow.camera, e = cfg.shadowExtent;
      sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 1; sc.far = 220; sc.updateProjectionMatrix();
      sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.03;
    }
    if (lights.rim) { lights.rim.color.setHex(0x9db6cf); lights.rim.intensity = 0.32; }
    if (camera) { camera.far = 520; camera.near = Math.max(camera.near, 0.25); camera.updateProjectionMatrix(); }
    // atmosphere.js: tinted depth fog + ground mist, painted sky, light grade, fireflies, god rays, vignette
    if (ATMO) ATMO.apply({ scene, group, lights, camera, cfg, walk, terrain, R });

    /* ------------------------------------------ runtime ------------------------------------------ */
    const SUN_DIR = ATMO ? ATMO.SUN_DIR.clone() : new T.Vector3(-6, 12, 7).normalize();
    const _rot = new T.Matrix4(), _inv = new T.Matrix4(), _p = new T.Vector3(), _up = new T.Vector3(0, 1, 0), _o = new T.Vector3();
    let detailOn = true;
    const _cp = new T.Vector3();
    let shadowExt = cfg.shadowExtent;
    function updateSun(sun, target, camDist) {
      const want = V.clamp((camDist || 12) * 1.7, 16, cfg.shadowExtent + 4);
      if (Math.abs(want - shadowExt) > 1.5) { shadowExt = want; const sc = sun.shadow.camera; sc.left = -want; sc.right = want; sc.top = want; sc.bottom = -want; sc.updateProjectionMatrix(); }
      const e = shadowExt, texel = (2 * e) / cfg.shadowMap;
      _rot.lookAt(SUN_DIR, _o.set(0, 0, 0), _up); _inv.copy(_rot).invert();
      _p.copy(target).applyMatrix4(_inv);
      _p.x = Math.round(_p.x / texel) * texel; _p.y = Math.round(_p.y / texel) * texel;
      _p.applyMatrix4(_rot);
      sun.target.position.copy(_p); sun.position.copy(_p).addScaledVector(SUN_DIR, 110);
      sun.target.updateMatrixWorld();
    }
    let lodT = 0;
    /* VERTICAL FRAME: the hero is always at y = 0; the whole world group is shifted by -yBase (the true ground height under
       the hero) so every effect authored at "y = 0" still sits on the ground next to the hero. W.heightAt = true height,
       W.frameY = height in the frame. Call setFrame(hero) after the hero has moved (index.html does, before the creatures sync). */
    function setFrame(p) {
      if (!WORLD || !p) return 0;
      WORLD.yBase = WORLD.walkY(p.x, p.z);
      group.position.y = -WORLD.yBase;
      return WORLD.yBase;
    }
    const frameY = (x, z) => (WORLD ? WORLD.frameY(x, z) : 0);
    /* click-to-move / aim picking on the real terrain (replaces the flat y = 0 pickPlane): ray-march against the frame height.
       Returns a point in FRAME coordinates (y = frame height), or null when the ray never meets the ground. */
    const _pgp = new T.Vector3();
    function pickGround(ray, out) {
      const o = ray.ray ? ray.ray.origin : ray.origin, d = ray.ray ? ray.ray.direction : ray.direction;
      out = out || new T.Vector3();
      if (!WORLD) { if (Math.abs(d.y) < 1e-6) return null; const t = -o.y / d.y; if (t < 0) return null; out.copy(o).addScaledVector(d, t); out.y = 0; return out; }
      if (o.y < frameY(o.x, o.z)) return null;
      let t0 = 0, t1 = 0;
      for (let t = 1.5; t < 520; t += t < 60 ? 1.0 : 2.5) {
        _pgp.copy(o).addScaledVector(d, t);
        if (_pgp.y <= frameY(_pgp.x, _pgp.z)) {
          t1 = t; t0 = t - (t < 60 ? 1.0 : 2.5);
          for (let k = 0; k < 14; k++) { const m = (t0 + t1) / 2; _pgp.copy(o).addScaledVector(d, m); if (_pgp.y <= frameY(_pgp.x, _pgp.z)) t1 = m; else t0 = m; }
          out.copy(o).addScaledVector(d, t1); out.y = frameY(out.x, out.z); return out;
        }
        if (_pgp.y > 400) break;
      }
      return null;
    }
    function update(dt, cam, playerPos, sun) {
      V.time.value += dt;
      setFrame(playerPos);
      if (ATMO) ATMO.update(dt);
      if (playerPos) {
        V.fade.uFadeP.value.set(playerPos.x, playerPos.y + 1.05, playerPos.z);
        V.fade.uFadeCam.value.copy(cam.position);
        V.fade.uFadeOn.value = 1;
        const dist = cam.position.distanceTo(V.fade.uFadeP.value);
        V.fade.uFadeR.value = V.clamp(1.6 + dist * 0.09, 2.0, 3.6);
      }
      if (sun && playerPos) updateSun(sun, playerPos, cam.position.distanceTo(playerPos));
      if (WORLD && playerPos) WORLD.cull(playerPos, dt);
      lodT -= dt;
      if (lodT <= 0 && playerPos) {     // distance-based clutter culling (chunk granularity), 4x per second
        lodT = 0.25;
        const lim = cfg.detailDist + cam.position.distanceTo(playerPos) * 1.2;
        for (const m of detail) {
          const bs = m.geometry.boundingSphere; if (!bs) continue;
          _cp.copy(bs.center);
          m.visible = detailOn && Math.hypot(_cp.x - playerPos.x, _cp.z - playerPos.z) - bs.radius < lim;
        }
      }
    }
    function collide(p, r) {
      const rr = r || cfg.playerRadius, moved = col.resolve(p, rr);
      if (WORLD) { let m2 = false; for (let k = 0; k < 2; k++) { if (!WORLD.keepInside(p, rr)) break; m2 = true; col.resolve(p, rr); } return moved || m2; }   // valley edge / rivers / hill mounds
      return moved;
    }
    function findPath(from, to) {
      const path = nav.findPath(from.x, from.z, to.x, to.z);
      return path ? path.map((q) => new T.Vector3(q.x, 0, q.z)) : null;
    }
    function projectileHit(a, b) { return col.segment(a, b); }

    /* ------------------------------------------ developer debug overlay ------------------------------------------ */
    let dbg = null;
    function buildDebug() {
      const g = new T.Group(); g.name = 'village_debug';
      const pos = [], cl = [];
      const colors = { wall: 0xff5040, tower: 0xff5040, gate: 0xff9040, gatedoor: 0xffc040, gatetower: 0xff5040, watchtower: 0xff5040, building: 0x40a0ff, keep: 0x8060ff, props: 0x40ff90, fence: 0xa0ff40, tree: 0x60c060, stall: 0x40ffd0, lowwall: 0xffa0a0, bounds: 0xffffff, stair: 0xff80ff, waystone: 0xffff40 };
      const cc = new T.Color();
      const seg = (x0, z0, x1, z1, y, hex) => { pos.push(x0, y, z0, x1, y, z1); cc.setHex(hex); cl.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); };
      for (const sh of col.shapes) {
        const hex = colors[sh.tag] || 0xffffff, y = 0.08;
        if (sh.t === 1) { for (let k = 0; k < 16; k++) { const a0 = k / 16 * PI * 2, a1 = (k + 1) / 16 * PI * 2; seg(sh.x + Math.cos(a0) * sh.r, sh.z + Math.sin(a0) * sh.r, sh.x + Math.cos(a1) * sh.r, sh.z + Math.sin(a1) * sh.r, y, hex); } }
        else {
          const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [sh.x + a * sh.hx * sh.c + b * sh.hz * sh.s, sh.z - a * sh.hx * sh.s + b * sh.hz * sh.c]);
          for (let k = 0; k < 4; k++) seg(cs[k][0], cs[k][1], cs[(k + 1) % 4][0], cs[(k + 1) % 4][1], y, hex);
        }
      }
      const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); lg.setAttribute('color', new T.Float32BufferAttribute(cl, 3));
      const lines = new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
      lines.renderOrder = 30; g.add(lines);
      // nav grid (blocked cells)
      const cv = document.createElement('canvas'); cv.width = nav.w; cv.height = nav.h;
      const cx2 = cv.getContext('2d'), img = cx2.createImageData(nav.w, nav.h);
      for (let i = 0; i < nav.block.length; i++) { if (nav.block[i]) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 40; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 90; } }
      cx2.putImageData(img, 0, 0);
      const nt = new T.CanvasTexture(cv); nt.magFilter = T.NearestFilter; nt.flipY = false;
      const np = new T.Mesh(new T.PlaneGeometry(nav.w * nav.cell, nav.h * nav.cell), new T.MeshBasicMaterial({ map: nt, transparent: true, depthWrite: false }));
      np.rotation.x = PI / 2; np.scale.z = -1;   // (mirrored so the canvas row order maps to +z without flipY)
      np.position.set(nav.minX + nav.w * nav.cell / 2, 0.06, nav.minZ + nav.h * nav.cell / 2); np.renderOrder = 29; g.add(np);
      // markers + labels
      const label = (text, x, y, z, hex) => {
        const c2 = document.createElement('canvas'); c2.width = 256; c2.height = 64; const q2 = c2.getContext('2d');
        q2.fillStyle = 'rgba(10,14,18,0.78)'; q2.fillRect(0, 0, 256, 64); q2.fillStyle = '#' + new T.Color(hex).getHexString(); q2.font = 'bold 26px system-ui, sans-serif'; q2.textAlign = 'center'; q2.textBaseline = 'middle'; q2.fillText(text, 128, 32);
        const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c2), depthTest: false, transparent: true }));
        sp.scale.set(4, 1, 1); sp.position.set(x, y, z); sp.renderOrder = 31; g.add(sp);
      };
      const pin = (p, hex, h) => { const m = new T.Mesh(new T.CylinderGeometry(0.25, 0.25, h || 2.2, 8), new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.85, depthTest: false })); m.position.set(p.x, (p.y || 0) + (h || 2.2) / 2, p.z); m.renderOrder = 31; g.add(m); };
      for (const k in reg.spawns) { const sp2 = reg.spawns[k]; pin(sp2.position, 0x40ff60, 3); label('spawn: ' + k, sp2.position.x, 3.6, sp2.position.z, 0x80ff90); const ar = new T.ArrowHelper(new T.Vector3(Math.sin(sp2.yaw), 0, Math.cos(sp2.yaw)), v3(sp2.position.x, 0.3, sp2.position.z), 2.2, 0x40ff60); g.add(ar); }
      const roleCol = { guard: 0xff6040, merchant: 0xffd040, blacksmith: 0xffa040, healer: 0x60ff90, quest_giver: 0xffff60, trainer: 0x60c0ff, innkeeper: 0xffb0d0, steward: 0xc0a0ff, stablehand: 0xd0c090 };
      for (const n of reg.npcs) { pin(n.position, roleCol[n.role] || 0xffffff, 1.9); label(n.role, n.position.x, n.position.y + 2.5, n.position.z, roleCol[n.role] || 0xffffff); }
      for (const t of reg.transitions) { const r2 = new T.Mesh(new T.RingGeometry(t.radius - 0.3, t.radius, 32), new T.MeshBasicMaterial({ color: 0x40e0ff, side: T.DoubleSide, depthTest: false })); r2.rotation.x = -PI / 2; r2.position.set(t.center.x, 0.1, t.center.z); g.add(r2); label('exit: ' + t.id, t.center.x, 3, t.center.z, 0x40e0ff); }
      for (const d of reg.dummies) pin(v3(d.x, 0, d.z), 0xff40ff, 2.6);
      for (const t of reg.targets) pin(v3(t.x, 0, t.z), 0xff40ff, 2.0);
      const wb = [[walk.minX, walk.minZ], [walk.maxX, walk.minZ], [walk.maxX, walk.maxZ], [walk.minX, walk.maxZ], [walk.minX, walk.minZ]];
      g.add(new T.Line(new T.BufferGeometry().setFromPoints(wb.map((q) => v3(q[0], 0.15, q[1]))), new T.LineBasicMaterial({ color: 0xffffff })));
      return g;
    }
    function setDebug(on) {
      if (on && !dbg) { dbg = buildDebug(); scene.add(dbg); }
      if (dbg) dbg.visible = !!on;
      world.debug = !!on;
    }

    // stats
    let tris = 0, draws = 0;
    group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; tris += o.isInstancedMesh ? n * o.count : n; draws++; } });
    const world = {
      group, registry: reg, collision: col, nav, terrain, pickPlane, materials: M, config: cfg, World: WORLD,
      spawn: (id) => reg.spawns[id] || reg.spawns.plaza,
      update, collide, findPath, projectileHit, updateSun, setDebug, setFrame, frameY, pickGround, toggleDebug: () => setDebug(!world.debug),
      setDetail: (on) => { detailOn = on; lodT = 0; },
      heightAt: terrain.height, debug: false,
      stats: { tris: Math.round(tris), meshes: draws, staticMeshes: staticMeshes.length, instanced: instMeshes.length, colliders: col.shapes.length, navCells: nav.w * nav.h, buildMs: Math.round(performance.now() - t0), texMs: Math.round(V.texTime), navMs: Math.round(navMs), tufts: V.stats_tufts, buildings: buildings.length },
      buildings, homes: buildings.filter((b) => b.spec && b.spec.seed < 100),
      mapHide: () => (ATMO && ATMO.mapHide) || [],              // additive fx hidden in the top-down map capture
    };
    return world;
  };
})();
