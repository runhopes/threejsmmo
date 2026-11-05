/* TDS HUD — death screen, ported 1:1 from Atherion death_overlay.gd (v3 "Sönen Renk", ADR-0160; olum_ekrani_tasarim_v3.html,
 * olum_ekrani_v3_kaynak/tezgah.js: G / C / TL are the same numbers):
 *   perde    — everything under it (world + HUD) loses its colour and darkens (death_perde.gdshader: mix(c, luma, .78k) · (1 − .45k)) → a CSS
 *              backdrop-filter saturate() brightness() (same Rec.709 luma); vignette + an elliptical veil band + a narrow core behind the
 *              title are drawn on the canvas with the shader's stops. It takes the pointer while open (no HUD / world clicks while dead).
 *   cluster  — no boxes: "ÖLDÜN" (Cinzel 600 · 84, vertical red ramp, dark halo + one red bloom as real blur — the tezgâh's shadowBlur,
 *              which death_overlay.gd approximates with stacked outlines — tracking .40em → .22em), the cause line,
 *              the fuse rule with its diamond, one choice (tracked caps + oblique sub line + amber groove).
 *   motion   — the shader / tezgâh timeline from the moment of death; on revive the cluster fades in .25 s and colour returns in .60 s.
 * What this game has (real data only): the HUD only knows state.player.dead and the game's single revive is the R key. So: no killer (Atherion's
 * own text for an unknown killer: "Yere düştün."), no death toll row, no Can Fitili row, no town choice, no countdown — the fuse is drawn in its
 * unlocked (burnt-through) state. TWO choices (2026-11-05): "ŞEHİRDE DİRİL" [T] (full health, town) and "BURADA DİRİL" [R] (half health, on
 * the spot); with hud.opts.onRevive(mode) they are clickable / tappable (hover cushion, one-shot, 3 s timeout) exactly like Atherion's.
 * API: window.HUDDeath(hud) → { set(dead), frame(dt), resize(s) }. Design space: height 1080 × hud.s, x from the screen centre, centred vertically.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint;

  const G = {
    DESAT: 0.78, DIM: 0.45,
    VIG_CY: 540, VIG_R0: 380, VIG_R1: 1380, VIG_A: 0.62,
    BAND_CY: 548, BAND_RX: 900, BAND_RY: 310, BAND_STOPS: [[0, 0.86], [0.5, 0.74], [0.8, 0.34], [1, 0]],
    CORE_CY: 452, CORE_RX: 560, CORE_RY: 130, CORE_STOPS: [[0, 0.55], [0.55, 0.35], [1, 0]],
    TITLE_Y: 432, TITLE_PX: 84, TITLE_CAP: 0.70, TITLE_TRACK: 0.22, TITLE_TRACK_IN: 0.40,
    CAUSE_Y: 477, CAUSE_LEAD_PX: 20,
    RULE_Y: 516, RULE_HALF: 300, RULE_GAP: 26, DIAMOND: 17,
    CHOICE_Y: 636, CHOICE_SUB_Y: 661, CHOICE_PX: 16, CHOICE_TRACK: 0.18, SUB_PX: 16,
    GROOVE_Y: 679, GROOVE_W: 150, GROOVE_W_HOVER: 196, CUSHION_RX: 170, CUSHION_RY: 46,
    HIT_HALF_W: 150, HIT_Y0: 598, HIT_Y1: 692, CHOICE_DX: 190,
    ITALIC_SKEW: 0.18,
    KEY_W: 32, KEY_H: 20, KEY_CUT: 4, KEY_TEXT_PAD: 10, KEY_PX: 12, KEY_GAP: 8,   // veil_key_cap.gd
    COUNTDOWN: 0,                                                 // this game revives at once (R): the lock is open from the first frame
  };
  const COL = {
    RED_TOP: '#DC5A44', RED: '#C63F2E', RED_BOT: '#962A1F', BLOOM: '#A82418',
    INK_HI: '#ECE3D4', INK: '#BCB6AA', INK_DIM: '#8D8375', SUB: '#9C9282', LOCK: '#7A7064',
    ASH: '#958365', BONE: '#C4B69A', AMBER: '#E2C78F', AMBER_LIT: '#F4E3BC', HOVER_HI: '#FFF4E4', CUSHION: '#FFECD6',
    VEIL: '#040302', VIGNETTE: '#050403', DIAMOND: '#080605', DIAMOND_READY: '#282014',
  };
  const TL = { PERDE: [0, 1.2], TITLE: [0.45, 1.35], TITLE_TRACK: [0.45, 1.85], CAUSE: [1.1, 1.6], RULE: [1.3, 1.75], CHOICE: [1.7, 2.15],
    FLASH: 0.30, GROOVE_IN: 0.35, CHOICE_HOLD: 0.12, EXIT_CLUSTER: 0.25, EXIT_PERDE: 0.60, HOVER_RATE: 14, REQUEST_TIMEOUT: 3, SETTLED: 2.4 };
  const HAIR_STOPS = [[0, 0], [0.14, 0.26], [0.5, 1], [0.86, 0.26], [1, 0]];
  const EMBER_STOPS = [[0, 0.95], [0.72, 0.45], [1, 0]];
  const ASH_STOPS = [[0, 0.55], [1, 0]];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ramp = (t, r) => clamp((t - r[0]) / (r[1] - r[0]), 0, 1);
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  const A = P.rgba, mix = P.mix;
  function stopsAlpha(stops, u) {
    if (u <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (u <= stops[i][0]) { const a = stops[i - 1], b = stops[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); }
    return stops[stops.length - 1][1];
  }

  global.HUDDeath = function (hud) {
    const root = document.createElement('div'); root.className = 'hd-root'; root.hidden = true;
    const perde = document.createElement('div'); perde.className = 'hd-perde';
    const cv = document.createElement('canvas'); cv.className = 'hd-cv';
    root.append(perde, cv);
    hud.root.appendChild(root);
    const g = cv.getContext('2d');

    let open = false, closing = false, t = 0, closeT = 0, chosen = false, tc = 0, hoverOn = false, hoverK = 0;
    // [two choices] 0 = ŞEHİRDE DİRİL (town, key T), 1 = BURADA DİRİL (here, key R); hoverOn/hoverK above are unused leftovers
    let hoverIdx = -1, chosenIdx = -1; const hk = [0, 0];
    const TOUCH = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
    let s = hud.s || 1, W = 0, H = 0, dpr = 1, dirty = true, filterKey = '';
    P.onFonts(() => { dirty = true; });
    const clickable = () => typeof hud.opts.onRevive === 'function';
    const oy = () => (H - 1080 * s) * 0.5;                        // death_overlay._layout_oy: the 1080-tall design box centred vertically

    function size() {
      W = innerWidth; H = innerHeight; dpr = Math.min(2, global.devicePixelRatio || 1);
      const bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      dirty = true;
    }

    /* ── strengths (death_overlay._perde_strength / _cluster_alpha) ── */
    function perdeK() {
      let k = eo(ramp(t, TL.PERDE));
      if (closing) k *= 1 - eo(clamp(closeT / TL.EXIT_PERDE, 0, 1));
      else if (!open) k = 0;
      return k;
    }
    function clusterA() {
      let ca = 1;
      if (chosen) ca *= 1 - eo(ramp(tc, [TL.CHOICE_HOLD, TL.CHOICE_HOLD + TL.EXIT_CLUSTER]));
      if (closing) ca *= 1 - eo(clamp(closeT / TL.EXIT_CLUSTER, 0, 1));
      else if (!open) ca = 0;
      return ca;
    }

    /* ── drawing helpers (design space) ── */
    function gradBar(xa, xb, y, h, ua, ub, stops, col, amul) {   // _grad_bar: the profile between ua and ub, split at its stops
      if (amul <= 0 || Math.abs(xb - xa) < 0.01 || ub <= ua) return;
      const gr = g.createLinearGradient(xa, 0, xb, 0), us = [ua].concat(stops.map((q) => q[0]).filter((u) => u > ua && u < ub), [ub]);
      for (const u of us) gr.addColorStop((u - ua) / (ub - ua), A(col, amul * stopsAlpha(stops, u)));
      g.fillStyle = gr; g.fillRect(Math.min(xa, xb), y - h * 0.5, Math.abs(xb - xa), h);
    }
    const hair = (cx, y, w, h, col, amul) => gradBar(cx - w * 0.5, cx + w * 0.5, y, h, 0, 1, HAIR_STOPS, col, amul);
    function radial(cx, cy, rx, ry, col, a) {                     // _make_radial texture (1 → .41 @ .6 → 0), stretched to rx × ry
      if (a <= 0.001) return;
      g.save(); g.translate(cx, cy); g.scale(rx / ry, 1);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      gr.addColorStop(0, A(col, a)); gr.addColorStop(0.6, A(col, a * 0.41)); gr.addColorStop(1, A(col, 0));
      g.fillStyle = gr; g.fillRect(-ry, -ry, ry * 2, ry * 2); g.restore();
    }
    function ellipseVeil(cy, rx, ry, stops, k) {
      g.save(); g.translate(0, cy); g.scale(rx / ry, 1);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      for (const q of stops) gr.addColorStop(q[0], A(COL.VEIL, q[1] * k));
      g.fillStyle = gr; g.fillRect(-ry, -ry, ry * 2, ry * 2); g.restore();
    }
    function tracked(text, font, sp) { P.setFont(g, font, sp); return g.measureText(text).width - sp; }   // Σ glyphs + sp·(n−1)
    function oblique(text, font, x, base, col) {                  // _draw_oblique: shear about the baseline, x' = x + k·(base − y)
      g.save(); g.transform(1, 0, -G.ITALIC_SKEW, 1, G.ITALIC_SKEW * base, 0);
      P.setFont(g, font); g.fillStyle = col; g.fillText(text, x, base); g.restore();
    }
    function diamondPath(cx, cy, d) { g.beginPath(); g.moveTo(cx, cy - d); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d); g.lineTo(cx - d, cy); g.closePath(); }

    /* ── layers ── */
    function drawVeil(k) {
      const x0 = -W * 0.5 / s, x1 = W * 0.5 / s, y0 = -oy() / s, y1 = (H - oy()) / s;
      const vg = g.createRadialGradient(0, G.VIG_CY, G.VIG_R0, 0, G.VIG_CY, G.VIG_R1);
      vg.addColorStop(0, A(COL.VIGNETTE, 0)); vg.addColorStop(1, A(COL.VIGNETTE, G.VIG_A * k));
      g.fillStyle = vg; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      ellipseVeil(G.BAND_CY, G.BAND_RX, G.BAND_RY, G.BAND_STOPS, k);
      ellipseVeil(G.CORE_CY, G.CORE_RX, G.CORE_RY, G.CORE_STOPS, k);
    }
    function drawTitle(ca) {
      const a = eo(ramp(t, TL.TITLE)) * ca;
      if (a <= 0) return;
      const trk = G.TITLE_TRACK_IN + (G.TITLE_TRACK - G.TITLE_TRACK_IN) * eo(ramp(t, TL.TITLE_TRACK)), sp = trk * G.TITLE_PX;
      const font = P.F.cinzel(600, G.TITLE_PX), text = 'ÖLDÜN';
      g.save();
      const w = tracked(text, font, sp), x = -w * 0.5, y = G.TITLE_Y;
      const gr = g.createLinearGradient(0, y - G.TITLE_PX * G.TITLE_CAP, 0, y);   // death_title.gdshader ramp: cap top → baseline
      gr.addColorStop(0, COL.RED_TOP); gr.addColorStop(0.55, COL.RED); gr.addColorStop(1, COL.RED_BOT);
      g.globalAlpha = a; g.fillStyle = gr;
      // Godot approximates the tezgâh's blurred halo with stacked outlines (TITLE_HALO / TITLE_BLOOM); canvas has the real blur:
      // (a) dark halo shadowBlur 26 · α .9 — lifts the word off any ground, (b) one red bloom shadowBlur 34 · α .30 — the screen's only red light
      const px = s * dpr;
      g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 26 * px; g.fillText(text, x, y);
      g.shadowColor = A(COL.BLOOM, 0.30); g.shadowBlur = 34 * px; g.fillText(text, x, y);
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.fillText(text, x, y);
      g.restore();
    }
    function drawCause(ca) {
      const a = eo(ramp(t, TL.CAUSE)) * ca;
      if (a <= 0) return;
      const font = P.F.serif(400, G.CAUSE_LEAD_PX), text = 'Yere düştün.', w = P.width(g, text, font);
      oblique(text, font, -w * 0.5, G.CAUSE_Y, A(COL.INK_DIM, a));
    }
    function drawRule(ca) {
      const dr = eo(ramp(t, TL.RULE)), a = dr * ca;
      if (a <= 0) return;
      const span = G.RULE_HALF - G.RULE_GAP, drawn = span * dr, ready = t >= G.COUNTDOWN;
      const p = G.COUNTDOWN > 0 ? clamp(t / G.COUNTDOWN, 0, 1) : 1;
      const flash = ready ? 1 - ramp(t, [G.COUNTDOWN, G.COUNTDOWN + TL.FLASH]) : 0;
      const uDrawn = drawn / span, burnt = Math.min(span * p, drawn), uBurnt = burnt / span, y = G.RULE_Y;
      for (const side of [-1, 1]) {
        const x0 = side * G.RULE_GAP;
        gradBar(x0, x0 + side * drawn, y, 1, 0, uDrawn, ASH_STOPS, COL.ASH, a);            // the dead line
        if (burnt > 0.5) {
          const xb = x0 + side * burnt, glow = 1 + flash * 1.4;
          gradBar(x0, xb, y, 10, 0, uBurnt, EMBER_STOPS, COL.AMBER, a * 0.07 * glow);
          gradBar(x0, xb, y, 5, 0, uBurnt, EMBER_STOPS, COL.AMBER, a * 0.16 * glow);
          gradBar(x0, xb, y, 2, 0, uBurnt, EMBER_STOPS, COL.AMBER, a);
          if (!ready && burnt < drawn) { radial(xb, y, 8, 8, COL.AMBER_LIT, 0.95 * a); g.beginPath(); g.arc(xb, y, 1.6, 0, Math.PI * 2); g.fillStyle = A(COL.AMBER_LIT, a); g.fill(); }
        }
      }
      const d = G.DIAMOND * (1 + 0.16 * flash);
      if (ready) { const gr = d + 10 + 14 * flash; radial(0, y, gr, gr, COL.AMBER, (0.16 + 0.45 * flash) * a); }
      diamondPath(0, y, d); g.fillStyle = A(ready ? COL.DIAMOND_READY : COL.DIAMOND, 0.92 * a); g.fill();
      g.lineWidth = 1.2; g.strokeStyle = ready ? A(COL.AMBER, a) : A(COL.ASH, 0.8 * a); g.stroke();
      if (ready) { diamondPath(0, y, 4.5); g.fillStyle = A(COL.AMBER_LIT, a); g.fill(); }
      else {
        const digit = String(Math.ceil(G.COUNTDOWN - t - 1e-6)), f = P.F.cinzel(600, 14);
        P.setFont(g, f); const dw = g.measureText(digit).width; g.fillStyle = A(COL.INK_HI, a); g.fillText(digit, -dw * 0.5, y + 5);
      }
    }
    function keyCap(x, cy, text, a) {                              // veil_key_cap.gd: well .46, dark top lip .85, light bottom lip .18, bone text
      const f = P.F.cinzel(600, G.KEY_PX), w = Math.max(G.KEY_W, P.width(g, text, f) + G.KEY_TEXT_PAD), h = G.KEY_H, y = cy - h * 0.5, c = G.KEY_CUT;
      P.octPath(g, x, y, w, h, c); g.fillStyle = 'rgba(0,0,0,' + (0.46 * a).toFixed(4) + ')'; g.fill();
      g.fillStyle = 'rgba(0,0,0,' + (0.85 * a).toFixed(4) + ')'; g.fillRect(x + c, y, w - c * 2, 1);
      g.fillStyle = A(P.C.ASH_HI, 0.18 * a); g.fillRect(x + c, y + h - 1, w - c * 2, 1);
      const m = P.metrics(g, f);
      P.setFont(g, f); g.fillStyle = A(COL.BONE, a); g.fillText(text, x + (w - g.measureText(text).width) * 0.5, y + (h + m.a - m.d) * 0.5);
      return w;
    }
    // two choices side by side (Metin2-style "Şehirde / Burada yeniden başla"); each: tracked caps + oblique sub line + key cap + groove
    const CHOICES = [
      { label: 'ŞEHİRDE DİRİL', sub: 'Tam canla · kasabada', key: 'T', cx: -G.CHOICE_DX },
      { label: 'BURADA DİRİL', sub: 'Yarı canla · olduğun yerde', key: 'R', cx: G.CHOICE_DX },
    ];
    function drawChoice(ca) {
      const a = eo(ramp(t, TL.CHOICE)) * ca;
      if (a <= 0) return;
      const rk = eo(ramp(t, [G.COUNTDOWN, G.COUNTDOWN + TL.GROOVE_IN]));
      CHOICES.forEach((c, i) => {
        const h = t >= G.COUNTDOWN ? hk[i] : 0;
        const lit = chosen && chosenIdx === i ? 1 - ramp(tc, [0, TL.CHOICE_HOLD + TL.EXIT_CLUSTER]) : 0;
        g.save(); g.translate(c.cx, 0);
        radial(0, G.CHOICE_Y - 6, G.CUSHION_RX, G.CUSHION_RY, COL.CUSHION, 0.085 * h * a);   // cursor light cushion
        let lc = mix(COL.LOCK, COL.INK_HI, rk);
        if (h > 0) lc = mix(COL.INK_HI, COL.HOVER_HI, h);
        if (lit > 0) lc = mix(COL.HOVER_HI, COL.AMBER, lit);
        const lf = P.F.cinzel(600, G.CHOICE_PX), sp = G.CHOICE_TRACK * G.CHOICE_PX;
        g.save(); const lw = tracked(c.label, lf, sp); g.fillStyle = A(lc, a); g.fillText(c.label, -lw * 0.5, G.CHOICE_Y); g.restore();
        // sub line (oblique) + the key cap (keyboards only; on touch the whole choice is the button)
        const sf = P.F.serif(400, G.SUB_PX), sw = P.width(g, c.sub, sf), sa = a * (0.8 + 0.2 * rk);
        const kw = TOUCH ? 0 : Math.max(G.KEY_W, P.width(g, c.key, P.F.cinzel(600, G.KEY_PX)) + G.KEY_TEXT_PAD), total = sw + (TOUCH ? 0 : G.KEY_GAP + kw), x0 = -total * 0.5;
        oblique(c.sub, sf, x0, G.CHOICE_SUB_Y, A(mix(COL.LOCK, COL.SUB, rk), sa));
        if (!TOUCH) keyCap(x0 + sw + G.KEY_GAP, G.CHOICE_SUB_Y - 5, c.key, sa);
        // groove: dead ash while locked, the amber identity once open
        const gw = G.GROOVE_W + (G.GROOVE_W_HOVER - G.GROOVE_W) * Math.max(h, lit);
        hair(0, G.GROOVE_Y, gw, 2, COL.ASH, 0.30 * (1 - rk) * a);
        if (rk > 0) {
          const ga = Math.min(1, rk * a * (i === 1 ? 0.85 : 0.7) * (0.85 + 0.15 * h) + lit);
          hair(0, G.GROOVE_Y, gw, 12, COL.AMBER, ga * 0.07);
          hair(0, G.GROOVE_Y, gw, 6, COL.AMBER, ga * 0.18);
          hair(0, G.GROOVE_Y, gw, 2, COL.AMBER, ga);
        }
        g.restore();
      });
    }
    function draw() {
      dirty = false;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      const k = perdeK(), ca = clusterA();
      const fk = k > 0.001 ? 'saturate(' + (1 - G.DESAT * k).toFixed(3) + ') brightness(' + (1 - G.DIM * k).toFixed(3) + ')' : 'none';
      if (fk !== filterKey) { filterKey = fk; perde.style.backdropFilter = fk; perde.style.webkitBackdropFilter = fk; }
      const m = dpr * s;
      g.setTransform(m, 0, 0, m, W * 0.5 * dpr, oy() * dpr);
      if (k > 0.001) drawVeil(k);
      if (ca <= 0.001) return;
      drawTitle(ca); drawCause(ca); drawRule(ca); drawChoice(ca);
    }

    /* ── input (only when the game provides hud.opts.onRevive(mode), mode = 'town' | 'here') ── */
    function zoneAt(e) {
      if (!open || chosen || !clickable() || t < G.COUNTDOWN || ramp(t, TL.CHOICE) < 0.5) return -1;
      const x = (e.clientX - W * 0.5) / s, y = (e.clientY - oy()) / s;
      if (y < G.HIT_Y0 || y > G.HIT_Y1) return -1;
      for (let i = 0; i < CHOICES.length; i++) if (Math.abs(x - CHOICES[i].cx) <= G.HIT_HALF_W) return i;
      return -1;
    }
    function choose(i) {
      if (chosen || i < 0) return;
      chosen = true; chosenIdx = i; tc = 0; hoverIdx = -1; root.style.cursor = ''; dirty = true;   // one shot: the request is on its way
      hud.opts.onRevive(i === 0 ? 'town' : 'here');
    }
    root.addEventListener('mousedown', (e) => e.preventDefault());
    root.addEventListener('pointermove', (e) => { const on = zoneAt(e); if (on !== hoverIdx) { hoverIdx = on; root.style.cursor = on >= 0 ? 'pointer' : ''; } });
    root.addEventListener('pointerleave', () => { hoverIdx = -1; root.style.cursor = ''; });
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      choose(zoneAt(e));
    });
    // keyboard: T = town, R = here (capture: before the game's own R handler)
    addEventListener('keydown', (e) => {
      if (!open || chosen || !clickable() || e.repeat) return;
      const k = (e.key || '').toLowerCase();
      if (k === 't' || k === 'r') { e.stopImmediatePropagation(); e.preventDefault(); choose(k === 't' ? 0 : 1); }
    }, true);
    root.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });

    cv.width = cv.height = 1;
    return {
      set(dead) {
        dead = !!dead;
        if (dead && !open) {
          open = true; closing = false; t = 0; closeT = 0; chosen = false; tc = 0; hoverOn = false; hoverK = 0; hoverIdx = -1; chosenIdx = -1; hk[0] = hk[1] = 0;
          root.hidden = false; root.style.pointerEvents = 'auto'; size();
        } else if (!dead && open) {                               // hide_death: input released at once, the exit plays without taking clicks
          open = false; closing = true; closeT = 0; hoverOn = false; hoverIdx = -1;
          root.style.pointerEvents = 'none'; root.style.cursor = ''; dirty = true;
        }
      },
      frame(dt) {
        if (root.hidden) return;
        let anim = false;
        if (open) {
          t += dt; if (t < TL.SETTLED) anim = true;
          if (chosen) { tc += dt; anim = true; if (tc >= TL.REQUEST_TIMEOUT) { chosen = false; tc = 0; } }
        }
        if (closing) {
          closeT += dt; anim = true;
          if (closeT >= TL.EXIT_PERDE) {
            closing = false; root.hidden = true; filterKey = 'none'; perde.style.backdropFilter = 'none'; perde.style.webkitBackdropFilter = 'none';
            cv.width = cv.height = 1;                               // no full-screen backing store while alive
            return;
          }
        }
        for (let i = 0; i < 2; i++) { const target = hoverIdx === i ? 1 : 0; if (Math.abs(hk[i] - target) > 0.002) { hk[i] += (target - hk[i]) * Math.min(1, dt * TL.HOVER_RATE); anim = true; } else if (hk[i] !== target) { hk[i] = target; anim = true; } }
        if (anim || dirty) draw();
      },
      resize(ns) { s = ns || hud.s || 1; if (!root.hidden) size(); },
    };
  };
})(window);
