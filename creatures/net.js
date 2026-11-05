/* TDS MOBA - creature networking seam (server-authoritative).
 *
 * The game has no network layer yet; this file defines the protocol and both ends so creatures are ready for one:
 *   CreatureNet.Server   wraps the unchanged CreatureSim (runs on the server: node can load defs.js + sim.js + net.js)
 *   CreatureNet.RemoteAuthority   client mirror with the SAME interface CreatureWorld uses for the local CreatureSim
 *   CreatureNet.loopback(latencyMs)   in-page transport pair with simulated latency/jitter (index.html?net=loopback)
 *
 * Protocol (JSON-able):
 *   client -> server  { type: 'player', id, x, z, alive }           ~20 Hz
 *                     { type: 'damage', id, creature, amount, src }   a REQUEST; the server validates and applies it
 *   server -> client  { type: 'state', t, snap: [...] }             ~15 Hz (CreatureSim.snapshot())
 *                     { type: 'events', t, list: [...] }            every server tick that produced events (attack, hit,
 *                                                                   damaged, interrupt, stagger, death, despawn, respawn...)
 * Clients never decide creature damage or player damage: 'hit' events (creature -> player) and kills come from the server.
 * Attack animations start from the server's 'attack' event and run on a clock = elapsed since the server start time,
 * so the strike pose lines up with the server's active window (minus one-way latency, which is compensated).
 */
