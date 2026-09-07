"""Prove TED coverage and semantics from every acquired response, fully offline."""

import copy
import csv
import io
import json
import unittest

import ted_notices as etl


class TedNoticesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(etl.SPEC.read_text())
        cls.pages = etl.read_pages(cls.spec)

    def sample(self):
        spec = copy.deepcopy(self.spec)
        notice = copy.deepcopy(self.pages[0]["notices"][0])
        page = {"notices": [notice], "totalNoticeCount": 1, "iterationNextToken": None, "timedOut": False}
        spec.update(totalNotices=1, pages=[{"rows": 1}], forms={notice["form-type"]: 1}, internationalNotices=0, englishBuyerNotices=0)
        return page, spec

    def test_original_pages_reproduce_all_public_rows_and_receipt(self):
        payload = etl.projection(self.pages, self.spec)
        etl.check_committed(self.spec, payload)
        rows = list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))
        self.assertEqual(len(rows), 2825)
        self.assertEqual(len({row["Numero pubblicazione"] for row in rows}), 2825)
        self.assertEqual(sum(row["Lingua committenti"] == "eng" for row in rows), 21)
        self.assertEqual(sum(len(set(json.loads(row["Paesi committenti"]))) > 1 for row in rows), 3)
        self.assertGreaterEqual(rows[0]["Data pubblicazione"], rows[-1]["Data pubblicazione"])
        self.assertFalse(any("importo" in header.lower() for header in rows[0]))

    def test_international_and_english_notices_keep_their_scope_and_arrays(self):
        payload = etl.projection(self.pages, self.spec)
        rows = list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))
        row = next(row for row in rows if row["Numero pubblicazione"] == "548051-2026")
        self.assertEqual(json.loads(row["Paesi committenti"]), ["SWE", "ITA"])
        self.assertEqual(len(json.loads(row["Committenti"])), 2)
        self.assertEqual(row["Lingua committenti"], "eng")
        bilingual = next(row for row in rows if row["Numero pubblicazione"] == "534211-2026")
        self.assertEqual(json.loads(bilingual["Committenti"]), ["Eco-Center Spa"])

    def test_partial_pages_timeouts_changed_totals_and_extra_schema_fail_closed(self):
        for change in [
            {"timedOut": True}, {"totalNoticeCount": 2}, {"iterationNextToken": "next"},
            {"notices": []}, {"unexpected": "value"},
        ]:
            with self.subTest(change=change), self.assertRaises(etl.SourceError):
                page, spec = self.sample()
                page.update(change)
                etl.projection([page], spec)
        page, spec = self.sample()
        with self.assertRaisesRegex(etl.SourceError, "pagine mancanti"):
            etl.projection([], spec)
        page["notices"] *= 2
        page["totalNoticeCount"] = spec["totalNotices"] = spec["pages"][0]["rows"] = 2
        with self.assertRaisesRegex(etl.SourceError, "duplicato"):
            etl.projection([page], spec)

    def test_dates_geography_identity_types_and_required_fields_fail_closed(self):
        for field, value in [
            ("publication-date", "2026-09-01+02:00"), ("publication-date", None),
            ("publication-number", "533445-2025"), ("buyer-country", ["DEU"]),
            ("buyer-country", []), ("buyer-name", {"ita": []}), ("buyer-name", {"fra": ["Name"]}),
            ("form-type", "unknown"), ("classification-cpv", ["33190"]),
            ("notice-title", {"eng": "English only"}),
            ("links", {"html": {"ITA": "https://example.com/notice"}}),
        ]:
            with self.subTest(field=field, value=value), self.assertRaises(etl.SourceError):
                page, spec = self.sample()
                page["notices"][0][field] = value
                etl.projection([page], spec)
        page, spec = self.sample()
        del page["notices"][0]["buyer-country"]
        with self.assertRaisesRegex(etl.SourceError, "schema avviso"):
            etl.projection([page], spec)

    def test_compressed_and_original_response_hashes_reject_drift(self):
        for target in ["response", "fixture"]:
            with self.subTest(target=target), self.assertRaises(etl.SourceError):
                spec = copy.deepcopy(self.spec)
                entry = spec["pages"][0] if target == "response" else spec["pages"][0]["fixture"]
                entry["sha256"] = "0" * 64
                etl.read_pages(spec)


if __name__ == "__main__":
    unittest.main()
