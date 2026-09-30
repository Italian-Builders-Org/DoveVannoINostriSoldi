#!/usr/bin/env python3
"""Pinned FC50RIFIUTI 2018 release — Rifiuti, not FC50TOT 2018 and not the 2019/2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2018-rifiuti.source.json",
    output=Path("src/data/generated/opencivitas-2018-rifiuti.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="b9b45fa236165db4f910b08d8fbee299e461b1d8972345f7f7a75645ee14bfe8",
    function="RIFIUTI",
    family="FC50RIFIUTI",
    total_family="FC50TOT",
    scope="ordinary-statute-municipalities-waste-fc50-2018",
    label="Rifiuti",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
