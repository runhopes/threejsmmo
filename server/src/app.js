'use strict';
/* Express uygulaması: statik oyun dosyaları + JSON API. WebSocket ayrıca (net/game.gateway). */
const path = require('path');
const express = require('express');
const config = require('./config');

module.exports = function createApp() {
  const app = express();
  app.disable('x-powered-by');
  /* mobil uygulama (Capacitor) farklı origin'den çağırır: capacitor://localhost (iOS), https://localhost (Android) */
  const APP_ORIGINS = /^(capacitor:[/][/]localhost|https?:[/][/]localhost(:[0-9]+)?|ionic:[/][/]localhost)$/;
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && APP_ORIGINS.test(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
  for (const mount of require('./routes')) mount(app);
  /* proje kökü servis edilir, ama sunucu kodu / veritabanı / git / araçlar asla (parola hash'leri + oturum tokenları orada) */
  const BLOCK = /^[/](server|[.]git|[.]claude|node_modules|tools|shots|skills-lock[.]json|package(-lock)?[.]json|CLAUDE[.]md)([/]|$)/i;
  app.use((req, res, next) => {
    let p = req.path;
    try { p = decodeURIComponent(p); } catch { return res.status(400).end(); }
    if (BLOCK.test(p) || /(^|[/])[.][^/]/.test(p)) return res.status(404).end();
    next();
  });
  app.use(express.static(config.STATIC_ROOT, { extensions: ['html'], dotfiles: 'ignore' }));
  /* henüz bilinmeyen api yolu: düzgün hata */
  app.use('/api', (req, res) => res.status(404).json({ error: 'Bilinmeyen API yolu.' }));
  return app;
};
