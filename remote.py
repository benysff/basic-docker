"""Uzak Docker: başka bir bilgisayardaki (sunucu, ev sunucusu, sanal makine) Docker'ı yönetmek.

VS Code'daki mantıkla çalışır:
  - Bağlantı bir Docker bağlamı (context) olarak kaydedilir; bütün docker komutları oradan gider.
  - Önerilen yol SSH: şifre sorulmaz, senin SSH anahtarınla bağlanılır (ssh-agent / ~/.ssh/config).
  - Uzak parçaların kapılarına bu Mac'ten ulaşmak için SSH tüneli açılır (VS Code'un port forwarding'i).
    Bağlantıya tıklayınca tünel kendiliğinden açılır; localhost:3000 bu Mac'te de çalışır.
"""
from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlparse

import docker_service as ds
from docker_service import L, UserError

HOST_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$")
USER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,31}$")
CTX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,62}$")
LOOPBACK = ("localhost", "127.0.0.1", "::1")
# Uygulamanın açtığı tünelleri kullanıcının kendi ssh tünellerinden ayırmak için komut satırındaki işaret
TUNNEL_TAG = "BASICDOCKER_TUNNEL=1"
# Yerel motorların bağlam adları; "yerel Docker'a dön" için tercih sırası
LOCAL_CONTEXTS = ("orbstack", "desktop-linux", "colima", "rancher-desktop", "default")

_ep_cache = {"t": 0.0, "endpoint": "", "name": ""}


def _setup_ssh_mux():
    """Uzak docker komutları tek bir SSH bağlantısını paylaşsın (VS Code gibi).

    docker komutu her çağrıda yeni bir SSH bağlantısı açar: yavaştır ve art arda gelen bağlantıları sunucu
    reddedebilir (MaxStartups). Uygulamanın kendi PATH'ine, ControlMaster ekleyen küçük bir ssh sarmalayıcısı
    konur. Kullanıcının ~/.ssh/config dosyasına dokunulmaz; oradaki ayarlar aynen geçerli.
    Dönen değer asıl ssh programı (tüneller ve bağlantı denemesi onu doğrudan kullanır)."""
    real = shutil.which("ssh", path=ds.ENV.get("PATH"))
    if not real or os.name != "posix":
        return real or "ssh"
    try:
        sock_dir = f"/tmp/bd-ssh-{os.getuid()}"  # soket yolu kısa olmalı (macOS'ta en çok 104 karakter)
        os.makedirs(sock_dir, mode=0o700, exist_ok=True)
        st = os.stat(sock_dir)
        if st.st_uid != os.getuid() or st.st_mode & 0o077:
            return real
        bin_dir = os.path.join(ds.SETTINGS_DIR, "bin")
        os.makedirs(bin_dir, exist_ok=True)
        shim = os.path.join(bin_dir, "ssh")
        body = ("#!/bin/sh\n# Basic Docker: uzak Docker komutları tek SSH bağlantısını paylaşsın.\n"
                f'exec "{real}" -o ControlMaster=auto -o "ControlPath={sock_dir}/%C" -o ControlPersist=120 "$@"\n')
        current = open(shim, encoding="utf-8").read() if os.path.exists(shim) else ""
        if current != body:
            with open(shim, "w", encoding="utf-8") as f:
                f.write(body)
        os.chmod(shim, 0o755)
    except OSError:
        return real
    ds.ENV["PATH"] = bin_dir + os.pathsep + ds.ENV["PATH"]
    return real


SSH = _setup_ssh_mux()


# ---------------------------------------------------------------------------
# Şu an hangi Docker'a bağlıyız?
# ---------------------------------------------------------------------------

def _current(max_age=10):
    if time.time() - _ep_cache["t"] > max_age:
        endpoint, name = os.environ.get("DOCKER_HOST", ""), ""
        if ds.DOCKER:
            code, out, _ = ds.docker("context", "show", timeout=8)
            if code == 0:
                name = out.strip()
            if not endpoint:
                code, out, _ = ds.docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}", timeout=8)
                endpoint = out.strip() if code == 0 else ""
        _ep_cache.update(t=time.time(), endpoint=endpoint, name=name)
    return _ep_cache["endpoint"], _ep_cache["name"]


def invalidate():
    _ep_cache["t"] = 0.0


