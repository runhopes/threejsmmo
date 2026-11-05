'use strict';
/* CONTROLLER — karakter uçları */
const service = require('../services/character.service');
const mw = require('../middleware/auth.middleware');

function secure(fn) {
  return [mw, (req, res) => {
    try { res.json(fn(req, res)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || 'Sunucuda bir sorun oldu.' }); }
  }];
}

module.exports = (app) => {
  app.get('/api/characters', secure((req) => ({ characters: service.list(req.auth.user.id) })));
  app.post('/api/characters', secure((req) => ({ character: service.create(req.auth.user.id, req.body || {}) })));
  app.delete('/api/characters/:id', secure((req) => ({ ok: service.remove(req.auth.user.id, +req.params.id) })));
};
