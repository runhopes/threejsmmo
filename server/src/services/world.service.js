'use strict';
/* SERVİS — dünya / çevrimiçi oyuncular (websocket'in arkasındaki durum) */
const Char = require('../models/character.model');

/* charId → { id, userId, name, cls, level, exp, x, z, yaw, zone, hp, ws, token } */
const players = new Map();

module.exports = {
  players,
  join(character, ws) {
    const p = {
      id: character.id, userId: character.user_id, name: character.name, cls: character.cls,
      level: character.level, exp: character.exp, x: character.x, z: character.z, yaw: character.yaw,
      zone: character.zone, hp: character.hp, ws, seen: Date.now(), dirty: true,
    };
    players.set(character.id, p);
    return p;
  },
  leave(charId) {
    const p = players.get(charId);
    players.delete(charId);
    return p || null;
  },
  get(charId) {
    return players.get(charId) || null;
  },
  state(charId, s) {
    const p = players.get(charId);
    if (!p || !s) return;
    if (Number.isFinite(+s.x)) p.x = +s.x;
    if (Number.isFinite(+s.z)) p.z = +s.z;
    if (Number.isFinite(+s.yaw)) p.yaw = +s.yaw;
    if (Number.isFinite(+s.level) && +s.level > 0) { p.level = +s.level; p.dirty = true; }
    if (Number.isFinite(+s.exp)) { p.exp = +s.exp; p.dirty = true; }
    if (Number.isFinite(+s.hp)) p.hp = Math.max(0, +s.hp);
    if (s.zone) p.zone = String(s.zone).slice(0, 64);
    p.seen = Date.now();
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) p.dirty = true;
  },
  list(exceptId) {
    const out = [];
    for (const p of players.values()) {
      if (p.id === exceptId) continue;
      out.push({ id: p.id, name: p.name, cls: p.cls, level: p.level, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, zone: p.zone });
    }
    return out;
  },
  flush(dirtyMinutesOld) {
    /* WorldService'den düzenli çağrılır: kirli konumları peş peşe yazmayalim diye hepsi yuvarlanır */
    for (const p of players.values()) {
      if (p.dirty) {
        Char.saveState(p.id, p);
        p.dirty = false;
      }
    }
  },
};
