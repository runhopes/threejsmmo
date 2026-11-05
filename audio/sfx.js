/* Moss Gate - combat / character sound effects (Web Audio).
 *
 * A port of Atherion's scripts/audio/{sfx_3d,sword_swing_sfx,arrow_sfx,spell_sfx,mob_hit_sfx}.gd. The clips are the SAME files
 * (audio/sfx/*.wav, mono 44.1 kHz WAV: sample-accurate starts - an mp3 decoder adds ~26 ms and the sound would land after the
 * visual); every level / pitch / interval constant below is Atherion's. All numbers in the comments are Atherion's own.
 *
 *   KNIGHT   sword swings: the three combo hits play sword_swing_01 / 02 / 03 in order (the clips are the character's shout +
 *            the swing); the LAST swing of a combo / skill with a long enough swing plays the long variant. Each clip is
 *            started PEAK_LEAD seconds early so its peak lands on the strike (Atherion measured 0.04 / 0.28 / 0.17 s).
 *   ARCHER   bow release = arrow_shot + arrow_shot_echo together (same pitch roll); arrow hit = arrow_hit pinned to the
 *            contact point ON TOP of the mob's own hit sounds; arrow rain landing = arrow_hit, -8 dB, thinned out.
 *   MAGE     fireball release = spell_shot; every mage SKILL = spell_skill (at the moment the cast is accepted).
 *   CREATURES  a hit = mob_hit_01/02 (alternating, never the same twice) + mob_hit_punch layer; a knock-down hit also
 *            mob_hit_flesh; the killing blow = mob_death_01 + mob_death_02 + mob_death_scream at once (one pitch roll).
 *
 * Distance (sfx_3d.gd, world units / 26 u hero * 1.8 m): inverse gain capped at 0 dB inside UNIT_SIZE, times a linear taper to
 * silence at MAX_DISTANCE; a source farther than that is not even started (is_audible - it must not eat the spam windows
 * of the sounds the player CAN hear). Stereo pan comes from the camera's right vector. GROUP_TRIM_DB lowers the whole group.
 *
 * Hooks (index.html): Sfx.onHeroEvent(e, hero) for the knight's events ('start' is new: an action began), Sfx.mobHit() from
 * dealDamage, Sfx.arrowHit() / Sfx.rainHit() from the ArcherVFX hooks. Browsers need a user gesture before audio plays:
 * the first pointer / key press resumes the context. Missing files / no WebAudio = silence, never an error.
 */
