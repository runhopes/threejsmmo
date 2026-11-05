# MageFX — Büyücü büyü efektleri (mage spell VFX)

Procedural three.js r128 VFX for the nine mage spells (no image files, no imported models). Built for the game camera
(~33° elevation, 10 m default, 3.5–24 m zoom) and the bright sandy village ground.

| File | Role |
|---|---|
| `core.js` | Palettes per school, quality presets, math, **procedural particle atlas** (16 frames) + **school sigils**, glyph alphabet, GLSL noise, premultiplied blending |
| `particles.js` | Pooled CPU particle sim (struct-of-arrays) drawn as **instanced billboards in 2 draw calls**; anchors (ride the staff orb), held particles (projectile heads), velocity stretch |
| `trails.js` | Pooled time-based ribbon trails (camera facing, interpolated tail, noise breakup) |
| `ground.js` | Ground layer: **sigil telegraphs**, shock rings, scorch (Voronoi cracks that cool), frost, glow / shadow disks |
| `meshes.js` | Flame surfaces (pillar, nova wall), shield dome, lightning ribbons, ice spear / shards, molten rock, instanced shard bursts, shared light pool |
| `spells.js` | **The nine spells** (cast → release → travel → impact → linger), shared building blocks, telegraph, tuning table |
| `director.js` | `MageFX.create()` — the only API pages use |

**Test scene:** `magefx.html` (village ground by default, `?world=arena` plain). Keys **1–9** cast, Space replay, L loop,
0 play all, P pause, `.` frame step, time-scale slider (0.05–2×), per-spell timing sliders (saved in localStorage,
"JSON kopyala" exports them), camera presets incl. the real game camera / zoomed out, quality, target set (dummy /
dummy + goblin, wolf, boar for silhouette checks), gameplay-radius overlay, shield hits (H, B, auto), live timeline of
the last cast and a performance readout.

**Tools:** `node tools/mfxshot.mjs <out> [spell,..|all] [query]` — deterministic contact sheets from the game camera
(fixed 1/60 s stepping). `node tools/mfxplay.mjs <out> [query]` — the real game with real input (`ONLY=storm,blink`).
**Game:** `index.html?cls=mage`; `?mfx=0` = the old effects for comparison; `?fxq=low|medium|high`.

---

## 1. Art direction

**One class, five schools.** Every spell uses the same grammar so the nine read as one mage:

* the same **sigil construction** (double outer ring, gold glyph band, inner ring, school geometry) and glyph alphabet;
* the same **release flare** at the staff orb (white-hot flash + star + ring pop + spark cone);
* the same **impact language**: flash → school burst → crisp ground ring → decal that fades (scorch / frost / burn);
* the staff orb and its charge motes **take the school colour** while casting.

| School | Spells | Core → body → edge | Shapes |
|---|---|---|---|
| Fire | Ateş Topu, Meteor, Alev Halkası, Ateş Sütunu, Ateş Fırtınası | `#fff3d2` → `#ffc04a` / `#ff7418` → `#b82a08` | round blooms, rising tongues, embers, smoke, cracked char |
| Frost | Buz Mızrağı | `#f6fdff` → `#7cd0ff` → `#2a6fd0` | angular crystals only, no clouds; facet lines, glints |
| Storm | Yıldırım | `#ffffff` → `#9ab4ff` → `#5462f0` | jagged ribbons, branching, short arcs |
| Arcane | Işınlanma | `#f8f0ff` → `#a880ff` → `#5836cc` | light shafts, motes, streak |
| Ward | Mana Kalkanı | `#eef6ff` → `#6c98ff`, gold glyphs `#ffd98a` | dome rim, hex cells, orbiting runes |

**Readability rules (what made it work on this ground):**

* **The telegraph edge is the gameplay radius**, drawn crisp by the shader with a dark halo underneath, so it reads on
  both bright sand and dark cobbles. Fill stays faint; a progress disk reaches the edge exactly at impact.
* **Premultiplied blending everywhere**: one material can be additive (glow) or covering (smoke, char). Fire bodies
  are ~35 % additive, otherwise orange turns white on the sand. Point lights are kept weak (×0.55). Fake light comes
  from additive ground disks instead.
* Impact bursts are pulled **out of the target's capsule toward the caster** (host hit points lie on the capsule axis
  and would be hidden by the body). Fire layers of the meteor sit **in front of** the opaque rock.
* Only ~3 m of air above a target is on screen from the game camera, so **meteors come in diagonally from the screen
  side** (camera relative) with a long trail and a growing ground shadow. Lightning comes from the far side.
* Lifetimes are short; scorch marks are capped at 8 (the oldest fades fast), so repeated casting never paints the
  field black. Enemy silhouettes stay visible (decals are under them, the column is streaky, the dome is rim-only).

## 2. Spell plan (default tuning, times from the key press)

