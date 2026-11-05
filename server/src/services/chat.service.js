'use strict';
/* SERVİS — sohbet kanalları. Genel kanal gerçek; sistem/savaş mesajları istemcide üretir. */
const config = require('../config');
const Chat = require('../models/chat.model');
const wsHub = require('../net/hub');

module.exports = {
  recent(channel, n) {
    return Chat.recent(channel || 'global', n || config.CHAT_HISTORY).map((m) => ({ from: m.from_name, text: m.text }));
  },
  send({ channel, fromId, fromName, text }) {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return null;
    channel = channel || 'global';
    const msg = { channel, fromId, fromName, text, ts: Date.now() };
    Chat.insert(msg);
    wsHub.broadcast({ t: 'chat', ch: channel, from: fromName, id: fromId, text, ts: msg.ts });
    return msg;
  },
};
