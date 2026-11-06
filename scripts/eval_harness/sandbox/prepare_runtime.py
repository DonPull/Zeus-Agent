"""Prepare benchmark-only dependency metadata. Never installs or runs an installer.

Only Microsoft's public WebView2 page is queried in catalogue mode. Downloads
and a complete actor bundle are separate explicit operations, not implicit CI.
"""
import argparse
import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.request
import urllib.parse
import uuid
import time
import subprocess
import os
import shutil
import sys
import importlib.metadata

REPOSITORY = Path(__file__).resolve().parents[3]
DIRECTORY = REPOSITORY / ".zeus" / "evaluations" / "sandbox-runtime"
PAGE = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"


def safe_directory(directory):
    absolute = directory.absolute()
    for parent in [*reversed(absolute.parents), absolute]:
        if parent.exists() and (parent.is_symlink() or getattr(parent.stat(), "st_file_attributes", 0) & 0x400):
            raise ValueError("Refusing a linked runtime directory")
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def bounded_bytes(file, limit):
    stat = file.lstat()
    if not file.is_file() or file.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400 or stat.st_size > limit:
        raise ValueError("Expected a bounded, unlinked runtime file")
    with file.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Runtime file grew beyond its allowance")
    return data


def file_hash(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def owned_source(source, prefix):
    source = source.absolute()
    if source.parent != DIRECTORY.absolute() or not re.fullmatch(prefix + r"-[0-9a-f-]{36}", source.name):
        raise ValueError("Select an owned runtime " + prefix + " directory")
    return safe_directory(source)


def parse_catalogue(data):
    text = html.unescape(data.decode("utf-8")).replace("\\/", "/")
    # Extract embedded JSON as data. Never evaluate the site's JavaScript.
    for block in re.findall(r'<script\b[^>]*type=["\']application/json["\'][^>]*>(.*?)</script>', text, re.S | re.I):
        try:
            value = json.loads(block)
        except json.JSONDecodeError:
            continue
        text += "\n" + json.dumps(value, ensure_ascii=False).replace("\\/", "/")
    urls = set(re.findall(r'https://[^"<>\s]+Microsoft\.WebView2\.FixedVersionRuntime\.[0-9.]+\.x64\.cab(?=["<>\s]|$)', text))
    valid = []
    for url in urls:
        parsed = urllib.parse.urlparse(url)
        if (parsed.hostname == "msedge.sf.dl.delivery.mp.microsoft.com"
                and parsed.username is None and parsed.password is None and parsed.port is None
                and not parsed.query and not parsed.fragment
                and re.fullmatch(r"/filestreamingservice/files/[0-9a-f-]{36}/Microsoft\.WebView2\.FixedVersionRuntime\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.x64\.cab", parsed.path)):
            valid.append(url)
    return sorted(valid)


def catalogue(cached_page=None):
    if cached_page is not None:
        data = bounded_bytes(cached_page, 8 * 1024 * 1024)
    else:
        data = fetch_catalogue()
    cabinet_urls = parse_catalogue(data)
    destination = safe_directory(DIRECTORY / ("catalogue-" + str(uuid.uuid4())))
    (destination / "page.html").write_bytes(data)
    record = {"schema_version": 1, "queried_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "source": PAGE, "sha256": hashlib.sha256(data).hexdigest(),
              "x64_fixed_cabinets": cabinet_urls,
              "provider_requests": 0, "installers_executed": 0}
    (destination / "catalogue.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"directory": str(destination), **record}, indent=2))


def fetch_catalogue():
    request = urllib.request.Request(PAGE, headers={"User-Agent": "Zeus-Benchmark-runtime-preparation/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if urllib.parse.urlparse(response.url).hostname not in {"developer.microsoft.com", "www.microsoft.com"}:
            raise ValueError("Unexpected catalogue redirect")
        data = response.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("Catalogue exceeds its byte limit")
    return data


def download_cabinet(source, version):
    """Cache a selected official data cabinet. Do not expand or execute it."""
    source = owned_source(source, "catalogue")
    raw = bounded_bytes(source / "page.html", 8 * 1024 * 1024)
    record = json.loads(bounded_bytes(source / "catalogue.json", 65536))
    if record["source"] != PAGE or record["sha256"] != hashlib.sha256(raw).hexdigest():
        raise ValueError("Retained catalogue identity changed")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Specify an exact runtime version")
    suffix = "/Microsoft.WebView2.FixedVersionRuntime." + version + ".x64.cab"
    selected = [url for url in parse_catalogue(raw) if url.endswith(suffix)]
    if len(selected) != 1:
        raise ValueError("Selected version is not uniquely present in Microsoft's retained catalogue")
    destination = safe_directory(DIRECTORY / ("download-" + str(uuid.uuid4())))
    target = destination / "webview2.cab"
    started = time.monotonic()
    digest = hashlib.sha256()
    size = 0
    try:
        with urllib.request.urlopen(selected[0], timeout=30) as response:
            final = urllib.parse.urlparse(response.url)
            if final.scheme != "https" or final.hostname != "msedge.sf.dl.delivery.mp.microsoft.com":
                raise ValueError("Unexpected runtime download redirect")
            with target.open("xb") as output:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if size > 512 * 1024 * 1024 or time.monotonic() - started > 180:
                        raise ValueError("Runtime download exceeded its size/time allowance")
                    output.write(block)
                    digest.update(block)
        with target.open("rb") as stream:
            if stream.read(4) != b"MSCF":
                raise ValueError("Downloaded content is not a Microsoft Cabinet")
        result = {"schema_version": 1, "status": "cached-not-executed", "version": version, "architecture": "x64",
                  "source": selected[0], "catalogue_sha256": record["sha256"], "bytes": size,
                  "sha256": digest.hexdigest(), "provider_requests": 0, "installers_executed": 0}
    except Exception as error:
        (destination / "download-error.json").write_text(json.dumps({"status": "failed", "error": str(error), "bytes": size}), encoding="utf8")
        raise
    (destination / "download.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"directory": str(destination), **result}, indent=2))


def tree_inventory(root):
    files = []
    size = 0
    for file in sorted(root.rglob("*")):
        stat = file.lstat()
        if file.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400:
            raise ValueError("Runtime tree contains a reparse point")
        if file.is_dir():
            continue
        size += stat.st_size
        if not file.is_file() or stat.st_size > 600 * 1024 * 1024 or size > 2 * 1024**3 or len(files) >= 20000:
            raise ValueError("Runtime tree exceeds its file/size allowance")
        files.append({"path": file.relative_to(root).as_posix(), "bytes": stat.st_size, "sha256": file_hash(file)})
    return files


def stage_webview(source):
    """Expand only the pinned Microsoft cabinet; verify the executable as data."""
    source = owned_source(source, "download")
    record = json.loads(bounded_bytes(source / "download.json", 65536))
    cabinet = source / "webview2.cab"
    stat = cabinet.lstat()
    if (cabinet.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400
            or record["status"] != "cached-not-executed" or stat.st_size != record["bytes"]
            or stat.st_size > 512 * 1024 * 1024 or file_hash(cabinet) != record["sha256"]):
        raise ValueError("Cached runtime cabinet changed")
    if parse_catalogue(json.dumps([record["source"]]).encode()) != [record["source"]]:
        raise ValueError("Runtime source is not an allowed Microsoft cabinet route")
    destination = safe_directory(DIRECTORY / ("webview-" + str(uuid.uuid4())))
    expanded = safe_directory(destination / "expanded")
    with (destination / "expand.log").open("wb") as log:
        result = subprocess.run(["expand.exe", str(cabinet), "-F:*", str(expanded)], stdout=log, stderr=subprocess.STDOUT,
                                timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode != 0:
        raise ValueError("Microsoft cabinet expansion failed; see retained expand.log")
    inventory = tree_inventory(expanded)
    executables = list(expanded.rglob("msedgewebview2.exe"))
    if len(executables) != 1:
        raise ValueError("Expected exactly one fixed WebView2 runtime")
    environment = dict(os.environ, ZEUS_BENCH_SIGNATURE_TARGET=str(executables[0]))
    command = "$file=$env:ZEUS_BENCH_SIGNATURE_TARGET; $s=Get-AuthenticodeSignature -LiteralPath $file; [ordered]@{status=$s.Status.ToString();subject=$s.SignerCertificate.Subject;version=(Get-Item -LiteralPath $file).VersionInfo.ProductVersion} | ConvertTo-Json"
    verified = subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], env=environment, capture_output=True,
                              encoding="utf8", timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    signature = json.loads(verified.stdout)
    if verified.returncode != 0 or signature["status"] != "Valid" or "O=Microsoft Corporation" not in signature["subject"] or signature["version"] != record["version"]:
        raise ValueError("WebView2 signature/publisher/version verification failed")
    result = {"schema_version": 1, "status": "staged-not-executed", "version": record["version"],
              "cabinet_sha256": record["sha256"], "source": record["source"], "signature": signature,
              "runtime_relative": executables[0].parent.relative_to(destination).as_posix(),
              "files": inventory, "bytes": sum(item["bytes"] for item in inventory),
              "provider_requests": 0, "installers_executed": 0}
    (destination / "webview.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"directory": str(destination), "version": record["version"], "files": len(inventory),
                      "bytes": result["bytes"], "signature": signature, "installers_executed": 0}, indent=2))


def copy_public_tree(source, destination):
    """Copy a selected public dependency, rejecting links and skipping caches/tests."""
    safe_directory(source)
    safe_directory(destination)
    for file in sorted(source.iterdir()):
        if file.name in {"__pycache__", "test", "tests", "site-packages", "sitecustomize.py", "usercustomize.py",
                          ".git", ".npmrc", ".pypirc", ".env"} or file.suffix in {".pyc", ".pyo"}:
            continue
        stat = file.lstat()
        if file.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400:
            raise ValueError("Linked public dependency is not accepted")
        target = destination / file.name
        if file.is_dir():
            copy_public_tree(file, target)
        elif file.is_file():
            shutil.copyfile(file, target)
        else:
            raise ValueError("Non-regular dependency file")


def microsoft_crt():
    """Read only the three public app-local C++ runtime libraries we need."""
    source = Path(os.environ["SystemRoot"]) / "System32"
    names = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]
    files = [source / name for name in names]
    for file in files:
        bounded_bytes(file, 2 * 1024 * 1024)
    environment = dict(os.environ, ZEUS_BENCH_CRT_FILES=json.dumps([str(file) for file in files]))
    command = "$files=$env:ZEUS_BENCH_CRT_FILES | ConvertFrom-Json; @(foreach ($file in $files) { $s=Get-AuthenticodeSignature -LiteralPath $file; [ordered]@{name=[IO.Path]::GetFileName($file);status=$s.Status.ToString();subject=$s.SignerCertificate.Subject;version=(Get-Item -LiteralPath $file).VersionInfo.ProductVersion} }) | ConvertTo-Json"
    verified = subprocess.run(["powershell.exe", "-NoProfile", "-Command", command], env=environment,
                              capture_output=True, encoding="utf8", timeout=30,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    records = json.loads(verified.stdout)
    if (verified.returncode != 0 or len(records) != 3 or [row["name"] for row in records] != names
            or any(row["status"] != "Valid" or "O=Microsoft Corporation" not in row["subject"] for row in records)
            or len({row["version"] for row in records}) != 1):
        raise ValueError("Microsoft app-local C++ runtime signature/version verification failed: " + json.dumps(records))
    return files, records


def build_bundle(webview_source):
    """Stage public dependencies only. No credentials, user data or repository mapping."""
    webview_source = owned_source(webview_source, "webview")
    webview = json.loads(bounded_bytes(webview_source / "webview.json", 4 * 1024 * 1024))
    if webview["status"] != "staged-not-executed" or webview["signature"]["status"] != "Valid":
        raise ValueError("A publisher-verified fixed WebView2 runtime is required")
    relative = Path(webview["runtime_relative"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Invalid fixed-runtime directory")
    webview_root = safe_directory(webview_source / relative)
    for entry in webview["files"]:
        file = webview_source / "expanded" / entry["path"]
        if file_hash(file) != entry["sha256"]:
            raise ValueError("Staged fixed runtime changed")
    if sys.version_info[:2] != (3, 11):
        raise ValueError("Use the installed Python 3.11 runtime matching the pinned packages")
    site_source = REPOSITORY / ".zeus/browser-runtime/venv/Lib/site-packages"
    versions_found = {item.metadata["Name"].lower().replace("-", "_"): item.version
                      for item in importlib.metadata.distributions(path=[str(site_source)])}
    for name, wanted in {"playwright": "1.62.0", "pyee": "13.0.1", "greenlet": "3.5.4", "typing_extensions": "4.15.0"}.items():
        if versions_found.get(name) != wanted:
            raise ValueError("Pinned browser dependency mismatch: " + name)
    if json.loads((REPOSITORY / "node_modules/playwright-core/package.json").read_text(encoding="utf8"))["version"] != "1.62.0":
        raise ValueError("Pinned JavaScript browser SDK mismatch")
    root = safe_directory(DIRECTORY / ("bundle-" + str(uuid.uuid4())))
    runtime = safe_directory(root / "runtime")
    python_source = Path(sys.base_prefix)
    python_root = safe_directory(runtime / "browser" / "venv" / "Scripts")
    for name in ["python.exe", "python3.dll", "python311.dll", "LICENSE.txt"]:
        shutil.copyfile(python_source / name, python_root / name)
    crt_files, crt_records = microsoft_crt()
    for file in crt_files:
        shutil.copyfile(file, python_root / file.name)
    copy_public_tree(python_source / "Lib", python_root / "Lib")
    # A host installation can have private/global site packages. The generic
    # copier excludes them; add only the four pinned browser dependencies here.
    copy_public_tree(python_source / "DLLs", python_root / "DLLs")
    site_target = safe_directory(python_root / "Lib/site-packages")
    wanted = ["playwright", "playwright-1.62.0.dist-info", "pyee", "pyee-13.0.1.dist-info",
              "greenlet", "greenlet-3.5.4.dist-info", "typing_extensions.py", "typing_extensions-4.15.0.dist-info"]
    for name in wanted:
        source = site_source / name
        if source.is_dir():
            copy_public_tree(source, site_target / name)
        else:
            shutil.copyfile(source, site_target / name)
    copy_public_tree(REPOSITORY / ".zeus/browser-runtime/extensions/ubol-2026.1026.1812", runtime / "browser/extensions/ubol-2026.1026.1812")
    browsers = json.loads((site_source / "playwright/driver/package/browsers.json").read_text(encoding="utf8"))
    chromium = next(item for item in browsers["browsers"] if item["name"] == "chromium")
    chromium_folder = "chromium-" + chromium["revision"]
    copy_public_tree(Path(os.environ["LOCALAPPDATA"]) / "ms-playwright" / chromium_folder, runtime / "browsers" / chromium_folder)
    node = Path(shutil.which("node.exe") or "")
    if not node.is_file():
        raise ValueError("A prepared Node runtime is required")
    safe_directory(runtime / "node")
    shutil.copyfile(node, runtime / "node/node.exe")
    if (node.parent / "LICENSE").is_file():
        shutil.copyfile(node.parent / "LICENSE", runtime / "node/LICENSE")
    copy_public_tree(REPOSITORY / "node_modules/playwright-core", runtime / "node_modules/playwright-core")
    copy_public_tree(webview_root, runtime / "webview")
    safe_directory(runtime / "app")
    for name in ["zeus-evaluation.exe"]:
        shutil.copyfile(REPOSITORY / "src-tauri/target/debug" / name, runtime / "app" / name)
    for file in crt_files:
        shutil.copyfile(file, runtime / "app" / file.name)
    copy_public_tree(REPOSITORY / "dist", runtime / "frontend")
    inventory = tree_inventory(runtime)
    versions = {"python": sys.version.split()[0], "node": subprocess.check_output([str(node), "--version"], text=True).strip(),
                "playwright": "1.62.0", "chromium": chromium["browserVersion"], "chromium_revision": chromium["revision"],
                "webview2": webview["version"], "microsoft_crt": crt_records[0]["version"]}
    record = {"schema_version": 1, "kind": "public-sandbox-runtime-bundle", "status": "staged-unproven",
              "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "versions": versions,
              "files": inventory, "content_sha256": hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest(),
              "bytes": sum(item["bytes"] for item in inventory), "credentials_included": False,
              "provider_requests": 0, "host_installers_executed": 0, "microsoft_crt_signatures": crt_records}
    (root / "bundle.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"directory": str(root), "versions": versions, "files": len(inventory), "bytes": record["bytes"],
                      "content_sha256": record["content_sha256"], "status": record["status"]}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--catalogue", action="store_true", help="Read and retain Microsoft's public runtime metadata")
    modes.add_argument("--catalogue-from", type=Path, help="Parse already retained catalogue HTML without network access")
    modes.add_argument("--download-cabinet", type=Path, help="Cache one selected Microsoft cabinet from a retained catalogue")
    modes.add_argument("--stage-webview", type=Path, help="Expand a hash-checked Microsoft cabinet and verify its publisher")
    modes.add_argument("--build-bundle", type=Path, help="Stage public guest dependencies using a verified WebView2 directory")
    parser.add_argument("--version", help="Exact four-part x64 WebView2 version; no automatic version choice")
    args = parser.parse_args()
    if args.build_bundle:
        build_bundle(args.build_bundle)
    elif args.stage_webview:
        stage_webview(args.stage_webview)
    elif args.download_cabinet:
        if not args.version:
            parser.error("--download-cabinet requires --version")
        download_cabinet(args.download_cabinet, args.version)
    elif args.catalogue or args.catalogue_from:
        catalogue(args.catalogue_from)
    else:
        print(json.dumps({"mode": "plan", "machine_changes": False, "network_requests": 0,
                          "next": "Pin a Microsoft Fixed Version WebView2 runtime before bundling the guest dependencies."}))


if __name__ == "__main__":
    main()
