/* TDS HUD part — effect column under the minimap ("Künye Sırası"), ported 1:1 from Atherion:
 *   effect_bar_view.gd    231 × 40 plates (left edge flat, right corners 5 px chamfered; rim ramp, leather face, top edge light,
 *                         2 px contact shadow), 3 px status inlay groove (iron = timed, red = last 5 s), 28 px carved icon well
 *                         with a 24 px icon, Cinzel 600 12 name (fits 12 → 10 px, then "…"), Alegreya 13 m:ss engraved at the right,
 *                         Alegreya 11 value line, 2 px depletion channel; rows rise 6 px into place in 0.18 s.
 *   effect_bar_model.gd   use order (new rows at the bottom, never re-sorted), at most 6 rows: past that 5 rows + a 26 px "rest" strip
 *                         with 16 px mini icons and "+N"; m:ss rounds UP; low = remaining ≤ 5 s.
 *   effect_bar_controller.gd   column top 304, 24 px from the right edge (same right edge as the minimap).
 * Rows = the player's active skill buffs. The value line shows the buff's desc when the game gives one (Atherion: what the effect does).
 * Not drawn (no data in this game): amber "pending protection" groove, "İŞARETLİ" indefinite rows, stack count "×N".
 * Atherion's column ignores the mouse; here each row carries a tooltip (name, time left, description).
 * API: { set(buffs) } with buffs = [{ id, name, iconHTML (64×64 SVG), left (s), dur (s), desc? }].
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, F = P.F;

  // ── geometry (effect_bar_view.gd) ──
  const WIDTH = 231, ROW_H = 40, ROW_GAP = 6, PITCH = ROW_H + ROW_GAP, STRIP_H = 26, CUT = 5, STRIP_CUT = 4;
  const GROOVE_X = 3, GROOVE_Y = 7, GROOVE_W = 3, GROOVE_H = 26, STRIP_GROOVE_Y = 5, STRIP_GROOVE_H = 16;
  const WELL_X = 11, WELL_Y = 6, WELL = 28, WELL_CUT = 3, ICON = 24, ICON_INSET = 2, MINI_ICON = 16, MINI_GAP = 4;
  const TEXT_X = 48, RIGHT_PAD = 10, NAME_TIME_GAP = 8, NAME_FS = 12, NAME_MIN_FS = 10, TIME_FS = 13, VALUE_FS = 11, COUNT_FS = 10;
  const TOP_BASE_Y = 16, VALUE_BASE_Y = 30, BAR_X = 11, BAR_H = 2, BAR_BOTTOM_PAD = 3;
  const ENTER_S = 0.18, ENTER_RISE = 6;
  // ── effect_bar_model.gd / controller ──
  const MAX_ROWS = 6, OVERFLOW_HEAD = MAX_ROWS - 1, LOW_MS = 5000, COLUMN_TOP = 304, RIGHT_MARGIN = 24;
  // ── palette ──
  const FACE = [[0, 'rgba(62,49,37,.92)'], [0.52, 'rgba(44,36,25,.92)'], [1, 'rgba(30,24,16,.92)']];          // #3E3125 #2C2419 #1E1810
  const RIM = [[0, 'rgba(227,211,183,.30)'], [0.26, 'rgba(227,211,183,.04)'], [0.74, 'rgba(0,0,0,.46)'], [1, 'rgba(0,0,0,.76)']];
  const EDGE_LIGHT = 'rgba(255,240,214,.10)', CONTACT_NEAR = 'rgba(0,0,0,.38)', CONTACT_FAR = 'rgba(0,0,0,.16)';
  const GROOVE_BED = 'rgba(0,0,0,.46)', GROOVE_IRON = '#8C7C66', GROOVE_LOW = '#C2564E';
  const WELL_RAMP = [[0, '#15110A'], [1, '#241D14']], WELL_LIP_TOP = 'rgba(0,0,0,.72)', WELL_LIP_BOT = 'rgba(227,211,183,.16)';
  const TEXT_HI = '#E3D3B7', TEXT_DIM = '#958365', ENGRAVE_INK = 'rgba(0,0,0,.90)';
  const BAR_BG = 'rgba(0,0,0,.50)', BAR_LIP_TOP = 'rgba(0,0,0,.75)', BAR_LIP_BOT = 'rgba(227,211,183,.22)', BAR_FILL = '#7A6B56';
  const F_TIME = F.serif(400, TIME_FS), F_VALUE = F.serif(400, VALUE_FS), F_COUNT = F.cinzel(600, COUNT_FS);
  const fName = (px) => F.cinzel(600, px);
  // canvas margins: 1 px left, contact shadow + entering rows below
  const PADL = 1, PADT = 1, PADB = ENTER_RISE + 4;
  const BAR_W = WIDTH - BAR_X - RIGHT_PAD;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // effect_bar_model.mmss: rounds UP (0.4 s left is still "0:01")
  function mmss(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function columnHeight(rows, extra) {
    const n = rows + (extra ? 1 : 0);
    if (n <= 0) return 0;
    return rows * ROW_H + (n - 1) * ROW_GAP + (extra ? STRIP_H : 0);
  }

  function EffectsPart(hud) {
    const root = document.createElement('div');
    root.className = 'ath-fx';
    // canvas = 1 px pad | 231 px column | 1 px pad, so the plates' right edge sits RIGHT_MARGIN from the screen edge
    root.style.cssText = 'position:absolute;right:calc(' + (RIGHT_MARGIN - 1) + 'px * var(--s));top:calc(' + (COLUMN_TOP - PADT) + 'px * var(--s));pointer-events:none';
    root.hidden = true;
    hud.frame.appendChild(root);
    const surf = P.surface(root, 'ath-fx-cv', WIDTH + PADL + 1, PADT + PADB, PADL, PADT);
    surf.el.style.cssText = 'display:block;pointer-events:none;font-variant-numeric:lining-nums tabular-nums;font-feature-settings:"lnum" 1,"tnum" 1';

    let order = [], data = {}, rows = [], extra = [], sig = '', dirty = true, colH = 0;
    const enter = {}, icons = {};
    P.onFonts(() => { nameCache.clear(); dirty = true; });

    // icons: each SVG rasterised once per id (96 px — enough for 24 px × 1.45 × DPR 2)
    function icon(id, html) {
      let ic = icons[id];
      if (ic && ic.html === html) return ic.ready ? ic.cv : null;
      ic = icons[id] = { html, ready: false, cv: null };
      if (!html) return null;
      let svg = String(html);
      if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      svg = svg.replace(/<svg\b/, '<svg width="96" height="96"');
      const img = new Image();
      img.onload = () => {
        if (icons[id] !== ic) return;
        const cv = document.createElement('canvas'); cv.width = cv.height = 96;
        cv.getContext('2d').drawImage(img, 0, 0, 96, 96);
        ic.cv = cv; ic.ready = true; dirty = true;
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      return null;
    }

    // hit areas (tooltips): one per drawn row + the rest strip
    const hits = [];
    function hitFor(i) {
      if (hits[i]) return hits[i];
      const d = document.createElement('div');
      d.className = 'ath-fx-hit';
      d.style.cssText = 'position:absolute;left:calc(' + PADL + 'px * var(--s));width:calc(' + WIDTH + 'px * var(--s));pointer-events:auto';
      d.addEventListener('mousedown', (e) => e.preventDefault());
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(d);
      hud.tips.bind(d, () => tipFor(d), 'left');
      hits[i] = d;
      return d;
    }
    function tipFor(d) {
      if (d._extra) {
        const list = extra.map((r) => esc(r.name) + ' · ' + mmss(r.ms)).join('<br>');
        return '<div class="tt">+' + extra.length + ' etki</div><div class="tb">' + list + '</div>';
      }
      const r = rows.find((x) => x.id === d._id);
      if (!r) return '';
      return '<div class="tt">' + esc(r.name) + '</div><div class="ts">' + mmss(r.ms) + ' kaldı' + (r.dur > 0 ? ' · ' + P.num(r.dur, r.dur % 1 ? 1 : 0) + ' sn' : '') + '</div>' +
        (r.desc ? '<div class="tb" style="margin-top:4px">' + esc(r.desc) + '</div>' : '');
    }

    // ── drawing helpers ──
    function platePath(g, x, y, w, h, cut) {
      const c = Math.max(1, Math.min(cut, Math.min(w, h) * 0.5));
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c); g.lineTo(x + w - c, y + h); g.lineTo(x, y + h); g.closePath();
    }
    function plate(g, x, y, w, h, cut) {
      platePath(g, x, y, w, h, cut); P.fillRamp(g, y, h, RIM);
      platePath(g, x + 1, y + 1, w - 2, h - 2, cut - 0.5); P.fillRamp(g, y + 1, h - 2, FACE);
      g.fillStyle = EDGE_LIGHT; g.fillRect(x, y, w - cut, 1);
      g.fillStyle = CONTACT_NEAR; g.fillRect(x, y + h, w - cut, 1);
      g.fillStyle = CONTACT_FAR; g.fillRect(x, y + h + 1, w - cut, 1);
    }
    function groove(g, x, y, w, h, col) {
      g.fillStyle = GROOVE_BED; g.fillRect(x - 1, y - 1, w + 2, h + 2);
      g.fillStyle = col; g.fillRect(x, y, w, h);
    }
    function well(g, x, y) {
      P.octPath(g, x, y, WELL, WELL, WELL_CUT); P.fillRamp(g, y, WELL, WELL_RAMP);
      g.fillStyle = WELL_LIP_TOP; g.fillRect(x + WELL_CUT, y, WELL - WELL_CUT * 2, 1);
      g.fillStyle = WELL_LIP_BOT; g.fillRect(x + WELL_CUT, y + WELL - 1, WELL - WELL_CUT * 2, 1);
    }
    // KAZIMA: no outline, 1 px hard ink shadow below; positioned by BASELINE
    function engrave(g, text, font, x, base, col, tracking) {
      g.save(); P.setFont(g, font, tracking);
      g.fillStyle = ENGRAVE_INK; g.fillText(text, x, base + 1);
      g.fillStyle = col; g.fillText(text, x, base);
      g.restore();
    }
    function ellipsize(g, text, font, tracking, maxW) {
      if (P.width(g, text, font, tracking) <= maxW) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P.width(g, text.slice(0, mid).trimEnd() + '…', font, tracking) <= maxW) lo = mid; else hi = mid - 1; }
      return text.slice(0, lo).trimEnd() + '…';
    }
    // _fit_name: 12 → 10 px, then ellipsis at 10
    const nameCache = new Map();
    function fitName(g, text, maxW) {
      const key = text + '|' + Math.floor(maxW);
      let r = nameCache.get(key);
      if (r) return r;
      for (let px = NAME_FS; px >= NAME_MIN_FS; px--) if (P.width(g, text, fName(px), 1) <= maxW) { r = { t: text, f: fName(px) }; break; }
      if (!r) r = { t: ellipsize(g, text, fName(NAME_MIN_FS), 1, Math.max(1, maxW)), f: fName(NAME_MIN_FS) };
      if (nameCache.size > 64) nameCache.clear();
      nameCache.set(key, r);
      return r;
    }

    function drawRow(g, r, top) {
      const e = enter[r.id] === undefined ? 1 : enter[r.id];
      const y = top + (1 - e) * (1 - e) * ENTER_RISE;
      plate(g, 0, y, WIDTH, ROW_H, CUT);
      groove(g, GROOVE_X, y + GROOVE_Y, GROOVE_W, GROOVE_H, r.low ? GROOVE_LOW : GROOVE_IRON);
      well(g, WELL_X, y + WELL_Y);
      const ic = icon(r.id, r.iconHTML);
      if (ic) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(ic, WELL_X + ICON_INSET, y + WELL_Y + ICON_INSET, ICON, ICON); }
      // time (right) then the name in the corridor left of it
      const tt = mmss(r.ms), tw = P.width(g, tt, F_TIME);
      engrave(g, tt, F_TIME, WIDTH - RIGHT_PAD - tw, y + TOP_BASE_Y, r.low ? GROOVE_LOW : TEXT_HI);
      const nm = fitName(g, r.name, WIDTH - RIGHT_PAD - tw - NAME_TIME_GAP - TEXT_X);
      engrave(g, nm.t, nm.f, TEXT_X, y + TOP_BASE_Y, TEXT_HI, 1);
      if (r.desc) engrave(g, ellipsize(g, r.desc, F_VALUE, 0, WIDTH - RIGHT_PAD - TEXT_X), F_VALUE, TEXT_X, y + VALUE_BASE_Y, TEXT_DIM);
      // depletion channel
      const by = y + ROW_H - BAR_BOTTOM_PAD - BAR_H, fw = BAR_W * Math.max(0, Math.min(1, r.ratio));
      g.fillStyle = BAR_BG; g.fillRect(BAR_X, by, BAR_W, BAR_H);
      if (fw > 0) { g.fillStyle = r.low ? GROOVE_LOW : BAR_FILL; g.fillRect(BAR_X, by, fw, BAR_H); }
      g.fillStyle = BAR_LIP_TOP; g.fillRect(BAR_X, by, BAR_W, 1);
      g.fillStyle = BAR_LIP_BOT; g.fillRect(BAR_X, by + BAR_H - 1, BAR_W, 1);
    }
    function drawStrip(g, top) {
      plate(g, 0, top, WIDTH, STRIP_H, STRIP_CUT);
      groove(g, GROOVE_X, top + STRIP_GROOVE_Y, GROOVE_W, STRIP_GROOVE_H, GROOVE_IRON);
      const ct = '+' + extra.length, cw = P.width(g, ct, F_COUNT, 1);
      engrave(g, ct, F_COUNT, WIDTH - RIGHT_PAD - cw, top + STRIP_H * 0.5 + 4, TEXT_DIM, 1);
      let x = WELL_X;
      const limit = WIDTH - RIGHT_PAD - cw - MINI_GAP * 2;
      for (const r of extra) {
        if (x + MINI_ICON > limit) break;
        g.fillStyle = WELL_RAMP[0][1]; g.fillRect(x, top + STRIP_GROOVE_Y, MINI_ICON, MINI_ICON);
        const ic = icon(r.id, r.iconHTML);
        if (ic) g.drawImage(ic, x, top + STRIP_GROOVE_Y, MINI_ICON, MINI_ICON);
        x += MINI_ICON + MINI_GAP;
      }
    }
    function draw() {
      const g = surf.begin();
      let y = 0;
      for (const r of rows) { drawRow(g, r, y); y += PITCH; }
      if (extra.length) drawStrip(g, y);
    }
    function layout() {
      const h = columnHeight(rows.length, extra.length > 0);
      if (h !== colH) { colH = h; surf.resize(hud.s || 1, WIDTH + PADL + 1, PADT + h + PADB); }
      let y = 0, i = 0;
      for (const r of rows) {
        const d = hitFor(i++);
        d._id = r.id; d._extra = false; d.hidden = false;
        d.style.top = 'calc(' + (PADT + y) + 'px * var(--s))'; d.style.height = 'calc(' + ROW_H + 'px * var(--s))';
        y += PITCH;
      }
      if (extra.length) {
        const d = hitFor(i++);
        d._id = null; d._extra = true; d.hidden = false;
        d.style.top = 'calc(' + (PADT + y) + 'px * var(--s))'; d.style.height = 'calc(' + STRIP_H + 'px * var(--s))';
      }
      for (; i < hits.length; i++) { if (!hits[i].hidden && hud.tips.anchor === hits[i]) hud.tips.hide(); hits[i].hidden = true; }
    }

    let lastLayout = '';
    const api = {
      set(buffs) {
        const list = (buffs || []).filter((b) => b && b.id !== undefined && !(b.dur > 0 && !(b.left > 0)));
        const live = {};
        for (const b of list) {
          live[b.id] = true;
          data[b.id] = b;
          if (order.indexOf(b.id) < 0) { order.push(b.id); enter[b.id] = 0; }
        }
        if (order.some((id) => !live[id])) {
          order = order.filter((id) => live[id]);
          for (const id in data) if (!live[id]) { delete data[id]; delete enter[id]; delete icons[id]; }
        }
        const all = order.map((id) => {
          const b = data[id], ms = Math.max(0, (+b.left || 0) * 1000), dur = +b.dur || 0;
          return { id, name: b.name || '', iconHTML: b.iconHTML || '', desc: b.desc || '', dur, ms, ratio: dur > 0 ? ms / (dur * 1000) : 0, low: ms <= LOW_MS };
        });
        if (all.length <= MAX_ROWS) { rows = all; extra = []; } else { rows = all.slice(0, OVERFLOW_HEAD); extra = all.slice(OVERFLOW_HEAD); }
        root.hidden = !rows.length;
        const lk = rows.map((r) => r.id).join(',') + '|' + extra.length;
        if (lk !== lastLayout) { lastLayout = lk; layout(); dirty = true; }
        let k = '';
        for (const r of rows) k += r.id + ':' + Math.ceil(r.ms / 1000) + ':' + Math.floor(r.ratio * BAR_W) + ':' + (r.low ? 1 : 0) + ':' + r.name + ':' + r.desc + ';';
        k += '+' + extra.map((r) => r.id).join(',');
        if (k !== sig) {
          sig = k; dirty = true;
          if (hud.tips.anchor && hud.tips.anchor.classList && hud.tips.anchor.classList.contains('ath-fx-hit')) hud.tips.refresh();
        }
      },
      frame(dt) {
        let moving = false;
        for (const r of rows) {
          const t = enter[r.id];
          if (t !== undefined && t < 1) { enter[r.id] = Math.min(1, t + (dt || 0) / ENTER_S); moving = true; }
        }
        if ((dirty || moving) && !root.hidden) { dirty = false; draw(); }
      },
      resize(s) { surf.resize(s); dirty = true; },
    };
    surf.resize(hud.s || 1);
    return api;
  }

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.effects = EffectsPart;
})(window);
