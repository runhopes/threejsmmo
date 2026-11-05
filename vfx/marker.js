/* TDS - ground move marker (right click on the ground), MMORPG style, procedural (canvas textures, no assets).
 *   click   : an amber ring snaps in from wide to its size while four chevrons slide inward and a soft glow flashes
 *   moving  : the ring turns slowly and breathes, chevrons bob, a small centre dot marks the exact point
 *   arrived : everything fades out (~0.35 s)
 * Palette = the Atherion HUD (amber #E2C78F / lit #F4E3BC, ink outline) so it reads on grass, dirt and stone alike.
 *   const mm = MoveMarker.create(THREE, scene); mm.show(x, z); mm.update(dt, moving); mm.group (Object3D)
 */
(function (global) {
  'use strict';
  function tex(T, size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.translate(size / 2, size / 2);
    draw(g, size / 2);
    const t = new T.CanvasTexture(c); t.anisotropy = 4;
    return t;
  }
  // ring: soft dark halo under an amber band with a lit inner edge, + 8 small notches
  function ringTex(T) {
    return tex(T, 256, (g, R) => {
      const r = R * 0.78;
      g.lineWidth = R * 0.16; g.strokeStyle = 'rgba(0,0,0,.30)'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = R * 0.075; g.strokeStyle = '#E2C78F'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = R * 0.022; g.strokeStyle = '#FFF4DA'; g.beginPath(); g.arc(0, 0, r - R * 0.025, 0, Math.PI * 2); g.stroke();
      g.lineWidth = R * 0.03; g.strokeStyle = 'rgba(19,11,4,.85)';
      for (let k = 0; k < 8; k++) {                              // notches across the band
        const a = k * Math.PI / 4 + Math.PI / 8;
        g.beginPath(); g.moveTo(Math.cos(a) * (r - R * 0.05), Math.sin(a) * (r - R * 0.05)); g.lineTo(Math.cos(a) * (r + R * 0.05), Math.sin(a) * (r + R * 0.05)); g.stroke();
      }
    });
  }
  // four chevrons pointing at the centre, amber with an ink outline
  function chevTex(T) {
    return tex(T, 256, (g, R) => {
      for (let k = 0; k < 4; k++) {
        g.save(); g.rotate(k * Math.PI / 2);
        g.beginPath();
        g.moveTo(0, -R * 0.52); g.lineTo(R * 0.17, -R * 0.8); g.lineTo(R * 0.07, -R * 0.8); g.lineTo(0, -R * 0.66); g.lineTo(-R * 0.07, -R * 0.8); g.lineTo(-R * 0.17, -R * 0.8); g.closePath();
        g.lineJoin = 'round'; g.lineWidth = R * 0.05; g.strokeStyle = 'rgba(19,11,4,.8)'; g.stroke();
        const gr = g.createLinearGradient(0, -R * 0.8, 0, -R * 0.52); gr.addColorStop(0, '#9C7A40'); gr.addColorStop(1, '#F4E3BC');
        g.fillStyle = gr; g.fill();
        g.restore();
      }
    });
  }
  function glowTex(T) {
    return tex(T, 128, (g, R) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
      gr.addColorStop(0, 'rgba(255,236,190,.9)'); gr.addColorStop(0.18, 'rgba(244,214,150,.55)'); gr.addColorStop(0.55, 'rgba(226,170,90,.14)'); gr.addColorStop(1, 'rgba(226,170,90,0)');
      g.fillStyle = gr; g.fillRect(-R, -R, R * 2, R * 2);
    });
  }
  function create(T, scene) {
    const group = new T.Group(); group.visible = false;
    const plane = (size, map, additive, order) => {
      const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0,
        blending: additive ? T.AdditiveBlending : T.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = order; group.add(m);
      if (global.VfxConform) global.VfxConform.attach(m, { lift: 0.035, seg: 6 });   // [conform] lies on slopes (vfx/conform.js)
      return m;
    };
    const glow = plane(1.5, glowTex(T), true, 3), ring = plane(1.1, ringTex(T), false, 4), chev = plane(1.25, chevTex(T), false, 5), dot = plane(0.16, glowTex(T), true, 6);
    scene.add(group);
    let t = 9, fade = 0, moving = false;
    const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    return {
      group,
      show(x, z) { group.position.set(x, 0.035, z); group.visible = true; t = 0; fade = 1; moving = true; },
      update(dt, isMoving) {
        if (!group.visible) return;
        t += dt;
        if (isMoving) moving = true; else if (moving) moving = false;
        fade = moving ? Math.min(1, fade + dt * 6) : Math.max(0, fade - dt / 0.35);
        if (fade <= 0 && !moving) { group.visible = false; return; }
        const a = easeOut(t / 0.22);                             // click snap
        const breathe = 1 + 0.045 * Math.sin(t * 5.2);
        ring.scale.setScalar((1.55 - 0.55 * a) * (t > 0.22 ? breathe : 1));
        ring.rotation.z = -t * 0.6;
        ring.material.opacity = fade * (0.35 + 0.65 * a);
        const slide = 1.45 - 0.45 * easeOut(t / 0.3), bob = t > 0.3 ? 0.06 * (0.5 + 0.5 * Math.sin(t * 6.5)) : 0;
        chev.scale.setScalar(slide - bob);
        chev.rotation.z = Math.PI / 4 - t * 0.6;
        chev.material.opacity = fade * Math.min(1, t / 0.08) * (t > 0.3 ? 0.85 : 1);
        const flash = Math.max(0, 1 - t / 0.35);
        glow.scale.setScalar(0.6 + 0.6 * a);
        glow.material.opacity = fade * (0.18 + 0.7 * flash);
        dot.material.opacity = fade * (0.55 + 0.25 * Math.sin(t * 6));
      },
    };
  }
  global.MoveMarker = { create };
})(window);
