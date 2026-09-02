# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the RiotSwitcher Python backend.

Produces a one-folder build in release/python/ containing main.exe plus all
bundled stdlib/third-party modules. electron-builder copies this folder into
the app's resources as resources/python so the packaged Electron app can spawn
the backend without a system Python install.

Build:  pyinstaller build/build-python.spec --noconfirm
"""
import os

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

ROOT = os.path.abspath(os.getcwd())
SRC = os.path.join(ROOT, "src", "backend")
OUT = os.path.join(ROOT, "release", "python")

hiddenimports = collect_submodules("cryptography")
datas = collect_data_files("cryptography")

a = Analysis(
    [os.path.join(SRC, "main.py")],
    pathex=[SRC],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest", "pydoc", "doctest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="main",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="python",
)
