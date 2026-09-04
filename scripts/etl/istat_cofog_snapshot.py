#!/usr/bin/env python3
"""Build the hash-pinned ISTAT COFOG snapshot (government final consumption by function).

The input is the SDMX-CSV response of the ISTAT dataflow 93_1227_DF_DCCN_TNA1_4
for a FULLY specified key: measure, valuation and edition are pinned in the URL,
so the bytes are deterministic and a different hash means the source revised the
series rather than time simply passing.  Runtime and CI never call ISTAT.

Four properties of the source are carried into the artifact instead of being
smoothed away:

* This is `P3`, final consumption expenditure, NOT total government spending.
  Italy 2023 is ~383 billion euro here against ~1149 billion of total general
  government expenditure in Eurostat `gov_10a_exp`.  The two must never be
  compared or summed, and the artifact says so in its caveats.
* The source's own label for the code `G` is "spesa totale della pubblica
  amministrazione", which is true of the codelist but false of this measure:
  combined with `P3_D_W0_S13` it is the total of final consumption only.  The
  snapshot relabels it rather than propagating a statement the data does not
  support.
* Editions are revisions, not a series.  Between editions 2025M1 and 2025M12,
  337 of the 704 comparable cells change value.  One edition is pinned and
  declared; mixing them would invent a trend out of a revision.
* Composite territories overlap the ones they contain (Nord = Nord-ovest +
  Nord-est, Mezzogiorno = Sud + Isole, ...).  They are typed so that nobody sums
  them into a double count, and every declared partition is checked.

Money is stored in cents: the source publishes millions of euro with at most one
decimal, so the conversion stays exact on integers.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-cofog-1995-2023.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-cofog-1995-2023.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-cofog-1995-2023.meta.json"

DATASET_ID = "istat-cofog"
# Trailing slash on purpose: without it "https://esploradati.istat.it" is also a
# literal prefix of "https://esploradati.istat.it.example.org".
OFFICIAL_PREFIX = "https://esploradati.istat.it/"

# Millions of euro -> cents.  The source publishes at most one decimal, so this
# stays exact on integers and no float ever reaches the artifact.
CENTS_PER_MILLION_EUR = 100_000_000
# Tenth of a million euro, the unit the tolerance is expressed in.
CENTS_PER_TENTH_MILLION = CENTS_PER_MILLION_EUR // 10

CAVEATS = (
    "È spesa per consumi finali (P3) delle Amministrazioni pubbliche, NON la spesa pubblica "
    "totale: ne è una componente. Nel 2023 vale circa 383 miliardi di euro contro i circa 1149 "
    "della spesa totale delle AP. Non va confrontata né sommata con Eurostat gov_10a_exp, con "
    "SIOPE o con le missioni del bilancio dello Stato.",
    "La fonte etichetta il codice «G» come «spesa totale della pubblica amministrazione»: vale per "
    "il codelist, non per questa misura. Qui «G» è il totale dei soli consumi finali, e lo "
    "snapshot lo rinomina invece di propagare un'affermazione che il dato non sostiene.",
    "L'edizione è una revisione, non una serie: fra l'edizione 2025M1 e la 2025M12 cambiano 337 "
    "delle 704 celle confrontabili. Lo snapshot fissa una sola edizione e la dichiara.",
    "I valori sono a prezzi correnti. I valori concatenati sono una serie distinta e non sono "
    "pubblicati qui: accostarli sarebbe un errore di unità.",
    "Le aree composite (Nord, Centro-nord, Mezzogiorno, Trentino Alto Adige) contengono già le "
    "aree che le compongono: sommarle alle loro parti è un doppio conteggio.",
    "Il dato territoriale è il territorio di erogazione contabile, non «quanto riceve» un "
    "cittadino di quella regione, e non misura efficienza o qualità del servizio.",
    "Contabilità nazionale a competenza economica: non sono pagamenti di cassa.",
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
    for key in ("schemaVersion", "datasetId", "period", "source", "measure",
                "expected", "reconciliation", "integrity"):
        if key not in spec:
            raise SnapshotError(f"source lock: campo {key} mancante")
    if spec["datasetId"] != DATASET_ID:
        raise SnapshotError("source lock: datasetId inatteso")
    # La licenza NON viene inferita: il precedente del Casellario pensioni vale
    # anche qui, e un lock che dichiarasse una licenza sarebbe sospetto.
    if spec["source"].get("licenseId") != "not-declared":
        raise SnapshotError("source lock: la risposta SDMX ISTAT non dichiara una licenza riusabile")
    if not str(spec["source"].get("landingUrl", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: landing URL non ufficiale ISTAT")
    for name, asset in spec["source"]["assets"].items():
        if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: URL non ufficiale per {name}")
        if len(str(asset.get("sha256", ""))) != 64 or not set(str(asset["sha256"])) <= set("0123456789abcdef"):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
    return spec


def _cents(raw: str, where: str) -> int:
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"valore non numerico {raw!r} in {where}") from error
    # Il lock dichiara che la fonte pubblica milioni di euro con AL PIÙ un
    # decimale: è ciò che rende esatta la conversione in centesimi. Se un
    # rilascio futuro cambiasse precisione non sarebbe più lo stesso contratto,
    # quindi si ferma qui invece di convertire in silenzio.
    if -value.as_tuple().exponent > 1:
        raise SnapshotError(
            f"valore {raw!r} in {where} ha più di un decimale: la fonte ne dichiarava al più uno"
        )
    scaled = value * CENTS_PER_MILLION_EUR
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"valore {raw!r} in {where} non è convertibile esattamente in centesimi")
    return int(scaled)


def _read_rows(payload: bytes, spec: dict[str, Any]) -> dict[tuple[str, int, str], int]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"risposta SDMX non decodificabile: {error}") from error
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise SnapshotError("risposta SDMX vuota")

    measure = spec["measure"]
    fixed = {
        "DATA_TYPE_AGGR": measure["dataTypeAggr"],
        "VALUATION": measure["valuation"],
        "EDITION": measure["edition"],
    }
    for column, expected in fixed.items():
        observed = {row.get(column) for row in rows}
        if observed != {expected}:
            raise SnapshotError(
                f"{column}: attesa la sola {expected!r}, trovate {sorted(observed)!r} — "
                "misura, valutazione ed edizione devono restare fissate"
            )

    areas = {a["code"] for a in spec["expected"]["areas"]}
    functions = {f["code"] for f in spec["expected"]["functions"]}
    years = set(spec["expected"]["years"])

    out: dict[tuple[str, int, str], int] = {}
    for row in rows:
        area = row["REF_AREA"]
        function = row["EXPEND_PURPOSE_COICOPCOFOG"]
        try:
            year = int(row["TIME_PERIOD"])
        except (TypeError, ValueError) as error:
            raise SnapshotError(f"anno non valido {row.get('TIME_PERIOD')!r}") from error
        if area not in areas or function not in functions or year not in years:
            raise SnapshotError(f"cella fuori dal lock: {area}/{year}/{function}")
        status = (row.get("OBS_STATUS") or "").strip()
        if status:
            raise SnapshotError(
                f"flag di stato inatteso {status!r} su {area}/{year}/{function}: "
                "la fonte non ne dichiarava alla stipula del lock"
            )
        key = (area, year, function)
        if key in out:
            raise SnapshotError(f"cella duplicata nella risposta: {key}")
        out[key] = _cents(row["OBS_VALUE"], f"{area}/{year}/{function}")

    expected_cells = spec["expected"]["cells"]
    if len(out) != expected_cells:
        raise SnapshotError(f"copertura: {len(out)} celle, attese {expected_cells}")
    return out


def _reconcile(cells: dict[tuple[str, int, str], int], spec: dict[str, Any]) -> dict[str, Any]:
    """Check every declared partition against a single, empirical tolerance.

    Nothing is corrected: the source's own totals stay the published ones and the
    gap is only bounded.  The bound is empirical because the source publishes some
    figures with one decimal and some with none, so a purely theoretical rounding
    bound would be contradicted by the data.
    """
    rules = spec["reconciliation"]
    tolerance = rules["toleranceTenths"] * CENTS_PER_TENTH_MILLION
    years = spec["expected"]["years"]
    areas = [a["code"] for a in spec["expected"]["areas"]]

    checks: list[dict[str, Any]] = []
    worst_overall = 0

    def run(label: str, whole: str, parts: list[str], scope: list[tuple[str, ...]]) -> None:
        nonlocal worst_overall
        worst = 0
        worst_at = None
        count = 0
        for key in scope:
            if label == "funzioni":
                area, year = key
                if (area, year, whole) not in cells:
                    raise SnapshotError(f"manca il totale {whole} per {area}/{year}")
                total = cells[(area, year, whole)]
                summed = 0
                for part in parts:
                    if (area, year, part) not in cells:
                        raise SnapshotError(f"manca {part} per {area}/{year}")
                    summed += cells[(area, year, part)]
                where = f"{area}/{year}"
            else:
                year, function = key
                if (whole, year, function) not in cells:
                    raise SnapshotError(f"manca l'area {whole} per {year}/{function}")
                total = cells[(whole, year, function)]
                summed = 0
                for part in parts:
                    if (part, year, function) not in cells:
                        raise SnapshotError(f"manca l'area {part} per {year}/{function}")
                    summed += cells[(part, year, function)]
                where = f"{year}/{function}"
            gap = abs(total - summed)
            count += 1
            if gap > tolerance:
                raise SnapshotError(
                    f"{label} {whole}: scarto {gap} centesimi su {where}, oltre la tolleranza "
                    f"dichiarata di {tolerance} — non è più arrotondamento"
                )
            if gap > worst:
                worst, worst_at = gap, where
        worst_overall = max(worst_overall, worst)
        checks.append({"kind": label, "whole": whole, "parts": list(parts),
                       "comparisons": count, "maxGapCents": worst, "maxGapAt": worst_at})

    function_rule = rules["functionTotal"]
    run("funzioni", function_rule["whole"], function_rule["parts"],
        [(area, year) for area in areas for year in years])

    functions = [f["code"] for f in spec["expected"]["functions"]]
    for rule in rules["territorial"]:
        run("territorio", rule["whole"], rule["parts"],
            [(year, function) for year in years for function in functions])

    return {"note": rules["note"], "toleranceCents": tolerance,
            "maxGapCents": worst_overall, "checks": checks}


def build_data(payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    cells = _read_rows(payload, spec)
    observations = [
        {"area": area, "year": year, "function": function, "amountCents": value}
        for (area, year, function), value in sorted(cells.items())
    ]
    measure = spec["measure"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "caveats": list(CAVEATS),
        "measure": {
            "code": measure["dataTypeAggr"],
            "meaning": measure["meaning"],
            "unit": "centesimi di euro",
            "valuation": measure["valuation"],
            "valuationLabel": measure["valuationLabel"],
            "edition": measure["edition"],
        },
        "functions": [dict(f) for f in spec["expected"]["functions"]],
        "areas": [dict(a) for a in spec["expected"]["areas"]],
        "observations": observations,
        "coverage": {"expectedCells": spec["expected"]["cells"], "observedCells": len(observations)},
        "reconciliation": _reconcile(cells, spec),
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "measure",
                "functions", "areas", "observations", "coverage", "reconciliation"):
        if key not in data:
            raise SnapshotError(f"data artifact: campo {key} mancante")
    if data["datasetId"] != DATASET_ID or data["schemaVersion"] != 1:
        raise SnapshotError("data artifact: identità inattesa")
    if not data["caveats"]:
        raise SnapshotError("data artifact: caveats assenti — i limiti del dato fanno parte del dato")
    if data["coverage"]["observedCells"] != data["coverage"]["expectedCells"]:
        raise SnapshotError("data artifact: copertura incompleta")
    if len(data["observations"]) != data["coverage"]["expectedCells"]:
        raise SnapshotError("data artifact: osservazioni e copertura non coincidono")

    areas = {a["code"] for a in data["areas"]}
    functions = {f["code"] for f in data["functions"]}
    years = range(data["period"]["from"], data["period"]["to"] + 1)
    seen = set()
    for observation in data["observations"]:
        key = (observation["area"], observation["year"], observation["function"])
        if key in seen:
            raise SnapshotError(f"data artifact: osservazione duplicata {key}")
        seen.add(key)
        if observation["area"] not in areas or observation["function"] not in functions:
            raise SnapshotError(f"data artifact: codice fuori anagrafica in {key}")
        if observation["year"] not in years:
            raise SnapshotError(f"data artifact: anno fuori periodo in {key}")
        value = observation["amountCents"]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise SnapshotError(f"data artifact: amountCents non valido in {key}")
    if not any(a["kind"] == "composite" for a in data["areas"]):
        raise SnapshotError("data artifact: le aree composite devono restare marcate come tali")


def build_metadata(spec: dict[str, Any], data_bytes: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    measure = spec["measure"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "observedAt": source["acquisition"]["checkedAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "dataflowId": source["dataflowId"],
            "dataflowLabel": source["dataflowLabel"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "acquisition": dict(source["acquisition"]),
            "assets": {name: dict(asset) for name, asset in source["assets"].items()},
        },
        "measure": dict(measure),
        "reconciliation": dict(data["reconciliation"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md).
        "semantics": {
            "soldi": {
                "unit": "centesimi di euro",
                "nature": (
                    "spesa per consumi finali (P3) delle Amministrazioni pubbliche (S13), contabilità "
                    "nazionale a competenza economica — non è la spesa totale delle AP, non è cassa, "
                    "non è stanziamento né impegno"
                ),
                "note": measure["unitEvidence"],
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": measure["editionNote"],
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]] + sorted(a["url"] for a in source["assets"].values()),
                # ISTAT non dichiara una data di pubblicazione nella risposta: l'edizione è
                # l'unico riferimento di rilascio, e resta tale invece di essere convertita
                # in una data che la fonte non afferma.
                "publicationEdition": measure["edition"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
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
    if data["period"] != spec["period"]:
        raise SnapshotError("data artifact: periodo divergente dal lock")
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
    parser.add_argument("--input-dir", type=Path, help="cartella con la risposta SDMX-CSV")
    parser.add_argument("--check", action="store_true", help="valida gli artefatti committati senza rete")
    parser.add_argument("--write", action="store_true", help="scrive artefatti e integrity nel lock")
    args = parser.parse_args()

    try:
        if args.check:
            _check(args.spec, args.data, args.meta)
            print("istat-cofog: lock, data e meta coerenti")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con la risposta SDMX-CSV, oppure --check")
        spec = load_source_spec(args.spec)
        name, asset = next(iter(spec["source"]["assets"].items()))
        path = args.input_dir / f"tna1_4-{spec['measure']['valuation']}-{spec['measure']['edition']}.csv"
        if not path.is_file():
            raise SnapshotError(f"input mancante: {path}")
        payload = path.read_bytes()
        if sha256_bytes(payload) != asset["sha256"] or len(payload) != asset["bytes"]:
            raise SnapshotError(f"input {path.name}: byte diversi da quelli vincolati nel lock")
        data = build_data(payload, spec)
        validate_snapshot(data)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(f"istat-cofog: build ok ({len(data['observations'])} osservazioni, {len(data_bytes)} byte) — usa --write per salvare")
            return 0
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_metadata(spec, data_bytes, data)
        args.meta.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"istat-cofog: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"istat-cofog: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
