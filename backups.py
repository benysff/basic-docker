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
import tarfile
import time

import docker_service as ds
import resources as rs

UserError = ds.UserError
L = ds.L

VOL_DIR = "Veri kutuları"
DB_DIR = "Veritabanları"
HELPER_DEFAULT = "alpine:3.20"
HELPER_LABEL = "basicdocker.yardimci=1"  # etkinlik listesinde görünmesin
TOOL_MISSING = (126, 127)  # docker exec: program bulunamadı / çalıştırılamadı


def backup_root():
    custom = ds.load_settings()["arayuz"].get("yedek_klasoru")
    root = custom if custom and os.path.isabs(custom) else os.path.expanduser("~/Documents/Basic Docker Yedekleri")
    return os.path.normpath(root)  # Windows'ta karışık / ve \ olmasın (Gezgin yanlış klasörü açıyordu)


def clean_path(path):
    """Yapıştırılan yol: baştaki/sondaki boşluklar ve Gezgin'in “Yol olarak kopyala”sının eklediği tırnaklar gider."""
    return (path or "").strip().strip('"').strip("'").strip()


def set_backup_root(path):
    path = os.path.realpath(os.path.expanduser(clean_path(path)))
    if not os.path.isdir(path):
        raise UserError(L("Klasör bulunamadı.", "Folder not found."))
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
    job.log(L(f"Yardımcı küçük kalıp indiriliyor ({HELPER_DEFAULT}, yaklaşık 3 MB, sadece bir kere)…",
              f"Pulling a small helper image ({HELPER_DEFAULT}, about 3 MB, only once)…"))
    if ds._stream(job, ["pull", HELPER_DEFAULT], timeout=600) != 0:
        raise UserError(L("Yardımcı kalıp indirilemedi. İnternet bağlantını kontrol et.", "Could not pull the helper image. Check your internet connection."))
    return HELPER_DEFAULT


