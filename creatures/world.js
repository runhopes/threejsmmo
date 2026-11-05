/* TDS MOBA - CreatureWorld: client-side bridge between the authoritative CreatureSim and the rendered CreatureViews.
 *
 *   authority (CreatureSim: local now, a server later)  --snapshot + events-->  CreatureWorld  -->  CreatureViews
 *   player attacks --> dealDamage --> world.damage() --> authority.applyDamage() (validated there)
 *
 * The world never invents gameplay: positions, facing, attack clocks, deaths and respawns all come from the authority.
 * It owns presentation only: pooled views per species, animation state requests (attack actions run on the attack's
 * authoritative clock, so the strike pose lines up with the server's hit window), hit flinches, corpses sinking away,
 * boss telegraphs, distance LOD / update-rate policy, frustum culling, and the hero hit-target capsules.
 *
 * Scale: views are LAZY. opts.viewRadius (default Infinity = a view for every creature, as before; the host passes ~110) makes the
 * world create a view only for ALIVE creatures within viewRadius of the player given to update(); a view is released beyond
 * viewRadius + VIEW_HYST unless the creature is in combat (has a target / attack running), is pinned (world.pin(id): the host pins
 * what the player has selected) or is still sinking. Views acquired by distance appear in place (no rise effect, no 'appear' hook);
 * only a respawn rises. Dead creatures that never had a view never get one; a corpse out of range simply disappears.
 * opts.activeRadius is handed to the local CreatureSim (dormant creatures: see sim.js) - keep it >= viewRadius so nothing visible
 * is frozen. markers / nearest / info / zoneAt read the authority list and keep working for creatures without a view.
 */
