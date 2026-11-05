/* TDS - game cursors, drawn procedurally (no image assets) in the Atherion HUD palette:
 *   --cur-default : bronze arrow pointer (world + UI)
 *   --cur-attack  : sword pointing up-left (hover over a creature / dummy / training target = right click attacks it)
 * Both are 32 x 32 data URLs with their hotspot at the tip; CSS uses them as var(--cur-default, default) etc.
 */
(function (global) {
  'use strict';
  const SZ = 32;
  const OUT = '#130B04';                                      // ink outline (HUD nail dark)
  function make(draw) {
    const c = document.createElement('canvas'); c.width = c.height = SZ;
    const g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    draw(g);
    return c.toDataURL('image/png');
  }
  const poly = (g, pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };

  // arrow: classic MMO pointer, bronze ramp face, light bevel on the left edge, ink outline + soft drop shadow
  const ARROW = [[1.5, 1.5], [1.5, 22], [7, 17], [11, 26.5], [15, 24.8], [11, 15.6], [18.5, 15.6]];
  const arrow = make((g) => {
    g.save(); g.translate(1.5, 1.5); poly(g, ARROW); g.fillStyle = 'rgba(0,0,0,.38)'; g.fill(); g.restore();   // shadow
    poly(g, ARROW);
    const gr = g.createLinearGradient(0, 0, 14, 24);
    gr.addColorStop(0, '#F4E3BC'); gr.addColorStop(0.38, '#E2C78F'); gr.addColorStop(1, '#8C6A3A');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = OUT; g.lineWidth = 1.6; g.stroke();
    g.strokeStyle = 'rgba(255,248,230,.75)'; g.lineWidth = 1; g.beginPath(); g.moveTo(3, 5); g.lineTo(3, 18.5); g.stroke();   // bevel
  });

  // sword: blade from the tip (top-left) down to a gold guard, leather grip and pommel at the bottom-right
  const sword = make((g) => {
    g.save();
    g.translate(3.5, 3.5); g.rotate(-Math.PI / 4);                  // local +Y runs from the tip (origin, top-left) down-right along the blade
    const blade = [[0, 0], [2.6, 3.6], [2.6, 19], [-2.6, 19], [-2.6, 3.6]];
    // shadow
    g.save(); g.translate(1.4, 0.6); poly(g, blade); g.fillStyle = 'rgba(0,0,0,.35)'; g.fill(); g.restore();
    poly(g, blade);
    const bg = g.createLinearGradient(-2.6, 0, 2.6, 0);
    bg.addColorStop(0, '#F2F5F8'); bg.addColorStop(0.5, '#C9D2DC'); bg.addColorStop(0.51, '#8E9BA9'); bg.addColorStop(1, '#B9C4CF');
    g.fillStyle = bg; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.3; g.stroke();
    g.strokeStyle = 'rgba(80,92,104,.8)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 4); g.lineTo(0, 18); g.stroke();   // fuller
    // cross guard
    poly(g, [[-6.4, 19], [6.4, 19], [6.4, 21.6], [-6.4, 21.6]]);
    const gg = g.createLinearGradient(0, 19, 0, 21.6); gg.addColorStop(0, '#F4E3BC'); gg.addColorStop(1, '#9C7A40');
    g.fillStyle = gg; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.2; g.stroke();
    // grip
    poly(g, [[-1.5, 21.6], [1.5, 21.6], [1.5, 26.6], [-1.5, 26.6]]);
    g.fillStyle = '#5A3A22'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.1; g.stroke();
    g.strokeStyle = 'rgba(226,199,143,.55)'; g.lineWidth = 0.7;
    for (const y of [23, 24.8]) { g.beginPath(); g.moveTo(-1.4, y); g.lineTo(1.4, y + 0.9); g.stroke(); }
    // pommel
    g.beginPath(); g.arc(0, 28.4, 2, 0, Math.PI * 2);
    g.fillStyle = '#E2C78F'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.1; g.stroke();
    g.restore();
  });

  const root = document.documentElement.style;
  root.setProperty('--cur-default', 'url(' + arrow + ') 2 2, default');
  root.setProperty('--cur-attack', 'url(' + sword + ') 3 3, pointer');
  global.GameCursors = { arrow, sword };
})(window);
