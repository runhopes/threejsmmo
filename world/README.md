# Taşkale Diyarı — the open world (levels 1-16)

Procedural (three.js r128, no external models) Metin2-style open world: the castle village in the middle, a great river wrapping
it, big ancient forests, climbable hills, a sea on the east, mountains all round. `?wild=0` = village only (old behaviour).
Everything is data + code: edit `layout.js`, reload. The map is authored on the pixels of the top-down reference image
(`P(px, py)` in `layout.js` converts reference pixels to metres: 3 m / px, the castle compound at px (150, 322) = (0, 0)).

| File | Role |
|---|---|
| `layout.js` | **Data + fields.** 13 zones (floor capsules in reference pixels, level band, biome), walkable `hills` + rolling relief, dead-flat `pads`, non-walkable rock `islands`, `rivers`, `lakes` (the sea, ponds, swamp pools), `roads` (a closed ring = the round plaza), `camps` (creature spawn camps), `sites`, `markers`. Builds the 2 m grids: `sd` (signed distance to the walkable floor), `hgrid` (terrain height = relief + hills + mountains), river / lake carve + wetness. Steep floor cells (slope > `SLOPE_MAX`) turn into rock. `snapCamps()` nudges camps inside the floor. |
| `terrain.js` | Chunked terrain mesh (64 m chunks, shared index buffer), the ground shader, world control maps (roads, banks, mud, forest floor, biome tint + barren), water (river ribbons, lakes, swamp), distance culling (`registerCull`, `cull`, `cullOff`). |
| `nav.js` | `computeBridges` (road × river crossings) + `stampBridges` (walkable deck corridor in the floor mask), `keepInside` (push-back onto the floor: used by hero AND creatures through `Village.collide`), `makeNav` (1 m NavGrid rasterised from the floor + colliders), `compositeNav` (village 0.5 m grid + wilderness 1 m grid behind one API). |
| `scenery.js` | Extra instanced kinds (dead tree, reeds, spires, burrows, tents, carrots, totem, campfire, lily), biome scatter (giants, trees, bushes, rocks, tufts, ferns, mushrooms) lifted onto the relief, hill-side pines / far giants, water edges, landmarks (bridges, great plaza, farm + windmill, mill, rabbit warren + carrot gardens, goblin camps, goblin fortress, wolf den arch, ruined watchtower hill, standing stones, dock, holy-isle shrine, Ancient Tree, signposts, lanterns). |

## Ground textures (Poly Haven, CC0 — `village/phtex.js`, rebuilt with `node tools/packvtex.mjs <srcDir>`)

`forrest_ground_01` meadow + `leafy_grass` (patches), `forest_leaves_02` forest floor, `park_dirt` road body, `rocky_trail` road shoulders /
pebbles / scree, `coast_sand_01` river + sea banks (wet pebbles at the water line), `mossy_rock` cliffs, `jolcham_oak_bark_01` bark.
The shader (`terrain.js`) sharpens + rags the road mask with noise, adds a dusty verge, darkens a packed road centre, blends scree on mid slopes
and mossy rock on cliffs, dries the grass on hill tops. 16 texture units is the hard limit: the biome map keeps its `barren` weight in the alpha
channel and mud / scree reuse the road / trail textures.

## Rules that matter

* **The hero is always at y = 0 in the scene frame** (foot IK). The floor has real relief (rolling swells ±2.6 m + climbable hills up to ~18 m);
  `village/scene.js` shifts the whole world group by `-World.yBase` each frame. `World.heightAt(x, z)` = true height, `World.frameY(x, z)` =
  height in the hero's frame (creatures, rings, impacts use it). Everything on the floor that the instancer places uses a RELATIVE y
  (scenery wraps `I.add`); static-Builder landmarks (farm, mill, fort, dock, plaza, stones, den, Ancient Tree, shrine) stand on dead-flat
  `W.pads`. The village band is flat too (relief fades in over 46 m outside it). Rivers / the sea are carved *below* the ground, bridges run at y = 0.
* The walkable floor is `sd < 0` in `layout.js`. Rivers, lakes, islands and steep cells are cut out of it; bridges stamp a corridor back in.
  Hero and creatures are held on it by `World.keepInside` (called from `collide()` in `village/scene.js`).
