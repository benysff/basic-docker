"""Yedekler: veri kutusu (volume) yedeği ve veritabanı dökümü, sonra geri yükleme.

- Veri kutusu yedeği: kutunun içeriği .tar.gz dosyası olarak Mac'ine kaydedilir.
  Küçük bir yardımcı kalıp (alpine) kutuyu salt-okunur bağlayıp arşivler.
- Veritabanı dökümü: PostgreSQL / MySQL / MariaDB / MongoDB için veritabanının kendi aracıyla
  (pg_dumpall, mysqldump, mongodump) tutarlı bir döküm alınır. Çalışırken alınabilir.

Yedekler varsayılan olarak ~/Documents/Basic Docker Yedekleri klasöründe durur.
"""
from __future__ import annotations

import os
import re
import subprocess
import time

import docker_service as ds
import resources as rs

UserError = ds.UserError

VOL_DIR = "Veri kutuları"
DB_DIR = "Veritabanları"
HELPER_DEFAULT = "alpine:3.20"
HELPER_LABEL = "basicdocker.yardimci=1"  # etkinlik listesinde görünmesin
TOOL_MISSING = (126, 127)  # docker exec: program bulunamadı / çalıştırılamadı


def backup_root():
    custom = ds.load_settings()["arayuz"].get("yedek_klasoru")
    root = custom if custom and os.path.isabs(custom) else os.path.expanduser("~/Documents/Basic Docker Yedekleri")
    return root


def set_backup_root(path):
    path = os.path.realpath(os.path.expanduser((path or "").strip()))
    if not os.path.isdir(path):
        raise UserError("Klasör bulunamadı.")
    ds.update_settings(lambda s: s["arayuz"].update({"yedek_klasoru": path}))
    return path


def _stamp():
    return time.strftime("%Y-%m-%d_%H-%M-%S")


def _safe(name):
    return re.sub(r"[^\w.-]+", "-", name)[:120]


def _inside_root(path):
    root = os.path.realpath(backup_root())
    real = os.path.realpath(path)
    return real == root or real.startswith(root + os.sep)


def _helper_image(job):
    """Yerelde duran küçük bir alpine/busybox kalıbı bulur; yoksa bir kere indirir (~3 MB)."""
    code, out, _ = ds.docker("image", "ls", "--format", "{{.Repository}}:{{.Tag}}", timeout=20)
    if code == 0:
        refs = [r for r in out.split() if not r.endswith(":<none>")]
        for prefix in ("alpine:", "busybox:"):
            for r in refs:
                if r.startswith(prefix):
                    return r
    job.log(f"Yardımcı küçük kalıp indiriliyor ({HELPER_DEFAULT}, yaklaşık 3 MB, sadece bir kere)…")
    if ds._stream(job, ["pull", HELPER_DEFAULT], timeout=600) != 0:
        raise UserError("Yardımcı kalıp indirilemedi. İnternet bağlantını kontrol et.")
    return HELPER_DEFAULT


