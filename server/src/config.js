'use strict';
/* Merkezî yapılandırma: her değer env ile üstüne yazılabilir (online / local geçişi için). */
const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',
  STATIC_ROOT: process.env.STATIC_ROOT || path.join(__dirname, '..', '..'),   // proje kökü (index.html)
  DB_PATH: process.env.TDS_DB || path.join(__dirname, '..', 'data', 'atherion.sqlite'),
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000,                                   // oturum: 30 gün
  WORLD_TICK_MS: 100,                                                         // oyuncu listesi yayını (10 Hz)
  SAVE_INTERVAL_MS: 10000,                                                    // konum kaydırma
  CHAT_HISTORY: 50,
  VALID: {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    USERNAME: /^[a-zA-Z0-9_ ÇçĞğİıÖöŞşÜü]{3,16}$/,
    CHARNAME: /^[a-zA-Z0-9_ ÇçĞğİıÖöŞşÜü]{2,16}$/,
    CLASSES: ['warrior', 'archer', 'mage'],
  },
};