* Camps (`W.camps`) become `CREATURE_DEFS.ZONES` (`integrate.js: creatureZones`). Species ids come from `creatures/defs.js`,
  `creatures/variants.js` (tinted / scaled variants) and `creatures/species/*.js`. Camps get no trees inside their radius. No snow / desert species
  are used (the frost variants stay in the defs but no camp spawns them).
* The starter area stays open: no trees on the great plaza, the gate road or the meadow ring round them (`calm` in `scenery.js`).
* Fog hides everything past ~175 m, so `terrain.js` culls static / instanced chunks past 205 m (terrain + water 470 m).
  The minimap capture switches culling off once (`World.cullOff`).

## Tools

* `village.html` — dev viewer; `window.__at(x, z, iso)`, `window.__cam(pos, tgt, fov)`, `window.__ortho(cx, cz, w, d)`.
* `node tools/worldshot.mjs <outDir> name:at:x:z[:iso] name:cam:px:py:pz:tx:ty:tz[:fov] name:ortho:cx:cz:vw:vh:w:d` — screenshots (ortho switches culling off).
* `node tools/worldplay.mjs <outDir> [campId ...]` — the real game: BFS reachability of every camp / bridge / site over the nav grid,
  creature census, frame-rate probe, shots at camps. Quick-start spawns: `index.html?cls=warrior&spawn=z_<zoneId>` or `spawn=c_<campId>`.
* `node tools/atmoshot.mjs shots/atmo/<name> x:z,x:z --pitch=12 --dist=18` — the real game camera at world points.

## Layout (x east, z south; village at the origin, gate at z ≈ 78; great plaza at (0, 180))

The great river (Akardere) comes from the west edge north of the castle, wraps its north-east and east, then runs south-west to the south edge;
bridges on every road crossing. The castle side (west bank) holds the meadow, the warren, the west forest and the south-west shadow forest.
The far bank holds the north plains + hills + pinewood, the fortland and the holy isle (cut off by a strait), the marsh coast, the south fen
and the deep wood. A sea fills the east.

| Zone | Levels | Where (x, z in m) |
|---|---|---|
| Taşkale Çayırları (castle meadow, plaza, farm, mill) | 1-4 | x ±150, z -260..400 |
| Tavşan İni (rabbit warren, king) | 2-5 | (190, 20) |
| Akarova Ovası (north-west plains, Aynagöl pond) | 3-6 | x -280..150, z -460..-340 |
| Kurt Ormanı (west forest, wolf den) | 5-9 | x -300..-80, z -60..330 |
| Rüzgâr Tepeleri (windswept hills, watchtower, Dikensırt den) | 6-10 | x 0..450, z -670..-360 |
| Güney Sazlığı (south fen) | 6-9 | x 165..450, z 370..600 |
| Sis Bataklığı (marsh coast) | 8-12 | x 400..790, z -100..320 |
| Gölge Orman (darkest forest, Ancient Tree) | 9-14 | x -330..-60, z 320..880 |
| Yaban Koru (deep wood) | 9-13 | x 330..570, z 530..780 |
| Kuzey Karaçamları (north pinewood, Karakulak) | 10-14 | x -180..420, z -850..-680 |
| Kıyı Kayalıkları (coast cliffs) | 10-13 | x 560..650, z 300..750 |
| Kızıl Kale Yaylası (goblin fortress, Kemikkıran) | 11-15 | x 400..720, z -870..-400 |
| Kutsal Ada (holy isle, shrine) | 13-16 | (780, -560) |

## Minimap görüntüsü (index.html)

- Dünya haritası (`mapImage`): tüm bölge tek seferde 1024 px'e çekilir — dünya haritası penceresi içindir.
- Minimap bunu büyütünce bulanıktı; bu yüzden oyuncunun çevresi için ayrı bir **yüksek çözünürlüklü karo** (`miniImage`:
  256 m kare, 1536 px ≈ 6 px/m) çekilir ve `S.map.miniImage` ile `ui/minimap.js`'e verilir (yoksa `image`'e düşer).
  Oyuncu karo merkezinden > 68 m uzaklaşınca yeniden çekilir (≈ 40–90 ms tek seferlik); pencere dünya sınırına kıstırılır.
  Uzak oyuncular çekimde gizlenir (`Net.roots()`). Çekim sırasında dünya grubunun dikey kayması sıfırlanır.
