# Archer VFX

The archer's skill effects. They are built procedurally on a small pooled kit and drawn on top of the game's
own aiming, hit tests and damage.

| File | Role |
|---|---|
| `vfx/core.js` | **VFXKit**: generic building blocks with fixed-size pools. Instanced particles (4 batches), batched ribbon trails, procedural flats (rings, decals, telegraph, reticle), beams and a scheduler. Not archer-specific; the mage can reuse it. |
| `vfx/conform.js` | **VfxConform** (shared by every class, magefx, markers, creature telegraphs): flat ground decals follow the open-world slopes. `attach(mesh, { lift? })` swaps in a subdivided twin of the Plane / Ring / Circle geometry (same UVs); `VfxConform.update()` (index.html, right before `renderer.render`) puts each vertex `lift` above the rendered terrain triangles (`lift` omitted = the decal's own y, the "authored at y = 0" convention). Lying particles (`gadd` / `gnorm`) are lifted + tilted on the slope in `vfx/core.js`. No-op without the open world; `?conform=0` = old flat decals (A/B). |
| `vfx/archer.js` | **ArcherVFX**: styles, pooled arrows, bow tracker, release / travel / impact builders, rain, poison status, eagle focus and hop. |
| `archer-vfx.html` | Test bench: the real archer with the real gameplay camera and every skill on keys 1–9. It has live tuning sliders. |
| `tools/archervfx.mjs` | Deterministic phase captures (contact sheet per skill + logged timeline). |
| `tools/archerplay.mjs` | The real game (`index.html?cls=archer`) driven with real input: click the dummy, then keys 1–8. |
| `tools/archervfxperf.mjs` | Cost under load (4 stress archers + rain + rapid + eagle). |

## 1. Visual language

The archer looks like a precise, kinetic marksman, not a caster. What carries the look:

- **Trajectory first.** Every arrow has a thin, time-based ribbon trail plus a bright *glint* on its head, the pixel the
  eye tracks at gameplay distance. Trails are controlled (60–170 ms long) and never thicker than ~10 cm.
- **Tension → release → contact.** The bowstring glow, the nock glint and the arrowhead treatments all come from the
  real bow simulation (`knight._bow.draw`, nocked arrow visibility). They build only while an arrow is nocked. Release is a
  sharp 50–90 ms snap: a flash, a short streak and wind wisps.
- **Hit confirmation is a ring, not an explosion.** Hits on a target show a crisp ring "ping" and a short flash on the
  target's *camera-facing surface*, plus sparks. Big shapes are kept for fire and pierce only.
- **Restrained residue.** Aftermath only where it means something: stuck arrows, scorch, poison splat, the rain field.
  Everything cleans itself up in ≤ 2.5 s (`linger` slider).

### Palette and blending rules

| Identity | Colour | Blending |
|---|---|---|
| Physical (basic, volley, rapid) | neutral cool white `#F2F6FF`, warm sparks | additive (white survives any ground) |
| Piercing | cold white-cyan `#DFF6FF` → `#5FB6E8` | additive |
| Fire | ember orange `#FFA030` → red `#A82A08`, hot core `#FFF0B0` | **normal** body + thin additive core |
| Poison | dirty olive `#8AAC3A` → `#3D5418`, dull wet glints | **normal** (no glow: dangerous, not neon) |
| Archer accent (rain telegraph, eagle) | pale hunter gold `#F6D98E` / `#E8C46A` | normal (+ dark contrast rim on the telegraph) |

**Rule learned on the bench:** additive orange or green turns *white* on bright ground (the old arena blue, village dirt).
Element hues therefore ride on normal blending, and additive is kept for small hot cores, sparks, flashes and rings. Poison and the
eagle focus never share a hue: poison is olive green, the focus is gold.

## 2. Skill-by-skill design (timings at attack speed 1.08)

Times are seconds after the key press, as logged by the bench timeline. Travel times are for the 9 m bench lane.

### 1 · Ok Atışı (basic): the constant, so the lightest

| Phase | Effect |
|---|---|
| Draw (nock 0.33 → full draw 0.53) | subtle bowstring glow (16 %), tiny nock glint from 55 % draw |
| Release 0.57 | 0.27 m snap flash, 1 m streak (grows in 25 ms, fades 90 ms), 2 wind wisps |
| Travel 36 m/s | 5 cm white ribbon, 90 ms long, head glint 11 cm |
| Impact | target: flash + ring ping (0.95 m) + 5 sparks + surface (straw/wood splinters, flesh puff, stone grit, ground dust and dirt) |
| Aftermath | arrow sticks 2.5 s (ground 1.6 s), shrinks out over its last 0.25 s |

### 2 · Yelpaze Atışı (volley): a controlled burst

- Draw: **ground fan guide**, three thin gold-white lines at the real spread (0.16 rad). They grow with the draw and
  flash out on release. This is the spread indicator.
- Release 0.60: one flash and **three synchronized streaks**, one per fan direction.
- Travel: three separate warm-white trails that never merge (0.16 rad = 1.4 m apart at 9 m).
- Impact: per-arrow physical hits. When 2+ arrows of the same volley hit one target, a single wider gold ring marks
  the multi-hit.

### 3 · Delici Ok (pierce): committed sniper shot

- Draw (rate 0.72 → nock 0.46, release 0.77): bowstring glow ramps to 95 % and pulses at full draw. Cold motes stream
  *into* the arrowhead and its glint grows. A pulse ring fires at full draw, a faint dust stir rises at the feet, and a
  **ground aim line** grows out to ~9 m.
- Release: big flash, two air rings across the flight axis, a **force-line** along the whole 18 m path with a highlight
  that runs at arrow speed, dust kicked back at the feet and a small camera kick.
- Travel 46 m/s: 1.22× arrow, 10 cm white-cyan trail (170 ms), wake rings every 1.8 m.
- Impact: passes through every target. On each one: a ping on the near side, an **exit cone of sparks + shock ring
  + 1.8 m exit streak on the far side**, so the penetration is obvious. It stops on stone or ground.

### 4 · Ateşli Ok (fire): an arrow first, fire second

- Draw: the head **ignites at the nock** (small flash, embers, a light flicker). The flame grows with the draw.
- Release: warm flash, short streak, embers flung forward.
- Travel 34 m/s: burning head (flame body + hot core), shed embers, a thin smoke wisp, orange→red trail (normal blend)
  with an additive core.
- Impact: compact **circular pop**: flash, hot tongues, a ring of 11 flames racing out horizontally, an orange ground ring
  (1.15 m), embers, 3 smoke puffs, a point-light flash.
- Aftermath: a 0.6 m scorch decal with ember speckle that cools over 2.2 s, plus a few ground embers. The stuck arrow keeps
  burning for 0.9 s.

### 5 · Zehirli Ok (poison): dirty and dangerous

- Draw: dull wet glint on the head, slow drips, faint mist. No glow.
- Travel: olive normal-blend trail + thin wet core, drips falling off the arrow, a faint mist.
- Impact: green-tinted ping, 9 heavy droplets, sickly mist (4 puffs to 1.2 m), a dark core puff, an **"applied" ring
  at the target's feet** and a splat decal (2.4 s).
- DoT (5 s): dark wisps curl off the camera-facing half of the body, drips and small wet bubble pops. Each damage tick
  adds a pulse (bubbles, mist, ground ring).

### 6 · Ok Sağanağı (rain): battlefield control

- Cast (0 s): **telegraph**: crisp gold edge with a dark contrast rim, 16 inward ticks, a faint fill and an inner ring. It
  snaps in (1.12 → 1.0 in 0.18 s).
- Sky shot (0.60): a gold streak and a sky arrow with a bright trail leaving the screen. A **sweep ring** then expands from
  the centre to the edge in exactly the time until the first volley lands.
- Volleys (first lands 1.15, then 5 × 0.2 s): ~6 parallel arrows per volley (one shared slant, so it reads as a coordinated
  volley). Landing spots are stratified by angle (golden-angle rotation per wave). One arrow per volley is aimed at each target
  inside the circle. A dark landing shadow focuses 0.3 s before each impact, and every volley pulses the fill.
- Impacts: small dust + dirt + a gold spark. Arrows stay as a **residue field** until 0.9 s after the last volley.
- The telegraph fades 0.3 s after the last volley.

### 7 · Seri Atış (rapid): pressure and tempo

- 5 releases ≈ 0.30 / 0.63 / 0.97 / 1.30 / 1.63 s, each a short snap: smaller flash, 0.7 m streak, one wisp and a tiny dust
  kick at the front foot.
- Lighter impacts (×0.6). Each hit of the burst rings 10 % wider, and the 5th adds a finishing flash + 3 sparks.

### 8 · Geri Sıçrayış (hop): athletic, not a teleport

- Take-off 0.13: dust kicked forward by the push-off, dirt chips, scuff ring.
- Air 0.13–0.45: speed lines at the body edges that move with the hero.
- Landing 0.45: radial dust, a short skid back along the hop, scuff ring, tiny camera kick.
- Recovery ~0.55: a small readiness glint on the upper bow limb.

### 9 · Kartal Gözü (eagle focus): heightened senses

- Activation 0.47: a gold flash and ring at the eyes, 10 focus streaks rising past the head, motes and a ground ring.
- Duration (10 s): a gold **reticle** at the feet (outer ring, 4 rotating ticks, notches, a dashed inner ring). It settles to
  ~35 % opacity with a slow breathe and flickers in the last 1.5 s. Gold motes rise from the bow and the string glows faintly gold.
- While active, shots get a **sharper release**: ×1.2 release, 30 % longer gold-tinted streak, a gold ping at the bow, and
  trails 18 % brighter.

## 3. Architecture

```
host (index.html / bench)                    ArcherVFX                         VFXKit
  knight 'impact' event ── AV.shoot(style) ──► release FX + pooled arrows ──►  particles (4 instanced batches)
  castSkill(rain) ──────── AV.rainMark()                                       trails (2 batches)
  skill release ───────── AV.rain(mark) ───► scheduled volleys (kit.later)     flats (pool 48)
  DoT applied / tick ──── AV.poison / poisonTick                              beams (pool 32)
  buff ─────────────────── AV.eagle(10)                                        scheduler
  per frame ───────────── AV.update(dt) ───► bow tracker (draw, hop) → projectiles → statuses → kit.end()
       ▲ hooks: hitTest(a,b,P) · onHit(P,hit,pass) · targetsIn · onRainWave · light · shake · event
```

- **Gameplay stays with the host.** ArcherVFX asks `hitTest` for the first thing the arrow head enters each frame. The y = 0
  ground is handled inside. It reports hits back through `onHit` (damage, DoT, reactions). Rain damage is per volley
  (`onRainWave` → `areaDamage`), so the volley you see is the damage you get.
- **Pooling.** Arrows are clones of the knight's own arrow mesh (shared geometry and materials) and are kept in a pool. Particles are
  packed typed arrays (swap-remove) uploaded with `updateRange`. Trails live in two batched ribbon geometries. Flats and beams are
  pre-built meshes. Nothing allocates GPU memory after start-up, and a full pool drops the request rather than growing.
- **Draw calls:** 4 particle + 2 trail batches + live flats/beams (typically 0–10, peak ~30 in the stress test).
- **Hit anchoring.** Hit effects sit on the target's camera-facing surface (axis + radius + margin, leaning toward the
  shooter). The host's hit point lies inside the capsule, and depth-tested particles there were hidden by the body.
