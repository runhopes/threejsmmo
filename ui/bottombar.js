/* TDS HUD part — bottom-centre bar, ported 1:1 from Atherion:
 *   vitals_strip.gd + glass_bar.gd  ("Cam Çizgi": HP 22 px skewed glass bar, number inside; mana (+ energy) 7 px below, numbers at the outer ends)
 *   action_bar_plate.gd             ("Mühürlü Kemer", frameless: 9 skill slots 52 px [1-9], F1-F9 row 36 px, two auto knobs, EXP rail + level seal)
 * Coordinates are the Atherion action-bar canvas (W 560 × H 152, anchored bottom-centre, 6 px above the screen edge); the vitals block sits
 * above it (negative y). Slots: 1-8 = the class skills, 9 empty, F1-F9 empty (the game has no consumables yet).
 * Left knob = basic attack (RIGHT click, Metin2-style; lit + inlay ticks while the combo runs), right knob = walk / run toggle (C; lit while walking).
 * Registers HUDParts.player (vitals), HUDParts.actions (slots / knobs), HUDParts.xp (EXP rail) — one shared canvas.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, C = P.C;

  // ── L · sizes (action_bar_plate.gd) ──
  const W = 560, H = 152, S = 52, S_GAP = 6, S_Y = 18, S_CUT = 5, S_INSET = 3, F = 36, F_GAP = 6, F_Y = 82, F_CUT = 4, F_INSET = 3;
  const AUTO = 36, AUTO_GAP = 12, AUTO_CUT = 6, AUTO_INLAY_W = 16, AUTO_INLAY_H = 2, AUTO_INLAY_DY = 6, AUTO_GLYPH = 18;
  const RAIL_CY = 134, STRAP_H = 16, STRAP_CUT = 4, G_H = 10, G_CUT = 2, G_PAD = 4, CAP_X = 490, CAP_W = 12, CAP_H = 24, CAP_CUT = 3, CAP_NAIL_R = 2.6;
  const G_READ_GAP = 8, G_READ_W = 44, G_READ_FS = 12, SEAL_CX = 28, SEAL_R = 17, SEAL_FACE_IN = 1.5, SEAL_RING_R = 12.5, SEAL_FS = 15, SEAL_FS_LONG = 12;
  const KEY_H = 12, KEY_FS = 10, KEY_PAD = 3, KEY_IN = 3, KEY_CUT = 2, CD_FS = 15, BOTTOM = 6;
  const SKILL_COUNT = 9;
  const MOBILE_HIDDEN = document.documentElement.classList.contains('is-mobile') || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  // ── RC · recipe alphas ──
  const WELL_FILL = 0.50, WELL_LIP_TOP = 0.72, WELL_LIP_BOT = 0.30, ICON_RECESS = 0.34, ICON_EDGE = 0.55, EMPTY_KEY_A = 0.50, KEY_FACE = 0.90, KEY_RIM = 0.22, KEY_SHADE = 0.50;
  const CD_VEIL = 0.66, CD_EDGE = 0.30, HOVER_LIP = 0.45, DROP_OK_A = 0.85, DROP_OK_WASH = 0.07, DROP_NO_A = 0.85, DROP_NO_WASH = 0.06, PRESS_DARK = 0.18, READY_A = 0.90, READY_WASH = 0.12;
  const AUTO_FACE = 0.97, AUTO_RIM_IDLE = 0.80, AUTO_INLAY_ON = 0.95, AUTO_INLAY_OFF = 0.14, AUTO_GLYPH_OFF = 0.85, SEAL_OUTLINE = 0.60;
  const G_FILL = 0.50, G_LIP_TOP = 0.72, G_LIP_BOT = 0.30, G_AMBER = 0.94, G_DEEP = 0.34, G_EDGE = 0.95, G_TICK = 0.42, G_GLINT_W = 14, G_GLINT_A = 0.55, SEAL_RING_DARK = 0.55, SEAL_RING_LIT = 0.14, LEVEL_FLASH = 0.90;
  // ── TM · motion (s) ──
  const PRESS_TIME = 0.09, PRESS_RELEASE = 0.12, READY_TIME = 0.45, GLINT_TIME = 0.60, LEVEL_TIME = 1.20, DENY_TIME = 0.34;
  const VEIL = 'rgba(6,4,2,', AMBER_LIT = C.AMBER_LIT, DANGER = C.DANGER;

  // ── vitals_strip.gd ("Cam Çizgi") ──
  const VW = SKILL_COUNT * S + (SKILL_COUNT - 1) * S_GAP;      // 516
  const HP_H = 22, HP_SKEW = 11, SUB_H = 7, SUB_SKEW = 4, ROW_GAP = 6, SPLIT = 12, SLOT_GAP = 6, VH = HP_H + ROW_GAP + SUB_H;
  const VX = (W - VW) * 0.5, VY = S_Y - SLOT_GAP - VH;          // block origin (22, -23)
  const HP_NUM_BASE = 16, SUB_NUM_BASE = HP_H + ROW_GAP + SUB_H + 1, SUB_NUM_GAP = 12, FS_BIG = 16, FS_BIG_MAX = 12, FS_SMALL = 14, FS_SMALL_MAX = 11;
  const DIM = '#A89C86';
  const CHIP_HOLD = 0.35, CHIP_SPEED = 0.9, LOW_ENTER = 0.30, LOW_EXIT = 0.33, LOW_PERIOD = 1.10, LOW_FADE = 0.25, LOW_A_MIN = 0.25;
  // glass_bar.gd
  const GB = {
    HP: ['#A8402F', '#7A2419', '#3E0E09'], MP: ['#3F6690', '#29486E', '#122338'], SP: ['#6E8A45', '#4B6332', '#24331A'],
    BACK: 'rgba(11,8,6,.82)', EDGE: 'rgba(236,227,208,.13)', CHIP: 'rgba(226,200,176,.34)', GHOST_A: 0.38, TOP_LIGHT: 'rgba(255,232,206,.20)',
    GLOSS_A: 0.07, SEG: 'rgba(0,0,0,.42)', TIP: 'rgba(240,214,186,.55)', LOW: '#C83426', MID_STOP: 0.42, SHADOW_R: 6, SHADOW_A: 0.65,
  };

  // canvas extent around the action-bar canvas: numbers left / right of the vitals, the vitals' shadow above
  const PADX = 128, PADT = 36, CW = W + PADX * 2, CH = H + PADT;

  /* ---------- geometry (shared by drawing and hit rects) ---------- */
  const skillX0 = (W - (SKILL_COUNT * S + (SKILL_COUNT - 1) * S_GAP)) * 0.5;
  const fTotal = SKILL_COUNT * F + (SKILL_COUNT - 1) * F_GAP + 2 * (AUTO + AUTO_GAP);
  const fX0 = (W - fTotal) * 0.5;
  function slotRect(i) {
    if (i < SKILL_COUNT) return { x: skillX0 + i * (S + S_GAP), y: S_Y, w: S, h: S };
    return { x: fX0 + AUTO + AUTO_GAP + (i - SKILL_COUNT) * (F + F_GAP), y: F_Y, w: F, h: F };
  }
  const autoRect = (kind) => ({ x: kind === 0 ? fX0 : fX0 + fTotal - AUTO, y: F_Y, w: AUTO, h: AUTO });   // 0 = combat (basic), 1 = walk
  const strapRect = { x: SEAL_CX, y: RAIL_CY - STRAP_H * 0.5, w: CAP_X - SEAL_CX, h: STRAP_H };
  const grooveRect = (() => { const x0 = SEAL_CX + SEAL_R + G_PAD, x1 = CAP_X - CAP_W * 0.5 - G_PAD; return { x: x0, y: RAIL_CY - G_H * 0.5, w: x1 - x0, h: G_H }; })();
  const capRect = { x: CAP_X - CAP_W * 0.5, y: RAIL_CY - CAP_H * 0.5, w: CAP_W, h: CAP_H };
  const READ_X = CAP_X + CAP_W * 0.5 + G_READ_GAP;
  const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

  /* ---------- glass bar (glass_bar.gd draw_bar) ---------- */
  function shapePts(x, y, w, h, sk) { return [[x + sk, y], [x + w, y], [x + w - sk, y + h], [x, y + h]]; }
  const lineX = (x, w, sk, r) => x + sk * 0.5 + (w - sk) * Math.max(0, Math.min(1, r));
  const slant = (cx, yy, y, h, sk) => cx + sk * (0.5 - (yy - y) / h);
  function bandPts(x, y, w, h, sk, r0, r1, y0, y1) {
    const a = lineX(x, w, sk, r0), b = lineX(x, w, sk, r1);
    return [[slant(a, y0, y, h, sk), y0], [slant(b, y0, y, h, sk), y0], [slant(b, y1, y, h, sk), y1], [slant(a, y1, y, h, sk), y1]];
  }
  function poly(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  function glassBar(g, x, y, w, h, sk, ratio, chip, ghost, cols, segments, low) {
    const r = Math.max(0, Math.min(1, ratio));
    for (let i = GB.SHADOW_R; i > 0; i--) {
      const k = 1 - i / (GB.SHADOW_R + 1);
      poly(g, shapePts(x - i, y - i + 2, w + i * 2, h + i * 2, sk)); g.fillStyle = 'rgba(0,0,0,' + (GB.SHADOW_A * 0.16 * k * k).toFixed(4) + ')'; g.fill();
    }
    poly(g, shapePts(x, y, w, h, sk)); g.fillStyle = GB.BACK; g.fill();
    if (ghost > r) { poly(g, bandPts(x, y, w, h, sk, r, Math.min(ghost, 1), y, y + h)); g.fillStyle = P.rgba(cols[1], GB.GHOST_A); g.fill(); }
    if (chip > r) { poly(g, bandPts(x, y, w, h, sk, r, Math.min(chip, 1), y, y + h)); g.fillStyle = GB.CHIP; g.fill(); }
    if (r > 0) {
      const ym = y + Math.round(h * GB.MID_STOP);
      poly(g, bandPts(x, y, w, h, sk, 0, r, y, ym)); g.fillStyle = P.vgrad(g, y, ym - y, [[0, cols[0]], [1, cols[1]]]); g.fill();
      poly(g, bandPts(x, y, w, h, sk, 0, r, ym, y + h)); g.fillStyle = P.vgrad(g, ym, y + h - ym, [[0, cols[1]], [1, cols[2]]]); g.fill();
      if (h >= 4) { poly(g, bandPts(x, y, w, h, sk, 0, r, y + 1, y + 2)); g.fillStyle = GB.TOP_LIGHT; g.fill(); }
    }
    poly(g, bandPts(x, y, w, h, sk, 0, 1, y, y + h * 0.5));
    g.fillStyle = P.vgrad(g, y, h * 0.5, [[0, 'rgba(255,236,214,' + GB.GLOSS_A + ')'], [1, 'rgba(255,236,214,0)']]); g.fill();
    if (segments && h >= 10) {
      g.strokeStyle = GB.SEG; g.lineWidth = 1; g.beginPath();
      for (let i = 1; i < 10; i++) { const cx = lineX(x, w, sk, i / 10); g.moveTo(cx + sk * 0.5, y); g.lineTo(cx - sk * 0.5, y + h); }
      g.stroke();
    }
    if (r > 0.002 && r < 0.998) {
      const ex = lineX(x, w, sk, r);
      g.lineCap = 'butt';
      for (const [lw, col] of [[6, P.rgba(cols[0], 0.10)], [3, P.rgba(cols[0], 0.22)], [1.5, GB.TIP]]) {
        g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(ex + sk * 0.5, y); g.lineTo(ex - sk * 0.5, y + h); g.stroke();
      }
    }
    poly(g, shapePts(x, y, w, h, sk)); g.strokeStyle = GB.EDGE; g.lineWidth = 1; g.stroke();
    const l = Math.max(0, Math.min(1, low || 0));
    if (l > 0) for (let i = 1; i <= 8; i++) {
      const k = 1 - (i - 1) / 8;
      poly(g, shapePts(x - i, y - i, w + i * 2, h + i * 2, sk)); g.strokeStyle = P.rgba(GB.LOW, (i === 1 ? 0.8 : 0.3) * l * k * k); g.stroke();
    }
  }

  /* ---------- icons: SVG strings rasterised once ---------- */
  function svgImage(svg, onload) {
    if (!svg) return null;
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image();
    img.onload = onload;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img;
  }

  /* ---------- the bar ---------- */
  function BottomBar(hud) {
    const root = document.createElement('div');
    root.className = 'hb-root';
    hud.frame.appendChild(root);
    const surf = P.surface(root, 'hb-cv', CW, CH, PADX, PADT);
    const hits = document.createElement('div'); hits.className = 'hb-hits'; root.appendChild(hits);
    const g = surf.g;
    let dirty = true;
    const mark = () => { dirty = true; };
    P.onFonts(mark);

    // state
    let defs = [], basic = null, icons = [], basicIcon = null, st = [], sig = '';
    const press = new Array(SKILL_COUNT).fill(-1), ready = new Array(SKILL_COUNT).fill(-1), deny = new Array(SKILL_COUNT).fill(-1), cdWas = new Array(SKILL_COUNT).fill(0);
    let hover = -1, autoHover = -1, autoPress = [-1, -1], combo = 0, walk = false, dead = false;
    const V = { hp: 0, maxHp: 0, mp: 0, maxMp: 0, sp: 0, maxSp: 0, absorb: 0, rHp: 0, rMp: 0, rSp: 0, chip: 0, chipHold: 0, low: [false, false, false], env: [0, 0, 0], phase: 0 };
    const X = { level: 1, exp: 0, need: 0, ratio: 0, glint: -1, flash: -1, gain: 0, gainT: 0, gainA: 0 };

    // hit rects (design px; positioned with --s)
    function hit(r, cls) {
      const d = document.createElement('div');
      d.className = 'hb-hit' + (cls ? ' ' + cls : '');
      d.style.cssText = 'left:calc(' + (r.x + PADX) + 'px * var(--s));top:calc(' + (r.y + PADT) + 'px * var(--s));width:calc(' + r.w + 'px * var(--s));height:calc(' + r.h + 'px * var(--s))';
      hits.appendChild(d);
      d.addEventListener('mousedown', (e) => e.preventDefault());
      return d;
    }
    const fmt = (n) => P.num(Math.floor(n), 0);
    // vitals tooltips
    hud.tips.bind(hit({ x: VX, y: VY, w: VW, h: HP_H }), () => '<div class="tt">Can</div><div class="ts">' + fmt(V.hp) + ' / ' + fmt(V.maxHp) + (V.absorb > 0 ? ' · ' + fmt(V.absorb) + ' emilim' : '') + '</div>', 'top');
    hud.tips.bind(hit({ x: VX, y: VY + HP_H + ROW_GAP - 2, w: VW, h: SUB_H + 4 }), () => '<div class="tt">Mana</div><div class="ts">' + fmt(V.mp) + ' / ' + fmt(V.maxMp) + (V.mpRegen ? ' · saniyede +' + fmt(V.mpRegen) : '') + '</div>', 'top');
    // skill slots 1-9
    for (let i = 0; i < SKILL_COUNT; i++) {
      const d = hit(slotRect(i), 'hb-slot'); d.dataset.slot = i;
      d.addEventListener('mouseenter', () => { hover = i; mark(); });
      d.addEventListener('mouseleave', () => { if (hover === i) { hover = -1; mark(); } });
      d.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.button === 0 && defs[i] && hud.opts.onSkill) hud.opts.onSkill(i); });
      hud.tips.bind(d, () => tipFor(i), 'top');
    }
    // knobs
    const kb = hit(autoRect(0), 'hb-knob'), kw = hit(autoRect(1), 'hb-knob');
    kb.addEventListener('mouseenter', () => { autoHover = 0; mark(); }); kb.addEventListener('mouseleave', () => { autoHover = -1; mark(); });
    kw.addEventListener('mouseenter', () => { autoHover = 1; mark(); }); kw.addEventListener('mouseleave', () => { autoHover = -1; mark(); });
    kw.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.button === 0 && hud.opts.onToggleWalk) { autoPress[1] = 0; hud.opts.onToggleWalk(); mark(); } });
    kb.addEventListener('pointerdown', (e) => e.stopPropagation());
    hud.tips.bind(kb, () => basic ? '<div class="tt">' + esc(basic.name) + '</div><div class="ts">Sağ tık</div><div class="tb" style="margin-top:6px">' + esc(basic.desc || '') + '</div>' : '', 'top');
    hud.tips.bind(kw, () => '<div class="tt">' + (walk ? 'Yürüyüş' : 'Koşu') + '</div><div class="ts">Tuş C · tıkla: ' + (walk ? 'koşuya geç' : 'yürüyüşe geç') + '</div>', 'top');
    // EXP rail + seal
    const xpTip = () => X.need ? '<div class="tt">Seviye ' + X.level + '</div><div class="ts">' + fmt(X.exp) + ' / ' + fmt(X.need) + ' TP · ' + P.pct(X.ratio * 100, 2) + '</div><div class="ts">Sonraki seviyeye ' + fmt(Math.max(0, Math.ceil(X.need - X.exp))) + ' TP</div>' : '';
    hud.tips.bind(hit({ x: SEAL_CX + SEAL_R, y: RAIL_CY - CAP_H * 0.5, w: READ_X + G_READ_W - SEAL_CX - SEAL_R, h: CAP_H }), xpTip, 'top');
    hud.tips.bind(hit({ x: SEAL_CX - SEAL_R, y: RAIL_CY - SEAL_R, w: SEAL_R * 2, h: SEAL_R * 2 }, 'seal'), xpTip, 'top');

    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function tipFor(i) {
      const s = defs[i], q = st[i] || {};
      if (!s) return '';
      let warn = '';
      if (q.cd > 0) warn = '<div class="tw">Bekleme: ' + (q.cd >= 1 ? Math.ceil(q.cd) + ' sn' : q.cd.toFixed(1).replace('.', ',') + ' sn') + '</div>';
      else if (q.usable === false) warn = '<div class="tw bad">Yetersiz mana</div>';
      if (q.active && q.activeLeft > 0) warn += '<div class="tw">Etkin: ' + Math.ceil(q.activeLeft) + ' sn</div>';
      return '<div class="tt">' + esc(s.name) + '</div><div class="ts">Tuş ' + esc(s.key) + (s.alt ? ' / ' + esc(s.alt) : '') + '</div>' +
        (s.mp || s.cd ? '<div class="tm">' + (s.mp ? '<span class="mp">' + s.mp + ' mana</span>' : '') + (s.cd ? '<span>' + s.cd + ' sn bekleme</span>' : '') + '</div>' : '<div style="height:6px"></div>') +
        '<div class="tb">' + esc(s.desc || '') + '</div>' + warn;
    }

    /* ----- drawing ----- */
    function keyChip(text, x, y, alpha, mouse) {
      const font = P.F.cinzel(600, KEY_FS);
      const w = mouse ? KEY_H : Math.max(KEY_H, Math.ceil(P.width(g, text, font)) + 2 * KEY_PAD);
      P.raised(g, x, y, w, KEY_H, KEY_CUT, KEY_FACE * alpha, KEY_RIM * alpha);
      g.fillStyle = 'rgba(0,0,0,' + (KEY_SHADE * alpha) + ')'; g.fillRect(x + KEY_CUT, y + KEY_H, w - 2 * KEY_CUT, 1);
      if (mouse) {                                                  // RIGHT mouse button glyph (the basic attack's "key": Metin2-style right click)
        const mx = x + 3.5, my = y + 1.5, mw = 5, mh = 9;
        g.strokeStyle = P.rgba(C.BONE, alpha); g.lineWidth = 1; g.beginPath(); g.roundRect(mx, my, mw, mh, 2.5); g.stroke();
        g.fillStyle = P.rgba(C.BONE, alpha); g.beginPath(); g.moveTo(mx + mw / 2, my); g.lineTo(mx + mw / 2, my + 4); g.lineTo(mx + mw, my + 4); g.arcTo(mx + mw, my, mx + mw / 2, my, 2.5); g.closePath(); g.fill();
      } else P.engraved(g, text, font, x + w / 2, y + KEY_H / 2 + 0.5, P.rgba(C.BONE, alpha), 0);
      return w;
    }
    function lip(r, cut, col, a, wash) {
      if (wash > 0) { P.octPath(g, r.x, r.y, r.w, r.h, cut); g.fillStyle = P.rgba(col, wash); g.fill(); }
      const q = grow(r, -0.5); P.octPath(g, q.x, q.y, q.w, q.h, cut); g.strokeStyle = P.rgba(col, a); g.lineWidth = 1; g.stroke();
    }
    function drawSlot(r, cut, inset, o) {
      P.well(g, r.x, r.y, r.w, r.h, cut, WELL_FILL, WELL_LIP_TOP, WELL_LIP_BOT);
      const ir = grow(r, -inset), icut = Math.max(2, cut - inset * 0.6);
      const p = o.press >= 0 ? Math.sin(Math.PI * Math.min(1, o.press)) : 0;
      if (o.img && o.img.complete && o.img.naturalWidth) {
        g.save();
        P.octPath(g, ir.x, ir.y + p, ir.w, ir.h, icut); g.clip();
        g.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
        if (o.filter) g.filter = o.filter;
        g.drawImage(o.img, ir.x, ir.y + p, ir.w, ir.h);
        g.restore();
        if (p > 0) { P.octPath(g, ir.x, ir.y, ir.w, ir.h, icut); g.fillStyle = 'rgba(0,0,0,' + (PRESS_DARK * p) + ')'; g.fill(); }
        // seat the icon: 4 px inner shade from the top + 1 px dark edge
        g.save(); P.octPath(g, ir.x, ir.y, ir.w, ir.h, icut); g.clip();
        g.fillStyle = P.vgrad(g, ir.y, 4, [[0, 'rgba(0,0,0,' + ICON_RECESS + ')'], [1, 'rgba(0,0,0,0)']]); g.fillRect(ir.x, ir.y, ir.w, 4);
        g.restore();
        const e = grow(ir, -0.5); P.octPath(g, e.x, e.y, e.w, e.h, icut); g.strokeStyle = 'rgba(0,0,0,' + ICON_EDGE + ')'; g.lineWidth = 1; g.stroke();
      }
      if (o.cd > 0) {                                               // remaining time as a dark wedge opening clockwise from 12
        const f = Math.max(0, Math.min(1, o.cd)), cx = ir.x + ir.w / 2, cy = ir.y + ir.h / 2, rr = Math.hypot(ir.w, ir.h);
        const a0 = -Math.PI / 2 + Math.PI * 2 * (1 - f), a1 = -Math.PI / 2 + Math.PI * 2;
        g.save(); P.octPath(g, ir.x, ir.y, ir.w, ir.h, icut); g.clip();
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rr, a0, a1); g.closePath(); g.fillStyle = VEIL + CD_VEIL + ')'; g.fill();
        if (f < 1) { g.strokeStyle = P.rgba(C.ASH_HI, CD_EDGE); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr); g.stroke(); }
        g.restore();
        if (o.cdText) P.engraved(g, o.cdText, P.F.serif(700, CD_FS), cx, cy + 1, C.ASH_HI, 0);
      }
      if (o.ready >= 0) {
        const k = Math.sin(Math.PI * Math.min(1, o.ready));
        if (k > 0) {
          P.octPath(g, r.x, r.y, r.w, r.h, cut); g.fillStyle = P.rgba(AMBER_LIT, READY_WASH * k); g.fill();
          const q = grow(r, -1); P.octPath(g, q.x, q.y, q.w, q.h, Math.max(2, cut - 0.5)); g.strokeStyle = P.rgba(C.AMBER, READY_A * k); g.lineWidth = 2; g.stroke();
        }
      }
      if (o.active) lip(r, cut, C.AMBER, DROP_OK_A, DROP_OK_WASH);
      if (o.deny >= 0) { const k = 1 - Math.min(1, o.deny); lip(r, cut, DANGER, DROP_NO_A * k, DROP_NO_WASH * k); }
      if (o.hover && !o.active) lip(r, cut, C.ASH_HI, HOVER_LIP, 0);
      if (o.key) keyChip(o.key, r.x + KEY_IN, r.y + KEY_IN, o.img ? 1 : EMPTY_KEY_A);
    }
    function glyphWalk(cx, cy, size, col) {
      const k = size / 18;
      g.fillStyle = col;
      for (const [ox, oy, rot] of [[-3.6, 2.2, -0.2], [3.6, -2.6, 0.2]]) {
        const x0 = cx + ox * k, y0 = cy + oy * k;
        for (const [dx, dy, rx, ry] of [[0, -2.6, 2.5, 3.5], [0, 3.6, 1.9, 2.1]]) {
          g.beginPath();
          for (let i = 0; i < 16; i++) {
            const a = Math.PI * 2 * i / 16, lx = (dx + Math.cos(a) * rx) * k, ly = (dy + Math.sin(a) * ry) * k;
            const px = x0 + lx * Math.cos(rot) - ly * Math.sin(rot), py = y0 + lx * Math.sin(rot) + ly * Math.cos(rot);
            if (i) g.lineTo(px, py); else g.moveTo(px, py);
          }
          g.closePath(); g.fill();
        }
      }
    }
    function glyphCombat(cx, cy, size, col) {
      const k = size / 18, l2 = 8.6 * k;
      g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'butt';
      for (const d of [-1, 1]) {
        const rot = d * Math.PI * 0.25, at = (vx, vy) => [cx + vx * Math.cos(rot) - vy * Math.sin(rot), cy + vx * Math.sin(rot) + vy * Math.cos(rot)];
        const ln = (a, b, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
        ln(at(0, -l2), at(0, l2 * 0.52), 2 * k);
        ln(at(-3.2 * k, l2 * 0.52), at(3.2 * k, l2 * 0.52), 1.6 * k);
        ln(at(0, l2 * 0.52), at(0, l2 * 0.86), 1.8 * k);
        const pm = at(0, l2 * 0.98); g.beginPath(); g.arc(pm[0], pm[1], 1.3 * k, 0, Math.PI * 2); g.fill();
      }
    }
    function drawAuto(kind, on, hov, pr) {
      const base = autoRect(kind), p = pr >= 0 ? Math.sin(Math.PI * Math.min(1, pr)) : 0, r = { x: base.x, y: base.y + p, w: AUTO, h: AUTO };
      P.knob(g, r.x, r.y, r.w, r.h, AUTO_CUT, AUTO_FACE, hov ? 1 : AUTO_RIM_IDLE);
      const col = on ? C.AMBER : P.rgba(C.ASH, AUTO_GLYPH_OFF), gx = r.x + AUTO / 2, gy = r.y + AUTO / 2 - 2;
      if (kind === 1) glyphWalk(gx, gy, AUTO_GLYPH, col); else glyphCombat(gx, gy, AUTO_GLYPH, col);
      const ix = r.x + (AUTO - AUTO_INLAY_W) * 0.5, iy = r.y + r.h - AUTO_INLAY_DY;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(ix - 1, iy - 1, AUTO_INLAY_W + 2, AUTO_INLAY_H + 2);
      if (kind === 0 && combo > 0 && comboMax > 1) {                // basic attack: the inlay counts the combo hits
        const seg = (AUTO_INLAY_W - (comboMax - 1)) / comboMax;
        for (let i = 0; i < comboMax; i++) { g.fillStyle = i < combo ? P.rgba(C.AMBER, AUTO_INLAY_ON) : P.rgba(C.ASH_HI, AUTO_INLAY_OFF); g.fillRect(ix + i * (seg + 1), iy, seg, AUTO_INLAY_H); }
      } else { g.fillStyle = on ? P.rgba(C.AMBER, AUTO_INLAY_ON) : P.rgba(C.ASH_HI, AUTO_INLAY_OFF); g.fillRect(ix, iy, AUTO_INLAY_W, AUTO_INLAY_H); }
      if (kind === 1) keyChip('C', r.x + KEY_IN, r.y + KEY_IN, 1); else keyChip('', r.x + KEY_IN, r.y + KEY_IN, 1, true);
    }
    let comboMax = 3;
    function drawGroove() {
      const sr = strapRect; P.knob(g, sr.x, sr.y, sr.w, sr.h, STRAP_CUT, AUTO_FACE, AUTO_RIM_IDLE);
      const gr = grooveRect; P.well(g, gr.x, gr.y, gr.w, gr.h, G_CUT, G_FILL, G_LIP_TOP, G_LIP_BOT);
      const fx = gr.x + 1, fy = gr.y + 1, fw = gr.w - 2, fh = gr.h - 2, r = Math.max(0, Math.min(1, X.ratio)), ww = fw * r;
      if (ww > 0) {
        g.save(); g.globalAlpha = G_AMBER; g.fillStyle = P.vgrad(g, fy, fh, [[0, AMBER_LIT], [0.30, C.AMBER], [1, P.darkened(C.AMBER, G_DEEP)]]); g.fillRect(fx, fy, ww, fh); g.restore();
        if (r < 1) {
          g.fillStyle = P.rgba(AMBER_LIT, G_EDGE); g.fillRect(fx + ww - 1.5, fy, 1.5, fh);
          if (X.glint >= 0) {
            const ga = G_GLINT_A * Math.sin(Math.PI * Math.min(1, X.glint)), x0 = Math.max(fx, fx + ww - G_GLINT_W);
            const gg = g.createLinearGradient(x0, 0, fx + ww, 0); gg.addColorStop(0, P.rgba(AMBER_LIT, 0)); gg.addColorStop(1, P.rgba(AMBER_LIT, ga));
            g.fillStyle = gg; g.fillRect(x0, fy, fx + ww - x0, fh);
          }
        }
      }
      const th = Math.round(fh * 0.5); g.fillStyle = 'rgba(0,0,0,' + G_TICK + ')';
      for (let k = 1; k < 10; k++) g.fillRect(Math.round(fx + fw * k / 10), fy, 1, th);
      const cr = capRect; P.knob(g, cr.x, cr.y, cr.w, cr.h, CAP_CUT, AUTO_FACE, 1); P.nail(g, cr.x + cr.w / 2, cr.y + cr.h / 2, CAP_NAIL_R);
      const read = X.need > 0 ? P.pct(X.ratio * 100, 1) : '';
      const rw = read ? P.haloed(g, read, P.F.serif(700, G_READ_FS), READ_X, RAIL_CY, C.BONE) : 0;
      if (X.gainA > 0.01) P.haloed(g, '+' + fmt(X.gain) + ' TP', P.F.serif(700, G_READ_FS), READ_X + rw + 10, RAIL_CY, P.rgba(C.AMBER, X.gainA));
    }
    function drawSeal() {
      const cx = SEAL_CX, cy = RAIL_CY, f = X.flash >= 0 ? 1 - Math.min(1, X.flash) : 0;
      g.beginPath(); g.arc(cx, cy, SEAL_R + 0.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,' + SEAL_OUTLINE + ')'; g.lineWidth = 1; g.stroke();
      P.circlePath(g, cx, cy, SEAL_R); P.fillRamp(g, cy - SEAL_R, SEAL_R * 2, P.RIM, 1);
      P.circlePath(g, cx, cy, SEAL_R - SEAL_FACE_IN); P.fillRamp(g, cy - SEAL_R, SEAL_R * 2, P.FACE, 0.97);
      g.beginPath(); g.arc(cx, cy, SEAL_RING_R, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,' + SEAL_RING_DARK + ')'; g.stroke();
      g.beginPath(); g.arc(cx, cy + 0.8, SEAL_RING_R + 0.8, 0, Math.PI); g.strokeStyle = P.rgba(C.ASH_HI, SEAL_RING_LIT); g.stroke();
      if (f > 0) { g.beginPath(); g.arc(cx, cy, SEAL_RING_R, 0, Math.PI * 2); g.strokeStyle = P.rgba(C.AMBER, LEVEL_FLASH * f); g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
      const lv = String(X.level), col = f > 0 ? P.mix(C.BONE, AMBER_LIT, f) : C.BONE;
      P.engraved(g, lv, P.F.cinzel(700, lv.length >= 3 ? SEAL_FS_LONG : SEAL_FS), cx, cy + 1, col, 0);
    }
    function lowStrength(i) { if (V.env[i] <= 0) return 0; const w = (Math.sin(V.phase * Math.PI * 2 / LOW_PERIOD) + 1) * 0.5; return V.env[i] * (LOW_A_MIN + w * (1 - LOW_A_MIN)); }
    function num2(cur, max, x, base, align, big) {
      const fa = big ? P.F.sans(800, FS_BIG) : P.F.sans(700, FS_SMALL), fb = big ? P.F.sans(500, FS_BIG_MAX) : P.F.sans(500, FS_SMALL_MAX);
      const a = fmt(cur), b = ' / ' + fmt(max), wa = P.width(g, a, fa), wb = P.width(g, b, fb), tot = wa + wb;
      const x0 = align < 0 ? x : align === 0 ? x - tot * 0.5 : x - tot;
      P.ufuk(g, a, fa, x0, base, C.U_BONE); P.ufuk(g, b, fb, x0 + wa, base, DIM);
    }
    function drawVitals() {
      const hasSp = V.maxSp > 0, subW = hasSp ? (VW - SPLIT) * 0.5 : VW, y1 = VY + HP_H + ROW_GAP;
      glassBar(g, VX, VY, VW, HP_H, HP_SKEW, V.rHp, V.chip, V.rHp, GB.HP, true, lowStrength(0));
      glassBar(g, VX, y1, subW, SUB_H, SUB_SKEW, V.rMp, 0, V.rMp, GB.MP, false, lowStrength(1));
      if (hasSp) glassBar(g, VX + subW + SPLIT, y1, subW, SUB_H, SUB_SKEW, V.rSp, 0, 0, GB.SP, false, lowStrength(2));
      if (V.maxHp > 0) num2(V.hp, V.maxHp, VX + VW * 0.5, VY + HP_NUM_BASE, 0, true);
      if (V.maxMp > 0) num2(V.mp, V.maxMp, VX - SUB_NUM_GAP, VY + SUB_NUM_BASE, 1, false);
      if (hasSp) num2(V.sp, V.maxSp, VX + VW + SUB_NUM_GAP, VY + SUB_NUM_BASE, -1, false);
    }
    function draw() {
      surf.begin();
      drawVitals();
      const deadF = dead ? 'grayscale(1) brightness(.5)' : '';
      for (let i = 0; i < SKILL_COUNT; i++) {
        const q = st[i] || {}, s = defs[i];
        const cdFrac = q.cd > 0 ? Math.max(0, Math.min(1, q.cd / Math.max(q.cdTotal || (s && s.cd) || q.cd, 0.01))) : 0;
        drawSlot(slotRect(i), S_CUT, S_INSET, {
          img: s ? icons[i] : null, key: String(i + 1), press: press[i], ready: ready[i], deny: deny[i], hover: hover === i && !!s,
          cd: cdFrac, cdText: q.cd > 0 ? String(Math.ceil(q.cd)) : '', alpha: s && q.usable === false && !(q.cd > 0) ? 0.45 : 1, filter: deadF,
          active: !!(q.active || q.casting),
        });
      }
      for (let i = SKILL_COUNT; i < SKILL_COUNT * 2; i++) drawSlot(slotRect(i), F_CUT, F_INSET, { key: 'F' + (i - SKILL_COUNT + 1), press: -1, ready: -1, deny: -1 });
      drawAuto(0, combo > 0, autoHover === 0, autoPress[0]);
      drawAuto(1, walk, autoHover === 1, autoPress[1]);
      drawGroove();
      drawSeal();
    }

    /* ----- API ----- */
    const api = {
      el: root,
      // vitals (HUDParts.player)
      setVitals(p) {
        const r = (v, m) => (m > 0 ? Math.max(0, Math.min(1, v / m)) : 0);
        const rh = r(p.hp, p.maxHp);
        if (rh < V.rHp && V.maxHp > 0) { V.chip = Math.max(V.chip, V.rHp); V.chipHold = CHIP_HOLD; } else if (rh >= V.chip) V.chip = 0;
        Object.assign(V, { hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, sp: p.sp || 0, maxSp: p.maxSp || 0, absorb: p.absorb || 0, mpRegen: p.mpRegen, rHp: rh, rMp: r(p.mp, p.maxMp), rSp: r(p.sp || 0, p.maxSp || 0) });
        [V.rHp, V.rMp, V.rSp].forEach((x, i) => { if (x < LOW_ENTER && (i < 2 ? (i ? V.maxMp : V.maxHp) : V.maxSp) > 0) V.low[i] = true; else if (x > LOW_EXIT) V.low[i] = false; });
        if (dead !== !!p.dead) { dead = !!p.dead; mark(); }
      },
      setSkills(list, b) {
        defs = list || []; basic = b || null;
        icons = defs.map((s) => svgImage(s.iconHTML, mark));
        basicIcon = basic ? svgImage(basic.iconHTML, mark) : null;
        comboMax = 3; mark();
      },
      update(list, state) {
        st = list || [];
        for (let i = 0; i < st.length && i < SKILL_COUNT; i++) {
          const cd = st[i].cd || 0;
          if (cdWas[i] > 0 && cd <= 0) ready[i] = 0;               // cooldown finished: one amber pulse
          cdWas[i] = cd;
        }
        if (state && state.walk !== undefined && walk !== !!state.walk) { walk = !!state.walk; mark(); }
        const k = st.map((q) => (q.cd > 0 ? Math.ceil(q.cd * 30) : 0) + (q.usable === false ? 'u' : '') + (q.active || q.casting ? 'a' : '')).join(',') +
          '|' + Math.round(V.hp) + '/' + V.maxHp + '|' + Math.round(V.mp) + '/' + V.maxMp + '|' + Math.round(V.sp) + '|' + X.ratio.toFixed(4) + '|' + X.level;
        if (k !== sig) { sig = k; mark(); }
        if (hud.tips.anchor && hud.tips.anchor.classList && hud.tips.anchor.classList.contains('hb-slot')) hud.tips.refresh();
      },
      pressed(i) { if (i >= 0 && i < SKILL_COUNT) { press[i] = 0; mark(); } },
      deny(i) { if (i >= 0 && i < SKILL_COUNT) { deny[i] = 0; mark(); } },
      combo(n) { if (combo !== n) { combo = n; if (n > 0) autoPress[0] = 0; mark(); } },
      // EXP (HUDParts.xp)
      setExp(x) {
        const r = x.need > 0 ? Math.max(0, Math.min(1, x.exp / x.need)) : 0;
        if (X.level !== x.level || Math.abs(r - X.ratio) > 0.00005) { X.level = x.level; X.exp = x.exp; X.need = x.need; X.ratio = r; mark(); }
        X.exp = x.exp; X.need = x.need;
      },
      levelUp() { X.flash = 0; mark(); },
      gain(n) { X.gain += n; X.gainT = 1.3; X.gainA = 1; X.glint = 0; mark(); },
      frame(dt) {
        let anim = false;
        const span = PRESS_TIME + PRESS_RELEASE;
        for (let i = 0; i < SKILL_COUNT; i++) {
          if (press[i] >= 0) { press[i] += dt / span; if (press[i] >= 1) press[i] = -1; anim = true; }
          if (ready[i] >= 0) { ready[i] += dt / READY_TIME; if (ready[i] >= 1) ready[i] = -1; anim = true; }
          if (deny[i] >= 0) { deny[i] += dt / DENY_TIME; if (deny[i] >= 1) deny[i] = -1; anim = true; }
          if (st[i] && st[i].cd > 0) anim = true;
        }
        for (let k = 0; k < 2; k++) if (autoPress[k] >= 0) { autoPress[k] += dt / span; if (autoPress[k] >= 1) autoPress[k] = -1; anim = true; }
        if (X.glint >= 0) { X.glint += dt / GLINT_TIME; if (X.glint >= 1) X.glint = -1; anim = true; }
        if (X.flash >= 0) { X.flash += dt / LEVEL_TIME; if (X.flash >= 1) X.flash = -1; anim = true; }
        if (X.gainT > 0) { X.gainT -= dt; anim = true; } else if (X.gainA > 0) { X.gainA = Math.max(0, X.gainA - dt / 0.3); if (X.gainA <= 0) X.gain = 0; anim = true; }
        // HP damage chip: holds, then melts
        if (V.chip > V.rHp) { if (V.chipHold > 0) V.chipHold -= dt; else V.chip = Math.max(V.rHp, V.chip - CHIP_SPEED * dt); anim = true; } else V.chip = 0;
        // low-resource pulse (hysteresis in setVitals)
        let lowOn = false;
        for (let i = 0; i < 3; i++) { const goal = V.low[i] ? 1 : 0; if (V.env[i] !== goal) { V.env[i] += Math.sign(goal - V.env[i]) * Math.min(Math.abs(goal - V.env[i]), dt / LOW_FADE); anim = true; } if (V.env[i] > 0 || V.low[i]) lowOn = true; }
        if (lowOn) { V.phase += dt; anim = true; } else V.phase = 0;
        if (MOBILE_HIDDEN) return;                                 // [perf] phones: this bar is hidden (ui/mobilehud.js paints its own)
        if (anim || dirty) { dirty = false; draw(); }
      },
      resize(s) { surf.resize(s); dirty = true; },
    };
    surf.resize(hud.s || 1);
    return api;
  }

  // [mobile HUD] the same brushes for ui/mobilehud.js (touch layout, identical look): glass bar + SVG rasteriser + colours
  global.HUDBottomPaint = { glassBar, svgImage, GB, poly, shapePts };

  const get = (hud) => hud._bottomBar || (hud._bottomBar = BottomBar(hud));
  global.HUDParts = global.HUDParts || {};
  // vitals: the top-left player frame of the old HUD is gone (Atherion layout C moved HP / mana to the bottom bar)
  global.HUDParts.player = (hud) => { const b = get(hud); return { setInfo() {}, set(p) { b.setVitals(p); } }; };
  global.HUDParts.actions = (hud) => get(hud);
  global.HUDParts.xp = (hud) => { const b = get(hud); return { set(x) { b.setExp(x); }, levelUp() { b.levelUp(); }, gain(n) { b.gain(n); } }; };
})(window);
