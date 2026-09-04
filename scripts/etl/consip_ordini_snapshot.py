#!/usr/bin/env python3
"""Build the hash-pinned Consip purchase-orders snapshot (Convenzioni + MEPA).

The six input files are the yearly CSV dumps published on https://dati.consip.it
(CC BY 4.0, per-package license verified on the CKAN catalog).  They are
deliberately passed as local files: runtime and CI never fetch the portal, and a
source/schema/hash drift fails closed before an existing artifact can be
replaced.

The source suppresses cell values instead of dropping rows: MEPA rows carry
either the amount or the order count, never both; Convenzioni files contain
rows with counts but no amount and registry-only rows with no figures at all.
Every aggregate therefore tracks known/suppressed row counts explicitly, and
the published amounts are LOWER BOUNDS — the artifact says so in its caveats
instead of letting the absence of a value take the shape of a zero.
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/consip-ordini-2024-2026.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/consip-ordini-2024-2026.data.json"
DEFAULT_META = ROOT / "src/data/generated/consip-ordini-2024-2026.meta.json"

HEX64 = re.compile(r"^[a-f0-9]{64}$")
# Amounts use a comma as decimal separator and no thousands separator
# (verified on all six 2024-2026 files).  Negative amounts are real —
# storni/rettifiche published by the source (e.g. -87004,8 in the 2024
# Convenzioni file, found by this very check failing closed) — so the sign is
# accepted and the rows carrying it are counted separately instead of being
# silently mixed in.  Anything else is a schema drift and must stop the build
# rather than be "cleaned up" silently.
AMOUNT = re.compile(r"^-?\d+(,\d{1,2})?$")
COUNT = re.compile(r"^\d+$")


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


def load_source_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if not isinstance(spec, dict):
        raise SnapshotError("source lock: atteso un oggetto")
    for key in ("schemaVersion", "datasetId", "period", "source", "expected", "suppression", "integrity"):
        if key not in spec:
            raise SnapshotError(f"source lock: campo {key} mancante")
    if spec["datasetId"] != "consip-ordini":
        raise SnapshotError("source lock: datasetId inatteso")
    landing = spec["source"].get("landingUrl", "")
    if not landing.startswith("https://dati.consip.it/"):
        raise SnapshotError("source lock: landing URL non ufficiale Consip")
    for name, asset in spec["source"]["assets"].items():
        if not str(asset.get("url", "")).startswith("https://dati.consip.it/download/dataset/"):
            raise SnapshotError(f"source lock: URL non ufficiale per {name}")
        if not HEX64.match(str(asset.get("sha256", ""))):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
    return spec


def _parse_amount_cents(raw: str, where: str) -> int:
    if not AMOUNT.match(raw):
        raise SnapshotError(f"importo non valido {raw!r} in {where}")
    try:
        value = Decimal(raw.replace(",", "."))
    except InvalidOperation as error:  # pragma: no cover - AMOUNT already filters
        raise SnapshotError(f"importo non convertibile {raw!r} in {where}") from error
    return int(value * 100)


def _read_rows(payload: bytes, channel: str, year: int, spec: dict[str, Any]) -> list[dict[str, str]]:
    encoding = spec["source"].get("encoding", "latin-1")
    try:
        text = payload.decode(encoding)
    except UnicodeDecodeError as error:
        raise SnapshotError(f"{channel}-{year}: encoding inatteso ({error})") from error
    rows = list(csv.reader(text.splitlines()))
    if not rows:
        raise SnapshotError(f"{channel}-{year}: file vuoto")
    header = [column.lstrip("#") for column in rows[0]]
    expected = spec["expected"]["columns"][channel]
    if header != expected:
        raise SnapshotError(
            f"{channel}-{year}: intestazione divergente dallo schema lock — attesa {expected}, trovata {header}"
        )
    body = rows[1:]
    expected_rows = spec["expected"]["rows"].get(f"{channel}-{year}")
    if expected_rows is not None and len(body) != expected_rows:
        raise SnapshotError(
            f"{channel}-{year}: {len(body)} righe contro le {expected_rows} del lock — la fonte è cambiata, aggiorna il lock consapevolmente"
        )
    out: list[dict[str, str]] = []
    for index, row in enumerate(body, start=2):
        if len(row) != len(header):
            raise SnapshotError(f"{channel}-{year}: riga {index} con {len(row)} campi invece di {len(header)}")
        record = dict(zip(header, row))
        if record["Anno_Riferimento"] != str(year):
            raise SnapshotError(
                f"{channel}-{year}: riga {index} dichiara anno {record['Anno_Riferimento']!r} in un file {year}"
            )
        out.append(record)
    return out


def _aggregate(rows: list[dict[str, str]], channel: str, year: int, spec: dict[str, Any], by: str) -> list[dict[str, Any]]:
    amount_col = spec["expected"]["amountColumn"][channel]
    orders_col = spec["expected"]["ordersColumn"][channel]
    groups: dict[str, dict[str, int]] = {}
    for index, record in enumerate(rows, start=2):
        key = record[by].strip() or "NON DICHIARATA"
        bucket = groups.setdefault(
            key,
            {"rows": 0, "rowsWithAmount": 0, "rowsAmountSuppressed": 0, "amountKnownCents": 0,
             "rowsWithNegativeAmount": 0,
             "rowsWithOrders": 0, "rowsOrdersSuppressed": 0, "ordersKnown": 0},
        )
        bucket["rows"] += 1
        amount_raw = record[amount_col].strip()
        if amount_raw:
            bucket["rowsWithAmount"] += 1
            bucket["amountKnownCents"] += _parse_amount_cents(amount_raw, f"{channel}-{year} riga {index}")
            if amount_raw.startswith("-"):
                bucket["rowsWithNegativeAmount"] += 1
        else:
            bucket["rowsAmountSuppressed"] += 1
        orders_raw = record[orders_col].strip()
        if orders_raw:
            if not COUNT.match(orders_raw):
                raise SnapshotError(f"{channel}-{year}: conteggio ordini non valido {orders_raw!r} alla riga {index}")
            bucket["rowsWithOrders"] += 1
            bucket["ordersKnown"] += int(orders_raw)
        else:
            bucket["rowsOrdersSuppressed"] += 1
    observations = []
    for key in sorted(groups):
        bucket = groups[key]
        if bucket["rowsWithAmount"] + bucket["rowsAmountSuppressed"] != bucket["rows"]:
            raise SnapshotError(f"{channel}-{year}: riconciliazione importi rotta per {key!r}")
        if bucket["rowsWithOrders"] + bucket["rowsOrdersSuppressed"] != bucket["rows"]:
            raise SnapshotError(f"{channel}-{year}: riconciliazione conteggi rotta per {key!r}")
        observations.append({"year": year, "channel": channel, "key": key, **bucket})
    return observations


CAVEATS = (
    "Gli importi sono LIMITI INFERIORI: la fonte sopprime il valore in molte righe (nei file MEPA importo e numero ordini sono mutuamente esclusivi per riga) e le celle soppresse non contribuiscono alle somme.",
    "Ordinato Consip non è pagato: un ordine o un'aggiudicazione non coincide con un pagamento SIOPE.",
    "Consip non è tutta la spesa per acquisti della PA: fuori dal Programma esistono procedure autonome censite da ANAC.",
    "Le righe sono aggregati per dimensione pubblicati dalla fonte, non singoli contratti: nessun giudizio su efficienza, regolarità o responsabilità individuale è deducibile da questi numeri.",
    "La fonte pubblica anche importi negativi (storni e rettifiche): concorrono alle somme col loro segno e le righe che li portano sono conteggiate a parte.",
)


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    expected_assets = set(spec["source"]["assets"])
    if set(inputs) != expected_assets:
        raise SnapshotError(f"input attesi {sorted(expected_assets)}, ricevuti {sorted(inputs)}")
    for name, payload in inputs.items():
        asset = spec["source"]["assets"][name]
        if len(payload) != asset["bytes"]:
            raise SnapshotError(f"{name}: {len(payload)} byte contro i {asset['bytes']} del lock")
        if sha256_bytes(payload) != asset["sha256"]:
            raise SnapshotError(f"{name}: sha256 divergente dal lock — la fonte è cambiata, aggiorna il lock consapevolmente")

    by_region: list[dict[str, Any]] = []
    by_admin_type: list[dict[str, Any]] = []
    totals: list[dict[str, Any]] = []
    max_regions = spec["expected"]["maxRegions"]
    for channel in spec["expected"]["channels"]:
        for year in spec["expected"]["years"]:
            rows = _read_rows(inputs[f"{channel}-{year}"], channel, year, spec)
            regions = _aggregate(rows, channel, year, spec, by="Regione_PA")
            if len(regions) > max_regions:
                raise SnapshotError(f"{channel}-{year}: {len(regions)} regioni distinte oltre il tetto {max_regions}")
            by_region.extend(regions)
            by_admin_type.extend(_aggregate(rows, channel, year, spec, by="Tipologia_Amministrazione"))
            totals.append({
                "year": year,
                "channel": channel,
                "rows": len(rows),
                "amountKnownCents": sum(r["amountKnownCents"] for r in regions),
                "rowsAmountSuppressed": sum(r["rowsAmountSuppressed"] for r in regions),
                "ordersKnown": sum(r["ordersKnown"] for r in regions),
                "rowsOrdersSuppressed": sum(r["rowsOrdersSuppressed"] for r in regions),
            })
            # The three aggregations must tell the same story or none at all.
            if sum(r["rows"] for r in regions) != len(rows):
                raise SnapshotError(f"{channel}-{year}: le righe per regione non riconciliano col totale")

    return {
        "schemaVersion": 1,
        "datasetId": "consip-ordini",
        "period": dict(spec["period"]),
        "caveats": list(CAVEATS),
        "channels": list(spec["expected"]["channels"]),
        "totals": totals,
        "byRegion": by_region,
        "byAdministrationType": by_admin_type,
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "channels", "totals", "byRegion", "byAdministrationType"):
        if key not in data:
            raise SnapshotError(f"data artifact: campo {key} mancante")
    if data["datasetId"] != "consip-ordini" or data["schemaVersion"] != 1:
        raise SnapshotError("data artifact: identità inattesa")
    if not data["caveats"]:
        raise SnapshotError("data artifact: caveats assenti — i limiti del dato fanno parte del dato")
    for section in ("totals", "byRegion", "byAdministrationType"):
        for row in data[section]:
            if not isinstance(row.get("rows"), int) or row["rows"] < 0:
                raise SnapshotError(f"data artifact: rows non valido in {section}")
            # amountKnownCents puo' essere negativo in un gruppo dominato dagli storni:
            # e' un fatto della fonte, non un errore nostro. Intero si', positivo non necessariamente.
            if not isinstance(row.get("amountKnownCents"), int):
                raise SnapshotError(f"data artifact: amountKnownCents non valido in {section}")
    for total in data["totals"]:
        year_channel = [r for r in data["byRegion"] if r["year"] == total["year"] and r["channel"] == total["channel"]]
        if sum(r["amountKnownCents"] for r in year_channel) != total["amountKnownCents"]:
            raise SnapshotError("data artifact: byRegion non riconcilia con totals")


def build_metadata(spec: dict[str, Any], data_bytes: bytes) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "datasetId": "consip-ordini",
        "period": dict(spec["period"]),
        "source": {
            "owner": spec["source"]["owner"],
            "landingUrl": spec["source"]["landingUrl"],
            "licenseId": spec["source"]["licenseId"],
            "licenseNote": spec["source"]["licenseNote"],
            "packages": dict(spec["source"]["packages"]),
            "acquisition": dict(spec["source"]["acquisition"]),
            "assets": {name: dict(asset) for name, asset in spec["source"]["assets"].items()},
        },
        "suppression": dict(spec["suppression"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md): soldi, periodo,
        # provenance — espliciti nel metadata dello snapshot, non deducibili dal lettore.
        "semantics": {
            "soldi": {
                "unit": "centesimi di euro",
                "nature": "ordinato (ordini di acquisto sottoscritti) — non è stanziamento, non è impegno, non è pagamento SIOPE",
                "note": "Somme come limiti inferiori per soppressione delle celle; gli storni negativi concorrono col loro segno. Zero osservato, cella soppressa e riga di sola anagrafica restano distinti nei conteggi.",
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": "Anno di riferimento dichiarato dalla fonte in ogni riga (Anno_Riferimento); il 2026 è parziale.",
            },
            "provenance": {
                "holder": spec["source"]["owner"],
                "canonicalUrls": [spec["source"]["landingUrl"]] + sorted(a["url"] for a in spec["source"]["assets"].values()),
                "publicationDate": "2026-03-19",
                "acquisitionDate": spec["source"]["acquisition"]["acquiredAt"],
                "checkedAt": spec["source"]["acquisition"]["checkedAt"],
                "license": spec["source"]["licenseId"],
                "hashes": "SHA-256 per asset in source.assets; artefatto in integrity.dataArtifact",
            },
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {
                "path": spec["integrity"]["dataArtifact"]["path"],
                "bytes": len(data_bytes),
                "sha256": sha256_bytes(data_bytes),
            },
            "sourceLockSha256": canonical_lock_sha256(spec),
        },
    }


def _check(spec_path: Path, data_path: Path, meta_path: Path) -> None:
    spec = load_source_spec(spec_path)
    if spec["integrity"]["lockSha256"] != canonical_lock_sha256(spec):
        raise SnapshotError("lockSha256 non corrisponde al contenuto del lock")
    data_bytes = data_path.read_bytes()
    data = json.loads(data_bytes.decode("utf-8"))
    validate_snapshot(data)
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    artifact = metadata["integrity"]["dataArtifact"]
    if artifact["sha256"] != sha256_bytes(data_bytes) or artifact["bytes"] != len(data_bytes):
        raise SnapshotError("meta: hash o dimensione del data artifact divergenti")
    if metadata["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente dal lock")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input-dir", type=Path, help="cartella con i sei CSV scaricati dal portale")
    parser.add_argument("--check", action="store_true", help="valida gli artefatti committati senza input di rete")
    parser.add_argument("--write", action="store_true", help="scrive artefatti e integrity nel lock")
    args = parser.parse_args()

    try:
        if args.check:
            _check(args.spec, args.data, args.meta)
            print("consip-ordini: lock, data e meta coerenti")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con i sei CSV, oppure --check")
        spec = load_source_spec(args.spec)
        inputs = {}
        for channel in spec["expected"]["channels"]:
            prefix = "ordini-convenzione" if channel == "convenzioni" else "ordini-mepa"
            for year in spec["expected"]["years"]:
                path = args.input_dir / f"{prefix}-{year}.csv"
                if not path.is_file():
                    raise SnapshotError(f"input mancante: {path}")
                inputs[f"{channel}-{year}"] = path.read_bytes()
        data = build_data(inputs, spec)
        validate_snapshot(data)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(f"consip-ordini: build ok ({len(data['byRegion'])} righe regionali, {len(data_bytes)} byte) — usa --write per salvare")
            return 0
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_metadata(spec, data_bytes)
        args.meta.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"consip-ordini: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"consip-ordini: {error}", file=__import__('sys').stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
