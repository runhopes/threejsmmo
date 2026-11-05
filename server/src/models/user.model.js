'use strict';
/* MODEL — kullanıcilar */
const db = require('../db');

const SELECT_PUBLIC = 'SELECT id, email, username, created_at FROM users';

module.exports = {
  create({ email, username, passhash }) {
    const r = db.prepare('INSERT INTO users (email, username, passhash) VALUES (?, ?, ?)')
      .run(email, username, passhash);
    return this.byId(r.lastInsertRowid);
  },
  byEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) || null;
  },
  byUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) || null;
  },
  byId(id) {
    const row = db.prepare(SELECT_PUBLIC + ' WHERE id = ?').get(id);
    return row || null;
  },
  /* hesap silme (App Store 5.1.1(v)): oturumlar + karakterler CASCADE ile gider; sohbet geçmişi anonimleşir */
  remove(id) {
    db.prepare('UPDATE chat_messages SET from_id = NULL WHERE from_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
  passhash(id) {
    const row = db.prepare('SELECT passhash FROM users WHERE id = ?').get(id);
    return row ? row.passhash : null;
  },
  exists(email, username) {
    const e = this.byEmail(email);
    const u = this.byUsername(username);
    return { email: !!e, username: !!u };
  },
};
