#!/usr/bin/env python3
"""Export a frozen, aggregate-only capsule and versioned public assets."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = Path(__file__).resolve().parents[1]
TARGET = ROOT / "public/studi/dai-fondi-ai-posti/v1.3"
CAPSULE = ROOT / "src/content/studies/childcare.json"


def publish_asset(source: Path, target: Path) -> dict:
    """Publish a new asset or verify an identical repeat export."""
    content = source.read_bytes()
    try:
        with target.open("xb") as output:
            output.write(content)
    except FileExistsError:
        if target.read_bytes() != content:
            raise ValueError(f"Asset già pubblicato con contenuto diverso: {target.name}; creare una nuova versione") from None
    return {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}


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
        assets[name] = publish_asset(path, TARGET / name)
    capsule = {"version": "1.3", "revisedAt": "2026-09-06",
               "source": summary["source"], "headline": summary["headline"],
               "pipeline": summary["pipeline"],
               "procurement": summary["procurement"]["procedure_number_value"],
               "robustness": robustness, "assets": assets}
    CAPSULE.write_text(json.dumps(capsule, ensure_ascii=False, indent=2) + "\n")
    print(f"Exported {len(files)} versioned assets and aggregate capsule")


if __name__ == "__main__":
    main()
