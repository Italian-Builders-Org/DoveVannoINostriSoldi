#!/usr/bin/env python3
"""Pinned FC50ISTRUZ 2018 release — Istruzione, not FC50TOT 2018 and not the 2019/2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2018-istruzione.source.json",
    output=Path("src/data/generated/opencivitas-2018-istruzione.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="7d9e1c23654dfe808851aa6b6dc3c9d3273d9a5bad7ba544b8764f8b60148e43",
    function="ISTRUZIONE",
    family="FC50ISTRUZ",
    total_family="FC50TOT",
    scope="ordinary-statute-municipalities-education-fc50-2018",
    label="Istruzione",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
