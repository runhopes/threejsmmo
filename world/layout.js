/* =====================================================================================================
 *  world/layout.js  -  the open world around Taskale: zones, valleys, rivers, lakes, roads, mob camps, landmarks
 *
 *  A WoW-style overworld for levels 1-18. Everything here is DATA + analytic fields (no three.js objects):
 *
 *    W.zones      named regions (level band, biome, chambers = capsule chains that form the walkable valley floor)
 *    W.islands    non-walkable hills inside the valleys (rabbit hillocks, the ruined watchtower hill, rock stacks)
 *    W.rivers     polylines (control points + width) -> carved channels, water ribbons, colliders, bridges
 *    W.lakes      ellipses (lake, swamp pools, frozen lake)
 *    W.roads      dirt roads / footpaths; the three village exit roads are continued here
 *    W.camps      creature camps (species, centre, radius, count) -> CREATURE_DEFS.ZONES
 *    W.sites      landmark anchors consumed by scenery.js
 *
 *  Walkable ground is exactly y = 0 everywhere (the hero's foot IK needs it, see village/README.md). Elevation lives
 *  in the places nobody walks: ridges between the valleys, mountains, hilltops, river gorges (the channel is carved
 *  BELOW the ground; bridges run at y = 0).
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
  W.bounds = { minX: -860, maxX: 860, minZ: -320, maxZ: 2240 };
  W.G = 2;
  const G = W.G, B = W.bounds;
  W.NX = Math.round((B.maxX - B.minX) / G) + 1; W.NZ = Math.round((B.maxZ - B.minZ) / G) + 1;
  const NX = W.NX, NZ = W.NZ;
  /* the part of the world the map / minimap shows (valleys + a margin of hills) */
  W.region = { minX: -640, maxX: 640, minZ: -150, maxZ: 2060 };

  /* village band (walkable rectangle around the walls, see village/terrain.js): x +-102.2, z -102.2 .. 144 */
  W.village = { minX: -102.2, maxX: 102.2, minZ: -102.2, maxZ: 144 };

  /* ------------------------------------------------ valley floors ------------------------------------------------ */
  const cap = (x1, z1, x2, z2, r) => ({ x1, z1, x2, z2, r });
  /* biome keys are interpreted by terrain.js (ground colours) and scenery.js (vegetation) */
  W.zones = [
    { id: 'meadow', name: 'Taşkale Çayırları', lv: [1, 3], biome: 'meadow', label: [0, 250], caps: [
      cap(0, 150, 0, 330, 118), cap(-120, 240, -240, 300, 88), cap(0, 330, 0, 430, 92), cap(-20, 190, 100, 215, 60),
    ] },
    { id: 'warren', name: 'Tavşan İni', lv: [2, 5], biome: 'warren', label: [215, 295], caps: [
      cap(110, 235, 270, 330, 74), cap(180, 330, 250, 395, 52),
    ] },
    { id: 'creek', name: 'Akardere Vadisi', lv: [3, 6], biome: 'creek', label: [0, 500], caps: [
      cap(-340, 480, -40, 480, 84), cap(-40, 480, 330, 470, 88), cap(-70, 548, -70, 600, 52),
      cap(190, 548, 260, 628, 80), cap(0, 430, 0, 560, 50),
    ] },
    { id: 'wolfwood', name: 'Kurt Ormanı', lv: [6, 9], biome: 'wolfwood', label: [-250, 800], caps: [
      cap(-30, 545, -120, 650, 42), cap(-120, 650, -200, 740, 74), cap(-200, 740, -300, 880, 100), cap(-300, 880, -335, 990, 86),
    ] },
    { id: 'hills', name: 'Rüzgâr Tepeleri', lv: [8, 10], biome: 'hills', label: [260, 780], caps: [
      cap(110, 545, 170, 650, 44), cap(170, 650, 290, 780, 96), cap(290, 780, 335, 940, 84), cap(290, 780, 200, 880, 76),
      cap(335, 940, 345, 1010, 56),
    ] },
    { id: 'marsh', name: 'Sis Bataklığı', lv: [7, 12], biome: 'marsh', label: [-10, 960], caps: [
      cap(0, 540, 0, 690, 34), cap(0, 690, -8, 810, 50), cap(-8, 810, -25, 960, 82), cap(-25, 960, -35, 1150, 130), cap(-35, 1150, -20, 1250, 100),
    ] },
    { id: 'canyon', name: 'Kızıl Kanyon', lv: [10, 15], biome: 'canyon', label: [440, 1220], caps: [
      cap(345, 1010, 400, 1085, 46), cap(400, 1085, 440, 1160, 52), cap(440, 1160, 470, 1290, 92), cap(470, 1290, 420, 1400, 66),
      cap(420, 1400, 360, 1480, 62),
    ] },
    { id: 'shadow', name: 'Gölge Orman', lv: [9, 16], biome: 'shadow', label: [-310, 1250], caps: [
      cap(-335, 990, -355, 1180, 104), cap(-355, 1180, -300, 1350, 136), cap(-300, 1350, -170, 1405, 104), cap(-290, 1400, -270, 1470, 78),
    ] },
    { id: 'frost', name: 'Don Zirveleri', lv: [14, 18], biome: 'frost', label: [40, 1790], caps: [
      cap(-20, 1250, -5, 1390, 60), cap(-5, 1390, 25, 1600, 72), cap(25, 1600, 40, 1720, 108), cap(40, 1720, 50, 1860, 150), cap(50, 1860, 50, 1950, 100),
      cap(360, 1480, 250, 1600, 58), cap(250, 1600, 120, 1690, 72),
      cap(-170, 1405, -80, 1550, 60), cap(-80, 1550, -10, 1650, 70),
    ] },
  ];
  W.zoneById = {}; for (const z of W.zones) W.zoneById[z.id] = z;

  /* non-walkable hills inside the valleys: round mounds, the profile is 0 at the rim (walkable ground stays y = 0) */
  W.islands = [
    // rabbit hillocks ring the warren: burrow mounds you can see, not climb
    { x: 128, z: 262, r: 15, h: 6.5 }, { x: 150, z: 205, r: 12, h: 5.5 }, { x: 255, z: 222, r: 16, h: 7 }, { x: 300, z: 288, r: 13, h: 5.5 },
    { x: 272, z: 372, r: 14, h: 6.5 }, { x: 182, z: 396, r: 15, h: 7 }, { x: 128, z: 335, r: 12, h: 5 }, { x: 214, z: 262, r: 6, h: 2.6 },
    // farm knoll
    { x: -58, z: 262, r: 11, h: 4.5 },
    // creek: reed islets are lakes; oak grove boulder hill
    { x: 232, z: 584, r: 13, h: 6 },
    // wolf wood rock stacks
    { x: -225, z: 812, r: 17, h: 11 }, { x: -312, z: 940, r: 14, h: 9 },
    // windswept hills: the hill with the ruined watchtower and two lesser knolls
    { x: 232, z: 800, r: 30, h: 26, tower: true }, { x: 292, z: 700, r: 16, h: 11 }, { x: 330, z: 905, r: 14, h: 10 }, { x: 214, z: 880, r: 13, h: 9 },
    // marsh mounds (dry hummocks)
    { x: -30, z: 1010, r: 12, h: 4.5 }, { x: 35, z: 1100, r: 11, h: 4 }, { x: -70, z: 1160, r: 10, h: 4 },
    // canyon pillars
    { x: 420, z: 1120, r: 12, h: 24 }, { x: 468, z: 1330, r: 13, h: 28 }, { x: 440, z: 1215, r: 9, h: 20 }, { x: 395, z: 1440, r: 12, h: 26 },
    // shadowwood boulders
    { x: -330, z: 1105, r: 15, h: 9 }, { x: -318, z: 1290, r: 16, h: 10 }, { x: -240, z: 1380, r: 13, h: 8 },
    // frost: ice knolls
    { x: 12, z: 1700, r: 18, h: 14 }, { x: 110, z: 1790, r: 16, h: 13 }, { x: -50, z: 1830, r: 17, h: 15 },
  ];

  /* mountain amplitude anchors: [x, z, extra height, radius] on top of the base ridge height */
  W.baseAmp = 46;
  W.ampAnchors = [
    [20, 1850, 90, 460], [0, 1950, 60, 260], [450, 1250, 28, 260], [-320, 1250, 24, 260], [260, 800, -14, 260], [-10, 950, -20, 220],
    [0, 250, -16, 240], [200, 300, -10, 160], [0, -100, -10, 200], [-250, 800, 6, 200], [-400, 550, -12, 160],
  ];

  /* ------------------------------------------------ rivers / lakes ------------------------------------------------ */
  const RIVER_DEPTH = 1.15, RIVER_BANK = 3.0, WATER_Y = -0.55;
  W.WATER_Y = WATER_Y; W.RIVER_BANK = RIVER_BANK;
  W.rivers = [
    { id: 'akar', name: 'Akardere', w: 11, pts: [[860, 440], [700, 452], [560, 440], [440, 468], [330, 466], [250, 458], [140, 492], [30, 468], [-80, 500], [-190, 486], [-300, 522], [-380, 548]] },
    { id: 'gumus', name: 'Gümüşdere', w: 7, falls: true, pts: [[372, 842], [344, 770], [302, 690], [284, 612], [292, 536], [262, 470]] },
    { id: 'kara', name: 'Karadere', w: 7, pts: [[-96, 1100], [-150, 1080], [-215, 1010], [-262, 930], [-318, 840], [-376, 725], [-400, 640], [-392, 590]] },
  ];
  W.lakes = [
    { id: 'aynagol', name: 'Aynagöl', x: -430, z: 545, rx: 76, rz: 52, rot: 0.2, kind: 'lake' },
    { id: 'buzgolu', name: 'Buzgölü', x: -140, z: 1760, rx: 56, rz: 40, rot: -0.3, kind: 'ice' },
    { id: 'sazlik', name: 'Sazlık Gölü', x: -70, z: 575, rx: 22, rz: 16, rot: 0.4, kind: 'pond' },
    { id: 'pool1', name: 'Bataklık Gölcüğü', x: -60, z: 905, rx: 24, rz: 17, rot: 0.3, kind: 'swamp' },
    { id: 'pool2', name: 'Bataklık Gölcüğü', x: 30, z: 960, rx: 20, rz: 14, rot: -0.5, kind: 'swamp' },
    { id: 'pool3', name: 'Bataklık Gölcüğü', x: -75, z: 1040, rx: 26, rz: 18, rot: 0.1, kind: 'swamp' },
    { id: 'pool4', name: 'Bataklık Gölcüğü', x: 40, z: 1160, rx: 22, rz: 16, rot: 0.9, kind: 'swamp' },
    { id: 'pool5', name: 'Bataklık Gölcüğü', x: -20, z: 1215, rx: 18, rz: 13, rot: -0.2, kind: 'swamp' },
    { id: 'pool6', name: 'Bataklık Gölcüğü', x: -75, z: 1130, rx: 15, rz: 11, rot: 0.6, kind: 'swamp' },
    { id: 'pool7', name: 'Dere Gölcüğü', x: 230, z: 548, rx: 16, rz: 11, rot: 0.2, kind: 'pond' },
  ];

  /* ------------------------------------------------ roads ------------------------------------------------ */
  /* kind: 'dirt' (4.4 m, the village's own road style), 'path' (footpath). The village exit roads stop at the splat
     region; their continuations start from the same end points. */
  W.roads = [
    { id: 'main', w: 5, kind: 'dirt', pts: [[0, 305], [12, 380], [6, 440], [0, 480], [-4, 525], [0, 570]] },
    { id: 'west', w: 4.4, kind: 'dirt', pts: [[0, 570], [-60, 612], [-120, 662], [-190, 735], [-250, 805], [-300, 875], [-332, 960], [-350, 1050], [-345, 1150], [-320, 1250], [-250, 1330], [-170, 1392], [-110, 1450], [-50, 1550], [8, 1650]] },
    { id: 'east', w: 4.4, kind: 'dirt', pts: [[0, 570], [70, 592], [140, 640], [200, 700], [262, 775], [306, 870], [336, 955], [378, 1045], [425, 1125], [455, 1215], [470, 1300], [425, 1395], [340, 1490], [215, 1590], [90, 1685]] },
    { id: 'mid', w: 4.4, kind: 'dirt', pts: [[0, 570], [2, 650], [-3, 740], [-9, 850], [-20, 950], [-30, 1050], [-22, 1150], [-12, 1260], [0, 1380], [10, 1500], [22, 1600], [42, 1700], [50, 1800], [50, 1895]] },
    { id: 'sw', w: 4.4, kind: 'dirt', pts: [[-190, 269], [-232, 292], [-270, 326], [-292, 372]] },
    { id: 'se', w: 4.4, kind: 'dirt', pts: [[175, 244], [218, 276], [248, 318], [262, 352]] },
    { id: 'farm', w: 3, kind: 'path', pts: [[8, 300], [-10, 300], [-26, 306]] },
    { id: 'gate', w: 4.4, kind: 'dirt', pts: [[0, 305], [0, 117]] },
  ];

  /* ------------------------------------------------ creature camps ------------------------------------------------ */
  /* [id, name, species, cx, cz, r, count]. Species come from creatures/defs.js + creatures/variants.js. */
  const C = [];
  const camp = (id, name, species, cx, cz, r, count) => C.push({ id, name, species, cx, cz, r, count });
  // --- Taskale meadows (1-3) ---
  camp('rat_a', 'Sıçan Çayırı', 'rat', -112, 205, 12, 8);
  camp('rat_b', 'Batı Otlakları', 'rat', -178, 318, 13, 8);
  camp('rat_c', 'Değirmen Arkası', 'rat', -62, 365, 11, 7);
  camp('rat_d', 'Kapı Yanı Çayır', 'rat', 74, 198, 10, 6);
  camp('rat_e', 'Güney Otlakları', 'rat', 30, 408, 12, 7);
  camp('rab_a', 'Havuç Bahçeleri', 'rabbit', 166, 272, 12, 6);
  camp('rab_b', 'Kuzey İnleri', 'rabbit', 205, 238, 11, 6);
  camp('rab_c', 'Doğu İnleri', 'rabbit', 262, 308, 12, 6);
  camp('rab_d', 'Derin İn', 'rabbit', 224, 350, 12, 6);
  camp('rab_e', 'Kök Yuvası', 'rabbit', 160, 342, 11, 5);
  camp('rab_king', 'Kral Yuvası', 'rabbit_king', 214, 300, 5, 1);
  // --- Akardere valley (3-6) ---
  camp('snk_a', 'Sazlık', 'snake', -72, 578, 14, 6);
  camp('snk_b', 'Batı Sazlığı', 'snake', -178, 505, 11, 5);
  camp('snk_c', 'Dere Dirseği', 'snake', 118, 520, 10, 5);
  camp('snk_d', 'Kıyı Kamışlığı', 'snake', -255, 478, 11, 5);
  camp('boar_a', 'Meşe Korusu', 'boar', 190, 596, 14, 6);
  camp('boar_b', 'Meşe Dibi', 'boar', 258, 640, 12, 5);
  camp('boar_c', 'Kütük Açıklığı', 'boar', 150, 612, 11, 5);
  camp('boar_d', 'Dere Ormanı', 'boar', 232, 522, 11, 5);
  // --- Wolf wood (6-9) ---
  camp('boar_e', 'Orman Girişi', 'boar', -92, 640, 12, 5);
  camp('wolf_a', 'Kurt Patikası', 'wolf', -150, 690, 12, 5);
  camp('wolf_b', 'Kurt Bozkırı', 'wolf', -228, 770, 13, 6);
  camp('wolf_c', 'Kurt İni', 'wolf', -318, 905, 13, 6);
  camp('wolf_d', 'Uluma Kayalığı', 'wolf', -332, 1000, 13, 5);
  camp('wolf_e', 'Gece Yuvası', 'wolf', -270, 850, 11, 5);
  // --- Windswept hills (8-10) ---
  camp('wolf_f', 'Rüzgâr Otlağı', 'wolf', 190, 668, 11, 5);
  camp('gob_a', 'Tepe Gözcüleri', 'goblin', 224, 742, 12, 6);
  camp('gob_b', 'Goblin Karakolu', 'goblin', 296, 820, 13, 6);
  camp('gob_c', 'Yıkık Kule Kampı', 'goblin', 238, 852, 12, 5);
  camp('gob_d', 'Taş Çember Kampı', 'goblin', 336, 930, 12, 6);
  camp('boss_spike', 'Dikensırt İni', 'spikeback', 342, 1000, 6, 1);
  // --- Mist marsh (7-12) ---
  camp('mrat_a', 'Çamur Çukurları', 'rat_swamp', -4, 765, 13, 7);
  camp('mrat_b', 'Çürük Köprü', 'rat_swamp', 12, 860, 14, 7);
  camp('mrat_c', 'Sis Gölcükleri', 'rat_swamp', -78, 960, 13, 7);
  camp('cobra_a', 'Zehirli Sazlık', 'snake_marsh', -28, 1000, 13, 6);
  camp('cobra_b', 'Kara Su', 'snake_marsh', 42, 1050, 13, 6);
  camp('cobra_c', 'Yosun Adası', 'snake_marsh', -88, 1100, 12, 5);
  camp('cobra_d', 'Dipsiz Çamur', 'snake_marsh', 12, 1190, 13, 6);
  camp('swolf_a', 'Bataklık Kıyısı', 'wolf_dark', -130, 1020, 12, 5);
  camp('swolf_b', 'Sis Kurtları', 'wolf_dark', 92, 1000, 12, 5);
  // --- Red canyon (10-15) ---
  camp('gw_a', 'Kanyon Girişi', 'goblin_warrior', 394, 1075, 12, 6);
  camp('gw_b', 'Kızıl Duvarlar', 'goblin_warrior', 430, 1150, 12, 6);
  camp('rattler_a', 'Sıcak Kayalar', 'snake_dune', 412, 1195, 12, 6);
  camp('rattler_b', 'Çıngırak Geçidi', 'snake_dune', 452, 1360, 12, 6);
  camp('gw_c', 'Goblin Kalesi Önü', 'goblin_warrior', 462, 1232, 13, 6);
  camp('gb_a', 'Kale İçi', 'goblin_brute', 475, 1290, 13, 6);
  camp('gb_b', 'Mızrak Avlusu', 'goblin_brute', 440, 1345, 11, 5);
  camp('gb_c', 'Kemik Ocağı', 'goblin_brute', 400, 1410, 12, 5);
  camp('boss_gob', 'Kemikkıran Tahtı', 'goblin_chief', 482, 1268, 5, 1);
  camp('boss_red', 'Kızıl Dikensırt Yatağı', 'spike_red', 360, 1470, 7, 1);
  // --- Shadowwood (9-16) ---
  camp('sw_a', 'Gölge Patikası', 'wolf_dark', -345, 1065, 13, 6);
  camp('sw_b', 'Karanlık Çalılık', 'wolf_dark', -365, 1160, 13, 6);
  camp('bb_a', 'Kara Domuz Yuvası', 'boar_black', -335, 1215, 13, 6);
  camp('bb_b', 'Kök Çukuru', 'boar_black', -270, 1305, 13, 6);
  camp('sw_c', 'Kurt Geçidi', 'wolf_dark', -300, 1250, 12, 5);
  camp('bb_c', 'Kadim Ağaç Etekleri', 'boar_black', -205, 1385, 13, 6);
  camp('bb_d', 'Çürük Kütük', 'boar_black', -340, 1330, 12, 5);
  camp('boss_alpha', 'Karakulak Ini', 'wolf_alpha', -280, 1448, 6, 1);
  camp('alpha_pack', 'Karakulak Sürüsü', 'wolf_dark', -268, 1425, 11, 4);
  // --- Frost peaks (14-18) ---
  camp('fw_a', 'Don Geçidi', 'wolf_frost', 12, 1590, 13, 6);
  camp('fw_b', 'Beyaz Yamaç', 'wolf_frost', 80, 1700, 13, 6);
  camp('fw_c', 'Kış Yuvası', 'wolf_frost', -60, 1750, 13, 6);
  camp('ib_a', 'Demirdiş Vadisi', 'boar_iron', 5, 1665, 12, 6);
  camp('ib_b', 'Taş Yaprak', 'boar_iron', 110, 1745, 12, 5);
  camp('ib_c', 'Buzlu Çalılık', 'boar_iron', -20, 1840, 12, 5);
  camp('fg_a', 'Buz Goblini Kampı', 'goblin_frost', 70, 1830, 13, 6);
  camp('fg_b', 'Kırağı Gözcüleri', 'goblin_frost', -90, 1660, 12, 6);
  camp('fg_c', 'Zirve Karakolu', 'goblin_frost', 30, 1905, 12, 6);
  camp('fg_d', 'Donuk Geçit', 'goblin_frost', 215, 1580, 11, 5);
  camp('fg_e', 'Kuzey Buz Kampı', 'goblin_frost', 135, 1660, 11, 5);
  camp('boss_frost', 'Buzsırt Mağarası', 'spike_frost', 50, 1938, 7, 1);
  // --- new species (creatures/species/{stag,bear,panther,troll}.js) ---
  camp('stag_a', 'Geyik Yamacı', 'stag', 186, 742, 12, 5);
  camp('stag_b', 'Boynuz Geçidi', 'stag', 332, 748, 11, 4);
  camp('stag_c', 'Sis Otlağı', 'stag', 266, 908, 11, 4);
  camp('bear_a', 'Ayı Mağaraları', 'bear', -382, 1118, 13, 4);
  camp('bear_b', 'Kök Ayıları', 'bear', -248, 1372, 12, 4);
  camp('bear_c', 'Kayalık Ayıları', 'bear', 388, 1032, 12, 4);
  camp('bear_d', 'Bataklık Ayıları', 'bear', 76, 1110, 12, 3);
  camp('cat_a', 'Puma Kayalığı', 'panther', 440, 1098, 12, 4);
  camp('cat_b', 'Gölgeli Yarık', 'panther', 408, 1330, 12, 4);
  camp('cat_c', 'Kızıl Çıkıntı', 'panther', 326, 1438, 11, 3);
  camp('cat_d', 'Karanlık Pusu', 'panther', -332, 1385, 11, 3);
  camp('trl_a', 'Troll Köprüsü', 'troll', -185, 1340, 12, 3);
  camp('trl_b', 'Troll Geçidi', 'troll', -4, 1452, 12, 3);
  camp('trl_c', 'Taş Troller', 'troll', 300, 1532, 12, 3);
  camp('trl_d', 'Yosunlu Tepe', 'troll', -76, 1585, 12, 3);
  // --- frost valley, top levels (variants of the new bodies: creatures/defs.js VARIANT_SPECS) ---
  camp('pb_a', 'Kutup Ayısı Yatağı', 'bear_polar', -25, 1772, 12, 4);
  camp('pb_b', 'Beyaz Mağara', 'bear_polar', 152, 1792, 12, 3);
  camp('snc_a', 'Kar Pusu', 'panther_snow', 170, 1716, 11, 4);
  camp('snc_b', 'Buzlu Kayalık', 'panther_snow', -8, 1722, 10, 3);
  camp('tf_a', 'Buz Trolü Kemeri', 'troll_frost', 98, 1888, 12, 3);
  camp('tf_b', 'Don Mağarası', 'troll_frost', -52, 1898, 12, 3);
  W.camps = C;

  /* named places for the map + scenery (x, z, kind, label) */
  W.sites = {
    farm: [-34, 300], mill: [14, 476], dock: [-362, 538], warrenHeart: [214, 300], wolfDen: [-326, 978], tower: [232, 800],
    stones: [170, 764], fort: [472, 1268], titan: [-290, 1452], icecave: [50, 1950], gate: [0, 78],
  };
  W.markers = [
    ['Taşkale', 0, 0], ['Çiftlik', -34, 300], ['Tavşan İni', 214, 300], ['Akardere Değirmeni', 14, 476], ['Aynagöl', -430, 545],
    ['Kurt İni', -326, 978], ['Yıkık Gözcü Kulesi', 232, 800], ['Dikensırt İni', 342, 1000], ['Sis Bataklığı', -10, 1000],
    ['Goblin Kalesi', 472, 1268], ['Kadim Ağaç', -290, 1452], ['Don Zirveleri', 40, 1790], ['Buzsırt Mağarası', 50, 1938], ['Buzgölü', -140, 1760],
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
    canyon:   [['goblin_warrior', 0.3], ['snake_dune', 0.25], ['panther', 0.25], ['goblin_brute', 0.1], ['bear', 0.1]],
    shadow:   [['wolf_dark', 0.3], ['boar_black', 0.3], ['bear', 0.15], ['panther', 0.15], ['troll', 0.1]],
    frost:    [['wolf_frost', 0.25], ['boar_iron', 0.15], ['goblin_frost', 0.25], ['bear_polar', 0.1], ['panther_snow', 0.1], ['troll_frost', 0.1], ['troll', 0.05]],
  };
  W.SCATTER_CAMPS = 340;
  W.scatterCamps = function () {
    if (W.scattered) return; W.scattered = true;
    const R = V.rng(20261105), out = [];
    const sites = Object.values(W.sites);
    let tries = 0;
    while (out.length < W.SCATTER_CAMPS && tries++ < 60000) {
      const x = lerp(W.region.minX, W.region.maxX, R()), z = lerp(W.region.minZ, W.region.maxZ, R());
      const r = 9;
      if (W.sdAt(x, z) > -(r * 0.75 + 3)) continue;
      if (Math.hypot(x, z - 110) < 115 || (x > -112 && x < 112 && z > -112 && z < 150)) continue;       // the village and its approach stay calm
      if (W.roadD && W.roadD[0] !== undefined && W.bil(W.roadD, x, z) < 4) continue;
      if (sites.some((p) => Math.hypot(p[0] - x, p[1] - z) < 28)) continue;
      if (W.bridges && W.bridges.some((b) => Math.hypot(b.x - x, b.z - z) < 20)) continue;
      if (W.camps.some((c) => Math.hypot(c.cx - x, c.cz - z) < c.r + 18)) continue;
      if (out.some((c) => Math.hypot(c.cx - x, c.cz - z) < 42)) continue;
      const zn = W.zoneAt(x, z); if (!zn) continue;
      const tab = SCATTER[zn.biome]; if (!tab) continue;
      let u = R(), sp = tab[0][0]; for (const [id, p] of tab) { if (u < p) { sp = id; break; } u -= p; }
      out.push({ id: 'rnd_' + out.length, name: zn.name, species: sp, cx: x, cz: z, r, count: 2 + Math.floor(R() * 3) });
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

  W.buildHeights = function () {
    const sd = W.sd, hg = W.hgrid, riverD = W.riverD, lakeD = W.lakeD;
    for (let j = 0; j < NZ; j++) {
      const z = B.minZ + j * G;
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i, x = B.minX + i * G, s = sd[k];
        let h = 0;
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
  };
})();
