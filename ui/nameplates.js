/* TDS HUD part — world name plates, ported 1:1 from Atherion "Ufuk" plates (ust_hud_tasarim.html §6):
 *   scripts/ui/ufuk_nameplate.gd   row [◆] LEVEL │ NAME (Alegreya Sans 800 / 700, lnum, soft .46 outline), clan line above (VERSAL, banner
 *                                  colour), 1 px divider with a dark halo, elite / boss diamond, NPC role line (italic, ash)
 *   shaders/ufuk_plate_bar.gdshader the 76 px HP groove (mob 5 px, player 4 px): trough, two-tone fill + 1 px light, damage trail ("ghost"),
 *                                  meniscus, bone + ink edge, 6 px fading shadow, corner brackets on the locked target, amber edge pulse on aggro
 *   scripts/mob/mob_view.gd        level colour = threat band, non-target plates at 80 %, ghost hold .35 s + catch-up 1.8 /s, death fade .8 s
 *                                  (sine ease-in), name capped at 150 px with "…", boss-tier plates ×1.16
 *   scripts/player/player_view.gd  level colour = 10-level tier, name colour self / duel / party / clanmate, own plate has no groove
 * Godot draws these as billboards whose root scales with camera distance (nameplate_scale_factor .055), i.e. a CONSTANT screen size:
 * 1 plate design px = 0.012 × 43/14 × .055 × 540 / tan(37.5°) ≈ 1.43 px at 1080p (fov 75). Here: × hud.s. No distance fade (Atherion pops
 * plates in / out with a distance gate — the game decides which plates it sends).
 * Each plate keeps two cached sprites (text row, groove) rendered at device resolution; per frame: one projection + two drawImage.
 * Registers HUDParts.nameplates: { set(plates, state), frame(dt), resize(s) }.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, C = P.C;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  const K_PLATE = 1.4266;                     // plate design px → Atherion canvas px (see header)
  // ── ufuk_nameplate.gd (design px) ──
  const BAR_W = 76, BAR_H_PLAYER = 4, BAR_H_MOB = 5, BAR_MARGIN = 8, LIFT = 9, NAME_GAP = 5, LEVEL_GAP = 11, DIVIDER_DX = 6, DIVIDER_RISE = 5.5;
  const ELITE_W = 11, ELITE_CX = 4, ELITE_RISE = 5, ELITE_R = 3.6, CLAN_RISE = 16, NAME_MAX = 150, BOSS_SCALE = 1.16, NON_TARGET_A = 0.80;
  const LPD = 43 / 14;                        // label px per design px
  const F_NAME = '700 ' + (43 / LPD).toFixed(2) + 'px "Alegreya Sans", "Segoe UI", sans-serif';
  const F_LEVEL = '800 ' + (46 / LPD).toFixed(2) + 'px "Alegreya Sans", "Segoe UI", sans-serif';
  const F_CLAN = '800 ' + (36 / LPD).toFixed(2) + 'px "Alegreya Sans", "Segoe UI", sans-serif', CLAN_TRACK = 4 / LPD;
  const OUTLINE = 12 / LPD, OUTLINE_A = 0.46;
  // NPC plate (npc_view.gd): own label scale (0.008 px, root ×2) → 2.30 label px per design px; stack collapsed (player not near)
  const NPC_LPD = 0.012 * LPD * 0.5 / 0.008;
  const F_NPC_NAME = '700 ' + (36 / NPC_LPD).toFixed(2) + 'px "Alegreya Sans", "Segoe UI", sans-serif', NPC_NAME_OUT = 10 / NPC_LPD;
  const F_ROLE = 'italic 500 ' + (30 / NPC_LPD).toFixed(2) + 'px "Alegreya Sans", "Segoe UI", sans-serif', ROLE_OUT = 8 / NPC_LPD;
  const NPC_ROLE_BASE = (0.36 - 0.28) / (0.012 * LPD * 0.5), NPC_NAME_BASE = NPC_ROLE_BASE + 15;   // above the anchor
  // colours
  const COL_NAME = '#ECE3D0', COL_PARTY = '#93BDE8', COL_CLANMATE = '#A9D08F', COL_HOSTILE = '#E27B6B', COL_CLAN_TEXT = 'rgba(236,227,208,.80)';
  const COL_ROLE = C.U_ASH, COL_BOSS_MARK = C.U_AMBER;
  const TIER = ['#ECE3D0', '#A9C98F', '#8EBBE6', '#B79CE6', '#6FCFC1', '#E58FB5', '#E3AF55', '#E8836A', '#DB5B4F', '#F3D57A'];
  const tierColor = (l) => TIER[Math.max(0, Math.min(TIER.length - 1, Math.floor((l || 1) / 10)))];
  // groove (ufuk_plate_bar.gdshader)
  const HP_TOP = [168, 53, 45], HP_BOT = [97, 24, 19], LIGHT = [255, 238, 224], MENISCUS = [255, 244, 230];
  const GHOST_HOLD = 0.35, GHOST_CATCHUP = 1.8, DEATH_FADE = 0.8;
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c) => 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.nameplates = function (hud) {
    const root = hud.root;
    const dpr = () => Math.min(2, global.devicePixelRatio || 1);
    // viewport canvas under the HUD panels and under the damage numbers (z -2 inside #hud-root's stacking context)
    const cv = document.createElement('canvas');
    cv.className = 'np-canvas';
    cv.style.cssText = 'position:absolute;left:0;top:0;z-index:-2;pointer-events:none';
    root.insertBefore(cv, root.firstChild);
    const g = cv.getContext('2d');
    // sprite canvases live in a display:none host so canvas text picks up lining figures (Godot FontVariation lnum)
    const host = document.createElement('div');
    host.style.cssText = 'display:none;font-variant-numeric:lining-nums';
    root.appendChild(host);
    const mcv = document.createElement('canvas'); host.appendChild(mcv);
    const mg = mcv.getContext('2d');
    const freeCanvases = [];
    function takeCanvas() { const c = freeCanvases.pop() || document.createElement('canvas'); if (!c.parentNode) host.appendChild(c); return c; }
    function dropCanvas(c) { if (c) { c.width = c.height = 1; freeCanvases.push(c); } }
    if (document.fonts) ['700 14px "Alegreya Sans"', '800 15px "Alegreya Sans"', 'italic 500 13px "Alegreya Sans"'].forEach((f) => document.fonts.load(f).catch(() => {}));

    const recs = new Map();
    let gen = 0, playerLevel = 1, vw = global.innerWidth, vh = global.innerHeight, sizeDirty = true, drawn = false, clock = 0;
    global.addEventListener('resize', () => { sizeDirty = true; });
    const order = [];

    const metricCache = new Map();
    function metrics(font) {
      let m = metricCache.get(font);
      if (!m) { mg.font = font; const t = mg.measureText('Hg'); m = { a: t.fontBoundingBoxAscent, d: t.fontBoundingBoxDescent }; metricCache.set(font, m); }
      return m;
    }
    function textW(text, font, tracking) { mg.font = font; mg.letterSpacing = (tracking || 0) + 'px'; const w = mg.measureText(text).width; mg.letterSpacing = '0px'; return w; }
    function fitName(text, maxW) {                                     // mob_view._fit_text_to_width
      if (textW(text, F_NAME) <= maxW) return text;
      let cut = text;
      while (cut.length > 1) { cut = cut.slice(0, -1); if (textW(cut + '…', F_NAME) <= maxW) return cut.trimEnd() + '…'; }
      return cut;
    }

    /* ---------- records ---------- */
    function update(r, p, viewerClan) {
      r.kind = p.kind === 'player' || p.kind === 'npc' ? p.kind : 'mob';
      r.x = +p.x || 0; r.y = +p.y || 0; r.z = +p.z || 0;
      const boss = r.kind === 'mob' && (p.rank === 'boss' || p.rank === 'elite');
      const self = r.kind === 'player' && p.self !== false;          // 'player' = the local player unless self: false (a remote avatar)
      const hasBar = r.kind !== 'npc' && !self && p.maxHp > 0;
      const level = r.kind === 'npc' ? 0 : (p.level | 0);
      let nameCol = COL_NAME, lvlCol = COL_NAME;
      if (r.kind === 'mob') lvlCol = P.threat(level - playerLevel);
      else if (r.kind === 'player') {
        lvlCol = tierColor(level);
        nameCol = self ? COL_NAME : p.hostile ? COL_HOSTILE : p.party ? COL_PARTY : p.clan && p.clan === viewerClan ? COL_CLANMATE : COL_NAME;
      }
      const clan = r.kind === 'player' && p.clan ? String(p.clan) : '';
      const key = [r.kind, p.name, level, nameCol, lvlCol, clan, p.clanColor || '', p.role || '', boss ? p.rank : '', hasBar ? 1 : 0].join('|');
      if (key !== r.key) { r.key = key; r.textDirty = true; }
      r.name = String(p.name || ''); r.level = level; r.nameCol = nameCol; r.lvlCol = lvlCol; r.clan = clan; r.clanColor = p.clanColor || '';
      r.role = r.kind === 'npc' && p.role ? String(p.role) : ''; r.rank = boss ? p.rank : ''; r.scale = boss ? BOSS_SCALE : 1;
      if (r.hasBar !== hasBar) { r.hasBar = hasBar; r.barDirty = true; r.primed = false; }
      r.barH = r.kind === 'mob' ? BAR_H_MOB : BAR_H_PLAYER;
      const selected = !!p.selected, aggro = r.kind === 'mob' && !!p.aggro;
      if (selected !== r.selected || aggro !== r.aggro) { r.selected = selected; r.aggro = aggro; r.barDirty = true; }
      r.baseA = r.kind === 'mob' ? (selected ? 1 : NON_TARGET_A) : 1;
      if (hasBar) {
        const raw = p.hp / p.maxHp, nr = Number.isFinite(raw) ? clamp01(raw) : r.ratio;
        if (!r.primed) { r.primed = true; r.ratio = r.ghost = nr; r.hold = 0; r.barDirty = true; }
        else if (nr < r.ratio) { r.ghost = r.ratio; r.hold = GHOST_HOLD; r.ratio = nr; r.barDirty = true; }   // trail = this hit
        else if (nr > r.ratio) { r.ghost = nr; r.hold = 0; r.ratio = nr; r.barDirty = true; }            // heal: no lagging trail
        r.ghost = Math.max(r.ghost, r.ratio);
      }
      // death: the plate fades out (mob_view.hide_nameplate, .8 s sine ease-in); a respawn under the same id brings it back
      if (r.kind === 'mob' && p.dead) { if (!r.dying) { r.dying = true; r.fadeT = 0; } }
      else if (r.dying) { r.dying = false; r.fadeT = 0; r.gone = false; }
    }
    function remove(id, r) { dropCanvas(r.tc); dropCanvas(r.bc); recs.delete(id); }

    /* ---------- sprites ---------- */
    function spriteScale(r) { return K_PLATE * (hud.s || 1) * dpr() * r.scale; }
    function buildText(r) {
      r.textDirty = false;
      const f = spriteScale(r), npc = r.kind === 'npc';
      const L = { items: [] };
      let left = 0, right = 0, top = 0, bottom = 0;
      const span = (w, base, m) => { left = Math.min(left, -w * 0.5); right = Math.max(right, w * 0.5); top = Math.min(top, base - m.a); bottom = Math.max(bottom, base + m.d); };
      if (npc) {
        const base = LIFT - NPC_NAME_BASE, w = textW(r.name, F_NPC_NAME);           // y relative to the groove centre (anchor − LIFT)
        L.items.push(['t', r.name, F_NPC_NAME, -w * 0.5, base, COL_NAME, NPC_NAME_OUT, 0]); span(w, base, metrics(F_NPC_NAME));
        if (r.role) { const rb = LIFT - NPC_ROLE_BASE, rw = textW(r.role, F_ROLE); L.items.push(['t', r.role, F_ROLE, -rw * 0.5, rb, COL_ROLE, ROLE_OUT, 0]); span(rw, rb, metrics(F_ROLE)); }
      } else {
        const base = r.hasBar ? -(r.barH * 0.5 + NAME_GAP + 1) : 1;
        const name = r.kind === 'mob' ? fitName(r.name, NAME_MAX) : r.name;
        const lvl = r.level > 0 ? String(r.level) : '';
        const lw = lvl ? textW(lvl, F_LEVEL) : 0, nw = textW(name, F_NAME), elite = !!r.rank;
        const gap = lvl ? LEVEL_GAP : 0, ew = elite ? ELITE_W : 0, total = ew + lw + gap + nw;
        let x = -total * 0.5;
        if (elite) L.items.push(['d', x + ELITE_CX, base - ELITE_RISE, r.rank === 'boss' ? COL_BOSS_MARK : COL_NAME]);
        x += ew;
        if (lvl) { L.items.push(['t', lvl, F_LEVEL, x, base, r.lvlCol, OUTLINE, 0]); L.items.push(['v', x + lw + DIVIDER_DX, base - DIVIDER_RISE]); }
        x += lw + gap;
        L.items.push(['t', name, F_NAME, x, base, r.nameCol, OUTLINE, 0]);
        span(total, base, metrics(F_NAME)); span(total, base, metrics(F_LEVEL)); top = Math.min(top, base - DIVIDER_RISE - 7);
        if (r.clan) {
          const t = r.clan.toLocaleUpperCase('tr-TR'), cb = base - CLAN_RISE, cw = textW(t, F_CLAN, CLAN_TRACK);
          L.items.push(['t', t, F_CLAN, -cw * 0.5, cb, r.clanColor || COL_CLAN_TEXT, OUTLINE, CLAN_TRACK]); span(cw, cb, metrics(F_CLAN));
        }
      }
      const pad = 4;
      left -= pad; right += pad; top -= pad; bottom += pad;
      const ox = Math.ceil(-left * f), oy = Math.ceil(-top * f);
      if (!r.tc) r.tc = takeCanvas();
      const c = r.tc, w = Math.max(1, ox + Math.ceil(right * f)), h = Math.max(1, oy + Math.ceil(bottom * f));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const tg = c.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, w, h);
      tg.setTransform(f, 0, 0, f, ox, oy);
      tg.lineJoin = 'round'; tg.textBaseline = 'alphabetic'; tg.textAlign = 'left';
      for (const it of L.items) {
        if (it[0] === 't') {                                          // Label3D: one soft outline (α .46) under the glyphs
          const [, s, font, x, base, col, ow, tr] = it;
          tg.font = font; tg.letterSpacing = tr + 'px';
          tg.strokeStyle = 'rgba(0,0,0,' + OUTLINE_A + ')'; tg.lineWidth = ow; tg.strokeText(s, x, base);
          tg.fillStyle = col; tg.fillText(s, x, base);
          if (font === F_CLAN) { tg.strokeStyle = col; tg.lineWidth = 0.2; tg.strokeText(s, x, base); }   // FontVariation embolden .2
          tg.letterSpacing = '0px';
        } else if (it[0] === 'v') {                                   // divider: 1 px bone core (α .55) in a 3 px dark halo (α .45)
          const [, cx, cy] = it;
          tg.fillStyle = 'rgba(0,0,0,.45)'; tg.fillRect(cx - 9 / LPD * 0.5, cy - 40 / LPD * 0.5, 9 / LPD, 40 / LPD);
          tg.fillStyle = 'rgba(236,227,208,.55)'; tg.fillRect(cx - 3 / LPD * 0.5, cy - 34 / LPD * 0.5, 3 / LPD, 34 / LPD);
        } else if (it[0] === 'd') {                                   // diamond_texture: 3 px fading shadow, 1.2 px dark rim, fill
          const [, cx, cy, col] = it;
          P.diamond(tg, cx, cy, ELITE_R + 2.0, 'rgba(0,0,0,.08)');
          P.diamond(tg, cx, cy, ELITE_R + 1.3, 'rgba(0,0,0,.14)');
          P.diamond(tg, cx, cy, ELITE_R + 0.6, 'rgba(16,10,6,.9)');
          P.diamond(tg, cx, cy, ELITE_R - 0.6, col);
        }
      }
      r.tox = ox; r.toy = oy;
    }
    // the groove, pixel for pixel like the shader (design px, origin = groove top-left)
    function grooveImage(tg, bw, bh, ratio, ghost, target, aggroA) {
      // 6 px fading shadow (Chebyshev rings 2 < d ≤ 8), ink ring, bone ring
      for (let i = 8; i >= 3; i--) { const k = 1 - (i - 0.5 - 2) / 7; P.frame1(tg, -i, -i, bw + i * 2, bh + i * 2, 'rgba(0,0,0,' + (0.35 * 0.30 * k * k).toFixed(4) + ')'); }
      P.frame1(tg, -2, -2, bw + 4, bh + 4, 'rgba(0,0,0,.70)');
      P.frame1(tg, -1, -1, bw + 2, bh + 2, aggroA > 0 ? 'rgba(227,175,85,' + aggroA.toFixed(3) + ')' : 'rgba(236,227,208,.26)');
      // trough, damage trail, fill rows (top 55 % flat, then down to the dark tone), 1 px light on row 1, meniscus, top inner shadow
      tg.fillStyle = 'rgba(12,10,8,.70)'; tg.fillRect(0, 0, bw, bh);
      const fw = Math.floor(bw * clamp01(ratio) + 0.5), gw = Math.floor(bw * clamp01(ghost) + 0.5);
      if (gw > fw) { tg.fillStyle = 'rgba(236,200,158,.70)'; tg.fillRect(fw, 0, gw - fw, bh); }
      if (fw > 0) {
        const split = Math.floor(bh * 0.55 + 0.5);
        for (let row = 0; row < bh; row++) {
          const yc = row + 0.5;
          let c = yc < split ? HP_TOP : mixc(HP_TOP, HP_BOT, clamp01((yc - split) / Math.max(bh - split, 1e-4)));
          if (bh >= 4 && row === 1) c = mixc(c, LIGHT, 0.16);
          tg.fillStyle = rgb(c); tg.fillRect(0, row, fw, 1);
          if (ratio < 1) { tg.fillStyle = rgb(mixc(c, MENISCUS, 0.85)); tg.fillRect(fw - 1, row, 1, 1); }
        }
      }
      tg.fillStyle = 'rgba(0,0,0,.45)'; tg.fillRect(0, 0, bw, 1);
      if (target) {                                                   // corner brackets: 1.2 px, arms 3 (vertical) / 4 (horizontal), 5 / 4 px out
        tg.fillStyle = '#ECE3D0';
        for (const [kx, ky, vx, vy] of [[-5, -4, -1, -1], [bw + 5, -4, 1, -1], [-5, bh + 4, -1, 1], [bw + 5, bh + 4, 1, 1]]) {
          tg.fillRect(kx - 0.6, vy < 0 ? ky : ky - 3, 1.2, 3);
          tg.fillRect(vx < 0 ? kx : kx - 4, ky - 0.6, 4, 1.2);
        }
      }
    }
    function buildBar(r, aggroA) {
      r.barDirty = false;
      if (!r.hasBar) return;
      const f = spriteScale(r), bw = BAR_W, bh = r.barH, m = BAR_MARGIN;
      if (!r.bc) r.bc = takeCanvas();
      const c = r.bc, ox = Math.ceil((bw * 0.5 + m) * f), oy = Math.ceil((bh * 0.5 + m) * f), w = ox * 2, h = oy * 2;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const tg = c.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, w, h);
      tg.setTransform(f, 0, 0, f, ox - bw * 0.5 * f, oy - bh * 0.5 * f);
      grooveImage(tg, bw, bh, r.ratio, r.ghost, r.selected, aggroA);
      r.box = ox; r.boy = oy;
    }

    function resizeCanvas() {
      vw = global.innerWidth; vh = global.innerHeight;
      const d = dpr(), bw = Math.max(1, Math.round(vw * d)), bh = Math.max(1, Math.round(vh * d));
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
      drawn = true;
    }
    P.onFonts(() => { metricCache.clear(); for (const r of recs.values()) r.textDirty = true; });

    resizeCanvas();
    return {
      // plates: [{ id, kind: 'mob'|'player'|'npc', name, level, hp, maxHp, x, y, z, selected, hostile, dead,
      //            self? (player: default true = own plate, no groove), rank?: 'normal'|'elite'|'boss', aggro?, party?, clan?, clanColor?, role? }]
      set(plates, state) {
        gen++;
        playerLevel = (state && state.player && state.player.level) || 1;
        const list = plates || [];
        let viewerClan = '';
        for (const p of list) if (p && p.kind === 'player' && p.self !== false && p.clan) viewerClan = String(p.clan);
        for (const p of list) {
          if (!p || p.id === undefined || p.id === null) continue;
          let r = recs.get(p.id);
          if (!r) { r = { id: p.id, ratio: 1, ghost: 1, hold: 0, primed: false, textDirty: true, barDirty: true, dying: false, fadeT: 0, gone: false, scale: 1 }; recs.set(p.id, r); }
          r.gen = gen; r.orphan = false;
          update(r, p, viewerClan);
        }
        for (const [id, r] of recs) if (r.gen !== gen) { if (r.dying && !r.gone) r.orphan = true; else remove(id, r); }   // a dying plate finishes its fade
      },
      frame(dt) {
        dt = Math.min(Math.max(dt || 0, 0), 0.1);
        clock += dt;
        if (sizeDirty) { sizeDirty = false; resizeCanvas(); }
        const pr = hud.opts.project, d = dpr();
        order.length = 0;
        for (const [id, r] of recs) {
          if (r.hasBar && r.ghost > r.ratio) {                        // ghost: hold, then catch up
            if (r.hold > 0) r.hold -= dt;
            else { r.ghost = Math.max(r.ratio, r.ghost - GHOST_CATCHUP * dt); r.barDirty = true; }
          }
          let fade = 1;
          if (r.dying) {
            r.fadeT += dt;
            const u = clamp01(r.fadeT / DEATH_FADE);
            fade = Math.cos(u * Math.PI * 0.5);
            if (u >= 1) { r.gone = true; if (r.orphan) { remove(id, r); continue; } }
          }
          if (r.gone || !pr) continue;
          const v = pr(r.x, r.y, r.z);
          if (!v || v.z > 1) continue;
          const sx = (v.x * 0.5 + 0.5) * vw, sy = (-v.y * 0.5 + 0.5) * vh, margin = 160 * (hud.s || 1);
          if (sx < -margin || sx > vw + margin || sy < -margin || sy > vh + margin) continue;
          r.sx = sx; r.sy = sy; r.sz = v.z; r.alpha = r.baseA * fade;
          if (r.alpha <= 0.003) continue;
          order.push(r);
        }
        if (drawn) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); drawn = false; }
        if (!order.length) return;
        order.sort((a, b) => b.sz - a.sz);                              // far first
        const aggroA = 0.55 + 0.40 * (0.5 + 0.5 * Math.sin(clock * 7));
        g.setTransform(1, 0, 0, 1, 0, 0);
        drawn = true;
        // render priority ladder (nameplate_occlusion.gd): every groove, then every text row
        for (const r of order) {
          if (!r.hasBar) continue;
          if (r.barDirty || r.aggro) buildBar(r, r.aggro ? aggroA : 0);
          const f = spriteScale(r), cx = r.sx * d, cy = (r.sy - LIFT * K_PLATE * (hud.s || 1) * r.scale) * d;
          g.globalAlpha = r.alpha; g.drawImage(r.bc, Math.round(cx - r.box), Math.round(cy - r.boy));
          r._f = f;
        }
        for (const r of order) {
          if (r.textDirty || !r.tc) buildText(r);
          const cx = r.sx * d, cy = (r.sy - LIFT * K_PLATE * (hud.s || 1) * r.scale) * d;
          g.globalAlpha = r.alpha; g.drawImage(r.tc, Math.round(cx - r.tox), Math.round(cy - r.toy));
        }
        g.globalAlpha = 1;
      },
      resize() { sizeDirty = true; for (const r of recs.values()) { r.textDirty = true; r.barDirty = true; } },
    };
  };
})(window);
