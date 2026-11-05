/* Atherion account API — REST callfrustum (hesap, karakterler).
 * Oturum jetonu localStorage'da (tdsm_token); server ve ws aynı jetonu kullanır.
 * Bağımsız mod (server yok / ?offline=1): her çağrı promisler; tek fark karşı tarafta lokal çalışır.
 */
(function (global) {
  'use strict';
  const TOKEN_KEY = 'tdsm_token';
  const OFFLINE = /[?&]offline=1/.test(global.location.search);

  async function call(method, url, body) {
    if (OFFLINE) throw new Error('offline');
    const res = await fetch(url, {
      method, headers: {
        'Content-Type': 'application/json',
        ...(global.localStorage.getItem(TOKEN_KEY) ? { Authorization: 'Bearer ' + global.localStorage.getItem(TOKEN_KEY) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* boş gövde */ }
    if (!res.ok) { const e = new Error((data && data.error) || 'Bağlantı hatası'); e.status = res.status; throw e; }
    return data;
  }

  global.Accounts = {
    TOKEN_KEY, OFFLINE,
    token() { return global.localStorage.getItem(TOKEN_KEY) || ''; },
    setToken(t) { if (t) global.localStorage.setItem(TOKEN_KEY, t); else global.localStorage.removeItem(TOKEN_KEY); },
    register: (d) => call('POST', '/api/register', d),
    login: (d) => call('POST', '/api/login', d),
    logout: () => call('POST', '/api/logout'),
    me: () => call('GET', '/api/me'),
    characters: () => call('GET', '/api/characters'),
    createChar: (d) => call('POST', '/api/characters', d),
  };
})(window);
