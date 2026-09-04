#!/usr/bin/env python3
"""Build the hash-pinned ISTAT Casellario pension snapshot.

The two input files are the bounded SDMX-CSV responses for the pension-benefit
and pensioner flows.  They are deliberately passed as local files: runtime
and CI never fetch SDMX, and a source/schema/hash drift fails closed before an
existing artifact can be replaced.
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import re
import tempfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-pensions-2012-2022.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-pensions-2012-2022.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-pensions-2012-2022.meta.json"

PENSION_YEARS = tuple(range(2012, 2023))
PENSION_CATEGORIES = ("ALL", "OLSEN1", "SURV", "DISAB1", "CIVDIS", "NOCONT", "COMP", "WAR")
PENSION_DATA_TYPES = {"AMEP_NS", "ANP_NS", "P_NSNU"}
PENSIONER_DATA_TYPES = {"AMEP_RS", "ANP_RS", "P_RSNU"}
HEX64 = re.compile(r"^[a-f0-9]{64}$")
DECIMAL = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d+)?$")
ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$")


class SnapshotError(ValueError):
    """Raised when an input, source lock, or generated snapshot diverges."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    candidate = copy.deepcopy(lock)
    integrity = candidate.get("integrity")
    if not isinstance(integrity, dict) or "lockSha256" not in integrity:
        raise SnapshotError("integrity.lockSha256 mancante nel source lock")
    integrity["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(candidate))


def _dict(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} deve essere un oggetto")
    return value


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotError(f"{label} mancante")
    return value.strip()


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"{label} illeggibile: {path}") from error
    return _dict(value, label)


def _validate_asset_lock(asset: dict[str, Any], label: str, *, expected_id: str, expected_title: str, expected_dataflow: str, expected_dsd: str, expected_rows: int, expected_bytes: int, expected_sha256: str, expected_header_sha256: str, expected_columns: list[str]) -> None:
    for key in ("id", "title", "url", "queryKey", "dataflowId", "dsd", "format", "encoding", "delimiter", "lineEnding", "observedAt"):
        _text(asset.get(key), f"{label}.{key}")
    if not asset["url"].startswith("https://esploradati.istat.it/SDMXWS/rest/data/"):
        raise SnapshotError(f"{label}.url non è l'endpoint ISTAT SDMX ufficiale")
    if asset["id"] != expected_id or asset["title"] != expected_title or asset["dataflowId"] != expected_dataflow or asset["dsd"] != expected_dsd:
        raise SnapshotError(f"{label}: dataflow/DSD non autorizzati")
    expected_key = {
        "IT1,46_813,1.0": "A.IT.P_NSNU+ANP_NS+AMEP_NS.ALL+OLSEN1+SURV+DISAB1+CIVDIS+NOCONT+COMP+WAR.TOTAL.9.9.TOTAL.99",
        "IT1,46_812,1.0": "A.IT.P_RSNU+ANP_RS+AMEP_RS.ALL.TOTAL.9.TOTAL",
    }[expected_dataflow]
    if asset["queryKey"] != expected_key or not asset["url"].endswith(expected_key):
        raise SnapshotError(f"{label}: query key non autorizzata")
    if "/all/" in asset["url"].lower() or asset["queryKey"].strip().lower() == "all":
        raise SnapshotError(f"{label}: la query wildcard /all/ non è ammessa")
    if f"/{asset['queryKey']}" not in asset["url"] or "?" in asset["url"]:
        raise SnapshotError(f"{label}: URL non riproducibile rispetto alla query key bloccata")
    if asset["accept"] != "application/vnd.sdmx.data+csv;version=1.0.0" or asset["format"] != "SDMX-CSV 1.0.0" or asset["encoding"] != "UTF-8" or asset["delimiter"] != "," or asset["lineEnding"] != "CRLF":
        raise SnapshotError(f"{label}: contratto CSV inatteso")
    if not ISO_TIMESTAMP.fullmatch(asset["observedAt"]):
        raise SnapshotError(f"{label}.observedAt non è un timestamp ISO valido")
    if asset.get("referencePeriod") != {"from": 2012, "to": 2022}:
        raise SnapshotError(f"{label}.referencePeriod inatteso")
    if asset.get("rows") != expected_rows:
        raise SnapshotError(f"{label}.rows inatteso")
    if asset.get("bytes") != expected_bytes or asset.get("sha256") != expected_sha256:
        raise SnapshotError(f"{label}: bytes/SHA-256 non coincidono con il raw acquisito")
    if asset.get("rawHeaderSha256") != expected_header_sha256:
        raise SnapshotError(f"{label}.rawHeaderSha256 inatteso")
    columns = asset.get("columns")
    if columns != expected_columns:
        raise SnapshotError(f"{label}.columns inattese")
    if not HEX64.fullmatch(str(asset.get("sha256", ""))) or not HEX64.fullmatch(str(asset.get("rawHeaderSha256", ""))):
        raise SnapshotError(f"{label}: hash non validi")


