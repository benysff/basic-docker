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
_SETTINGS_KEYS = ("adlar", "notlar", "eslestirme", "projeler", "arayuz", "setler")


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
    (r"ollama", "model", "Model sunucusu (Ollama)", "Bilgisayarında yerel model sunucusu çalıştırır."),
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
              "worker", "scheduler", "mail", "panel", "monitor", "model", "build", "backup", "task",
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
        # Durdurulabilir mi? (çalışıyor, sürekli yeniden başlıyor ya da duraklatılmış)
        "up": state.get("Status") in ("running", "restarting", "paused"),
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
        "image_id": attrs.get("Image", ""),
        "oom": bool(state.get("OOMKilled")),
        "created": attrs.get("Created", ""),
        "restart_policy": ((attrs.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name") or "no",
        "restart_count": attrs.get("RestartCount", 0),
        "platform": attrs.get("Platform", ""),
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
            "up": sum(1 for c in cs if c["up"]),
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


def _compose_or_fail(app):
    comp = app.get("compose")
    if not comp or not comp.get("exists"):
        raise UserError("Bu işlem için uygulamanın docker-compose dosyası bilgisayarında bulunmalı.")
    return _compose_args(app["key"], comp["files"], comp["dir"]), comp["dir"] or None


def _update_app(job, app):
    """Kalıpların yeni sürümlerini indirir, değişen parçaları yeniden oluşturur."""
    args, cwd = _compose_or_fail(app)
    job.log("Yeni sürümler indiriliyor (kendi kodundan derlenen parçalar atlanır)…")
    if _stream(job, args + ["pull", "--ignore-buildable"], cwd=cwd, timeout=1800) != 0:
        job.log("Bazı kalıplar indirilemedi; eldekilerle devam ediliyor.")
    job.log("Değişen parçalar yeniden oluşturuluyor…")
    if _stream(job, args + ["up", "-d", "--remove-orphans"], cwd=cwd, timeout=1800) != 0:
        raise UserError("Güncelleme tamamlanamadı. Ayrıntılara bak.")
    return "Güncellendi. Değişmeyen parçalar olduğu gibi kaldı."


def _rebuild_app(job, app):
    """Kendi kodunu yeniden derleyip parçaları baştan oluşturur (docker compose up --build)."""
    args, cwd = _compose_or_fail(app)
    job.log("Kod yeniden derleniyor ve parçalar baştan oluşturuluyor…")
    if _stream(job, args + ["up", "-d", "--build", "--force-recreate"], cwd=cwd, timeout=3600) != 0:
        raise UserError("Yeniden kurulum başarısız oldu. Ayrıntılara bak.")
    return "Yeniden derlendi ve başlatıldı."


APP_ACTIONS = {
    "baslat": ("Başlatılıyor", _start_app),
    "durdur": ("Durduruluyor", _stop_app),
    "yeniden": ("Yeniden başlatılıyor", _restart_app),
    "sil": ("Siliniyor", _delete_app),
    "guncelle": ("Güncelleniyor", _update_app),
    "derle": ("Yeniden derleniyor", _rebuild_app),
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
            # Duraklatılmış parça "start" ile açılmaz; devam ettirilir.
            code = _stream(job, ["unpause" if c["state"] == "paused" else "start", name], timeout=180)
        elif action == "durdur":
            if c["state"] == "paused":
                _stream(job, ["unpause", name], timeout=60)
            code = _stream(job, ["stop", name], timeout=180)
        elif action == "yeniden":
            code = _stream(job, ["restart", name], timeout=240)
        elif action == "duraklat":
            code = _stream(job, ["pause", name], timeout=60)
        elif action == "devam":
            code = _stream(job, ["unpause", name], timeout=60)
        elif action == "oldur":
            code = _stream(job, ["kill", name], timeout=60)
        elif action == "sil":
            _remove_containers(job, [c], with_data)
            update_settings(lambda s: s["eslestirme"].pop(name, None))
            return "Parça silindi."
        else:
            raise UserError("Bilinmeyen işlem.")
        if code != 0:
            raise UserError("İşlem başarısız oldu. Kayıtlara bak.")
        return "Tamam."

    titles = {"baslat": "başlatılıyor", "durdur": "durduruluyor", "yeniden": "yeniden başlatılıyor", "sil": "siliniyor",
              "duraklat": "duraklatılıyor", "devam": "devam ettiriliyor", "oldur": "zorla kapatılıyor"}
    if action not in titles:
        raise UserError("Bilinmeyen işlem.")
    return start_job(f"{c['role_title']} ({name}) {titles[action]}", app["key"], run)


def bulk_container_action(ids, action, with_data=False):
    """Seçilen birçok parçaya aynı işlemi tek bir iş içinde sırayla uygular."""
    if action not in ("baslat", "durdur", "yeniden", "sil"):
        raise UserError("Bilinmeyen işlem.")
    ids = [i for i in (ids or []) if isinstance(i, str)][:200]
    targets = []
    for cid in ids:
        try:
            targets.append(get_container(cid)[1])
        except UserError:
            pass
    if not targets:
        raise UserError("Seçilen parçalar bulunamadı.")
    verb = {"baslat": "start", "durdur": "stop", "yeniden": "restart"}.get(action)

    def run(job):
        failed = []
        if action == "sil":
            _remove_containers(job, targets, with_data)
            update_settings(lambda s: [s["eslestirme"].pop(c["name"], None) for c in targets])
            return f"{len(targets)} parça silindi."
        if action == "baslat":
            todo = [c for c in targets if not c["up"] or c["state"] == "paused"]
        else:
            todo = [c for c in targets if c["up"]]
        for c in (_dependency_order(todo) if action == "baslat" else todo):
            job.log(f"{c['role_title']} ({c['name']})…")
            paused = c["state"] == "paused"
            if paused and action == "durdur":
                _stream(job, ["unpause", c["name"]], timeout=60)
            cmd = "unpause" if paused and action == "baslat" else verb
            if _stream(job, [cmd, c["name"]], timeout=240) != 0:
                failed.append(c["name"])
        if failed:
            raise UserError("Şunlarda sorun çıktı: " + ", ".join(failed))
        return f"{len(todo)} parça için tamamlandı."

    titles = {"baslat": "başlatılıyor", "durdur": "durduruluyor", "yeniden": "yeniden başlatılıyor", "sil": "siliniyor"}
    return start_job(f"{len(targets)} parça {titles[action]}", None, run)


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


# ---------------------------------------------------------------------------
# Parçanın ayrıntıları, komut çalıştırma, yeniden başlama kuralı
# ---------------------------------------------------------------------------

SECRET_KEY_RE = re.compile(r"PASS|SECRET|TOKEN|KEY|PWD|CREDENTIAL|PRIVATE|AUTH", re.I)

RESTART_POLICIES = {
    "no": "Hiçbir zaman (elle başlatırsın)",
    "on-failure": "Sadece hata verip kapanırsa",
    "unless-stopped": "Her zaman (sen durdurmadıysan)",
    "always": "Her zaman",
}


def inspect_container(name):
    code, out, err = docker("inspect", name, timeout=20)
    if code != 0:
        raise UserError("Parça okunamadı: " + err.strip()[-200:])
    try:
        return json.loads(out)[0]
    except (ValueError, IndexError):
        raise UserError("Parça bilgisi anlaşılamadı.")


def container_detail(cid):
    """Ayrıntı sayfası için: ortam değişkenleri, etiketler, ağ adresleri, sağlık kontrolü ve ham bilgi."""
    app, c = get_container(cid)
    attrs = inspect_container(c["name"])
    cfg = attrs.get("Config") or {}
    host = attrs.get("HostConfig") or {}
    state = attrs.get("State") or {}
    env = []
    for item in cfg.get("Env") or []:
        k, _, v = item.partition("=")
        env.append({"key": k, "value": v, "secret": bool(SECRET_KEY_RE.search(k)) and bool(v)})
    nets = []
    for nname, n in ((attrs.get("NetworkSettings") or {}).get("Networks") or {}).items():
        nets.append({
            "name": nname,
            "ip": n.get("IPAddress", ""),
            "aliases": [a for a in (n.get("Aliases") or []) if a != c["short_id"]][:6],
            "gateway": n.get("Gateway", ""),
        })
    health = state.get("Health") or {}
    health_log = [{
        "start": h.get("Start", ""),
        "code": h.get("ExitCode"),
        "output": strip_ansi(h.get("Output", "")).strip()[-600:],
    } for h in (health.get("Log") or [])[-5:]]
    hc = cfg.get("Healthcheck") or {}
    return {
        "container": c,
        "app": {"key": app["key"], "name": app["name"]},
        "env": env,
        "labels": cfg.get("Labels") or {},
        "cmd": cfg.get("Cmd") or [],
        "entrypoint": cfg.get("Entrypoint") or [],
        "workdir": cfg.get("WorkingDir", ""),
        "user": cfg.get("User", ""),
        "hostname": cfg.get("Hostname", ""),
        "networks": nets,
        "restart": {"policy": (host.get("RestartPolicy") or {}).get("Name") or "no",
                    "options": RESTART_POLICIES},
        "memory_limit": host.get("Memory") or 0,
        "cpu_limit": (host.get("NanoCpus") or 0) / 1e9,
        "health": {
            "status": health.get("Status"),
            "failing": health.get("FailingStreak", 0),
            "test": " ".join(hc.get("Test") or [])[:300],
            "log": health_log,
        },
        "raw": attrs,
    }


def exec_command(cid, command, timeout=30):
    """Parçanın içinde tek bir komut çalıştırıp çıktısını döndürür (uygulama içi mini terminal)."""
    _, c = get_container(cid)
    command = (command or "").strip()
    if not command:
        raise UserError("Bir komut yaz.")
    if len(command) > 2000:
        raise UserError("Komut çok uzun.")
    if not c["running"]:
        raise UserError("Parça kapalıyken içinde komut çalıştırılamaz. Önce başlat.")
    started = time.time()
    try:
        p = subprocess.run(
            [DOCKER, "exec", c["name"], "sh", "-c", command],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace", timeout=timeout, env=ENV,
        )
    except subprocess.TimeoutExpired as e:
        out = e.stdout if isinstance(e.stdout, str) else (e.stdout or b"").decode("utf-8", "replace")
        return {"output": strip_ansi(out or "")[-60000:], "code": None, "timeout": True,
                "seconds": round(time.time() - started, 1)}
    out = strip_ansi(p.stdout or "")
    if p.returncode == 126 or (p.returncode == 127 and "sh" in out and "not found" in out and len(out) < 300):
        out += "\n(Bu parçanın içinde komut satırı (sh) yok. Bazı küçük kalıplarda komut çalıştırılamaz.)"
    return {"output": out[-60000:], "code": p.returncode, "timeout": False,
            "seconds": round(time.time() - started, 1)}


def set_restart_policy(cid, policy):
    if policy not in RESTART_POLICIES:
        raise UserError("Geçersiz seçim.")
    _, c = get_container(cid)
    code, _, err = docker("update", "--restart", policy, c["name"], timeout=30)
    if code != 0:
        raise UserError("Değiştirilemedi: " + err.strip()[-200:])
    return RESTART_POLICIES[policy]


_TS_RE = re.compile(r"^(\d{4}-\d\d-\d\dT[\d:.]+Z?)\s?")


def app_logs(key, tail=300):
    """Uygulamanın bütün parçalarının kayıtlarını zamana göre birleştirir."""
    app = get_app(key)
    tail = max(20, min(int(tail or 300), 3000))
    merged = []
    for c in app["containers"]:
        try:
            p = subprocess.run(
                [DOCKER, "logs", "--timestamps", "--tail", str(tail), c["name"]],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", timeout=20, env=ENV,
            )
        except subprocess.TimeoutExpired:
            continue
        label = c["compose"]["service"] if c["compose"] and c["compose"]["service"] else c["name"]
        for line in strip_ansi(p.stdout).splitlines():
            m = _TS_RE.match(line)
            ts = m.group(1) if m else ""
            merged.append((ts, label, line[m.end():] if m else line))
    merged.sort(key=lambda x: x[0])
    return [{"t": t, "src": s, "line": ln} for t, s, ln in merged[-tail * 2:]]


def logs_ex(cid, tail=500, timestamps=False, since=""):
    """Kayıtları zaman damgasıyla ya da belirli bir süreden beri okur."""
    _, c = get_container(cid)
    args = [DOCKER, "logs", "--tail", str(max(10, min(int(tail or 500), 20000)))]
    if timestamps:
        args.append("--timestamps")
    if since and re.fullmatch(r"\d+[smhd]", since):
        args += ["--since", since]
    args.append(c["name"])
    try:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           text=True, encoding="utf-8", errors="replace", timeout=25, env=ENV)
    except subprocess.TimeoutExpired:
        raise UserError("Kayıtlar zamanında okunamadı.")
    return strip_ansi(p.stdout)


def app_env(key):
    """Uygulamanın bütün bağlantı bilgilerini tek bir .env metni olarak verir."""
    app = get_app(key)
    blocks = []
    for c in app["containers"]:
        if c["connection"]:
            blocks.append(f"# {c['role_title']} ({c['name']})\n{c['connection']['text']}")
    if not blocks:
        raise UserError("Bu uygulamada bağlantı bilgisi üretilebilen bir parça (veritabanı, Redis…) yok.")
    return f"# {app['name']} — Basic Docker tarafından üretildi\n\n" + "\n\n".join(blocks) + "\n"


def compose_files(key):
    app = get_app(key)
    comp = app.get("compose") or {}
    out = []
    for f in comp.get("files") or []:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                out.append({"path": f, "text": fh.read(200_000)})
        except OSError as e:
            out.append({"path": f, "text": f"(Okunamadı: {e})"})
    if not out:
        raise UserError("Bu uygulamanın compose dosyası bilinmiyor.")
    return out


# ---------------------------------------------------------------------------
# Çalışma setleri: birkaç uygulamayı tek tuşla birlikte aç/kapat
# ---------------------------------------------------------------------------

def list_sets():
    sets = load_settings()["setler"]
    return [{"id": k, "name": v.get("ad", k), "apps": list(v.get("uygulamalar") or [])}
            for k, v in sorted(sets.items(), key=lambda kv: kv[1].get("ad", kv[0]).lower())]


def save_set(set_id, name, apps):
    name = (name or "").strip()[:60]
    if not name:
        raise UserError("Sete bir ad ver (ör. İş, Kişisel projeler).")
    apps = [str(a) for a in (apps or []) if isinstance(a, str)][:50]
    if not apps:
        raise UserError("Sete en az bir uygulama ekle.")
    if not set_id:
        base = slugify(name) or uuid.uuid4().hex[:6]
        existing = load_settings()["setler"]
        set_id, i = base, 2
        while set_id in existing:
            set_id = f"{base}-{i}"
            i += 1

    def apply(s):
        s["setler"][set_id] = {"ad": name, "uygulamalar": apps}

    update_settings(apply)
    return set_id


def delete_set(set_id):
    update_settings(lambda s: s["setler"].pop(set_id, None))


def run_set(set_id, action):
    sets = {s["id"]: s for s in list_sets()}
    st = sets.get(set_id)
    if not st:
        raise UserError("Set bulunamadı.")
    if action not in ("baslat", "durdur"):
        raise UserError("Bilinmeyen işlem.")

    def run(job):
        known = {a["key"]: a for a in snapshot()["apps"]}
        missing = [k for k in st["apps"] if k not in known]
        failed = []
        for key in st["apps"]:
            if key not in known:
                continue
            app = get_app(key)
            job.log(f"{app['name']}: {'başlatılıyor' if action == 'baslat' else 'durduruluyor'}…")
            try:
                (_start_app if action == "baslat" else _stop_app)(job, app)
            except UserError as e:
                failed.append(app["name"])
                job.log(f"{app['name']}: {e}")
        if missing:
            job.log("Artık olmayan uygulamalar atlandı: " + ", ".join(missing))
        if failed:
            raise UserError("Şunlarda sorun çıktı: " + ", ".join(failed))
        return f"“{st['name']}” seti {'başlatıldı' if action == 'baslat' else 'durduruldu'}."

    return start_job(f"{st['name']} seti: {'başlatılıyor' if action == 'baslat' else 'durduruluyor'}", None, run)


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


def engine_kind():
    """Hangi Docker motoru kullanılıyor: 'orbstack', 'docker-desktop', 'colima' ya da 'diger'."""
    endpoint = ""
    if DOCKER:
        code, out, _ = docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}", timeout=8)
        if code == 0:
            endpoint = out.strip()
    endpoint = os.environ.get("DOCKER_HOST") or endpoint
    if ".orbstack" in endpoint:
        return "orbstack"
    if "colima" in endpoint:
        return "colima"
    if ".docker/run" in endpoint or "docker.raw.sock" in endpoint:
        return "docker-desktop"
    if IS_MAC:
        has_orb = os.path.isdir("/Applications/OrbStack.app")
        has_dd = os.path.isdir("/Applications/Docker.app")
        if has_orb and not has_dd:
            return "orbstack"
        if has_dd and not has_orb:
            return "docker-desktop"
    return "diger"


ENGINE_NAMES = {"orbstack": "OrbStack", "docker-desktop": "Docker Desktop", "colima": "Colima", "diger": "Docker"}


def start_docker_desktop():
    """Docker motorunu açar. OrbStack kullanan birinde OrbStack'i, değilse Docker Desktop'ı açar."""
    if IS_MAC:
        kind = engine_kind()
        if kind == "colima":
            subprocess.Popen(["colima", "start"], env=ENV)
            return "Colima başlatılıyor… Bu 20-30 saniye sürebilir."
        app = "OrbStack" if kind == "orbstack" else "Docker"
        subprocess.Popen(["open", "-a", app])
        return f"{ENGINE_NAMES.get(kind if kind != 'diger' else 'docker-desktop')} açılıyor… Bu 10-30 saniye sürebilir."
    if sys.platform.startswith("win"):
        path = os.path.expandvars(r"%ProgramFiles%\Docker\Docker\Docker Desktop.exe")
        if os.path.exists(path):
            subprocess.Popen([path])
            return "Docker açılıyor… Bu 20-30 saniye sürebilir."
    raise UserError("Docker'ı kendin başlatman gerekiyor (Linux: sudo systemctl start docker).")
