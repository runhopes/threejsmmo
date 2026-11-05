/* TDS - party panel (HUD slot `party`), ported 1:1 from Atherion scripts/ui/party_view.gd ("Bölük Künyesi", v4;
 * docs grup_paneli_tasarim_v4_kunye.html, grup_paneli_tasarim.html) + the column coupling of party_controller.gd.
 *
 * ONE forged ash-metal plate nailed to the left screen edge (left edge straight, right corners chamfered), members ENGRAVED
 * into it: class inlay, name, "Sv" level well, status stamp (Düştü), HP groove with 25/50/75 ticks; offline rows cool down
 * with an achromatic hatch and say "Çevrimdışı" where the HP groove was. One warm accent per panel: the copper hairline
 * of the inlay groove. The quest tracker sits under the panel (TRACKER_GAP 12) and settles when the panel grows/shrinks.
 *
 * API: set(list) — list = [{ id, name, level, hp, maxHp, dead, offline }]; hidden for an empty list.
 *   Also frame(dt), resize(s).
 * Left out (the game has no data / action for them, so they would only be decoration): leader diamond + leader view,
 * class colour (the inlay shows Atherion's own "unknown class" ash), own-row highlight, party cap ("n/8": the count
 * well shows the member count only), EXP share mode switch, "Menzil dışı" stamp, offline grace countdown, footer
 * (Ayrıl / Grubu Dağıt) and kick buttons, invite card.
 * Units: Atherion canvas px (1920x1080 design), scaled by hud.s.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, D = document;

  /* ---------- geometry (party_view.gd) ---------- */
  const PANEL_W = 340, LEFT = 10, TOP_Y = 20, HEADER_H = 28, ROW_H = 36;
  const PAD_L = 12, PAD_R = 10, COL_GAP = 8;
  const CARD_CUT = 9, SMALL_CUT = 3, GROOVE_X = 3, GROOVE_W = 3, GROOVE_PAD = 8, NAIL_R = 3, NAIL_INSET = 5;
  const TITLE_TRACK = 2, TITLE_GAP = 8, COUNT_W = 46, COUNT_H = 18, COUNT_TOP = 5, HEAD_SCORE_Y = 26;
  const SELF_SEG_TOP = 6, SELF_SEG_H = 24, CLS_X = 26, CLS_W = 3, CLS_TOP = 8, CLS_H = 16;
  const NAME_X = 36, NAME_TOP = 2, NAME_H = 17, LVL_W = 44, LVL_H = 16, LVL_TOP = 3, LVL_KEY_X = 5, LVL_KEY_W = 14, LVL_PAD_R = 6;
  const TAG_W = 76, TAG_H = 16, TAG_TOP = 3, TAG_TILT = -0.0209;
  const HP_TOP = 24, HP_H = 4, BAR_TICKS = 3, CHAN_TOP = 25, GRACE_TOP = 20, GRACE_H = 13, ROW_SCORE_Y = 34, HP_LOW_RATIO = 0.25;
  // member view: the right rails end at PANEL_W - PAD_R (the kick column exists only in the leader view)
  const RAIL = PANEL_W - PAD_R, LVL_X = RAIL - LVL_W, TAG_X = LVL_X - COL_GAP - TAG_W, HP_W = RAIL - NAME_X;
  const TRACKER_GAP = 12, TRACKER_SLIDE_S = 0.18;   // party_controller.gd

  /* ---------- palette (party_view.gd: the tracker's ash family, cooled) ---------- */
  const LIT = '219,211,199';                                                     // #DBD3C7 (COL_ASH_HI)
  const RIM = [[0, LIT, 0.30], [0.26, LIT, 0.04], [0.74, '0,0,0', 0.46], [1, '0,0,0', 0.76]];
  const FACE = [[0, 'rgba(26,19,17,.90)'], [0.55, 'rgba(13,10,10,.92)'], [1, 'rgba(19,14,13,.90)']];
  const COL_ASH = '#8D8375', COL_BONE = '#BCB6AA', COL_PARTY = '#E0956B';
  const GROOVE_DARK = 'rgba(0,0,0,.82)', GROOVE_MID = 'rgba(0,0,0,.44)', NAIL_DARK = '#0F0B0A', NAIL_LIT = '#C6BDAD';
  const WELL_FILL = 'rgba(0,0,0,.28)', WELL_EDGE_TOP = 'rgba(0,0,0,.72)', WELL_EDGE_BOT = 'rgba(' + LIT + ',.11)';
  const BAR_BG = 'rgba(0,0,0,.44)', BAR_EDGE_TOP = 'rgba(0,0,0,.62)', BAR_EDGE_BOT = 'rgba(' + LIT + ',.10)', BAR_TICK = 'rgba(' + LIT + ',.17)';
  const ROW_BG = 'rgba(' + LIT + ',.022)';
  const SCORE_INK = 'rgba(0,0,0,.62)', SCORE_LIT = 'rgba(' + LIT + ',.10)', HEAD_SCORE_INK = 'rgba(0,0,0,.70)', HEAD_SCORE_LIT = 'rgba(' + LIT + ',.16)';
  const HATCH = 'rgba(' + LIT + ',.022)', HATCH_STEP = 9, HATCH_SHEAR = 22.5;
  const COL_TXT = 'rgba(224,218,214,.94)', COL_DIM = 'rgba(166,158,150,.72)', COL_OFF = 'rgba(166,158,150,.44)';
  const COL_HP = '#7FBF6A', COL_HP_DIM = '#5E9450', COL_HP_LOW = '#C2564E', COL_HP_LOW_DIM = '#8E3A34';
  const TAG_FILL = 'rgba(' + LIT + ',.07)', TAG_EDGE = 'rgba(' + LIT + ',.32)';
  const SHADOW = 'rgba(0,0,0,.94)';                                              // Label shadow (engraved): 1 px, not scaled by the text alpha

  /* ---------- fonts (all Cinzel 600) ---------- */
  const FN = { title: P.F.cinzel(600, 11), count: P.F.cinzel(600, 11), name: P.F.cinzel(600, 13), key: P.F.cinzel(600, 9),
    lvl: P.F.cinzel(600, 12), state: P.F.cinzel(600, 10), tag: P.F.cinzel(600, 9) };
  const T = { title: 'GRUP', lvl: 'Sv', offline: 'Çevrimdışı', downed: 'Düştü' };   // PARTY_TITLE, PARTY_LEVEL_PREFIX, PARTY_OFFLINE, PARTY_DOWNED

  /* ---------- animation (one shot) ---------- */
  const OPEN_DUR = 0.26, OPEN_SLIDE_PX = 26, OPEN_RIM_GAIN = 0.42, OPEN_FLASH_S = 0.52, JOIN_DUR = 0.28, JOIN_SLIDE_PX = 10;
  const ease = { lin: (t) => t, quadOut: (t) => 1 - (1 - t) * (1 - t), cubicOut: (t) => 1 - (1 - t) * (1 - t) * (1 - t) };
  const seg = (t, delay, dur, a, b, e) => a + (b - a) * e(Math.max(0, Math.min(1, (t - delay) / dur)));

  /* ---------- drawing helpers ---------- */
  // login_ornate.plate_points: left edge STRAIGHT (nailed to the screen edge), both right corners chamfered
  function platePath(g, x, y, w, h, cut) {
    const c = Math.max(1, Math.min(cut, Math.min(w, h) * 0.5));
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c);
    g.lineTo(x + w - c, y + h); g.lineTo(x, y + h); g.closePath();
  }
  // Godot Label, vertically centred in its box; engraved = 1 px hard shadow. align -1 left · 0 centre · 1 right
  function label(g, text, font, ls, x, cy, col, align, maxW) {
    if (!text) return;
    const m = P.metrics(g, font);
    g.font = font; g.letterSpacing = (ls || 0) + 'px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (maxW !== undefined && g.measureText(text).width > maxW) {                // OVERRUN_TRIM_ELLIPSIS
      let n = text.length;
      while (n > 1 && g.measureText(text.slice(0, n).trimEnd() + '…').width > maxW) n--;
      text = text.slice(0, n).trimEnd() + '…';
    }
    const w = g.measureText(text).width, left = align === 0 ? x - w * 0.5 : align > 0 ? x - w : x;
    const base = cy + (m.a - m.d) * 0.5;
    g.fillStyle = SHADOW; g.fillText(text, left, base + 1);
    g.fillStyle = col; g.fillText(text, left, base);
  }
  // pressed well: fill + dark top lip + faint lit bottom lip
  function well(g, x, y, w, h) {
    P.octPath(g, x, y, w, h, SMALL_CUT); g.fillStyle = WELL_FILL; g.fill();
    g.fillStyle = WELL_EDGE_TOP; g.fillRect(x + SMALL_CUT, y, w - SMALL_CUT * 2, 1);
    g.fillStyle = WELL_EDGE_BOT; g.fillRect(x + SMALL_CUT, y + h - 1, w - SMALL_CUT * 2, 1);
  }
  function score(g, x, y, w, ink, lit) { g.fillStyle = ink; g.fillRect(x, y, w, 1); g.fillStyle = lit; g.fillRect(x, y + 1, w, 1); }

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.party = function (hud) {
    const root = D.createElement('div');
    root.className = 'hud-ath-party';
    root.style.cssText = 'position:absolute;pointer-events:none';
    root.hidden = true;
    hud.frame.appendChild(root);
    const S = P.surface(root, '', PANEL_W, HEADER_H);
    S.el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';

    let rows = [], visible = false, H = HEADER_H, sig = '', dirty = false;
    let openT = null, slideX = 0, alpha = 1, rimGain = 0;
    const seenIds = new Set();
    // shared left column (party_controller._sync_quest_tracker)
    let trackerBase = -1, trackerWant = -1, trackerTw = null;

    function record(m) {
      const offline = !!m.offline, maxHp = num(m.maxHp), hp = num(m.hp);
      const ratio = m.dead ? 0 : maxHp > 0 && hp !== null ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
      const lvl = num(m.level);
      const r = { id: String(m.id), name: String(m.name || '?'), level: lvl !== null ? String(Math.round(lvl)) : '', offline,
        ratio, hpPx: Math.round(HP_W * ratio), tag: !offline && ratio <= 0 ? T.downed : '', joinT: null };
      r.key = [r.id, r.name, r.level, offline ? 1 : 0, offline ? '' : r.hpPx, r.tag].join('\u0001');
      return r;
    }

    function place() {
      const s = hud.s;
      root.style.left = (LEFT * s) + 'px'; root.style.top = (TOP_Y * s) + 'px';
      root.style.transform = slideX ? 'translateX(' + (slideX * s) + 'px)' : '';
      root.style.opacity = alpha < 1 ? String(alpha) : '';
    }

    function drawPlate(g) {
      const W = PANEL_W;
      // rim ramp (+ the opening flash on its top stops), face 1 px inside
      const gain = OPEN_RIM_GAIN * rimGain;
      platePath(g, 0, 0, W, H, CARD_CUT);
      g.fillStyle = P.vgrad(g, 0, H, RIM.map(([t, rgb, a]) => [t, 'rgba(' + rgb + ',' + Math.min(1, a + gain * (1 - t)).toFixed(4) + ')']));
      g.fill();
      platePath(g, 1, 1, W - 2, H - 2, CARD_CUT - 0.5);
      g.fillStyle = P.vgrad(g, 0, H, FACE); g.fill();
      // inlay groove: three hairlines, the lightest one copper (the panel's ONE warm accent)
      const gh = Math.max(H - GROOVE_PAD * 2, 2);
      g.fillStyle = GROOVE_DARK; g.fillRect(GROOVE_X, GROOVE_PAD, 1, gh);
      g.fillStyle = GROOVE_MID; g.fillRect(GROOVE_X + 1, GROOVE_PAD, 1, gh);
      g.fillStyle = COL_PARTY; g.fillRect(GROOVE_X + 2, GROOVE_PAD, 1, gh);
      // nail heads
      const nx = GROOVE_X + GROOVE_W * 0.5;
      for (const cy of [NAIL_INSET, H - NAIL_INSET]) { P.diamond(g, nx, cy, NAIL_R, NAIL_DARK); P.diamond(g, nx, cy - 0.5, NAIL_R - 1.2, NAIL_LIT); }
      // header seam + count well
      score(g, PAD_L, HEAD_SCORE_Y, PANEL_W - PAD_L - PAD_R, HEAD_SCORE_INK, HEAD_SCORE_LIT);
      const titleW = Math.ceil(P.width(g, T.title, FN.title, TITLE_TRACK)) + 2, cx = PAD_L + titleW + TITLE_GAP;
      well(g, cx, COUNT_TOP, COUNT_W, COUNT_H);
      // labels (siblings drawn after the plate)
      label(g, T.title, FN.title, TITLE_TRACK, PAD_L, HEADER_H * 0.5, COL_BONE, -1);
      label(g, String(rows.length), FN.count, 0, cx + COUNT_W * 0.5, COUNT_TOP + COUNT_H * 0.5, COL_DIM, 0);
    }

    function drawRow(g, r, y, last) {
      g.save();
      g.beginPath(); g.rect(0, y, PANEL_W, ROW_H); g.clip();               // holder.clip_contents
      g.save();
      let jx = 0, ja = 1;
      if (r.joinT !== null) { jx = seg(r.joinT, 0, JOIN_DUR, -JOIN_SLIDE_PX, 0, ease.cubicOut); ja = seg(r.joinT, 0, JOIN_DUR * 0.8, 0, 1, ease.lin); }
      g.translate(jx, y); g.globalAlpha = ja;
      // inner: ground -> offline hatch -> groove segment -> class inlay -> level well -> stamp -> HP groove / empty channel -> score
      g.fillStyle = ROW_BG; g.fillRect(1, 0, PANEL_W - 2, ROW_H);
      if (r.offline) {
        g.beginPath();
        for (let x = -HATCH_SHEAR; x < PANEL_W; x += HATCH_STEP) { g.moveTo(x + HATCH_SHEAR, 0); g.lineTo(x, ROW_H); }
        g.strokeStyle = HATCH; g.lineWidth = 1; g.stroke();
        g.fillStyle = 'rgba(0,0,0,.86)'; g.fillRect(GROOVE_X, SELF_SEG_TOP, 2, SELF_SEG_H);
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(GROOVE_X + 2, SELF_SEG_TOP, 1, SELF_SEG_H);
      }
      g.fillStyle = r.offline ? 'rgba(141,131,117,.30)' : COL_ASH; g.fillRect(CLS_X, CLS_TOP, CLS_W, CLS_H);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(CLS_X, CLS_TOP, CLS_W, 1); g.fillRect(CLS_X, CLS_TOP + CLS_H - 1, CLS_W, 1);
      well(g, LVL_X, LVL_TOP, LVL_W, LVL_H);
      if (r.tag) drawTag(g, TAG_X, r.tag);
      if (r.offline) {
        g.fillStyle = 'rgba(0,0,0,.50)'; g.fillRect(NAME_X, CHAN_TOP, HP_W, 1);
        g.fillStyle = 'rgba(' + LIT + ',.07)'; g.fillRect(NAME_X, CHAN_TOP + 1, HP_W, 1);
      } else drawHp(g, NAME_X, HP_TOP, HP_W, r.ratio);
      if (!last) score(g, NAME_X, ROW_SCORE_Y, PANEL_W - NAME_X - PAD_R, SCORE_INK, SCORE_LIT);
      g.restore();
      // holder labels (they do not take part in the join slide)
      g.translate(0, y);
      const right = r.tag ? TAG_X : LVL_X;
      label(g, r.name, FN.name, 1, NAME_X, NAME_TOP + NAME_H * 0.5, r.offline ? COL_OFF : COL_TXT, -1, Math.max(right - COL_GAP - NAME_X, 40));
      label(g, T.lvl, FN.key, 1, LVL_X + LVL_KEY_X, LVL_TOP + LVL_H * 0.5, COL_ASH, -1);
      label(g, r.level, FN.lvl, 0, LVL_X + LVL_W - LVL_PAD_R, LVL_TOP + LVL_H * 0.5, r.offline ? COL_OFF : COL_BONE, 1);
      if (r.offline) label(g, T.offline, FN.state, 1, NAME_X, GRACE_TOP + GRACE_H * 0.5, COL_OFF, -1);
      g.restore();
    }
    // HP groove: a carved channel (lips over the whole length, ticks over the fill); red only when low
    function drawHp(g, x, y, w, ratio) {
      g.fillStyle = BAR_BG; g.fillRect(x, y, w, HP_H);
      const fw = Math.round(w * ratio);
      if (fw > 0) {
        const low = ratio <= HP_LOW_RATIO;
        g.fillStyle = low ? COL_HP_LOW : COL_HP; g.fillRect(x, y, fw, 2);
        g.fillStyle = low ? COL_HP_LOW_DIM : COL_HP_DIM; g.fillRect(x, y + 2, fw, HP_H - 2);
      }
      g.fillStyle = BAR_TICK;
      for (let i = 1; i <= BAR_TICKS; i++) g.fillRect(x + w * (i / (BAR_TICKS + 1)), y, 1, HP_H);
      g.fillStyle = BAR_EDGE_TOP; g.fillRect(x, y, w, 1);
      g.fillStyle = BAR_EDGE_BOT; g.fillRect(x, y + HP_H - 1, w, 1);
    }
    // status stamp: achromatic, tilted -1.2° (pressed by hand), on the fixed rail left of the level well
    function drawTag(g, x, text) {
      g.save();
      g.translate(x + TAG_W * 0.5, TAG_TOP + TAG_H * 0.5); g.rotate(TAG_TILT);
      P.octPath(g, -TAG_W * 0.5, -TAG_H * 0.5, TAG_W, TAG_H, SMALL_CUT);
      g.fillStyle = TAG_FILL; g.fill();
      g.strokeStyle = TAG_EDGE; g.lineWidth = 1; g.stroke();
      g.font = FN.tag; g.letterSpacing = '1px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = COL_BONE; g.fillText(text, -g.measureText(text).width * 0.5, 9 * 0.5 - 0.5);
      g.restore();
    }

    function draw() {
      if (S.s !== hud.s || S.h !== H) S.resize(hud.s, PANEL_W, H);
      const g = S.begin();
      drawPlate(g);
      rows.forEach((r, i) => drawRow(g, r, HEADER_H + i * ROW_H, i === rows.length - 1));
    }

    function syncTracker() {
      const q = hud.quests;
      if (!q || typeof q.setTopOffset !== 'function' || typeof q.baseTopOffset !== 'function') return;
      if (trackerBase < 0) trackerBase = q.baseTopOffset();
      const wanted = visible ? Math.max(trackerBase, TOP_Y + H + TRACKER_GAP) : trackerBase;
      if (Math.abs(trackerWant - wanted) < 1e-3) return;
      const from = trackerWant;
      trackerWant = wanted; trackerTw = null;
      // the panel OPENING moves the column at once (no second motion racing the slide-in); later size changes settle
      if (from < 0 || Math.abs(from - trackerBase) < 1e-3) { q.setTopOffset(wanted); return; }
      trackerTw = { from, to: wanted, t: 0 };
    }

    const api = {
      root,
      set(list) {
        list = Array.isArray(list) ? list.filter((m) => m && m.id !== undefined && m.id !== null) : [];
        if (!list.length) {
          sig = '';
          if (visible) { visible = false; root.hidden = true; rows = []; seenIds.clear(); openT = null; syncTracker(); }
          return;
        }
        const next = list.map(record), k = next.map((r) => r.key).join('\u0002');
        if (k === sig) return;
        sig = k;
        const wasHidden = !visible, prev = new Map(rows.map((r) => [r.id, r])), live = new Set();
        for (const r of next) {
          live.add(r.id);
          if (!seenIds.has(r.id)) { seenIds.add(r.id); if (!wasHidden) r.joinT = 0; }      // a NEW member slides in
          else if (prev.has(r.id)) r.joinT = prev.get(r.id).joinT;
        }
        for (const id of [...seenIds]) if (!live.has(id)) seenIds.delete(id);
        rows = next; H = HEADER_H + ROW_H * rows.length;
        visible = true; root.hidden = false; dirty = true;
        if (wasHidden) { openT = 0; slideX = -OPEN_SLIDE_PX; alpha = 0; rimGain = 1; }
        place();
        syncTracker();
      },
      frame(dt) {
        dt = Math.min(Math.max(dt || 0, 0), 0.1);
        if (trackerTw) {
          const tw = trackerTw; tw.t += dt;
          if (hud.quests && hud.quests.setTopOffset) hud.quests.setTopOffset(seg(tw.t, 0, TRACKER_SLIDE_S, tw.from, tw.to, ease.cubicOut));
          if (tw.t >= TRACKER_SLIDE_S) trackerTw = null;
        }
        if (!visible) return;
        let moved = false;
        if (openT !== null) {
          openT += dt; moved = true;
          slideX = seg(openT, 0, OPEN_DUR, -OPEN_SLIDE_PX, 0, ease.cubicOut);
          alpha = seg(openT, 0, OPEN_DUR * 0.8, 0, 1, ease.lin);
          rimGain = seg(openT, 0, OPEN_FLASH_S, 1, 0, ease.quadOut);
          if (openT >= OPEN_FLASH_S) openT = null;
          place();
        }
        for (const r of rows) if (r.joinT !== null) { moved = true; if ((r.joinT += dt) >= JOIN_DUR) r.joinT = null; }
        if (moved || dirty) { dirty = false; draw(); }
      },
      resize() { place(); dirty = true; },
    };
    P.onFonts(() => { dirty = true; });
    place();
    return api;
  };
})(window);