(function (global) {
  'use strict';

  const FILES = {
    swing: ['sword_swing_01', 'sword_swing_02', 'sword_swing_03'],
    swingLong: ['sword_swing_long_01', 'sword_swing_long_02', 'sword_swing_long_03'],
    arrowShot: 'arrow_shot', arrowEcho: 'arrow_shot_echo', arrowHit: 'arrow_hit',
    spellShot: 'spell_shot', spellSkill: 'spell_skill',
    mobHit: ['mob_hit_01', 'mob_hit_02'], punch: 'mob_hit_punch', flesh: 'mob_hit_flesh',
    kill: ['mob_death_01', 'mob_death_02', 'mob_death_scream'],
  };

  // ---- Atherion constants ----
  const WORLD_PER_METRE = 26 / 1.8;                 // Atherion's hero is ~26 units tall; ours is 1.8 m
  const UNIT_SIZE = 70 / WORLD_PER_METRE;           // sfx_3d.UNIT_SIZE 70   -> 4.85 m (full level inside it)
  const MAX_DISTANCE = 600 / WORLD_PER_METRE;       // sfx_3d.MAX_DISTANCE 600 -> 41.5 m (silent beyond)
  const GROUP_TRIM_DB = -4.0;                       // sfx_3d.GROUP_TRIM_DB
  const SWORD = { VOL: -3.0, PITCH: [0.97, 1.03], PEAK_LEAD: [0.04, 0.28, 0.17], LONG_MIN: 0.62 };
  const ARROW = { SHOT: -3.0, ECHO: -3.0, HIT: -2.0, PITCH: [0.96, 1.04], SHOT_GAP: 40, HIT_GAP: 50, RAIN_GAP: 150, RAIN_DB: -8.0 };
  const SPELL = { SHOT: -2.0, SKILL: 3.0, SHOT_PITCH: [0.96, 1.04], SKILL_PITCH: [0.98, 1.02], SHOT_GAP: 40, SKILL_GAP: 60 };
  const MOB = { VOL: 0.0, PUNCH: -6.0, FLESH: 2.0, KILL: [-3.0, -5.0, 0.0], PITCH: [0.94, 1.06], KILL_PITCH: [0.98, 1.02], GAP: 40, KILL_GAP: 60 };
  // the warrior's sword actions (the clip a skill plays follows clip_index_for_swing: the LAST swing is always sword_swing_03)
  const SWORD_ACTIONS = new Set(['attack1', 'attack2', 'attack3', 'attack4', 'special', 'dash', 'leap']);
  const COMBO_CLIP = { attack1: 0, attack2: 1, attack3: 2, attack4: 2 };

  const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);
  const lin = (db) => Math.pow(10, db / 20);
  const now = () => (global.performance ? performance.now() : Date.now());

  const Sfx = {
    ready: false, volume: 1, enabled: true,
    stats: { played: 0, byClip: {}, skippedFar: 0, skippedGap: 0 },
    log: [],                                   // last sound starts { clip, db, pan, gain, delay } (tests / debugging)
    _ctx: null, _master: null, _bufs: {}, _cfg: null, _last: {}, _comboIdx: -1, _mobIdx: -1,
  };

  /* ---------------- setup ---------------- */
  // cfg: { camera: THREE.Camera, listener: () => { x, z } }  (the hero's position; the camera gives the stereo axis)
  Sfx.init = function (cfg) {
    Sfx._cfg = cfg || {};
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC || Sfx._ctx) return Sfx;
    if (global.location && global.location.protocol === 'file:') return Sfx;     // Chrome cannot fetch() file:// - the dev benches / tools opened from disk stay silent (no console noise)
    // [mobile] iOS / WebKit: a 'playback' audio session, so the ring / silent switch does not mute the game (Safari 17+, app WebViews)
    try { if (global.navigator && global.navigator.audioSession) global.navigator.audioSession.type = 'playback'; } catch (e) { /* older WebKit */ }
    try {
      const ctx = Sfx._ctx = new AC();
      const master = Sfx._master = ctx.createGain();
      let v = 1; try { const s = localStorage.getItem('mg:sfxVolume'); if (s !== null) v = Math.max(0, Math.min(1, parseFloat(s))); } catch (e) { /* storage blocked */ }
      Sfx.volume = isFinite(v) ? v : 1; master.gain.value = Sfx.volume;
      const an = Sfx._an = ctx.createAnalyser(); an.fftSize = 512;            // (tests read the output level)
      master.connect(an); master.connect(ctx.destination);
      // a gesture also retries the clip load once if it found nothing at startup (app WebViews can refuse requests that early)
      let retried = false;
      // iOS / WebKit: the context can sit in 'interrupted' (not only 'suspended') — before the first gesture, after a call or after the
      // app was in the background. Every gesture resumes it while it is not 'running', and plays a 1-sample silent buffer INSIDE the
      // gesture (WebKit only unlocks output for a source started from a user gesture).
      const kick = () => {
        try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); } catch (e) { /* ignore */ }
      };
      Sfx.unlocked = false;
      const unlock = () => {
        if (ctx.state !== 'running') { kick(); ctx.resume().then(() => { Sfx.unlocked = ctx.state === 'running'; }).catch((e) => { Sfx.lastError = 'resume: ' + (e && e.message); }); }
        else Sfx.unlocked = true;
        if (!retried && Sfx.ready === false && !Object.keys(Sfx._bufs).length) { retried = true; Sfx._load(); }
      };
      ctx.onstatechange = () => { if (ctx.state !== 'running') Sfx.unlocked = false; };
      global.document && global.document.addEventListener('visibilitychange', () => { if (!global.document.hidden && ctx.state !== 'running') ctx.resume().catch(() => {}); });
      // [mobile] iOS only lets touchend / click start audio, and the touch layer (mobile.js) stops world pointerdowns in the capture
      // phase: listen in the capture phase too, on every gesture kind
      for (const ev of ['pointerdown', 'keydown', 'touchstart', 'touchend', 'click']) global.addEventListener(ev, unlock, { passive: true, capture: true });
      Sfx._load();
    } catch (e) { Sfx._ctx = null; }
    return Sfx;
  };
  Sfx.setVolume = function (v) {                                              // 0..1 (the player's "Karakter Sesleri" level)
    Sfx.volume = Math.max(0, Math.min(1, +v || 0));
    if (Sfx._master) Sfx._master.gain.value = Sfx.volume;
    try { localStorage.setItem('mg:sfxVolume', String(Sfx.volume)); } catch (e) { /* storage blocked */ }
  };
  Sfx._load = function () {
    const names = [].concat(...Object.values(FILES));
    const base = (Sfx._cfg && Sfx._cfg.base) || 'audio/sfx/';
    let left = names.length;
    const done = () => { if (--left === 0) Sfx.ready = Object.keys(Sfx._bufs).length > 0; };
    for (const n of names) {
      // no file:// fetch (Chrome blocks it) and no 404 noise: a failed clip is simply a silent clip
      // [mobile] the app's bundled files: the WebView's own fetch (CapacitorWebFetch when a native HTTP patch is installed)
      (global.CapacitorWebFetch || global.fetch)(base + n + '.wav').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(0)))
        .then((ab) => new Promise((res, rej) => Sfx._ctx.decodeAudioData(ab, res, rej)))
        .then((buf) => { Sfx._bufs[n] = buf; }).catch((e) => { Sfx.lastError = n + ': ' + (e && (e.message || e.name) || e); }).then(done);
    }
  };

  /* ---------------- core: one positioned one-shot ---------------- */
  // pos: { x, z } world position (null = at the hero). Returns true when a sound was started.
  Sfx._play = function (name, db, pitch, pos, delay) {
    const ctx = Sfx._ctx, buf = Sfx._bufs[name];
    if (!ctx || !buf || !Sfx.enabled || Sfx.volume <= 0) return false;
    let gain = lin(db + GROUP_TRIM_DB), pan = 0;
    const L = Sfx._cfg && Sfx._cfg.listener ? Sfx._cfg.listener() : null;
    if (pos && L) {
      const dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz);
      if (d > MAX_DISTANCE) { Sfx.stats.skippedFar++; return false; }
      // inverse-distance gain with the 0 dB ceiling (sfx_3d.MAX_DB) x linear taper to silence at MAX_DISTANCE
      gain *= Math.min(1, UNIT_SIZE / Math.max(d, 1e-3)) * Math.max(0, 1 - d / MAX_DISTANCE);
      const cam = Sfx._cfg.camera;
      if (cam && d > 0.3) {
        const e = cam.matrixWorld.elements, rl = Math.hypot(e[0], e[2]) || 1;
        pan = Math.max(-0.85, Math.min(0.85, ((dx * e[0] + dz * e[2]) / (d * rl)) * Math.min(1, d / 3)));
      }
    }
    if (gain < 1e-4) return false;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = pitch || 1; g.gain.value = gain;
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(g); out.connect(Sfx._master);
    src.onended = () => { try { src.disconnect(); out.disconnect(); if (out !== g) g.disconnect(); } catch (e) { /* already gone */ } };
    src.start(ctx.currentTime + Math.max(0, delay || 0));
    Sfx.stats.played++; Sfx.stats.byClip[name] = (Sfx.stats.byClip[name] || 0) + 1;
    Sfx.log.push({ clip: name, db, pan: +pan.toFixed(2), gain: +gain.toFixed(3), delay: +(delay || 0).toFixed(3), t: now() });
    if (Sfx.log.length > 80) Sfx.log.shift();
    return true;
  };
  // spam windows (the static counters of the .gd files). The audibility gate runs FIRST so a far fight never eats a window.
  Sfx._audible = (pos) => { const L = Sfx._cfg && Sfx._cfg.listener ? Sfx._cfg.listener() : null; return !pos || !L || Math.hypot(pos.x - L.x, pos.z - L.z) <= MAX_DISTANCE; };
  Sfx._gap = function (key, ms) { const t = now(); if (t - (Sfx._last[key] || -1e5) < ms) { Sfx.stats.skippedGap++; return false; } Sfx._last[key] = t; return true; };

  /* ---------------- knight: sword swings ---------------- */
  // sword_swing_sfx.clip_index_for_swing: the LAST swing is always sword_swing_03, the ones before alternate 01 / 02
  const clipIndexForSwing = (swing, total) => (total <= 0 || swing >= total ? 2 : (swing - 1) % 2);
  Sfx.swordStart = function (e) {
    const d = e.def, rate = e.rate || 1; if (!d || !d.hitWin || !d.hitWin.length) return;
    const skillRun = !!e.skill || !COMBO_CLIP.hasOwnProperty(e.name), n = d.hitWin.length, skipT = (e.skip || 0) * d.dur;
    for (let w = 0; w < n; w++) {
      const idx = skillRun ? clipIndexForSwing(w + 1, n) : COMBO_CLIP[e.name];
      const strike = d.hitWin[w][0] + 0.45 * (d.hitWin[w][1] - d.hitWin[w][0]);            // the cut's fastest moment inside the hit window
      const delay = Math.max(0, (strike - skipT - SWORD.PEAK_LEAD[idx]) / rate);           // start early: the clip's PEAK lands on the strike
      const lastSwing = idx === 2 && (!skillRun || w === n - 1);
      const long = lastSwing && d.dur / rate >= SWORD.LONG_MIN;                           // the finishing swing rings out (long variant, same peak lead)
      Sfx._play(long ? FILES.swingLong[idx] : FILES.swing[idx], SWORD.VOL, rnd(SWORD.PITCH), null, delay);
    }
  };

  /* ---------------- archer ---------------- */
  Sfx.arrowShot = function () {                                                            // the bow is released (every archer projectile, once per release)
    if (!Sfx._gap('arrowShot', ARROW.SHOT_GAP)) return;
    const p = rnd(ARROW.PITCH);                                                            // shot + echo share one pitch roll (two rolls would sound like two arrows)
    Sfx._play(FILES.arrowShot, ARROW.SHOT, p, null); Sfx._play(FILES.arrowEcho, ARROW.ECHO, p, null);
  };
  Sfx.arrowHit = function (point) {                                                        // an arrow went into a creature: pinned to the contact point
    if (!Sfx._audible(point) || !Sfx._gap('arrowHit', ARROW.HIT_GAP)) return;
    Sfx._play(FILES.arrowHit, ARROW.HIT, rnd(ARROW.PITCH), point);
  };
  Sfx.rainHit = function (point) {                                                         // arrow rain landing: quieter + thinned out (its own window)
    if (!Sfx._audible(point) || !Sfx._gap('arrowRain', ARROW.RAIN_GAP)) return;
    Sfx._play(FILES.arrowHit, ARROW.RAIN_DB, rnd(ARROW.PITCH), point);
  };

  /* ---------------- mage ---------------- */
  Sfx.spellShot = function () { if (Sfx._gap('spellShot', SPELL.SHOT_GAP)) Sfx._play(FILES.spellShot, SPELL.SHOT, rnd(SPELL.SHOT_PITCH), null); };
  Sfx.spellSkill = function () { if (Sfx._gap('spellSkill', SPELL.SKILL_GAP)) Sfx._play(FILES.spellSkill, SPELL.SKILL, rnd(SPELL.SKILL_PITCH), null); };

  /* ---------------- creatures: being hit / killed ---------------- */
  // pos: the creature { x, z }; killing: this blow killed it; heavy: this blow knocks it down (the 3rd swing / a skill strike)
  Sfx.mobHit = function (pos, killing, heavy) {
    if (!Sfx._audible(pos)) return;
    if (killing) {                                                                         // death pair + scream, one pitch roll, own window
      if (!Sfx._gap('mobKill', MOB.KILL_GAP)) return;
      const p = rnd(MOB.KILL_PITCH);
      for (let i = 0; i < FILES.kill.length; i++) Sfx._play(FILES.kill[i], MOB.KILL[i], p, pos);
      return;
    }
    if (!Sfx._gap('mobHit', MOB.GAP)) return;
    const n = FILES.mobHit.length;                                                         // never the same clip twice in a row (two clips = 1-2-1-2)
    let i = Math.floor(Math.random() * n); if (Sfx._mobIdx >= 0) i = (Sfx._mobIdx + 1 + Math.floor(Math.random() * (n - 1))) % n;
    Sfx._mobIdx = i;
    const p = rnd(MOB.PITCH);                                                              // cut + punch (+ flesh) share one pitch roll
    Sfx._play(FILES.mobHit[i], MOB.VOL, p, pos); Sfx._play(FILES.punch, MOB.PUNCH, p, pos);
    if (heavy) Sfx._play(FILES.flesh, MOB.FLESH, p, pos);
  };

  /* ---------------- the knight's gameplay events ---------------- */
  // e: { type, name, def, skill, ... } as emitted by knight.js; hero: the ACTIVE hero (events of the other two are ignored)
  Sfx.onHeroEvent = function (e, hero) {
    if (!Sfx._ctx || !hero) return;
    const cls = hero.cls;
    if (e.type === 'start') {
      if (cls === 'warrior' && SWORD_ACTIONS.has(e.name)) Sfx.swordStart(e);
      else if (cls === 'mage' && e.skill) Sfx.spellSkill();                              // every mage skill, at the moment the cast is accepted
    } else if (e.type === 'impact') {
      if (cls === 'archer' && e.def && e.def.ranged) Sfx.arrowShot();
      else if (cls === 'mage' && e.def && e.def.spell && !e.skill) Sfx.spellShot();      // the basic fireball release (skills already played spell_skill)
    }
  };

  global.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
