"""Arka planda sürekli çalışan iki gözcü.

1. Kaynak gözcüsü: `docker stats` akışını okur, her parçanın işlemci/bellek/ağ kullanımını
   ve son birkaç dakikalık geçmişini tutar (grafikler için). Arayüz sormayı bırakınca kendini kapatır.
2. Olay gözcüsü: `docker events` akışını okur, önemli olayları (başladı, çöktü, belleği yetmedi…)
   ~/.basic-docker/etkinlik.jsonl dosyasına yazar. Docker bu geçmişi kısa süre tutar; biz saklarız.
   Bir parça beklenmedik şekilde çökerse macOS bildirimi gönderir.
"""
from __future__ import annotations

import atexit
import json
import os
import subprocess
import threading
import time
from collections import deque

import docker_service as ds

# ---------------------------------------------------------------------------
# Boyut ayrıştırma ("12.3MiB", "1.2kB", "4GB" → bayt)
# ---------------------------------------------------------------------------

_UNITS = {
    "b": 1, "kb": 1000, "mb": 1000 ** 2, "gb": 1000 ** 3, "tb": 1000 ** 4,
    "kib": 1024, "mib": 1024 ** 2, "gib": 1024 ** 3, "tib": 1024 ** 4,
}


def parse_size(text):
    text = (text or "").strip().split(" (")[0].replace(" ", "")
    if not text or text in ("N/A", "--"):
        return 0
    num, unit = "", ""
    for ch in text:
        if ch.isdigit() or ch == ".":
            num += ch
        else:
            unit += ch
    try:
        return int(float(num) * _UNITS.get(unit.lower(), 1))
    except ValueError:
        return 0


def _pair(text):
    a, _, b = (text or "").partition("/")
    return parse_size(a), parse_size(b)


def _pct(text):
    try:
        return float((text or "0").strip().rstrip("%") or 0)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Kaynak gözcüsü
# ---------------------------------------------------------------------------

