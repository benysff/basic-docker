## İndir

| Bilgisayar | Dosya |
|---|---|
| Mac (M1/M2/M3/M4…) | `Basic-Docker-macOS-AppleSilicon.zip` |
| Mac (Intel) | `Basic-Docker-macOS-Intel.zip` |
| Windows 10/11 (deneysel) | `Basic-Docker-Windows.zip` |

Python kurmana gerek yok; her şey paketin içinde. Bir Docker motoru gerekir: Mac'te [OrbStack](https://orbstack.dev) ya da [Docker Desktop](https://www.docker.com/products/docker-desktop/), Windows'ta Docker Desktop.

**Mac'te ilk açılış:** Zip'i aç, `Basic Docker.app`'i Uygulamalar klasörüne sürükle. Uygulama imzalı olmadığı için macOS ilk açılışta uyarır. Sistem Ayarları → Gizlilik ve Güvenlik → en altta **Yine de Aç**'a bas. Ya da Terminal'de bir kez:
`xattr -dr com.apple.quarantine "/Applications/Basic Docker.app"`

**Windows'ta ilk açılış:** Zip'i bir klasöre çıkar, `Basic Docker.exe`'yi çalıştır. SmartScreen uyarırsa **Ek bilgi → Yine de çalıştır**. Windows sürümü deneysel: otomatik testlerden geçiyor ama gerçek bir Windows bilgisayarda henüz uzun süre denenmedi. Sorun görürsen Issues'a yaz.

## Bu sürümde yeni (2.1.0)

- **İngilizce arayüz.** Sistem → Dil / Language ya da ⌘K → “Switch to English”. Teşhis açıklamaları ve hazır parça listesi de iki dilde.
- **Uzak Docker (VS Code'daki gibi).** Sunucundaki Docker'ı SSH ile ekle, buradan yönet. Uzak parçaların bağlantılarına tıklayınca SSH tüneli kendiliğinden açılır.
- **Parçanın içine gir: gerçek terminal** (xterm.js). `cd`, sekme tamamlama, `top`, `vim` çalışır.
- **Windows desteği (deneysel)** ve indirilebilir paketler.
- Düzeltmeler: açılışta kayıtlı dil/tema tercihinin kaçırılması, motor kapalıyken kenar çubuğunun yarıya inmesi, terminal kapatılınca bazı kalıplarda kabuğun konteynerde açık kalması.

---

## Download (English)

Pick the file for your computer from the table above; Python is not needed. You need a Docker engine (OrbStack or Docker Desktop on a Mac, Docker Desktop on Windows).

- **Mac:** unzip, drag `Basic Docker.app` to Applications. The app isn't signed, so on first launch go to System Settings → Privacy & Security → **Open Anyway** (or run `xattr -dr com.apple.quarantine "/Applications/Basic Docker.app"` once).
- **Windows (experimental):** unzip and run `Basic Docker.exe`. If SmartScreen warns, choose **More info → Run anyway**.

New in 2.1.0: English interface, remote Docker over SSH with automatic tunnels, an in-app terminal, experimental Windows support and downloadable builds.
