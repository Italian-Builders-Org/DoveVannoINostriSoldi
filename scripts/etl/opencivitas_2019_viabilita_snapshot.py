#!/usr/bin/env python3
"""Pinned FC60TERRVIAB 2019 release — Viabilità e territorio, not FC60TOT 2019 and not the 2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2019-viabilita.source.json",
    output=Path("src/data/generated/opencivitas-2019-viabilita.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="75a18b66e17f4cf12726fb0a09edb4d91f36ca83c8534ebbe03beb618b48f841",
    function="TERR_VIAB",
    family="FC60TERRVIAB",
    scope="ordinary-statute-municipalities-roads-fc60-2019",
    label="Viabilità e territorio",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
