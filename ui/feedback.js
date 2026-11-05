/* TDS HUD part — combat feedback, ported 1:1 from Atherion:
 *   scripts/vfx/damage_number.gd (Rev.11)  floating combat text: Cinzel 900, 8° slant, tone-in outline, log size ladder, M2 "yay" arc
 *                                          (sharp exponential rise + alternating side throw), M4 crit "çakma" (3× slam, shake, white-hot
 *                                          flash, additive halo), M3 "sütun" column for gains; fade in .18 s, fade out 1 − u².
 *   scripts/ui/status_banner.gd STYLE_SEAL  "Mühür Şeridi" (hata_bildirimi_tasarim.html Yön A): status stamp + message over an elliptic
 *   + status_banner_hub.gd (general lane)  darkening, accent wash and two plateau rules; errors shake and interrupt, level-up queues.
 *   scripts/vfx/damage_veil.gd + shaders/damage_veil.gdshader  "Perde" (hasar_perdesi_tasarim.html V1): blood seeps in from the screen
 *                                          edges on a hit (4 tiers by damage / max HP), slow / fast pulse under 25 % / 12 % HP.
 * Numbers live in the world like Atherion's Label3D: they keep their world point, size follows the camera (Atherion units mapped to
 * metres by hero height), so their size relative to the characters is Atherion's. The veil is the shader evaluated on a coarse grid
 * (smooth field) and stretched to the screen. Death: delegates to window.HUDDeath (ui/death.js) when present.
 * Registers HUDParts.feedback: { number(pos, text, kind), frame(dt), error(text), levelUp(level), dead(on), hurt(), resize(s) }.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint;
  const TAU = Math.PI * 2;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const quadOut = (t) => 1 - (1 - t) * (1 - t);
  const quadIn = (t) => t * t;
  const quadInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
  const backOut = (t) => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };   // Godot TRANS_BACK / EASE_OUT
  const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const rgb255 = (c) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
  const hex = (h) => P.hexRGB(h).map((v) => v / 255);
  const css = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';

  /* ================= damage numbers — damage_number.gd ================= */
  // One Atherion world unit in metres: the Atherion body is 26.1 units tall (camera_orbit.gd), the hero here ~1.95 m (index.html).
  const UNIT_M = 1.95 / 26.1;
  const DN = {
    DURATION: 1.70, FADE_START: 0.48, RISE_MIN: 78, RISE_MAX: 102, RISE_DRAG: 6.0, SIDE_MIN: 64, SIDE_MAX: 100, DEPTH_MAX: 16, H_DRAG: 5.0,
    WOB_F_MIN: 4, WOB_F_MAX: 7.5, WOB_S_MAX: 0.03,
    RES_DURATION: 2.30, RES_FADE_START: 0.58, RES_RISE: 36, RES_DRAG: 3.6,
    CRIT_DUR: 1.15, SLAM: 0.05, SLAM_SCALE: 3.0, SHAKE: 0.13, SHAKE_AMP: 0.17, SHAKE_FREQ: 5, REBOUND: 0.14, FLASH: 0.055,
    HALO_PAD_X: 2.23, HALO_PAD_Y: 2.80, HALO_PEAK: 0.95, HALO_BASE: 0.38, HALO_DECAY: 0.18, HALO_FOLLOW: 0.55,
    POP_IN: 0.035, POP_SETTLE: 0.09, POP_OVER: 0.6, FADE_IN: 0.18,
    SIZE_LO: Math.log(40), SIZE_HI: Math.log(3000), SIZE_MIN: 0.78, SIZE_SPAN: 0.50, OUTLINE: 0.090, PIXEL: 0.034, QUANTUM: 4,
    SLANT: Math.tan(8 * Math.PI / 180), DIGIT_EM: 0.7175, JITTER: 0.35, JITTER_TAKEN: 0.3,
  };
  const COL_FLASH = [1.00, 0.98, 0.86], COL_HALO = rgb255([1.00, 0.66, 0.20]);
  // Kind map. dmg / crit / hurt are Atherion's DEALT / DEALT_CRIT / TAKEN. Atherion has no poison or ice number: poison takes the design
  // doc's DoT tick ("#A8E88C, 78 sabit", hasar_sayilari_tasarim.html §4) with the green family's outline, ice the code's ice blue
  // (COLOR_MISS "soğuk buz mavisi") on the DEALT ladder, buff (skill name / "+N TP") the M3 column at the HEAL size in the banner gold.
  const KINDS = {
    dmg: { base: 108, col: [1.00, 0.94, 0.46], out: [0.18, 0.11, 0.00], scaled: true },
    crit: { base: 216, col: [1.00, 0.70, 0.14], out: [0.32, 0.09, 0.00], scaled: true, crit: true },
    hurt: { base: 112, col: [1.00, 0.29, 0.20], out: [0.16, 0.01, 0.00], scaled: true, taken: true },
    poison: { base: 78, col: hex('#A8E88C'), out: [0.02, 0.13, 0.04] },
    ice: { base: 108, col: [0.55, 0.85, 1.00], out: [0.03, 0.10, 0.20], scaled: true },
    buff: { base: 92, col: hex('#E2C78F'), out: [0.29, 0.13, 0.00], column: true },
  };
  for (const k in KINDS) { KINDS[k].c255 = rgb255(KINDS[k].col); KINDS[k].o255 = rgb255(KINDS[k].out); }
  const amountBoost = (a) => clamp01((Math.log(Math.max(a, 1)) - DN.SIZE_LO) / (DN.SIZE_HI - DN.SIZE_LO));
  const MAX_NUMBERS = 64;                                          // damage_number.gd POOL_SIZE (a dozen mobs x 10 hits/s x 1.7 s fits)

  /* ================= status banner — status_banner.gd STYLE_SEAL ================= */
  const BN = {
    BOTTOM: 246, MIN_W: 260, MAX_RATIO: 0.46, MAX_ROWS: 2, KIND_PAD_X: 40, KIND_FS: 12, MSG_FS: 23, DETAIL_FS: 14, DETAIL_A: 0.72, KIND_SP: 3,
    RULE_H: 1, KIND_GAP: 9, MSG_GAP: 4, DETAIL_GAP: 3, RULE_BOT_GAP: 10, RULE_TOP_RATIO: 0.46, SPOT_X: 150, SPOT_Y: 28, WASH_IX: 0.58, WASH_IY: 0.45,
    RULE_TOP_A: 0.62, RULE_BOT_A: 0.46, WASH_A: 0.26, WASH_A_LEVEL: 0.30,
    FADE_IN: 0.20, HOLD: 1.90, HOLD_DETAIL: 2.60, FADE_OUT: 0.45, TEXT_DELAY: 0.06, TEXT_RISE: 6, SCALE_IN: 0.84, SCALE_OUT: 0.95,
    FLASH: 2.6, FLASH_T: 0.14, SHAKE: 4, SHAKE_T1: 0.05, SHAKE_T2: 0.08, SHAKE_T3: 0.07, QUEUE_MAX: 4, MARGIN: 10,
  };
  const TONE_FAIL = 0, TONE_SUCCESS = 1, TONE_LEVEL = 2;
  const ACC = { [TONE_FAIL]: rgb255([0.886, 0.376, 0.314]), [TONE_SUCCESS]: rgb255([0.494, 0.808, 0.478]), [TONE_LEVEL]: rgb255([0.910, 0.745, 0.416]) };
  const COL_MSG = rgb255([0.965, 0.933, 0.902]), COL_GOLD = P.hexRGB('#E2C78F');
  // i18n (data/i18n/ui_strings.csv): BANNER_KIND_BLOCKED, BANNER_KIND_LEVEL_UP, LEVEL_UP_MSG
  const KIND_BLOCKED = 'ENGELLENDİ', KIND_LEVEL_UP = 'SEVİYE ATLADIN', LEVEL_UP_MSG = (n) => 'Artık Seviye ' + n;
  const F_MSG = (px) => '800 ' + px + 'px Alegreya, Georgia, serif', F_KIND = '700 ' + BN.KIND_FS + 'px Alegreya, Georgia, serif';

  /* ================= damage veil — damage_veil.gd + damage_veil.gdshader ================= */
  const VEIL = {
    TIERS: [
      { max: 0.04, a: 0.16, rise: 0.040, fall: 0.280 },
      { max: 0.10, a: 0.32, rise: 0.055, fall: 0.420 },
      { max: 0.22, a: 0.54, rise: 0.070, fall: 0.620 },
      { max: 999, a: 0.78, rise: 0.085, fall: 0.900 },
    ],
    CAP: 0.82, T1: 0.25, T2: 0.12, T1_PERIOD: 0.95, T2_PERIOD: 0.62, T1_BASE: 0.12, T1_AMP: 0.18, T2_BASE: 0.20, T2_AMP: 0.24, PULSE_FADE: 0.5,
    CLEAR_R: 0.42, PULSE_CLEAR_EXTRA: 0.10, SCALE: 1.0, PULSE_ON: true, ROWS: 72,
    DEEP: [0.290, 0.008, 0.024], MID: [0.557, 0.039, 0.047], HOT: [0.780, 0.102, 0.078],
  };

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.feedback = function (hud) {
    const root = hud.root;
    const dpr = () => Math.min(2, global.devicePixelRatio || 1);
    let vw = global.innerWidth, vh = global.innerHeight, sizeDirty = true;
    global.addEventListener('resize', () => { sizeDirty = true; });
    if (document.fonts) ['900 20px Cinzel', '800 20px Alegreya', '700 12px Alegreya'].forEach((f) => document.fonts.load(f).catch(() => {}));

    /* ---------- numbers: one viewport canvas under the HUD panels (z -1; name plates -2) ---------- */
    const ncv = document.createElement('canvas');
    ncv.className = 'fbk-numbers';
    ncv.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;pointer-events:none';
    root.insertBefore(ncv, root.firstChild);
    const ng = ncv.getContext('2d');
    let nDrawn = false, clock = 0, sideFlip = false;
    const pool = [];
    for (let i = 0; i < MAX_NUMBERS; i++) pool.push({ on: false });
    const live = [];                                                  // reused draw list
    const metricCache = new Map();
    function fontMetrics(font) {
      let m = metricCache.get(font);
      if (!m) { ng.save(); ng.font = font; const t = ng.measureText('0'); m = { a: t.fontBoundingBoxAscent, d: t.fontBoundingBoxDescent }; ng.restore(); metricCache.set(font, m); }
      return m;
    }
    P.onFonts(() => { metricCache.clear(); for (const it of pool) if (it.on) measure(it); });
    function measure(it) {
      ng.save(); ng.font = it.font; ng.letterSpacing = '0px'; it.w = ng.measureText(it.text).width; ng.restore();
      const m = fontMetrics(it.font); it.baseOff = (m.a - m.d) * 0.5;
      if (it.halo) { const dh = it.fs * DN.DIGIT_EM; it.hw = it.w + dh * DN.HALO_PAD_X; it.hh = dh * (1 + DN.HALO_PAD_Y); }
    }
    const toScreen = (v, out) => { out.x = (v.x * 0.5 + 0.5) * vw; out.y = (-v.y * 0.5 + 0.5) * vh; out.z = v.z; return out; };
    const _a = { x: 0, y: 0, z: 0 }, _b = { x: 0, y: 0, z: 0 }, _c = { x: 0, y: 0, z: 0 };
    function project(x, y, z, out) {
      const v = hud.opts.project && hud.opts.project(x, y, z);
      if (!v) return null;
      return toScreen(v, out);
    }
    // camera right, flattened to the ground (damage_number._screen_space_basis), recovered from the projection: the horizontal world
    // direction whose image is screen-horizontal; the depth axis is its horizontal perpendicular (its sign is random in Atherion anyway).
    function cameraRight(x, y, z, out) {
      const o = project(x, y, z, _a), a = o && project(x + 1, y, z, _b) && { x: _b.x - _a.x, y: _b.y - _a.y }, b = a && project(x, y, z + 1, _c) && { x: _c.x - _a.x, y: _c.y - _a.y };
      out[0] = 1; out[1] = 0;
      if (!o || !a || !b) return out;
      let al = b.y, be = -a.y, len = Math.hypot(al, be);
      if (len < 1e-6) { if (Math.abs(a.x) >= Math.abs(b.x)) { al = 1; be = 0; } else { al = 0; be = 1; } len = 1; }
      al /= len; be /= len;
      if (al * a.x + be * b.x < 0) { al = -al; be = -be; }
      out[0] = al; out[1] = be; return out;
    }
    const _r = [1, 0];
    function number(pos, text, kind) {
      text = String(text);
      const K = KINDS[kind] || KINDS.dmg;
      const amount = +text.replace(/[^\d]/g, '') || 0;
      if (K.taken) { lastHurt.amount = amount; lastHurt.t = clock; text = text.replace(/^[-−]\s*/, ''); }   // Atherion prints the taken amount bare (red, no sign)
      if (!hud.settings.numbers && kind !== 'buff') return;
      if (!pos) return;
      let it = null;
      for (const p of pool) if (!p.on) { it = p; break; }
      if (!it) it = pool.reduce((a, b) => (a.born < b.born ? a : b));     // hard cap: recycle the oldest
      // no stacking: Atherion separates consecutive numbers only by the alternating side throw (_side_flip) + depth scatter
      const crit = !!K.crit, boost = amountBoost(amount), mult = K.scaled ? DN.SIZE_MIN + boost * DN.SIZE_SPAN : 1, q = DN.QUANTUM * (crit ? 2 : 1);
      it.on = true; it.born = clock; it.K = K; it.text = text; it.ax = pos.x; it.az = pos.z;
      it.fs = Math.max(Math.round(K.base * mult / q) * q, q);
      it.ow = Math.max(Math.round(it.fs * DN.OUTLINE), 1);
      it.font = '900 ' + it.fs + 'px Cinzel, Georgia, serif';
      it.halo = crit; it.flash = crit;
      measure(it);
      const j = (K.taken ? DN.JITTER_TAKEN : DN.JITTER) * UNIT_M;
      it.x = pos.x + rnd(-j, j); it.y = pos.y; it.z = pos.z + rnd(-j, j);
      const r = cameraRight(pos.x, pos.y, pos.z, _r);
      it.rx = r[0]; it.rz = r[1];
      const fx = -r[1], fz = r[0];
      it.timer = 0; it.slam = false; it.wx = 0; it.wz = 0; it.wStr = 0; it.wPh = 0; it.wSp = 0;
      if (K.column) {                                                 // M3 SÜTUN (_configure_motion_resource)
        it.vx = 0; it.vz = 0; it.vy = DN.RES_RISE * UNIT_M; it.riseDrag = DN.RES_DRAG; it.hDrag = DN.H_DRAG;
        it.dur = DN.RES_DURATION; it.fadeStart = DN.RES_FADE_START;
      } else {                                                        // M2 YAY (_configure_motion_arc)
        sideFlip = !sideFlip;
        const ss = sideFlip ? -1 : 1, ds = Math.random() < 0.5 ? -1 : 1;
        let side = rnd(DN.SIDE_MIN, DN.SIDE_MAX) * ss * (1 + boost * 0.35), depth = rnd(0, DN.DEPTH_MAX) * ds, lift = rnd(DN.RISE_MIN, DN.RISE_MAX) * (1 + boost * 0.08);
        if (crit) { side *= 1.30; depth *= 1.20; lift *= 1.10; }
        it.vx = (it.rx * side + fx * depth) * UNIT_M; it.vz = (it.rz * side + fz * depth) * UNIT_M; it.vy = lift * UNIT_M;
        const wd = rnd(-0.5, 0.5); let wx = it.rx * -ss + fx * wd, wz = it.rz * -ss + fz * wd; const wl = Math.hypot(wx, wz) || 1;
        it.wx = wx / wl; it.wz = wz / wl; it.wPh = rnd(0, TAU); it.wSp = rnd(DN.WOB_F_MIN, DN.WOB_F_MAX); it.wStr = rnd(0, DN.WOB_S_MAX) * (1 + boost * 0.5) * UNIT_M;
        it.riseDrag = DN.RISE_DRAG; it.hDrag = DN.H_DRAG;
        it.dur = DN.DURATION * (crit ? DN.CRIT_DUR : 1); it.fadeStart = DN.FADE_START;
        it.slam = crit;
      }
    }
    function scaleCurve(it, t) {
      if (it.slam) {
        if (t < DN.SLAM) { const k = t / DN.SLAM; return DN.SLAM_SCALE + (1 - DN.SLAM_SCALE) * (1 - Math.pow(1 - k, 3)); }
        if (t < DN.SHAKE) { const s = (t - DN.SLAM) / (DN.SHAKE - DN.SLAM); return 1 + Math.sin(s * TAU * 2) * DN.REBOUND * (1 - s); }
        return 1;
      }
      if (t < DN.POP_IN) return 1 + (t / DN.POP_IN) * DN.POP_OVER;
      if (t < DN.POP_SETTLE) return 1 + DN.POP_OVER - ((t - DN.POP_IN) / (DN.POP_SETTLE - DN.POP_IN)) * DN.POP_OVER;
      return 1;
    }
    function stepNumbers(dt) {
      live.length = 0;
      const pr = hud.opts.project;
      for (const it of pool) {
        if (!it.on) continue;
        it.timer += dt;
        const t = it.timer / it.dur;
        if (it.timer >= it.dur) { it.on = false; continue; }
        const moving = !(it.slam && t < DN.SLAM);
        if (moving) {
          it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
          it.vy *= Math.max(1 - it.riseDrag * dt, 0);
          const d = Math.max(1 - it.hDrag * dt, 0); it.vx *= d; it.vz *= d;
        }
        const wob = Math.sin(it.timer * it.wSp + it.wPh) * it.wStr * (1 - Math.min(t, 1));
        let sh = 0;
        if (it.slam && t < DN.SHAKE) { const k = t / DN.SHAKE; sh = Math.sin(k * TAU * DN.SHAKE_FREQ) * DN.SHAKE_AMP * UNIT_M * (1 - k); }
        const qx = it.x + it.wx * wob + it.rx * sh, qy = it.y, qz = it.z + it.wz * wob + it.rz * sh;
        // alpha: fade in .18 s (ease-out), fade out 1 − u² from fadeStart
        let alpha = 1;
        if (it.timer < DN.FADE_IN) { const v = 1 - it.timer / DN.FADE_IN; alpha = 1 - v * v; }
        if (t > it.fadeStart) { const u = clamp01((t - it.fadeStart) / (1 - it.fadeStart)); alpha = Math.min(alpha, 1 - u * u); }
        if (!pr || alpha <= 0.002) continue;
        const v = pr(qx, qy, qz);
        if (!v || v.z > 1) continue;
        const nx = v.x, ny = v.y, sx = (nx * 0.5 + 0.5) * vw, sy = (-ny * 0.5 + 0.5) * vh, sz = v.z;   // copy: project() may reuse one vector
        const v2 = pr(qx + it.rx, qy, qz + it.rz);                     // 1 m along camera right = billboard px per metre at this depth
        if (!v2) continue;
        const pxm = Math.hypot((v2.x - nx) * 0.5 * vw, (v2.y - ny) * 0.5 * vh);
        const sc = scaleCurve(it, t), k = DN.PIXEL * UNIT_M * pxm * (global.__dmgNumScale || 1);     // CSS px per font px before the scale curve ([mobile HUD] __dmgNumScale: the far phone camera)
        if (sx < -400 || sx > vw + 400 || sy < -400 || sy > vh + 400) continue;
        let col = it.K.c255;
        if (it.flash) {
          const fk = t / DN.FLASH;
          if (fk >= 1) it.flash = false;
          else { const e = fk * fk, c = it.K.col; col = [Math.round((COL_FLASH[0] + (c[0] - COL_FLASH[0]) * e) * 255), Math.round((COL_FLASH[1] + (c[1] - COL_FLASH[1]) * e) * 255), Math.round((COL_FLASH[2] + (c[2] - COL_FLASH[2]) * e) * 255)]; }
        }
        it.dx = sx; it.dy = sy; it.dz = sz; it.k = k; it.sc = sc; it.alpha = alpha; it.col = col; it.t = t;
        live.push(it);
      }
      live.sort((a, b) => b.dz - a.dz);                               // far first
    }
    function drawNumbers() {
      const d = dpr();
      if (nDrawn) { ng.setTransform(1, 0, 0, 1, 0, 0); ng.clearRect(0, 0, ncv.width, ncv.height); nDrawn = false; }
      if (!live.length) return;
      nDrawn = true;
      // render priority 5 / 6 / 7 (damage_number.gd): every crit halo, then every outline, then every glyph
      ng.globalCompositeOperation = 'source-over';
      for (const it of live) {
        if (!it.halo) continue;
        const follow = 1 + (it.sc - 1) * DN.HALO_FOLLOW, kk = it.k * follow * d;
        const hk = clamp01(it.t / DN.HALO_DECAY), ha = (DN.HALO_PEAK + (DN.HALO_BASE - DN.HALO_PEAK) * hk * hk) * it.alpha;
        ng.setTransform(it.hw * 0.5 * kk, 0, 0, it.hh * 0.5 * kk, it.dx * d, it.dy * d);
        const gr = ng.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, css(COL_HALO, ha)); gr.addColorStop(0.28, css(COL_HALO, ha * 0.55)); gr.addColorStop(0.62, css(COL_HALO, ha * 0.14)); gr.addColorStop(1, css(COL_HALO, 0));
        ng.fillStyle = gr; ng.beginPath(); ng.arc(0, 0, 1, 0, TAU); ng.fill();
      }
      ng.lineJoin = 'round'; ng.textBaseline = 'alphabetic'; ng.textAlign = 'left'; ng.letterSpacing = '0px';
      for (let pass = 0; pass < 2; pass++) {
        for (const it of live) {
          const kk = it.k * it.sc * d;
          // glyph space: origin on the baseline (the slant shears about it, FontVariation.variation_transform), centred like Label3D
          ng.setTransform(kk, 0, -DN.SLANT * kk, kk, it.dx * d, (it.dy + it.baseOff * it.k * it.sc) * d);
          ng.font = it.font;
          if (pass === 0) { ng.strokeStyle = css(it.K.o255, it.alpha); ng.lineWidth = it.ow; ng.strokeText(it.text, -it.w * 0.5, 0); }
          else { ng.fillStyle = css(it.col, it.alpha); ng.fillText(it.text, -it.w * 0.5, 0); }
        }
      }
    }
    function sizeNumbers() {
      vw = global.innerWidth; vh = global.innerHeight;
      const d = dpr(), bw = Math.max(1, Math.round(vw * d)), bh = Math.max(1, Math.round(vh * d));
      if (ncv.width !== bw) ncv.width = bw;
      if (ncv.height !== bh) ncv.height = bh;
      ncv.style.width = vw + 'px'; ncv.style.height = vh + 'px';
      nDrawn = true;
    }

    /* ---------- status banner (general lane) ---------- */
    const bsurf = P.surface(null, 'fbk-banner', 10, 10, 0, 0), bg = bsurf.g;
    bsurf.el.style.cssText += ';position:absolute;pointer-events:none;display:none';
    root.appendChild(bsurf.el);
    const lane = { queue: [], current: null, showing: false };
    const B = { on: false, out: false, bt: 0, ot: 0, lay: null, acc: null, tone: 0, flash: false, shake: false, hold: BN.HOLD, veilFrom: 1, dirty: false };
    const sameEntry = (a, b) => a && b && a.kind === b.kind && a.msg === b.msg && (a.detail || '') === (b.detail || '');
    function notify(entry) {
      if ((lane.showing && sameEntry(lane.current, entry)) || lane.queue.some((q) => sameEntry(q, entry))) return;   // same content: ignored
      if (entry.tone === TONE_FAIL) {                                 // an error interrupts; a positive banner it cuts goes back to the front
        if (lane.showing && lane.current && lane.current.tone !== TONE_FAIL) { lane.queue.unshift(lane.current); while (lane.queue.length > BN.QUEUE_MAX) lane.queue.pop(); }
        present(entry); return;
      }
      lane.queue.push(entry);
      while (lane.queue.length > BN.QUEUE_MAX) lane.queue.shift();
      pump();
    }
    function pump() { if (!lane.showing && lane.queue.length) present(lane.queue.shift()); }
    function present(entry) {
      lane.current = entry; lane.showing = true;
      B.acc = ACC[entry.tone] || ACC[TONE_FAIL]; B.tone = entry.tone;
      B.flash = entry.tone !== TONE_SUCCESS; B.shake = entry.tone === TONE_FAIL;
      B.hold = entry.detail ? BN.HOLD_DETAIL : BN.HOLD;
      B.on = true; B.out = false; B.bt = 0; B.ot = 0; B.entry = entry;
      layoutBanner();
      bsurf.el.style.display = '';
      B.dirty = true;
    }
    function bannerDone() {
      B.on = false; bsurf.el.style.display = 'none';
      lane.current = null; lane.showing = false;
      pump();
    }
    // highlights: each one boxed on its first non-overlapping match (compose_bbcode)
    function spans(msg, hl) {
      const out = [];
      for (const raw of hl || []) {
        const needle = String(raw).trim(); if (!needle) continue;
        let at = msg.indexOf(needle);
        while (at >= 0) {
          if (!out.some((s) => at < s[0] + s[1] && s[0] < at + needle.length)) { out.push([at, needle.length]); break; }
          at = msg.indexOf(needle, at + 1);
        }
      }
      return out.sort((a, b) => a[0] - b[0]);
    }
    // greedy word wrap that keeps character offsets (for the gold runs); at most `rows` lines, the last one ellipsised
    function wrap(text, font, maxW, rows) {
      const words = []; const re = /\S+/g; let m;
      while ((m = re.exec(text))) words.push([m.index, m.index + m[0].length]);
      const lines = []; let start = -1, end = -1;
      for (const [a, b] of words) {
        if (start < 0) { start = a; end = b; continue; }
        if (P.width(bg, text.slice(start, b), font) <= maxW) end = b;
        else { lines.push([start, end]); start = a; end = b; }
      }
      if (start >= 0) lines.push([start, end]);
      if (lines.length > rows) { lines.length = rows; lines[rows - 1].ell = true; lines[rows - 1][1] = text.length; }
      return lines;
    }
    function layoutBanner() {
      const e = B.entry, s = hud.s || 1;
      const screenW = (global.innerWidth || 1920) / s;
      const maxW = Math.max(BN.MIN_W, screenW * BN.MAX_RATIO);
      const fMsg = F_MSG(BN.MSG_FS), fDet = F_MSG(BN.DETAIL_FS);
      const msgW = P.width(bg, e.msg, fMsg), detW = e.detail ? P.width(bg, e.detail, fDet) : 0, kindW = P.width(bg, e.kind, F_KIND, BN.KIND_SP);
      const msgRows = msgW <= maxW ? 1 : Math.min(BN.MAX_ROWS, Math.ceil(msgW / maxW)), detRows = !e.detail ? 0 : detW <= maxW ? 1 : Math.min(BN.MAX_ROWS, Math.ceil(detW / maxW));
      const cw = Math.ceil(Math.max(Math.min(msgW, maxW), Math.min(detW, maxW), kindW + BN.KIND_PAD_X, BN.MIN_W));
      const mk = P.metrics(bg, F_KIND), mm = P.metrics(bg, fMsg), md = P.metrics(bg, fDet);
      const kindH = Math.ceil(mk.a + mk.d), msgLH = Math.ceil(mm.a + mm.d), detLH = Math.ceil(md.a + md.d);
      let y = BN.RULE_H + BN.KIND_GAP; const kindY = y;
      y += kindH + BN.MSG_GAP; const msgY = y;
      y += msgLH * msgRows;
      let detY = y;
      if (detRows) { y += BN.DETAIL_GAP; detY = y; y += detLH * detRows; }
      y += BN.RULE_BOT_GAP; const ruleBotY = y, th = y + BN.RULE_H;
      const L = {
        cw, th, kindY, kindH, msgY, msgLH, detY, detLH, ruleBotY, fMsg, fDet, mk, mm, md,
        msgLines: msgRows > 1 ? wrap(e.msg, fMsg, cw, BN.MAX_ROWS) : [[0, e.msg.length]],
        detLines: !detRows ? [] : detRows > 1 ? wrap(e.detail, fDet, cw, BN.MAX_ROWS) : [[0, e.detail.length]],
        msgSpans: spans(e.msg, e.hl), detSpans: e.detail ? spans(e.detail, e.hl) : [],
      };
      B.lay = L;
      // canvas = content box + the spot's spill + a margin for the shake and the TRANS_BACK overshoot; content box top-left = (0, 0)
      const padX = BN.SPOT_X + BN.MARGIN, padY = BN.SPOT_Y + BN.MARGIN;
      bsurf.ox = padX; bsurf.oy = padY;
      bsurf.resize(s, cw + padX * 2, th + padY * 2);
      // bottom edge of the content box fixed 246 px above the screen bottom, centred
      bsurf.el.style.left = 'calc(50% - ' + ((cw * 0.5 + padX) * s).toFixed(1) + 'px)';
      bsurf.el.style.bottom = ((BN.BOTTOM - padY) * s).toFixed(1) + 'px';
    }
    function ellipseGrad(cx, cy, rw, rh, stops) {
      bg.save(); bg.translate(cx, cy); bg.scale(rw * 0.5, rh * 0.5);
      const gr = bg.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      bg.fillStyle = gr; bg.fillRect(-1, -1, 2, 2); bg.restore();
    }
    function rule(x, y, w, a, m) {
      const c = B.acc.map((v) => Math.min(255, Math.round(v * m)));
      const gr = bg.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, css(c, 0)); gr.addColorStop(0.28, css(c, a)); gr.addColorStop(0.72, css(c, a)); gr.addColorStop(1, css(c, 0));
      bg.fillStyle = gr; bg.fillRect(x, y, w, BN.RULE_H);
    }
    // one RichTextLabel line: [center], soft shadow (outline 6 / 5 + glyph, offset 2 / 1, α .95), gold runs
    function richLine(text, a, b, sp, font, base, cw, alpha, so, sy, ell) {
      let str = text.slice(a, b), cut = b;
      if (ell) { while (str.length > 1 && P.width(bg, str + '…', font) > cw) { str = str.slice(0, -1); } cut = a + str.length; str = str.trimEnd() + '…'; }
      P.setFont(bg, font);
      const total = bg.measureText(str).width, x0 = (cw - total) * 0.5;
      bg.lineJoin = 'round';
      bg.strokeStyle = 'rgba(0,0,0,' + (0.95 * alpha).toFixed(3) + ')'; bg.fillStyle = bg.strokeStyle; bg.lineWidth = so;
      bg.strokeText(str, x0, base + sy); bg.fillText(str, x0, base + sy);
      // runs
      const cuts = [a];
      for (const [s, l] of sp) { if (s > a && s < cut) cuts.push(s); if (s + l > a && s + l < cut) cuts.push(s + l); }
      cuts.push(cut);
      cuts.sort((p, q) => p - q);
      let x = x0;
      for (let i = 0; i < cuts.length - 1; i++) {
        const s0 = cuts[i], s1 = cuts[i + 1]; if (s1 <= s0) continue;
        const seg = text.slice(s0, s1), gold = sp.some(([s, l]) => s0 >= s && s1 <= s + l);
        bg.fillStyle = gold ? css(COL_GOLD, alpha) : css(COL_MSG, alpha);
        bg.fillText(seg, x, base); x += bg.measureText(seg).width;
      }
      if (ell) { bg.fillStyle = css(COL_MSG, alpha); bg.fillText('…', x, base); }
    }
    function drawBanner() {
      const L = B.lay, e = B.entry;
      bsurf.begin();
      if (!B.on || !L) return;
      // tween state (status_banner.show_entry / _start_fade_out)
      let shellA, veilX, textA, textY, flashM = 1, shakeX = 0;
      if (!B.out) {
        const u = clamp01(B.bt / BN.FADE_IN);
        shellA = quadOut(u); veilX = BN.SCALE_IN + (1 - BN.SCALE_IN) * backOut(u);
        const ut = clamp01((B.bt - BN.TEXT_DELAY) / BN.FADE_IN);
        textA = quadOut(ut); textY = BN.TEXT_RISE * (1 - quadOut(ut));
        if (B.flash) flashM = BN.FLASH + (1 - BN.FLASH) * quadOut(clamp01(B.bt / BN.FLASH_T));
        if (B.shake) {
          const t = B.bt, t1 = BN.SHAKE_T1, t2 = t1 + BN.SHAKE_T2, t3 = t2 + BN.SHAKE_T3;
          if (t < t1) shakeX = -BN.SHAKE * quadOut(t / t1);
          else if (t < t2) shakeX = -BN.SHAKE + 2 * BN.SHAKE * quadInOut((t - t1) / BN.SHAKE_T2);
          else if (t < t3) shakeX = BN.SHAKE * (1 - quadIn((t - t2) / BN.SHAKE_T3));
        }
      } else {
        const u = clamp01(B.ot / BN.FADE_OUT), e2 = quadIn(u);
        shellA = B.outFrom.a * (1 - e2); veilX = B.outFrom.vx + (BN.SCALE_OUT - B.outFrom.vx) * e2;
        textA = B.outFrom.ta; textY = B.outFrom.ty + (-BN.TEXT_RISE - B.outFrom.ty) * e2;
      }
      B.cur = { a: shellA, vx: veilX, ta: textA, ty: textY };
      const cw = L.cw, th = L.th;
      bg.save();
      bg.globalAlpha = shellA;
      bg.translate(shakeX, 0);
      // veil group, scaled horizontally about the content centre
      bg.save(); bg.translate(cw * 0.5, 0); bg.scale(veilX, 1); bg.translate(-cw * 0.5, 0);
      ellipseGrad(cw * 0.5, th * 0.5, cw + BN.SPOT_X * 2, th + BN.SPOT_Y * 2, [[0, 'rgba(0,0,0,.88)'], [0.44, 'rgba(0,0,0,.68)'], [0.76, 'rgba(0,0,0,.26)'], [1, 'rgba(0,0,0,0)']]);
      const wa = B.tone === TONE_LEVEL ? BN.WASH_A_LEVEL : BN.WASH_A;
      bg.globalCompositeOperation = 'lighter';
      ellipseGrad(cw * 0.5, th * 0.5, cw + BN.SPOT_X * BN.WASH_IX * 2, th + BN.SPOT_Y * BN.WASH_IY * 2, [[0, css(B.acc, wa)], [0.58, css(B.acc, wa * 0.34)], [1, css(B.acc, 0)]]);
      bg.globalCompositeOperation = 'source-over';
      const topW = Math.ceil(cw * BN.RULE_TOP_RATIO);
      rule(Math.floor((cw - topW) * 0.5), 0, topW, BN.RULE_TOP_A, flashM);
      rule(0, L.ruleBotY, cw, BN.RULE_BOT_A, flashM);
      bg.restore();
      // text group
      if (textA > 0.001) {
        bg.translate(0, textY);
        // stamp: Alegreya 700 12 px, tracking 3, accent, soft shadow (outline 4, offset 1), centred in its line box
        const kb = L.kindY + (L.kindH - (L.mk.a + L.mk.d)) * 0.5 + L.mk.a;
        P.setFont(bg, F_KIND, BN.KIND_SP);
        const kw = bg.measureText(e.kind).width, kx = (cw - kw) * 0.5;
        bg.lineJoin = 'round'; bg.lineWidth = 4;
        bg.strokeStyle = bg.fillStyle = 'rgba(0,0,0,' + (0.95 * textA).toFixed(3) + ')';
        bg.strokeText(e.kind, kx, kb + 1); bg.fillText(e.kind, kx, kb + 1);
        bg.fillStyle = css(B.acc, textA); bg.fillText(e.kind, kx, kb);
        L.msgLines.forEach((ln, i) => richLine(e.msg, ln[0], ln[1], L.msgSpans, L.fMsg, L.msgY + L.mm.a + i * L.msgLH, cw, textA, 6, 2, ln.ell));
        L.detLines.forEach((ln, i) => richLine(e.detail, ln[0], ln[1], L.detSpans, L.fDet, L.detY + L.md.a + i * L.detLH, cw, textA * BN.DETAIL_A, 5, 1, ln.ell));
      }
      bg.restore();
    }
    function stepBanner(dt) {
      if (!B.on) return;
      if (!B.out) {
        B.bt += dt;
        const animating = B.bt < Math.max(BN.FADE_IN + BN.TEXT_DELAY, B.shake ? BN.SHAKE_T1 + BN.SHAKE_T2 + BN.SHAKE_T3 : 0) + 0.05;
        if (animating) B.dirty = true;
        if (B.bt >= B.hold) { B.out = true; B.ot = 0; B.outFrom = B.cur || { a: 1, vx: 1, ta: 1, ty: 0 }; B.dirty = true; }
      } else {
        B.ot += dt; B.dirty = true;
        if (B.ot >= BN.FADE_OUT) { bannerDone(); return; }
      }
      if (B.dirty) { B.dirty = false; drawBanner(); }
    }
    P.onFonts(() => { if (B.on) { layoutBanner(); drawBanner(); } });

    /* ---------- damage veil ---------- */
    const vcv = document.createElement('canvas');
    vcv.className = 'fbk-veil';
    vcv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none';
    root.appendChild(vcv);
    const vg = vcv.getContext('2d');
    const V = { hitA: 0, target: 0, phase: 0, t: 0, rise: 0.05, fall: 0.4, hp: 1, env: 0, pt: 0, on: false, cols: 0, rows: 0, img: null, rim: null, rimP: null, base: null, band: null };
    const lastHurt = { amount: 0, t: -1 };
    function veilGrid() {
      const aspect = Math.max(0.5, (global.innerWidth || 1920) / Math.max(1, global.innerHeight || 1080));
      const rows = VEIL.ROWS, cols = Math.max(8, Math.round(rows * aspect));
      if (cols === V.cols && rows === V.rows) return;
      V.cols = cols; V.rows = rows; vcv.width = cols; vcv.height = rows;
      V.img = vg.createImageData(cols, rows);
      const n = cols * rows;
      V.rim = new Float32Array(n); V.rimP = new Float32Array(n); V.band = new Float32Array(n); V.base = new Float32Array(n * 3);
      const half = 0.5 * Math.hypot(aspect, 1), c0 = VEIL.CLEAR_R;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = j * cols + i, px = ((i + 0.5) / cols - 0.5) * aspect, py = (j + 0.5) / rows - 0.5;
        let d = Math.hypot(px, py) / half;
        const ang = Math.atan2(py, px);
        d *= 0.955 + 0.045 * Math.sin(ang * 3 + 1.3) + 0.028 * Math.sin(ang * 7 - 0.7);
        const r = smooth(c0, 1, d), rp = smooth(c0 + VEIL.PULSE_CLEAR_EXTRA, 1, d);
        V.rim[k] = r * r; V.rimP[k] = rp * rp;
        const m = smooth(0.52, 0.98, d);
        for (let c = 0; c < 3; c++) V.base[k * 3 + c] = VEIL.HOT[c] + (VEIL.DEEP[c] - VEIL.HOT[c]) * m;
        V.band[k] = smooth(c0, c0 + 0.16, d) * (1 - smooth(c0 + 0.16, c0 + 0.38, d));
      }
    }
    const tierOf = (r) => VEIL.TIERS.find((t) => r < t.max) || VEIL.TIERS[VEIL.TIERS.length - 1];
    function veilHit(ratio) {
      if (VEIL.SCALE <= 0 || !(ratio > 0)) return;
      const T = tierOf(ratio);
      V.target = Math.min(VEIL.CAP, Math.max(V.target, T.a * VEIL.SCALE));   // max, not sum: no blindness before death
      V.rise = T.rise; V.fall = T.fall; V.phase = 1; V.t = 0;
    }
    function pulseTarget() {
      if (!VEIL.PULSE_ON || VEIL.SCALE <= 0 || V.hp <= 0) return 0;
      if (V.hp < VEIL.T2) return (VEIL.T2_BASE + VEIL.T2_AMP) * VEIL.SCALE;
      if (V.hp < VEIL.T1) return (VEIL.T1_BASE + VEIL.T1_AMP) * VEIL.SCALE;
      return 0;
    }
    function stepVeil(dt) {
      const pl = hud.state && hud.state.player;
      V.hp = pl && pl.maxHp > 0 ? clamp01(pl.hp / pl.maxHp) : 1;
      if (pl && pl.dead) V.hp = 0;
      if (V.phase === 1) { V.t += dt; const k = V.rise <= 0 ? 1 : Math.min(1, V.t / V.rise); V.hitA = V.target * k; if (k >= 1) { V.phase = 2; V.t = 0; } }
      else if (V.phase === 2) { V.t += dt; const k = V.fall <= 0 ? 1 : Math.min(1, V.t / V.fall), inv = 1 - k; V.hitA = V.target * inv * inv; if (k >= 1) { V.phase = 0; V.hitA = 0; V.target = 0; } }
      const want = pulseTarget();
      V.env = want > 0 ? Math.min(1, V.env + dt / VEIL.PULSE_FADE) : Math.max(0, V.env - dt / VEIL.PULSE_FADE);
      let pulseA = 0;
      if (V.env > 0) {
        const fast = V.hp < VEIL.T2, period = fast ? VEIL.T2_PERIOD : VEIL.T1_PERIOD, base = fast ? VEIL.T2_BASE : VEIL.T1_BASE, amp = fast ? VEIL.T2_AMP : VEIL.T1_AMP;
        V.pt += dt;
        pulseA = (base + (Math.sin(V.pt * TAU / period) + 1) * 0.5 * amp) * VEIL.SCALE * V.env;
      }
      const active = V.hitA > 0 || pulseA > 0;
      if (!active) { if (V.on) { V.on = false; vcv.style.display = 'none'; } return; }
      if (!V.on) { V.on = true; vcv.style.display = ''; }
      veilGrid();
      const D = V.img.data, n = V.cols * V.rows, hitA = V.hitA, hot = Math.min(hitA * 1.6, 1);
      const MH = [VEIL.MID[0] + VEIL.HOT[0] * 0.45, VEIL.MID[1] + VEIL.HOT[1] * 0.45, VEIL.MID[2] + VEIL.HOT[2] * 0.45];
      for (let k = 0; k < n; k++) {
        const ah = hitA * V.rim[k], ap = pulseA * V.rimP[k], a = Math.min(1, Math.max(ah, ap)), o = k * 4;
        if (a < 0.002) { D[o + 3] = 0; continue; }
        const hb = V.band[k] * hot, pw = ap / Math.max(ah + ap, 1e-4) * 0.55;
        for (let c = 0; c < 3; c++) {
          let v = V.base[k * 3 + c];
          v += (MH[c] - v) * hb;
          v += (VEIL.DEEP[c] - v) * pw;
          D[o + c] = v * 255;
        }
        D[o + 3] = a * 255;
      }
      vg.putImageData(V.img, 0, 0);
    }

    /* ---------- death: ui/death.js (another part) or a minimal fallback line ---------- */
    let death = null, deathFallback = null, isDead = false;
    function deathPart() {
      if (!death && typeof global.HUDDeath === 'function') {
        try { death = global.HUDDeath(hud); if (death && death.resize) death.resize(hud.s || 1); if (death && isDead) death.set(true); } catch (err) { console.error(err); death = null; }
        if (deathFallback && death) { deathFallback.remove(); deathFallback = null; }
      }
      return death;
    }
    function fallbackDead(on) {
      if (on && !deathFallback) {
        deathFallback = document.createElement('div');
        deathFallback.className = 'fbk-dead';
        deathFallback.style.cssText = 'position:absolute;left:0;right:0;top:36%;text-align:center;pointer-events:none;font:700 calc(18px * var(--s,1)) "Alegreya Sans","Segoe UI",sans-serif;' +
          'color:#ECE3D0;letter-spacing:.04em;text-shadow:0 1px 0 rgba(0,0,0,.55),0 0 3px rgba(0,0,0,.6),0 0 6px rgba(0,0,0,.35)';
        deathFallback.textContent = 'Öldün · Diriltmek için R';
        root.appendChild(deathFallback);
      }
      if (deathFallback) deathFallback.hidden = !on;
    }
    deathPart();

    sizeNumbers(); veilGrid();
    return {
      number,
      frame(dt) {
        dt = Math.min(Math.max(dt || 0, 0), 0.1);
        clock += dt;
        if (sizeDirty) { sizeDirty = false; sizeNumbers(); veilGrid(); }
        stepNumbers(dt); drawNumbers();
        stepBanner(dt);
        stepVeil(dt);
        const d = deathPart(); if (d && d.frame) d.frame(dt);
      },
      error(text) { if (text) notify({ msg: String(text).trim(), tone: TONE_FAIL, kind: KIND_BLOCKED, hl: [] }); },
      levelUp(level) { notify({ msg: LEVEL_UP_MSG(level), tone: TONE_LEVEL, kind: KIND_LEVEL_UP, hl: [String(level)] }); },
      dead(on) {
        on = !!on;
        const changed = on !== isDead; isDead = on;
        const d = deathPart();
        if (d) { if (changed) d.set(on); } else if (changed || on) fallbackDead(on);
      },
      // hit ratio = damage / max HP: the amount of the 'hurt' number the game spawned for this hit (same tick); a fully absorbed hit
      // (no number) shows nothing, like DamageVeil.hit(ratio <= 0).
      hurt() {
        const pl = hud.state && hud.state.player;
        if (lastHurt.t >= 0 && clock - lastHurt.t < 0.25 && pl && pl.maxHp > 0) veilHit(lastHurt.amount / pl.maxHp);
        lastHurt.t = -1;
      },
      resize(s) {
        sizeDirty = true;
        if (B.on) { layoutBanner(); drawBanner(); } else bsurf.resize(s);
        const d = deathPart(); if (d && d.resize) d.resize(s);
      },
    };
  };
})(window);
