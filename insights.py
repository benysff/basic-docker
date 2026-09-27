"""Teşhis: bir parça neden kapandı, kayıtlardaki hata ne anlama geliyor?

Çıkış kodlarını ve kayıtlardaki bilinen hata kalıplarını sade Türkçeye (ya da İngilizceye) çevirir,
her biri için "ne yapmalıyım?" önerisi verir. Docker Desktop ve OrbStack bunu yapmaz;
kullanıcıya sadece ham kaydı gösterir.
"""
from __future__ import annotations

import re

from docker_service import L

# ---------------------------------------------------------------------------
# Çıkış kodları: kod -> (başlık, açıklama, İngilizce başlık, İngilizce açıklama)
# ---------------------------------------------------------------------------

EXIT_CODES = {
    0: ("İşini bitirip normal şekilde kapandı",
        "Hata yok. Kurulum/test gibi bir kere çalışan parçalar için bu normaldir.",
        "Finished its work and exited normally",
        "No error. This is normal for one-off containers like setup or test jobs."),
    1: ("Uygulama bir hata yüzünden kapandı",
        "Parçanın içindeki program hata verip durdu. Sebebi genelde kayıtların son satırlarında yazar.",
        "The app exited because of an error",
        "The program inside the container failed and stopped. The reason is usually in the last log lines."),
    2: ("Komut yanlış kullanıldı",
        "Parçanın başlangıç komutu ya da ayarları hatalı olabilir. Kayıtlara ve ortam değişkenlerine bak.",
        "The command was used incorrectly",
        "The start command or settings may be wrong. Check the logs and environment variables."),
    125: ("Docker parçayı başlatamadı",
          "Sorun parçanın içinde değil, Docker ayarlarında (kapı, klasör, ağ gibi). İşlem çıktısına bak.",
          "Docker could not start the container",
          "The problem is not inside the container but in the Docker settings (port, folder, network…). "
          "Check the task output."),
    126: ("Başlangıç komutu çalıştırılamadı",
          "Komut dosyası var ama çalıştırma izni yok. Dockerfile'da 'chmod +x' eklemek gerekebilir.",
          "The start command could not be executed",
          "The script exists but is not executable. You may need 'chmod +x' in the Dockerfile."),
    127: ("Başlangıç komutu bulunamadı",
          "Kalıbın içinde böyle bir program yok. Komut adında yazım hatası ya da eksik kurulum olabilir.",
          "The start command was not found",
          "There is no such program in the image. The command may be misspelled or not installed."),
    130: ("Ctrl+C ile durduruldu", "Biri parçayı elle durdurdu. Sorun yok.",
          "Stopped with Ctrl+C", "Someone stopped it by hand. Nothing to worry about."),
    134: ("Program çöktü (abort)", "Programın kendisi ciddi bir hatayla durdu. Kayıtlara bak.",
          "The program crashed (abort)", "The program itself stopped with a serious error. Check the logs."),
    137: ("Zorla kapatıldı",
          "Ya biri durdurdu ya da parça belleği aştığı için sistem onu kapattı. "
          "Kendin durdurmadıysan bellek sorununa işaret eder.",
          "Killed",
          "Either someone stopped it or the system killed it for using too much memory. "
          "If you didn't stop it, it points to a memory problem."),
    139: ("Program çöktü (bellek hatası)",
          "Segmentation fault. Çoğunlukla kalıbın işlemci mimarisi uymuyordur ya da program hatalıdır.",
          "The program crashed (memory error)",
          "Segmentation fault. Usually the image's CPU architecture doesn't match, or the program has a bug."),
    143: ("Nazikçe durduruldu", "Parça kapat komutu aldı ve düzgünce kapandı. Sorun yok.",
          "Stopped gracefully", "It received a stop signal and shut down cleanly. Nothing to worry about."),
    255: ("Beklenmeyen şekilde kapandı",
          "Çoğunlukla Docker motoru (OrbStack/Docker Desktop) ya da bilgisayar kapanırken parça düzgün "
          "kapatılamadığında görülür. Genelde Başlat'a basmak yeter; tekrar kapanırsa kayıtlara bak.",
          "Exited unexpectedly",
          "Usually seen when the Docker engine (OrbStack/Docker Desktop) or the computer shut down before the "
          "container could stop cleanly. Pressing Start is usually enough; if it stops again, check the logs."),
}


