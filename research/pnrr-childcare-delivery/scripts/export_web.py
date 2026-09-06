#!/usr/bin/env python3
"""Export a frozen, aggregate-only capsule and versioned public assets."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = Path(__file__).resolve().parents[1]
TARGET = ROOT / "public/studi/dai-fondi-ai-posti/v1.2"
CAPSULE = ROOT / "src/content/studies/childcare.json"


def main():
    summary = json.loads((RESEARCH / "generated/analysis_summary.json").read_text())
    robustness = json.loads((RESEARCH / "generated/robustness_summary.json").read_text())
    TARGET.mkdir(parents=True, exist_ok=True)
    CAPSULE.parent.mkdir(parents=True, exist_ok=True)
    files = {
        "dai-fondi-ai-posti.pdf": RESEARCH / "paper/main.pdf",
        "regioni.csv": RESEARCH / "generated/regional_summary.csv",
        "sensibilita.json": RESEARCH / "generated/robustness_summary.json",
    }
    assets = {}
    for name, path in files.items():
        shutil.copyfile(path, TARGET / name)
        assets[name] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
    capsule = {"version": "1.2", "revisedAt": "2026-09-06",
               "source": summary["source"], "headline": summary["headline"],
               "pipeline": summary["pipeline"],
               "procurement": summary["procurement"]["procedure_number_value"],
               "robustness": robustness, "assets": assets}
    CAPSULE.write_text(json.dumps(capsule, ensure_ascii=False, indent=2) + "\n")
    print(f"Exported {len(files)} versioned assets and aggregate capsule")


if __name__ == "__main__":
    main()
