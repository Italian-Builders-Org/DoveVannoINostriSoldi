#!/usr/bin/env python3
"""Render an existing local GTFS analysis without rescanning its source archives."""
import argparse
import json
from pathlib import Path

from analyze import safe_json, write_viewer
from basemap import load_map


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--basemap-cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(args.analysis.read_text())
    if (
        payload.get("schemaVersion") != 2
        or payload.get("metric") != "scheduled-segment-travel-time"
    ):
        raise ValueError("Unsupported analysis contract")
    for city in payload["cities"]:
        city["basemap"] = load_map(city, args.basemap_cache)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "analysis.json").write_text(safe_json(payload))
    write_viewer(payload, args.output)
    print("Wrote", args.output / "index.html")


if __name__ == "__main__":
    main()
