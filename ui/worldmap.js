/* TDS - world map window (HUD part, slot `worldmap`, window id 'map', key M), ported 1:1 from Atherion's
 * map v2 "Kartograf Masası":
 *   scripts/ui/map_sheet.gd      board (leather) · leaf (vellum, deckle, grain, foxing, watermark) · iron well · well lip ·
 *                                cartouche (legend) · north rose · scale bar · nails · engraved header · close clasp · footer + zoom rail
 *   scripts/ui/map_view.gd       mist · capture (map image) · ageing (warm multiply, edge vignette, grain) · ink dots · vellum-halo labels ·
 *                                label slots · quest pulse · portal diamond · party dot · player arrow + breathing ring
 *   scripts/ui/map_controller.gd layout (sheet_size_for) · zoom 1..4 in x1.25 steps, wheel anchored at the cursor, drag pan, rail · coords line
 *   scripts/ui/vellum_frame.gd   palette + nail head
 * Units are Atherion canvas px (1920x1080 design), scaled by hud.s (HUDPaint.surface). Draws only while open.
 *
 * Data (read every frame while open): hud.state.map = { region, world?, bounds, player: {x, z, yaw}, moveTo, markers: [...], image? }
 *   image (optional) = { src: canvas|img, minX, maxX, minZ, maxZ, version? } -> base layer with Atherion's capture treatment
 *   (bump `version` when a canvas source is redrawn: the warm-tinted copy is cached per src + version).
 * API: { frame(dt), resize(s), zoomTo(z, x?, z?) }   (zoomTo: dev / bench helper)
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, D = document, TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rgba = (c, a) => P.rgba(c, a);

  /* ---------- geometry: map_sheet.gd ---------- */
  const HEAD_H = 52, FOOT_H = 38, LEAF_IN = 14, WIN_PAD = 22, CUT = 12, TOOL_INSET = 9, NAIL_R = 3, NAIL_IN = 15, WELL_BAND = 5;
  const CLASP = 30, CLASP_PAD = 6, CART_W = 186, CART_ROW = 19, CART_HEAD = 34, CART_PAD = 18, ROSE_R = 34, ROSE_PAD = 18;
  const SCALE_PAD = 18, SCALE_H = 9, SCALE_MIN_PX = 150, SCALE_MAX_PX = 300, SCALE_SEGMENTS = 3;
  // Atherion's ladder starts at 10 units (a 15 km valley); this world is ~250 m, so the same 1-2-3-5 ladder continues down to 1
  const SCALE_STEPS = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000];
  const RAIL_W = 200, RAIL_H = 16, RAIL_NOTCHES = 7, RAIL_INSET = 6, MIN_WINDOW = 160, VIEWPORT_MARGIN = 30;
  /* map_controller.gd */
  const ZOOM_MIN = 1, ZOOM_MAX = 4, ZOOM_STEP = 1.25, SAMPLE_INTERVAL = 0.5;
  /* leaf edge (quest panels v2 measured values) */
  const DECKLE = 0.62, DECKLE_WAVE = 0.95, DECKLE_WAVE_FREQ = 0.085, DECKLE_STEP = 7;
  const SHADOW_RINGS = [[7, 0.05], [5.6, 0.07], [4.3, 0.09], [3.2, 0.12]], SHADOW_BIAS_Y = 1.2;
  const RIM_RINGS = [[2.4, 0.22], [1.5, 0.46], [0.7, 0.70]];
  const FEATHER = [[5, 0.10], [3, 0.14], [1.6, 0.20]];
  const GRAIN_A = 0.055, FOX_A = 0.035, WM_A = 0.05, WM_NAILS = 7;
  const AGE_VIGN_FADE = 64, AGE_VIGN_ALPHA = 0.22, AGE_GRAIN_ALPHA = 0.06;
  const SEED_DECKLE = 90210, SEED_FOX = 31337, SEED_GRAIN = 4711, MIST_SEED = 20260817, MIST_TEX = 128, MIST_FREQ = 0.028;
  /* map_view.gd */
  const DOT_RADIUS = 5, PARTY_DOT_RADIUS = 5.5, FRIEND_DOT_RADIUS = 5.5, QUEST_RADIUS_MIN = 5.5, QUEST_RADIUS_MAX = 8.5;
  const QUEST_BLINK_HZ = 1.1, QUEST_BLINK_MIN_ALPHA = 0.30, HALO_STEPS = 8, HALO_ALPHA = 0.75;

  /* ---------- palette: vellum_frame.gd + map_sheet.gd + map_view.gd ---------- */
  const K = {
    VELLUM_HI: '#E9E0CA', VELLUM: '#DDD0B2', VELLUM_LO: '#CFC09C', INK: '#3A2C14', INK_BODY: '#4A3B22', INK_FAINT: '#6B5A3C',
    IRON: '#55483A', IRON_HI: '#8C7C66', IRON_DARK: '#2E2619', BOARD_HI: '#5A4A38', BOARD: '#3A2E22', BOARD_LO: '#201913',
    TOOLED: '#D9CBAE', FOX: '#7A5A2C', AMBER: '#E2C78F', EDGE_DARK: '#272016', AGE_TINT: '#F7ECD7', MIST: '#CCC9C2',
    CARVE: 'rgba(18,13,8,.72)',
    // markers (minimap colour contract)
    NPC: '#59B8FF', PLAYER: '#59F26B', QUEST: '#E2C78F', PARTY: '#E0956B', FRIEND: '#4E8C7A', PORTAL: '#B8862B',
    HOSTILE: '#CF5444',                     // MinimapMask.mob_color
    NEUTRAL: '#9C978C',                     // mob threat grey (mob_global_config): a passive creature
  };
  const RAMP_BOARD = [[0, K.BOARD_HI], [0.045, K.BOARD], [0.72, K.BOARD], [1, K.BOARD_LO]];
  const RAMP_VELLUM = [[0, K.VELLUM_HI], [0.45, K.VELLUM], [1, K.VELLUM_LO]];
  const RAMP_IRON = [[0, K.IRON_HI], [0.035, K.IRON], [0.72, K.IRON], [1, K.IRON_DARK]];

  /* marker kinds -> Atherion's map language. label: 'big' = NPC name (13 px, slot placement), 'small' = party name (11 px),
     'sel' = creatures: no label unless selected or hovered (Atherion's map shows no mobs; this game's data does) */
  const KIND = {
    npc: { col: K.NPC, r: DOT_RADIUS, label: 'big', legend: 'NPC' },
    quest: { col: K.QUEST, r: QUEST_RADIUS_MIN, label: 'big', legend: 'Görev var ( ! )', pulse: true },
    poi: { col: K.PORTAL, shape: 'diamond', label: 'big', legend: 'İlgi noktası' },
    party: { col: K.PARTY, r: PARTY_DOT_RADIUS, label: 'small', legend: 'Grup üyesi' },
    friendly: { col: K.FRIEND, r: 4.5, label: 'sel', legend: 'Dost' },
    hostile: { col: K.HOSTILE, r: 4.5, label: 'sel', legend: 'Düşman' },
    neutral: { col: K.NEUTRAL, r: 4.5, label: 'sel', legend: 'Tarafsız' },
  };
  const LEGEND_ORDER = ['npc', 'quest', 'party', 'friendly', 'hostile', 'neutral', 'poi'];
  const T = {
    legendTitle: 'İşaretler', you: 'Sen', moveTo: 'Hedef nokta', scaleUnit: 'Metre',
    coordsYou: 'Konumun', coordsCursor: 'İmleç', zoom: 'Yakınlık', hint: 'Tekerlek · + − — Yakınlaştır    M · ESC — Kapat',
  };
  const FT = {
    title: P.F.cinzel(600, 22),
    cart: (px) => P.F.cinzel(600, px),
    label: (px) => P.F.serif(600, px),
    small: (px) => P.F.serif(500, px),
  };
  const trUpper = (s) => String(s).toLocaleUpperCase('tr-TR');

  /* ---------- small helpers ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function polyPath(g, pts, dx, dy) {
    g.beginPath(); g.moveTo(pts[0][0] + (dx || 0), pts[0][1] + (dy || 0));
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + (dx || 0), pts[i][1] + (dy || 0));
    g.closePath();
  }
  // Geometry2D.offset_polygon stand-in: miter offset of a (screen-)clockwise polygon, outward normal = (dy, -dx)
  function grow(pts, d) {
    const n = pts.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], la = Math.hypot(ax, ay) || 1, bx = p2[0] - p1[0], by = p2[1] - p1[1], lb = Math.hypot(bx, by) || 1;
      const n1x = ay / la, n1y = -ax / la, n2x = by / lb, n2y = -bx / lb;
      let mx = n1x + n2x, my = n1y + n2y; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      const c = Math.max(0.35, mx * n1x + my * n1y);
      out[i] = [p1[0] + mx * d / c, p1[1] + my * d / c];
    }
    return out;
  }
  const hit = (r, x, y) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const growR = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 });
  const mctx = D.createElement('canvas').getContext('2d');
  function measure(str, font, track) { mctx.font = font; mctx.letterSpacing = (track || 0) + 'px'; return mctx.measureText(str).width; }
  function text(g, str, font, x, y, col, track) {
    g.font = font; g.letterSpacing = (track || 0) + 'px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = col; g.fillText(str, x, y);
  }
  // map_sheet._carve: 1.1 px dark drop under a face colour (text pressed into the leather)
  function carve(g, str, x, y, font, col, track) { text(g, str, font, x, y + 1.1, K.CARVE, track); text(g, str, font, x, y, col, track); }
  // vellum_frame.draw_nail: dark diamond + lit upper facet
  function nail(g, cx, cy, r) {
    P.diamond(g, cx, cy, r, K.IRON_DARK);
    const r2 = r * 0.52;
    P.diamond(g, cx, cy - 0.6, r2, K.IRON_HI);
  }
  // radial-ish arc stroke
  function ring(g, x, y, r, col, w) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.strokeStyle = col; g.lineWidth = w; g.stroke(); }
  function disc(g, x, y, r, col) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = col; g.fill(); }

  /* ---------- procedural textures (built once) ---------- */
  // mist: 128² fractal gradient noise -> alpha .55..1 of a cool paper grey (map_view._build_mist_texture)
  const mist = (function () {
    const r = rng(MIST_SEED), perm = new Uint8Array(512), p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const GR = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    function noise(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const d = (h, dx, dy) => { const gv = GR[h & 7]; return gv[0] * dx + gv[1] * dy; };
      const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]], ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
      const u = fade(xf), v = fade(yf);
      return lerp(lerp(d(aa, xf, yf), d(ba, xf - 1, yf), u), lerp(d(ab, xf, yf - 1), d(bb, xf - 1, yf - 1), u), v);
    }
    const c = D.createElement('canvas'); c.width = c.height = MIST_TEX;
    const g = c.getContext('2d'), im = g.createImageData(MIST_TEX, MIST_TEX), [mr, mg, mb] = P.hexRGB(K.MIST);
    for (let y = 0; y < MIST_TEX; y++) for (let x = 0; x < MIST_TEX; x++) {
      let n = 0, amp = 1, f = MIST_FREQ, sum = 0;
      for (let o = 0; o < 4; o++) { n += noise(x * f + o * 17.3, y * f + o * 9.1) * amp; sum += amp; amp *= 0.5; f *= 2; }
      n = clamp((n / sum) * 1.25 * 0.5 + 0.5, 0, 1);
      const i = (y * MIST_TEX + x) * 4;
      im.data[i] = mr; im.data[i + 1] = mg; im.data[i + 2] = mb; im.data[i + 3] = Math.round(lerp(0.55, 1, n) * 255);
    }
    g.putImageData(im, 0, 0);
    return c;
  })();
  // paper grain: 128 design px of white noise at DEVICE resolution (no upscaled blotches), three tints (map_sheet._make_grain_texture)
  let grainK = 0, grain = null;
  function grainSet(k) {
    if (grain && grainK === k) return grain;
    const n = Math.max(32, Math.round(128 * k)), r = rng(SEED_GRAIN), alpha = new Uint8Array(n * n);
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(r() * 255);
    const mk = (hex, mul) => {
      const c = D.createElement('canvas'); c.width = c.height = n;
      const g = c.getContext('2d'), im = g.createImageData(n, n), rgb = hex ? P.hexRGB(hex).map((v) => Math.round(v * mul)) : [0, 0, 0];
      for (let i = 0; i < alpha.length; i++) { const j = i * 4; im.data[j] = rgb[0]; im.data[j + 1] = rgb[1]; im.data[j + 2] = rgb[2]; im.data[j + 3] = alpha[i]; }
      g.putImageData(im, 0, 0); return c;
    };
    grainK = k; grain = { black: mk(null), ink: mk(K.INK, 0.337), hi: mk(K.VELLUM_HI, 0.337) };
    return grain;
  }
  function grainFill(g, cv, x, y, w, h, alpha, k, ox, oy) {
    const pat = g.createPattern(cv, 'repeat');
    pat.setTransform(new DOMMatrix().translate(ox || 0, oy || 0).scale(1 / k));
    g.save(); g.globalAlpha *= alpha; g.fillStyle = pat; g.fillRect(x, y, w, h); g.restore();
  }

  /* ---------- static geometry (map_sheet.gd: sheet_size_for … rail_knob_x) ---------- */
  function sheetSizeFor(vw, vh, aspect) {
    const a = Math.max(aspect, 0.001), ax = vw - VIEWPORT_MARGIN * 2, ay = vh - VIEWPORT_MARGIN * 2;
    let winH = Math.min(ay - (HEAD_H + FOOT_H + 2 * WIN_PAD), (ax - 2 * (LEAF_IN + WIN_PAD)) / a);
    winH = Math.floor(Math.max(winH, MIN_WINDOW));
    const winW = Math.round(Math.max(winH * a, MIN_WINDOW));
    return { w: winW + 2 * (LEAF_IN + WIN_PAD), h: winH + HEAD_H + FOOT_H + 2 * WIN_PAD };
  }
  function scaleStepFor(upx) {
    const u = Math.max(upx, 0.0001), target = (SCALE_MIN_PX + SCALE_MAX_PX) * 0.5;
    let best = SCALE_STEPS[0], bestErr = Infinity;
    for (const st of SCALE_STEPS) {
      const px = st * SCALE_SEGMENTS / u;
      if (px >= SCALE_MIN_PX && px <= SCALE_MAX_PX) return st;
      const err = Math.abs(px - target);
      if (err < bestErr) { bestErr = err; best = st; }
    }
    return best;
  }
  function railKnobX(rail, zoom) {
    const span = Math.log(Math.max(ZOOM_MAX / ZOOM_MIN, 1.0001)), t = clamp(Math.log(Math.max(zoom / ZOOM_MIN, 0.0001)) / span, 0, 1);
    return rail.x + RAIL_INSET + t * Math.max(rail.w - RAIL_INSET * 2, 1);
  }
  function zoomFromRail(rail, lx) {
    const usable = Math.max(rail.w - RAIL_INSET * 2, 1), t = clamp((lx - rail.x - RAIL_INSET) / usable, 0, 1);
    return ZOOM_MIN * Math.pow(Math.max(ZOOM_MAX / ZOOM_MIN, 1.0001), t);
  }
  // map_view.view_rect_for: zoom window, centre clamped so the view always stays inside the world rect
  function viewRectFor(world, zoom, cx, cz) {
    if (zoom <= 1) return { x: world.x, y: world.y, w: world.w, h: world.h };
    const w = world.w / zoom, h = world.h / zoom;
    const x = clamp(cx, world.x + w / 2, world.x + world.w - w / 2), y = clamp(cz, world.y + h / 2, world.y + world.h - h / 2);
    return { x: x - w / 2, y: y - h / 2, w, h };
  }

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.worldmap = function (hud) {
    /* ---------- DOM: dim (click closes) > sheet > base / window / chrome canvases + transparent close button ---------- */
    const root = D.createElement('div'); root.className = 'hud-wm'; hud.frame.appendChild(root);
    const sheet = D.createElement('div'); sheet.className = 'wm-sheet'; root.appendChild(sheet);
    const base = P.surface(sheet, 'wm-base', 64, 64), win = P.surface(sheet, 'wm-win', 64, 64), chrome = P.surface(sheet, 'wm-chrome', 64, 64);
    const stat = D.createElement('canvas');        // cached window layer (mist + map + ageing), same backing size as the sheet
    const closeBtn = D.createElement('button'); closeBtn.className = 'wm-x'; closeBtn.type = 'button'; closeBtn.tabIndex = -1;
    closeBtn.setAttribute('aria-label', 'Kapat'); sheet.appendChild(closeBtn);

    let s = hud.s || 1, open = false, L = null, layoutDirty = true;
    let S = null, world = null, worldKey = '', zoom = 1, cx = 0, cz = 0, view = null, viewInit = false;
    let t = 0, sampleT = 0, staticKey = '', chromeKey = '', baseDirty = true;
    let cursorOn = false, cursorX = 0, cursorZ = 0, hoverId = null, lastLocal = null;
    let drag = null, lastCX = 0, lastCY = 0, wheelAcc = 0, closeHover = false, closePress = false;
    let deckle = [], shadows = [], rims = [], fox = [];
    const places = new Map();                      // marker id -> label baseline offset from its dot (Atherion's 2 Hz slot solve)
    let rows = [], rowsKey = '';
    const tinted = { src: null, ver: null, c: null };

    /* ---------- layout ---------- */
    function worldFrom(m) {
      const b = m && m.bounds;
      if (b && b.maxX > b.minX && b.maxZ > b.minZ) {
        const w = b.maxX - b.minX, h = b.maxZ - b.minZ, pad = Math.max(4, 0.04 * Math.max(w, h));   // a thin mist rim around the land
        return { x: b.minX - pad, y: b.minZ - pad, w: w + pad * 2, h: h + pad * 2 };
      }
      const p = (m && m.player) || { x: 0, z: 0 };   // no bounds: a square around the player (map_controller FALLBACK_VIEW_SIZE)
      return { x: p.x - 60, y: p.z - 60, w: 120, h: 120 };
    }
    function layout() {
      layoutDirty = false;
      const sz = sheetSizeFor(innerWidth / s, innerHeight / s, world ? world.w / world.h : 1), w = sz.w, h = sz.h, inset = LEAF_IN + WIN_PAD;
      L = {
        w, h,
        win: { x: inset, y: HEAD_H + WIN_PAD, w: Math.max(w - inset * 2, 1), h: Math.max(h - HEAD_H - FOOT_H - 2 * WIN_PAD, 1) },
        leaf: { x: LEAF_IN, y: HEAD_H, w: Math.max(w - LEAF_IN * 2, 1), h: Math.max(h - HEAD_H - FOOT_H, 1) },
        clasp: { x: w - LEAF_IN - CLASP - CLASP_PAD, y: (HEAD_H - CLASP) * 0.5, w: CLASP, h: CLASP },
        rail: { x: (w - RAIL_W) * 0.5, y: h - FOOT_H + (FOOT_H - RAIL_H) * 0.5, w: RAIL_W, h: RAIL_H },
      };
      L.rose = { x: L.win.x + L.win.w - ROSE_PAD - ROSE_R, y: L.win.y + ROSE_PAD + ROSE_R };
      L.scaleAnchor = { x: L.win.x + L.win.w - SCALE_PAD, y: L.win.y + L.win.h - SCALE_PAD };
      // the sheet is centred on the screen (the dim covers the whole viewport, even on ultrawide)
      sheet.style.left = Math.round((innerWidth - w * s) / 2) + 'px'; sheet.style.top = Math.round((innerHeight - h * s) / 2) + 'px';
      sheet.style.width = (w * s) + 'px'; sheet.style.height = (h * s) + 'px';
      base.resize(s, w, h); win.resize(s, w, h); chrome.resize(s, w, h);
      if (stat.width !== base.el.width) stat.width = base.el.width;
      if (stat.height !== base.el.height) stat.height = base.el.height;
      const c = L.clasp;
      Object.assign(closeBtn.style, { left: c.x * s + 'px', top: c.y * s + 'px', width: c.w * s + 'px', height: c.h * s + 'px' });
      buildLeaf();
      baseDirty = true; staticKey = ''; chromeKey = '';
      refreshView();
    }
    function buildLeaf() {
      const r = rng(SEED_DECKLE), lf = L.leaf, pts = [];
      const edge = (ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        if (len <= 0.001) return;
        const n = Math.max(2, Math.round(len / DECKLE_STEP)), nx = dy / len, ny = -dx / len, phase = r() * TAU;
        for (let i = 0; i < n; i++) {
          const tt = i / n, wave = Math.sin(len * tt * DECKLE_WAVE_FREQ + phase) * DECKLE_WAVE, fibre = (r() * 2 - 1) * DECKLE;
          pts.push([ax + dx * tt + nx * (wave + fibre), ay + dy * tt + ny * (wave + fibre)]);
        }
      };
      const x0 = lf.x, y0 = lf.y, x1 = lf.x + lf.w, y1 = lf.y + lf.h;
      edge(x0, y0, x1, y0); edge(x1, y0, x1, y1); edge(x1, y1, x0, y1); edge(x0, y1, x0, y0);
      deckle = pts;
      shadows = SHADOW_RINGS.map(([d, a]) => ({ pts: grow(pts, d), a }));
      rims = RIM_RINGS.map(([d, k]) => ({ pts: grow(pts, d), col: P.mix(K.EDGE_DARK, K.VELLUM, k) }));
      // foxing anchored on the leaf's margin band, never on the map window (map_sheet._build_fox)
      const fr = rng(SEED_FOX), w6 = growR(L.win, -6);
      fox = [];
      for (const [ax, ay] of [[lf.x + 26, lf.y + 30], [lf.x + lf.w - 24, lf.y + lf.h * 0.62], [lf.x + lf.w * 0.34, lf.y + lf.h - 22]]) {
        if (hit(w6, ax, ay)) continue;
        fox.push([ax, ay, 18 + fr() * 26]);
      }
    }

    /* ---------- view: zoom + pan (map_controller.gd) ---------- */
    function refreshView() {
      if (!world) return;
      view = viewRectFor(world, zoom, cx, cz);
      cx = view.x + view.w / 2; cz = view.y + view.h / 2;   // clamped centre written back: a pinned sheet answers a reverse drag at once
      sampleT = SAMPLE_INTERVAL;                           // label slots follow the new view next frame
    }
    function applyZoom(next, ax, ay) {
      const z = clamp(next, ZOOM_MIN, ZOOM_MAX);
      if (Math.abs(z - zoom) < 1e-6 || !world) return;
      if (ax !== undefined) {                              // keep the world point under the cursor fixed
        const A = L.win, ux = ax / A.w, uy = ay / A.h, wx = view.x + ux * view.w, wz = view.y + uy * view.h;
        zoom = z;
        const nw = world.w / zoom, nh = world.h / zoom;
        cx = wx - (ux - 0.5) * nw; cz = wz - (uy - 0.5) * nh;
      } else zoom = z;
      refreshView(); updateCursor();
    }
    function panBy(dx, dy) {
      if (!view) return;
      cx -= dx * (view.w / L.win.w); cz -= dy * (view.h / L.win.h);
      refreshView(); updateCursor();
    }
    const toPx = (x, z) => [(x - view.x) / view.w * L.win.w, (z - view.y) / view.h * L.win.h];
    const inView = (x, z) => x >= view.x && x < view.x + view.w && z >= view.y && z < view.y + view.h;
    function updateCursor() {
      if (!lastLocal || !view) { cursorOn = false; return; }
      const lx = lastLocal[0] - L.win.x, ly = lastLocal[1] - L.win.y;
      cursorOn = lx >= 0 && ly >= 0 && lx <= L.win.w && ly <= L.win.h;
      if (cursorOn) { cursorX = view.x + lx / L.win.w * view.w; cursorZ = view.y + ly / L.win.h * view.h; }
    }

    /* ---------- label sprites: vellum halo (8 offset passes) + ink face, cached at device resolution ---------- */
    const sprites = new Map();
    let spriteK = 0;
    function sprite(str, kind, col) {
      const k = s * Math.min(2, global.devicePixelRatio || 1);
      if (k !== spriteK) { sprites.clear(); spriteK = k; }
      const key = kind + '|' + col + '|' + str;
      let sp = sprites.get(key);
      if (sp) return sp;
      if (sprites.size > 400) sprites.clear();
      const size = kind === 'small' ? 11 : 13, font = kind === 'small' ? FT.small(size) : FT.label(size);
      const tw = measure(str, font), m = P.metrics(mctx, font), r = Math.max(size * 0.16, 1.4), pad = r + 1.5;
      const w = tw + pad * 2, h = m.a + m.d + pad * 2;
      const c = D.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
      const g = c.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
      g.font = font; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.fillStyle = rgba(K.VELLUM_HI, HALO_ALPHA);
      for (let i = 0; i < HALO_STEPS; i++) { const a = i / HALO_STEPS * TAU; g.fillText(str, pad + Math.cos(a) * r, pad + m.a + Math.sin(a) * r); }
      g.fillStyle = col; g.fillText(str, pad, pad + m.a);
      sp = { c, k, tw, ox: -pad, oy: -(pad + m.a) };
      if (D.fonts && D.fonts.status === 'loaded') sprites.set(key, sp);
      return sp;
    }
    function drawSprite(g, sp, x, y) {
      const k = sp.k, dx = Math.round((x + sp.ox) * k) / k, dy = Math.round((y + sp.oy) * k) / k;
      g.drawImage(sp.c, dx, dy, sp.c.width / k, sp.c.height / k);
    }

    /* ---------- map_view._place_labels: right -> left -> below -> above, first free slot ---------- */
    function markerId(m, i) { return m.id !== undefined ? m.id : m.kind + ':' + i; }
    function placeLabels() {
      places.clear();
      if (!S || !view) return;
      const W = L.win.w, H = L.win.h, placed = [], ms = S.markers || [];
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i], kd = KIND[m.kind] || KIND.poi;
        if (kd.label !== 'big' || !m.label || !inView(m.x, m.z)) continue;
        const [px, py] = toPx(m.x, m.z), cw = sprite(m.label, 'big', K.INK).tw + 8, ch = 18;
        const cands = [[11, -9], [-cw - 11, -9], [-cw * 0.5, 12], [-cw * 0.5, -30]];
        let pick = cands[0];
        for (const c of cands) {
          const r = { x: px + c[0], y: py + c[1], w: cw, h: ch };
          if (placed.some((o) => intersects(r, o)) || r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) continue;
          pick = c; break;
        }
        placed.push({ x: px + pick[0], y: py + pick[1], w: cw, h: ch });
        places.set(markerId(m, i), [pick[0], pick[1] + 13]);
      }
    }

    /* ---------- legend rows: only the kinds actually present ---------- */
    function legendRows() {
      const out = [];
      if (S && S.player) out.push({ text: T.you, shape: 'dot', col: K.PLAYER, r: 4.5 });
      const have = new Set((S && S.markers || []).map((m) => (KIND[m.kind] ? m.kind : 'poi')));
      for (const k of LEGEND_ORDER) if (have.has(k)) { const kd = KIND[k]; out.push({ text: kd.legend, shape: kd.shape || 'dot', col: kd.col, r: 4 }); }
      if (S && S.moveTo) out.push({ text: T.moveTo, shape: 'cross', col: K.INK, r: 4 });
      return out;
    }

    /* ================= drawing ================= */
    // ink dot: vellum outline + ink ring + colour ("signature stamped on the sheet")
    function inkDot(g, x, y, r, fill) {
      disc(g, x, y, r + 2.4, rgba(K.VELLUM_HI, 0.65));
      disc(g, x, y, r + 1.3, rgba(K.INK, 0.85));
      disc(g, x, y, r, fill);
    }
    // portal mark: hollow amber diamond (map_view: geçit nişanı)
    function portal(g, x, y, d) {
      g.beginPath(); g.moveTo(x, y - d); g.lineTo(x + d, y); g.lineTo(x, y + d); g.lineTo(x - d, y); g.closePath();
      g.fillStyle = rgba(K.PORTAL, 0.35); g.fill();
      g.lineJoin = 'miter'; g.strokeStyle = K.PORTAL; g.lineWidth = 2; g.stroke();
    }
    // move order target: an ink cross on a vellum halo + a faint ring (not in Atherion: this game has right-click movement)
    function cross(g, x, y, r) {
      g.lineCap = 'round';
      for (const [w, c] of [[3.4, rgba(K.VELLUM_HI, 0.65)], [1.6, rgba(K.INK, 0.9)]]) {
        g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
        g.strokeStyle = c; g.lineWidth = w; g.stroke();
      }
      g.lineCap = 'butt';
      ring(g, x, y, r + 3.2, rgba(K.INK, 0.45), 1);
    }

    // BASE: board + leaf + well band (under the map; redrawn on layout only)
    function drawBase() {
      baseDirty = false;
      const g = base.begin(), W = L.w, H = L.h, k = base.s * base.dpr, gr = grainSet(k);
      // 1-2 · board (leather) + tooling
      P.octPath(g, 0, 0, W, H, CUT); P.fillRamp(g, 0, H, RAMP_BOARD);
      g.save(); g.clip(); grainFill(g, gr.black, 0, 0, W, H, 0.10, k); g.restore();
      P.octPath(g, 0, 0, W, H, CUT); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1; g.stroke();
      const t = TOOL_INSET;
      P.octPath(g, t, t, W - t * 2, H - t * 2, CUT - 3); g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
      P.octPath(g, t + 1, t + 1, W - (t + 1) * 2, H - (t + 1) * 2, CUT - 4); g.strokeStyle = rgba(K.BOARD_HI, 0.44); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(t, HEAD_H - 1, W - t * 2, 1); g.fillRect(t, H - FOOT_H, W - t * 2, 1);
      // 3-9 · contact shadow -> margin rim -> leaf -> feather -> grain -> foxing -> watermark
      for (const sh of shadows) { polyPath(g, sh.pts, 0, SHADOW_BIAS_Y); g.fillStyle = 'rgba(0,0,0,' + sh.a + ')'; g.fill(); }
      for (const rm of rims) { polyPath(g, rm.pts); g.fillStyle = rm.col; g.fill(); }
      const lf = L.leaf;
      polyPath(g, deckle); P.fillRamp(g, lf.y, lf.h, RAMP_VELLUM);
      g.lineJoin = 'round';
      for (const [w, a] of FEATHER) { polyPath(g, deckle); g.strokeStyle = rgba(K.IRON_DARK, a); g.lineWidth = w; g.stroke(); }
      g.save(); polyPath(g, deckle); g.clip();
      grainFill(g, gr.ink, lf.x, lf.y, lf.w, lf.h, GRAIN_A, k);
      grainFill(g, gr.hi, lf.x, lf.y, lf.w, lf.h, GRAIN_A * 0.7, k, 37, 53);
      for (const [x, y, r] of fox) {
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, rgba(K.FOX, FOX_A)); rg.addColorStop(0.6, rgba(K.FOX, FOX_A * 0.45)); rg.addColorStop(1, rgba(K.FOX, 0));
        g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // watermark: "a circle of seven nails" (lore mark), sits under the map well
      const wcx = lf.x + lf.w / 2, wcy = lf.y + lf.h / 2, wr = Math.min(lf.w, lf.h) * 0.11;
      ring(g, wcx, wcy, wr, rgba(K.INK, WM_A), 3);
      for (let i = 0; i < WM_NAILS; i++) { const a = i / WM_NAILS * TAU - Math.PI / 2; disc(g, wcx + Math.cos(a) * wr, wcy + Math.sin(a) * wr, wr * 0.095, rgba(K.INK, WM_A)); }
      g.restore();
      // 11a · iron band of the map well (under the map)
      const o = growR(L.win, WELL_BAND);
      P.octPath(g, o.x, o.y, o.w, o.h, 4); P.fillRamp(g, o.y, o.h, RAMP_IRON);
      P.octPath(g, o.x, o.y, o.w, o.h, 4); g.strokeStyle = rgba(K.IRON_DARK, 0.9); g.lineWidth = 1; g.stroke();
    }

    // capture treatment E1: warm multiply (blue -16 %, green -7 %), alpha kept
    function tintedImage(img) {
      const ver = img.version !== undefined ? img.version : (img.src.width + 'x' + img.src.height);
      if (tinted.src === img.src && tinted.ver === ver && tinted.c) return tinted.c;
      const sw = img.src.naturalWidth || img.src.width, sh = img.src.naturalHeight || img.src.height;
      if (!sw || !sh) return null;
      const c = tinted.c && tinted.c.width === sw && tinted.c.height === sh ? tinted.c : D.createElement('canvas');
      c.width = sw; c.height = sh;
      const g = c.getContext('2d');
      g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, sw, sh); g.drawImage(img.src, 0, 0);
      g.globalCompositeOperation = 'multiply'; g.fillStyle = K.AGE_TINT; g.fillRect(0, 0, sw, sh);
      g.globalCompositeOperation = 'destination-in'; g.drawImage(img.src, 0, 0);
      g.globalCompositeOperation = 'source-over';
      tinted.src = img.src; tinted.ver = ver; tinted.c = c;
      return c;
    }
    function imageInfo() {
      const im = S && S.image;
      if (!im || !im.src || !(im.maxX > im.minX) || !(im.maxZ > im.minZ)) return null;
      if (im.src.complete === false) return null;
      return im;
    }

    // WINDOW (static part, cached): mist -> map image (or vector backdrop) -> edge vignette -> grain
    function drawStatic(img) {
      const k = base.s * base.dpr, A = L.win, W = A.w, H = A.h, g = stat.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, stat.width, stat.height);
      g.setTransform(k, 0, 0, k, A.x * k, A.y * k);
      g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      // mist: pinned to the WORLD (same crop as the map), shows wherever there is no land
      const mx = (view.x - world.x) / world.w * MIST_TEX, my = (view.y - world.y) / world.h * MIST_TEX;
      g.drawImage(mist, mx, my, view.w / world.w * MIST_TEX, view.h / world.h * MIST_TEX, 0, 0, W, H);
      if (img) {
        const tex = { x: img.minX, y: img.minZ, w: img.maxX - img.minX, h: img.maxZ - img.minZ };
        const x0 = Math.max(view.x, tex.x), y0 = Math.max(view.y, tex.y), x1 = Math.min(view.x + view.w, tex.x + tex.w), y1 = Math.min(view.y + view.h, tex.y + tex.h);
        const c = tintedImage(img);
        if (c && x1 - x0 > 0.001 && y1 - y0 > 0.001) {
          g.drawImage(c, (x0 - tex.x) / tex.w * c.width, (y0 - tex.y) / tex.h * c.height, (x1 - x0) / tex.w * c.width, (y1 - y0) / tex.h * c.height,
            (x0 - view.x) / view.w * W, (y0 - view.y) / view.h * H, (x1 - x0) / view.w * W, (y1 - y0) / view.h * H);
        }
      } else drawVectorLand(g, W, H);
      // E2 · edge vignette (not radial: a radial one would brighten the centre and read as "that matters")
      const f = Math.min(AGE_VIGN_FADE, Math.min(W, H) * 0.5), ink = rgba(K.INK, AGE_VIGN_ALPHA), none = rgba(K.INK, 0);
      const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => { const lg = g.createLinearGradient(x0, y0, x1, y1); lg.addColorStop(0, ink); lg.addColorStop(1, none); g.fillStyle = lg; g.fillRect(rx, ry, rw, rh); };
      edge(0, 0, 0, f, 0, 0, W, f); edge(0, H, 0, H - f, 0, H - f, W, f); edge(0, 0, f, 0, 0, 0, f, H); edge(W, 0, W - f, 0, W - f, 0, f, H);
      // E3 · paper grain (pinned to the paper, not to the world)
      grainFill(g, grainSet(k).ink, 0, 0, W, H, AGE_GRAIN_ALPHA, k);
      g.restore();
    }
    // no map image yet: the walkable bounds as an inked plate with a graticule (real data only: bounds + a metric grid)
    function drawVectorLand(g, W, H) {
      const b = S && S.bounds;
      if (!b || !(b.maxX > b.minX)) return;
      const [x0, y0] = toPx(b.minX, b.minZ), [x1, y1] = toPx(b.maxX, b.maxZ);
      g.save();
      g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = P.vgrad(g, y0, y1 - y0, [[0, '#D9CCAA'], [1, '#CFC09B']]); g.fill();
      g.clip();
      const ppm = W / view.w;                                   // px per metre
      let step = 5;
      for (const st of [1, 2, 5, 10, 20, 50, 100, 200]) { if (st * ppm >= 22) { step = st; break; } }
      const major = step * 5;
      for (let pass = 0; pass < 2; pass++) {
        const st = pass ? major : step;
        g.fillStyle = rgba(K.INK, pass ? 0.20 : 0.085);
        for (let wx = Math.ceil(Math.max(b.minX, view.x) / st) * st; wx <= Math.min(b.maxX, view.x + view.w); wx += st) {
          if (!pass && wx % major === 0) continue;
          g.fillRect(Math.round(toPx(wx, 0)[0] * 2) / 2 - 0.5, y0, 1, y1 - y0);
        }
        for (let wz = Math.ceil(Math.max(b.minZ, view.y) / st) * st; wz <= Math.min(b.maxZ, view.y + view.h); wz += st) {
          if (!pass && wz % major === 0) continue;
          g.fillRect(x0, Math.round(toPx(0, wz)[1] * 2) / 2 - 0.5, x1 - x0, 1);
        }
      }
      g.restore();
      // neat line: ink edge + a faint inner rule (cartographic border of the plate)
      g.strokeStyle = rgba(K.INK, 0.6); g.lineWidth = 1.2; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = rgba(K.INK, 0.22); g.lineWidth = 1; g.strokeRect(x0 + 3.5, y0 + 3.5, x1 - x0 - 7, y1 - y0 - 7);
    }

    // WINDOW (live part, every frame while open): markers, labels, move target, player
    function drawWindow() {
      const g = win.g, k = win.s * win.dpr, A = L.win;
      const dx0 = Math.max(0, Math.floor(A.x * k)), dy0 = Math.max(0, Math.floor(A.y * k));
      const dw = Math.min(stat.width, Math.ceil((A.x + A.w) * k)) - dx0, dh = Math.min(stat.height, Math.ceil((A.y + A.h) * k)) - dy0;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(dx0, dy0, dw, dh);
      if (dw > 0 && dh > 0) g.drawImage(stat, dx0, dy0, dw, dh, dx0, dy0, dw, dh);
      if (!S || !view) return;
      g.setTransform(k, 0, 0, k, A.x * k, A.y * k);
      g.save(); g.beginPath(); g.rect(0, 0, A.w, A.h); g.clip();
      const wave = 0.5 + 0.5 * Math.sin(t * TAU * QUEST_BLINK_HZ), ms = S.markers || [], pl = S.player;
      // move order: dashed ink lead from you to the target, then the cross
      if (S.moveTo) {
        const [tx, ty] = toPx(S.moveTo.x, S.moveTo.z);
        if (pl) {
          const [px, py] = toPx(clamp(pl.x, view.x, view.x + view.w), clamp(pl.z, view.y, view.y + view.h));
          g.setLineDash([4, 4]); g.lineCap = 'butt';
          g.beginPath(); g.moveTo(px, py); g.lineTo(tx, ty); g.strokeStyle = rgba(K.VELLUM_HI, 0.55); g.lineWidth = 3; g.stroke();
          g.beginPath(); g.moveTo(px, py); g.lineTo(tx, ty); g.strokeStyle = rgba(K.INK, 0.55); g.lineWidth = 1.2; g.stroke();
          g.setLineDash([]);
        }
        cross(g, tx, ty, 4);
      }
      // creatures first (many, unlabelled), then NPC / quest / place marks with their label slots, then party
      let sel = null, hov = null;
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < ms.length; i++) {
          const m = ms[i], kd = KIND[m.kind] || KIND.poi;
          const want = kd.label === 'sel' ? 0 : kd.label === 'big' ? 1 : 2;
          if (want !== pass || !inView(m.x, m.z)) continue;
          const [x, y] = toPx(m.x, m.z), id = markerId(m, i);
          if (kd.shape === 'diamond') portal(g, x, y, DOT_RADIUS + 3);
          else if (kd.pulse) {
            inkDot(g, x, y, lerp(QUEST_RADIUS_MIN, QUEST_RADIUS_MAX, wave), rgba(kd.col, lerp(QUEST_BLINK_MIN_ALPHA, 1, wave)));
            ring(g, x, y, lerp(QUEST_RADIUS_MAX + 2, QUEST_RADIUS_MAX + 9, wave), rgba(K.INK, 0.5 * (1 - wave)), 1);
          } else inkDot(g, x, y, kd.r, kd.col);
          if (m.selected) {
            const rr = (kd.shape === 'diamond' ? DOT_RADIUS + 3 : kd.r) + 5;
            ring(g, x, y, rr + 1, rgba(K.VELLUM_HI, 0.6), 2.6); ring(g, x, y, rr + 1, rgba(K.INK, 0.85), 1.2);
          }
          const off = places.get(id);
          if (kd.label === 'big' && m.label && off) drawSprite(g, sprite(m.label, 'big', K.INK), x + off[0], y + off[1]);
          else if (kd.label === 'small' && m.label) drawSprite(g, sprite(m.label, 'small', K.INK_BODY), x + kd.r + 5, y + 4);
          if (m.label && kd.label === 'sel' && m.selected) sel = [m, x, y, kd];
          if (id === hoverId && m.label && !(kd.label === 'big' && off) && kd.label !== 'small') hov = [m, x, y, kd];
        }
      }
      for (const it of [sel, hov]) if (it && (it !== hov || !sel || hov[0] !== sel[0])) drawSprite(g, sprite(it[0].label, 'small', K.INK_BODY), it[1] + (it[3].r || DOT_RADIUS + 3) + 5, it[2] + 4);
      if (pl) drawPlayer(g, pl);
      g.restore();
    }
    // player: slow breathing ring (2.6 s) + green arrow; pinned to the window edge when outside the view
    function drawPlayer(g, pl) {
      const [px, py] = toPx(clamp(pl.x, view.x, view.x + view.w), clamp(pl.z, view.y, view.y + view.h));
      const breath = 0.5 + 0.5 * Math.sin(t * TAU / 2.6);
      ring(g, px, py, lerp(10, 16, breath), rgba(K.PLAYER, lerp(0.55, 0.18, breath)), 1.5);
      const yaw = pl.yaw || 0, dx = Math.sin(yaw), dy = Math.cos(yaw), qx = -dy, qy = dx;
      const tip = [px + dx * 9, py + dy * 9], bl = [px - dx * 4 - qx * 5, py - dy * 4 - qy * 5], br = [px - dx * 4 + qx * 5, py - dy * 4 + qy * 5];
      const tri = (o, col) => { g.beginPath(); g.moveTo(tip[0] + o[0], tip[1] + o[1]); g.lineTo(bl[0] + o[0], bl[1] + o[1]); g.lineTo(br[0] + o[0], br[1] + o[1]); g.closePath(); g.fillStyle = col; g.fill(); };
      tri([0, 0], 'rgba(5,13,8,.9)');
      tri([dx * 0.8, dy * 0.8], K.PLAYER);
      g.beginPath(); g.moveTo(tip[0], tip[1]); g.lineTo(bl[0], bl[1]); g.lineTo(br[0], br[1]); g.closePath();
      g.lineJoin = 'round'; g.strokeStyle = 'rgba(191,255,209,.9)'; g.lineWidth = 1; g.stroke();
    }

    // CHROME: well lip + cartouche + rose + scale + nails + header + clasp + footer (over the map; redrawn on change)
    function drawChrome(title, coords, zoomText) {
      const g = chrome.begin(), A = L.win, W = L.w, H = L.h;
      // 11b · well lip: two inner shadow bands so the map sits IN the paper
      g.lineWidth = 4; g.strokeStyle = 'rgba(20,14,8,.50)'; g.strokeRect(A.x + 2, A.y + 2, A.w - 4, A.h - 4);
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,14,8,.22)'; g.strokeRect(A.x + 6, A.y + 6, A.w - 12, A.h - 12);
      if (rows.length) drawCartouche(g);
      drawRose(g);
      if (view) drawScale(g);
      const lf = L.leaf;
      for (const [x, y] of [[lf.x + NAIL_IN, lf.y + NAIL_IN], [lf.x + lf.w - NAIL_IN, lf.y + NAIL_IN], [lf.x + NAIL_IN, lf.y + lf.h - NAIL_IN], [lf.x + lf.w - NAIL_IN, lf.y + lf.h - NAIL_IN]]) nail(g, x, y, NAIL_R);
      // header: region name carved into the leather + the amber rule (amber budget point 1)
      if (title) {
        const asc = P.metrics(mctx, FT.title).a, top = HEAD_H * 0.5 - asc * 0.5, baseY = top + asc;
        text(g, title, FT.title, 34, baseY + 1.1, K.CARVE, 4); text(g, title, FT.title, 34, baseY, K.TOOLED, 4);
        g.fillStyle = rgba(K.AMBER, 0.85); g.fillRect(34, baseY + 5, Math.min(measure(title, FT.title, 4), 240), 2);
      }
      drawClasp(g);
      // footer: coords · zoom rail · hint, all carved into the leather
      const ft = footerLayout(zoomText);
      drawRail(g);
      const by = H - FOOT_H + FOOT_H * 0.5 + 4.5;
      if (coords) carve(g, coords, 34, by, FT.small(12), rgba(K.TOOLED, 0.80));
      if (ft.zoom) carve(g, ft.zoom, L.rail.x + L.rail.w + 10, by, FT.small(11), rgba(K.TOOLED, 0.70));
      if (ft.hint) carve(g, ft.hint, W - 34 - measure(ft.hint, FT.small(12)), by, FT.small(12), rgba(K.TOOLED, 0.62));
    }
    // Atherion's footer assumes its ~936 px sheet; this world's sheet is narrower (and smaller again below 840 px height).
    // Same order, never overlapping: the rail clears the WIDEST possible coords line (stable, does not jump with the cursor),
    // then the zoom label and the hint fall back to shorter forms ("×1,00", "M · ESC — Kapat") or drop out.
    function footerLayout(zoomText) {
      const W = L.w, fs = FT.small(12), fz = FT.small(11), b = S && S.bounds;
      const dig = b ? Math.max(...[b.minX, b.maxX, b.minZ, b.maxZ].map((v) => String(Math.round(v)).length)) : 4;
      const n = '-' + '8'.repeat(Math.max(1, dig - 1)), tmpl = T.coordsYou + '  ' + n + ' · ' + n + '   ·   ' + T.coordsCursor + '  ' + n + ' · ' + n;
      let rx = Math.max((W - RAIL_W) * 0.5, 34 + measure(tmpl, fs) + 16);
      if (rx + RAIL_W > W - 34) rx = (W - RAIL_W) * 0.5;
      L.rail.x = rx;
      const zShort = zoomText.slice(zoomText.indexOf('×')), hShort = T.hint.slice(T.hint.lastIndexOf('    ') + 4);
      for (const [z, hnt] of [[zoomText, T.hint], [zShort, T.hint], [zoomText, hShort], [zShort, hShort], [zShort, '']]) {
        const zEnd = rx + RAIL_W + 10 + measure(z, fz);
        if (!hnt || W - 34 - measure(hnt, fs) >= zEnd + 18) return { zoom: z, hint: hnt };
      }
      return { zoom: zShort, hint: '' };
    }
    function drawClasp(g) {
      const r = L.clasp, lit = closePress ? -0.07 : closeHover ? 0.10 : 0;
      P.octPath(g, r.x + 1, r.y + 1.5, r.w, r.h, 5); g.fillStyle = 'rgba(16,11,7,.55)'; g.fill();
      const ramp = RAMP_IRON.map(([o, c]) => [o, lit ? P.mix(c, lit > 0 ? '#FFFFFF' : '#000000', Math.abs(lit)) : c]);
      P.octPath(g, r.x, r.y, r.w, r.h, 5); P.fillRamp(g, r.y, r.h, ramp);
      P.octPath(g, r.x, r.y, r.w, r.h, 5); g.strokeStyle = rgba(K.IRON_HI, 0.42); g.lineWidth = 1; g.stroke();
      nail(g, r.x + 4.5, r.y + 4.5, 1.9); nail(g, r.x + r.w - 4.5, r.y + r.h - 4.5, 1.9);
      const glyph = '✕', f = FT.label(15), w = measure(glyph, f), x = r.x + (r.w - w) * 0.5, y = r.y + r.h * 0.66;
      text(g, glyph, f, x, y + 1, K.CARVE); text(g, glyph, f, x, y, rgba(K.TOOLED, closeHover ? 1 : 0.86));
    }
    function drawRail(g) {
      const r = L.rail;
      g.fillStyle = 'rgba(16,11,7,.72)'; g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = rgba(K.IRON_HI, 0.35); g.lineWidth = 1; g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      for (let i = 0; i < RAIL_NOTCHES; i++) {
        const tt = i / Math.max(RAIL_NOTCHES - 1, 1), nx = r.x + RAIL_INSET + tt * (r.w - RAIL_INSET * 2);
        g.fillStyle = rgba(K.IRON_HI, i % 3 === 0 ? 0.62 : 0.32);
        g.fillRect(Math.round(nx) - 0.5, r.y + r.h * 0.28, 1, r.h * 0.44);
      }
      // knob: amber (amber budget point 2)
      const kx = railKnobX(r, zoom);
      g.fillStyle = 'rgba(12,8,5,.60)'; g.fillRect(kx - 4, r.y - 2, 8, r.h + 4);
      g.fillStyle = K.AMBER; g.fillRect(kx - 3.2, r.y - 2, 6.4, r.h + 4);
      g.fillStyle = 'rgba(20,14,8,.45)'; g.fillRect(kx - 0.6, r.y - 1, 1.2, r.h + 2);
    }
    function legendMark(g, row, x, y) {
      if (row.shape === 'diamond') portal(g, x, y, 5.6);
      else if (row.shape === 'cross') cross(g, x, y, 3);
      else inkDot(g, x, y, row.r, row.col);
    }
    // cartouche: dog-eared vellum plate pinned to the map's lower-left corner (paper on paper)
    function drawCartouche(g) {
      const h = Math.max(rows.length, 1) * CART_ROW + CART_HEAD, r = { x: L.win.x + CART_PAD, y: L.win.y + L.win.h - CART_PAD - h, w: CART_W, h }, fold = 13;
      g.fillStyle = 'rgba(30,22,14,.30)'; g.fillRect(r.x + 1.5, r.y + 2, r.w, r.h);
      const body = [[r.x, r.y], [r.x + r.w - fold, r.y], [r.x + r.w, r.y + fold], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
      polyPath(g, body); P.fillRamp(g, r.y, r.h, RAMP_VELLUM);
      polyPath(g, body); g.strokeStyle = rgba(K.INK, 0.55); g.lineWidth = 1; g.lineJoin = 'miter'; g.stroke();
      const tri = [[r.x + r.w - fold, r.y], [r.x + r.w, r.y + fold], [r.x + r.w - fold, r.y + fold]];
      polyPath(g, tri); g.fillStyle = P.darkened(K.VELLUM_LO, 0.10); g.fill();
      polyPath(g, tri); g.strokeStyle = rgba(K.INK, 0.45); g.stroke();
      const tf = FT.cart(10);
      text(g, trUpper(T.legendTitle), tf, r.x + 10, r.y + 6 + P.metrics(mctx, tf).a, rgba(K.INK, 0.78), 3);
      g.fillStyle = rgba(K.INK, 0.35); g.fillRect(r.x + 10, r.y + 21.5, r.w - 20, 1);
      let y = r.y + CART_HEAD + 2 + CART_ROW * 0.30;
      for (const row of rows) {
        legendMark(g, row, r.x + 17, y);
        text(g, row.text, FT.small(12), r.x + 30, y + 4.2, K.INK_BODY);
        y += CART_ROW;
      }
    }
    // north rose: eight arms (four filled), two rings, 32 ticks, fleur + "K" — ink only, no amber
    function drawRose(g) {
      const c = L.rose, R = ROSE_R;
      ring(g, c.x, c.y, R, rgba(K.INK, 0.55), 1.1);
      ring(g, c.x, c.y, R * 0.62, rgba(K.INK, 0.30), 0.7);
      g.lineCap = 'butt';
      for (let i = 0; i < 32; i++) {
        const a = i / 32 * TAU - Math.PI / 2, l = R * (i % 4 === 0 ? 0.10 : 0.05), ux = Math.cos(a), uy = Math.sin(a);
        g.beginPath(); g.moveTo(c.x + ux * R, c.y + uy * R); g.lineTo(c.x + ux * (R - l), c.y + uy * (R - l));
        g.strokeStyle = rgba(K.INK, i % 4 === 0 ? 0.55 : 0.30); g.lineWidth = 0.8; g.stroke();
      }
      const arm = (a, tip, bs, w) => {
        g.beginPath(); g.moveTo(c.x + Math.cos(a) * tip, c.y + Math.sin(a) * tip);
        g.lineTo(c.x + Math.cos(a + w) * bs, c.y + Math.sin(a + w) * bs); g.lineTo(c.x + Math.cos(a - w) * bs, c.y + Math.sin(a - w) * bs); g.closePath();
      };
      g.lineJoin = 'miter';
      for (let i = 0; i < 4; i++) { arm(i / 4 * TAU + Math.PI / 4 - Math.PI / 2, R * 0.66, R * 0.20, 0.13); g.strokeStyle = rgba(K.INK, 0.55); g.lineWidth = 0.9; g.stroke(); }
      for (let i = 0; i < 4; i++) { arm(i / 4 * TAU - Math.PI / 2, R * 0.92, R * 0.26, 0.15); g.fillStyle = rgba(K.INK, i === 0 ? 0.88 : 0.62); g.fill(); }
      g.beginPath(); g.moveTo(c.x, c.y - R * 1.02); g.lineTo(c.x - R * 0.09, c.y - R * 0.82); g.lineTo(c.x + R * 0.09, c.y - R * 0.82); g.closePath();
      g.fillStyle = rgba(K.INK, 0.88); g.fill();
      const f = FT.cart(11), w = measure('K', f, 3);
      text(g, 'K', f, c.x - w * 0.5, c.y - R * 1.14, rgba(K.INK, 0.80), 3);
    }
    // scale bar: alternating cells, lining numbers above, unit label on top
    function drawScale(g) {
      const upx = view.w / L.win.w, step = scaleStepFor(upx), seg = step / Math.max(upx, 0.0001), total = seg * SCALE_SEGMENTS;
      const x0 = L.scaleAnchor.x - total, y = L.scaleAnchor.y - SCALE_H;
      for (let i = 0; i < SCALE_SEGMENTS; i++) {
        g.fillStyle = i % 2 === 0 ? rgba(K.INK, 0.82) : rgba(K.VELLUM_HI, 0.86); g.fillRect(x0 + i * seg, y, seg, SCALE_H);
        g.strokeStyle = rgba(K.INK, 0.75); g.lineWidth = 1; g.strokeRect(x0 + i * seg, y, seg, SCALE_H);
      }
      // numbers + unit get the map's vellum halo (§07 legibility rule): here they sit on the terrain picture, not on mist
      const nf = FT.small(10);
      for (let i = 0; i <= SCALE_SEGMENTS; i++) {
        const str = String(step * i), w = measure(str, nf);
        haloText(g, str, nf, x0 + i * seg - w * 0.5, y - 5, K.INK_BODY, 0, 10);
      }
      const lab = trUpper(T.scaleUnit), lf = FT.cart(9), lw = measure(lab, lf, 3);
      haloText(g, lab, lf, x0 + total * 0.5 - lw * 0.5, y - 30 + P.metrics(mctx, lf).a, rgba(K.INK, 0.70), 3, 9);
    }
    function haloText(g, str, font, x, y, col, track, size) {
      const r = Math.max(size * 0.16, 1.4);
      for (let i = 0; i < HALO_STEPS; i++) { const a = i / HALO_STEPS * TAU; text(g, str, font, x + Math.cos(a) * r, y + Math.sin(a) * r, rgba(K.VELLUM_HI, HALO_ALPHA), track); }
      text(g, str, font, x, y, col, track);
    }

    /* ================= input (map_controller._on_sheet_input) ================= */
    const localOf = (e) => { const r = sheet.getBoundingClientRect(); return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; };
    const onMap = (l) => L && hit(L.win, l[0], l[1]);
    root.addEventListener('pointerdown', (e) => { if (e.target === root && e.button === 0) hud.windows.close('map'); });   // dim click closes
    root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    sheet.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!L || e.button !== 0 || e.target === closeBtn) return;
      const l = localOf(e); lastLocal = l;
      if (hit(growR(L.rail, 6), l[0], l[1])) {           // rail: click = jump, hold = drag-zoom
        drag = 'rail'; applyZoom(zoomFromRail(L.rail, l[0]));
      } else if (onMap(l) && zoom > ZOOM_MIN + 0.001) {   // pan only makes sense when zoomed in
        drag = 'map'; sheet.classList.add('grabbing');
      } else return;
      lastCX = e.clientX; lastCY = e.clientY;
      try { sheet.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      e.preventDefault();
    });
    sheet.addEventListener('pointermove', (e) => {
      if (!L) return;
      const l = localOf(e); lastLocal = l;
      if (drag === 'rail') applyZoom(zoomFromRail(L.rail, l[0]));
      else if (drag === 'map') { panBy((e.clientX - lastCX) / s, (e.clientY - lastCY) / s); lastCX = e.clientX; lastCY = e.clientY; }
      updateCursor();
      hoverId = cursorOn && !drag ? pickMarker(l[0] - L.win.x, l[1] - L.win.y) : null;
      sheet.classList.toggle('grab', !drag && cursorOn && zoom > ZOOM_MIN + 0.001);
    });
    const endDrag = (e) => { if (!drag) return; drag = null; sheet.classList.remove('grabbing'); try { sheet.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ } };
    sheet.addEventListener('pointerup', endDrag);
    sheet.addEventListener('pointercancel', endDrag);
    sheet.addEventListener('pointerleave', () => { if (!drag) { lastLocal = null; cursorOn = false; hoverId = null; } });
    sheet.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!L) return;
      const l = localOf(e);
      if (!onMap(l)) return;                               // the wheel is always swallowed on the sheet; it zooms only over the map
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      wheelAcc += dy;
      if (Math.abs(wheelAcc) < 60 && Math.abs(dy) < 50) return;   // trackpads: accumulate small deltas into one notch
      const dir = wheelAcc < 0 ? 1 : -1; wheelAcc = 0;
      applyZoom(dir > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, l[0] - L.win.x, l[1] - L.win.y);
    }, { passive: false });
    closeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    closeBtn.addEventListener('mouseenter', () => { closeHover = true; });
    closeBtn.addEventListener('mouseleave', () => { closeHover = false; closePress = false; });
    closeBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.button === 0) closePress = true; });
    closeBtn.addEventListener('pointerup', () => { closePress = false; });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hud.windows.close('map'); });
    // + / − zoom while open (swallowed so nothing else sees them); inert when closed
    function onKey(e) {
      if (!open || e.ctrlKey || e.altKey || e.metaKey) return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      const k = e.key, inK = k === '+' || k === '=' || e.code === 'NumpadAdd', outK = k === '-' || k === '−' || e.code === 'NumpadSubtract';
      if (!inK && !outK) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) applyZoom(inK ? zoom * ZOOM_STEP : zoom / ZOOM_STEP);
    }
    function pickMarker(lx, ly) {
      if (!S || !view) return null;
      let best = null, bd = 10 * 10;
      const ms = S.markers || [];
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        if (!inView(m.x, m.z)) continue;
        const [x, y] = toPx(m.x, m.z), d = (x - lx) * (x - lx) + (y - ly) * (y - ly);
        if (d < bd) { bd = d; best = markerId(m, i); }
      }
      return best;
    }

    /* ================= lifecycle ================= */
    function readState() {
      S = (hud.state && hud.state.map) || (hud.minimap && hud.minimap.state) || null;
      const b = S && S.bounds, key = b ? [b.minX, b.maxX, b.minZ, b.maxZ].join(',') : 'none';
      if (key !== worldKey || !world) {
        worldKey = key; world = worldFrom(S);
        if (!viewInit || !b) { zoom = ZOOM_MIN; viewInit = true; }   // zoom + centre survive closing and reopening (Atherion 2026-10-12)
        cx = world.x + world.w / 2; cz = world.y + world.h / 2;
        layoutDirty = true;
      }
    }
    hud.windows.register('map', root, {
      onOpen() {
        open = true; t = 0; sampleT = SAMPLE_INTERVAL; chromeKey = ''; staticKey = '';
        D.addEventListener('keydown', onKey, true);
        readState(); if (layoutDirty) layout(); else refreshView();
      },
      onClose() {
        open = false; drag = null; closeHover = false; closePress = false; cursorOn = false; hoverId = null; lastLocal = null;
        sheet.classList.remove('grab', 'grabbing');
        D.removeEventListener('keydown', onKey, true);
        // free the four sheet-sized backing stores while closed (~13 MB each at DPR 2); the next open rebuilds them
        for (const c of [base.el, win.el, chrome.el, stat]) { c.width = 1; c.height = 1; }
        layoutDirty = true;
      },
    });
    P.onFonts(() => { sprites.clear(); chromeKey = ''; sampleT = SAMPLE_INTERVAL; });

    return {
      root,
      frame(dt) {
        if (!open) return;
        t += dt;
        readState();
        if (layoutDirty || !L) layout();
        if (!view) refreshView();
        sampleT += dt;
        if (sampleT >= SAMPLE_INTERVAL) { sampleT = 0; placeLabels(); }
        if (baseDirty) drawBase();
        const img = imageInfo(), k = base.s * base.dpr;
        const sk = [view.x, view.y, view.w, view.h].map((v) => v.toFixed(3)).join(',') + '|' + worldKey + '|' + L.w + 'x' + L.h + '|' + k +
          '|' + (img ? (img.version !== undefined ? img.version : '') + ':' + img.minX + ',' + img.maxX + ',' + img.minZ + ',' + img.maxZ + ':' + (img.src.width || 0) : '-');
        if (sk !== staticKey || (img && tinted.src !== img.src)) { staticKey = sk; drawStatic(img); }
        drawWindow();
        rows = legendRows();
        const rk = rows.map((r) => r.text).join('|');
        if (rk !== rowsKey) rowsKey = rk;
        const title = (S && (S.world || S.region)) || '';
        const parts = [];
        if (S && S.player) parts.push(T.coordsYou + '  ' + Math.round(S.player.x) + ' · ' + Math.round(S.player.z));
        if (cursorOn) parts.push(T.coordsCursor + '  ' + Math.round(cursorX) + ' · ' + Math.round(cursorZ));
        const coords = parts.join('   ·   ').replace(/-0(?!\d)/g, '0');
        const zoomText = T.zoom + '  ×' + zoom.toFixed(2).replace('.', ',');
        const ck = [title, coords, zoomText, zoom.toFixed(4), closeHover, closePress, rowsKey, view.w.toFixed(4), L.w, L.h, k].join('|');
        if (ck !== chromeKey) { chromeKey = ck; drawChrome(title, coords, zoomText); }
      },
      resize(ns) {
        s = ns || s; layoutDirty = true; sprites.clear();
        if (open) { layout(); }
      },
      // dev / bench helper: set the zoom (and optionally the view centre in world x / z)
      zoomTo(z, x, zz) { if (!world) readState(); if (x !== undefined) { cx = x; cz = zz; } applyZoom(z); refreshView(); },
      get zoom() { return zoom; },
      get view() { return view && Object.assign({}, view); },
    };
  };
})(window);
