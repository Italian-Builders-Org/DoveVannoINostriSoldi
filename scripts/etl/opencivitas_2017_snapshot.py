#!/usr/bin/env python3
"""Pinned FC40TOT 2017 release, independently verified from official metadata."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re

from opencivitas_common import (
    MUNICIPALITY_COLUMNS, SELECTED_INDICATORS, StructuralError,
    load_entities, load_raw_data, normalize_municipality, read_outer_file,
    row_dicts, xlsx_rows, snapshot_text,
)

SPEC_PATH = Path(__file__).with_name("specs") / "opencivitas-2017.source.json"
SPEC = json.loads(SPEC_PATH.read_text())
OUTPUT = Path("src/data/generated/opencivitas-2017.json")
SEMANTIC_SHA256 = "a22e6c17a06e9fe785276450438320c48747852598a626293ff953b668a0a326"


def verify_bytes(payload: bytes, key: str) -> None:
    expected = SPEC["files"][key]
    if len(payload) != expected["bytes"] or hashlib.sha256(payload).hexdigest() != expected["sha256"]:
        raise StructuralError(f"FC40TOT: byte/SHA-256 {key} diversi dal lock")


def verify_indicators(payload: bytes) -> None:
    definitions = list(row_dicts(xlsx_rows(read_outer_file(payload, ".xlsx"), "Indicatori_FC40TOT_2017")))
    verify_definitions(definitions)


def verify_definitions(definitions: list[dict]) -> None:
    codes = [row.get("VAR_IND_COD") for row in definitions]
    if len(codes) != 25 or len(set(codes)) != len(codes):
        raise StructuralError("FC40TOT: metadati indicatori duplicati o copertura inattesa")
    by_code = {row["VAR_IND_COD"]: row for row in definitions}
    for code, description in SELECTED_INDICATORS.items():
        row = by_code.get(code, {})
        expected_type = "FS" if code in {
            "FST_RIPROPORZIONATO_BI", "FST_RIPROPORZIONATO_BI_PROAB",
            "SPESA_STORICA", "SPESA_STORICA_PROAB",
        } else "LQP"
        if (row.get("VAR_IND_DES") != description
                or row.get("VAR_IND_FUNZIONE") != "TOTALE"
                or row.get("VAR_IND_LINGUA") != "IT"
                or row.get("VAR_IND_TIP") != expected_type):
            raise StructuralError(f"FC40TOT: definizione/unità/perimetro inattesi per {code}")


def normalize_rows(entities: dict, raw: dict) -> list[dict]:
    unknown = set(raw) - set(entities)
    if unknown != set(SPEC["excludedAggregates"]):
        raise StructuralError("FC40TOT: join enti sconosciuti o aggregati inattesi")
    result = []
    for username in sorted(set(raw) & set(entities)):
        entity = dict(entities[username])
        if entity["region"] == "EMILIA ROMAGNA":
            entity["region"] = "EMILIA-ROMAGNA"
        if entity["region"] not in SPEC["regionCounts"]:
            raise StructuralError(f"FC40TOT: Comune fuori RSO {username}")
        rows = raw[username]
        if set(rows) != set(SELECTED_INDICATORS):
            raise StructuralError(f"FC40TOT: indicatori comunali mancanti {username}")
        if any(row["anomaly"] or row["privacy"] for row in rows.values()):
            raise StructuralError(f"FC40TOT: anomalia/privacy inattesa {username}")
        result.append(normalize_municipality(username, entity, rows))
    if len(result) != SPEC["municipalities"] or Counter(row["region"] for row in result) != SPEC["regionCounts"]:
        raise StructuralError("FC40TOT: copertura RSO non riconciliata")
    codes = [row["istatCode"] for row in result]
    if len(set(codes)) != len(codes):
        raise StructuralError("FC40TOT: codice ISTAT duplicato")
    return sorted(result, key=lambda row: row["istatCode"])


def normalize(data: bytes, entities: bytes, indicators: bytes, observed_at: str) -> dict:
    for key, payload in (("data", data), ("entities", entities), ("indicators", indicators)):
        verify_bytes(payload, key)
    csv_bytes = read_outer_file(data, ".csv")
    headers = next(csv.reader(io.StringIO(csv_bytes.decode("utf-8-sig")), delimiter=";"))
    if headers != SPEC["csvHeaders"]:
        raise StructuralError("FC40TOT: schema CSV inatteso")
    verify_indicators(indicators)
    municipalities = normalize_rows(load_entities(entities), load_raw_data(data))
    return {
        "schemaVersion": 1, "transformVersion": 1,
        "scope": "ordinary-statute-municipalities-total-services-fc40-2017",
        "referenceYear": 2017, "publishedAt": SPEC["publishedAt"],
        "modifiedAt": SPEC["modifiedAt"], "generatedAt": observed_at,
        "coverage": {"municipalities": len(municipalities), "regions": 15,
                     "regionNames": sorted(SPEC["regionCounts"]),
                     "territorialScope": "Comuni delle Regioni a statuto ordinario"},
        "municipalityColumns": list(MUNICIPALITY_COLUMNS),
        "municipalityRows": [[row[column] for column in MUNICIPALITY_COLUMNS] for row in municipalities],
        "source": {
            "owner": SPEC["owner"], "publisher": SPEC["publisher"],
            "dataset": "Comuni · Servizi totali · Indicatori e determinanti 2017 (FC40TOT)",
            "landingUrl": "https://www.opencivitas.it/it/open-data",
            "datasetUrl": SPEC["datasetPageUrl"],
            **{key + "Url": item["url"] for key, item in SPEC["files"].items()},
            "license": SPEC["license"], "licenseUrl": SPEC["licenseUrl"],
            "observedAt": observed_at, "declaredCadence": "Irregolare",
            "family": "FC40TOT", "releaseVersion": 1,
            "sha256": {key: item["sha256"] for key, item in SPEC["files"].items()},
            "bytes": {key: item["bytes"] for key, item in SPEC["files"].items()},
        },
        "methodology": {
            "differenceMeaning": "Differenza tra spesa storica e spesa standard. Non è una misura di spreco.",
            "serviceMeaning": "Il confronto sui servizi usa la media dei Comuni della stessa fascia di popolazione.",
            "perCapitaMeaning": "Euro per abitante pubblicati dalla fonte; nessuna popolazione ricostruita o imputata.",
            "coverageWarning": "RSS e Province autonome fuori perimetro; esclusi gli aggregati di Italia, regioni, aree e fasce.",
            "rankingWarning": "I livelli della fonte non costituiscono un ranking di efficienza.",
            "yearSeparationWarning": "FC40TOT 2017, FC50TOT 2018, FC60TOT 2019, FC70TOT 2021 e FC80TOT 2022 restano separati: nessuna somma o confronto silenzioso. Il 2020 non è ricostruito.",
        },
    }


def semantic_digest(snapshot: dict) -> str:
    value = {key: item for key, item in snapshot.items() if key != "generatedAt"}
    value["source"] = {key: item for key, item in snapshot["source"].items() if key != "observedAt"}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def validate_snapshot(snapshot: dict) -> None:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("source"), dict):
        raise StructuralError("FC40TOT: oggetto snapshot e fonte attesi")
    observed = snapshot.get("generatedAt")
    if (not isinstance(observed, str) or observed != snapshot["source"].get("observedAt")
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", observed)):
        raise StructuralError("FC40TOT: timestamp di acquisizione non coerenti")
    try:
        date = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if date.tzinfo is None or date < datetime(2021, 3, 15, tzinfo=timezone.utc):
            raise ValueError("acquisizione precedente al rilascio")
    except ValueError as error:
        raise StructuralError("FC40TOT: timestamp ISO con fuso atteso") from error
    if semantic_digest(snapshot) != SEMANTIC_SHA256:
        raise StructuralError("FC40TOT: SHA-256 semantico diverso dal rilascio verificato")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input-dir", type=Path, help="Directory dei tre ZIP ufficiali pinned; nessuna rete")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    if args.check:
        validate_snapshot(json.loads(args.output.read_text()))
        print("FC40TOT 2017: snapshot verificato offline")
        return
    if args.input_dir is None:
        parser.error("specificare --input-dir con i tre ZIP ufficiali")
    payloads = {key: (args.input_dir / item["url"].rsplit("/", 1)[1]).read_bytes() for key, item in SPEC["files"].items()}
    result = normalize(**payloads, observed_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))
    validate_snapshot(result)
    if args.output.exists():
        current = json.loads(args.output.read_text())
        validate_snapshot(current)
        if semantic_digest(current) == semantic_digest(result):
            print("FC40TOT 2017: nessuna variazione")
            return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(snapshot_text(result), encoding="utf-8")
    print(f"FC40TOT 2017: {len(result['municipalityRows'])} Comuni")


if __name__ == "__main__":
    main()
