"""Explicit, separately invoked setup. Never imported/run by the application."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import venv

parser = argparse.ArgumentParser()
parser.add_argument("--destination", type=Path, required=True)
parser.add_argument("--install", action="store_true", help="Explicitly create a venv and install the pinned packages")
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
print(f"ZEUS_BROWSER_PYTHON={python}")
print("If the matching Chromium is missing, explicitly run this interpreter with: -m playwright install chromium")
