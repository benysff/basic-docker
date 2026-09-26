#!/usr/bin/env python3
"""Basic Docker — Docker uygulamalarını tek tuşla aç/kapat.

Native bir masaüstü penceresi açar (macOS'ta WKWebView). Sunucu, port ya da tarayıcı yoktur:
arayüz, Python fonksiyonlarını doğrudan `window.pywebview.api.call(...)` ile çağırır.

Kurmak için:  ./kur.command   (sonra Uygulamalar klasöründeki Basic Docker ile açılır)
Geliştirirken:  .venv/bin/python app.py --gelistirici
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import traceback
import webbrowser
from urllib.parse import parse_qs, urlparse

import webview

import catalog
import docker_service as ds

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")


def build_html():
    """index.html'i CSS ve JS gömülü olarak tek parça halinde hazırlar."""
    def read(name):
        with open(os.path.join(STATIC, name), encoding="utf-8") as f:
            return f.read()

    html = read("index.html")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{read('style.css')}\n</style>")
    html = html.replace('<script src="app.js"></script>', f"<script>\n{read('app.js')}\n</script>")
    return html


# ---------------------------------------------------------------------------
# Arayüzün çağırdığı uçlar. Her biri parametre sözlüğü alır, JSON'a çevrilebilir bir şey döndürür.
# ---------------------------------------------------------------------------

def api_state(p):
    snap = ds.snapshot()
    snap.pop("taken_ports", None)
    snap["jobs"] = ds.recent_jobs()
    snap["platform"] = {"mac": ds.IS_MAC}
    snap["ui"] = ds.load_settings()["arayuz"]
    return snap


def api_app(p):
    return {"is": ds.app_action(str(p.get("key", "")), str(p.get("islem", "")), bool(p.get("veriler"))).to_dict()}


def api_app_meta(p):
    key = str(p.get("key", ""))
    ds.get_app(key)  # var mı?
    ds.set_app_meta(key, name=p.get("ad"), note=p.get("not"))
    return {"tamam": True}


def api_container(p):
    job = ds.container_action(str(p.get("id", "")), str(p.get("islem", "")), bool(p.get("veriler")))
    return {"is": job.to_dict() if job else None}


def api_move(p):
    ds.move_container(str(p.get("id", "")), str(p.get("hedef", "")), str(p.get("yeni_ad", "")))
    return {"tamam": True}


def api_create(p):
    kind = p.get("tur")
    if kind == "sablon":
        job = ds.create_from_template(str(p.get("sablon", "")), str(p.get("uygulama", "")), str(p.get("yeni_ad", "")))
    elif kind == "ozel":
        job = ds.create_custom(
            str(p.get("imaj", "")), str(p.get("parca", "")), str(p.get("uygulama", "")), str(p.get("yeni_ad", "")),
            p.get("ic_kapi"), p.get("dis_kapi"), str(p.get("ayarlar", "")), str(p.get("veri", "")),
        )
    elif kind == "compose":
        job = ds.create_from_compose(str(p.get("yol", "")), str(p.get("proje", "")), str(p.get("ad", "")))
    else:
        raise ds.UserError("Bilinmeyen oluşturma türü.")
    return {"is": job.to_dict()}


def api_choose_folder(p):
    windows = webview.windows
    if not windows:
        return {"yol": None}
    result = windows[0].create_file_dialog(webview.FOLDER_DIALOG)
    return {"yol": result[0] if result else None}


def api_open_link(p):
    url = str(p.get("url", ""))
    if urlparse(url).scheme not in ("http", "https"):
        raise ds.UserError("Geçersiz bağlantı.")
    webbrowser.open(url)
    return {"tamam": True}


def api_copy(p):
    text = str(p.get("metin", ""))
    if ds.IS_MAC:
        subprocess.run(["pbcopy"], input=text, text=True, encoding="utf-8", check=False)
        return {"tamam": True}
    return {"tamam": False}  # arayüz kendi yöntemini dener


def api_ui_pref(p):
    ds.update_settings(lambda s: s["arayuz"].update({k: v for k, v in p.items() if k == "intro_kapali"}))
    return {"tamam": True}


def api_open_folder(p):
    ds.open_folder(str(p.get("key", "")))
    return {"tamam": True}


ROUTES = {
    "/api/durum": api_state,
    "/api/katalog": lambda p: {"katalog": catalog.public_catalog()},
    "/api/kayitlar": lambda p: {"metin": ds.logs(p.get("id", ""), p.get("satir", 400))},
    "/api/kaynak": lambda p: {"kaynak": ds.stats(p.get("key", ""))},
    "/api/is": lambda p: {"is": ds.get_job(p.get("id", ""))},
    "/api/compose-bilgi": lambda p: {"bilgi": ds.compose_info(p.get("yol", ""))},
    "/api/uygulama": api_app,
    "/api/uygulama/ayar": api_app_meta,
    "/api/parca": api_container,
    "/api/parca/tasi": api_move,
    "/api/olustur": api_create,
    "/api/klasor-sec": api_choose_folder,
    "/api/klasor-ac": api_open_folder,
    "/api/docker-ac": lambda p: {"mesaj": ds.start_docker_desktop()},
    "/api/link-ac": api_open_link,
    "/api/kopyala": api_copy,
    "/api/arayuz": api_ui_pref,
}


class Bridge:
    """pywebview bu nesnenin herkese açık metodlarını JavaScript'e açar."""

    def call(self, path, body=None):
        parsed = urlparse(str(path))
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        if isinstance(body, dict):
            params.update(body)
        route = ROUTES.get(parsed.path)
        if not route:
            return {"ok": False, "hata": "Bilinmeyen işlem."}
        try:
            return {"ok": True, "veri": route(params)}
        except ds.UserError as e:
            return {"ok": False, "hata": str(e)}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "hata": f"Beklenmeyen hata: {e}"}


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
    parser = argparse.ArgumentParser(description="Basic Docker")
    parser.add_argument("--gelistirici", action="store_true", help="Web denetçisini aç (hata ayıklama)")
    args = parser.parse_args()

    mac_identity()

    webview.create_window(
        "Basic Docker",
        html=build_html(),
        js_api=Bridge(),
        width=1280,
        height=860,
        min_size=(460, 560),
    )
    webview.start(debug=args.gelistirici)


if __name__ == "__main__":
    main()
