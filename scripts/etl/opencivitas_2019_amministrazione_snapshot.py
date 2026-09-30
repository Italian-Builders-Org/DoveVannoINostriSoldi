#!/usr/bin/env python3
"""Pinned FC60AMMIN 2019 release — Amministrazione, not FC60TOT 2019 and not the 2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2019-amministrazione.source.json",
    output=Path("src/data/generated/opencivitas-2019-amministrazione.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="8f10c17c5b1ac0400e9693a10a1a757562eb8dfe1a29639ea6bf2d731e5fbe61",
    function="AMMINISTRAZIONE",
    family="FC60AMMIN",
    total_family="FC60TOT",
    scope="ordinary-statute-municipalities-administration-fc60-2019",
    label="Amministrazione",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
