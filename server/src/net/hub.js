'use strict';
/* NET — websocket yayın yardımıcısı (hub): game.gateway ile chat.service'in paylaştığı yayın kanalı */
module.exports = {
  broadcast(message, exceptCharId) {
    const GameHub = require('./game.gateway');
    GameHub.broadcast(message, exceptCharId);
  },
};
