'use strict';
/* MODEL — oturumlar */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

module.exports = {
  create(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + config.SESSION_TTL_MS;
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, userId, expires);
    return { token, expires };
  },
  valid(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  },
  destroy(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token || '');
  },
  purgeExpired() {
    return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
  },
  destroyAll(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },
};