- **Quality tiers** (`tuning.quality`): `high` (density 1, 14 trail points, extras, smoke, lights), `medium` (0.7, 11),
  `low` (0.42, 8, no wake rings / landing shadows / smoke / light flashes).

### Tuning (bench sliders, `AV.tuning`)

`trail` (width √, alpha, length) · `impact` (counts, flash/ping size √) · `charge` (draw glows, aim guides, aura) ·
`release` · `linger` (aftermath durations) · `life` (every lifetime) · `volleySpread` · `rain.{waves, perWave,
interval, lead, height, speed, dots}`. The bench's *Ayarları kopyala* button exports the JSON to paste back into
`TUNING` in `vfx/archer.js`. Bench settings persist per browser (localStorage); `?fresh=1` ignores them.

### Measured cost

`node tools/archervfxperf.mjs` (4 stress archers firing every 0.4 s + rain + rapid + eagle): ArcherVFX.update
**0.10 ms/frame average, 0.9 ms peak**; peak live 115 additive + 151 normal + 28 ground particles, 30 trails, 28 flats; 0 dropped.

## 4. Testing

**Bench:** open `archer-vfx.html` (`?world=village` for the real ground, `?skill=pierce` to cast on load, `?cam=archer` for
the exact game framing).

- `1–9` skills · `Space` replay · `L` loop · `A` play all · `R` clear · `P` pause · `.` step a frame · `[` `]` time scale
- `C` cycle cameras: *Oyun (şerit ortası)* (default: same angle and distance as the game, centred on the lane), *Oyun (okçu)*
  (exactly the game framing), *Oyun (en uzak)* (max zoom 24 m), *Yakın*, *Yan*, *Üst*, *Hedeften* and *Ok takibi* (chase cam).
