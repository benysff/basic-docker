# -*- mode: python ; coding: utf-8 -*-
# İndirilebilir sürüm paketi (PyInstaller). Python'u içinde taşır; kullanıcının Python kurmasına gerek yok.
#   macOS  : dist/Basic Docker.app
#   Windows: dist/Basic Docker/Basic Docker.exe
# Çalıştırma: pyinstaller --noconfirm basic-docker.spec   (GitHub Actions'ta .github/workflows/surum.yml yapar)
# Kaynaktan kurulum için bu dosya gerekmez; orada ./kur.command kullanılır.
import re
import sys

from PyInstaller.utils.hooks import collect_all

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform.startswith("win")
VERSION = re.search(r'^VERSION = "([^"]+)"', open("app.py", encoding="utf-8").read(), re.M).group(1)

datas = [("static", "static")]
binaries = []
hiddenimports = []
if IS_WIN:
    # Uygulama içi terminal (ConPTY); yerel DLL'leriyle birlikte alınmalı.
    d, b, h = collect_all("winpty")
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["app.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "py2app"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    # Windows'ta Python UTF-8 kipinde çalışsın (varsayılan cp1252 Türkçe çıktıyı bozar).
    [("X utf8", None, "OPTION")] if IS_WIN else [],
    exclude_binaries=True,
    name="Basic Docker",
    console=False,
    icon="assets/BasicDocker.icns" if IS_MAC else "assets/BasicDocker.ico",
)
coll = COLLECT(exe, a.binaries, a.datas, name="Basic Docker")

if IS_MAC:
    app = BUNDLE(
        coll,
        name="Basic Docker.app",
        icon="assets/BasicDocker.icns",
        bundle_identifier="io.github.benysff.basicdocker",
        version=VERSION,
        info_plist={
            "CFBundleName": "Basic Docker",
            "CFBundleDisplayName": "Basic Docker",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "LSMinimumSystemVersion": "11.0",
            "NSHighResolutionCapable": True,
            "NSHumanReadableCopyright": "MIT Lisansı",
        },
    )
