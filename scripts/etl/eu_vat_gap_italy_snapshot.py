#!/usr/bin/env python3
"""Build the source-locked DG TAXUD VAT gap Italy snapshot (IT sheet only).

Reads the official XLSX of country-chapter tables for *VAT gap in Europe —
Report 2025*. Runtime and CI stay offline: URL, bytes, SHA-256, sheet member,
labels and cell pins live in the source lock.

Money is converted exactly from whole million euro to euro-cents. Compliance
gap shares are fractions of VTTL: IEEE float noise in the workbook is rounded
to three decimal places (source presentation) then stored as millionths of
unity. Empty cells and the marker ``X`` stay non-observed and are never zero.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

import integrated_curated_datasets as corpus
from monetary import MoneyPolicy, decimal_to_cents

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eu-vat-gap-italy.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eu-vat-gap-italy.data.json"
DEFAULT_META = ROOT / "src/data/generated/eu-vat-gap-italy.meta.json"
DATASET_ID = "eu-vat-gap-italy"
OFFICIAL_PREFIX = "https://taxation-customs.ec.europa.eu/"
OP_PREFIX = "https://op.europa.eu/"
SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
OFFICE_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
INTEGER = re.compile(r"-?(?:0|[1-9][0-9]*)\Z")
SHARE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z")
MAX_SAFE = 9_007_199_254_740_991
MILLION_EURO_TO_CENTS = Decimal(100_000_000)
SHARE_QUANTUM = Decimal("0.001")
SHARE_SCALE = Decimal(1_000_000)

CAVEATS = (
    "Il VAT compliance gap DG TAXUD è una stima di compliance rispetto al VTTL, non evasione accertata e non un pagamento o uno stanziamento.",
    "Questa slice pubblica soltanto il foglio IT: nessuna media UE e nessun confronto con altri paesi ricostruito qui.",
    "Il 2024 è una stima rapida (etichetta sorgente «2024 (e)»); non è omogeneo ai valori 2019-2023 senza avvertenza.",
    "VTTL, gettito IVA (VAT revenue) e gap sono nature distinte della stessa tavola: non si sommano ad altre fonti (MEF IVA dichiarata, tax gap MEF, ISTAT economia non osservata).",
    "Le celle vuote e il marcatore «X» restano non osservate: non diventano zero e non si ricostruiscono per differenza.",
    "La somma delle componenti o/w del VTTL può scostarsi di ±1 milione di euro rispetto al VTTL pubblicato (arrotondamento della fonte); VTTL − VAT revenue = compliance gap resta esatto.",
    "La licenza del workbook XLSX non è dichiarata sul file; il PDF documentale è citato come evidenza CC BY 4.0 senza inventare un license id per l'XLSX.",
)
COMPOSITION_TOLERANCE_CENTS = 100_000_000  # ±1 million euro source rounding

MONEY_POLICY = MoneyPolicy(
    pattern=re.compile(r".*"),
    decimal_separator=".",
    unit="euros",
    allow_negative=True,
    rounding="reject",
    strip_whitespace=True,
)


class SnapshotError(ValueError):
    """Schema, provenance or cell drift blocks publication."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    clone = json.loads(json.dumps(lock))
    clone["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(clone))


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "not-declared":
        raise SnapshotError("source lock: licenza XLSX deve restare not-declared")
    if not str(source.get("url", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: URL download non ufficiale DG TAXUD")
    if not str(source.get("landingUrl", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: landing non ufficiale DG TAXUD")
    for evidence in source.get("evidenceUrls") or []:
        if not (
            str(evidence).startswith(OFFICIAL_PREFIX) or str(evidence).startswith(OP_PREFIX)
        ):
            raise SnapshotError("source lock: evidence URL non ufficiale")
    if not isinstance(source.get("bytes"), int) or source["bytes"] <= 0:
        raise SnapshotError("source lock: bytes non validi")
    digest = str(source.get("sha256", ""))
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise SnapshotError("source lock: sha256 non valido")
    workbook = spec.get("workbook") or {}
    if workbook.get("italySheetName") != "IT":
        raise SnapshotError("source lock: foglio IT obbligatorio")
    if canonical_lock_sha256(spec) != (spec.get("integrity") or {}).get("lockSha256"):
        raise SnapshotError("source lock: lockSha256 divergente")
    return spec


def verified_payload(spec: dict[str, Any], path: Path | None = None) -> bytes:
    source = spec["source"]
    source_path = path or ROOT / source["path"]
    payload = source_path.read_bytes()
    if len(payload) != source["bytes"] or sha256_bytes(payload) != source["sha256"]:
        raise SnapshotError("byte sorgente divergenti dal lock")
    return payload


def workbook_italy_cells(payload: bytes, spec: dict[str, Any]) -> dict[str, str | None]:
    workbook_spec = spec["workbook"]
    try:
        archive = ZipFile(io.BytesIO(payload))
    except BadZipFile as error:
        raise SnapshotError("sorgente non è un XLSX valido") from error
    with archive:
        try:
            workbook = corpus.safe_xml(archive.read(workbook_spec["member"]), DATASET_ID, workbook_spec["member"])
            relationships = corpus.safe_xml(
                archive.read(workbook_spec["relationshipsMember"]),
                DATASET_ID,
                workbook_spec["relationshipsMember"],
            )
            shared_tree = corpus.safe_xml(
                archive.read(workbook_spec["sharedStringsMember"]),
                DATASET_ID,
                workbook_spec["sharedStringsMember"],
            )
        except KeyError as error:
            raise SnapshotError("membro obbligatorio XLSX mancante") from error

        shared = ["".join(node.text or "" for node in item.iter(SHEET_NS + "t")) for item in shared_tree]
        targets = {
            node.attrib["Id"]: node.attrib["Target"]
            for node in relationships.findall(PACKAGE_REL_NS + "Relationship")
            if node.attrib.get("Type", "").endswith("/worksheet")
        }
        sheet_nodes = workbook.find(SHEET_NS + "sheets")
        if sheet_nodes is None:
            raise SnapshotError("elenco fogli XLSX mancante")
        names = [node.attrib.get("name") for node in list(sheet_nodes)]
        if names != workbook_spec["expectedSheetNames"]:
            raise SnapshotError("nomi o ordine dei fogli divergenti")

        italy = next((node for node in list(sheet_nodes) if node.attrib.get("name") == "IT"), None)
        if italy is None:
            raise SnapshotError("foglio IT assente")
        relationship_id = italy.attrib.get(OFFICE_REL_NS + "id")
        target = targets.get(relationship_id or "")
        member = "xl/" + target if target else ""
        if member != workbook_spec["italySheetMember"]:
            raise SnapshotError("relazione del foglio IT divergente")
        try:
            tree = corpus.safe_xml(archive.read(member), DATASET_ID, member)
        except KeyError as error:
            raise SnapshotError("foglio IT XLSX mancante") from error

        observed: dict[str, str | None] = {}
        for cell in tree.iter(SHEET_NS + "c"):
            reference = cell.attrib.get("r", "")
            if corpus.XLSX_CELL_RE.fullmatch(reference) is None or reference in observed:
                raise SnapshotError(f"riferimento cella invalido o duplicato: IT!{reference}")
            if cell.find(SHEET_NS + "f") is not None or cell.attrib.get("t") not in {None, "n", "s"}:
                raise SnapshotError(f"formula o tipo cella inatteso: IT!{reference}")
            value = corpus.xlsx_cell_value(cell, shared)
            if value is not None and not isinstance(value, str):
                raise SnapshotError(f"valore cella non stringa: IT!{reference}")
            observed[reference] = value
        return observed


def cell(cells: dict[str, str | None], reference: str) -> str | None:
    return cells.get(reference)


def require_label(cells: dict[str, str | None], reference: str, expected: str) -> None:
    actual = cell(cells, reference)
    if actual != expected:
        raise SnapshotError(f"etichetta {reference}: {actual!r} != {expected!r}")


def money_cell(raw: str | None, where: str, *, allow_negative: bool = False) -> dict[str, Any]:
    if raw is None or raw == "":
        return {"value": None, "status": "missing"}
    if raw == "X":
        return {"value": None, "status": "unavailable"}
    if INTEGER.fullmatch(raw) is None:
        raise SnapshotError(f"{where}: milione di euro non intero {raw!r}")
    try:
        millions = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotError(f"{where}: milione di euro non numerico") from error
    euros = millions * Decimal(1_000_000)
    policy = MONEY_POLICY if allow_negative else MoneyPolicy(
        pattern=MONEY_POLICY.pattern,
        decimal_separator=".",
        unit="euros",
        allow_negative=False,
        rounding="reject",
        strip_whitespace=True,
    )
    cents = decimal_to_cents(euros, policy)
    if abs(cents) > MAX_SAFE:
        raise SnapshotError(f"{where}: fuori dal range sicuro")
    if cents % 100_000_000 and millions != 0:
        # Whole million euro must land on exact cent quanta of 1e8.
        raise SnapshotError(f"{where}: conversione milione→centesimi non esatta")
    return {"value": cents, "status": "observed"}


def share_cell(raw: str | None, where: str) -> dict[str, Any]:
    if raw is None or raw == "":
        return {"value": None, "status": "missing"}
    if raw == "X":
        return {"value": None, "status": "unavailable"}
    if SHARE.fullmatch(raw) is None:
        raise SnapshotError(f"{where}: quota non numerica {raw!r}")
    try:
        decimal = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotError(f"{where}: quota non numerica") from error
    rounded = decimal.quantize(SHARE_QUANTUM, rounding=ROUND_HALF_EVEN)
    scaled = rounded * SHARE_SCALE
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"{where}: precisione oltre il quantum dichiarato")
    value = int(scaled)
    if abs(value) > MAX_SAFE:
        raise SnapshotError(f"{where}: fuori dal range sicuro")
    return {"value": value, "status": "observed"}


def parse_change_pp(raw: str | None, where: str) -> dict[str, Any]:
    if raw is None or raw == "":
        return {"value": None, "status": "missing", "sourceText": None}
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?)pp", raw)
    if match is None:
        raise SnapshotError(f"{where}: variazione pp inattesa {raw!r}")
    decimal = Decimal(match.group(1))
    tenths = decimal * Decimal(10)
    if tenths != tenths.to_integral_value():
        raise SnapshotError(f"{where}: precisione pp oltre i decimi")
    return {"value": int(tenths), "status": "observed", "sourceText": raw}


def build_data(cells: dict[str, str | None], spec: dict[str, Any]) -> dict[str, Any]:
    expected = spec["expected"]
    require_label(cells, "A2", expected["sectionTitle"])
    years_meta = expected["years"]
    for index, year in enumerate(years_meta):
        column = "BCDEFG"[index]
        label = cell(cells, f"{column}1")
        if label != year["sourceYearLabel"]:
            raise SnapshotError(f"anno colonna {column}1: {label!r} != {year['sourceYearLabel']!r}")

    composition_defs = expected["vttlComposition"]
    for entry in composition_defs:
        require_label(cells, f"A{entry['row']}", entry["sourceLabel"])

    for row, label in expected["coreLabels"].items():
        require_label(cells, f"A{row}", label)

    years: list[dict[str, Any]] = []
    for index, year in enumerate(years_meta):
        column = "BCDEFG"[index]
        where = f"{year['year']}"
        vttl = money_cell(cell(cells, f"{column}3"), f"VTTL {where}")
        revenue = money_cell(cell(cells, f"{column}9"), f"VAT revenue {where}")
        gap = money_cell(cell(cells, f"{column}10"), f"compliance gap {where}")
        share = share_cell(cell(cells, f"{column}11"), f"compliance gap share {where}")
        if vttl["status"] != "observed" or revenue["status"] != "observed" or gap["status"] != "observed":
            raise SnapshotError(f"{where}: VTTL/revenue/gap devono essere osservati")
        if vttl["value"] - revenue["value"] != gap["value"]:
            raise SnapshotError(f"{where}: VTTL − VAT revenue ≠ compliance gap")
        if share["status"] != "observed":
            raise SnapshotError(f"{where}: quota gap deve essere osservata")

        composition = []
        composition_sum = 0
        composition_complete = True
        for entry in composition_defs:
            amount = money_cell(
                cell(cells, f"{column}{entry['row']}"),
                f"{entry['id']} {where}",
                allow_negative=bool(entry.get("allowNegative")),
            )
            if year["year"] == 2024 and amount["status"] != "unavailable":
                raise SnapshotError(f"{where}: composizione 2024 deve restare X/unavailable")
            if year["year"] != 2024 and amount["status"] != "observed":
                raise SnapshotError(f"{where}: composizione 2019-2023 deve essere osservata")
            if amount["status"] == "observed":
                composition_sum += amount["value"]
            else:
                composition_complete = False
            composition.append(
                {
                    "id": entry["id"],
                    "sourceLabel": entry["sourceLabel"],
                    "amountCents": amount,
                }
            )
        if composition_complete and abs(composition_sum - vttl["value"]) > COMPOSITION_TOLERANCE_CENTS:
            raise SnapshotError(f"{where}: somma composizione VTTL oltre la tolleranza fonte")

        years.append(
            {
                "year": year["year"],
                "estimateKind": year["estimateKind"],
                "sourceYearLabel": year["sourceYearLabel"],
                "vttlCents": vttl,
                "vatRevenueCents": revenue,
                "complianceGapCents": gap,
                "complianceGapShareMillionths": share,
                "vttlComposition": composition,
            }
        )

    change = expected["gapChangeSince2019"]
    require_label(cells, f"A{change['row']}", change["sourceLabel"])
    for column, year in zip("BCDEG", (2019, 2020, 2021, 2022, 2024), strict=True):
        if cell(cells, f"{column}{change['row']}") not in (None, ""):
            raise SnapshotError(f"variazione gap presente fuori da {change['asOfYear']}")
    parsed_change = parse_change_pp(cell(cells, f"F{change['row']}"), "gap change since 2019")
    if parsed_change["status"] != "observed" or parsed_change["value"] != change["valueTenthsOfPp"]:
        raise SnapshotError("variazione gap since 2019 divergente dal lock")

    data = {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "geography": {"code": "IT", "label": "Italia"},
        "period": {"from": 2019, "to": 2024},
        "units": {
            "money": "euro-cents",
            "sourceMoney": "million-euro",
            "complianceGapShare": "millionths-of-unity",
            "gapChange": "tenths-of-a-percentage-point",
        },
        "caveats": list(CAVEATS),
        "years": years,
        "gapChangeSince2019": {
            "asOfYear": change["asOfYear"],
            "sourceLabel": change["sourceLabel"],
            "valueTenthsOfPp": {
                "value": parsed_change["value"],
                "status": parsed_change["status"],
            },
            "sourceText": parsed_change["sourceText"],
        },
    }
    validate_data(data, spec)
    return data


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != DATASET_ID:
        raise SnapshotError("data: identità inattesa")
    if data.get("caveats") != list(CAVEATS):
        raise SnapshotError("data: caveats divergenti")
    if data.get("period") != {"from": 2019, "to": 2024}:
        raise SnapshotError("data: periodo inatteso")
    years = data.get("years")
    if not isinstance(years, list) or len(years) != 6:
        raise SnapshotError("data: copertura anni inattesa")
    expected_years = spec["expected"]["years"]
    for row, locked in zip(years, expected_years, strict=True):
        if row.get("year") != locked["year"] or row.get("estimateKind") != locked["estimateKind"]:
            raise SnapshotError("data: anno o stima rapida divergente")
        if row.get("sourceYearLabel") != locked["sourceYearLabel"]:
            raise SnapshotError("data: etichetta anno sorgente divergente")
        for field in ("vttlCents", "vatRevenueCents", "complianceGapCents", "complianceGapShareMillionths"):
            cell_value = row.get(field)
            if not isinstance(cell_value, dict) or set(cell_value) != {"value", "status"}:
                raise SnapshotError(f"data: schema cella {field}")
            if cell_value["status"] != "observed" or type(cell_value["value"]) is not int:
                raise SnapshotError(f"data: cella core non osservata {field}")
            if abs(cell_value["value"]) > MAX_SAFE:
                raise SnapshotError(f"data: overflow {field}")
        if row["vttlCents"]["value"] - row["vatRevenueCents"]["value"] != row["complianceGapCents"]["value"]:
            raise SnapshotError("data: riconciliazione gap fallita")
        composition = row.get("vttlComposition")
        if not isinstance(composition, list) or len(composition) != len(spec["expected"]["vttlComposition"]):
            raise SnapshotError("data: composizione VTTL incompleta")
        total = 0
        complete = True
        for item, locked_item in zip(composition, spec["expected"]["vttlComposition"], strict=True):
            if item.get("id") != locked_item["id"] or item.get("sourceLabel") != locked_item["sourceLabel"]:
                raise SnapshotError("data: composizione id/label divergente")
            amount = item.get("amountCents")
            if not isinstance(amount, dict) or set(amount) != {"value", "status"}:
                raise SnapshotError("data: schema composizione")
            if amount["status"] == "observed":
                if type(amount["value"]) is not int:
                    raise SnapshotError("data: composizione non intera")
                total += amount["value"]
            elif amount["status"] in {"missing", "unavailable"}:
                if amount["value"] is not None:
                    raise SnapshotError("data: composizione assente ricostruita")
                complete = False
            else:
                raise SnapshotError("data: stato composizione sconosciuto")
            if row["year"] == 2024 and amount["status"] != "unavailable":
                raise SnapshotError("data: composizione 2024 deve restare unavailable")
            if row["year"] != 2024 and amount["status"] != "observed":
                raise SnapshotError("data: composizione 2019-2023 deve essere osservata")
        if complete and abs(total - row["vttlCents"]["value"]) > COMPOSITION_TOLERANCE_CENTS:
            raise SnapshotError("data: somma composizione oltre la tolleranza fonte")
        if row["year"] == 2024 and complete:
            raise SnapshotError("data: composizione 2024 non può essere completa")
    change = data.get("gapChangeSince2019")
    locked_change = spec["expected"]["gapChangeSince2019"]
    if not isinstance(change, dict):
        raise SnapshotError("data: gapChangeSince2019 mancante")
    if change.get("asOfYear") != locked_change["asOfYear"]:
        raise SnapshotError("data: asOfYear divergente")
    if change.get("sourceText") != "-4.2pp":
        raise SnapshotError("data: sourceText variazione divergente")
    value = change.get("valueTenthsOfPp")
    if not isinstance(value, dict) or value.get("status") != "observed" or value.get("value") != locked_change["valueTenthsOfPp"]:
        raise SnapshotError("data: variazione pp divergente")


def metadata(spec: dict[str, Any], payload: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": data["period"],
        "observedAt": source["acquiredAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "url": source["url"],
            "filename": source["filename"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "evidenceUrls": list(source["evidenceUrls"]),
            "publicationDate": source["publicationDate"],
            "acquiredAt": source["acquiredAt"],
            "checkedAt": source["checkedAt"],
            "bytes": source["bytes"],
            "sha256": source["sha256"],
            "path": source["path"],
            "geography": source["geography"],
            "updateFrequency": source["updateFrequency"],
        },
        "coverage": {
            "years": len(data["years"]),
            "coreMeasures": 4,
            "compositionRows": len(spec["expected"]["vttlComposition"]),
        },
        "integrity": {
            "sourceLockSha256": spec["integrity"]["lockSha256"],
            "dataSha256": sha256_bytes(payload),
            "dataBytes": len(payload),
        },
        "semantics": {
            "soldi": {
                "unit": "euro-cents",
                "sourceUnit": "million-euro",
                "nature": "stima compliance gap / VTTL / VAT revenue DG TAXUD; non gettito riscosso MEF né NOE ISTAT",
            },
            "periodo": {
                "referencePeriod": "2019-2024",
                "rapidEstimateYear": 2024,
            },
            "provenance": {
                "holder": source["owner"],
                "publicationDate": source["publicationDate"],
                "acquiredAt": source["acquiredAt"],
                "checkedAt": source["checkedAt"],
            },
        },
    }


def artifact_bytes(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_artifacts(spec: dict[str, Any], data: dict[str, Any], data_path: Path, meta_path: Path) -> None:
    payload = artifact_bytes(data)
    meta = metadata(spec, payload, data)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_bytes(payload)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check(spec_path: Path = DEFAULT_SPEC, data_path: Path = DEFAULT_DATA, meta_path: Path = DEFAULT_META) -> None:
    spec = load_spec(spec_path)
    payload = data_path.read_bytes()
    data = json.loads(payload.decode("utf-8"))
    validate_data(data, spec)
    expected_meta = metadata(spec, payload, data)
    if json.loads(meta_path.read_text(encoding="utf-8")) != expected_meta:
        raise SnapshotError("Metadata or artifact hash drift")
    if spec.get("dataCanonicalSha256") != sha256_bytes(canonical_bytes(data)):
        raise SnapshotError("dataCanonicalSha256 drift")
    # Re-project from the locked workbook to reject silent cell edits.
    source_payload = verified_payload(spec)
    cells = workbook_italy_cells(source_payload, spec)
    rebuilt = build_data(cells, spec)
    if canonical_bytes(rebuilt) != canonical_bytes(data):
        raise SnapshotError("riproiezione dal workbook diverge dall'artifact")


def bootstrap_expected_from_cells(cells: dict[str, str | None]) -> dict[str, Any]:
    """Helper used only while drafting the first lock; not invoked by CI."""
    return {
        "sectionTitle": cell(cells, "A2"),
        "years": [
            {"year": 2019, "sourceYearLabel": cell(cells, "B1"), "estimateKind": "standard"},
            {"year": 2020, "sourceYearLabel": cell(cells, "C1"), "estimateKind": "standard"},
            {"year": 2021, "sourceYearLabel": cell(cells, "D1"), "estimateKind": "standard"},
            {"year": 2022, "sourceYearLabel": cell(cells, "E1"), "estimateKind": "standard"},
            {"year": 2023, "sourceYearLabel": cell(cells, "F1"), "estimateKind": "standard"},
            {"year": 2024, "sourceYearLabel": cell(cells, "G1"), "estimateKind": "rapid-estimate"},
        ],
        "coreLabels": {
            "3": cell(cells, "A3"),
            "9": cell(cells, "A9"),
            "10": cell(cells, "A10"),
            "11": cell(cells, "A11"),
        },
        "vttlComposition": [
            {"id": "household-final-consumption", "row": 4, "sourceLabel": cell(cells, "A4"), "allowNegative": False},
            {"id": "government-npish-final-consumption", "row": 5, "sourceLabel": cell(cells, "A5"), "allowNegative": False},
            {"id": "intermediate-consumption", "row": 6, "sourceLabel": cell(cells, "A6"), "allowNegative": False},
            {"id": "gfcf", "row": 7, "sourceLabel": cell(cells, "A7"), "allowNegative": False},
            {"id": "net-adjustments", "row": 8, "sourceLabel": cell(cells, "A8"), "allowNegative": True},
        ],
        "gapChangeSince2019": {
            "row": 12,
            "sourceLabel": cell(cells, "A12"),
            "asOfYear": 2023,
            "valueTenthsOfPp": -42,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input", type=Path, help="path to the official XLSX (defaults to lock path)")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--bootstrap-lock", action="store_true", help="print draft expected block from workbook")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta)
            print("eu-vat-gap-italy: lock, data e meta coerenti")
            return 0
        if args.bootstrap_lock:
            draft_spec = json.loads(args.spec.read_text(encoding="utf-8")) if args.spec.exists() else {
                "source": {
                    "path": "tests/fixtures/eu-vat-gap/VAT-GAP-2025-Tables-of-Country-Chapters.xlsx",
                    "bytes": 102793,
                    "sha256": "7662fdd6da02d5acca385cca5f1ed5a5fbad3655105f8f0f490d433e472c75fa",
                },
                "workbook": {
                    "member": "xl/workbook.xml",
                    "relationshipsMember": "xl/_rels/workbook.xml.rels",
                    "sharedStringsMember": "xl/sharedStrings.xml",
                    "italySheetName": "IT",
                    "italySheetMember": "xl/worksheets/sheet12.xml",
                    "expectedSheetNames": [
                        "BE", "BG", "CZ", "DK", "DE", "EE", "IE", "EL", "ES", "FR", "HR", "IT",
                        "CY", "LV", "LT", "LU", "HU", "MT", "NL", "AT", "PL", "PT", "RO", "SI",
                        "SK", "FI", "SE", "AL", "GE", "UA", "XK", "BA", "MK", "RS",
                    ],
                },
            }
            payload = verified_payload(draft_spec, args.input)
            cells = workbook_italy_cells(payload, draft_spec)
            print(json.dumps(bootstrap_expected_from_cells(cells), ensure_ascii=False, indent=2))
            return 0
        if not args.write:
            raise SnapshotError("specificare --write, --check oppure --bootstrap-lock")
        spec = load_spec(args.spec)
        payload = verified_payload(spec, args.input)
        cells = workbook_italy_cells(payload, spec)
        data = build_data(cells, spec)
        # Bind the published digest into the lock before writing metadata.
        spec["dataCanonicalSha256"] = sha256_bytes(canonical_bytes(data))
        spec["integrity"]["lockSha256"] = ""
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_artifacts(spec, data, args.data, args.meta)
        check(args.spec, args.data, args.meta)
        print(f"eu-vat-gap-italy: scritto {args.data.relative_to(ROOT)}")
        return 0
    except SnapshotError as error:
        print(f"eu-vat-gap-italy: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
