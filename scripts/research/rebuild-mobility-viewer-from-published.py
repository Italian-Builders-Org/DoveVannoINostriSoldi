#!/usr/bin/env python3
"""Rebuild explorer/index.html from published cities/*.json.gz + research sources."""

from __future__ import annotations

import gzip
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research/trasporti-gtfs"
PUBLISHED = ROOT / "public/mappe/mobilita/explorer"
OUTPUT = RESEARCH / "output"

sys.path.insert(0, str(RESEARCH))
from analyze import write_viewer  # noqa: E402


def load_published_payload(published: Path) -> dict:
    index = published / "index.html"
    text = index.read_text(encoding="utf-8")
    marker = '<script id="data" type="application/json">'
    start = text.index(marker) + len(marker)
    end = text.index("</script>", start)
    manifest = json.loads(text[start:end])
    cities = []
    for entry in manifest["cities"]:
        asset = entry.get("asset")
        if not asset:
            raise SystemExit(f"Missing asset for {entry.get('id')}")
        path = published / asset["path"]
        cities.append(json.loads(gzip.decompress(path.read_bytes())))
    payload = {k: v for k, v in manifest.items() if k != "cities"}
    payload["cities"] = cities
    return payload


def publish(source: Path, target: Path) -> None:
    index = source / "index.html"
    if not index.is_file():
        raise SystemExit(f"Missing rendered viewer: {index}")
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns("analysis.json", "analysis.json.gz"),
    )
    for leftover in ("analysis.json", "analysis.json.gz"):
        path = target / leftover
        if path.exists():
            path.unlink()
    print(f"Published {index} -> {target / 'index.html'}")


def main() -> None:
    payload = load_published_payload(PUBLISHED)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_viewer(payload, OUTPUT, standalone=False)
    publish(OUTPUT, PUBLISHED)


if __name__ == "__main__":
    main()
