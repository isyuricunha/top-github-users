#!/usr/bin/env python3
"""Download the flag SVG for every configured country into the site's public
directory, so the site self-hosts flags instead of hotlinking Wikimedia.

Run from anywhere: paths are resolved against the repository root two levels
above this file. Safe to re-run; existing files are overwritten.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "config.json"
OUT_DIR = REPO_ROOT / "site" / "public" / "flags"

UA = "top-github-users-flag-fetcher/1.0 (+https://github.com/isyuricunha/top-github-users)"


def slugify(country: str) -> str:
    return country.lower().replace(" ", "_")


def encode_url(url: str) -> str:
    """Percent-encode the URL path without double-encoding existing escapes."""
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/")
    return urllib.parse.urlunsplit(parts._replace(path=path))


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    for location in config["locations"]:
        country = location["country"]
        url = encode_url(location["imageUrl"])
        target = OUT_DIR / f"{slugify(country)}.svg"
        payload: bytes | None = None
        for attempt, delay in enumerate((0, 2, 8)):
            if delay:
                time.sleep(delay)
            try:
                request = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = response.read()
                if b"<svg" not in payload[:1024]:
                    raise ValueError("response is not an SVG document")
                break
            except Exception as error:  # noqa: BLE001 - retry, then report
                payload = None
                if attempt == 2:
                    failures.append(f"{country}: {error}")
                    print(f"FAILED {country}: {error}", file=sys.stderr)
        if payload is not None:
            target.write_bytes(payload)
            print(f"ok {country} -> {target.name} ({len(payload)} bytes)")
        time.sleep(0.5)
    if failures:
        print(f"{len(failures)} failures", file=sys.stderr)
        return 1
    print(f"downloaded {len(config['locations'])} flags")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
