/* TDS - shared Canvas2D material recipes for the HUD, ported 1:1 from the Atherion UI (Godot):
 *   chat_plate.gd (face / rim ramps, body, raised, well, seam, inlay groove, engraved + haloed text, nail)
 *   login_ornate.gd (octagon, diamond) · ufuk_style.gd (palette, baseline halo text, frame1, double edge, soft shadow)
 *   mob_global_config.gd (threat colours) · number_format.gd (TR grouping).
 * Units are Atherion canvas px (designed at 1920x1080); a Surface maps them to CSS px with the HUD scale (hud.s) and devicePixelRatio.
 * Every HUD part (ui/*.js) draws with these recipes instead of inventing new ones. Global: HUDPaint.
 */
(function (global) {
  'use strict';

  /* ---------- palette ---------- */
  const C = {
    // chat_plate.gd ("Kül ve Kehribar": HUD widget family)
    ASH: '#958365', ASH_HI: '#E3D3B7', BONE: '#C4B69A', AMBER: '#E2C78F', AMBER_LIT: '#F4E3BC', TEXT_OFF: '#5B544C',
    NAIL_DARK: '#130B04', NAIL_LIT: '#CEBD9D', DANGER: '#C2564E',
    // ufuk_style.gd ("Ufuk": frameless HUD language)
    U_BONE: '#ECE3D0', U_ASH: '#B4A792', U_SOFT: 'rgba(180,167,146,.72)', U_DIM: 'rgba(236,227,208,.38)', U_AMBER: '#E3AF55', U_BAD: '#D2574A',
    // mob threat (level difference)
    T_GREY: '#9C978C', T_GREEN: '#A9C98F', T_YELLOW: '#ECE3D0', T_ORANGE: '#E3AF55', T_RED: '#E0664F',
  };
  // vertical ramps: [offset, colour]
  const FACE = [[0, '#1E1309'], [0.55, '#110A02'], [1, '#170E05']];
  const RIM = [[0, 'rgba(227,211,183,.30)'], [0.26, 'rgba(227,211,183,.04)'], [0.74, 'rgba(0,0,0,.46)'], [1, 'rgba(0,0,0,.76)']];
  const HALO = { WIDE: 6, WIDE_A: 0.20, TIGHT: 3, TIGHT_A: 0.45 };

  /* ---------- colour helpers ---------- */
  function hexRGB(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  // rgba('#E3D3B7', .3) — also accepts 'rgba(...)' strings (alpha multiplied)
  function rgba(c, a) {
    if (a === undefined) a = 1;
    if (c[0] === '#') { const [r, g, b] = hexRGB(c); return 'rgba(' + r + ',' + g + ',' + b + ',' + (+a).toFixed(4) + ')'; }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c;
    const p = m[1].split(',').map((s) => +s);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + ((p.length > 3 ? p[3] : 1) * a).toFixed(4) + ')';
  }
  function mix(c1, c2, t) {
    const a = hexRGB(c1), b = hexRGB(c2), k = Math.max(0, Math.min(1, t));
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
  }
  // Godot Color.darkened(k): rgb * (1 - k)
  function darkened(c, k) { const [r, g, b] = hexRGB(c); return '#' + [r, g, b].map((v) => Math.round(v * (1 - k)).toString(16).padStart(2, '0')).join(''); }

  /* ---------- geometry ---------- */
  // login_ornate.octagon: all four corners chamfered by `cut` (clamped 2 .. min(w,h)/2)
  function octPath(g, x, y, w, h, cut, keep) {
    const c = Math.max(2, Math.min(cut, Math.min(w, h) * 0.5));
    if (!keep) g.beginPath();
    g.moveTo(x + c, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c);
    g.lineTo(x + w - c, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c); g.closePath();
  }
  function circlePath(g, cx, cy, r) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath(); }
  function diamond(g, cx, cy, r, col) {
    g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
    g.fillStyle = col; g.fill();
  }
  // vertical gradient over [y0, y0+h] from [[t, colour], ...]
  function vgrad(g, y0, h, stops) {
    const gr = g.createLinearGradient(0, y0, 0, y0 + Math.max(h, 1));
    for (const [t, c] of stops) gr.addColorStop(t, c);
    return gr;
  }
  // chat_plate.fill_ramp: fill the CURRENT path with a vertical ramp, modulated by alpha
  function fillRamp(g, y0, h, stops, alpha) {
    g.save(); g.globalAlpha *= (alpha === undefined ? 1 : alpha); g.fillStyle = vgrad(g, y0, h, stops); g.fill(); g.restore();
  }

  /* ---------- materials (chat_plate.gd) ---------- */
  // plate body: rim ramp + face 1.5 px inside (the ramp reads as an edge; no separate frame line)
  function body(g, x, y, w, h, cut, faceA, rimA) {
    octPath(g, x, y, w, h, cut); fillRamp(g, y, h, RIM, rimA === undefined ? 1 : rimA);
    octPath(g, x + 1.5, y + 1.5, w - 3, h - 3, cut - 1.5); fillRamp(g, y + 1.5, h - 3, FACE, faceA === undefined ? 0.9 : faceA);
  }
  // raised face: ink ramp + 1 px top rim (between the chamfers)
  function raised(g, x, y, w, h, cut, faceA, rimA) {
    octPath(g, x, y, w, h, cut); fillRamp(g, y, h, FACE, faceA);
    g.fillStyle = rgba(C.ASH_HI, rimA); g.fillRect(x + cut, y, w - cut * 2, 1);
  }
  // well (carved): dark fill + dark top lip + light bottom lip
  function well(g, x, y, w, h, cut, fillA, lipTopA, lipBotA) {
    if (w <= cut * 2 || h <= 2) return;
    octPath(g, x, y, w, h, cut); g.fillStyle = 'rgba(0,0,0,' + fillA + ')'; g.fill();
    const iw = w - cut * 2;
    g.fillStyle = 'rgba(0,0,0,' + lipTopA + ')'; g.fillRect(x + cut, y, iw, 1);
    if (lipBotA > 0) { g.fillStyle = rgba(C.ASH_HI, lipBotA); g.fillRect(x + cut, y + h - 1, iw, 1); }
  }
  // action_bar_plate.draw_knob: rim ramp + face 1.5 px inside + 1 px dark outline outside
  function knob(g, x, y, w, h, cut, faceA, rimMul) {
    octPath(g, x, y, w, h, cut); fillRamp(g, y, h, RIM, rimMul === undefined ? 1 : rimMul);
    octPath(g, x + 1.5, y + 1.5, w - 3, h - 3, cut - 1.5); fillRamp(g, y, h, FACE, faceA === undefined ? 0.97 : faceA);
    octPath(g, x - 0.5, y - 0.5, w + 1, h + 1, cut + 0.5); g.strokeStyle = 'rgba(0,0,0,.60)'; g.lineWidth = 1; g.stroke();
  }
  // nail head: dark diamond + small lit diamond
  function nail(g, cx, cy, r, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    diamond(g, cx, cy, r, rgba(C.NAIL_DARK, a));
    diamond(g, cx, cy - 0.7, r * 0.52, rgba(C.NAIL_LIT, a));
  }
  // hairline with faded ends and a flat middle
  function seam(g, x0, x1, y, peak) {
    if (x1 - x0 < 8) return;
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, rgba(C.ASH, 0)); gr.addColorStop(0.24, rgba(C.ASH, peak)); gr.addColorStop(0.76, rgba(C.ASH, peak)); gr.addColorStop(1, rgba(C.ASH, 0));
    g.fillStyle = gr; g.fillRect(x0, y, x1 - x0, 1);
  }
  // inlay groove (3 px vertical stripe): dark bed -> colour -> light right lip
  function inlay(g, x, y, h, col, alpha, w) {
    const W = w || 3;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x - 1, y - 1, W + 2, h + 2);
    g.fillStyle = rgba(col, alpha); g.fillRect(x, y, W, h);
    g.fillStyle = rgba(C.ASH_HI, 0.14); g.fillRect(x + W, y, 1, h);
  }
  // ufuk_style.frame1 / double_edge / soft_shadow (1 px frames on the INSIDE of the rect)
  function frame1(g, x, y, w, h, col) {
    g.fillStyle = col;
    g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y + 1, 1, h - 2); g.fillRect(x + w - 1, y + 1, 1, h - 2);
  }
  function doubleEdge(g, x, y, w, h, innerA) {
    frame1(g, x - 1, y - 1, w + 2, h + 2, 'rgba(0,0,0,.62)');
    frame1(g, x, y, w, h, rgba(C.U_BONE, innerA === undefined ? 0.42 : innerA));
  }
  function softShadow(g, x, y, w, h, radius, alpha) {
    for (let i = radius; i > 0; i--) { const k = 1 - i / (radius + 1); frame1(g, x - i, y - i, w + i * 2, h + i * 2, 'rgba(0,0,0,' + (alpha * 0.30 * k * k).toFixed(4) + ')'); }
  }

  /* ---------- text ---------- */
  // fonts: Cinzel (titles, key chips; its lowercase is small caps), Alegreya (serif numbers / body), Alegreya Sans (HUD numbers)
  const F = {
    cinzel: (w, px) => w + ' ' + px + 'px Cinzel, Georgia, serif',
    serif: (w, px) => w + ' ' + px + 'px Alegreya, Georgia, serif',
    sans: (w, px) => w + ' ' + px + 'px "Alegreya Sans", "Segoe UI", sans-serif',
    sansItalic: (w, px) => 'italic ' + w + ' ' + px + 'px "Alegreya Sans", "Segoe UI", sans-serif',
  };
  const metricCache = new Map();
  function setFont(g, font, tracking) { g.font = font; g.letterSpacing = (tracking || 0) + 'px'; g.textBaseline = 'alphabetic'; g.textAlign = 'left'; }
  // font ascent / descent (Godot TextLine.get_line_ascent / descent)
  function metrics(g, font) {
    let m = metricCache.get(font);
    if (!m) { g.save(); g.font = font; const t = g.measureText('Hg'); m = { a: t.fontBoundingBoxAscent, d: t.fontBoundingBoxDescent }; g.restore(); if (document.fonts && document.fonts.status === 'loaded') metricCache.set(font, m); }
    return m;
  }
  function width(g, text, font, tracking) { g.save(); setFont(g, font, tracking); const w = g.measureText(text).width; g.restore(); return w; }
  const alignX = (x, w, align) => (align === 0 ? x - w * 0.5 : align > 0 ? x - w : x);   // align undefined = left
  // ENGRAVED (chat_plate.draw_engraved_left): no outline, 1 px hard shadow below. Vertically centred on cy like Godot.
  // align: -1 left (x = left edge) · 0 centre · 1 right (x = right edge). Returns the width.
  function engraved(g, text, font, x, cy, col, align, tracking, shadowA) {
    g.save(); setFont(g, font, tracking);
    const w = g.measureText(text).width, m = metrics(g, font), left = alignX(x, w, align);
    const base = cy + (m.a - m.d) * 0.5;
    const a = colAlpha(col);
    g.fillStyle = 'rgba(0,0,0,' + ((shadowA === undefined ? 0.94 : shadowA) * a).toFixed(3) + ')'; g.fillText(text, left, base + 1);
    g.fillStyle = col; g.fillText(text, left, base);
    g.restore(); return w;
  }
  // HALOED (chat_plate.draw_haloed_left): wide + tight soft dark outlines under an engraved line. halo 0..1.
  function haloed(g, text, font, x, cy, col, align, tracking, halo) {
    const h = (halo === undefined ? 1 : halo) * colAlpha(col);
    if (h > 0) {
      g.save(); setFont(g, font, tracking);
      const w = g.measureText(text).width, m = metrics(g, font), left = alignX(x, w, align);
      const base = cy + (m.a - m.d) * 0.5;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,' + (HALO.WIDE_A * h).toFixed(3) + ')'; g.lineWidth = HALO.WIDE; g.strokeText(text, left, base);
      g.strokeStyle = 'rgba(0,0,0,' + (HALO.TIGHT_A * h).toFixed(3) + ')'; g.lineWidth = HALO.TIGHT; g.strokeText(text, left, base);
      g.restore();
    }
    return engraved(g, text, font, x, cy, col, align, tracking);
  }
  // UFUK text (ufuk_style.text): positioned by BASELINE; halo + .55 drop shadow. Returns width.
  function ufuk(g, text, font, x, baseline, col, align, halo, tracking) {
    g.save(); setFont(g, font, tracking);
    const w = g.measureText(text).width, left = Math.round(alignX(x, w, align)), base = Math.round(baseline);
    const h = (halo === undefined ? 1 : halo) * colAlpha(col);
    if (h > 0) {
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,' + (HALO.WIDE_A * h).toFixed(3) + ')'; g.lineWidth = HALO.WIDE; g.strokeText(text, left, base);
      g.strokeStyle = 'rgba(0,0,0,' + (HALO.TIGHT_A * h).toFixed(3) + ')'; g.lineWidth = HALO.TIGHT; g.strokeText(text, left, base);
      g.fillStyle = 'rgba(0,0,0,' + (0.55 * h).toFixed(3) + ')'; g.fillText(text, left, base + 1);
    }
    g.fillStyle = col; g.fillText(text, left, base);
    g.restore(); return w;
  }
  function colAlpha(col) { const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(col); return m ? +m[1] : 1; }

  /* ---------- surface: a HUD canvas in design px ---------- */
  // surface(parent, cls, w, h, ox, oy): canvas covering design rect (-ox, -oy, w, h) -> local design coords start at (0,0) = origin.
  // begin() clears and sets the transform for the current HUD scale + DPR; call resize() when the HUD scale changes.
  function surface(parent, cls, w, h, ox, oy) {
    const el = document.createElement('canvas');
    el.className = cls || '';
    el.style.fontVariantNumeric = 'lining-nums tabular-nums';     // Atherion draws boxed numbers with lnum + tnum (canvas text inherits it)
    if (parent) parent.appendChild(el);
    const S = { el, g: el.getContext('2d'), w, h, ox: ox || 0, oy: oy || 0, s: 1, dpr: 1 };
    S.resize = function (scale, nw, nh) {
      if (nw !== undefined) S.w = nw;
      if (nh !== undefined) S.h = nh;
      S.s = scale || S.s; S.dpr = Math.min(2, global.devicePixelRatio || 1);
      const k = S.s * S.dpr, bw = Math.max(1, Math.round(S.w * k)), bh = Math.max(1, Math.round(S.h * k));
      if (el.width !== bw) el.width = bw;
      if (el.height !== bh) el.height = bh;
      el.style.width = (S.w * S.s) + 'px'; el.style.height = (S.h * S.s) + 'px';
    };
    S.begin = function () {
      const k = S.s * S.dpr;
      S.g.setTransform(1, 0, 0, 1, 0, 0); S.g.clearRect(0, 0, el.width, el.height);
      S.g.setTransform(k, 0, 0, k, S.ox * k, S.oy * k);
      return S.g;
    };
    S.resize(1);
    return S;
  }

  /* ---------- small rules ---------- */
  // mob_global_config.threat_color(level_diff)  (grey at diff <= -8)
  function threat(diff) {
    if (diff <= -8) return C.T_GREY;
    if (diff <= -2) return C.T_GREEN;
    if (diff <= 1) return C.T_YELLOW;
    if (diff <= 4) return C.T_ORANGE;
    return C.T_RED;
  }
  // number_format.stat (TR): 12.340 · %62,4
  function num(v, decimals) {
    const d = Math.max(0, decimals | 0), s = Math.abs(v).toFixed(d), [ip, fp] = s.split('.');
    const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (v < 0 && +s !== 0 ? '−' : '') + grouped + (fp ? ',' + fp : '');
  }
  const pct = (v, decimals) => '%' + num(v, decimals === undefined ? 1 : decimals);

  // redraw every surface once the web fonts arrive (canvas text does not re-layout by itself)
  const fontWaiters = [];
  function onFonts(fn) { fontWaiters.push(fn); }
  if (document.fonts) {
    const fire = () => { metricCache.clear(); fontWaiters.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };
    document.fonts.ready.then(fire);
    document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', fire);
    ['600 10px Cinzel', '700 10px Cinzel', '500 10px Cinzel', '500 10px Alegreya', '700 10px Alegreya', '500 10px "Alegreya Sans"', '700 10px "Alegreya Sans"', '800 10px "Alegreya Sans"']
      .forEach((f) => document.fonts.load(f).catch(() => {}));
  }

  global.HUDPaint = {
    C, FACE, RIM, HALO, F,
    rgba, mix, darkened, hexRGB,
    octPath, circlePath, diamond, vgrad, fillRamp,
    body, raised, well, knob, nail, seam, inlay, frame1, doubleEdge, softShadow,
    setFont, metrics, width, engraved, haloed, ufuk,
    surface, threat, num, pct, onFonts,
  };
})(window);
