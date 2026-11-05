/* TDS HUD part — menu strip (slot 'menustrip'), ported 1:1 from Atherion:
 *   menu_strip_plate.gd ("Etiketli Ray", menu_modern_tasarim.html 2b + 2026-10-04: frameless, key chip at the glyph's top-right)
 *   hud_view.gd (_draw_menu_strip: glyphs (+ glow) → names + key chips; hover / open / press state; hit = the whole cell)
 * Bottom-right, 16 px from the right, 6 px above the bottom (= the action bar's baseline), 54 px tall; cells are as wide as their
 * name + equal air (AIR 6..18, strip ≤ 620). Glyphs are Atherion's SVG path data (GLYPH_LAYERS), rasterised per role at screen scale.
 * Buttons = only the windows this game has: Karakter, Yetenekler, Envanter (when the inventory part registered 'inv'), Harita, Ayarlar.
 * Key letters come from hud.keymap (the game's real bindings); Ayarlar = Esc.
 * API: { sync() } — lights the buttons whose window is open (and plays the press dip when that changes); frame(dt), resize(s).
 */
(function (global) {
  'use strict';
  global.HUDParts = global.HUDParts || {};
  const P = global.HUDPaint, C = P.C;

  /* ── sizes (canvas px) ── */
  const H = 54, SIDE = 14, RIGHT = 16, BOTTOM = 6, MAX_W = 620, AIR_MIN = 6, AIR_MAX = 18, CELL_MIN = 40;
  const GLYPH_CY = 20, GLYPH_BOX = 24, GLYPH_VIEW = 28.8, GLYPH_SHADOW_A = 0.55, PRESS_DY = 1.5;
  const LABEL_BASE = 44, LABEL_FS = 10, LABEL_TRACK = 1, LABEL_SHADOW_A = 0.70;
  const MARK_W = 16, MARK_H = 2, MARK_Y = LABEL_BASE + 5, GLOW_R = 22, GLOW_A = 0.12;
  const KEY_R = 7.5, KEY_DX = 13, KEY_DY = -8, KEY_FS = 10, KEY_PAD = 4;
  const PRESS_SPAN = 0.09 + 0.12;                                  // ActionBarPlate PRESS_TIME + PRESS_RELEASE
  /* ── palette (Cam Çizgi bone + Ufuk amber) ── */
  const BONE = '#ECE3D0', GLYPH_A_IDLE = 0.80;
  const LABEL_IDLE = P.rgba(C.BONE, 0.86);
  const CUT_COL = '#110A02';                                       // ChatPlate.FACE_MID
  const MARK_COL = '#D9A94E', KEY_EDGE = 'rgba(217,169,78,.55)', KEY_EDGE_HOVER = 'rgba(217,169,78,.90)', KEY_FILL = 'rgba(14,10,6,.88)', KEY_FG = '#E3BE79';
  const BADGE_EDGE = 'rgba(20,13,6,.90)', BADGE_SHADOW = 'rgba(0,0,0,.45)', BADGE_FG = '#1A120A';
  const LABEL_FONT = P.F.cinzel(600, LABEL_FS), KEY_FONT = P.F.cinzel(700, KEY_FS);

  /* ── glyphs: menu_strip_plate.GLYPH_LAYERS (24 × 24 unit grid, centre 0,0). Layer = [role, stroke width (0 = fill), paths];
   *    role "b" body (state colour) · "d<t>" second tone (cut → colour by t) · "c" cut (CUT_COL; skipped in the shadow pass) ── */
  const GLYPHS = {
    helm: [['b', 0, ['M-8.4 7.6L-8.4 -5.6Q-8.4 -11.6 0 -11.6Q8.4 -11.6 8.4 -5.6L8.4 7.6L0 11.4Z']], ['c', 2.3, ['M-6.4 -2.6L6.4 -2.6']], ['c', 2.1, ['M0 -2.6L0 7.2']], ['c', 1.1, ['M-8.4 -7.4L8.4 -7.4']]],
    spark: [['b', 0, ['M-3 -12L-1.2 -9L-1.2 4L-4.8 4L-4.8 -9Z', 'M-8.6 4L2.6 4L2.6 6.2L-8.6 6.2Z', 'M-4 6.2L-2 6.2L-2 9.8L-4 9.8Z', 'M-1.3 11A1.7 1.7 0 1 1 -4.7 11A1.7 1.7 0 1 1 -1.3 11Z', 'M5.8 -10L6.755 -5.355L11.4 -4.4L6.755 -3.445L5.8 1.2L4.845 -3.445L0.2 -4.4L4.845 -5.355Z']]],
    pouch: [['b', 0, ['M-6 -11.8L6 -11.8L3.4 -7.6L-3.4 -7.6Z', 'M-4.4 -6.4L4.4 -6.4L4.4 -4.6L-4.4 -4.6Z', 'M-3.6 -3.4Q-10.8 -0.4 -10.2 5Q-9.6 11.2 0 11.2Q9.6 11.2 10.2 5Q10.8 -0.4 3.6 -3.4Z']]],
    door: [['b', 0, ['M-5.6 -11.4L5.6 -11.4L5.6 11L-5.6 11Z']], ['c', 1.8, ['M-4.2 -11.4L-4.2 11', 'M5.6 -3.4L2.2 -3.4']], ['b', 0, ['M4.6 1.6A1.5 1.5 0 1 1 1.6 1.6A1.5 1.5 0 1 1 4.6 1.6Z']]],   // kapı: kanat + tokmak
    map: [['b', 0, ['M-11.6 -7.5L-4.5 -10L-4.5 7.5L-11.6 10Z', 'M4.5 -7.5L11.6 -10L11.6 7.5L4.5 10Z']], ['d0.6', 0, ['M-3.1 -10L3.1 -7.5L3.1 10L-3.1 7.5Z']]],
    gear: [['b', 3.6, ['M5.4 0A5.4 5.4 0 1 1 -5.4 0A5.4 5.4 0 1 1 5.4 0Z']], ['b', 0, ['M5.844 -2.61L10.389 -2.106L10.389 2.106L5.844 2.61Z', 'M5.977 2.287L8.835 5.857L5.857 8.835L2.287 5.977Z', 'M2.61 5.844L2.106 10.389L-2.106 10.389L-2.61 5.844Z', 'M-2.287 5.977L-5.857 8.835L-8.835 5.857L-5.977 2.287Z', 'M-5.844 2.61L-10.389 2.106L-10.389 -2.106L-5.844 -2.61Z', 'M-5.977 -2.287L-8.835 -5.857L-5.857 -8.835L-2.287 -5.977Z', 'M-2.61 -5.844L-2.106 -10.389L2.106 -10.389L2.61 -5.844Z', 'M2.287 -5.977L5.857 -8.835L8.835 -5.857L5.977 -2.287Z']]],
  };
  const glyphCache = new Map();                                    // "<glyph>:<px>" → [{ role, cv, tint: {} }]
  // one white mask per run of same-role layers (overlaps inside a run do not double the alpha — like Godot's per-role SVG texture)
  function glyphRuns(name, px) {
    const key = name + ':' + px;
    let runs = glyphCache.get(key);
    if (runs) return runs;
    runs = [];
    const layers = GLYPHS[name];
    for (let i = 0; i < layers.length;) {
      const role = layers[i][0], cv = document.createElement('canvas');
      cv.width = cv.height = px;
      const c = cv.getContext('2d'), k = px / GLYPH_VIEW;
      c.setTransform(k, 0, 0, k, px / 2, px / 2);
      c.fillStyle = c.strokeStyle = '#fff'; c.lineCap = 'butt'; c.lineJoin = 'miter';
      for (; i < layers.length && layers[i][0] === role; i++) {
        const [, w, paths] = layers[i];
        for (const d of paths) { const p2 = new Path2D(d); if (w > 0) { c.lineWidth = w; c.stroke(p2); } else c.fill(p2); }
      }
      runs.push({ role, cv, tint: {} });
    }
    glyphCache.set(key, runs);
    return runs;
  }
  function tinted(run, rgb) {
    let t = run.tint[rgb];
    if (!t) {
      t = document.createElement('canvas'); t.width = run.cv.width; t.height = run.cv.height;
      const c = t.getContext('2d');
      c.drawImage(run.cv, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = rgb; c.fillRect(0, 0, t.width, t.height);
      run.tint[rgb] = t;
    }
    return t;
  }
  const roleRGB = (role) => (role === 'c' ? CUT_COL : role === 'b' ? BONE : P.mix(CUT_COL, BONE, +role.slice(1)));
  const press = (t) => (t >= 0 ? Math.sin(Math.PI * Math.min(1, t)) : 0);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  global.HUDParts.menustrip = function (hud) {
    const D = document;
    const defs = [
      { id: 'char', label: 'Karakter', glyph: 'helm' },
      { id: 'skills', label: 'Yetenekler', glyph: 'spark' },
      { id: 'inv', label: 'Envanter', glyph: 'pouch' },
      { id: 'map', label: 'Harita', glyph: 'map' },
      { id: 'menu', label: 'Ayarlar', glyph: 'gear' },
      { id: 'exit', label: 'Çıkış', glyph: 'door', action: () => { if (hud.onExit) hud.onExit(); } },
    ];
    // only windows that exist (the inventory part, when present, registers 'inv' before this part is created)
    const items = defs.filter((d) => d.id !== 'inv' || (hud.windows.reg && hud.windows.reg.inv));
    const keyOf = (id) => {
      if (id === 'menu') return 'Esc';
      const ks = Object.keys(hud.keymap || {}).filter((k) => hud.keymap[k] === id);
      const k = ks.find((x) => /^[a-z0-9]$/.test(x)) || ks[0];
      return k ? k.toUpperCase() : '';
    };
    const root = D.createElement('div');
    root.className = 'hud-menustrip';
    root.style.cssText = 'position:absolute;pointer-events:none;z-index:2';
    hud.frame.appendChild(root);
    const M = 8;
    const S = P.surface(root, 'ms-cv', 100, H + M * 2, M, M);
    S.el.style.cssText = 'position:absolute;pointer-events:none';
    const g = S.g;
    for (const it of items) {
      it.open = false; it.hover = false; it.pressT = -1; it.key = keyOf(it.id);
      it.text = it.label.toLocaleUpperCase('tr-TR');
      const b = D.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.setAttribute('aria-label', it.label);
      b.style.cssText = 'position:absolute;top:0;pointer-events:auto;cursor:pointer';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => { e.stopPropagation(); it.pressT = 0; dirty = true; if (it.action) { it.action(); return; } hud.windows.toggle(it.id); });
      b.addEventListener('mouseenter', () => { it.hover = true; dirty = true; });
      b.addEventListener('mouseleave', () => { it.hover = false; dirty = true; });
      hud.tips.bind(b, () => '<div class="tt">' + esc(it.label) + '</div>' + (it.key ? '<div class="ts">Kısayol: ' + esc(it.key) + '</div>' : ''), 'top');
      root.appendChild(b); it.btn = b;
    }
    let s = hud.s || 1, dirty = true, w = 0;

    // menu_strip_plate.layout: cell = name width + equal air; short names rise to CELL_MIN and the air is re-split
    function layout() {
      for (const it of items) it.lw = Math.max(0, P.width(g, it.text, LABEL_FONT, LABEL_TRACK) - LABEL_TRACK);
      const n = Math.max(items.length, 1), room = MAX_W - 2 * SIDE;
      let air = clamp((room - items.reduce((a, it) => a + it.lw, 0)) / n, AIR_MIN, AIR_MAX), fixed = 0, freeSum = 0, freeN = 0;
      for (const it of items) { if (it.lw + air < CELL_MIN) fixed += CELL_MIN; else { freeSum += it.lw; freeN++; } }
      if (freeN) air = clamp((room - fixed - freeSum) / freeN, AIR_MIN, AIR_MAX);
      let x = SIDE;
      for (const it of items) { it.x = x; it.cw = Math.max(CELL_MIN, it.lw + air); x += it.cw; }
      w = x + SIDE;
      S.resize(s, w + M * 2, H + M * 2);
      S.el.style.left = (-M * s) + 'px'; S.el.style.top = (-M * s) + 'px';
      root.style.right = (RIGHT * s) + 'px'; root.style.bottom = (BOTTOM * s) + 'px';
      root.style.width = (w * s) + 'px'; root.style.height = (H * s) + 'px';
      for (const it of items) { const b = it.btn.style; b.left = (it.x * s) + 'px'; b.width = (it.cw * s) + 'px'; b.height = (H * s) + 'px'; }
      dirty = true;
    }

    function draw() {
      dirty = false;
      S.begin();
      const k = S.s * S.dpr, px = Math.max(8, Math.round(GLYPH_BOX * k));
      for (const it of items) drawButton(it, k, px);                       // glyphs (+ glow)
      for (const it of items) { drawLabel(it); drawKey(it); }              // names + key chips
    }
    const lit = (it) => it.hover || it.open;
    function drawButton(it, k, px) {
      const cx = it.x + it.cw * 0.5, cy = GLYPH_CY;
      if (lit(it)) {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, GLOW_R);
        gr.addColorStop(0, P.rgba(BONE, GLOW_A)); gr.addColorStop(1, P.rgba(BONE, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, GLOW_R, 0, Math.PI * 2); g.fill();
      }
      const a = lit(it) ? 1 : GLYPH_A_IDLE, y = cy + PRESS_DY * press(it.pressT);
      // device-pixel aligned box (the masks are rasterised at screen scale → 1:1 pixels)
      const bx = (Math.round((cx - GLYPH_BOX / 2 + M) * k) / k) - M, by = (Math.round((y - GLYPH_BOX / 2 + M) * k) / k) - M;
      const runs = glyphRuns(it.glyph, px);
      g.save();
      g.globalAlpha = GLYPH_SHADOW_A * a;
      for (const r of runs) if (r.role !== 'c') g.drawImage(tinted(r, '#000000'), bx, by + 1, GLYPH_BOX, GLYPH_BOX);
      g.globalAlpha = a;
      for (const r of runs) g.drawImage(tinted(r, roleRGB(r.role)), bx, by, GLYPH_BOX, GLYPH_BOX);
      g.restore();
      if (it.open && !it.key) { g.fillStyle = MARK_COL; g.fillRect(Math.round(cx - MARK_W / 2), MARK_Y, MARK_W, MARK_H); }
    }
    // name: centred in the cell on LABEL_BASE, a 1 px dark shadow (no halo); does not move on press
    function drawLabel(it) {
      const col = lit(it) ? BONE : LABEL_IDLE, x = Math.round(it.x + (it.cw - it.lw) * 0.5);
      P.setFont(g, LABEL_FONT, LABEL_TRACK);
      const a = lit(it) ? 1 : 0.86;
      g.fillStyle = 'rgba(0,0,0,' + (LABEL_SHADOW_A * a).toFixed(3) + ')'; g.fillText(it.text, x, LABEL_BASE + 1);
      g.fillStyle = col; g.fillText(it.text, x, LABEL_BASE);
      g.letterSpacing = '0px';
    }
    // key chip at the glyph's top-right: dark stone circle + amber letter centred on its INK; open → amber chip, dark letter.
    // A key wider than the circle (Esc) gets a capsule of the same height that grows to the right.
    function drawKey(it) {
      if (!it.key) return;
      P.setFont(g, KEY_FONT, 0);
      const m = g.measureText(it.key), inkW = m.actualBoundingBoxRight + m.actualBoundingBoxLeft;
      const hw = Math.max(KEY_R, inkW * 0.5 + KEY_PAD);
      const cx = it.x + it.cw * 0.5 + KEY_DX - KEY_R + hw, cy = GLYPH_CY + KEY_DY + PRESS_DY * press(it.pressT);
      const pill = (x, y, hx, r) => { g.beginPath(); if (hx <= r + 0.01) g.arc(x, y, r, 0, Math.PI * 2); else { g.arc(x - hx + r, y, r, Math.PI * 0.5, Math.PI * 1.5); g.arc(x + hx - r, y, r, -Math.PI * 0.5, Math.PI * 0.5); g.closePath(); } };
      pill(cx, cy + 1, hw + 0.5, KEY_R + 0.5); g.fillStyle = BADGE_SHADOW; g.fill();
      pill(cx, cy, hw, KEY_R); g.fillStyle = it.open ? MARK_COL : KEY_FILL; g.fill();
      pill(cx, cy, hw - 0.5, KEY_R - 0.5); g.strokeStyle = it.open ? BADGE_EDGE : it.hover ? KEY_EDGE_HOVER : KEY_EDGE; g.lineWidth = 1; g.stroke();
      g.fillStyle = it.open ? BADGE_FG : KEY_FG;
      g.fillText(it.key, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) * 0.5, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) * 0.5);
    }

    P.onFonts(() => layout());
    layout();
    const api = {
      root,
      // the open-panel amber follows hud.windows; a change plays the press dip (unless a click's own dip is still running)
      sync() {
        for (const it of items) {
          const o = hud.windows.isOpen(it.id);
          if (o !== it.open) { it.open = o; if (it.pressT < 0) it.pressT = 0; dirty = true; }
        }
      },
      frame(dt) {
        for (const it of items) if (it.pressT >= 0) { it.pressT += dt / PRESS_SPAN; if (it.pressT >= 1) it.pressT = -1; dirty = true; }
        if (dirty) draw();
      },
      resize(ns) { s = ns || s; layout(); draw(); },
    };
    api.sync();
    return api;
  };
})(window);
