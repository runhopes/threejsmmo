/* Atherion dünya ağı (WebSocket) — çevrimiçi oyuncular, konum kaydı, genel sohbet.
 * Kendi kahramanımız index.html'de kalır; Net yalnızca uzak oyuncuları sahneye ekler
 * (her sınıf aynı Knight modeli: mevcut animasyonlar aynen oynar) ve kendi state'ini 10 Hz gönderir.
 * Protocol: { t:'join' } → { t:'welcome', you, players, chat } ; sonra
 *   client → { t:'state', x, z, yaw, level, exp, hp, zone }   (10 Hz)
 *   client → { t:'chat', text }  ·  server → { t:'players' | 'chat' | 'sys' | 'join' | 'leave' }
 *   client → { t:'bye' } (sunucu son konumu kaydeder)
 */
(function (global) {
  'use strict';

  const SEND_MS = 100;        // kendi konum: 10 Hz
  const LERP = 12;            // uzak oyuncu yumuşatması
  const RUN_SPEED = 6.4;      // uzak kahramanın koşu gait'i (Knight.RUN_SPEED ile aynı)
  const PLATE_RANGE = 40;     // isim levhası menzili (creature plates ile aynı)
  const PLAYER_HP = { warrior: 3400, archer: 2700, mage: 2300 };   // CLASS_INFO bazları (index.html ile aynı)

  let cfg = null;             // { scene, log(text, tone), onChatLine(msg), welcome(char), recentChat(lines), onClose() }
  let ws = null, ready = false, me = null, token = '';
  const remotes = new Map();  // id → Remote
  let sendAcc = 0, lastPos = { x: 0, z: 0, t: 0 };

  function wsUrl() {
    if (global.AtherionConfig && global.AtherionConfig.WS_URL) return global.AtherionConfig.WS_URL;   // app/config.js (native → canlı sunucu)
    const proto = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + global.location.host + '/ws';
  }

  function Remote(id, player) {
    const k = new global.Knight({ cls: player.cls || 'warrior' });   // mevcut model + animasyonlar
    if (cfg.scene) cfg.scene.add(k.root);
    try { cfg.scene.add(k.trail.mesh); } catch { }
    try { cfg.scene.add(k.slash.group); } catch { }
    this.id = id; this.k = k;
    this.cls = player.cls || 'warrior';
    this.name = player.name || ('? ' + id);
    this.level = player.level || 1; this.hp = player.hp;
    this.tx = player.x || 0; this.tz = player.z || 0; this.tyaw = player.yaw || 0;
    k.root.position.set(this.tx, 0, this.tz);
    k.root.rotation.y = this.tyaw;
    k.update(0, {});
  }
  Remote.prototype.update = function (dt) {
    const p = this.k.root.position;
    const a = Math.min(1, dt * LERP);
    p.x += (this.tx - p.x) * a;
    p.z += (this.tz - p.z) * a;
    this.k.root.rotation.y += (this.tyaw - this.k.root.rotation.y) * a;
    const d = Math.hypot(this.tx - p.x, this.tz - p.z);
    const moving = d > 0.06;
    // vertical frame (world/layout.js W.frameY): the knight rig plants feet at world y = 0, so animate at y = 0, then lift the root onto the terrain
    const W = global.Village && global.Village.World, gy = W && W.on && W.frameY ? W.frameY(p.x, p.z) : 0;
    p.y = 0;
    if (W && W.on && W.frameY) this.k.groundAt = (x, z) => W.frameY(x, z) - gy;   // feet ride the terrain relative to this player's own ground
    this.k.update(dt, { move: moving ? 1 : 0, speed: moving ? Math.min(RUN_SPEED, RUN_SPEED * d * 3) : 0 });
    p.y = gy;
    try { this.k.trail.mesh.position.y = gy; this.k.slash.group.position.y = gy; } catch { }   // (world-space effect meshes were drawn at the y = 0 baseline)
  };
  Remote.prototype.dispose = function () {
    const k = this.k;
    if (cfg.scene) {
      try { cfg.scene.remove(k.root); cfg.scene.remove(k.trail.mesh); cfg.scene.remove(k.slash.group); } catch { }
    }
  };

  global.Net = {
    get ready() { return ready; },
    get me() { return me; },
    init(options) { cfg = options || {}; },

    connect(char, tk) {
      token = tk || token || (global.Accounts ? global.Accounts.token() : '');
      if (!token || !global.WebSocket) return false;   // sunucu yoksa sessizca lokal kal
      try { ws = new global.WebSocket(wsUrl()); } catch { return false; }
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', token, charId: char.id }));   // server: token + karakter sahipliği
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m !== 'object') return;

        if (m.t === 'welcome') {
          ready = true; me = m.you;
          for (const p of m.players || []) remotes.set(p.id, new Remote(p.id, p));
          cfg.recentChat && cfg.recentChat(m.chat || []);
          cfg.welcome && cfg.welcome(m.you);
        } else if (m.t === 'players') {
          const seen = new Set();
          for (const p of m.list || []) {
            if (me && p.id === me.id) continue;                 // güvence: kendimiz asla uzak kahraman olmayız
            seen.add(p.id);
            let r = remotes.get(p.id);
            if (!r) { r = new Remote(p.id, p); remotes.set(p.id, r); }
            r.tx = p.x; r.tz = p.z; r.tyaw = p.yaw || r.tyaw;
            r.hp = (p.hp === null || p.hp === undefined) ? r.hp : p.hp;
            r.name = p.name || r.name;
            r.level = p.level || r.level;
          }
          for (const id of Array.from(remotes.keys())) if (!seen.has(id)) { const r = remotes.get(id); remotes.delete(id); r.dispose(); }
        } else if (m.t === 'sys') {
          cfg.log && cfg.log(m.text, 'sys');
        } else if (m.t === 'chat') {
          if (me && m.id && m.id === me.user_id) return;   // kendi satır zaten anında "Sen:" ile düştü (sunucu eko'su mükerrer)
          cfg.onChatLine && cfg.onChatLine(m);
        }
      };
      ws.onclose = () => {
        if (ready && cfg && cfg.onClose) cfg.onClose();
        ready = false; me = null; ws = null;
        for (const r of remotes.values()) r.dispose();
        remotes.clear();
      };
      return true;
    },

    chat(text) {
      if (ready && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ t: 'chat', text: String(text || '').slice(0, 300) }));
      }
    },

    /* tick başına: uzak oyuncuları hareket ettir + kendi state'ini gönder */
    frame(dt, pos, yaw, extra) {
      for (const r of remotes.values()) r.update(dt);
      if (!ready || !ws || ws.readyState !== 1) return;
      sendAcc += dt;
      if (sendAcc >= SEND_MS / 1000) {
        sendAcc = 0;
        ws.send(JSON.stringify(Object.assign({ t: 'state', x: pos.x, z: pos.z, yaw: yaw }, extra || {})));
      }
      void lastPos;   // (hız hesabı istemcide değil sunucunun modele genel listesinde)
    },

    /* ui/nameplates.js plates dizisine uzak oyuncuları ekle (index.html'den çağrılır) */
    plates(out, kp) {
      for (const r of remotes.values()) {
        const p = r.k.root.position;
        if (Math.hypot(p.x - kp.x, p.z - kp.z) > PLATE_RANGE) continue;
        const maxHp = PLAYER_HP[r.cls] || 1;
        out.push({ id: 'pl:' + r.id, kind: 'player', self: false, name: r.name, level: r.level, hp: r.hp ?? maxHp, maxHp,
          x: p.x, y: p.y + 2.3, z: p.z, selected: false, hostile: false, dead: r.hp === 0, clan: '', role: '' });
      }
    },

    roots() { return Array.from(remotes.values()).map((r) => r.k.root); },   // harita çekimi: uzak oyuncular haritaya pişmesin

    /* oyun çıkışı: sunucuya veda (son konumu kaydeder), sonra REST logout */
    leave() {
      try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'bye' })); } catch { }
      token = '';
    },
  };
})(window);
