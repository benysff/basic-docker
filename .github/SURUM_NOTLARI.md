## İndir

| Bilgisayar | Dosya |
|---|---|
| Mac (M1/M2/M3/M4…) | `Basic-Docker-macOS-AppleSilicon.zip` |
| Mac (Intel) | `Basic-Docker-macOS-Intel.zip` |
| Windows 10/11 (deneysel) | `Basic-Docker-Windows-Kurulum.exe` |

Python kurmana gerek yok; her şey paketin içinde. Bir Docker motoru gerekir: Mac'te [OrbStack](https://orbstack.dev) ya da [Docker Desktop](https://www.docker.com/products/docker-desktop/), Windows'ta Docker Desktop.

**Mac'te ilk açılış:** Zip'i aç, `Basic Docker.app`'i Uygulamalar klasörüne sürükle. Uygulama imzalı olmadığı için macOS ilk açılışta uyarır. Sistem Ayarları → Gizlilik ve Güvenlik → en altta **Yine de Aç**'a bas. Ya da Terminal'de bir kez:
`xattr -dr com.apple.quarantine "/Applications/Basic Docker.app"`

**Windows'ta kurulum:** `Basic-Docker-Windows-Kurulum.exe`'yi çalıştır. Yönetici izni istemeden kendi kullanıcı klasörüne (`%LOCALAPPDATA%\Programs\Basic Docker`) kurulur, Başlat menüsüne eklenir ve açılır. Güncellemek için yeni sürümün kurulum dosyasını çalıştırman yeterli; kaldırmak için Ayarlar → Uygulamalar. SmartScreen uyarırsa **Ek bilgi → Yine de çalıştır**. Windows sürümü deneysel: sorun görürsen Issues'a yaz.

## Bu sürümde (2.1.1)

**Windows**
- Tek dosyalık kurulum: zip ve `_internal` klasörü yerine, AppData'ya kurulan bir kurulum dosyası.
- "Bu Mac" yazan her yer Windows'ta "bu bilgisayar"; Finder yerine Gezgin, Çöp Sepeti yerine Geri Dönüşüm Kutusu (yedek silme artık geri alınabilir).
- Kapı haritası Windows'ta da çalışıyor (hangi program hangi kapıyı kullanıyor); Docker Desktop tanınıyor.
- AltGr ile [ ] yazınca sayfanın geri/ileri gitmesi düzeltildi.
- Terminalde kopyala/yapıştır: Ctrl+Shift+C / Ctrl+Shift+V.
- Uzak sunucu eklerken Windows'ta parola yerine anahtarı yükleyen tek satırlık komut gösteriliyor.

**Uzak sunucular ve güvenli mod**
- Bir işlem sürerken başka sunucuya geçilirse işlemin kalan adımları artık yeni sunucuda çalışmıyor; her işlem başladığı sunucuda biter. Terminal kapatma da doğru sunucuya gidiyor.
- Güvenli mod sıkılaştı: terminal ve komut çalıştırma da kapalı; parçası kalmamış uygulamada "Başlat" (sunucuya yeniden kurulum) engelleniyor; hangi sunucuya gidileceği okunamazsa yıkıcı işlem yapılmıyor. Güvenli modda silme/kurulum düğmeleri hiç gösterilmiyor.
- Silinen bir bağlantının "tam kontrol" izni, aynı adla eklenen yeni sunucuya geçmiyor.

**Düzeltmeler**
- Veritabanı geri yüklemesi hatalarla bittiğinde artık "başarılı" demiyor; yanlış türde döküm (ör. MySQL dökümü Postgres'e) reddediliyor.
- Veri kutusu geri yüklemede yedek önce denetleniyor; bozuksa kutudaki veri silinmiyor.
- Silme ve temizlikte başarısız adımlar sonuçta açıkça yazıyor.
- Hazır parça yeniden kurulurken eski veri kutusu (eski şifreyle) sessizce kullanılmıyor.
- Kayıt aramasında "INFO", "FAILED" gibi büyük harfli satırlar bulunuyor.
- Sayfalar arasında hızlı geçişte bir parçanın bilgilerinin başka parçanın sayfasında görünmesi, sunucu değiştirince eski rozetlerin kalması, pencerelerde Enter'ın iki kez gönderilmesi düzeltildi.

---

## Download (English)

Pick the file for your computer from the table above; Python is not needed. You need a Docker engine (OrbStack or Docker Desktop on a Mac, Docker Desktop on Windows).

- **Mac:** unzip, drag `Basic Docker.app` to Applications. The app isn't signed, so on first launch go to System Settings → Privacy & Security → **Open Anyway** (or run `xattr -dr com.apple.quarantine "/Applications/Basic Docker.app"` once).
- **Windows (experimental):** run `Basic-Docker-Windows-Kurulum.exe`. It installs into your user folder without admin rights and adds a Start menu entry. If SmartScreen warns, choose **More info → Run anyway**.

2.1.1 is a bug-fix release: a single-file Windows installer, correct "this computer" wording, Recycle Bin, port map and keyboard fixes on Windows, jobs that stay on the server they started on, a stricter safe mode for remote servers, and honest results for restores and cleanups.
