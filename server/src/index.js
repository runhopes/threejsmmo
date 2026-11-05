'use strict';
/* Başlangıç noktası: `node server/src/index.js` (veya npm start) → http://localhost:3000 */
const config = require('./config');
const createApp = require('./app');
const gateway = require('./net/game.gateway');
const World = require('./services/world.service');

const app = createApp();
const server = app.listen(config.PORT, config.HOST, () => {
  console.log('[Atherion] local server: http://localhost:' + config.PORT);
});

gateway.attach(server);
const Session = require('./models/session.model');
Session.purgeExpired();
setInterval(() => Session.purgeExpired(), 60 * 60 * 1000).unref();
setInterval(() => World.flush(), config.SAVE_INTERVAL_MS);
setInterval(() => gateway.broadcastWorld(), config.WORLD_TICK_MS);

/* temiz kapanış: Ctrl+C / kill → çevrimiçi herkesin konumunu diske yaz */
function shutdown() {
  try { World.flush(); } catch (e) { console.error('[Atherion] kapanışta kayıt hatası:', e.message); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
/* bir hata tüm oyunculara mal olmasın */
process.on('uncaughtException', (e) => console.error('[Atherion] beklenmeyen hata:', e));
process.on('unhandledRejection', (e) => console.error('[Atherion] işlenmeyen reddedilme:', e));
