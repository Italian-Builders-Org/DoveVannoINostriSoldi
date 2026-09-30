#!/usr/bin/env python3
"""Pinned FC60POLIZIA 2019 release — Polizia locale, not FC60TOT 2019 and not the 2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2019-polizia.source.json",
    output=Path("src/data/generated/opencivitas-2019-polizia.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="44b9fbf5d3f3a0aa272c5cb5268180a1a973a87bc712110c1319938ec4619531",
    function="POLIZIA",
    family="FC60POLIZIA",
    scope="ordinary-statute-municipalities-local-police-fc60-2019",
    label="Polizia locale",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
