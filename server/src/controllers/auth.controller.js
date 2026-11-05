'use strict';
/* CONTROLLER — kimlik doğrulama uçları */
const service = require('../services/auth.service');
const mw = require('../middleware/auth.middleware');

function open(fn) {
  return (req, res) => {
    try { res.json(fn(req, res)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || 'Sunucuda bir sorun oldu.' }); }
  };
}
function secure(fn) {
  return [mw, (req, res) => {
    try { res.json(fn(req, res)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || 'Sunucuda bir sorun oldu.' }); }
  }];
}

module.exports = (app) => {
  app.post('/api/register', open((req) => service.register(req.body || {})));
  app.post('/api/login', open((req) => service.login(req.body || {})));
  app.post('/api/logout', secure((req) => { service.logout(req.auth.token); return { ok: true }; }));
  app.post('/api/me/delete', secure((req) => { service.deleteAccount(req.auth.user.id, (req.body || {}).password); return { ok: true }; }));
  app.get('/api/me', secure((req) => {
    const Char = require('../services/character.service');
    return { user: req.auth.user, characters: Char.list(req.auth.user.id) };
  }));
};
