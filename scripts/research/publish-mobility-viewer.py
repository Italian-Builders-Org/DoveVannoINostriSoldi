#!/usr/bin/env python3
"""Copy a rendered GTFS explorer directory into public/ for static delivery."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "research/trasporti-gtfs/output"
DEFAULT_TARGET = ROOT / "public/mappe/mobilita/explorer"


def publish(source: Path, target: Path) -> None:
    index = source / "index.html"
    if not index.is_file():
        raise SystemExit(f"Missing rendered viewer: {index}")
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("analysis.json", "analysis.json.gz"))
    for leftover in ("analysis.json", "analysis.json.gz"):
        path = target / leftover
        if path.exists():
            path.unlink()
    print(f"Published {index} -> {target / 'index.html'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    args = parser.parse_args()
    publish(args.source.resolve(), args.target.resolve())


if __name__ == "__main__":
    main()
