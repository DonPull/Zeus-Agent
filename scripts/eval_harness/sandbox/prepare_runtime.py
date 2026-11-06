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
        data = cached_page.read_bytes()
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("Catalogue exceeds its byte limit")
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", action="store_true", help="Read and retain Microsoft's public runtime metadata")
    parser.add_argument("--catalogue-from", type=Path, help="Parse already retained catalogue HTML without network access")
    args = parser.parse_args()
    if args.catalogue or args.catalogue_from:
        catalogue(args.catalogue_from)
    else:
        print(json.dumps({"mode": "plan", "machine_changes": False, "network_requests": 0,
                          "next": "Pin a Microsoft Fixed Version WebView2 runtime before bundling the guest dependencies."}))


if __name__ == "__main__":
    main()
