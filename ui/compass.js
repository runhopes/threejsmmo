/* TDS HUD part — top-centre compass ("Ufuk"), ported 1:1 from Atherion compass_view.gd (ust_hud_tasarim.html `compass()`, G.cmp).
 * No box: a 1 px bone line fading toward both ends over a 3 px soft dark halo, ticks under the line every 5° (3 / 6 / 9 px at
 * 5° / 15° / 45°), direction letters over the line at every 45° (K D G B: Cinzel 700 17 bone · KD GD GB KB: Cinzel 600 12 ash),
 * a small bone caret 12 px under the line. Quest marks (map markers of kind 'quest', at most 3) ride the line as pulsing amber
 * diamonds pinned to the ends when outside the arc — the only marks Atherion's compass shows (no target / move-order marks).
 * Heading = camera forward on the ground (mapState.view): world −Z = north (0°), +X = east (90°).
 * The night warning under the line is omitted: this game has no day / night cycle.
 * Strip 700 × 96 at the top centre; its bottom (96) stays above the target card (102).
 * API: { set(mapState), frame(dt), resize(s) }.
 */
(function (global) {
  'use strict';
  const P = global.HUDPaint, C = P.C, F = P.F;

  const STRIP_W = 700, STRIP_H = 96, LINE_Y = 40, HALF_W = 320, PX_PER_DEG = 4, VISIBLE_DEG = HALF_W * 2 / PX_PER_DEG;
  const FADE_IN = 0.68, TICK_MINOR = 3, TICK_MID = 6, TICK_MAIN = 9, LABEL_BASE = LINE_Y - 9;
  const CARET_TOP = 12, CARET_BOT = 18, CARET_HALF = 5;
  const QM_R = 5, QM_EDGE_ALPHA = 0.55, QM_PULSE_HZ = 1.1, QM_AMP_PRIMARY = [0.55, 1.0], QM_AMP_SECONDARY = [0.62, 0.90], QM_MAX = 3;
  const HEADING_EPSILON = 0.05;
  const F_MAIN = F.cinzel(700, 17), F_INTER = F.cinzel(600, 12);
  const CARDINALS = { 0: 'K', 45: 'KD', 90: 'D', 135: 'GD', 180: 'G', 225: 'GB', 270: 'B', 315: 'KB' };
  const COL_MARK_EDGE = [28, 18, 8];

  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const wrap180 = (d) => { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };   // (-180, 180]
  const contentFade = (rel) => 1 - smooth(VISIBLE_DEG * 0.5 * FADE_IN, VISIBLE_DEG * 0.5, Math.abs(rel));
  const markX = (rel, cx) => cx + Math.max(-VISIBLE_DEG * 0.5, Math.min(VISIBLE_DEG * 0.5, rel)) * PX_PER_DEG;
  const markAlpha = (rel) => Math.max(QM_EDGE_ALPHA, contentFade(rel));
  const pulseAlpha = (t, band) => band[0] + (band[1] - band[0]) * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * QM_PULSE_HZ));
  // line_stops(): (position 0..1, multiplier)
  const STOPS = [[0, 0], [0.12, 0.55], [0.5 - FADE_IN * 0.5, 1], [0.5, 1], [0.5 + FADE_IN * 0.5, 1], [0.88, 0.55], [1, 0]];

  function CompassPart(hud) {
    const root = document.createElement('div');
    root.className = 'ath-cmp';
    root.style.cssText = 'position:absolute;left:50%;top:0;transform:translateX(-50%);pointer-events:none';
    hud.frame.appendChild(root);
    const surf = P.surface(root, 'ath-cmp-cv', STRIP_W, STRIP_H, 0, 0);
    surf.el.style.cssText = 'display:block;pointer-events:none';

    let heading = 0, last = -1000, dirty = true, marks = [], pulse = 0, here = { x: 0, z: 0 };
    P.onFonts(() => { dirty = true; });

    function lineGrad(g, a) {
      const x0 = STRIP_W * 0.5 - HALF_W, gr = g.createLinearGradient(x0, 0, x0 + HALF_W * 2, 0);
      for (const [o, k] of STOPS) gr.addColorStop(o, a(k));
      return gr;
    }
    function diamond(g, x, y, r, col, a) {
      const path = (rr) => { g.beginPath(); g.moveTo(x, y - rr); g.lineTo(x + rr, y); g.lineTo(x, y + rr); g.lineTo(x - rr, y); g.closePath(); };
      path(r + 2); g.fillStyle = 'rgba(0,0,0,' + (0.30 * a).toFixed(3) + ')'; g.fill();
      path(r); g.fillStyle = P.rgba(col, a); g.fill();
      g.lineWidth = 1.2; g.lineJoin = 'miter'; g.strokeStyle = 'rgba(' + COL_MARK_EDGE.join(',') + ',' + (0.9 * a).toFixed(3) + ')'; g.stroke();
    }

    function draw() {
      const g = surf.begin(), cx = STRIP_W * 0.5, x0 = cx - HALF_W;
      // base line: halo, then bone (per-vertex gradient in Godot = linear gradient here)
      g.fillStyle = lineGrad(g, (k) => 'rgba(0,0,0,' + (0.30 * k).toFixed(3) + ')'); g.fillRect(x0, LINE_Y - 1, HALF_W * 2, 3);
      g.fillStyle = lineGrad(g, (k) => P.rgba(C.U_BONE, 0.62 * k)); g.fillRect(x0, LINE_Y, HALF_W * 2, 1);
      // ticks + direction letters
      const span = VISIBLE_DEG * 0.5;
      for (let b = Math.ceil((heading - span) / 5) * 5; b <= heading + span; b += 5) {
        const d = b - heading, x = Math.round(cx + d * PX_PER_DEG), a = contentFade(d), bb = ((b % 360) + 360) % 360;
        const main = bb % 45 === 0, mid = bb % 15 === 0;
        const len = main ? TICK_MAIN : mid ? TICK_MID : TICK_MINOR, ta = a * (main ? 0.95 : mid ? 0.7 : 0.45);
        if (ta <= 0.003) continue;
        g.fillStyle = 'rgba(0,0,0,' + (0.32 * ta).toFixed(4) + ')'; g.fillRect(x - 1, LINE_Y, 3, len + 2);
        g.fillStyle = P.rgba(C.U_BONE, ta); g.fillRect(x, LINE_Y + 1, 1, len);
        if (main && CARDINALS[bb]) {
          const card = bb % 90 === 0;
          P.ufuk(g, CARDINALS[bb], card ? F_MAIN : F_INTER, x + 0.5, LABEL_BASE, P.rgba(card ? C.U_BONE : C.U_ASH, a), 0, 1, card ? 1 : 0);
        }
      }
      // centre caret under the line, two soft shadow passes
      const tri = (k) => { g.beginPath(); g.moveTo(cx, LINE_Y + CARET_TOP - k); g.lineTo(cx + CARET_HALF + k, LINE_Y + CARET_BOT + k); g.lineTo(cx - CARET_HALF - k, LINE_Y + CARET_BOT + k); g.closePath(); };
      g.fillStyle = 'rgba(0,0,0,.22)';
      tri(2); g.fill(); tri(1); g.fill();
      tri(0); g.fillStyle = C.U_BONE; g.fill();
      // quest marks
      let first = true;
      for (const m of marks) {
        const dx = m.x - here.x, dz = m.z - here.z;
        const bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360, rel = wrap180(bearing - heading);
        const a = markAlpha(rel) * pulseAlpha(pulse, first ? QM_AMP_PRIMARY : QM_AMP_SECONDARY);
        diamond(g, markX(rel, cx), LINE_Y + 0.5, QM_R, C.U_AMBER, a);
        first = false;
      }
    }

    const api = {
      set(S) {
        if (!S) return;
        const v = S.view;
        if (v && (v.x * v.x + v.z * v.z) > 1e-8) heading = ((Math.atan2(v.x, -v.z) * 180 / Math.PI) % 360 + 360) % 360;
        if (S.player) { here.x = S.player.x; here.z = S.player.z; }
        const q = [];
        for (const m of S.markers || []) if (m.kind === 'quest' && q.length < QM_MAX) q.push(m);
        if (q.length !== marks.length) dirty = true;
        if (!q.length) pulse = 0;
        marks = q;
      },
      frame(dt) {
        if (marks.length) { pulse += dt || 0; last = heading; dirty = false; draw(); return; }
        if (!dirty && Math.abs(heading - last) < HEADING_EPSILON) return;
        last = heading; dirty = false; draw();
      },
      resize(s) { surf.resize(s); dirty = true; },
    };
    surf.resize(hud.s || 1);
    return api;
  }

  global.HUDParts = global.HUDParts || {};
  global.HUDParts.compass = CompassPart;
})(window);
