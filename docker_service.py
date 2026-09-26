"""Docker ile konuşan katman.

Konteynerleri okur, "uygulama" gruplarına ayırır, her parçayı sade Türkçeyle açıklar
ve başlat / durdur / sil / oluştur işlemlerini arka planda (iş olarak) yürütür.
Her şey `docker` komut satırı aracı üzerinden yapılır; ek Python paketi gerekmez.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import socket
import string
import subprocess
import sys
import threading
import time
import traceback
import uuid
from collections import deque
from urllib.parse import quote

import catalog

# ---------------------------------------------------------------------------
# Docker komutunu bulma ve çalıştırma
# ---------------------------------------------------------------------------

EXTRA_PATHS = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/Applications/Docker.app/Contents/Resources/bin",
    os.path.expanduser("~/.orbstack/bin"),
    os.path.expanduser("~/.docker/bin"),
    "/usr/bin",
    "/bin",
]


def _build_env():
    # Çift tıklamayla açılınca PATH kısa olabiliyor; Docker'ın yardımcı araçları da bulunabilsin.
    env = os.environ.copy()
    parts = [p for p in env.get("PATH", "").split(os.pathsep) if p]
    for p in EXTRA_PATHS:
        if p not in parts:
            parts.append(p)
    env["PATH"] = os.pathsep.join(parts)
    return env


ENV = _build_env()
DOCKER = shutil.which("docker", path=ENV["PATH"])
IS_MAC = sys.platform == "darwin"

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07")
NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")
IMAGE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$")
ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class UserError(Exception):
    """Kullanıcıya olduğu gibi gösterilecek, anlaşılır hata."""


def strip_ansi(text):
    return ANSI_RE.sub("", text)


def docker(*args, timeout=30, cwd=None):
    """Docker komutunu çalıştırır, (çıkış_kodu, stdout, stderr) döndürür."""
    if not DOCKER:
        return 127, "", "Docker bulunamadı"
    try:
        p = subprocess.run(
            [DOCKER, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=cwd,
            env=ENV,
        )
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "Docker yanıt vermedi (zaman aşımı)."
    except OSError as e:
        return 127, "", str(e)


# ---------------------------------------------------------------------------
# Kalıcı ayarlar (görünen adlar, notlar, elle gruplama, bilinen compose projeleri)
# ---------------------------------------------------------------------------

SETTINGS_DIR = os.path.expanduser("~/.basic-docker")
_OLD_SETTINGS_DIR = os.path.expanduser("~/.docker-kontrol")  # eski sürümün ayarları
if os.path.isdir(_OLD_SETTINGS_DIR) and not os.path.exists(SETTINGS_DIR):
    try:
        os.rename(_OLD_SETTINGS_DIR, SETTINGS_DIR)
    except OSError:
        pass
SETTINGS_FILE = os.path.join(SETTINGS_DIR, "ayarlar.json")
_settings_lock = threading.Lock()
_SETTINGS_KEYS = ("adlar", "notlar", "eslestirme", "projeler", "arayuz")


def _read_settings():
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    for k in _SETTINGS_KEYS:
        if not isinstance(data.get(k), dict):
            data[k] = {}
    return data


def load_settings():
    with _settings_lock:
        return _read_settings()


def update_settings(fn):
    """Ayarları kilitli şekilde okur, fn ile değiştirir, değiştiyse diske yazar."""
    with _settings_lock:
        data = _read_settings()
        before = json.dumps(data, sort_keys=True)
        fn(data)
        if json.dumps(data, sort_keys=True) == before:
            return data
        os.makedirs(SETTINGS_DIR, exist_ok=True)
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, SETTINGS_FILE)
        return data


# ---------------------------------------------------------------------------
# Parçaların sade Türkçe açıklamaları
# ---------------------------------------------------------------------------

# (desen, tür, başlık, açıklama). Önce servis adındaki özel görevlere bakılır,
# sonra bilinen imajlara, sonra genel servis adlarına, en son genel imajlara.
SERVICE_SPECIFIC = [
    (r"beat|schedul|cron|timer", "scheduler", "Zamanlayıcı",
     "Belirli saatlerde otomatik işleri tetikler (her gece rapor, her saat temizlik gibi)."),
    (r"worker|celery|sidekiq|queue|consumer|jobs?\b", "worker", "Arka plan işçisi",
     "Kullanıcıyı bekletmeden arka planda iş yapar (e-posta gönderme, rapor hazırlama gibi)."),
    (r"tailwind|vite|webpack|assets|watch", "build", "Tasarım / kod derleyici",
     "Geliştirme sırasında CSS ve JavaScript dosyalarını otomatik hazırlar."),
    (r"backup|yedek", "backup", "Yedekleyici", "Verilerin düzenli olarak yedeğini alır."),
    (r"migrat|seed|^init|setup", "task", "Kurulum görevi",
     "Bir kere çalışıp veritabanını hazırlar, sonra kapanır. Kapalı görünmesi normaldir."),
    (r"(^|[-_.])(ui|e2e|unit|int)?tests?($|[-_.\d])|e2e|playwright|cypress|selenium", "test", "Test aracı",
     "Uygulamayı otomatik test eder. İşi bitince kapanır; kapalı görünmesi normaldir."),
]

IMAGE_KNOWN = [
    (r"adminer|pgadmin|phpmyadmin|mongo-express|redisinsight|dbgate", "panel", "Veritabanı paneli",
     "Veritabanını tarayıcıdan görüp düzenlemeni sağlar."),
    (r"postgres|postgis|timescale", "db", "Veritabanı (PostgreSQL)",
     "Uygulamanın bilgilerini (kullanıcılar, kayıtlar, siparişler…) kalıcı olarak saklar."),
    (r"mysql|mariadb|percona", "db", "Veritabanı (MySQL)",
     "Uygulamanın bilgilerini (kullanıcılar, kayıtlar, siparişler…) kalıcı olarak saklar."),
    (r"mongo", "db", "Veritabanı (MongoDB)",
     "Uygulamanın bilgilerini belge (JSON) şeklinde kalıcı olarak saklar."),
    (r"redis|valkey|keydb|dragonfly", "cache", "Hızlı hafıza (Redis)",
     "Sık kullanılan bilgileri hafızada tutar; oturumlar, önbellek ve iş kuyrukları için kullanılır."),
    (r"memcache", "cache", "Hızlı hafıza (Memcached)", "Sık kullanılan bilgileri hafızada tutar."),
    (r"nginx|caddy|traefik|httpd|apache|haproxy|envoy", "web", "Web sunucusu (kapı görevlisi)",
     "Dışarıdan gelen istekleri karşılar ve uygulamanın doğru parçasına yönlendirir."),
    (r"mailpit|mailhog|maildev|smtp", "mail", "Test e-posta kutusu",
     "Uygulamanın gönderdiği e-postaları yakalar; gerçek kişilere gitmez, buradan okursun."),
    (r"rabbitmq|kafka|nats|activemq", "queue", "Mesaj kuyruğu",
     "Parçalar arasında iş/mesaj taşır; biri iş bırakır, diğeri sırayla alıp yapar."),
    (r"minio|localstack|azurite", "storage", "Dosya deposu (S3)",
     "Yüklenen dosyaları (resim, belge) saklar. Amazon S3'ün bilgisayarındaki kopyası gibi."),
    (r"elasticsearch|opensearch|meilisearch|typesense|solr", "search", "Arama motoru",
     "Uygulamadaki aramaları hızlı ve akıllı yapar."),
    (r"buildkit", "build", "Derleme yardımcısı (Docker)",
     "Docker'ın imaj derlerken kullandığı yardımcı. Kapalı olması normaldir, silebilirsin."),
    (r"n8n", "app", "Otomasyon aracı (n8n)", "Sürükle-bırak ile otomasyonlar kurduğun panel."),
    (r"grafana|prometheus|loki|uptime-kuma", "monitor", "İzleme aracı",
     "Uygulamanın sağlığını ve istatistiklerini grafiklerle gösterir."),
    (r"ollama", "ai", "Yapay zekâ modeli (Ollama)", "Bilgisayarında yapay zekâ modeli çalıştırır."),
]

SERVICE_GENERIC = [
    (r"^(db|database|postgres|pg|mysql|mariadb|mongo)", "db", "Veritabanı",
     "Uygulamanın bilgilerini kalıcı olarak saklar."),
    (r"redis|cache", "cache", "Hızlı hafıza", "Sık kullanılan bilgileri hafızada tutar."),
    (r"front|^ui$|client|spa|next|nuxt|react|vue|svelte", "frontend", "Ön yüz (arayüz)",
     "Kullanıcının tarayıcıda gördüğü ekranları sunar."),
    (r"back|api|server", "backend", "Arka uç (API)",
     "Uygulamanın beyni: iş kurallarını çalıştırır, veritabanıyla konuşur."),
    (r"web|app|site|main|django|rails|laravel|flask|fastapi", "app", "Ana uygulama",
     "Yazdığın kodun çalıştığı yer. Siteyi/uygulamayı asıl bu parça çalıştırır."),
    (r"proxy|gateway", "web", "Web sunucusu (kapı görevlisi)",
     "Dışarıdan gelen istekleri karşılar ve doğru parçaya yönlendirir."),
    (r"mail|smtp", "mail", "E-posta", "E-posta ile ilgili işleri yapar."),
]

IMAGE_GENERIC = [
    (r"^(node|bun|deno)", "app", "Node.js uygulaması", "JavaScript/TypeScript kodu çalıştıran parça."),
    (r"^python|^pypy", "app", "Python uygulaması", "Python kodu çalıştıran parça."),
    (r"^php|laravel|wordpress", "app", "PHP uygulaması", "PHP kodu çalıştıran parça."),
    (r"^ruby|rails", "app", "Ruby uygulaması", "Ruby kodu çalıştıran parça."),
    (r"^golang|^go$", "app", "Go uygulaması", "Go kodu çalıştıran parça."),
    (r"openjdk|temurin|java|maven|gradle", "app", "Java uygulaması", "Java kodu çalıştıran parça."),
    (r"dotnet|aspnet", "app", ".NET uygulaması", ".NET kodu çalıştıran parça."),
    (r"^(alpine|ubuntu|debian|busybox|curl)", "other", "Yardımcı araç", "Küçük bir yardımcı/deneme parçası."),
]

KIND_ORDER = ["frontend", "app", "backend", "web", "db", "cache", "queue", "storage", "search",
              "worker", "scheduler", "mail", "panel", "monitor", "ai", "build", "backup", "task",
              "test", "other"]
# Bir kere çalışıp kapanması normal olan türler: uygulamanın "çalışıyor" durumunu bozmazlar.
ONESHOT_KINDS = {"task", "test", "build"}

# Tarayıcıda açılmayan (http olmayan) bilinen kapılar
NON_HTTP_PORTS = {5432, 5433, 3306, 33060, 27017, 6379, 6380, 5672, 1025, 11211, 9092, 4222,
                  1433, 1521, 25, 587, 2525, 22}


def _match(rules, text):
    for pattern, kind, title, desc in rules:
        if text and re.search(pattern, text):
            return {"kind": kind, "title": title, "desc": desc}
    return None


def image_base(image):
    img = (image or "").split("@")[0]
    last = img.rsplit("/", 1)[-1]
    return last.split(":")[0].lower()


def describe_role(service, image, name="", project=""):
    service = (service or "").lower()
    base = image_base(image)
    full = (image or "").lower()
    # Konteyner adı da ipucu verir (ör. servis "web" ama ad "proje-uitest").
    short = (name or "").lower()
    if project and short.startswith(project.lower()):
        short = short[len(project):].lstrip("-_")
    return (
        _match(SERVICE_SPECIFIC, service)
        or (short != service and _match(SERVICE_SPECIFIC, short))
        or _match(IMAGE_KNOWN, base)
        or _match(IMAGE_KNOWN, full)
        or _match(SERVICE_GENERIC, service)
        or _match(IMAGE_GENERIC, base)
        or {"kind": "other", "title": "Uygulama parçası", "desc": "Uygulamanın bir bölümü."}
    )


def container_status(state):
    status = state.get("Status", "")
    health = (state.get("Health") or {}).get("Status")
    code = state.get("ExitCode", 0)
    if status == "running":
        if health == "unhealthy":
            return "err", "Çalışıyor ama sağlıksız", "Sağlık kontrolünden geçemiyor. Kayıtlara bak."
        if health == "starting":
            return "warn", "Açılıyor…", "Hazır olması bekleniyor."
        return "ok", "Çalışıyor", ""
    if status == "restarting":
        return "err", "Sürekli çöküyor", "Açılıp tekrar kapanıyor. Kayıtlara bakıp hatayı bul."
    if status == "paused":
        return "warn", "Duraklatılmış", ""
    if status == "created":
        return "off", "Hiç başlatılmadı", ""
    if status == "dead":
        return "err", "Bozuk", "Silip yeniden oluşturman gerekebilir."
    if state.get("OOMKilled"):
        return "err", "Belleği yetmedi, kapandı", "Parça fazla bellek kullandı ve Docker onu kapattı."
    if code in (0, 137, 143):
        return "off", "Kapalı", ""
    return "err", f"Hata verip kapandı (kod {code})", "Kayıtlara bak; sebebi genelde son satırlarda yazar."


# ---------------------------------------------------------------------------
# Bağlantı bilgisi (DATABASE_URL gibi .env satırları)
# ---------------------------------------------------------------------------

def _cred(user, pw):
    if not user:
        return ""
    return quote(user, safe="") + (":" + quote(pw, safe="") if pw else "") + "@"


def _cmd_arg(cmd, flag):
    try:
        return cmd[cmd.index(flag) + 1]
    except (ValueError, IndexError):
        return ""


def connection_info(base, env, cmd, ports, alias):
    """Bilinen servisler için .env dosyasına yapıştırılabilecek bağlantı satırları üretir."""

    def endpoint(default_port):
        for p in ports:
            if p["container"] == default_port and p["proto"] == "tcp":
                return "localhost", p["host"], "local"
        return alias, default_port, "internal"

    lines, secret_values = [], []

    if re.search(r"postgres|postgis|timescale", base):
        user = env.get("POSTGRES_USER") or "postgres"
        pw = env.get("POSTGRES_PASSWORD", "")
        db = env.get("POSTGRES_DB") or user
        h, p, scope = endpoint(5432)
        lines.append(f"DATABASE_URL=postgresql://{_cred(user, pw)}{h}:{p}/{db}")
        secret_values.append(pw)
    elif re.search(r"mysql|mariadb|percona", base):
        user = env.get("MYSQL_USER") or env.get("MARIADB_USER")
        if user:
            pw = env.get("MYSQL_PASSWORD") or env.get("MARIADB_PASSWORD", "")
        else:
            user = "root"
            pw = env.get("MYSQL_ROOT_PASSWORD") or env.get("MARIADB_ROOT_PASSWORD", "")
        db = env.get("MYSQL_DATABASE") or env.get("MARIADB_DATABASE", "")
        h, p, scope = endpoint(3306)
        lines.append(f"DATABASE_URL=mysql://{_cred(user, pw)}{h}:{p}/{db}")
        secret_values.append(pw)
    elif base.startswith("mongo") and "express" not in base:
        user = env.get("MONGO_INITDB_ROOT_USERNAME", "")
        pw = env.get("MONGO_INITDB_ROOT_PASSWORD", "")
        h, p, scope = endpoint(27017)
        suffix = "/?authSource=admin" if user else ""
        lines.append(f"MONGODB_URI=mongodb://{_cred(user, pw)}{h}:{p}{suffix}")
        secret_values.append(pw)
    elif re.search(r"redis|valkey|keydb|dragonfly", base):
        pw = env.get("REDIS_PASSWORD") or _cmd_arg(cmd, "--requirepass")
        h, p, scope = endpoint(6379)
        lines.append(f"REDIS_URL=redis://{':' + quote(pw, safe='') + '@' if pw else ''}{h}:{p}")
        secret_values.append(pw)
    elif "rabbitmq" in base:
        user = env.get("RABBITMQ_DEFAULT_USER", "guest")
        pw = env.get("RABBITMQ_DEFAULT_PASS", "guest")
        h, p, scope = endpoint(5672)
        lines.append(f"RABBITMQ_URL=amqp://{_cred(user, pw)}{h}:{p}")
        secret_values.append(pw)
    elif "minio" in base:
        h, p, scope = endpoint(9000)
        lines += [
            f"S3_ENDPOINT=http://{h}:{p}",
            f"S3_ACCESS_KEY={env.get('MINIO_ROOT_USER', 'minioadmin')}",
            f"S3_SECRET_KEY={env.get('MINIO_ROOT_PASSWORD', 'minioadmin')}",
        ]
        secret_values.append(env.get("MINIO_ROOT_PASSWORD", ""))
    elif re.search(r"mailpit|mailhog|maildev", base):
        h, p, scope = endpoint(1025)
        lines += [f"SMTP_HOST={h}", f"SMTP_PORT={p}"]
    elif "meilisearch" in base:
        h, p, scope = endpoint(7700)
        key = env.get("MEILI_MASTER_KEY", "")
        lines += [f"MEILI_HOST=http://{h}:{p}"] + ([f"MEILI_MASTER_KEY={key}"] if key else [])
        secret_values.append(key)
    else:
        return None

    text = "\n".join(lines)
    masked = text
    for s in secret_values:
        if s:
            masked = masked.replace(quote(s, safe=""), "••••••").replace(s, "••••••")
    return {"text": text, "masked": masked, "scope": scope, "has_secret": masked != text}


# ---------------------------------------------------------------------------
# Konteynerleri okuma ve uygulamalara gruplama
# ---------------------------------------------------------------------------

SYSTEM_KEY = "_docker-yardimcilari"
SINGLE_PREFIX = "tek:"


def _is_system(name, image, labels):
    return (
        name.startswith("buildx_buildkit_")
        or image.startswith("moby/buildkit")
        or name.startswith("k8s_")
        or any(k.startswith("com.docker.desktop.extension") for k in labels)
    )


def _ports(attrs, kind):
    running = attrs.get("State", {}).get("Running")
    live = (attrs.get("NetworkSettings") or {}).get("Ports") or {}
    conf = (attrs.get("HostConfig") or {}).get("PortBindings") or {}
    source = live if running and live else conf
    ports, exposed, seen = [], set(), set()
    for key, binds in source.items():
        cport_s, _, proto = key.partition("/")
        try:
            cport = int(cport_s)
        except ValueError:
            continue
        exposed.add(cport)
        for b in binds or []:
            try:
                hport = int(b.get("HostPort") or 0)
            except ValueError:
                continue
            if not hport or (hport, proto) in seen:
                continue
            seen.add((hport, proto))
            web = proto == "tcp" and cport not in NON_HTTP_PORTS and kind not in ("db", "cache")
            ports.append({
                "host": hport,
                "container": cport,
                "proto": proto or "tcp",
                "local_only": (b.get("HostIp") or "") in ("127.0.0.1", "::1"),
                "url": f"http://localhost:{hport}" if web else None,
            })
    for key in ((attrs.get("Config") or {}).get("ExposedPorts") or {}):
        try:
            exposed.add(int(key.split("/")[0]))
        except ValueError:
            pass
    published = {p["container"] for p in ports}
    ports.sort(key=lambda p: p["host"])
    return ports, sorted(exposed - published)


def _mounts(attrs):
    out = []
    for m in attrs.get("Mounts") or []:
        if m.get("Type") == "volume":
            name = m.get("Name", "")
            out.append({
                "type": "volume",
                "name": name,
                "anonymous": bool(re.fullmatch(r"[0-9a-f]{64}", name)),
                "dest": m.get("Destination", ""),
            })
        elif m.get("Type") == "bind":
            source = m.get("Source", "")
            if source.startswith("/host_mnt/"):  # Docker Desktop'ın iç yolu -> gerçek klasör
                source = source[len("/host_mnt"):]
            out.append({"type": "bind", "source": source, "dest": m.get("Destination", "")})
    return out


def build_container(attrs):
    cfg = attrs.get("Config") or {}
    labels = cfg.get("Labels") or {}
    state = attrs.get("State") or {}
    name = (attrs.get("Name") or "").lstrip("/")
    image = cfg.get("Image") or attrs.get("Image", "")
    service = (labels.get("com.docker.compose.service") or labels.get("basicdocker.role") or name)
    project = labels.get("com.docker.compose.project") or labels.get("basicdocker.app") or ""
    if labels.get("com.docker.compose.oneoff") == "True":
        role = {"kind": "task", "title": "Tek seferlik komut",
                "desc": "'docker compose run' ile bir kere çalıştırılmış komut. Kapalı olması normaldir."}
    else:
        role = describe_role(service, image, name, project)
    level, status_text, status_hint = container_status(state)
    ports, internal = _ports(attrs, role["kind"])
    env = {}
    for item in cfg.get("Env") or []:
        k, _, v = item.partition("=")
        env[k] = v
    cmd = cfg.get("Cmd") or []

    compose = None
    if labels.get("com.docker.compose.project"):
        project = labels["com.docker.compose.project"]
        files = [f for f in (labels.get("com.docker.compose.project.config_files") or "").split(",") if f]
        wd = labels.get("com.docker.compose.project.working_dir", "")
        compose = {
            "project": project,
            "service": labels.get("com.docker.compose.service", ""),
            "files": files,
            "dir": wd,
            "exists": bool(files) and all(os.path.isfile(f) for f in files) and os.path.isdir(wd),
            "depends": [d.split(":")[0] for d in (labels.get("com.docker.compose.depends_on") or "").split(",") if d],
        }

    return {
        "id": attrs.get("Id", ""),
        "short_id": attrs.get("Id", "")[:12],
        "name": name,
        "image": image,
        "service": service,
        "state": state.get("Status", ""),
        "running": state.get("Status") == "running",
        "health": (state.get("Health") or {}).get("Status") if state.get("Status") == "running" else None,
        "exit_code": state.get("ExitCode", 0),
        "started_at": state.get("StartedAt", ""),
        "finished_at": state.get("FinishedAt", ""),
        "level": level,
        "status_text": status_text,
        "status_hint": status_hint,
        "kind": role["kind"],
        "role_title": role["title"],
        "role_desc": role["desc"],
        "ports": ports,
        "internal_ports": internal,
        "connection": connection_info(image_base(image), env, cmd, ports, service),
        "mounts": _mounts(attrs),
        "networks": sorted(((attrs.get("NetworkSettings") or {}).get("Networks") or {}).keys()),
        "compose": compose,
        "template": labels.get("basicdocker.template"),
        "_labels": labels,
    }


def pretty_name(key):
    words = re.split(r"[-_\s]+", key)
    return " ".join(w[:1].upper() + w[1:] for w in words if w) or key


def _app_state(cs):
    total = len(cs)
    running = sum(1 for c in cs if c["running"])
    expected = [c for c in cs if c["kind"] not in ONESHOT_KINDS or c["running"]]
    exp_running = sum(1 for c in expected if c["running"])
    crashed = [c for c in cs if c["level"] == "err" and not c["running"] and c["state"] != "restarting"
               and c["kind"] not in ONESHOT_KINDS]
    troubled = [c for c in cs if c["state"] == "restarting" or c["health"] == "unhealthy"]

    if total == 0:
        return "empty", "Kurulu değil", "Parçalar silinmiş. Başlat'a basarsan proje klasöründen yeniden kurulur."
    if troubled:
        names = ", ".join(c["role_title"] for c in troubled[:2])
        return "problem", "Sorun var", f"Sorunlu parça: {names}"
    hint = ""
    if crashed:
        hint = f"{len(crashed)} parça hata verip kapanmış: " + ", ".join(c["role_title"] for c in crashed[:2])
    if expected and exp_running == len(expected):
        return "running", "Çalışıyor", hint
    if running == 0:
        return "stopped", "Kapalı", hint
    off = [c["role_title"] for c in expected if not c["running"]]
    return "partial", f"Kısmen çalışıyor ({running}/{total})", hint or ("Kapalı: " + ", ".join(off[:3]))


def _summary(cs):
    titles = []
    for c in cs:
        t = c["role_title"]
        if t not in titles:
            titles.append(t)
    if len(titles) <= 3:
        return ", ".join(titles)
    return ", ".join(titles[:3]) + f" +{len(titles) - 3}"


def snapshot():
    """Docker'daki her şeyi okuyup uygulamalar listesi halinde döndürür."""
    if not DOCKER:
        return {"docker": {"ok": False, "reason": "yok"}, "apps": [], "taken_ports": []}
    code, out, err = docker("ps", "-aq", "--no-trunc", timeout=15)
    if code != 0:
        return {"docker": {"ok": False, "reason": "kapali", "detail": err.strip()[-300:]},
                "apps": [], "taken_ports": []}
    ids = out.split()
    raw = []
    if ids:
        # Arada silinen konteyner olursa inspect hata kodu verir ama diğerlerini yine basar.
        _, out, _ = docker("inspect", *ids, timeout=30)
        try:
            raw = json.loads(out or "[]")
        except ValueError:
            raw = []

    settings = load_settings()
    manual = settings["eslestirme"]
    groups = {}
    taken = set()
    for attrs in raw:
        c = build_container(attrs)
        for binds in ((attrs.get("HostConfig") or {}).get("PortBindings") or {}).values():
            for b in binds or []:
                if (b.get("HostPort") or "").isdigit():
                    taken.add(int(b["HostPort"]))
        labels = c["_labels"]
        if labels.get("basicdocker.app"):
            key, source = labels["basicdocker.app"], "basicdocker"
        elif c["compose"]:
            key, source = c["compose"]["project"], "compose"
        elif c["name"] in manual:
            key, source = manual[c["name"]], "manual"
        elif _is_system(c["name"], c["image"], labels):
            key, source = SYSTEM_KEY, "system"
        else:
            key, source = SINGLE_PREFIX + c["name"], "single"
        c["source"] = source
        del c["_labels"]
        groups.setdefault(key, []).append(c)

    # Compose projelerini hatırla: parçaları silinse bile listede kalsın, tekrar kurulabilsin.
    learned = {}
    for key, cs in groups.items():
        for c in cs:
            comp = c["compose"]
            if comp and comp["project"] == key and comp["files"]:
                learned[key] = {"files": comp["files"], "dir": comp["dir"]}
                break
    if any(settings["projeler"].get(k) != v for k, v in learned.items()):
        settings = update_settings(lambda s: s["projeler"].update(learned))

    for key, proj in settings["projeler"].items():
        files = proj.get("files") or []
        if key not in groups and files and all(os.path.isfile(f) for f in files):
            groups[key] = []

    apps = []
    for key, cs in groups.items():
        cs.sort(key=lambda c: (KIND_ORDER.index(c["kind"]) if c["kind"] in KIND_ORDER else 99, c["name"]))
        sources = {c["source"] for c in cs}
        if not cs or "compose" in sources:
            source = "compose"
        elif "basicdocker" in sources:
            source = "basicdocker"
        elif "manual" in sources:
            source = "manual"
        else:
            source = sources.pop()

        if key == SYSTEM_KEY:
            default_name = "Docker yardımcıları"
        elif key.startswith(SINGLE_PREFIX):
            default_name = key[len(SINGLE_PREFIX):]
        else:
            default_name = pretty_name(key)

        comp_info = None
        proj = settings["projeler"].get(key)
        if proj:
            files = proj.get("files") or []
            comp_info = {
                "dir": proj.get("dir", ""),
                "files": files,
                "exists": bool(files) and all(os.path.isfile(f) for f in files),
            }

        state, state_text, hint = _app_state(cs)
        links = []
        for c in cs:
            for p in c["ports"]:
                if p["url"]:
                    links.append({"url": p["url"], "label": f"localhost:{p['host']}", "role": c["role_title"],
                                  "running": c["running"]})
        apps.append({
            "key": key,
            "name": settings["adlar"].get(key) or default_name,
            "default_name": default_name,
            "note": settings["notlar"].get(key, ""),
            "source": source,
            "containers": cs,
            "total": len(cs),
            "running": sum(1 for c in cs if c["running"]),
            "state": state,
            "state_text": state_text,
            "hint": hint,
            "links": links,
            "summary": _summary(cs),
            "compose": comp_info,
        })

    rank = {"compose": 0, "basicdocker": 0, "manual": 0, "single": 1, "system": 2}
    apps.sort(key=lambda a: (rank.get(a["source"], 1), a["name"].lower()))
    return {"docker": {"ok": True}, "apps": apps, "taken_ports": sorted(taken)}