- Left click a target to aim at it, `T` cycles targets · `M` moving targets · *Yaratıklar* swaps in a goblin and a wolf (flesh hits,
  silhouettes) · *Taş duvar* (stone impacts) · *Stres* (4 extra archers) · lane direction and distance · ground colour.
- The right panel logs each cast's phases in ms (nock, release, every impact, volley, buff, hop).

**Captures:** `node tools/archervfx.mjs all --village` (or `pierce,rain --cam=archer --creatures --target=F1`). Each skill
is stepped at 60 fps to its key phases. **In game:** `node tools/archerplay.mjs`. **Regression:** `node tools/arrowhit.mjs`.

## 5. Gameplay changes made with this pass

- **Seri Atış fires 5 arrows** (was 3), each at 0.55× damage (5 × 0.55 = 2.75, about the old 3 × 0.9 = 2.7).
- **Ok Sağanağı damage lands per volley** (42 base with falloff to every target in the circle). Before, each random arrow had to
  hit a capsule, so the skill rarely did damage.

## 6. Next steps (not done)

- Sound: the `knight-sfx` events already fire (`bow_release`, `arrow_hit`, `arrow_rain`). Wire them to an audio engine for the
  full "snap".
- Instanced flats (one draw call for every ring and decal) if pierce spam in large groups ever shows up in profiles.
- A short target hit-flash tint per element (green on poison ticks, orange on fire) on creatures. This needs a colour parameter
  on `CreatureView.flash`.
- Hit-stop on the *target* side (2–3 frames) for pierce and the rapid finisher.