(function (global) {
  'use strict';
  const DEFS = global.CREATURE_DEFS;

  /* ---------------- server ---------------- */
  class Server {
    constructor(sim, transport, opts) {
      opts = opts || {};
      this.sim = sim; this.tx = transport; this.acc = 0; this.snapAcc = 0;
      this.tickDt = 1 / (opts.tickHz || 30); this.snapDt = 1 / (opts.snapHz || 15);
      transport.onMessage((m) => this.receive(m));
    }
    receive(m) {
      if (m.type === 'player') this.sim.setPlayer(m.id, m.x, m.z, m.alive, m.radius);
      else if (m.type === 'damage') {
        const res = this.sim.applyDamage(m.creature, m.amount, Object.assign({}, m.src, { pid: m.id }));
        this.tx.send({ type: 'damageResult', req: m.req, res });
      }
    }
    // driven by the server loop (setInterval / the game loop of a listen server)
    update(dt) {
      this.acc += dt; this.snapAcc += dt;
      while (this.acc >= this.tickDt) {
        this.acc -= this.tickDt;
        this.sim.tick(this.tickDt);
        const ev = this.sim.drainEvents();
        if (ev.length) this.tx.send({ type: 'events', t: this.sim.time, list: ev });
      }
      if (this.snapAcc >= this.snapDt) { this.snapAcc = 0; this.tx.send({ type: 'state', t: this.sim.time, snap: this.sim.snapshot() }); }
    }
  }

  /* ---------------- client mirror ---------------- */
  // record fields match CreatureSim's records for everything CreatureWorld / the HUD read
  class RemoteAuthority {
    constructor(transport, opts) {
      opts = opts || {};
      this.tx = transport; this.creatures = []; this.byId = new Map(); this.events = [];
      this.time = 0;               // estimated server time
      this.delay = opts.interpDelay || 0.12;   // entity interpolation delay (s)
      this.sendAcc = 0; this.req = 0; this.lat = 0.05;
      transport.onMessage((m) => this.receive(m));
    }
    _rec(s) {
      let c = this.byId.get(s.id);
      if (!c) {
        c = { id: s.id, sp: s.sp, D: DEFS.SPECIES[s.sp], buf: [], x: s.x, z: s.z, yaw: s.yaw, act: null, deadT: 0, speed: 0, mode: 'walk', seq: s.seq, alive: true, despawned: false, target: null };
        this.creatures.push(c); this.byId.set(c.id, c);
      }
      return c;
    }
    receive(m) {
      if (m.type === 'state') {
        if (m.t > this.time) this.time = Math.max(this.time, m.t - this.delay);
        for (const s of m.snap) {
          const c = this._rec(s);
          c.buf.push({ t: m.t, x: s.x, z: s.z, yaw: s.yaw }); if (c.buf.length > 6) c.buf.shift();
          Object.assign(c, { level: s.lv, hp: s.hp, maxHp: s.maxHp, st: s.st, mode: s.mode, speedS: s.spd, alive: s.alive, despawned: s.despawned, enraged: s.enraged, target: s.target, seq: s.seq });
          if (s.act && c.act && c.act.id === s.act.id) c.act.t = Math.max(c.act.t, s.act.t - this.lat);   // drift correction only forward
          if (!s.act && c.act && c.act.t > c.act.def.dur * 0.98) c.act = null;
        }
      } else if (m.type === 'events') {
        for (const e of m.list) {
          const c = this.byId.get(e.id);
          if (c) {
            if (e.type === 'attack') c.act = { id: e.attack, def: c.D.attacks[e.attack], t: this.lat };   // compensate one-way latency
            else if (e.type === 'interrupt') c.act = null;
            else if (e.type === 'death') { c.alive = false; c.act = null; c.deadT = 0; c.hp = 0; }
            else if (e.type === 'despawn') c.despawned = true;
            else if (e.type === 'respawn') { c.buf.length = 0; }
            else if (e.type === 'damaged') c.hp = e.hp;
          }
          this.events.push(e);
        }
      } else if (m.type === 'damageResult') { /* authoritative HP arrives with the next state / damaged event */ }
    }
    // the world's per-frame call: advance interpolation and the local attack clocks
    tick(dt) {
      this.time += dt;
      const rt = this.time;
      for (const c of this.creatures) {
        if (!c.alive) c.deadT += dt;
        if (c.act) { c.act.t += dt; if (c.act.t > c.act.def.dur + 0.3) c.act = null; }
        const b = c.buf; if (!b.length) continue;
        let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
        const A = b[Math.max(0, i - 1)], B = b[i], k = B.t > A.t ? Math.min(1.2, Math.max(0, (rt - A.t) / (B.t - A.t))) : 1;
        const px = c.x, pz = c.z;
        c.x = A.x + (B.x - A.x) * k; c.z = A.z + (B.z - A.z) * k;
        c.yaw = A.yaw + Math.atan2(Math.sin(B.yaw - A.yaw), Math.cos(B.yaw - A.yaw)) * k;
        c.speed = Math.hypot(c.x - px, c.z - pz) / Math.max(dt, 1e-4);
      }
    }
    drainEvents() { const e = this.events; this.events = []; return e; }
    setPlayer(id, x, z, alive, radius) {
      this.sendAcc += 1 / 60;
      if (this.sendAcc < 0.05) return; this.sendAcc = 0;
      this.tx.send({ type: 'player', id, x, z, alive, radius });
    }
    // damage REQUEST: optimistic acknowledgement (the client shows its hit), the server decides the result
    applyDamage(id, amount, src) {
      const c = this.byId.get(id);
      if (!c || !c.alive) return { ok: false, reason: 'dead' };
      if (c.st === 'return') return { ok: false, reason: 'evade' };   // same rule as the server: evading home is immune
      this.tx.send({ type: 'damage', id: src.pid, creature: id, amount, src: { x: src.x, z: src.z, crit: src.crit }, req: ++this.req });
      return { ok: true, pending: true, amount };
    }
  }

  /* ---------------- loopback transport (two ends, simulated latency + jitter) ---------------- */
  function loopback(latencyMs, jitterMs) {
    const L = latencyMs || 60, J = jitterMs || 15;
    const mk = () => ({ handlers: [], peer: null, sent: 0, onMessage(h) { this.handlers.push(h); }, send(m) {
      const peer = this.peer, data = JSON.stringify(m); this.sent += data.length;   // serialised: exactly what would go over the wire
      setTimeout(() => { const o = JSON.parse(data); for (const h of peer.handlers) h(o); }, L + Math.random() * J);
    } });
    const a = mk(), b = mk(); a.peer = b; b.peer = a;
    return { client: a, server: b };
  }

  global.CreatureNet = { Server, RemoteAuthority, loopback };
})(typeof window !== 'undefined' ? window : globalThis);
