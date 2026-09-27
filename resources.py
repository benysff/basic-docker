"""Uygulama/parça dışındaki Docker kaynakları.

Kalıplar (imaj), veri kutuları (volume), ağlar, kapı haritası, disk temizliği,
motor bilgisi ve bağlam (context) değiştirme burada. Hepsi `docker` komutuyla yapılır.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import docker_service as ds
from monitor import parse_size

UserError = ds.UserError
L = ds.L

# ---------------------------------------------------------------------------
# Ortak yardımcılar
# ---------------------------------------------------------------------------

_df_cache = {"t": 0.0, "data": None}
_df_lock = threading.Lock()


def system_df(max_age=8):
    """`docker system df -v` sonucu (kısa süre önbellekli; hesaplaması pahalı olabilir)."""
    with _df_lock:
        if _df_cache["data"] is not None and time.time() - _df_cache["t"] < max_age:
            return _df_cache["data"]
        code, out, err = ds.docker("system", "df", "-v", "--format", "json", timeout=120)
        if code != 0:
            raise UserError(L("Disk kullanımı okunamadı: ", "Could not read disk usage: ") + err.strip()[-200:])
        try:
            data = json.loads(out)
        except ValueError:
            raise UserError(L("Disk kullanımı anlaşılamadı.", "Could not parse disk usage."))
        _df_cache.update(t=time.time(), data=data)
        return data


def invalidate_df():
    _df_cache["t"] = 0.0


def _json_lines(out):
    rows = []
    for line in (out or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows


def _labels(text):
    out = {}
    for part in (text or "").split(","):
        k, sep, v = part.partition("=")
        if sep:
            out[k] = v
    return out


def _host_arch():
    code, out, _ = ds.docker("version", "--format", "{{.Server.Arch}}", timeout=10)
    arch = out.strip() if code == 0 else ""
    return {"aarch64": "arm64", "x86_64": "amd64"}.get(arch, arch)


_arch_cache = {}


def host_arch():
    if "v" not in _arch_cache:
        _arch_cache["v"] = _host_arch()
    return _arch_cache["v"]


def _app_names():
    snap = ds.snapshot()
    return snap, {a["key"]: a["name"] for a in snap["apps"]}


# ---------------------------------------------------------------------------
# Kalıplar (imajlar)
# ---------------------------------------------------------------------------

_updates = {}   # ref -> {"status": "guncel"|"yeni"|"yerel"|"hata", "t": zaman, "detail": ""}


def list_images():
    code, out, err = ds.docker("image", "ls", "-a", "-q", "--no-trunc", timeout=30)
    if code != 0:
        raise UserError(L("Kalıplar okunamadı: ", "Could not read images: ") + err.strip()[-200:])
    ids = sorted(set(out.split()))
    raw = []
    if ids:
        _, out, _ = ds.docker("image", "inspect", *ids, timeout=60)
        try:
            raw = json.loads(out or "[]")
        except ValueError:
            raw = []
    try:
        df = {i.get("ID"): i for i in system_df().get("Images") or []}
    except UserError:
        df = {}
    snap, names = _app_names()
    users = {}
    for a in snap["apps"]:
        for c in a["containers"]:
            users.setdefault(c.get("image_id"), []).append({
                "name": c["name"], "id": c["id"], "running": c["running"],
                "app": a["key"], "app_name": a["name"], "role": c["role_title"],
            })
    harch = host_arch()
    images = []
    for im in raw:
        iid = im.get("Id", "")
        tags = [t for t in im.get("RepoTags") or [] if t != "<none>:<none>"]
        digests = im.get("RepoDigests") or []
        d = df.get(iid) or {}
        cfg = im.get("Config") or {}
        arch = im.get("Architecture", "")
        repo = tags[0].rsplit(":", 1)[0] if tags else (digests[0].split("@")[0] if digests else "")
        used = users.get(iid, [])
        images.append({
            "id": iid.replace("sha256:", "")[:12],
            "full_id": iid,
            "repo": repo,
            "tags": tags,
            "tag_names": [t.rsplit(":", 1)[1] for t in tags],
            "ref": tags[0] if tags else None,
            "dangling": not tags,
            "size": im.get("Size", 0),
            "unique_size": parse_size(d.get("UniqueSize")) if d.get("UniqueSize") not in (None, "N/A") else None,
            "created": im.get("Created", ""),
            "arch": arch,
            "os": im.get("Os", ""),
            "emulated": bool(arch and harch and arch != harch and im.get("Os") == "linux"),
            "local_build": not digests,
            "used_by": used,
            "in_use": bool(used),
            "running": any(u["running"] for u in used),
            "ports": sorted((cfg.get("ExposedPorts") or {}).keys()),
            "updates": {t: _updates.get(t) for t in tags if t in _updates},
        })
    images.sort(key=lambda i: (i["dangling"], i["repo"].lower(), i["created"]), reverse=False)
    return {"images": images, "host_arch": harch}


def image_detail(ref):
    code, out, err = ds.docker("image", "inspect", ref, timeout=20)
    if code != 0:
        raise UserError(L("Kalıp bulunamadı.", "Image not found."))
    try:
        im = json.loads(out)[0]
    except (ValueError, IndexError):
        raise UserError(L("Kalıp bilgisi anlaşılamadı.", "Could not parse the image info."))
    code, out, _ = ds.docker("history", "--no-trunc", "--format", "{{json .}}", ref, timeout=30)
    layers = []
    for row in _json_lines(out):
        cmd = re.sub(r"^/bin/sh -c (#\(nop\) )?", "", row.get("CreatedBy", "")).strip()
        layers.append({"cmd": cmd[:500], "size": parse_size(row.get("Size")), "created": row.get("CreatedSince", "")})
    cfg = im.get("Config") or {}
    return {
        "env": cfg.get("Env") or [],
        "cmd": cfg.get("Cmd") or [],
        "entrypoint": cfg.get("Entrypoint") or [],
        "workdir": cfg.get("WorkingDir", ""),
        "ports": sorted((cfg.get("ExposedPorts") or {}).keys()),
        "volumes": sorted((cfg.get("Volumes") or {}).keys()),
        "labels": cfg.get("Labels") or {},
        "layers": layers,
        "raw": im,
    }


def check_update(ref):
    """Docker Hub'daki (ya da kayıt defterindeki) sürüm yereldekinden yeni mi?"""
    if not ref or ref.endswith(":<none>"):
        raise UserError(L("Etiketsiz kalıp denetlenemez.", "Untagged images can't be checked."))
    code, out, _ = ds.docker("image", "inspect", "--format", "{{json .RepoDigests}}", ref, timeout=15)
    try:
        local = {d.split("@", 1)[1] for d in json.loads(out or "[]") if "@" in d} if code == 0 else set()
    except ValueError:
        local = set()
    if not local:
        res = {"status": "yerel", "detail": L("Bu kalıp bilgisayarında derlenmiş; denetlenecek bir kaynak yok.",
                                              "This image was built on your computer; there is no source to check.")}
    else:
        code, out, err = ds.docker("buildx", "imagetools", "inspect", ref, "--format", "{{json .Manifest}}", timeout=40)
        if code != 0:
            msg = err.strip().splitlines()[-1] if err.strip() else L("bilinmeyen hata", "unknown error")
            res = {"status": "hata", "detail": L("Denetlenemedi: ", "Could not check: ") + msg[-200:]}
        else:
            try:
                remote = json.loads(out).get("digest", "")
            except ValueError:
                remote = ""
            if remote and remote in local:
                res = {"status": "guncel", "detail": L("En son sürüm bilgisayarında.", "You have the latest version.")}
            elif remote:
                res = {"status": "yeni", "detail": L("Yeni sürüm var. İndirip parçaları yeniden oluşturabilirsin.",
                                                    "A newer version is available. Pull it and recreate the containers.")}
            else:
                res = {"status": "hata", "detail": L("Uzak sürüm okunamadı.", "Could not read the remote version.")}
    res["t"] = time.time()
    _updates[ref] = res
    return res


