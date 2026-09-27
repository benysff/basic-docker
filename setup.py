"""macOS uygulama paketi (Basic Docker.app) üretimi. Doğrudan değil, ./kur.command üzerinden çalıştırılır."""
from setuptools import setup

setup(
    name="Basic Docker",
    app=["app.py"],
    options={
        "py2app": {
            "iconfile": "assets/BasicDocker.icns",
            "plist": {
                "CFBundleName": "Basic Docker",
                "CFBundleDisplayName": "Basic Docker",
                "CFBundleIdentifier": "io.github.benysff.basicdocker",
                "CFBundleShortVersionString": "2.0.0",
                "CFBundleVersion": "2.0.0",
                "LSMinimumSystemVersion": "11.0",
                "NSHighResolutionCapable": True,
                "NSHumanReadableCopyright": "MIT Lisansı",
            },
        }
    },
)
