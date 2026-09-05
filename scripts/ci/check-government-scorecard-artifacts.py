#!/usr/bin/env python3
"""Validate the two generated artifacts published by the government refresh."""

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import government_scorecard_chronology  # noqa: E402
import government_scorecard_page  # noqa: E402
import government_scorecard_snapshot  # noqa: E402
import government_scorecard_refresh  # noqa: E402


def main() -> None:
    scorecard_spec = government_scorecard_snapshot.load_json(
        government_scorecard_snapshot.DEFAULT_SPEC
    )
    government_scorecard_snapshot.validate_spec(scorecard_spec)
    scorecard = government_scorecard_snapshot.load_json(
        government_scorecard_snapshot.DEFAULT_OUTPUT
    )
    chronology = government_scorecard_snapshot.load_json(
        government_scorecard_chronology.DEFAULT_REGISTRY,
        "chronology",
    )
    page = government_scorecard_snapshot.load_json(
        government_scorecard_page.OUTPUT,
        "page snapshot",
    )
    government_scorecard_snapshot.validate_snapshot(scorecard)
    government_scorecard_chronology.validate_registry(chronology)
    policy = government_scorecard_refresh.load_policy(government_scorecard_refresh.POLICY_PATH)
    government_scorecard_refresh.validate_release(scorecard, page, chronology, policy)
    print("ok: government scorecard core and page snapshots")


if __name__ == "__main__":
    main()
