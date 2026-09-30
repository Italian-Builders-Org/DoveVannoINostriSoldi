#!/usr/bin/env python3
"""Pinned FC50POLIZIA 2018 release — Polizia locale, not FC50TOT 2018 and not the 2019/2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2018-polizia.source.json",
    output=Path("src/data/generated/opencivitas-2018-polizia.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="ef262ebb908fc6256753d4e8f4b7dfcbfa91572a48cef4fa2cff7cbfb8cf2669",
    function="POLIZIA",
    family="FC50POLIZIA",
    total_family="FC50TOT",
    scope="ordinary-statute-municipalities-local-police-fc50-2018",
    label="Polizia locale",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