| Spell | Cast / anticipation | Release | Travel | Impact | Linger |
|---|---|---|---|---|---|
| **Ateş Topu** (basic) | 0–0.46 s: fire motes spiral into the orb, flame licks | orb flare + ring pop | 19 m/s: white core in an orange shell, comet streak, swirling ember helix, ribbon | flash, bloom (14 puffs), sparks, smoke, 1.5 m ring | scorch 2.6 s |
| **Meteor** | sigil (2.8 m) appears at press, fills to impact; staff calls up, embers shoot skyward | upward flare + sparks | 0.7 s diagonal fall: molten-crack rock inside fire, 0.5 s trail, smoke, falling sparks, ground shadow + glow grow | 4 m flash, flame dome + column, debris, dust ring, 3.5 m shock ring, dust ring | crater with cooling lava cracks 3.8 s, afterburn 2.4 s |
| **Alev Halkası** | feet sigil draws in clockwise and spins up, heat motes pulled in | slam: ground flash, fast white pulse ring | flame wall ring 0.4 → 4.5 m in 0.42 s (eased), crisp heated front, tongues + embers on the rim, shimmer ahead | damage when the ring reaches each target | char band, 0.7 s burn-out |
| **Buz Mızrağı** | shard motes, cold mist falls; a frost sigil "barrel" forms in front of the staff | sigil shatters in its plane, glints | 30 m/s faceted lance with fletching crystals, glow streak, thin double trail, glints, snow | white-cyan flash + star, 14 instanced crystal shards, shard sprites, frost ring | frost decal 2.8 s, 6 ice splinters planted in the ground 1.6 s |
| **Yıldırım** | storm sigil (1.6 m) with static crawling on the edge, sparks around the orb | leader bolt + circle flash (pre-flash 0.07 s) | — | branching bolt from the far side, 3 strikes over 0.3 s, 7 ground arcs, 2.1 m ring, sparks | blue-white fulgurite scorch, crackle 0.7 s |
| **Ateş Sütunu** | sigil + glowing cracks that heat with the progress, embers from the cracks | ground swell: cracks flare, dust, pebbles | eruption +0.1 s: upward burst, column rises 3.6 m (overshoot) | 1.5 s: streaky outer flames + hot core, licks, spiral embers, top smoke; ticks every 0.3 s | collapse 0.32 s, scorch, smoke wisps |
| **Işınlanma** | feet sigil, motes spiral up the body, destination marker | body dissolves into motes drifting toward the target, light shaft | arcane streak along the path + streaming motes | light shaft, implosion, arrival sigil flare, ring | — (snappy) |
| **Mana Kalkanı** | ward sigil draws in, glyphs rise | dome forms bottom → top (0.32 s, overshoot), ring | — | hits: ripple + lit cells toward the attacker, shard sparks | 12 s: rim + hex cells, 3 orbiting glyphs, ground sigil; weakening: cells drop out, glyphs 3 → 2 → 1, flicker < 35 %; break = shatter, expiry = drain |
| **Ateş Fırtınası** | big sigil (4.2 m), danger glow, embers across the area, flame stream from the staff | skyward flare | 6 meteors every 0.22 s from alternating sides, each with a shrinking landing marker | each blast ~60 % of a Meteor | finale at the centre: area-wide blast + dust ring, big scorch, burning field 2.6 s |

## 3. Architecture & performance

* **Draw calls:** all particles = 2; each trail, decal, flame surface, bolt = 1; shards = 2 instanced. Storm peak ≈ 35.
* **Budget (measured on the bench):** storm peak ≈ 740 particles / 21 decals / 35 shards, MageFX update < 0.2 ms per
  frame. Other spells peak at 50–300 particles.
* **Pooling:** particles, trails, decals (per kind), flame surfaces, spears, rocks, bolts; no allocation in the
  particle loop.
* **Quality:** `low / medium / high` scale spawn density (0.45 / 0.75 / 1) and light count; `tuning.global.density`
  and brightness on top.
* **Lights:** the game's two existing point lights are **shared**: the legacy code resets them each frame, and
  MageFX only takes over when its light is stronger. No new lights means no shader recompiles.

## 4. Game integration (`index.html`, lines marked `magefx:`)

```js
const MFX = MageFX.create({ scene, camera, renderer, lights: [boltLight, blastLight], feel: (shake, punch) => {...} });
MFX.attach(mageKnight);                          // anticipation starts / cancels itself from knight.action
const tg = MFX.telegraph('meteor', point, 2.8);  // right after knight.play: progress fill timed to the impact
MFX.release('meteor', { point, radius, telegraph: tg, onImpact: (i) => damage(i.point, i.radius) });   // on the 'impact' event
MFX.release('fireball', { from, dir, range, step: (p0, p1) => hit | null, home: () => targetPos, onHit: (hit, dir) => damage });
MFX.release('nova', { center, radius, onSweep: (r0, r1) => damage targets the ring just reached });
MFX.release('pillar', { point, radius, telegraph, onTick });  MFX.release('blink', { from, to, telegraph });
MFX.release('mshield', { follow: knight.root, state: () => ({ active, frac }) });  MFX.shieldHit(fromX, fromZ);
MFX.update(dt);                                  // after updateMagic (which resets the shared lights)
```

Gameplay stays in the page (aim, hit tests, damage, movement). MageFX calls back at the visual moment, so hits land
when they look like they land. Changes in feel: Alev Halkası now damages as the ring reaches each target (it used to
hit instantly). Ateş Fırtınası's last meteor lands in the centre with a 2.8 m radius (the others are 2.0 m, as before).
Timings marked **(G)** in the tuning table drive those callbacks; for a server they belong in a shared defs file like
`creatures/defs.js`.

## 5. Recommendations / next polish

* **Sound:** `feel()` and `event('release' | 'impact')` are the natural hooks for the `knight-sfx` audio events.
* Profile fill rate on the target iGPU (Radeon 610M) with `?fxq=medium`. The largest overdraw is the meteor flash and
  the storm zone; shrink those first if needed.
* `vfx/core.js` (archer, VFXKit) and MageFX solved the same problems separately. Merging them into one kit (atlas,
  particles, trails, decals) would cut duplicate code and draw calls once both are approved.
* Optional extras that fit the style: a brief screen-space heat haze under the pillar, mana-cost "drain" motes from
  the HUD orb to the staff, and a death / interrupt fizzle (castEnd(false) currently just fades).
