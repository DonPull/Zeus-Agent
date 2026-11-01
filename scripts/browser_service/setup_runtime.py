"""Explicit, separately invoked setup. Never imported/run by the application."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import venv
import urllib.request
import zipfile

UBOL_VERSION = '2026.1026.1812'
UBOL_SHA256 = 'd3788eac9f0a44c67f3745a43c3fd446ef33d56b1121f469b19e0fa0a836c2b5'


def install_extensions(runtime):
    """Pinned upstream release, no automatic app-time downloads or updates."""
    url = f'https://github.com/uBlockOrigin/uBOL-home/releases/download/{UBOL_VERSION}/uBOLite_{UBOL_VERSION}.chromium.zip'
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(20 * 1024 * 1024 + 1)
    if hashlib.sha256(data).hexdigest() != UBOL_SHA256:
        raise SystemExit('uBO Lite release hash mismatch; nothing installed')
    destination = runtime.parent / 'extensions' / f'ubol-{UBOL_VERSION}'
    destination.mkdir(parents=True, exist_ok=True)
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sum(item.file_size for item in archive.infolist()) > 80 * 1024 * 1024:
            raise SystemExit('Extension exceeds unpacked size limit')
        for item in archive.infolist():
            name = item.filename
            target = (destination / name).resolve()
            if '\\' in name or not target.is_relative_to(destination.resolve()) or target == destination.resolve():
                raise SystemExit('Unsafe extension archive path')
            if item.is_dir():
                continue
            payload = archive.read(item)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            files[name] = hashlib.sha256(payload).hexdigest()
    (destination / 'zeus-integrity.json').write_text(json.dumps({'version': UBOL_VERSION, 'archive_sha256': UBOL_SHA256, 'source': url, 'files': files}, indent=2), encoding='utf8')
    print(f'Verified uBO Lite {UBOL_VERSION}: {destination}')

parser = argparse.ArgumentParser()
parser.add_argument("--destination", type=Path, required=True)
parser.add_argument("--install", action="store_true", help="Explicitly create a venv and install the pinned packages")
parser.add_argument('--extensions', action='store_true', help='Explicitly install the pinned official uBO Lite release')
args = parser.parse_args()
root = args.destination.resolve()
python = root / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if args.install:
    if root.exists() and not (root / "pyvenv.cfg").is_file():
        raise SystemExit("Refusing to reuse a directory that is not an existing browser venv")
    if not python.is_file():
        venv.EnvBuilder(with_pip=True).create(root)
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(Path(__file__).with_name("requirements.txt"))], check=True)
if not python.is_file():
    raise SystemExit("Browser runtime missing. Run this setup explicitly with --install.")
subprocess.run([str(python), "-I", "-c", "import importlib.metadata as m; assert m.version('playwright') == '1.62.0'; print('Managed browser SDK verified: '+m.version('playwright'))"], check=True)
if args.extensions:
    install_extensions(root)
print(f"ZEUS_BROWSER_PYTHON={python}")
print("If the matching Chromium is missing, explicitly run this interpreter with: -m playwright install chromium")
