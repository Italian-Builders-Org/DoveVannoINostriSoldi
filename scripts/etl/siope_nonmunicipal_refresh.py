#!/usr/bin/env python3
"""Acquire one bounded SIOPE release and prepare its fully validated PR artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

import siope_nonmunicipal as etl
import siope_nonmunicipal_corpus as corpus
from siope_nonmunicipal_contract import DATASET_IDS, load_manifest

ROOT = Path(__file__).resolve().parents[2]
MIB = 1024 * 1024
LIMITS = {name: (160 if name.startswith("SIOPE_USCITE") else 32) * MIB for name in etl.CANONICAL_INPUT_URLS}
TOTAL_LIMIT = 512 * MIB
EXPANDED_LIMIT = 3 * 1024 * MIB
DOWNLOAD_SECONDS = 12 * 60


class RefreshError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RefreshError("Official source redirected; review the canonical URL before refresh")


def download_inputs(directory: Path, *, opener=None, clock=time.monotonic) -> dict:
    opener = opener or urllib.request.build_opener(NoRedirect())
    acquired_at = etl.core.utc_now()
    deadline = clock() + DOWNLOAD_SECONDS
    receipt = {"schemaVersion": 1, "scope": "non-municipal-payments-inputs", "files": {}}
    total = 0
    for name, url in etl.CANONICAL_INPUT_URLS.items():
        if clock() >= deadline:
            raise RefreshError("SIOPE download deadline exceeded")
        request = urllib.request.Request(url, headers={"User-Agent": etl.core.USER_AGENT, "Accept-Encoding": "identity"})
        with opener.open(request, timeout=30) as response:
            if response.status != 200 or response.geturl() != url or response.headers.get("Content-Encoding", "identity") != "identity":
                raise RefreshError(f"Unexpected official response for {name}")
            length = response.headers.get("Content-Length")
            if length is not None and (not length.isdecimal() or not 0 < int(length) <= min(LIMITS[name], TOTAL_LIMIT - total)):
                raise RefreshError(f"Download size limit exceeded for {name}")
            digest = hashlib.sha256()
            size = 0
            with (directory / name).open("xb") as target:
                while True:
                    chunk = response.read(MIB)
                    if not chunk:
                        break
                    size += len(chunk)
                    total += len(chunk)
                    if size > LIMITS[name] or total > TOTAL_LIMIT or clock() >= deadline:
                        raise RefreshError(f"Download budget exceeded for {name}")
                    target.write(chunk)
                    digest.update(chunk)
            if size == 0 or (length is not None and size != int(length)):
                raise RefreshError(f"Incomplete download for {name}")
            receipt["files"][name] = {"url": url, "bytes": size, "sha256": digest.hexdigest(), "acquisitionDate": acquired_at, "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified")}
    etl.validate_input_receipt_metadata(receipt, acquired_at)
    return receipt


def validate_archives(directory: Path) -> None:
    expanded = 0
    for name in etl.CANONICAL_INPUT_URLS:
        if not name.endswith(".zip"):
            continue
        with zipfile.ZipFile(directory / name) as archive:
            members = archive.infolist()
            if len(members) > 100 or len({item.filename for item in members}) != len(members):
                raise RefreshError("Unexpected SIOPE ZIP member set")
            for item in members:
                expanded += item.file_size
                if item.flag_bits & 1 or item.file_size < 0 or expanded > EXPANDED_LIMIT:
                    raise RefreshError("SIOPE expanded ZIP budget exceeded")


def same_inputs(receipt: dict, previous: dict) -> bool:
    return all(receipt["files"][name][key] == previous["files"][name][key] for name in etl.CANONICAL_INPUT_URLS for key in ("url", "bytes", "sha256"))


def refresh(*, opener=None) -> str:
    previous = load_manifest()
    # Check the old product before contacting upstream or touching its artifacts.
    etl.validate_committed_detail()
    if shutil.disk_usage(tempfile.gettempdir()).free < 2 * 1024 * MIB:
        raise RefreshError("At least 2 GiB free staging space is required")
    with tempfile.TemporaryDirectory(prefix="dvns-siope-nonmunicipal-") as temporary:
        staging = Path(temporary)
        inputs = staging / "inputs"
        inputs.mkdir()
        receipt = download_inputs(inputs, opener=opener)
        if same_inputs(receipt, previous["inputReceipt"]):
            return "NO_CHANGE"
        validate_archives(inputs)
        receipt_path = staging / "input-receipt.json"
        receipt_path.write_bytes(etl.canonical_json(receipt) + b"\n")
        candidate = staging / "candidate"
        etl.build_release(input_dir=inputs, input_receipt=receipt_path, output_dir=candidate, acquired_at=next(iter(receipt["files"].values()))["acquisitionDate"])
        corpus.append(
            spec_path=ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json", source_root=candidate,
            dataset_ids=set(DATASET_IDS), catalog_path=ROOT / etl.DEFAULT_CATALOG_PATH,
            rows_dir=ROOT / etl.DEFAULT_ROWS_DIR, receipts_dir=ROOT / etl.DEFAULT_RECEIPTS_DIR,
            proof_path=ROOT / etl.DEFAULT_DATASET_PROOF_PATH,
            candidate_detail_path=candidate / "siope-nonmunicipal-detail.json",
            candidate_manifest_path=candidate / "siope-nonmunicipal-release.json",
            detail_path=ROOT / etl.DEFAULT_DETAIL_PATH, view_proof_path=ROOT / etl.DEFAULT_VIEW_PROOF_PATH,
            release_proof_path=ROOT / etl.DEFAULT_RELEASE_PROOF_PATH,
        )
    subprocess.run([sys.executable, "scripts/ci/source-snapshot-inventory.py", "--write"], cwd=ROOT, check=True)
    return "REFRESHED"


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    print(json.dumps({"status": refresh()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
