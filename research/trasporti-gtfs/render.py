#!/usr/bin/env python3
"""Render an existing local GTFS analysis without rescanning its source archives."""
import argparse
import json
import gzip
from pathlib import Path

from analyze import safe_json, write_viewer
from artifact_io import write_artifact
from basemap import load_map


MAX_ANALYSIS_BYTES = 256 * 1024**2


def read_analysis(path, max_bytes=MAX_ANALYSIS_BYTES):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as stream:
        raw = stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError("Expanded analysis byte budget exceeded")
    return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--basemap-cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--standalone", action="store_true", help="Embed every city for offline use"
    )
    args = parser.parse_args()
    payload = read_analysis(args.analysis)
    if (
        payload.get("schemaVersion") not in (2, 3)
        or payload.get("metric") != "scheduled-segment-travel-time"
    ):
        raise ValueError("Unsupported analysis contract")
    for city in payload["cities"]:
        city["basemap"] = load_map(city, args.basemap_cache)
    args.output.mkdir(parents=True, exist_ok=True)
    raw = safe_json(payload).encode()
    if args.analysis.suffix == ".gz":
        write_artifact(args.output / "analysis.json.gz", gzip.compress(raw, mtime=0))
    else:
        write_artifact(args.output / "analysis.json", raw)
    write_viewer(payload, args.output, standalone=args.standalone)
    print("Wrote", args.output / "index.html")


if __name__ == "__main__":
    main()
