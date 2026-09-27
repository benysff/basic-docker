#!/usr/bin/env python3
"""Basic Docker — Docker uygulamalarını tek tuşla aç/kapat.

Native bir masaüstü penceresi açar (macOS'ta WKWebView). Sunucu, port ya da tarayıcı yoktur:
arayüz, Python fonksiyonlarını doğrudan `window.pywebview.api.call(...)` ile çağırır.

Kurmak için:  ./kur.command   (sonra Uygulamalar klasöründeki Basic Docker ile açılır)
Geliştirirken:  .venv/bin/python app.py --gelistirici
"""
from __future__ import annotations

import argparse
import atexit
import json
import os
import re
import signal
import subprocess
import sys
import time
import traceback
import webbrowser
from urllib.parse import parse_qs, urlparse

import backups as bk
import catalog
import docker_service as ds
import insights
import monitor
import remote as rm
import resources as rs
import terminal as term

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
VERSION = "2.0.0"


def build_html():
    """index.html'i, içinde andığı bütün CSS ve JS dosyaları gömülü olarak tek parça halinde hazırlar."""
    def read(name):
        with open(os.path.join(STATIC, name), encoding="utf-8") as f:
            return f.read()

    html = read("index.html")
    html = re.sub(r'<link rel="stylesheet" href="([\w./-]+)">',
                  lambda m: f"<style>\n{read(m.group(1))}\n</style>", html)
    html = re.sub(r'<script src="([\w./-]+)"></script>',
                  lambda m: f"<script>\n{read(m.group(1))}\n</script>", html)
    return html


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------

_engine_cache = {"t": 0.0, "v": "diger"}

UI_PREFS = {
    "intro_kapali": bool,
    "tema": ("sistem", "acik", "koyu"),
    "dil": ("sade", "teknik"),
    "bildirim": bool,
    "gorunum": ("kart", "liste"),
    "kenar_dar": bool,
    "lang": ("tr", "en"),
}


def _engine():
    if time.time() - _engine_cache["t"] > 30:
        _engine_cache.update(t=time.time(), v=ds.engine_kind())
    return _engine_cache["v"]


def _s(p, key, default=""):
    v = p.get(key, default)
    return v if isinstance(v, str) else str(v if v is not None else default)


def _job(job):
    return {"is": job.to_dict() if job else None}


# ---------------------------------------------------------------------------
# Arayüzün çağırdığı uçlar. Her biri parametre sözlüğü alır, JSON'a çevrilebilir bir şey döndürür.
# ---------------------------------------------------------------------------

def api_state(p):
    snap = ds.snapshot()
    snap.pop("taken_ports", None)
    snap["jobs"] = ds.recent_jobs()
    kind = _engine()
    remote = rm.remote_info() if kind == "remote" else None
    if remote:
        remote["guvenli"] = rm.safe_mode_active()
    snap["makineler"] = rm.machines()
    snap["platform"] = {"mac": ds.IS_MAC, "engine": kind,
                        "engine_name": (remote["context"] or remote["host"]) if remote else ds.ENGINE_NAMES.get(kind, "Docker"),
                        "remote": remote, "version": VERSION}
    snap["ui"] = ds.load_settings()["arayuz"]
    snap["sets"] = ds.list_sets()
    return snap


def api_app(p):
    return _job(ds.app_action(_s(p, "key"), _s(p, "islem"), bool(p.get("veriler"))))


def api_app_meta(p):
    key = _s(p, "key")
    ds.get_app(key)  # var mı?
    ds.set_app_meta(key, name=p.get("ad"), note=p.get("not"))
    return {"tamam": True}


def api_container(p):
    return _job(ds.container_action(_s(p, "id"), _s(p, "islem"), bool(p.get("veriler"))))


def api_move(p):
    ds.move_container(_s(p, "id"), _s(p, "hedef"), _s(p, "yeni_ad"))
    return {"tamam": True}


def api_create(p):
    kind = p.get("tur")
    if kind == "sablon":
        job = ds.create_from_template(_s(p, "sablon"), _s(p, "uygulama"), _s(p, "yeni_ad"))
    elif kind == "ozel":
        job = ds.create_custom(
            _s(p, "imaj"), _s(p, "parca"), _s(p, "uygulama"), _s(p, "yeni_ad"),
            p.get("ic_kapi"), p.get("dis_kapi"), _s(p, "ayarlar"), _s(p, "veri"),
        )
    elif kind == "compose":
        job = ds.create_from_compose(_s(p, "yol"), _s(p, "proje"), _s(p, "ad"))
    else:
        raise ds.UserError(ds.L("Bilinmeyen oluşturma türü.", "Unknown create type."))
    return _job(job)


