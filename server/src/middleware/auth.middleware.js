'use strict';
/* MIDDLEWARE — Bearer oturum kontrolü: req.auth = { user, token } */
module.exports = function authRequired(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  const q = new URL(req.originalUrl || req.url, 'http://x');   // ?token= da kabul (bağlantı araçları için)
  const Auth = require('../services/auth.service');
  const found = Auth.byToken(token || q.searchParams.get('token'));
  if (!found) {
    return res.status(401).json({ error: 'Oturum bulunamadı veya süresi doldu.' });
  }
  req.auth = found;   // { user, token, session }
  next();
};
