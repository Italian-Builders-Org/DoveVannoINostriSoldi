from __future__ import annotations

import io
import json
import tempfile
from pathlib import Path
from unittest import TestCase, mock

import siope_nonmunicipal_refresh as refresh
import siope_nonmunicipal_contract as contract
import test_siope_nonmunicipal as fixtures


class Response(io.BytesIO):
    status = 200

    def __init__(self, url, payload=b"official bytes", headers=None):
        super().__init__(payload)
        self.url = url
        self.headers = headers or {}

    def geturl(self):
        return self.url


class AcquisitionTests(TestCase):
    def acquire(self, response_factory, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            opener = mock.Mock()
            opener.open.side_effect = lambda request, timeout: response_factory(request.full_url)
            result = refresh.download_inputs(Path(directory), opener=opener, **kwargs)
            for request, kwargs in opener.open.call_args_list:
                self.assertIn(request[0].full_url, refresh.etl.CANONICAL_INPUT_URLS.values())
                self.assertEqual(kwargs["timeout"], 30)
            return result

    def test_receipt_hashes_exact_bytes_and_unchanged_inputs_ignore_validator_churn(self):
        first = self.acquire(Response)
        second = self.acquire(lambda url: Response(url, headers={"ETag": '"new-validator"'}))
        self.assertTrue(refresh.same_inputs(first, second))
        second["files"]["amministrazioni.txt"]["sha256"] = "0" * 64
        self.assertFalse(refresh.same_inputs(first, second))

    def test_rejects_redirect_partial_empty_and_oversized_responses(self):
        cases = (
            lambda url: Response("https://example.invalid/redirect"),
            lambda url: Response(url, headers={"Content-Length": "999"}),
            lambda url: Response(url, payload=b""),
            lambda url: Response(url, headers={"Content-Length": str(refresh.TOTAL_LIMIT + 1)}),
            lambda url: Response(url, headers={"Content-Encoding": "gzip"}),
        )
        for factory in cases:
            with self.subTest(factory=factory), self.assertRaises(refresh.RefreshError):
                self.acquire(factory)

    def test_streaming_and_aggregate_limits_apply_without_content_length(self):
        with mock.patch.dict(refresh.LIMITS, {key: 3 for key in refresh.LIMITS}):
            with self.assertRaisesRegex(refresh.RefreshError, "budget"):
                self.acquire(Response)
        with mock.patch.object(refresh, "TOTAL_LIMIT", 15):
            with self.assertRaisesRegex(refresh.RefreshError, "budget"):
                self.acquire(Response)

    def test_redirect_handler_blocks_before_following_the_new_destination(self):
        with self.assertRaises(refresh.RefreshError):
            refresh.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.invalid")

    def test_transport_failure_is_not_a_success_or_a_partial_receipt(self):
        with self.assertRaises(OSError):
            self.acquire(lambda url: (_ for _ in ()).throw(OSError("upstream outage")))

    def test_deadline_bounds_the_whole_acquisition(self):
        clock = mock.Mock(side_effect=[0, 0, refresh.DOWNLOAD_SECONDS + 1])
        with self.assertRaisesRegex(refresh.RefreshError, "budget"):
            self.acquire(Response, clock=clock)

    def test_unchanged_real_fixture_bytes_do_not_rebuild_or_promote(self):
        fixture = fixtures.SiopeNonMunicipalTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        manifest = fixture.build()
        before = {path: path.read_bytes() for path in fixture.output.iterdir()}
        by_url = {url: (fixture.input / name).read_bytes() for name, url in refresh.etl.CANONICAL_INPUT_URLS.items()}
        opener = mock.Mock()
        opener.open.side_effect = lambda request, timeout: Response(request.full_url, by_url[request.full_url])
        with mock.patch.object(refresh, "load_manifest", return_value=manifest), mock.patch.object(refresh.etl, "validate_committed_detail") as validate, mock.patch.object(refresh.etl, "build_release") as build, mock.patch.object(refresh.corpus, "append") as promote:
            self.assertEqual(refresh.refresh(opener=opener), "NO_CHANGE")
        validate.assert_called_once()
        build.assert_not_called()
        promote.assert_not_called()
        self.assertEqual({path: path.read_bytes() for path in fixture.output.iterdir()}, before)

    def test_expanded_archive_budget_is_checked_before_parsing(self):
        fixture = fixtures.SiopeNonMunicipalTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        with mock.patch.object(refresh, "EXPANDED_LIMIT", 1):
            with self.assertRaisesRegex(refresh.RefreshError, "ZIP budget"):
                refresh.validate_archives(fixture.input)


class MeasurementContractTests(TestCase):
    def test_only_siope_measurements_and_observation_dates_can_vary(self):
        import copy
        fixture = fixtures.SiopeNonMunicipalTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        manifest = fixture.build()
        path = fixture.output / "siope-nonmunicipal-release.json"
        contract.load_manifest(path)
        spec = json.loads((refresh.ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json").read_bytes())
        before = copy.deepcopy(spec)
        contract.apply_manifest(spec, manifest)
        for old, new in zip(before["datasets"], spec["datasets"], strict=True):
            if new["id"] not in contract.DATASET_IDS:
                self.assertEqual(new, old)
            else:
                for key in old:
                    if key != "expected":
                        self.assertEqual(new[key], old[key])
                self.assertEqual(new["expected"]["headers"], old["expected"]["headers"])
        totals = contract.row_contract(manifest)
        count = sum(item["rows"] for item in manifest["projections"].values())
        self.assertEqual(totals["sourceRows"], contract.FIXED_ROWS["sourceRows"] + count)
        self.assertEqual(totals["publicRows"], contract.FIXED_ROWS["publicRows"] + count)
        self.assertEqual(totals["catalogOnlyRows"], contract.FIXED_ROWS["catalogOnlyRows"])

    def test_manifest_mutation_cannot_self_approve_an_unverified_receipt(self):
        fixture = fixtures.SiopeNonMunicipalTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        manifest = fixture.build()
        manifest["projections"]["siope-uscite-asl"]["rows"] += 1
        path = fixture.output / "siope-nonmunicipal-release.json"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(refresh.etl.SiopeNonMunicipalError, "release divergente"):
            contract.load_manifest(path)
