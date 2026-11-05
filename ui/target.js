/* TDS HUD part — target card, ported 1:1 from Atherion target_info_view.gd (v2 "Lento", hedef_karti_tasarim.html §07):
 * a 600 × 50 plate (boss 58) centred under the compass at y 102: threat seal (level, ring coloured by level difference) → name (Cinzel) →
 * engraved rule → family label → tier stamp (ELİT / BOSS) → counter well "hp / max"; a full-width notched HP groove below; two nails right.
 * Motion as in the game: fade + 6 px drop on show, fill falls in .12 s, the damage chip waits .2 s (first hit only) and follows in .4 s,
 * the card shakes 2 px on a ≥5 % hit, the groove lip breathes red under 20 % HP.
 * Below the plate (not in Atherion — this game shows target debuffs): small sockets with the effect icon and its seconds.
 * Registers HUDParts.target: set(target, state) with target = { id, name, level, type, disposition, rank: 'normal'|'elite'|'boss', hp, maxHp, effects }.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, C = P.C;

  const PLATE_X = 5, PLATE_W = 600, PANEL_W = PLATE_W + PLATE_X * 2, TOP_MARGIN = 102;
  const PLATE_H = 50, BOSS_PLATE_H = 58, PLATE_CUT = 9;
  const SEAL = { cx: 30, cy: 25, r: 16, ring: 12.5, fs: 15 }, BOSS_SEAL = { cx: 32, cy: 29, r: 18, ring: 14.5, fs: 17 };
  const CONTENT_X = 56, RIGHT_INSET = 26;
  const HEAD_TOP = 6, NAME_BASE = 21, NAME_FS = 18, BOSS_HEAD_TOP = 7, BOSS_NAME_BASE = 24, BOSS_NAME_FS = 20;
  const RULE_Y = 16, BOSS_RULE_Y = 18, RULE_PAD = 12, RULE_MIN_W = 24;
  const COUNT_W_MIN = 88, COUNT_H = 20, COUNT_CUT = 4, COUNT_FS = 12, COUNT_PAD = 20;
  const RANK_H = 18, RANK_FS = 11, RANK_GAP = 8, RANK_PAD = 18, FAMILY_FS = 11, FAMILY_TRACKING = 2, FAMILY_PAD = 10, NAME_GAP = 14, NAME_SHRINK_STEPS = 3;
  const GROOVE_Y = 34, GROOVE_H = 10, BOSS_GROOVE_Y = 38, BOSS_GROOVE_H = 14, BAR_TICKS = 3;
  const NAIL_X = PLATE_W - 14, NAIL_Y = [11, 39], BOSS_NAIL_Y = [12, 46], NAIL_R = 3, NAIL_R_LIT = 1.75;
  const FACE_ALPHA = 0.90;
  const COL_GOLD = '#E2C78F', COL_ENGRAVE = 'rgba(0,0,0,.78)', COL_BAR_BED = 'rgba(12,7,2,.88)', COL_BAR_CUT = 'rgba(0,0,0,.55)';
  const COL_HP = '#951F1F', COL_CHIP = 'rgba(255,115,96,.45)', COL_LOW = '#FF4A3E', LIP_A = 0.30, TICK_A = 0.30;
  const LOW_HP_RATIO = 0.2, CHIP_DELAY = 0.20, CHIP_FALL = 0.40, FILL_FALL = 0.12, SHAKE_MIN_LOSS = 0.05;
  const RANK_TEXT = { elite: 'Elit', boss: 'Boss' };
  // effect sockets under the plate
  const FX_S = 22, FX_GAP = 6, FX_Y = 8, FX_CUT = 3;
  const PAD = 4, CW = PANEL_W + PAD * 2, CH = BOSS_PLATE_H + PAD + FX_Y + FX_S + 16;

  function svgImage(svg, onload) {
    if (!svg) return null;
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image(); img.onload = onload;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img;
  }
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.target = function (hud) {
    const root = document.createElement('div');
    root.className = 'tc-root';
    root.style.opacity = '0';
    hud.frame.appendChild(root);
    const surf = P.surface(root, 'tc-cv', CW, CH, PAD, PAD), g = surf.g;
    const fxHits = document.createElement('div'); fxHits.className = 'tc-fx'; root.appendChild(fxHits);
    let dirty = true; const mark = () => { dirty = true; };
    P.onFonts(() => { layout(); mark(); });

    // card state
    let id = null, T = null, boss = false, elite = false, plateH = PLATE_H, threat = C.T_YELLOW;
    let fill = 1, chip = 1, last = 1, fillFrom = 1, fillTo = 1, fillT = -1, chipFrom = 1, chipTo = 1, chipT = -1, chipWait = 0, chipDraining = false;
    let shakeT = -1, lowOn = false, lowPhase = 0, lowT = 0;
    let alpha = 0, alphaGoal = 0, dropT = -1, cardY = 0;
    // layout
    const L = { nameText: '', namePx: NAME_FS, nameW: 0, nameShown: '', familyVisible: false, familyX: 0, familyW: 0, rankVisible: false, rankX: 0, rankW: 0, countX: 0, countW: COUNT_W_MIN, count: '' };
    let fx = [], fxKey = '', fxImgs = {};

    const fName = (px) => P.F.cinzel(600, px), fFamily = P.F.cinzel(500, FAMILY_FS), fRank = P.F.cinzel(600, RANK_FS), fNum = P.F.serif(500, COUNT_FS);
    const fmt = (v) => P.num(Math.max(0, Math.round(v)), 0);

    function layout() {
      if (!T) return;
      const right = PLATE_W - RIGHT_INSET;
      L.count = fmt(T.hp) + ' / ' + fmt(T.maxHp);
      L.countW = Math.max(COUNT_W_MIN, P.width(g, L.count, fNum) + COUNT_PAD);
      L.countX = right - L.countW;
      let left = L.countX;
      L.rankVisible = boss || elite;
      if (L.rankVisible) { L.rankW = P.width(g, RANK_TEXT[boss ? 'boss' : 'elite'], fRank, FAMILY_TRACKING) + RANK_PAD; L.rankX = left - RANK_GAP - L.rankW; left = L.rankX; } else { L.rankW = 0; L.rankX = left; }
      const fam = T.type || '';
      L.familyVisible = !!fam;
      if (L.familyVisible) { L.familyW = P.width(g, fam, fFamily, FAMILY_TRACKING); L.familyX = left - FAMILY_PAD - L.familyW; left = L.familyX; } else { L.familyW = 0; L.familyX = left; }
      let avail = Math.max(0, left - NAME_GAP - CONTENT_X);
      const base = boss ? BOSS_NAME_FS : NAME_FS;
      L.namePx = base; let raw = P.width(g, T.name, fName(L.namePx));
      if (L.familyVisible && raw > avail) {                        // first the family label gives way (the name is never cut first)
        left += FAMILY_PAD + L.familyW; L.familyVisible = false; L.familyW = 0; L.familyX = left;
        avail = Math.max(0, left - NAME_GAP - CONTENT_X);
      }
      while (raw > avail && L.namePx > base - NAME_SHRINK_STEPS) { L.namePx--; raw = P.width(g, T.name, fName(L.namePx)); }
      L.nameShown = T.name;
      if (raw > avail) {                                            // last resort: ellipsis
        let s = T.name;
        while (s.length > 1 && P.width(g, s + '…', fName(L.namePx)) > avail) s = s.slice(0, -1);
        L.nameShown = s + '…'; raw = P.width(g, L.nameShown, fName(L.namePx));
      }
      L.nameW = Math.min(raw, avail);
    }

    function drawSeal() {
      const S = boss ? BOSS_SEAL : SEAL;
      g.beginPath(); g.arc(S.cx, S.cy + 1.2, S.r, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.42)'; g.fill();
      g.beginPath(); g.arc(S.cx, S.cy, S.r, 0, Math.PI * 2); g.fillStyle = 'rgba(10,6,1,.92)'; g.fill();
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(S.cx, S.cy, S.r - 0.9, Math.PI, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.80)'; g.stroke();
      g.beginPath(); g.arc(S.cx, S.cy, S.r - 0.9, 0, Math.PI); g.strokeStyle = P.rgba(C.ASH_HI, 0.26); g.stroke();
      g.beginPath(); g.arc(S.cx, S.cy, S.ring, 0, Math.PI * 2); g.strokeStyle = P.rgba(threat, 0.92); g.stroke();
      g.lineWidth = 1;
      P.engraved(g, String(T.level || 1), P.F.serif(700, S.fs), S.cx, S.cy, threat, 0, 0, 0.78);
    }
    function drawHead() {
      const top = boss ? BOSS_HEAD_TOP : HEAD_TOP, base = boss ? BOSS_NAME_BASE : NAME_BASE;
      // counter well (the HP number lives here, not in the groove)
      const x = L.countX, w = L.countW;
      P.octPath(g, x, top, w, COUNT_H, COUNT_CUT); g.fillStyle = 'rgba(0,0,0,.70)'; g.fill();
      g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(x + COUNT_CUT, top, w - COUNT_CUT * 2, 1);
      g.fillStyle = P.rgba(C.ASH_HI, 0.18); g.fillRect(x + COUNT_CUT, top + COUNT_H - 1, w - COUNT_CUT * 2, 1);
      P.engraved(g, L.count, fNum, x + w / 2, top + COUNT_H / 2, C.BONE, 0, 0, 0.78);
      if (L.rankVisible) {
        const col = boss ? COL_GOLD : C.BONE, ry = top + 1;
        P.octPath(g, L.rankX, ry, L.rankW, RANK_H, 3); g.fillStyle = 'rgba(0,0,0,.34)'; g.fill(); g.strokeStyle = P.rgba(col, 0.55); g.lineWidth = 1; g.stroke();
        P.engraved(g, RANK_TEXT[boss ? 'boss' : 'elite'], fRank, L.rankX + L.rankW / 2, ry + RANK_H / 2, col, 0, FAMILY_TRACKING, 0.78);
      }
      if (L.familyVisible) baseText(T.type, fFamily, L.familyX, base - 1, C.ASH, FAMILY_TRACKING);
      baseText(L.nameShown, fName(L.namePx), CONTENT_X, base, C.ASH_HI, 0);
      // engraved rule from the end of the name to the start of the chain (makes a short name's gap deliberate)
      const x0 = CONTENT_X + L.nameW + RULE_PAD, chainLeft = L.familyVisible ? L.familyX : L.rankVisible ? L.rankX : L.countX, x1 = chainLeft - RULE_PAD;
      if (x1 - x0 >= RULE_MIN_W) {
        const y = boss ? BOSS_RULE_Y : RULE_Y;
        g.fillStyle = 'rgba(0,0,0,.50)'; g.fillRect(x0, y, x1 - x0, 1);
        g.fillStyle = P.rgba(C.ASH_HI, 0.10); g.fillRect(x0, y + 1, x1 - x0, 1);
      }
    }
    function baseText(text, font, x, baseline, col, tracking) {      // TextLine at (x, baseline - ascent): engraved, 1 px shadow
      g.save(); P.setFont(g, font, tracking);
      g.fillStyle = COL_ENGRAVE; g.fillText(text, x, baseline + 1);
      g.fillStyle = col; g.fillText(text, x, baseline);
      g.restore();
    }
    function drawGroove() {
      const r = { x: CONTENT_X, y: boss ? BOSS_GROOVE_Y : GROOVE_Y, w: PLATE_W - RIGHT_INSET - CONTENT_X, h: boss ? BOSS_GROOVE_H : GROOVE_H };
      g.fillStyle = COL_BAR_BED; g.fillRect(r.x, r.y, r.w, r.h);
      if (chip > 0) { g.fillStyle = COL_CHIP; g.fillRect(r.x, r.y, r.w * chip, r.h); }
      if (fill > 0) { g.fillStyle = COL_HP; g.fillRect(r.x, r.y, r.w * fill, r.h); }
      g.fillStyle = P.rgba(C.ASH, TICK_A);
      for (let i = 1; i <= BAR_TICKS; i++) g.fillRect(Math.round(r.x + r.w * i / (BAR_TICKS + 1)), r.y + 1, 1, r.h - 2);
      g.fillStyle = COL_BAR_CUT; g.fillRect(r.x, r.y, r.w, 1);
      const lipCol = lowOn ? P.mix(C.ASH, COL_LOW, 0.35 + 0.65 * lowPhase) : C.ASH, lipA = lowOn ? LIP_A + (0.85 - LIP_A) * lowPhase : LIP_A;
      g.fillStyle = P.rgba(lipCol, lipA);
      g.fillRect(r.x, r.y + r.h - 1, r.w, 1); g.fillRect(r.x, r.y, 1, r.h); g.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    }
    function nail(cx, cy) { P.diamond(g, cx, cy, NAIL_R, 'rgba(19,11,4,.95)'); P.diamond(g, cx - 0.5, cy - 0.6, NAIL_R_LIT, P.rgba(C.ASH_HI, 0.78)); }
    function drawEffects() {
      const y0 = plateH + FX_Y;
      fx.forEach((e, i) => {
        const x = CONTENT_X + i * (FX_S + FX_GAP);
        P.well(g, x, y0, FX_S, FX_S, FX_CUT, 0.5, 0.72, 0.30);
        const img = fxImgs[e.id];
        if (img && img.complete && img.naturalWidth) {
          g.save(); P.octPath(g, x + 2, y0 + 2, FX_S - 4, FX_S - 4, 2); g.clip(); g.drawImage(img, x + 2, y0 + 2, FX_S - 4, FX_S - 4); g.restore();
          P.octPath(g, x + 2.5, y0 + 2.5, FX_S - 5, FX_S - 5, 2); g.strokeStyle = e.debuff ? 'rgba(194,86,78,.75)' : 'rgba(0,0,0,.55)'; g.stroke();
        }
        if (e.left > 0) P.haloed(g, String(Math.ceil(e.left)), P.F.serif(700, 11), x + FX_S / 2, y0 + FX_S + 7, e.left < 3 ? C.U_AMBER : C.BONE, 0);
      });
    }
    function draw() {
      surf.begin();
      if (!T) return;
      const sx = shakeX();
      g.save(); g.translate(PLATE_X + sx, cardY);
      // contact shadow, rim ramp, face
      P.octPath(g, 0, 2, PLATE_W, plateH, PLATE_CUT); g.fillStyle = 'rgba(0,0,0,.30)'; g.fill();
      P.octPath(g, 0, 0, PLATE_W, plateH, PLATE_CUT); P.fillRamp(g, 0, plateH, P.RIM, 1);
      P.octPath(g, 1.5, 1.5, PLATE_W - 3, plateH - 3, PLATE_CUT - 1.5); P.fillRamp(g, 1.5, plateH - 3, P.FACE, FACE_ALPHA);
      const ny = boss ? BOSS_NAIL_Y : NAIL_Y; nail(NAIL_X, ny[0]); nail(NAIL_X, ny[1]);
      drawSeal(); drawHead(); drawGroove(); drawEffects();
      g.restore();
    }
    function shakeX() {
      if (shakeT < 0) return 0;
      const t = shakeT;                                             // 0 → +2 (.04) → −2 (.06) → 0 (.05)
      if (t < 0.04) return 2 * (t / 0.04);
      if (t < 0.10) return 2 - 4 * ((t - 0.04) / 0.06);
      if (t < 0.15) return -2 + 2 * ((t - 0.10) / 0.05);
      return 0;
    }
    function syncFxHits() {
      fxHits.innerHTML = '';
      fx.forEach((e, i) => {
        const d = document.createElement('div'); d.className = 'tc-fxhit';
        d.style.cssText = 'left:calc(' + (PAD + PLATE_X + CONTENT_X + i * (FX_S + FX_GAP)) + 'px * var(--s));top:calc(' + (PAD + plateH + FX_Y) + 'px * var(--s));width:calc(' + FX_S + 'px * var(--s));height:calc(' + FX_S + 'px * var(--s))';
        fxHits.appendChild(d);
        hud.tips.bind(d, () => { const s = fx.find((q) => q.id === e.id); return s ? '<div class="tt">' + s.name + '</div>' + (s.left > 0 ? '<div class="ts">' + Math.ceil(s.left) + ' sn kaldı</div>' : '') + (s.desc ? '<div class="tb" style="margin-top:4px">' + s.desc + '</div>' : '') : ''; }, 'bottom');
      });
    }

    return {
      set(t, state) {
        if (!t) { if (id !== null) { id = null; alphaGoal = 0; lowOn = false; } return; }
        const ratio = t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 0;
        const pl = state && state.player ? state.player.level : 1;
        if (id !== t.id) {                                          // new target: instant layout, fade + drop in
          id = t.id; T = Object.assign({}, t);
          boss = t.rank === 'boss'; elite = t.rank === 'elite'; plateH = boss ? BOSS_PLATE_H : PLATE_H;
          threat = P.threat((t.level || 1) - (pl || 1));
          fill = chip = last = ratio; fillT = chipT = -1; chipDraining = false; shakeT = -1;
          lowOn = ratio < LOW_HP_RATIO && ratio > 0; lowT = 0; lowPhase = 0;
          alphaGoal = 1; if (alpha < 0.05) { alpha = 0; dropT = 0; cardY = -6; }
          fx = []; fxKey = ''; syncFxHits();
          layout(); mark();
        }
        const newThreat = P.threat((t.level || 1) - (pl || 1));
        const changed = t.hp !== T.hp || t.maxHp !== T.maxHp || t.name !== T.name || t.type !== T.type || t.level !== T.level || newThreat !== threat;
        T = Object.assign({}, t); threat = newThreat;
        if (changed) {
          layout();
          const lost = last - ratio; last = ratio;
          fillFrom = fill; fillTo = ratio; fillT = 0;
          if (lost > 0) {
            chipFrom = chip; chipTo = ratio; chipT = 0;
            if (!chipDraining) { chipDraining = true; chipWait = CHIP_DELAY; } else chipWait = 0;
            if (lost >= SHAKE_MIN_LOSS) shakeT = 0;
          } else { chip = ratio; chipT = -1; chipDraining = false; }
          const low = ratio < LOW_HP_RATIO && ratio > 0;
          if (low !== lowOn) { lowOn = low; lowT = 0; lowPhase = 0; }
          mark();
        }
        // effects (icons rasterised once per id)
        const list = t.effects || [], k = list.map((e) => e.id).join(',');
        if (k !== fxKey) { fxKey = k; for (const e of list) if (!fxImgs[e.id]) fxImgs[e.id] = svgImage(e.iconHTML, mark); }
        const secs = list.map((e) => Math.ceil(e.left || 0)).join(',') + '|' + k;
        if (secs !== fx._sig) { const n = fx.length; fx = list.slice(); fx._sig = secs; if (n !== fx.length) syncFxHits(); mark(); }
      },
      frame(dt) {
        let anim = false;
        if (alpha !== alphaGoal) {
          alpha = alphaGoal > alpha ? Math.min(1, alpha + dt / 0.12) : Math.max(0, alpha - dt / 0.35);
          root.style.opacity = alpha.toFixed(3); anim = true;
          if (alpha <= 0 && !id) { T = null; fx = []; syncFxHits(); }
        }
        if (dropT >= 0) { dropT += dt / 0.16; cardY = -6 * (1 - easeOutCubic(Math.min(1, dropT))); if (dropT >= 1) { dropT = -1; cardY = 0; } anim = true; }
        if (fillT >= 0) { fillT += dt / FILL_FALL; fill = fillFrom + (fillTo - fillFrom) * Math.min(1, fillT); if (fillT >= 1) fillT = -1; anim = true; }
        if (chipT >= 0) {
          if (chipWait > 0) chipWait -= dt;
          else { chipT += dt / CHIP_FALL; chip = chipFrom + (chipTo - chipFrom) * easeOutQuad(Math.min(1, chipT)); if (chipT >= 1) { chipT = -1; chipDraining = false; } }
          anim = true;
        }
        if (shakeT >= 0) { shakeT += dt; if (shakeT >= 0.15) shakeT = -1; anim = true; }
        if (lowOn) { lowT += dt; const u = (lowT % 1); const np = u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5; if (Math.abs(np - lowPhase) >= 0.04 || np === 0 || np === 1) { lowPhase = np; anim = true; } }
        if (anim || dirty) { dirty = false; draw(); }
      },
      resize(s) { surf.resize(s); dirty = true; },
    };
  };
})(window);
