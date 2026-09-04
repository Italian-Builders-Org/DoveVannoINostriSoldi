#!/usr/bin/env python3
"""Build hash-pinned ISTAT EPEA snapshot (environmental protection expenditure account).

Source: SDMX dataflow IT1,97_953,1.0 — edition 2025M2, years 2016–2022.
CI and --check never call ISTAT: only local CSV + SHA-256 from the source spec.

EPEA is ESA national-accounts style (competence). It must not be summed or
silently compared with RGS state-budget environmental tables, PNRR Mission 2,
SIOPE cash, or SAD/SAF.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-epea-2016-2022.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-epea-2016-2022.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-epea-2016-2022.meta.json"

DATASET_ID = "istat-epea"
EXPECTED_EDITION = "2025M2"
CENTS_PER_MILLION_EUR = 100_000_000

CAVEATS = (
    "EPEA è contabilità SEC di competenza: non è cassa SIOPE.",
    "Non sommare né confrontare silenziosamente con RGS spese ambientali del bilancio dello Stato.",
    "Non sommare né confrontare con PNRR Missione 2 né SAD/SAF.",
    "TOT_CEPA e totali settoriali non vanno sommati alle parti che già li compongono senza verifica di sovrapposizione.",
    "Edizione 2025M2 fissata: non mescolare con altre edizioni della serie.",
    "Licenza non dichiarata dalla risposta SDMX: non inferita.",
)


class SnapshotError(ValueError):
    pass


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_source_spec(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def to_cents_from_millions(obs: str) -> int:
    try:
        d = Decimal(obs.strip())
    except InvalidOperation as exc:
        raise SnapshotError(f"OBS_VALUE non numerico: {obs!r}") from exc
    return int(d * CENTS_PER_MILLION_EUR)


def build_from_csv(payload: bytes, spec: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    asset = spec["source"]["assets"]["epea-full"]
    expected_sha = asset["sha256"]
    got = sha256_bytes(payload)
    if got != expected_sha:
        raise SnapshotError(f"sha256 mismatch: got {got}, expected {expected_sha}")
    if len(payload) != asset["bytes"]:
        raise SnapshotError(f"byte length mismatch: got {len(payload)}, expected {asset['bytes']}")

    rows_in = list(csv.DictReader(io.StringIO(payload.decode("utf-8"))))
    if len(rows_in) != asset["rows"]:
        raise SnapshotError(f"row count mismatch: got {len(rows_in)}, expected {asset['rows']}")

    out_rows: list[dict[str, Any]] = []
    editions: set[str] = set()
    years: set[int] = set()
    sectors: set[str] = set()
    cepas: set[str] = set()
    dtypes: set[str] = set()

    for r in rows_in:
        ed = (r.get("EDITION") or "").strip()
        editions.add(ed)
        if ed != EXPECTED_EDITION:
            raise SnapshotError(f"edition {ed!r} != {EXPECTED_EDITION}")
        year = int(r["TIME_PERIOD"])
        years.add(year)
        sector = (r.get("INSTITUTIONAL_SECTOR") or "").strip()
        cepa = (r.get("CEPA_CLASS") or "").strip()
        dtype = (r.get("DATA_TYPE_AGGR") or "").strip()
        if not sector or not cepa or not dtype:
            raise SnapshotError("missing INSTITUTIONAL_SECTOR, CEPA_CLASS or DATA_TYPE_AGGR")
        sectors.add(sector)
        cepas.add(cepa)
        dtypes.add(dtype)
        obs = (r.get("OBS_VALUE") or "").strip()
        unit_meas = (r.get("UNIT_MEAS") or "").strip()
        unit_mult = (r.get("UNIT_MULT") or "").strip()
        if unit_meas and unit_meas != "EURO":
            raise SnapshotError(f"UNIT_MEAS inattesa: {unit_meas}")
        if unit_mult and unit_mult != "6":
            raise SnapshotError(f"UNIT_MULT inattesa: {unit_mult}")
        cents = to_cents_from_millions(obs) if obs else None
        out_rows.append(
            {
                "year": year,
                "institutionalSector": sector,
                "cepaClass": cepa,
                "dataTypeAggr": dtype,
                "obsValueMillions": obs if obs else None,
                "amountCents": cents,
                "valuation": (r.get("VALUATION") or "").strip(),
                "refArea": (r.get("REF_AREA") or "").strip(),
            }
        )

    expected_years = set(spec["expected"]["years"])
    if years != expected_years:
        raise SnapshotError(f"years {sorted(years)} != expected {sorted(expected_years)}")

    data = {
        "datasetId": DATASET_ID,
        "edition": EXPECTED_EDITION,
        "rows": out_rows,
    }
    meta = {
        "datasetId": DATASET_ID,
        "edition": EXPECTED_EDITION,
        "referencePeriod": {"from": min(years), "to": max(years)},
        "source": {
            "owner": spec["source"]["owner"],
            "dataflowId": "IT1,97_953,1.0",
            "url": asset["url"],
            "accept": asset.get("accept"),
            "sha256": expected_sha,
            "bytes": asset["bytes"],
            "rows": len(out_rows),
            "acquiredAt": asset.get("observedAt") or spec["source"]["acquisition"]["acquiredAt"],
        },
        "unit": {
            "source": "milioni di euro (UNIT_MEAS=EURO, UNIT_MULT=6)",
            "storage": "amountCents = OBS_VALUE * 1e6 * 100 quando OBS_VALUE presente",
        },
        "dimensions": {
            "institutionalSectors": sorted(sectors),
            "cepaClasses": sorted(cepas),
            "dataTypeAggr": sorted(dtypes),
            "years": sorted(years),
        },
        "caveats": list(CAVEATS),
        "issue": 86,
    }
    return data, meta


def write_json(path: Path, value: object, *, pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def check_existing(data_path: Path, meta_path: Path, spec: dict[str, Any]) -> None:
    if not data_path.is_file() or not meta_path.is_file():
        raise SnapshotError("generated data/meta mancanti")
    data = json.loads(data_path.read_text(encoding="utf-8"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if data.get("datasetId") != DATASET_ID or data.get("edition") != EXPECTED_EDITION:
        raise SnapshotError("data.json datasetId/edition non validi")
    if meta.get("edition") != EXPECTED_EDITION:
        raise SnapshotError("meta edition non valida")
    if meta.get("source", {}).get("sha256") != spec["source"]["assets"]["epea-full"]["sha256"]:
        raise SnapshotError("meta sha256 non allineato alla spec")
    rows = data.get("rows") or []
    if len(rows) != spec["source"]["assets"]["epea-full"]["rows"]:
        raise SnapshotError("numero righe data.json non allineato")
    for row in rows:
        if row.get("year") not in spec["expected"]["years"]:
            raise SnapshotError(f"anno fuori perimetro: {row.get('year')}")
        if not row.get("institutionalSector") or not row.get("cepaClass"):
            raise SnapshotError("riga senza settore o CEPA")
    print(f"OK --check: {len(rows)} righe, edition {EXPECTED_EDITION}, hash pinnato")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    p.add_argument("--csv", type=Path, help="CSV SDMX locale (obbligatorio se non --check)")
    p.add_argument("--data-out", type=Path, default=DEFAULT_DATA)
    p.add_argument("--meta-out", type=Path, default=DEFAULT_META)
    p.add_argument("--check", action="store_true", help="Solo verifica artifact già generati (offline)")
    args = p.parse_args(argv)

    spec = load_source_spec(args.spec)
    if args.check:
        check_existing(args.data_out, args.meta_out, spec)
        return 0
    if not args.csv:
        print("Serve --csv path/to/istat-epea-2016-2022.csv oppure --check", file=sys.stderr)
        return 2
    payload = args.csv.read_bytes()
    data, meta = build_from_csv(payload, spec)
    write_json(args.data_out, data, pretty=False)
    write_json(args.meta_out, meta, pretty=True)
    print(f"Wrote {args.data_out} ({len(data['rows'])} rows)")
    print(f"Wrote {args.meta_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
