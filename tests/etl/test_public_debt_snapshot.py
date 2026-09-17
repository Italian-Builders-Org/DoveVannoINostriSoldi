from __future__ import annotations

import copy
import calendar
import csv
import io
import json
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest import mock

from scripts.etl import public_debt_snapshot as ETL


ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "scripts/etl/specs/public-debt.source.json"
EUROSTAT_FIXTURE = ROOT / "tests/etl/fixtures/public-debt/eurostat.json"
MONTHS = [f"2025-{month:02d}" for month in range(6, 13)] + [f"2026-{month:02d}" for month in range(1, 7)]


def load_lock() -> dict[str, object]:
    return json.loads(LOCK_PATH.read_text(encoding="utf-8"))


def series_by_field(lock: dict[str, object], cube_id: str) -> dict[str, dict[str, object]]:
    cube = lock["bancaditalia"]["cubes"][cube_id]
    return {item["field"]: item for item in cube["series"]}


def synthetic_values(lock: dict[str, object], cube_id: str) -> dict[str, list[tuple[str, str]]]:
    series = series_by_field(lock, cube_id)
    if cube_id == "TCCE0175":
        result: dict[str, list[tuple[str, str]]] = {item["id"]: [] for item in series.values()}
        for index, month in enumerate(MONTHS):
            total = 1000 + index * 10
            values = {
                "total": total,
                "currencyAndDeposits": 100,
                "shortTermSecurities": 200,
                "mediumLongTermSecurities": 400 + index * 10,
                "otherLiabilities": 150,
                "mfiLoans": 100,
                "euLoans": 50,
            }
            for field, value in values.items():
                result[series[field]["id"]].append((month, f"{value},0"))
        return result
    if cube_id == "TCCE0125":
        values = {
            "debtInstrumentTransactions": "12,0",
            "rawLiquidityChange": "-5,0",
            "borrowingRequirement": "7,0",
            "netShortTermSecurities": "3,0",
            "netMediumLongTermSecurities": "9,0",
        }
        return {series[field]["id"]: [("2026-06", value)] for field, value in values.items()}
    if cube_id == "TCCE0200":
        may = {
            "total": "1110,0",
            "bankitaliaAmount": "111,0",
            "bankitaliaShare": "10,0",
            "otherMfiAmount": "222,0",
            "otherMfiShare": "20,0",
            "otherFinancialAmount": "166,5",
            "otherFinancialShare": "15,0",
            "otherResidentsAmount": "166,5",
            "otherResidentsShare": "15,0",
            "nonResidentsAmount": "444,0",
            "nonResidentsShare": "40,0",
        }
        result = {}
        for field, value in may.items():
            rows = [("2026-05", value)]
            rows.append(("2026-06", "1120,0" if field == "total" else ""))
            result[series[field]["id"]] = rows
        return result
    if cube_id == "TCCE0325":
        values = {
            "total": "1120,0",
            "upToOneYear": "280,0",
            "oneToFiveYears": "392,0",
            "overFiveYears": "448,0",
            "averageYears": "7,9",
        }
        return {series[field]["id"]: [("2026-06", value)] for field, value in values.items()}
    raise AssertionError(cube_id)


