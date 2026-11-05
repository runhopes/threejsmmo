/* TDS HUD part — game menu + settings window (slot 'menuwin', window id 'menu'), ported 1:1 from Atherion:
 *   settings_view.gd       two leaves on a 0.5 black dim: PAGE_MENU 400 × (70 + n·54 + 26) "Oyun Menüsü" (card buttons: inlay groove fills on
 *                          hover, two nails, "›" on Ayarlar) · PAGE_SETTINGS 860 × 570 "Ayarlar": head beam (◆ + title + rule), spine (vertical
 *                          index: well + groove + divider cut at the open row + wax stamp with the pending count), content column (group
 *                          headers, row cards with a wax groove while pending, dropdown wells with an iron chevron, sliders with the nail
 *                          grabber, scroll rail), description beam (flows under the rows, never empty), foot beam (‹ Geri · wax stamp · Uygula)
 *   settings_layout.gd     every measure · settings_skin.gd (plate exposure ×0,86 on the whole leaf, popup colours toned by hand)
 *   settings_controller.gd deferred apply: changes stay PENDING until "Uygula"; Geri / Esc / dim click / closing discard them and the slider's
 *                          live preview reverts. Esc is two-stage: popup → closes it, settings page → back to the menu page, menu page → closed.
 *   vellum_frame.gd        "Vellum ve Demir": iron band, vellum leaf + grain + edge vignette, corner straps + nails, card / well / groove /
 *                          rule / plate / stamp
 * What this game has (real data only): hud.settings scale ('auto' | .9 | 1 | 1.15 | 1.3), numbers, showMap, perf, showLog, logAlpha (chat plate
 * at rest, 0 .. .9), timestamps — and the shortcut list hud.opts.keys (read-only rows). Menu: Oyuna Dön, Ayarlar, Sınıf Seçimine Dön (only when
 * hud.opts.onRestart exists). Left out (the game has none): Genel Kalite preset, graphics / camera / system / audio pages, language row, Çıkış.
 * API: {} plus frame(dt) / resize(s). Units: Atherion canvas px × hud.s (clamped so the 860 × 570 leaf always fits the viewport).
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint;
  global.HUDParts = global.HUDParts || {};

  /* ── palette: vellum_frame.gd × settings_skin.TONE (the plate exposure darkens the WHOLE leaf, ink and iron included) ── */
  const TONE = 0.86;
  const shade = (hex, k) => '#' + P.hexRGB(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('');
  const BASE = { VELLUM_HI: '#E9E0CA', VELLUM: '#DDD0B2', VELLUM_LO: '#CFC09C', INK: '#3A2C14', INK_BODY: '#4A3B22', INK_FAINT: '#6B5A3C',
    IRON: '#55483A', IRON_HI: '#8C7C66', IRON_DARK: '#2E2619', GROOVE_ACTIVE: '#7A6A4E', WAX: '#8C2A1E' };
  const V = {};
  for (const k in BASE) V[k] = shade(BASE[k], TONE);
  const A = P.rgba;

  /* ── vellum_frame.gd ── */
  const VF = { CUT: 12, BAND: 8, LEAF_INSET: 9, STRAP: 54, STRAP_W: 13, NAIL_R: 3, NAIL_INSET: 14, VIGN_FADE: 46, HANDLE_W: 18, GRAIN_A: 0.045, VIGN_A: 0.10, STAMP_TILT: -0.0279 };
  /* ── settings_layout.gd ── */
  const L = { W: 860, H: 570, SIDE: 30, HEAD_TOP: 16, HEAD_H: 32, RULE_Y: 58, BODY_TOP: 70, CATEGORY_COUNT: 8, SPINE_W: 168, SP_H: 34, SP_STEP: 40,
    DIV_X: 212, CONT_X: 232, CONT_W: 586, ROW_H: 32, ROW_STEP: 36, HDR_H: 24, HDR_STEP: 30, LABEL_PAD: 16, CTRL_PAD: 14, CTRL_W: 170, CTRL_H: 24, SLD_W: 126,
    RAIL_GAP: 6, RAIL_W: 4, BEAM_H: 90, BEAM_GAP: 14, FOOT_H: 44, FOOT_BOTTOM: 25, FOOT_GAP: 12,
    MENU_W: 400, MENU_SIDE: 30, MENU_HEAD_TOP: 16, MENU_HEAD_H: 30, MENU_RULE_Y: 54, MENU_BODY_TOP: 70, MENU_BTN_H: 46, MENU_BTN_STEP: 54, MENU_BOTTOM: 26 };
  L.FOOT_Y = L.H - L.FOOT_BOTTOM - L.FOOT_H;                       // 501
  L.BODY_BOT = L.FOOT_Y - L.FOOT_GAP;                              // 489
  L.BEAM_Y = L.BODY_BOT - L.BEAM_H;                                // 399 — the beam's lowest place
  L.ROWS_BOT = L.BODY_TOP + (L.SP_STEP * L.CATEGORY_COUNT - 6);   // 384 — spine and content end on the same line
  L.AREA_H = L.ROWS_BOT - L.BODY_TOP;                              // 314
  L.CTRL_X = L.CONT_X + L.CONT_W - L.CTRL_PAD - L.CTRL_W;          // 634
  const APPLY = { x: L.W - L.SIDE - 118, y: L.FOOT_Y + (L.FOOT_H - 28) / 2, w: 118, h: 28 };
  const BACK = { x: L.SIDE, y: L.FOOT_Y, w: 120, h: L.FOOT_H };
  const SLD_GRAB = 11, OPT_TEXT_PAD = 11, OPT_ARROW_ZONE = 24, STAMP_H = 15;
  // popup (settings_view._style_popup: border 1, margins 8 / 4, Alegreya 13; Godot PopupMenu v_separation 4, radio column 16 + h_separation 4)
  const POP = { BORDER: 1, MX: 8, MY: 4, VSEP: 4, ICON: 16, HSEP: 4 };

  /* ── fonts (settings_view.gd: FS_*) — Cinzel 600 · "cinzel_sm" = Cinzel 500 + 1 px tracking · Alegreya 500 / 600 ── */
  const fC = (px) => P.F.cinzel(600, px), fCs = (px) => P.F.cinzel(500, px), fS = (px) => P.F.serif(500, px), fSb = (px) => P.F.serif(600, px);
  const FS = { TITLE: 15, SPINE: 13, LABEL: 13, GROUP: 11, VALUE: 13, BEAM_TITLE: 11, BEAM_BODY: 13, FOOT: 13, STAMP: 10, MENU_BTN: 14 };

  /* ── content: only this game's real settings ── */
  const ONOFF = [['Kapalı', false], ['Açık', true]];
  function schema(hud) {
    const cats = [
      { title: 'Arayüz', rows: [
        { header: 'Boyut', key: 'scale', label: 'Arayüz Ölçeği', kind: 'option',
          options: [['Otomatik', 'auto'], ['%90', 0.9], ['%100', 1], ['%115', 1.15], ['%130', 1.3]],
          desc: 'Arayüzün tamamının boyutu. Otomatik, ekran yüksekliğine göre seçer: 840 px altı %87,5 · 1080p %100 · 1440p %120 · 4K %145.' },
        { header: 'Göstergeler', key: 'numbers', label: 'Hasar Sayıları', kind: 'option', options: ONOFF,
          desc: 'Vurduğunda ve hasar aldığında karakterlerin üstünde beliren sayılar.' },
        { key: 'showMap', label: 'Mini Harita', kind: 'option', options: ONOFF,
          desc: 'Sağ üstteki mini harita ve altındaki konum satırı. Büyük harita (M) her durumda açılır.' },
        { key: 'perf', label: 'Performans Göstergesi', kind: 'option', options: ONOFF,
          desc: 'Mini haritanın altındaki satıra kare hızını (fps) ve çizilen üçgen sayısını ekler.' },
      ] },
      { title: 'Sohbet', rows: [
        { key: 'showLog', label: 'Sohbet Penceresi', kind: 'option', options: ONOFF,
          desc: 'Sol alttaki sohbet penceresi: sistem mesajları ve savaş kaydı.' },
        { key: 'logAlpha', label: 'Zemin Görünürlüğü', kind: 'slider', min: 0, max: 0.9, step: 0.05, fmt: (v) => P.pct(Math.round(v / 0.9 * 100), 0),
          desc: 'Yazmıyorken satırların arkasındaki plakanın görünürlüğü. %0 = plaka yok, yalnız haleli yazı; %100 = yazarkenki tam plaka.' },
        { key: 'timestamps', label: 'Zaman Damgası', kind: 'option', options: ONOFF,
          desc: 'Her satırın başına mesajın geldiği saati (SS:DD) yazar.' },
      ] },
    ];
    const keys = (hud.opts.keys || []).filter((k) => k && k.length >= 2);
    if (keys.length) cats.push({ title: 'Kısayollar', rows: keys.map(([k, d]) => ({ kind: 'keys', keys: String(k), label: String(d), desc: String(d) })) });
    for (const c of cats) {                                       // settings_view._build_content: y walk, header before its row
      let y = 0;
      for (const r of c.rows) { if (r.header) { r.hy = y; y += L.HDR_STEP; } r.y = y; y += L.ROW_STEP; }
      c.h = Math.max(0, y - (L.ROW_STEP - L.ROW_H));
    }
    return cats;
  }

  /* ── small geometry / text helpers ── */
  const oct = (g, x, y, w, h, c) => P.octPath(g, x, y, w, h, c);
  const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  function txt(g, s, font, x, base, col, align, tracking) {           // Godot draw_string: (x, baseline); align -1/undefined left · 0 centre · 1 right
    g.save(); P.setFont(g, font, tracking);
    const w = g.measureText(s).width - (tracking || 0);
    g.fillStyle = col; g.fillText(s, align === 0 ? x - w / 2 : align > 0 ? x - w : x, base);
    g.restore(); return w;
  }
  const mid = (g, font, cy) => { const m = P.metrics(g, font); return cy + (m.a - m.d) * 0.5; };   // Label VERTICAL_ALIGNMENT_CENTER baseline
  const top = (g, font, y) => y + P.metrics(g, font).a;                                             // Label top-aligned baseline
  const textW = (g, s, font, tracking) => P.width(g, s, font, tracking) - (tracking || 0);
  function ellipsize(g, s, font, maxW, tracking) {
    if (textW(g, s, font, tracking) <= maxW) return s;
    let t = s;
    while (t.length > 1 && textW(g, t + '…', font, tracking) > maxW) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '…';
  }
  function wrap(g, s, font, maxW) {
    const words = String(s).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (line && textW(g, t, font) > maxW) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }

  /* ── vellum_frame.gd recipes (drawn with the toned palette) ── */
  let grainSrc = null;
  function grainPattern(g) {                                     // NoiseTexture2D 96² (freq .62, ink 0 → .045): per-pixel noise, lightly smoothed
    if (!grainSrc) {
      const n = 96, raw = new Float32Array(n * n);
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < n * n; i++) raw[i] = rnd();
      const c = document.createElement('canvas'); c.width = c.height = n;
      const cg = c.getContext('2d'), img = cg.createImageData(n, n), [r, gg, b] = P.hexRGB(V.INK);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const at = (dx, dy) => raw[((y + dy + n) % n) * n + ((x + dx + n) % n)];
        const v = at(0, 0) * 0.5 + (at(1, 0) + at(-1, 0) + at(0, 1) + at(0, -1)) * 0.125;
        const k = (y * n + x) * 4;
        img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = Math.round(Math.min(1, Math.max(0, (v - 0.2) / 0.6)) * VF.GRAIN_A * 255);
      }
      cg.putImageData(img, 0, 0);
      grainSrc = c;
    }
    return g.createPattern(grainSrc, 'repeat');
  }
  function nail(g, x, y, r) { P.diamond(g, x, y, r, V.IRON_DARK); P.diamond(g, x, y - 0.6, r * 0.52, V.IRON_HI); }
  function strap(g, cx, cy, dx, dy) {
    const S = VF.STRAP, T = VF.STRAP_W, pts = [[VF.CUT, 0], [S, 0], [S, T], [T, T], [T, S], [0, S], [0, VF.CUT]];
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * dx, cy + y * dy) : g.moveTo(cx + x * dx, cy + y * dy)));
    g.closePath();
    g.fillStyle = P.vgrad(g, Math.min(cy, cy + S * dy), S, dy > 0 ? [[0, V.IRON_HI], [0.09, V.IRON], [0.75, V.IRON], [1, V.IRON_DARK]] : [[0, V.IRON_DARK], [0.25, V.IRON], [0.91, V.IRON], [1, V.IRON_HI]]);
    g.fill(); g.strokeStyle = A(V.IRON_DARK, 0.9); g.lineWidth = 1; g.stroke();
    const t = T - 0.5;                                           // 1 px light on the inner edge of both arms
    g.beginPath(); g.moveTo(cx + t * dx, cy + t * dy); g.lineTo(cx + S * dx, cy + t * dy); g.moveTo(cx + t * dx, cy + t * dy); g.lineTo(cx + t * dx, cy + S * dy);
    g.strokeStyle = A(V.IRON_HI, 0.34); g.stroke();
    nail(g, cx + VF.NAIL_INSET * dx, cy + VF.NAIL_INSET * dy, VF.NAIL_R);
    nail(g, cx + (S - 8) * dx, cy + 6.5 * dy, VF.NAIL_R * 0.8);
    nail(g, cx + 6.5 * dx, cy + (S - 8) * dy, VF.NAIL_R * 0.8);
  }
  function drawLeaf(g, W, H) {
    // 1 · iron band (narrow top light) + dark outer edge
    oct(g, 0, 0, W, H, VF.CUT); g.fillStyle = P.vgrad(g, 0, H, [[0, V.IRON_HI], [0.035, V.IRON], [0.72, V.IRON], [1, V.IRON_DARK]]); g.fill();
    oct(g, 0.5, 0.5, W - 1, H - 1, VF.CUT); g.strokeStyle = A(V.IRON_DARK, 0.85); g.lineWidth = 1; g.stroke();
    // 2 · band's inner shadow + inner chamfer
    const i1 = VF.BAND - 3, i2 = VF.BAND - 1;
    oct(g, i1, i1, W - i1 * 2, H - i1 * 2, VF.CUT - 3); g.fillStyle = A(V.IRON_DARK, 0.62); g.fill();
    oct(g, i2, i2, W - i2 * 2, H - i2 * 2, VF.CUT - 4); g.strokeStyle = A(V.IRON_HI, 0.30); g.stroke();
    // 3 · vellum leaf + grain + edge vignette
    const li = VF.LEAF_INSET, lw = W - li * 2, lh = H - li * 2, c = VF.CUT - 4;
    oct(g, li, li, lw, lh, c); g.fillStyle = P.vgrad(g, li, lh, [[0, V.VELLUM_HI], [0.45, V.VELLUM], [1, V.VELLUM_LO]]); g.fill();
    g.save(); oct(g, li, li, lw, lh, c); g.clip(); g.fillStyle = grainPattern(g); g.fillRect(li, li, lw, lh); g.restore();
    const f = Math.min(VF.VIGN_FADE, Math.min(lw, lh) * 0.5), dark = A(V.INK, VF.VIGN_A), clear = A(V.INK, 0);
    const band = (x, y, w, h, x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, dark); gr.addColorStop(1, clear); g.fillStyle = gr; g.fillRect(x, y, w, h); };
    band(li + c, li, lw - c * 2, f, 0, li, 0, li + f);
    band(li + c, li + lh - f, lw - c * 2, f, 0, li + lh, 0, li + lh - f);
    band(li, li + c, f, lh - c * 2, li, 0, li + f, 0);
    band(li + lw - f, li + c, f, lh - c * 2, li + lw, 0, li + lw - f, 0);
    // 4 · leaf edge line
    oct(g, li, li, lw, lh, c); g.strokeStyle = A(V.INK, 0.30); g.stroke();
    // 5 · corner straps + nails
    strap(g, 0, 0, 1, 1); strap(g, W, 0, -1, 1); strap(g, 0, H, 1, -1); strap(g, W, H, -1, -1);
    // 6 · top-edge handle
    g.fillStyle = A(V.IRON_HI, 0.42);
    for (let k = 0; k < 3; k++) g.fillRect(W * 0.5 - VF.HANDLE_W * 0.5, 2.5 + k * 1.6, VF.HANDLE_W, 1);
  }
  function well(g, x, y, w, h, cut, fillA, topA, botA) {
    oct(g, x, y, w, h, cut); g.fillStyle = A(V.INK, fillA); g.fill();
    g.fillStyle = A(V.INK, topA); g.fillRect(x + cut, y, w - cut * 2, 1);
    g.fillStyle = A(V.VELLUM_HI, botA); g.fillRect(x + cut, y + h - 1, w - cut * 2, 1);
  }
  function groove(g, x, y, w, h, filled, col, diamond) {
    g.fillStyle = A(V.INK, 0.42); g.fillRect(x - 1, y - 1, w + 2, h + 2);
    if (filled) { g.fillStyle = col; g.fillRect(x, y, w, h); if (diamond) P.diamond(g, x + w / 2, y + h / 2, 3.8, A(V.VELLUM_HI, 0.85)); }
    g.fillStyle = A(V.VELLUM_HI, 0.45); g.fillRect(x + w, y, 1, h);
  }
  function card(g, x, y, w, h, cut, hover) {
    oct(g, x, y, w, h, cut); g.fillStyle = A(V.INK, hover ? 0.115 : 0.075); g.fill();
    g.fillStyle = A(V.VELLUM_HI, 0.35); g.fillRect(x + cut, y, w - cut * 2, 1);
    oct(g, x, y, w, h, cut); g.strokeStyle = A(V.INK, 0.34); g.lineWidth = 1; g.stroke();
  }
  function rule(g, x0, x1, y, peak, diamond) {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, A(V.INK, 0)); gr.addColorStop(0.22, A(V.INK, peak)); gr.addColorStop(0.78, A(V.INK, peak)); gr.addColorStop(1, A(V.INK, 0));
    g.fillStyle = gr; g.fillRect(x0, y, x1 - x0, 1);
    if (!diamond) return;
    const cx = (x0 + x1) * 0.5;
    g.beginPath(); g.moveTo(cx, y - 3); g.lineTo(cx + 3, y + 0.5); g.lineTo(cx, y + 4); g.lineTo(cx - 3, y + 0.5); g.closePath();
    g.fillStyle = A(V.INK, peak + 0.18); g.fill();
    g.fillStyle = A(V.VELLUM_HI, 0.5); g.fillRect(cx - 9, y, 18, 1);
  }
  function stamp(g, x, y, w, h, col) {
    g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(VF.STAMP_TILT);
    oct(g, -w / 2, -h / 2, w, h, 3); g.fillStyle = A(col, 0.12); g.fill(); g.strokeStyle = A(col, 0.78); g.lineWidth = 1; g.stroke();
    g.restore();
  }
  function stampCount(g, x, y, w, n) {                           // mühür + rakam (Alegreya 600 · 10, wax)
    stamp(g, x, y, w, STAMP_H, V.WAX);
    txt(g, String(n), fSb(FS.STAMP), x + w / 2, y + STAMP_H * 0.5 + 4, V.WAX, 0);
  }
  function chevron(g, cx, cy) {
    g.beginPath(); g.moveTo(cx - 4, cy - 2); g.lineTo(cx + 4, cy - 2); g.lineTo(cx, cy + 2.8); g.closePath(); g.fillStyle = A(V.IRON, 0.85); g.fill();
  }
  function nailGrabber(g, x, y) {                                // settings_view._make_nail_tex(11): L1 diamond, top quarter lit
    const c = x + SLD_GRAB / 2, m = y + SLD_GRAB / 2, r = SLD_GRAB / 2;
    P.diamond(g, c, m, r, V.IRON_DARK);
    g.save(); g.beginPath(); g.rect(x - 1, y - 1, SLD_GRAB + 2, 5); g.clip(); P.diamond(g, c, m, r, V.IRON_HI); g.restore();
  }

  global.HUDParts.menuwin = function (hud) {
    const MENU = 0, SETTINGS = 1;
    const win = document.createElement('div'); win.className = 'mw-win';
    const dim = document.createElement('div'); dim.className = 'mw-dim';
    const leaf = document.createElement('div'); leaf.className = 'mw-leaf';
    const catcher = document.createElement('div'); catcher.className = 'mw-catch'; catcher.hidden = true;
    const pop = document.createElement('div'); pop.className = 'mw-pop'; pop.hidden = true;
    win.append(dim, leaf, catcher, pop);
    hud.frame.appendChild(win);
    const surf = P.surface(leaf, 'mw-cv', L.MENU_W, 312), g = surf.g;
    const psurf = P.surface(pop, 'mw-pcv', L.CTRL_W, 40), pg = psurf.g;

    let page = MENU, sc = 1, left = 0, topY = 0, dirty = true, popDirty = false;
    let cats = [], cat = 0, scroll = 0, lastRow = {}, pending = {};
    let buttons = [], hover = null, focusKey = null, drag = null, popup = null;
    const mark = () => { dirty = true; };
    P.onFonts(() => { dirty = true; popDirty = true; });

    /* ── state helpers ── */
    const hasPending = () => Object.keys(pending).length > 0;
    const value = (key) => (drag && drag.row.key === key ? drag.v : key in pending ? pending[key] : hud.settings[key]);
    const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);
    const catPending = (i) => cats[i].rows.filter((r) => r.key && r.key in pending).length;
    function optionIndex(r) { const v = value(r.key); return r.options.findIndex((o) => same(o[1], v) || (typeof v === 'boolean' && o[1] === v)); }
    function optionText(r) {
      const i = optionIndex(r);
      if (i >= 0) return r.options[i][0];
      const v = value(r.key);
      return typeof v === 'number' ? P.pct(v * 100, 0) : String(v);
    }
    function setPending(key, v) {                                 // settings_controller._on_setting_changed (+ a value equal to the saved one is not pending)
      if (same(v, hud.settings[key])) delete pending[key]; else pending[key] = v;
      if (key === 'logAlpha') previewLog();
      dirty = true;
    }
    function previewLog() { hud.log.applySettings(Object.assign({}, hud.settings, pending, drag ? { [drag.row.key]: drag.v } : {})); }
    function discard() {                                          // _discard_pending: drop the buffer, revert the live preview
      if (!hasPending()) return;
      pending = {};
      hud.log.applySettings(hud.settings);
      dirty = true;
    }
    function apply() {                                            // _on_apply_requested: write, persist, run each setting's own apply path
      if (!hasPending()) return;
      const keys = Object.keys(pending), s = hud.settings;
      for (const k of keys) s[k] = pending[k];
      pending = {};
      hud.saveSettings();
      if (keys.includes('showMap') || keys.includes('showLog')) hud.applyVisibility();
      if (keys.includes('perf')) hud.applyPerf();
      hud.log.applySettings(s);
      if (keys.includes('scale')) hud.applyScale();                // calls resize() → layout
      dirty = true;
    }

    /* ── pages ── */
    const menuH = () => L.MENU_BODY_TOP + buttons.length * L.MENU_BTN_STEP + L.MENU_BOTTOM;   // 4 buttons → 312 (settings_layout MENU_H)
    const menuBtnRect = (i) => ({ x: L.MENU_SIDE, y: L.MENU_BODY_TOP + i * L.MENU_BTN_STEP, w: L.MENU_W - L.MENU_SIDE * 2, h: L.MENU_BTN_H });
    function buildButtons() {
      buttons = [{ label: 'Oyuna Dön', act: () => hud.windows.close('menu') }, { label: 'Ayarlar', chev: true, act: () => showPage(SETTINGS) }];
      if (hud.opts.onRestart) buttons.push({ label: 'Sınıf Seçimine Dön', act: () => { hud.windows.close('menu'); hud.opts.onRestart(); } });
    }
    function showPage(p) {
      closePopup();
      if (p === SETTINGS) { cats = schema(hud); cat = Math.min(cat, cats.length - 1); scroll = 0; }
      page = p; hover = null; focusKey = null; drag = null;
      layout();
    }
    function showCategory(i) { cat = Math.max(0, Math.min(cats.length - 1, i)); scroll = 0; focusKey = null; dirty = true; }
    function layout() {
      sc = Math.max(0.5, Math.min(hud.s, (innerHeight - 16) / L.H, (innerWidth - 16) / L.W));
      const W = page === MENU ? L.MENU_W : L.W, H = page === MENU ? menuH() : L.H;
      surf.resize(sc, W, H);
      left = Math.round((innerWidth - W * sc) / 2); topY = Math.round((innerHeight - H * sc) / 2);
      leaf.style.left = left + 'px'; leaf.style.top = topY + 'px';
      if (popup) placePopup();
      dirty = true;
    }

    /* ── settings page geometry ── */
    const C = () => cats[cat];
    const overflow = () => C().h > L.AREA_H;
    const maxScroll = () => Math.max(0, C().h - L.AREA_H);
    const beamY = () => Math.min(L.BODY_TOP + Math.max(C().h, 0) + L.BEAM_GAP, L.BEAM_Y);
    const spineY = (i) => L.BODY_TOP + i * L.SP_STEP;
    const rowTop = (r) => L.BODY_TOP + r.y - scroll;
    const optRect = (r) => ({ x: L.CTRL_X, y: rowTop(r) + (L.ROW_H - L.CTRL_H) / 2, w: L.CTRL_W, h: L.CTRL_H });
    const sldRect = (r) => ({ x: L.CTRL_X, y: rowTop(r) + (L.ROW_H - 14) / 2, w: L.SLD_W, h: 14 });
    function beamRow() {                                          // never empty: hovered row, else the last touched one, else the first
      const rows = C().rows;
      const i = hover && hover.t === 'row' ? hover.i : (lastRow[cat] !== undefined ? lastRow[cat] : 0);
      return rows[Math.max(0, Math.min(rows.length - 1, i))];
    }

    /* ── drawing ── */
    function drawMenu() {
      const W = L.MENU_W, H = menuH();
      drawLeaf(g, W, H);
      rule(g, L.MENU_SIDE, W - L.MENU_SIDE, L.MENU_RULE_Y, 0.30, true);
      txt(g, 'Oyun Menüsü', fC(FS.TITLE), W / 2, mid(g, fC(FS.TITLE), L.MENU_HEAD_TOP + L.MENU_HEAD_H / 2), V.INK, 0);
      buttons.forEach((b, i) => {
        const r = menuBtnRect(i), hov = hover && hover.t === 'btn' && hover.i === i;
        card(g, r.x, r.y, r.w, r.h, 8, hov);
        groove(g, r.x + 3, r.y + 8, 3, r.h - 16, hov, V.GROOVE_ACTIVE, hov);
        nail(g, r.x + r.w - 10, r.y + 9, 2.4); nail(g, r.x + r.w - 10, r.y + r.h - 9, 2.4);
        txt(g, b.label, fC(FS.MENU_BTN), r.x + 20, r.y + r.h * 0.5 + 5, V.INK);
        if (b.chev) txt(g, '›', fS(17), r.x + r.w - 32, r.y + r.h * 0.5 + 6, A(V.INK_FAINT, 0.9));
      });
    }
    function drawHead() {
      const cy = L.HEAD_TOP + L.HEAD_H * 0.5;
      P.diamond(g, L.SIDE + 5, cy, 3.6, A(V.INK, 0.5));
      txt(g, 'Ayarlar', fC(FS.TITLE), L.SIDE + 18, mid(g, fC(FS.TITLE), cy), V.INK);
      rule(g, L.SIDE, L.W - L.SIDE, L.RULE_Y, 0.30, true);
    }
    function drawSpine() {
      cats.forEach((c, i) => {
        const y = spineY(i), sel = i === cat, hov = !sel && hover && hover.t === 'spine' && hover.i === i;
        if (sel) well(g, L.SIDE, y, L.SPINE_W, L.SP_H, 6, 0.055, 0.22, 0.36);
        else if (hov) well(g, L.SIDE, y, L.SPINE_W, L.SP_H, 6, 0.035, 0.16, 0.26);
        groove(g, L.SIDE + 3, y + 7, 3, L.SP_H - 14, sel, V.GROOVE_ACTIVE, sel);
        const f = sel ? fC(FS.SPINE) : fCs(FS.SPINE), tr = sel ? 0 : 1;
        txt(g, c.title, f, L.SIDE + 20, mid(g, f, y + L.SP_H / 2), sel ? V.INK : A(V.INK_FAINT, 0.82), -1, tr);
        const n = catPending(i);
        if (n > 0) stampCount(g, L.SIDE + L.SPINE_W - 22 - 8, y + (L.SP_H - STAMP_H) / 2, 22, n);
      });
      // divider: faded ends, CUT at the open row (the page "opens" there)
      const y0 = L.BODY_TOP, y1 = L.ROWS_BOT, gap0 = spineY(cat) + 3, gap1 = spineY(cat) + L.SP_H - 3;
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, A(V.INK, 0)); gr.addColorStop(0.12, A(V.INK, 0.24)); gr.addColorStop(0.88, A(V.INK, 0.24)); gr.addColorStop(1, A(V.INK, 0));
      g.fillStyle = gr; g.fillRect(L.DIV_X, y0, 1, gap0 - y0); g.fillRect(L.DIV_X, gap1 + 1, 1, y1 - gap1 - 1);
    }
    function drawRow(r, i) {
      const x = L.CONT_X, y = rowTop(r), hov = hover && hover.t === 'row' && hover.i === i;
      card(g, x, y, L.CONT_W, L.ROW_H, 8, hov);
      groove(g, x + 3, y + 6, 3, L.ROW_H - 12, !!r.key && r.key in pending, V.WAX, false);
      const lf = fC(FS.LABEL), maxW = L.CTRL_X - L.CONT_X - L.LABEL_PAD - 8;
      txt(g, ellipsize(g, r.label, lf, maxW), lf, x + L.LABEL_PAD, mid(g, lf, y + L.ROW_H / 2), V.INK);
      if (r.kind === 'option' || r.kind === 'keys') {
        const o = optRect(r);
        well(g, o.x, o.y, o.w, o.h, 4, 0.085, 0.26, 0.40);
        if (r.kind === 'option') {
          const vf = fS(FS.VALUE);
          g.save(); g.beginPath(); g.rect(o.x, o.y, o.w - OPT_ARROW_ZONE + 4, o.h); g.clip();
          txt(g, optionText(r), vf, o.x + OPT_TEXT_PAD, mid(g, vf, o.y + o.h / 2), V.INK);
          g.restore();
          chevron(g, o.x + o.w - 15, o.y + o.h * 0.5 + 1);
          if (focusKey === r.key) { oct(g, o.x, o.y, o.w, o.h, 4); g.strokeStyle = A(V.INK, 0.70); g.lineWidth = 1; g.stroke(); }
        } else {
          const kf = fC(12);
          txt(g, ellipsize(g, r.keys, kf, o.w - 16, 1), kf, o.x + o.w / 2, mid(g, kf, o.y + o.h / 2), V.INK, 0, 1);
        }
      } else if (r.kind === 'slider') {
        const s = sldRect(r), v = value(r.key), ratio = Math.max(0, Math.min(1, (v - r.min) / (r.max - r.min)));
        const ty = s.y + (s.h - 10) / 2, area = s.w - SLD_GRAB, gx = s.x + Math.round(ratio * area);
        g.fillStyle = A(V.INK, 0.13); g.fillRect(s.x, ty, s.w, 10);                   // track (StyleBoxFlat: fill + 1 px top border)
        g.fillStyle = A(V.INK, 0.34); g.fillRect(s.x, ty, s.w, 1);
        g.fillStyle = V.GROOVE_ACTIVE; g.fillRect(s.x, ty, Math.round(area * ratio + SLD_GRAB / 2), 10);   // grabber_area up to the grabber centre
        nailGrabber(g, gx, s.y + Math.floor(s.h / 2) - Math.floor(SLD_GRAB / 2));
        if (focusKey === r.key) { oct(g, s.x - 2, s.y - 2, s.w + 4, s.h + 4, 3); g.strokeStyle = A(V.INK, 0.45); g.lineWidth = 1; g.stroke(); }
        const vf = fSb(FS.VALUE);
        txt(g, r.fmt(v), vf, L.CTRL_X + L.CTRL_W, mid(g, vf, y + L.ROW_H / 2), V.INK_BODY, 1);
      }
    }
    function drawContent() {
      const c = C();
      g.save(); g.beginPath(); g.rect(L.CONT_X - 1, L.BODY_TOP - 1, L.CONT_W + L.RAIL_GAP + L.RAIL_W + 2, L.AREA_H + 2); g.clip();
      c.rows.forEach((r, i) => {
        if (L.BODY_TOP + r.y - scroll > L.ROWS_BOT || L.BODY_TOP + r.y - scroll + L.ROW_H < L.BODY_TOP - L.HDR_STEP) return;
        if (r.header) {
          const hy = L.BODY_TOP + r.hy - scroll, hf = fCs(FS.GROUP);
          const w = txt(g, r.header, hf, L.CONT_X + 2, mid(g, hf, hy + L.HDR_H / 2), A(V.INK_FAINT, 0.95), -1, 1);
          rule(g, L.CONT_X + 2 + w + 12, L.CONT_X + L.CONT_W, hy + L.HDR_H * 0.5, 0.20, false);
        }
        drawRow(r, i);
      });
      g.restore();
      if (overflow()) {                                           // scroll rail = inlay groove (VScrollBar: track INK .30, grabber IRON)
        const x = L.CONT_X + L.CONT_W + L.RAIL_GAP, h = L.AREA_H, gh = Math.max(16, Math.round(h * h / c.h)), gy = L.BODY_TOP + Math.round((h - gh) * (scroll / maxScroll()));
        g.fillStyle = A(V.INK, 0.30); g.fillRect(x, L.BODY_TOP, L.RAIL_W, h);
        g.fillStyle = V.IRON; g.fillRect(x, gy, L.RAIL_W, gh);
      }
    }
    function drawBeam() {
      const y = beamY(), r = beamRow(), x = L.CONT_X;
      well(g, x, y, L.CONT_W, L.BEAM_H, 6, 0.085, 0.26, 0.40);
      if (!r) return;
      const tf = fCs(FS.BEAM_TITLE), bf = fS(FS.BEAM_BODY);
      const title = r.kind === 'keys' ? r.keys : r.label;
      txt(g, ellipsize(g, title, tf, L.CONT_W - 28, 1), tf, x + 14, top(g, tf, y + 8), A(V.INK_FAINT, 0.95), -1, 1);
      const m = P.metrics(g, bf), lh = m.a + m.d + 3;             // Godot Label line_spacing 3
      wrap(g, r.desc, bf, L.CONT_W - 28).slice(0, 3).forEach((line, k) => txt(g, line, bf, x + 14, y + 26 + m.a + k * lh, V.INK_BODY));
    }
    function drawFoot() {
      rule(g, L.SIDE, L.W - L.SIDE, L.FOOT_Y, 0.22, false);
      const n = Object.keys(pending).length;
      if (n > 0) stampCount(g, L.W - L.SIDE - 118 - 12 - 24, L.FOOT_Y + (L.FOOT_H - STAMP_H) * 0.5, 24, n);
      const bf = fCs(FS.FOOT);
      txt(g, '‹  Geri', bf, BACK.x, mid(g, bf, BACK.y + BACK.h / 2), A(V.INK_FAINT, 0.95), -1, 1);
      const on = n > 0, a = on ? 1 : 0.60, hov = on && hover && hover.t === 'apply', r = APPLY;
      oct(g, r.x, r.y, r.w, r.h, 4); g.fillStyle = A(V.INK, 0.08 + (hov ? 0.08 : 0)); g.fill();
      g.strokeStyle = A(V.INK, 0.42); g.lineWidth = 1; g.stroke();
      g.fillStyle = A(V.VELLUM_HI, 0.45); g.fillRect(r.x + 4, r.y + r.h - 1, r.w - 8, 1);
      if (on) { nail(g, r.x + 9, r.y + r.h / 2, 2.4); nail(g, r.x + r.w - 9, r.y + r.h / 2, 2.4); }
      txt(g, 'Uygula', fC(FS.FOOT), r.x + r.w / 2, r.y + r.h * 0.5 + 5, A(V.INK_BODY, a), 0);
    }
    function draw() {
      dirty = false;
      surf.begin();
      if (page === MENU) { drawMenu(); return; }
      drawLeaf(g, L.W, L.H);
      drawHead(); drawSpine(); drawContent(); drawBeam(); drawFoot();
    }

    /* ── dropdown popup (Godot PopupMenu: an embedded sub-window, outside the leaf's exposure → colours toned by hand) ── */
    function popupMetrics() { const m = P.metrics(pg, fS(FS.VALUE)); return { ih: Math.round(m.a + m.d + POP.VSEP), m }; }
    function openPopup(r) {
      popup = { row: r, hover: -1 };
      focusKey = r.key;
      catcher.hidden = false; pop.hidden = false;
      placePopup(); popDirty = true; dirty = true;
    }
    function closePopup() {
      if (!popup) return;
      popup = null; catcher.hidden = true; pop.hidden = true; dirty = true;
    }
    function placePopup() {
      const r = popup.row, { ih } = popupMetrics(), h = POP.BORDER * 2 + POP.MY * 2 + ih * r.options.length, o = optRect(r);
      psurf.resize(sc, L.CTRL_W, h);
      let y = topY + (o.y + o.h) * sc;
      if (y + h * sc > innerHeight - 4) y = topY + o.y * sc - h * sc;   // no room below: open upwards
      pop.style.left = Math.round(left + o.x * sc) + 'px'; pop.style.top = Math.round(y) + 'px';
      popup.h = h; popup.ih = ih;
    }
    function drawPopup() {
      popDirty = false;
      if (!popup) return;
      const r = popup.row, { ih, m } = popupMetrics(), w = L.CTRL_W, h = popup.h, sel = optionIndex(r), vf = fS(FS.VALUE);
      const g2 = psurf.begin();
      g2.fillStyle = V.VELLUM_HI; g2.fillRect(0, 0, w, h);                       // popup_bg = toned(VELLUM_HI), opaque
      P.frame1(g2, 0, 0, w, h, A(V.INK, 0.55));                                  // border INK .55
      r.options.forEach((o, i) => {
        const y = POP.BORDER + POP.MY + i * ih;
        if (i === popup.hover) { g2.fillStyle = A(V.INK, 0.12); g2.fillRect(POP.BORDER + POP.MX - POP.HSEP, y, w - (POP.BORDER + POP.MX - POP.HSEP) * 2, ih); }
        const tx = POP.BORDER + POP.MX + POP.ICON + POP.HSEP;
        if (i === sel) P.diamond(g2, POP.BORDER + POP.MX + POP.ICON / 2, y + ih / 2, 3.4, V.INK);   // radio mark (ink, not the default white theme icon)
        txt(g2, o[0], vf, tx, y + (ih - (m.a + m.d)) / 2 + m.a, V.INK);
      });
    }
    function popupIndex(e) {
      const rc = pop.getBoundingClientRect(), y = (e.clientY - rc.top) / sc;
      const i = Math.floor((y - POP.BORDER - POP.MY) / popup.ih);
      return i >= 0 && i < popup.row.options.length ? i : -1;
    }
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('pointermove', (e) => { if (!popup) return; const i = popupIndex(e); if (i !== popup.hover) { popup.hover = i; popDirty = true; } });
    pop.addEventListener('pointerleave', () => { if (popup && popup.hover !== -1) { popup.hover = -1; popDirty = true; } });
    pop.addEventListener('pointerdown', (e) => {
      // no stopPropagation here or below: pointerdown bubbles to the window element, which hud.windows restacks
      if (!popup || e.button !== 0) return;
      const i = popupIndex(e), r = popup.row;
      if (i >= 0) { lastRow[cat] = C().rows.indexOf(r); setPending(r.key, r.options[i][1]); }
      closePopup();
    });
    catcher.addEventListener('mousedown', (e) => e.preventDefault());
    catcher.addEventListener('pointerdown', () => closePopup());   // an outside click only closes the list

    /* ── input on the leaf ── */
    function local(e) { const rc = surf.el.getBoundingClientRect(); return { x: (e.clientX - rc.left) / sc, y: (e.clientY - rc.top) / sc }; }
    function hit(x, y) {
      if (page === MENU) { for (let i = 0; i < buttons.length; i++) if (inside(menuBtnRect(i), x, y)) return { t: 'btn', i }; return null; }
      for (let i = 0; i < cats.length; i++) if (inside({ x: L.SIDE, y: spineY(i), w: L.SPINE_W, h: L.SP_H }, x, y)) return { t: 'spine', i };
      if (inside(BACK, x, y)) return { t: 'back' };
      if (inside(APPLY, x, y)) return { t: 'apply' };
      if (x >= L.CONT_X && x < L.CONT_X + L.CONT_W && y >= L.BODY_TOP && y < L.ROWS_BOT) {
        const rows = C().rows;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], ry = rowTop(r);
          if (y < ry || y >= ry + L.ROW_H) continue;
          let ctrl = null;
          if (r.kind === 'option' && inside(optRect(r), x, y)) ctrl = 'option';
          else if (r.kind === 'slider' && inside({ x: L.CTRL_X - 4, y: ry, w: L.SLD_W + 8, h: L.ROW_H }, x, y)) ctrl = 'slider';
          return { t: 'row', i, ctrl };
        }
      }
      return null;
    }
    const sameHit = (a, b) => (!a && !b) || (a && b && a.t === b.t && a.i === b.i && a.ctrl === b.ctrl);
    function setHover(h) {
      if (sameHit(h, hover)) return;
      hover = h; dirty = true;
      if (h && h.t === 'row') lastRow[cat] = h.i;                 // _focus_row: the beam keeps the last touched row
      const click = h && (h.t === 'btn' || (h.t === 'spine' && h.i !== cat) || h.t === 'back' || (h.t === 'apply' && hasPending()) || h.ctrl);
      surf.el.style.cursor = click ? 'pointer' : '';
    }
    function sliderSet(r, e) {
      const s = sldRect(r), p = local(e), area = s.w - SLD_GRAB;
      let v = r.min + Math.max(0, Math.min(1, (p.x - s.x - SLD_GRAB / 2) / area)) * (r.max - r.min);
      v = Math.round(v / r.step) * r.step; v = Math.max(r.min, Math.min(r.max, +v.toFixed(4)));
      if (!same(v, drag.v)) { drag.v = v; drag.moved = true; previewLog(); dirty = true; }
    }
    surf.el.addEventListener('mousedown', (e) => e.preventDefault());
    surf.el.addEventListener('pointermove', (e) => {
      if (drag) { sliderSet(drag.row, e); return; }
      const p = local(e); setHover(hit(p.x, p.y));
    });
    surf.el.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
    surf.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = local(e), h = hit(p.x, p.y);
      if (!h || h.ctrl !== 'option') focusKey = null;
      if (!h) { dirty = true; return; }
      if (h.t === 'btn') { buttons[h.i].act(); return; }
      if (h.t === 'spine') { showCategory(h.i); return; }
      if (h.t === 'back') { discard(); showPage(MENU); return; }
      if (h.t === 'apply') { apply(); return; }
      if (h.t === 'row') {
        const r = C().rows[h.i];
        lastRow[cat] = h.i;
        if (h.ctrl === 'option') { openPopup(r); return; }
        if (h.ctrl === 'slider') {
          focusKey = r.key;
          drag = { row: r, v: value(r.key), moved: false };          // the live value lives in drag.v (value() reads it) until the drag ends
          surf.el.setPointerCapture(e.pointerId);
          sliderSet(r, e);
        }
        dirty = true;
      }
    });
    function endDrag() {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.moved) setPending(d.row.key, d.v); else previewLog();  // drag_ended(false): no commit
      dirty = true;
    }
    surf.el.addEventListener('pointerup', endDrag);
    surf.el.addEventListener('pointercancel', endDrag);
    surf.el.addEventListener('lostpointercapture', endDrag);
    surf.el.addEventListener('wheel', (e) => {                    // ScrollContainer: the wheel scrolls the content column (sliders ignore it)
      e.preventDefault(); e.stopPropagation();
      if (page !== SETTINGS || !overflow() || popup) return;
      const p = local(e);
      if (p.x < L.CONT_X || p.x > L.CONT_X + L.CONT_W + L.RAIL_GAP + L.RAIL_W || p.y < L.BODY_TOP || p.y > L.ROWS_BOT) return;
      const next = Math.max(0, Math.min(maxScroll(), scroll + Math.sign(e.deltaY) * L.ROW_STEP));
      if (next !== scroll) { scroll = next; const q = local(e); hover = null; setHover(hit(q.x, q.y)); dirty = true; }
    }, { passive: false });
    dim.addEventListener('mousedown', (e) => e.preventDefault());
    dim.addEventListener('pointerdown', (e) => { if (e.button === 0) hud.windows.close('menu'); });   // dim click: close the modal
    win.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });

    // Esc, two-stage (settings_controller._handle_cancel): runs before the HUD's own Esc (capture), only while this window is on top
    function onTop() {
      const z = +win.style.zIndex || 0;
      for (const id in hud.windows.reg) if (id !== 'menu' && hud.windows.isOpen(id) && (+hud.windows.reg[id].el.style.zIndex || 0) > z) return false;
      return true;
    }
    global.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || hud.root.hidden || !hud.windows.isOpen('menu') || !onTop()) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;   // a focused text field handles its own Esc
      if (popup) closePopup();
      else if (page === SETTINGS) { discard(); showPage(MENU); }
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);

    hud.windows.register('menu', win, {
      onOpen() { buildButtons(); pending = {}; lastRow = {}; cat = 0; showPage(MENU); },
      onClose() { closePopup(); drag = null; discard(); hover = null; },
    });

    return {
      frame() {
        if (win.hidden) return;
        if (dirty) draw();
        if (popDirty) drawPopup();
      },
      resize() { if (!win.hidden) layout(); else dirty = true; },
    };
  };
})(window);
