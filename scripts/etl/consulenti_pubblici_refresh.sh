#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PY="${PYTHON_BIN:-}"
if [[ -z "$PY" ]]; then
  if command -v python >/dev/null 2>&1; then
    PY=python
  else
    PY=python3
  fi
fi
"$PY" scripts/etl/consulenti_snapshot.py
"$PY" scripts/etl/consulenti_regionali_snapshot.py
