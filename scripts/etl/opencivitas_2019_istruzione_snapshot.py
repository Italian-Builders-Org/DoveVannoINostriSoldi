#!/usr/bin/env python3
"""Pinned FC60ISTRUZ 2019 release — Istruzione, not FC60TOT 2019 and not the 2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2019-istruzione.source.json",
    output=Path("src/data/generated/opencivitas-2019-istruzione.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="043a06ed2526a8639a37368d286ed5f03f424b56aad00e4c5f8d40d07c8072f3",
    function="ISTRUZIONE",
    family="FC60ISTRUZ",
    scope="ordinary-statute-municipalities-education-fc60-2019",
    label="Istruzione",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
