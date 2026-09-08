#!/usr/bin/env python3
"""Validate all SIOPE refresh artifacts offline, including the shared release."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

for command in (
    ["scripts/etl/siope_nonmunicipal.py", "--check"],
    # The release gate already runs the full integrated dataset check internally.
    ["scripts/etl/integrated_source_release.py", "--check"],
    ["scripts/ci/source-snapshot-inventory.py", "--check"],
):
    subprocess.run([sys.executable, *command], cwd=ROOT, check=True)
