/* TDS HUD part — character window (slot `charwin`, window id 'char', key P), ported from Atherion's stat drawer v1 "Sicil Defteri"
 * (stat_ekrani_tasarim.html; the GDScript is the source of truth):
 *   stat_view.gd            draw order (head band → identity → ledger → footer), ledger hover well + source groove, close glyph, card placement
 *   stat_sheet_style.gd     geometry (600 px reference canvas, sheet 564 wide at (18, 18), 22 px ruling grid), class-dyed cover ramp, formats
 *   quest_leaf.gd           the material: leather board (cover ramp + tooled line), deckle-edged vellum sheet, contact shadow + rim rings,
 *                           feather, grain, foxing, ruling, vignette, iron corner clips + nails; rule / well / socket / notched bar recipes.
 *                           Seeded randomness = Godot's RandomNumberGenerator (PCG32, randf with the CLZ trick), same seeds 90210 / 1234 / 4711.
 *   stat_breakdown_card.gd + kunye_plate.gd   the "künye" card that opens beside the drawer while a ledger row is hovered
 *   stat_controller.gd      0.22 s cubic slide in from / out to the left screen edge
 * Real data only. The sheet shows what the game has: level, EXP, class + title, and a two-column ledger
 *   Saldırı: attack speed, damage multiplier, crit chance, crit damage · Havuzlar: max HP, max mana · Korunma: damage taken, absorb, HP / mana regen.
 * Omitted (the game has none): the attribute block (STR/AGI/... rows, yields, points stamp, [+] plates), equipment / level / attribute breakdown rows,
 * caps, the vigilance card, "Yol ve Kazanç" (move speed, XP / gold / drop bonus), the reset hint. Rows lit by an active effect show it like a "fed"
 * row (long groove + pencil delta). The sheet is as tall as its content (Atherion's 1044 px sheet is filled by the attribute block).
 * Registers HUDParts.charwin: { setInfo(info), update(state, dt), frame(dt), resize(s) }.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint;
  const TAU = Math.PI * 2;

  /* ---------- palette (quest_leaf.gd, kunye_plate.gd) — Godot float colours ---------- */
  const BOARD_HI = [0.353, 0.290, 0.220], BOARD = [0.227, 0.180, 0.133], BOARD_LO = [0.125, 0.098, 0.075];
  const VELLUM_HI = [0.914, 0.878, 0.792], VELLUM = [0.867, 0.816, 0.698], VELLUM_LO = [0.812, 0.753, 0.612];
  const INK = [0.227, 0.173, 0.078], INK_BODY = [0.290, 0.231, 0.133], INK_FAINT = [0.420, 0.353, 0.235], TOOLED = [0.851, 0.796, 0.682];
  const IRON = [0.333, 0.282, 0.227], IRON_HI = [0.549, 0.486, 0.400], IRON_DARK = [0.180, 0.149, 0.098], FOX = [0.478, 0.353, 0.173];
  const EDGE_DARK = [0.153, 0.126, 0.086], GROOVE_ACTIVE = [0.478, 0.416, 0.306], GROOVE_READY = [0.247, 0.420, 0.227];
  const K_INK = [0.063, 0.039, 0.016], K_ASH = [0.584, 0.514, 0.396], K_ASH_HI = [0.890, 0.827, 0.718], K_BONE = [0.769, 0.714, 0.604];
  const K_OFF = [0.431, 0.396, 0.357], K_AMBER = [0.886, 0.780, 0.561];
  const BLACK = [0, 0, 0];
  const css = (c, a) => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a === undefined ? 1 : +(+a).toFixed(4)) + ')';
  const lerpC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /* ---------- class cover (stat_sheet_style.cover_ramp; accents = PlayerClassRegistry.CLASS_ACCENT) ---------- */
  const CLASS_ACCENT = { knight: [0.60, 0.67, 0.72], mage: [0.604, 0.510, 0.874], archer: [0.361, 0.710, 0.529] };
  const CLASS_OF = { 'savaşçı': 'knight', 'şövalye': 'knight', warrior: 'knight', knight: 'knight', 'büyücü': 'mage', mage: 'mage', 'okçu': 'archer', archer: 'archer' };
  const DYE_S_MIN = 0.28, DYE_S_MAX = 0.45, DYE_HI_V = 0.37, DYE_MID_V = 0.235, DYE_LO_V = 0.12, DYE_HI_S_SCALE = 0.85;
  function hsvOf(c) {                                              // Godot Color.h / .s
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
    let h = 0;
    if (d > 0) { h = mx === c[0] ? (c[1] - c[2]) / d : mx === c[1] ? 2 + (c[2] - c[0]) / d : 4 + (c[0] - c[1]) / d; h /= 6; if (h < 0) h += 1; }
    return { h, s: mx > 0 ? d / mx : 0 };
  }
  function fromHsv(h, s, v) {                                      // Godot Color.from_hsv
    if (s === 0) return [v, v, v];
    h = (h * 6) % 6; const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  }
  function coverRamp(info) {
    const key = CLASS_OF[String((info && (info.cls || info.name)) || '').toLocaleLowerCase('tr-TR')];
    const acc = CLASS_ACCENT[key];
    if (!acc) return [BOARD_HI, BOARD, BOARD_LO];
    const hs = hsvOf(acc), s = Math.min(DYE_S_MAX, Math.max(DYE_S_MIN, hs.s));
    return [fromHsv(hs.h, s * DYE_HI_S_SCALE, DYE_HI_V), fromHsv(hs.h, s, DYE_MID_V), fromHsv(hs.h, s, DYE_LO_V)];
  }

  /* ---------- Godot RandomNumberGenerator (core/math/random_pcg.h + thirdparty/misc/pcg.cpp) ---------- */
  const M64 = (1n << 64n) - 1n, PCG_MUL = 6364136223846793005n, PCG_INC = 1442695040888963407n;
  function Rng(seed) {
    const inc = ((PCG_INC << 1n) | 1n) & M64;
    let state = 0n;
    const next = () => {
      const old = state;
      state = (old * PCG_MUL + inc) & M64;
      const xs = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn), rot = Number(old >> 59n);
      return ((xs >>> rot) | (xs << ((32 - rot) & 31))) >>> 0;
    };
    next(); state = (state + BigInt(seed)) & M64; next();       // pcg32_srandom_r(seed, DEFAULT_INC)
    return {
      randf() {                                                   // RandomPCG::randf: exponent from CLZ of one draw, mantissa from the next
        const proto = next();
        if (proto === 0) return 0;
        return Math.fround((next() | 0x80000001) >>> 0) * Math.pow(2, -32 - Math.clz32(proto));
      },
    };
  }

  /* ---------- geometry (stat_sheet_style.gd · quest_leaf.gd), sheet-local px ---------- */
  const REF_W = 600, PX = 18, PY = 18, SW = 564;
  const CUT = 12, TOOL_INSET = 9, HEAD_H = 52, SHEET_X = 20, SIDE_PAD = 20, FOOT_PAD = 24;
  const DECKLE = 0.62, DECKLE_WAVE = 0.95, DECKLE_WAVE_FREQ = 0.085, DECKLE_STEP = 7, CLIP = 24, CLIP_NAIL_R = 2.6;
  const RULE_STEP = 22, MARGIN_X = 36, TITLE_X = 36, LIST_TOP = 68, BAR_TICKS = 3;
  const GRAIN_A = 0.065, VIGN_A = 0.16, RULE_A = 0.05, SEED_DECKLE = 90210, SEED_FOX = 1234, GRAIN_SIZE = 128, GRAIN_SEED = 4711, GRAIN_OFFSET = [37, 53];
  const SHADOW_RINGS = [[7.0, 0.05], [5.6, 0.07], [4.3, 0.09], [3.2, 0.12]], SHADOW_BIAS_Y = 1.2;
  const FEATHER = [[5.0, 0.10], [3.0, 0.14], [1.6, 0.20]], RIM_RINGS = [[2.4, 0.22], [1.5, 0.46], [0.7, 0.70]];
  const TEXT_X = 46, RIGHT = 528, NAME_FS = 18, CLOSE_C = [534, 27], CLOSE_ARM = 5, CLOSE_HIT = 30;
  const LEVEL_C = [64, 110], LEVEL_R = 18, LEVEL_FS = 15, CLASS_X = 94, CLASS_BASE = 108, CLASS_FS = 13, EXP_FS = 12, EXP_Y = 117, EXP_H = 5;
  const RULE1_Y = 156, GROUP_FS = 11, LEDGER_FS = 13, GUTTER = 38, DELTA_FS = 11, COLS = [[46, 276], [298, 528]], VRULE_X = 287;
  const FOOT_CX = 282, FOOT_FS = 12, FOOT_AFTER_LEDGER = 2 * RULE_STEP - 5, FOOT_TO_SHEET_END = 32;
  const ITALIC_SKEW = 0.18;
  // breakdown card (stat_breakdown_card.gd + kunye_plate.gd)
  const CARD_GAP = 12, CARD_ROW_LIFT = 40, CARD_W = 276, CARD_CUT = 9;
  const KC = { TEXT_X: 24, RIGHT_PAD: 28, TITLE_BASE: 27, TITLE_FS: 13, TITLE_RULE_Y: 37, ROWS_BASE: 58, ROW_STEP: 20, ROW_FS: 13, SEP_AFTER_ROWS: 11,
    TOTAL_AFTER_SEP: 25, TOTAL_LABEL_FS: 11, TOTAL_VALUE_FS: 15, PROSE_AFTER_TOTAL: 22, BOTTOM_PAD: 16, GROOVE_X: 10, GROOVE_INSET_Y: 12, GROOVE_W: 4,
    RIVET_R: 3, RIVET_D: 12.5, PROSE_FS: 13, PROSE_LINE_H: 17, PROSE_INDENT: 10, PROSE_NOTCH: 3, PROSE_NOTCH_RISE: 8 };
  const CARD_GROOVE = lerpC([0.584, 0.514, 0.396], [0.890, 0.827, 0.718], 0.30);   // card_groove_color(<no attribute>)
  // motion (stat_controller.gd)
  const SLIDE = 0.22, CLOSED_MARGIN = 24, REFRESH = 0.25;

  /* ---------- the ledger: only what the game reports ---------- */
  const STAT = {
    attackSpeed: { name: 'Saldırı Hızı', prose: 'Saldırı hareketinin temposu' },
    damageMul: { name: 'Hasar Çarpanı', prose: 'Verdiğin bütün hasarın çarpanı' },
    critChance: { name: 'Kritik Şans', prose: 'Kritik vuruş olasılığı' },
    critDamage: { name: 'Kritik Hasar', prose: 'Kritik vuruşun hasara eklediği pay' },
    maxHp: { name: 'Azami Can', prose: 'Can havuzunun üst sınırı' },
    maxMp: { name: 'Azami Mana', prose: 'Mana havuzunun üst sınırı' },
    damageTaken: { name: 'Alınan Hasar', prose: 'Gelen hasarın sana işleyen payı' },
    absorb: { name: 'Emilim Kalkanı', prose: 'Hasarı candan önce karşılayan kalkan' },
    hpRegen: { name: 'Can Yenilenmesi', prose: 'Savaş dışında saniyede yenilenen can, azami canın yüzdesi olarak' },
    mpRegen: { name: 'Mana Yenilenmesi', prose: 'Saniyede yenilenen mana' },
  };
  const LEDGER = [
    [['Saldırı', ['attackSpeed', 'damageMul', 'critChance', 'critDamage']], ['Havuzlar', ['maxHp', 'maxMp']]],
    [['Korunma', ['damageTaken', 'absorb', 'hpRegen', 'mpRegen']]],
  ];
  const FOOT_TEXT = 'Can yenilenmesi yalnız savaş dışında işler.';

  /* ---------- fonts (stat_view.setup: caps Cinzel 600 · body Alegreya 500 · num 600 / 700 lining · fake italic) ---------- */
  const fCaps = (px) => P.F.cinzel(600, px), fBody = (px) => P.F.serif(500, px), fNum = (px) => P.F.serif(600, px), fNumBold = (px) => P.F.serif(700, px);
  const fCardNum = (px) => P.F.serif(500, px);

  /* ---------- geometry helpers ---------- */
  function octPts(x, y, w, h, cut) {                               // login_ornate.octagon, shifted
    const c = Math.max(2, Math.min(cut, Math.min(w, h) * 0.5));
    return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
  }
  function path(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  function diamond(g, cx, cy, r, fill) { g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fillStyle = fill; g.fill(); }
  function vramp(g, y0, h, stops) { const gr = g.createLinearGradient(0, y0, 0, y0 + Math.max(h, 1)); for (const [t, c] of stops) gr.addColorStop(t, c); return gr; }
  // Geometry2D.offset_polygon stand-in: every vertex moves along its mitred outward normal (the deckle is clockwise on screen, so
  // (d.y, -d.x) points out). Small concave fibres may fold; the rings are filled non-zero, so a fold only fills itself.
  function grow(pts, amount, biasY) {
    const n = pts.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      let d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = c[0] - b[0], d2y = c[1] - b[1];
      const l1 = Math.hypot(d1x, d1y) || 1, l2 = Math.hypot(d2x, d2y) || 1;
      const n1x = d1y / l1, n1y = -d1x / l1, n2x = d2y / l2, n2y = -d2x / l2;
      let mx = n1x + n2x, my = n1y + n2y; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      const k = Math.min(2, 1 / Math.max(0.5, mx * n1x + my * n1y));
      out[i] = [b[0] + mx * amount * k, b[1] + my * amount * k + biasY];
    }
    return out;
  }

  /* ---------- grain (quest_leaf._make_grain_texture): 128² native alpha noise, built once ---------- */
  let grainTiles = null;
  function grain() {
    if (grainTiles) return grainTiles;
    const rng = Rng(GRAIN_SEED), N = GRAIN_SIZE, alpha = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) alpha[i] = rng.randf();
    // draw_texture_rect(..., modulate): texel (0.337 grey, a) × modulate colour / alpha
    const tile = (tint, a) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = N;
      const cx = cv.getContext('2d'), im = cx.createImageData(N, N);
      const r = Math.round(0.337 * tint[0] * 255), gg = Math.round(0.337 * tint[1] * 255), b = Math.round(0.337 * tint[2] * 255);
      for (let i = 0; i < N * N; i++) { const o = i * 4; im.data[o] = r; im.data[o + 1] = gg; im.data[o + 2] = b; im.data[o + 3] = Math.round(alpha[i] * a * 255); }
      cx.putImageData(im, 0, 0);
      return cv;
    };
    grainTiles = [tile(INK, GRAIN_A), tile(VELLUM_HI, GRAIN_A * 0.7)];
    return grainTiles;
  }

  /* ---------- QuestLeaf (the parts the stat drawer uses), built once per size + cover ---------- */
  function Leaf(w, h, ramp) {
    const r = { x: SHEET_X, y: HEAD_H, w: Math.max(w - SHEET_X - SIDE_PAD, 1), h: Math.max(h - HEAD_H - FOOT_PAD, 1) };
    // deckle (two octaves: slow wave + fibre), seeded
    const rng = Rng(SEED_DECKLE), deckle = [];
    const edge = (ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      if (len <= 0.001) return;
      const n = Math.max(2, Math.round(len / DECKLE_STEP)), nx = dy / len, ny = -dx / len, phase = rng.randf() * TAU;
      for (let i = 0; i < n; i++) {
        const t = i / n, wave = Math.sin(len * t * DECKLE_WAVE_FREQ + phase) * DECKLE_WAVE, fibre = (rng.randf() * 2 - 1) * DECKLE;
        deckle.push([ax + dx * t + nx * (wave + fibre), ay + dy * t + ny * (wave + fibre)]);
      }
    };
    const x1 = r.x + r.w, y1 = r.y + r.h;
    edge(r.x, r.y, x1, r.y); edge(x1, r.y, x1, y1); edge(x1, y1, r.x, y1); edge(r.x, y1, r.x, r.y);
    const fr = Rng(SEED_FOX), fox = [];
    for (let i = 0; i < 5; i++) fox.push([r.x + 18 + fr.randf() * Math.max(r.w - 36, 1), r.y + 24 + fr.randf() * Math.max(r.h - 48, 1), 16 + fr.randf() * 24]);
    return {
      w, h, r, deckle, fox, boardHi: ramp[0], ramp,
      shadow: SHADOW_RINGS.map(([a]) => grow(deckle, a, SHADOW_BIAS_Y)),
      rims: RIM_RINGS.map(([a]) => grow(deckle, a, 0)),
    };
  }
  function drawBoard(g, L) {
    const pts = octPts(0, 0, L.w, L.h, CUT);
    path(g, pts); g.fillStyle = vramp(g, 0, L.h, [[0, css(L.ramp[0])], [0.045, css(L.ramp[1])], [0.72, css(L.ramp[1])], [1, css(L.ramp[2])]]); g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,.75)'; g.stroke();
    const t = TOOL_INSET;                                          // tooled groove: 1 px dark + 1 px light
    path(g, octPts(t, t, L.w - t * 2, L.h - t * 2, CUT - 3)); g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
    path(g, octPts(t + 1, t + 1, L.w - (t + 1) * 2, L.h - (t + 1) * 2, CUT - 4)); g.strokeStyle = css(L.boardHi, 0.44); g.stroke();
  }
  function drawSheet(g, L) {
    const r = L.r;
    L.shadow.forEach((ring, i) => { path(g, ring); g.fillStyle = css(BLACK, SHADOW_RINGS[i][1]); g.fill(); });
    L.rims.forEach((ring, i) => { path(g, ring); g.fillStyle = css(lerpC(EDGE_DARK, VELLUM, RIM_RINGS[i][1])); g.fill(); });
    path(g, L.deckle); g.fillStyle = vramp(g, r.y, r.h, [[0, css(VELLUM_HI)], [0.45, css(VELLUM)], [1, css(VELLUM_LO)]]); g.fill();
    g.lineJoin = 'round';
    for (const [wd, a] of FEATHER) { path(g, L.deckle); g.lineWidth = wd; g.strokeStyle = css(IRON_DARK, a); g.stroke(); }
    g.lineJoin = 'miter'; g.lineWidth = 1;
    // grain: two tiled passes, the second shifted by a prime offset (its rect moves with it, as in draw_texture_rect)
    const [t1, t2] = grain();
    for (const [tile, ox, oy] of [[t1, 0, 0], [t2, GRAIN_OFFSET[0], GRAIN_OFFSET[1]]]) {
      const pat = g.createPattern(tile, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, r.x + ox, r.y + oy]));
      g.fillStyle = pat; g.fillRect(r.x + ox, r.y + oy, r.w, r.h);
    }
    for (const [bx, by, br] of L.fox) {                              // foxing: soft radial sepia specks
      const gr = g.createRadialGradient(bx, by, 0, bx, by, br);
      gr.addColorStop(0, css(FOX, 0.055)); gr.addColorStop(0.6, css(FOX, 0.055 * 0.45)); gr.addColorStop(1, css(FOX, 0));
      g.fillStyle = gr; g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    g.fillStyle = css(INK_FAINT, RULE_A);                           // ruling: the layout grid
    for (let y = LIST_TOP; y < r.y + r.h - 14; y += RULE_STEP) g.fillRect(r.x + 20, y, r.w - 40, 1);
    g.fillStyle = css(INK, RULE_A * 1.8); g.fillRect(MARGIN_X, r.y + 12, 1, r.h - 24);
    const f = 44, va = css(INK, VIGN_A), vb = css(INK, 0);           // vignette: four short sepia fades
    const quad = (x, y, w, h, x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, va); gr.addColorStop(1, vb); g.fillStyle = gr; g.fillRect(x, y, w, h); };
    quad(r.x, r.y, r.w, f, 0, r.y, 0, r.y + f);
    quad(r.x, r.y + r.h - f, r.w, f, 0, r.y + r.h, 0, r.y + r.h - f);
    quad(r.x, r.y, f, r.h, r.x, 0, r.x + f, 0);
    quad(r.x + r.w - f, r.y, f, r.h, r.x + r.w, 0, r.x + r.w - f, 0);
  }
  function nail(g, cx, cy, rad, onPaper) {
    if (onPaper) { g.beginPath(); g.arc(cx + 0.9, cy + 1.3, rad * 1.15, 0, TAU); g.fillStyle = css(INK, 0.32); g.fill(); }
    diamond(g, cx, cy, rad, css(IRON_DARK)); diamond(g, cx, cy - 0.6, rad * 0.52, css(IRON_HI));
  }
  function drawClips(g, L) {
    const r = L.r;
    [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]].forEach(([ox, oy, sx, sy]) => {
      const pts = [[ox - 5 * sx, oy - 5 * sy], [ox + CLIP * sx, oy - 5 * sy], [ox + CLIP * sx, oy + 2 * sy], [ox + 2 * sx, oy + 2 * sy], [ox + 2 * sx, oy + CLIP * sy], [ox - 5 * sx, oy + CLIP * sy]];
      const gr = g.createLinearGradient(0, oy - 5 * sy, 0, oy + CLIP * sy);    // light from above: t over the clip's own height
      gr.addColorStop(0, css(IRON_HI)); gr.addColorStop(0.12, css(IRON)); gr.addColorStop(1, css(IRON_DARK));
      path(g, pts); g.fillStyle = gr; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.75)'; g.stroke();
      nail(g, ox + 7 * sx, oy + 7 * sy, CLIP_NAIL_R, true);
    });
  }
  // draw_rule: hairline faded at both ends with a flat middle (+ diamond)
  function rule(g, x0, x1, y, peak, dia) {
    if (x1 - x0 < 12) return;
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, css(INK, 0)); gr.addColorStop(0.22, css(INK, peak)); gr.addColorStop(0.78, css(INK, peak)); gr.addColorStop(1, css(INK, 0));
    g.fillStyle = gr; g.fillRect(x0, y, x1 - x0, 1);
    if (!dia) return;
    const cx = (x0 + x1) * 0.5;
    diamond(g, cx, y + 0.5, 3, css(INK, peak + 0.18));
    g.fillStyle = css(VELLUM_HI, 0.5); g.fillRect(cx - 9, y, 18, 1);
  }
  function well(g, x, y, w, h, cut, fillA, topA, botA) {
    if (w <= cut * 2 || h <= 2) return;
    path(g, octPts(x, y, w, h, cut)); g.fillStyle = css(INK, fillA); g.fill();
    g.fillStyle = css(INK, topA); g.fillRect(x + cut, y, w - cut * 2, 1);
    g.fillStyle = css(VELLUM_HI, botA); g.fillRect(x + cut, y + h - 1, w - cut * 2, 1);
  }
  function socket(g, cx, cy, d) {
    const rad = d * 0.5;
    g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.fillStyle = css(INK, 0.14); g.fill();
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, rad, Math.PI, TAU); g.strokeStyle = css(INK, 0.42); g.stroke();
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI); g.strokeStyle = css(VELLUM_HI, 0.55); g.stroke();
  }
  function notchedBar(g, x, y, w, h, t, c) {
    if (w <= 2 || h <= 1) return;
    g.fillStyle = css(INK, 0.13); g.fillRect(x, y, w, h);
    g.fillStyle = css(INK, 0.34); g.fillRect(x, y, w, 1);
    g.fillStyle = css(VELLUM_HI, 0.55); g.fillRect(x, y + h - 1, w, 1);
    const fw = Math.max(0, Math.min(1, t)) * w;
    if (fw > 1) { g.fillStyle = css(c, 0.92); g.fillRect(x, y, fw, h); }
    g.fillStyle = css(INK, 0.26);
    for (let i = 1; i <= BAR_TICKS; i++) g.fillRect(x + w * i / (BAR_TICKS + 1), y, 1, h);
  }
  // stat_view._groove: ink bed + fill + light right lip
  function groove(g, x, y, w, h, c, alpha) {
    g.fillStyle = css(INK, 0.42 * alpha); g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = css(c, alpha); g.fillRect(x, y, w, h);
    g.fillStyle = css(VELLUM_HI, 0.45 * alpha); g.fillRect(x + w, y, 1, h);
  }
  function vrule(g, x, y0, y1, peak) {
    if (y1 - y0 < 12) return;
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, css(INK, 0)); gr.addColorStop(0.12, css(INK, peak)); gr.addColorStop(0.88, css(INK, peak)); gr.addColorStop(1, css(INK, 0));
    g.fillStyle = gr; g.fillRect(x, y0, 1, y1 - y0);
  }

  /* ---------- text (stat_view._text / _caps; draw_string: baseline-positioned, no shadow on paper) ---------- */
  function text(g, font, str, x, base, fill, align, italic) {
    g.save(); P.setFont(g, font, 0);
    const w = g.measureText(str).width, left = align === 1 ? x - w : align === 0 ? x - w * 0.5 : x;
    g.fillStyle = fill;
    if (italic) { g.translate(left, base); g.transform(1, 0, -ITALIC_SKEW, 1, 0, 0); g.fillText(str, 0, 0); } else g.fillText(str, left, base);
    g.restore(); return w;
  }
  function fit(g, font, str, maxW) {                                 // TextServer.OVERRUN_TRIM_ELLIPSIS
    if (P.width(g, str, font) <= maxW) return str;
    let s = str;
    while (s.length > 1 && P.width(g, s + '…', font) > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }
  function wrap(g, font, str, maxW) {                               // kunye_plate.wrap_text
    const out = []; let cur = '';
    for (const word of String(str).split(' ').filter(Boolean)) {
      const probe = cur ? cur + ' ' + word : word;
      if (P.width(g, probe, font) <= maxW) { cur = probe; continue; }
      if (cur) out.push(cur);
      cur = word;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }

  /* ---------- number formats (stat_sheet_style.format_value: "1,08" · "%3,7" · "9,00/sn") ---------- */
  const fmtInt = (v) => P.num(Math.floor(v + 0.0001), 0);
  const fmtPct = (v) => P.pct(v, 1);
  const signedPct = (v) => (v < 0 ? '−' : '+') + P.pct(Math.abs(v), 1);

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.charwin = function (hud) {
    const root = document.createElement('div');
    root.className = 'cw-root';
    hud.frame.appendChild(root);
    const surf = P.surface(root, 'cw-cv', REF_W, 500, 0, 0), g = surf.g;
    const hit = document.createElement('div'); hit.className = 'cw-hit'; root.appendChild(hit);
    const cardSurf = P.surface(root, 'cw-card', CARD_W + 8, 200, 4, 2), cg = cardSurf.g;
    cardSurf.el.style.display = 'none';

    let s = hud.s || 1, info = {}, ramp = coverRamp(null), leaf = null, leafKey = '';
    let V = null, sig = '', acc = 0, dirty = true, opened = false, anim = null, x = 0;
    let hoverStat = '', hoverClose = false, card = null;
    // layout (stat_view._compute_layout)
    let heads = [], rows = [], headLine = RULE1_Y + RULE_STEP, ledgerBottom = 0, footBase = 0, sheetH = 449;
    const mark = () => { dirty = true; };

    /* ---- data ---- */
    function sample(state) {
      if (!state) return null;
      const p = state.player || {}, ex = state.exp || {}, st = state.stats || {};
      const v = {
        level: p.level || ex.level || 1, exp: ex.exp || 0, need: ex.need || 0,
        hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, absorb: p.absorb,
        attackSpeed: st.attackSpeed, attackSpeedBuff: st.attackSpeedBuff || 0, damageMul: st.damageMul, damageTaken: st.damageTaken,
        critChance: st.critChance, critMul: st.critMul, hpRegen: st.hpRegen, mpRegen: st.mpRegen,
      };
      return v;
    }
    const has = (v) => typeof v === 'number' && isFinite(v);
    // one ledger entry: { text, fx (active-effect delta, '' if none), rows (card breakdown), prose }
    function entry(key) {
      if (!V) return null;
      const e = (text, fx, rows) => ({ text, fx: fx || '', rows: rows || [], prose: STAT[key].prose });
      switch (key) {
        case 'attackSpeed': {
          if (!has(V.attackSpeed)) return null;
          const b = V.attackSpeedBuff, base = b > 0 ? V.attackSpeed / (1 + b) : V.attackSpeed;
          return e(P.num(V.attackSpeed, 2), b > 0 ? signedPct(b * 100) : '', [{ label: 'Taban', value: P.num(base, 2) }, b > 0 ? { label: 'Etkiler', value: signedPct(b * 100) } : { label: 'Etkiler', value: '—', dim: true }]);
        }
        case 'damageMul': {
          if (!has(V.damageMul)) return null;
          const d = V.damageMul - 1, on = Math.abs(d) > 1e-6;
          return e('×' + P.num(V.damageMul, 2), on ? signedPct(d * 100) : '', [on ? { label: 'Etkiler', value: signedPct(d * 100), neg: d < 0 } : { label: 'Etkiler', value: '—', dim: true }]);
        }
        case 'critChance': return has(V.critChance) ? e(fmtPct(V.critChance * 100)) : null;
        case 'critDamage': return has(V.critMul) ? e(fmtPct((V.critMul - 1) * 100), '', [{ label: 'Çarpan', value: '×' + P.num(V.critMul, 2) }]) : null;
        case 'maxHp': return has(V.maxHp) ? e(fmtInt(V.maxHp), '', has(V.hp) ? [{ label: 'Şu an', value: fmtInt(Math.max(0, V.hp)) }] : []) : null;
        case 'maxMp': return has(V.maxMp) ? e(fmtInt(V.maxMp), '', has(V.mp) ? [{ label: 'Şu an', value: fmtInt(Math.max(0, V.mp)) }] : []) : null;
        case 'damageTaken': {
          if (!has(V.damageTaken)) return null;
          const d = V.damageTaken - 1, on = Math.abs(d) > 1e-6;
          return e(fmtPct(V.damageTaken * 100), on ? signedPct(d * 100) : '', [on ? { label: 'Etkiler', value: signedPct(d * 100), neg: d > 0 } : { label: 'Etkiler', value: '—', dim: true }]);
        }
        case 'absorb': return has(V.absorb) ? e(fmtInt(Math.max(0, V.absorb))) : null;
        case 'hpRegen': return has(V.hpRegen) ? e(P.pct(V.hpRegen, 1) + '/sn') : null;
        case 'mpRegen': return has(V.mpRegen) ? e(P.num(V.mpRegen, 2) + '/sn') : null;
      }
      return null;
    }
    function layout() {
      heads = []; rows = [];
      let lines = 0;
      LEDGER.forEach((groups, col) => {
        let line = headLine;
        for (const [title, keys] of groups) {
          const list = keys.filter((k) => entry(k));
          if (!list.length) continue;
          heads.push({ title, col, line }); line += RULE_STEP;
          for (const k of list) { rows.push({ key: k, col, line }); line += RULE_STEP; }
        }
        lines = Math.max(lines, (line - headLine) / RULE_STEP);
      });
      ledgerBottom = headLine + RULE_STEP * Math.max(lines, 1);
      footBase = ledgerBottom + FOOT_AFTER_LEDGER;
      sheetH = footBase + FOOT_TO_SHEET_END + FOOT_PAD;
      const key = sheetH + '|' + ramp.map((c) => c.join(',')).join('|');
      if (key !== leafKey) { leafKey = key; leaf = Leaf(SW, sheetH, ramp); resize(s); }
    }
    function signature() {
      if (!V) return '';
      const parts = [V.level, Math.floor(V.exp), Math.floor(V.need), info.name, info.title];
      for (const groups of LEDGER) for (const [, keys] of groups) for (const k of keys) { const en = entry(k); parts.push(en ? en.text + '|' + en.fx + '|' + en.rows.map((r) => r.value).join('/') : '-'); }
      return parts.join('#');
    }
    function refresh(state) {
      V = sample(state);
      const ns = signature();
      if (ns !== sig) { sig = ns; layout(); if (hoverStat) showCard(hoverStat); mark(); }
    }

    /* ---- drawing (stat_view._draw_sheet) ---- */
    function draw() {
      surf.begin();
      if (!leaf) return;
      g.save(); g.translate(PX, PY);
      drawBoard(g, leaf); drawSheet(g, leaf); drawClips(g, leaf);
      // head band: name tooled into the leather (1 px hard shadow), trimmed before the close glyph
      const name = info.title || info.name || 'Karakter', nf = fCaps(NAME_FS);
      P.engraved(g, fit(g, nf, name, CLOSE_C[0] - CLOSE_HIT * 0.5 - TITLE_X - 6), nf, TITLE_X, HEAD_H * 0.5 + 1, css(TOOLED), -1, 0, 0.6);
      drawClose();
      if (V) { drawIdentity(); drawLedger(); }
      text(g, fBody(FOOT_FS), FOOT_TEXT, FOOT_CX, footBase, css(INK_FAINT, 0.92), 0, true);
      g.restore();
    }
    function drawClose() {
      const [cx, cy] = CLOSE_C, a = CLOSE_ARM;
      g.lineWidth = 1.6; g.lineCap = 'butt';
      for (const [dy, c] of [[1, 'rgba(0,0,0,.6)'], [0, css(TOOLED, hoverClose ? 0.95 : 0.62)]]) {
        g.strokeStyle = c; g.beginPath();
        g.moveTo(cx - a, cy - a + dy); g.lineTo(cx + a, cy + a + dy); g.moveTo(cx + a, cy - a + dy); g.lineTo(cx - a, cy + a + dy);
        g.stroke();
      }
      g.lineWidth = 1;
    }
    function drawIdentity() {
      socket(g, LEVEL_C[0], LEVEL_C[1], LEVEL_R * 2);
      text(g, fNumBold(LEVEL_FS), String(V.level | 0), LEVEL_C[0], LEVEL_C[1] + 5, css(INK), 0);
      text(g, fCaps(CLASS_FS), info.name || '', CLASS_X, CLASS_BASE, css(INK));
      text(g, fNum(EXP_FS), P.num(Math.floor(V.exp), 0) + ' / ' + P.num(Math.floor(V.need), 0) + ' EXP', RIGHT, CLASS_BASE, css(INK_FAINT, 0.95), 1);
      notchedBar(g, CLASS_X, EXP_Y, RIGHT - CLASS_X, EXP_H, V.need > 0 ? V.exp / V.need : 0, GROOVE_ACTIVE);
      rule(g, TEXT_X - 6, RIGHT + 6, RULE1_Y, 0.30, true);
    }
    function drawLedger() {
      for (const hd of heads) {
        const span = COLS[hd.col], w = text(g, fCaps(GROUP_FS), hd.title, span[0], hd.line - 6, css(INK_FAINT, 0.95));
        rule(g, span[0] + w + 10, span[1], hd.line - 10, 0.20);
      }
      for (const row of rows) {
        const span = COLS[row.col], line = row.line, base = line - 5, en = entry(row.key);
        if (!en) continue;
        const fed = !!en.fx, pigment = fed ? GROOVE_READY : INK_FAINT;   // no attribute feeds a row here; an active effect does
        if (hoverStat === row.key) well(g, span[0] - 5, line - 20, span[1] - span[0] + 9, 19, 3, 0.05, 0.14, 0.26);
        const gh = fed ? 14 : 9;
        groove(g, span[0] - 7, Math.round(line - 9 - gh * 0.5), 3, gh, pigment, 1);
        text(g, fBody(LEDGER_FS), STAT[row.key].name, span[0], base, css(fed ? GROOVE_READY : INK_BODY));
        text(g, fNum(LEDGER_FS), en.text, span[1] - GUTTER, base, css(INK), 1);
        if (fed) text(g, fBody(DELTA_FS), en.fx, span[1], base, css(GROOVE_READY), 1, true);
      }
      vrule(g, VRULE_X, headLine - 14, ledgerBottom - 18, 0.20);
    }

    /* ---- künye card (stat_breakdown_card.gd) ---- */
    function showCard(key) {
      const en = entry(key), row = rows.find((r) => r.key === key);
      if (!en || !row) { hideCard(); return; }
      const n = en.rows.length;
      const sepY = n ? KC.ROWS_BASE + (n - 1) * KC.ROW_STEP + KC.SEP_AFTER_ROWS : KC.TITLE_RULE_Y;
      const totalBase = sepY + KC.TOTAL_AFTER_SEP, proseTop = totalBase + KC.PROSE_AFTER_TOTAL;
      const prose = wrap(cg, fBody(KC.PROSE_FS), en.prose, CARD_W - KC.TEXT_X - KC.RIGHT_PAD - KC.PROSE_INDENT);
      const h = proseTop + Math.max(prose.length - 1, 0) * KC.PROSE_LINE_H + KC.BOTTOM_PAD;
      card = { key, line: row.line, title: STAT[key].name, rows: en.rows, total: en.text, prose, n, sepY, totalBase, proseTop, h };
      cardSurf.resize(s, CARD_W + 8, h + 10);
      cardSurf.el.style.display = '';
      placeCard(); drawCard();
    }
    function hideCard() { card = null; cardSurf.el.style.display = 'none'; }
    function placeCard() {
      if (!card) return;
      const fh = hud.frame.clientHeight || innerHeight;
      let top = (PY + card.line - CARD_ROW_LIFT) * s;
      top = Math.min(Math.max(top, PY * s), Math.max(fh - card.h * s - PY * s, PY * s));
      cardSurf.el.style.left = ((PX + SW + CARD_GAP - 4) * s) + 'px';
      cardSurf.el.style.top = (top - 2 * s) + 'px';
    }
    function drawCard() {
      const q = card; cardSurf.begin();
      if (!q) return;
      const w = CARD_W, h = q.h, right = w - KC.RIGHT_PAD;
      // kunye_plate.draw_plate: one hard shadow, ink face, rim ramp (ash top → ink bottom), ramped 1 px edge
      path(cg, octPts(-3, 0, w + 6, h + 6, CARD_CUT + 3)); cg.fillStyle = 'rgba(0,0,0,.40)'; cg.fill();
      const pts = octPts(0, 0, w, h, CARD_CUT);
      path(cg, pts); cg.fillStyle = css(K_INK, 0.94); cg.fill();
      cg.fillStyle = vramp(cg, 0, h, [[0, css(K_ASH_HI, 0.30)], [0.10, css(K_ASH_HI, 0.045)], [0.80, 'rgba(0,0,0,.34)'], [1, 'rgba(0,0,0,.62)']]); cg.fill();
      path(cg, octPts(0.5, 0.5, w - 1, h - 1, CARD_CUT));
      cg.strokeStyle = vramp(cg, 0, h, [[0, css(K_ASH_HI, 0.52)], [0.35, css(K_ASH_HI, 0)], [0.3501, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.72)']]); cg.lineWidth = 1; cg.stroke();
      // groove (draw_groove): cut shadow + fill + opposite lip
      const gy = KC.GROOVE_INSET_Y, gh = h - KC.GROOVE_INSET_Y * 2;
      cg.fillStyle = 'rgba(0,0,0,.88)'; cg.fillRect(KC.GROOVE_X, gy, KC.GROOVE_W, gh);
      cg.fillStyle = css(CARD_GROOVE, 0.82); cg.fillRect(KC.GROOVE_X + 1, gy + 1, KC.GROOVE_W - 2, gh - 2);
      cg.fillStyle = css(K_ASH_HI, 0.26); cg.fillRect(KC.GROOVE_X + KC.GROOVE_W, gy, 1, gh);
      rivet(w - KC.RIVET_D, KC.RIVET_D); rivet(w - KC.RIVET_D, h - KC.RIVET_D);
      engr(fCaps(KC.TITLE_FS), q.title, KC.TEXT_X, KC.TITLE_BASE, css(K_ASH_HI));
      kRule(KC.TEXT_X, right, KC.TITLE_RULE_Y);
      q.rows.forEach((r, i) => {
        const base = KC.ROWS_BASE + i * KC.ROW_STEP;
        engr(fBody(KC.ROW_FS), r.label, KC.TEXT_X, base, css(r.dim ? K_OFF : K_BONE));
        engr(fCardNum(KC.ROW_FS), r.value, right, base, r.neg ? P.C.DANGER : css(r.dim ? K_OFF : K_ASH_HI), true);
      });
      if (q.n) kRule(KC.TEXT_X, right, q.sepY);
      engr(fCaps(KC.TOTAL_LABEL_FS), 'Toplam', KC.TEXT_X, q.totalBase, css(K_OFF));
      engr(fNumBold(KC.TOTAL_VALUE_FS), q.total, right, q.totalBase, css(K_AMBER), true);
      cg.fillStyle = css(K_ASH, 0.9); cg.fillRect(KC.TEXT_X, q.proseTop - KC.PROSE_NOTCH_RISE, KC.PROSE_NOTCH, KC.PROSE_NOTCH);
      q.prose.forEach((ln, i) => engr(fBody(KC.PROSE_FS), ln, KC.TEXT_X + KC.PROSE_INDENT, q.proseTop + i * KC.PROSE_LINE_H, css(K_BONE, 0.92)));
    }
    function rivet(cx, cy) {
      diamond(cg, cx, cy, KC.RIVET_R + 1, 'rgba(0,0,0,.72)');
      diamond(cg, cx, cy, KC.RIVET_R, css(K_ASH, 0.62));
      cg.beginPath(); cg.moveTo(cx, cy - KC.RIVET_R); cg.lineTo(cx + KC.RIVET_R, cy); cg.lineTo(cx, cy); cg.closePath(); cg.fillStyle = css(K_ASH_HI, 0.42); cg.fill();
    }
    function kRule(x0, x1, y) { cg.fillStyle = 'rgba(0,0,0,.70)'; cg.fillRect(x0, y, x1 - x0, 1); cg.fillStyle = css(K_ASH, 0.30); cg.fillRect(x0, y + 1, x1 - x0, 1); }
    function engr(font, str, x, base, fill, alignRight) {           // kunye_plate.draw_engraved: no outline, 1 px hard ink shadow
      cg.save(); P.setFont(cg, font, 0);
      const w = cg.measureText(str).width, left = alignRight ? x - w : x;
      cg.fillStyle = 'rgba(0,0,0,' + (0.9 * colA(fill)).toFixed(3) + ')'; cg.fillText(str, left, base + 1);
      cg.fillStyle = fill; cg.fillText(str, left, base);
      cg.restore();
    }
    const colA = (c) => { const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(c); return m ? +m[1] : 1; };

    /* ---- hover (stat_view._update_hover) ---- */
    function local(e) { const b = hit.getBoundingClientRect(); return [(e.clientX - b.left) / s, (e.clientY - b.top) / s]; }
    function nearClose(px, py) { return Math.abs(px - CLOSE_C[0]) <= CLOSE_HIT * 0.5 && Math.abs(py - CLOSE_C[1]) <= CLOSE_HIT * 0.5; }
    function setHover(stat, close) {
      if (close !== hoverClose) { hoverClose = close; hit.style.cursor = close ? 'pointer' : ''; mark(); }
      if (stat === hoverStat) return;
      hoverStat = stat;
      if (stat) showCard(stat); else hideCard();
      mark();
    }
    hit.addEventListener('mousemove', (e) => {
      if (anim) return;
      const [px, py] = local(e);
      let stat = '';
      for (const row of rows) {
        const span = COLS[row.col];
        if (px >= span[0] - 5 && px <= span[1] + 4 && py >= row.line - 21 && py < row.line + 1) { stat = row.key; break; }
      }
      setHover(stat, nearClose(px, py));
    });
    hit.addEventListener('mouseleave', () => setHover('', false));
    hit.addEventListener('mousedown', (e) => {
      e.preventDefault();                                          // never take focus / select
      if (e.button !== 0) return;
      const [px, py] = local(e);
      if (nearClose(px, py)) hud.windows.close('char');
    });
    hit.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---- drawer slide (stat_controller: TRANS_CUBIC, EASE_OUT in / EASE_IN out, 0.22 s) ---- */
    const closedX = () => -REF_W * s - CLOSED_MARGIN;
    function place() { root.style.transform = 'translateX(' + Math.round(x) + 'px)'; }
    function slide(open) { anim = { open, from: x, to: open ? 0 : closedX(), t: 0 }; }
    hud.windows.register('char', root, {
      onOpen() {
        opened = true; root.classList.remove('cw-closing');
        if (!anim) { x = closedX(); place(); }
        slide(true);
        acc = 0; sig = ''; refresh(hud.state); mark();
      },
      onClose() {
        opened = false; setHover('', false);
        root.classList.add('cw-closing');                          // stays drawn while it slides out (charwin.css)
        slide(false);
      },
    });

    function resize(ns) {
      s = ns;
      surf.resize(s, REF_W, sheetH + PY * 2);
      root.style.width = (REF_W * s) + 'px'; root.style.height = ((sheetH + PY * 2) * s) + 'px';
      hit.style.left = (PX * s) + 'px'; hit.style.top = (PY * s) + 'px';
      hit.style.width = (SW * s) + 'px'; hit.style.height = (sheetH * s) + 'px';
      if (card) showCard(card.key);
      if (!opened && !anim) { x = closedX(); place(); }
      mark();
    }
    P.onFonts(() => { if (card) showCard(card.key); mark(); });
    layout(); resize(s); x = closedX(); place();

    return {
      el: root,
      setInfo(i) { info = i || {}; ramp = coverRamp(info); leafKey = ''; layout(); sig = ''; mark(); },
      update(state, dt) {
        if (!opened) return;
        acc += dt || 0;
        if (acc >= REFRESH) { acc = 0; refresh(state); }           // at most ~4×/s while open
      },
      frame(dt) {
        if (anim) {
          anim.t = Math.min(1, anim.t + dt / SLIDE);
          const u = anim.t, k = anim.open ? 1 - Math.pow(1 - u, 3) : u * u * u;
          x = anim.from + (anim.to - anim.from) * k; place();
          if (anim.t >= 1) { if (!anim.open) root.classList.remove('cw-closing'); anim = null; }
        }
        if (!opened && !anim) return;
        if (dirty) { dirty = false; draw(); }
      },
      resize,
    };
  };
})(window);