class StatsCollector:
    HISTORY = 90          # yaklaşık 3 dakikalık geçmiş (docker stats ~2 sn'de bir yazar)
    IDLE_STOP = 45        # arayüz bu kadar saniye sormazsa akışı kapat

    def __init__(self):
        self.lock = threading.Lock()
        self.latest = {}
        self.history = {}
        self.last_request = 0.0
        self.thread = None
        self.proc = None

    def snapshot(self):
        self.last_request = time.time()
        if not self.thread or not self.thread.is_alive():
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()
        with self.lock:
            out = {}
            for name, cur in self.latest.items():
                if time.time() - cur["t"] > 12:
                    continue  # kapanmış parçanın bayat verisi
                h = self.history.get(name) or {}
                out[name] = {**cur, "hist": {k: list(v) for k, v in h.items()}}
            return out

    def _run(self):
        if not ds.DOCKER:
            return
        try:
            self.proc = subprocess.Popen(
                [ds.DOCKER, "stats", "--format", "{{json .}}"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", errors="replace", env=ds.ENV,
            )
        except OSError:
            return
        try:
            for raw in self.proc.stdout:
                if time.time() - self.last_request > self.IDLE_STOP:
                    break
                line = ds.strip_ansi(raw).strip()
                if not line.startswith("{"):
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                self._ingest(d)
        finally:
            try:
                self.proc.kill()
            except OSError:
                pass
            self.proc = None

    def _ingest(self, d):
        name = d.get("Name", "")
        if not name or name == "--":
            return
        mem, limit = _pair(d.get("MemUsage"))
        rx, tx = _pair(d.get("NetIO"))
        br, bw = _pair(d.get("BlockIO"))
        try:
            pids = int(d.get("PIDs") or 0)
        except ValueError:
            pids = 0
        cur = {
            "t": time.time(),
            "cpu": _pct(d.get("CPUPerc")),
            "mem": mem,
            "mem_limit": limit,
            "mem_pct": _pct(d.get("MemPerc")),
            "net_rx": rx, "net_tx": tx,
            "blk_r": br, "blk_w": bw,
            "pids": pids,
        }
        with self.lock:
            self.latest[name] = cur
            h = self.history.setdefault(name, {"cpu": deque(maxlen=self.HISTORY), "mem": deque(maxlen=self.HISTORY)})
            h["cpu"].append(round(cur["cpu"], 2))
            h["mem"].append(mem)


STATS = StatsCollector()

# ---------------------------------------------------------------------------
# Olay gözcüsü
# ---------------------------------------------------------------------------

EVENTS_FILE = os.path.join(ds.SETTINGS_DIR, "etkinlik.jsonl")
MAX_EVENTS = 5000
_KEEP_CONTAINER = {"create", "start", "restart", "stop", "die", "oom", "pause", "unpause", "destroy",
                   "health_status: healthy", "health_status: unhealthy", "rename"}
_KEEP_IMAGE = {"pull", "delete", "build"}
_KEEP_VOLUME = {"create", "destroy"}
_events_lock = threading.Lock()
_recent_stop = {}   # parça kimliği -> kullanıcı durdurma zamanı (çökme sanmayalım)
_last_notified = {}


def _translate(ev):
    """Docker olayını sade bir kayda çevirir. İlgisizse None."""
    typ = ev.get("Type")
    action = ev.get("Action", "")
    actor = ev.get("Actor") or {}
    attrs = actor.get("Attributes") or {}
    t = (ev.get("timeNano") or 0) / 1e9 or float(ev.get("time") or 0)
    rec = {
        "t": t, "type": typ, "action": action, "id": (actor.get("ID") or "")[:12],
        "name": attrs.get("name", ""), "image": attrs.get("image", ""),
        "app": attrs.get("com.docker.compose.project") or attrs.get("basicdocker.app") or "",
        "service": attrs.get("com.docker.compose.service") or attrs.get("basicdocker.role") or "",
        "level": "info", "text": "", "detail": "",
    }
    if typ == "container" and attrs.get("basicdocker.yardimci"):
        return None  # yedekleme için kısa süreliğine açılan yardımcı parça
    if typ == "container":
        cid = rec["id"]
        if action == "kill":
            # `docker stop` sırası: kill → die → stop. Kill'i not alalım ki ardından gelen
            # 137/143 kodlu "die" olayını çökme sanmayalım.
            _recent_stop[cid] = t
            return None
        if action not in _KEEP_CONTAINER:
            return None
        if attrs.get("com.docker.compose.oneoff") == "True" and action in ("create", "destroy"):
            return None
        if action == "start":
            rec.update(level="ok", text="başladı")
        elif action == "create":
            rec.update(text="oluşturuldu")
        elif action == "restart":
            rec.update(text="yeniden başlatıldı")
        elif action == "stop":
            rec.update(text="durduruldu")
            _recent_stop[cid] = t
        elif action == "pause":
            rec.update(text="duraklatıldı")
        elif action == "unpause":
            rec.update(text="devam ettirildi")
        elif action == "destroy":
            rec.update(text="silindi")
        elif action == "rename":
            rec.update(text=f"adı değişti ({attrs.get('oldName', '').lstrip('/')} → {rec['name']})")
        elif action == "oom":
            rec.update(level="err", text="belleği yetmediği için kapatıldı")
        elif action.startswith("health_status"):
            ok = action.endswith("healthy") and not action.endswith("unhealthy")
            rec.update(level="ok" if ok else "err",
                       text="sağlıklı" if ok else "sağlık kontrolünden geçemedi")
        elif action == "die":
            try:
                code = int(attrs.get("exitCode", "0"))
            except ValueError:
                code = 0
            rec["exit_code"] = code
            user_stop = 0 <= t - _recent_stop.get(cid, -1e12) < 60
            if user_stop:
                return None  # kullanıcı durdurdu; "durduruldu" kaydı zaten var
            if code == 0:
                rec.update(text="işini bitirip kapandı")
            elif code in (137, 143):
                rec.update(level="warn", text=f"zorla kapatıldı (kod {code})")
            else:
                rec.update(level="err", text=f"hata verip kapandı (kod {code})")
        return rec
    if typ == "image":
        if action not in _KEEP_IMAGE:
            return None
        ref = attrs.get("name") or actor.get("ID", "")
        rec.update(name=ref, image=ref,
                   text={"pull": "kalıbı indirildi", "delete": "kalıbı silindi", "build": "kalıbı derlendi"}[action],
                   level="ok" if action != "delete" else "info")
        return rec
    if typ == "volume":
        if action not in _KEEP_VOLUME:
            return None
        rec.update(name=actor.get("ID", ""), text="veri kutusu " + ("oluşturuldu" if action == "create" else "silindi"))
        return rec
    return None


def _key(rec):
    return f"{rec['t']:.6f}|{rec['id']}|{rec['action']}"


def _load_events():
    try:
        with open(EVENTS_FILE, encoding="utf-8") as f:
            lines = f.readlines()[-MAX_EVENTS:]
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            pass
    return out


def _append(records):
    if not records:
        return
    with _events_lock:
        existing = {_key(r) for r in _load_events()[-800:]}
        new = [r for r in records if _key(r) not in existing]
        if not new:
            return
        os.makedirs(ds.SETTINGS_DIR, exist_ok=True)
        with open(EVENTS_FILE, "a", encoding="utf-8") as f:
            for r in new:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        # Dosya çok büyümesin.
        try:
            if os.path.getsize(EVENTS_FILE) > 3_000_000:
                keep = _load_events()[-MAX_EVENTS // 2:]
                tmp = EVENTS_FILE + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    for r in keep:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")
                os.replace(tmp, EVENTS_FILE)
        except OSError:
            pass


def notify(title, text):
    """macOS bildirim merkezine bildirim gönderir (metin argüman olarak geçer, betiğe gömülmez)."""
    if not ds.IS_MAC:
        return
    try:
        subprocess.Popen(
            ["osascript", "-e", "on run argv", "-e",
             "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run",
             title, text],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass


def _maybe_notify(rec):
    if rec["level"] != "err" or rec["type"] != "container":
        return
    if time.time() - rec["t"] > 60:
        return  # eski olay (geçmişi doldururken) için bildirim yok
    prefs = ds.load_settings()["arayuz"]
    if prefs.get("bildirim") is False:
        return
    key = rec["id"] + rec["action"]
    if time.time() - _last_notified.get(key, 0) < 120:
        return
    _last_notified[key] = time.time()
    who = rec["name"] or rec["id"]
    notify("Basic Docker", f"{who} {rec['text']}")


def _watch():
    while True:
        if not ds.DOCKER:
            time.sleep(60)
            continue
        saved = _load_events()
        since = int(saved[-1]["t"]) if saved else int(time.time() - 86400)
        code, out, _ = ds.docker("events", "--since", str(since), "--until", str(int(time.time())),
                                 "--format", "{{json .}}", timeout=20)
        if code == 0:
            recs = []
            for ln in out.splitlines():
                try:
                    r = _translate(json.loads(ln))
                except ValueError:
                    continue
                if r:
                    recs.append(r)
            _append(recs)
        try:
            proc = subprocess.Popen(
                [ds.DOCKER, "events", "--format", "{{json .}}"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", errors="replace", env=ds.ENV,
            )
            _children.add(proc)
            for ln in proc.stdout:
                try:
                    r = _translate(json.loads(ln))
                except ValueError:
                    continue
                if r:
                    _append([r])
                    _maybe_notify(r)
            proc.wait()
            _children.discard(proc)
        except OSError:
            pass
        time.sleep(8)  # Docker kapandıysa biraz bekleyip yeniden bağlan


_watcher = None
_children = set()


@atexit.register
def _kill_children():
    """Uygulama kapanınca arkada `docker events` / `docker stats` süreci kalmasın."""
    for proc in list(_children) + ([STATS.proc] if STATS.proc else []):
        try:
            proc.kill()
        except (OSError, AttributeError):
            pass


def start():
    global _watcher
    if _watcher and _watcher.is_alive():
        return
    _watcher = threading.Thread(target=_watch, daemon=True)
    _watcher.start()


def events(days=7, limit=1500):
    cutoff = time.time() - days * 86400
    with _events_lock:
        recs = [r for r in _load_events() if r.get("t", 0) >= cutoff]
    recs.sort(key=lambda r: r["t"], reverse=True)
    return recs[:limit]