def parse_endpoint(endpoint):
    """ssh://kullanici@sunucu:22 ya da tcp://sunucu:2376 → sözlük. Yerel uçlar için None."""
    u = urlparse(endpoint or "")
    if u.scheme == "ssh" or (u.scheme == "tcp" and (u.hostname or "") not in LOOPBACK):
        return {"kind": u.scheme, "host": u.hostname or "", "user": u.username or "", "port": u.port}
    return None


def remote_info():
    """Uzak bir motora bağlıysak {kind, host, user, port, context}; değilse None."""
    endpoint, name = _current()
    r = parse_endpoint(endpoint)
    if r:
        r["context"] = name
    return r


def is_remote():
    return remote_info() is not None


# Kapı seçerken bu Mac'te boş mu diye bakmak uzak motorda anlamsız; hatırlanan compose projeleri de
# bağlama göre ayrılır. docker_service bunlara sorar.
ds.is_remote_engine = is_remote
ds.current_context_name = lambda: _current()[1]


# ---------------------------------------------------------------------------
# Bağlamlar
# ---------------------------------------------------------------------------

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


def list_contexts():
    code, out, err = ds.docker("context", "ls", "--format", "json", timeout=15)
    if code != 0:
        raise UserError(L("Bağlamlar okunamadı: ", "Could not read contexts: ") + err.strip()[-200:])
    rows = []
    for row in _json_lines(out):
        endpoint = row.get("DockerEndpoint", "")
        r = parse_endpoint(endpoint)
        rows.append({
            "name": row.get("Name", ""), "current": bool(row.get("Current")),
            "desc": row.get("Description", ""), "endpoint": endpoint, "error": row.get("Error", ""),
            "kind": r["kind"] if r else "local", "host": r["host"] if r else "",
        })
    return rows


def local_context():
    """Bu Mac'teki motorun bağlamı (uzaktan geri dönmek için)."""
    rows = [c for c in list_contexts() if c["kind"] == "local"]
    names = {c["name"] for c in rows}
    for n in LOCAL_CONTEXTS:
        if n in names:
            return n
    return rows[0]["name"] if rows else "default"


def remove_context(name):
    if not CTX_RE.match(name or ""):
        raise UserError(L("Geçersiz bağlam adı.", "Invalid context name."))
    if name == "default":
        raise UserError(L("“default” bağlamı silinemez.", "The “default” context can't be removed."))
    if any(c["name"] == name and c["current"] for c in list_contexts()):
        raise UserError(L("Kullanılan bağlam silinemez. Önce başka birine geç.",
                          "The context in use can't be removed. Switch to another one first."))
    code, _, err = ds.docker("context", "rm", name, timeout=15)
    if code != 0:
        raise UserError(L("Silinemedi: ", "Could not remove: ") + err.strip()[-200:])
    return name


def test_context(name):
    """Bağlamdaki motora ulaşılıyor mu? Sürümü ve gecikmeyi döndürür."""
    if not CTX_RE.match(name or ""):
        raise UserError(L("Geçersiz bağlam adı.", "Invalid context name."))
    t0 = time.time()
    code, out, err = ds.docker("--context", name, "version", "--format", "{{.Server.Version}}", timeout=25)
    ms = int((time.time() - t0) * 1000)
    if code != 0 or not out.strip():
        return {"ok": False, "ms": ms, "error": explain(err or out)}
    return {"ok": True, "ms": ms, "version": out.strip()}


# ---------------------------------------------------------------------------
# Uzak Docker ekleme
# ---------------------------------------------------------------------------

def _ssh_target(user, host, port):
    args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]
    if port:
        args += ["-p", str(port)]
    return args + [f"{user}@{host}" if user else host]