def get_app(key):
    for app in snapshot()["apps"]:
        if app["key"] == key:
            return app
    raise UserError("Uygulama bulunamadı. Liste yenilenmiş olabilir.")


def get_container(cid):
    for app in snapshot()["apps"]:
        for c in app["containers"]:
            if cid in (c["id"], c["short_id"], c["name"]):
                return app, c
    raise UserError("Parça bulunamadı. Silinmiş olabilir.")


# ---------------------------------------------------------------------------
# Arka plan işleri (uzun süren her şey burada, arayüz donmasın diye)
# ---------------------------------------------------------------------------

class Job:
    def __init__(self, title, app_key=None):
        self.id = uuid.uuid4().hex[:12]
        self.title = title
        self.app_key = app_key
        self.status = "calisiyor"  # calisiyor | bitti | hata
        self.message = ""
        self.lines = deque(maxlen=400)
        self.started = time.time()
        self.finished = None

    def log(self, text):
        for line in strip_ansi(text).replace("\r", "\n").split("\n"):
            line = line.rstrip()
            if line:
                self.lines.append(line)

    def to_dict(self, full=False):
        d = {
            "id": self.id,
            "title": self.title,
            "app": self.app_key,
            "status": self.status,
            "message": self.message,
            "last": self.lines[-1] if self.lines else "",
            "started": self.started,
            "finished": self.finished,
        }
        if full:
            d["lines"] = list(self.lines)
        return d