def check_all_updates():
    refs = sorted({i["ref"] for i in list_images()["images"] if i["ref"] and not i["local_build"]})
    if not refs:
        raise UserError(L("Denetlenecek (internetten indirilmiş) kalıp yok.", "There are no pulled images to check."))

    def run(job):
        job.log(L(f"{len(refs)} kalıp denetleniyor…", f"Checking {len(refs)} image(s)…"))
        newer = []
        with ThreadPoolExecutor(max_workers=4) as pool:
            for ref, res in zip(refs, pool.map(check_update, refs)):
                job.log(f"{ref}: {res['detail']}")
                if res["status"] == "yeni":
                    newer.append(ref)
        if newer:
            return L(f"{len(newer)} kalıbın yeni sürümü var: ", f"{len(newer)} image(s) have a newer version: ") + \
                ", ".join(newer[:5]) + (" …" if len(newer) > 5 else "")
        return L("Hepsi güncel.", "Everything is up to date.")

    return ds.start_job(L("Kalıp güncellemeleri denetleniyor", "Checking image updates"), "_kaliplar", run)


def pull_image(ref):
    ref = (ref or "").strip()
    if not ds.IMAGE_RE.match(ref):
        raise UserError(L("Kalıp adı geçersiz. Örnek: postgres:17-alpine", "Invalid image name. Example: postgres:17-alpine"))

    def run(job):
        job.log(L(f"{ref} indiriliyor…", f"Pulling {ref}…"))
        if ds._stream(job, ["pull", ref], timeout=3600) != 0:
            raise UserError(L(f"{ref} indirilemedi. Adı ve internet bağlantını kontrol et.",
                              f"Could not pull {ref}. Check the name and your internet connection."))
        _updates.pop(ref if ":" in ref.rsplit("/", 1)[-1] else ref + ":latest", None)
        invalidate_df()
        return L(f"{ref} indirildi.", f"{ref} pulled.")

    return ds.start_job(L(f"{ref} indiriliyor", f"Pulling {ref}"), None, run)


