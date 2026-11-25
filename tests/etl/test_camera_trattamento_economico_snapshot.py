"""Offline checks for Camera institutional economic treatment snapshot."""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from camera_trattamento_economico_snapshot import (
    OUTPUT,
    SnapshotError,
    build_snapshot,
    check_committed,
    content_text,
    extract_history,
    load_spec,
    plain_text,
    validate_snapshot,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/camera-trattamento-economico/pagina-2026-11-02.html"


def committed() -> dict:
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


def fixture_page() -> bytes:
    return FIXTURE.read_bytes()


def fixture_content() -> str:
    return content_text(plain_text(fixture_page().decode("utf-8")))[0]


def steps(history: list[dict], component_id: str) -> list[tuple]:
    return [
        (item["fromYear"], item["fromDate"], item["amountCents"], item["basis"])
        for item in history
        if item["componentId"] == component_id
    ]


def validate(payload: dict) -> None:
    spec = load_spec()
    validate_snapshot(payload, floor=spec["coverageFloor"]["components"], locks=spec["source"]["committedContent"])


class CameraTrattamentoEconomicoSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_summary_matches_components(self) -> None:
        payload = committed()
        by_id = {item["id"]: item for item in payload["components"]}
        self.assertEqual(
            payload["summary"]["indemnityGrossMonthlyCents"],
            by_id["indennita-parlamentare-lordo"]["amountCents"],
        )
        self.assertEqual(by_id["indennita-parlamentare-lordo"]["amountCents"], 1_043_500)

    def test_history_follows_every_step_published_by_the_camera(self) -> None:
        history = extract_history(fixture_content())
        self.assertEqual(
            steps(history, "indennita-parlamentare-lordo"),
            [
                (2005, None, 1_243_432, "literal"),
                (2006, None, 1_170_364, "literal"),
                (2011, None, 1_128_328, "literal"),
                (2012, None, 1_043_500, "literal"),
            ],
        )
        self.assertEqual(
            steps(history, "indennita-parlamentare-lordo-altra-attivita"),
            [(2011, None, 1_086_292, "literal"), (2012, None, 997_500, "literal")],
        )
        # The page states only the 500 euro cut, so the earlier amount is arithmetic, not a quote.
        self.assertEqual(
            steps(history, "diaria"),
            [(None, None, 400_311, "derived"), (2010, "2010-07-27", 350_311, "literal")],
        )
        self.assertEqual(
            steps(history, "rimborso-eletti-elettori"),
            [(None, None, 419_000, "literal"), (2010, None, 369_000, "literal")],
        )
        self.assertEqual(
            steps(history, "rimborso-spese-telefoniche"),
            [(None, None, 309_874, "literal"), (2014, "2014-04-01", 120_000, "literal")],
        )

    def test_history_rejects_a_broken_from_to_chain(self) -> None:
        # The 2012 cut starts "da 11.283,28": if that stops matching the 2011 amount the page is incoherent.
        text = fixture_content().replace("nel 2012, l'importo dell'indennità parlamentare mensile è stato nuovamente ridotto: da 11.283,28", "nel 2012, l'importo dell'indennità parlamentare mensile è stato nuovamente ridotto: da 11.283,29")
        with self.assertRaises(SnapshotError):
            extract_history(text)

    def test_history_rejects_missing_wording(self) -> None:
        text = fixture_content().replace("fissandone l'ammontare in", "portandola a")
        with self.assertRaises(SnapshotError):
            extract_history(text)

    def test_build_ignores_drupal_css_cache_token(self) -> None:
        spec = load_spec()
        page = fixture_page()
        variant = page.replace(b"?tmfoic", b"?zzzzzz")
        self.assertNotEqual(page, variant)
        first = build_snapshot(spec, page, "2026-11-02T00:00:00Z")
        second = build_snapshot(spec, variant, "2026-11-02T00:00:00Z")
        self.assertEqual(first["source"]["content"], second["source"]["content"])
        self.assertNotEqual(first["source"]["responses"]["page"]["sha256"], second["source"]["responses"]["page"]["sha256"])

    def test_build_rejects_changed_section_text(self) -> None:
        page = fixture_page().replace(b"<strong>5.000 euro</strong>", b"<strong>5.100 euro</strong>")
        with self.assertRaises(SnapshotError):
            build_snapshot(load_spec(), page, "2026-11-02T00:00:00Z")

    def test_build_reads_publication_date_and_withholdings(self) -> None:
        payload = build_snapshot(load_spec(), fixture_page(), "2026-11-02T00:00:00Z")
        self.assertEqual(payload["source"]["publicationDate"], "2024-04-15")
        self.assertEqual(payload["summary"]["indemnityGrossWithoutCutsMonthlyCents"], 1_639_312)
        self.assertEqual(payload["summary"]["pensionContributionBasisPoints"], 880)
        self.assertEqual(payload["freeze"]["adjustmentsSuspendedFromYear"], 2007)
        self.assertEqual(payload["freeze"]["confirmedThroughYear"], 2026)
        by_id = {item["id"]: item for item in payload["components"]}
        self.assertEqual(by_id["trattenuta-assistenza-sanitaria"]["grossNet"], "withholding")
        self.assertEqual(by_id["rimborso-spese-accessorie-viaggio-oltre-100km"]["frequency"], "quarterly")
        validate(payload)

    def test_validate_rejects_content_hash_drift(self) -> None:
        payload = committed()
        payload["source"]["content"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate(payload)

    def test_validate_rejects_history_out_of_order(self) -> None:
        payload = copy.deepcopy(committed())
        indemnity = [i for i, item in enumerate(payload["history"]) if item["componentId"] == "indennita-parlamentare-lordo"]
        first, last = indemnity[0], indemnity[-1]
        payload["history"][first], payload["history"][last] = payload["history"][last], payload["history"][first]
        with self.assertRaises(SnapshotError):
            validate(payload)

    def test_validate_rejects_history_that_ends_away_from_current_rate(self) -> None:
        payload = copy.deepcopy(committed())
        last = [item for item in payload["history"] if item["componentId"] == "diaria"][-1]
        last["amountCents"] += 100
        last["amountEuro"] = "3.504,11"
        with self.assertRaises(SnapshotError):
            validate(payload)

    def test_senato_gap_is_declared(self) -> None:
        payload = committed()
        self.assertIn("Senato", payload["provenance"]["gap"])


if __name__ == "__main__":
    unittest.main()
