"""Failure cases defined before the observed-rail importer; synthetic, no network."""

import html
import tempfile
import unittest
from pathlib import Path

from rail import (
    analyse_capture,
    csv_for,
    rail_history,
    read_capture,
    write_rail_viewer,
)


def capture(rows, number="8509"):
    parts = ["<h1>FR " + number + "</h1>"]
    for i, (station, planned, observed, forecast) in enumerate(rows):
        event = "Partenza" if i == 0 else "Arrivo"
        parts.extend(
            [
                "<h2>" + html.escape(station) + "</h2>",
                f"<p>{event} programmat{'a' if i == 0 else 'o'}:<br><strong>{planned}</strong></p>",
                f"<p>{event} {'previsto' if forecast else 'effettiva' if i == 0 else 'effettivo'}:<br><strong>{observed}</strong></p>",
            ]
        )
    return {
        "url": "http://www.viaggiatreno.it/vt_pax_internet/mobile/scheda?dettaglio=visualizza&numeroTreno=8509&codLocOrig=S11811&dataPartenza=1793574000000&tipoRicerca=numero&lang=IT",
        "acquiredAt": "2026-11-02T10:00:00Z",
        "html": "<html><body>" + "".join(parts) + "</body></html>",
    }


ROWS = [
    ("A", "06:00", "06:00", False),
    ("B", "07:00", "07:10", False),
    ("C", "08:00", "08:05", False),
]


