#!/usr/bin/env python3
"""Build the hash-pinned INPS CIG Fondi di Solidarietà 2023-2024 snapshot.

Fourth slice of issue #261 after NASpI, Assegno Unico and integrazioni salariali.
One CKAN package: authorized hours by fund management, region, month and sector.
Hours only — no euro amounts. License cc-by per package.

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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/inps-cig-fondi-solidarieta-2023-2024.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/inps-cig-fondi-solidarieta-2023-2024.data.json"
DEFAULT_META = ROOT / "src/data/generated/inps-cig-fondi-solidarieta-2023-2024.meta.json"
DEFAULT_FIXTURE_DIR = ROOT / "tests/fixtures/inps-cig-fondi-solidarieta"

DATASET_ID = "inps-cig-fondi-solidarieta"
OFFICIAL_PREFIX = "https://opendata.inps.it/"
ACQUIRED_AT = "2026-09-15"
CHECKED_AT = "2026-09-15"
PUBLICATION_DATE = "2026-01-17"
DATA_ARTIFACT_PATH = "src/data/generated/inps-cig-fondi-solidarieta-2023-2024.data.json"
EXPECTED_ROWS = 628
FUND_MANAGEMENTS = frozenset({"FIS", "Altri fondi"})
SECTORS = frozenset({"Commercio", "Credito", "Industria", "ex Enti Pubblici"})
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
    "totale_ore_autorizzate sono ore autorizzate, NON euro: nessuna somma con spesa, SIOPE o bilanci INPS.",
    "Perimetro CIG Fondi di Solidarietà (FIS e Altri fondi): distinto da CIGO/CIGS/CIGD della fetta integrazioni salariali.",
    "Ore autorizzate ≠ lavoratori, domande o mensilità: nature diverse e non confrontabili.",
    "La copertura non è un prodotto cartesiano completo: solo le combinazioni pubblicate dalla fonte.",
    "Perimetro distinto da NASpI, Assegno Unico, pensioni IVS e invalidità civile: nessun totale unico.",
    "Licenza cc-by dichiarata per package; non eredita l'IODL 2.0 della fetta NASpI.",
    "Le ore autorizzate non dicono nulla su adeguatezza, efficienza o merito degli ammortizzatori.",
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


def parse_hours(raw: str) -> int:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotError(f"totale_ore_autorizzate non numerica: {raw!r}") from error
    if value != value.to_integral_value() or value < 0:
        raise SnapshotError(f"totale_ore_autorizzate: atteso intero non negativo, trovato {raw!r}")
    as_int = int(value)
    if not (-(2**53) < as_int < 2**53):
        raise SnapshotError("totale_ore_autorizzate fuori dagli interi sicuri")
    return as_int


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    if b"\r\n" not in raw:
        raise SnapshotError(f"{path.name}: attesi terminatorii CRLF")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    if not rows:
        raise SnapshotError(f"{path.name}: vuoto")
    return rows


def project_rows(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    expected = {
        "Anno",
        "gestione_fondi",
        "Regione",
        "Mese",
        "Ramo di attività",
        "totale_ore_autorizzate",
    }
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str, str]] = set()
    for row in rows:
        if set(row) != expected:
            raise SnapshotError(f"schema inatteso {sorted(row)}")
        key = (
            row["Anno"],
            row["gestione_fondi"],
            row["Regione"],
            row["Mese"],
            row["Ramo di attività"],
        )
        if key in seen:
            raise SnapshotError(f"chiave duplicata {key}")
        seen.add(key)
        year = int(row["Anno"])
        if year not in (2023, 2024):
            raise SnapshotError(f"anno fuori periodo {year}")
        if row["gestione_fondi"] not in FUND_MANAGEMENTS:
            raise SnapshotError(f"gestione fondi sconosciuta {row['gestione_fondi']!r}")
        if row["Mese"] not in MONTHS:
            raise SnapshotError(f"mese non canonico {row['Mese']!r}")
        if row["Ramo di attività"] not in SECTORS:
            raise SnapshotError(f"ramo attività sconosciuto {row['Ramo di attività']!r}")
        if not row["Regione"].strip():
            raise SnapshotError("regione vuota")
        out.append(
            {
                "year": year,
                "fundManagement": row["gestione_fondi"],
                "region": row["Regione"],
                "month": row["Mese"],
                "sector": row["Ramo di attività"],
                "authorizedHours": parse_hours(row["totale_ore_autorizzate"]),
            }
        )
    if len(out) != EXPECTED_ROWS:
        raise SnapshotError(f"attese {EXPECTED_ROWS} righe, trovate {len(out)}")
    return out


def build_data(observations: list[dict[str, Any]]) -> dict[str, Any]:
    regions = {row["region"] for row in observations}
    if len(regions) != 20:
        raise SnapshotError(f"attese 20 regioni, trovate {len(regions)}")
    if {row["fundManagement"] for row in observations} != FUND_MANAGEMENTS:
        raise SnapshotError("gestioni fondi divergenti")
    if {row["sector"] for row in observations} != SECTORS:
        raise SnapshotError("rami attività divergenti")
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2023, "to": 2024},
        "units": {
            "hours": "ore",
            "money": "nessuna — il dataset non contiene importi",
            "hoursNote": "totale_ore_autorizzate pubblicate dalla fonte come ore intere.",
        },
        "coverage": {
            "years": [2023, 2024],
            "regions": 20,
            "fundManagements": 2,
            "sectors": 4,
            "observedRows": EXPECTED_ROWS,
            "perimeter": "CIG Fondi di Solidarietà — ore autorizzate per regione, mese, gestione e ramo",
        },
        "measures": {
            "authorizedHours": "Ore autorizzate di CIG Fondi di Solidarietà.",
        },
        "caveats": list(CAVEATS),
        "observations": observations,
    }


def build_meta(spec: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    data_bytes = canonical_bytes(data)
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    lock_digest = digest(canonical_bytes(lock_body))
    asset = spec["source"]["assets"]["hours"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2023, "to": 2024},
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
                "hours": {
                    "package": asset["package"],
                    "filename": Path(asset["path"]).name,
                    "path": asset["path"],
                    "url": asset["url"],
                    "bytes": asset["bytes"],
                    "sha256": asset["sha256"],
                    "packageLandingUrl": asset["packageLandingUrl"],
                }
            },
            "acquisition": {
                "acquiredAt": ACQUIRED_AT,
                "checkedAt": CHECKED_AT,
            },
        },
        "semantics": {
            "soldi": {
                "unit": "nessuna — il dataset non contiene importi",
                "nature": "ore autorizzate CIG Fondi di Solidarietà (non euro)",
                "note": (
                    "Il package pubblica sole quantità di ore; non contiene importi indennizzati né "
                    "stanziamenti. Non sommare a SIOPE, bilanci o integrazioni salariali."
                ),
            },
            "periodo": {
                "referencePeriod": "2023-2024",
                "note": "Anno di riferimento delle ore autorizzate; dettaglio mensile. Distinto da acquisizione e checkedAt.",
            },
            "provenance": {
                "acquisitionDate": ACQUIRED_AT,
                "checkedAt": CHECKED_AT,
                "publicationDate": PUBLICATION_DATE,
                "canonicalUrls": sorted(
                    {
                        "https://opendata.inps.it/opendata",
                        asset["url"],
                        asset["packageLandingUrl"],
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


def verified_payload(spec: dict[str, Any], fixture_dir: Path) -> Path:
    asset = spec["source"]["assets"]["hours"]
    require_official(asset["url"], "hours")
    require_official(asset["packageLandingUrl"], "hours landing")
    candidate = fixture_dir / Path(asset["path"]).name
    path = candidate if candidate.exists() else (ROOT / asset["path"])
    if not path.exists():
        raise SnapshotError(f"fixture mancante: {asset['path']}")
    raw = path.read_bytes()
    if len(raw) != asset["bytes"] or digest(raw) != asset["sha256"]:
        raise SnapshotError("hours: hash o byte divergenza sul CSV")
    return path


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_bytes(value) + b"\n")


def build(spec: dict[str, Any], fixture_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    path = verified_payload(spec, fixture_dir)
    data = build_data(project_rows(read_csv_rows(path)))
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
            print("inps-cig-fondi-solidarieta: lock, data e meta coerenti")
        else:
            if not args.spec.exists():
                raise SnapshotError("manca lo source lock iniziale")
            write(args.spec, args.data, args.meta, args.fixture_dir)
            data = json.loads(args.data.read_text(encoding="utf-8"))
            print(
                f"inps-cig-fondi-solidarieta: scritto {args.data.name} "
                f"({data['coverage']['observedRows']} righe)"
            )
        return 0
    except SnapshotError as error:
        print(f"inps-cig-fondi-solidarieta: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
