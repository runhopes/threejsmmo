# Vuruş / ölüm / EXP geri bildirimi — Atherion → tdsmoba spec

Kaynak (doğruluk kaynağı kod): `atherion/scripts/vfx/mob_hit_fx.gd`, `hit_spark.gd` + `shaders/hit_spark.gdshader`,
`impact_sparks.gd`, `hit_anchor.gd`, `hit_flash.gd`, `death_burst.gd`, `explosion_smoke.gd`, `damage_number.gd`,
`exp_orb.gd`, `level_up_effect.gd`, vendor `assets/vfx/hit/effects/hit/vfx_hit_07.tscn` (+ glow / streaks / four_point_star /
flare shaders), `assets/vfx/magic_areas/*` ; çağıranlar `mob_controller.gd` (receive_damage, _on_died), `player_controller.gd`
(_apply_damage, take_mob_damage, receive_exp, _on_level_up). Niyet: `carpma_isareti_tasarim.html`, `vurus_impact_tasarim.html`.

**Birim:** 1 Atherion birimi = 1.95 / 26.1 m (gövde 26.1 u = kahraman 1.95 m; `ui/feedback.js` ile aynı). Mob-göreli her şey
**gövde yarıçapı r** ile ölçeklenir: tipik Atherion mobu r = 6.3 u, boy 26.75 u → tdsmoba'da `r = boy × 0.2355`
(`ImpactFX.bodyRadius(D.height)`); oyuncu / yedek r = 6.3 u = 0.47 m.

## 1. Bir isabet (MobHitFx.spawn) — her kabul edilen hasarda, öldüren vuruş dahil
Bayraklar: `heavy` = yere seren vuruş (3. kombo savuruşu ya da beceri; öldüren vuruş ve boss'ta %90 değil),
`crit`, `self` (yerel oyuncunun kendi gövdesi → kırmızı palet, kıvılcım yok), `kind` = sınıf (knight **bıçak**, archer **ok**, mage yok).

**Çıpa** (hepsi aynı noktadan çıkar, gövdeye bağlı kalır — mob yürürse efekt de gider):
1. mermi / AoE noktası varsa: gövde kapsülüne kırp (y ∈ [0.35 r, 3.65 r], yatay ≤ r), kameraya **0.35 r** it;
2. yoksa ve `kind` varsa: gövdenin saldırana bakan yüzü, yükseklik **2 r**; yüz kameraya bakmıyorsa 3'e düş; 0.35 r it;
3. gövde merkezi (0, 2 r, 0), kameraya **1.0 r** it. (Melee nokta taşımaz → hep 2/3.)

| katman | ne | sayılar |
|---|---|---|
| 1 **Kor patlaması** (VFXHit_07, sıcak/geniş) | ölçek S = 2.6 r (ağır ×1.35); palet birincil (1, .90, .55) / ikincil (1, .30, .05), ışık #FF731F; self: (1, .10, .07)/(.88, .02, .02), kendi gövdende en çok 3 | Glow küresi r .5·S, ölçek 3→0 / 0.2 s (ease-out), fresnel pow 8, emisyon 2 · ışınsal çizgi patlaması 1 parça, quad 3·S, ölçek .76→1, alfa 1→0, 0.3 s, 15+21 çizgi, emisyon 4 · 2 dört-köşe yıldız (HitCore) quad .7×.3, ölçek 3–5 × eğri, 0.6 s, yıldız üsseli .6×alfa · halka parlaması quad 1.2, ölçek 1–2 × (.55→1), alfa .9→0, 0.8 s, 12 ışın · 8 iğ kıvılcım (küre r .05 h .6, hıza hizalı), 4–7 u/s ×S, yerçekimi −10·S, 0.3 s · OmniLight enerji 4, 0.2 s'de söner |
| 2 **Çarpma işareti** (HitSpark, soğuk/dar) | tasarım yarıçapı 2.6 r (ağır ×1.15, krit ×1.30), krit kalınlık ×1.55; renk çekirdek beyaz / kenar #C9D6E0 / buz #96C0E2 (self kırmızı); mob başına en çok 3 | **CROSS** (normal, 320 ms): iki hilal bıçak 0–195 / 48–243 ms (açı aralığı 1.02–1.40 rad, rastgele dönüş), çekirdek yıldız 48–183 ms (dikey kol %50), şok halkası 48–238 ms, kıvılcım demeti 6–304 ms (bıçak eksenlerinde 12). **SHATTER** (ağır, 520 ms): anamorfik parlama 0–125, çekirdek 72 ms tutunur, halka 0–300 + soğuk halka 66–411, 12 kıvılcım tam daire 58–403, 9 kırık parça 72–507. Yoğunluk 1.6 (HDR) |
| 3 **Gövde flaşı** | mobun kendi rengini çeliğe karıştırır (overlay, blend_mix) | normal %34 / 0.10 s, krit %50 / 0.16 s, doğrusal söner; renk çelik (.788, .839, .878), self kızıl (.78, .04, .04) |
| 4 **Kıvılcım** (ImpactSparks) | yalnız bıçak/ok; 2/3 ileri lop – 1/3 geri; lop içinde yelpaze; iz = son 40 ms'lik yol; sıcak beyaz → turuncu → kor | normal 5–6 / 120–180 ms / uzunluk 4.13–5.40 r / lop ±.79 · krit 7–8 / 160–220 / 4.76–6.35 r / ±.96 · ağır 9–10 / 180–260 / 5.08–6.98 r / ±.96 / yerçekimi 1.2 · ok 2–3 / 90–140 / 3.17–4.44 r / ±.52 (geri saçılma). Eksen: bıçak = saldırandan uzağa + yukarı + savuruş teğeti; ok = atıcıya doğru + hafif yukarı. Çekirdek .025 r (≥.9 px), hale .08 r (≥3.5 px) |

Kamera sarsıntısı / FOV darbesi / kombo arası donma (hit-stop) Atherion'da oyuncunun kombo zamanlamasına bağlı (savuruş arası
0.05 s donma + 0.08 s rampa, sonra trauma .95 + .30·savuruş, FOV −4 + savuruş); mob isabet efekti bunlardan bağımsız, gerçek
zamanda oynar. Geri itme / nudge (0.08 × ölçek, 0.10 s) offline-yalnız oyun mantığıdır, online sunucu otoriter.

