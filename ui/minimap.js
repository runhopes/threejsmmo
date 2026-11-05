/* TDS HUD part — top-right minimap ("Ufuk" pafta), ported 1:1 from Atherion:
 *   minimap_sheet.gd      220² window 24 px from the right / 20 px from the top, soft shadow + thin double edge, north "K",
 *                         hover glyphs (− + and the ×N reading), region name (Cinzel 600 16) and the info line under the window.
 *   minimap_mask.gd       76° view cone (camera forward), 2.6 px dots with a dark halo ring, quest diamonds pinned to the edge,
 *                         notched bone player arrow (the way the character faces), rectangular marker clip.
 *   minimap_controller.gd + shaders/minimap_cached.gdshader   zoom ladder (wheel / glyphs), 16 px edge vignette α .40,
 *                         "no terrain" tone #14110E, map colour grade toward the same target look (see GRADE).
 * Layout C of ust_hud_tasarim.html ("Aksiyon Düzeni"). Units = Atherion canvas px, scaled by hud.s.
 *
 * Data: mapState { region, bounds, player {x,z,yaw}, view {x,z}, moveTo, markers [{id,x,z,kind,selected,label}], image? }.
 *   image = { src: canvas|img, minX, maxX, minZ, maxZ, version? } — the game's top-down render of the world (north = minZ at the top),
 *   drawn as Atherion draws its terrain texture: colour-graded once per src/version (bump `version` if the same canvas is re-rendered),
 *   then the edge vignette. Without an image (e.g. ?world=arena) a vector backdrop (bounds + survey grid) is drawn instead.
 * Info line: Atherion shows "☀ clock · x, z · ▮▮▯ ping"; this game has no clock and no ping, so it shows "x, −z" and — in the slot
 *   where Atherion keeps its network reading — the HUD's perf text (fps · triangles) while hud.settings.perf is on.
 * API: { root, perf, set(mapState), frame(dt), redraw(), resize(s), get state() }.
 */
