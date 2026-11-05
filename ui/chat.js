/* TDS HUD part — chat panel (slot 'chat'), ported 1:1 from Atherion:
 *   chat_plate.gd   (v2 "Kütük ve Mürekkep": chamfered ash plate, tab rail + tongues, unread diamonds, seams, per-row channel inlay,
 *                    input well + outgoing inlay, nails; ZEMİNSİZ KAPALI HÂL 2026-09-26: the plate exists only in typing mode)
 *   chat_view.gd    (tabs, filter-then-window (9 rows), "Tümü" channel tag "SİSTEM · …", sender "Ad:", unread = seen-count compare,
 *                    newest-row pop-in, compact_t tween, input fade, drag in typing mode)
 *   chat_controller.gd (Enter opens / sends / closes, Esc cancels, a world click while typing only closes, death closes)
 * Coordinates are the Atherion panel (620 × 330, bottom-left: 12 px from the left, 5 px above the bottom), scaled by hud.s.
 * At rest only the tabs, the rows and the "[Enter] Mesajını yaz..." hint float over the world as haloed text; Enter brings the plate.
 *
 * What this game has (real data only): channels 'system' and 'combat' (tones sys, lvl, buff, end, crit, hurt, dot, dmg) and the
 * player's own local line ("Sen"). No server: no Sunucu / Grup / Klan tabs, no Genel⇄Yakın toggle, no whispers, no slash commands.
 * Additions over Atherion (the game asks for them): wheel scroll over ~200 lines, HH:MM timestamps (setting), resting backdrop
 * opacity (setting logAlpha), the idle hint is clickable.
 * API: { root, add(ch, text, tone), applySettings(settings), focus(), frame(dt), resize(s) }.
 */
