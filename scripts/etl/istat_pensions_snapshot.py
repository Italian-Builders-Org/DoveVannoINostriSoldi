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


NON_GEOGRAPHIC = ("ITTOT", "ITS", "ITNI")
TERRITORY_KINDS = {"totale", "country", "ripartizione", "regione", "provincia", "estero", "non-indicato"}


def _validate_territories(expected: dict[str, Any]) -> None:
    """L'anagrafica non e solo geografica: tre codici non sono territori."""
    territories = expected.get("territories")
    if not isinstance(territories, list) or len(territories) != 142:
        raise SnapshotError("anagrafica territoriale: attesi 142 codici")
    codes: set[str] = set()
    for entry in territories:
        item = _dict(entry, "expected.territories[]")
        code = _text(item.get("code"), "territory.code")
        if code in codes:
            raise SnapshotError(f"anagrafica: codice duplicato {code}")
        codes.add(code)
        if item.get("kind") not in TERRITORY_KINDS:
            raise SnapshotError(f"anagrafica: kind inatteso per {code}")
        geographic = item.get("geographic")
        if not isinstance(geographic, bool):
            raise SnapshotError(f"anagrafica: {code} non dichiara se e geografico")
        # ITTOT, ITS e ITNI non sono luoghi: vanno marcati, non dedotti.
        if (code in NON_GEOGRAPHIC) != (geographic is False):
            raise SnapshotError(f"anagrafica: {code} tipizzato in modo incoerente")
    for code in NON_GEOGRAPHIC:
        if code not in codes:
            raise SnapshotError(f"anagrafica: manca il codice non geografico {code}")

    identities = expected.get("territorialIdentities")
    if not isinstance(identities, list) or len(identities) != 2:
        raise SnapshotError("attese due identita territoriali dichiarate")
    for identity in identities:
        item = _dict(identity, "territorialIdentities[]")
        if item.get("exactOn") != "conteggi":
            raise SnapshotError("le identita territoriali devono dichiarare su cosa sono esatte")
        if item.get("whole") not in codes or not set(item.get("parts", [])) <= codes:
            raise SnapshotError("identita territoriale che cita codici fuori anagrafica")


def _validate_asset_lock(asset: dict[str, Any], label: str, *, expected_id: str, expected_title: str, expected_dataflow: str, expected_dsd: str, expected_rows: int, expected_bytes: int, expected_sha256: str, expected_header_sha256: str, expected_columns: list[str]) -> None:
    for key in ("id", "title", "url", "queryKey", "dataflowId", "dsd", "format", "encoding", "delimiter", "lineEnding", "observedAt"):
        _text(asset.get(key), f"{label}.{key}")
    if not asset["url"].startswith("https://esploradati.istat.it/SDMXWS/rest/data/"):
        raise SnapshotError(f"{label}.url non è l'endpoint ISTAT SDMX ufficiale")
    if asset["id"] != expected_id or asset["title"] != expected_title or asset["dataflowId"] != expected_dataflow or asset["dsd"] != expected_dsd:
        raise SnapshotError(f"{label}: dataflow/DSD non autorizzati")
    expected_key = {
        "IT1,46_813,1.0": "A..P_NSNU+ANP_NS+AMEP_NS.ALL+OLSEN1+SURV+DISAB1+CIVDIS+NOCONT+COMP+WAR.TOTAL.9.9.TOTAL.99",
        "IT1,46_812,1.0": "A..P_RSNU+ANP_RS+AMEP_RS.ALL.TOTAL.9.TOTAL",
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
        expected_rows=36672, expected_bytes=3035542,
        expected_sha256="7c18d7a3c4c952a71913dda4d29b2529d8900753fb5ae04a50e031f0b4896f26",
        expected_header_sha256="6314996849e1e4057a915ad2e569be3c304ec9a1b2ad76a57bc6ffce7ac7459e",
        expected_columns=expected_pension_columns,
    )
    _validate_asset_lock(
        _dict(assets.get("pensioners"), "source.assets.pensioners"),
        "source.assets.pensioners", expected_id="istat-pensioners-2012-2022", expected_title="Istat - Pensionati (Casellario dei pensionati)", expected_dataflow="IT1,46_812,1.0", expected_dsd="DCAR_PENSIONATI2",
        expected_rows=4611, expected_bytes=345803,
        expected_sha256="376d151aa54f7c282fede4a9980c1fe027746962f0def63ff566e74ea19ffdf1",
        expected_header_sha256="44a46feb3a8a987da32e6bfdc244ad7ed7877e76a31e37718dc92174b1f74cc9",
        expected_columns=expected_pensioner_columns,
    )

    expected = _dict(spec.get("expected"), "expected")
    if expected.get("years") != list(PENSION_YEARS) or expected.get("pensionCategories") != list(PENSION_CATEGORIES):
        raise SnapshotError("anni/categorie source lock inattesi")
    _validate_territories(expected)
    if expected.get("pensionBenefitRows") != 12224 or expected.get("pensionerRows") != 1537:
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