def validate_source_spec(spec: dict[str, Any], *, allow_unbound_artifact: bool = False) -> None:
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != "istat-pensions":
        raise SnapshotError("source lock ISTAT pensioni non supportato")
    if spec.get("period") != {"from": 2012, "to": 2022}:
        raise SnapshotError("periodo source lock inatteso")
    source = _dict(spec.get("source"), "source")
    if source.get("owner") != "Istat" or source.get("licenseStatus") != "not-declared":
        raise SnapshotError("owner/licenza source lock inattesi")
    _text(source.get("licenseNote"), "source.licenseNote")
    if not source.get("landingUrl", "").startswith("https://esploradati.istat.it/"):
        raise SnapshotError("source.landingUrl non ufficiale")

    assets = _dict(source.get("assets"), "source.assets")
    expected_pension_columns = [
        "DATAFLOW", "FREQ", "REF_AREA", "DATA_TYPE", "PENSION_TYPE",
        "MONTHLY_AMOUNT_CLASS", "PENSIONER_SECTOR_PUBPRIV", "SEX", "AGE",
        "EX_PROF_STATUS", "TIME_PERIOD", "OBS_VALUE", "OBS_STATUS", "NOTE_DS",
        "NOTE_REF_AREA", "NOTE_DATA_TYPE", "NOTE_PENSION_TYPE", "NOTE_MONTHLY_AMOUNT_CLASS",
        "NOTE_PENSIONER_SECTOR_PUBPRIV", "NOTE_SEX", "NOTE_AGE", "NOTE_EX_PROF_STATUS",
        "NOTE_TIME_PERIOD", "BASE_PER", "UNIT_MEAS", "UNIT_MULT",
    ]
    expected_pensioner_columns = [
        "DATAFLOW", "FREQ", "REF_AREA", "DATA_TYPE", "PENSION_TYPE",
        "MONTHLY_AMOUNT_CLASS", "SEX", "AGE", "TIME_PERIOD", "OBS_VALUE",
        "OBS_STATUS", "NOTE_DS", "NOTE_REF_AREA", "NOTE_DATA_TYPE", "NOTE_PENSION_TYPE",
        "NOTE_MONTHLY_AMOUNT_CLASS", "NOTE_SEX", "NOTE_AGE", "NOTE_TIME_PERIOD",
        "BASE_PER", "UNIT_MEAS", "UNIT_MULT",
    ]
    _validate_asset_lock(
        _dict(assets.get("pensionBenefits"), "source.assets.pensionBenefits"),
        "source.assets.pensionBenefits", expected_id="istat-pension-benefits-2012-2022", expected_title="Istat - Pensioni (Casellario dei pensionati)", expected_dataflow="IT1,46_813,1.0", expected_dsd="DCAR_PENSIONI2",
        expected_rows=264, expected_bytes=21835,
        expected_sha256="e6479f690a4030dfbab3a19b07b8822ffc5d553bfaa94b70165ea81c0d0b1325",
        expected_header_sha256="6314996849e1e4057a915ad2e569be3c304ec9a1b2ad76a57bc6ffce7ac7459e",
        expected_columns=expected_pension_columns,
    )
    _validate_asset_lock(
        _dict(assets.get("pensioners"), "source.assets.pensioners"),
        "source.assets.pensioners", expected_id="istat-pensioners-2012-2022", expected_title="Istat - Pensionati (Casellario dei pensionati)", expected_dataflow="IT1,46_812,1.0", expected_dsd="DCAR_PENSIONATI2",
        expected_rows=33, expected_bytes=2685,
        expected_sha256="1d11b46a3cf52456766487b566d3a371a36b32d15c3a79a7631ef146716fbd72",
        expected_header_sha256="44a46feb3a8a987da32e6bfdc244ad7ed7877e76a31e37718dc92174b1f74cc9",
        expected_columns=expected_pensioner_columns,
    )

    expected = _dict(spec.get("expected"), "expected")
    if expected.get("years") != list(PENSION_YEARS) or expected.get("pensionCategories") != list(PENSION_CATEGORIES):
        raise SnapshotError("anni/categorie source lock inattesi")
    if expected.get("pensionBenefitRows") != 88 or expected.get("pensionerRows") != 11:
        raise SnapshotError("cardinalità trasformata inattesa")
    integrity = _dict(spec.get("integrity"), "integrity")
    artifact = _dict(integrity.get("dataArtifact"), "integrity.dataArtifact")
    artifact_bytes = artifact.get("bytes")
    artifact_sha = artifact.get("sha256")
    if allow_unbound_artifact and artifact_bytes == 0 and artifact_sha == "":
        pass
    elif not isinstance(artifact_bytes, int) or artifact_bytes <= 0 or not isinstance(artifact_sha, str) or not HEX64.fullmatch(artifact_sha):
        raise SnapshotError("integrity.dataArtifact non valido")
    declared = integrity.get("lockSha256")
    if allow_unbound_artifact and declared == "":
        return
    if not isinstance(declared, str) or not HEX64.fullmatch(declared) or declared != canonical_lock_sha256(spec):
        raise SnapshotError("source lock modificato senza aggiornare integrity.lockSha256")