(function (global) {
  'use strict';
  const T = global.THREE, K = global.CreatureKit, DEFS = global.CREATURE_DEFS;
  const angD = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  function create(opts) {
    const scene = opts.scene, camera = opts.camera;
    // authority: a provided one (e.g. a networked mirror), the in-page server behind a latency loopback (?net=loopback),
    // or the local CreatureSim (single player / listen server)
    let authority = opts.authority, server = null;
    if (!authority) {
      const sim = new global.CreatureSim({ seed: opts.seed || 20261104, obstacles: opts.obstacles || [], collide: opts.collide || null, activeRadius: opts.activeRadius });
      sim.spawnZones(opts.zones || DEFS.ZONES);
      if (opts.net === 'loopback' && global.CreatureNet) {
        const link = global.CreatureNet.loopback(opts.latency || 70, 20);
        server = new global.CreatureNet.Server(sim, link.server);
        authority = new global.CreatureNet.RemoteAuthority(link.client);
        authority.link = link;
      } else authority = sim;
    }
    const hitLists = () => Object.values(opts.heroes || {}).map((h) => h.hitTargets);
    const views = new Map();               // creature id -> entry
    const pool = {};                       // species -> [entry]
    const group = new T.Group(); group.name = 'creatures'; scene.add(group);
    const hooks = { onPlayerHit: null, onKill: null, onEvent: null };
    const frustum = new T.Frustum(), projM = new T.Matrix4(), sphere = new T.Sphere();
    let frame = 0, visible = true;
    const PLAYER = opts.playerId || 'local';
    const VIEW_R = opts.viewRadius > 0 ? opts.viewRadius : Infinity, VIEW_HYST = 15, VIEW_REL = VIEW_R + VIEW_HYST;
    const pins = new Set();                 // creature ids that keep their view regardless of distance (selected target...)
    const respawned = new Map();            // creature id -> authority time of its last respawn (only those rise from the ground)
    let px = 0, pz = 0, havePlayer = false;

    /* ---------------- pooled views ---------------- */
    function acquire(sp) {
      const list = pool[sp] || (pool[sp] = []);
      let e = list.pop();
      if (!e) {
        const view = new K.CreatureView(sp);
        e = { view, sp, D: DEFS.SPECIES[sp], target: null, idleT: 2 + Math.random() * 4, lastQ: 0, acc: 0, sink: -1, rise: -1, hidden: false, actKey: null };
      }
      e.view.root.visible = true; e.view.root.position.y = 0;
      group.add(e.view.root);
      return e;
    }
    function release(e) {
      group.remove(e.view.root);
      if (e.target) removeTarget(e);
      e.sink = -1; e.rise = -1; e.actKey = null;
      (pool[e.sp] || (pool[e.sp] = [])).push(e);
    }
    /* hero hit-target capsule (shared vector: the hero code reads tg.pos every frame) */
    function addTarget(e, rec) {
      if (e.target) return;
      // hit capsule: at least head-high so horizontal sword arcs, level arrows and fireballs register on small animals
      // (MMO convention: generous hit volumes)
      e.target = { id: 'cr:' + rec.id, pos: e.view.root.position, radius: e.D.radius, height: Math.max(e.D.height, 1.9), bodyHeight: e.D.height, alive: () => rec.alive, creature: rec, entry: e };
      for (const L of hitLists()) L.push(e.target);
    }
    function removeTarget(e) {
      for (const L of hitLists()) { const i = L.indexOf(e.target); if (i >= 0) L.splice(i, 1); }
      e.target = null;
    }
    const pendingRemove = [];

    /* ---------------- boss telegraphs (ground decals, pooled) ---------------- */
    const teleMat = () => new T.MeshBasicMaterial({ color: 0xc8463a, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide });
    const tele = { cone: null, ring: null, line: null };
    function teleMesh(kind) {
      if (tele[kind]) return tele[kind];
      let g;
      if (kind === 'cone') g = new T.CircleGeometry(1, 40, Math.PI / 2 - 0.95, 1.9);
      else if (kind === 'ring') g = new T.CircleGeometry(1, 56);
      else { g = new T.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); }
      const m = new T.Mesh(g, teleMat()); m.rotation.x = -Math.PI / 2; m.renderOrder = 6; m.visible = false; scene.add(m);
      const edge = new T.Mesh(kind === 'line' ? new T.EdgesGeometry(g) : new T.RingGeometry(0.97, 1, 56, 1, kind === 'cone' ? Math.PI / 2 - 0.95 : 0, kind === 'cone' ? 1.9 : Math.PI * 2), teleMat());
      if (kind !== 'line') { edge.rotation.x = 0; m.add(edge); }
      tele[kind] = { m, edge, t: 0, life: 0, rec: null };
      return tele[kind];
    }
    function startTelegraph(rec, ev) {
      const a = rec.D.attacks[ev.attack]; if (!a || !a.telegraph) return;
      const t = teleMesh(a.telegraph);
      t.rec = rec; t.t = 0; t.life = a.dur * a.active[1]; t.def = a; t.m.visible = true;
      const R = a.reach + rec.D.radius;
      t.R = R;
    }
    function updateTelegraphs(dt) {
      for (const k in tele) {
        const t = tele[k]; if (!t || !t.m.visible) continue;
        t.t += dt;
        const rec = t.rec, a = t.def, u = t.t / a.dur;
        if (!rec.alive || !rec.act || t.t > t.life + 0.15) { t.m.visible = false; continue; }
        const grow = Math.min(1, u / Math.max(0.05, a.phases.wu)), pulse = 0.5 + 0.5 * Math.sin(t.t * 14);
        const op = (u < a.active[0] ? 0.16 + 0.12 * grow + 0.08 * pulse : 0.45 * Math.max(0, 1 - (u - a.active[0]) / 0.1));
        t.m.material.opacity = op; if (t.edge) t.edge.material.opacity = Math.min(0.9, op * 2.4);
        const yaw = rec.yaw;
        if (k === 'ring') { t.m.position.set(rec.x, 0.04, rec.z); t.m.scale.setScalar(t.R * (0.35 + 0.65 * grow)); }
        else if (k === 'cone') { t.m.position.set(rec.x, 0.04, rec.z); t.m.rotation.set(-Math.PI / 2, 0, yaw + Math.PI); t.m.scale.setScalar(t.R * (0.4 + 0.6 * grow)); }   // +pi: local +Y -> creature forward
        else { t.m.position.set(rec.x, 0.04, rec.z); t.m.rotation.set(-Math.PI / 2, 0, yaw + Math.PI); t.m.scale.set(rec.D.radius * 2.2, a.lunge * grow + 1, 1); }
      }
    }

    /* ---------------- events from the authority ---------------- */
    function localDir(e, dx, dz) {             // world direction -> creature-local (x, z)
      const y = e.view.root.rotation.y, c = Math.cos(y), s = Math.sin(y);
      return [dx * c - dz * s, dx * s + dz * c];
    }
    function actionName(e, attackId) { const m = e.view.sp.attackAction; return (m && m[attackId]) || attackId; }
    function handle(ev) {
      const rec = authority.byId.get(ev.id), e = views.get(ev.id);
      if (ev.type === 'respawn') respawned.set(ev.id, authority.time);
      if (hooks.onEvent && (e || ev.type !== 'despawn')) hooks.onEvent(ev, rec, e);     // no despawn dust for a creature nobody can see
      if (ev.type === 'hit' && ev.target === PLAYER && hooks.onPlayerHit) hooks.onPlayerHit(ev, rec);
      if (!e) { if (ev.type === 'death' && hooks.onKill) hooks.onKill(ev, rec); return; }
      const v = e.view;
      switch (ev.type) {
        case 'attack': {
          const name = actionName(e, ev.attack);
          // the animation clock IS the authoritative attack clock (in a networked client: the server timestamp)
          const key = rec.id + ':' + authority.time.toFixed(4);
          e.actKey = key;
          v.play(name, { ext: (dt, t) => (rec.act && e.actKey === key ? rec.act.t : t + dt), data: { tx: ev.tx, tz: ev.tz } });
          startTelegraph(rec, ev);
          break;
        }
        case 'interrupt': v.sm.stop(); e.actKey = null; break;
        case 'damaged': {
          const d = localDir(e, ev.dirX, ev.dirZ);
          v.flash(0.1);
          if (v.anim && v.anim.hit) v.anim.hit(d[0], d[1], Math.min(1.6, 0.6 + ev.amount / Math.max(1, rec.maxHp) * 6));
          if (ev.stagger) v.play('stagger');
          break;
        }
        case 'death': {
          const d = localDir(e, ev.dirX, ev.dirZ);
          v.play('death', { data: { side: d[0] >= 0 ? -1 : 1, dirX: d[0], dirZ: d[1] } });
          pendingRemove.push(e);
          if (hooks.onKill) hooks.onKill(ev, rec);
          break;
        }
        case 'despawn': e.sink = 0; break;
        case 'alert': v.play('raise'); break;
      }
    }

    /* ---------------- per-frame ---------------- */
    const _cam = new T.Vector3();
    function update(dt, player) {
      if (server) server.update(dt);                    // in-page server (loopback test only)
      if (player) authority.setPlayer(PLAYER, player.x, player.z, player.alive, player.radius || 0.45);
      authority.tick(dt);
      for (const ev of authority.drainEvents()) handle(ev);
      for (const e of pendingRemove) if (e.target) removeTarget(e);
      pendingRemove.length = 0;
      frame++;
      camera.updateMatrixWorld();
      projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projM);
      camera.getWorldPosition(_cam);
      if (player) { px = player.x; pz = player.z; havePlayer = true; }
      const lazy = VIEW_R < Infinity && havePlayer;
      for (const rec of authority.creatures) {
        let e = views.get(rec.id);
        if (rec.despawned && (!e || e.sink < 0)) { if (e && e.sink < 0) { release(e); views.delete(rec.id); } continue; }
        if (lazy) {
          const dx = rec.x - px, dz = rec.z - pz, d2 = dx * dx + dz * dz;
          if (!e) { if (!rec.alive || d2 > VIEW_R * VIEW_R) continue; }
          else if (d2 > VIEW_REL * VIEW_REL && e.sink < 0 && !(rec.alive && (rec.target || rec.act || pins.has(rec.id)))) { release(e); views.delete(rec.id); continue; }
        } else if (!e && VIEW_R < Infinity && (!rec.alive || !havePlayer)) continue;
        if (!e) {
          e = acquire(rec.sp); views.set(rec.id, e); e.seq = rec.seq;
          e.view.teleport(rec.x, rec.z, rec.yaw);
          const rt = respawned.get(rec.id), rose = rt !== undefined && authority.time - rt < 1.5;   // a fresh respawn rises; a view acquired by distance does not
          if (rt !== undefined) respawned.delete(rec.id);
          e.rise = rose || VIEW_R === Infinity ? 0 : -1;
          if (rec.alive) addTarget(e, rec);
          if ((rose || VIEW_R === Infinity) && hooks.onEvent) hooks.onEvent({ type: 'appear', id: rec.id }, rec, e);
        } else if (e.seq !== rec.seq) {                    // respawned in place of a still-sinking corpse
          e.seq = rec.seq; e.sink = -1; e.rise = 0; e.view.teleport(rec.x, rec.z, rec.yaw);
          respawned.delete(rec.id);
          if (!e.target) addTarget(e, rec);
          if (hooks.onEvent) hooks.onEvent({ type: 'appear', id: rec.id }, rec, e);
        }
        const v = e.view, root = v.root;
        // transform from the authority (yaw smoothed: the sim turns in steps)
        root.position.x = rec.x; root.position.z = rec.z;
        root.rotation.y += angD(rec.yaw, root.rotation.y) * (1 - Math.exp(-dt * 16));
        if (v.anim && v.anim.setMode) v.anim.setMode(rec.alive ? (rec.speed > 0.05 ? rec.mode : null) : null, rec);
        // corpse sinking / respawn rising (never pops)
        if (e.sink >= 0) { e.sink += dt; root.position.y = -Math.min(1, Math.pow(e.sink / 2.2, 1.6)) * (e.D.height * 0.9 + 0.1); if (e.sink > 2.3) { release(e); views.delete(rec.id); continue; } }
        else if (e.rise >= 0) { e.rise += dt; root.position.y = -0.25 * Math.max(0, 1 - e.rise / 0.6); if (e.rise > 0.6) { e.rise = -1; root.position.y = 0; } }
        // cosmetic idle specials (client-only, never gameplay)
        if (rec.alive && !rec.act && rec.speed < 0.05 && !v.sm.cur) {
          e.idleT -= dt;
          const sp = v.sp.specials;
          if (e.idleT <= 0 && sp && sp.length) { v.play(sp[(Math.random() * sp.length) | 0]); e.idleT = 4 + Math.random() * 7; }
        }
        // visibility, distance LOD and update rate
        const d = _cam.distanceTo(root.position);
        sphere.center.set(rec.x, e.D.height * 0.5, rec.z); sphere.radius = Math.max(e.D.height, e.D.radius * 2.2) + 0.3;
        const inView = visible && frustum.intersectsSphere(sphere);
        root.visible = inView;
        v.setLOD(d > 15 ? 1 : 0); v.setShadow(d < 18);
        let q = !inView ? 0 : d < 18 ? 2 : d < 34 ? 1 : 1;
        const every = !inView ? 1 : d < 18 ? 1 : d < 34 ? 2 : 4;
        e.acc += dt;
        if (q > 0 && e.lastQ === 0 && v.anim && v.anim.gait) v.anim.gait.reset(root);     // back on screen: re-plant feet
        if ((frame + rec.id) % every === 0 || q === 0) { v.update(e.acc, q); e.acc = 0; }
        e.lastQ = q;
      }
      updateTelegraphs(dt);
    }

    /* ---------------- queries for the game / HUD ---------------- */
    const _ray = new T.Ray(), _a = new T.Vector3(), _b = new T.Vector3(), _c1 = new T.Vector3(), _c2 = new T.Vector3();
    function pick(raycaster) {                 // creature capsule under the cursor (closest to the camera)
      let best = null, bd = 1e9;
      for (const [id, e] of views) {
        const rec = authority.byId.get(id); if (!rec || !rec.alive || !e.view.root.visible) continue;
        _a.set(rec.x, 0.05, rec.z); _b.set(rec.x, Math.max(e.D.height, 0.9), rec.z);
        const d2 = raycaster.ray.distanceSqToSegment(_a, _b, _c1, _c2), r = e.D.radius + 0.3;     // generous: easy to click
        if (d2 < r * r) { const dc = _c1.distanceTo(raycaster.ray.origin); if (dc < bd) { bd = dc; best = rec; } }
      }
      return best;
    }
    function nearest(x, z, maxD, filter) {
      let best = null, bd = maxD;
      for (const rec of authority.creatures) {
        if (!rec.alive || !views.has(rec.id)) continue;
        if (filter && !filter(rec)) continue;
        const d = Math.hypot(rec.x - x, rec.z - z) - rec.D.radius;
        if (d < bd) { bd = d; best = rec; }
      }
      return best;
    }
    const RANK = { normal: 'normal', boss: 'boss' };
    function info(id) {
      const rec = typeof id === 'string' ? authority.byId.get(+id.replace('cr:', '')) : id;
      if (!rec) return null;
      const passive = rec.D.behavior.aggro <= 0;
      return { id: 'cr:' + rec.id, name: rec.D.name, level: rec.level, hp: rec.hp, maxHp: rec.maxHp, rank: rec.D.boss ? RANK.boss : RANK.normal,
        disposition: passive && !rec.target ? 'neutral' : 'hostile', type: rec.D.boss ? 'Canavar · Bölge patronu' : 'Canavar', alive: rec.alive, x: rec.x, z: rec.z,
        effects: rec.enraged ? [{ id: 'enrage', name: 'Öfke', desc: 'Daha hızlı ve daha güçlü saldırıyor.', left: 0, debuff: false }] : [] };
    }
    function markers(x, z, range, selected) {
      const out = [];
      for (const rec of authority.creatures) {
        if (!rec.alive || Math.hypot(rec.x - x, rec.z - z) > range) continue;
        out.push({ id: 'cr:' + rec.id, x: rec.x, z: rec.z, kind: rec.D.behavior.aggro <= 0 && !rec.target ? 'neutral' : 'hostile', selected: selected === 'cr:' + rec.id, label: rec.D.name + ' (' + rec.level + ')' });
      }
      return out;
    }
    function zoneAt(x, z) {
      for (const Z of DEFS.ZONES) if (Math.hypot(x - Z.cx, z - Z.cz) < Z.r + 6) return Z;
      return null;
    }
    // keep a creature's view (and hit target) while the player cares about it, however far it is (the host pins the selected target)
    function pin(id) { pins.add(typeof id === 'string' ? +id.replace('cr:', '') : id); }
    function unpin(id) { pins.delete(typeof id === 'string' ? +id.replace('cr:', '') : id); }
    function unpinAll() { pins.clear(); }
    // damage request from the local player (the authority validates it)
    function damage(tg, amount, src) {
      const rec = tg.creature; if (!rec) return null;
      return authority.applyDamage(rec.id, amount, Object.assign({ pid: PLAYER }, src || {}));
    }
    // a bone to stick arrows into (follows the animated body)
    function attachPoint(tg) { const e = tg.entry; return e ? e.view.bones[e.view.tpl.idx.body] : null; }

    return {
      authority, server, group, hooks, update, pick, nearest, info, markers, zoneAt, damage, attachPoint, pin, unpin, unpinAll,
      get views() { return views; },
      byKey(key) { return typeof key === 'string' && key.startsWith('cr:') ? authority.byId.get(+key.slice(3)) : null; },
      setVisible(v) { visible = v; group.visible = v; },
      stats() {
        let n = 0, on = 0; for (const e of views.values()) { n++; if (e.view.root.visible) on++; }
        const sim = authority.stats ? authority.stats() : null;
        return { views: n, onScreen: on, creatures: authority.creatures.length, pinned: pins.size, active: sim ? sim.active : authority.creatures.length, dormant: sim ? sim.dormant : 0 };
      },
    };
  }

  global.CreatureWorld = { create };
})(window);
