# Atherion — Ağ Sunucusu (TDS MOBA Backend)

Oyunu çok oyunculu hale getiren Node.js backend'i. Node ≥ 22.5 gerektirir
(kod, yerleşik `node:sqlite` modülünü kullanır; ek bağımlılık yoktur).

## Çalıştırma

```bash
# proje kökünden
npm start            # → node server/src/index.js
```

Sunucu ayağa kalkarken:

- http://localhost:3000 → oyunun kendisi (`index.html` express tarafından servis edilir)
- http://localhost:3000/health → durum kontrolü `{ ok: true }`
- ws://localhost:3000/ws → dünya senkronizasyonu (WebSocket)

Port vb. ayarlar `src/config.js` içindedir. SQLite dosyası
`server/data/atherion.sqlite` olarak oluşturulur (WAL modunda; `data/`
yoksa otomatik oluşur).

## Mimari — MVC

```
server/src/
├── config.js                  # port, token/session süreleri, kaydetme aralığı
├── index.js                   # giriş noktası: HTTP + WS + flush/tick döngüleri
├── app.js                     # express uygulaması (statik + REST + hata yolu)
├── db/
│   └── index.js               # DatabaseSync, şema (users, sessions, characters, chat_messages)
├── models/                    # saf veri erişimi (model katmanı)
│   ├── user.model.js          # kullanıcı: oluştur/bul
│   ├── session.model.js       # oturum tokenları: yaratma/bulma/silme (temizlik dahil)
│   ├── character.model.js     # karakterler: listele/oluştur/sil/konum-ilerleme kaydı
│   └── chat.model.js          # sohbet geçmişi: ekle/son kayıtları getir
├── services/                  # iş kuralları (servis katmanı)
│   ├── auth.service.js        # kayıt/giriş + scrypt hash doğrulaması, token bazlı oturum
│   ├── character.service.js   # karakter CRUD doğrulamaları (sınıf, isim tekrarı)
│   ├── world.service.js       # çevrimiçi oyuncu kaydı, durum işleme, 10 sn'de bir flush
│   └── chat.service.js        # mesaj doğrulama + kalıcılık + geçmiş
├── controllers/               # HTTP isteklerini karşılayan katman
│   ├── auth.controller.js     # register/login/logout/me
│   └── character.controller.js# list/create/delete
├── routes/
│   └── index.js               # /api yol haritası
├── middleware/
│   └── auth.middleware.js     # `Authorization: Bearer <token>` zorunluluğu
└── net/                       # gerçek zamanlı katman
    ├── game.gateway.js        # WS protokolü (aşağıda) + dünya yayınları
    └── hub.js                 # bağlantı kaydı / yayın yardımcıları
```

## REST API

Tümü `/api` önekiyle; JSON gövdeli. Auth gerektiren uçlar Bearer token ile çağrılır.

| Yol                     | Metot | Açıklama |
|-------------------------|-------|----------|
| `/health`               | GET   | Hizmet denetimi |
| `/api/register`         | POST  | `{ email, username, password }` → kullanıcı + oturum |
| `/api/login`            | POST  | `{ username \| email, password }` → oturum |
| `/api/logout`           | POST  | Auth → oturumu siler |
| `/api/me`               | GET   | Auth → mevcut kullanıcı |
| `/api/characters`       | GET   | Auth → karakter listesi |
| `/api/characters`       | POST  | Auth → karakter oluştur `{ name, cls }` |
| `/api/characters/:id`   | DELETE| Auth → karakteri sil |

Dönen token hem REST (Bearer) hem WS katılımı için kullanılır.
Hatalar standart `{ error: "..." }` gövdesiyle gelir (ör. aynı kullanıcı
adıyla tekrar kayıt → `409`).

## WebSocket Protokolü (`/ws`)

Mesajlar JSON: `{ t, ...data }` (alan adı `t`).

1. **join** (istemci→sunucu) — ilk mesaj: `{ t:'join', token, charId }` (8 sn içinde gelmezse / token ya da karakter sahipliği geçersizse soket 1008 ile kapanır; aynı karakter ikinci kez açılırsa eski bağlantıya `kicked` gider ve 4000 ile düşürülür)
2. **welcome** (sunucu→istemci) — `{ you:{id,name,cls,level,hp,x,z,yaw,zone}, players:[...], chat:[...] }` (sohbet geçmişi dahil)
3. **state** (istemci→sunucu) — olağan durum: `{ x, z, yaw, zone, level, exp, hp }`, 10 Hz
4. **players** (sunucu→istemci) — diğer oyuncuların anlık durumu (kendisi hariç), 10 Hz
5. **chat** (iki yönlü) — `{ from, text }`; tüm mesajlar `chat_messages` tablosuna yazılır
6. **sys** (sunucu→istemci) — sistem satırları ("X oyuna katıldı / oyundan ayrıldı")
7. **bye** (istemci→sunucu) — temiz çıkış: pozisyonu kaydet + dünyadan çıkar

Oyuncu durumu her `SAVE_INTERVAL_MS` (10 sn) ve ayrıca `bye` ya da bağlantı
kopması anında `characters` tablosuna yazılır.

## İstemci Tarafı

Oyunun kendi ağ kodu `app/` klasöründedir: `api.js` (REST + `localStorage['tdsm_token']`),
`net.js` (WS, uzak oyuncular), `screens.js` (GİRİŞ/KAYIT/karakter ekranları).
Geliştirme bypass'ı: `?cls=warrior|archer|mage` veya `?anim=1` sorgu parametreleri
kayıt akışını atlar (eski sınıf seçim akışı korunur).

## Güvenlik / dayanıklılık

- Statik servis `server/`, `.git`, `tools`, `package*.json`, `CLAUDE.md` ve nokta-dosyalarını **404** verir (DB'de hash + oturum tokenı var).
- Sohbet: soket başına en az 400 ms arayla mesaj; `join` olmadan mesaj işlenmez; mesaj işleyicisi try/catch içinde (tek kötü paket sunucuyu düşürmez).
- Süresi dolan oturumlar açılışta ve saatte bir silinir; `SIGINT/SIGTERM`'de çevrimiçi herkesin konumu diske yazılır.

## Notlar

- `server/data/` ve `node_modules/` depoda izlenmez; ilk çalıştırmada otomatik oluşur.
- Parolalar scrypt ile hash'lenir; tokenlar sunucu tarafında saklanır ve isteğe bağlı
  süre sonunda `session.model.js` içindeki temizlikle silinir.
