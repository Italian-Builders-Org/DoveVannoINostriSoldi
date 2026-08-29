#!/usr/bin/env python3
"""Validate both generated artifacts published by the government refresh."""

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import government_current_signals  # noqa: E402
import government_scorecard_snapshot  # noqa: E402


def main() -> None:
    scorecard_spec = government_scorecard_snapshot.load_json(
        government_scorecard_snapshot.DEFAULT_SPEC
    )
    signal_spec = government_current_signals.load_json(
        government_current_signals.DEFAULT_SPEC,
        "source spec",
    )
    government_scorecard_snapshot.validate_spec(scorecard_spec)
    government_current_signals.validate_spec(signal_spec)
    scorecard = government_scorecard_snapshot.load_json(
        government_scorecard_snapshot.DEFAULT_OUTPUT
    )
    signals = government_current_signals.load_json(
        government_current_signals.DEFAULT_OUTPUT,
        "snapshot",
    )
    government_scorecard_snapshot.validate_snapshot(scorecard)
    government_current_signals.validate_snapshot(signals)
    print("ok: government scorecard and current signals")


if __name__ == "__main__":
    main()