def remove_images(refs, force=False):
    refs = [r for r in (refs or []) if isinstance(r, str) and re.fullmatch(r"[\w./:@-]{1,300}", r)]
    if not refs:
        raise UserError(L("Silinecek kalıp seçilmedi.", "No image selected to delete."))

    def run(job):
        failed = []
        for r in refs:
            code, out, err = ds.docker("image", "rm", *(["-f"] if force else []), r, timeout=120)
            if code == 0:
                job.log(L(f"Silindi: {r}", f"Deleted: {r}"))
            else:
                failed.append(r)
                msg = err.strip()
                if "being used" in msg or "is using" in msg:
                    msg = L("Bir parça bu kalıbı kullanıyor; önce o parçayı sil.", "A container uses this image; delete that container first.")
                job.log(L(f"Silinemedi ({r}): ", f"Could not delete ({r}): ") + msg[-250:])
        invalidate_df()
        if failed and len(failed) == len(refs):
            raise UserError(L("Kalıplar silinemedi. Ayrıntılara bak.", "The images could not be deleted. See the details."))
        return L(f"{len(refs) - len(failed)} kalıp silindi.", f"{len(refs) - len(failed)} image(s) deleted.") + \
            (L(f" {len(failed)} tanesi silinemedi.", f" {len(failed)} could not be deleted.") if failed else "")

    return ds.start_job(L(f"{len(refs)} kalıp siliniyor", f"Deleting {len(refs)} image(s)"), "_kaliplar", run)


# ---------------------------------------------------------------------------
# Veri kutuları (volume)
# ---------------------------------------------------------------------------

_ANON_RE = re.compile(r"^[0-9a-f]{64}$")


def list_volumes():
    try:
        dfv = {v.get("Name"): v for v in system_df().get("Volumes") or []}
    except UserError:
        dfv = {}
    code, out, err = ds.docker("volume", "ls", "-q", timeout=20)
    if code != 0:
        raise UserError(L("Veri kutuları okunamadı: ", "Could not read volumes: ") + err.strip()[-200:])
    names = out.split()
    raw = []
    if names:
        _, out, _ = ds.docker("volume", "inspect", *names, timeout=30)
        try:
            raw = json.loads(out or "[]")
        except ValueError:
            raw = []
    snap, app_names = _app_names()
    users = {}
    for a in snap["apps"]:
        for c in a["containers"]:
            for m in c["mounts"]:
                if m["type"] == "volume":
                    users.setdefault(m["name"], []).append({
                        "name": c["name"], "id": c["id"], "running": c["running"], "dest": m["dest"],
                        "app": a["key"], "app_name": a["name"], "role": c["role_title"], "kind": c["kind"],
                    })
    vols = []
    for v in raw:
        name = v.get("Name", "")
        labels = v.get("Labels") or {}
        used = users.get(name, [])
        project = labels.get("com.docker.compose.project") or (used[0]["app"] if used else "")
        d = dfv.get(name) or {}
        vols.append({
            "name": name,
            "anonymous": bool(_ANON_RE.match(name)) or "com.docker.volume.anonymous" in labels,
            "driver": v.get("Driver", ""),
            "created": v.get("CreatedAt", ""),
            "size": parse_size(d.get("Size")) if d.get("Size") not in (None, "N/A") else None,
            "used_by": used,
            "in_use": bool(used),
            "running": any(u["running"] for u in used),
            "app": project,
            "app_name": app_names.get(project) or (ds.pretty_name(project) if project else ""),
            "db": any(u["kind"] == "db" for u in used),
            "labels": labels,
        })
    vols.sort(key=lambda v: (v["anonymous"], not v["in_use"], v["app_name"].lower(), v["name"]))
    return vols


