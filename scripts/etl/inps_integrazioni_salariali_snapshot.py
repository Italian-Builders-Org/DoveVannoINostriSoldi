#!/usr/bin/env python3
"""Build the hash-pinned INPS integrazioni salariali 2023 snapshot.

Third slice of issue #261 after NASpI and Assegno Unico. Three CKAN packages
from the annual Ammortizzatori Sociali report: workers, applications, and
benefit-months. Counts only — no euro amounts. License cc-by per package.

Runtime and CI never call INPS: --write needs local fixtures matching the lock.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/inps-integrazioni-salariali-2023.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/inps-integrazioni-salariali-2023.data.json"
DEFAULT_META = ROOT / "src/data/generated/inps-integrazioni-salariali-2023.meta.json"
DEFAULT_FIXTURE_DIR = ROOT / "tests/fixtures/inps-integrazioni-salariali"

DATASET_ID = "inps-integrazioni-salariali"
OFFICIAL_PREFIX = "https://opendata.inps.it/"
ACQUIRED_AT = "2026-09-15"
CHECKED_AT = "2026-09-15"
PUBLICATION_DATE = "2026-01-15"
DATA_ARTIFACT_PATH = "src/data/generated/inps-integrazioni-salariali-2023.data.json"

TABLES = ("lavoratori", "domande", "mensilita")
MEASURE_COLUMN = {
    "lavoratori": "numero_lavoratori",
    "domande": "numero_domande",
    "mensilita": "numero_mensilita",
}
EXPECTED_ROWS = {"lavoratori": 790, "domande": 759, "mensilita": 790}
INTERVENTION_TYPES = frozenset(
    {"CIGD", "CIGO", "CIGS", "FIS", "FONDI_Centrali", "FONDI_Territorio"}
)
MONTHS = frozenset(
    {
        "Gennaio",
        "Febbraio",
        "Marzo",
        "Aprile",
        "Maggio",
        "Giugno",
        "Luglio",
        "Agosto",
        "Settembre",
        "Ottobre",
        "Novembre",
        "Dicembre",
    }
)

CAVEATS = (
    "Lavoratori, domande e mensilità sono misure diverse e non vanno sommate né confrontate come se fossero la stessa natura.",
    "Sono conteggi, NON euro: nessuna somma o confronto con la spesa per prestazioni, con SIOPE o con i bilanci INPS.",
    "Le ore autorizzate CIG (altri package) e questi conteggi di integrazioni salariali restano perimetri distinti.",
    "La copertura delle chiavi (mese × tipo × regione) non è identica fra le tre tabelle: 790 / 759 / 790 righe.",
    "Perimetro distinto da NASpI, Assegno Unico, pensioni IVS e invalidità civile: nessun totale unico.",
    "È un report annuale 2023 a dettaglio mensile regionale: i mesi non si sommano fra anni e non formano uno stock.",
    "Licenza cc-by dichiarata per package; non eredita l'IODL 2.0 della fetta NASpI.",
    "I conteggi non dicono nulla su adeguatezza, efficienza o merito degli ammortizzatori.",
)


class SnapshotError(ValueError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def require_official(url: str, label: str) -> None:
    if not url.startswith(OFFICIAL_PREFIX):
        raise SnapshotError(f"{label}: URL non ufficiale INPS open data")


def parse_count(raw: str, label: str) -> int:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotError(f"{label}: intero non valido {raw!r}") from error
    if value != value.to_integral_value() or value < 0:
        raise SnapshotError(f"{label}: atteso intero non negativo, trovato {raw!r}")
    as_int = int(value)
    if not (-(2**53) < as_int < 2**53):
        raise SnapshotError(f"{label}: intero non sicuro")
    return as_int


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    if b"\r\n" not in raw:
        raise SnapshotError(f"{path.name}: attesi terminatorii CRLF")
    text = raw.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise SnapshotError(f"{path.name}: vuoto")
    return rows


def project_table(table_id: str, rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    measure_col = MEASURE_COLUMN[table_id]
    expected = {"Anno", "Mese", "Tipo_intervento", "Regione", measure_col}
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for row in rows:
        if set(row) != expected:
            raise SnapshotError(f"{table_id}: schema inatteso {sorted(row)}")
        key = (row["Anno"], row["Mese"], row["Tipo_intervento"], row["Regione"])
        if key in seen:
            raise SnapshotError(f"{table_id}: chiave duplicata {key}")
        seen.add(key)
        year = int(row["Anno"])
        if year != 2023:
            raise SnapshotError(f"{table_id}: anno fuori periodo {year}")
        if row["Mese"] not in MONTHS:
            raise SnapshotError(f"{table_id}: mese non canonico {row['Mese']!r}")
        if row["Tipo_intervento"] not in INTERVENTION_TYPES:
            raise SnapshotError(f"{table_id}: tipo intervento sconosciuto {row['Tipo_intervento']!r}")
        if not row["Regione"].strip():
            raise SnapshotError(f"{table_id}: regione vuota")
        out.append(
            {
                "table": table_id,
                "year": year,
                "month": row["Mese"],
                "interventionType": row["Tipo_intervento"],
                "region": row["Regione"],
                "count": parse_count(row[measure_col], measure_col),
            }
        )
    if len(out) != EXPECTED_ROWS[table_id]:
        raise SnapshotError(f"{table_id}: attese {EXPECTED_ROWS[table_id]} righe, trovate {len(out)}")
    return out


def build_data(tables: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    observations = [row for table_id in TABLES for row in tables[table_id]]
    regions = {row["region"] for row in observations}
    types = {row["interventionType"] for row in observations}
    if len(regions) != 20:
        raise SnapshotError(f"attese 20 regioni, trovate {len(regions)}")
    if types != INTERVENTION_TYPES:
        raise SnapshotError(f"tipi intervento divergenti: {sorted(types)}")
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2023, "to": 2023},
        "units": {
            "count": "unita",
            "money": "nessuna — il dataset non contiene importi",
            "countNote": (
                "numero_lavoratori, numero_domande e numero_mensilita sono conteggi distinti pubblicati dalla fonte."
            ),
        },
        "tables": [
            {
                "id": table_id,
                "package": f"integrazioni-salariali-{table_id}-2023",
                "title": {
                    "lavoratori": "Integrazioni salariali · lavoratori 2023",
                    "domande": "Integrazioni salariali · domande 2023",
                    "mensilita": "Integrazioni salariali · mensilità 2023",
                }[table_id],
                "rows": EXPECTED_ROWS[table_id],
                "dimensions": ["Anno", "Mese", "Tipo_intervento", "Regione"],
                "measureColumn": MEASURE_COLUMN[table_id],
            }
            for table_id in TABLES
        ],
        "coverage": {
            "years": [2023],
            "regions": 20,
            "interventionTypes": 6,
            "observedRows": 2339,
            "perimeter": "Report annuale integrazioni salariali 2023 — Direzione Ammortizzatori Sociali",
        },
        "measures": {
            "lavoratori": "Numero lavoratori per regione, mese e tipo di intervento.",
            "domande": "Numero domande per regione, mese e tipo di intervento.",
            "mensilita": "Numero mensilità per regione, mese e tipo di intervento.",
        },
        "caveats": list(CAVEATS),
        "observations": observations,
    }


def build_meta(spec: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    data_bytes = canonical_bytes(data)
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    lock_digest = digest(canonical_bytes(lock_body))
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2023, "to": 2023},
        "observedAt": CHECKED_AT,
        "source": {
            "owner": "INPS — Istituto Nazionale della Previdenza Sociale",
            "landingUrl": "https://opendata.inps.it/opendata",
            "catalogApi": "https://opendata.inps.it/opendata/api/3/action/package_show",
            "licenseId": "CC-BY",
            "licenseNote": (
                "Creative Commons Attribution (`license_id=cc-by`) dichiarato per package sul catalogo "
                "CKAN INPS il 2026-09-15. Non eredita l'IODL 2.0 della fetta NASpI."
            ),
            "termsUrl": "https://creativecommons.org/licenses/by/4.0/",
            "publicationDate": PUBLICATION_DATE,
            "updateFrequency": "annuale",
            "distributionChoice": {
                "used": "CSV UTF-8 con CRLF",
                "note": (
                    "Filiera migr2024: CSV ben formato. JSON e XML disponibili; si usa il CSV per "
                    "allinearsi alle colonne pubblicate."
                ),
            },
            "assets": {
                table_id: {
                    "package": table["package"],
                    "filename": Path(table["path"]).name,
                    "path": table["path"],
                    "url": table["url"],
                    "bytes": table["bytes"],
                    "sha256": table["sha256"],
                    "packageLandingUrl": table["packageLandingUrl"],
                }
                for table_id, table in spec["source"]["assets"].items()
            },
            "acquisition": {
                "acquiredAt": ACQUIRED_AT,
                "checkedAt": CHECKED_AT,
            },
        },
        "semantics": {
            "soldi": {
                "unit": "nessuna — il dataset non contiene importi",
                "nature": "conteggi di lavoratori, domande e mensilità (non euro)",
                "note": (
                    "Il report annuale pubblica sole quantità; non contiene importi indennizzati né "
                    "stanziamenti. Non sommare a SIOPE, bilanci o NASpI."
                ),
            },
            "periodo": {
                "referencePeriod": "2023",
                "note": "Anno di riferimento del report; dettaglio mensile. Distinto da acquisizione e checkedAt.",
            },
            "provenance": {
                "acquisitionDate": ACQUIRED_AT,
                "checkedAt": CHECKED_AT,
                "publicationDate": PUBLICATION_DATE,
                "canonicalUrls": sorted(
                    {
                        "https://opendata.inps.it/opendata",
                        *(asset["url"] for asset in spec["source"]["assets"].values()),
                        *(asset["packageLandingUrl"] for asset in spec["source"]["assets"].values()),
                    }
                ),
            },
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {
                "path": DATA_ARTIFACT_PATH,
                "bytes": len(data_bytes),
                "sha256": digest(data_bytes),
            },
            "sourceLockSha256": lock_digest,
        },
    }


def verified_payload(spec: dict[str, Any], fixture_dir: Path) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for table_id, asset in spec["source"]["assets"].items():
        require_official(asset["url"], table_id)
        require_official(asset["packageLandingUrl"], f"{table_id} landing")
        candidate = fixture_dir / Path(asset["path"]).name
        path = candidate if candidate.exists() else (ROOT / asset["path"])
        if not path.exists():
            raise SnapshotError(f"fixture mancante: {asset['path']}")
        raw = path.read_bytes()
        if len(raw) != asset["bytes"] or digest(raw) != asset["sha256"]:
            raise SnapshotError(f"{table_id}: hash o byte divergenza sul CSV")
        paths[table_id] = path
    return paths


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_bytes(value) + b"\n")


def build(spec: dict[str, Any], fixture_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    paths = verified_payload(spec, fixture_dir)
    tables = {table_id: project_table(table_id, read_csv_rows(paths[table_id])) for table_id in TABLES}
    data = build_data(tables)
    meta = build_meta(spec, data)
    return data, meta


def check(
    spec_path: Path = DEFAULT_SPEC,
    data_path: Path = DEFAULT_DATA,
    meta_path: Path = DEFAULT_META,
    fixture_dir: Path = DEFAULT_FIXTURE_DIR,
) -> None:
    spec = load_spec(spec_path)
    data, meta = build(spec, fixture_dir)
    committed_data = json.loads(data_path.read_text(encoding="utf-8"))
    committed_meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if canonical_bytes(committed_data) != canonical_bytes(data):
        raise SnapshotError("data artifact divergente dalla riproiezione")
    if canonical_bytes(committed_meta) != canonical_bytes(meta):
        raise SnapshotError("meta artifact divergente dalla riproiezione")
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    if digest(canonical_bytes(lock_body)) != spec["integrity"]["lockSha256"]:
        raise SnapshotError("lockSha256 incoerente")
    if meta["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("sourceLockSha256 meta/lock divergenti")
    if meta["integrity"]["dataArtifact"]["sha256"] != spec["integrity"]["dataArtifact"]["sha256"]:
        raise SnapshotError("hash data nel lock divergente")


def write(
    spec_path: Path = DEFAULT_SPEC,
    data_path: Path = DEFAULT_DATA,
    meta_path: Path = DEFAULT_META,
    fixture_dir: Path = DEFAULT_FIXTURE_DIR,
) -> None:
    spec = load_spec(spec_path)
    data, meta = build(spec, fixture_dir)
    lock_body = {
        **spec,
        "integrity": {
            **spec["integrity"],
            "lockSha256": "",
            "dataArtifact": {
                "path": DATA_ARTIFACT_PATH,
                "bytes": meta["integrity"]["dataArtifact"]["bytes"],
                "sha256": meta["integrity"]["dataArtifact"]["sha256"],
            },
        },
    }
    lock_digest = digest(canonical_bytes(lock_body))
    spec["integrity"] = {
        "algorithm": "sha256",
        "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
        "dataArtifact": {
            "path": DATA_ARTIFACT_PATH,
            "bytes": meta["integrity"]["dataArtifact"]["bytes"],
            "sha256": meta["integrity"]["dataArtifact"]["sha256"],
        },
        "lockSha256": lock_digest,
    }
    meta["integrity"]["sourceLockSha256"] = lock_digest
    write_json(spec_path, spec)
    write_json(data_path, data)
    write_json(meta_path, meta)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--fixture-dir", type=Path, default=DEFAULT_FIXTURE_DIR)
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta, args.fixture_dir)
            print("inps-integrazioni-salariali: lock, data e meta coerenti")
        else:
            if not args.spec.exists():
                raise SnapshotError("manca lo source lock iniziale")
            write(args.spec, args.data, args.meta, args.fixture_dir)
            data = json.loads(args.data.read_text(encoding="utf-8"))
            print(
                f"inps-integrazioni-salariali: scritto {args.data.name} "
                f"({data['coverage']['observedRows']} righe)"
            )
        return 0
    except SnapshotError as error:
        print(f"inps-integrazioni-salariali: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
