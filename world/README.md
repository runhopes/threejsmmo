# Taşkale Diyarı — the open world (levels 1-18)

Procedural (three.js r128, no external models) open world around the castle village. `?wild=0` = village only (old behaviour).
Everything is data + code: edit `layout.js`, reload.

| File | Role |
|---|---|
| `layout.js` | **Data + fields.** 9 zones (valley-floor capsule chains, level band, biome), non-walkable hill `islands`, `rivers`, `lakes`, `roads`, `camps` (creature spawn camps), `sites`, `markers`. Builds the 2 m grids: `sd` (signed distance to the walkable floor), `hgrid` (terrain height), river / lake carve + wetness. `snapCamps()` nudges camps inside the floor. |
| `terrain.js` | Chunked terrain mesh (64 m chunks, shared index buffer), the ground shader (grass / forest floor / barren dirt / river gravel / mud / slope rock / snow, biome tinted), world control maps (roads, banks, mud, forest floor, biome tint, barren), water (river ribbons, lakes, swamp, ice), distance culling (`registerCull`, `cull`, `cullOff`). |
| `nav.js` | `computeBridges` (road × river crossings) + `stampBridges` (walkable deck corridor in the floor mask), `keepInside` (push-back onto the floor: used by hero AND creatures through `Village.collide`), `makeNav` (1 m NavGrid rasterised from the floor + colliders), `compositeNav` (village 0.5 m grid + wilderness 1 m grid behind one API). |
| `scenery.js` | Extra instanced kinds (snow fir, dead tree, reeds, spires, burrows, tents, carrots, cactus, totem, campfire, lily), biome scatter (giants, trees, bushes, rocks, tufts, ferns, mushrooms), hill-side pines / far giants, water edges, landmarks (bridges, farm + windmill, mill, rabbit warren + carrot gardens, goblin camps, goblin fortress, wolf den arch, ruined watchtower hill, standing stones, dock, ice cave, Ancient Tree, signposts, lanterns). |

## Rules that matter

* **Walkable ground is exactly y = 0** (hero / creature foot IK). Elevation lives where nobody walks: ridges between valleys, mountains,
  island hills (rabbit hillocks, watchtower hill, canyon pillars), river gorges (the channel is carved *below* y = 0, bridges run at y = 0).
* The walkable floor is `sd < 0` in `layout.js`. Rivers, lakes and islands are cut out of it; bridges stamp a corridor back in.
  Hero and creatures are held on it by `World.keepInside` (called from `collide()` in `village/scene.js`).
* Camps (`W.camps`) become `CREATURE_DEFS.ZONES` (`integrate.js: creatureZones`). Species ids come from `creatures/defs.js`,
  `creatures/variants.js` (tinted / scaled variants) and `creatures/species/*.js`. Camps get no trees inside their radius.
* Fog hides everything past ~175 m, so `terrain.js` culls static / instanced chunks past 235 m (terrain + water 470 m).
  `?` the minimap capture switches culling off once (`World.cullOff`).

## Tools

* `village.html` — dev viewer; `window.__at(x, z, iso)`, `window.__cam(pos, tgt, fov)`, `window.__ortho(cx, cz, w, d)`.
* `node tools/worldshot.mjs <outDir> name:at:x:z[:iso] name:cam:px:py:pz:tx:ty:tz[:fov] name:ortho:cx:cz:vw:vh:w:d` — screenshots.
* `node tools/worldplay.mjs <outDir> [campId ...]` — the real game: BFS reachability of every camp / bridge / site over the nav grid,
  creature census, frame-rate probe, shots at camps. Quick-start spawns: `index.html?cls=warrior&spawn=z_<zoneId>` or `spawn=c_<campId>`.

## Layout (x east, z south; village at the origin, gate at z ≈ 78)

| Zone | Levels | Where |
|---|---|---|
| Taşkale Çayırları (+ Tavşan İni warren) | 1-5 | z 150-430 |
| Akardere Vadisi (river, oak grove, reeds) | 3-6 | z 430-640 |
| Kurt Ormanı (west deep forest, wolf den) | 6-9 | x -330..-30, z 545-990 |
| Rüzgâr Tepeleri (hills, watchtower, Dikensırt den) | 8-10 | x 110..345, z 545-1010 |
| Sis Bataklığı (marsh) | 7-12 | x -35..0, z 540-1250 |
| Kızıl Kanyon (goblin fortress) | 10-15 | x 345..470, z 1010-1480 |
| Gölge Orman (darkest forest, Ancient Tree) | 9-16 | x -355..-170, z 990-1470 |
| Don Zirveleri (snow valley, ice cave) | 14-18 | z 1250-1950 |