def explain_exit(code, oom=False, running=False):
    """Çıkış kodunu açıklar. Çalışan parça için None döner."""
    if running:
        return None
    if oom:
        return {
            "title": L("Belleği yetmediği için kapatıldı", "Killed because it ran out of memory"),
            "desc": L("Parça kendisine ayrılan belleğin tamamını kullandı, sistem de onu kapattı.",
                      "The container used all the memory it was allowed, so the system killed it."),
            "fix": L("Docker motoruna daha fazla bellek ver (OrbStack/Docker Desktop ayarları) "
                     "ya da uygulamanın bellek kullanımını azalt.",
                     "Give the Docker engine more memory (OrbStack/Docker Desktop settings) "
                     "or reduce the app's memory usage."),
            "code": code,
            "level": "err",
        }
    row = EXIT_CODES.get(code)
    if row:
        title, desc = L(row[0], row[2]), L(row[1], row[3])
    else:
        title = L(f"Hata koduyla kapandı ({code})", f"Exited with error code {code}")
        desc = L("Program bu kodla çıktı. Kayıtların son satırlarında sebebi yazar.",
                 "The program exited with this code. The reason is in the last log lines.")
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

# (kimlik, desen, sayfa bağlantısı, Türkçe (başlık, açıklama, öneri), İngilizce (başlık, açıklama, öneri))
PATTERNS = [
    ("port", r"port is already allocated|address already in use|EADDRINUSE|bind: address already in use", "ports",
     ("Kapı (port) başka biri tarafından kullanılıyor",
      "Parçanın açmak istediği numaralı kapıyı bilgisayarındaki başka bir program ya da başka bir parça tutuyor.",
      "Kapılar sayfasından o numarayı kimin kullandığına bak; onu kapat ya da bu parçaya başka numara ver."),
     ("The port is already in use",
      "Another program or container on your computer is holding the port this container wants.",
      "See who uses that number on the Ports page; stop it or give this container a different port.")),
    ("arch", r"exec format error|no matching manifest for linux/arm64|image's platform \(linux/amd64\) does not match", None,
     ("Kalıp bu işlemciye uygun değil",
      "Kalıp Intel (amd64) işlemciler için hazırlanmış; Mac'in Apple Silicon (arm64). Ya hiç çalışmaz ya da çok yavaş çalışır.",
      "Kalıbın arm64 sürümünü kullan. Yoksa compose dosyasında servise 'platform: linux/amd64' ekle."),
     ("The image doesn't match this CPU",
      "The image was built for Intel (amd64) CPUs; your Mac is Apple Silicon (arm64). It won't run, or runs very slowly.",
      "Use the arm64 version of the image. If there is none, add 'platform: linux/amd64' to the service in compose.")),
    ("crlf", r"exec [^\s:]+\.sh: no such file or directory|/bin/sh\^M|\$'\\r': command not found|bad interpreter: No such file", None,
     ("Komut dosyasının satır sonları Windows biçiminde",
      "Başlangıç komut dosyası (.sh) Windows'ta kaydedilmiş; Linux onu okuyamıyor.",
      "Dosyayı editörde 'LF' satır sonu ile kaydet (VS Code sağ alt köşe: CRLF → LF) ve kalıbı yeniden derle."),
     ("The script has Windows line endings",
      "The start script (.sh) was saved on Windows; Linux can't read it.",
      "Save the file with 'LF' line endings (VS Code bottom right: CRLF → LF) and rebuild the image.")),
    ("dns", r"could not translate host name|getaddrinfo (ENOTFOUND|EAI_AGAIN)|Name or service not known|"
            r"Temporary failure in name resolution|no such host|Unknown MySQL server host", "networks",
     ("Bağlanmak istediği adres bulunamadı",
      "Parça, adını verdiğin sunucuyu (ör. 'db') bulamıyor. İki parça aynı ağda değil ya da ad yanlış yazılmış.",
      "Aynı uygulamadaki parçalara servis adıyla bağlanılır (ör. postgres://db:5432). Adı ve ağı kontrol et."),
     ("The host it wants to reach was not found",
      "The container can't find the server you named (e.g. 'db'). They are not on the same network or the name is wrong.",
      "Containers in the same app connect by service name (e.g. postgres://db:5432). Check the name and the network.")),
    ("localhost", r"(ECONNREFUSED|Connection refused).{0,40}(127\.0\.0\.1|localhost|::1)|"
                  r"(127\.0\.0\.1|localhost|::1).{0,40}(ECONNREFUSED|Connection refused)", None,
     ("Parça 'localhost'a bağlanmaya çalışıyor",
      "Bir parçanın içinde 'localhost' o parçanın kendisi demektir; bilgisayarın ya da diğer parçalar değil.",
      "localhost yerine diğer parçanın servis adını yaz (ör. db, redis). Bilgisayarındaki bir programa "
      "ulaşmak içinse 'host.docker.internal' kullan."),
     ("The container is trying to connect to 'localhost'",
      "Inside a container, 'localhost' means that container itself, not your computer or the other containers.",
      "Use the other container's service name instead (e.g. db, redis). To reach a program on your computer, "
      "use 'host.docker.internal'.")),
    ("refused", r"ECONNREFUSED|Connection refused|connect: connection refused|Can't connect to|"
                r"Is the server running on that host", None,
     ("Bağlanmak istediği parça yanıt vermiyor",
      "Diğer parça (genelde veritabanı) henüz açılmamış ya da kapalı.",
      "Önce bağımlı olduğu parçanın çalıştığından emin ol. Compose'da 'depends_on' + 'healthcheck' kullanmak kalıcı çözümdür."),
     ("The container it depends on isn't answering",
      "The other container (usually the database) hasn't started yet or is stopped.",
      "Make sure the container it depends on is running. Using 'depends_on' + 'healthcheck' in compose fixes it for good.")),
    ("auth", r"password authentication failed|Access denied for user|Authentication failed|"
             r"WRONGPASS|NOAUTH|invalid password|SCRAM authentication", "volumes",
     ("Şifre ya da kullanıcı adı yanlış",
      "Parça veritabanına giriş yapamadı. Klasik tuzak: veritabanı kalıpları şifreyi sadece İLK kurulumda, "
      "veri kutusu boşken ayarlar. Sonradan .env'deki şifreyi değiştirmek eski veriye etki etmez.",
      "Eski şifreyi kullan ya da (veriler önemli değilse) veri kutusunu silip yeniden kur. Önce yedek almayı unutma."),
     ("Wrong password or user name",
      "The container couldn't log in to the database. Classic trap: database images set the password only on the "
      "FIRST start, while the volume is empty. Changing the password in .env later doesn't affect existing data.",
      "Use the old password, or (if the data doesn't matter) delete the volume and start fresh. Back it up first.")),
    ("dbmissing", r'database "?[\w-]+"? does not exist|Unknown database|FATAL:\s+role "?[\w-]+"? does not exist', None,
     ("Veritabanı ya da kullanıcı yok",
      "Bağlanılmak istenen veritabanı/kullanıcı oluşturulmamış. Genelde veri kutusu önceden, farklı ayarlarla oluşturulduğu için olur.",
      "Veritabanını elle oluştur ya da veri kutusunu yedekleyip sıfırdan kur."),
     ("The database or user doesn't exist",
      "The database/user it wants was never created. Usually the volume was created earlier with different settings.",
      "Create the database by hand, or back up the volume and start fresh.")),
    ("migrate", r'relation "?[\w.]+"? does not exist|Table \'[\w.]+\' doesn\'t exist|no such table', None,
     ("Tablolar oluşturulmamış",
      "Uygulama bir tabloyu arıyor ama veritabanında yok. Kurulum adımı (migration) çalıştırılmamış.",
      "Projenin migration komutunu çalıştır (ör. 'npm run migrate', 'php artisan migrate', 'python manage.py migrate')."),
     ("Tables are missing",
      "The app is looking for a table that isn't in the database. The migration step hasn't been run.",
      "Run the project's migration command (e.g. 'npm run migrate', 'php artisan migrate', 'python manage.py migrate').")),
    ("pgversion", r"database files are incompatible with server|initialized by PostgreSQL version \d+|"
                  r"InnoDB: Upgrade after a crash is not supported|Cannot upgrade|downgrade is not supported", "volumes",
     ("Veri kutusundaki veriler başka bir sürüme ait",
      "Veritabanının sürümünü değiştirmişsin (ör. postgres:16 → 17). Eski sürümün verileri yeni sürümle doğrudan açılmaz.",
      "Kalıbı eski sürüme geri al. Yükseltmek istiyorsan önce 'Veritabanı dökümü' al, yeni sürümü boş kutuyla kurup dökümü geri yükle."),
     ("The data in the volume belongs to another version",
      "You changed the database version (e.g. postgres:16 → 17). Old data can't be opened directly by the new version.",
      "Switch the image back to the old version. To upgrade, take a 'Database dump', start the new version with an "
      "empty volume and restore the dump.")),
    ("disk", r"no space left on device|disk full|ENOSPC|could not extend file", "cleanup",
     ("Disk dolmuş", "Docker'ın kullandığı disk alanı bitmiş.",
      "Temizlik sayfasından kullanılmayan kalıpları ve derleme önbelleğini sil."),
     ("The disk is full", "Docker has run out of disk space.",
      "Delete unused images and the build cache from the Cleanup page.")),
    ("oom", r"JavaScript heap out of memory|OutOfMemoryError|Cannot allocate memory|\bKilled\b|out of memory", "system",
     ("Bellek yetmedi", "Program çalışmak için daha fazla bellek istedi.",
      "Docker motoruna daha fazla bellek ver. Node.js için NODE_OPTIONS=--max-old-space-size=4096 gibi bir ayar da işe yarar."),
     ("Out of memory", "The program needed more memory to run.",
      "Give the Docker engine more memory. For Node.js, a setting like NODE_OPTIONS=--max-old-space-size=4096 also helps.")),
    ("perm", r"permission denied|EACCES|Operation not permitted|chown: .*: Operation not permitted", None,
     ("İzin hatası",
      "Parça bir dosyaya/klasöre yazamıyor. Genelde bilgisayarından bağlanan klasörün izinleri ya da kullanıcı (UID) uyuşmazlığıdır.",
      "Bağlanan klasörün izinlerini kontrol et. Veri kutusu kullanmak bu sorunları çoğunlukla ortadan kaldırır."),
     ("Permission error",
      "The container can't write to a file/folder. Usually the permissions of a folder mounted from your computer, "
      "or a user (UID) mismatch.",
      "Check the permissions of the mounted folder. Using a volume usually makes these problems go away.")),
    ("nodemod", r"Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND", None,
     ("Node.js paketi eksik",
      "Kod bir paketi arıyor ama node_modules içinde yok. Kalıp eski ya da paketler kurulmamış.",
      "Kalıbı yeniden derle (docker compose build). Klasörü bağladıysan içeride 'npm install' çalıştır."),
     ("A Node.js package is missing",
      "The code needs a package that isn't in node_modules. The image is outdated or packages weren't installed.",
      "Rebuild the image (docker compose build). If you mounted the folder, run 'npm install' inside.")),
    ("pymod", r"ModuleNotFoundError|ImportError: No module named", None,
     ("Python paketi eksik", "Kod bir Python paketini arıyor ama kurulu değil.",
      "requirements.txt'yi kontrol edip kalıbı yeniden derle."),
     ("A Python package is missing", "The code needs a Python package that isn't installed.",
      "Check requirements.txt and rebuild the image.")),
    ("pull", r"pull access denied|manifest unknown|repository does not exist|not found: manifest|"
             r"unauthorized: authentication required", "images",
     ("Kalıp indirilemedi", "Kalıp adı yanlış, o sürüm (etiket) yok ya da kalıp gizli bir depoda.",
      "Adı ve etiketi Docker Hub'dan kontrol et. Gizli depoysa terminalde 'docker login' yap."),
     ("The image could not be pulled", "The image name is wrong, that version (tag) doesn't exist, or it's in a private registry.",
      "Check the name and tag on Docker Hub. For a private registry, run 'docker login' in a terminal.")),
    ("tls", r"x509: certificate|certificate verify failed|SSL routines|self[- ]signed certificate", None,
     ("Güvenlik sertifikası sorunu",
      "Bağlantıdaki SSL/TLS sertifikası doğrulanamadı. Kurumsal ağ/VPN ya da kendi imzaladığın sertifika olabilir.",
      "VPN'i kapatıp dene. Geliştirme ortamındaysan sertifika doğrulamasını kapatman gerekebilir."),
     ("Certificate problem",
      "The SSL/TLS certificate couldn't be verified. A corporate network/VPN or a self-signed certificate may be the cause.",
      "Try with the VPN off. In development you may need to turn certificate verification off.")),
    ("envmissing", r"(is not set|must be set|is required|missing required).{0,40}(env|environment|variable|KEY|SECRET|URL)|"
                   r"environment variable .{0,40}(not set|missing|required)", None,
     ("Eksik ayar (ortam değişkeni)", "Uygulama bir ayarın (ortam değişkeni) tanımlı olmasını bekliyor.",
      "Projenin .env dosyasını ve compose'daki 'environment' kısmını kontrol et."),
     ("A setting (environment variable) is missing", "The app expects a setting (environment variable) to be defined.",
      "Check the project's .env file and the 'environment' section in compose.")),
    ("healthcheck", r"health check exceeded timeout|unhealthy", None,
     ("Sağlık kontrolü başarısız", "Docker parçanın içinde düzenli bir kontrol çalıştırıyor ve kontrol başarısız oluyor.",
      "Genel sekmesindeki 'Sağlık kontrolü' çıktısına bak."),
     ("Health check failing", "Docker runs a regular check inside the container and it keeps failing.",
      "See the 'Health check' output on the Overview tab.")),
]