def csv_bytes(headers: list[str], rows: list[list[str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def fixture_date(period: str) -> str:
    year, month = map(int, period.split("-"))
    day = calendar.monthrange(year, month)[1] if 1 <= month <= 12 else 30
    return f"{year:04d}/{month:02d}/{day:02d}"


def bds_zip(
    lock: dict[str, object],
    cube_id: str,
    *,
    values: dict[str, list[tuple[str, str]]] | None = None,
    headers: dict[str, list[str]] | None = None,
    structure_mutator=None,
    member_names: dict[str, str] | None = None,
    omit: str | None = None,
    extra_members: list[tuple[str, bytes]] | None = None,
) -> bytes:
    config = lock["bancaditalia"]["csv"]
    data_headers = (headers or {}).get("data", [config["dataDateHeader"], *[item["id"] for item in lock["bancaditalia"]["cubes"][cube_id]["series"]]])
    structure_headers = (headers or {}).get("structure", config["structureHeaders"])
    domain_headers = (headers or {}).get("domain", config["domainHeaders"])
    legend_headers = (headers or {}).get("legend", config["legendHeaders"])
    cube = lock["bancaditalia"]["cubes"][cube_id]
    series_values = values or synthetic_values(lock, cube_id)
    values_by_series = {series_id: dict(observations) for series_id, observations in series_values.items()}
    periods = [period for period, _ in next(iter(series_values.values()))]
    data_rows = [
        [fixture_date(period), *[values_by_series.get(series_id, {}).get(period, "") for series_id in data_headers[1:]]]
        for period in periods
    ]
    structure_rows = []
    for item in cube["series"]:
        structure_rows.extend([
            [item["id"], "FREQ", "Frequenza", "VC", "FREQUENZA", item["frequency"]],
            [item["id"], "UNMIS", "unità di misura", "VC", "UNMIS", item["unit"]],
            [item["id"], "REGOLA", "Metodo di calcolo", "VC", "FONTE", item["method"]],
            [item["id"], "SCALA", "Scala", "AT", "SCALA", item["scale"]],
        ])
    if structure_mutator is not None:
        structure_mutator(structure_rows)
    members = {
        "DATA": csv_bytes(data_headers, data_rows),
        "STRUCTURE": csv_bytes(structure_headers, structure_rows),
        "DOMAIN": csv_bytes(domain_headers, [["FREQUENZA", "M", "Mensile"]]),
        "LEGEND": csv_bytes(legend_headers, [["Serie storica", item["id"], item["description"]] for item in cube["series"]]),
    }
    names = member_names or {}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for kind, payload in members.items():
            if kind == omit:
                continue
            archive.writestr(names.get(kind, f"{cube_id}_{kind}.csv"), payload)
        for name, payload in extra_members or []:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(name, payload)
    return output.getvalue()


def mark_encrypted(payload: bytes) -> bytes:
    result = bytearray(payload)
    offset = 0
    while True:
        offset = result.find(b"PK\x03\x04", offset)
        if offset < 0:
            break
        flags = int.from_bytes(result[offset + 6:offset + 8], "little") | 1
        result[offset + 6:offset + 8] = flags.to_bytes(2, "little")
        offset += 4
    offset = 0
    while True:
        offset = result.find(b"PK\x01\x02", offset)
        if offset < 0:
            break
        flags = int.from_bytes(result[offset + 8:offset + 10], "little") | 1
        result[offset + 8:offset + 10] = flags.to_bytes(2, "little")
        offset += 4
    return bytes(result)


def replace_zip_member(payload: bytes, member_name: str, replacement: bytes) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(payload)) as source, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            target.writestr(info.filename, replacement if info.filename == member_name else source.read(info.filename))
    return output.getvalue()


def corrupt_first_member(payload: bytes) -> bytes:
    result = bytearray(payload)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        info = archive.infolist()[0]
        name_length = int.from_bytes(result[info.header_offset + 26:info.header_offset + 28], "little")
        extra_length = int.from_bytes(result[info.header_offset + 28:info.header_offset + 30], "little")
        data_offset = info.header_offset + 30 + name_length + extra_length
        result[data_offset + max(0, info.compress_size // 2)] ^= 0x01
    return bytes(result)


class FakeHeaders:
    def __init__(self, content_type: str):
        self.content_type = content_type

    def get_content_type(self) -> str:
        return self.content_type


class FakeResponse:
    def __init__(self, payload: bytes, content_type: str, final_url: str):
        self.payload = payload
        self.headers = FakeHeaders(content_type)
        self.final_url = final_url

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def geturl(self) -> str:
        return self.final_url

    def read(self, limit: int) -> bytes:
        return self.payload[:limit]


class FakeOpener:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def open(self, _request, timeout: int):
        self.calls += 1
        assert timeout == 20
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def parsed_inputs(lock: dict[str, object]):
    cubes = {
        cube_id: ETL.parse_bds_zip(bds_zip(lock, cube_id), cube_id, lock)
        for cube_id in lock["bancaditalia"]["cubes"]
    }
    eurostat = ETL.parse_eurostat(EUROSTAT_FIXTURE.read_bytes(), lock)
    return cubes, eurostat


def valid_snapshot(lock: dict[str, object]):
    cubes, eurostat = parsed_inputs(lock)
    raw = {
        cube_id: {"bytes": len(bds_zip(lock, cube_id)), "sha256": ETL.sha256_bytes(bds_zip(lock, cube_id))}
        for cube_id in cubes
    }
    return ETL.build_snapshot(
        lock,
        cubes,
        eurostat,
        bankitalia_retrieved_at="2026-08-24T08:00:00Z",
        eurostat_retrieved_at="2026-08-24T08:00:00Z",
        bds_raw=raw,
        eurostat_raw={"bytes": EUROSTAT_FIXTURE.stat().st_size, "sha256": ETL.sha256_bytes(EUROSTAT_FIXTURE.read_bytes())},
    )


class PublicDebtSnapshotTests(unittest.TestCase):
    def test_source_lock_and_all_four_valid_archives_build_a_reconciled_snapshot(self):
        lock = load_lock()
        ETL.validate_source_lock(lock)
        snapshot = valid_snapshot(lock)
        ETL.validate_snapshot(snapshot, now="2026-08-24T09:00:00Z")
        self.assertEqual(snapshot["stock"]["referenceDate"], "2026-06-30")
        self.assertEqual(snapshot["stock"]["totalCents"], 112_000_000_000)
        self.assertEqual(snapshot["stock"]["changeCents"], 1_000_000_000)
        self.assertEqual(len(snapshot["stock"]["history"]), 13)
        self.assertEqual(snapshot["holders"]["referenceDate"], "2026-05-31")
        self.assertEqual(snapshot["residualMaturity"]["averageYears"], 7.9)
        self.assertEqual(snapshot["annualInterest"]["referenceYear"], 2025)
        self.assertEqual(snapshot["annualInterest"]["interestShareBasisPoints"], 754)

    def test_network_policy_rejects_http_wrong_hosts_paths_and_redirects(self):
        self.assertEqual(
            ETL.validate_official_url(
                "https://a2a.bancaditalia.it/infostat/dataservices/export/IT/CSV/ALL/CUBE/BANKITALIA/DIFF/TCCE0175",
                "a2a.bancaditalia.it",
            ).hostname,
            "a2a.bancaditalia.it",
        )
        for url in (
            "http://a2a.bancaditalia.it/infostat/x",
            "https://a2a.bancaditalia.it.evil.test/infostat/x",
            "https://user@example.test/x",
        ):
            with self.subTest(url=url), self.assertRaisesRegex(ETL.SnapshotError, "HTTPS|host|credenziali"):
                ETL.validate_official_url(url, "a2a.bancaditalia.it")
        with self.assertRaisesRegex(ETL.SnapshotError, "path"):
            ETL.validate_official_url(
                "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/other",
                "ec.europa.eu",
                expected_path="/eurostat/api/dissemination/statistics/1.0/data/gov_10a_main",
            )
        lock = load_lock()
        lock["bancaditalia"]["exportTemplate"] = "https://a2a.bancaditalia.it/infostat/wrong/{cube}"
        with self.assertRaisesRegex(ETL.SnapshotError, "path"):
            ETL.validate_source_lock(lock)
        with self.assertRaisesRegex(ETL.SnapshotError, "redirect"):
            ETL.validate_redirect(
                "https://a2a.bancaditalia.it/infostat/x",
                "https://example.test/file.zip",
                "a2a.bancaditalia.it",
            )

    def test_zip_boundary_rejects_invalid_encrypted_large_or_unsafe_archives(self):
        lock = load_lock()
        valid = bds_zip(lock, "TCCE0175")
        cases = [
            (b"not-a-zip", "PK"),
            (mark_encrypted(valid), "cifrat"),
            (bds_zip(lock, "TCCE0175", omit="LEGEND"), "membri"),
            (bds_zip(lock, "TCCE0175", member_names={"DATA": "../TCCE0175_DATA.csv"}), "path"),
            (bds_zip(lock, "TCCE0175", extra_members=[("extra.txt", b"x")]), "membri"),
        ]
        for payload, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ETL.SnapshotError, message):
                ETL.parse_bds_zip(payload, "TCCE0175", lock)
        with self.assertRaisesRegex(ETL.SnapshotError, "compresso"):
            ETL.parse_bds_zip(valid, "TCCE0175", lock, max_compressed_bytes=len(valid) - 1)
        with self.assertRaisesRegex(ETL.SnapshotError, "non compress"):
            ETL.parse_bds_zip(valid, "TCCE0175", lock, max_uncompressed_bytes=10)

        duplicate = bds_zip(lock, "TCCE0175", extra_members=[("TCCE0175_DATA.csv", b"duplicate")])
        with self.assertRaisesRegex(ETL.SnapshotError, "membri"):
            ETL.parse_bds_zip(duplicate, "TCCE0175", lock)
        for payload in (
            bds_zip(lock, "TCCE0175", member_names={"DATA": "/TCCE0175_DATA.csv"}),
            bds_zip(lock, "TCCE0175", extra_members=[("folder/", b"")]),
        ):
            with self.assertRaisesRegex(ETL.SnapshotError, "path"):
                ETL.parse_bds_zip(payload, "TCCE0175", lock)

        invalid_utf8 = replace_zip_member(valid, "TCCE0175_STRUCTURE.csv", b"\xff")
        with self.assertRaisesRegex(ETL.SnapshotError, "UTF-8"):
            ETL.parse_bds_zip(invalid_utf8, "TCCE0175", lock)
        with self.assertRaisesRegex(ETL.SnapshotError, "CRC|ZIP"):
            ETL.parse_bds_zip(corrupt_first_member(valid), "TCCE0175", lock)

    def test_download_boundary_checks_content_type_size_final_url_and_retries(self):
        bank_url = "https://a2a.bancaditalia.it/infostat/file.zip"
        euro_url = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10a_main"
        cases = [
            (FakeResponse(b"{}", "text/html", euro_url), euro_url, "ec.europa.eu", "application/json", "content type"),
            (FakeResponse(b"12345", "application/zip", bank_url), bank_url, "a2a.bancaditalia.it", "application/zip", "limite"),
            (FakeResponse(b"{}", "application/json", "https://example.test/data"), euro_url, "ec.europa.eu", "application/json", "host"),
        ]
        for response, url, host, content_type, message in cases:
            opener = FakeOpener([response])
            with self.subTest(message=message), mock.patch.object(ETL.urllib.request, "build_opener", return_value=opener), self.assertRaisesRegex(ETL.SnapshotError, message):
                ETL._download(
                    url,
                    host,
                    expected_path="/eurostat/api/dissemination/statistics/1.0/data/gov_10a_main" if host == "ec.europa.eu" else None,
                    max_bytes=4,
                    expected_content=content_type,
                )

        transient = ETL.urllib.error.HTTPError(bank_url, 408, "timeout", {}, None)
        opener = FakeOpener([
            transient,
            FakeResponse(b"PK", "application/zip", bank_url),
        ])
        with mock.patch.object(ETL.urllib.request, "build_opener", return_value=opener), mock.patch.object(ETL.time, "sleep") as sleep:
            self.assertEqual(
                ETL._download(bank_url, "a2a.bancaditalia.it", expected_path=None, max_bytes=4, expected_content="application/zip"),
                b"PK",
            )
        transient.close()
        self.assertEqual(opener.calls, 2)
        sleep.assert_called_once_with(1)

    def test_bds_schema_and_semantic_metadata_fail_closed(self):
        lock = load_lock()
        bad_header = bds_zip(lock, "TCCE0175", headers={"data": ["SERIES_CODE", "TIME_PERIOD", "VALUE"]})
        with self.assertRaisesRegex(ETL.SnapshotError, "header"):
            ETL.parse_bds_zip(bad_header, "TCCE0175", lock)

        for column, replacement in ((1, "Descrizione divergente"), (2, "A"), (3, "USD"), (4, "UNIT"), (5, "ALTRO")):
            payload = bds_zip(
                lock,
                "TCCE0175",
                structure_mutator=lambda rows, column=column, replacement=replacement: rows[0].__setitem__(column, replacement),
            )
            with self.subTest(column=column), self.assertRaisesRegex(ETL.SnapshotError, "metadati|descrizione"):
                ETL.parse_bds_zip(payload, "TCCE0175", lock)

        values = synthetic_values(lock, "TCCE0175")
        values.pop(next(iter(values)))
        with self.assertRaisesRegex(ETL.SnapshotError, "serie"):
            ETL.parse_bds_zip(bds_zip(lock, "TCCE0175", values=values), "TCCE0175", lock)

    def test_bds_values_dates_and_holder_completeness_are_strict(self):
        lock = load_lock()
        stock = synthetic_values(lock, "TCCE0175")
        total_id = series_by_field(lock, "TCCE0175")["total"]["id"]
        malformed = copy.deepcopy(stock)
        malformed[total_id][-1] = ("2026-06", "1.2.3")
        with self.assertRaisesRegex(ETL.SnapshotError, "valore"):
            ETL.parse_bds_zip(bds_zip(lock, "TCCE0175", values=malformed), "TCCE0175", lock)
        negative = copy.deepcopy(stock)
        negative[total_id][-1] = ("2026-06", "-1,0")
        with self.assertRaisesRegex(ETL.SnapshotError, "negativ"):
            ETL.parse_bds_zip(bds_zip(lock, "TCCE0175", values=negative), "TCCE0175", lock)
        duplicate = copy.deepcopy(stock)
        duplicate[total_id][-1] = duplicate[total_id][-2]
        with self.assertRaisesRegex(ETL.SnapshotError, "duplicat"):
            ETL.parse_bds_zip(bds_zip(lock, "TCCE0175", values=duplicate), "TCCE0175", lock)
        unordered = copy.deepcopy(stock)
        unordered[total_id][-2:] = list(reversed(unordered[total_id][-2:]))
        with self.assertRaisesRegex(ETL.SnapshotError, "ordine"):
            ETL.parse_bds_zip(bds_zip(lock, "TCCE0175", values=unordered), "TCCE0175", lock)
        invalid_date = copy.deepcopy(stock)
        invalid_date[total_id][-1] = ("2026-13", "1120,0")
        with self.assertRaisesRegex(ETL.SnapshotError, "periodo"):
            ETL.parse_bds_zip(bds_zip(lock, "TCCE0175", values=invalid_date), "TCCE0175", lock)

        flow = ETL.parse_bds_zip(bds_zip(lock, "TCCE0125"), "TCCE0125", lock)
        self.assertLess(flow["series"]["rawLiquidityChange"]["2026-06"], 0)
        cubes, eurostat = parsed_inputs(lock)
        snapshot = ETL.build_snapshot(
            lock,
            cubes,
            eurostat,
            bankitalia_retrieved_at="2026-08-24T08:00:00Z",
            eurostat_retrieved_at="2026-08-24T08:00:00Z",
            bds_raw={cube: {"bytes": 1, "sha256": "a" * 64} for cube in cubes},
            eurostat_raw={"bytes": 1, "sha256": "b" * 64},
        )
        self.assertEqual(snapshot["holders"]["referenceDate"], "2026-05-31")

    def test_exact_conversions_and_half_up_rounding(self):
        self.assertEqual(ETL.money_millions_to_cents("1,1", "test"), 110_000_000)
        self.assertEqual(ETL.money_millions_to_cents("-0,1", "test", allow_negative=True), -10_000_000)
        self.assertEqual(ETL.percent_to_basis_points("17,2", "test"), 1720)
        self.assertEqual(ETL.share_basis_points(5, 8), 6250)
        self.assertEqual(ETL.share_basis_points(1, 32), 313)
        with self.assertRaisesRegex(ETL.SnapshotError, "sicuro"):
            ETL.money_millions_to_cents("90071992,6", "test")

    def test_json_stat_maps_by_dimension_name_and_rejects_drift_or_duplicate_keys(self):
        lock = load_lock()
        parsed = ETL.parse_eurostat(EUROSTAT_FIXTURE.read_bytes(), lock)
        self.assertEqual(parsed["years"], [2021, 2022, 2023, 2024, 2025])
        self.assertEqual(parsed["series"]["D41PAY"][2025], 8_714_600_000_000)
        self.assertEqual(parsed["series"]["TE"][2025], 115_530_900_000_000)
        self.assertEqual(json.loads(EUROSTAT_FIXTURE.read_text(encoding="utf-8"))["id"], ["geo", "time", "na_item", "unit", "freq", "sector"])

        original = json.loads(EUROSTAT_FIXTURE.read_text(encoding="utf-8"))
        mutations = []
        for dimension, code in (("freq", "Q"), ("unit", "EUR"), ("sector", "S1"), ("geo", "FR")):
            candidate = copy.deepcopy(original)
            category = candidate["dimension"][dimension]["category"]
            old = next(iter(category["index"]))
            category["index"] = {code: 0}
            category["label"] = {code: category["label"][old]}
            mutations.append(candidate)
        missing_item = copy.deepcopy(original)
        missing_item["dimension"]["na_item"]["category"]["index"] = {"D41PAY": 0}
        missing_item["size"][2] = 1
        missing_item["value"] = missing_item["value"][::2]
        mutations.append(missing_item)
        wrong_dataset = copy.deepcopy(original)
        wrong_dataset["label"] = "Different dataset"
        mutations.append(wrong_dataset)
        wrong_label = copy.deepcopy(original)
        wrong_label["dimension"]["na_item"]["category"]["label"]["D41PAY"] = "Different item"
        mutations.append(wrong_label)
        duplicate_position = copy.deepcopy(original)
        duplicate_position["dimension"]["time"]["category"]["index"]["2025"] = 3
        mutations.append(duplicate_position)
        for candidate in mutations:
            with self.assertRaisesRegex(ETL.SnapshotError, "dimension|codic|cardinal|dataset|label|anni"):
                ETL.parse_eurostat(json.dumps(candidate).encode(), lock)

        with self.assertRaisesRegex(ETL.SnapshotError, "duplicat"):
            ETL.parse_eurostat(b'{"version":"2.0","version":"2.0"}', lock)
        with self.assertRaisesRegex(ETL.SnapshotError, "oltre il limite"):
            ETL.parse_eurostat(b" " * (ETL.MAX_JSON_BYTES + 1), lock)
        with self.assertRaisesRegex(ETL.SnapshotError, "JSON non valido"):
            ETL.parse_eurostat(b"{", lock)

    def test_eurostat_rejects_missing_nonconsecutive_null_or_unsafe_values(self):
        lock = load_lock()
        original = json.loads(EUROSTAT_FIXTURE.read_text(encoding="utf-8"))
        cases = []
        missing_year = copy.deepcopy(original)
        del missing_year["dimension"]["time"]["category"]["index"]["2023"]
        del missing_year["dimension"]["time"]["category"]["label"]["2023"]
        missing_year["size"][1] = 4
        del missing_year["value"][4:6]
        cases.append(missing_year)
        for replacement in (None, 0, -1, "87146", 90_071_993):
            candidate = copy.deepcopy(original)
            candidate["value"][-2] = replacement
            cases.append(candidate)
        for candidate in cases:
            with self.assertRaisesRegex(ETL.SnapshotError, "anni|positivo|valore|sicuro"):
                ETL.parse_eurostat(json.dumps(candidate).encode(), lock)

    def test_all_snapshot_reconciliations_fail_closed_on_single_mutations(self):
        lock = load_lock()
        original = valid_snapshot(lock)
        mutations = [
            (lambda value: value["stock"]["instruments"].__setitem__("currencyAndDepositsCents", value["stock"]["instruments"]["currencyAndDepositsCents"] + 1), "strument"),
            (lambda value: value["stock"].__setitem__("changeCents", value["stock"]["changeCents"] + 1), "variazione"),
            (lambda value: value["change"].__setitem__("borrowingRequirementCents", value["change"]["borrowingRequirementCents"] + 1), "fabbisogno"),
            (lambda value: value["change"].__setitem__("liquidityContributionCents", value["change"]["liquidityContributionCents"] + 1), "liquid"),
            (lambda value: value["change"].__setitem__("otherEffectsCents", value["change"]["otherEffectsCents"] + 1), "altri effetti"),
            (lambda value: value["holders"]["sectors"][0].__setitem__("amountCents", value["holders"]["sectors"][0]["amountCents"] + 100_000_001), "detentor"),
            (lambda value: value["holders"]["sectors"][0].__setitem__("shareBasisPoints", 9000), "quot"),
            (lambda value: value["residualMaturity"].__setitem__("upToOneYearCents", value["residualMaturity"]["upToOneYearCents"] + 100_000_001), "vita residua"),
            (lambda value: value["annualInterest"].__setitem__("interestShareBasisPoints", value["annualInterest"]["interestShareBasisPoints"] + 1), "interessi"),
            (lambda value: value["stock"]["history"].pop(), "tredici"),
            (lambda value: value["annualInterest"]["history"].pop(), "cinque"),
            (lambda value: value["sources"]["bancaditalia"].__setitem__("retrievedAt", "ieri"), "timestamp"),
            (lambda value: value["sources"]["bancaditalia"]["cubes"][0].__setitem__("sha256", "x"), "hash"),
            (lambda value: value["stock"].__setitem__("totalCents", 9_007_199_254_740_992), "sicuro"),
        ]
        for mutate, message in mutations:
            candidate = copy.deepcopy(original)
            mutate(candidate)
            with self.subTest(message=message), self.assertRaisesRegex(ETL.SnapshotError, message):
                ETL.validate_snapshot(candidate, now="2026-08-24T09:00:00Z")

        balanced_shares = copy.deepcopy(original)
        balanced_shares["holders"]["sectors"][0]["shareBasisPoints"] += 100
        balanced_shares["holders"]["sectors"][1]["shareBasisPoints"] -= 100
        with self.assertRaisesRegex(ETL.SnapshotError, "quota detentore"):
            ETL.validate_snapshot(balanced_shares, now="2026-08-24T09:00:00Z")

    def test_holder_latency_future_period_and_annual_staleness_are_enforced(self):
        lock = load_lock()
        original = valid_snapshot(lock)
        future = copy.deepcopy(original)
        future["holders"]["referenceDate"] = "2026-07-31"
        with self.assertRaisesRegex(ETL.SnapshotError, "detentori"):
            ETL.validate_snapshot(future, now="2026-08-24T09:00:00Z")
        old = copy.deepcopy(original)
        old["holders"]["referenceDate"] = "2026-03-31"
        with self.assertRaisesRegex(ETL.SnapshotError, "due mesi"):
            ETL.validate_snapshot(old, now="2026-08-24T09:00:00Z")
        stale = copy.deepcopy(original)
        stale["annualInterest"]["referenceYear"] = 2023
        stale["annualInterest"]["previousYear"] = 2022
        for index, point in enumerate(stale["annualInterest"]["history"]):
            point["year"] -= 2
        warnings_found = ETL.validate_snapshot(stale, now="2026-08-24T09:00:00Z")
        self.assertIn("annual-interest-stale", warnings_found)
        stock_warnings = ETL.validate_snapshot(original, now="2026-10-01T09:00:00Z")
        self.assertIn("stock-stale", stock_warnings)
        future_year = copy.deepcopy(original)
        future_year["annualInterest"]["referenceYear"] = 2027
        with self.assertRaisesRegex(ETL.SnapshotError, "interessi annuali|futuro"):
            ETL.validate_snapshot(future_year, now="2026-08-24T09:00:00Z")

    def test_unchanged_normalized_input_does_not_rewrite_snapshot(self):
        lock = load_lock()
        snapshot = valid_snapshot(lock)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public-debt.json"
            self.assertTrue(ETL.write_snapshot_if_changed(path, snapshot))
            first_mtime = path.stat().st_mtime_ns
            self.assertFalse(ETL.write_snapshot_if_changed(path, copy.deepcopy(snapshot)))
            self.assertEqual(path.stat().st_mtime_ns, first_mtime)
            changed = copy.deepcopy(snapshot)
            changed["sources"]["eurostat"]["sha256"] = "c" * 64
            self.assertTrue(ETL.write_snapshot_if_changed(path, changed))

    def test_transport_only_bds_zip_changes_do_not_create_a_new_semantic_snapshot(self):
        lock = load_lock()
        original = valid_snapshot(lock)
        regenerated = copy.deepcopy(original)
        regenerated["sources"]["bancaditalia"]["retrievedAt"] = "2026-08-25T08:00:00Z"
        for cube in regenerated["sources"]["bancaditalia"]["cubes"]:
            cube["bytes"] += 3
            cube["sha256"] = "f" * 64
        self.assertTrue(ETL.snapshots_semantically_equal(original, regenerated))
        regenerated["stock"]["history"][0]["totalCents"] += 100_000_000
        self.assertFalse(ETL.snapshots_semantically_equal(original, regenerated))

    def test_refresh_failure_preserves_the_last_verified_snapshot(self):
        lock = load_lock()
        snapshot = valid_snapshot(lock)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "public-debt.json"
            output.write_text(json.dumps(snapshot), encoding="utf-8")
            before = output.read_bytes()
            with mock.patch.object(ETL, "_download", side_effect=ETL.SnapshotError("upstream unavailable")), self.assertRaisesRegex(ETL.SnapshotError, "upstream"):
                ETL.refresh(LOCK_PATH, output)
            self.assertEqual(output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
