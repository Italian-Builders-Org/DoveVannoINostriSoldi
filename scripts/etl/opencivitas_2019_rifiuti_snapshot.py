#!/usr/bin/env python3
"""Pinned FC60RIFIUTI 2019 release — Rifiuti, not FC60TOT 2019 and not the 2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2019-rifiuti.source.json",
    output=Path("src/data/generated/opencivitas-2019-rifiuti.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="fcf7459c57a688b9ccb9a6027e0f3fb45d19a3b7b373b96b66d13a9cd6d3aa9c",
    function="RIFIUTI",
    family="FC60RIFIUTI",
    total_family="FC60TOT",
    scope="ordinary-statute-municipalities-waste-fc60-2019",
    label="Rifiuti",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