def create_volume(name):
    name = (name or "").strip()
    if not ds.NAME_RE.match(name):
        raise UserError(L("Ad geçersiz. Harf, rakam, - ve _ kullan (ör. proje-veri).", "Invalid name. Use letters, digits, - and _ (e.g. project-data)."))
    code, _, err = ds.docker("volume", "create", name, timeout=30)
    if code != 0:
        raise UserError(L("Oluşturulamadı: ", "Could not create it: ") + err.strip()[-200:])
    invalidate_df()
    return name


def remove_volumes(names):
    names = [n for n in (names or []) if isinstance(n, str) and ds.NAME_RE.match(n)]
    if not names:
        raise UserError(L("Silinecek veri kutusu seçilmedi.", "No volume selected to delete."))

    def run(job):
        failed = []
        for n in names:
            code, _, err = ds.docker("volume", "rm", n, timeout=60)
            if code == 0:
                job.log(L(f"Silindi: {n}", f"Deleted: {n}"))
            else:
                failed.append(n)
                msg = L("Bir parça bu kutuyu kullanıyor; önce parçayı sil.", "A container uses this volume; delete the container first.") \
                    if "in use" in err else err.strip()[-200:]
                job.log(L(f"Silinemedi ({n}): ", f"Could not delete ({n}): ") + msg)
        invalidate_df()
        if failed and len(failed) == len(names):
            raise UserError(L("Veri kutuları silinemedi. Ayrıntılara bak.", "The volumes could not be deleted. See the details."))
        return L(f"{len(names) - len(failed)} veri kutusu silindi.", f"{len(names) - len(failed)} volume(s) deleted.") + \
            (L(f" {len(failed)} tanesi silinemedi.", f" {len(failed)} could not be deleted.") if failed else "")

    return ds.start_job(L(f"{len(names)} veri kutusu siliniyor", f"Deleting {len(names)} volume(s)"), "_kutular", run)


# ---------------------------------------------------------------------------
# Ağlar
# ---------------------------------------------------------------------------

BUILTIN_NETS = {
    "bridge": ("Docker'ın varsayılan ağı. Buradaki parçalar birbirini adıyla bulamaz; sadece IP ile konuşur.",
               "Docker's default network. Containers here can't find each other by name; only by IP."),
    "host": ("Parça doğrudan bilgisayarın ağını kullanır (Mac'te sınırlı çalışır).",
             "The container uses your computer's network directly (limited on Mac)."),
    "none": ("Ağ yok: bu ağdaki parça hiçbir yere bağlanamaz.", "No network: a container here can't connect anywhere."),
}


def list_networks():
    code, out, err = ds.docker("network", "ls", "-q", "--no-trunc", timeout=20)
    if code != 0:
        raise UserError(L("Ağlar okunamadı: ", "Could not read networks: ") + err.strip()[-200:])
    ids = out.split()
    raw = []
    if ids:
        _, out, _ = ds.docker("network", "inspect", *ids, timeout=30)
        try:
            raw = json.loads(out or "[]")
        except ValueError:
            raw = []
    snap, app_names = _app_names()
    by_id = {c["id"]: (a, c) for a in snap["apps"] for c in a["containers"]}
    nets = []
    for n in raw:
        name = n.get("Name", "")
        labels = n.get("Labels") or {}
        cfgs = (n.get("IPAM") or {}).get("Config") or []
        members = []
        for cid, m in (n.get("Containers") or {}).items():
            a, c = by_id.get(cid, (None, None))
            members.append({
                "id": cid, "name": m.get("Name", ""), "ip": (m.get("IPv4Address") or "").split("/")[0],
                "app": a["key"] if a else "", "app_name": a["name"] if a else "",
                "role": c["role_title"] if c else "", "running": bool(c and c["running"]),
            })
        project = labels.get("com.docker.compose.project") or labels.get("basicdocker.app") or ""
        nets.append({
            "id": n.get("Id", "")[:12],
            "name": name,
            "driver": n.get("Driver", ""),
            "scope": n.get("Scope", ""),
            "internal": bool(n.get("Internal")),
            "subnet": cfgs[0].get("Subnet", "") if cfgs else "",
            "gateway": cfgs[0].get("Gateway", "") if cfgs else "",
            "created": n.get("Created", ""),
            "builtin": name in BUILTIN_NETS,
            "desc": L(*BUILTIN_NETS[name]) if name in BUILTIN_NETS else "",
            "app": project,
            "app_name": app_names.get(project) or (ds.pretty_name(project) if project else ""),
            "containers": sorted(members, key=lambda m: m["name"]),
        })
    nets.sort(key=lambda n: (n["builtin"], n["app_name"].lower(), n["name"]))
    return nets


