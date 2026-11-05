/* Mobile / touch layer (loaded last by index.html, active only on touch devices or with ?mobile=1).
 *  - virtual joystick (bottom-left, camera-relative); NO tap-to-move on touch. Holding a finger on the world turns the hero toward it;
 *    the fire button (right) attacks the nearest creature in reach (runs to it), else shoots / swings toward the facing; hold = keep attacking
 *  - camera: fixed far-medium pitch / distance, no zoom, no finger rotation; it follows the hero's heading while the joystick moves him
 *  - HUD scaled to the screen, portrait hint, fullscreen button. The game logic itself is untouched. */
(function () {
  'use strict';
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!(coarse || /[?&]mobile=1/.test(location.search))) return;
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  document.documentElement.classList.add('is-mobile');

  const css = document.createElement('style');
  css.textContent = [
    'html.is-mobile, html.is-mobile body { overscroll-behavior: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: none; }',
    '#m-joy { position: fixed; left: 18px; bottom: 18px; width: 132px; height: 132px; border-radius: 50%; background: rgba(20,24,30,.38); border: 2px solid rgba(220,200,150,.45); z-index: 60; touch-action: none; }',
    '#m-joy i { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: rgba(230,205,140,.55); border: 2px solid rgba(255,235,180,.7); }',
    '#m-fire { position: fixed; right: 26px; bottom: 96px; width: 104px; height: 104px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, rgba(190,60,48,.85), rgba(110,24,20,.85)); border: 3px solid rgba(250,225,160,.75); z-index: 60; touch-action: none; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 14px rgba(0,0,0,.5); }',
    '#m-fire.on { transform: scale(.92); filter: brightness(1.25); }',
    '#m-fs { position: fixed; right: 10px; top: 10px; width: 38px; height: 38px; border-radius: 8px; background: rgba(20,24,30,.55); color: #e8d9a8; border: 1px solid rgba(220,200,150,.5); font: 20px/36px system-ui; text-align: center; z-index: 60; }',
    '#m-rot { position: fixed; inset: 0; background: #11161c; color: #e8d9a8; z-index: 200; display: none; align-items: center; justify-content: center; text-align: center; font: 600 20px/1.5 system-ui; padding: 30px; }',
    '.is-mobile .hud-tip { display: none !important; }',
    '.is-mobile .hud-chat { display: none !important; }',
    '@media (orientation: portrait) { #m-rot { display: flex; } }',
  ].join('\n');
  document.head.appendChild(css);

  const rot = document.createElement('div'); rot.id = 'm-rot'; rot.innerHTML = 'Telefonu yatay çevir<br><small style="font-weight:400;opacity:.8">Oyun yatay ekranda oynanır</small>'; document.body.appendChild(rot);
  const fs = document.createElement('div'); fs.id = 'm-fs'; fs.textContent = '⛶';
  fs.addEventListener('click', () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen().then(() => { try { screen.orientation.lock('landscape'); } catch (_) {} }).catch(() => {}); });
  document.body.appendChild(fs);

  // HUD size: the HUD has its own scale system (--s, minimap canvas etc.): feed it a phone-sized value instead of zooming the page
  let lastK = 0;
  function fit() {
    const k = Math.max(0.6, Math.min(1, innerHeight / 560)), hud = window.__hud;
    if (hud && hud.settings && Math.abs(k - lastK) > 0.01) { lastK = k; hud.settings.scale = k.toFixed(2); if (hud.applyScale) hud.applyScale(); }
    const f = 'scale(' + Math.max(0.8, Math.min(1.1, innerHeight / 560)).toFixed(2) + ')';
    document.getElementById('m-fire').style.transform = f; document.getElementById('m-joy').style.transform = f;
  }

  // ---- virtual joystick -> WASD ----
  const joy = document.createElement('div'); joy.id = 'm-joy'; joy.innerHTML = '<i></i>'; document.body.appendChild(joy);
  const knob = joy.firstChild;
  let joyId = null, basis = null;
  // joystick up = away from the camera; the vector is turned into a world direction using the camera's heading AT TOUCH-DOWN.
  // (A live basis made a feedback loop: stick right -> hero turns -> camera swings behind him -> "right" is a new direction -> the hero
  //  spun on the spot at the camera's turn rate. Latching it for the duration of the touch makes the stick direction stable.)
  function latchBasis() {
    const cam = window.__camera, tg = window.__controls.target;
    let fx = tg.x - cam.position.x, fz = tg.z - cam.position.z; const fl = Math.hypot(fx, fz) || 1;
    basis = { x: fx / fl, z: fz / fl };
  }
  function joyMove(e) {
    const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / R);
    dx = dx / l * k; dy = dy / l * k;
    knob.style.transform = 'translate(' + dx * R * 0.6 + 'px,' + dy * R * 0.6 + 'px)';
    if (k < 0.22 || !window.__mobile) { window.__mobile && (window.__mobile.mv = null); return; }
    if (!basis) latchBasis();
    const fx = basis.x, fz = basis.z, rx = -fz, rz = fx, wx = fx * -dy + rx * dx, wz = fz * -dy + rz * dx, wl = Math.hypot(wx, wz) || 1;
    window.__mobile.mv = { x: wx / wl, z: wz / wl };
  }
  function joyEnd() { joyId = null; basis = null; knob.style.transform = ''; if (window.__mobile) window.__mobile.mv = null; }
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; latchBasis(); joy.setPointerCapture(e.pointerId); joyMove(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  joy.addEventListener('pointerup', (e) => { if (e.pointerId === joyId) joyEnd(); });
  joy.addEventListener('pointercancel', joyEnd);

  // ---- the world: NO tap-to-move on touch. Holding a finger turns the hero toward it; the fire button attacks ----
  const rc = new THREE.Raycaster(), nd = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let worldId = null;
  function aimAt(e) {
    const r = canvas.getBoundingClientRect(); nd.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    rc.setFromCamera(nd, window.__camera); if (rc.ray.intersectPlane(plane, hit) && window.__mobile) window.__mobile.aim(hit.x, hit.z);
  }
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target !== canvas || worldId !== null) return;
    worldId = e.pointerId; e.stopPropagation(); e.preventDefault(); aimAt(e);
  }, true);
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && e.pointerId === worldId) { e.stopPropagation(); aimAt(e); } }, true);
  const end = (e) => { if (e.pointerType === 'touch' && e.pointerId === worldId) { worldId = null; e.stopPropagation(); } };
  window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- fire button (right side): hold = keep attacking ----
  const fire = document.createElement('div'); fire.id = 'm-fire'; fire.innerHTML = '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#fbe9b4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5 20.5 3.5 20.5 9.5 10 20 7 17Z"/><path d="M6 14 10 18"/><path d="M3.5 20.5 7 17"/></svg>'; document.body.appendChild(fire);
  let fireId = null, fireTimer = 0;
  const shoot = () => { if (window.__mobile) window.__mobile.fire(); };
  fire.addEventListener('pointerdown', (e) => { if (fireId !== null) return; fireId = e.pointerId; fire.setPointerCapture(e.pointerId); fire.classList.add('on'); e.preventDefault(); if (window.__mobile) window.__mobile.hold(true); shoot(); fireTimer = setInterval(shoot, 300); });
  const fireEnd = (e) => { if (e.pointerId !== fireId) return; fireId = null; fire.classList.remove('on'); clearInterval(fireTimer); if (window.__mobile) window.__mobile.hold(false); };
  fire.addEventListener('pointerup', fireEnd); fire.addEventListener('pointercancel', fireEnd);

  // camera: fixed far-medium MMO pitch / distance (no zoom, no finger rotation); while the joystick moves the hero the camera
  // eases round behind the direction the hero is facing (slowly; the stick basis is latched per touch)
  const ctl = window.__controls;
  if (ctl) {
    ctl.enableRotate = false; ctl.enableZoom = false; ctl.enablePan = false;
    ctl.touches = { ONE: -1, TWO: -1 };
    ctl.minDistance = ctl.maxDistance = 15.5;
    ctl.minPolarAngle = ctl.maxPolarAngle = 0.92;
    let last = performance.now();
    (function follow(t) {
      requestAnimationFrame(follow);
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const mb = window.__mobile, k = window.__knight, cam = window.__camera;
      if (!mb || !mb.mv || !k || !cam) return;
      const tg = ctl.target, ox = cam.position.x - tg.x, oz = cam.position.z - tg.z;
      const cur = Math.atan2(ox, oz), want = k.root.rotation.y + Math.PI;
      // gentle follow: soft dead zone (~17°) so small heading changes don't swing the view, proportional ease, ≤ 0.9 rad/s
      let d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)); d = Math.sign(d) * Math.max(0, Math.abs(d) - 0.3);
      const a = Math.max(-0.9 * dt, Math.min(0.9 * dt, d * 1.6 * dt));
      const c = Math.cos(a), s = Math.sin(a);
      cam.position.set(tg.x + ox * c + oz * s, cam.position.y, tg.z + oz * c - ox * s);
    })(last);
  }
  addEventListener('resize', fit); addEventListener('orientationchange', fit);
  setInterval(fit, 1500); fit();
})();