def load_source_spec(path: Path = DEFAULT_SPEC, *, allow_unbound_artifact: bool = False) -> dict[str, Any]:
    spec = _load_json(path, "source lock")
    validate_source_spec(spec, allow_unbound_artifact=allow_unbound_artifact)
    return spec


def validate_generation_observed_at(spec: dict[str, Any], observed_at: str) -> None:
    assets = _dict(_dict(spec.get("source"), "source").get("assets"), "source.assets")
    locked_values = {
        _dict(asset, f"source.assets.{name}").get("observedAt")
        for name, asset in assets.items()
    }
    if locked_values != {observed_at}:
        raise SnapshotError(
            "--observed-at deve coincidere con il timestamp acquisito e bloccato per entrambi gli asset"
        )


def _parse_decimal(raw: str, label: str) -> Decimal:
    value = raw.strip()
    if not DECIMAL.fullmatch(value):
        raise SnapshotError(f"valore decimale non valido in {label}: {raw!r}")
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise SnapshotError(f"valore decimale non valido in {label}: {raw!r}") from error
    if not parsed.is_finite() or parsed < 0:
        raise SnapshotError(f"valore negativo/non finito in {label}")
    return parsed


def _read_csv(payload: bytes, label: str, expected_columns: list[str], expected_bytes: int, expected_sha256: str) -> list[dict[str, str]]:
    if len(payload) != expected_bytes or sha256_bytes(payload) != expected_sha256:
        raise SnapshotError(f"{label}: bytes/SHA-256 non coincidono con il source lock")
    if b"\r\n" not in payload or b"\n" in payload.replace(b"\r\n", b""):
        raise SnapshotError(f"{label}: line ending non è CRLF")
    try:
        decoded = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"{label}: encoding UTF-8 non valido") from error
    header_bytes = payload.split(b"\r\n", 1)[0]
    if sha256_bytes(header_bytes) not in {
        "6314996849e1e4057a915ad2e569be3c304ec9a1b2ad76a57bc6ffce7ac7459e",
        "44a46feb3a8a987da32e6bfdc244ad7ed7877e76a31e37718dc92174b1f74cc9",
    }:
        raise SnapshotError(f"{label}: header non bloccato")
    reader = csv.DictReader(io.StringIO(decoded, newline=""))
    if reader.fieldnames != expected_columns:
        raise SnapshotError(f"{label}: intestazione inattesa")
    rows = list(reader)
    if any(None in row for row in rows):
        raise SnapshotError(f"{label}: colonne extra presenti")
    if any(any(value is None for value in row.values()) for row in rows):
        raise SnapshotError(f"{label}: valore CSV mancante")
    return rows


