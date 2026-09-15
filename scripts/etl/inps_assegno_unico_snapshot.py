#!/usr/bin/env python3
"""Build the hash-pinned INPS Assegno Unico snapshot (nuclei + figli).

Second slice of issue #261 after NASpI. Two CKAN packages, license cc-by
(not IODL 2.0), CSV well-formed (unlike the dfb_st_* NASpI CSV). Amounts are
stored as millesimi di euro because 49 published values are not exact cents.

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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/inps-assegno-unico-2022-2024.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/inps-assegno-unico-2022-2024.data.json"
DEFAULT_META = ROOT / "src/data/generated/inps-assegno-unico-2022-2024.meta.json"
DEFAULT_FIXTURE_DIR = ROOT / "tests/fixtures/inps-assegno-unico"

DATASET_ID = "inps-assegno-unico"
OFFICIAL_PREFIX = "https://opendata.inps.it/"
ACQUIRED_AT = "2026-09-14"
CHECKED_AT = "2026-09-14"
PUBLICATION_DATE = "2026-01-17"

CAVEATS = (
    "Perimetro «AUU a domanda — esclusi beneficiari RdC»: non è la popolazione totale dell'Assegno Unico.",
    "somma_importi è erogato, non stanziato né dovuto: non è un budget e non si somma a SIOPE né ai bilanci.",
    "Importi in millesimi di euro: 49 valori della fonte non sono esatti in centesimi e non vengono arrotondati.",
    "Nuclei e figli sono denominatori diversi e non si confrontano: un nucleo non è un figlio.",
    "somma_mesi è una terza natura (mesi di prestazione) e non si somma né agli euro né alle teste.",
    "Nel package nuclei, numero_figli non è documentato dalla fonte come conteggio di figli distinti; restano colonne separate e non confrontabili col package figli.",
    "figli_disabili è un flag 0/1 che stratifica i figli; nel package figli stratifica non disabili e disabili.",
    "La classe ISEE è una fascia dichiarata, non un reddito; la terza classe include chi non ha presentato l'ISEE.",
    "Perimetro distinto da NASpI, pensioni IVS e invalidità civile: nessun totale unico.",
    "Licenza cc-by dichiarata per package; non eredita l'IODL 2.0 della fetta NASpI.",
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


def parse_flag(raw: str) -> int:
    value = Decimal(raw)
    if value not in (Decimal("0"), Decimal("1"), Decimal("0.0"), Decimal("1.0")):
        raise SnapshotError(f"figli_disabili non binario: {raw!r}")
    return int(value)


def parse_int_count(raw: str, label: str) -> int:
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


def parse_amount_milli(raw: str) -> int:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotError(f"somma_importi non numerica: {raw!r}") from error
    milli = value * Decimal(1000)
    if milli != milli.to_integral_value():
        raise SnapshotError(f"somma_importi non esatta in millesimi: {raw!r}")
    as_int = int(milli)
    if not (-(2**53) < as_int < 2**53):
        raise SnapshotError(f"somma_importi fuori dagli interi sicuri: {raw!r}")
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


def project_nuclei(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    expected = {
        "Anno",
        "Regione",
        "provincia",
        "ZONA",
        "figli_disabili",
        "numero_nuclei",
        "numero_figli",
        "somma_importi",
        "somma_mesi",
    }
    out: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for row in rows:
        if set(row) != expected:
            raise SnapshotError(f"nuclei: schema inatteso {sorted(row)}")
        key = (row["Anno"], row["provincia"], row["figli_disabili"])
        if key in seen:
            raise SnapshotError(f"nuclei: chiave duplicata {key}")
        seen.add(key)
        year = int(row["Anno"])
        if year < 2022 or year > 2024:
            raise SnapshotError(f"nuclei: anno fuori periodo {year}")
        out.append(
            {
                "table": "nuclei",
                "year": year,
                "region": row["Regione"],
                "province": row["provincia"],
                "zone": row["ZONA"],
                "childrenDisabilityFlag": parse_flag(row["figli_disabili"]),
                "householdCount": parse_int_count(row["numero_nuclei"], "numero_nuclei"),
                "childrenCount": parse_int_count(row["numero_figli"], "numero_figli"),
                "childrenCountNote": "unita-non-documentata-dalla-fonte",
                "amountMilli": parse_amount_milli(row["somma_importi"]),
                "monthSum": parse_int_count(row["somma_mesi"], "somma_mesi"),
            }
        )
    if len(out) != 636:
        raise SnapshotError(f"nuclei: attese 636 righe, trovate {len(out)}")
    return out


def project_figli(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    expected = {
        "Anno",
        "Regione",
        "provincia",
        "classe_isee",
        "classe_eta",
        "ZONA",
        "figli_disabili",
        "numero_figli",
        "somma_importi",
        "somma_mesi",
    }
    out: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for row in rows:
        if set(row) != expected:
            raise SnapshotError(f"figli: schema inatteso {sorted(row)}")
        key = (
            row["Anno"],
            row["provincia"],
            row["figli_disabili"],
            row["classe_isee"],
            row["classe_eta"],
        )
        if key in seen:
            raise SnapshotError(f"figli: chiave duplicata {key}")
        seen.add(key)
        year = int(row["Anno"])
        if year < 2022 or year > 2024:
            raise SnapshotError(f"figli: anno fuori periodo {year}")
        out.append(
            {
                "table": "figli_disabilita",
                "year": year,
                "region": row["Regione"],
                "province": row["provincia"],
                "zone": row["ZONA"],
                "childrenDisabilityFlag": parse_flag(row["figli_disabili"]),
                "iseeClass": row["classe_isee"],
                "ageClass": row["classe_eta"],
                "childrenCount": parse_int_count(row["numero_figli"], "numero_figli"),
                "amountMilli": parse_amount_milli(row["somma_importi"]),
                "monthSum": parse_int_count(row["somma_mesi"], "somma_mesi"),
            }
        )
    if len(out) != 3816:
        raise SnapshotError(f"figli: attese 3816 righe, trovate {len(out)}")
    return out


def measured_nuclei_children_ratio(observations: list[dict[str, Any]]) -> dict[str, Any]:
    by_year: dict[int, dict[str, int]] = {}
    for row in observations:
        if row["table"] != "nuclei":
            continue
        bucket = by_year.setdefault(row["year"], {"children": 0, "months": 0, "households": 0})
        bucket["children"] += row["childrenCount"]
        bucket["months"] += row["monthSum"]
        bucket["households"] += row["householdCount"]
    ratios = {}
    for year, bucket in sorted(by_year.items()):
        if bucket["months"] == 0:
            raise SnapshotError(f"nuclei {year}: somma_mesi zero")
        ratios[str(year)] = {
            "households": bucket["households"],
            "childrenColumn": bucket["children"],
            "months": bucket["months"],
            "childrenColumnPerMonth": round(bucket["children"] / bucket["months"], 6),
        }
    return {
        "note": (
            "Rapporto misurato sulla colonna numero_figli del package nuclei rispetto a somma_mesi. "
            "La fonte non documenta l'unità di numero_figli in quel package: il rapporto resta "
            "evidenza di lettura, non un'etichetta inventata."
        ),
        "byYear": ratios,
    }


def build_data(nuclei: list[dict[str, Any]], figli: list[dict[str, Any]]) -> dict[str, Any]:
    observations = [*nuclei, *figli]
    provinces_nuclei = {row["province"] for row in nuclei}
    provinces_figli = {row["province"] for row in figli}
    if provinces_nuclei != provinces_figli or len(provinces_nuclei) != 106:
        raise SnapshotError("province incoerenti fra i due package")
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2022, "to": 2024},
        "units": {
            "money": "euro-millesimi",
            "sourceMoney": "euro",
            "moneyNote": (
                "49 valori pubblicati non sono esatti in centesimi; millesimi preservano tutte le cifre della fonte."
            ),
        },
        "tables": [
            {
                "id": "nuclei",
                "package": "assegno-unico-nuclei-2022-2024",
                "title": "Assegno Unico · nuclei beneficiari di almeno una mensilità",
                "rows": 636,
                "dimensions": ["Anno", "provincia", "figli_disabili"],
            },
            {
                "id": "figli_disabilita",
                "package": "assegno-unico-figli-con-disabilita-2022-2024",
                "title": "Assegno Unico · figli beneficiari con stratificazione disabilità, ISEE ed età",
                "rows": 3816,
                "dimensions": ["Anno", "provincia", "figli_disabili", "classe_isee", "classe_eta"],
            },
        ],
        "coverage": {
            "years": [2022, 2023, 2024],
            "provinces": 106,
            "observedRows": 4452,
            "perimeter": "AUU a domanda — esclusi beneficiari RdC",
        },
        "measures": {
            "householdCount": "Numero nuclei beneficiari di almeno una mensilità (solo tabella nuclei).",
            "childrenCount": (
                "Numero figli: nel package figli è un conteggio di figli; nel package nuclei l'unità "
                "non è documentata dalla fonte e resta separata."
            ),
            "amountMilli": "Somma importi erogati in millesimi di euro.",
            "monthSum": "Somma mesi di prestazione.",
        },
        "nucleiChildrenColumn": measured_nuclei_children_ratio(observations),
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
        "period": {"from": 2022, "to": 2024},
        "observedAt": CHECKED_AT,
        "source": {
            "owner": "INPS — Istituto Nazionale della Previdenza Sociale",
            "landingUrl": "https://opendata.inps.it/opendata",
            "catalogApi": "https://opendata.inps.it/opendata/api/3/action/package_show",
            "licenseId": "CC-BY",
            "licenseNote": (
                "Creative Commons Attribution (`license_id=cc-by`) dichiarato per package sul catalogo "
                "CKAN INPS il 2026-09-14. Non eredita l'IODL 2.0 della fetta NASpI."
            ),
            "termsUrl": "https://creativecommons.org/licenses/by/4.0/",
            "publicationDate": PUBLICATION_DATE,
            "updateFrequency": "annuale",
            "distributionChoice": {
                "used": "CSV UTF-8 con CRLF",
                "note": (
                    "Su questa filiera migr2024 il CSV è ben formato (a differenza dei package dfb_st_* NASpI). "
                    "JSON e XML sono validi; si usa il CSV per allinearsi alle colonne pubblicate."
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
                "nature": "erogato",
                "unit": "euro-millesimi",
                "note": (
                    "somma_importi è erogato AUU a domanda. Unità millesimi per non arrotondare 49 cifre "
                    "non esatte in centesimi."
                ),
            },
            "periodo": {
                "referencePeriod": "2022-2024",
                "note": "Anno di riferimento della mensilità AUU, distinto da acquisizione e checkedAt.",
            },
            "provenance": {
                "acquisitionDate": ACQUIRED_AT,
                "checkedAt": CHECKED_AT,
                "publicationDate": PUBLICATION_DATE,
                "canonicalUrls": sorted({
                    "https://opendata.inps.it/opendata",
                    *(asset["url"] for asset in spec["source"]["assets"].values()),
                    *(asset["packageLandingUrl"] for asset in spec["source"]["assets"].values()),
                }),
            },
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {
                "path": "src/data/generated/inps-assegno-unico-2022-2024.data.json",
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
    nuclei = project_nuclei(read_csv_rows(paths["nuclei"]))
    figli = project_figli(read_csv_rows(paths["figli_disabilita"]))
    data = build_data(nuclei, figli)
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
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": "", "dataArtifact": {
        "path": "src/data/generated/inps-assegno-unico-2022-2024.data.json",
        "bytes": meta["integrity"]["dataArtifact"]["bytes"],
        "sha256": meta["integrity"]["dataArtifact"]["sha256"],
    }}}
    lock_digest = digest(canonical_bytes(lock_body))
    spec["integrity"] = {
        "algorithm": "sha256",
        "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
        "dataArtifact": {
            "path": "src/data/generated/inps-assegno-unico-2022-2024.data.json",
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
            print("inps-assegno-unico: lock, data e meta coerenti")
        else:
            # seed lock if missing
            if not args.spec.exists():
                raise SnapshotError("manca lo source lock iniziale")
            write(args.spec, args.data, args.meta, args.fixture_dir)
            data = json.loads(args.data.read_text(encoding="utf-8"))
            print(f"inps-assegno-unico: scritto {args.data.name} ({data['coverage']['observedRows']} righe)")
        return 0
    except SnapshotError as error:
        print(f"inps-assegno-unico: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
