"""Offline checks for TED open notices projection."""

import copy
import csv
import io
import json
import unittest

import ted_open_notices as etl


class TedOpenNoticesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(etl.SPEC.read_text(encoding="utf-8"))
        cls.pages = etl.read_pages(cls.spec)

    def test_committed_projection_matches_lock(self):
        payload = etl.projection(self.pages, self.spec)
        rows = list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))
        self.assertEqual(len(rows), 1707)
        self.assertTrue(all(row["Scadenza offerte"] >= self.spec["openDeadlineCutoff"] for row in rows))
        self.assertEqual(len({row["Numero pubblicazione"] for row in rows}), 1707)

    def test_missing_deadline_in_source_fails_closed(self):
        page = copy.deepcopy(self.pages[0])
        notice = copy.deepcopy(page["notices"][0])
        notice.pop("deadline-receipt-tender-date-lot")
        page["notices"] = [notice]
        spec = copy.deepcopy(self.spec)
        spec.update(totalNotices=1, pages=[{"rows": 1}])
        with self.assertRaises(etl.SourceError):
            etl.projection([page], spec)


if __name__ == "__main__":
    unittest.main()
