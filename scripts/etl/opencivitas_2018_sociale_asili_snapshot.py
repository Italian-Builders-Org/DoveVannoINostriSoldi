#!/usr/bin/env python3
"""Pinned FC50SOCNID 2018 release — Sociale e asili nido, not FC50TOT 2018 and not the 2019/2021/2022 releases."""
from __future__ import annotations

from pathlib import Path

from opencivitas_function_release import FunctionRelease, main as release_main

RELEASE = FunctionRelease(
    spec_name="opencivitas-2018-sociale-asili.source.json",
    output=Path("src/data/generated/opencivitas-2018-sociale-asili.json"),
    # Fissato dopo il primo build verificato; --check vincola l'artifact immutabile.
    semantic_sha256="2cb0b2d0568980ac854695f68b72176de32c18528a71f893caa480fe2a727d98",
    function="SOCIALE E NIDO",
    family="FC50SOCNID",
    total_family="FC50TOT",
    scope="ordinary-statute-municipalities-social-nursery-fc50-2018",
    label="Sociale e asili nido",
)


if __name__ == "__main__":
    release_main(RELEASE, __doc__)
