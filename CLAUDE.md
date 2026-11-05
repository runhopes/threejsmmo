# tdsmoba — project rules (MANDATORY)

Persistent fantasy MMORPG (three.js r128, procedural models, no build step). Details live in the folder READMEs
(`village/README.md`, `world/README.md`, `creatures/`, `ui/`) and in the auto-memory notes.

## World look: "WoW Forever" mystic atmosphere — DO NOT REGRESS (zorunlu)

The user's direction (2026-11-05): the world (not UI, not characters) must read like WoW: Forever — **devasa (colossal)
ancient trees, a mystic misty air, warm low sun against blue-teal shade, painterly Poly Haven ground**. Rules:

1. **Trees are giants.** Forest biomes (`wolfwood`, `shadow`, `creek`, `marsh`) are dense with ancient trees from
   `village/forest.js` (`giant0..3`, `greatpine0`, `titan`). Never fall back to the old blob trees (`oak`, `oakF`,
   `lindenF`) or the cone `pine` as the *main* forest; small trees may only fill in. Trunks need buttress lobes, roots,
   limbs and a card crown; crowns must roof the glade. New tree kinds go into `forest.js` and are placed through
   `Forest.addGiant` (full + LOD copy), with colliders (core, lobes, roots) and the painted forest floor.
2. **Atmosphere stays:** tinted depth fog + ground-mist pockets, painted sky, god rays, fireflies, mushroom glows,
   vignette (`village/atmosphere.js`; tune only through `Atmosphere.P`). Ground = Poly Haven textures
   (`village/phtex.js`, rebuilt with `node tools/packvtex.mjs`), never flat lime green. Models stay procedural
   ([[procedural-only-models]]); only textures may come from Poly Haven (CC0).
3. **Never copy WoW assets, zones or landmarks** — original art only.
4. `?atmo=0` (old look) and `?giants=<k>` (ancient-tree density, 0.5 for slow GPUs) must keep working.

## Before you say "trees / atmosphere are done" (verification is required)

- Capture the REAL game, not a bench: `node tools/atmoshot.mjs shots/atmo/<name> <spots>` at the default camera AND the
  low horizon view `--pitch=12 --dist=18`, in **at least 3 biomes including a dense forest** (e.g. `-260:1200` shadow,
  `-200:760` wolf wood, `0:200` meadow, `0:500` creek) and LOOK at the images (are the trees colossal? is the mist
  there? is the ground painterly, not lime?). Compare with the user's reference mood, not with "it renders".
- Performance: A/B against the previous state in the same run (other sessions load the GPU; absolute fps is noisy).
  Profile with toggles before guessing. The dense forest on the dev iGPU (Radeon 610M, headless) is ~15–25 fps today;
  do not make it worse without a stated reason.
- Reachability: `node tools/worldplay.mjs shots/atmo/worldplay` — the unreachable list must not grow. Known baseline
  (map v2, Metin2-style, 2026-11-05; also without trees): ~4 random camps `rnd_*` (they move with the layout) and sites `tower titan`. Compare with
  `WQ=giants=0` when in doubt.
- Smoke-test every page that loads `village/*.js`: `village.html`, `magefx.html`, `archer-vfx.html`,
  `index.html?world=arena`, `index.html?atmo=0` (no pageerror) — `node tools/smoke.mjs` does all of them; `node tools/worldcheck.mjs` sanity-checks the layout data.
- The world / minimap is a hand-drawn sketch painted from the world data (`world/mapart.js`, `node tools/mapart.mjs <dir>` renders it); `?mapphoto` = old 3D capture.
- Ground textures are Poly Haven (CC0) layers; the terrain shader sits at the 16-texture-unit limit (see world/README.md) — do not add samplers.

## Performance rules for the forest (learned the hard way)

- Leaf cards are **Lambert**, double-sided, and **never cast or receive shadows**; a crown-wide `shadowOnly` dapple quad
  casts the shadow. Per-card shadows cost ~30 % of a frame. Far (LOD) copies have no proxy.
- Every giant placement = full copy + `giantL*`/`greatpineL*` copy; `world/terrain.js` `cull()` shows exactly one per
  32 m chunk by chunk-centre distance (`Forest.LOD_DIST`). Keep draw calls per near tree at ≤ 3.
- Additive shaders output non-premultiplied colour (three's AdditiveBlending = SRC_ALPHA, ONE). The sky dome is drawn
  last at the far plane (early-z). Only built-in materials use the patched fog chunks.

## Game constraints that bite

- The hero is ALWAYS at `y = 0` in the scene frame (foot IK); the open world has walkable relief + climbable hills because `village/scene.js` shifts the world group by `-World.yBase` each frame. True height: `World.heightAt(x, z)`; frame height: `World.frameY(x, z)` (index.html `fY`). The village band / settlement pads stay dead flat.
- Creature camps need clearings (`campClear` in `world/scenery.js`, `Forest.CLEARINGS` in the village band).
- Click-to-attack is on the RIGHT mouse button only; HUD shows real data only; verify animations / looks through the
  real game camera (see the memory notes).
- Other Claude sessions edit `index.html`, `world/*`, `creatures/*` in parallel: re-read a file before editing it and
  keep edits to shared files minimal and marked.
- Update the relevant README when you change forest / atmosphere / world behaviour.
