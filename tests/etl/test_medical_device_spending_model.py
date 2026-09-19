from __future__ import annotations

import csv
import io
import json
from decimal import Decimal, localcontext
from unittest import TestCase

import medical_device_spending_model as model
import medical_device_spending_profile as source
import integrated_curated_datasets as corpus
import test_medical_device_spending_profile as fixtures

FIXTURE_REGISTRY_MEMBER = fixtures.FIXTURE_REGISTRY_MEMBER


class MedicalDeviceModelTests(TestCase):
    setUp = fixtures.MedicalDeviceProfileTests.setUp
    tearDown = fixtures.MedicalDeviceProfileTests.tearDown
    candidate_inputs = fixtures.MedicalDeviceProfileTests.candidate_inputs

    def inputs(self):
        spending, path = self.candidate_inputs()
        lock = source.load_spec(path)
        meta = model.snapshot_metadata(lock["registry"], model.REGISTRY_DATASET)
        records = list(model.registry_records(source._zip_rows(
            self.registry, FIXTURE_REGISTRY_MEMBER, "utf-8-sig", source.REGISTRY_HEADERS, "test",
        ), meta))
        registry = {record["key"]: record["source_record_id"] for record in records}
        return spending, lock, meta, records, registry

    def facts(self, year=2021):
        spending, lock, meta, records, registry = self.inputs()
        release = lock["spendingReleases"][str(year)]
        raw = list(source._zip_rows(spending[year], release["archive"]["member"],
                                    "ascii", source.SPENDING_HEADERS, "test"))
        facts = [model.spending_fact(row, i, release, meta, registry) for i, row in enumerate(raw, 1)]
        return facts, records, raw, release, meta, registry

    def test_left_join_exact_money_originals_and_context(self):
        with localcontext() as ctx:
            ctx.prec = 2
            facts, records, raw, _, _, _ = self.facts()
            before = after = Decimal(0)
            for original, fact in zip(raw, facts, strict=True):
                before = source.add_decimals(before, source.parse_source_euros(original["CostoAcq"]))
                after = source.add_decimals(after, Decimal(fact["spesa_normalizzata"]))
                self.assertEqual(fact["source"]["cells"], original)
            self.assertEqual(before, after)
            self.assertEqual(str(after), "1001.00")
        self.assertEqual([f["join_status"] for f in facts], ["matched", "matched", "not_found", "missing_key"])
        self.assertNotEqual(facts[0]["anagrafica_record_id"], facts[1]["anagrafica_record_id"])
        self.assertNotEqual(facts[0]["azienda_key"], facts[1]["azienda_key"])
        self.assertEqual(facts[0]["codice_classificazione_fonte"], "A00")
        self.assertEqual(records[0]["codice_classificazione_anagrafica"], "A01")
        self.assertEqual(records[1]["codice_classificazione_anagrafica"], "")
        self.assertIsNone(facts[0]["denominazione_regione"])
        self.assertIsNone(facts[0]["versione_classificazione"])
        self.assertIsNone(facts[0]["extraction_date"])
        self.assertNotEqual(facts[0]["anno"], facts[0]["anagrafica_date"][:4])

    def test_historical_fact_keeps_source_region_and_zero_padded_codes(self):
        _, lock, meta, _, registry = self.inputs()
        raw = dict(zip(source.SPENDING_HEADERS_2018_2019, [
            "2018", "010", "PIEMONTE", "010203", "TO3", "A01", "1", "42", "1,00",
        ], strict=True))
        fact = model.spending_fact(raw, 1, lock["spendingReleases"]["2018"], meta, registry)
        self.assertEqual(fact["denominazione_regione"], "PIEMONTE")
        self.assertEqual(fact["codice_regione"], "010")
        self.assertEqual(fact["codice_azienda_sanitaria"], "010203")
        self.assertEqual(fact["source"]["cells"], raw)

    def test_repeated_facts_are_not_deduplicated_and_ids_match_corpus(self):
        facts, _, raw, release, _, _ = self.facts(2020)
        self.assertEqual(len(facts), 5)
        self.assertEqual(facts[0]["source"]["cells"], facts[-1]["source"]["cells"])
        self.assertNotEqual(facts[0]["source_record_id"], facts[-1]["source_record_id"])
        import medical_device_spending_corpus as candidate
        item = candidate.dataset_entry(2020, release)
        parsed = corpus.ParsedDataset(source.SPENDING_HEADERS,
            [[r[h] for h in source.SPENDING_HEADERS] for r in raw], item["expected"]["sha256"],
            item["expected"]["bytes"], [], [("source", i) for i in range(1, 6)], False, 5, None)
        _, payload, _, _ = corpus.build_dataset(item, parsed, {})
        public = [json.loads(line) for line in payload.splitlines()]
        self.assertEqual([r["id"] for r in public], [f["source_record_id"] for f in facts])

    def test_missing_invalid_and_zero_padded_keys_never_fallback(self):
        _, _, raw, release, meta, registry = self.facts()
        for kind, number, expected in [("", "42", "missing_key"), ("3", "42", "invalid_key"),
                                       ("1", "42X", "invalid_key"), ("1", "042", "not_found")]:
            with self.subTest(kind=kind, number=number):
                fact = model.spending_fact({**raw[0], "CodTipoDM": kind, "NumRep": number},
                                           1, release, meta, registry)
                self.assertEqual(fact["join_status"], expected)
                self.assertEqual(fact["numero_repertorio"], number)
                self.assertIsNone(fact["anagrafica_record_id"])

    def test_null_empty_invalid_money_and_wrong_release_fail_closed(self):
        _, _, raw, release, meta, registry = self.facts()
        for value in (None, "", "NaN", "1.00"):
            with self.subTest(value=value), self.assertRaises(source.SourceError):
                model.spending_fact({**raw[0], "CostoAcq": value}, 1, release, meta, registry)
        for changes in ({"Anno": "2020"},):
            with self.assertRaises(source.SourceError):
                model.spending_fact({**raw[0], **changes}, 1, release, meta, registry)
        with self.assertRaises(source.SourceError):
            model.spending_fact(raw[0], 1, {**release, "releaseId": "other"}, meta, registry)

    def test_fiscal_fields_and_repeated_identifiers_are_redacted_before_hashing(self):
        _, _, meta, _, _ = self.inputs()
        raw = next(source._zip_rows(self.registry, FIXTURE_REGISTRY_MEMBER, "utf-8-sig",
                                    source.REGISTRY_HEADERS, "test"))
        raw.update(cod_fiscale="RSSMRA80A01H501U", PARTITAIVA_VATNUMBER_MAND="12345678901",
                   denominazione_commerciale="Dispositivo RSSMRA80A01H501U")
        record = next(model.registry_records([raw], meta))
        serialized = json.dumps(record)
        self.assertNotIn("RSSMRA80A01H501U", serialized)
        self.assertNotIn("12345678901", serialized)
        self.assertIsNone(record["source"]["cells"]["cod_fiscale"])
        self.assertTrue(record["source"]["redactions"])
        self.assertEqual(record["fabbricante_assemblatore"], "Fab A")

    def test_duplicate_registry_keys_and_invalid_dates_block(self):
        _, _, meta, _, _ = self.inputs()
        raw = next(source._zip_rows(self.registry, FIXTURE_REGISTRY_MEMBER, "utf-8-sig",
                                    source.REGISTRY_HEADERS, "test"))
        with self.assertRaisesRegex(source.SourceError, "duplicata"):
            list(model.registry_records([raw, {**raw, "denominazione_commerciale": "Altro"}], meta))
        with self.assertRaisesRegex(source.SourceError, "Data"):
            list(model.registry_records([{**raw, "data_inizio_validita": "2020-02-31"}], meta))

    def test_conventional_dates_preserve_original_without_real_expiry(self):
        for value in ("9999/12/31", "9999-12-31 00:00:00"):
            parsed = model.source_date(value, conventional_end=True)
            self.assertEqual(parsed["original"], value)
            self.assertIsNone(parsed["normalized"])
            self.assertEqual(parsed["status"], "conventional-open-end")
        self.assertEqual(model.source_date("")["status"], "missing")
        self.assertEqual(model.source_date("2020-01-01 12:34:56")["normalized"], "2020-01-01T12:34:56")

    def test_classification_preserves_all_versions_without_historical_rewrite(self):
        _, lock, _, _, _ = self.inputs()
        meta = model.snapshot_metadata(lock["classification"], model.CND_DATASET)
        rows = list(csv.DictReader(io.StringIO(self.cnd.read_text(encoding="utf-8")), delimiter=";"))
        records = list(model.classification_records(rows, meta))
        self.assertEqual([r["codice"] for r in records], ["A", "A", "A01"])
        self.assertNotEqual(records[0]["key"], records[1]["key"])
        revisions = list(model.classification_records(
            [rows[0], {**rows[0], "data_fine_validita": "2022-02-23 00:00:00"}], meta))
        self.assertNotEqual(revisions[0]["key"], revisions[1]["key"])
        with self.assertRaisesRegex(source.SourceError, "duplicata"):
            list(model.classification_records([rows[0], rows[0]], meta))
