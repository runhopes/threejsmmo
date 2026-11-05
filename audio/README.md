# audio/ - combat & character sounds

`sfx.js` (global `Sfx`) plays the sounds of the three classes and the creature hits. It is a port of Atherion's
`scripts/audio/{sfx_3d,sword_swing_sfx,arrow_sfx,spell_sfx,mob_hit_sfx}.gd`: the SAME 18 clips (`audio/sfx/*.wav`, mono 44.1 kHz WAV -
sample-accurate starts; an mp3 decoder would add ~26 ms and the sound would land after the visual) and the same levels, pitch rolls and
spam windows (the constants in `sfx.js` carry Atherion's numbers).

| Who | Sound | Trigger |
|---|---|---|
| Knight | `sword_swing_01/02/03` (the character's shout + swing) in combo order; the LAST swing of a combo / skill rings out as `sword_swing_long_0x` | `start` event of the action, scheduled so the clip's PEAK (`PEAK_LEAD` 0.04 / 0.28 / 0.17 s) lands on the strike (middle of the hit window). Skills: `clipIndexForSwing` (last swing = clip 03; whirlwind = 01 then long 03). War cry: silent |
| Archer | `arrow_shot` + `arrow_shot_echo` (one pitch roll), `arrow_hit` ON TOP of the creature's hit sounds, rain landings -8 dB / 150 ms window | `impact` event of a ranged action; ArcherVFX `onHit` / `event('impact', style 'rain')` |
| Mage | `spell_shot` (fireball release), `spell_skill` (EVERY mage skill) | `impact` of the basic cast / `start` of a skill action |
| Creatures | hit = `mob_hit_01/02` (alternating) + `mob_hit_punch`; knock-down hit (the visual's `heavy` flag) + `mob_hit_flesh`; killing blow = `mob_death_01` + `_02` + `_scream` at once | `dealDamage()` in index.html (DoT ticks / the 2nd fire-arrow hit stay silent) |

Distance: inverse gain, 0 dB inside `UNIT_SIZE` (4.85 m = Atherion's 70 u), linear taper to silence at `MAX_DISTANCE` (41.5 m = 600 u); a source farther than
that is not started and does not consume the spam windows (`is_audible`). Pan from the camera's right vector. `GROUP_TRIM_DB` -4 on everything.

* Browsers need a user gesture before audio plays: the first pointer / key press resumes the context.
* `file://` (benches / tools opened from disk) stays silent on purpose (`fetch` of local files is blocked) - serve the project (`npm start`) to hear it.
* Volume: `Sfx.setVolume(0..1)` (saved in localStorage `mg:sfxVolume`). There is no settings page for it yet (the HUD shows only what the game has).
* Debug: `Sfx.stats`, `Sfx.log` (last 80 starts: clip, dB, pan, gain, delay), `Sfx._an` (AnalyserNode on the master bus).
* Not ported (Atherion has them, this game has no matching system yet): UI sounds, coins / potions / quest cues, music, ambience, rain.