def api_diagnose(p):
    _, c = ds.get_container(_s(p, "id"))
    text = ds.logs_ex(c["id"], tail=400)
    arch_warning = None
    if c.get("image_id"):
        code, out, _ = ds.docker("image", "inspect", "--format", "{{.Architecture}}", c["image_id"], timeout=10)
        arch = out.strip()
        host = rs.host_arch()
        if code == 0 and arch and host and arch != host:
            arch_warning = {
                "id": "emulated",
                "title": ds.L(f"Kalıp {arch} işlemci için; Mac'in {host}", f"The image is for {arch}; your Mac is {host}"),
                "desc": ds.L("Parça emülasyonla (Rosetta/QEMU) çalışıyor. Çalışabilir ama yavaştır; bazı programlar hiç açılmaz.",
                             "The container runs under emulation (Rosetta/QEMU). It may work but is slow; some programs won't start."),
                "fix": ds.L(f"Kalıbın {host} sürümü varsa onu kullan.", f"Use the {host} version of the image if there is one."),
                "link": None, "line": "", "line_no": 0,
            }
    return {"teshis": insights.diagnose(c, text, arch_warning)}


def api_logs(p):
    text = ds.logs_ex(_s(p, "id"), tail=p.get("satir", 500), timestamps=bool(p.get("zaman")), since=_s(p, "since"))
    return {"metin": text}


def api_line_hints(p):
    lines = p.get("satirlar") or []
    return {"ipuclari": {str(i): h for i, ln in enumerate(lines[:3000]) if (h := insights.line_hint(str(ln)))}}


def api_prefs_get(p):
    prefs = ds.load_settings()["arayuz"]
    return {"ayarlar": prefs, "yedek_klasoru": bk.backup_root(), "surum": VERSION}


def api_prefs_set(p):
    clean = {}
    for k, v in p.items():
        rule = UI_PREFS.get(k)
        if rule is bool:
            clean[k] = bool(v)
        elif isinstance(rule, tuple) and v in rule:
            clean[k] = v
    ds.update_settings(lambda s: s["arayuz"].update(clean))
    if "lang" in clean:
        ds.set_lang(clean["lang"])
    return {"tamam": True}


def api_choose_folder(p):
    import webview
    windows = webview.windows
    if not windows:
        return {"yol": None}
    result = windows[0].create_file_dialog(webview.FOLDER_DIALOG)
    return {"yol": result[0] if result else None}


def api_choose_file(p):
    import webview
    windows = webview.windows
    if not windows:
        return {"yol": None}
    start = bk.backup_root() if os.path.isdir(bk.backup_root()) else os.path.expanduser("~")
    result = windows[0].create_file_dialog(webview.OPEN_DIALOG, directory=start, allow_multiple=False)
    return {"yol": result[0] if result else None}


def api_open_link(p):
    url = _s(p, "url")
    if urlparse(url).scheme not in ("http", "https"):
        raise ds.UserError(ds.L("Geçersiz bağlantı.", "Invalid link."))
    url, tunnel = rm.open_url(url)  # uzak motorda localhost adresleri için önce SSH tüneli
    webbrowser.open(url)
    return {"tamam": True, "url": url, "tunel": tunnel}


def _context_changed():
    """Bağlam değişince: önbellekler, canlı akışlar ve eski sunucuya açılmış tüneller sıfırlanır."""
    _engine_cache["t"] = 0.0
    rm.invalidate()
    rm.invalidate_machines()
    rm.close_all()
    monitor.reconnect()


def api_use_context(p):
    name = rs.use_context(_s(p, "ad"))
    _context_changed()
    return {"ad": name}


def api_use_local(p):
    # Uygulama kendine özel uzak bir bağlamdaysa sadece onu bırak: terminalin bağlamına dokunma.
    name = ""
    if rm.clear_app_context():
        name = rm.global_context_name()
        if rm.parse_endpoint(rm.context_endpoint(name) or ""):
            name = ""  # terminal de uzak bir bağlamdaymış; Bu Mac'in motorunu seç
    if not name:
        name = rs.use_context(rm.local_context())
    _context_changed()
    return {"ad": name}


