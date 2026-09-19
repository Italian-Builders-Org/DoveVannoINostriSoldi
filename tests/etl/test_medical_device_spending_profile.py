from __future__ import annotations

import csv
import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import medical_device_spending_profile as etl
import medical_device_spending_corpus as candidate

FIXTURE_REGISTRY_MEMBER = "registry-fixture.csv"


def write_zip(path: Path, member: str, headers: list[str], rows: list[list[str]], encoding: str) -> None:
    import io
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=";", lineterminator="\r\n")
    writer.writerow(headers); writer.writerows(rows)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, stream.getvalue().encode(encoding))


class MedicalDeviceProfileTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.spending = self.root / "spending.zip"; self.registry = self.root / "registry.zip"; self.cnd = self.root / "cnd.csv"
        write_zip(self.registry, FIXTURE_REGISTRY_MEMBER, etl.REGISTRY_HEADERS, [
            ["1", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Fab A", "", "", "A", "Device A", "A01", "Aghi", ""],
            ["2", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Ass B", "", "", "B", "Kit B", "", "", ""],
        ], "utf-8")
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [
            ["2021", "10", "100", "ASL A", "1", "42", "A00", "1.000,00"],
            ["2021", "20", "100", "ASL B", "2", "42", "K01", "0,00"],
            ["2021", "20", "101", "ASL C", "1", "99", "A01", "-2,00"],
            ["2021", "20", "101", "ASL C", "", "", "A01", "3,00"],
        ], "ascii")
        with self.cnd.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, delimiter=";", lineterminator="\n"); writer.writerow(etl.CND_HEADERS)
            writer.writerows([["A", "Old", "N", "", "2007-01-01", "2020-12-31"], ["A", "New", "N", "", "2021-01-01", ""], ["A01", "Aghi", "S", "", "2007-01-01", ""]])

    def tearDown(self): self.temp.cleanup()

    def test_composite_join_preserves_unresolved_zero_negative_and_versions(self):
        result = etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)
        self.assertEqual(result["registry"]["duplicateBareNumbersAcrossTypes"], 1)
        self.assertEqual(result["join"], {"matchedRows": 2, "unresolvedRows": 2, "missingKeyRows": 1, "invalidKeyRows": 0, "notFoundRows": 1, "ambiguousRows": 0, "matchedEuroExact": "1000.00", "unresolvedEuroExact": "1.00", "sourceCurrentCndDifferentRows": 2})
        self.assertEqual(result["spending"]["totalEuroExact"], "1001.00")
        self.assertEqual(result["spending"]["zeroAmounts"], 1)
        self.assertEqual(result["spending"]["negativeAmounts"], 1)
        self.assertEqual(result["spending"]["repeatedBusinessGrains"], 0)
        self.assertEqual(result["registry"]["sentinelValidTo"], 2)
        self.assertEqual(result["cnd"]["codesWithMultipleVersions"], 1)

    def test_duplicate_composite_registry_key_fails_closed(self):
        row = ["1", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Fab", "", "", "A", "Device", "A01", "Aghi", ""]
        write_zip(self.registry, FIXTURE_REGISTRY_MEMBER, etl.REGISTRY_HEADERS, [row, row], "utf-8")
        with self.assertRaisesRegex(etl.SourceError, "duplicata"):
            etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)

    def test_schema_and_money_drift_fail_closed(self):
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [["2021", "10", "100", "ASL", "1", "42", "A01", "1.00"]], "ascii")
        with self.assertRaisesRegex(etl.SourceError, "Importo"):
            etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)

    def test_empty_amount_is_not_observed_zero(self):
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [["2021", "10", "100", "ASL", "1", "42", "A01", ""]], "ascii")
        with self.assertRaisesRegex(etl.SourceError, "Importo"):
            etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)

    def test_extra_or_missing_row_cells_fail_closed(self):
        for row in (
            ["2021", "10", "100", "ASL", "1", "42", "A01", "1,00", "extra"],
            ["2021", "10", "100", "ASL", "1", "42", "A01"],
        ):
            with self.subTest(cells=len(row)):
                write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [row], "ascii")
                with self.assertRaisesRegex(etl.SourceError, "Forma riga spesa"):
                    etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)

    def test_observed_money_lexicon_preserves_up_to_five_decimals(self):
        self.assertEqual([str(etl.parse_source_euros(value)) for value in ("468", "655,2", "1.248,00", "8024,92164", "-2,00")], ["468", "655.2", "1248.00", "8024.92164", "-2.00"])
        for value in ("1,234567", "1.23,00", "+1,00", " 1,00"):
            with self.subTest(value=value), self.assertRaises(etl.SourceError):
                etl.parse_source_euros(value)

    def test_period_and_member_are_release_specific(self):
        with self.assertRaisesRegex(etl.SourceError, "Contenuto archivio"):
            etl.profile(self.spending, self.registry, self.cnd, 2022, registry_member=FIXTURE_REGISTRY_MEMBER)

    def test_release_specific_member_is_accepted_only_when_explicit(self):
        rows = [["2020", "10", "100", "ASL", "1", "42", "A01", "1,00"]]
        write_zip(self.spending, "Appendice 2020.csv", etl.SPENDING_HEADERS, rows, "ascii")
        result = etl.profile(
            self.spending,
            self.registry,
            self.cnd,
            2020,
            spending_member="Appendice 2020.csv",
            registry_member=FIXTURE_REGISTRY_MEMBER,
        )
        self.assertEqual(result["spending"]["years"], {"2020": 1})

    def test_2018_2019_schema_preserves_region_and_lexical_codes(self):
        member = "OpenDataCostiDM2018.csv"
        write_zip(self.spending, member, etl.SPENDING_HEADERS_2018_2019, [[
            "2018", "010", "PIEMONTE", "010203", "TO3", "A01010101", "1", "42", "1.000,00",
        ]], "ascii")
        result = etl.profile(
            self.spending,
            self.registry,
            self.cnd,
            2018,
            spending_member=member,
            registry_member=FIXTURE_REGISTRY_MEMBER,
        )
        self.assertEqual(result["spending"]["years"], {"2018": 1})
        self.assertEqual(result["spending"]["totalEuroExact"], "1000.00")
        rows = list(etl._zip_rows(
            self.spending, member, "ascii", etl.spending_headers(2018), "test",
        ))
        self.assertEqual(rows[0]["CodRegCommit"], "010")
        self.assertEqual(rows[0]["CodASL"], "010203")
        self.assertEqual(rows[0]["RegioneCommit"], "PIEMONTE")

    def test_registry_member_is_accepted_only_when_explicit(self):
        member = "registry-fixture-renamed.csv"
        write_zip(self.registry, member, etl.REGISTRY_HEADERS, [[
            "1", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Fab A", "", "", "A", "Device A", "A01", "Aghi", "",
        ]], "utf-8")
        result = etl.profile(self.spending, self.registry, self.cnd, registry_member=member)
        self.assertEqual(result["registry"]["rows"], 1)

    def test_same_health_company_code_in_different_regions_stays_distinct(self):
        rows = [
            ["2021", "10", "100", "ASL Nord", "1", "42", "A01", "1,00"],
            ["2021", "20", "100", "ASL Sud", "1", "42", "A01", "2,00"],
        ]
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, rows, "ascii")
        result = etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)
        self.assertEqual(result["spending"]["rows"], 2)
        self.assertEqual(result["spending"]["repeatedBusinessGrains"], 0)

    def test_repeated_business_grain_is_reported_without_deduplication(self):
        rows = [
            ["2021", "20", "100", "Nome breve", "1", "42", "A01", "1,00"],
            ["2021", "20", "100", "Nome esteso", "1", "42", "A01", "2,00"],
        ]
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, rows, "ascii")
        result = etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)
        self.assertEqual(result["spending"]["rows"], 2)
        self.assertEqual(result["spending"]["totalEuroExact"], "3.00")
        self.assertEqual(result["spending"]["repeatedBusinessGrains"], 1)
        self.assertEqual(result["spending"]["maxBusinessGrainOccurrences"], 2)

    def test_invalid_join_key_is_distinct_from_missing_and_not_found(self):
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [
            ["2021", "20", "100", "ASL", "3", "42", "A01", "1,00"],
            ["2021", "20", "100", "ASL", "1", "42A", "A01", "2,00"],
        ], "ascii")
        result = etl.profile(self.spending, self.registry, self.cnd, registry_member=FIXTURE_REGISTRY_MEMBER)
        self.assertEqual(result["join"]["invalidKeyRows"], 2)
        self.assertEqual(result["join"]["missingKeyRows"], 0)
        self.assertEqual(result["join"]["notFoundRows"], 0)
        self.assertEqual(result["join"]["unresolvedEuroExact"], "3.00")

    def test_committed_source_lock_is_self_consistent(self):
        spec = etl.load_spec()
        self.assertEqual(spec["integrity"]["lockSha256"], etl.canonical_lock_sha256(spec))
        self.assertEqual(set(spec["spendingReleases"]), {str(year) for year in range(2012, 2024)})
        self.assertTrue(all(spec["spendingReleases"][str(year)]["licenseStatus"] == "IODL-2.0" for year in range(2012, 2022)))
        self.assertTrue(all(spec["spendingReleases"][year]["licenseStatus"] == "not-declared" for year in ("2022", "2023")))
        self.assertTrue(all(spec["spendingReleases"][year]["siteTermsUrl"].endswith("/note-legali-2/") for year in ("2022", "2023")))
        self.assertTrue(all(spec["spendingReleases"][str(year)]["acquisitionStatus"] == "cataloged-not-acquired" for year in range(2012, 2018)))
        self.assertTrue(all(spec["spendingReleases"][str(year)]["acquisitionStatus"] == "acquired-profiled" for year in range(2018, 2024)))
        self.assertTrue(all("archive" not in spec["spendingReleases"][str(year)] for year in range(2012, 2018)))
        self.assertEqual(spec["schemas"]["spendingHeaders2018To2019"], etl.SPENDING_HEADERS_2018_2019)

    def test_source_lock_requires_every_profile_field(self):
        original = json.loads(etl.DEFAULT_SPEC.read_text(encoding="utf-8"))
        for location in (("spendingReleases", "2021"), ("registry",), ("classification",)):
            target = original
            for part in location:
                target = target[part]
            for key in target["expected"]:
                with self.subTest(location=location, key=key):
                    changed = json.loads(json.dumps(original))
                    target = changed
                    for part in location:
                        target = target[part]
                    del target["expected"][key]
                    changed["integrity"]["lockSha256"] = etl.canonical_lock_sha256(changed)
                    path = self.root / f"missing-{'-'.join(location)}-{key}.json"
                    path.write_text(json.dumps(changed), encoding="utf-8")
                    with self.assertRaisesRegex(etl.SourceError, "Profilo atteso"):
                        etl.load_spec(path)

    def test_source_lock_rejects_license_period_and_url_drift(self):
        original = json.loads(etl.DEFAULT_SPEC.read_text(encoding="utf-8"))
        for field, value, message in (
            ("licenseStatus", "CC-BY-4.0", "Licenza"),
            ("referencePeriod", "2021", "Periodo"),
            ("downloadUrl", "https://example.test/file.zip", "URL ufficiale"),
            ("publicationDisposition", "publish", "Selezione release"),
        ):
            with self.subTest(field=field):
                changed = json.loads(json.dumps(original))
                changed["spendingReleases"]["2022"][field] = value
                changed["integrity"]["lockSha256"] = etl.canonical_lock_sha256(changed)
                path = self.root / f"bad-{field}.json"
                path.write_text(json.dumps(changed), encoding="utf-8")
                with self.assertRaisesRegex(etl.SourceError, message):
                    etl.load_spec(path)

    def test_zip_member_bytes_and_hash_are_verified(self):
        member = "Appendice rapporto 2021.csv"
        with zipfile.ZipFile(self.spending) as archive:
            payload = archive.read(member)
        expected = {
            "member": member,
            "memberBytes": len(payload),
            "memberSha256": hashlib.sha256(payload).hexdigest(),
        }
        etl._verify_zip_member(self.spending, expected, "fixture")
        expected["memberSha256"] = "0" * 64
        with self.assertRaisesRegex(etl.SourceError, "Byte membro"):
            etl._verify_zip_member(self.spending, expected, "fixture")

    def candidate_inputs(self):
        lock = etl.load_spec()
        with zipfile.ZipFile(self.spending) as archive:
            import io
            rows = list(csv.reader(io.StringIO(archive.read("Appendice rapporto 2021.csv").decode("ascii")), delimiter=";"))[1:]
        previous = self.root / "spending-2020.zip"
        previous_rows = [["2020", *row[1:]] for row in rows]
        write_zip(previous, "Appendice 2020.csv", etl.SPENDING_HEADERS, [*previous_rows, previous_rows[0]], "ascii")
        spending = {2020: previous, 2021: self.spending}
        for path, expected in [
            (self.registry, lock["registry"]["archive"]),
            (previous, lock["spendingReleases"]["2020"]["archive"]),
            (self.spending, lock["spendingReleases"]["2021"]["archive"]),
        ]:
            payload = path.read_bytes()
            with zipfile.ZipFile(path) as archive:
                member = archive.namelist()[0]
                raw = archive.read(member)
            expected.update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(),
                            member=member, memberBytes=len(raw), memberSha256=hashlib.sha256(raw).hexdigest())
        payload = self.cnd.read_bytes()
        lock["classification"].update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
        for year, path in spending.items():
            release = lock["spendingReleases"][str(year)]
            result = etl.profile(path, self.registry, self.cnd, year,
                                 spending_member=release["archive"]["member"], registry_member=FIXTURE_REGISTRY_MEMBER)
            observed = {**result["spending"], **result["join"]}
            release["expected"] = {key: observed[key] for key in release["expected"]}
            lock["registry"]["expected"] = result["registry"]
            lock["classification"]["expected"] = result["cnd"]
        lock["integrity"]["lockSha256"] = etl.canonical_lock_sha256(lock)
        path = self.root / "fixture.source.json"
        path.write_text(json.dumps(lock), encoding="utf-8")
        base, _ = candidate.corpus.load_spec(candidate.corpus.DEFAULT_SPEC)
        base["datasets"] = [item for item in base["datasets"] if item["id"] not in candidate.DATASET_IDS]
        for dataset_id in candidate.DATASET_IDS:
            base["sourceMetadata"]["overrides"].pop(dataset_id, None)
        (self.root / "base-corpus.source.json").write_text(json.dumps(base), encoding="utf-8")
        return spending, path

    def historical_candidate_inputs(self):
        lock = etl.load_spec()
        archives = {}
        rows_by_year = {
            2018: [
                ["2018", "010", "PIEMONTE", "010203", "TO3", "A01010101", "1", "42", "1.000,00"],
                ["2018", "020", "VALLE D'AOSTA", "020100", "USL", "A01010102", "1", "99", "-2,00"],
            ],
            2019: [
                ["2019", "10", "PIEMONTE", "10203", "TO3", "A01010101", "1", "42", "3"],
                ["2019", "20", "VALLE D'AOSTA", "20100", "USL", "A01010102", "1", "99", "0,0"],
            ],
        }
        for year, rows in rows_by_year.items():
            path = self.root / f"spending-{year}.zip"
            member = f"OpenDataCostiDM{year}.csv"
            write_zip(path, member, etl.SPENDING_HEADERS_2018_2019, rows, "ascii")
            archives[year] = path
            payload = path.read_bytes()
            with zipfile.ZipFile(path) as zipped:
                raw = zipped.read(member)
            lock["spendingReleases"][str(year)]["archive"].update(
                bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(), member=member,
                memberBytes=len(raw), memberSha256=hashlib.sha256(raw).hexdigest(),
            )
        registry_payload = self.registry.read_bytes()
        with zipfile.ZipFile(self.registry) as zipped:
            registry_raw = zipped.read(FIXTURE_REGISTRY_MEMBER)
        lock["registry"]["archive"].update(
            bytes=len(registry_payload), sha256=hashlib.sha256(registry_payload).hexdigest(),
            member=FIXTURE_REGISTRY_MEMBER, memberBytes=len(registry_raw),
            memberSha256=hashlib.sha256(registry_raw).hexdigest(),
        )
        cnd_payload = self.cnd.read_bytes()
        lock["classification"].update(bytes=len(cnd_payload), sha256=hashlib.sha256(cnd_payload).hexdigest())
        for year, path in archives.items():
            result = etl.profile(
                path, self.registry, self.cnd, year,
                spending_member=lock["spendingReleases"][str(year)]["archive"]["member"],
                registry_member=FIXTURE_REGISTRY_MEMBER,
            )
            observed = {**result["spending"], **result["join"]}
            expected = lock["spendingReleases"][str(year)]["expected"]
            lock["spendingReleases"][str(year)]["expected"] = {key: observed[key] for key in expected}
            lock["registry"]["expected"] = result["registry"]
            lock["classification"]["expected"] = result["cnd"]
        lock["integrity"]["lockSha256"] = etl.canonical_lock_sha256(lock)
        lock_path = self.root / "historical-fixture.source.json"
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        return archives, lock_path

    def test_candidate_preserves_source_bytes_cells_and_existing_spec(self):
        spending, lock_path = self.candidate_inputs()
        output = self.root / "candidate"
        candidate.prepare(spending, self.registry, self.cnd, output, lock_path=lock_path, base_spec_path=self.root / "base-corpus.source.json")
        self.assertGreater(len((output / "candidate.source.json").read_text(encoding="utf-8").splitlines()), 1)
        spec, datasets = candidate.corpus.load_spec(output / "candidate.source.json")
        base, existing = candidate.corpus.load_spec(self.root / "base-corpus.source.json")
        self.assertEqual(datasets[:-4], existing)
        registry_item, cnd_item = datasets[-2:]
        with zipfile.ZipFile(self.registry) as zipped:
            original = zipped.read(FIXTURE_REGISTRY_MEMBER)
        self.assertEqual((output / registry_item["relativePath"]).read_bytes(), original.replace(b";\r\n", b"\r\n", 1))
        self.assertEqual((output / cnd_item["relativePath"]).read_bytes(), self.cnd.read_bytes())
        import medical_device_spending_model as model
        lock = etl.load_spec(lock_path)
        records = list(model.registry_records(etl._zip_rows(self.registry, FIXTURE_REGISTRY_MEMBER, "utf-8-sig", etl.REGISTRY_HEADERS, "test"),
                       model.snapshot_metadata(lock["registry"], model.REGISTRY_DATASET)))
        _, registry_rows, _, _ = candidate.corpus.build_dataset(registry_item, candidate.corpus.parse_dataset(output, registry_item), {})
        self.assertEqual([r["source_record_id"] for r in records], [json.loads(r)["id"] for r in registry_rows.splitlines()])
        for dataset_id, metadata in base["sourceMetadata"]["overrides"].items():
            self.assertEqual(spec["sourceMetadata"]["overrides"][dataset_id], metadata)
        for year, item in zip((2020, 2021), datasets[-4:-2], strict=True):
            with zipfile.ZipFile(spending[year]) as archive:
                self.assertEqual((output / item["relativePath"]).read_bytes(), archive.read(archive.namelist()[0]))
            parsed = candidate.corpus.parse_dataset(output, item)
            _, payload, receipt, _ = candidate.corpus.build_dataset(
                item, parsed, candidate.corpus.resolved_source_metadata(spec, item["id"]),
            )
            rows = [json.loads(line) for line in payload.splitlines()]
            self.assertEqual([list(row["cells"][header] for header in etl.SPENDING_HEADERS) for row in rows], parsed.rows)
            self.assertEqual([row["cells"]["CostoAcq"] for row in rows[:4]], ["1.000,00", "0,00", "-2,00", "3,00"])
            self.assertEqual(receipt["publication"]["publicRows"], 5 if year == 2020 else 4)
            self.assertEqual(len({row["id"] for row in rows}), len(rows))
            self.assertTrue(all(row["cells"]["Anno"] == str(year) for row in rows))
        with self.assertRaisesRegex(etl.SourceError, "esiste già"):
            candidate.prepare(spending, self.registry, self.cnd, output, lock_path=lock_path)

    def test_candidate_does_not_leave_partial_output_on_second_year_failure(self):
        spending, lock_path = self.candidate_inputs()
        self.spending.write_bytes(b"corrupted archive")
        output = self.root / "candidate"
        with self.assertRaisesRegex(etl.SourceError, "Byte spesa 2021"):
            candidate.prepare(spending, self.registry, self.cnd, output, lock_path=lock_path, base_spec_path=self.root / "base-corpus.source.json")
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".medical-device-candidate-*")), [])

    def test_registry_normalization_never_discards_a_seventeenth_cell(self):
        _, path = self.candidate_inputs()
        lock = etl.load_spec(path)
        with zipfile.ZipFile(self.registry) as zipped:
            raw = zipped.read(FIXTURE_REGISTRY_MEMBER)
        lines = raw.splitlines(keepends=True)
        for suffix in (b";", b";dato"):
            with self.subTest(suffix=suffix):
                with zipfile.ZipFile(self.registry, "w") as zipped:
                    zipped.writestr(FIXTURE_REGISTRY_MEMBER, lines[0] + lines[1].rstrip(b"\r\n") + suffix + b"\r\n" + b"".join(lines[2:]))
                payload = self.registry.read_bytes()
                lock["registry"]["archive"].update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
                with self.assertRaisesRegex(etl.SourceError, "non assente"):
                    candidate.normalize_registry(self.registry, lock["registry"], self.root / "normalized.csv")

    def test_candidate_excludes_unapproved_years(self):
        with self.assertRaisesRegex(etl.SourceError, "soltanto le annualità pilota"):
            candidate.prepare({2021: self.spending, 2022: self.spending}, self.registry, self.cnd, self.root / "candidate")

    def test_candidate_rejects_a_second_release_for_an_existing_year(self):
        spending, lock_path = self.candidate_inputs()
        with self.assertRaisesRegex(etl.SourceError, "Dataset già nel corpus"):
            candidate.prepare(
                spending, self.registry, self.cnd, self.root / "candidate",
                lock_path=lock_path,
            )

    def test_historical_candidate_preserves_original_bytes_and_lexical_codes(self):
        spending, lock_path = self.historical_candidate_inputs()
        output = self.root / "historical-candidate"
        base, _ = candidate.corpus.load_spec(candidate.corpus.DEFAULT_SPEC)
        base["datasets"] = [
            item for item in base["datasets"] if item["id"] not in candidate.HISTORICAL_DATASET_IDS
        ]
        for dataset_id in candidate.HISTORICAL_DATASET_IDS:
            base["sourceMetadata"]["overrides"].pop(dataset_id, None)
        base_path = self.root / "pre-history-corpus.source.json"
        base_path.write_text(json.dumps(base), encoding="utf-8")
        candidate.prepare_historical(
            spending, self.registry, self.cnd, output,
            lock_path=lock_path, base_spec_path=base_path,
        )
        spec, datasets = candidate.corpus.load_spec(output / "candidate.source.json")
        historical = datasets[-2:]
        self.assertEqual([item["id"] for item in historical], [
            "salute-spesa-dispositivi-2018", "salute-spesa-dispositivi-2019",
        ])
        for year, item in zip(candidate.HISTORICAL_YEARS, historical, strict=True):
            with zipfile.ZipFile(spending[year]) as zipped:
                self.assertEqual((output / item["relativePath"]).read_bytes(), zipped.read(zipped.namelist()[0]))
            parsed = candidate.corpus.parse_dataset(output, item)
            self.assertEqual(parsed.headers, etl.SPENDING_HEADERS_2018_2019)
            self.assertEqual(parsed.rows[0][0], str(year))
            self.assertEqual(parsed.rows[0][2], "PIEMONTE")
        self.assertEqual(candidate.corpus.resolved_source_metadata(
            spec, "salute-spesa-dispositivi-2018",
        )["referencePeriod"], "2018")
        self.assertEqual(candidate.corpus.parse_dataset(output, historical[0]).rows[0][1:4], [
            "010", "PIEMONTE", "010203",
        ])
        self.assertEqual(candidate.corpus.parse_dataset(output, historical[1]).rows[0][1:4], [
            "10", "PIEMONTE", "10203",
        ])

    def test_historical_candidate_requires_exactly_2018_and_2019(self):
        with self.assertRaisesRegex(etl.SourceError, "soltanto le annualità 2018 e 2019"):
            candidate.prepare_historical(
                {2018: self.spending, 2020: self.spending}, self.registry, self.cnd,
                self.root / "historical-candidate",
            )

    def test_historical_candidate_rejects_a_second_release_for_an_existing_year(self):
        spending, lock_path = self.historical_candidate_inputs()
        with self.assertRaisesRegex(etl.SourceError, "Annualità storiche già nel corpus"):
            candidate.prepare_historical(
                spending, self.registry, self.cnd, self.root / "historical-candidate",
                lock_path=lock_path,
            )