_COMPILED = [(pid, re.compile(rx, re.I), link, tr, en) for pid, rx, link, tr, en in PATTERNS]
_ERR_LINE = re.compile(r"\b(error|exception|fatal|failed|traceback|panic|critical|refused|denied)\b", re.I)


def scan_logs(text, limit=4):
    """Kayıtlarda bilinen hata kalıplarını arar. En son görülen örneğiyle birlikte döndürür."""
    found = {}
    lines = (text or "").splitlines()
    for idx in range(len(lines) - 1, -1, -1):
        line = lines[idx]
        if len(found) >= limit:
            break
        for pid, rx, link, tr, en in _COMPILED:
            if pid in found:
                continue
            if rx.search(line):
                # "localhost" daha özel olduğu için genel "refused" onu gölgelemesin.
                if pid == "refused" and "localhost" in found:
                    continue
                title, desc, fix = L(tr[0], en[0]), L(tr[1], en[1]), L(tr[2], en[2])
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
    for pid, rx, link, tr, en in _COMPILED:
        if rx.search(line or ""):
            return L(tr[0], en[0])
    return None


def diagnose(container, log_text, arch_warning=None):
    """Bir parça için tam teşhis: durum + çıkış kodu + kayıt bulguları."""
    findings = scan_logs(log_text)
    exit_info = explain_exit(container.get("exit_code", 0), container.get("oom", False), container.get("running"))
    summary = None
    if container.get("state") == "restarting":
        summary = L("Parça açılıyor, hata verip kapanıyor, Docker tekrar açıyor. Aşağıdaki bulgular sebebini gösterebilir.",
                    "The container starts, crashes and Docker starts it again. The findings below may show why.")
    elif container.get("health") == "unhealthy":
        summary = L("Parça çalışıyor ama kendi sağlık kontrolünden geçemiyor.",
                    "The container is running but keeps failing its own health check.")
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