def _run_to_file(job, args, path, timeout=3600):
    """Docker komutunun stdout'unu dosyaya yazar, stderr'i işe kaydeder."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".yaziliyor"
    with open(tmp, "wb") as fh:
        proc = subprocess.Popen([ds.DOCKER, *args], stdout=fh, stderr=subprocess.PIPE, env=ds.cur_env())
        try:
            _, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, err = proc.communicate()
            err = (err or b"") + b"\ntimeout"
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


def _run_from_file(job, args, path, timeout=3600, stats=None):
    with open(path, "rb") as fh:
        proc = subprocess.Popen([ds.DOCKER, *args], stdin=fh, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, env=ds.cur_env())
        try:
            out, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
    text = (out or b"").decode("utf-8", "replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    for ln in lines[-200:]:
        job.log(ln)
    if stats is not None:
        stats["errors"] = sum(1 for ln in lines if "ERROR:" in ln)  # psql hatayı yazar ama 0 ile çıkabilir
    return proc.returncode


def _check_archive(path):
    """Yedeği sonuna kadar okur; bozuk ya da yarım dosyada kutuya dokunmadan durmak için."""
    try:
        with tarfile.open(path, "r:*") as tf:
            for _ in tf:
                pass
    except (tarfile.TarError, OSError, EOFError, ValueError) as e:
        raise UserError(L(f"Yedek dosyası bozuk ya da eksik ({e}); veri kutusuna dokunulmadı.",
                          f"The backup file is corrupt or incomplete ({e}); the volume was not touched."))


# ---------------------------------------------------------------------------
# Veri kutusu yedeği
# ---------------------------------------------------------------------------

def backup_volume(name):
    if not ds.NAME_RE.match(name or ""):
        raise UserError(L("Geçersiz veri kutusu adı.", "Invalid volume name."))
    code, _, _ = ds.docker("volume", "inspect", name, timeout=15)
    if code != 0:
        raise UserError(L("Veri kutusu bulunamadı.", "Volume not found."))
    users = [v for v in rs.list_volumes() if v["name"] == name]
    running_db = users and users[0]["db"] and users[0]["running"]

    def run(job):
        helper = _helper_image(job)
        path = os.path.join(backup_root(), VOL_DIR, f"{_safe(name)}__{_stamp()}.tar.gz")
        if running_db:
            job.log(L("Not: Bu kutuyu kullanan veritabanı çalışıyor. En tutarlı yedek için 'Veritabanı dökümü' de al.",
                      "Note: the database using this volume is running. For the most consistent backup, also take a 'Database dump'."))
        job.log(L(f"{name} arşivleniyor…", f"Archiving {name}…"))
        code = _run_to_file(job, ["run", "--rm", "--label", HELPER_LABEL, "-v", f"{name}:/kutu:ro", "--entrypoint", "tar", helper,
                                  "czf", "-", "-C", "/kutu", "."], path)
        if code != 0:
            raise UserError(L("Yedek alınamadı. Ayrıntılara bak.", "The backup failed. See the details."))
        job.log(L(f"Kaydedildi: {path}", f"Saved: {path}"))
        return L(f"Yedek alındı ({rs.human_size(os.path.getsize(path))}).", f"Backup saved ({rs.human_size(os.path.getsize(path))}).")

    return ds.start_job(L(f"{name} yedekleniyor", f"Backing up {name}"), f"_kutu:{name}", run)


def restore_volume(path, target, create_new=False, wipe=False):
    path = os.path.realpath(os.path.expanduser(clean_path(path)))
    if not os.path.isfile(path) or not path.endswith((".tar.gz", ".tgz", ".tar")):
        raise UserError(L("Yedek dosyası bulunamadı (.tar.gz olmalı).", "Backup file not found (must be .tar.gz)."))
    target = (target or "").strip()
    if not ds.NAME_RE.match(target):
        raise UserError(L("Hedef veri kutusunun adı geçersiz.", "Invalid target volume name."))
    exists = ds.docker("volume", "inspect", target, timeout=15)[0] == 0
    if create_new and exists:
        raise UserError(L(f"“{target}” adında bir veri kutusu zaten var. Başka bir ad seç.", f"A volume named “{target}” already exists. Pick another name."))
    if not create_new and not exists:
        raise UserError(L("Hedef veri kutusu bulunamadı.", "Target volume not found."))
    if exists:
        busy = [u["name"] for v in rs.list_volumes() if v["name"] == target for u in v["used_by"] if u["running"]]
        if busy:
            raise UserError(L("Bu kutuyu kullanan parçalar çalışıyor: ", "Containers using this volume are running: ") + ", ".join(busy)
                            + L(". Önce onları durdur.", ". Stop them first."))

    def run(job):
        # Önce yedek sonuna kadar okunur: bozuksa "önce boşalt" seçiliyken bile kutudaki veri silinmez.
        job.log(L("Yedek dosyası denetleniyor…", "Checking the backup file…"))
        _check_archive(path)
        helper = _helper_image(job)
        if create_new:
            code, _, err = ds.docker("volume", "create", target, timeout=30)
            if code != 0:
                raise UserError(L("Veri kutusu oluşturulamadı: ", "Could not create the volume: ") + err.strip()[-200:])
            job.log(L(f"Yeni veri kutusu oluşturuldu: {target}", f"New volume created: {target}"))
        script = ("find /kutu -mindepth 1 -delete && " if wipe else "") + "tar xzf - -C /kutu"
        if path.endswith(".tar"):
            script = script.replace("tar xzf", "tar xf")
        job.log(L(f"{os.path.basename(path)} → {target} geri yükleniyor…", f"Restoring {os.path.basename(path)} → {target}…"))
        code = _run_from_file(job, ["run", "--rm", "--label", HELPER_LABEL, "-i", "-v", f"{target}:/kutu", "--entrypoint", "sh", helper,
                                    "-c", script], path)
        if code != 0:
            if create_new:  # yarım kalmış yeni kutu ortada kalmasın
                ds.docker("volume", "rm", target, timeout=30)
                job.log(L(f"Yarım kalan {target} kutusu silindi.", f"Removed the incomplete {target} volume."))
            raise UserError(L("Geri yükleme başarısız oldu. Ayrıntılara bak.", "The restore failed. See the details."))
        rs.invalidate_df()
        return L(f"Geri yüklendi: {target}", f"Restored: {target}")

    return ds.start_job(L(f"{target} geri yükleniyor", f"Restoring {target}"), f"_kutu:{target}", run)


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
        raise UserError(L("Veritabanı şifresi parçanın ayarlarında bulunamadı; döküm alınamıyor.",
                          "The database password isn't in the container settings, so a dump can't be taken."))
    if engine == "mongo":
        args = ["mongodump", "--archive", "--gzip"]
        user, pw = env.get("MONGO_INITDB_ROOT_USERNAME"), env.get("MONGO_INITDB_ROOT_PASSWORD")
        if user and pw:
            args += ["-u", user, "-p", pw, "--authenticationDatabase", "admin"]
        return args, {}, "archive.gz"
    raise UserError(L("Bu parça için döküm desteklenmiyor (PostgreSQL, MySQL, MariaDB, MongoDB desteklenir).",
                      "Dumps aren't supported for this container (PostgreSQL, MySQL, MariaDB and MongoDB are)."))


def _exec_env_args(extra):
    out = []
    for k, v in extra.items():
        out += ["-e", f"{k}={v}"]
    return out


def dump_database(cid):
    _, c = ds.get_container(cid)
    engine = _db_engine(c["image"])
    if not engine:
        raise UserError(L("Bu parça bir veritabanı gibi görünmüyor.", "This container doesn't look like a database."))
    if not c["running"]:
        raise UserError(L("Döküm için veritabanının çalışıyor olması gerekir. Önce başlat.", "The database must be running to take a dump. Start it first."))
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
            job.log(L(f"{c['role_title']} dökümü alınıyor ({tool[0]})…", f"Dumping {c['role_title']} ({tool[0]})…"))
            code = _run_to_file(job, ["exec", *_exec_env_args(extra), c["name"], *tool], path)
            if code == 0:
                job.log(L(f"Kaydedildi: {path}", f"Saved: {path}"))
                return L(f"Veritabanı dökümü alındı ({rs.human_size(os.path.getsize(path))}).",
                         f"Database dump saved ({rs.human_size(os.path.getsize(path))}).")
            if code not in TOOL_MISSING or i + 1 >= len(tools):
                break
            job.log(L("Bu araç yok, diğeri deneniyor…", "That tool isn't there; trying the other one…"))
        raise UserError(L("Döküm alınamadı. Ayrıntılara bak.", "The dump failed. See the details."))

    return ds.start_job(L(f"{c['name']} veritabanı dökümü", f"{c['name']} database dump"), None, run)


def restore_database(cid, path):
    path = os.path.realpath(os.path.expanduser(clean_path(path)))
    if not os.path.isfile(path):
        raise UserError(L("Döküm dosyası bulunamadı.", "Dump file not found."))
    _, c = ds.get_container(cid)
    engine = _db_engine(c["image"])
    if not engine:
        raise UserError(L("Bu parça bir veritabanı gibi görünmüyor.", "This container doesn't look like a database."))
    if not c["running"]:
        raise UserError(L("Geri yükleme için veritabanının çalışıyor olması gerekir. Önce başlat.", "The database must be running to restore. Start it first."))
    m = _NAME_RE.match(os.path.basename(path))
    dump = _dump_engine(path, m.group("ext") if m else path.rsplit(".", 1)[-1])
    if dump and dump != {"mariadb": "mysql"}.get(engine, engine):
        names = {"postgres": "PostgreSQL", "mysql": "MySQL/MariaDB", "mongo": "MongoDB"}
        raise UserError(L(f"Bu bir {names[dump]} dökümü; {names[{'mariadb': 'mysql'}.get(engine, engine)]} veritabanına yüklenemez.",
                          f"This is a {names[dump]} dump; it can't be restored into a "
                          f"{names[{'mariadb': 'mysql'}.get(engine, engine)]} database."))
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
            job.log(L(f"{os.path.basename(path)} geri yükleniyor ({tool[0]})…", f"Restoring {os.path.basename(path)} ({tool[0]})…"))
            stats = {}
            code = _run_from_file(job, ["exec", "-i", *_exec_env_args(extra), c["name"], *tool], path, stats=stats)
            if code == 0 and stats.get("errors"):
                # psql hataları geçip devam eder ve 0 ile çıkar; "başarılı" demek yanlış olur.
                raise UserError(L(f"Geri yükleme bitti ama {stats['errors']} komut hata verdi. Ayrıntılara bak "
                                  "(ör. tablo zaten varsa önce boş bir veritabanına yüklemeyi dene).",
                                  f"The restore finished but {stats['errors']} statements failed. See the details "
                                  "(e.g. if tables already exist, try restoring into an empty database)."))
            if code == 0:
                return L("Veritabanı geri yüklendi.", "Database restored.")
            if code not in TOOL_MISSING or i + 1 >= len(tools):
                break  # araç vardı ama hata verdi: dökümü ikinci kez çalıştırma
            job.log(L("Bu araç yok, diğeri deneniyor…", "That tool isn't there; trying the other one…"))
        raise UserError(L("Geri yükleme hatalarla bitti. Ayrıntılara bak.", "The restore finished with errors. See the details."))

    return ds.start_job(L(f"{c['name']} veritabanı geri yükleniyor", f"Restoring {c['name']} database"), None, run)


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


def _recycle_windows(path):
    """Windows Geri Dönüşüm Kutusu'na taşır (geri alınabilir silme)."""
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR),
                    ("pTo", wintypes.LPCWSTR), ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL),
                    ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR)]

    FO_DELETE, FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI = 3, 0x4, 0x10, 0x40, 0x400
    op = SHFILEOPSTRUCTW(None, FO_DELETE, os.path.abspath(path) + "\0", None,
                         FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI, False, None, None)
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0 and not op.fAnyOperationsAborted