JOBS = {}
_jobs_lock = threading.Lock()


def start_job(title, app_key, fn, *args):
    with _jobs_lock:
        now = time.time()
        for jid in [j.id for j in JOBS.values() if j.finished and now - j.finished > 3600]:
            del JOBS[jid]
        if app_key and any(j.app_key == app_key and j.status == "calisiyor" for j in JOBS.values()):
            raise UserError("Bu uygulamada zaten bir işlem sürüyor, bitmesini bekle.")
        job = Job(title, app_key)
        JOBS[job.id] = job

    def runner():
        try:
            job.message = fn(job, *args) or "Tamamlandı."
            job.status = "bitti"
        except UserError as e:
            job.status = "hata"
            job.message = str(e)
        except Exception as e:  # beklenmeyen hatalar da kullanıcıya görünsün
            job.status = "hata"
            job.message = f"Beklenmeyen hata: {e}"
            job.log(traceback.format_exc())
        finally:
            job.finished = time.time()

    threading.Thread(target=runner, daemon=True).start()
    return job


def recent_jobs():
    now = time.time()
    with _jobs_lock:
        jobs = [j for j in JOBS.values() if not j.finished or now - j.finished < 120]
    return [j.to_dict() for j in sorted(jobs, key=lambda j: j.started)]


