"""Offline checks for OpenCivitas servizi-totali year discovery on the Liferay portal."""

from __future__ import annotations

import unittest
from unittest import mock

import opencivitas_snapshot as oc


class OpenCivitasDiscoveryTest(unittest.TestCase):
    def test_discovers_from_wider_landing_when_default_page_omits_totals(self) -> None:
        landing_empty = (
            '<html><a href="/portale/w/2023-comuni-rifiuti-indicatori-e-determinanti-1">x</a></html>'
        )
        landing_wide = (
            '<html>'
            '<a href="/portale/w/2023-comuni-servizi-totali-indicatori-e-determinanti-1">x</a>'
            '<a href="/portale/w/2022-comuni-servizi-totali-indicatori-e-determinanti">y</a>'
            "</html>"
        )
        urls: list[str] = []

        def fake_download(url: str, timeout: int) -> str:
            urls.append(url)
            if "delta=50" in url:
                return landing_wide
            return landing_empty

        with mock.patch.object(oc, "download_text", side_effect=fake_download):
            self.assertEqual(oc.discover_latest_total_services_year(10), 2023)
        self.assertEqual(
            urls,
            [
                "https://www.opencivitas.it/portale/open-data",
                "https://www.opencivitas.it/portale/open-data?delta=50&start=0",
            ],
        )

    def test_falls_back_to_search_index(self) -> None:
        search = (
            '<html><a href="/portale/w/2023-comuni-servizi-totali-indicatori-e-determinanti-1'
            '?p_l_back_url=%2Fportale%2Fsearch">z</a></html>'
        )

        def fake_download(url: str, timeout: int) -> str:
            if "search" in url:
                return search
            return "<html></html>"

        with mock.patch.object(oc, "download_text", side_effect=fake_download):
            self.assertEqual(oc.discover_latest_total_services_year(10), 2023)

    def test_fails_closed_when_no_year_is_listed(self) -> None:
        with mock.patch.object(oc, "download_text", return_value="<html></html>"):
            with self.assertRaisesRegex(oc.StructuralError, "nessuna annualità"):
                oc.discover_latest_total_services_year(10)


if __name__ == "__main__":
    unittest.main()