def delete_backup(path):
    if not path or not os.path.isfile(path) or not _inside_root(path):
        raise UserError(L("Yedek dosyası bulunamadı.", "Backup file not found."))
    if ds.IS_WIN:
        if _recycle_windows(path) and not os.path.exists(path):
            return L("Geri Dönüşüm Kutusu'na taşındı.", "Moved to the Recycle Bin.")
        raise UserError(L("Geri Dönüşüm Kutusu'na taşınamadı.", "Could not move to the Recycle Bin."))
    if ds.IS_MAC:
        # Kalıcı silme yerine Çöp Sepeti'ne taşı (geri alınabilsin). macOS'un kendi işlevi;
        # Finder'ı kontrol etmek için izin istemez.
        try:
            from Foundation import NSFileManager, NSURL
            ok, _, err = NSFileManager.defaultManager().trashItemAtURL_resultingItemURL_error_(
                NSURL.fileURLWithPath_(path), None, None)
            if ok:
                return L("Çöp Sepeti'ne taşındı.", "Moved to the Trash.")
            raise UserError(L("Çöp Sepeti'ne taşınamadı: ", "Could not move to the Trash: ") + str(err.localizedDescription() if err else ""))
        except ImportError:
            pass
    os.remove(path)
    return L("Kalıcı olarak silindi.", "Deleted permanently.")


def reveal(path=None):
    target = path if path and os.path.exists(path) and _inside_root(path) else backup_root()
    os.makedirs(backup_root(), exist_ok=True)
    if ds.IS_MAC:
        subprocess.Popen(["open", "-R", target] if os.path.isfile(target) else ["open", target])
    elif ds.IS_WIN:
        target = os.path.normpath(target)
        if os.path.isfile(target):
            # /select, ile tırnaklı yol tek parça olmalı; liste verilirse Python bütün argümanı tırnaklar, Gezgin anlamaz.
            subprocess.Popen(f'explorer /select,"{target}"')
        else:
            os.startfile(target)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(target) if os.path.isfile(target) else target])
