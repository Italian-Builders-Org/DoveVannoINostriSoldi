#!/usr/bin/env python3
"""Build the hash-pinned INPS NASpI snapshot (beneficiaries and benefit spells).

The nine inputs are the SDMX-ML 2.1 responses of the INPS open data portal for
the `dfb_st_naspi_*` packages.  They are deliberately passed as local files:
runtime and CI never call INPS, and a structure or hash drift fails closed
before an existing artifact can be replaced.

Why SDMX-ML and not the other two distributions the source offers:

* the **CSV** is not CSV.  It contains no control byte at all: zero newlines,
  records concatenated and separable only by the `INPS:DFB_ST_` token.  Putting
  the records back together on that token is exactly the kind of "cleaning" the
  import standard forbids, so the distribution is refused rather than repaired.
* the **SDMX-JSON** writes a suppressed cell as a BARE underscore
  (`"observations":{"0":[_,0]}`), which makes the file invalid JSON: 212 cells in
  `trattamenti_01`, 389 in `trattamenti_03`.  The other seven parse only because
  they happen to carry no suppression.  A format that breaks precisely where
  privacy is protected cannot be the one we depend on.

Two properties of the data are carried into the artifact instead of being
smoothed away:

* `beneficiari` and `trattamenti` are DIFFERENT measures — people against spells
  of benefit.  One more spell is not one more person, and the two families are
  never summed.
* a suppressed cell is not a zero.  The source marks it with `ObsValue="_"` plus
  the `MIS_PRIVACY` attribute; the artifact stores `count: null` with
  `suppressed: true`, and the contract refuses to let it become a number.

Unlike the two COFOG snapshots, this source is internally EXACT: territorial
hierarchies and the two cuts of the same population reconcile to the unit, so
the reconciliations demand equality instead of a rounding tolerance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/inps-naspi-2018-2022.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/inps-naspi-2018-2022.data.json"
DEFAULT_META = ROOT / "src/data/generated/inps-naspi-2018-2022.meta.json"

DATASET_ID = "inps-naspi"
# Trailing slash on purpose: without it "https://opendata.inps.it" is also a
# literal prefix of "https://opendata.inps.it.example.org".
OFFICIAL_PREFIX = "https://opendata.inps.it/"

NS = {
    "m": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message",
    "g": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic",
}

SUPPRESSED = "_"
DIMENSION_FIELD = {
    "TERRITORIO": "territorio",
    "SESSO": "sesso",
    "CLASSI_ETA": "classeEta",
    "DURATA_MESI_TEO": "durataMesiTeorica",
}

CAVEATS = (
    "«Beneficiari» e «trattamenti» sono misure diverse e non vanno sommate né confrontate: i primi "
    "sono persone, i secondi periodi di prestazione. Un trattamento in più non è una persona in più.",
    "Sono teste e prestazioni, NON euro: nessuna somma o confronto con la spesa per prestazioni, "
    "con SIOPE o con i bilanci INPS.",
    "È un flusso annuale, non uno stock: i beneficiari di un anno non si sommano fra anni e non sono "
    "confrontabili con lo stock di pensioni vigenti o con l'invalidità civile già in piattaforma.",
    "Perimetro distinto dalle pensioni IVS e dal Casellario ISTAT: nessun totale unico.",
    "Territorio, sesso, classe di età e durata teorica sono dimensioni distinte, non denominatori "
    "intercambiabili: non si sommano fra loro.",
    "Una cella soppressa per privacy non è uno zero osservato: resta null e marcata come soppressa.",
    "Il numero di beneficiari non dice nulla su adeguatezza, efficienza o merito della prestazione, "
    "né sulle ragioni della disoccupazione.",
)


class SnapshotError(ValueError):
    """Raised when an input, source lock, or generated snapshot diverges."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    stripped = json.loads(json.dumps(lock))
    stripped["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(stripped))


def load_source_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if not isinstance(spec, dict):
        raise SnapshotError("source lock: atteso un oggetto")
    for key in ("schemaVersion", "datasetId", "period", "source", "expected", "reconciliation", "integrity"):
        if key not in spec:
            raise SnapshotError(f"source lock: campo {key} mancante")
    if spec["datasetId"] != DATASET_ID:
        raise SnapshotError("source lock: datasetId inatteso")
    # La licenza e' verificata per package sul catalogo: il lock la dichiara e
    # il contratto la pretende, cosi' non puo' essere estesa in silenzio.
    if spec["source"].get("licenseId") != "IODL-2.0":
        raise SnapshotError("source lock: licenza attesa IODL-2.0 verificata per package")
    if not str(spec["source"].get("landingUrl", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: landing URL non ufficiale INPS")
    tables = spec["expected"]["tables"]
    if not tables:
        raise SnapshotError("source lock: nessuna tabella dichiarata")
    for name, table in tables.items():
        if not str(table.get("url", "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: URL non ufficiale per {name}")
        if len(str(table.get("sha256", ""))) != 64 or not set(str(table["sha256"])) <= set("0123456789abcdef"):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        if not isinstance(table.get("bytes"), int) or table["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
        if table.get("measure") not in ("beneficiari", "trattamenti"):
            raise SnapshotError(f"source lock: misura inattesa per {name}")
    return spec


def _read_table(payload: bytes, name: str, table: dict[str, Any], spec: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise SnapshotError(f"{name}: SDMX-ML non ben formato: {error}") from error

    header = root.find("m:Header", NS)
    if header is None:
        raise SnapshotError(f"{name}: header SDMX assente")
    prepared = header.findtext("m:Prepared", namespaces=NS)
    if prepared != table["sdmxPrepared"]:
        raise SnapshotError(f"{name}: Prepared {prepared!r} diverso dal lock {table['sdmxPrepared']!r}")

    dataset = root.find("m:DataSet", NS)
    if dataset is None:
        raise SnapshotError(f"{name}: DataSet assente")

    expected_dims = set(table["dimensions"])
    years = set(spec["expected"]["years"])
    marker = spec["expected"]["suppressionMarker"]

    rows: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    for series in dataset.findall("g:Series", NS):
        key_node = series.find("g:SeriesKey", NS)
        if key_node is None:
            raise SnapshotError(f"{name}: serie senza SeriesKey")
        key = {v.get("id"): v.get("value") for v in key_node.findall("g:Value", NS)}
        # FREQ e' dichiarata dalla fonte ma non e' una dimensione di prodotto:
        # se cambiasse valore, pero', non sarebbe piu' la stessa serie annuale.
        if key.get("FREQ") != "A":
            raise SnapshotError(f"{name}: frequenza {key.get('FREQ')!r} inattesa, attesa annuale")
        if set(key) - {"FREQ"} != expected_dims:
            raise SnapshotError(f"{name}: dimensioni {sorted(set(key) - {'FREQ'})} diverse dal lock")

        for obs in series.findall("g:Obs", NS):
            dim = obs.find("g:ObsDimension", NS)
            val = obs.find("g:ObsValue", NS)
            if dim is None or val is None:
                raise SnapshotError(f"{name}: osservazione senza dimensione o valore")
            try:
                year = int(dim.get("value"))
            except (TypeError, ValueError) as error:
                raise SnapshotError(f"{name}: anno non valido {dim.get('value')!r}") from error
            if year not in years:
                raise SnapshotError(f"{name}: anno {year} fuori dal periodo del lock")

            raw = val.get("value")
            attributes = obs.find("g:Attributes", NS)
            flags = {v.get("id"): v.get("value") for v in attributes.findall("g:Value", NS)} if attributes is not None else {}

            if raw == SUPPRESSED:
                if flags.get(marker["attribute"]) != marker["attributeValue"]:
                    raise SnapshotError(
                        f"{name}: cella soppressa senza l'attributo {marker['attribute']} atteso"
                    )
                count: int | None = None
                suppressed = True
            else:
                if flags.get(marker["attribute"]) is not None:
                    raise SnapshotError(f"{name}: cella valorizzata ma marcata come soppressa")
                if raw is None or not raw.lstrip("-").isdigit():
                    raise SnapshotError(f"{name}: valore non intero {raw!r}")
                count = int(raw)
                if count < 0:
                    raise SnapshotError(f"{name}: conteggio negativo {count}")
                suppressed = False

            row = {"table": name, "measure": table["measure"], "year": year}
            for dimension, field in DIMENSION_FIELD.items():
                if dimension in key:
                    row[field] = key[dimension]
            row["count"] = count
            if suppressed:
                row["suppressed"] = True

            cell = (name, year) + tuple(row.get(f) for f in DIMENSION_FIELD.values())
            if cell in seen:
                raise SnapshotError(f"{name}: cella duplicata {cell}")
            seen.add(cell)
            rows.append(row)

    if len(rows) != table["observations"]:
        raise SnapshotError(f"{name}: {len(rows)} osservazioni, attese {table['observations']}")
    actual_suppressed = sum(1 for r in rows if r.get("suppressed"))
    if actual_suppressed != table["suppressed"]:
        raise SnapshotError(f"{name}: {actual_suppressed} celle soppresse, attese {table['suppressed']}")
    return rows


def _totals(rows: list[dict[str, Any]], table: str, prefix: int | None = None) -> dict[tuple[str, int], int]:
    """Sum the known cells of one table by territory (optionally truncated) and year."""
    out: dict[tuple[str, int], int] = defaultdict(int)
    for row in rows:
        if row["table"] != table or row["count"] is None:
            continue
        territory = row["territorio"]
        out[(territory[:prefix] if prefix else territory, row["year"])] += row["count"]
    return dict(out)


def _reconcile(rows: list[dict[str, Any]], spec: dict[str, Any]) -> dict[str, Any]:
    """Check the declared identities exactly: this source has no rounding to absorb."""
    results = []
    for check in spec["reconciliation"]["checks"]:
        whole_table = check["whole"]
        part_table = check["parts"][0]
        prefix = {"ripartizioni-vs-regioni": 3, "regioni-vs-province": 4}.get(check["id"])
        whole = _totals(rows, whole_table)
        part = _totals(rows, part_table, prefix)
        shared = sorted(set(whole) & set(part))
        if not shared:
            raise SnapshotError(f"riconciliazione {check['id']}: nessuna chiave in comune")
        mismatches = [(k, whole[k], part[k]) for k in shared if whole[k] != part[k]]
        if mismatches:
            key, a, b = mismatches[0]
            raise SnapshotError(
                f"riconciliazione {check['id']} rotta su {key}: {a} contro {b} "
                f"({len(mismatches)} chiavi discordanti)"
            )
        results.append({"id": check["id"], "kind": check["kind"], "whole": whole_table,
                        "part": part_table, "comparisons": len(shared), "mismatches": 0,
                        "note": check["note"]})
    return {"note": spec["reconciliation"]["note"], "exact": True, "checks": results}


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    tables = spec["expected"]["tables"]
    rows: list[dict[str, Any]] = []
    for name in sorted(tables):
        rows.extend(_read_table(inputs[name], name, tables[name], spec))

    rows.sort(key=lambda r: (r["table"], r["year"], r.get("territorio") or "",
                             r.get("sesso") or "", r.get("classeEta") or "",
                             r.get("durataMesiTeorica") or ""))

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "caveats": list(CAVEATS),
        "measures": {
            "beneficiari": "Persone che hanno percepito la NASpI nell'anno (teste, non euro).",
            "trattamenti": "Periodi di prestazione NASpI dell'anno (prestazioni, non persone).",
        },
        "suppression": {
            "marker": dict(spec["expected"]["suppressionMarker"]),
            "note": "Cella soppressa per privacy: count resta null e non diventa mai zero.",
        },
        "tables": [
            {"id": name, "measure": t["measure"], "title": t["title"],
             "territoryLevel": t["territoryLevel"], "dimensions": list(t["dimensions"]),
             "observations": t["observations"], "suppressed": t["suppressed"]}
            for name, t in sorted(tables.items())
        ],
        "observations": rows,
        "coverage": {
            "expectedObservations": spec["expected"]["observations"],
            "observedObservations": len(rows),
            "suppressed": sum(1 for r in rows if r.get("suppressed")),
        },
        "reconciliation": _reconcile(rows, spec),
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "measures", "suppression",
                "tables", "observations", "coverage", "reconciliation"):
        if key not in data:
            raise SnapshotError(f"data artifact: campo {key} mancante")
    if data["datasetId"] != DATASET_ID or data["schemaVersion"] != 1:
        raise SnapshotError("data artifact: identità inattesa")
    if not data["caveats"]:
        raise SnapshotError("data artifact: caveats assenti — i limiti del dato fanno parte del dato")
    coverage = data["coverage"]
    if coverage["observedObservations"] != coverage["expectedObservations"]:
        raise SnapshotError("data artifact: copertura incompleta")
    if len(data["observations"]) != coverage["expectedObservations"]:
        raise SnapshotError("data artifact: osservazioni e copertura non coincidono")

    tables = {t["id"]: t for t in data["tables"]}
    years = range(data["period"]["from"], data["period"]["to"] + 1)
    suppressed = 0
    for observation in data["observations"]:
        table = tables.get(observation["table"])
        if table is None:
            raise SnapshotError(f"data artifact: tabella sconosciuta {observation['table']}")
        if observation["measure"] != table["measure"]:
            raise SnapshotError(f"data artifact: misura incoerente in {observation['table']}")
        if observation["year"] not in years:
            raise SnapshotError("data artifact: anno fuori periodo")
        count = observation["count"]
        if observation.get("suppressed"):
            suppressed += 1
            if count is not None:
                raise SnapshotError("data artifact: cella soppressa con un valore — non può diventare un numero")
        else:
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                raise SnapshotError("data artifact: conteggio non valido")
    if suppressed != coverage["suppressed"]:
        raise SnapshotError("data artifact: conteggio delle soppressioni divergente")
    if not any(t["measure"] == "beneficiari" for t in data["tables"]):
        raise SnapshotError("data artifact: manca la famiglia beneficiari")
    if not any(t["measure"] == "trattamenti" for t in data["tables"]):
        raise SnapshotError("data artifact: manca la famiglia trattamenti")


def build_metadata(spec: dict[str, Any], data_bytes: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "observedAt": source["acquisition"]["checkedAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "catalogApi": source["catalogApi"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "distributionChoice": dict(source["distributionChoice"]),
            "sdmxTestFlag": source["sdmxTestFlag"],
            "acquisition": dict(source["acquisition"]),
            "packages": {
                name: {"url": t["url"], "bytes": t["bytes"], "sha256": t["sha256"],
                       "package": t["package"], "sdmxPrepared": t["sdmxPrepared"]}
                for name, t in sorted(spec["expected"]["tables"].items())
            },
        },
        "reconciliation": dict(data["reconciliation"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md).
        "semantics": {
            "soldi": {
                "unit": "nessuna — il dataset non contiene importi",
                "nature": (
                    "conteggi di persone (beneficiari) e di periodi di prestazione (trattamenti) NASpI: "
                    "non sono euro, non sono spesa, non sono cassa"
                ),
                "note": (
                    "Nessuna somma con la spesa per prestazioni, con SIOPE o con i bilanci INPS. "
                    "Le due famiglie non si sommano fra loro."
                ),
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": (
                    "Flusso annuale dalla dimensione TIME_PERIOD, mai dedotto dall'URL. Non è uno stock "
                    "e non è sommabile fra anni."
                ),
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]]
                + sorted(t["url"] for t in spec["expected"]["tables"].values()),
                "publicationPrepared": sorted({t["sdmxPrepared"] for t in spec["expected"]["tables"].values()}),
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
                "hashes": "SHA-256 per package in source.packages; artefatto in integrity.dataArtifact",
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
    if data["period"] != spec["period"]:
        raise SnapshotError("data artifact: periodo divergente dal lock")
    _reconcile(data["observations"], spec)
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
    parser.add_argument("--input-dir", type=Path, help="cartella con le nove risposte SDMX-ML")
    parser.add_argument("--check", action="store_true", help="valida gli artefatti committati senza rete")
    parser.add_argument("--write", action="store_true", help="scrive artefatti e integrity nel lock")
    args = parser.parse_args()

    try:
        if args.check:
            _check(args.spec, args.data, args.meta)
            print("inps-naspi: lock, data e meta coerenti")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con le nove risposte SDMX-ML, oppure --check")
        spec = load_source_spec(args.spec)
        inputs = {}
        for name, table in spec["expected"]["tables"].items():
            path = args.input_dir / f"{table['package']}.xml"
            if not path.is_file():
                raise SnapshotError(f"input mancante: {path}")
            payload = path.read_bytes()
            if sha256_bytes(payload) != table["sha256"] or len(payload) != table["bytes"]:
                raise SnapshotError(f"input {path.name}: byte diversi da quelli vincolati nel lock")
            inputs[name] = payload
        data = build_data(inputs, spec)
        validate_snapshot(data)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(f"inps-naspi: build ok ({len(data['observations'])} osservazioni, {len(data_bytes)} byte) — usa --write per salvare")
            return 0
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_metadata(spec, data_bytes, data)
        args.meta.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"inps-naspi: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"inps-naspi: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