def _validate_common(row: dict[str, str], label: str, *, expected_dataflow: str, pension_benefits: bool) -> None:
    expected = {
        "DATAFLOW": expected_dataflow, "FREQ": "A", "REF_AREA": "IT", "MONTHLY_AMOUNT_CLASS": "TOTAL",
        "SEX": "9", "AGE": "TOTAL", "OBS_STATUS": "", "NOTE_DS": "",
        "NOTE_REF_AREA": "", "NOTE_DATA_TYPE": "", "NOTE_PENSION_TYPE": "",
        "NOTE_MONTHLY_AMOUNT_CLASS": "", "NOTE_SEX": "", "NOTE_AGE": "",
        "NOTE_TIME_PERIOD": "", "BASE_PER": "", "UNIT_MEAS": "", "UNIT_MULT": "",
    }
    if pension_benefits:
        expected.update({
            "PENSIONER_SECTOR_PUBPRIV": "9",
            "EX_PROF_STATUS": "99",
            "NOTE_PENSIONER_SECTOR_PUBPRIV": "",
            "NOTE_EX_PROF_STATUS": "",
        })
    for key, expected_value in expected.items():
        if row.get(key) != expected_value:
            raise SnapshotError(f"{label}.{key} inatteso: {row.get(key)!r}")
    try:
        year = int(row["TIME_PERIOD"])
    except (KeyError, ValueError) as error:
        raise SnapshotError(f"{label}.TIME_PERIOD non valido") from error
    if year not in PENSION_YEARS:
        raise SnapshotError(f"{label}.TIME_PERIOD fuori copertura")
    _parse_decimal(row.get("OBS_VALUE", ""), f"{label}.OBS_VALUE")


def _number(value: Decimal, label: str) -> int | float:
    if value == value.to_integral_value():
        return int(value)
    result = float(value)
    if not (result >= 0 and result < float("inf")):
        raise SnapshotError(f"{label} fuori intervallo numerico")
    return result


def _validate_and_index(rows: list[dict[str, str]], *, label: str, expected_dataflow: str, pension_benefits: bool, data_types: set[str], categories: set[str], expected_count: int) -> dict[tuple[str, str, int], Decimal]:
    if len(rows) != expected_count:
        raise SnapshotError(f"{label}: attese {expected_count} righe, trovate {len(rows)}")
    indexed: dict[tuple[str, str, int], Decimal] = {}
    for index, row in enumerate(rows):
        row_label = f"{label}[{index}]"
        _validate_common(row, row_label, expected_dataflow=expected_dataflow, pension_benefits=pension_benefits)
        data_type = row.get("DATA_TYPE", "")
        category = row.get("PENSION_TYPE", "")
        year = int(row["TIME_PERIOD"])
        if data_type not in data_types or category not in categories:
            raise SnapshotError(f"{row_label}: data type/categoria non autorizzati")
        key = (data_type, category, year)
        if key in indexed:
            raise SnapshotError(f"{label}: riga duplicata {key}")
        indexed[key] = _parse_decimal(row["OBS_VALUE"], f"{row_label}.OBS_VALUE")
    expected_keys = {(data_type, category, year) for data_type in data_types for category in categories for year in PENSION_YEARS}
    if set(indexed) != expected_keys:
        raise SnapshotError(f"{label}: combinazioni data type/categoria/anno incomplete o extra")
    return indexed


def _validate_reconciliation(data: dict[str, Any]) -> None:
    rows = data["pensionBenefits"]["observations"]
    for row in rows:
        expected_mean = Decimal(str(row["grossAnnualThousandEuros"])) * Decimal(1000) / Decimal(row["pensionCount"])
        actual_mean = Decimal(str(row["grossAnnualMeanEuros"]))
        if abs(expected_mean - actual_mean) > Decimal("0.01"):
            raise SnapshotError(f"media pensione non riconcilia per {row['year']}/{row['pensionType']}")
    for reconciliation in data["pensionBenefits"]["amountReconciliations"]:
        if abs(reconciliation["deltaThousandEuros"]) > 2:
            raise SnapshotError(f"somma importi categorie fuori tolleranza per l'anno {reconciliation['year']}")
        if reconciliation["totalCount"] != reconciliation["categoryCount"]:
            raise SnapshotError(f"somma conteggi categorie non riconcilia per l'anno {reconciliation['year']}")
    for row in data["pensioners"]["observations"]:
        expected_mean = Decimal(str(row["grossAnnualThousandEuros"])) * Decimal(1000) / Decimal(row["pensionerCount"])
        actual_mean = Decimal(str(row["grossAnnualMeanEuros"]))
        if abs(expected_mean - actual_mean) > Decimal("0.01"):
            raise SnapshotError(f"media pensionati non riconcilia per l'anno {row['year']}")