def create_network(name, internal=False):
    name = (name or "").strip()
    if not ds.NAME_RE.match(name):
        raise UserError(L("Ad geçersiz. Harf, rakam, - ve _ kullan.", "Invalid name. Use letters, digits, - and _."))
    args = ["network", "create"] + (["--internal"] if internal else []) + [name]
    code, _, err = ds.docker(*args, timeout=30)
    if code != 0:
        raise UserError(L("Oluşturulamadı: ", "Could not create it: ") + err.strip()[-200:])
    return name


def remove_network(name):
    if name in BUILTIN_NETS:
        raise UserError(L("Docker'ın kendi ağları silinemez.", "Docker's built-in networks can't be deleted."))
    code, _, err = ds.docker("network", "rm", name, timeout=30)
    if code != 0:
        raise UserError(L("Silinemedi: ", "Could not delete: ") + (L("Önce bu ağa bağlı parçaları çıkar.", "Disconnect its containers first.")
                                                                   if "active endpoints" in err else err.strip()[-200:]))


def network_connect(network, container, connect=True):
    if not ds.NAME_RE.match(network or "") or not ds.NAME_RE.match(container or ""):
        raise UserError(L("Geçersiz ad.", "Invalid name."))
    code, _, err = ds.docker("network", "connect" if connect else "disconnect", network, container, timeout=30)
    if code != 0:
        raise UserError((L("Bağlanamadı: ", "Could not connect: ") if connect else L("Çıkarılamadı: ", "Could not disconnect: "))
                        + err.strip()[-200:])


# ---------------------------------------------------------------------------
# Kapı haritası: hangi numara kimde? (Docker + bilgisayardaki diğer programlar)
# ---------------------------------------------------------------------------

DOCKER_PROCS = {"orbstack", "orbstack helper", "com.docker.backend", "com.docker.vpnkit", "vpnkit", "docker",
                "com.docker.bac", "com.docker", "vpnkit-bridge", "limactl"}
# işlem adı -> (başlık, açıklama, İngilizce başlık, İngilizce açıklama)
KNOWN_PROCS = {
    "controlce": ("macOS AirPlay Alıcısı",
                  "macOS 5000 ve 7000 numaralı kapıları AirPlay için kullanır. Gerekirse Sistem Ayarları → Genel → "
                  "AirDrop ve Handoff → 'AirPlay Alıcısı'nı kapatabilirsin.",
                  "macOS AirPlay Receiver",
                  "macOS uses ports 5000 and 7000 for AirPlay. If needed, turn off System Settings → General → "
                  "AirDrop & Handoff → 'AirPlay Receiver'."),
    "rapportd": ("macOS Süreklilik (Handoff)", "Apple cihazların arasındaki bağlantı için macOS servisi.",
                 "macOS Continuity (Handoff)", "macOS service that connects your Apple devices."),
    "ardagent": ("macOS Ekran Paylaşma", "Uzaktan yönetim/ekran paylaşma servisi.",
                 "macOS Screen Sharing", "Remote management / screen sharing service."),
    "postgres": ("Bilgisayarındaki PostgreSQL", "Docker dışında, doğrudan Mac'e kurulu bir veritabanı (ör. Homebrew/Postgres.app).",
                 "PostgreSQL on your Mac", "A database installed directly on your Mac, outside Docker (e.g. Homebrew/Postgres.app)."),
    "mysqld": ("Bilgisayarındaki MySQL", "Docker dışında, doğrudan Mac'e kurulu bir MySQL.",
               "MySQL on your Mac", "MySQL installed directly on your Mac, outside Docker."),
    "redis-ser": ("Bilgisayarındaki Redis", "Docker dışında, doğrudan Mac'e kurulu bir Redis.",
                  "Redis on your Mac", "Redis installed directly on your Mac, outside Docker."),
    "ollama": ("Ollama", "Yerel model sunucusu.", "Ollama", "Local model server."),
    "node": ("Node.js programı", "Bir terminalde çalışan Node.js uygulaması (ör. npm run dev).",
             "Node.js program", "A Node.js app running in a terminal (e.g. npm run dev)."),
    "python": ("Python programı", "Bir terminalde çalışan Python uygulaması.", "Python program", "A Python app running in a terminal."),
    "python3": ("Python programı", "Bir terminalde çalışan Python uygulaması.", "Python program", "A Python app running in a terminal."),
    "java": ("Java programı", "", "Java program", ""),
    "php": ("PHP programı", "", "PHP program", ""),
    "ruby": ("Ruby programı", "", "Ruby program", ""),
    "code helper": ("VS Code", "Editörün kendi yardımcı servisi.", "VS Code", "The editor's own helper service."),
    "spotify": ("Spotify", "", "Spotify", ""),
}


