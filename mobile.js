/* Mobile / touch layer (loaded last by index.html, active only on touch devices or with ?mobile=1).
 *  - virtual joystick (bottom-left, camera-relative); NO tap-to-move on touch. Holding a finger on the world turns the hero toward it;
 *    the fire button (right) attacks the nearest creature in reach (runs to it), else shoots / swings toward the facing; hold = keep attacking
 *  - camera: MOBA style — fixed distance; a swipe on the world tilts / turns it (kept per device); it rides the hero
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
    '@media (orientation: portrait) { #m-rot { display: flex; } }',
    /* notch / dynamic island / home indicator: keep the HUD and the touch controls inside the safe area (canvas stays full-bleed) */
    /* (#hud-root stays full-screen: name plates / combat numbers are drawn in screen coordinates on its canvases — insetting the root
       shifted them off their heads. Each HUD piece applies the safe area itself, see ui/mobilehud.css) */
    'html.is-mobile #m-joy { left: calc(18px + env(safe-area-inset-left)); bottom: calc(18px + env(safe-area-inset-bottom)); }',
    'html.is-mobile #m-fire { right: calc(26px + env(safe-area-inset-right)); }',
    'html.is-mobile #m-fs { right: calc(10px + env(safe-area-inset-right)); }',
    'html.is-mobile #at-screen { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }',
    /* native app (Capacitor): orientation is locked to landscape by the app itself, no browser fullscreen API */
    'html.is-native #m-fs, html.is-native #m-rot { display: none !important; }',
    /* login / character screens: no joystick or fire button on top of the forms */
    'body:has(#at-screen:not([hidden])) #m-joy, body:has(#at-screen:not([hidden])) #m-fire { display: none !important; }',
  ].join('\n');
  document.head.appendChild(css);

  // native app: hide the status bar (iOS + Android), keep the hero facing the screen
  const NATIVE = !!(window.AtherionConfig && window.AtherionConfig.NATIVE), P = window.Capacitor && window.Capacitor.Plugins;
  if (NATIVE && P) {
    try { P.StatusBar && P.StatusBar.hide(); } catch (_) {}
    try { P.ScreenOrientation && P.ScreenOrientation.lock({ orientation: 'landscape' }); } catch (_) {}
  }

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
  let joyId = null, stick = null;
  // joystick up = away from the camera. The stick vector is turned into a world direction EVERY FRAME from the camera's current
  // heading (see the follow loop below), so turning the view with a swipe while walking turns the walk with it. (The camera never
  // swings round by itself any more, so the old feedback loop — stick right -> hero turns -> camera follows -> hero spins — is gone.)
  function stickDir() {
    if (!stick || !window.__mobile) return;
    const cam = window.__camera, tg = window.__controls.target;
    let fx = tg.x - cam.position.x, fz = tg.z - cam.position.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx, wx = fx * -stick.dy + rx * stick.dx, wz = fz * -stick.dy + rz * stick.dx, wl = Math.hypot(wx, wz) || 1;
    window.__mobile.mv = { x: wx / wl, z: wz / wl };
  }
  function joyMove(e) {
    const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / R);
    dx = dx / l * k; dy = dy / l * k;
    knob.style.transform = 'translate(' + dx * R * 0.6 + 'px,' + dy * R * 0.6 + 'px)';
    if (k < 0.22 || !window.__mobile) { stick = null; window.__mobile && (window.__mobile.mv = null); return; }
    stick = { dx, dy }; stickDir();
  }
  function joyEnd() { joyId = null; stick = null; knob.style.transform = ''; if (window.__mobile) window.__mobile.mv = null; }
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  joy.addEventListener('pointerup', (e) => { if (e.pointerId === joyId) joyEnd(); });
  joy.addEventListener('pointercancel', joyEnd);

  // ---- camera settings (MOBA view): polar = angle from straight down; 0.90 rad ≈ 38° above the ground. Kept per device. ----
  // az = camera heading around the hero (0 = camera on the +z side looking toward -z; a horizontal swipe turns it)
  const CAM = { dist: 19.5, polar: 0.90, az: 0, ahead: 1.6, lookY: 1.2, MIN: 0.50, MAX: 1.20 };
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  try {
    const sv = JSON.parse(localStorage.getItem('tds.mobile.cam') || 'null');
    if (sv && isFinite(sv.polar)) CAM.polar = Math.max(CAM.MIN, Math.min(CAM.MAX, sv.polar));
    if (sv && isFinite(sv.az)) CAM.az = wrapA(sv.az);
  } catch (_) {}
  function applyCam() { const c = window.__controls; if (!c) return; c.minDistance = c.maxDistance = CAM.dist; c.minPolarAngle = c.maxPolarAngle = CAM.polar; c.minAzimuthAngle = c.maxAzimuthAngle = CAM.az; }
  function setPolar(v) { CAM.polar = Math.max(CAM.MIN, Math.min(CAM.MAX, v)); applyCam(); }
  function setAz(v) { CAM.az = wrapA(v); applyCam(); }
  function saveCam() { try { localStorage.setItem('tds.mobile.cam', JSON.stringify({ polar: +CAM.polar.toFixed(3), az: +CAM.az.toFixed(3) })); } catch (_) {} }
  window.__mobileCam = { get: () => CAM.polar, getAz: () => CAM.az, set: (v) => { setPolar(v); saveCam(); }, setAz: (v) => { setAz(v); saveCam(); } };

  // ---- the world: NO tap-to-move on touch. Holding a finger turns the hero toward it; the fire button attacks ----
  const rc = new THREE.Raycaster(), nd = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let worldId = null, wy0 = 0, wx0 = 0, wCam = false, wPolar0 = 0, wAz0 = 0, aimT = 0, aiming = false, lastE = null;
  function aimAt(e) {
    const r = canvas.getBoundingClientRect(); nd.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    rc.setFromCamera(nd, window.__camera); if (rc.ray.intersectPlane(plane, hit) && window.__mobile) window.__mobile.aim(hit.x, hit.z);
  }
  // a finger on the world: a SWIPE moves the camera — vertical tilts it (drag down = steeper / more top-down, up = flatter), horizontal
  // turns it round the hero; a finger that stays put (> 140 ms) instead turns the hero toward it. The view is kept (localStorage).
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target !== canvas || worldId !== null) return;
    worldId = e.pointerId; wx0 = e.clientX; wy0 = e.clientY; wCam = false; aiming = false; lastE = e;
    e.stopPropagation(); e.preventDefault();
    clearTimeout(aimT); aimT = setTimeout(() => { if (worldId !== null && !wCam) { aiming = true; aimAt(lastE); } }, 140);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== worldId) return;
    e.stopPropagation(); lastE = e;
    const dx = e.clientX - wx0, dy = e.clientY - wy0;
    if (!wCam && !aiming && Math.hypot(dx, dy) > 12) { wCam = true; clearTimeout(aimT); wx0 = e.clientX; wy0 = e.clientY; wPolar0 = CAM.polar; wAz0 = CAM.az; }
    if (wCam) { setPolar(wPolar0 - (e.clientY - wy0) * 0.0028); setAz(wAz0 - (e.clientX - wx0) * 0.006); }
    else if (aiming) aimAt(e);
  }, true);
  const end = (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== worldId) return;
    clearTimeout(aimT);
    if (!wCam && !aiming && lastE) aimAt(lastE);                     // a quick tap still turns the hero
    worldId = null; if (wCam) saveCam(); wCam = false; aiming = false; e.stopPropagation();
  };
  window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- fire button (right side): hold = keep attacking ----
  const fire = document.createElement('div'); fire.id = 'm-fire'; fire.innerHTML = '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="#fbe9b4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5 20.5 3.5 20.5 9.5 10 20 7 17Z"/><path d="M6 14 10 18"/><path d="M3.5 20.5 7 17"/></svg>'; document.body.appendChild(fire);
  let fireId = null, fireTimer = 0;
  const shoot = () => { if (window.__mobile) window.__mobile.fire(); };
  fire.addEventListener('pointerdown', (e) => { if (fireId !== null) return; fireId = e.pointerId; fire.setPointerCapture(e.pointerId); fire.classList.add('on'); e.preventDefault(); if (window.__mobile) window.__mobile.hold(true); shoot(); fireTimer = setInterval(shoot, 300); });
  const fireEnd = (e) => { if (e.pointerId !== fireId) return; fireId = null; fire.classList.remove('on'); clearInterval(fireTimer); if (window.__mobile) window.__mobile.hold(false); };
  fire.addEventListener('pointerup', fireEnd); fire.addEventListener('pointercancel', fireEnd);

  // camera: MOBA style (Mobile Legends-like) — the heading never swings by itself; ~38° view; a swipe on the world tilts (vertical) /
  // turns (horizontal) it (CAM, kept per device); fixed distance, no zoom; it rides the hero with the look point a little ahead so the hero sits just below the screen centre.
  // The joystick reads the camera heading every frame (stick up = away from the camera).
  const ctl = window.__controls;
  if (ctl) {
    ctl.enableRotate = false; ctl.enableZoom = false; ctl.enablePan = false;
    ctl.touches = { ONE: -1, TWO: -1 };
    applyCam();
    const want = new THREE.Vector3(), d = new THREE.Vector3();
    (function follow() {
      requestAnimationFrame(follow);
      const k = window.__knight, cam = window.__camera;
      if (!k || !cam) return;
      want.set(k.root.position.x - Math.sin(CAM.az) * CAM.ahead, CAM.lookY, k.root.position.z - Math.cos(CAM.az) * CAM.ahead);   // look a little ahead along the view
      d.subVectors(want, ctl.target);
      if (d.lengthSq() > 1e-6) { ctl.target.add(d); cam.position.add(d); }
      ctl.update();
      stickDir();                                                  // a held stick follows the view as it turns
    })();
  }
  addEventListener('resize', fit); addEventListener('orientationchange', fit);
  setInterval(fit, 1500); fit();
})();