class RailCaptureTests(unittest.TestCase):
    def test_delay_changes_preserve_recovery_and_zero(self):
        j = analyse_capture(capture(ROWS))
        self.assertEqual(j["serviceDate"], "2026-11-02")
        self.assertEqual([s["delayMinutes"] for s in j["observations"]], [0, 10, 5])
        self.assertEqual([s["deltaMinutes"] for s in j["observations"]], [None, 10, -5])
        self.assertEqual(j["arrivalDelayMinutes"], 5)
        self.assertEqual(j["peakDelayMinutes"], 10)
        self.assertEqual(
            j["largestIncrease"], {"fromIndex": 0, "toIndex": 1, "minutes": 10}
        )
        self.assertEqual(
            j["coverage"], {"stops": 3, "observedStops": 3, "complete": True}
        )

    def test_forecast_is_not_an_observation_and_a_gap_is_not_attributed(self):
        rows = [ROWS[0], ("B", "07:00", "07:15", True), ROWS[2]]
        j = analyse_capture(capture(rows))
        self.assertIsNone(j["observations"][1]["observed"])
        self.assertIsNone(j["observations"][1]["delayMinutes"])
        self.assertIsNone(j["observations"][2]["deltaMinutes"])
        self.assertIsNone(j["largestIncrease"])
        self.assertFalse(j["coverage"]["complete"])

    def test_advance_and_absence_do_not_become_zero(self):
        j = analyse_capture(
            capture(
                [ROWS[0], ("B", "07:00", "06:58", False), ("C", "08:00", "--", False)]
            )
        )
        self.assertEqual(j["observations"][1]["delayMinutes"], -2)
        self.assertIsNone(j["arrivalDelayMinutes"])

    def test_source_train_and_date_identity_are_required(self):
        for changed in [
            {
                "url": capture(ROWS)["url"].replace(
                    "www.viaggiatreno.it", "untrusted.invalid"
                )
            },
            {"url": capture(ROWS)["url"].replace("1793574000000", "invalid")},
            {"html": capture(ROWS)["html"].replace("FR 8509", "FR 8519")},
            {"acquiredAt": "2026-11-01T10:00:00Z"},
        ]:
            with self.subTest(changed=list(changed)):
                with self.assertRaises(ValueError):
                    analyse_capture({**capture(ROWS), **changed})

    def test_missing_schedule_and_ambiguous_midnight_are_rejected(self):
        for rows in [
            [("A", "--", "06:00", False), ROWS[1]],
            [("A", "23:00", "23:00", False), ("B", "00:30", "00:40", False)],
            [("A", "06:00", "06:05", False), ("B", "07:00", "05:59", False)],
            [("A", "06:00", "06:00", False), ("B", "07:00", "15:00", False)],
        ]:
            with self.subTest(rows=rows):
                with self.assertRaises(ValueError):
                    analyse_capture(capture(rows))

    def test_clock_only_overnight_delay_cannot_look_like_a_day_early(self):
        data = capture([("A", "23:50", "00:10", False), ("B", "23:59", "00:20", False)])
        data["acquiredAt"] = "2026-11-03T10:00:00Z"
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            analyse_capture(data)

    def test_capture_budget_and_invalid_json_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "capture.json"
            p.write_text("x" * 65)
            with self.assertRaises(ValueError):
                read_capture(p, max_bytes=64)
            p.write_text("not json")
            with self.assertRaises(ValueError):
                read_capture(p)

    def test_csv_retains_missing_and_negative_values_and_escapes_source_text(self):
        import csv, io

        j = analyse_capture(
            capture(
                [
                    ROWS[0],
                    ('=1+1, "X"', "07:00", "06:58", False),
                    ("C", "08:00", "--", False),
                ]
            )
        )
        rows = list(csv.DictReader(io.StringIO(csv_for(j))))
        self.assertEqual(rows[1]["fermata"], '\'=1+1, "X"')
        self.assertEqual(rows[1]["ritardo_min"], "-2")
        self.assertEqual(rows[2]["rilevato"], "")
        self.assertEqual(rows[2]["ritardo_min"], "")
        self.assertEqual(rows[0]["data_servizio"], "2026-11-02")

    def test_render_does_not_allow_source_text_to_close_the_data_script(self):
        j = analyse_capture(
            capture(
                [
                    ROWS[0],
                    ("</script><img src=x onerror=alert(1)>", "07:00", "07:00", False),
                ]
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            write_rail_viewer([j], Path(tmp), standalone=True)
            text = (Path(tmp) / "treni.html").read_text()
            self.assertNotIn("</script><img", text)
            self.assertIn("\\u003c/script>", text)
            self.assertNotIn('href="index.html"', text)


if __name__ == "__main__":
    unittest.main()


class RailHistoryTests(unittest.TestCase):
    def day(self, stamp, acquired, rows, number="8509"):
        c = capture(rows, number)
        c["url"] = c["url"].replace("1793574000000", stamp).replace(
            "numeroTreno=8509", "numeroTreno=" + number
        )
        c["acquiredAt"] = acquired
        return analyse_capture(c)

    def test_days_and_stations_aggregate_only_observed_passes(self):
        first = self.day("1793574000000", "2026-11-02T10:00:00Z", ROWS)
        second = self.day(
            "1793660400000",
            "2026-11-03T10:00:00Z",
            [
                ("A", "06:00", "06:02", False),
                ("B", "07:00", "08:00", True),  # forecast: not observed
                ("C", "08:00", "08:20", False),
            ],
        )
        other = self.day("1793574000000", "2026-11-02T10:00:00Z", ROWS, "8519")
        history = rail_history([second, other, first])
        self.assertEqual([t["number"] for t in history["trains"]], ["8509", "8519"])
        train = history["trains"][0]
        self.assertEqual(
            [d["serviceDate"] for d in train["days"]], ["2026-11-02", "2026-11-03"]
        )
        self.assertEqual([d["arrivalDelayMinutes"] for d in train["days"]], [5, 20])
        stations = {s["station"]: s for s in train["stations"]}
        self.assertEqual(stations["B"]["observedDays"], 1)
        self.assertEqual(stations["B"]["meanDelayMinutes"], 10)
        self.assertEqual(stations["C"]["meanDelayMinutes"], 12.5)
        self.assertEqual(stations["C"]["delays"], [5, 20])
        self.assertEqual(stations["B"]["delays"], [10, None])

    def test_same_train_and_day_twice_is_rejected(self):
        first = self.day("1793574000000", "2026-11-02T10:00:00Z", ROWS)
        with self.assertRaises(ValueError):
            rail_history([first, dict(first)])