(function (global) {
  'use strict';
  const MOBILE_MM = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches); let mmAcc = 0;   // [perf] see frame()
  const P = global.HUDPaint, C = P.C, F = P.F;

  // ── minimap_sheet.gd geometry ──
  const WIN = 220, EDGE = 24, TOP = 20;
  const NAME_BASE = WIN + 26, INFO_BASE = WIN + 46, BOARD_H = WIN + 56;
  const SHADOW_R = 14, SHADOW_A = 0.55, NORTH_BASE = 16, NORTH_PX = 11, NAME_PX = 16, INFO_PX = 14, GLYPH_PX = 18;
  const COL_INFO_DOT = '#9B9589';                                   // Color(0.608, 0.584, 0.537)
  const ZOOM_OUT_X = WIN - 40, ZOOM_IN_X = WIN - 18, ZOOM_BASE = WIN - 10, ZOOM_HIT = 18, SCALE_X = 12, SCALE_BASE = WIN - 11;
  const F_NAME = F.cinzel(600, NAME_PX), F_NORTH = F.cinzel(700, NORTH_PX), F_INFO = F.sans(700, INFO_PX), F_GLYPH = F.sans(500, GLYPH_PX);
  // canvas margins around the board (shadow, centred text wider than the window)
  const PADL = 96, PADR = EDGE, PADT = 18, PADB = 8;

  // ── minimap_mask.gd ──
  const DOT_R = 4.1;                                                // texture radius: core 0.72 R, dark halo to ~0.93 R
  const CLIP_PAD = 7.5 + 2.0;                                        // MAX_DOT_RADIUS + 2
  const CONE_HALF = 38 * Math.PI / 180, CONE_R = 74, CONE_A = 0.30;
  const QUEST_MARK_R = 5, QUEST_MARK_INSET = 9;
  const COL_QUEST = '#E3AF55', COL_ARROW = '#F4EEE0', COL_ARROW_EDGE = 'rgba(22,14,8,.95)', COL_MARK_EDGE = 'rgba(28,18,8,.9)';
  const COL = {
    mob: '#CF5444',                                                 // mob_color (0.812, 0.329, 0.267)
    npc: '#ECE3D0',                                                 // npc_color — bone
    player: '#59F26B',                                              // player_color (0.35, 0.95, 0.42) — other players
    party: '#E0956B',                                               // party_color (0.878, 0.584, 0.420) — copper
  };
  // game marker kinds -> Atherion dot families (Atherion draws every creature red, aggressive or not)
  const KIND = { hostile: 'mob', neutral: 'mob', friendly: 'player', party: 'party', npc: 'npc' };

  // ── shaders/minimap_cached.gdshader ──
  const EMPTY = '#14110E', VIGN_PX = 16, VIGN_A = 0.40;
  // Atherion grades its UNLIT albedo (luma .386 / std .071 / sat .577) toward the approved noon look (luma .466 / std .098 / sat .485)
  // with saturation .84 · gain 1.21 · contrast 1.14. This game's render is already lit and less saturated (village interior measured
  // .408 / .078 / .391), so the same target is reached with gain + contrast only (→ .46 / .10 / .46); re-desaturating would grey it.
  const GRADE = 'brightness(1.15) contrast(1.18)';

  // ── zoom (minimap_controller.gd): the same ladder, sized to this game's world (Atherion: 80..840 step 40, default 440 units) ──
  const VIEW_MIN = 20, VIEW_MAX = 120, VIEW_STEP = 10, VIEW_DEFAULT = 60;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function MinimapPart(hud) {
    const root = document.createElement('div');
    root.className = 'ath-mm';
    root.style.cssText = 'position:absolute;right:calc(' + (EDGE - PADR) + 'px * var(--s));top:calc(' + (TOP - PADT) + 'px * var(--s));pointer-events:none';
    hud.frame.appendChild(root);
    const surf = P.surface(root, 'ath-mm-cv', PADL + WIN + PADR, PADT + BOARD_H + PADB, PADL, PADT);
    surf.el.style.cssText = 'display:block;pointer-events:none;font-variant-numeric:lining-nums tabular-nums;font-feature-settings:"lnum" 1,"tnum" 1';
    // only the map window takes the mouse (minimap_sheet._has_point); name + info line stay transparent to the world
    const hit = document.createElement('div');
    hit.className = 'ath-mm-hit';
    hit.style.cssText = 'position:absolute;left:calc(' + PADL + 'px * var(--s));top:calc(' + PADT + 'px * var(--s));width:calc(' + WIN + 'px * var(--s));height:calc(' + WIN + 'px * var(--s));pointer-events:auto;cursor:pointer';
    root.appendChild(hit);
    // the HUD writes the perf reading here (textContent / hidden); it is drawn into the info line, the element itself never shows
    const perf = document.createElement('div');
    perf.className = 'perf ath-mm-perf';
    perf.style.cssText = 'display:none';
    root.appendChild(perf);

    let S = null, dirty = true, hover = false, sig = '', coordKey = '', perfKey = '';
    let view = +hud.settings.mapZoom;
    if (!(view >= VIEW_MIN && view <= VIEW_MAX)) view = VIEW_DEFAULT;      // legacy index (0..2) or unset
    const mark = () => { dirty = true; };
    P.onFonts(mark);
    new MutationObserver(() => {
      const k = (perf.hidden ? '' : perf.textContent || '');
      if (k !== perfKey) { perfKey = k; dirty = true; }
    }).observe(perf, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

    // ── input (minimap_sheet._gui_input): wheel anywhere on the window, − / + glyphs while hovered; elsewhere opens the world map ──
    function setView(v) {
      const nv = clamp(v, VIEW_MIN, VIEW_MAX);
      if (nv === view) return;
      view = nv; hud.settings.mapZoom = nv; hud.saveSettings(); dirty = true;
    }
    function local(e) {
      const r = hit.getBoundingClientRect(), k = WIN / Math.max(1, r.width);
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
    }
    const inRect = (p, x, y, w, h) => p.x >= x && p.x < x + w && p.y >= y && p.y < y + h;
    const glyphY = ZOOM_BASE - ZOOM_HIT + 4;
    hit.addEventListener('mouseenter', () => { hover = true; dirty = true; });
    hit.addEventListener('mouseleave', () => { hover = false; dirty = true; });
    hit.addEventListener('mousedown', (e) => e.preventDefault());
    hit.addEventListener('pointerdown', (e) => e.stopPropagation());
    hit.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); setView(view + (e.deltaY < 0 ? -VIEW_STEP : VIEW_STEP)); }, { passive: false });
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = local(e);
      if (inRect(p, ZOOM_OUT_X - ZOOM_HIT * 0.5, glyphY, ZOOM_HIT, ZOOM_HIT)) { setView(view + VIEW_STEP); return; }
      if (inRect(p, ZOOM_IN_X - ZOOM_HIT * 0.5, glyphY, ZOOM_HIT, ZOOM_HIT)) { setView(view - VIEW_STEP); return; }
      if (hud.windows.reg && hud.windows.reg.map) hud.windows.toggle('map');
    });

    // ── map image: graded once per source (the shader's saturation / gain / contrast on an unlit render) ──
    let graded = null, gradedKey = null;
    function gradedImage(im) {
      const src = im.src, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      if (!w || !h) return null;
      if (graded && gradedKey && gradedKey.src === src && gradedKey.v === im.version && gradedKey.w === w && gradedKey.h === h) return graded;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cg = cv.getContext('2d');
      cg.filter = GRADE; cg.drawImage(src, 0, 0);
      graded = cv; gradedKey = { src, v: im.version, w, h };
      return graded;
    }

    // ── drawing ──
    function drawImageLayer(g, im, X, Y, k, x0, z0, x1, z1) {
      const tex = gradedImage(im);
      if (!tex) return false;
      const iw = im.maxX - im.minX, ih = im.maxZ - im.minZ;
      if (!(iw > 0 && ih > 0)) return false;
      const ax = Math.max(x0, im.minX), bx = Math.min(x1, im.maxX), az = Math.max(z0, im.minZ), bz = Math.min(z1, im.maxZ);
      if (bx <= ax || bz <= az) return true;
      const sx = (ax - im.minX) / iw * tex.width, sy = (az - im.minZ) / ih * tex.height;
      const sw = (bx - ax) / iw * tex.width, sh = (bz - az) / ih * tex.height;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(tex, sx, sy, sw, sh, X(ax), Y(az), (bx - ax) * k, (bz - az) * k);
      return true;
    }
    // vector backdrop (no world render yet): walkable area as a muted earth plate, 10 m / 50 m survey grid, bone border
    function drawVector(g, X, Y, k, x0, z0, x1, z1) {
      const b = S.bounds;
      if (b) {
        const bx = X(b.minX), by = Y(b.minZ), bw = (b.maxX - b.minX) * k, bh = (b.maxZ - b.minZ) * k;
        g.fillStyle = '#2E2920'; g.fillRect(bx, by, bw, bh);
        g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
      }
      const minor = 10, major = 50;
      for (let pass = 0; pass < 2; pass++) {
        const s = pass ? major : minor;
        g.fillStyle = pass ? 'rgba(236,227,208,.10)' : 'rgba(236,227,208,.045)';
        for (let wx = Math.ceil(x0 / s) * s; wx <= x1; wx += s) { if (!pass && wx % major === 0) continue; g.fillRect(Math.round(X(wx)), 0, 1, WIN); }
        for (let wz = Math.ceil(z0 / s) * s; wz <= z1; wz += s) { if (!pass && wz % major === 0) continue; g.fillRect(0, Math.round(Y(wz)), WIN, 1); }
      }
      if (b) {
        g.restore();
        P.frame1(g, Math.round(X(b.minX)), Math.round(Y(b.minZ)), Math.round((b.maxX - b.minX) * k), Math.round((b.maxZ - b.minZ) * k), 'rgba(236,227,208,.22)');
      }
    }
    // four edge gradients; corners compose to 1 − (1 − vx)(1 − vy) like the shader
    function vignette(g) {
      const lg = (ax, ay, bx, by) => { const q = g.createLinearGradient(ax, ay, bx, by); q.addColorStop(0, 'rgba(0,0,0,' + VIGN_A + ')'); q.addColorStop(1, 'rgba(0,0,0,0)'); return q; };
      g.fillStyle = lg(0, 0, VIGN_PX, 0); g.fillRect(0, 0, VIGN_PX, WIN);
      g.fillStyle = lg(WIN, 0, WIN - VIGN_PX, 0); g.fillRect(WIN - VIGN_PX, 0, VIGN_PX, WIN);
      g.fillStyle = lg(0, 0, 0, VIGN_PX); g.fillRect(0, 0, WIN, VIGN_PX);
      g.fillStyle = lg(0, WIN, 0, WIN - VIGN_PX); g.fillRect(0, WIN - VIGN_PX, WIN, VIGN_PX);
    }
    // MinimapMask dot texture: colour core (0.72 R) inside a near-black halo of the same hue (colour × 0.06) out to ~0.93 R
    function dot(g, x, y, col, R) {
      const r = R || DOT_R, [cr, cg, cb] = P.hexRGB(col);
      g.fillStyle = 'rgb(' + Math.round(cr * 0.06) + ',' + Math.round(cg * 0.06) + ',' + Math.round(cb * 0.06) + ')';
      g.beginPath(); g.arc(x, y, r * 0.93, 0, Math.PI * 2); g.fill();
      g.fillStyle = col;
      g.beginPath(); g.arc(x, y, r * 0.72, 0, Math.PI * 2); g.fill();
    }
    // point of interest (no Atherion equivalent): the same dot footprint, hollow, in ash
    function poi(g, x, y) {
      g.fillStyle = 'rgba(16,10,6,.92)'; g.beginPath(); g.arc(x, y, DOT_R * 0.93, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.U_ASH; g.lineWidth = 1.3; g.beginPath(); g.arc(x, y, DOT_R * 0.55, 0, Math.PI * 2); g.stroke();
    }
    // quest diamond: 2 px soft shadow diamond + fill + 1.2 px dark outline
    function diamond(g, x, y, r, col) {
      const path = (rr) => { g.beginPath(); g.moveTo(x, y - rr); g.lineTo(x + rr, y); g.lineTo(x, y + rr); g.lineTo(x - rr, y); g.closePath(); };
      path(r + 2); g.fillStyle = 'rgba(0,0,0,.30)'; g.fill();
      path(r); g.fillStyle = col; g.fill();
      g.lineWidth = 1.2; g.lineJoin = 'miter'; g.strokeStyle = COL_MARK_EDGE; g.stroke();
    }
    function arrow(g, cx, cy, yaw) {
      let dx = Math.sin(yaw), dy = Math.cos(yaw);
      if (!isFinite(dx) || !isFinite(dy)) { dx = 0; dy = 1; }
      const px = -dy, py = dx;
      const pts = [[cx + dx * 9, cy + dy * 9], [cx - dx * 6.5 + px * 6.2, cy - dy * 6.5 + py * 6.2], [cx - dx * 3, cy - dy * 3], [cx - dx * 6.5 - px * 6.2, cy - dy * 6.5 - py * 6.2]];
      const poly = (list) => { g.beginPath(); list.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      poly(pts.map((p) => [cx + (p[0] - cx) * 1.35, cy + (p[1] - cy) * 1.35 + 1])); g.fillStyle = 'rgba(0,0,0,.30)'; g.fill();
      poly(pts); g.fillStyle = COL_ARROW; g.fill();
      g.lineWidth = 1.4; g.lineJoin = 'miter'; g.strokeStyle = COL_ARROW_EDGE; g.stroke();
    }
    function zoomText() {
      return '×' + (VIEW_DEFAULT / Math.max(view, 1)).toFixed(1).replace('.', ',');
    }
    // info line: "x, −z" (+ "  ·  " + perf segments) centred under the window (minimap_sheet._draw_info_line)
    function infoLine(g, cx, base) {
      const dotS = '  ·  ', items = [{ t: coordKey, col: C.U_ASH }];
      if (perfKey) for (const seg of perfKey.split('·').map((s) => s.trim()).filter(Boolean)) { items.push({ t: dotS, col: COL_INFO_DOT }); items.push({ t: seg, col: C.U_ASH }); }
      let total = 0;
      for (const it of items) { it.w = P.width(g, it.t, F_INFO); total += it.w; }
      let x = cx - total * 0.5;
      for (const it of items) x += P.ufuk(g, it.t, F_INFO, x, base, it.col, -1);
    }

    function draw() {
      const g = surf.begin();
      g.save();
      g.beginPath(); g.rect(0, 0, WIN, WIN); g.clip();
      g.fillStyle = EMPTY; g.fillRect(0, 0, WIN, WIN);
      if (S && S.player) {
        const p = S.player, k = WIN / view, cx = WIN * 0.5, cy = WIN * 0.5, half = view * 0.5;
        const X = (wx) => cx + (wx - p.x) * k, Y = (wz) => cy + (wz - p.z) * k;
        const x0 = p.x - half, x1 = p.x + half, z0 = p.z - half, z1 = p.z + half;
        const mi = S.miniImage && S.miniImage.src ? S.miniImage : S.image;   // miniImage = oyuncu çevresinin yüksek çözünürlüklü çekimi (dünya görüntüsü ~0,8 px/m, bulanık kalır)
        if (!(mi && mi.src && drawImageLayer(g, mi, X, Y, k, x0, z0, x1, z1))) drawVector(g, X, Y, k, x0, z0, x1, z1);
        vignette(g);
        // view cone (camera forward), linear fade centre -> rim
        if (S.view && (S.view.x * S.view.x + S.view.z * S.view.z) > 1e-6) {
          const a = Math.atan2(S.view.z, S.view.x), cg = g.createRadialGradient(cx, cy, 0, cx, cy, CONE_R);
          cg.addColorStop(0, P.rgba(COL_ARROW, CONE_A)); cg.addColorStop(1, P.rgba(COL_ARROW, 0));
          g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, CONE_R, a - CONE_HALF, a + CONE_HALF); g.closePath(); g.fillStyle = cg; g.fill();
        }
        // dots: NPCs first, then players / party, then creatures (MinimapMask sampling order); rectangular clip, party pinned to the edge
        const lo = CLIP_PAD, hi = WIN - CLIP_PAD, quests = [];
        const ms = S.markers || [];
        for (const pass of ['npc', 'player', 'mob']) {
          for (const m of ms) {
            if (m.kind === 'quest') { if (pass === 'npc') quests.push(m); continue; }
            const fam = m.kind === 'poi' ? 'npc' : (KIND[m.kind] || 'mob');
            const order = fam === 'party' ? 'player' : fam;
            if (order !== pass) continue;
            let x = X(m.x), y = Y(m.z);
            const inside = x >= lo && x <= hi && y >= lo && y <= hi;
            if (!inside) { if (fam !== 'party') continue; x = clamp(x, lo, hi); y = clamp(y, lo, hi); }
            if (m.kind === 'poi') poi(g, x, y); else dot(g, x, y, COL[fam]);
          }
        }
        // quest diamonds: pinned to the window edge along the ray when outside
        const lim = WIN * 0.5 - QUEST_MARK_INSET;
        for (const m of quests) {
          const ox = (m.x - p.x) * k, oy = (m.z - p.z) * k, s = Math.min(1, lim / Math.max(Math.abs(ox), Math.abs(oy), 0.001));
          diamond(g, cx + ox * s, cy + oy * s, QUEST_MARK_R, COL_QUEST);
        }
        arrow(g, cx, cy, p.yaw);
      } else vignette(g);
      g.restore();

      // ── sheet (drawn over the map): shadow, double edge, north, hover glyphs, region + info line ──
      P.softShadow(g, 0, 2, WIN, WIN, SHADOW_R, SHADOW_A);
      P.doubleEdge(g, 0, 0, WIN, WIN);
      P.ufuk(g, 'K', F_NORTH, WIN * 0.5, NORTH_BASE, C.U_BONE, 0, 0.9);
      if (hover) {
        P.ufuk(g, '−', F_GLYPH, ZOOM_OUT_X, ZOOM_BASE, C.U_BONE, 0);
        P.ufuk(g, '+', F_GLYPH, ZOOM_IN_X, ZOOM_BASE, C.U_BONE, 0);
        P.ufuk(g, zoomText(), F_INFO, SCALE_X, SCALE_BASE, C.U_ASH, -1);
      }
      if (S && S.region) P.ufuk(g, S.region, F_NAME, WIN * 0.5, NAME_BASE, C.U_BONE, 0, 1, 2);
      if (coordKey || perfKey) infoLine(g, WIN * 0.5, INFO_BASE);
    }

    const api = {
      root, perf,
      set(state) {
        S = state;
        if (!S || !S.player) return;
        const p = S.player, v = S.view, ms = S.markers || [];
        let k = p.x.toFixed(2) + ',' + p.z.toFixed(2) + ',' + (+p.yaw || 0).toFixed(3) + '|' + (v ? v.x.toFixed(3) + ',' + v.z.toFixed(3) : '') + '|' + (S.region || '') + '|' +
          (S.image && S.image.src ? 'i' + (S.image.version || 0) : '') + (S.miniImage && S.miniImage.src ? 'm' + (S.miniImage.version || 0) : '') + '|';
        for (const m of ms) k += m.kind[0] + m.x.toFixed(1) + ',' + m.z.toFixed(1) + ';';
        if (k !== sig) { sig = k; dirty = true; }
        const ck = Math.round(p.x) + ', ' + Math.round(-p.z);
        if (ck !== coordKey) { coordKey = ck; dirty = true; }
      },
      // [perf] phones: markers move every frame, so the sketch map redraws at most 10x a second there (desktop: every frame)
      frame(dt) { if (!dirty || root.hidden) return; if (MOBILE_MM) { mmAcc += dt || 0.016; if (mmAcc < 0.1) return; mmAcc = 0; } dirty = false; draw(); },
      redraw() { dirty = true; },
      resize(s) { surf.resize(s); dirty = true; },
      get state() { return S; },
    };
    surf.resize(hud.s || 1);
    return api;
  }

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.minimap = MinimapPart;
})(window);
