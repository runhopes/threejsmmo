'use strict';
/* SERVİS — kimlik doğrulama: scrypt hash + oturum jetonu */
const crypto = require('crypto');
const config = require('../config');
const User = require('../models/user.model');
const Session = require('../models/session.model');

const SCRYPT_K = { N: 16384, r: 8, p: 1, keylen: 64 };

function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, SCRYPT_K.keylen, SCRYPT_K).toString('hex');
  return `${salt}:${key}`;
}
function verify(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const test = crypto.scryptSync(password, salt, SCRYPT_K.keylen, SCRYPT_K).toString('hex');
  const a = Buffer.from(key, 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  register({ email, username, password }) {
    email = String(email || '').trim();
    username = String(username || '').trim();
    if (!config.VALID.EMAIL.test(email)) throw http(400, 'Geçerli bir e-posta gir.');
    if (!config.VALID.USERNAME.test(username)) throw http(400, 'Kullanıcı adı 3-16 karakter (harf, rakam, _).');
    if (String(password || '').length < 6) throw http(400, 'Şifre en az 6 karakter olmalı.');
    const dup = User.exists(email, username);
    if (dup.email) throw http(409, 'Bu e-posta zaten kayıtlı.');
    if (dup.username) throw http(409, 'Bu kullanıcı adı alınmış.');
    const user = User.create({ email, username, passhash: hash(password) });
    return this.login({ user: email, password });   // kayıt hemen oturum açar (tek dönüş: token + user)
  },

  login({ user, password }) {
    user = String(user || '').trim();
    const row = user.includes('@') ? User.byEmail(user) : User.byUsername(user);
    if (!row || !verify(String(password || ''), row.passhash)) throw http(401, 'Kullanıcı veya şifre hatalı.');
    const s = Session.create(row.id);
    return { token: s.token, expires: s.expires, user: User.byId(row.id) };
  },

  /* token → kullanıcı (middleware + websocket gözcüsü kullanır) */
  byToken(token) {
    const s = Session.valid(token);
    if (!s) return null;
    const user = User.byId(s.user_id);
    return user ? { user, token, session: s } : null;
  },
  logout(token) {
    Session.destroy(token);
  },
};

function http(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
