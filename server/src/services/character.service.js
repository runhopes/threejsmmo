'use strict';
/* SERVİS — karakter yönetimi */
const config = require('../config');
const Char = require('../models/character.model');

module.exports = {
  list(userId) {
    return Char.allOfUser(userId);
  },
  create(userId, { name, cls }) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!config.VALID.CHARNAME.test(name)) throw http(400, 'Karakter adı 2-16 karakter (harf, rakam, _).');
    if (!config.VALID.CLASSES.includes(cls)) throw http(400, 'Geçersiz sınıf.');
    if (Char.nameTaken(name)) throw http(409, 'Bu karakter adı kullanılıyor.');
    return Char.create(userId, { name, cls });
  },
  /* websocket 'join': karakter, bu kullanıcıya mı ait */
  owned(userId, charId) {
    const c = Char.byId(charId);
    return c && c.user_id === userId ? c : null;
  },
  saveState(charId, state) {
    Char.saveState(charId, sanitize(state));
  },
  remove(userId, id) {
    Char.deleteOfUser(userId, id);
    return true;
  },
};

function sanitize(s) {
  s = s || {};
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  return {
    level: Math.max(1, Math.min(999, num(s.level) || 1)),
    exp: num(s.exp),
    x: num(s.x), z: num(s.z), yaw: num(s.yaw),
    zone: String(s.zone || '').slice(0, 64),
    hp: Number.isFinite(+s.hp) ? Math.max(0, +s.hp) : null,
  };
}

function http(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
