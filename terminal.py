"""Uygulama içi terminal: parçanın (konteynerin) içinde gerçek, etkileşimli bir kabuk.

`docker exec -it` bir sözde terminal (PTY) üzerinden çalıştırılır; arayüzdeki xterm.js
yazılanları buraya gönderir, çıktıyı da "bekleyen istek" (long-poll) ile alır.
Böylece cd, sekme tamamlama, renkler, top, vim gibi her şey normal terminaldeki gibi çalışır.
"""
from __future__ import annotations

import base64
import fcntl
import os
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import threading
import time
import uuid

import docker_service as ds

MAX_SESSIONS = 16
MAX_BUFFER = 1_000_000  # arayüz okumazsa en fazla bu kadar çıktı biriktirilir
READ_WAIT = 20          # bir okuma isteğinin yeni çıktı için bekleyeceği en uzun süre (sn)

# Önce kabuğun konteyner içindeki PID'sini görünmez bir işaretle bildir (oturum kapanınca
# o kabuğu sonlandırabilmek için), sonra bash varsa onu, yoksa sh'yi aç.
SHELL_PICK = ("printf '\\033]7777;bd-pid=%s\\007' \"$$\"; "
              "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi")
PID_MARK = re.compile(rb"\x1b\]7777;bd-pid=(\d+)\x07")

_sessions: dict[str, "Session"] = {}
_lock = threading.Lock()


def _set_size(fd, cols, rows):
    cols = max(20, min(int(cols or 80), 500))
    rows = max(5, min(int(rows or 24), 300))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


class Session:
    def __init__(self, container, cols, rows, user=None):
        self.id = uuid.uuid4().hex
        self.container = container
        self.buffer = bytearray()
        self.closed = False
        self.exit_code = None
        self.cond = threading.Condition()
        self.last_seen = time.time()
        self.remote_pid = None  # kabuğun konteyner içindeki PID'si

        master, slave = pty.openpty()
        _set_size(slave, cols, rows)
        args = [ds.DOCKER, "exec", "-it", "-e", "TERM=xterm-256color", "-e", "COLORTERM=truecolor"]
        if user:
            args += ["-u", user]
        args += [container, "sh", "-c", SHELL_PICK]
        # subprocess, fork+exec'i C tarafında yapar; çok iş parçacıklı süreçte de güvenlidir.
        self.proc = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave,
                                     start_new_session=True, env=ds.ENV, close_fds=True)
        os.close(slave)
        self.fd = master
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        while True:
            try:
                ready, _, _ = select.select([self.fd], [], [], 1.0)
                if not ready:
                    if self.proc.poll() is not None:
                        break
                    continue
                data = os.read(self.fd, 65536)
            except OSError:
                data = b""
            if not data:
                break
            if self.remote_pid is None:
                m = PID_MARK.search(data)
                if m:
                    self.remote_pid = int(m.group(1))
                    data = data[:m.start()] + data[m.end():]
            with self.cond:
                self.buffer += data
                if len(self.buffer) > MAX_BUFFER:
                    del self.buffer[: len(self.buffer) - MAX_BUFFER]
                self.cond.notify_all()
        try:
            self.exit_code = self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.exit_code = None
        with self.cond:
            self.closed = True
            self.cond.notify_all()

    def read(self, wait=READ_WAIT):
        self.last_seen = time.time()
        with self.cond:
            if not self.buffer and not self.closed:
                self.cond.wait(timeout=wait)
            data = bytes(self.buffer)
            self.buffer.clear()
            return data, self.closed and not data

    def write(self, text):
        self.last_seen = time.time()
        if self.closed:
            return
        data = text.encode("utf-8")
        while data:
            try:
                n = os.write(self.fd, data)
            except BlockingIOError:
                time.sleep(0.01)
                continue
            except OSError:
                return
            data = data[n:]

    def resize(self, cols, rows):
        if self.closed:
            return
        try:
            _set_size(self.fd, cols, rows)
            # docker istemcisi yeni boyutu SIGWINCH gelince okur ve konteynere iletir.
            self.proc.send_signal(signal.SIGWINCH)
        except (OSError, ProcessLookupError):
            pass

    def close(self):
        # docker istemcisini öldürmek konteynerin içindeki kabuğu kapatmaz; ona ayrıca HUP gönder.
        if self.remote_pid and self.proc.poll() is None:
            try:
                subprocess.run([ds.DOCKER, "exec", self.container, "kill", "-HUP", str(self.remote_pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=ds.ENV, timeout=5)
            except (subprocess.TimeoutExpired, OSError):
                pass
        if self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    self.proc.kill()
                except OSError:
                    pass
        try:
            os.close(self.fd)
        except OSError:
            pass
        with self.cond:
            self.closed = True
            self.cond.notify_all()


def _get(sid):
    s = _sessions.get(sid or "")
    if not s:
        raise ds.UserError("Terminal oturumu bulunamadı. Yeniden bağlan.")
    return s


def _cleanup():
    """Kapanmış ve arayüzün bırakmış olduğu (5 dk okunmamış) oturumları temizler."""
    now = time.time()
    for sid, s in list(_sessions.items()):
        if (s.closed and now - s.last_seen > 60) or now - s.last_seen > 300:
            s.close()
            _sessions.pop(sid, None)


def open_session(cid, cols=80, rows=24, user=""):
    _, c = ds.get_container(cid)
    if not c["running"]:
        raise ds.UserError("Parça kapalı. Terminal açmak için önce başlat.")
    user = (user or "").strip()
    if user and not ds.NAME_RE.match(user):
        raise ds.UserError("Geçersiz kullanıcı adı.")
    if not ds.DOCKER:
        raise ds.UserError("Docker bulunamadı.")
    with _lock:
        _cleanup()
        if len(_sessions) >= MAX_SESSIONS:
            raise ds.UserError("Çok fazla açık terminal var. Birkaçını kapatıp tekrar dene.")
        s = Session(c["name"], cols, rows, user or None)
        _sessions[s.id] = s
    return {"sid": s.id, "parca": c["name"]}


def read(sid):
    data, finished = _get(sid).read()
    s = _sessions.get(sid)
    return {
        "veri": base64.b64encode(data).decode("ascii") if data else "",
        "bitti": finished,
        "kod": s.exit_code if (s and finished) else None,
    }


def write(sid, text):
    _get(sid).write(str(text or ""))
    return {"tamam": True}


def resize(sid, cols, rows):
    _get(sid).resize(cols, rows)
    return {"tamam": True}


def close(sid):
    with _lock:
        s = _sessions.pop(sid or "", None)
    if s:
        threading.Thread(target=s.close, daemon=True).start()
    return {"tamam": True}


def close_all():
    with _lock:
        sessions = list(_sessions.values())
        _sessions.clear()
    threads = [threading.Thread(target=s.close, daemon=True) for s in sessions]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=6)
