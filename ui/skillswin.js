/* TDS HUD part — skills window (slot `skillswin`, window id 'skills', key K), ported from Atherion's skill window v6 "Kül ve Kehribar"
 * (skill_tree_view.gd = skill_agaci_tasarim.html; the GDScript is the source of truth): a 1280-wide centred window, header strip
 * (diamond glyph, spaced Cinzel title, identity line, ✕), on the left the node canvas in a dark well, on the right the "künye" column of
 * the selected node, a footer strip with hints. Same palette (ash chrome; amber only on the selected node), same octagon plates
 * (80 px node plates, cut 9), comb links (trunk → tag → node, rounded elbows, spines with teeth + junction diamonds), labels, chips,
 * section rules with a diamond, the delta-table rows. Drag the window by its header (SkillTreeController drag handle + clamp).
 * The game has no skill tree, ranks, points or paths, so the canvas is the game's real set: the class root plate, the basic attack on
 * the trunk (tag "SAĞ TIK"), the 8 class skills in two 2×2 combs by hotkey (tags "TUŞ 1–4" / "TUŞ 5–8"); the diamond on a node's top
 * edge (Atherion's [+] badge) carries its hotkey. The künye column shows the selected skill: icon plate, name, key line, mana / cooldown
 * chips, description, and a live table (mana enough?, cooldown left, effect running) from hud.state.
 * Omitted (the game has none): points chip, rank meter under the nodes, rank ladder, rank names, now → next deltas, rank-up notice,
 * the "1 PUAN HARCA" button, path plates / foreign path, the no-path veil, drag-to-hotbar.
 * Registers HUDParts.skillswin: { set(skills, basic), frame(dt), resize(s), select(i) }.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint;
  const TAU = Math.PI * 2;

  /* ---------- palette (skill_tree_view.gd "Kül ve Kehribar") ---------- */
  const css = (c, a) => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a === undefined ? (c[3] === undefined ? 1 : c[3]) : a) + ')';
  const INK_TOP = [0.129, 0.090, 0.071, 0.97], INK_BOT = [0.075, 0.055, 0.043, 0.97], INK_WELL_TOP = [0.137, 0.102, 0.078], INK_WELL = [0.114, 0.086, 0.071];
  const PLATE_TOP = [0.212, 0.173, 0.137], PLATE_BOT = [0.165, 0.129, 0.102], NODE_TOP = [0.204, 0.165, 0.133], NODE_BOT = [0.102, 0.078, 0.063];
  const ASH = [0.553, 0.514, 0.459], ASH_HI = [0.859, 0.827, 0.780], TEXT = [0.890, 0.871, 0.839], DIM = [0.647, 0.616, 0.573], FAINT = [0.455, 0.424, 0.384];
  const RULE = [0.180, 0.149, 0.122], EDGE = [0.298, 0.263, 0.220], EDGE_HI = [0.471, 0.424, 0.357], GOOD = [0.525, 0.722, 0.576], BAD = [0.757, 0.529, 0.494];
  const DANGER = [0.761, 0.353, 0.306], AMBER = [0.886, 0.780, 0.561], BADGE_BOT = [0.682, 0.639, 0.576], CTA_INK = [0.075, 0.055, 0.043];
  const RANK_1 = [0.722, 0.678, 0.616];                            // "Kalfa" step of the brightness ladder: the key line

  /* ---------- geometry (skill_tree_view.gd) ---------- */
  const W = 1280, HEADER_H = 56, FOOTER_H = 46, PAD = 18;
  const TREE_PANE_W = 852, TREE_PAD = 16, TREE_W = 820;
  const DETAIL_X = TREE_PANE_W + 1, DETAIL_W = W - DETAIL_X, DETAIL_PAD = 20, DETAIL_CONTENT_W = DETAIL_W - DETAIL_PAD * 2;
  // node canvas (well-local): Atherion's trunk / root / shared row; the two path combs become the two hotkey groups
  const TRUNK_X = 410, ROOT_RECT = [322, 6, 176, 58], TAG_RECT = [324, 80, 66, 20], BASIC_TOP = 104, BASIC_CELL_BOTTOM = 238;
  const SPLIT_Y = 262, SPLIT_MID_Y = 272, SPLIT_CORNER_R = 10, GROUP_TOP = 296, GROUP_TAG_H = 20, GROUP_CX = [190, 630];
  const ROW_TOPS = [352, 502], COL_DX = 78, SPINE_BOTTOM = ROW_TOPS[1] + 40;
  const NODE_W = 148, NODE_H = 126, PLATE = 80, PLATE_CUT = 9, ICON_PAD = 8, BADGE_R = 15.5, BADGE_CY = -2;
  const TREE_H = ROW_TOPS[1] + NODE_H + 14, BODY_H = TREE_H + TREE_PAD * 2, H = HEADER_H + BODY_H + FOOTER_H;
  const HEAD_PLATE = 72, DELTA_ROW_H = 27, VIEWPORT_MARGIN = 24, REFRESH = 0.25;

  /* ---------- fonts ---------- */
  const fSerif = (px) => P.F.serif(500, px), fBold = (px) => P.F.serif(700, px), fCinzel = (px) => P.F.cinzel(600, px);
  const CAPS_TRACK = 2;                                            // _serif_caps: Alegreya + 2 px glyph spacing
  const up = (t) => String(t).toLocaleUpperCase('tr-TR');          // UIUtils.tr_upper

  function svgImage(svg, onload) {
    if (!svg) return null;
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image(); img.onload = onload;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img;
  }
  function octPts(x, y, w, h, cut) {
    const c = Math.max(2, Math.min(cut, Math.min(w, h) * 0.5));
    return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
  }
  function path(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  function vgrad(g, y0, h, top, bot) { const gr = g.createLinearGradient(0, y0, 0, y0 + Math.max(h, 1)); gr.addColorStop(0, css(top)); gr.addColorStop(1, css(bot)); return gr; }
  function diamond(g, cx, cy, r, fill) { g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fillStyle = fill; g.fill(); }
  const hline = (g, x0, x1, y, fill) => { g.fillStyle = fill; g.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), 1); };
  const vline = (g, x, y0, y1, fill) => { g.fillStyle = fill; g.fillRect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0)); };
  const fmtSec = (v) => P.num(v, Math.abs(v - Math.round(v)) > 1e-6 ? 1 : 0) + ' sn';

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.skillswin = function (hud) {
    const el = document.createElement('div');
    el.className = 'sw-win';
    hud.frame.appendChild(el);
    const surf = P.surface(el, 'sw-cv', W, H, 0, 0), g = surf.g;

    let s = hud.s || 1, skills = [], basic = null, imgs = {}, sel = 1, hoverNode = -1, hoverClose = false;
    let opened = false, dirty = true, acc = 0, liveSig = '', moved = false, drag = null;
    const pos = { x: 0, y: 0 };
    const mark = () => { dirty = true; };

    /* ---- nodes: 0 = basic attack on the trunk, 1..8 = class skills in the two hotkey combs ---- */
    function nodes() {
      const out = [];
      if (basic) out.push({ i: 0, cx: TRUNK_X, top: BASIC_TOP, d: basic, basic: true });
      skills.slice(0, 8).forEach((sk, j) => {
        const grp = j < 4 ? 0 : 1, k = j % 4, row = k >> 1;
        out.push({ i: j + 1, cx: GROUP_CX[grp] + (k % 2 ? COL_DX : -COL_DX), top: ROW_TOPS[row], d: sk, grp, si: j });
      });
      return out;
    }
    const nodeOf = (i) => nodes().find((n) => n.i === i) || null;
    const groupOf = (i) => (i >= 1 && i <= 4 ? 0 : i >= 5 ? 1 : -1);

    /* ---- text (Godot Label: top-left box, baseline = top + ascent; ≥ 14 px gets the 3 px label shadow) ---- */
    function label(str, font, x, y, w, fill, opt) {
      const o = opt || {};
      g.save(); P.setFont(g, font, o.track || 0);
      const m = P.metrics(g, font), tw = g.measureText(str).width;
      let left = x;
      if (o.align === 0) left = x + (w - tw) * 0.5; else if (o.align === 1) left = x + w - tw;
      if (o.clip && tw > w) { g.beginPath(); g.rect(x, y - 4, w, m.a + m.d + 8); g.clip(); if (o.align !== undefined) left = x; }
      const base = y + (o.vh ? (o.vh - (m.a + m.d)) * 0.5 : 0) + m.a;
      if (o.shadow) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(str, left, base + 3); }
      g.fillStyle = fill; g.fillText(str, left, base);
      g.restore(); return tw;
    }
    const tw = (str, font, track) => P.width(g, str, font, track || 0);
    function wrap(str, font, maxW) {
      const out = []; let cur = '';
      for (const word of String(str || '').split(' ').filter(Boolean)) {
        const probe = cur ? cur + ' ' + word : word;
        if (tw(probe, font) <= maxW || !cur) { cur = probe; continue; }
        out.push(cur); cur = word;
      }
      if (cur) out.push(cur);
      return out;
    }

    /* ---- drawing ---- */
    function draw() {
      surf.begin();
      drawFrame(); drawHeader();
      g.save(); g.translate(TREE_PAD, HEADER_H + TREE_PAD); drawTree(); g.restore();
      vline(g, TREE_PANE_W, HEADER_H, HEADER_H + BODY_H, css(RULE));
      g.save(); g.translate(DETAIL_X, HEADER_H); drawDetail(); g.restore();
      drawFooter();
    }
    // _draw_frame: gradient body, ash edge, inner hairline, corner brackets, header rule with a lit middle, footer band
    function drawFrame() {
      g.fillStyle = vgrad(g, 0, H, INK_TOP, INK_BOT); g.fillRect(0, 0, W, H);
      P.frame1(g, 0, 0, W, H, css(EDGE));
      P.frame1(g, 5, 5, W - 10, H - 10, css(ASH_HI, 0.055));
      const b = 16, bc = css(ASH_HI, 0.30);
      for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        const sx = cx === 0 ? 1 : -1, sy = cy === 0 ? 1 : -1;
        hline(g, cx, cx + b * sx, cy === 0 ? 0 : H - 1, bc); vline(g, cx === 0 ? 0 : W - 1, cy, cy + b * sy, bc);
      }
      hline(g, 0, W, HEADER_H, css(RULE)); hline(g, W * 0.18, W * 0.82, HEADER_H, css(ASH_HI, 0.22));
      g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, HEADER_H + BODY_H, W, FOOTER_H);
      hline(g, 0, W, HEADER_H + BODY_H, css(RULE));
    }
    function drawHeader() {
      diamond(g, PAD + 10, 28, 10, css(ASH, 0.55)); diamond(g, PAD + 10, 28, 5, css(ASH_HI));
      label(up('Yetenekler'), fCinzel(16), PAD + 34, 17, 230, css(ASH_HI), { track: 4, shadow: true, clip: true });
      vline(g, PAD + 276, 17, 39, css(RULE));
      const inf = hud.info || {}, lvl = (hud.state && hud.state.player && hud.state.player.level) || 1;
      const nm = inf.name || '', meta = (inf.title ? '· ' + inf.title + ' ' : '') + '· Sv. ' + lvl;
      let x = PAD + 292;
      if (nm) x += label(nm, fBold(14), x, 18, 400, css(TEXT), { shadow: true }) + 6;
      label(meta, fSerif(14), x, 18, 400, css(DIM), { shadow: true });
      // ✕ (flat button, COL_FAINT → COL_DANGER on hover)
      const cx = W - PAD - 14, cy = 28, a = 4.5;
      g.strokeStyle = css(hoverClose ? DANGER : FAINT); g.lineWidth = 1.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx - a, cy - a); g.lineTo(cx + a, cy + a); g.moveTo(cx + a, cy - a); g.lineTo(cx - a, cy + a); g.stroke();
      g.lineWidth = 1; g.lineCap = 'butt';
    }
    function drawFooter() {
      const y = HEADER_H + BODY_H;
      const range = skills.length ? skills[0].key + '–' + skills[Math.min(skills.length, 8) - 1].key : '';
      const alt = skills.find((sk) => sk.alt);
      let x = PAD;
      if (range) x += label('Yetenekler ' + range + ' tuşlarıyla kullanılır.', fSerif(12), x, y + 14, 600, css(FAINT)) + 8;
      if (alt) label(alt.alt + ' tuşu da ' + alt.name + ' yeteneğini kullanır.', fSerif(12), x, y + 14, 600, css(DIM));
      label(up('K / Esc kapat'), fSerif(10), W - PAD - 240, y + 16, 240, css(FAINT), { track: CAPS_TRACK, align: 1 });
    }

    // ---- left: node canvas ----
    function drawTree() {
      g.fillStyle = vgrad(g, 0, TREE_H, INK_WELL_TOP, INK_WELL); g.fillRect(0, 0, TREE_W, TREE_H);
      P.frame1(g, 0, 0, TREE_W, TREE_H, css(RULE));
      drawLinks();
      drawRoot();
      if (basic) drawTag('Sağ tık', TAG_RECT[0], TAG_RECT[1], TAG_RECT[2]);
      [0, 1].forEach((grp) => {
        const list = skills.slice(grp * 4, grp * 4 + 4);
        if (!list.length) return;
        const t = 'Tuş ' + list[0].key + '–' + list[list.length - 1].key, w = Math.max(66, Math.ceil(tw(up(t), fSerif(10), CAPS_TRACK)) + 16);
        drawTag(t, GROUP_CX[grp] - w * 0.5, GROUP_TOP, w);
      });
      for (const n of nodes()) drawNode(n);
    }
    function drawLinks() {
      const trunk = css(ASH, 0.85), bright = css(ASH_HI, 0.85), selGrp = groupOf(sel);
      vline(g, TRUNK_X, ROOT_RECT[1] + ROOT_RECT[3], basic ? BASIC_TOP : SPLIT_Y, trunk);
      if (basic) {
        hline(g, TAG_RECT[0] + TAG_RECT[2], TRUNK_X, TAG_RECT[1] + TAG_RECT[3] * 0.5, trunk);
        vline(g, TRUNK_X, BASIC_CELL_BOTTOM, SPLIT_Y, trunk);
      }
      [0, 1].forEach((grp) => {
        if (!skills[grp * 4]) return;
        const col = grp === selGrp ? bright : trunk, cx = GROUP_CX[grp];
        elbow(TRUNK_X, SPLIT_Y, SPLIT_MID_Y, cx, GROUP_TOP, col);
        const rows = Math.ceil(Math.min(4, skills.length - grp * 4) / 2);
        vline(g, cx, GROUP_TOP + GROUP_TAG_H, rows > 1 ? SPINE_BOTTOM : ROW_TOPS[0] + PLATE * 0.5, col);
        for (let r = 0; r < rows; r++) {
          const y = ROW_TOPS[r] + PLATE * 0.5;
          hline(g, cx - COL_DX + PLATE * 0.5, cx + COL_DX - PLATE * 0.5, y, col);
          diamond(g, cx + 0.5, y + 0.5, 3.5, col);
        }
      });
    }
    // _elbow: vertical → horizontal → vertical, corners rounded with SPLIT_CORNER_R
    function elbow(x0, y0, ym, x1, y1, col) {
      const r = SPLIT_CORNER_R, d = Math.sign(x1 - x0), o = 0.5;
      g.beginPath(); g.moveTo(x0 + o, y0); g.lineTo(x0 + o, ym - r + o);
      g.quadraticCurveTo(x0 + o, ym + o, x0 + d * r + o, ym + o); g.lineTo(x1 - d * r + o, ym + o);
      g.quadraticCurveTo(x1 + o, ym + o, x1 + o, ym + r + o); g.lineTo(x1 + o, y1);
      g.strokeStyle = col; g.lineWidth = 1; g.stroke();
    }
    function drawPlate(x, y, w, h, frame, top, bot) {
      const pts = octPts(x, y, w, h, PLATE_CUT);
      path(g, pts); g.fillStyle = vgrad(g, y, h, top, bot); g.fill();
      path(g, octPts(x + 0.5, y + 0.5, w - 1, h - 1, PLATE_CUT)); g.strokeStyle = css(frame); g.lineWidth = 1; g.stroke();
    }
    function drawRoot() {
      const [x, y, w, h] = ROOT_RECT;
      drawPlate(x, y, w, h, EDGE_HI, PLATE_TOP, PLATE_BOT);
      const cx = x + 33, cy = y + 29, r = 11;                      // crest: diamond outline + carved chevron
      g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
      g.strokeStyle = css(ASH); g.stroke();
      g.beginPath(); g.moveTo(cx + 2, cy - 4); g.lineTo(cx - 2, cy); g.lineTo(cx + 2, cy + 4); g.strokeStyle = css(ASH_HI); g.stroke();
      const inf = hud.info || {}, lvl = (hud.state && hud.state.player && hud.state.player.level) || 1;
      label(up(inf.name || ''), fCinzel(14), x + 56, y + 10, w - 66, css(ASH_HI), { track: 3, shadow: true, clip: true });
      label('Karakter seviyesi ' + lvl, fSerif(11), x + 56, y + 30, w - 66, css(DIM), { clip: true });
    }
    function drawTag(t, x, y, w) {                                 // _tag: well fill + edge, ash caps
      g.fillStyle = css(INK_WELL); g.fillRect(x, y, w, TAG_RECT[3]);
      P.frame1(g, x, y, w, TAG_RECT[3], css(EDGE));
      label(up(t), fSerif(10), x + 4, y + 2, w - 8, css(ASH), { track: CAPS_TRACK, align: 0, vh: 15 });
    }
    function drawNodePlate(x, y, size, frame, glow, img, inset, lit) {
      g.save();
      if (lit) g.filter = 'brightness(1.14)';                       // plate.modulate 1.14 on hover
      path(g, octPts(x, y, size, size, PLATE_CUT)); g.fillStyle = vgrad(g, y, size, NODE_TOP, NODE_BOT); g.fill();
      if (glow) {                                                  // halo: two faint octagons outside (octagon_inset −3 / −6)
        path(g, octPts(x - 2.5, y - 2.5, size + 5, size + 5, PLATE_CUT + 1.5)); g.strokeStyle = css(frame, 0.20); g.lineWidth = 1; g.stroke();
        path(g, octPts(x - 5.5, y - 5.5, size + 11, size + 11, PLATE_CUT + 3)); g.strokeStyle = css(frame, 0.09); g.stroke();
      }
      if (img && img.complete && img.naturalWidth) g.drawImage(img, x + inset, y + inset, size - inset * 2, size - inset * 2);
      path(g, octPts(x + 0.5, y + 0.5, size - 1, size - 1, PLATE_CUT)); g.strokeStyle = css(frame); g.lineWidth = 1; g.stroke();
      g.restore();
    }
    function drawNode(n) {
      const isSel = n.i === sel, frame = isSel ? AMBER : EDGE_HI, x = n.cx - NODE_W * 0.5;
      drawNodePlate(n.cx - PLATE * 0.5, n.top, PLATE, frame, isSel, imgs[n.basic ? '#basic' : n.d.id], ICON_PAD, hoverNode === n.i);
      label(n.d.name || '', isSel ? fBold(12) : fSerif(12), x, n.top + 96, NODE_W, css(isSel ? AMBER : TEXT), { align: 0, clip: true });
      label(stateText(n), fSerif(10), x, n.top + 112, NODE_W, css(DIM), { align: 0, clip: true });
      if (!n.basic && n.d.key) {                                   // hotkey diamond on the plate's top edge (Atherion's [+] badge)
        const cx = n.cx, cy = n.top + BADGE_CY;
        g.save();
        if (hoverNode === n.i) g.filter = 'brightness(1.12)';
        g.beginPath(); g.moveTo(cx, cy - BADGE_R); g.lineTo(cx + BADGE_R, cy); g.lineTo(cx, cy + BADGE_R); g.lineTo(cx - BADGE_R, cy); g.closePath();
        g.fillStyle = vgrad(g, cy - BADGE_R, BADGE_R * 2, ASH_HI, BADGE_BOT); g.fill();
        g.restore();
        label(String(n.d.key), fBold(14), cx - BADGE_R, cy - BADGE_R, BADGE_R * 2, css(CTA_INK), { align: 0, vh: BADGE_R * 2 });
      }
    }
    function stateText(n) {
      if (n.basic) return 'Temel saldırı';
      const p = [];
      if (n.d.mp) p.push(n.d.mp + ' mana');
      if (n.d.cd) p.push(fmtSec(n.d.cd));
      return p.join(' · ');
    }

    // ---- right: künye column of the selected node ----
    function drawDetail() {
      const n = nodeOf(sel);
      if (!n) { label('Bir yetenek seç.', fSerif(12), DETAIL_PAD, BODY_H * 0.5 - 20, DETAIL_CONTENT_W, css(DIM), { align: 0 }); return; }
      const d = n.d;
      let y = 18;
      drawNodePlate(DETAIL_PAD, y, HEAD_PLATE, EDGE_HI, false, imgs[n.basic ? '#basic' : d.id], 7, false);
      const tx = DETAIL_PAD + HEAD_PLATE + 14, twid = DETAIL_W - tx - DETAIL_PAD;
      label(d.name || '', fCinzel(19), tx, y + 1, twid, css(ASH_HI), { track: 1, shadow: true, clip: true });
      label(n.basic ? 'Sağ tık' : 'Tuş ' + d.key + (d.alt ? ' · ' + d.alt : ''), fSerif(12), tx, y + 27, twid, css(RANK_1));
      let cx = tx;
      for (const [k, v] of chips(n)) cx += chip(cx, y + 48, k, v) + 6;
      y += 88;
      y = detailRule(y);
      y = section('Açıklama', y);
      const font = fSerif(13), m = P.metrics(g, font), lh = Math.round(m.a + m.d);
      for (const ln of wrap(d.desc, font, DETAIL_CONTENT_W)) { label(ln, font, DETAIL_PAD, y, DETAIL_CONTENT_W, css(TEXT)); y += lh; }
      const rows = liveRows(n);
      if (!rows.length) return;
      y = detailRule(y);
      // delta table: header + rows (label · value · state)
      hline(g, DETAIL_PAD, DETAIL_PAD + DETAIL_CONTENT_W, y + 17, css(RULE));
      cell(up('Özellik'), 0, y, 140); cell(up('Değer'), 145, y, 100); cell(up('Durum'), 252, y, 135);
      y += 18;
      for (const r of rows) {
        hline(g, DETAIL_PAD, DETAIL_PAD + DETAIL_CONTENT_W, y + DELTA_ROW_H - 1, css(RULE, 0.6));
        label(r[0], fSerif(13), DETAIL_PAD, y + 6, 140, css(DIM), { clip: true });
        label(r[1], fSerif(13), DETAIL_PAD + 145, y + 6, 100, css(ASH_HI), { clip: true });
        if (r[2]) label(r[2], fSerif(13), DETAIL_PAD + 252, y + 6, 135, css(r[3] || DIM), { clip: true });
        y += DELTA_ROW_H;
      }
    }
    function chips(n) {
      if (n.basic) return [];
      const out = [];
      if (n.d.mp) out.push(['Mana', String(n.d.mp)]);
      if (n.d.cd) out.push(['Bekleme', fmtSec(n.d.cd)]);
      const st = liveState(n);
      if (st && st.activeDur > 0) out.push(['Süre', fmtSec(st.activeDur)]);
      return out;
    }
    function chip(x, y, k, v) {                                    // PanelContainer: faint face + rule border, 8/2 margins, k (dim) + v (bright)
      const kw = k ? tw(k, fSerif(11)) : 0, vw = tw(v, fSerif(11)), w = 16 + kw + (k ? 5 : 0) + vw, h = 22;
      g.fillStyle = css(ASH_HI, 0.03); g.fillRect(x, y, w, h); P.frame1(g, x, y, w, h, css(RULE));
      if (k) label(k, fSerif(11), x + 8, y, kw, css(DIM), { vh: h });
      label(v, fSerif(11), x + 8 + kw + (k ? 5 : 0), y, vw, css(TEXT), { vh: h });
      return w;
    }
    function detailRule(y) {
      hline(g, DETAIL_PAD, DETAIL_PAD + DETAIL_CONTENT_W, y + 14, css(RULE));
      diamond(g, DETAIL_PAD + DETAIL_CONTENT_W * 0.5, y + 14.5, 3.5, css(EDGE_HI));
      return y + 28;
    }
    function section(t, y) { label(up(t), fSerif(10), DETAIL_PAD, y, DETAIL_CONTENT_W, css(ASH), { track: CAPS_TRACK }); return y + 22; }
    function cell(t, x, y, w) { label(t, fSerif(9), DETAIL_PAD + x, y + 2, w, css(FAINT), { track: CAPS_TRACK }); }
    function liveState(n) {
      const st = hud.state && hud.state.skills;
      return n && !n.basic && st ? st[n.si] || null : null;
    }
    // live rows: what the game reports for this skill right now
    function liveRows(n) {
      if (n.basic) return [];
      const st = liveState(n), out = [];
      if (n.d.mp) out.push(['Mana bedeli', String(n.d.mp)].concat(st ? (st.usable === false ? ['yetmiyor', BAD] : ['yeterli', GOOD]) : []));
      if (n.d.cd) out.push(['Bekleme', fmtSec(n.d.cd)].concat(st ? (st.cd > 0 ? [P.num(st.cd, 1) + ' sn kaldı', DIM] : ['hazır', GOOD]) : []));
      if (st && st.activeDur > 0) out.push(['Etki süresi', fmtSec(st.activeDur)].concat(st.active ? ['etkin · ' + Math.ceil(st.activeLeft || 0) + ' sn', GOOD] : ['—', FAINT]));
      return out;
    }
    function liveSignature() {
      const inf = hud.info || {}, lvl = (hud.state && hud.state.player && hud.state.player.level) || 1;
      const n = nodeOf(sel);
      return [inf.name, inf.title, lvl, sel, n ? JSON.stringify(liveRows(n)) + JSON.stringify(chips(n)) : ''].join('|');
    }

    /* ---- input ---- */
    function local(e) { const b = el.getBoundingClientRect(); return [(e.clientX - b.left) / s, (e.clientY - b.top) / s]; }
    function hitNode(px, py) {
      const wx = px - TREE_PAD, wy = py - HEADER_H - TREE_PAD;
      for (const n of nodes()) {
        const x0 = n.cx - PLATE * 0.5;
        if (wx >= x0 && wx < x0 + PLATE && wy >= n.top && wy < n.top + PLATE) return n.i;
        if (!n.basic && Math.abs(wx - n.cx) + Math.abs(wy - (n.top + BADGE_CY)) <= BADGE_R) return n.i;
      }
      return -1;
    }
    const onClose = (px, py) => px >= W - PAD - 28 && px < W - PAD && py >= 14 && py < 42;
    el.addEventListener('mousemove', (e) => {
      if (drag) return;
      const [px, py] = local(e), hn = hitNode(px, py), hc = onClose(px, py);
      if (hn !== hoverNode || hc !== hoverClose) { hoverNode = hn; hoverClose = hc; mark(); }
      el.style.cursor = hn >= 0 || hc ? 'pointer' : '';
    });
    el.addEventListener('mouseleave', () => { if (hoverNode !== -1 || hoverClose) { hoverNode = -1; hoverClose = false; el.style.cursor = ''; mark(); } });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();                                          // no focus, no text selection
      if (e.button !== 0) return;
      const [px, py] = local(e);
      if (onClose(px, py)) { hud.windows.close('skills'); return; }
      const hn = hitNode(px, py);
      if (hn >= 0) { if (hn !== sel) { sel = hn; liveSig = ''; mark(); } return; }
      if (py < HEADER_H && px < W - 64) drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (drag) { pos.x = e.clientX - drag.dx; pos.y = e.clientY - drag.dy; place(); } });
    addEventListener('mouseup', (e) => { if (drag && e.button === 0) { drag = null; moved = true; clamp(); place(); } });

    /* ---- placement: centred (SkillTreeController._center_panel), clamped after a drag ---- */
    function frameSize() { return [hud.frame.clientWidth || innerWidth, hud.frame.clientHeight || innerHeight]; }
    function center() { const [fw, fh] = frameSize(); pos.x = Math.max(VIEWPORT_MARGIN, (fw - W * s) * 0.5); pos.y = Math.max(VIEWPORT_MARGIN, (fh - H * s) * 0.5); }
    function clamp() {
      const [fw, fh] = frameSize(), w = W * s, h = H * s;
      pos.x = Math.min(Math.max(pos.x, VIEWPORT_MARGIN - w * 0.5), Math.max(fw - w * 0.5, VIEWPORT_MARGIN));
      pos.y = Math.min(Math.max(pos.y, VIEWPORT_MARGIN), Math.max(fh - h, VIEWPORT_MARGIN));
    }
    function place() { el.style.left = Math.round(pos.x) + 'px'; el.style.top = Math.round(pos.y) + 'px'; }

    hud.windows.register('skills', el, {
      onOpen() { if (moved) clamp(); else center(); place(); liveSig = ''; acc = REFRESH; mark(); },
      onClose() { drag = null; hoverNode = -1; hoverClose = false; el.style.cursor = ''; },
    });
    P.onFonts(mark);

    const api = {
      el,
      set(list, b) {
        skills = (list || []).slice(); basic = b || null;
        for (const sk of skills) if (sk.iconHTML && !imgs[sk.id]) imgs[sk.id] = svgImage(sk.iconHTML, mark);   // rasterised once per id
        if (basic && basic.iconHTML) imgs['#basic'] = svgImage(basic.iconHTML, mark);
        if (!nodeOf(sel)) sel = skills.length ? 1 : basic ? 0 : -1;
        liveSig = ''; mark();
      },
      select(i) { if (nodeOf(i)) { sel = i; liveSig = ''; mark(); } },
      frame(dt) {
        if (!opened && el.hidden) return;
        opened = !el.hidden;
        if (!opened) return;
        acc += dt;
        if (acc >= REFRESH) { acc = 0; const sg = liveSignature(); if (sg !== liveSig) { liveSig = sg; dirty = true; } }   // live rows ~4×/s
        if (dirty) { dirty = false; draw(); }
      },
      resize(ns) {
        s = ns; surf.resize(s);
        el.style.width = (W * s) + 'px'; el.style.height = (H * s) + 'px';
        if (moved) clamp(); else center();
        place(); mark();
      },
    };
    api.resize(s);
    return api;
  };
})(window);