def get_job(jid):
    job = JOBS.get(jid)
    if not job:
        raise UserError("İş bulunamadı.")
    return job.to_dict(full=True)


def _stream(job, args, cwd=None, timeout=None):
    """Docker komutunu çalıştırıp çıktısını satır satır işe yazar; çıkış kodunu döndürür."""
    if not DOCKER:
        raise UserError("Docker bulunamadı.")
    proc = subprocess.Popen(
        [DOCKER, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
        env=ENV,
    )
    timer = None
    if timeout:
        timer = threading.Timer(timeout, proc.kill)
        timer.start()
    try:
        for line in proc.stdout:
            job.log(line)
        return proc.wait()
    finally:
        if timer:
            timer.cancel()


def _compose_args(project, files, wd):
    args = ["compose"]
    if project:
        args += ["-p", project]
    if wd:
        args += ["--project-directory", wd]
    for f in files:
        args += ["-f", f]
    return args


# ---------------------------------------------------------------------------
# Uygulama işlemleri
# ---------------------------------------------------------------------------

def _dependency_order(cs):
    """Compose depends_on bilgisine göre önce bağımlılıklar gelecek şekilde sıralar."""
    by_service = {c["compose"]["service"]: c for c in cs if c["compose"] and c["compose"]["service"]}
    ordered, seen = [], set()

    def visit(c, depth=0):
        if c["id"] in seen or depth > 50:
            return
        seen.add(c["id"])
        for dep in (c["compose"] or {}).get("depends", []):
            if dep in by_service:
                visit(by_service[dep], depth + 1)
        ordered.append(c)

    for c in cs:
        visit(c)
    return ordered


def _start_app(job, app):
    cs = app["containers"]
    if not cs:
        comp = app.get("compose")
        if comp and comp["exists"]:
            job.log("Parçalar proje klasöründen yeniden kuruluyor…")
            code = _stream(job, _compose_args(app["key"], comp["files"], comp["dir"]) + ["up", "-d"],
                           cwd=comp["dir"] or None)
            if code != 0:
                raise UserError("Kurulum başarısız oldu. Ayrıntılara bak.")
            return "Uygulama kuruldu ve başlatıldı."
        raise UserError("Bu uygulamanın başlatılacak parçası yok.")

    todo = [c for c in cs if not c["running"]]
    if not todo:
        return "Zaten her şey çalışıyor."

    for c in [c for c in todo if c["state"] == "paused"]:
        _stream(job, ["unpause", c["name"]], timeout=60)
        todo.remove(c)

    done = set()
    groups = {}
    for c in todo:
        comp = c["compose"]
        if comp and comp["exists"]:
            groups.setdefault((comp["project"], tuple(comp["files"]), comp["dir"]), []).append(c)
    for (project, files, wd), items in groups.items():
        job.log(f"Docker Compose ile başlatılıyor ({project})…")
        code = _stream(job, _compose_args(project, files, wd) + ["start"], cwd=wd or None, timeout=600)
        if code == 0:
            done.update(c["id"] for c in items)
        else:
            job.log("Compose ile olmadı, parçalar tek tek başlatılıyor…")

    failed = []
    for c in _dependency_order([c for c in todo if c["id"] not in done]):
        job.log(f"Başlatılıyor: {c['role_title']} ({c['name']})")
        if _stream(job, ["start", c["name"]], timeout=180) != 0:
            failed.append(c["name"])
    if failed:
        raise UserError("Şu parçalar başlatılamadı: " + ", ".join(failed) + ". Kayıtlarına bak.")
    return "Başlatıldı."


def _stop_app(job, app):
    names = [c["name"] for c in app["containers"] if c["state"] in ("running", "restarting", "paused")]
    if not names:
        return "Zaten kapalı."
    job.log("Durduruluyor: " + ", ".join(names))
    if _stream(job, ["stop", *names], timeout=300) != 0:
        raise UserError("Bazı parçalar durdurulamadı. Ayrıntılara bak.")
    return "Durduruldu."


def _restart_app(job, app):
    _stop_app(job, app)
    _start_app(job, get_app(app["key"]))
    return "Yeniden başlatıldı."


def _remove_containers(job, containers, with_data):
    names = [c["name"] for c in containers]
    if names:
        args = ["rm", "-f"] + (["-v"] if with_data else []) + names
        if _stream(job, args, timeout=300) != 0:
            raise UserError("Parçalar silinemedi. Ayrıntılara bak.")
    if with_data:
        volumes = sorted({m["name"] for c in containers for m in c["mounts"]
                          if m["type"] == "volume" and not m["anonymous"]})
        for v in volumes:
            code, _, err = docker("volume", "rm", v, timeout=60)
            job.log(f"Veri kutusu silindi: {v}" if code == 0 else f"Veri kutusu silinemedi ({v}): {err.strip()}")


def _delete_app(job, app, with_data):
    key = app["key"]
    _remove_containers(job, app["containers"], with_data)
    if not key.startswith(SINGLE_PREFIX) and key != SYSTEM_KEY:
        for label in (f"com.docker.compose.project={key}", f"basicdocker.app={key}"):
            _, out, _ = docker("network", "ls", "-q", "--filter", f"label={label}")
            for net in out.split():
                docker("network", "rm", net, timeout=30)

    def clean(s):
        for section in ("adlar", "notlar", "projeler"):
            s[section].pop(key, None)
        for cname in [n for n, k in s["eslestirme"].items() if k == key]:
            del s["eslestirme"][cname]

    update_settings(clean)
    return "Silindi." + (" Veriler de silindi." if with_data else " Veriler (veri kutuları) korundu.")


APP_ACTIONS = {
    "baslat": ("Başlatılıyor", _start_app),
    "durdur": ("Durduruluyor", _stop_app),
    "yeniden": ("Yeniden başlatılıyor", _restart_app),
    "sil": ("Siliniyor", _delete_app),
}


def app_action(key, action, with_data=False):
    if action not in APP_ACTIONS:
        raise UserError("Bilinmeyen işlem.")
    app = get_app(key)
    title, fn = APP_ACTIONS[action]
    args = (app, bool(with_data)) if action == "sil" else (app,)
    return start_job(f"{app['name']}: {title}", key, fn, *args)


def set_app_meta(key, name=None, note=None):
    def apply(s):
        if name is not None:
            if name.strip():
                s["adlar"][key] = name.strip()[:80]
            else:
                s["adlar"].pop(key, None)
        if note is not None:
            if note.strip():
                s["notlar"][key] = note.strip()[:1000]
            else:
                s["notlar"].pop(key, None)

    update_settings(apply)


# ---------------------------------------------------------------------------
# Tek parça işlemleri
# ---------------------------------------------------------------------------

def container_action(cid, action, with_data=False):
    app, c = get_container(cid)
    name = c["name"]
    if action == "terminal":
        return open_terminal(name)

    def run(job):
        if action == "baslat":
            code = _stream(job, ["start", name], timeout=180)
        elif action == "durdur":
            code = _stream(job, ["stop", name], timeout=180)
        elif action == "yeniden":
            code = _stream(job, ["restart", name], timeout=240)
        elif action == "sil":
            _remove_containers(job, [c], with_data)
            update_settings(lambda s: s["eslestirme"].pop(name, None))
            return "Parça silindi."
        else:
            raise UserError("Bilinmeyen işlem.")
        if code != 0:
            raise UserError("İşlem başarısız oldu. Kayıtlara bak.")
        return "Tamam."

    titles = {"baslat": "başlatılıyor", "durdur": "durduruluyor", "yeniden": "yeniden başlatılıyor", "sil": "siliniyor"}
    if action not in titles:
        raise UserError("Bilinmeyen işlem.")
    return start_job(f"{c['role_title']} ({name}) {titles[action]}", app["key"], run)


def move_container(cid, target_key, target_name=""):
    _, c = get_container(cid)
    if c["source"] not in ("single", "manual"):
        raise UserError("Bu parça zaten bir projeye bağlı; yalnızca tek başına duran parçalar taşınabilir.")
    target_key = (target_key or "").strip()
    if target_key == "__yeni__":
        target_key = slugify(target_name)
        if not target_key:
            raise UserError("Yeni uygulama için bir ad yaz.")

    def apply(s):
        if target_key:
            s["eslestirme"][c["name"]] = target_key
            if target_name.strip() and target_key not in s["adlar"]:
                s["adlar"][target_key] = target_name.strip()[:80]
        else:
            s["eslestirme"].pop(c["name"], None)

    update_settings(apply)


def logs(cid, tail=400):
    _, c = get_container(cid)
    try:
        p = subprocess.run(
            [DOCKER, "logs", "--tail", str(int(tail)), c["name"]],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", timeout=20, env=ENV,
        )
        return strip_ansi(p.stdout)
    except subprocess.TimeoutExpired:
        raise UserError("Kayıtlar zamanında okunamadı.")


def stats(key):
    app = get_app(key)
    names = [c["name"] for c in app["containers"] if c["running"]]
    if not names:
        return {}
    _, out, _ = docker("stats", "--no-stream", "--format", "{{json .}}", *names, timeout=25)
    result = {}
    for line in out.splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        result[d.get("Name", "")] = {
            "cpu": d.get("CPUPerc", ""),
            "mem": (d.get("MemUsage", "").split("/")[0]).strip(),
        }
    return result


# ---------------------------------------------------------------------------
# Yeni parça / uygulama oluşturma
# ---------------------------------------------------------------------------

_TR = str.maketrans("ıİşŞğĞüÜöÖçÇ", "iIsSgGuUoOcC")


def slugify(text):
    s = (text or "").translate(_TR).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:40].strip("-")


