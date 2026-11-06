<div align="center">

# VPMarket

**Valorant Points e-pin satışı için açık kaynak, kurulumu kolay e-ticaret altyapısı.**

PayTR ve Shopier ödeme entegrasyonu · Otomatik kod teslimi · Yönetim paneli · Sıfır bağımlılık

![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=node.js&logoColor=white)
![Bağımlılık](https://img.shields.io/badge/ba%C4%9F%C4%B1ml%C4%B1l%C4%B1k-0-ff4655)
![Veritabanı](https://img.shields.io/badge/veritaban%C4%B1-SQLite-003B57?logo=sqlite&logoColor=white)

</div>

---

## Özellikler

### Mağaza
- Animasyonlu, mobil uyumlu modern arayüz
- Paket arama, filtreleme (popüler / indirimli) ve sıralama
- Ürün detay penceresi, sepet, adet seçimi
- Stok durumuna göre "Tükendi" gösterimi
- Her paket için otomatik üretilen e-pin kart görselleri

### Ödeme ve teslimat
- **PayTR** (iFrame API) ve **Shopier** entegrasyonu
- Yerel test için **demo ödeme** modu
- Ödeme onaylanınca stoktan **otomatik kod teslimi**
- Stok yetersizse sipariş "teslim bekliyor" durumuna düşer; kod eklendiğinde otomatik tamamlanır
- Müşteriye özel, gizli bağlantılı sipariş takip sayfası (kodlar canlı olarak güncellenir)
- Yeni ödemelerde isteğe bağlı **Discord** bildirimi

### Yönetim paneli
- Günlük / toplam ciro ve stok özeti
- Sipariş arama ve filtreleme
- Toplu kod yükleme (her satıra bir kod, tekrarlar otomatik atlanır)
- Elle kod teslimi, "ödendi olarak işaretle" (havale/EFT) ve iptal

### Güvenlik
- Fiyatlar yalnızca sunucuda hesaplanır; istemciden gelen tutar dikkate alınmaz
- PayTR ve Shopier bildirimlerinde HMAC imza doğrulaması, PayTR'de tutar kontrolü
- Aynı ödeme bildirimi tekrar gelse bile kod iki kez verilmez (transaction ile)
- Siparişler tahmin edilemeyen erişim anahtarıyla korunur
- Admin oturumu `HttpOnly` + `SameSite=Strict` çerez, CSRF başlığı ve giriş deneme sınırı
- Sipariş oluşturma için IP bazlı hız sınırı
- Content-Security-Policy ve diğer güvenlik başlıkları
- `config.json` ve veritabanı asla dışarı sunulmaz, dizin atlama engellidir

---

## Kurulum

Gereksinim: **Node.js 22.13 veya üzeri.** Başka hiçbir paket gerekmez.

```bash
git clone https://github.com/l1devz/vpmarket.git
cd vpmarket
node server.js
```

| Adres | Açıklama |
|---|---|
| http://localhost:5500 | Mağaza |
| http://localhost:5500/admin/ | Yönetim paneli |

İlk çalıştırmada `config.example.json` kopyalanarak **`config.json`** oluşturulur ve rastgele bir **admin şifresi** üretilir. Şifreyi `config.json` → `admin.password` alanında bulabilirsin.

> [!IMPORTANT]
> `config.json` (ödeme anahtarları, admin şifresi) ve `data/` (veritabanı, satılan kodlar) gizlidir ve `.gitignore` ile depodan hariç tutulur. Bu dosyaları asla paylaşma.

---

## Yapılandırma

Tüm ayarlar `config.json` dosyasındadır. Dosya kaydedildiğinde sunucu ayarları otomatik yeniden yükler.

| Alan | Açıklama |
|---|---|
| `site.name` | Mağaza adı |
| `site.baseUrl` | Sitenin gerçek adresi (ör. `https://vpmarket.com`). Ödeme dönüş bağlantıları buna göre oluşturulur. |
| `site.port` | Sunucu portu (varsayılan `5500`, `PORT` ortam değişkeni ile de ayarlanabilir) |
| `site.trustProxy` | Cloudflare / Nginx arkasında çalışıyorsa `true` |
| `site.supportEmail` | Müşterilere gösterilen destek adresi |
| `admin.password` | Admin şifresi (en az 10 karakter) |
| `payment.demo.enabled` | Test ödemesi — **canlıda mutlaka `false`** |
| `payment.paytr.*` | PayTR mağaza bilgileri |
| `payment.shopier.*` | Shopier API bilgileri |
| `notify.discordWebhook` | Ödeme bildirimleri için Discord webhook adresi (isteğe bağlı) |
| `store.allowBackorder` | `true`: stok bitse de satış yapılır, kod sonradan verilir |
| `store.maxQtyPerItem` | Bir üründen en fazla kaç adet alınabileceği |
| `products` | Ürün listesi: `id`, `vp`, `price`, `old` (indirim öncesi), `tags`, `badge` |

Ürün eklediğinde kart görselini üretmek için:

```bash
npm run cards
```

---

## Ödeme entegrasyonu

### PayTR

1. `payment.paytr` içine `merchantId`, `merchantKey`, `merchantSalt` değerlerini gir ve `enabled: true` yap.
2. PayTR Mağaza Paneli → **Bildirim URL**:
   ```
   https://SITEN.com/api/callback/paytr
   ```
3. Önce `testMode: true` ile test kartlarıyla dene; sorun yoksa `testMode: false` ve `debug: false` yap.

### Shopier

1. `payment.shopier` içine `apiKey` ve `apiSecret` değerlerini gir ve `enabled: true` yap.
2. Shopier Paneli → API ayarları → **Geri dönüş URL**:
   ```
   https://SITEN.com/api/callback/shopier
   ```
3. Küçük bir tutarla gerçek bir deneme ödemesi yap.

> [!NOTE]
> Ödeme bildirimleri ödeme kuruluşunun sunucusundan geldiği için **localhost üzerinde çalışmaz**. Gerçek ödeme testi için site HTTPS ile internete açık olmalıdır. Yerel geliştirmede demo ödeme modunu kullan.

---

## Sipariş akışı

```
Müşteri sepeti onaylar
        │
        ▼
Sunucu siparişi oluşturur (fiyat sunucudan)
        │
        ▼
PayTR / Shopier ödeme sayfası
        │
        ▼
Ödeme bildirimi (imza doğrulanır) ──► Discord bildirimi
        │
        ├── Stok yeterli  ──► Kodlar otomatik teslim edilir
        │
        └── Stok yetersiz ──► "Teslim bekliyor"
                                  │
                                  ├── Admin stoğa kod ekler ──► otomatik teslim
                                  └── Admin siparişe elle kod girer
```

| Durum | Anlamı |
|---|---|
| `pending` | Ödeme bekleniyor |
| `paid` | Ödendi, kod teslimi bekleniyor |
| `delivered` | Kodlar teslim edildi |
| `failed` | Ödeme başarısız |
| `cancelled` | İptal edildi |

---

## Proje yapısı

```
├── server.js              Sunucu: API, ödeme entegrasyonu, veritabanı, statik dosyalar
├── config.example.json    Örnek ayar dosyası
├── public/
│   ├── index.html         Mağaza
│   ├── odeme.html         Ödeme sayfası
│   ├── siparis.html       Sipariş takip ve kod görüntüleme
│   ├── admin/             Yönetim paneli
│   └── img/               Kart görselleri ve ikonlar
└── tools/
    └── generate-cards.mjs E-pin kart görseli üretici
```

---

## Canlıya almadan önce

- [ ] `payment.demo.enabled` → `false`
- [ ] `site.baseUrl` gerçek HTTPS adresi
- [ ] Güçlü bir `admin.password`
- [ ] PayTR / Shopier panelinde bildirim ve geri dönüş adresleri
- [ ] `site.supportEmail` ve `public/index.html` içindeki iletişim bilgileri
- [ ] Mesafeli Satış Sözleşmesi, KVKK Aydınlatma Metni ve İade Politikası sayfaları
- [ ] Site bir ters vekil sunucu (Nginx / Caddy / Cloudflare) arkasındaysa `site.trustProxy: true`
- [ ] `data/store.db` için düzenli yedekleme

---

## Yasal uyarı

Bu proje bağımsız bir e-ticaret altyapısıdır ve **Riot Games ile herhangi bir bağlantısı yoktur**. Valorant, Valorant Points ve ilgili logolar Riot Games, Inc.'in ticari markalarıdır. E-pin satışı yapmadan önce ilgili yasal düzenlemelere ve yayıncının kurallarına uygunluğu kendin kontrol etmelisin.
