# Basic Docker

**Docker'ı mala anlatır gibi yöneten, Mac'e özel (native) uygulama.**
5 konteynerli bir proje ekranda tek kart olarak görünür. Tek tuşla hepsi açılır, tek tuşla hepsi kapanır.

![Basic Docker ana ekran](docs/ana.png)

Docker Desktop güçlü ama kalabalık. Bir projede `proje-web-1`, `proje-db-1`, `proje-redis-1`, `proje-worker-1` gibi
isimler birikince neyin ne olduğu karışıyor. Basic Docker bunları **uygulama** olarak toplar ve her parçanın ne işe
yaradığını sade Türkçeyle söyler.

## Neler yapar?

- **Bir uygulama = bir kart.** Docker Compose projeleri kendiliğinden gruplanır. Tek başına duran konteynerleri de istediğin karta taşıyabilirsin.
- **Tek tuş.** Başlat'a basınca uygulamanın bütün parçaları doğru sırayla açılır, Durdur'a basınca hepsi kapanır.
- **Her parça sade dille açıklanır.** "Veritabanı (PostgreSQL)", "Arka plan işçisi", "Zamanlayıcı", "Test e-posta kutusu" gibi. Parçanın durumu, kapıları (portları), veri kutuları (volume) ve kaynak kullanımı da görünür.
- **Bağlantı adresi hazır gelir.** Veritabanı parçalarında `.env` dosyana yapıştıracağın `DATABASE_URL=…` satırı tek tıkla kopyalanır.
- **Kayıtlar (log) okunur.** Hatalar kırmızıyla gösterilir. "Kopyala" deyip yapay zekâya sorabilirsin.
- **Sorunu söyler.** Sürekli çöken, sağlık kontrolünden geçemeyen ya da hata verip kapanan parçaları kart üzerinde uyarır.
- **Yeni ekleme üç yoldan yapılır:**
  - **Hazır parça:** PostgreSQL, MySQL, MongoDB, Redis, Mailpit, Adminer, MinIO, RabbitMQ, Meilisearch, n8n. Şifre, kapı ve veri kutusu otomatik ayarlanır.
  - **Proje klasörüm:** `docker-compose.yml` olan klasörü seçersin, her şey tek seferde kurulur.
  - **Docker Hub'dan imaj:** İstediğin imajı kendi kapı ve ayarlarınla çalıştırırsın.

![Hazır parça seçimi](docs/yeni.png)

![Uygulama ayrıntıları](docs/detay.png)

## Kurulum

Gerekenler: **macOS 11+**, **Python 3.9+** (macOS'ta hazır gelir), **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**.

```bash
git clone https://github.com/benysff/basic-docker.git
cd basic-docker
./kur.command
```

Kurulum 1-2 dakika sürer. Bitince uygulama **Uygulamalar** klasörüne yerleşir ve açılır.
Bundan sonra Launchpad'den ya da Spotlight'tan (⌘ + boşluk → *Basic Docker*) açarsın; terminal açılmaz.

> Klonladığın klasörü taşırsan ya da `git pull` ile güncellersen `./kur.command`'ı tekrar çalıştır.

## Sık sorulanlar

**Yeni projem otomatik görünür mü?**
`docker compose up` ile çalıştırdıysan evet, kendiliğinden tek kart olur. Konteynerleri tek tek `docker run` ile
açtıysan ayrı kartlar olarak görünürler; ayrıntılardaki **Uygulamaya ekle** ile birleştirebilirsin.

**`docker compose down` yaparsam kart kaybolur mu?**
Hayır. Compose projeleri hatırlanır. Kartta Başlat'a basınca proje klasöründen yeniden kurulur.

**Silince verilerim gider mi?**
Varsayılan olarak hayır. Veriler (veri kutuları) korunur. Silmek için ayrıca "Verileri de sil" kutusunu
işaretlemen gerekir. Proje klasörüne ve kodlarına hiçbir zaman dokunulmaz.

**Güvenli mi?**
Hazır parçaların kapıları sadece senin bilgisayarına açılır (`127.0.0.1`), ağdaki başkaları erişemez.
Uygulama ağa hiçbir şey açmaz; tamamen yerel çalışır ve sadece `docker` komutunu kullanır.

## Nasıl çalışır?

Basic Docker bir Python uygulamasıdır. Arayüzü [pywebview](https://pywebview.flowrl.com/) ile native bir macOS
penceresinde (WKWebView) açar. Web sunucusu ya da port kullanmaz: arayüz Python fonksiyonlarını doğrudan çağırır.
Docker ile sadece `docker` komut satırı aracı üzerinden konuşur.

Konteynerleri şu sırayla gruplar:

1. Basic Docker ile kurulanlar (`basicdocker.app` etiketi)
2. Docker Compose projeleri (`com.docker.compose.project` etiketi)
3. Elle gruplananlar
4. Kalanlar tek başına kart olur; Docker'ın kendi yardımcıları (buildx vb.) en altta ayrı durur

| Dosya | Ne yapar |
|---|---|
| `app.py` | Pencereyi açar ve arayüzün çağırdığı işlemleri Python'a bağlar |
| `docker_service.py` | Docker ile konuşur: okuma, gruplama, açıklamalar, başlat/durdur/sil/oluştur |
| `catalog.py` | Hazır parça listesi |
| `static/` | Arayüz (HTML, CSS, JS) |
| `kur.command`, `setup.py` | Kurulum ve `.app` paketi |

Ayarlar (görünen adlar, notlar, elle gruplamalar) `~/.basic-docker/ayarlar.json` dosyasında durur.

### Geliştirme

```bash
./kur.command                              # bir kere, .venv'i hazırlar
.venv/bin/python app.py --gelistirici      # web denetçisi (sağ tık → Öğeyi İncele) açık çalıştırır
```

Yeni bir hazır parça eklemek için `catalog.py`'ye bir kayıt eklemen yeterli.

## Lisans

[MIT](LICENSE)
