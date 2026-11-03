#!/usr/bin/env python3
"""Acquire official GTFS archives once, retaining original bytes and SHA-256 receipts."""
import argparse
import concurrent.futures
import hashlib
import json
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from analyze import Archive, archive_id

MAX_BYTES = 256 * 1024 * 1024


def redirect_allowed(source, final_url):
    """HTTPS only, on the official host or a host declared in the registry."""
    final = urllib.parse.urlparse(final_url)
    hosts = {urllib.parse.urlparse(source["url"]).hostname}
    hosts.update(source.get("allowedRedirectHosts", []))
    return final.scheme == "https" and final.hostname in hosts


def acquire(source, cache, refresh=False):
    destination = cache / (archive_id(source) + ".zip")
    receipt_path = cache / (archive_id(source) + ".receipt.json")
    if destination.exists() and receipt_path.exists() and not refresh:
        receipt = json.loads(receipt_path.read_text())
        with destination.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if (
            digest != receipt["sha256"]
            or destination.stat().st_size != receipt["bytes"]
        ):
            raise ValueError("Cached archive fails its receipt: " + source["id"])
        if receipt["url"] != source["url"]:
            raise ValueError("Cached receipt belongs to a different source URL")
        return {"city": source["id"], "status": "verified-cache", "sha256": digest}
    request = urllib.request.Request(
        source["url"], headers={"User-Agent": "DVNS-GTFS-research/1.0"}
    )
    temporary = None
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            if not redirect_allowed(source, response.url):
                raise ValueError("Unexpected redirect outside official HTTPS host")
            with tempfile.NamedTemporaryFile(
                dir=cache, suffix=".partial", delete=False
            ) as stream:
                temporary = Path(stream.name)
                size, digest = 0, hashlib.sha256()
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("Compressed archive byte budget exceeded")
                    digest.update(chunk)
                    stream.write(chunk)
            receipt = {
                "city": source["id"],
                "url": source["url"],
                "finalUrl": response.url,
                "acquiredAt": datetime.now(timezone.utc).isoformat(),
                "bytes": size,
                "sha256": digest.hexdigest(),
                "lastModified": response.headers.get("Last-Modified"),
                "contentType": response.headers.get("Content-Type"),
            }
        with Archive(temporary):
            pass
        temporary.replace(destination)
        receipt_path.write_text(json.dumps(receipt, indent=2))
        return {"city": source["id"], "status": "acquired", **receipt}
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def unique_archives(sources):
    archives = {}
    for source in sources:
        key = archive_id(source)
        if key in archives and archives[key]["url"] != source["url"]:
            raise ValueError("Shared archive has conflicting URLs: " + key)
        archives.setdefault(key, source)
    return list(archives.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Explicitly replace the cached feed with a new version",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        help="Limit to these dataset IDs (repeatable); others are not touched",
    )
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    sources = json.loads((Path(__file__).parent / "feeds.json").read_text())
    if args.only:
        unknown = set(args.only) - {s["id"] for s in sources}
        if unknown:
            raise ValueError("Unknown dataset: " + ", ".join(sorted(unknown)))
        sources = [s for s in sources if s["id"] in args.only]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(
            lambda source: acquire(source, args.cache, args.refresh),
            unique_archives(sources),
        ):
            print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
