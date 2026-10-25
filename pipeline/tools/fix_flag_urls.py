#!/usr/bin/env python3
"""Resolve direct Wikimedia Commons SVG URLs for flags that the legacy config
points at dead pages or thumbnails, and patch config.json in place.

Uses the official Commons API (action=query&prop=imageinfo) to resolve each
candidate file title to its direct upload.wikimedia.org URL.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "config.json"

API = "https://commons.wikimedia.org/w/api.php"
UA = "top-github-users-flag-fixer/1.0 (+https://github.com/isyuricunha/top-github-users)"

# country slug -> candidate Commons file titles, first resolvable wins
CANDIDATES: dict[str, list[str]] = {
    "afghanistan": ["Flag of Afghanistan.svg"],
    "bangladesh": ["Flag of Bangladesh.svg"],
    "cuba": ["Flag of Cuba.svg"],
    "dominican_republic": ["Flag of the Dominican Republic.svg"],
    "ghana": ["Flag of Ghana.svg", "Ghana Flag.svg"],
    "honduras": ["Flag of Honduras.svg"],
    "spain": ["Flag of Spain.svg", "Bandera de España.svg"],
    "sri_lanka": ["Flag of Sri Lanka.svg"],
    "switzerland": ["Flag of Switzerland.svg"],
    "syria": ["Flag of Syria.svg"],
}


def resolve_title(title: str) -> str | None:
    params = {
        "action": "query",
        "titles": f"File:{title}",
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    }
    url = f"{API}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    for page in data["query"]["pages"].values():
        if "imageinfo" in page:
            info = page["imageinfo"][0]
            # strip tracking query params the API appends to the direct URL
            direct = info.get("url", "").split("?", 1)[0]
            if direct.endswith(".svg"):
                return direct
    return None


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    patched = 0
    failures: list[str] = []
    for location in config["locations"]:
        country = location["country"]
        slug = country.lower().replace(" ", "_")
        if slug not in CANDIDATES:
            continue
        resolved = None
        for candidate in CANDIDATES[slug]:
            resolved = resolve_title(candidate)
            if resolved is not None:
                break
        if resolved is None:
            failures.append(country)
            continue
        print(f"{country}: {location['imageUrl']} -> {resolved}")
        location["imageUrl"] = resolved
        patched += 1
    CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"patched {patched} entries")
    if failures:
        print(f"unresolved: {failures}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
