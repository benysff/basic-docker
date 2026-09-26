#!/bin/bash
# Basic Docker kurulumu (macOS). Çift tıkla ya da terminalde ./kur.command çalıştır.
# Gerekenleri bu klasördeki .venv'e kurar, "Basic Docker.app" üretir ve Uygulamalar klasörüne koyar.
# Bu klasörü taşırsan ya da güncellersen (git pull) tekrar çalıştır.
set -e
cd "$(dirname "$0")"
echo "▸ Basic Docker kuruluyor…"

if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ Python 3 bulunamadı. Terminalde şunu çalıştır, sonra tekrar dene:  xcode-select --install"
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 && [ ! -x /usr/local/bin/docker ]; then
  echo "! Docker bulunamadı. Uygulama açılır ama önce Docker Desktop'ı kurman gerekecek:"
  echo "  https://www.docker.com/products/docker-desktop/"
fi

[ -x .venv/bin/python ] || python3 -m venv .venv
echo "▸ Paketler kuruluyor (ilk seferde 1-2 dakika)…"
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt

echo "▸ Uygulama paketi hazırlanıyor…"
rm -rf build dist
LOG="$(mktemp)"
if ! .venv/bin/python setup.py -q py2app -A >"$LOG" 2>&1; then
  cat "$LOG"; echo "✗ Uygulama paketi oluşturulamadı."; exit 1
fi
rm -rf build "$LOG"

# /Applications yazılabilirse oraya, değilse ~/Applications'a koy.
TARGET="/Applications"
[ -w "$TARGET" ] || { TARGET="$HOME/Applications"; mkdir -p "$TARGET"; }
rm -rf "$TARGET/Basic Docker.app"
mv "dist/Basic Docker.app" "$TARGET/"
rmdir dist 2>/dev/null || true

echo "✓ Hazır: $TARGET/Basic Docker.app"
echo "  Launchpad'den ya da Spotlight'tan (⌘ + boşluk → Basic Docker) açabilirsin."
open "$TARGET/Basic Docker.app"
