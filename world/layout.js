/* =====================================================================================================
 *  world/layout.js  -  the open world around Taskale (Metin2-style top-down map): zones, floor, relief, rivers, roads, camps
 *
 *  A Metin2-style overworld for levels 1-16: the castle in the middle, a great river wrapping it, big forests, a sea on
 *  the east, mountains all around. Authored in the pixels of the top-down reference map (P(px, py) -> metres).
 *  Everything here is DATA + analytic fields (no three.js objects):
 *
 *    W.zones      named regions (level band, biome, chambers = capsule chains that form the walkable floor)
 *    W.hills      WALKABLE hills (+ rolling swells everywhere on the floor); W.pads = dead-flat settlement pads
 *    W.islands    non-walkable rock outcrops / mounds inside the plains (watchtower massif, warren hillocks, crags)
 *    W.rivers     polylines (control points + width) -> carved channels, water ribbons, colliders, bridges
 *    W.lakes      ellipses (the sea, ponds, swamp pools)
 *    W.roads      dirt roads / footpaths (a closed ring = a round plaza); bridges appear on every road x river crossing
 *    W.camps      creature camps (species, centre, radius, count) -> CREATURE_DEFS.ZONES
 *    W.sites      landmark anchors consumed by scenery.js
 *
 *  The hero is always at y = 0 in the scene frame (foot IK); the world group is shifted by -W.yBase each frame
 *  (village/scene.js), so the floor can have real relief: W.heightAt = true height, W.frameY = height in the hero's
 *  frame. The village band and the settlement pads stay dead flat (their buildings are built at y = 0). Rivers / the
 *  sea are carved BELOW the ground (bridges run at y = 0); mountains rise outside the floor.
 *
 *  Grids (2 m): sd = signed distance to the walkable floor (<0 inside), hgrid = terrain height, river / lake carve
 *  depth, bank wetness. Everything else (nav, collision push-back, terrain mesh, scenery) samples these.
 * ===================================================================================================== */