def explain(err):
    """SSH / Docker bağlantı hatasını sade dile çevirir."""
    e = (err or "").lower()
    if "docker.sock" in e and "permission denied" in e:
        return L("Bu kullanıcının sunucudaki Docker'a erişim izni yok. Sunucuda şunu çalıştırıp oturumu kapatıp aç: "
                 "sudo usermod -aG docker $USER",
                 "This user has no access to Docker on the server. Run this on the server, then log out and in again: "
                 "sudo usermod -aG docker $USER")
    if "permission denied (publickey" in e or "permission denied, please try again" in e or "too many authentication failures" in e:
        return L("Sunucu SSH anahtarını kabul etmedi. Terminalde bir kez ssh-copy-id kullanici@sunucu çalıştır; "
                 "anahtarın şifreliyse ssh-add --apple-use-keychain ile ekle. Sonra tekrar dene.",
                 "The server did not accept your SSH key. Run ssh-copy-id user@server once in Terminal; "
                 "if your key has a passphrase, add it with ssh-add --apple-use-keychain. Then try again.")
    if "host key verification failed" in e or "remote host identification has changed" in e:
        return L("Sunucunun kimliği (host key) kayıtlı olandan farklı. Güvenlik için bağlanılmadı. "
                 "Sunucunun değiştiğinden eminsen: ssh-keygen -R sunucu",
                 "The server's identity (host key) differs from the saved one, so the connection was refused for safety. "
                 "If you're sure the server changed: ssh-keygen -R server")
    if "could not resolve hostname" in e or "nodename nor servname" in e or "name or service not known" in e:
        return L("Sunucu adı bulunamadı. Adresi kontrol et.", "The server name could not be found. Check the address.")
    if "connection refused" in e:
        return L("Sunucu bağlantıyı reddetti. SSH ya da Docker o kapıda dinlemiyor olabilir.",
                 "The server refused the connection. SSH or Docker may not be listening on that port.")
    if "timed out" in e or "no route to host" in e or "network is unreachable" in e or "i/o timeout" in e:
        return L("Sunucuya ulaşılamadı (zaman aşımı). Adresi, VPN'i ve güvenlik duvarını kontrol et.",
                 "The server could not be reached (timed out). Check the address, VPN and firewall.")
    if "command not found" in e or "docker: not found" in e or "no such file or directory" in e and "docker" in e:
        return L("Sunucuda docker komutu yok. Önce sunucuya Docker kur: https://docs.docker.com/engine/install/",
                 "There's no docker command on the server. Install Docker there first: https://docs.docker.com/engine/install/")
    if "cannot connect to the docker daemon" in e or "is the docker daemon running" in e:
        return L("Sunucuda Docker çalışmıyor. Sunucuda: sudo systemctl start docker",
                 "Docker isn't running on the server. On the server: sudo systemctl start docker")
    if "certificate" in e or "tls" in e or "x509" in e:
        return L("TLS sertifikası sorunu. Sertifika klasöründe ca.pem, cert.pem ve key.pem olmalı.",
                 "TLS certificate problem. The certificate folder must contain ca.pem, cert.pem and key.pem.")
    last = [ln for ln in (err or "").strip().splitlines() if ln.strip()]
    return last[-1][-300:] if last else L("Bağlanılamadı.", "Could not connect.")