def _listening():
    """lsof ile dinlenen TCP kapılarını okur: {port: [{proc, pid, addr}]}"""
    try:
        p = subprocess.run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"],
                           capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    out, proc, pid = {}, "", 0
    for line in p.stdout.splitlines():
        if not line:
            continue
        tag, val = line[0], line[1:]
        if tag == "p":
            pid = int(val) if val.isdigit() else 0
        elif tag == "c":
            proc = val.replace("\\x20", " ")
        elif tag == "n":
            addr, _, port_s = val.rpartition(":")
            if not port_s.isdigit():
                continue
            port = int(port_s)
            addr = addr.strip("[]")
            lst = out.setdefault(port, [])
            if not any(x["pid"] == pid and x["addr"] == addr for x in lst):
                lst.append({"proc": proc, "pid": pid, "addr": addr})
    return out


def _scope(addrs):
    if any(a in ("*", "0.0.0.0", "::") for a in addrs):
        return "lan"
    return "local"


def port_map():
    snap = ds.snapshot()
    # Uzak motorda bu Mac'te dinleyen programlar ilgisiz; sadece Docker'ın kapıları gösterilir.
    remote = ds.is_remote_engine()
    listening = {} if remote else _listening()
    # Docker'ın yayınladığı kapılar (çalışan ve kapalı parçalar dahil)
    docker_ports = {}
    wanted = []  # kapalı parçaların istediği kapılar
    for a in snap["apps"]:
        for c in a["containers"]:
            for p in c["ports"]:
                entry = {"app": a["key"], "app_name": a["name"], "container": c["name"], "id": c["id"],
                         "role": c["role_title"], "running": c["running"], "container_port": p["container"],
                         "proto": p["proto"], "url": p["url"], "local_only": p["local_only"]}
                if c["running"]:
                    docker_ports.setdefault(p["host"], []).append(entry)
                else:
                    wanted.append((p["host"], entry))
    rows = []
    for port in sorted(set(listening) | set(docker_ports)):
        holders = listening.get(port, [])
        docker_entries = docker_ports.get(port, [])
        addrs = [h["addr"] for h in holders]
        if docker_entries:
            d = docker_entries[0]
            scope = "local" if d["local_only"] else (_scope(addrs) if addrs else "lan")
            rows.append({"port": port, "owner": "docker", "app": d["app"], "app_name": d["app_name"],
                         "container": d["container"], "id": d["id"], "role": d["role"], "url": d["url"],
                         "container_port": d["container_port"], "scope": scope,
                         "title": d["app_name"], "desc": L(f"{d['role']} · içeride {d['container_port']}",
                                                         f"{d['role']} · {d['container_port']} inside")})
            continue
        h = holders[0]
        pname = h["proc"].lower()
        if pname in DOCKER_PROCS:
            # Docker motorunun kendi kapısı (ör. OrbStack'in iç servisleri)
            rows.append({"port": port, "owner": "engine", "title": h["proc"],
                         "desc": L("Docker motorunun kendi servisi", "The Docker engine's own service"),
                         "scope": _scope(addrs), "pid": h["pid"], "proc": h["proc"]})
            continue
        known = None
        for key, val in KNOWN_PROCS.items():
            if pname.startswith(key):
                known = (L(val[0], val[2]), L(val[1], val[3]))
                break
        if pname in ("controlce", "controlcenter") and port not in (5000, 7000):
            known = (L("macOS Denetim Merkezi", "macOS Control Center"), "")
        rows.append({"port": port, "owner": "process", "proc": h["proc"], "pid": h["pid"],
                     "title": known[0] if known else h["proc"],
                     "desc": known[1] if known else L("Bilgisayarında çalışan bir program.", "A program running on your computer."),
                     "scope": _scope(addrs), "system": pname in ("controlce", "rapportd", "ardagent")})
    # Çakışmalar: kapalı bir parçanın istediği kapıyı şu an başkası tutuyor
    conflicts = []
    by_port = {r["port"]: r for r in rows}
    for port, entry in wanted:
        holder = by_port.get(port)
        if holder and not (holder["owner"] == "docker" and holder.get("container") == entry["container"]):
            conflicts.append({"port": port, "wanted_by": entry, "holder": holder})
    return {"ports": rows, "conflicts": conflicts, "remote": remote}


def suggest_port(preferred):
    try:
        preferred = int(preferred)
    except (TypeError, ValueError):
        raise UserError(L("Bir sayı yaz.", "Enter a number."))
    if not 1 <= preferred <= 65535:
        raise UserError(L("Kapı numarası 1 ile 65535 arasında olmalı.", "The port must be between 1 and 65535."))
    snap = ds.snapshot()
    if ds.is_remote_engine():
        taken = set(snap["taken_ports"])
        free = preferred not in taken
    else:
        taken = set(snap["taken_ports"]) | set(_listening())
        free = preferred not in taken and ds._port_free(preferred)
    return {"port": preferred, "free": free, "suggestion": preferred if free else ds.pick_port(preferred + 1, taken)}