def api_add_remote(p):
    res = rm.add_remote(p)
    if res.get("gerekli"):  # önce parmak izi onayı ya da parola adımı
        return {"sonuc": res}
    rm.invalidate_machines()
    if p.get("gec"):
        rs.use_context(res["name"])
        _context_changed()
    return {"sonuc": res}


def api_copy(p):
    text = _s(p, "metin")
    if ds.IS_MAC:
        subprocess.run(["pbcopy"], input=text, text=True, encoding="utf-8", check=False)
        return {"tamam": True}
    return {"tamam": False}  # arayüz kendi yöntemini dener


def api_open_folder(p):
    ds.open_folder(_s(p, "key"))
    return {"tamam": True}


def api_set_save(p):
    return {"id": ds.save_set(_s(p, "id"), _s(p, "ad"), p.get("uygulamalar") or [])}


ROUTES = {
    # Genel durum
    "/api/durum": api_state,
    "/api/istatistik": lambda p: {"istatistik": monitor.STATS.snapshot()},
    "/api/is": lambda p: {"is": ds.get_job(_s(p, "id"))},
    "/api/etkinlik": lambda p: {"olaylar": monitor.events(days=int(p.get("gun") or 7))},
    "/api/sistem": lambda p: {"sistem": rs.system_info()},
    "/api/baglam": api_use_context,
    "/api/baglamlar": lambda p: {"baglamlar": rm.list_contexts(), "tuneller": rm.list_tunnels(), "uzak": rm.remote_info(),
                                 "tam_kontrol": sorted(rm.safe_mode_names())},
    "/api/baglam/yerel": api_use_local,
    "/api/baglam/dene": lambda p: {"sonuc": rm.test_context(_s(p, "ad"))},
    "/api/baglam/sil": lambda p: {"ad": rm.remove_context(_s(p, "ad"))},
    "/api/uzak/ekle": api_add_remote,
    "/api/uzak/guven": lambda p: rm.trust_host(p),
    "/api/uzak/anahtar": lambda p: rm.install_key(p, _s(p, "parola")),
    "/api/uzak/tam-kontrol": lambda p: rm.set_full_control(_s(p, "ad"), bool(p.get("acik"))),
    "/api/tunel/ac": lambda p: {"tunel": rm.open_tunnel(p.get("kapi"))},
    "/api/tunel/kapat": lambda p: {"tamam": rm.close_tunnel(p.get("kapi"))},
    "/api/docker-ac": lambda p: {"mesaj": ds.start_docker_desktop()},
    # Uygulamalar
    "/api/katalog": lambda p: {"katalog": catalog.public_catalog()},
    "/api/uygulama": api_app,
    "/api/uygulama/ayar": api_app_meta,
    "/api/uygulama/kayitlar": lambda p: {"satirlar": ds.app_logs(_s(p, "key"), p.get("satir", 300))},
    "/api/uygulama/env": lambda p: {"metin": ds.app_env(_s(p, "key"))},
    "/api/uygulama/compose": lambda p: {"dosyalar": ds.compose_files(_s(p, "key"))},
    "/api/compose-bilgi": lambda p: {"bilgi": ds.compose_info(_s(p, "yol"))},
    "/api/olustur": api_create,
    "/api/klasor-ac": api_open_folder,
    # Parçalar
    "/api/parca": api_container,
    "/api/parca/tasi": api_move,
    "/api/parcalar/toplu": lambda p: _job(ds.bulk_container_action(p.get("idler") or [], _s(p, "islem"),
                                                                   bool(p.get("veriler")))),
    "/api/parca/detay": lambda p: {"detay": ds.container_detail(_s(p, "id"))},
    "/api/parca/teshis": api_diagnose,
    "/api/parca/komut": lambda p: {"sonuc": ds.exec_command(_s(p, "id"), _s(p, "komut"))},
    # Uygulama içi etkileşimli terminal (docker exec -it)
    "/api/terminal/ac": lambda p: term.open_session(_s(p, "id"), p.get("cols"), p.get("rows"), _s(p, "kullanici")),
    "/api/terminal/oku": lambda p: term.read(_s(p, "sid")),
    "/api/terminal/yaz": lambda p: term.write(_s(p, "sid"), p.get("veri")),
    "/api/terminal/boyut": lambda p: term.resize(_s(p, "sid"), p.get("cols"), p.get("rows")),
    "/api/terminal/kapat": lambda p: term.close(_s(p, "sid")),
    "/api/parca/politika": lambda p: {"metin": ds.set_restart_policy(_s(p, "id"), _s(p, "politika"))},
    "/api/kayitlar": api_logs,
    "/api/kayit-ipuclari": api_line_hints,
    # Kalıplar
    "/api/kaliplar": lambda p: rs.list_images(),
    "/api/kalip/detay": lambda p: {"detay": rs.image_detail(_s(p, "ref"))},
    "/api/kalip/indir": lambda p: _job(rs.pull_image(_s(p, "ref"))),
    "/api/kalip/sil": lambda p: _job(rs.remove_images(p.get("refs") or [], bool(p.get("zorla")))),
    "/api/kalip/denetle": lambda p: {"sonuc": rs.check_update(_s(p, "ref"))},
    "/api/kalip/denetle-hepsi": lambda p: _job(rs.check_all_updates()),
    # Veri kutuları ve yedekler
    "/api/kutular": lambda p: {"kutular": rs.list_volumes()},
    "/api/kutu/olustur": lambda p: {"ad": rs.create_volume(_s(p, "ad"))},
    "/api/kutu/sil": lambda p: _job(rs.remove_volumes(p.get("adlar") or [])),
    "/api/kutu/yedekle": lambda p: _job(bk.backup_volume(_s(p, "ad"))),
    "/api/kutu/geri-yukle": lambda p: _job(bk.restore_volume(_s(p, "dosya"), _s(p, "hedef"),
                                                             bool(p.get("yeni")), bool(p.get("temizle")))),
    "/api/db/dokum": lambda p: _job(bk.dump_database(_s(p, "id"))),
    "/api/db/geri-yukle": lambda p: _job(bk.restore_database(_s(p, "id"), _s(p, "dosya"))),
    "/api/yedekler": lambda p: bk.list_backups(),
    "/api/yedek/sil": lambda p: {"mesaj": bk.delete_backup(_s(p, "dosya"))},
    "/api/yedek/goster": lambda p: bk.reveal(_s(p, "dosya")) or {"tamam": True},
    "/api/yedek-klasoru": lambda p: {"yol": bk.set_backup_root(_s(p, "yol"))},
    # Ağlar
    "/api/aglar": lambda p: {"aglar": rs.list_networks()},
    "/api/ag/olustur": lambda p: {"ad": rs.create_network(_s(p, "ad"), bool(p.get("ic")))},
    "/api/ag/sil": lambda p: rs.remove_network(_s(p, "ad")) or {"tamam": True},
    "/api/ag/bagla": lambda p: rs.network_connect(_s(p, "ag"), _s(p, "parca"), bool(p.get("bagla", True))) or {"tamam": True},
    # Kapılar ve temizlik
    "/api/kapilar": lambda p: rs.port_map(),
    "/api/kapi-oner": lambda p: rs.suggest_port(p.get("kapi")),
    "/api/temizlik": lambda p: {"plan": rs.cleanup_plan()},
    "/api/temizle": lambda p: _job(rs.run_cleanup(p)),
    # Çalışma setleri
    "/api/set/kaydet": api_set_save,
    "/api/set/sil": lambda p: ds.delete_set(_s(p, "id")) or {"tamam": True},
    "/api/set/calistir": lambda p: _job(ds.run_set(_s(p, "id"), _s(p, "islem"))),
    # Bilgisayarla ilgili
    "/api/klasor-sec": api_choose_folder,
    "/api/dosya-sec": api_choose_file,
    "/api/link-ac": api_open_link,
    "/api/kopyala": api_copy,
    "/api/ayarlar": api_prefs_get,
    "/api/ayarlar/kaydet": api_prefs_set,
}


