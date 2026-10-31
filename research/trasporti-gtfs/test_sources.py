"""Shared archives must not duplicate downloads or accept inconsistent identities."""

import unittest
from analyze import archive_id
from acquire import unique_archives


class SourceTests(unittest.TestCase):
    def test_shared_archive_has_one_download(self):
        sources = [
            dict(id="milano", url="https://example.invalid/a"),
            dict(
                id="milano-metro", archiveId="milano", url="https://example.invalid/a"
            ),
        ]
        self.assertEqual(archive_id(sources[1]), "milano")
        self.assertEqual(unique_archives(sources), [sources[0]])

    def test_ambiguous_or_unsafe_archive_is_rejected(self):
        with self.assertRaises(ValueError):
            archive_id(dict(id="x", archiveId="../x"))
        with self.assertRaises(ValueError):
            unique_archives(
                [
                    dict(id="x", url="https://example.invalid/a"),
                    dict(id="y", archiveId="x", url="https://example.invalid/b"),
                ]
            )
