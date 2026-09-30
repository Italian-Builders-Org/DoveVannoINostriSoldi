#!/usr/bin/env python3
"""Pinned FC50AMMIN 2018 release — Amministrazione, not FC50TOT 2018 and not the 2019/2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2018-amministrazione.source.json",
    output=Path("src/data/generated/opencivitas-2018-amministrazione.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="fafd7089b70411bdee79a0e786a4c2fc772f014458292378c6a1ed3a6c6ac56d",
    function="AMMINISTRAZIONE",
    family="FC50AMMIN",
    total_family="FC50TOT",
    scope="ordinary-statute-municipalities-administration-fc50-2018",
    label="Amministrazione",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