def gen_password(n=20):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _port_free(port):
    for host in ("127.0.0.1", "0.0.0.0"):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((host, port))
        except OSError:
            return False
        finally:
            s.close()
    return True


def pick_port(preferred, taken):
    port = preferred
    while port < 65000:
        if port not in taken and _port_free(port):
            return port
        port += 1
    raise UserError("Boş kapı bulunamadı.")


def _unique_name(base, existing):
    name, i = base, 2
    while name in existing:
        name = f"{base}-{i}"
        i += 1
    return name


def _resolve_target(app_key, new_name):
    """Seçilen uygulamayı ya da yeni uygulama adını anahtara çevirir."""
    if app_key and app_key != "__yeni__":
        if app_key.startswith(SINGLE_PREFIX) or app_key == SYSTEM_KEY or not NAME_RE.match(app_key):
            raise UserError("Bu uygulamaya parça eklenemez.")
        return app_key, None
    key = slugify(new_name)
    if not key:
        raise UserError("Yeni uygulama için bir ad yaz (ör. Blog Sitem).")
    return key, new_name.strip()[:80]


def _prepare(job, key, image):
    """İmajı indirir (yoksa) ve uygulamanın ağını hazırlar; (ağ, mevcut_adlar, dolu_kapılar) döndürür."""
    code, _, _ = docker("image", "inspect", image, timeout=20)
    if code != 0:
        job.log(f"{image} indiriliyor (ilk seferde biraz sürebilir)…")
        if _stream(job, ["pull", image]) != 0:
            raise UserError(f"{image} indirilemedi. İnternet bağlantını ve imaj adını kontrol et.")

    snap = snapshot()
    existing = {c["name"] for a in snap["apps"] for c in a["containers"]}
    network = None
    for a in snap["apps"]:
        if a["key"] == key:
            for c in a["containers"]:
                for n in c["networks"]:
                    if n not in ("bridge", "host", "none"):
                        network = n
                        break
                if network:
                    break
    if not network:
        network = f"basicdocker-{key}"
        code, _, _ = docker("network", "inspect", network)
        if code != 0:
            code, _, err = docker("network", "create", "--label", f"basicdocker.app={key}", network)
            if code != 0:
                raise UserError("Uygulama ağı oluşturulamadı: " + err.strip())
    return network, existing, set(snap["taken_ports"])


