#!/usr/bin/env python3
"""Pinned FC60SOCNID 2019 release — Sociale e asili nido, not FC60TOT 2019 and not the 2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2019-sociale-asili.source.json",
    output=Path("src/data/generated/opencivitas-2019-sociale-asili.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="7db8d7a8d4cad001593c465b181346f7227637c14b9b66afe9adbf2cb3239c32",
    function="SOCIALE E NIDO",
    family="FC60SOCNID",
    scope="ordinary-statute-municipalities-social-nursery-fc60-2019",
    label="Sociale e asili nido",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
