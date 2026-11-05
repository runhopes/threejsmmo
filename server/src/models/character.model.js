'use strict';
/* MODEL — karakterler */
const db = require('../db');
const config = require('../config');

const FIELDS = 'id, user_id, name, cls, level, exp, x, z, yaw, zone, hp, created_at, updated_at';

module.exports = {
  create(userId, { name, cls }) {
    const r = db.prepare('INSERT INTO characters (user_id, name, cls) VALUES (?, ?, ?)')
      .run(userId, name, cls);
    return this.byId(r.lastInsertRowid);
  },
  byId(id) {
    const row = db.prepare('SELECT ' + FIELDS + ' FROM characters WHERE id = ?').get(id);
    return row || null;
  },
  allOfUser(userId) {
    return db.prepare('SELECT ' + FIELDS + ' FROM characters WHERE user_id = ? ORDER BY created_at').all(userId);
  },
  nameTaken(name) {
    return !!db.prepare('SELECT 1 FROM characters WHERE name = ? COLLATE NOCASE').get(name);
  },
  /* konum + ilerleme kaydı (WorldService düzenli çağırır, çıkışta da) */
  saveState(id, s) {
    db.prepare(`UPDATE characters SET
      level = ?, exp = ?, x = ?, z = ?, yaw = ?, zone = ?, hp = ?, updated_at = datetime('now')
      WHERE id = ?`).run(
      s.level ?? 1, s.exp ?? 0, s.x ?? 0, s.z ?? 0, s.yaw ?? 0, s.zone ?? '', s.hp ?? null, id);
  },
  deleteOfUser(userId, id) {
    db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').run(id, userId);
  },
  classes: config.VALID.CLASSES,
};