def _remember_name(key, display):
    if display:
        update_settings(lambda s: s["adlar"].setdefault(key, display))


def create_from_template(template_id, app_key, new_name):
    t = catalog.BY_ID.get(template_id)
    if not t:
        raise UserError("Böyle bir hazır parça yok.")
    key, display = _resolve_target(app_key, new_name)

    def run(job):
        network, existing, taken = _prepare(job, key, t["image"])
        name = _unique_name(f"{key}-{t['role']}", existing)
        password = gen_password()
        db_name = key.replace("-", "_")
        args = ["run", "-d", "--name", name, "--restart", "unless-stopped",
                "--network", network, "--network-alias", t["role"],
                "--label", f"basicdocker.app={key}", "--label", f"basicdocker.role={t['role']}",
                "--label", f"basicdocker.template={t['id']}"]
        chosen = []
        for p in t["ports"]:
            host = pick_port(p.get("host", p["container"]), taken)
            taken.add(host)
            chosen.append(f"{p['label']}: localhost:{host}")
            args += ["-p", f"127.0.0.1:{host}:{p['container']}"]
        if t.get("data"):
            args += ["-v", f"{name}-veri:{t['data']}"]
        for k, v in t["env"].items():
            args += ["-e", f"{k}={v.format(sifre=password, db=db_name)}"]
        args.append(t["image"])
        args += t.get("cmd", [])
        _remember_name(key, display)
        job.log(f"Parça oluşturuluyor: {name}")
        if _stream(job, args, timeout=300) != 0:
            raise UserError("Parça oluşturulamadı. Ayrıntılara bak.")
        for line in chosen:
            job.log(line)
        return f"{t['title']} kuruldu ve çalışıyor. Bağlantı bilgisi uygulamanın ayrıntılarında."

    return start_job(f"{t['title']} kuruluyor", key, run)