def _run_to_file(job, args, path, timeout=3600):
    """Docker komutunun stdout'unu dosyaya yazar, stderr'i işe kaydeder."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".yaziliyor"
    with open(tmp, "wb") as fh:
        proc = subprocess.Popen([ds.DOCKER, *args], stdout=fh, stderr=subprocess.PIPE, env=ds.ENV)
        try:
            _, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, err = proc.communicate()
            err = (err or b"") + b"\nZaman asimi."
    for line in (err or b"").decode("utf-8", "replace").splitlines():
        if line.strip():
            job.log(line)
    if proc.returncode != 0 or os.path.getsize(tmp) == 0:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return proc.returncode or 1
    os.replace(tmp, path)
    return 0


def _run_from_file(job, args, path, timeout=3600):
    with open(path, "rb") as fh:
        proc = subprocess.Popen([ds.DOCKER, *args], stdin=fh, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, env=ds.ENV)
        try:
            out, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
    text = (out or b"").decode("utf-8", "replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    for ln in lines[-200:]:
        job.log(ln)
    return proc.returncode


# ---------------------------------------------------------------------------
# Veri kutusu yedeği
# ---------------------------------------------------------------------------

def backup_volume(name):
    if not ds.NAME_RE.match(name or ""):
        raise UserError("Geçersiz veri kutusu adı.")
    code, _, _ = ds.docker("volume", "inspect", name, timeout=15)
    if code != 0:
        raise UserError("Veri kutusu bulunamadı.")
    users = [v for v in rs.list_volumes() if v["name"] == name]
    running_db = users and users[0]["db"] and users[0]["running"]

    def run(job):
        helper = _helper_image(job)
        path = os.path.join(backup_root(), VOL_DIR, f"{_safe(name)}__{_stamp()}.tar.gz")
        if running_db:
            job.log("Not: Bu kutuyu kullanan veritabanı çalışıyor. En tutarlı yedek için 'Veritabanı dökümü' de al.")
        job.log(f"{name} arşivleniyor…")
        code = _run_to_file(job, ["run", "--rm", "--label", HELPER_LABEL, "-v", f"{name}:/kutu:ro", "--entrypoint", "tar", helper,
                                  "czf", "-", "-C", "/kutu", "."], path)
        if code != 0:
            raise UserError("Yedek alınamadı. Ayrıntılara bak.")
        job.log(f"Kaydedildi: {path}")
        return f"Yedek alındı ({rs.human_size(os.path.getsize(path))})."

    return ds.start_job(f"{name} yedekleniyor", f"_kutu:{name}", run)


def restore_volume(path, target, create_new=False, wipe=False):
    path = os.path.realpath(os.path.expanduser(path or ""))
    if not os.path.isfile(path) or not path.endswith((".tar.gz", ".tgz", ".tar")):
        raise UserError("Yedek dosyası bulunamadı (.tar.gz olmalı).")
    target = (target or "").strip()
    if not ds.NAME_RE.match(target):
        raise UserError("Hedef veri kutusunun adı geçersiz.")
    exists = ds.docker("volume", "inspect", target, timeout=15)[0] == 0
    if create_new and exists:
        raise UserError(f"“{target}” adında bir veri kutusu zaten var. Başka bir ad seç.")
    if not create_new and not exists:
        raise UserError("Hedef veri kutusu bulunamadı.")
    if exists:
        busy = [u["name"] for v in rs.list_volumes() if v["name"] == target for u in v["used_by"] if u["running"]]
        if busy:
            raise UserError("Bu kutuyu kullanan parçalar çalışıyor: " + ", ".join(busy) + ". Önce onları durdur.")

    def run(job):
        helper = _helper_image(job)
        if create_new:
            code, _, err = ds.docker("volume", "create", target, timeout=30)
            if code != 0:
                raise UserError("Veri kutusu oluşturulamadı: " + err.strip()[-200:])
            job.log(f"Yeni veri kutusu oluşturuldu: {target}")
        script = ("find /kutu -mindepth 1 -delete && " if wipe else "") + "tar xzf - -C /kutu"
        if path.endswith(".tar"):
            script = script.replace("tar xzf", "tar xf")
        job.log(f"{os.path.basename(path)} → {target} geri yükleniyor…")
        code = _run_from_file(job, ["run", "--rm", "--label", HELPER_LABEL, "-i", "-v", f"{target}:/kutu", "--entrypoint", "sh", helper,
                                    "-c", script], path)
        if code != 0:
            raise UserError("Geri yükleme başarısız oldu. Ayrıntılara bak.")
        rs.invalidate_df()
        return f"Geri yüklendi: {target}"

    return ds.start_job(f"{target} geri yükleniyor", f"_kutu:{target}", run)


# ---------------------------------------------------------------------------
# Veritabanı dökümü
# ---------------------------------------------------------------------------

def _db_engine(image):
    base = ds.image_base(image)
    if re.search(r"postgres|postgis|timescale", base):
        return "postgres"
    if re.search(r"mariadb", base):
        return "mariadb"
    if re.search(r"mysql|percona", base):
        return "mysql"
    if base.startswith("mongo") and "express" not in base:
        return "mongo"
    return None


def db_support(container):
    """Arayüz için: bu parçadan döküm alınabilir mi?"""
    return _db_engine(container.get("image", "")) if container.get("kind") == "db" else None


def _env_of(name):
    attrs = ds.inspect_container(name)
    env = {}
    for item in (attrs.get("Config") or {}).get("Env") or []:
        k, _, v = item.partition("=")
        env[k] = v
    return env


def _dump_plan(engine, env):
    """(exec argümanları, ortam değişkenleri, dosya uzantısı)"""
    if engine == "postgres":
        user = env.get("POSTGRES_USER") or "postgres"
        extra = {"PGPASSWORD": env["POSTGRES_PASSWORD"]} if env.get("POSTGRES_PASSWORD") else {}
        return ["pg_dumpall", "-U", user, "--clean", "--if-exists"], extra, "sql"
    if engine in ("mysql", "mariadb"):
        root_pw = env.get("MYSQL_ROOT_PASSWORD") or env.get("MARIADB_ROOT_PASSWORD")
        allow_empty = env.get("MYSQL_ALLOW_EMPTY_PASSWORD") or env.get("MARIADB_ALLOW_EMPTY_ROOT_PASSWORD")
        base = ["--single-transaction", "--routines", "--triggers", "--events"]
        if root_pw or allow_empty:
            return ["-uroot", "--all-databases", *base], ({"MYSQL_PWD": root_pw} if root_pw else {}), "sql"
        user = env.get("MYSQL_USER") or env.get("MARIADB_USER")
        db = env.get("MYSQL_DATABASE") or env.get("MARIADB_DATABASE")
        if user and db:
            # Root olmayan kullanıcının EVENT/PROCESS yetkisi olmayabilir.
            pw = env.get("MYSQL_PASSWORD") or env.get("MARIADB_PASSWORD", "")
            return ([f"-u{user}", "--databases", db, "--single-transaction", "--no-tablespaces", "--routines",
                     "--triggers"], {"MYSQL_PWD": pw}, "sql")
        raise UserError("Veritabanı şifresi parçanın ayarlarında bulunamadı; döküm alınamıyor.")
    if engine == "mongo":
        args = ["mongodump", "--archive", "--gzip"]
        user, pw = env.get("MONGO_INITDB_ROOT_USERNAME"), env.get("MONGO_INITDB_ROOT_PASSWORD")
        if user and pw:
            args += ["-u", user, "-p", pw, "--authenticationDatabase", "admin"]
        return args, {}, "archive.gz"
    raise UserError("Bu parça için döküm desteklenmiyor (PostgreSQL, MySQL, MariaDB, MongoDB desteklenir).")


def _exec_env_args(extra):
    out = []
    for k, v in extra.items():
        out += ["-e", f"{k}={v}"]
    return out


def dump_database(cid):
    _, c = ds.get_container(cid)
    engine = _db_engine(c["image"])
    if not engine:
        raise UserError("Bu parça bir veritabanı gibi görünmüyor.")
    if not c["running"]:
        raise UserError("Döküm için veritabanının çalışıyor olması gerekir. Önce başlat.")
    env = _env_of(c["name"])
    args, extra, ext = _dump_plan(engine, env)

    family = "mysql" if engine in ("mysql", "mariadb") else engine
    if ext == "sql":
        ext = f"{family}.sql"  # dosya adı hangi veritabanına ait olduğunu söylesin (yanlış yere yüklenmesin)

    def run(job):
        path = os.path.join(backup_root(), DB_DIR, f"{_safe(c['name'])}__{_stamp()}.{ext}")
        tools = [args]
        if engine in ("mysql", "mariadb"):
            tools = [["mysqldump", *args], ["mariadb-dump", *args]]
        for i, tool in enumerate(tools):
            job.log(f"{c['role_title']} dökümü alınıyor ({tool[0]})…")
            code = _run_to_file(job, ["exec", *_exec_env_args(extra), c["name"], *tool], path)
            if code == 0:
                job.log(f"Kaydedildi: {path}")
                return f"Veritabanı dökümü alındı ({rs.human_size(os.path.getsize(path))})."
            if code not in TOOL_MISSING or i + 1 >= len(tools):
                break
            job.log("Bu araç yok, diğeri deneniyor…")
        raise UserError("Döküm alınamadı. Ayrıntılara bak.")

    return ds.start_job(f"{c['name']} veritabanı dökümü", None, run)


def restore_database(cid, path):
    path = os.path.realpath(os.path.expanduser(path or ""))
    if not os.path.isfile(path):
        raise UserError("Döküm dosyası bulunamadı.")
    _, c = ds.get_container(cid)
    engine = _db_engine(c["image"])
    if not engine:
        raise UserError("Bu parça bir veritabanı gibi görünmüyor.")
    if not c["running"]:
        raise UserError("Geri yükleme için veritabanının çalışıyor olması gerekir. Önce başlat.")
    env = _env_of(c["name"])
    if engine == "postgres":
        user = env.get("POSTGRES_USER") or "postgres"
        extra = {"PGPASSWORD": env["POSTGRES_PASSWORD"]} if env.get("POSTGRES_PASSWORD") else {}
        tools = [["psql", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=0", "-q"]]
    elif engine in ("mysql", "mariadb"):
        root_pw = env.get("MYSQL_ROOT_PASSWORD") or env.get("MARIADB_ROOT_PASSWORD")
        if root_pw or env.get("MYSQL_ALLOW_EMPTY_PASSWORD") or env.get("MARIADB_ALLOW_EMPTY_ROOT_PASSWORD"):
            extra, who = ({"MYSQL_PWD": root_pw} if root_pw else {}), "-uroot"
        else:
            user = env.get("MYSQL_USER") or env.get("MARIADB_USER") or "root"
            extra, who = {"MYSQL_PWD": env.get("MYSQL_PASSWORD") or env.get("MARIADB_PASSWORD", "")}, f"-u{user}"
        tools = [["mysql", who], ["mariadb", who]]
    else:
        extra = {}
        args = ["mongorestore", "--archive", "--gzip", "--drop"]
        user, pw = env.get("MONGO_INITDB_ROOT_USERNAME"), env.get("MONGO_INITDB_ROOT_PASSWORD")
        if user and pw:
            args += ["-u", user, "-p", pw, "--authenticationDatabase", "admin"]
        tools = [args]

    def run(job):
        for i, tool in enumerate(tools):
            job.log(f"{os.path.basename(path)} geri yükleniyor ({tool[0]})…")
            code = _run_from_file(job, ["exec", "-i", *_exec_env_args(extra), c["name"], *tool], path)
            if code == 0:
                return "Veritabanı geri yüklendi."
            if code not in TOOL_MISSING or i + 1 >= len(tools):
                break  # araç vardı ama hata verdi: dökümü ikinci kez çalıştırma
            job.log("Bu araç yok, diğeri deneniyor…")
        raise UserError("Geri yükleme hatalarla bitti. Ayrıntılara bak.")

    return ds.start_job(f"{c['name']} veritabanı geri yükleniyor", None, run)


# ---------------------------------------------------------------------------
# Yedek dosyaları
# ---------------------------------------------------------------------------

_NAME_RE = re.compile(r"^(?P<src>.+)__(?P<ts>\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)\.(?P<ext>.+)$")


def _dump_engine(path, ext):
    """Dökümün hangi veritabanına ait olduğu: dosya adından, yoksa ilk satırlarından."""
    if ext.startswith("postgres"):
        return "postgres"
    if ext.startswith("mysql"):
        return "mysql"
    if "archive" in ext:
        return "mongo"
    try:
        with open(path, "rb") as fh:
            head = fh.read(400).decode("utf-8", "replace")
    except OSError:
        return None
    if "PostgreSQL" in head:
        return "postgres"
    if "MySQL dump" in head or "MariaDB dump" in head:
        return "mysql"
    return None


def list_backups():
    root = backup_root()
    out = []
    for sub, kind in ((VOL_DIR, "volume"), (DB_DIR, "db")):
        d = os.path.join(root, sub)
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if n.startswith(".") or n.endswith(".yaziliyor"):
                continue
            p = os.path.join(d, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            m = _NAME_RE.match(n)
            ext = m.group("ext") if m else n.rsplit(".", 1)[-1]
            out.append({
                "path": p, "file": n, "kind": kind,
                "source": m.group("src") if m else n,
                "ext": ext,
                "engine": _dump_engine(p, ext) if kind == "db" else None,
                "size": st.st_size, "mtime": st.st_mtime,
            })
    out.sort(key=lambda b: b["mtime"], reverse=True)
    return {"root": root, "backups": out}


def delete_backup(path):
    if not path or not os.path.isfile(path) or not _inside_root(path):
        raise UserError("Yedek dosyası bulunamadı.")
    if ds.IS_MAC:
        # Kalıcı silme yerine Çöp Sepeti'ne taşı (geri alınabilsin). macOS'un kendi işlevi;
        # Finder'ı kontrol etmek için izin istemez.
        try:
            from Foundation import NSFileManager, NSURL
            ok, _, err = NSFileManager.defaultManager().trashItemAtURL_resultingItemURL_error_(
                NSURL.fileURLWithPath_(path), None, None)
            if ok:
                return "Çöp Sepeti'ne taşındı."
            raise UserError("Çöp Sepeti'ne taşınamadı: " + str(err.localizedDescription() if err else ""))
        except ImportError:
            pass
    os.remove(path)
    return "Silindi."


def reveal(path=None):
    target = path if path and os.path.exists(path) and _inside_root(path) else backup_root()
    os.makedirs(backup_root(), exist_ok=True)
    if ds.IS_MAC:
        subprocess.Popen(["open", "-R", target] if os.path.isfile(target) else ["open", target])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(target) if os.path.isfile(target) else target])
