'use strict';
/* NET — oyun gözcüsü (WebSocket).
 * Öge akışı:
 *   client → { t:'join', token, charId }
 *   server → { t:'welcome', you:{...}, players:[...], chat:[...] }  sonra her WORLD_TICK:
 *   server → { t:'players', list:[...] }
 *   client → { t:'state', x, z, yaw, level, exp, hp, zone }  (10 Hz'e kadar;挑剔 olmuyor)
 *   client → { t:'chat', text }       server → { t:'chat', from, text, ts } (genel kanal, everyone)
 *   server → { t:'join' / 'leave' / 'sys' }
 *   client → { t:'bye' }              server: son konumu kaydeder, 'leave' yayınlar */
const { WebSocketServer } = require('ws');
const config = require('../config');
const Auth = require('../services/auth.service');
const Char = require('../services/character.service');
const World = require('../services/world.service');
const Chat = require('../services/chat.service');

const sockets = new Map();   // ws → charId
const CHAT_MIN_GAP_MS = 400;  // sohbet flood koruması (soket başına)
const JOIN_TIMEOUT_MS = 8000; // join göndermeyen soket kapatılır

function close(ws, code, reason) {
  try { ws.close(code || 1008, reason || 'unauthorized'); } catch { /* zaten kapalı */ }
}

module.exports = {
  broadcast(msg, exceptCharId) {
    const buf = JSON.stringify(msg);
    for (const [ws, id] of sockets) {
      if (exceptCharId !== undefined && id === exceptCharId) continue;
      if (ws.readyState === 1) ws.send(buf);
    }
  },

  broadcastWorld() {   // 10 Hz oyuncu snapshot (kendi kendini görmez — kendi kahramanını sahne zaten çizer)
    for (const [ws, id] of sockets) {
      if (ws.readyState !== 1) continue;
      try { ws.send(JSON.stringify({ t: 'players', list: World.list(id) })); } catch { }
    }
  },

  attach(httpServer) {
    const wss = new WebSocketServer({ noServer: true, path: '/ws' });
    httpServer.on('upgrade', (req, sock, head) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/ws') return;   // diğer upgrade istekleri (varsa) başkasına
      wss.handleUpgrade(req, sock, head, (ws) => this.onConnection(ws));
    });

    wss.on('close', () => { sockets.clear(); });
    return wss;
  },

  onConnection(ws) {                                    // eslint-disable-line consistent-return
    let me = null;   // WorldService oyuncu kaydı
    let joined = false, lastChat = 0;
    ws.on('error', () => {});
    const joinTimer = setTimeout(() => { if (!joined) close(ws, 1008, 'join timeout'); }, JOIN_TIMEOUT_MS);
    ws.once('close', () => clearTimeout(joinTimer));

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      try { handle.call(this, m); } catch (e) { console.error('[ws] mesaj işlenemedi:', e && e.message); }
    });

    const handle = function (m) {

      if (!joined) {
        if (m.t !== 'join') return;
        const auth = Auth.byToken(String(m.token || ''));
        if (!auth) return close(ws);
        const wanted = +m.charId;
        /* aynı karakter başka sekmede/bağlantıda açıksa eskisini düşür: konumu kaydet, çifte oturum olmasın */
        for (const [oldWs, oldId] of sockets) {
          if (oldId === wanted && oldWs !== ws) {
            sockets.delete(oldWs);
            const old = World.leave(oldId);
            if (old) { try { require('../models/character.model').saveState(old.id, old); } catch {} }
            try { oldWs.send(JSON.stringify({ t: 'kicked', reason: 'Bu karakter başka bir yerden açıldı.' })); } catch {}
            close(oldWs, 4000, 'replaced');
          }
        }
        const character = Char.owned(auth.user.id, wanted);        // karakterin sahibi (taze okuma)
        if (!character) return close(ws);
        joined = true;
        clearTimeout(joinTimer);
        me = World.join(character, ws);
        sockets.set(ws, character.id);
        ws.send(JSON.stringify({
          t: 'welcome',
          you: character,
          players: World.list(character.id),
          chat: Chat.recent('global'),
        }));
        this.broadcast({ t: 'join', player: { id: character.id, name: character.name, cls: character.cls, level: character.level } }, character.id);
        this.broadcast({ t: 'sys', text: character.name + ' oyuna girdi.' });
        return;
      }

      switch (m.t) {
        case 'state': World.state(me.id, m); break;
        case 'chat': {
          const text = String(m.text || '').trim().slice(0, 300);
          const now = Date.now();
          if (now - lastChat < CHAT_MIN_GAP_MS) break;     // flood: sessizce yut
          lastChat = now;
          if (text) Chat.send({ channel: 'global', fromId: me.userId, fromName: me.name, text });
          break;
        }
        case 'bye': saveAndClose(ws, me); break;
      }
    };

    ws.on('close', () => {
      const owned = sockets.get(ws) === (me && me.id);     // başkası tarafından düşürüldüyse (replaced) karaktere dokunma
      sockets.delete(ws);
      if (me && owned) saveAndClose(ws, me);
    });
  },
};

function saveAndClose(ws, me) {
  if (World.players && !World.players.has(me.id)) return;         // çift kapanış koruması
  try {
    const p = World.leave(me.id);                                 // en azından bu oyuncunun konumu hemen yazılır
    if (p) require('../models/character.model').saveState(p.id, p);
  } catch { /* db hatası olsa da bağlantı gitmeli */ }
  try { module.exports.broadcast({ t: 'leave', id: me.id }); } catch {}
  try { module.exports.broadcast({ t: 'sys', text: me.name + ' oyundan ayrıldı.' }, me.id); } catch {}
  try { if (ws.readyState === 1) ws.close(1000, 'bye'); } catch {}
}
