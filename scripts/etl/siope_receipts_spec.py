"""Shared source vocabulary and artifact paths for SIOPE receipts."""
from __future__ import annotations

import json
from pathlib import Path

try:
    from . import siope_municipal_core as core
except ImportError:
    import siope_municipal_core as core

SPEC_PATH = Path(__file__).with_name("specs") / "siope-municipal-receipts.source.json"
SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
YEARS = tuple(SPEC["years"])
TITLE_LABELS = SPEC["titleLabels"]
OUTPUT_DIR = Path("src/data/generated")


def paths_for_year(year: int) -> tuple[Path, Path]:
    return (
        OUTPUT_DIR / f"siope-municipal-receipts-{year}.json",
        OUTPUT_DIR / f"siope-municipal-receipts-detail-{year}.json",
    )


def source_urls(year: int) -> dict[str, str]:
    return {
        "movements": f"{core.SIOPE_BASE}/SIOPE_ENTRATE.{year}.zip",
        "registry": f"{core.SIOPE_BASE}/{core.SIOPE_REGISTRY_FILE}",
        "ipa": core.IPA_ADMINISTRATIONS_URL,
    }