# Güvenli mod: uzak sunucuda (tam kontrol açılmadıysa) sadece izleme ve güvenli kontrol işlemleri.
REMOTE_ALLOWED = {
    "/api/durum", "/api/istatistik", "/api/is", "/api/etkinlik", "/api/sistem", "/api/katalog",
    "/api/baglam", "/api/baglamlar", "/api/baglam/yerel", "/api/baglam/dene", "/api/baglam/sil",
    "/api/uzak/ekle", "/api/uzak/guven", "/api/uzak/anahtar", "/api/uzak/tam-kontrol", "/api/tunel/ac", "/api/tunel/kapat",
    "/api/uygulama", "/api/uygulama/ayar", "/api/uygulama/kayitlar", "/api/uygulama/env", "/api/uygulama/compose",
    "/api/parca", "/api/parca/tasi", "/api/parcalar/toplu", "/api/parca/detay", "/api/parca/teshis", "/api/parca/komut",
    "/api/terminal/ac", "/api/terminal/oku", "/api/terminal/yaz", "/api/terminal/boyut", "/api/terminal/kapat",
    "/api/kayitlar", "/api/kayit-ipuclari", "/api/kaliplar", "/api/kalip/detay", "/api/kalip/denetle", "/api/kalip/denetle-hepsi",
    "/api/kutular", "/api/aglar", "/api/kapilar", "/api/kapi-oner", "/api/temizlik",
    "/api/yedekler", "/api/yedek/goster", "/api/yedek-klasoru", "/api/yedek/sil", "/api/compose-bilgi",
    "/api/link-ac", "/api/kopyala", "/api/ayarlar", "/api/ayarlar/kaydet", "/api/klasor-sec", "/api/dosya-sec",
    "/api/klasor-ac", "/api/docker-ac",
}
REMOTE_SAFE_ACTIONS = {"baslat", "durdur", "yeniden", "duraklat", "devam", "oldur", "terminal"}


