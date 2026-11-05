'use strict';
/* MODEL — sohbet geçmişi (kalıcı; kanal ileride genişletilebilir: 'general', 'trade'...) */
const db = require('../db');
const config = require('../config');

module.exports = {
  insert({ channel, fromId, fromName, text }) {
    db.prepare('INSERT INTO chat_messages (channel, from_id, from_name, text) VALUES (?, ?, ?, ?)')
      .run(channel, fromId, fromName, String(text).slice(0, 300));
  },
  recent(channel, n) {
    return db.prepare(`SELECT from_name, text FROM chat_messages
      WHERE channel = ? ORDER BY id DESC LIMIT ?`).all(channel, n || config.CHAT_HISTORY).reverse();
  },
};