def _check_ssh(user, host, port):
    try:
        p = subprocess.run([SSH, *_ssh_target(user, host, port), "docker", "version", "--format", "'{{.Server.Version}}'"],
                           capture_output=True, text=True, timeout=30, env=ds.ENV, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise UserError(explain("timed out"))
    except OSError:
        raise UserError(L("Bu Mac'te ssh komutu bulunamadı.", "The ssh command was not found on this Mac."))
    version = p.stdout.strip()
    if p.returncode != 0 or not version:
        raise UserError(explain(p.stderr or p.stdout))
    return version


def _tls_args(tls_dir):
    if "," in tls_dir or "=" in tls_dir:
        raise UserError(L("Sertifika klasörünün yolunda virgül ya da = olmamalı.", "The certificate folder path can't contain commas or =."))
    files = {k: os.path.join(tls_dir, f"{k}.pem") for k in ("ca", "cert", "key")}
    missing = [f"{k}.pem" for k, f in files.items() if not os.path.isfile(f)]
    if missing:
        raise UserError(L(f"Sertifika klasöründe eksik dosya: {', '.join(missing)}",
                          f"Missing files in the certificate folder: {', '.join(missing)}"))
    return files


def _check_tcp(url, tls):
    args = ["-H", url]
    if tls:
        args += ["--tlsverify", "--tlscacert", tls["ca"], "--tlscert", tls["cert"], "--tlskey", tls["key"]]
    code, out, err = ds.docker(*args, "version", "--format", "{{.Server.Version}}", timeout=20)
    if code != 0 or not out.strip():
        e = (err or out).lower()
        if "cannot connect to the docker daemon" in e or "connection refused" in e:
            raise UserError(L("Bu adreste Docker'a ulaşılamadı. Sunucuda Docker'ın çalıştığını ve bu kapıda TCP ile dinlediğini kontrol et "
                              "(genelde 2376, sertifikasız ise 2375).",
                              "Couldn't reach Docker at this address. Check that Docker is running on the server and listening on "
                              "this TCP port (usually 2376, or 2375 without certificates)."))
        raise UserError(explain(err or out))
    return out.strip()


def add_remote(p):
    """Yeni bir uzak Docker bağlamı oluşturur (önce bağlantıyı dener)."""
    kind = p.get("tur") if p.get("tur") in ("ssh", "tcp") else "ssh"
    host = (p.get("sunucu") or "").strip()
    user = (p.get("kullanici") or "").strip()
    port = str(p.get("kapi") or "").strip()
    if "@" in host and not user:
        user, host = host.split("@", 1)
    if ":" in host and not port and host.count(":") == 1:
        host, port = host.split(":", 1)
    if not HOST_RE.match(host):
        raise UserError(L("Sunucu adresini yaz (ör. sunucu.ornek.com, 192.168.1.20 ya da ~/.ssh/config'teki bir ad).",
                          "Enter the server address (e.g. server.example.com, 192.168.1.20 or a name from ~/.ssh/config)."))
    if user and not USER_RE.match(user):
        raise UserError(L("Geçersiz kullanıcı adı.", "Invalid user name."))
    if port and (not port.isdigit() or not 1 <= int(port) <= 65535):
        raise UserError(L("Kapı 1 ile 65535 arasında bir sayı olmalı.", "The port must be a number between 1 and 65535."))
    name = (p.get("ad") or "").strip() or re.sub(r"[^A-Za-z0-9_.-]+", "-", host).strip("-.")[:40]
    if not CTX_RE.match(name):
        raise UserError(L("Bağlantı adı harf ya da rakamla başlamalı; boşluk içermemeli.",
                          "The connection name must start with a letter or digit and contain no spaces."))
    if any(c["name"] == name for c in list_contexts()):
        raise UserError(L(f"“{name}” adında bir bağlantı zaten var. Başka bir ad seç.",
                          f"A connection named “{name}” already exists. Pick another name."))
    desc = (p.get("aciklama") or "").strip()[:120]

    if kind == "ssh":
        version = _check_ssh(user, host, port)
        spec = f"host=ssh://{user + '@' if user else ''}{host}{':' + port if port else ''}"
    else:
        url = f"tcp://{host}:{port or 2376}"
        tls_dir = os.path.expanduser((p.get("tls") or "").strip())
        tls = _tls_args(tls_dir) if tls_dir else None
        version = _check_tcp(url, tls)
        spec = f"host={url}" + (f",ca={tls['ca']},cert={tls['cert']},key={tls['key']}" if tls else "")

    args = ["context", "create", name, "--docker", spec]
    if desc:
        args += ["--description", desc]
    code, _, err = ds.docker(*args, timeout=15)
    if code != 0:
        raise UserError(L("Bağlantı kaydedilemedi: ", "Could not save the connection: ") + err.strip()[-200:])
    return {"name": name, "version": version, "secure": kind == "ssh" or bool(p.get("tls"))}


# ---------------------------------------------------------------------------
# SSH tünelleri (VS Code'daki port forwarding)
# ---------------------------------------------------------------------------

_tunnels = {}  # uzak kapı -> {"local", "proc", "endpoint", "log", "started"}
_tlock = threading.Lock()


def _local_port_free(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # ssh de böyle dinler; TIME_WAIT'teki kapı boş sayılır
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _can_connect(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def _probe(port):
    """Tünelden bir bağlantı dener. Sunucu yönlendirmeyi reddederse ya da kapıda kimse yoksa ssh bağlantıyı hemen kapatır."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2) as s:
            s.settimeout(1.2)
            try:
                return s.recv(1) != b""
            except socket.timeout:
                return True  # bağlantı açık, karşı taraf bizden istek bekliyor (ör. HTTP)
    except OSError:
        return False


def _pick_local(preferred):
    candidates = [preferred] if 1024 <= preferred <= 65535 else []
    candidates += range(max(1024, preferred + 1) if preferred >= 1024 else 20000, 65000)
    for port in candidates:
        if _local_port_free(port):
            return port
    raise UserError(L("Tünel için boş kapı bulunamadı.", "No free local port for the tunnel."))


def _public(remote_port, t):
    return {"remote": remote_port, "local": t["local"], "started": t["started"],
            "url": f"http://localhost:{t['local']}"}


def _alive(t, endpoint):
    return t["proc"].poll() is None and t["endpoint"] == endpoint


def open_tunnel(remote_port):
    try:
        remote_port = int(remote_port)
    except (TypeError, ValueError):
        raise UserError(L("Geçersiz kapı.", "Invalid port."))
    if not 1 <= remote_port <= 65535:
        raise UserError(L("Geçersiz kapı.", "Invalid port."))
    r = remote_info()
    if not r or r["kind"] != "ssh":
        raise UserError(L("Tünel yalnızca SSH ile bağlı uzak Docker'da gerekir.",
                          "Tunnels are only needed for a remote Docker connected over SSH."))
    endpoint, _ = _current()
    with _tlock:
        t = _tunnels.get(remote_port)
        if t and _alive(t, endpoint):
            return _public(remote_port, t)
        if t:
            _stop(t)
        local = _pick_local(remote_port)
        log = tempfile.TemporaryFile()
        args = [SSH, "-N", "-o", "ControlPath=none", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
                "-o", f"SetEnv={TUNNEL_TAG}",
                "-L", f"127.0.0.1:{local}:127.0.0.1:{remote_port}",
                *_ssh_target(r["user"], r["host"], r["port"])]
        try:
            proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log, env=ds.ENV)
        except OSError:
            raise UserError(L("Bu Mac'te ssh komutu bulunamadı.", "The ssh command was not found on this Mac."))
        deadline = time.time() + 15
        while time.time() < deadline:
            if proc.poll() is not None:
                log.seek(0)
                raise UserError(explain(log.read().decode("utf-8", "replace")))
            if _can_connect(local):
                break
            time.sleep(0.15)
        else:
            proc.kill()
            raise UserError(explain("timed out"))
        if not _probe(local):
            time.sleep(0.3)
            log.seek(0)
            msg = log.read().decode("utf-8", "replace").lower()
            _stop({"proc": proc, "log": log})
            if "administratively prohibited" in msg:
                raise UserError(L("Sunucu SSH tüneline izin vermiyor. Sunucuda /etc/ssh/sshd_config dosyasında "
                                  "AllowTcpForwarding yes yapıp SSH'yi yeniden başlat (sudo systemctl restart ssh).",
                                  "The server doesn't allow SSH tunnels. On the server, set AllowTcpForwarding yes in "
                                  "/etc/ssh/sshd_config and restart SSH (sudo systemctl restart ssh)."))
            raise UserError(L(f"Sunucuda {remote_port} kapısında çalışan bir şey yok. Parça kapalı olabilir.",
                              f"Nothing is listening on port {remote_port} on the server. The container may be stopped."))
        t = {"local": local, "proc": proc, "endpoint": endpoint, "log": log, "started": time.time()}
        _tunnels[remote_port] = t
        return _public(remote_port, t)


def _stop(t):
    try:
        t["proc"].terminate()
        t["proc"].wait(timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        try:
            t["proc"].kill()
        except OSError:
            pass
    try:
        t["log"].close()
    except OSError:
        pass


def close_tunnel(remote_port):
    with _tlock:
        t = _tunnels.pop(int(remote_port), None)
    if t:
        _stop(t)
    return True


def list_tunnels():
    endpoint, _ = _current()
    with _tlock:
        for port, t in list(_tunnels.items()):
            if not _alive(t, endpoint):
                _stop(_tunnels.pop(port))
        return [_public(port, t) for port, t in sorted(_tunnels.items())]


def kill_orphans():
    """Uygulama çöktüyse arkada kalmış tünelleri kapatır. Sadece bu uygulamanın işaretli tünellerine dokunur."""
    try:
        out = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return 0
    killed = 0
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[1] == "1" and TUNNEL_TAG in parts[2] and "ssh" in parts[2]:
            try:
                os.kill(int(parts[0]), signal.SIGTERM)
                killed += 1
            except (OSError, ValueError):
                pass
    return killed


@atexit.register
def close_all():
    """Bağlam değişince ya da uygulama kapanınca bütün tüneller kapansın (arkada ssh kalmasın)."""
    with _tlock:
        items = list(_tunnels.values())
        _tunnels.clear()
    for t in items:
        _stop(t)


def open_url(url):
    """Tarayıcıda açılacak adres. Uzak SSH motorunda localhost adresleri için önce tünel açar."""
    u = urlparse(url)
    r = remote_info()
    if not r or (u.hostname or "") not in LOOPBACK or not u.port:
        return url, None
    if r["kind"] == "tcp":
        return url.replace(u.netloc, f"{r['host']}:{u.port}", 1), None
    t = open_tunnel(u.port)
    return url.replace(u.netloc, f"localhost:{t['local']}", 1), t