def _safe_mode_guard(path, params):
    if not rm.safe_mode_active():
        return
    blocked = path not in REMOTE_ALLOWED
    if path in ("/api/uygulama", "/api/parca", "/api/parcalar/toplu") and _s(params, "islem") not in REMOTE_SAFE_ACTIONS:
        blocked = True
    if blocked:
        raise ds.UserError(ds.L(
            "Bu sunucu güvenli modda: silme, kurulum, güncelleme ve temizlik kapalı. "
            "Açmak için Sistem → Bağlantılar'dan bu sunucuda “Tam kontrol”ü aç.",
            "This server is in safe mode: deleting, installing, updating and cleanup are off. "
            "To allow them, turn on “Full control” for this server in System → Connections."))


class Bridge:
    """pywebview bu nesnenin herkese açık metodlarını JavaScript'e açar."""

    def call(self, path, body=None):
        parsed = urlparse(str(path))
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        if isinstance(body, dict):
            params.update(body)
        route = ROUTES.get(parsed.path)
        if not route:
            return {"ok": False, "hata": ds.L("Bilinmeyen işlem.", "Unknown action.")}
        try:
            _safe_mode_guard(parsed.path, params)
            return {"ok": True, "veri": route(params)}
        except ds.UserError as e:
            return {"ok": False, "hata": str(e)}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "hata": ds.L(f"Beklenmeyen hata: {e}", f"Unexpected error: {e}")}


def mac_identity():
    """macOS'ta menü çubuğunda "Python" yerine uygulamanın adı, Dock'ta kendi ikonu görünsün."""
    if not ds.IS_MAC:
        return
    try:
        from AppKit import NSApplication, NSImage
        from Foundation import NSBundle

        info = NSBundle.mainBundle().infoDictionary()
        info["CFBundleName"] = "Basic Docker"
        info["CFBundleDisplayName"] = "Basic Docker"
        icon = NSImage.alloc().initWithContentsOfFile_(os.path.join(STATIC, "ikon.png"))
        if icon:
            NSApplication.sharedApplication().setApplicationIconImage_(icon)
    except Exception:
        pass  # sadece görünüş; olmazsa uygulama yine çalışır


def main():
    import webview

    parser = argparse.ArgumentParser(description="Basic Docker")
    parser.add_argument("--gelistirici", action="store_true", help="Web denetçisini aç (hata ayıklama)")
    args = parser.parse_args()

    mac_identity()
    rm.restore_app_context()  # son seçilen uzak sunucu (sadece uygulama için)
    monitor.start()
    rm.kill_orphans()
    # Oturum kapanırken gelen SIGTERM'de de arkada docker süreci kalmasın.
    signal.signal(signal.SIGTERM, lambda *_: (term.close_all(), rm.close_all(), monitor._kill_children(), os._exit(0)))
    atexit.register(term.close_all)

    webview.create_window(
        "Basic Docker",
        html=build_html(),
        js_api=Bridge(),
        width=1360,
        height=880,
        min_size=(480, 560),
    )
    webview.start(debug=args.gelistirici)


if __name__ == "__main__":
    main()