(function (global) {
  'use strict';
  global.HUDParts = global.HUDParts || {};
  const P = global.HUDPaint, C = P.C;

  /* ── geometry (chat_plate.gd, panel-local, +y down) ── */
  const W_MAX = 440, H = 250, CUT = 12, NAIL_R = 3.5, NAIL_INSET = 11;      // minimal (user, 2026-11-05: "chat çok büyük"); Atherion 620 x 330
  const RAIL_TOP = 10, RAIL_H = 30, RAIL_SIDE_PAD = 12, RAIL_CUT = 4;
  const TAB_INSET = 2, TAB_PAD = 11, TAB_GAP = 6, TAB_FS = 12, TAB_CUT = 4, TAB_GROOVE_H = 2, TAB_GROOVE_INSET = 3;
  const BADGE_R = 2.6, BADGE_IX = 5, BADGE_IY = 4.5;
  const GRIP_W = 16, GRIP_GAP = 4, GRIP_PAD = 4;
  const SIDE_PAD = 14, MSG_TOP = 48, MSG_TEXT_X = 26, ROW_H = 20, ROW_SEP = 2, MSG_FS = 13;
  const GROOVE_INSET = 3, GROOVE_MAX_H = 16;
  const IN_BOTTOM_PAD = 12, IN_H = 30, IN_CUT = 5, IN_INLAY_W = 3, IN_INLAY_PAD = 5, IN_INLAY_V_INSET = 5, IN_TEXT_GAP = 9;
  const SEAM_INPUT_GAP = 8, SEAM_MSG_GAP = 4, SEAM1 = RAIL_TOP + RAIL_H + SEAM_MSG_GAP;            // 44
  const MSG_BOTTOM = H - (IN_BOTTOM_PAD + IN_H + SEAM_INPUT_GAP + SEAM_MSG_GAP);                  // 276
  const IN_Y = H - IN_BOTTOM_PAD - IN_H;                                                         // 288
  const INPUT_MARGIN_LEFT = IN_INLAY_PAD + IN_INLAY_W + IN_TEXT_GAP, INPUT_MARGIN_V = 2;           // 17 · 2
  const HINT_KEY_FS = 11, HINT_KEY_H = 18, HINT_KEY_PAD = 6, HINT_KEY_CUT = 2, HINT_GAP = 8, HINT_A = 0.85;
  const PANEL_LEFT = 12, PANEL_BOTTOM = 5;                                                       // bottom_bar.tscn override
  const CENTRE_HALF = 314, CENTRE_GAP = 14;     // action_bar_plate.W / 2 (280) + the vitals' outer mana readout (34): the plate never runs under
                                                // the centre block (at 1920 × 1080 this leaves exactly the 620 px Atherion panel)
  const W_MIN = 340;
  /* ── alphas ── */
  const FACE_ALPHA_FULL = 0.90, WELL_FILL_A = 0.50, WELL_LIP_TOP_A = 0.72, WELL_LIP_BOT_A = 0.30;
  const RAIL_FILL_A = 0.30, RAIL_LIP_TOP_A = 0.60, RAIL_LIP_BOT_A = 0.11, TAB_RIM_A = 0.26, SEAM1_A = 0.40, SEAM2_A = 0.32, GRIP_A = 0.26;
  const GROOVE_COL_A = 0.70, INLAY_A_IDLE = 0.45, INLAY_A_FOCUS = 0.95, FOCUS_LIP_A = 0.55, IDLE_GROOVE_BED_A = 0.70;
  const HALO_TIGHT = 3, HALO_TIGHT_A = 0.45;
  /* ── motion (s) ── */
  const HEIGHT_TWEEN = 0.18, POP_IN = 0.15, BADGE_PUNCH = 0.28, BADGE_PUNCH_SCALE = 1.9;
  const VISIBLE_COUNT = 6, MAX_HISTORY = 200, MAX_LEN = 200;                    // Atherion shows 9

  /* ── line colours (chat_view.gd BBCode constants; no new colour invented) ── */
  const TEXT = '#F8F2E2', SENDER = '#9AD9FF', SAY = '#FFD27A', SYSTEM = '#FFC857', CLAN = '#8FE3B0', CLAN_SENDER = '#58C98D';
  const PARTY = '#E0956B', PARTY_SENDER = '#C9743F', TAG_SEP = '#958365';
  // channel → tag (Tümü prefix) / sender ("Ad:" in a single-channel tab) / inlay groove. Atherion's own system channel for 'system';
  // 'combat' takes the copper pair (Atherion's party colours — this game has no party chat, so they are free and read "warm / blood").
  const CH = {
    system: { tag: 'SİSTEM', sender: 'SİSTEM', tagCol: SYSTEM, senderCol: SYSTEM, groove: SYSTEM, body: SYSTEM, noSenderInAll: true },
    combat: { tag: 'SAVAŞ', sender: 'SAVAŞ', tagCol: PARTY_SENDER, senderCol: PARTY_SENDER, groove: PARTY, body: TEXT, noSenderInAll: true },
    self: { tag: '', sender: 'Sen', tagCol: '', senderCol: SENDER, groove: TEXT, body: TEXT, noSenderInAll: false },
    // Genel: gerçek ağ kanalı (Atherion's say channel palette); own line shows as "Sen", others "Ad:"
    global: { tag: 'GENEL', sender: '', tagCol: SAY, senderCol: SENDER, groove: SAY, body: TEXT, noSenderInAll: false },
  };
  // tone → body colour (mapped onto Atherion's chat palette)
  const TONE = { sys: SYSTEM, lvl: CLAN, buff: SENDER, end: C.BONE, dmg: TEXT, crit: SAY, dot: CLAN_SENDER, hurt: PARTY };
  const TABS = [
    { id: 'all', label: 'Tümü', badge: C.BONE, match: () => true },
    { id: 'global', label: 'Genel', badge: SAY, match: (e) => e.ch === 'global' },
    { id: 'system', label: 'Sistem', badge: SYSTEM, match: (e) => e.ch === 'system' },
    { id: 'combat', label: 'Savaş', badge: PARTY, match: (e) => e.ch === 'combat' },
  ];

  const TAB_FONT = P.F.cinzel(600, TAB_FS), KEY_FONT = P.F.cinzel(600, HINT_KEY_FS);
  const MSG_FONT = P.F.serif(500, MSG_FS), MSG_BOLD = P.F.serif(700, MSG_FS);
  // [mobile HUD] touch screens have no Enter key: the hint chip reads "Sohbet" and a tap opens typing mode
  const TOUCH = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  const HINT_KEY = TOUCH ? 'Sohbet' : 'Enter', HINT_TEXT = 'Mesajını yaz...';
  const quartOut = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 4);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  global.HUDParts.chat = function (hud) {
    const D = document;
    const root = D.createElement('div');
    root.className = 'hud-chat';
    hud.frame.appendChild(root);
    const M = 6;                                                    // canvas margin around the plate (halo, nails)
    const S = P.surface(root, 'ct-cv', W_MAX + M * 2, H + M * 2, M, M);
    const g = S.g;
    // transparent hit layers: the plate (drag, typing mode only), one per tab, the idle hint
    const plateHit = el('div', 'ct-plate');
    const hintHit = el('div', 'ct-hint');
    const inp = D.createElement('input');
    inp.className = 'ct-in'; inp.type = 'text'; inp.maxLength = MAX_LEN; inp.placeholder = HINT_TEXT; inp.tabIndex = -1;
    inp.autocomplete = 'off'; inp.spellcheck = false; inp.setAttribute('aria-label', 'Sohbet');
    root.appendChild(inp);
    for (const t of TABS) {
      const b = D.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.className = 'ct-tab'; b.setAttribute('aria-label', t.label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => { e.stopPropagation(); setTab(TABS.indexOf(t)); });
      b.addEventListener('mouseenter', () => setHover(TABS.indexOf(t)));
      b.addEventListener('mouseleave', () => { if (hover === TABS.indexOf(t)) setHover(-1); });
      root.appendChild(b); t.btn = b;
    }
    function el(tag, cls) { const e = D.createElement(tag); e.className = cls; root.appendChild(e); return e; }

    /* ── state ── */
    let s = hud.s || 1, Wp = W_MAX, dirty = true, gen = 0;
    let tab = 0, hover = -1, open = false, compactT = 1, tweenFrom = 1, tweenTo = 1, tweenT = -1;
    let restP = 0, stamps = false, scroll = 0, popT = -1, rowsTop = MSG_BOTTOM, oldest = 0;
    let dragX = 0, dragY = 0, drag = null, wasDead = false;                         // drag offset (design px), Atherion: in-session only
    const hist = [];
    const counts = TABS.map(() => 0), seen = TABS.map(() => 0), unread = TABS.map(() => false), badgeT = TABS.map(() => -1);

    /* ── layout ── */
    function layoutTabs() {
      let x = RAIL_SIDE_PAD + TAB_INSET;
      for (const t of TABS) {
        const w = Math.round(P.width(g, t.label, TAB_FONT, 1)) + TAB_PAD * 2;
        t.r = { x, y: RAIL_TOP + TAB_INSET, w, h: RAIL_H - TAB_INSET * 2 };
        x += w + TAB_GAP;
      }
    }
    function hintGeom() {
      const kw = Math.max(HINT_KEY_H, Math.ceil(P.width(g, HINT_KEY, KEY_FONT, 1)) + HINT_KEY_PAD * 2);
      const tw = P.width(g, HINT_TEXT, MSG_FONT, 0);
      return { kw, tw, cy: IN_Y + IN_H * 0.5 };
    }
    function place() {
      // the plate narrows on small screens so it never runs under the centre action bar (all of chat_plate.gd derives from `size`)
      const fw = (hud.frame.clientWidth || innerWidth) / s;
      Wp = Math.round(clamp(fw * 0.5 - CENTRE_HALF - CENTRE_GAP - PANEL_LEFT, W_MIN, W_MAX));
      S.resize(s, Wp + M * 2, H + M * 2);
      S.el.style.left = (-M * s) + 'px'; S.el.style.top = (-M * s) + 'px';
      clampDrag();
      root.style.left = ((PANEL_LEFT + dragX) * s) + 'px';
      root.style.bottom = ((PANEL_BOTTOM - dragY) * s) + 'px';
      root.style.width = (Wp * s) + 'px'; root.style.height = (H * s) + 'px';
      layoutTabs();
      for (const t of TABS) box(t.btn, t.r.x, t.r.y, t.r.w, t.r.h);
      const hg = hintGeom();
      box(hintHit, SIDE_PAD, IN_Y + 3, hg.kw + HINT_GAP + hg.tw, IN_H - 6);
      box(inp, SIDE_PAD + INPUT_MARGIN_LEFT, IN_Y + INPUT_MARGIN_V, Wp - SIDE_PAD * 2 - INPUT_MARGIN_LEFT - 8, IN_H - INPUT_MARGIN_V * 2);
      inp.style.fontSize = (MSG_FS * s) + 'px';
      gen++; dirty = true;
    }
    function box(e, x, y, w, h) { e.style.left = (x * s) + 'px'; e.style.top = (y * s) + 'px'; e.style.width = (w * s) + 'px'; e.style.height = (h * s) + 'px'; }
    function clampDrag() {
      const fw = (hud.frame.clientWidth || innerWidth) / s, fh = (hud.frame.clientHeight || innerHeight) / s;
      dragX = clamp(dragX, -PANEL_LEFT, Math.max(-PANEL_LEFT, fw - PANEL_LEFT - Wp));
      dragY = clamp(dragY, -(fh - PANEL_BOTTOM - H), PANEL_BOTTOM);
    }

    /* ── rows: runs → wrapped lines (RichTextLabel autowrap word-smart) ── */
    function runsOf(e, withTag) {
      const ch = CH[e.ch] || CH.system, body = (e.ch === 'self' || e.ch === 'global') ? ch.body : (TONE[e.tone] || ch.body), out = [];
      if (stamps) out.push([e.hm + ' ', MSG_FONT, TAG_SEP]);
      if (withTag && ch.tag) { out.push([ch.tag, MSG_BOLD, ch.tagCol]); out.push([' ', MSG_FONT, TAG_SEP]); out.push(['·', MSG_FONT, TAG_SEP]); out.push([' ', MSG_FONT, TAG_SEP]); }
      if (withTag && ch.noSenderInAll) out.push([e.text, MSG_FONT, body]);   // "SİSTEM · text": the tag already names the source
      else {
        const sender = e.from ? String(e.from) : ch.sender;                  // Genel: gerçek gönderen ("Sen" own mesajlarda)
        out.push([sender + ':', MSG_BOLD, ch.senderCol]); out.push([' ' + e.text, MSG_FONT, body]);
      }
      return out;
    }
    function measure(t, font) { g.font = font; return g.measureText(t).width; }
    function wrap(e) {
      const withTag = tab === 0, key = gen + '|' + withTag + '|' + stamps;
      if (e.lay && e.lay.key === key) return e.lay;
      g.save(); g.letterSpacing = '0px';
      const maxW = Wp - MSG_TEXT_X - SIDE_PAD, lines = [[]];
      let x = 0;
      const push = (t, font, col) => { const w = measure(t, font); lines[lines.length - 1].push({ t, font, col, x }); x += w; };
      for (const [text, font, col] of runsOf(e, withTag)) {
        for (const tok of text.split(/(\s+)/)) {
          if (!tok) continue;
          const space = /^\s+$/.test(tok), w = measure(tok, font);
          if (space) { if (x > 0) push(tok, font, col); continue; }
          if (x > 0 && x + w > maxW) { lines.push([]); x = 0; }
          if (w <= maxW) { push(tok, font, col); continue; }
          let part = '';                                            // a single word wider than the row: break by characters
          for (const c of tok) {
            if (x + measure(part + c, font) > maxW && part) { push(part, font, col); lines.push([]); x = 0; part = ''; }
            part += c;
          }
          if (part) push(part, font, col);
        }
      }
      g.restore();
      const m = P.metrics(g, MSG_FONT), lh = Math.ceil(m.a + m.d);
      e.lay = { key, lines, a: m.a, lh, h: Math.max(ROW_H, lines.length * lh) };
      return e.lay;
    }
    const filtered = () => (tab === 0 ? hist : hist.filter(TABS[tab].match));
    // the 9-entry window (filter first, then window — chat_view._tail), bottom-aligned (VBox alignment END), newest last
    function visibleRows() {
      const f = filtered();
      scroll = clamp(scroll, 0, Math.max(0, f.length - 1));
      const end = f.length - scroll, start = Math.max(0, end - VISIBLE_COUNT), rows = [];
      let y = MSG_BOTTOM;
      for (let i = end - 1; i >= start; i--) {
        const L = wrap(f[i]), top = y - L.h;
        if (top < MSG_TOP - 1 && rows.length) break;                // a row that no longer fits whole is left out (wrapped rows)
        rows.unshift({ e: f[i], L, top, newest: i === f.length - 1 });
        y = top - ROW_SEP;
      }
      rowsTop = rows.length ? Math.max(MSG_TOP, rows[0].top) : MSG_BOTTOM;
      oldest = rows.length ? f.indexOf(rows[0].e) : 0;
      return rows;
    }

    /* ── drawing (chat_plate._draw + the rows above it) ── */
    function draw() {
      dirty = false;
      S.begin();
      const p = 1 - compactT, idle = compactT, pb = p + (1 - p) * restP, w = Wp;
      const rows = visibleRows();
      if (pb > 0.002) P.body(g, 0, 0, w, H, CUT, FACE_ALPHA_FULL * pb, pb);
      if (p > 0.002) P.well(g, RAIL_SIDE_PAD, RAIL_TOP, w - RAIL_SIDE_PAD * 2, RAIL_H, RAIL_CUT, RAIL_FILL_A * p, RAIL_LIP_TOP_A * p, RAIL_LIP_BOT_A * p);
      drawTabs(p, idle);
      if (p > 0.002) {
        const gx = w - RAIL_SIDE_PAD - GRIP_PAD - GRIP_W;            // drag grip: three notches at the rail's right end
        g.fillStyle = P.rgba(C.ASH, GRIP_A * p);
        for (let k = 0; k < 3; k++) g.fillRect(gx, RAIL_TOP + 9 + k * GRIP_GAP, GRIP_W, 1);
        P.seam(g, SIDE_PAD, w - SIDE_PAD, SEAM1, SEAM1_A * p);
        P.seam(g, SIDE_PAD, w - SIDE_PAD, IN_Y - SEAM_INPUT_GAP, SEAM2_A * p);
        for (const r of rows) {                                       // channel inlay per row (chat_plate._draw_row_grooves)
          const h = Math.min(r.L.h - GROOVE_INSET * 2, GROOVE_MAX_H), cy = r.top + r.L.h * 0.5;
          if (h >= 4 && r.top >= MSG_TOP - 1) P.inlay(g, SIDE_PAD, cy - h * 0.5, h, (CH[r.e.ch] || CH.system).groove, GROOVE_COL_A * p);
        }
        drawInput(p);
        for (const [nx, ny] of [[NAIL_INSET, NAIL_INSET], [w - NAIL_INSET, NAIL_INSET], [NAIL_INSET, H - NAIL_INSET], [w - NAIL_INSET, H - NAIL_INSET]]) P.nail(g, nx, ny, NAIL_R, p);
      }
      if (idle > 0.002) drawHint(idle);
      // rows (RichTextLabel: 1 px hard shadow + tight halo outline, clipped to the message box)
      g.save();
      g.beginPath(); g.rect(MSG_TEXT_X - 3, MSG_TOP, w - MSG_TEXT_X - SIDE_PAD + 6, MSG_BOTTOM - MSG_TOP); g.clip();
      g.letterSpacing = '0px'; g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.lineJoin = 'round';
      for (const r of rows) {
        const a = r.newest && popT >= 0 && scroll === 0 ? quartOut(popT) : 1;
        if (a <= 0.003) continue;
        r.L.lines.forEach((ln, i) => drawLine(ln, r.top + i * r.L.lh + r.L.a, a));
      }
      g.restore();
    }
    function drawLine(pieces, base, a) {
      const X = MSG_TEXT_X;
      g.fillStyle = 'rgba(0,0,0,' + (0.94 * a).toFixed(3) + ')';
      for (const pc of pieces) { g.font = pc.font; g.fillText(pc.t, X + pc.x, base + 1); }
      g.strokeStyle = 'rgba(0,0,0,' + (HALO_TIGHT_A * a).toFixed(3) + ')'; g.lineWidth = HALO_TIGHT;
      for (const pc of pieces) { g.font = pc.font; g.strokeText(pc.t, X + pc.x, base); }
      for (const pc of pieces) { g.font = pc.font; g.fillStyle = a < 1 ? P.rgba(pc.col, a) : pc.col; g.fillText(pc.t, X + pc.x, base); }
    }
    // tab tongues: a passive tongue has NO fill of its own (the rail's well is its surface); the active one rises (typing) and
    // carries the amber selection groove; at rest they are haloed words over the world, the active one with a bedded amber groove
    function drawTabs(p, idle) {
      const passive = P.mix(C.ASH, C.BONE, idle), hov = P.mix(C.BONE, C.ASH_HI, idle);
      TABS.forEach((t, i) => {
        const r = t.r, active = i === tab;
        if (active) {
          if (p > 0.002) P.raised(g, r.x, r.y, r.w, r.h, TAB_CUT, Math.min(1, FACE_ALPHA_FULL + 0.06) * p, TAB_RIM_A * p);
          const gx = r.x + TAB_GROOVE_INSET, gy = r.y + r.h - TAB_GROOVE_H, gw = r.w - TAB_GROOVE_INSET * 2;
          if (idle > 0.002) { g.fillStyle = 'rgba(0,0,0,' + (IDLE_GROOVE_BED_A * idle).toFixed(3) + ')'; g.fillRect(gx, gy + TAB_GROOVE_H, gw, 1); }
          g.fillStyle = P.rgba(C.AMBER, 0.92); g.fillRect(gx, gy, gw, TAB_GROOVE_H);
        } else if (i === hover) {
          g.fillStyle = P.rgba(C.ASH, 0.45); g.fillRect(r.x + TAB_GROOVE_INSET, r.y + r.h - 1, r.w - TAB_GROOVE_INSET * 2, 1);
        }
        P.haloed(g, t.label, TAB_FONT, r.x + r.w * 0.5, r.y + r.h * 0.5, active ? C.ASH_HI : i === hover ? hov : passive, 0, 1, idle);
        if (unread[i] && !active) {
          const k = badgeT[i] >= 0 ? BADGE_PUNCH_SCALE + (1 - BADGE_PUNCH_SCALE) * quartOut(badgeT[i]) : 1;
          P.diamond(g, r.x + r.w - BADGE_IX, r.y + BADGE_IY, BADGE_R * k, t.badge);
        }
      });
    }
    // input well + outgoing inlay + focus lip (no frame: focus = the bottom lip warms to amber)
    function drawInput(p) {
      const x = SIDE_PAD, y = IN_Y, w = Wp - SIDE_PAD * 2, h = IN_H;
      P.well(g, x, y, w, h, IN_CUT, WELL_FILL_A * p, WELL_LIP_TOP_A * p, open ? 0 : WELL_LIP_BOT_A * p);
      if (open) { g.fillStyle = P.rgba(C.AMBER, FOCUS_LIP_A * p); g.fillRect(x + IN_CUT, y + h - 1, w - IN_CUT * 2, 1); }
      // outgoing channel inlay: bone (Atherion's "Genel"); here a sent line stays local, shown as the player's own line
      g.fillStyle = P.rgba(C.BONE, (open ? INLAY_A_FOCUS : INLAY_A_IDLE) * p);
      g.fillRect(x + IN_INLAY_PAD, y + IN_INLAY_V_INSET, IN_INLAY_W, h - IN_INLAY_V_INSET * 2);
    }
    // the closed state's hint in place of the input: raised key tag + haloed "Mesajını yaz..."
    function drawHint(a) {
      const hg = hintGeom(), kr = { x: SIDE_PAD, y: Math.round(hg.cy - HINT_KEY_H * 0.5), w: hg.kw, h: HINT_KEY_H };
      P.raised(g, kr.x, kr.y, kr.w, kr.h, HINT_KEY_CUT, 0.92 * a, TAB_RIM_A * a);
      g.fillStyle = 'rgba(0,0,0,' + (0.6 * a).toFixed(3) + ')'; g.fillRect(kr.x + HINT_KEY_CUT, kr.y + kr.h, kr.w - HINT_KEY_CUT * 2, 1);
      P.engraved(g, HINT_KEY, KEY_FONT, kr.x + kr.w * 0.5, kr.y + kr.h * 0.5 + 0.5, P.rgba(C.ASH_HI, a), 0, 1);
      P.haloed(g, HINT_TEXT, MSG_FONT, kr.x + kr.w + HINT_GAP, hg.cy, P.rgba(C.BONE, HINT_A * a), -1, 0, a);
    }

    /* ── behaviour ── */
    function setHover(i) { if (hover !== i) { hover = i; dirty = true; } }
    function setTab(i) {
      tab = clamp(i, 0, TABS.length - 1); scroll = 0;
      markCoveredSeen();
      if (filtered().length) popT = 0;                               // _paint_rows pops the bottom row on every repaint
      dirty = true;
    }
    const covered = (t) => t === tab || tab === 0;                   // "Tümü" covers every tab
    function markCoveredSeen() { TABS.forEach((t, i) => { if (covered(i)) { seen[i] = counts[i]; unread[i] = false; } }); }
    function updateUnread() {
      TABS.forEach((t, i) => {
        if (covered(i)) { seen[i] = counts[i]; unread[i] = false; return; }
        if (counts[i] > seen[i]) { if (!unread[i]) { unread[i] = true; badgeT[i] = 0; } }
        else seen[i] = Math.min(seen[i], counts[i]);                  // history is capped: the count can fall
      });
    }
    function push(e) {
      const d = new Date();
      e.hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      hist.push(e);
      TABS.forEach((t, i) => { if (t.match(e)) counts[i]++; });
      if (hist.length > MAX_HISTORY) { const old = hist.shift(); TABS.forEach((t, i) => { if (t.match(old)) counts[i]--; }); }
      if (TABS[tab].match(e)) { if (scroll > 0) scroll++; else popT = 0; }   // scrolled back: the view stays where it is
      updateUnread();
      dirty = true;
      return e;
    }
    function animate(to) { tweenFrom = compactT; tweenTo = to; tweenT = 0; dirty = true; }
    function openChat() {
      if (root.hidden || hud.root.hidden) return;
      if (!open) { open = true; scroll = 0; root.classList.add('open'); animate(0); }
      try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
    }
    function closeChat() {
      if (!open) return;
      open = false; drag = null;
      root.classList.remove('open');
      inp.value = '';
      if (D.activeElement === inp) inp.blur();
      animate(1);
    }
    function submit() {
      const text = inp.value.replace(/\s+/g, ' ').trim();
      if (text) {
        // hud.onChatSend: the game hooks outgoing chatter (Net → server). true = sent to the network,
        // so the line lands in the Genel channel as "Sen: …"; no hook / offline = the old local line.
        const sent = hud.onChatSend ? !!hud.onChatSend(text) : false;
        scroll = 0;
        push(sent ? { ch: 'global', text, own: true, from: 'Sen' } : { ch: 'self', text, tone: '' });
      }
      closeChat();
    }
    inp.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
      else if (e.key === 'Tab') e.preventDefault();                   // keep the caret in the input (Atherion: Tab = channel toggle)
    });
    inp.addEventListener('blur', () => { if (D.hasFocus()) closeChat(); });   // alt-tab keeps typing mode; any other focus loss closes
    hintHit.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (e.button === 0) openChat(); });
    // [mobile HUD] tap: open on touchend (a user gesture, so iOS shows the keyboard); preventDefault stops the emulated mouse events,
    // whose default focus change would blur the input and close the chat again
    hintHit.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    hintHit.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); openChat(); }, { passive: false });
    // drag: typing mode only, the whole plate is the handle (chat_view._on_drag_handle_input)
    plateHit.addEventListener('mousedown', (e) => { e.preventDefault(); if (e.button === 0 && open) drag = { x: e.clientX, y: e.clientY, dx: dragX, dy: dragY }; });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      dragX = drag.dx + (e.clientX - drag.x) / s; dragY = drag.dy + (e.clientY - drag.y) / s;
      clampDrag();
      root.style.left = ((PANEL_LEFT + dragX) * s) + 'px'; root.style.bottom = ((PANEL_BOTTOM - dragY) * s) + 'px';
    });
    addEventListener('mouseup', () => { drag = null; });
    // a world click while typing only closes the chat; that click must not also attack / walk (chat_controller click-to-close)
    addEventListener('pointerdown', (e) => {
      if (!open || (e.target && e.target.nodeType && hud.root.contains(e.target))) return;
      closeChat(); e.stopPropagation(); e.preventDefault();
    }, true);
    // wheel over the rows scrolls the log and never reaches the camera (capture: runs before OrbitControls on the canvas)
    addEventListener('wheel', (e) => {
      const t = e.target && e.target.nodeType ? e.target : null;
      if (root.hidden || hud.root.hidden || (t && hud.root.contains(t) && !root.contains(t))) return;
      const r = root.getBoundingClientRect(), x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
      const top = open ? MSG_TOP : rowsTop;
      if (x < SIDE_PAD || x > Wp - SIDE_PAD || y < top || y > MSG_BOTTOM || top >= MSG_BOTTOM) return;
      e.stopPropagation();
      const n = filtered().length, step = Math.max(1, Math.round(Math.abs(e.deltaY) / 100));
      const next = e.deltaY < 0 ? (oldest > 0 ? Math.min(scroll + step, scroll + oldest, n - 1) : scroll) : Math.max(0, scroll - step);
      if (next !== scroll) { scroll = next; popT = -1; dirty = true; }
    }, { capture: true, passive: true });
    P.onFonts(() => place());

    place();
    setTab(0);
    return {
      root,
      // ch: 'system' | 'combat' | 'global'; tone: sys, lvl, buff, end, crit, hurt, dot, dmg; from: Genel gönderene adı
      add(ch, text, tone, from) {
        if (ch === 'global') return push({ ch, text: String(text), tone: '', from });
        return push({ ch: ch === 'combat' ? 'combat' : 'system', text: String(text), tone: tone || '' });
      },
      applySettings(st) {
        const ts = !!st.timestamps, ra = clamp((+st.logAlpha || 0) / FACE_ALPHA_FULL, 0, 1);
        if (ts !== stamps || ra !== restP) { stamps = ts; restP = ra; dirty = true; }
      },
      focus: openChat,
      frame(dt) {
        if (tweenT >= 0) { tweenT += dt / HEIGHT_TWEEN; compactT = tweenFrom + (tweenTo - tweenFrom) * quartOut(tweenT); if (tweenT >= 1) { compactT = tweenTo; tweenT = -1; } dirty = true; }
        if (popT >= 0) { popT += dt / POP_IN; if (popT >= 1) popT = -1; dirty = true; }
        for (let i = 0; i < badgeT.length; i++) if (badgeT[i] >= 0) { badgeT[i] += dt / BADGE_PUNCH; if (badgeT[i] >= 1) badgeT[i] = -1; dirty = true; }
        const dead = !!(hud.state && hud.state.player && hud.state.player.dead);
        if (dead && !wasDead) closeChat();                               // dying closes the input (chat_controller._on_player_hp_changed)
        wasDead = dead;
        if (dirty && !root.hidden) draw();
      },
      resize(ns) { s = ns || s; place(); draw(); },
    };
  };
})(window);