def build_data(pensions_payload: bytes, pensioners_payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    assets = spec["source"]["assets"]
    pension_columns = assets["pensionBenefits"]["columns"]
    pensioner_columns = assets["pensioners"]["columns"]
    pension_rows = _read_csv(pensions_payload, "pensionBenefits", pension_columns, 21835, "e6479f690a4030dfbab3a19b07b8822ffc5d553bfaa94b70165ea81c0d0b1325")
    pensioner_rows = _read_csv(pensioners_payload, "pensioners", pensioner_columns, 2685, "1d11b46a3cf52456766487b566d3a371a36b32d15c3a79a7631ef146716fbd72")
    pension_index = _validate_and_index(pension_rows, label="pensionBenefits", expected_dataflow="IT1:46_813(1.0)", pension_benefits=True, data_types=PENSION_DATA_TYPES, categories=set(PENSION_CATEGORIES), expected_count=264)
    pensioner_index = _validate_and_index(pensioner_rows, label="pensioners", expected_dataflow="IT1:46_812(1.0)", pension_benefits=False, data_types=PENSIONER_DATA_TYPES, categories={"ALL"}, expected_count=33)

    benefits: list[dict[str, Any]] = []
    for year in PENSION_YEARS:
        for category in PENSION_CATEGORIES:
            count = pension_index["P_NSNU", category, year]
            amount = pension_index["ANP_NS", category, year]
            mean = pension_index["AMEP_NS", category, year]
            benefits.append({
                "year": year,
                "pensionType": category,
                "pensionCount": _number(count, "pensionCount"),
                "grossAnnualThousandEuros": _number(amount, "grossAnnualThousandEuros"),
                "grossAnnualMeanEuros": _number(mean, "grossAnnualMeanEuros"),
            })
    pensioners: list[dict[str, Any]] = []
    for year in PENSION_YEARS:
        pensioners.append({
            "year": year,
            "pensionType": "ALL",
            "pensionerCount": _number(pensioner_index["P_RSNU", "ALL", year], "pensionerCount"),
            "grossAnnualThousandEuros": _number(pensioner_index["ANP_RS", "ALL", year], "grossAnnualThousandEuros"),
            "grossAnnualMeanEuros": _number(pensioner_index["AMEP_RS", "ALL", year], "grossAnnualMeanEuros"),
        })

    amount_reconciliations = []
    for year in PENSION_YEARS:
        total = next(row for row in benefits if row["year"] == year and row["pensionType"] == "ALL")
        categories = [row for row in benefits if row["year"] == year and row["pensionType"] != "ALL"]
        amount_reconciliations.append({
            "year": year,
            "categoryCount": sum(row["pensionCount"] for row in categories),
            "totalCount": total["pensionCount"],
            "categoryGrossAnnualThousandEuros": sum(row["grossAnnualThousandEuros"] for row in categories),
            "totalGrossAnnualThousandEuros": total["grossAnnualThousandEuros"],
            "deltaThousandEuros": total["grossAnnualThousandEuros"] - sum(row["grossAnnualThousandEuros"] for row in categories),
        })

    data = {
        "schemaVersion": 1,
        "datasetId": "istat-pensions",
        "period": {"from": 2012, "to": 2022},
        "pensionBenefits": {"observations": benefits, "amountReconciliations": amount_reconciliations},
        "pensioners": {"observations": pensioners},
        "caveats": {
            "amounts": "Importi lordi annuali; la somma delle categorie ANP_NS può differire dal totale di pochi migliaia di euro per arrotondamenti della fonte.",
            "invalidityOverlap": "CIVDIS è mantenuto separato dall'invalidità civile INPS: fonte, periodo e perimetro non sono sommabili.",
            "nominal": "Valori nominali; non viene mostrata una variazione reale senza un deflatore verificato.",
        },
    }
    _validate_reconciliation(data)
    return data


def validate_snapshot(data: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != "istat-pensions" or data.get("period") != {"from": 2012, "to": 2022}:
        raise SnapshotError("schema/periodo snapshot inattesi")
    benefits = _dict(data.get("pensionBenefits"), "pensionBenefits")
    pensioners = _dict(data.get("pensioners"), "pensioners")
    benefit_rows = benefits.get("observations")
    pensioner_rows = pensioners.get("observations")
    if not isinstance(benefit_rows, list) or len(benefit_rows) != 88 or not isinstance(pensioner_rows, list) or len(pensioner_rows) != 11:
        raise SnapshotError("cardinalità snapshot inattesa")
    keys: set[tuple[int, str]] = set()
    for index, row in enumerate(benefit_rows):
        item = _dict(row, f"pensionBenefits.observations[{index}]")
        if set(item) != {"year", "pensionType", "pensionCount", "grossAnnualThousandEuros", "grossAnnualMeanEuros"}:
            raise SnapshotError("campi pensionBenefits inattesi")
        if item["year"] not in PENSION_YEARS or item["pensionType"] not in PENSION_CATEGORIES or not isinstance(item["pensionCount"], int) or item["pensionCount"] <= 0 or not isinstance(item["grossAnnualThousandEuros"], int) or item["grossAnnualThousandEuros"] < 0 or not isinstance(item["grossAnnualMeanEuros"], (int, float)):
            raise SnapshotError("valore pensionBenefits non valido")
        key = (item["year"], item["pensionType"])
        if key in keys:
            raise SnapshotError(f"osservazione pensionBenefits duplicata: {key}")
        keys.add(key)
    if keys != {(year, category) for year in PENSION_YEARS for category in PENSION_CATEGORIES}:
        raise SnapshotError("copertura pensionBenefits incompleta")
    pkeys: set[int] = set()
    for index, row in enumerate(pensioner_rows):
        item = _dict(row, f"pensioners.observations[{index}]")
        if set(item) != {"year", "pensionType", "pensionerCount", "grossAnnualThousandEuros", "grossAnnualMeanEuros"}:
            raise SnapshotError("campi pensioners inattesi")
        if item["year"] not in PENSION_YEARS or item["pensionType"] != "ALL" or not isinstance(item["pensionerCount"], int) or item["pensionerCount"] <= 0 or not isinstance(item["grossAnnualThousandEuros"], int) or item["grossAnnualThousandEuros"] < 0 or not isinstance(item["grossAnnualMeanEuros"], (int, float)):
            raise SnapshotError("valore pensioners non valido")
        if item["year"] in pkeys:
            raise SnapshotError(f"osservazione pensioners duplicata: {item['year']}")
        pkeys.add(item["year"])
    if pkeys != set(PENSION_YEARS):
        raise SnapshotError("copertura pensioners incompleta")
    reconciliations = benefits.get("amountReconciliations")
    if not isinstance(reconciliations, list) or len(reconciliations) != 11:
        raise SnapshotError("riconciliazioni importi mancanti")
    for item in reconciliations:
        row = _dict(item, "amountReconciliations[]")
        required = {"year", "categoryCount", "totalCount", "categoryGrossAnnualThousandEuros", "totalGrossAnnualThousandEuros", "deltaThousandEuros"}
        if set(row) != required or row["year"] not in PENSION_YEARS or not all(isinstance(row[key], int) for key in required - {"year"}):
            raise SnapshotError("riconciliazione importi non valida")
    _validate_reconciliation(data)


def build_metadata(data: dict[str, Any], spec: dict[str, Any], data_bytes: bytes) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "datasetId": "istat-pensions",
        "period": {"from": 2012, "to": 2022},
        "source": spec["source"],
        "transformation": {
            "version": 1,
            "description": "Le tre misure per ciascun flusso sono ricomposte per anno e categoria senza fondere pensioni e pensionati.",
            "pensionBenefitsRows": 88,
            "pensionerRows": 11,
            "units": {"grossAnnualThousandEuros": "migliaia di euro", "grossAnnualMeanEuros": "euro", "counts": "unità"},
        },
        "overlap": {
            "dataset": "inps_invalidita_civile",
            "relation": "CIVDIS ISTAT e invalidità civile INPS hanno fonte, periodo e perimetro diversi",
            "additive": False,
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {"path": "src/data/generated/istat-pensions-2012-2022.data.json", "bytes": len(data_bytes), "sha256": sha256_bytes(data_bytes)},
            "sourceLockSha256": spec["integrity"]["lockSha256"],
        },
    }


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(payload)
        handle.flush()
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_pair_atomically(data_path: Path, meta_path: Path, data_payload: bytes, meta_payload: bytes) -> None:
    data_backup = data_path.read_bytes() if data_path.exists() else None
    meta_backup = meta_path.read_bytes() if meta_path.exists() else None
    try:
        _write_atomic(data_path, data_payload)
        _write_atomic(meta_path, meta_payload)
    except Exception:
        if data_backup is None:
            data_path.unlink(missing_ok=True)
        else:
            _write_atomic(data_path, data_backup)
        if meta_backup is None:
            meta_path.unlink(missing_ok=True)
        else:
            _write_atomic(meta_path, meta_backup)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera e valida offline il bundle ISTAT pensioni/pensionati 2012-2022.")
    parser.add_argument("--check", action="store_true", help="Valida source lock e artefatti committati senza rete/input")
    parser.add_argument("--pensions-input", type=Path, help="Raw SDMX-CSV locale del flusso pensioni")
    parser.add_argument("--pensioners-input", type=Path, help="Raw SDMX-CSV locale del flusso pensionati")
    parser.add_argument("--observed-at", help="Timestamp ISO acquisito per entrambi gli asset")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data-output", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta-output", type=Path, default=DEFAULT_META)
    args = parser.parse_args()

    if args.check:
        spec = load_source_spec(args.spec)
        if not args.data_output.exists() or not args.meta_output.exists():
            raise SnapshotError("artefatti ISTAT pensioni mancanti")
        data = _load_json(args.data_output, "data artifact")
        meta = _load_json(args.meta_output, "metadata artifact")
        validate_snapshot(data)
        if meta.get("schemaVersion") != 1 or meta.get("datasetId") != "istat-pensions" or meta.get("period") != spec["period"] or meta.get("source") != spec["source"] or meta.get("integrity", {}).get("sourceLockSha256") != spec["integrity"]["lockSha256"]:
            raise SnapshotError("metadata non legata al source lock")
        data_bytes = canonical_bytes(data)
        if meta.get("integrity", {}).get("dataArtifact") != {"path": "src/data/generated/istat-pensions-2012-2022.data.json", "bytes": len(data_bytes), "sha256": sha256_bytes(data_bytes)}:
            raise SnapshotError("binding hash/bytes del data artifact non valido")
        if spec["integrity"]["dataArtifact"] != meta["integrity"]["dataArtifact"]:
            raise SnapshotError("source lock e metadata non concordano sul data artifact")
        print(f"OK {args.data_output} + {args.meta_output}: bundle ISTAT pensioni validato offline")
        return

    if args.pensions_input is None or args.pensioners_input is None or args.observed_at is None:
        parser.error("la generazione richiede --pensions-input, --pensioners-input e --observed-at")
    if not ISO_TIMESTAMP.fullmatch(args.observed_at):
        parser.error("--observed-at deve essere un timestamp ISO")
    spec = load_source_spec(args.spec, allow_unbound_artifact=True)
    validate_generation_observed_at(spec, args.observed_at)
    pension_payload = args.pensions_input.read_bytes()
    pensioner_payload = args.pensioners_input.read_bytes()
    data = build_data(pension_payload, pensioner_payload, spec)
    data_payload = canonical_bytes(data)
    expected_artifact = spec["integrity"]["dataArtifact"]
    expected_binding = {
        "path": "src/data/generated/istat-pensions-2012-2022.data.json",
        "bytes": len(data_payload),
        "sha256": sha256_bytes(data_payload),
    }
    if expected_artifact.get("bytes") != 0 and expected_artifact != expected_binding:
        raise SnapshotError("data artifact generato non coincide col source lock")
    metadata = build_metadata(data, spec, data_payload)
    meta_payload = canonical_bytes(metadata)
    _write_pair_atomically(args.data_output, args.meta_output, data_payload, meta_payload)
    print(f"Scritto {args.data_output} + {args.meta_output}: 88 pensioni e 11 righe pensionati")


if __name__ == "__main__":
    main()