# ---------------------------------------------------------------------------
# Disk temizliği
# ---------------------------------------------------------------------------

def cleanup_plan():
    df = system_df(max_age=2)
    snap, app_names = _app_names()
    stopped = []
    by_name = {c["name"]: (a, c) for a in snap["apps"] for c in a["containers"]}
    csize = {}
    for c in df.get("Containers") or []:
        for n in (c.get("Names") or "").split(","):
            csize[n] = parse_size(c.get("Size"))
    for name, (a, c) in by_name.items():
        if not c["running"] and c["state"] not in ("restarting", "paused"):
            stopped.append({"name": name, "id": c["id"], "app": a["key"], "app_name": a["name"],
                            "role": c["role_title"], "size": csize.get(name, 0), "finished": c["finished_at"],
                            "compose": bool(c["compose"]), "oneshot": c["kind"] in ds.ONESHOT_KINDS})
    dangling, unused = [], []
    for im in df.get("Images") or []:
        count = int(im.get("Containers") or 0) if str(im.get("Containers", "0")).isdigit() else 0
        if count:
            continue
        repo, tag = im.get("Repository", ""), im.get("Tag", "")
        # Silinince açılacak yer = başka kalıplarla paylaşılmayan kısım (paylaşılan katmanlar kalır).
        uniq = im.get("UniqueSize")
        size = parse_size(uniq) if uniq not in (None, "", "N/A") else parse_size(im.get("Size"))
        item = {"id": im.get("ID", "").replace("sha256:", "")[:12], "full_id": im.get("ID", ""),
                "ref": f"{repo}:{tag}" if repo != "<none>" else None, "repo": repo if repo != "<none>" else "",
                "tag": tag if tag != "<none>" else "", "size": size, "created": im.get("CreatedSince", "")}
        (dangling if repo == "<none>" else unused).append(item)
    cache = [b for b in df.get("BuildCache") or [] if str(b.get("InUse")).lower() != "true"]
    cache_size = sum(parse_size(b.get("Size")) for b in cache)
    vols = []
    for v in df.get("Volumes") or []:
        if str(v.get("Links", "0")) != "0":
            continue
        labels = _labels(v.get("Labels"))
        name = v.get("Name", "")
        project = labels.get("com.docker.compose.project", "")
        vols.append({"name": name, "size": parse_size(v.get("Size")),
                     "anonymous": bool(_ANON_RE.match(name)) or "com.docker.volume.anonymous" in labels,
                     "app": project, "app_name": app_names.get(project) or (ds.pretty_name(project) if project else "")})
    stopped.sort(key=lambda x: -x["size"])
    unused.sort(key=lambda x: -x["size"])
    vols.sort(key=lambda x: -x["size"])

    def total(rows):
        return sum(r.get("size") or 0 for r in rows)

    usage = {}
    for key, rows in (("images", df.get("Images") or []), ("containers", df.get("Containers") or []),
                      ("volumes", df.get("Volumes") or []), ("cache", df.get("BuildCache") or [])):
        if key == "images":
            # Paylaşılan katmanları iki kere saymamak için benzersiz boyutları + paylaşılanı bir kere topla
            uniq = sum(parse_size(r.get("UniqueSize")) for r in rows)
            shared = max((parse_size(r.get("SharedSize")) for r in rows), default=0)
            usage[key] = uniq + shared
        else:
            usage[key] = sum(parse_size(r.get("Size")) for r in rows)
    return {
        "usage": usage,
        "dangling": {"items": dangling, "size": total(dangling)},
        "unused_images": {"items": unused, "size": total(unused)},
        "cache": {"count": len(cache), "size": cache_size},
        "stopped": {"items": stopped, "size": total(stopped)},
        "volumes": {"items": vols, "size": total(vols)},
    }