## 2. Hasar sayısı (DamageNumber)
Doğum: vurulan gövdenin **ayağından 6.0 u** yukarıda (±0.35 u), alınan hasar **8.4 u**; düz rakam (`str(int)`), ayraç yok.
M2 yay: dikey 78–102 u/s, sönüm 6/s; yan 64–100 u/s **her doğumda zıt yöne**, sönüm 5/s; derinlik 0–16 u/s; ömür 1.70 s
(krit ×1.15); belirme 0.18 s; sönme %48'den 1−u². Punto 108 (krit 216, alınan 112) × log merdiveni 0.78–1.28 (40–3000);
Cinzel 900, 8° eğik, kontur %9. Krit: 3× çakma 0.05, sarsıntı + nabız 0.13, beyaz-sıcak parlama, turuncu hale.
Yığma yok; havuz 64.

## 3. Ölüm (mob_controller._on_died)
**DeathBurst**: 50 bulut parçası, halka r .3 u, yatay ışınsal 8–13 u/s, sönüm 2–4, ölçek 1.5–3 × quad 2.5 u (eğri .2→1→1.2→.6),
beyaz, Y-billboard, ömür 1.0 / hız 1.5 (≈0.67 s). **ExplosionSmoke** (×2): 8 gri bulut, ömür 1.9 / hız 1.3, ölçek 3–5 × quad 5 u
(.4→1), %30 koni yukarı 2.5–4.5 u/s, kaldırma 1.4. + öldüren vuruşun isabet efekti.

## 4. EXP küresi (ExpOrb) — offline Atherion'da EXP'nin otoritesi küredir
Ölümden **0.3 s** sonra tek küre, ödülün tamamı. Doğuş 0.38 s (yay, 1.05–1.45 u yukarı, .35–.95 u saçılma) → dönüş 0.62 s
(hedef etrafında yarım tur, yarıçap → 1.08 u, hedef yüksekliği 1.45 u) → güdümlü uçuş 12→120 u/s (ivme 180, dönüş 13,
salınım .72 / 2.15 Hz) → **0.72 u'da emilir, EXP o anda verilir**. 1.35 s zaman aşımı ya da 28 u uzaklık → hedefe ışınlanıp
emilir; canlı tavan 16 aşılırsa EXP anında verilir → **hiçbir EXP kaybolmaz**. Görsel: çekirdek r .30 u, kabuk .58, aura .98
(fresnel altın→camgöbeği), parlama quad 1.45, iki halka, 32 noktalı iki şerit iz (.28 / .085 u).
Not: kürenin boyut/yükseklik sabitleri Atherion'da gövde büyütmesinden önceki ölçekte kalmış (1.45 u = bilek hizası);
port bunu birebir taşır (`vfx/progress.js` ORB tablosu).

## 5. Seviye atlama (LevelUpEffect)
Üç alan: **lift** (ölçek 7 × 11.2 × 7: üç açık silindir r 1.2–1.4, h 3–4, yükselen altın çizgiler + yer düzlemi 3.7),
**rim** (10×: yer halkaları 3.4 / 6 / 5, iki kısa yukarı bant), **pulse** (10×: iki yer quad'ı 4.5, ince halkalar). Palet
birincil (1, .918, .8) / ikincil (1, .906, 0). **1.5 s tam**, **1.0 s söner**, karakterin x/z'sini izler, tek ışık (enerji 3).
Yeni seviye bir öncekini değiştirir.

## tdsmoba eşlemesi
`vfx/impact.js` (ImpactFX: katman 1–4, çıpa, ölüm, kahraman flaşı) · `vfx/progress.js` (ProgressFX: küre, seviye) ·
`creatures/core.js` (quantize flaş ikizleri, tek program) · `ui/feedback.js` (yığma kaldırıldı, havuz 64) ·
`index.html` (`impactHit` + `dealDamage` / `takeDamage` / `onKill` / `gainExp`). Kaçış: vendor dokuları yerine prosedürel
gürültü; Godot Filmic+bloom yerine efektin kendi katkısı yumuşak sıkıştırılır (`1 − e^(−1.1x)`).
