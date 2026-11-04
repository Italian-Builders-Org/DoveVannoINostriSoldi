"""Shared archives must not duplicate downloads or accept inconsistent identities."""

import unittest
from analyze import archive_id
from acquire import redirect_allowed, unique_archives


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


class RedirectTests(unittest.TestCase):
    def test_redirect_stays_on_https_and_declared_hosts(self):
        source = dict(
            id="napoli",
            url="https://www.anm.it/google/google-transit.zip",
            allowedRedirectHosts=["anmspa.file.force.com"],
        )
        self.assertTrue(redirect_allowed(source, source["url"]))
        self.assertTrue(
            redirect_allowed(source, "https://anmspa.file.force.com/sfc/x?y=1")
        )
        # Declared hosts are exact: no suffix tricks, no downgrade, no others.
        for url in (
            "http://anmspa.file.force.com/x",
            "https://evil.anmspa.file.force.com.example/x",
            "https://file.force.com/x",
            "https://example.org/x",
        ):
            self.assertFalse(redirect_allowed(source, url), url)
        self.assertFalse(
            redirect_allowed(dict(url="https://a.example/x"), "https://b.example/x")
        )