def run_cleanup(opts):
    opts = opts or {}
    images = [i for i in opts.get("kaliplar") or [] if isinstance(i, str) and re.fullmatch(r"[\w./:@-]{1,300}", i)]
    containers = [c for c in opts.get("parcalar") or [] if isinstance(c, str) and ds.NAME_RE.match(c)]
    volumes = [v for v in opts.get("kutular") or [] if isinstance(v, str) and ds.NAME_RE.match(v)]
    dangling = bool(opts.get("sahipsiz"))
    cache = bool(opts.get("onbellek"))
    if not (images or containers or volumes or dangling or cache):
        raise UserError(L("Temizlenecek bir şey seçmedin.", "You didn't select anything to clean up."))

    def total_now():
        try:
            u = cleanup_plan()["usage"]
            return sum(u.values())
        except UserError:
            return 0

    def run(job):
        before = total_now()
        if containers:
            job.log(L(f"{len(containers)} kapalı parça siliniyor…", f"Deleting {len(containers)} stopped container(s)…"))
            ds._stream(job, ["rm", *containers], timeout=600)
        if dangling:
            job.log(L("Sahipsiz kalıp katmanları siliniyor…", "Deleting dangling image layers…"))
            ds._stream(job, ["image", "prune", "-f"], timeout=900)
        for ref in images:
            code, _, err = ds.docker("image", "rm", ref, timeout=180)
            job.log(L(f"Kalıp silindi: {ref}", f"Image deleted: {ref}") if code == 0
                    else L(f"Kalıp silinemedi ({ref}): ", f"Could not delete image ({ref}): ") + err.strip()[-200:])
        if cache:
            job.log(L("Derleme önbelleği siliniyor…", "Deleting the build cache…"))
            ds._stream(job, ["builder", "prune", "-af"], timeout=1800)
        for v in volumes:
            code, _, err = ds.docker("volume", "rm", v, timeout=60)
            job.log(L(f"Veri kutusu silindi: {v}", f"Volume deleted: {v}") if code == 0
                    else L(f"Veri kutusu silinemedi ({v}): ", f"Could not delete volume ({v}): ") + err.strip()[-200:])
        invalidate_df()
        freed = max(0, before - total_now())
        return L(f"Temizlik bitti. Yaklaşık {human_size(freed)} yer açıldı.", f"Cleanup done. About {human_size(freed)} freed.")

    return ds.start_job(L("Disk temizleniyor", "Cleaning up disk"), "_temizlik", run)


def human_size(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1000 or unit == "TB":
            text = f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"
            return text if ds.LANG == "en" else text.replace(".", ",")
        n /= 1000
    return f"{n:.1f} TB"


# ---------------------------------------------------------------------------
# Motor bilgisi ve bağlamlar (context)
# ---------------------------------------------------------------------------

def system_info():
    code, out, err = ds.docker("info", "--format", "{{json .}}", timeout=20)
    if code != 0:
        raise UserError(L("Docker bilgisi okunamadı: ", "Could not read Docker info: ") + err.strip()[-200:])
    try:
        info = json.loads(out)
    except ValueError:
        raise UserError(L("Docker bilgisi anlaşılamadı.", "Could not parse Docker info."))
    code, out, _ = ds.docker("version", "--format", "{{json .}}", timeout=15)
    try:
        ver = json.loads(out) if code == 0 else {}
    except ValueError:
        ver = {}
    code, out, _ = ds.docker("context", "ls", "--format", "json", timeout=15)
    contexts = []
    for row in _json_lines(out) if code == 0 else []:
        contexts.append({"name": row.get("Name", ""), "current": bool(row.get("Current")),
                         "desc": row.get("Description", ""), "endpoint": row.get("DockerEndpoint", ""),
                         "error": row.get("Error", "")})
    compose_v = ""
    code, out, _ = ds.docker("compose", "version", "--short", timeout=10)
    if code == 0:
        compose_v = out.strip()
    kind = ds.engine_kind()
    return {
        "engine": kind,
        "engine_name": ds.ENGINE_NAMES.get(kind, "Docker"),
        "os": info.get("OperatingSystem", ""),
        "server_version": info.get("ServerVersion", ""),
        "client_version": (ver.get("Client") or {}).get("Version", ""),
        "compose_version": compose_v,
        "cpus": info.get("NCPU", 0),
        "memory": info.get("MemTotal", 0),
        "arch": host_arch(),
        "kernel": info.get("KernelVersion", ""),
        "storage_driver": info.get("Driver", ""),
        "containers": {"total": info.get("Containers", 0), "running": info.get("ContainersRunning", 0),
                       "paused": info.get("ContainersPaused", 0), "stopped": info.get("ContainersStopped", 0)},
        "images": info.get("Images", 0),
        "name": info.get("Name", ""),
        "contexts": contexts,
        "docker_path": ds.DOCKER,
        "warnings": info.get("Warnings") or [],
    }


def use_context(name):
    if not ds.NAME_RE.match(name or ""):
        raise UserError(L("Geçersiz bağlam adı.", "Invalid context name."))
    code, _, err = ds.docker("context", "use", name, timeout=15)
    if code != 0:
        raise UserError(L("Değiştirilemedi: ", "Could not switch: ") + err.strip()[-200:])
    _arch_cache.clear()
    invalidate_df()
    return name
