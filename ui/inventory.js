/* TDS - inventory window (HUD part slot `inventory`, window id 'inv', key I), ported 1:1 from Atherion's "Ufuk · Pencere":
 *   inventory_drawer_frame.gd  geometry, surface, wells, slot glyphs, tabs, rail, close glyph (the single source of the measures)
 *   inventory_view.gd          draw order (_draw_bg / _draw_fg / _draw_shelf / _draw_rail / close), hit test, hover states, pages, shelf scroll
 *   panel_base.gd              0.3 s cubic slide in from / out to the right screen edge, drag by the header, dragged position kept
 *   ufuk_style.gd              text halo, frame1, double edge, soft shadow (HUDPaint)
 * The game has no item system yet, so the window draws its full structure only: the 8 equipment wells with their slot glyphs,
 * the 12 extra wells (EK YUVALAR page), the 5-column bag shelf (6 visible rows) and its rail bed, all with Atherion's empty-slot
 * treatment. No items, no counts (bag "used / capacity", extra "n/12"), no purse: nothing here is invented.
 * Units are Atherion canvas px (412x768 window); every surface is scaled by hud.s.
 */
(function () {
  'use strict';
  window.HUDParts = window.HUDParts || {};
  const P = window.HUDPaint, C = P.C, F = P.F;

  /* ---------- geometry: inventory_drawer_frame.gd (window-local, (0,0) = top-left) ---------- */
  const W = 412, H = 768;
  const WIN_MARGIN = 24, DEFAULT_TOP = 232, CLOSED_X_PAD = 20, SLIDE = 0.3;
  const HEAD_H = 52, CL = 20, CR = 392, CLOSE = 22, NAME_BASE = 24, TAB_BASE = 45, NAME_CLOSE_GAP = 12;
  const TAB_UFUK_TRACK = 1, TAB_UFUK_GAP = 22, TAB_COUNT_UFUK_GAP = 6, TAB_LINE_DY = 6;
  const RULES = [52, 252, 730], RULE_A = 0.12;
  const COLUMNS = 5, CELL = 64, CELL_GAP = 10, PITCH = CELL + CELL_GAP;
  const SLOT_RECTS = {                                       // dictionary order = draw / hit order
    helmet: [181, 66, 50, 50], armor: [181, 122, 50, 66], pants: [150, 194, 50, 50], boots: [212, 194, 50, 50],
    weapon: [77, 122, 50, 106], earring: [135, 122, 40, 40], bracelet: [237, 122, 40, 40], shield: [285, 122, 50, 66],
  };
  const EXTRA_COUNT = 12, EXTRA_COLS = 4, EXTRA_CELL = 50, EXTRA_PITCH = 58, EXTRA_X = 91, EXTRA_Y = 76;
  const BAG_BASE = 276, SHELF_TOP = 286, SHELF_ROWS = 6, SHELF_W = COLUMNS * PITCH - CELL_GAP, SHELF_H = SHELF_ROWS * PITCH - CELL_GAP;
  const RAIL_W = 2, RAIL_X = CR - RAIL_W, RAIL_MIN_THUMB = 18;
  // surface (document `inventory()` window branch)
  const FACE = 'rgba(12,10,8,0.84)', EDGE_INNER_A = 0.30, SHADOW_R = 14, SHADOW_A = 0.55, TOP_LIGHT_H = 60, TOP_LIGHT_A = 0.05;
  // well (document `well()`)
  const WELL_BED_A = 0.34, WELL_TOP_A = 0.45, WELL_RIM_A = 0.13, WELL_HOVER_RIM_A = 0.62, WELL_HOVER_WASH_A = 0.06;
  const Well = { EMPTY: 0, HOVER: 2 };
  const Tab = { OFF: 0, HOVER: 1, ON: 2 };
  const Zone = { NONE: 0, TAB: 1, EQUIP: 2, EXTRA: 3, BAG: 4, SHELF: 5, PANEL: 6, HEAD: 7, CLOSE: 8 };
  const Page = { EQUIP: 0, EXTRA: 1 };
  // fonts (inventory_view._make_fonts): name Cinzel 600 16 tracking 2 · tab / bag Alegreya Sans 500 13 tracking 1 · × Alegreya Sans 500 20
  const NAME_FONT = F.cinzel(600, 16), NAME_TRACK = 2, TAB_FONT = F.sans(500, 13), CLOSE_FONT = F.sans(500, 20);
  // texts (Atherion data/i18n/ui_strings.csv: INV_TAB_EQUIP, INV_TAB_EXTRA, INV_BAG, SHOP_SLOT_*), upper-cased with the Turkish rule (i -> İ)
  const up = (s) => s.toLocaleUpperCase('tr-TR');
  const TAB_TEXT = [up('Kuşam'), up('Ek Yuvalar')], BAG_TEXT = up('Heybe');
  const SLOT_NAME = { weapon: 'Silah', helmet: 'Kask', armor: 'Zırh', shield: 'Kalkan', earring: 'Küpe', bracelet: 'Kolluk', pants: 'Pantolon', boots: 'Bot' };

  const has = (r, x, y) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
  const closeRect = () => [CR - CLOSE + 2, NAME_BASE - 16, CLOSE, CLOSE];
  const nameMaxWidth = () => closeRect()[0] - NAME_CLOSE_GAP - CL;
  const extraRect = (i) => [EXTRA_X + (i % EXTRA_COLS) * EXTRA_PITCH, EXTRA_Y + Math.floor(i / EXTRA_COLS) * EXTRA_PITCH, EXTRA_CELL, EXTRA_CELL];
  const cellRect = (index, scrollRow) => [CL + (index % COLUMNS) * PITCH, SHELF_TOP + (Math.floor(index / COLUMNS) - scrollRow) * PITCH, CELL, CELL];

  /* ---------- drawing: inventory_drawer_frame.gd ---------- */
  // window: soft shadow + dark translucent face + fading bone top light + thin double edge + three rules
  function drawPanel(g) {
    P.softShadow(g, 0, 3, W, H, SHADOW_R, SHADOW_A);
    g.fillStyle = FACE; g.fillRect(0, 0, W, H);
    g.fillStyle = P.vgrad(g, 0, TOP_LIGHT_H, [[0, P.rgba(C.U_BONE, TOP_LIGHT_A)], [1, P.rgba(C.U_BONE, 0)]]); g.fillRect(0, 0, W, TOP_LIGHT_H);
    P.doubleEdge(g, 0, 0, W, H, EDGE_INNER_A);
    g.fillStyle = P.rgba(C.U_BONE, RULE_A);
    for (const y of RULES) g.fillRect(CL, y, CR - CL, 1);
  }
  // well (the EXP bar's trough): dark bed + 1 px top shadow + 1 px bone rim; hover = brighter rim + faint wash
  function drawWell(g, r, state) {
    const [x, y, w, h] = r;
    g.fillStyle = 'rgba(0,0,0,' + WELL_BED_A + ')'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,' + WELL_TOP_A + ')'; g.fillRect(x, y, w, 1);
    if (state === Well.HOVER) {
      g.fillStyle = P.rgba(C.U_BONE, WELL_HOVER_WASH_A); g.fillRect(x + 1, y + 1, w - 2, h - 2);
      P.frame1(g, x, y, w, h, P.rgba(C.U_BONE, WELL_HOVER_RIM_A));
    } else P.frame1(g, x, y, w, h, P.rgba(C.U_BONE, WELL_RIM_A));
  }
  // slot glyph: the mark pressed into the bottom of an empty well (dark print 1 px lower, then a faint bone face). Unit box 40 (weapon 88 tall).
  const cuffHalf = (y) => 7 + (10 - 7) * ((y + 15) / 30);
  function glyphPoly(g, pts, cx, cy, s, col) {
    g.beginPath(); g.moveTo(cx + pts[0][0] * s, cy + pts[0][1] * s);
    for (let i = 1; i < pts.length; i++) g.lineTo(cx + pts[i][0] * s, cy + pts[i][1] * s);
    g.closePath(); g.fillStyle = col; g.fill();
  }
  const HELMET = (() => {
    const pts = [];
    for (let k = 0; k < 13; k++) { const an = Math.PI + Math.PI * k / 12; pts.push([Math.cos(an) * 13, 3 + Math.sin(an) * 13]); }
    return pts.concat([[13, 13], [8, 13], [8, 5], [2.2, 5], [2.2, 15], [-2.2, 15], [-2.2, 5], [-8, 5], [-8, 13], [-13, 13]]);
  })();
  function drawSlotGlyph(g, slot, cx0, cy0, s, alpha) {
    for (let pass = 0; pass < 2; pass++) {
      const cx = cx0, cy = cy0 + (pass === 0 ? 1 : 0);
      const col = pass === 0 ? 'rgba(0,0,0,' + (0.42 * alpha).toFixed(4) + ')' : P.rgba(C.U_BONE, 0.14 * alpha);
      switch (slot) {
        case 'earring':
          g.beginPath(); g.arc(cx, cy - 9 * s, 4.25 * s, 0, Math.PI * 2); g.strokeStyle = col; g.lineWidth = 2.5 * s; g.stroke();
          glyphPoly(g, [[0, -2], [6, 7], [0, 15], [-6, 7]], cx, cy, s, col);
          break;
        case 'bracelet':   // the band in three pieces so the strap slots stay hollow
          for (const [a, b] of [[-15, -5], [-2.6, 5], [7.4, 15]]) glyphPoly(g, [[-cuffHalf(a), a], [cuffHalf(a), a], [cuffHalf(b), b], [-cuffHalf(b), b]], cx, cy, s, col);
          break;
        case 'weapon':
          glyphPoly(g, [[0, -44], [3.2, -38], [3.2, 20], [-3.2, 20], [-3.2, -38]], cx, cy, s, col);
          glyphPoly(g, [[-13, 20], [13, 20], [13, 24], [-13, 24]], cx, cy, s, col);
          glyphPoly(g, [[-2.4, 24], [2.4, 24], [2.4, 39], [-2.4, 39]], cx, cy, s, col);
          g.beginPath(); g.arc(cx, cy + 42 * s, 4.5 * s, 0, Math.PI * 2); g.fillStyle = col; g.fill();
          break;
        case 'helmet': glyphPoly(g, HELMET, cx, cy, s, col); break;
        case 'armor':
          glyphPoly(g, [[-15, -11], [-6, -14], [-3, -9], [3, -9], [6, -14], [15, -11], [17, -1], [11, 1], [11, 15], [-11, 15], [-11, 1], [-17, -1]], cx, cy, s, col);
          break;
        case 'shield': glyphPoly(g, [[-13, -14], [13, -14], [13, -1], [9, 8], [0, 16], [-9, 8], [-13, -1]], cx, cy, s, col); break;
        case 'pants': glyphPoly(g, [[-12, -14], [12, -14], [13, 15], [4, 15], [0, -1], [-4, 15], [-13, 15]], cx, cy, s, col); break;
        case 'boots': glyphPoly(g, [[-9, -15], [3, -15], [3, 3], [12, 7], [14, 15], [-9, 15]], cx, cy, s, col); break;
      }
    }
  }
  // inventory tab (Ufuk): haloed capitals; active = bone + 1 px bone line under it, hover = bone .86, idle = ash. Returns the width.
  function drawUfukTab(g, x, text, count, state) {
    const col = state === Tab.ON ? C.U_BONE : state === Tab.HOVER ? P.rgba(C.U_BONE, 0.86) : C.U_ASH;
    const lw = P.ufuk(g, text, TAB_FONT, x, TAB_BASE, col, -1, 1, TAB_UFUK_TRACK);
    let w = lw;
    if (count) { w += TAB_COUNT_UFUK_GAP; w += P.ufuk(g, count, TAB_FONT, x + w, TAB_BASE, C.U_SOFT); }
    if (state === Tab.ON) { g.fillStyle = C.U_BONE; g.fillRect(Math.round(x), TAB_BASE + TAB_LINE_DY, lw, 1); }
    return w;
  }
  // scroll rail: faint bone bed + bone thumb (position / ratio 0..1)
  function drawRail(g, t0, th, scrollable) {
    g.fillStyle = P.rgba(C.U_BONE, 0.10); g.fillRect(RAIL_X, SHELF_TOP, RAIL_W, SHELF_H);
    if (!scrollable) return;
    const thumb = Math.max(RAIL_MIN_THUMB, Math.min(1, Math.max(0, th)) * SHELF_H);
    const top = SHELF_TOP + Math.min(1, Math.max(0, t0)) * Math.max(SHELF_H - thumb, 0);
    g.fillStyle = P.rgba(C.U_BONE, 0.55); g.fillRect(RAIL_X, top, RAIL_W, thumb);
  }

  HUDParts.inventory = function (hud) {
    const el = document.createElement('div');
    el.className = 'inv-win';
    hud.frame.appendChild(el);
    const bg = P.surface(el, 'inv-bg', W + 2 * 16, H + 2 * 16 + 3, 16, 16);   // margin for the soft shadow (14 px, +3 down) and the outer edge
    const fg = P.surface(el, 'inv-fg', W, H, 0, 0);

    let s = hud.s || 1, name = '', page = Page.EQUIP, scrollRow = 0;
    let hover = { z: Zone.NONE, i: -1, slot: '' };
    let dirtyBg = true, dirtyFg = true;
    // TODO(items): the game has no bag yet. When it gets one, its capacity (and later the items, rarity notches, "+N",
    // stack counts, the "used / capacity" counter, the extra slots' "n/12" and the purse row) come from state.inventory.
    // Until then the shelf is exactly its visible cells: nothing to scroll, so the rail shows its bed only.
    let capacity = SHELF_ROWS * COLUMNS;
    const totalRows = () => Math.ceil(capacity / COLUMNS);

    /* ---------- window position + slide (panel_base.gd) ---------- */
    const pos = { x: 0, y: 0, openX: 0, laid: false };
    let anim = null, opened = false, drag = null;
    function frameRect() { return hud.frame.getBoundingClientRect(); }
    function home() {
      const fw = hud.frame.clientWidth, fh = hud.frame.clientHeight;
      const top = Math.min(DEFAULT_TOP, Math.max(fh / s - H - 10, 0));
      return { x: Math.round(fw - (W + WIN_MARGIN) * s), y: Math.round(top * s) };
    }
    const closedX = () => Math.round(innerWidth - frameRect().left + CLOSED_X_PAD * s);
    function place() { el.style.transform = 'translate(' + Math.round(pos.x) + 'px,' + Math.round(pos.y) + 'px)'; }
    // viewport / scale change: the window returns to its default place (PanelBase.relayout), a running slide snaps to its end
    function relayout() {
      if (!hud.frame.clientWidth) { pos.laid = false; return; }
      const h0 = home();
      pos.openX = h0.x; pos.y = h0.y; pos.laid = true;
      if (anim) { if (!anim.open) finishClose(); anim = null; }
      pos.x = opened ? pos.openX : closedX();
      drag = null; place();
    }
    function slide(open) {
      anim = { from: pos.x, to: open ? pos.openX : closedX(), t: 0, open };
    }
    function finishClose() { el.classList.remove('inv-closing'); }

    /* ---------- drawing ---------- */
    function shownName() {
      let t = up(name);
      if (!t) return '';
      const max = nameMaxWidth();
      if (P.width(fg.g, t, NAME_FONT, NAME_TRACK) <= max) return t;
      while (t.length > 1 && P.width(fg.g, t + '…', NAME_FONT, NAME_TRACK) > max) t = t.slice(0, -1);
      return t + '…';
    }
    // _draw_bg: window surface + rules, name, bag heading (the purse row would sit at COIN_BASE 754: no currency in the game yet)
    function drawBg() {
      const g = bg.begin();
      drawPanel(g);
      const nm = shownName();
      if (nm) P.ufuk(g, nm, NAME_FONT, CL, NAME_BASE, C.U_BONE, -1, 1, NAME_TRACK);
      P.ufuk(g, BAG_TEXT, TAB_FONT, CL, BAG_BASE, C.U_ASH, -1, 1, TAB_UFUK_TRACK);
    }
    function tabRects() {
      const w0 = P.width(fg.g, TAB_TEXT[0], TAB_FONT, TAB_UFUK_TRACK), w1 = P.width(fg.g, TAB_TEXT[1], TAB_FONT, TAB_UFUK_TRACK);
      const x0 = CL, x1 = x0 + w0 + TAB_UFUK_GAP, top = TAB_BASE - 14;
      return [[x0 - 4, top, w0 + 8, 22], [x1 - 4, top, w1 + 8, 22]];
    }
    // _draw_fg + _draw_shelf + _draw_rail + the close control, in Godot's child order
    function drawFg() {
      const g = fg.begin();
      const rects = tabRects();
      for (let i = 0; i < 2; i++) {
        const st = page === i ? Tab.ON : hover.z === Zone.TAB && hover.i === i ? Tab.HOVER : Tab.OFF;
        drawUfukTab(g, rects[i][0] + 4, TAB_TEXT[i], null, st);   // the extra page's "n/12" needs extra-slot data the game does not have
      }
      if (page === Page.EQUIP) {
        for (const slot in SLOT_RECTS) {
          const r = SLOT_RECTS[slot];
          drawWell(g, r, hover.z === Zone.EQUIP && hover.slot === slot ? Well.HOVER : Well.EMPTY);
          const gs = (slot === 'weapon' ? r[2] : Math.min(r[2], r[3])) / 56;
          drawSlotGlyph(g, slot, r[0] + r[2] / 2, r[1] + r[3] / 2, gs, 1);
        }
      } else {
        for (let i = 0; i < EXTRA_COUNT; i++) drawWell(g, extraRect(i), hover.z === Zone.EXTRA && hover.i === i ? Well.HOVER : Well.EMPTY);
      }
      // shelf (clipped like the Godot `_shelf` control): empty cells never light on hover, only a drop target does
      g.save(); g.beginPath(); g.rect(CL - 2, SHELF_TOP - 1, SHELF_W + 4, SHELF_H + 2); g.clip();
      for (let r = scrollRow; r < scrollRow + SHELF_ROWS; r++) {
        for (let c = 0; c < COLUMNS; c++) {
          const idx = r * COLUMNS + c;
          if (idx >= capacity) continue;
          drawWell(g, cellRect(idx, scrollRow), Well.EMPTY);
        }
      }
      g.restore();
      const total = totalRows(), span = Math.max(total - SHELF_ROWS, 1);
      drawRail(g, scrollRow / span, SHELF_ROWS / total, total > SHELF_ROWS);
      P.ufuk(g, '×', CLOSE_FONT, CR - 2, NAME_BASE + 1, hover.z === Zone.CLOSE ? C.U_BONE : C.U_ASH, 1);
    }

    /* ---------- hit test (inventory_view._hit; the close control sits on top of the content surface) ---------- */
    function hit(px, py) {
      if (!(px >= 0 && py >= 0 && px < W && py < H)) return { z: Zone.NONE, i: -1, slot: '' };
      if (has(closeRect(), px, py)) return { z: Zone.CLOSE, i: -1, slot: '' };
      const tabs = tabRects();
      for (let i = 0; i < tabs.length; i++) if (has(tabs[i], px, py)) return { z: Zone.TAB, i, slot: '' };
      if (py < HEAD_H) return { z: Zone.HEAD, i: -1, slot: '' };
      if (page === Page.EQUIP) {
        for (const slot in SLOT_RECTS) if (has(SLOT_RECTS[slot], px, py)) return { z: Zone.EQUIP, i: -1, slot };
      } else {
        for (let i = 0; i < EXTRA_COUNT; i++) if (has(extraRect(i), px, py)) return { z: Zone.EXTRA, i, slot: '' };
      }
      if (has([CL, SHELF_TOP, SHELF_W, SHELF_H], px, py)) {
        const c = Math.floor((px - CL) / PITCH), r = Math.floor((py - SHELF_TOP) / PITCH);
        if (px - CL - c * PITCH < CELL && py - SHELF_TOP - r * PITCH < CELL) {
          const idx = (r + scrollRow) * COLUMNS + c;
          if (idx < capacity) return { z: Zone.BAG, i: idx, slot: '' };
        }
        return { z: Zone.SHELF, i: -1, slot: '' };
      }
      return { z: Zone.PANEL, i: -1, slot: '' };
    }
    function local(e) { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; }

    // tooltip: Atherion opens item cards to the LEFT of the window at the equipment's top (CARD_TOP 66, gap 12), or to its right when
    // the window sits at the left edge. Empty wells have no card there; with no items in this game an empty equipment well names its slot.
    const CARD_TOP = 66, CARD_GAP = 12;
    const tipAnchor = {
      getBoundingClientRect() {
        const r = el.getBoundingClientRect(), y = r.top + CARD_TOP * s;
        return tipAnchor.right ? { left: r.right + CARD_GAP * s - 8, right: r.right + CARD_GAP * s - 8, top: y, bottom: y, width: 0, height: 0 }
          : { left: r.left - CARD_GAP * s + 8, right: r.left - CARD_GAP * s + 8, top: y, bottom: y, width: 0, height: 0 };
      },
    };
    function showTip() {
      if (hover.z === Zone.EQUIP) {
        tipAnchor.right = el.getBoundingClientRect().left < 300 * s;
        const slot = hover.slot;
        hud.tips.show(tipAnchor, () => '<div class="tt">' + SLOT_NAME[slot] + '</div><div class="ts">Boş yuva</div>', tipAnchor.right ? 'right' : 'left');
      } else if (hud.tips.anchor === tipAnchor) hud.tips.hide();
    }
    const CURSOR = { [Zone.HEAD]: 'move', [Zone.CLOSE]: 'pointer' };
    function setHover(hv) {
      if (hv.z === hover.z && hv.i === hover.i && hv.slot === hover.slot) return;
      hover = hv;
      el.style.cursor = CURSOR[hv.z] || '';
      dirtyFg = true;
      showTip();
    }
    function setPage(p) {
      if (p === page) return;
      page = p; hover = { z: Zone.NONE, i: -1, slot: '' };
      if (hud.tips.anchor === tipAnchor) hud.tips.hide();
      dirtyFg = true;
    }
    function scrollBy(rows) {
      const before = scrollRow;
      scrollRow = Math.max(0, Math.min(scrollRow + rows, Math.max(0, totalRows() - SHELF_ROWS)));
      if (scrollRow !== before) dirtyFg = true;
    }

    /* ---------- input ---------- */
    el.addEventListener('mousemove', (e) => { if (!drag) { const [x, y] = local(e); setHover(hit(x, y)); } });
    el.addEventListener('mouseleave', () => { if (!drag) setHover({ z: Zone.NONE, i: -1, slot: '' }); });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();                                        // no focus, no text selection
      if (e.button !== 0) return;
      const [x, y] = local(e), h = hit(x, y);
      if (h.z === Zone.CLOSE) { hud.windows.close('inv'); return; }
      if (h.z === Zone.TAB) { setPage(h.i); return; }
      if (h.z === Zone.HEAD && !anim) {                          // PanelBase.start_drag (refused while sliding)
        drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        if (hud.tips.anchor === tipAnchor) hud.tips.hide();
      }
    });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      const fr = frameRect(), w = W * s, h = H * s;              // the window stays inside the viewport (PanelBase._clamped)
      pos.x = Math.min(Math.max(e.clientX - drag.dx, -fr.left), Math.max(innerWidth - fr.left - w, -fr.left));
      pos.y = Math.min(Math.max(e.clientY - drag.dy, -fr.top), Math.max(innerHeight - fr.top - h, -fr.top));
      place();
    });
    addEventListener('mouseup', (e) => {
      if (!drag || e.button !== 0) return;
      drag = null; pos.openX = pos.x;                            // keep_drag_position: the next opening slides back here
    });
    el.addEventListener('wheel', (e) => {
      const [x, y] = local(e), h = hit(x, y);
      if (h.z === Zone.BAG || h.z === Zone.SHELF) { e.preventDefault(); scrollBy(e.deltaY < 0 ? -1 : 1); }
    }, { passive: false });
    /* ---------- window registration: I toggles, × closes; Esc passes through (Atherion decision 2026-09-30) ---------- */
    /* ---------- window registration: I toggles, × closes, Esc closes the top window (HUD window stack) ---------- */
    hud.windows.register('inv', el, {
      esc: false,                                                    // Atherion: Esc passes through the inventory (close with I or ×)
      onOpen() {
        if (!pos.laid) relayout();
        opened = true;
        el.classList.remove('inv-closing');
        if (!anim) pos.x = closedX();
        place(); slide(true);
        dirtyBg = dirtyFg = true;
      },
      onClose() {
        opened = false; drag = null;
        if (hud.tips.anchor === tipAnchor) hud.tips.hide();
        hover = { z: Zone.NONE, i: -1, slot: '' }; el.style.cursor = ''; dirtyFg = true;
        el.classList.add('inv-closing');                         // stays drawn while it slides out (see inventory.css)
        slide(false);
      },
    });
    hud.keymap.i = 'inv';
    hud.keymap['ı'] = 'inv';                                     // Turkish Q keyboard: the I key types a dotless ı

    P.onFonts(() => { dirtyBg = dirtyFg = true; });

    const api = {
      el,
      set(state) {
        const nm = (hud.info && hud.info.name) || '';
        if (nm !== name) { name = nm; dirtyBg = true; }
        // TODO(items): state.inventory is undefined today; when the game gets an item system, read the bag capacity here
        // (capacity = ...; dirtyFg = true) and draw the items with inventory_view.gd's rules (_draw_shelf / _draw_equip_page).
      },
      frame(dt) {
        if (anim) {
          anim.t = Math.min(1, anim.t + dt / SLIDE);
          const u = anim.t, k = anim.open ? 1 - Math.pow(1 - u, 3) : u * u * u;   // TRANS_CUBIC, EASE_OUT on open / EASE_IN on close
          pos.x = anim.from + (anim.to - anim.from) * k; place();
          if (anim.t >= 1) { if (!anim.open) finishClose(); anim = null; }
        }
        if (el.hidden && !el.classList.contains('inv-closing')) return;
        if (dirtyBg) { dirtyBg = false; drawBg(); }
        if (dirtyFg) { dirtyFg = false; drawFg(); }
      },
      resize(ns) {
        s = ns; bg.resize(s); fg.resize(s);
        bg.el.style.left = bg.el.style.top = (-16 * s) + 'px';
        el.style.width = (W * s) + 'px'; el.style.height = (H * s) + 'px';
        relayout();
        dirtyBg = dirtyFg = true;
      },
    };
    api.resize(s);
    return api;
  };
})();