(function () {
  'use strict';
  const V = window.Village;
  const Q = new URLSearchParams(location.search);
  const W = V.World = { on: Q.get('wild') !== '0' };
  if (!W.on) return;
  const { clamp, smooth, lerp } = V;

  /* ------------------------------------------------ bounds / grid ------------------------------------------------ */
  /* The map is authored on the Metin2-style top-down reference (a 507 x 635 px image): P(px, py) converts reference
     pixels to metres, 3 m per pixel, with the castle compound (village, centre 0,0) at px (150, 322).
       north plains (north of the river)   |  castle meadow + west forest (west bank)  |  east marsh coast + sea (east)
       the great river wraps the castle from the north and the east, then runs south-west; bridges on every crossing.   */
  const PX0 = 150, PY0 = 322, PS = 3;
  const P = (px, py) => [(px - PX0) * PS, (py - PY0) * PS];
  W.P = P;
  W.bounds = { minX: -620, maxX: 1200, minZ: -1000, maxZ: 1100 };
  W.G = 2;
  const G = W.G, B = W.bounds;
  W.NX = Math.round((B.maxX - B.minX) / G) + 1; W.NZ = Math.round((B.maxZ - B.minZ) / G) + 1;
  const NX = W.NX, NZ = W.NZ;
  /* the part of the world the map / minimap shows (the floor + a margin of mountains + the coast) */
  W.region = { minX: -480, maxX: 930, minZ: -940, maxZ: 960 };

  /* village band (walkable rectangle around the walls, see village/terrain.js): x +-102.2, z -102.2 .. 144 */
  W.village = { minX: -102.2, maxX: 102.2, minZ: -102.2, maxZ: 144 };

  /* ------------------------------------------------ valley floors ------------------------------------------------ */
  /* cap(px1, py1, px2, py2, rpx): a capsule of the walkable floor in REFERENCE PIXELS (converted to metres) */
  const cap = (px1, py1, px2, py2, rp) => { const a = P(px1, py1), b = P(px2, py2); return { x1: a[0], z1: a[1], x2: b[0], z2: b[1], r: rp * PS }; };
  /* biome keys are interpreted by terrain.js (ground colours) and scenery.js (vegetation); `scatter` overrides the open-field mob table */
  W.zones = [
    { id: 'meadow', name: 'Taşkale Çayırları', lv: [1, 4], biome: 'meadow', label: P(150, 392), caps: [
      cap(150, 332, 150, 392, 54), cap(105, 385, 195, 420, 36), cap(110, 270, 195, 270, 30),
    ] },
    { id: 'warren', name: 'Tavşan İni', lv: [2, 5], biome: 'warren', label: P(213, 336), caps: [
      cap(208, 312, 224, 346, 24),
    ] },
    { id: 'wolfwood', name: 'Kurt Ormanı', lv: [5, 9], biome: 'wolfwood', label: P(80, 300), caps: [
      cap(78, 262, 88, 300, 36), cap(88, 300, 86, 428, 40),
    ] },
    { id: 'shadow', name: 'Gölge Orman', lv: [9, 14], biome: 'shadow', label: P(84, 480), caps: [
      cap(86, 428, 80, 500, 38), cap(80, 500, 92, 566, 38), cap(92, 566, 112, 600, 30),
    ] },
    { id: 'creek', name: 'Akarova Ovası', lv: [3, 6], biome: 'creek', label: P(130, 196), caps: [
      cap(60, 205, 215, 205, 40), cap(58, 112, 60, 190, 28), cap(100, 150, 170, 180, 34),
    ] },
    { id: 'hills', name: 'Rüzgâr Tepeleri', lv: [6, 10], biome: 'hills', label: P(230, 150), caps: [
      cap(170, 125, 270, 150, 46), cap(210, 190, 300, 205, 32),
    ] },
    { id: 'pinewood', name: 'Kuzey Karaçamları', lv: [10, 14], biome: 'shadow', label: P(190, 68), caps: [
      cap(75, 62, 130, 58, 30), cap(130, 58, 290, 60, 32),
    ] },
    { id: 'fortland', name: 'Kızıl Kale Yaylası', lv: [11, 15], biome: 'hills', scatter: [['goblin_warrior', 0.35], ['goblin_brute', 0.25], ['panther', 0.2], ['bear', 0.2]], label: P(345, 110), caps: [
      cap(322, 72, 348, 150, 40), cap(338, 150, 350, 225, 34),
    ] },
    { id: 'isle', name: 'Kutsal Ada', lv: [13, 16], biome: 'hills', scatter: [['troll', 0.4], ['panther', 0.3], ['goblin_brute', 0.3]], label: P(410, 150), caps: [
      cap(410, 92, 410, 190, 20),
    ] },
    { id: 'marsh', name: 'Sis Bataklığı', lv: [8, 12], biome: 'marsh', label: P(348, 330), caps: [
      cap(300, 290, 372, 292, 32), cap(372, 292, 372, 420, 42), cap(280, 300, 300, 330, 28),
      cap(412, 238, 410, 330, 10), cap(410, 330, 412, 400, 10),
    ] },
    { id: 'coast', name: 'Kıyı Kayalıkları', lv: [10, 13], biome: 'hills', scatter: [['goblin_warrior', 0.3], ['snake_dune', 0.25], ['panther', 0.25], ['bear', 0.2]], label: P(345, 490), caps: [
      cap(366, 420, 358, 548, 52), cap(412, 400, 416, 450, 10), cap(416, 450, 423, 500, 10), cap(423, 500, 433, 548, 10),
    ] },
    { id: 'southfen', name: 'Güney Sazlığı', lv: [6, 9], biome: 'creek', scatter: [['boar', 0.3], ['wolf', 0.3], ['stag', 0.25], ['snake', 0.15]], label: P(235, 480), caps: [
      cap(195, 440, 265, 468, 40), cap(245, 468, 300, 520, 42), cap(158, 462, 214, 520, 32), cap(214, 520, 262, 548, 30),
    ] },
    { id: 'deepwood', name: 'Yaban Koru', lv: [9, 13], biome: 'wolfwood', scatter: [['wolf_dark', 0.3], ['boar_black', 0.3], ['bear', 0.2], ['panther', 0.2]], label: P(290, 548), caps: [
      cap(262, 520, 300, 575, 40), cap(300, 530, 336, 556, 32),
    ] },
  ];
  W.zoneById = {}; for (const z of W.zones) W.zoneById[z.id] = z;

  /* ------------------------------------------------ relief (Metin2: a flat plain with swells and climbable hills) ------------------------------------------------ */
  /* walkable hills { x, z, r, h }: profile 0 at the rim.  hl(px, py, rpx, h, k?) */
  const hl = (px, py, rp, h, k) => { const q = P(px, py); return { x: q[0], z: q[1], r: rp * PS, h, k }; };
  W.hills = [
    // castle meadow: gentle swells round the town
    hl(108, 372, 16, 7), hl(196, 405, 14, 6.5), hl(120, 440, 14, 8), hl(70, 330, 12, 7),
    // west forest ridge-lets
    hl(60, 285, 11, 9), hl(95, 365, 12, 10), hl(64, 410, 12, 9),
    // shadow forest
    hl(70, 470, 14, 12), hl(100, 520, 13, 11), hl(70, 560, 12, 10),
    // warren knolls
    hl(236, 345, 8, 5), hl(200, 300, 8, 5),
    // north plains (creek)
    hl(90, 190, 16, 9), hl(170, 190, 14, 8), hl(62, 150, 12, 10),
    // windswept hills: the real hills
    hl(190, 112, 20, 16), hl(255, 130, 18, 18), hl(215, 175, 14, 12), hl(285, 195, 14, 10),
    // north pinewood
    hl(110, 60, 14, 12), hl(200, 55, 16, 14), hl(265, 62, 14, 11),
    // fortland
    hl(335, 110, 14, 13), hl(345, 190, 12, 9),
    // isle
    hl(410, 120, 12, 11), hl(410, 170, 10, 8),
    // marsh dunes
    hl(325, 300, 10, 5), hl(352, 380, 10, 6),
    // coast + south
    hl(342, 470, 12, 12), hl(344, 520, 11, 10), hl(225, 455, 12, 7), hl(270, 495, 14, 9), hl(290, 545, 13, 11), hl(320, 545, 10, 8),
  ];
  /* dead-flat pads (settlements, landmarks: their buildings are built at y = 0) */
  W.pads = [
    { x: 0, z: 180, r: 44 },                       // the great plaza
    { x: -150, z: 236, r: 62 },                    // farm + windmill
    { x: -20, z: 340, r: 30 },                     // mill
    { x: 0, z: 78, r: 40 },                        // gate
    { x: 600, z: -621, r: 52 },                    // goblin fortress
    { x: 30, z: -636, r: 30 },                     // standing stones
    { x: 799, z: 24, r: 40 },                      // dock
    { x: -270, z: 114, r: 24 },                    // wolf den
    { x: -204, z: 618, r: 34 },                    // the Ancient Tree
    { x: 780, z: -560, r: 34 },                    // the isle shrine
    { x: 178, z: 66, r: 7 },                       // warren signpost
  ];

  /* non-walkable rock outcrops / mounds inside the plains: round, profile 0 at the rim */
  const isl = (px, py, rp, h, extra) => { const q = P(px, py); return Object.assign({ x: q[0], z: q[1], r: rp * PS, h }, extra || {}); };
  W.islands = [
    // grey rock massifs of the north plains (the reference's rocky lumps)
    isl(255, 130, 6, 30, { tower: true }), isl(300, 152, 5, 22), isl(150, 205, 5, 20), isl(120, 160, 4, 16), isl(180, 150, 4, 14),
    isl(235, 195, 4, 16), isl(350, 70, 4, 18), isl(240, 80, 4, 15),
    // castle side crags
    isl(100, 300, 4, 15), isl(120, 455, 4, 17), isl(70, 380, 3.5, 14), isl(88, 545, 4, 17), isl(60, 500, 3.5, 14),
    // warren burrow hillocks (rabbit mounds you can see but not climb)
    isl(205, 318, 2.2, 5.5), isl(235, 322, 2.2, 5.5), isl(226, 352, 2.2, 5), isl(202, 345, 2, 5), isl(216, 304, 2, 4.5),
    // east side
    isl(335, 250, 4, 13), isl(360, 350, 3.5, 11), isl(345, 450, 4, 15), isl(320, 530, 4, 14), isl(260, 540, 3.5, 12), isl(225, 485, 3.5, 11),
    // marsh dry hummocks
    isl(312, 330, 3, 5), isl(340, 400, 3, 5),
  ];

  /* mountain amplitude anchors: [x, z, extra height, radius] on top of the base ridge height */
  W.baseAmp = 46;
  W.ampAnchors = [
    [-300, -500, 40, 380], [800, -700, 30, 360], [-380, 700, 34, 340], [500, 900, 26, 360], [0, -980, 34, 360], [-560, 100, 26, 280],
  ];

  /* ------------------------------------------------ rivers / lakes ------------------------------------------------ */
  const RIVER_DEPTH = 1.15, RIVER_BANK = 3.0, WATER_Y = -0.55;
  W.WATER_Y = WATER_Y; W.RIVER_BANK = RIVER_BANK;
  const pts = (list) => list.map(([a, b]) => P(a, b));
  W.rivers = [
    // the great river: from the west edge north of the castle, round its north-east, then south-west to the south edge
    { id: 'akar', name: 'Akardere', w: 13, pts: pts([[-10, 213], [40, 232], [100, 237], [150, 243], [186, 251], [225, 268], [255, 292], [262, 320], [249, 344], [222, 373], [205, 399], [180, 431], [150, 463], [130, 506], [121, 560], [108, 640]]) },
    // the strait that cuts the Holy Isle off from the fortland (runs to the sea)
    { id: 'bogaz', name: 'Ada Boğazı', w: 15, pts: pts([[386, 60], [386, 120], [385, 170], [386, 205], [410, 218], [450, 222]]) },
  ];
  W.lakes = [
    // the eastern sea (overlapping ellipses = a living coast line)
    { id: 'deniz', name: 'Doğu Denizi', x: P(490, 330)[0], z: P(490, 330)[1], rx: 72 * PS, rz: 300 * PS, rot: 0, kind: 'lake' },
    // inland ponds
    { id: 'aynagol', name: 'Aynagöl', x: P(115, 175)[0], z: P(115, 175)[1], rx: 58, rz: 38, rot: 0.2, kind: 'lake' },
    { id: 'sazlik', name: 'Sazlık Gölü', x: P(215, 495)[0], z: P(215, 495)[1], rx: 26, rz: 18, rot: 0.4, kind: 'pond' },
    { id: 'pool1', name: 'Bataklık Gölcüğü', x: P(325, 340)[0], z: P(325, 340)[1], rx: 26, rz: 18, rot: 0.3, kind: 'swamp' },
    { id: 'pool2', name: 'Bataklık Gölcüğü', x: P(345, 372)[0], z: P(345, 372)[1], rx: 22, rz: 15, rot: -0.5, kind: 'swamp' },
    { id: 'pool3', name: 'Bataklık Gölcüğü', x: P(330, 410)[0], z: P(330, 410)[1], rx: 28, rz: 18, rot: 0.1, kind: 'swamp' },
    { id: 'pool4', name: 'Bataklık Gölcüğü', x: P(358, 300)[0], z: P(358, 300)[1], rx: 20, rz: 14, rot: 0.9, kind: 'swamp' },
    { id: 'pool5', name: 'Bataklık Gölcüğü', x: P(318, 285)[0], z: P(318, 285)[1], rx: 18, rz: 13, rot: -0.2, kind: 'swamp' },
    { id: 'pool6', name: 'Dere Gölcüğü', x: P(240, 505)[0], z: P(240, 505)[1], rx: 16, rz: 11, rot: 0.2, kind: 'pond' },
  ];

  /* ------------------------------------------------ roads ------------------------------------------------ */
  /* kind: 'dirt' (4.4 m, the village's own road style), 'path' (footpath). Bridges appear on every road x river crossing. */
  const ring = (cx, cy, rp, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push(P(cx + Math.cos(a) * rp, cy + Math.sin(a) * rp)); } return o; };
  W.roads = [
    { id: 'gate', w: 4.4, kind: 'dirt', pts: [[0, 117], [0, 160]] },
    { id: 'plaza', w: 16, kind: 'dirt', pts: ring(150, 382, 6.5, 14) },                    // the great round plaza
    // south road: plaza -> main (south) bridge -> south-east lands -> deep wood
    { id: 'main', w: 5, kind: 'dirt', pts: pts([[150, 388], [150, 420], [152, 450], [158, 478], [175, 505], [205, 533], [245, 556], [285, 580]]) },
    // west road: plaza -> west bank forest -> north-west bridge -> north plains
    { id: 'west', w: 4.4, kind: 'dirt', pts: pts([[145, 384], [118, 388], [96, 385], [80, 362], [76, 322], [76, 282], [76, 254], [76, 232], [72, 205], [62, 180], [58, 150], [70, 112], [96, 80]]) },
    // south-west branch: west bank -> shadow forest
    { id: 'wsouth', w: 4.4, kind: 'dirt', pts: pts([[96, 386], [90, 430], [85, 480], [84, 520], [92, 560], [108, 595]]) },
    // east road: plaza -> south bridge -> marsh coast -> north along the coast to the fortland
    { id: 'east', w: 4.4, kind: 'dirt', pts: pts([[155, 382], [190, 380], [214, 386], [250, 372], [300, 358], [335, 346], [350, 310], [350, 260], [346, 210], [340, 160], [336, 110]]) },
    // north road: plaza -> round the castle -> north bridge -> north plains hub -> pinewood
    { id: 'north', w: 4.4, kind: 'dirt', pts: pts([[158, 378], [180, 362], [202, 336], [208, 300], [198, 266], [190, 252], [188, 226], [184, 190], [182, 150], [178, 110], [182, 66]]) },
    // east bridge road: warren -> east bridge -> marsh
    { id: 'ebridge', w: 4.4, kind: 'dirt', pts: pts([[210, 320], [236, 312], [262, 307], [290, 304], [322, 302], [350, 304]]) },
    // north plains ring
    { id: 'nring', w: 4.4, kind: 'dirt', pts: pts([[58, 150], [75, 105], [110, 78], [182, 66], [260, 70], [322, 92], [340, 140], [340, 200]]) },
    { id: 'ncross', w: 3.6, kind: 'dirt', pts: pts([[182, 150], [225, 154], [270, 156], [300, 182], [338, 192]]) },
    { id: 'nwest', w: 3.6, kind: 'dirt', pts: pts([[184, 190], [140, 196], [96, 198], [62, 182]]) },
    // holy-isle bridge
    { id: 'isle', w: 4.4, kind: 'dirt', pts: pts([[340, 150], [372, 150], [390, 150], [410, 140], [410, 100]]) },
    // south-east loops
    { id: 'sloop', w: 3.6, kind: 'dirt', pts: pts([[205, 533], [250, 500], [290, 480], [330, 470], [344, 450]]) },
    { id: 'coastroad', w: 3.6, kind: 'dirt', pts: pts([[350, 420], [346, 470], [340, 520], [324, 553], [290, 580]]) },
    { id: 'farm', w: 3, kind: 'path', pts: pts([[145, 384], [128, 398], [108, 400]]) },
  ];

  /* ------------------------------------------------ creature camps ------------------------------------------------ */
  /* [id, name, species, px, py, r, count]  (reference pixels). Species come from creatures/defs.js + variants + species/*.js. */
  const C = [];
  const camp = (id, name, species, px, py, r, count) => { const q = P(px, py); C.push({ id, name, species, cx: q[0], cz: q[1], r, count }); };
  const campM = (id, name, species, cx, cz, r, count) => C.push({ id, name, species, cx, cz, r, count });
  // --- castle meadows (1-4) ---
  camp('rat_a', 'Sıçan Çayırı', 'rat', 112, 396, 12, 8);
  camp('rat_b', 'Çayır Kıyısı', 'rat', 192, 398, 11, 7);
  camp('rat_c', 'Değirmen Arkası', 'rat', 135, 440, 11, 7);
  camp('rat_d', 'Batı Otlakları', 'rat', 96, 424, 12, 7);
  camp('rat_e', 'Kale Duvarı Dibi', 'rat', 108, 345, 10, 6);
  camp('rat_f', 'Kuzey Çayırı', 'rat', 140, 270, 11, 6);
  camp('snk_a', 'Taşlık Yılanları', 'snake', 118, 432, 11, 5);
  camp('snk_b', 'Dere Dirseği', 'snake', 172, 428, 10, 5);
  campM('rab_a', 'Havuç Bahçeleri', 'rabbit', 160, -8, 10, 6);
  campM('rab_b', 'Kuzey İnleri', 'rabbit', 222, -8, 10, 6);
  campM('rab_c', 'Doğu İnleri', 'rabbit', 228, 48, 10, 6);
  campM('rab_d', 'Derin İn', 'rabbit', 168, 50, 10, 6);
  campM('rab_e', 'Kök Yuvası', 'rabbit', 192, -34, 9, 5);
  campM('rab_king', 'Kral Yuvası', 'rabbit_king', 192, 20, 5, 1);
  // --- castle gate + plaza apron (Metin2: the first mobs stand right outside the village; they are in view range, 95 m, of the gate and plaza) ---
  campM('rat_g', 'Plaza Batısı', 'rat', -42, 153, 8, 5);
  campM('rab_g', 'Plaza Doğusu', 'rabbit', 42, 153, 8, 5);
  campM('rat_h', 'Batı Sur Dibi', 'rat', -130, 112, 9, 5);
  campM('rab_h', 'Doğu Sur Dibi', 'rabbit', 130, 112, 9, 5);
  campM('snk_g', 'Çiftlik Yolu', 'snake', -112, 172, 9, 4);
  campM('rat_i', 'Doğu Otlağı', 'rat', 112, 178, 9, 5);
  campM('rat_j', 'Güney Çayırı', 'rat', -30, 262, 8, 5);
  campM('rab_j', 'Yol Kenarı', 'rabbit', 32, 262, 8, 5);
  // --- west forest (5-9) ---
  camp('boar_a', 'Orman Girişi', 'boar', 66, 268, 12, 5);
  camp('boar_b', 'Kütük Açıklığı', 'boar', 62, 322, 12, 5);
  camp('boar_c', 'Meşe Dibi', 'boar', 92, 300, 11, 5);
  camp('wolf_a', 'Kurt Patikası', 'wolf', 66, 354, 12, 5);
  camp('wolf_b', 'Kurt Bozkırı', 'wolf', 100, 392, 11, 5);
  camp('wolf_c', 'Uluma Kayalığı', 'wolf', 60, 396, 13, 6);
  camp('wolf_d', 'Kurt İni', 'wolf', 62, 362, 11, 5);
  camp('stag_a', 'Geyik Yamacı', 'stag', 90, 336, 12, 4);
  camp('wolf_e', 'Gece Yuvası', 'wolf', 82, 270, 11, 5);
  // --- north-west creek plains (3-6) ---
  camp('snk_n1', 'Göl Kamışlığı', 'snake', 80, 178, 11, 5);
  camp('snk_n2', 'Batı Sazlığı', 'snake', 118, 218, 11, 5);
  camp('boar_n1', 'Ova Domuzları', 'boar', 150, 192, 12, 5);
  camp('boar_n2', 'Kuzey Koruluğu', 'boar', 195, 200, 12, 5);
  camp('boar_n3', 'Dere Ormanı', 'boar', 66, 214, 11, 5);
  camp('boar_n4', 'Köşe Açıklığı', 'boar', 60, 150, 11, 5);
  camp('wolf_n1', 'Kuzeybatı Kurtları', 'wolf', 60, 120, 12, 5);
  camp('stag_n1', 'Ova Geyikleri', 'stag', 100, 160, 11, 4);
  // --- windswept hills (6-10) ---
  camp('wolf_h1', 'Rüzgâr Otlağı', 'wolf', 180, 176, 11, 5);
  camp('wolf_h2', 'Tepe Kurtları', 'wolf', 205, 130, 11, 5);
  camp('gob_a', 'Tepe Gözcüleri', 'goblin', 235, 160, 12, 6);
  camp('gob_b', 'Goblin Karakolu', 'goblin', 285, 175, 13, 6);
  camp('gob_c', 'Yıkık Kule Kampı', 'goblin', 252, 150, 11, 5);
  camp('gob_d', 'Taş Çember Kampı', 'goblin', 165, 122, 12, 6);
  camp('stag_h1', 'Boynuz Geçidi', 'stag', 215, 105, 11, 4);
  camp('stag_h2', 'Sis Otlağı', 'stag', 300, 205, 11, 4);
  camp('boss_spike', 'Dikensırt İni', 'spikeback', 190, 90, 6, 1);
  // --- north pinewood (10-14) ---
  camp('pw_a', 'Karaçam Patikası', 'wolf_dark', 100, 62, 12, 5);
  camp('pw_b', 'Kök Çukuru', 'boar_black', 150, 52, 12, 5);
  camp('pw_c', 'Gölge Çalılığı', 'wolf_dark', 205, 60, 12, 5);
  camp('pw_d', 'Kara Domuz Yuvası', 'boar_black', 250, 62, 12, 5);
  camp('pw_e', 'Ayı Mağaraları', 'bear', 125, 75, 11, 4);
  camp('pw_f', 'Kayalık Ayıları', 'bear', 225, 78, 11, 4);
  camp('boss_alpha', 'Karakulak İni', 'wolf_alpha', 170, 40, 6, 1);
  camp('alpha_pack', 'Karakulak Sürüsü', 'wolf_dark', 160, 56, 10, 4);
  // --- fortland (11-15) ---
  camp('gw_a', 'Kale Yolu', 'goblin_warrior', 342, 190, 12, 6);
  camp('gw_b', 'Kızıl Gözcüler', 'goblin_warrior', 336, 145, 12, 6);
  camp('gw_c', 'Kale Önü', 'goblin_warrior', 330, 100, 12, 6);
  camp('gb_a', 'Kale İçi', 'goblin_brute', 345, 118, 12, 6);
  camp('gb_b', 'Mızrak Avlusu', 'goblin_brute', 338, 85, 11, 5);
  camp('gb_c', 'Kemik Ocağı', 'goblin_brute', 348, 160, 11, 5);
  camp('cat_f', 'Kızıl Çıkıntı', 'panther', 326, 215, 11, 3);
  camp('boss_gob', 'Kemikkıran Tahtı', 'goblin_chief', 348, 112, 5, 1);
  camp('boss_red', 'Kızıl Dikensırt Yatağı', 'spike_red', 335, 70, 7, 1);
  // --- holy isle (13-16) ---
  camp('trl_i1', 'Ada Trolleri', 'troll', 410, 112, 12, 3);
  camp('trl_i2', 'Taş Troller', 'troll', 410, 160, 11, 3);
  camp('cat_i1', 'Kutsal Pusu', 'panther', 408, 135, 10, 3);
  // --- east marsh coast (8-12) ---
  camp('mrat_a', 'Çamur Çukurları', 'rat_swamp', 300, 298, 13, 7);
  camp('mrat_b', 'Çürük Köprü', 'rat_swamp', 335, 268, 14, 7);
  camp('mrat_c', 'Sis Gölcükleri', 'rat_swamp', 355, 330, 13, 7);
  camp('cobra_a', 'Zehirli Sazlık', 'snake_marsh', 330, 318, 13, 6);
  camp('cobra_b', 'Kara Su', 'snake_marsh', 352, 365, 13, 6);
  camp('cobra_c', 'Yosun Adası', 'snake_marsh', 318, 392, 12, 5);
  camp('cobra_d', 'Dipsiz Çamur', 'snake_marsh', 350, 412, 13, 6);
  camp('swolf_a', 'Bataklık Kıyısı', 'wolf_dark', 340, 288, 12, 5);
  camp('swolf_b', 'Sis Kurtları', 'wolf_dark', 312, 350, 12, 5);
  camp('bear_d', 'Bataklık Ayıları', 'bear', 345, 345, 12, 3);
  // --- coast cliffs (10-13) ---
  camp('gw_d', 'Sahil Gözcüleri', 'goblin_warrior', 348, 440, 12, 6);
  camp('rattler_a', 'Sıcak Kayalar', 'snake_dune', 340, 480, 12, 6);
  camp('rattler_b', 'Çıngırak Kıyısı', 'snake_dune', 342, 520, 12, 6);
  camp('cat_a', 'Puma Kayalığı', 'panther', 344, 460, 12, 4);
  camp('cat_b', 'Gölgeli Yarık', 'panther', 336, 540, 12, 4);
  // --- south fen (6-9) ---
  camp('boar_s1', 'Sazlık Domuzları', 'boar', 210, 450, 12, 5);
  camp('boar_s2', 'Dere Ormanı', 'boar', 255, 470, 12, 5);
  camp('wolf_s1', 'Güney Kurtları', 'wolf', 235, 495, 12, 5);
  camp('wolf_s2', 'Kıyı Kurtları', 'wolf', 280, 500, 12, 5);
  camp('stag_s1', 'Sazlık Geyikleri', 'stag', 270, 520, 11, 4);
  camp('snk_s1', 'Gölcük Yılanları', 'snake', 220, 470, 10, 5);
  // --- deep wood (9-13) ---
  camp('dw_a', 'Karanlık Çalılık', 'wolf_dark', 270, 540, 12, 5);
  camp('dw_b', 'Kara Domuz Yuvası', 'boar_black', 300, 560, 12, 5);
  camp('dw_c', 'Kök Çukuru', 'boar_black', 322, 548, 11, 5);
  camp('dw_d', 'Kök Ayıları', 'bear', 285, 580, 11, 4);
  camp('dw_e', 'Pusu Yarığı', 'panther', 262, 565, 11, 3);
  // --- shadowwood, south-west (9-14) ---
  camp('sw_a', 'Gölge Patikası', 'wolf_dark', 84, 445, 13, 6);
  camp('sw_b', 'Karanlık Çalılık', 'wolf_dark', 80, 480, 13, 6);
  camp('bb_a', 'Kara Domuz Yuvası', 'boar_black', 78, 515, 13, 6);
  camp('bb_b', 'Kök Çukuru', 'boar_black', 92, 545, 13, 6);
  camp('bb_c', 'Kadim Ağaç Etekleri', 'boar_black', 96, 572, 13, 6);
  camp('bear_a', 'Ayı Mağaraları', 'bear', 74, 498, 12, 4);
  camp('bear_b', 'Kök Ayıları', 'bear', 100, 590, 12, 4);
  camp('trl_a', 'Troll Geçidi', 'troll', 66, 535, 12, 3);
  camp('trl_b', 'Yosunlu Tepe', 'troll', 108, 525, 12, 3);
  camp('cat_d', 'Karanlık Pusu', 'panther', 72, 568, 11, 3);
  W.camps = C;

  /* named places for the map + scenery (x, z) */
  W.sites = {
    gate: [0, 78], plaza: [0, 180], farm: [-150, 236], mill: [-20, 340], warrenHeart: [192, 20], wolfDen: [-270, 114],
    tower: P(255, 130), stones: [30, -636], fort: [600, -621], dock: [799, 24], titan: [-204, 618], shrine: [780, -560],
  };
  W.markers = [
    ['Taşkale', 0, 0], ['Büyük Meydan', 0, 180], ['Çiftlik', -150, 236], ['Akardere Değirmeni', -20, 340], ['Tavşan İni', 192, 20],
    ['Kurt İni', -270, 114], ['Yıkık Gözcü Kulesi', P(255, 130)[0], P(255, 130)[1]], ['Taş Çember', 30, -636], ['Dikensırt İni', P(190, 90)[0], P(190, 90)[1]],
    ['Goblin Kalesi', 600, -621], ['Kutsal Ada', 780, -560], ['Sis Bataklığı', P(345, 340)[0], P(345, 340)[1]], ['İskele', 799, 24],
    ['Kadim Ağaç', -204, 618], ['Kuzey Karaçamları', P(190, 62)[0], P(190, 62)[1]], ['Yaban Koru', P(290, 550)[0], P(290, 550)[1]],
  ];

  /* ------------------------------------------------ geometry helpers ------------------------------------------------ */
  function segDist(px, pz, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz;
    const t = L2 ? clamp(((px - x1) * dx + (pz - z1) * dz) / L2, 0, 1) : 0;
    return Math.hypot(px - x1 - dx * t, pz - z1 - dz * t);
  }
  W.segDist = segDist;
  /* Catmull-Rom through control points -> dense polyline with arclength */
  function spline(pts, step) {
    const out = [], n = pts.length;
    const P = (i) => pts[clamp(i, 0, n - 1)];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), m = Math.max(2, Math.ceil(L / step));
      for (let k = 0; k < m; k++) {
        const t = k / m, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[n - 1].slice());
    let s = 0; out[0][2] = 0;
    for (let i = 1; i < out.length; i++) { s += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]); out[i][2] = s; }
    return out;
  }
  W.spline = spline;

  /* ------------------------------------------------ fields ------------------------------------------------ */
  const gi = (x, z) => ((z - B.minZ) / G) * NX + (x - B.minX) / G;
  W.sd = null; W.hgrid = null; W.riverD = null; W.wet = null; W.lakeD = null; W.zoneGrid = null;

  function bil(arr, x, z) {
    let fx = (x - B.minX) / G, fz = (z - B.minZ) / G;
    if (fx < 0) fx = 0; else if (fx > NX - 1.001) fx = NX - 1.001;
    if (fz < 0) fz = 0; else if (fz > NZ - 1.001) fz = NZ - 1.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * NX + ix;
    const a = arr[k], b = arr[k + 1], c = arr[k + NX], d = arr[k + NX + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  W.bil = bil;
  W.sdAt = (x, z) => bil(W.sd, x, z);
  W.heightAt = (x, z) => (W.hgrid ? bil(W.hgrid, x, z) : 0);
  W.inside = (x, z, m) => bil(W.sd, x, z) < -(m || 0);
  W.sdGrad = (x, z, out) => {
    const e = 1.2, gx = bil(W.sd, x + e, z) - bil(W.sd, x - e, z), gz = bil(W.sd, x, z + e) - bil(W.sd, x, z - e), l = Math.hypot(gx, gz) || 1;
    out.x = gx / l; out.z = gz / l; return out;
  };

  /* zone of a point: smallest (distance to a chamber capsule - radius); islands / lakes keep their surroundings' zone */
  W.zoneAt = function (x, z) {
    let best = null, bd = 1e9;
    for (const zn of W.zones) for (const c of zn.caps) { const d = segDist(x, z, c.x1, c.z1, c.x2, c.z2) - c.r; if (d < bd) { bd = d; best = zn; } }
    return best;
  };

  /* rivers: dense polylines + cross-section parameters */
  for (const r of W.rivers) { r.line = spline(r.pts, 4); r.hw = r.w / 2; r.length = r.line[r.line.length - 1][2]; }

  function lakeSd(L, x, z) {            // approx signed distance to the lake ellipse (negative inside)
    const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    return (Math.hypot(lx / L.rx, lz / L.rz) - 1) * Math.min(L.rx, L.rz);
  }
  W.lakeSd = lakeSd;

  const NZ0 = 1;
  W.build = function () {
    if (W.sd) return W;
    const t0 = performance.now();
    const N = NX * NZ;
    const sd = new Float32Array(N), hgrid = new Float32Array(N), riverD = new Float32Array(N).fill(1e5), wet = new Float32Array(N), lakeD = new Float32Array(N).fill(1e5);
    W.sd = sd; W.hgrid = hgrid; W.riverD = riverD; W.wet = wet; W.lakeD = lakeD;

    /* --- walkable floor signed distance (organic edges through a domain warp) --- */
    const caps = []; for (const zn of W.zones) for (const c of zn.caps) caps.push(c);
    const vb = W.village;
    const warp = (x, z) => [(V.fbm(x / 85 + 11.3, z / 85 - 4.2, 3, 0, 801) - 0.5) * 36, (V.fbm(x / 85 - 7.7, z / 85 + 9.1, 3, 0, 803) - 0.5) * 36];
    for (let j = 0; j < NZ; j++) {
      const z = B.minZ + j * G;
      for (let i = 0; i < NX; i++) {
        const x = B.minX + i * G;
        let d = 1e9;
        const q = warp(x, z), wx = x + q[0], wz = z + q[1];
        for (let k = 0; k < caps.length; k++) {
          const c = caps[k];
          // cheap reject: bbox of the capsule inflated by the current best distance
          const dd = segDist(wx, wz, c.x1, c.z1, c.x2, c.z2) - c.r;
          if (dd < d) d = dd;
        }
        // village band: exact rectangle (the village is built for it)
        const ex = Math.max(vb.minX - x, x - vb.maxX), ez = Math.max(vb.minZ - z, z - vb.maxZ);
        const bd = ex > 0 && ez > 0 ? Math.hypot(ex, ez) : Math.max(ex, ez);
        if (bd < d) d = bd;
        sd[j * NX + i] = d;
      }
    }
    // islands (non-walkable hills) + lakes cut out of the floor
    for (const I of W.islands) {
      const R = I.r + 6, i0 = Math.max(0, Math.floor((I.x - R - B.minX) / G)), i1 = Math.min(NX - 1, Math.ceil((I.x + R - B.minX) / G));
      const j0 = Math.max(0, Math.floor((I.z - R - B.minZ) / G)), j1 = Math.min(NZ - 1, Math.ceil((I.z + R - B.minZ) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = B.minX + i * G, z = B.minZ + j * G, d = I.r - Math.hypot(x - I.x, z - I.z);
        const k = j * NX + i; if (d > sd[k]) sd[k] = d;
      }
    }
    for (const L of W.lakes) {
      const R = Math.max(L.rx, L.rz) + 14, i0 = Math.max(0, Math.floor((L.x - R - B.minX) / G)), i1 = Math.min(NX - 1, Math.ceil((L.x + R - B.minX) / G));
      const j0 = Math.max(0, Math.floor((L.z - R - B.minZ) / G)), j1 = Math.min(NZ - 1, Math.ceil((L.z + R - B.minZ) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = B.minX + i * G, z = B.minZ + j * G, s = lakeSd(L, x, z), k = j * NX + i;
        lakeD[k] = Math.min(lakeD[k], s);
        const ex = 3.2 - s;                              // blocked: the lake + a 3 m wet margin
        if (ex > sd[k]) sd[k] = ex;
      }
    }
    /* --- rivers: carve + wetness, blocked band stored in the sd as well --- */
    for (const r of W.rivers) {
      const reach = r.hw + RIVER_BANK + 10;
      for (let s = 0; s < r.line.length - 1; s++) {
        const a = r.line[s], b = r.line[s + 1];
        const x0 = Math.min(a[0], b[0]) - reach, x1 = Math.max(a[0], b[0]) + reach, z0 = Math.min(a[1], b[1]) - reach, z1 = Math.max(a[1], b[1]) + reach;
        const i0 = Math.max(0, Math.floor((x0 - B.minX) / G)), i1 = Math.min(NX - 1, Math.ceil((x1 - B.minX) / G));
        const j0 = Math.max(0, Math.floor((z0 - B.minZ) / G)), j1 = Math.min(NZ - 1, Math.ceil((z1 - B.minZ) / G));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = B.minX + i * G, z = B.minZ + j * G, d = segDist(x, z, a[0], a[1], b[0], b[1]) - r.hw, k = j * NX + i;
          if (d < riverD[k]) riverD[k] = d;
        }
      }
    }
    for (let k = 0; k < N; k++) {
      const d = riverD[k];
      if (d < 20) wet[k] = 1 - smooth(RIVER_BANK * 0.6, RIVER_BANK + 7, Math.max(0, d));
      if (d < 0.75 * RIVER_BANK) { const ex = 0.75 * RIVER_BANK - d; /* blocked: water + most of the bank */ if (ex > sd[k]) sd[k] = ex - 0.0; }
    }
    // lake wetness / mud ring
    for (let k = 0; k < N; k++) { const s = lakeD[k]; if (s < 16) wet[k] = Math.max(wet[k], 1 - smooth(1, 14, Math.max(0, s))); }
    if (W.stampBridges) W.stampBridges();
    W.buildHeights();
    W.snapCamps();
    W.fieldMs = performance.now() - t0;
    return W;
  };

  /* Metin2-style open-field mobs: small groups scattered over the whole valley floor (on top of the authored camps).
     Species by zone; deterministic; kept off the village approach, roads, landmarks, bridges and the authored camps. */
  const SCATTER = {
    meadow:   [['rat', 0.6], ['rabbit', 0.4]],
    warren:   [['rabbit', 0.85], ['rat', 0.15]],
    creek:    [['snake', 0.3], ['boar', 0.35], ['rat', 0.15], ['rabbit', 0.2]],
    wolfwood: [['wolf', 0.5], ['boar', 0.3], ['stag', 0.2]],
    hills:    [['goblin', 0.3], ['wolf', 0.2], ['stag', 0.3], ['boar', 0.2]],
    marsh:    [['rat_swamp', 0.35], ['snake_marsh', 0.35], ['wolf_dark', 0.2], ['bear', 0.1]],
    shadow:   [['wolf_dark', 0.3], ['boar_black', 0.3], ['bear', 0.15], ['panther', 0.15], ['troll', 0.1]],
  };
  W.SCATTER_CAMPS = 1000;                // ~1 mob per 200 m2 on the open floor: a 40 m camera view always shows a pack or two
  W.scatterCamps = function () {
    if (W.scattered) return; W.scattered = true;
    const R = V.rng(20261105), out = [];
    const sites = Object.values(W.sites);
    let tries = 0;
    while (out.length < W.SCATTER_CAMPS && tries++ < 200000) {
      const x = lerp(W.region.minX, W.region.maxX, R()), z = lerp(W.region.minZ, W.region.maxZ, R());
      const r = 9;
      if (W.sdAt(x, z) > -(r * 0.75 + 3)) continue;
      if (Math.hypot(x, z - 180) < 60 || (x > -112 && x < 112 && z > -112 && z < 150)) continue;       // the village and the great plaza stay calm
      if (W.roadD && W.roadD[0] !== undefined && W.bil(W.roadD, x, z) < 4) continue;
      if (sites.some((p) => Math.hypot(p[0] - x, p[1] - z) < 28)) continue;
      if (W.bridges && W.bridges.some((b) => Math.hypot(b.x - x, b.z - z) < 20)) continue;
      if (W.camps.some((c) => Math.hypot(c.cx - x, c.cz - z) < c.r + 18)) continue;
      if (out.some((c) => Math.hypot(c.cx - x, c.cz - z) < 28)) continue;
      const zn = W.zoneAt(x, z); if (!zn) continue;
      const tab = zn.scatter || SCATTER[zn.biome]; if (!tab) continue;
      let u = R(), sp = tab[0][0]; for (const [id, p] of tab) { if (u < p) { sp = id; break; } u -= p; }
      out.push({ id: 'rnd_' + out.length, name: zn.name, species: sp, cx: x, cz: z, r, count: 3 + Math.floor(R() * 3) });
    }
    for (const c of out) W.camps.push(c);
    W.scatterCount = out.length;
  };

  /* camps must sit well inside the valley floor (their radius fits): nudge along the floor gradient */
  W.snapCamps = function () {
    const g = { x: 0, z: 0 }; W.snapped = [];
    for (const c of W.camps) {
      const need = c.r * 0.75 + 3; let moved = 0;
      for (let it = 0; it < 80; it++) {
        const s = W.sdAt(c.cx, c.cz); if (s < -need) break;
        W.sdGrad(c.cx, c.cz, g); const k = Math.min(10, s + need + 0.5); c.cx -= g.x * k; c.cz -= g.z * k; moved += k;
      }
      if (moved > 0.5) W.snapped.push(c.id + ' ' + moved.toFixed(0) + 'm');
    }
  };

  /* ------------------------------------------------ heights ------------------------------------------------ */
  W.ampAt = function (x, z) {
    let a = W.baseAmp;
    for (const [ax, az, da, rr] of W.ampAnchors) { const d = Math.hypot(x - ax, z - az) / rr; if (d < 2.4) a += da * Math.exp(-d * d); }
    return a;
  };
  function islandBump(x, z) {
    let h = 0;
    for (const I of W.islands) {
      const dx = x - I.x, dz = z - I.z; if (dx > I.r || dx < -I.r || dz > I.r || dz < -I.r) continue;
      const d = Math.hypot(dx, dz); if (d >= I.r) continue;
      const t = 1 - smooth(0.0, 1.0, d / I.r);                  // 1 in the middle, 0 at the rim
      const n = 0.85 + 0.3 * V.fbm(x / 9 + I.x, z / 9, 2, 0, 811);
      h = Math.max(h, I.h * Math.pow(t, 0.8) * n);
    }
    return h;
  }
  W.islandBump = islandBump;
  const ridged = (x, z, s, seed) => { const n = V.fbm(x / s, z / s, 3, 0, seed); return 1 - Math.abs(n * 2 - 1); };

  /* ---- WALKABLE RELIEF (Metin2 logic: a mostly open plain with rolling swells and climbable hills) ----
     The hero stays at y = 0 in the game frame; village/scene.js shifts the whole world group by -W.yBase each frame
     (W.yBase = ground height under the hero), so every effect that is authored at "y = 0" still sits on the ground
     next to the hero.  W.heightAt(x, z) is the TRUE height; W.frameY(x, z) = heightAt - yBase is the frame height.  */
  W.yBase = 0;
  /* walking height: the terrain height, except on a bridge deck (the river bed is carved far below the deck, the deck top is y = 0) */
  W.walkY = (x, z) => {
    if (!W.hgrid) return 0;
    if (W.deck) { const i = Math.round((x - B.minX) / G), j = Math.round((z - B.minZ) / G); if (i >= 0 && i < NX && j >= 0 && j < NZ && W.deck[j * NX + i]) return 0; }
    return bil(W.hgrid, x, z);
  };
  W.frameY = (x, z) => W.walkY(x, z) - W.yBase;
  W.hills = W.hills || [];                  // walkable hills { x, z, r, h, k? }: profile 0 at the rim, h in the middle
  W.pads = W.pads || [];                    // dead-flat settlement pads { x, z, r }: height stays 0 inside r, fades out over 30 m
  W.SLOPE_MAX = 0.62;                       // steeper floor cells become non-walkable (rock faces)
  const rectDist = (x, z, b) => { const ex = Math.max(b.minX - x, x - b.maxX), ez = Math.max(b.minZ - z, z - b.maxZ); return ex > 0 && ez > 0 ? Math.hypot(ex, ez) : Math.max(ex, ez); };
  function hillBump(x, z) {
    let h = 0;
    for (const H of W.hills) {
      const dx = x - H.x, dz = z - H.z, R = H.r * (H.rz ? 1 : 1);
      if (dx > R * 1.3 || dx < -R * 1.3 || dz > R * 1.3 || dz < -R * 1.3) continue;
      // slightly noisy rim so hills are never perfect cones
      const d = Math.hypot(dx, dz) / (R * (0.9 + 0.2 * V.fbm(x / 60 + H.x, z / 60 + H.z, 2, 0, 821)));
      if (d >= 1) continue;
      const t = 1 - smooth(0, 1, d);
      h = Math.max(h, H.h * Math.pow(t, H.k || 1.15));
    }
    return h;
  }
  W.hillBump = hillBump;
  function floorRelief(x, z, s) {                      // s = signed distance (<0 inside the floor)
    let f = smooth(2, 46, -s);                         // fades to 0 at the valley rim (mountains take over there)
    const vd = rectDist(x, z, W.village); if (vd < 46) f *= smooth(0, 46, vd);      // the village band is dead flat
    for (const P of W.pads) { const d = Math.hypot(x - P.x, z - P.z) - P.r; if (d < 30) f *= smooth(0, 30, d); }
    if (f <= 0.001) return 0;
    const n = V.fbm(x / 150 + 21.7, z / 150 - 8.3, 3, 0, 831), m = V.fbm(x / 47 + 5.1, z / 47 + 12.9, 2, 0, 833);
    return f * ((n - 0.5) * 5.2 + (m - 0.5) * 1.1 + hillBump(x, z));
  }

  W.buildHeights = function () {
    const sd = W.sd, hg = W.hgrid, riverD = W.riverD, lakeD = W.lakeD;
    for (let j = 0; j < NZ; j++) {
      const z = B.minZ + j * G;
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i, x = B.minX + i * G, s = sd[k];
        let h = 0;
        if (s <= 0.02) h = floorRelief(x, z, s);
        if (s > 0.02) {
          const isl = islandBump(x, z);
          if (isl > 0.01) h = isl;
          else {
            const rw = 34 + 26 * V.fbm(x / 300 + 3, z / 300, 2, 0, 805);
            const t = clamp((s - 0.02) / rw, 0, 1), pr = Math.pow(t * t * (3 - 2 * t), 0.78);
            const amp = W.ampAt(x, z);
            const n = 0.5 * V.fbm(x / 140 + 5.5, z / 140 - 2.5, 3, 0, 807) + 0.5 * ridged(x + 33, z - 71, 95, 809);
            const peak = amp * (0.35 + 1.0 * n) * (0.75 + 0.5 * smooth(0, 160, s));
            h = pr * peak + smooth(0, 24, s) * (V.fbm(x / 11, z / 11, 2, 0, 813) - 0.5) * 3.2;
          }
        }
        // carved water: rivers + lakes (below the walkable ground, never touching walkable cells)
        const dr = riverD[k];
        if (dr < RIVER_BANK) h = Math.min(h, -RIVER_DEPTH * (1 - smooth(0, RIVER_BANK, Math.max(0, dr))) + (dr < 0 ? -0.15 * smooth(0, -3, dr) : 0));
        const dl = lakeD[k];
        if (dl < 6) h = Math.min(h, -1.9 * (1 - smooth(-2, 6, dl)) * smooth(6, 0, dl) - 0.0 + (dl < 0 ? -0.2 : 0));
        hg[k] = h;
      }
    }
    // floor cells that turned out too steep (relief noise + hills) become rock: blocked in the floor mask, collision and nav follow
    let steep = 0;
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = j * NX + i; if (sd[k] > 0.02) continue;
      const gx = (hg[k + 1] - hg[k - 1]) / (2 * G), gz = (hg[k + NX] - hg[k - NX]) / (2 * G), g = Math.hypot(gx, gz);
      if (g > W.SLOPE_MAX) { sd[k] = Math.max(sd[k], 0.6 + (g - W.SLOPE_MAX) * 6); steep++; }
    }
    W.steepCells = steep;
  };
})();
