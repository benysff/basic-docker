"""Teşhis: bir parça neden kapandı, kayıtlardaki hata ne anlama geliyor?

Çıkış kodlarını ve kayıtlardaki bilinen hata kalıplarını sade Türkçeye çevirir,
her biri için "ne yapmalıyım?" önerisi verir. Docker Desktop ve OrbStack bunu yapmaz;
kullanıcıya sadece ham kaydı gösterir.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Çıkış kodları
# ---------------------------------------------------------------------------

EXIT_CODES = {
    0: ("İşini bitirip normal şekilde kapandı",
        "Hata yok. Kurulum/test gibi bir kere çalışan parçalar için bu normaldir."),
    1: ("Uygulama bir hata yüzünden kapandı",
        "Parçanın içindeki program hata verip durdu. Sebebi genelde kayıtların son satırlarında yazar."),
    2: ("Komut yanlış kullanıldı",
        "Parçanın başlangıç komutu ya da ayarları hatalı olabilir. Kayıtlara ve ortam değişkenlerine bak."),
    125: ("Docker parçayı başlatamadı",
          "Sorun parçanın içinde değil, Docker ayarlarında (kapı, klasör, ağ gibi). İşlem çıktısına bak."),
    126: ("Başlangıç komutu çalıştırılamadı",
          "Komut dosyası var ama çalıştırma izni yok. Dockerfile'da 'chmod +x' eklemek gerekebilir."),
    127: ("Başlangıç komutu bulunamadı",
          "Kalıbın içinde böyle bir program yok. Komut adında yazım hatası ya da eksik kurulum olabilir."),
    130: ("Ctrl+C ile durduruldu", "Biri parçayı elle durdurdu. Sorun yok."),
    134: ("Program çöktü (abort)", "Programın kendisi ciddi bir hatayla durdu. Kayıtlara bak."),
    137: ("Zorla kapatıldı",
          "Ya biri durdurdu ya da parça belleği aştığı için sistem onu kapattı. "
          "Kendin durdurmadıysan bellek sorununa işaret eder."),
    139: ("Program çöktü (bellek hatası)",
          "Segmentation fault. Çoğunlukla kalıbın işlemci mimarisi uymuyordur ya da program hatalıdır."),
    143: ("Nazikçe durduruldu", "Parça kapat komutu aldı ve düzgünce kapandı. Sorun yok."),
    255: ("Beklenmeyen şekilde kapandı",
          "Çoğunlukla Docker motoru (OrbStack/Docker Desktop) ya da bilgisayar kapanırken parça düzgün "
          "kapatılamadığında görülür. Genelde Başlat'a basmak yeter; tekrar kapanırsa kayıtlara bak."),
}


def explain_exit(code, oom=False, running=False):
    """Çıkış kodunu açıklar. Çalışan parça için None döner."""
    if running:
        return None
    if oom:
        return {
            "title": "Belleği yetmediği için kapatıldı",
            "desc": "Parça kendisine ayrılan belleğin tamamını kullandı, sistem de onu kapattı.",
            "fix": "Docker motoruna daha fazla bellek ver (OrbStack/Docker Desktop ayarları) "
                   "ya da uygulamanın bellek kullanımını azalt.",
            "code": code,
            "level": "err",
        }
    title, desc = EXIT_CODES.get(code, (f"Hata koduyla kapandı ({code})",
                                        "Program bu kodla çıktı. Kayıtların son satırlarında sebebi yazar."))
    return {
        "title": title,
        "desc": desc,
        "fix": "",
        "code": code,
        "level": "ok" if code in (0, 130, 143) else "warn" if code == 137 else "err",
    }


# ---------------------------------------------------------------------------
# Kayıtlardaki bilinen hata kalıpları
# ---------------------------------------------------------------------------

# (kimlik, desen, başlık, açıklama, öneri, sayfa bağlantısı)
PATTERNS = [
    ("port", r"port is already allocated|address already in use|EADDRINUSE|bind: address already in use",
     "Kapı (port) başka biri tarafından kullanılıyor",
     "Parçanın açmak istediği numaralı kapıyı bilgisayarındaki başka bir program ya da başka bir parça tutuyor.",
     "Kapılar sayfasından o numarayı kimin kullandığına bak; onu kapat ya da bu parçaya başka numara ver.",
     "ports"),
    ("arch", r"exec format error|no matching manifest for linux/arm64|image's platform \(linux/amd64\) does not match",
     "Kalıp bu işlemciye uygun değil",
     "Kalıp Intel (amd64) işlemciler için hazırlanmış; Mac'in Apple Silicon (arm64). Ya hiç çalışmaz ya da çok yavaş çalışır.",
     "Kalıbın arm64 sürümünü kullan. Yoksa compose dosyasında servise 'platform: linux/amd64' ekle.",
     None),
    ("crlf", r"exec [^\s:]+\.sh: no such file or directory|/bin/sh\^M|\$'\\r': command not found|bad interpreter: No such file",
     "Komut dosyasının satır sonları Windows biçiminde",
     "Başlangıç komut dosyası (.sh) Windows'ta kaydedilmiş; Linux onu okuyamıyor.",
     "Dosyayı editörde 'LF' satır sonu ile kaydet (VS Code sağ alt köşe: CRLF → LF) ve kalıbı yeniden derle.",
     None),
    ("dns", r"could not translate host name|getaddrinfo (ENOTFOUND|EAI_AGAIN)|Name or service not known|"
            r"Temporary failure in name resolution|no such host|Unknown MySQL server host",
     "Bağlanmak istediği adres bulunamadı",
     "Parça, adını verdiğin sunucuyu (ör. 'db') bulamıyor. İki parça aynı ağda değil ya da ad yanlış yazılmış.",
     "Aynı uygulamadaki parçalara servis adıyla bağlanılır (ör. postgres://db:5432). Adı ve ağı kontrol et.",
     "networks"),
    ("localhost", r"(ECONNREFUSED|Connection refused).{0,40}(127\.0\.0\.1|localhost|::1)|"
                  r"(127\.0\.0\.1|localhost|::1).{0,40}(ECONNREFUSED|Connection refused)",
     "Parça 'localhost'a bağlanmaya çalışıyor",
     "Bir parçanın içinde 'localhost' o parçanın kendisi demektir; bilgisayarın ya da diğer parçalar değil.",
     "localhost yerine diğer parçanın servis adını yaz (ör. db, redis). Bilgisayarındaki bir programa "
     "ulaşmak içinse 'host.docker.internal' kullan.",
     None),
    ("refused", r"ECONNREFUSED|Connection refused|connect: connection refused|Can't connect to|"
                r"Is the server running on that host",
     "Bağlanmak istediği parça yanıt vermiyor",
     "Diğer parça (genelde veritabanı) henüz açılmamış ya da kapalı.",
     "Önce bağımlı olduğu parçanın çalıştığından emin ol. Compose'da 'depends_on' + 'healthcheck' kullanmak kalıcı çözümdür.",
     None),
    ("auth", r"password authentication failed|Access denied for user|Authentication failed|"
             r"WRONGPASS|NOAUTH|invalid password|SCRAM authentication",
     "Şifre ya da kullanıcı adı yanlış",
     "Parça veritabanına giriş yapamadı. Klasik tuzak: veritabanı kalıpları şifreyi sadece İLK kurulumda, "
     "veri kutusu boşken ayarlar. Sonradan .env'deki şifreyi değiştirmek eski veriye etki etmez.",
     "Eski şifreyi kullan ya da (veriler önemli değilse) veri kutusunu silip yeniden kur. Önce yedek almayı unutma.",
     "volumes"),
    ("dbmissing", r'database "?[\w-]+"? does not exist|Unknown database|FATAL:\s+role "?[\w-]+"? does not exist',
     "Veritabanı ya da kullanıcı yok",
     "Bağlanılmak istenen veritabanı/kullanıcı oluşturulmamış. Genelde veri kutusu önceden, farklı ayarlarla oluşturulduğu için olur.",
     "Veritabanını elle oluştur ya da veri kutusunu yedekleyip sıfırdan kur.",
     None),
    ("migrate", r'relation "?[\w.]+"? does not exist|Table \'[\w.]+\' doesn\'t exist|no such table',
     "Tablolar oluşturulmamış",
     "Uygulama bir tabloyu arıyor ama veritabanında yok. Kurulum adımı (migration) çalıştırılmamış.",
     "Projenin migration komutunu çalıştır (ör. 'npm run migrate', 'php artisan migrate', 'python manage.py migrate').",
     None),
    ("pgversion", r"database files are incompatible with server|initialized by PostgreSQL version \d+|"
                  r"InnoDB: Upgrade after a crash is not supported|Cannot upgrade|downgrade is not supported",
     "Veri kutusundaki veriler başka bir sürüme ait",
     "Veritabanının sürümünü değiştirmişsin (ör. postgres:16 → 17). Eski sürümün verileri yeni sürümle doğrudan açılmaz.",
     "Kalıbı eski sürüme geri al. Yükseltmek istiyorsan önce 'Veritabanı dökümü' al, yeni sürümü boş kutuyla kurup dökümü geri yükle.",
     "volumes"),
    ("disk", r"no space left on device|disk full|ENOSPC|could not extend file",
     "Disk dolmuş",
     "Docker'ın kullandığı disk alanı bitmiş.",
     "Temizlik sayfasından kullanılmayan kalıpları ve derleme önbelleğini sil.",
     "cleanup"),
    ("oom", r"JavaScript heap out of memory|OutOfMemoryError|Cannot allocate memory|\bKilled\b|out of memory",
     "Bellek yetmedi",
     "Program çalışmak için daha fazla bellek istedi.",
     "Docker motoruna daha fazla bellek ver. Node.js için NODE_OPTIONS=--max-old-space-size=4096 gibi bir ayar da işe yarar.",
     "system"),
    ("perm", r"permission denied|EACCES|Operation not permitted|chown: .*: Operation not permitted",
     "İzin hatası",
     "Parça bir dosyaya/klasöre yazamıyor. Genelde bilgisayarından bağlanan klasörün izinleri ya da kullanıcı (UID) uyuşmazlığıdır.",
     "Bağlanan klasörün izinlerini kontrol et. Veri kutusu kullanmak bu sorunları çoğunlukla ortadan kaldırır.",
     None),
    ("nodemod", r"Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND",
     "Node.js paketi eksik",
     "Kod bir paketi arıyor ama node_modules içinde yok. Kalıp eski ya da paketler kurulmamış.",
     "Kalıbı yeniden derle (docker compose build). Klasörü bağladıysan içeride 'npm install' çalıştır.",
     None),
    ("pymod", r"ModuleNotFoundError|ImportError: No module named",
     "Python paketi eksik",
     "Kod bir Python paketini arıyor ama kurulu değil.",
     "requirements.txt'yi kontrol edip kalıbı yeniden derle.",
     None),
    ("pull", r"pull access denied|manifest unknown|repository does not exist|not found: manifest|"
             r"unauthorized: authentication required",
     "Kalıp indirilemedi",
     "Kalıp adı yanlış, o sürüm (etiket) yok ya da kalıp gizli bir depoda.",
     "Adı ve etiketi Docker Hub'dan kontrol et. Gizli depoysa terminalde 'docker login' yap.",
     "images"),
    ("tls", r"x509: certificate|certificate verify failed|SSL routines|self[- ]signed certificate",
     "Güvenlik sertifikası sorunu",
     "Bağlantıdaki SSL/TLS sertifikası doğrulanamadı. Kurumsal ağ/VPN ya da kendi imzaladığın sertifika olabilir.",
     "VPN'i kapatıp dene. Geliştirme ortamındaysan sertifika doğrulamasını kapatman gerekebilir.",
     None),
    ("envmissing", r"(is not set|must be set|is required|missing required).{0,40}(env|environment|variable|KEY|SECRET|URL)|"
                   r"environment variable .{0,40}(not set|missing|required)",
     "Eksik ayar (ortam değişkeni)",
     "Uygulama bir ayarın (ortam değişkeni) tanımlı olmasını bekliyor.",
     "Projenin .env dosyasını ve compose'daki 'environment' kısmını kontrol et.",
     None),
    ("healthcheck", r"health check exceeded timeout|unhealthy",
     "Sağlık kontrolü başarısız",
     "Docker parçanın içinde düzenli bir kontrol çalıştırıyor ve kontrol başarısız oluyor.",
     "Genel sekmesindeki 'Sağlık kontrolü' çıktısına bak.",
     None),
]

_COMPILED = [(pid, re.compile(rx, re.I), t, d, f, link) for pid, rx, t, d, f, link in PATTERNS]
_ERR_LINE = re.compile(r"\b(error|exception|fatal|failed|traceback|panic|critical|refused|denied)\b", re.I)


def scan_logs(text, limit=4):
    """Kayıtlarda bilinen hata kalıplarını arar. En son görülen örneğiyle birlikte döndürür."""
    found = {}
    lines = (text or "").splitlines()
    for idx in range(len(lines) - 1, -1, -1):
        line = lines[idx]
        if len(found) >= limit:
            break
        for pid, rx, title, desc, fix, link in _COMPILED:
            if pid in found:
                continue
            if rx.search(line):
                # "localhost" daha özel olduğu için genel "refused" onu gölgelemesin.
                if pid == "refused" and "localhost" in found:
                    continue
                found[pid] = {"id": pid, "title": title, "desc": desc, "fix": fix, "link": link,
                              "line": line.strip()[:400], "line_no": idx + 1}
                break
    if "localhost" in found:
        found.pop("refused", None)
    return list(found.values())


def last_error_lines(text, n=6):
    """Hata gibi görünen son satırlar (kalıp bulunamazsa gösterilir)."""
    out = [ln.strip() for ln in (text or "").splitlines() if _ERR_LINE.search(ln)]
    return out[-n:]


def line_hint(line):
    """Tek bir kayıt satırı için kısa açıklama (arayüzde satırın yanında gösterilir)."""
    for pid, rx, title, *_ in _COMPILED:
        if rx.search(line or ""):
            return title
    return None


def diagnose(container, log_text, arch_warning=None):
    """Bir parça için tam teşhis: durum + çıkış kodu + kayıt bulguları."""
    findings = scan_logs(log_text)
    exit_info = explain_exit(container.get("exit_code", 0), container.get("oom", False), container.get("running"))
    summary = None
    if container.get("state") == "restarting":
        summary = "Parça açılıyor, hata verip kapanıyor, Docker tekrar açıyor. Aşağıdaki bulgular sebebini gösterebilir."
    elif container.get("health") == "unhealthy":
        summary = "Parça çalışıyor ama kendi sağlık kontrolünden geçemiyor."
    elif exit_info and exit_info["level"] == "err":
        summary = exit_info["title"] + "."
    if arch_warning:
        findings.insert(0, arch_warning)
    return {
        "summary": summary,
        "exit": exit_info,
        "findings": findings,
        "error_lines": [] if findings else last_error_lines(log_text),
    }
