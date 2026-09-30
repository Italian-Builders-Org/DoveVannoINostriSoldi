#!/usr/bin/env python3
"""Pinned FC50TERRVIAB 2018 release — Viabilità e territorio, not FC50TOT 2018 and not the 2019/2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2018-viabilita.source.json",
    output=Path("src/data/generated/opencivitas-2018-viabilita.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="bc5af979aacfde7eea49704f011c9c973a21568180e96a87a4a15a6503a312ed",
    function="TERR_VIAB",
    family="FC50TERRVIAB",
    total_family="FC50TOT",
    scope="ordinary-statute-municipalities-roads-fc50-2018",
    label="Viabilità e territorio",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