def create_custom(image, role, app_key, new_name, container_port, host_port, env_text, data_path):
    image = (image or "").strip()
    if not IMAGE_RE.match(image):
        raise UserError("İmaj adı geçersiz. Örnek: nginx:alpine")
    key, display = _resolve_target(app_key, new_name)
    role = slugify(role) or slugify(image_base(image)) or "parca"

    def to_port(value, label):
        if value in (None, ""):
            return None
        try:
            v = int(value)
        except (TypeError, ValueError):
            raise UserError(f"{label} bir sayı olmalı.")
        if not 1 <= v <= 65535:
            raise UserError(f"{label} 1 ile 65535 arasında olmalı.")
        return v

    cport = to_port(container_port, "İç kapı")
    hport = to_port(host_port, "Dış kapı")
    envs = []
    for line in (env_text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, sep, v = line.partition("=")
        if not sep or not ENV_KEY_RE.match(k.strip()):
            raise UserError(f"Ayar satırı anlaşılamadı: '{line}'. Biçim: AD=değer")
        envs.append(f"{k.strip()}={v}")
    data_path = (data_path or "").strip()
    if data_path and not data_path.startswith("/"):
        raise UserError("Veri klasörü / ile başlamalı (ör. /data).")

    def run(job):
        network, existing, taken = _prepare(job, key, image)
        name = _unique_name(f"{key}-{role}", existing)
        args = ["run", "-d", "--name", name, "--restart", "unless-stopped",
                "--network", network, "--network-alias", role,
                "--label", f"basicdocker.app={key}", "--label", f"basicdocker.role={role}"]
        if cport:
            host = hport or pick_port(cport if cport >= 1024 else 8080, taken)
            if hport and (hport in taken or not _port_free(hport)):
                raise UserError(f"{hport} numaralı kapı dolu. Başka bir sayı dene ya da boş bırak.")
            args += ["-p", f"127.0.0.1:{host}:{cport}"]
            job.log(f"Kapı: localhost:{host} → içeride {cport}")
        if data_path:
            args += ["-v", f"{name}-veri:{data_path}"]
        for e in envs:
            args += ["-e", e]
        args.append(image)
        _remember_name(key, display)
        job.log(f"Parça oluşturuluyor: {name}")
        if _stream(job, args, timeout=300) != 0:
            raise UserError("Parça oluşturulamadı. Ayrıntılara bak.")
        return f"{name} oluşturuldu."

    return start_job(f"{image} kuruluyor", key, run)


COMPOSE_NAMES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]