def _validate_common(row: dict[str, str], label: str, *, expected_dataflow: str, pension_benefits: bool, territories: set[str]) -> None:
    if row.get("REF_AREA") not in territories:
        raise SnapshotError(f"{label}.REF_AREA fuori anagrafica: {row.get('REF_AREA')!r}")
    expected = {
        "DATAFLOW": expected_dataflow, "FREQ": "A", "MONTHLY_AMOUNT_CLASS": "TOTAL",
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


def _validate_and_index(rows: list[dict[str, str]], *, label: str, expected_dataflow: str, pension_benefits: bool, data_types: set[str], categories: set[str], expected_count: int, territories: set[str]) -> dict[tuple[str, str, str, int], Decimal]:
    if len(rows) != expected_count:
        raise SnapshotError(f"{label}: attese {expected_count} righe, trovate {len(rows)}")
    indexed: dict[tuple[str, str, str, int], Decimal] = {}
    for index, row in enumerate(rows):
        row_label = f"{label}[{index}]"
        _validate_common(row, row_label, expected_dataflow=expected_dataflow, pension_benefits=pension_benefits, territories=territories)
        data_type = row.get("DATA_TYPE", "")
        territory = row["REF_AREA"]
        category = row.get("PENSION_TYPE", "")
        year = int(row["TIME_PERIOD"])
        if data_type not in data_types or category not in categories:
            raise SnapshotError(f"{row_label}: data type/categoria non autorizzati")
        key = (data_type, territory, category, year)
        if key in indexed:
            raise SnapshotError(f"{label}: riga duplicata {key}")
        indexed[key] = _parse_decimal(row["OBS_VALUE"], f"{row_label}.OBS_VALUE")
    # La griglia NON e un prodotto cartesiano: cinque territori sardi esistono solo
    # in parte del periodo per la riforma del 2016, e Estero e Non indicato non
    # hanno tutte le categorie. Si pretende invece che le tre misure stiano sempre
    # insieme: una cella con il conteggio ma senza importo sarebbe inutilizzabile.
    triples: dict[tuple[str, str, int], set[str]] = {}
    for data_type, territory, category, year in indexed:
        triples.setdefault((territory, category, year), set()).add(data_type)
    for cell, seen in triples.items():
        if seen != data_types:
            raise SnapshotError(f"{label}: misure incomplete per {cell}, trovate {sorted(seen)}")
    return indexed


def _mean_bound(count: int) -> Decimal:
    """Limite derivato, non scelto.

    Il totale e pubblicato in MIGLIAIA di euro arrotondate: l'incertezza sulla media
    derivata vale quindi 500 / conteggio euro, piu mezzo centesimo per
    l'arrotondamento della media stessa. A livello nazionale il limite e strettissimo;
    su una cella con poche pensioni si allarga quanto la fonte impone, e non oltre.
    """
    return Decimal(500) / Decimal(count) + Decimal("0.005")


def _validate_reconciliation(data: dict[str, Any]) -> None:
    for scope, count_field in (("pensionBenefits", "pensionCount"), ("pensioners", "pensionerCount")):
        for row in data[scope]["observations"]:
            count = row[count_field]
            if count <= 0:
                raise SnapshotError(f"{scope}: conteggio non positivo in {row['territory']}/{row['year']}")
            expected_mean = Decimal(str(row["grossAnnualThousandEuros"])) * Decimal(1000) / Decimal(count)
            actual_mean = Decimal(str(row["grossAnnualMeanEuros"]))
            if abs(expected_mean - actual_mean) > _mean_bound(count):
                raise SnapshotError(
                    f"{scope}: media non riconcilia per {row['territory']}/{row['year']}/{row['pensionType']} "
                    f"oltre il limite di arrotondamento"
                )

    benefit_cells = {
        (row["territory"], row["year"], row["pensionType"]): row
        for row in data["pensionBenefits"]["observations"]
    }
    expected_reconciliations = {
        (territory, year)
        for territory, year, category in benefit_cells
        if category == "ALL" and all(
            (territory, year, kind) in benefit_cells for kind in PENSION_CATEGORIES
        )
    }
    seen_reconciliations: set[tuple[str, int]] = set()
    for reconciliation in data["pensionBenefits"]["amountReconciliations"]:
        key = (reconciliation["territory"], reconciliation["year"])
        if key in seen_reconciliations or key not in expected_reconciliations:
            raise SnapshotError("riconciliazione duplicata o fuori perimetro")
        seen_reconciliations.add(key)
        total = benefit_cells[(*key, "ALL")]
        categories = [benefit_cells[(*key, kind)] for kind in PENSION_CATEGORIES if kind != "ALL"]
        category_count = sum(row["pensionCount"] for row in categories)
        category_amount = sum(row["grossAnnualThousandEuros"] for row in categories)
        if (
            reconciliation["categoryCount"] != category_count
            or reconciliation["totalCount"] != total["pensionCount"]
            or reconciliation["categoryGrossAnnualThousandEuros"] != category_amount
            or reconciliation["totalGrossAnnualThousandEuros"] != total["grossAnnualThousandEuros"]
            or reconciliation["deltaThousandEuros"] != total["grossAnnualThousandEuros"] - category_amount
        ):
            raise SnapshotError("riconciliazione non coerente con le righe")
        where = f"{reconciliation['territory']}/{reconciliation['year']}"
        if abs(reconciliation["deltaThousandEuros"]) > 2:
            raise SnapshotError(f"somma importi categorie fuori tolleranza per {where}")
        if reconciliation["totalCount"] != reconciliation["categoryCount"]:
            raise SnapshotError(f"somma conteggi categorie non riconcilia per {where}")

    if seen_reconciliations != expected_reconciliations:
        raise SnapshotError("riconciliazioni incomplete")

    # Le identita territoriali sono ESATTE sui conteggi, che sono numeri interi di
    # pensioni. Sugli IMPORTI no: la fonte li pubblica in migliaia di euro
    # arrotondate, quindi sommare le parti puo scostarsi di qualche unita. Il limite
    # e derivato dall'arrotondamento — mezza unita per ciascuna parte piu mezza per
    # il totale — non scelto a occhio.
    by_cell = {(r["territory"], r["year"]): r for r in data["pensionBenefits"]["observations"] if r["pensionType"] == "ALL"}
    for identity in data["territorialIdentities"]:
        whole, parts = identity["whole"], identity["parts"]
        amount_bound = -(-(len(parts) + 1) // 2)
        for year in PENSION_YEARS:
            total = by_cell.get((whole, year))
            if total is None:
                continue
            pieces = [by_cell.get((part, year)) for part in parts]
            if any(piece is None for piece in pieces):
                raise SnapshotError(f"identita {whole}: manca una parte nell'anno {year}")
            if total["pensionCount"] != sum(piece["pensionCount"] for piece in pieces):
                raise SnapshotError(
                    f"identita {whole} = {' + '.join(parts)} non esatta sui conteggi nell'anno {year}"
                )
            delta = abs(total["grossAnnualThousandEuros"] - sum(piece["grossAnnualThousandEuros"] for piece in pieces))
            if delta > amount_bound:
                raise SnapshotError(
                    f"identita {whole}: scarto {delta} migliaia sugli importi nell'anno {year}, "
                    f"oltre il limite di arrotondamento {amount_bound}"
                )


def build_data(pensions_payload: bytes, pensioners_payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    assets = spec["source"]["assets"]
    expected = spec["expected"]
    territories = [dict(t) for t in expected["territories"]]
    territory_codes = {t["code"] for t in territories}
    pension_columns = assets["pensionBenefits"]["columns"]
    pensioner_columns = assets["pensioners"]["columns"]
    pension_rows = _read_csv(pensions_payload, "pensionBenefits", pension_columns, 3035542, "7c18d7a3c4c952a71913dda4d29b2529d8900753fb5ae04a50e031f0b4896f26")
    pensioner_rows = _read_csv(pensioners_payload, "pensioners", pensioner_columns, 345803, "376d151aa54f7c282fede4a9980c1fe027746962f0def63ff566e74ea19ffdf1")
    pension_index = _validate_and_index(pension_rows, label="pensionBenefits", expected_dataflow="IT1:46_813(1.0)", pension_benefits=True, data_types=PENSION_DATA_TYPES, categories=set(PENSION_CATEGORIES), expected_count=36672, territories=territory_codes)
    pensioner_index = _validate_and_index(pensioner_rows, label="pensioners", expected_dataflow="IT1:46_812(1.0)", pension_benefits=False, data_types=PENSIONER_DATA_TYPES, categories={"ALL"}, expected_count=4611, territories=territory_codes)

    # Si itera su cio che la fonte pubblica, non su un prodotto cartesiano: la
    # copertura e per territorio (riforma sarda 2016) e per categoria (Estero e
    # Non indicato non hanno tutte le tipologie).
    benefits: list[dict[str, Any]] = []
    for territory, category, year in sorted({(t, c, y) for _, t, c, y in pension_index}):
        benefits.append({
            "territory": territory,
            "year": year,
            "pensionType": category,
            "pensionCount": _number(pension_index["P_NSNU", territory, category, year], "pensionCount"),
            "grossAnnualThousandEuros": _number(pension_index["ANP_NS", territory, category, year], "grossAnnualThousandEuros"),
            "grossAnnualMeanEuros": _number(pension_index["AMEP_NS", territory, category, year], "grossAnnualMeanEuros"),
        })
    pensioners: list[dict[str, Any]] = []
    for territory, category, year in sorted({(t, c, y) for _, t, c, y in pensioner_index}):
        pensioners.append({
            "territory": territory,
            "year": year,
            "pensionType": category,
            "pensionerCount": _number(pensioner_index["P_RSNU", territory, category, year], "pensionerCount"),
            "grossAnnualThousandEuros": _number(pensioner_index["ANP_RS", territory, category, year], "grossAnnualThousandEuros"),
            "grossAnnualMeanEuros": _number(pensioner_index["AMEP_RS", territory, category, year], "grossAnnualMeanEuros"),
        })

    by_cell = {(row["territory"], row["year"], row["pensionType"]): row for row in benefits}
    amount_reconciliations = []
    for territory in sorted(territory_codes):
        for year in PENSION_YEARS:
            total = by_cell.get((territory, year, "ALL"))
            if total is None:
                continue
            parts = [by_cell[(territory, year, c)] for c in PENSION_CATEGORIES if c != "ALL" and (territory, year, c) in by_cell]
            if len(parts) != len(PENSION_CATEGORIES) - 1:
                continue
            amount_reconciliations.append({
                "territory": territory,
                "year": year,
                "categoryCount": sum(row["pensionCount"] for row in parts),
                "totalCount": total["pensionCount"],
                "categoryGrossAnnualThousandEuros": sum(row["grossAnnualThousandEuros"] for row in parts),
                "totalGrossAnnualThousandEuros": total["grossAnnualThousandEuros"],
                "deltaThousandEuros": total["grossAnnualThousandEuros"] - sum(row["grossAnnualThousandEuros"] for row in parts),
            })

    data = {
        "schemaVersion": 1,
        "datasetId": "istat-pensions",
        "period": {"from": 2012, "to": 2022},
        "territories": territories,
        "territorialIdentities": [dict(i) for i in expected["territorialIdentities"]],
        "territorialNotes": dict(expected["territorialNotes"]),
        # La copertura NON e uniforme fra i due asset: le province sarde soppresse
        # chiudono nel 2016 sulle pensioni e nel 2017 sui pensionati.
        "partialCoverage": {
            name: {code: list(span) for code, span in assets[name].get("partialCoverage", {}).items()}
            for name in ("pensionBenefits", "pensioners")
        },
        "pensionBenefits": {"observations": benefits, "amountReconciliations": amount_reconciliations},
        "pensioners": {"observations": pensioners},
        "caveats": {
            "amounts": "Importi lordi annuali; la somma delle categorie ANP_NS può differire dal totale di pochi migliaia di euro per arrotondamenti della fonte.",
            "invalidityOverlap": "CIVDIS è mantenuto separato dall'invalidità civile INPS: fonte, periodo e perimetro non sono sommabili.",
            "nominal": "Valori nominali; non viene mostrata una variazione reale senza un deflatore verificato.",
            "nonGeographic": "ITTOT non è l'Italia: è Italia più Estero (ITS) più Non indicato (ITNI). Nessuno dei tre è un luogo e non vanno messi su una mappa né sommati alle regioni.",
            "partialCoverage": "Cinque territori coprono solo parte del periodo per la riforma delle province sarde del 2016: non sono dati mancanti.",
            "derivedMean": "La media pubblicata è coerente col totale diviso il conteggio entro l'arrotondamento del totale al migliaio di euro, che su celle piccole vale parecchi euro per pensione.",
        },
    }
    _validate_reconciliation(data)
    return data


def validate_snapshot(data: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != "istat-pensions" or data.get("period") != {"from": 2012, "to": 2022}:
        raise SnapshotError("schema/periodo snapshot inattesi")
    territories = data.get("territories")
    if not isinstance(territories, list) or len(territories) != 142:
        raise SnapshotError("anagrafica territoriale assente dallo snapshot")
    territory_codes = {t["code"] for t in territories}
    non_geographic = {t["code"] for t in territories if t.get("geographic") is False}
    if non_geographic != set(NON_GEOGRAPHIC):
        raise SnapshotError("i codici non geografici devono restare marcati come tali")
    coverage = data.get("partialCoverage")
    if not isinstance(coverage, dict) or set(coverage) != {"pensionBenefits", "pensioners"}:
        raise SnapshotError("copertura parziale non dichiarata per asset")

    benefits = _dict(data.get("pensionBenefits"), "pensionBenefits")
    pensioners = _dict(data.get("pensioners"), "pensioners")
    benefit_rows = benefits.get("observations")
    pensioner_rows = pensioners.get("observations")
    if not isinstance(benefit_rows, list) or len(benefit_rows) != 12224 or not isinstance(pensioner_rows, list) or len(pensioner_rows) != 1537:
        raise SnapshotError("cardinalità snapshot inattesa")

    def check(rows: list[Any], label: str, count_field: str, categories: set[str]) -> set[tuple[str, int, str]]:
        seen: set[tuple[str, int, str]] = set()
        for index, row in enumerate(rows):
            item = _dict(row, f"{label}.observations[{index}]")
            if set(item) != {"territory", "year", "pensionType", count_field, "grossAnnualThousandEuros", "grossAnnualMeanEuros"}:
                raise SnapshotError(f"campi {label} inattesi")
            if item["territory"] not in territory_codes:
                raise SnapshotError(f"{label}: territorio fuori anagrafica {item['territory']}")
            if item["year"] not in PENSION_YEARS or item["pensionType"] not in categories:
                raise SnapshotError(f"{label}: anno o categoria non validi")
            # Un territorio non puo comparire fuori dalla sua copertura dichiarata:
            # e cosi che la riforma sarda del 2016 resta un fatto e non un buco.
            low, high = coverage[label].get(item["territory"], [2012, 2022])
            if not low <= item["year"] <= high:
                raise SnapshotError(f"{label}: {item['territory']} fuori dalla copertura dichiarata nel {item['year']}")
            if not isinstance(item[count_field], int) or item[count_field] <= 0:
                raise SnapshotError(f"{label}: conteggio non valido")
            if not isinstance(item["grossAnnualThousandEuros"], int) or item["grossAnnualThousandEuros"] < 0:
                raise SnapshotError(f"{label}: importo non valido")
            if not isinstance(item["grossAnnualMeanEuros"], (int, float)):
                raise SnapshotError(f"{label}: media non valida")
            key = (item["territory"], item["year"], item["pensionType"])
            if key in seen:
                raise SnapshotError(f"osservazione {label} duplicata: {key}")
            seen.add(key)
        return seen

    check(benefit_rows, "pensionBenefits", "pensionCount", set(PENSION_CATEGORIES))
    check(pensioner_rows, "pensioners", "pensionerCount", {"ALL"})

    reconciliations = benefits.get("amountReconciliations")
    if not isinstance(reconciliations, list) or not reconciliations:
        raise SnapshotError("riconciliazioni importi mancanti")
    for item in reconciliations:
        row = _dict(item, "amountReconciliations[]")
        required = {"territory", "year", "categoryCount", "totalCount", "categoryGrossAnnualThousandEuros", "totalGrossAnnualThousandEuros", "deltaThousandEuros"}
        if set(row) != required or row["year"] not in PENSION_YEARS or row["territory"] not in territory_codes:
            raise SnapshotError("riconciliazione importi non valida")
        if not all(isinstance(row[key], int) for key in required - {"year", "territory"}):
            raise SnapshotError("riconciliazione importi non numerica")

    identities = data.get("territorialIdentities")
    if not isinstance(identities, list) or len(identities) != 2:
        raise SnapshotError("identità territoriali assenti dallo snapshot")
    _validate_reconciliation(data)


def build_metadata(data: dict[str, Any], spec: dict[str, Any], data_bytes: bytes) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "datasetId": "istat-pensions",
        "period": {"from": 2012, "to": 2022},
        "source": spec["source"],
        "transformation": {
            "version": 1,
            "description": "Le tre misure per ciascun flusso sono ricomposte per territorio, anno e categoria senza fondere pensioni e pensionati.",
            "pensionBenefitsRows": len(data["pensionBenefits"]["observations"]),
            "pensionerRows": len(data["pensioners"]["observations"]),
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
        if meta.get("transformation") != build_metadata(data, spec, canonical_bytes(data))["transformation"]:
            raise SnapshotError("metadati della trasformazione non coerenti con le righe territoriali")
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
    print(
        f"Scritto {args.data_output} + {args.meta_output}: "
        f"{len(data['pensionBenefits']['observations'])} righe pensioni e "
        f"{len(data['pensioners']['observations'])} pensionati su "
        f"{len(data['territories'])} territori"
    )


if __name__ == "__main__":
    main()
