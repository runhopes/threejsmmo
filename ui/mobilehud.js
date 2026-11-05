/* Mobile HUD — touch layer for phones / the native app (styles: ui/mobilehud.css). Loaded after mobile.js; active only under
 * html.is-mobile. It PRESENTS what the desktop HUD already receives (window.__hud.state / .info / .skills, set by index.html) and
 * routes taps to the same entry points (skills → window.__mobile.cast(i) [auto-aims], windows → hud.windows.toggle(id)).
 * LOOK: painted with the web HUD's own brushes (ui/paint.js HUDPaint + ui/bottombar.js HUDBottomPaint): the level seal, the skewed
 * "Cam Çizgi" HP / mana glass bars, octagonal slot wells with the cooldown wedge, the knob for the basic attack, the amber EXP groove.
 * Only the LAYOUT is mobile (MOBA arcs around the attack button). The web target card and minimap are reused, scaled.
 * Hidden on mobile (stylesheet): the desktop action bar (key caps, F-row), compass, menu strip.
 * Layout: see the header of ui/mobilehud.css. */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const D = document, P = window.HUDPaint, BP = window.HUDBottomPaint;
  if (!P || !BP) return;
  const C = P.C;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function h(tag, cls, parent, html) { const e = D.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
  const tog = (el, c, on) => { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };
  const fmt = (n) => P.num(Math.floor(n || 0), 0);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

  const I = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const ICON = {
    bag: I('<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
    menu: I('<path d="M5 7h14M5 12h14M5 17h14"/>'),
    char: I('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.8-4.1 3.6-6.4 7.2-6.4s6.4 2.3 7.2 6.4"/>'),
    skills: I('<path d="M12 6.6C10 5.1 7.1 4.6 4 5.1v13.2c3.1-.5 6 0 8 1.5 2-1.5 4.9-2 8-1.5V5.1c-3.1-.5-6 0-8 1.5Z"/><path d="M12 6.6v13.2"/>'),
    map: I('<path d="M3.5 6.4 9 4.5l6 2 5.5-1.9v13l-5.5 1.9-6-2-5.5 1.9v-13Z"/><path d="M9 4.5v13M15 6.5v13"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>'),
    exit: I('<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h9"/>'),
    chat: I('<path d="M5 5.5h14v10H10l-4 3.5v-3.5H5Z"/><path d="M8.5 9.5h7M8.5 12h4.5"/>'),
    close: I('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    weapon: I('<path d="M14.5 3.5h6v6L10 20l-3-3Z"/><path d="M6 14l4 4M3.5 20.5 7 17"/>'),
    helmet: I('<path d="M5 15a7 7 0 0 1 14 0v3H5Z"/><path d="M12 8v10M9 18v-3h6v3"/>'),
    armor: I('<path d="M8 4 4 6.5V11l3 1v8h10v-8l3-1V6.5L16 4c-1 1.6-2.4 2.4-4 2.4S9 5.6 8 4Z"/>'),
    shield: I('<path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6Z"/>'),
    pants: I('<path d="M7 4h10l1 16h-4l-2-9-2 9H6Z"/>'),
    boots: I('<path d="M8 4h5v9l5 2.5V20H6v-4l2-3Z"/>'),
    earring: I('<circle cx="12" cy="7" r="2.5"/><path d="M12 9.5v3"/><path d="M12 12.5 9.5 17h5Z"/>'),
    bracelet: I('<ellipse cx="12" cy="12" rx="7" ry="4.5"/><ellipse cx="12" cy="12" rx="4.5" ry="2.2"/>'),
  };

  /* ======================= painters (web brushes, mobile sizes) ======================= */
  // recipe alphas / motion: ui/bottombar.js (action_bar_plate.gd)
  const WELL_FILL = 0.50, WELL_LIP_TOP = 0.72, WELL_LIP_BOT = 0.30, ICON_RECESS = 0.34, ICON_EDGE = 0.55, CD_VEIL = 0.66, CD_EDGE = 0.30;
  const READY_A = 0.90, READY_WASH = 0.12, PRESS_DARK = 0.18, DROP_OK_A = 0.85, DROP_OK_WASH = 0.07, DROP_NO_A = 0.85, DROP_NO_WASH = 0.06;
  const PRESS_TIME = 0.21, READY_TIME = 0.45, DENY_TIME = 0.34, CHIP_HOLD = 0.35, CHIP_SPEED = 0.9, LOW_PERIOD = 1.10;
  const VEIL = 'rgba(6,4,2,', DIM = '#A89C86';

  // one ROUND slot (skill) or round knob (basic attack) on its own canvas — the web slot recipe (sunken well, recessed icon, cooldown
  // wedge, amber ready pulse / active lip, danger deny) on a circle with the seal's bronze rim ramp
  function Slot(parent, d, opts) {
    const pad = 6, R = d / 2, cx = R, cy = R;
    const surf = P.surface(parent, 'mh-cv', d + pad * 2, d + pad * 2, pad, pad); surf.resize(1);
    const S = { surf, d, knob: !!opts.knob, img: null, press: -1, ready: -1, deny: -1, cd: 0, cdText: '', alpha: 1, active: false, held: false, dirty: true, sig: '' };
    S.setIcon = (svg) => { S.img = svg ? BP.svgImage(svg, () => { S.dirty = true; }) : null; S.dirty = true; };
    const ring = (g, r, col, a, w) => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.strokeStyle = P.rgba(col, a); g.lineWidth = w; g.stroke(); };
    S.draw = function () {
      const g = surf.begin();
      // drop shadow
      g.beginPath(); g.arc(cx, cy + 1.5, R + 1, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.18)'; g.fill();   // a hairline contact shadow only
      // bronze rim (seal recipe): dark outline, rim ramp, face ramp; the knob gets a wider rim + inner ring
      const rimW = S.knob ? Math.max(5, d * 0.08) : Math.max(2.5, d * 0.055);
      g.beginPath(); g.arc(cx, cy, R + 0.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 1; g.stroke();
      P.circlePath(g, cx, cy, R); P.fillRamp(g, cy - R, d, P.RIM, S.held ? 1 : 0.92);
      if (S.knob) { P.circlePath(g, cx, cy, R - 1.5); P.fillRamp(g, cy - R, d, P.FACE, 0.6); }
      const wr = R - rimW;
      // sunken well
      P.circlePath(g, cx, cy, wr); g.fillStyle = 'rgba(8,6,4,' + (S.img ? WELL_FILL : 0.3) + ')'; g.fill();
      ring(g, wr - 0.5, '#000000', 0.5, 1);
      const ir = wr - Math.max(1.5, d * 0.03), p = S.press >= 0 ? Math.sin(Math.PI * Math.min(1, S.press)) * 1.5 : 0;
      if (S.img && S.img.complete && S.img.naturalWidth) {
        g.save(); P.circlePath(g, cx, cy, ir); g.clip();
        g.globalAlpha = S.alpha; const sz = ir * 2 * 1.12; g.drawImage(S.img, cx - sz / 2, cy - sz / 2 + p, sz, sz); g.restore();
        if (p > 0) { P.circlePath(g, cx, cy, ir); g.fillStyle = 'rgba(0,0,0,' + (PRESS_DARK * p / 1.5) + ')'; g.fill(); }
        // seat the icon: inner shade from the top + dark edge
        g.save(); P.circlePath(g, cx, cy, ir); g.clip();
        g.fillStyle = P.vgrad(g, cy - ir, ir * 0.5, [[0, 'rgba(0,0,0,' + ICON_RECESS + ')'], [1, 'rgba(0,0,0,0)']]); g.fillRect(cx - ir, cy - ir, ir * 2, ir * 0.5); g.restore();
        ring(g, ir - 0.5, '#000000', ICON_EDGE, 1);
      }
      // top light on the rim
      g.beginPath(); g.arc(cx, cy, R - 0.8, Math.PI * 1.1, Math.PI * 1.9); g.strokeStyle = P.rgba(C.AMBER_LIT, 0.22); g.lineWidth = 1; g.stroke();
      if (S.knob) ring(g, wr + 1.5, '#000000', 0.55, 1);
      if (S.cd > 0) {                                                // remaining time: dark wedge opening clockwise from 12 + engraved seconds
        const f = clamp01(S.cd), a0 = -Math.PI / 2 + Math.PI * 2 * (1 - f), a1 = -Math.PI / 2 + Math.PI * 2;
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, ir, a0, a1); g.closePath(); g.fillStyle = VEIL + CD_VEIL + ')'; g.fill();
        if (f < 1) { g.strokeStyle = P.rgba(C.ASH_HI, CD_EDGE); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * ir, cy + Math.sin(a0) * ir); g.stroke(); }
        if (S.cdText) P.engraved(g, S.cdText, P.F.serif(700, Math.round(d * 0.34)), cx, cy + 1, C.ASH_HI, 0);
      }
      if (S.ready >= 0) {
        const k = Math.sin(Math.PI * Math.min(1, S.ready));
        if (k > 0) { P.circlePath(g, cx, cy, wr); g.fillStyle = P.rgba(C.AMBER_LIT, READY_WASH * k); g.fill(); ring(g, R - 1, C.AMBER, READY_A * k, 2); }
      }
      if (S.active || S.held) { P.circlePath(g, cx, cy, wr); g.fillStyle = P.rgba(C.AMBER, DROP_OK_WASH); g.fill(); ring(g, R - 1, C.AMBER, DROP_OK_A, 2); }
      if (S.deny >= 0) { const k = 1 - Math.min(1, S.deny); ring(g, R - 1, C.DANGER, DROP_NO_A * k, 2); }
    };
    S.tick = function (dt) {
      let anim = false;
      if (S.press >= 0) { S.press += dt / PRESS_TIME; if (S.press >= 1) S.press = -1; anim = true; }
      if (S.ready >= 0) { S.ready += dt / READY_TIME; if (S.ready >= 1) S.ready = -1; anim = true; }
      if (S.deny >= 0) { S.deny += dt / DENY_TIME; if (S.deny >= 1) S.deny = -1; anim = true; }
      if (anim || S.dirty) { S.dirty = false; S.draw(); }
    };
    return S;
  }

  // compact target bar (top centre): threat-coloured level, name, rank; a thin segmented HP glass bar. Fades out after the target dies.
  function TargetBar(parent) {
    const W = 236, H = 40, BX = 4, BW = 228;
    const surf = P.surface(parent, 'mh-cv', W + 8, H + 8, 4, 4); surf.resize(1);
    let T = null, myLv = 1, dirty = true, sig = '', rHp = 0, chip = 0, hold = 0, deadT = 0;
    P.onFonts(() => { dirty = true; });
    function draw() {
      const g = surf.begin(); if (!T) return;
      const lv = String(T.level || ''), lvCol = T.level ? P.threat(T.level - myLv) : C.BONE;
      let x = BX;
      if (lv) x += P.ufuk(g, lv, P.F.cinzel(700, 13), x, 13, lvCol) + 6;
      const rk = T.rank === 'boss' ? 'BOSS' : T.rank === 'elite' ? 'ELİT' : '';
      const nameCol = T.disposition === 'friendly' ? '#B9DCA0' : T.disposition === 'neutral' ? '#EADB92' : C.U_BONE;
      P.ufuk(g, T.name || '', P.F.cinzel(600, 13), x, 13, nameCol);
      if (rk) P.ufuk(g, rk, P.F.cinzel(600, 10), BX + BW, 13, C.U_AMBER, 1);
      BP.glassBar(g, BX, 19, BW, 12, 6, rHp, chip, rHp, BP.GB.HP, true, 0);
      const t = T.hp <= 0 ? 'Ölü' : fmt(T.hp) + ' / ' + fmt(T.maxHp);
      P.ufuk(g, t, P.F.sans(700, 10), BX + BW / 2, 19 + 9.5, C.U_BONE, 0);
    }
    return {
      set(t, lvl, el) {
        myLv = lvl || 1;
        if (!t) { T = null; deadT = 0; el.hidden = true; return; }
        if (!T || T.id !== t.id) { rHp = t.maxHp > 0 ? clamp01(t.hp / t.maxHp) : 0; chip = 0; deadT = 0; }
        const r = t.maxHp > 0 ? clamp01(t.hp / t.maxHp) : 0;
        if (r < rHp) { chip = Math.max(chip, rHp); hold = CHIP_HOLD; }
        rHp = r; T = t;
        const k = t.id + '|' + Math.round(t.hp) + '|' + t.maxHp + '|' + t.name + '|' + t.level + '|' + myLv;
        if (k !== sig) { sig = k; dirty = true; }
        el.hidden = t.hp <= 0 && deadT > 0.8;                       // a dead target lingers briefly, then the bar goes
      },
      tick(dt) {
        if (T && T.hp <= 0) deadT += dt;
        if (chip > rHp) { if (hold > 0) hold -= dt; else chip = Math.max(rHp, chip - CHIP_SPEED * dt); dirty = true; } else chip = 0;
        if (dirty) { dirty = false; draw(); }
      },
    };
  }

  // level seal + name + HP / mana glass bars (vitals_strip.gd look, stacked for the top-left corner)
  function Vitals(parent) {
    const W = 246, H = 64, SX = 25, SY = 30, SR = 22, BX = 54, HPW = 186, HPH = 18, HPSK = 9, MPW = 176, MPH = 6, MPSK = 3;
    const surf = P.surface(parent, 'mh-cv', W + 8, H + 8, 4, 4); surf.resize(1);
    const V = { hp: 0, maxHp: 0, mp: 0, maxMp: 0, rHp: 0, rMp: 0, chip: 0, hold: 0, env: 0, phase: 0, level: 1, name: '', dead: false, flash: -1 };
    let dirty = true, sig = '';
    P.onFonts(() => { dirty = true; });
    function num2(g, cur, max, x, base, align, big) {
      const fa = big ? P.F.sans(800, 13) : P.F.sans(700, 10), fb = big ? P.F.sans(500, 10) : P.F.sans(500, 9);
      const a = fmt(cur), b = ' / ' + fmt(max), wa = P.width(g, a, fa), wb = P.width(g, b, fb), tot = wa + wb;
      const x0 = align < 0 ? x : align === 0 ? x - tot * 0.5 : x - tot;
      P.ufuk(g, a, fa, x0, base, C.U_BONE); P.ufuk(g, b, fb, x0 + wa, base, DIM);
    }
    function draw() {
      const g = surf.begin();
      // seal (drawSeal): rim ramp, face ramp, inner ring, engraved level
      const f = V.flash >= 0 ? 1 - Math.min(1, V.flash) : 0;
      g.beginPath(); g.arc(SX, SY, SR + 0.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke();
      P.circlePath(g, SX, SY, SR); P.fillRamp(g, SY - SR, SR * 2, P.RIM, 1);
      P.circlePath(g, SX, SY, SR - 1.5); P.fillRamp(g, SY - SR, SR * 2, P.FACE, 0.97);
      g.beginPath(); g.arc(SX, SY, SR - 4.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
      g.beginPath(); g.arc(SX, SY + 0.8, SR - 3.7, 0, Math.PI); g.strokeStyle = P.rgba(C.ASH_HI, 0.14); g.stroke();
      if (f > 0) { g.beginPath(); g.arc(SX, SY, SR - 4.5, 0, Math.PI * 2); g.strokeStyle = P.rgba(C.AMBER, 0.9 * f); g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
      const lv = String(V.level);
      P.engraved(g, lv, P.F.cinzel(700, lv.length >= 3 ? 14 : 18), SX, SY + 1, f > 0 ? P.mix(C.BONE, C.AMBER_LIT, f) : C.BONE, 0);
      // name
      P.ufuk(g, V.name, P.F.cinzel(600, 13), BX + 2, 13, C.U_BONE, -1, undefined, 0.6);
      // HP (segmented glass, damage chip, low pulse) + mana
      const low = V.env > 0 ? V.env * (0.25 + 0.75 * (Math.sin(V.phase * Math.PI * 2 / LOW_PERIOD) + 1) * 0.5) : 0;
      BP.glassBar(g, BX, 19, HPW, HPH, HPSK, V.rHp, V.chip, V.rHp, BP.GB.HP, true, low);
      BP.glassBar(g, BX, 19 + HPH + 5, MPW, MPH, MPSK, V.rMp, 0, V.rMp, BP.GB.MP, false, 0);
      if (V.maxHp > 0) { if (V.dead) P.ufuk(g, 'Ölü', P.F.sans(800, 13), BX + HPW / 2, 19 + 13.5, C.U_BONE, 0); else num2(g, V.hp, V.maxHp, BX + HPW / 2, 19 + 13.5, 0, true); }
      if (V.maxMp > 0) num2(g, V.mp, V.maxMp, BX + 2, 19 + HPH + 5 + MPH + 11, -1, false);
    }
    return {
      set(p, info) {
        const rh = p.maxHp > 0 ? clamp01(p.hp / p.maxHp) : 0;
        if (rh < V.rHp && V.maxHp > 0) { V.chip = Math.max(V.chip, V.rHp); V.hold = CHIP_HOLD; } else if (rh >= V.chip) V.chip = 0;
        if ((p.level || 1) > V.level && V.maxHp > 0) V.flash = 0;
        Object.assign(V, { hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, rHp: rh, rMp: p.maxMp > 0 ? clamp01(p.mp / p.maxMp) : 0, level: p.level || 1, dead: !!p.dead, name: (info && info.name) || '' });
        const k = Math.round(V.hp) + '/' + V.maxHp + '|' + Math.round(V.mp) + '/' + V.maxMp + '|' + V.level + '|' + V.name + '|' + V.dead;
        if (k !== sig) { sig = k; dirty = true; }
      },
      tick(dt) {
        let anim = false;
        if (V.chip > V.rHp) { if (V.hold > 0) V.hold -= dt; else V.chip = Math.max(V.rHp, V.chip - CHIP_SPEED * dt); anim = true; } else V.chip = 0;
        const lowGoal = !V.dead && V.maxHp > 0 && V.rHp < 0.3 ? 1 : 0;
        if (V.env !== lowGoal) { V.env += Math.sign(lowGoal - V.env) * Math.min(Math.abs(lowGoal - V.env), dt / 0.25); anim = true; }
        if (V.env > 0) { V.phase += dt; anim = true; } else V.phase = 0;
        if (V.flash >= 0) { V.flash += dt / 1.2; if (V.flash >= 1) V.flash = -1; anim = true; }
        if (anim || dirty) { dirty = false; draw(); }
      },
    };
  }

  // active effects (the web's effect column, condensed): round icon wells with the bronze rim, an amber depletion arc and m:ss below;
  // the last 5 s turn the time red (effect_bar_model low)
  function BuffRow(parent) {
    const D0 = 26, GAP = 6, MAX = 8, H = D0 + 14, W = MAX * (D0 + GAP);
    const surf = P.surface(parent, 'mh-cv', W + 8, H + 8, 4, 4); surf.resize(1);
    let list = [], imgs = {}, sig = '', dirty = true;
    P.onFonts(() => { dirty = true; });
    const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
    function draw() {
      const g = surf.begin(), n = Math.min(MAX, list.length), x0 = (W - n * (D0 + GAP) + GAP) / 2, R = D0 / 2;
      for (let i = 0; i < n; i++) {
        const b = list[i], cx = x0 + i * (D0 + GAP) + R, cy = R, img = imgs[b.id];
        g.beginPath(); g.arc(cx, cy, R + 0.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke();
        P.circlePath(g, cx, cy, R); P.fillRamp(g, cy - R, D0, P.RIM, 0.92);
        P.circlePath(g, cx, cy, R - 2); g.fillStyle = 'rgba(8,6,4,.6)'; g.fill();
        if (img && img.complete && img.naturalWidth) { g.save(); P.circlePath(g, cx, cy, R - 2.5); g.clip(); g.drawImage(img, cx - R, cy - R, D0, D0); g.restore(); }
        const f = b.dur > 0 ? clamp01(b.left / b.dur) : 1, low = b.left > 0 && b.left <= 5;
        g.beginPath(); g.arc(cx, cy, R - 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); g.strokeStyle = P.rgba(b.debuff ? C.DANGER : C.AMBER, 0.95); g.lineWidth = 2; g.stroke();
        if (b.left > 0) P.engraved(g, mmss(b.left), P.F.serif(700, 10), cx, D0 + 7, low ? C.U_BAD : C.BONE, 0);
      }
    }
    return {
      set(bs) {
        list = (bs || []).slice(0, MAX);
        for (const b of list) if (!imgs[b.id] && b.iconHTML) imgs[b.id] = BP.svgImage(b.iconHTML, () => { dirty = true; });
        const k = list.map((b) => b.id + ':' + Math.ceil(b.left || 0) + ':' + (b.dur ? Math.round(30 * (b.left || 0) / b.dur) : 0)).join(',');
        if (k !== sig) { sig = k; dirty = true; }
      },
      tick() { if (dirty) { dirty = false; draw(); } },
      get count() { return list.length; },
    };
  }

  // EXP groove (drawGroove): strap knob, well groove, amber fill + ticks, cap + nail, percentage read
  function XpRail(parent) {
    const H = 22, CYR = 11;
    let W = 300, surf = P.surface(parent, 'mh-cv', W, H, 0, 0), X = { ratio: 0, level: 1, need: 0 }, dirty = true, glint = -1, sig = '';
    surf.resize(1);
    function draw() {
      const g = surf.begin(), capW = 10, readW = 46, sx = 0, sw = W - readW - capW / 2;
      P.knob(g, sx, CYR - 7, sw, 14, 4, 0.97, 0.8);
      const gx = sx + 5, gw = sw - 10 - capW / 2, gy = CYR - 4, gh = 8;
      P.well(g, gx, gy, gw, gh, 2, 0.5, 0.72, 0.30);
      const fx = gx + 1, fy = gy + 1, fw = gw - 2, fh = gh - 2, r = clamp01(X.ratio), ww = fw * r;
      if (ww > 0) {
        g.save(); g.globalAlpha = 0.94; g.fillStyle = P.vgrad(g, fy, fh, [[0, C.AMBER_LIT], [0.3, C.AMBER], [1, P.darkened(C.AMBER, 0.34)]]); g.fillRect(fx, fy, ww, fh); g.restore();
        if (r < 1) { g.fillStyle = P.rgba(C.AMBER_LIT, 0.95); g.fillRect(fx + ww - 1.5, fy, 1.5, fh); }
        if (glint >= 0) { const ga = 0.55 * Math.sin(Math.PI * Math.min(1, glint)), x0 = Math.max(fx, fx + ww - 14), gg = g.createLinearGradient(x0, 0, fx + ww, 0);
          gg.addColorStop(0, P.rgba(C.AMBER_LIT, 0)); gg.addColorStop(1, P.rgba(C.AMBER_LIT, ga)); g.fillStyle = gg; g.fillRect(x0, fy, fx + ww - x0, fh); }
      }
      g.fillStyle = 'rgba(0,0,0,.42)'; for (let k = 1; k < 10; k++) g.fillRect(Math.round(fx + fw * k / 10), fy, 1, Math.round(fh * 0.5));
      const cx = sx + sw - capW / 2; P.knob(g, cx - capW / 2, CYR - 9, capW, 18, 3, 0.97, 1); P.nail(g, cx, CYR, 2.2);
      if (X.need > 0) P.haloed(g, P.pct(r * 100, 1), P.F.serif(700, 11), sx + sw + 6, CYR, C.BONE);
    }
    return {
      width(w) { w = Math.max(120, Math.round(w)); if (w !== W) { W = w; surf.resize(1, W, H); dirty = true; } },
      set(x) { const r = x.need > 0 ? clamp01(x.exp / x.need) : 0; if (r > X.ratio + 0.00005 && X.need > 0) glint = 0; X = { ratio: r, level: x.level, need: x.need };
        const k = r.toFixed(4) + '|' + x.level; if (k !== sig) { sig = k; dirty = true; } },
      tick(dt) { if (glint >= 0) { glint += dt / 0.6; if (glint >= 1) glint = -1; dirty = true; } if (dirty) { dirty = false; draw(); } },
    };
  }

  // small square knob behind an icon (bag / menu / close): same face + rim as the web's knobs
  function knobBg(el, size) {
    const surf = P.surface(el, 'mh-kb', size + 8, size + 8, 4, 4); surf.resize(1);
    // round like the slots: bronze rim ramp + dark face, no drop shadow
    const draw = () => {
      const g = surf.begin(), R = size / 2, on = el.classList.contains('on');
      g.beginPath(); g.arc(R, R, R + 0.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; g.stroke();
      P.circlePath(g, R, R, R); P.fillRamp(g, 0, size, P.RIM, on ? 1 : 0.9);
      P.circlePath(g, R, R, R - 2.5); g.fillStyle = on ? 'rgba(46,36,22,.88)' : 'rgba(14,11,8,.62)'; g.fill();
      g.beginPath(); g.arc(R, R, R - 0.8, Math.PI * 1.1, Math.PI * 1.9); g.strokeStyle = P.rgba(C.AMBER_LIT, 0.22); g.lineWidth = 1; g.stroke();
    };
    draw(); return draw;
  }

  /* ======================= layer ======================= */
  let hud = null, root = null, built = false;
  const ui = {};
  const press = (b, fn) => { b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); }); b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); };

  function build() {
    hud = window.__hud;
    root = h('div', '', D.body); root.id = 'mh-root'; root.hidden = true;

    // player: seal + name + glass bars (tap → character window)
    const me = ui.me = h('div', 'mh-me', root);
    ui.vit = Vitals(me);
    me.addEventListener('click', () => winToggle('char'));
    ui.buffsEl = h('div', 'mh-buffs', root); ui.buffs = BuffRow(ui.buffsEl);
    ui.tgEl = h('div', 'mh-tg', root); ui.tgEl.hidden = true; ui.tg = TargetBar(ui.tgEl);

    // top-right: bag + menu knobs, menu sheet
    const tr = h('div', 'mh-tr', root);
    const bBag = ui.bBag = h('button', 'mh-ib', tr); ui.bBagKb = knobBg(bBag, 38); bBag.insertAdjacentHTML('beforeend', ICON.bag); press(bBag, () => winToggle('inv'));
    const bMenu = ui.bMenu = h('button', 'mh-ib', tr); ui.bMenuKb = knobBg(bMenu, 38); bMenu.insertAdjacentHTML('beforeend', ICON.menu); press(bMenu, () => sheet(!ui.sheet || ui.sheet.hidden));
    const sh = ui.sheet = h('div', 'mh-sheet mh-panel', root); sh.hidden = true;
    [['char', 'Karakter', ICON.char], ['skills', 'Yetenekler', ICON.skills], ['inv', 'Envanter', ICON.bag],
      ['map', 'Harita', ICON.map], ['chat', 'Sohbet', ICON.chat], ['menu', 'Ayarlar', ICON.gear], ['exit', 'Çıkış', ICON.exit]].forEach(([id, label, ic]) => {
      const b = h('button', '', sh, ic + '<span>' + label + '</span>');
      press(b, () => { sheet(false); if (id === 'exit') exitGame(); else if (id === 'chat') { if (hud.log && hud.log.focus) hud.log.focus(); } else winToggle(id); });
    });
    root.addEventListener('pointerdown', (e) => { if (!sh.hidden && !sh.contains(e.target) && e.target !== bMenu && !bMenu.contains(e.target)) sheet(false); });

    // skills + basic attack knob (painted into mobile.js's #m-fire)
    ui.skills = []; ui.skillSig = '';
    ui.tip = h('div', 'mh-tip mh-panel', root); ui.tip.hidden = true;
    const fire = D.getElementById('m-fire');
    if (fire) {
      fire.innerHTML = '';
      const fd = parseFloat(getComputedStyle(D.documentElement).getPropertyValue('--mh-fire-size')) || 80;
      ui.fire = Slot(fire, fd, { knob: true }); ui.fireEl = fire;
      new MutationObserver(() => { const on = fire.classList.contains('on'); if (ui.fire.held !== on) { ui.fire.held = on; ui.fire.dirty = true; if (on) ui.fire.press = 0; } }).observe(fire, { attributes: true, attributeFilter: ['class'] });
    }

    // modal chrome: dim (for windows without their own backdrop, UNDER the HUD windows) + one large close button above everything
    ui.dim = h('div', 'mh-dim'); hud.frame.insertBefore(ui.dim, hud.frame.firstChild);
    ui.x = h('button', 'mh-x', D.body); ui.x.type = 'button'; knobBg(ui.x, 42); ui.x.insertAdjacentHTML('beforeend', ICON.close); press(ui.x, closeTop);
    ui.dim.addEventListener('click', closeTop);
    ui.page = null;

    // EXP groove
    ui.xpEl = h('div', 'mh-xp', root);
    ui.xp = XpRail(ui.xpEl);

    built = true;
    layout();
    addEventListener('resize', layout);
    perfAndPing();
  }

  function sheet(on) { ui.sheet.hidden = !on; tog(ui.bMenu, 'on', on); ui.bMenuKb(); }
  function winToggle(id) {
    if (!hud || !hud.windows) return;
    if (id === 'skills' || id === 'inv') { if (ui.page && ui.page.id === id) closePage(); else openPage(id); return; }   // touch sheets
    closePage();
    if (hud.windows.reg && !hud.windows.reg[id]) return;
    hud.windows.toggle(id);
  }
  function exitGame() {
    // the same path as the desktop menu strip's Çıkış: index.html sets hud.onExit → confirm modal (app/screens.js); else the menu window
    if (hud && hud.onExit) hud.onExit(); else winToggle('menu');
  }

  // ---- touch sheets: the canvas skills tree / inventory are desktop-sized (portrait / 1280 px wide); on a phone the same
  //      information is laid out for a short landscape screen ----
  function openPage(id) {
    closePage();
    for (const k in hud.windows.reg) if (hud.windows.isOpen(k)) hud.windows.close ? hud.windows.close(k) : hud.windows.toggle(k);
    const pg = h('div', 'mh-page', root); pg.id = 'mh-page-' + id;
    ui.page = { id, el: pg };
    if (id === 'skills') pageSkills(pg); else pageInv(pg);
  }
  function closePage() { if (ui.page) { ui.page.el.remove(); ui.page = null; } }
  function closeTop() {
    if (ui.page) { closePage(); return; }
    if (hud && hud.windows && hud.windows.closeTop) hud.windows.closeTop();
  }
  function pageSkills(pg) {
    const info = hud.info || {}, list = hud.skills || [], basic = hud.basic;
    const card = (s, i, isBasic) => '<div class="mh-skc' + (isBasic ? ' basic' : '') + '"><div class="ic">' + (s.iconHTML || '') + '</div><b>' + esc(s.name) + '</b>' +
      '<div class="meta">' + (isBasic ? '<span class="key">TEMEL SALDIRI</span>' : '<span class="key">' + (i + 1) + '. YETENEK</span>') +
      (s.mp ? '<span class="mp">' + s.mp + ' mana</span>' : '') + (s.cd ? '<span>' + s.cd + ' sn</span>' : '') + '</div>' +
      '<p>' + esc(s.desc || '') + '</p></div>';
    pg.innerHTML = '<header><h2>YETENEKLER</h2><small>' + esc([info.name, info.title].filter(Boolean).join(' · ')) + '</small></header>' +
      '<div class="body"><div class="mh-skg">' + (basic ? card(basic, -1, true) : '') + list.map((s, i) => card(s, i, false)).join('') + '</div></div>';
  }
  function pageInv(pg) {
    const EQ = [['helmet', 'Kask'], ['earring', 'Küpe'], ['bracelet', 'Kolluk'], ['weapon', 'Silah'], ['armor', 'Zırh'], ['shield', 'Kalkan'], ['pants', 'Pantolon'], ['boots', 'Bot']];
    const well = (k, label) => '<div class="mh-well ' + k + '">' + (ICON[k] || '') + '<span>' + label.toLocaleUpperCase('tr-TR') + '</span></div>';
    const empty = (n) => Array.from({ length: n }, () => '<div class="mh-well"></div>').join('');
    pg.innerHTML = '<header><h2>ENVANTER</h2><div class="tabs"><button class="on" data-t="eq">KUŞAM</button><button data-t="ex">EK YUVALAR</button></div></header>' +
      '<div class="body"><div class="mh-inv">' +
      '<div><div class="mh-cap" data-cap>KUŞAM</div><div class="mh-eq" data-eq>' + EQ.map(([k, l]) => well(k, l)).join('') + '</div>' +
      '<div class="mh-eq" data-ex hidden style="grid-template-columns:repeat(4,50px);grid-auto-rows:50px">' + empty(12) + '</div></div>' +
      '<div><div class="mh-cap">HEYBE</div><div class="mh-bag">' + empty(30) + '</div><div class="mh-note">Heyben boş.</div></div>' +
      '</div></div>';
    pg.querySelectorAll('.tabs button').forEach((b) => press(b, () => {
      pg.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      const ex = b.dataset.t === 'ex';
      pg.querySelector('[data-eq]').hidden = ex; pg.querySelector('[data-ex]').hidden = !ex;
      pg.querySelector('[data-cap]').textContent = ex ? 'EK YUVALAR' : 'KUŞAM';
    }));
  }

  // minimap + target card (shared web parts) scaled into place; EXP groove spans the gap between joystick and skill arcs
  function layout() {
    const de = D.documentElement, mm = D.querySelector('.ath-mm');
    if (mm) {
      const k = Math.max(0.46, Math.min(0.66, innerHeight / 640));
      de.style.setProperty('--mh-mm-k', k.toFixed(3));
      de.style.setProperty('--mh-mm-w', Math.round(mm.offsetWidth * k) + 'px');
    }
    // EXP groove: from the joystick's right edge to the attack knob's left edge (measured, so every screen size fits)
    if (ui.xp) {
      const joy = D.getElementById('m-joy'), fire = D.getElementById('m-fire');
      const l = joy ? joy.getBoundingClientRect().right + 14 : 190, r = fire ? fire.getBoundingClientRect().left - 12 : innerWidth - 250;
      ui.xpEl.style.left = Math.round(l) + 'px';
      ui.xp.width(r - l);
    }
  }

  // fps (the game's own reading) + ping (round trip to the game server) under the minimap, in the minimap's info line
  // damage numbers are sized in world metres; the phone camera sits further out than the desktop one, so they are scaled up
  window.__dmgNumScale = 1.9;

  function perfAndPing() {
    let fps = 0, ping = null;
    hud.settings.perf = true; if (hud.applyPerf) hud.applyPerf();
    const write = () => { if (hud.minimap && hud.minimap.perf) hud.minimap.perf.textContent = (fps ? fps + ' fps' : '') + (ping !== null ? (fps ? ' · ' : '') + ping + ' ms' : ''); };
    hud.setPerf = function (p) { if (p && p.fps) fps = p.fps; write(); };
    const base = (window.AtherionConfig && window.AtherionConfig.API_BASE) || '';
    async function probe() {
      if (D.hidden) return;
      const t0 = performance.now();
      try { const r = await fetch(base + '/health?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) ping = Math.round(performance.now() - t0); else ping = null; }
      catch (e) { ping = null; }
      write();
    }
    probe(); setInterval(probe, 4000);
  }

  // ---- skills: two arcs around the basic-attack knob (inner 1-4, outer 5-8), each an octagonal web slot ----
  function buildSkills(list) {
    ui.skills.forEach((S) => S.el.remove()); ui.skills = [];
    const fire = D.getElementById('m-fire');
    const fireR = (parseFloat(getComputedStyle(D.documentElement).getPropertyValue('--mh-fire-size')) || 80) / 2;
    const fr = fire ? fire.getBoundingClientRect() : { right: innerWidth - 66, bottom: innerHeight - 62, width: 80, height: 80 };
    const cx = innerWidth - (fr.right - fr.width / 2), cy = innerHeight - (fr.bottom - fr.height / 2);   // centre, measured from right / bottom
    const short = innerHeight < 360;
    const inner = { r: fireR + (short ? 50 : 58), d: short ? 44 : 50, a: [180, 148, 116, 84] };
    const outer = { r: fireR + (short ? 106 : 120), d: short ? 40 : 44, a: [168, 144, 120, 96] };
    list.forEach((s, i) => {
      const ring = i < 4 ? inner : outer, a = ring.a[i % 4] * Math.PI / 180;
      const x = cx - Math.cos(a) * ring.r, y = cy + Math.sin(a) * ring.r;   // angle 180° = straight left, 90° = straight up
      const el = h('button', 'mh-sk', root);
      el.style.setProperty('--d', ring.d + 'px'); el.style.setProperty('--x', x.toFixed(1) + 'px'); el.style.setProperty('--y', y.toFixed(1) + 'px');
      const S = Slot(el, ring.d, {}); S.el = el; S.def = s; S.setIcon(s.iconHTML); S.cdWas = 0;
      let downT = 0, longT = 0, long = false;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); el.setPointerCapture(e.pointerId);
        downT = performance.now(); long = false; S.press = 0;
        longT = setTimeout(() => { long = true; showTip(i); }, 420);
      });
      el.addEventListener('pointerup', (e) => {
        e.stopPropagation(); clearTimeout(longT);
        if (long) { ui.tip.hidden = true; return; }
        if (performance.now() - downT < 1500) cast(i);
      });
      el.addEventListener('pointercancel', () => { clearTimeout(longT); ui.tip.hidden = true; });
      ui.skills.push(S);
    });
    if (ui.fire && hud.basic) ui.fire.setIcon(hud.basic.iconHTML);
  }
  function cast(i) {
    const m = window.__mobile;
    if (m && m.cast) m.cast(i); else if (hud && hud.opts && hud.opts.onSkill) hud.opts.onSkill(i);
  }
  function showTip(i) {
    const s = hud.skills && hud.skills[i]; if (!s) return;
    ui.tip.innerHTML = '<div class="tt">' + esc(s.name) + '</div><div class="tm">' + (s.mp ? s.mp + ' mana' : '') + (s.mp && s.cd ? ' · ' : '') + (s.cd ? s.cd + ' sn bekleme' : '') + '</div><div class="tb">' + esc(s.desc || '') + '</div>';
    ui.tip.hidden = false;
  }

  // the game calls hud.pressed(i) / hud.deny(i) for slot feedback; mirror them onto the touch slots
  function hookFeedback() {
    if (!hud || hud._mhHooked) return; hud._mhHooked = true;
    const p = hud.pressed, d = hud.deny;
    hud.pressed = function (i) { if (ui.skills[i]) ui.skills[i].press = 0; return p.apply(this, arguments); };
    hud.deny = function (i) { if (ui.skills[i]) ui.skills[i].deny = 0; return d.apply(this, arguments); };
  }

  // ---- per-frame update (canvases redraw only on change / while animating) ----
  let last = performance.now();
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000)); last = t;
    if (!window.__hud) return;
    if (!built) build();
    const sel = D.getElementById('select'), scr = D.getElementById('at-screen');
    const hr = hud.root, visible = hr && !hr.hidden && !(sel && !sel.hidden) && !(scr && !scr.hidden);
    if (root.hidden === visible) root.hidden = !visible;
    if (!visible) return;
    hookFeedback();
    const st = hud.state || {}, info = hud.info || {};

    // modal: any HUD window or touch sheet open → the controls step aside, the close button shows
    let anyWin = false, needDim = false;
    if (hud.windows && hud.windows.reg) for (const k in hud.windows.reg) if (hud.windows.isOpen(k)) { anyWin = true; if (k === 'char') needDim = true; }
    const modal = anyWin || !!ui.page, de = D.documentElement;
    tog(de, 'mh-modal', modal); tog(de, 'mh-dimmed', needDim);
    tog(de, 'mh-dead', !!(st.player && st.player.dead));            // the death screen owns the input: controls step aside
    if (modal && !ui.sheet.hidden) sheet(false);

    // skills (rebuilt when the class / skill list changes)
    const list = hud.skills || [];
    const sig = list.map((s) => s.id).join(',') + '|' + innerWidth + 'x' + innerHeight;
    if (sig !== ui.skillSig) { ui.skillSig = sig; buildSkills(list); layout(); }

    if (st.player) {
      ui.vit.set(st.player, info);
      ui.buffs.set(st.player.buffs || []);
    }
    ui.vit.tick(dt); ui.buffs.tick();
    // effects sit under the target bar; with no target they move up into its place
    tog(ui.buffsEl, 'up', ui.tgEl.hidden);
    ui.tg.set(st.target || null, st.player && st.player.level, ui.tgEl); ui.tg.tick(dt);

    const ss = st.skills || [], deadF = st.player && st.player.dead;
    for (let i = 0; i < ui.skills.length; i++) {
      const S = ui.skills[i], q = ss[i] || {}, cd = q.cd || 0;
      const frac = cd > 0 ? clamp01(cd / Math.max(q.cdTotal || S.def.cd || cd, 0.01)) : 0;
      if (S.cdWas > 0 && cd <= 0) S.ready = 0;                     // cooldown finished: one amber pulse
      S.cdWas = cd;
      S.cd = frac; S.cdText = cd > 0 ? String(Math.ceil(cd)) : '';
      S.alpha = deadF ? 0.35 : (q.usable === false && !(cd > 0) ? 0.45 : 1);
      S.active = !!(q.active || q.casting);
      const k = (cd > 0 ? Math.ceil(cd * 30) : 0) + '|' + S.alpha + '|' + S.active;
      if (k !== S.sig) { S.sig = k; S.dirty = true; }
      S.tick(dt);
    }
    if (ui.fire) ui.fire.tick(dt);

    if (st.exp) ui.xp.set(st.exp);
    ui.xp.tick(dt);
  }
  requestAnimationFrame(frame);
})();