def _compose_target(path):
    path = os.path.realpath(os.path.expanduser((path or "").strip()))
    if os.path.isfile(path):
        return os.path.dirname(path), path
    if os.path.isdir(path):
        for n in COMPOSE_NAMES:
            if os.path.isfile(os.path.join(path, n)):
                return path, None  # standart ad: compose kendisi bulsun (override dosyası dahil)
        raise UserError("Bu klasörde docker-compose.yml (veya compose.yaml) yok.")
    raise UserError("Klasör bulunamadı.")


def compose_info(path):
    d, f = _compose_target(path)
    args = ["compose"] + (["-f", f] if f else []) + ["config", "--format", "json"]
    code, out, err = docker(*args, cwd=d, timeout=60)
    if code != 0:
        raise UserError("docker-compose dosyası okunamadı:\n" + strip_ansi(err).strip()[-800:])
    try:
        cfg = json.loads(out)
    except ValueError:
        raise UserError("docker-compose dosyası anlaşılamadı.")
    services = []
    for sname, s in (cfg.get("services") or {}).items():
        role = describe_role(sname, s.get("image", ""))
        services.append({
            "name": sname,
            "image": s.get("image", ""),
            "build": bool(s.get("build")),
            "role": role["title"],
            "kind": role["kind"],
        })
    name = cfg.get("name") or slugify(os.path.basename(d))
    known = {a["key"]: a["name"] for a in snapshot()["apps"]}
    return {
        "display": known.get(name) or pretty_name(name),
        "dir": d,
        "file": os.path.basename(f) if f else next(n for n in COMPOSE_NAMES if os.path.isfile(os.path.join(d, n))),
        "name": name,
        "services": services,
        "exists": name in known,
    }


def create_from_compose(path, project_name, display_name):
    info = compose_info(path)
    d, f = _compose_target(path)
    project = slugify(project_name) if project_name else ""
    if project == info["name"]:
        project = ""  # dosyadaki/klasördeki adı zaten kullanıyor; -p vermeye gerek yok
    final = project or info["name"]

    def run(job):
        args = ["compose"] + (["-p", project] if project else []) + (["-f", f] if f else []) + ["up", "-d"]
        job.log("Kuruluyor… (kendi kodun derlenecekse birkaç dakika sürebilir)")
        if _stream(job, args, cwd=d) != 0:
            raise UserError("Kurulum başarısız oldu. Ayrıntılardaki son satırlara bak.")
        if display_name and display_name.strip():
            set_app_meta(final, name=display_name)
        return "Proje kuruldu ve başlatıldı."

    return start_job(f"{display_name or pretty_name(final)} kuruluyor", final, run)


# ---------------------------------------------------------------------------
# Bilgisayarla ilgili küçük yardımcılar (macOS)
# ---------------------------------------------------------------------------

def open_folder(key):
    app = get_app(key)
    folder = (app.get("compose") or {}).get("dir")
    if not folder or not os.path.isdir(folder):
        raise UserError("Bu uygulamanın proje klasörü bilinmiyor.")
    if IS_MAC:
        subprocess.Popen(["open", folder])
    elif sys.platform.startswith("win"):
        os.startfile(folder)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", folder])


def open_terminal(name):
    if not IS_MAC:
        raise UserError(f"Terminal açma yalnızca macOS'ta var. Kendin çalıştır: docker exec -it {name} sh")
    if not NAME_RE.match(name):
        raise UserError("Geçersiz parça adı.")
    command = f"'{DOCKER}' exec -it {name} sh"
    subprocess.Popen([
        "osascript",
        "-e", f'tell application "Terminal" to do script "{command}"',
        "-e", 'tell application "Terminal" to activate',
    ])
    return None


def start_docker_desktop():
    if IS_MAC:
        subprocess.Popen(["open", "-a", "Docker"])
        return "Docker açılıyor… Bu 20-30 saniye sürebilir."
    if sys.platform.startswith("win"):
        path = os.path.expandvars(r"%ProgramFiles%\Docker\Docker\Docker Desktop.exe")
        if os.path.exists(path):
            subprocess.Popen([path])
            return "Docker açılıyor… Bu 20-30 saniye sürebilir."
    raise UserError("Docker'ı kendin başlatman gerekiyor (Linux: sudo systemctl start docker).")
