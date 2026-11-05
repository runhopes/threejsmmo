/* Atherion giriş ekranları: oturum açma, kayıt, karakter listesi, karakter yaratma.
 * index.html'den AtherionScreens.init() ile başlatılır; karakter seçilmeden oyun açılmaz
 * (?cls= veya ?anim= debug yolları ekranları bypass eder).
 * Akış:
 *   jeton var → /api/me (karakter listesi de gelir)  → KARAKTER ekranı
 *   jeton yok → GİRİŞ / KAYIT sekmesi (e-posta · kullanıcı adı · şifre) → KARAKTER ekranı
 *   karakter seçildi → opts.onEnter(char)   (index.html: startGame(char))
 *   menü şeridindeki "Çıkış" → onay modalı → sunucuya veda (konum kaydı) + logout + yenileme
 */
(function (global) {
  'use strict';

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CLASS_TR = { warrior: 'Savaşçı', archer: 'Okçu', mage: 'Büyücü' };
  const CLASS_DESC = {
    warrior: 'Yakın dövüş · kılıç: 3 vuruşluk kombo, geniş savurmalar, girdap.',
    archer: 'Uzak menzil · yay: 16 m menzil, ok yağmuru, seri atış.',
    mage: 'Ateş büyüsü · asa: patlayan ateş topları, meteor, alev halkası.',
  };

  let opts = {};

  /* ── küçük yardımlar ── */
  function q(sel) { return document.querySelector(sel); }
  function viewBox(html) {
    const v = q('#at-view');
    v.innerHTML = `<div id="at-error" style="display:none"></div>` + html;
    const v2 = q('#at-view');
    v2.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => {
      const el = q('#at-error'); el.style.display = 'none';
    }));
    return v2;
  }
  function showError(msg) {
    const el = q('#at-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function busy(btn, label, on) {
    if (btn) { btn.disabled = !!on; btn.textContent = label; }
  }

  /* ── GİRİŞ / KAYIT ── */
  function showAuth() {
    q('#at-view').innerHTML = `
      <div id="at-tabs">
        <button class="at-tab on" data-t="in" type="button">GİRİŞ</button>
        <button class="at-tab" data-t="up" type="button">KAYIT</button>
      </div>
      <div id="at-error" style="display:none"></div>
      <form id="at-form" autocomplete="off">
        <div id="at-upfields" style="display:none">
          <label class="at-fld"><span>E-posta</span><input name="email" type="email" maxlength="64"></label>
          <label class="at-fld"><span>Kullanıcı adı</span><input name="username" type="text" maxlength="16"></label>
        </div>
        <label class="at-fld" id="at-infield"><span>Kullanıcı adı veya e-posta</span><input name="user" type="text" maxlength="64" required autofocus></label>
        <label class="at-fld"><span>Şifre</span><input name="password" type="password" maxlength="64" required></label>
        <button id="at-go" type="submit">OYUNA BAĞLAN</button>
      </form>
      <div class="at-note" id="at-note">E-posta · kullanıcı adı · şifre ile kayıt olabilirsin.</div>
    `;

    let mode = 'in';   // in | up
    q('#at-view').querySelectorAll('.at-tab').forEach((tb) => {
      tb.addEventListener('click', () => {
        mode = tb.dataset.t;
        q('#at-view').querySelectorAll('.at-tab').forEach((x) => x.classList.toggle('on', x === tb));
        q('#at-upfields').style.display = mode === 'up' ? 'block' : 'none';
        q('#at-infield').style.display = mode === 'up' ? 'none' : 'block';
        q('#at-infield input').required = mode === 'in';
        q('#at-go').textContent = mode === 'in' ? 'OYUNA BAĞLAN' : 'HESAP OLUŞTUR';
        q('#at-note').textContent = mode === 'in'
          ? 'E-posta veya kullanıcı adı + şifre ile giriş yap.'
          : 'E-posta · kullanıcı adı · şifre ile kaydol (şifren sunucuda hashlenir).';
        q('#at-error').style.display = 'none';
      });
    });

    q('#at-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, btn = q('#at-go');
      const body = Object.fromEntries(new FormData(f).entries());
      busy(btn, mode === 'in' ? 'BAĞLANICAK...' : 'OLUŞTURULUYOR...', true);
      try {
        const rep = mode === 'in' ? await global.Accounts.login(body) : await global.Accounts.register(body);
        global.Accounts.setToken(rep.token);
        const meR = await global.Accounts.me();
        showCharacters(meR.user, meR.characters || []);
      } catch (err) {
        showError(err.message || 'Sunucuya ulaşılamadı — `npm start` ile yerel sunucuyu başlat.');
        busy(btn, mode === 'in' ? 'OYUNA BAĞLAN' : 'HESAP OLUŞTUR', false);
      }
    });
  }

  /* ── KARAKTER ekranı ── */
  function showCharacters(user, chars) {
    q('#at-view').innerHTML = `
      <div id="at-who"><span class="at-dim">Hesap:</span> <b>${esc(user.username)}</b>
        <button id="at-out" type="button" class="at-mini">Çıkış</button></div>
      <h2 class="at-title">KAHRAMANLARIM</h2>
      ${!chars.length ? '<div class="at-empty">Henüz bir kahraman yok — ilk karakterini yarat!</div>' : ''}
      <div id="at-chars" class="at-cards">${chars.map((c) => `
        <button class="at-char" data-id="${c.id}" data-cls="${c.cls}">
          <b>${esc(c.name)}</b>
          <small>${esc(CLASS_TR[c.cls] || c.cls)} · Seviye ${c.level} · ${c.zone ? esc(c.zone) : 'başlangıç bölgesi'}</small>
          <p>${esc(CLASS_DESC[c.cls] || '')}</p>
          <span class="at-go">KARAKTERLE GİR</span>
        </button>`).join('')}</div>
      <div class="at-actions"><button id="at-new" type="button" class="at-ghost">+ YENİ KARAKTER YARAT</button></div>
      <div id="at-error" style="display:none"></div>
    `;

    q('#at-out').addEventListener('click', async () => {
      try { await global.Accounts.logout(); } catch { /* jeton zaten dolduysa sessiz geç */ }
      global.Accounts.setToken('');
      showAuth();
    });

    q('#at-view').querySelectorAll('.at-char[data-id]').forEach((cc) => {
      cc.addEventListener('click', () => {
        const c = chars.find((x) => String(x.id) === cc.dataset.id);
        if (!c) return;
        hideScreen();
        opts.onEnter && opts.onEnter(c);
      });
    });

    q('#at-new').addEventListener('click', () => showCreate());
  }

  /* ── KARAKTER YARATMA ── */
  function showCreate() {
    const v = viewBox(`
      <h2 class="at-title">YENİ KAHRAMAN</h2>
      <div id="at-clsv" class="at-cards">
        ${Object.keys(CLASS_TR).map((cls, i) => `
          <button class="at-char cls${i === 0 ? ' on' : ''}" data-cls="${cls}">
            <b>${esc(CLASS_TR[cls].toLocaleUpperCase('tr-TR'))}</b>
            <p>${esc(CLASS_DESC[cls])}</p>
          </button>`).join('')}
      </div>
      <label class="at-fld"><span>Karakter adı</span><input id="at-name" type="text" maxlength="16" placeholder="örn. Zeynep Kılıç" autocomplete="off"></label>
      <div class="at-actions two">
        <button id="at-create" type="button" class="at-go">KARAKTERİ OLUŞTUR</button>
        <button id="at-cancel" type="button" class="at-ghost">GERİ</button>
      </div>
    `);
    let cls = Object.keys(CLASS_TR)[0];
    v.querySelectorAll('.at-char.cls').forEach((cc) => cc.addEventListener('click', () => {
      cls = cc.dataset.cls;
      v.querySelectorAll('.at-char.cls').forEach((x) => x.classList.toggle('on', x === cc));
    }));
    v.querySelector('#at-cancel').addEventListener('click', async () => {
      try { const meR = await global.Accounts.me(); showCharacters(meR.user, meR.characters || []); } catch { showAuth(); }
    });
    v.querySelector('#at-create').addEventListener('click', async () => {
      const name = v.querySelector('#at-name').value;
      const btn = v.querySelector('#at-create');
      busy(btn, 'YARATILIYOR...', true);
      try {
        await global.Accounts.createChar({ name, cls });
        const meR = await global.Accounts.me();
        showCharacters(meR.user, meR.characters || []);
      } catch (e) {
        showError(e.message || 'Karakter yaratılamadı.');
        busy(btn, 'KARAKTERİ OLUŞTUR', false);
      }
    });
    setTimeout(() => { try { v.querySelector('#at-name').focus(); } catch { } }, 30);
  }

  /* ── Çıkış onay modalı (menü şeridindeki Çıkış düğmesinin getirdiği) ── */
  function showExitConfirm(onYes) {
    q('#at-view').innerHTML = `
      <h2 class="at-title">ÇIKIŞ</h2>
      <div class="at-empty">Oyundan çıkılsın mı? Son konumun ve ilerlemen kaydedilecek.</div>
      <div class="at-actions two">
        <button id="at-exit-yes" type="button" class="at-go">KAYDET VE ÇIK</button>
        <button id="at-exit-no" type="button" class="at-ghost">GERİ DÖN</button>
      </div>
      <div id="at-error" style="display:none"></div>
    `;
    const root = q('#at-screen');
    root.hidden = false;
    q('#at-exit-no').addEventListener('click', () => { root.hidden = true; });
    q('#at-exit-yes').addEventListener('click', () => { root.hidden = true; onYes && onYes(); });
  }

  function hideScreen() {
    const root = q('#at-screen');
    if (root) root.hidden = true;
  }

  global.AtherionScreens = {
    async init(options) {
      opts = options || {};
      const root = q('#at-screen');
      if (!root) return;
      /* panel iskeleti: perde + panel + görünüm kutusu (showAuth / showCharacters doldurur) */
      root.innerHTML = `
        <div id="at-scrim"></div>
        <div id="at-panel">
          <div id="at-brand"><h1>ATHERION</h1><span class="at-sub">online alan · savaş · macera</span></div>
          <div id="at-view"></div>
          <div id="at-foot">Atherion Çevrimiçi</div>
        </div>
      `;
      root.hidden = false;
      /* otomatik giriş: geçerli bir jeton varsa doğrudan karakter ekranı */
      try {
        if (global.Accounts.token()) {
          const meR = await global.Accounts.me();
          if (opts.onAuthed) opts.onAuthed(meR.user, meR.characters || []);
          showCharacters(meR.user, meR.characters || []);
          return;
        }
      } catch { /* jeton süresi doldu → sil, giriş ekranı */ global.Accounts.setToken(''); }
      if (opts.onAuthed) opts.onAuthed(null, []);
      showAuth();
    },
    exitConfirm() {
      showExitConfirm(async () => {
        try { global.Net && global.Net.leave(); } catch { }
        try { if (global.Accounts.token()) { await global.Accounts.logout(); global.Accounts.setToken(''); } } catch { }
        global.location.reload();   // temiz yeniden giriş ekranı
      });
    },
    CLASS_TR, CLASS_DESC,
  };
})(window);
