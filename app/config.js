/* Atherion istemci yapılandırması — web ve mobil uygulama (Capacitor) aynı dosyaları kullanır.
 *  - Web (mmorpg.thebora.dev / localhost:3000): API aynı origin'de → taban adres ''.
 *  - Native uygulama (iOS: capacitor://localhost, Android: https://localhost): oyun dosyaları uygulamanın içinde,
 *    API + WebSocket canlı sunucuda → https://mmorpg.thebora.dev.
 *  Geliştirme için üstüne yazma: localStorage['tdsm_api'] = 'http://192.168.1.20:3000'  (veya ?api=...). */
(function (global) {
  'use strict';
  const PROD = 'https://mmorpg.thebora.dev';
  const cap = global.Capacitor;
  const native = !!(cap && (cap.isNativePlatform ? cap.isNativePlatform() : cap.isNative));
  let base = native ? PROD : '';
  try {
    const qs = /[?&]api=([^&#]+)/.exec(global.location.search);
    const ov = qs ? decodeURIComponent(qs[1]) : global.localStorage.getItem('tdsm_api');
    if (ov) base = ov.replace(/\/+$/, '');
  } catch { /* depolama kapalı olabilir */ }
  const ws = base ? base.replace(/^http/, 'ws') + '/ws'
    : (global.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + global.location.host + '/ws';
  global.AtherionConfig = {
    NATIVE: native,
    PLATFORM: native && cap.getPlatform ? cap.getPlatform() : 'web',
    API_BASE: base,
    WS_URL: ws,
    PRIVACY_URL: PROD + '/privacy.html',
  };
  if (native) global.document.documentElement.classList.add('is-native', 'is-' + global.AtherionConfig.PLATFORM);
})(window);
