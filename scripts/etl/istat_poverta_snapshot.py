#!/usr/bin/env python3
"""Build the hash-pinned ISTAT absolute-poverty snapshot (34_727, principali indicatori).

The input is the SDMX-CSV response of the ISTAT dataflow 34_727_DF_DCCV_POVERTA_1
for a FULLY specified key: of the eleven dimensions, nine have a single value in
this table and are pinned literally, while REF_AREA and DATA_TYPE are enumerated.
The bytes are therefore deterministic and a different hash means the source revised
the series rather than time simply passing.  Runtime and CI never call ISTAT.

Four properties of the source are carried into the artifact instead of being
smoothed away:

* `34_727` is the CURRENT post-revision series (2014-2024).  The dataflows
  `34_201` and `34_202`, which the issue originally proposed, are closed series
  ending in 2013, and `34_728` holds the broken 1997-2021 series.  None of them
  may be spliced onto this one: they are different series, not earlier years.
* `OBS_STATUS` is bound to `CL_FLAG`, NOT to `CL_OBS_STATUS`.  The flag `0` means
  "il dato non raggiunge la metà della cifra minima considerata" — a positive
  value below the rounding floor, neither an observed zero nor a suppression.  A
  flagged cell keeps a null value and never becomes zero.
* This dataset is NOT money.  It mixes rates and compositions in percent with
  counts in thousands, so the `soldi` axis is declared absent rather than invented,
  and each measure carries its own unit.
* Composite territories overlap the ones they contain (Nord = Nord-ovest +
  Nord-est, Mezzogiorno = Sud + Isole).  They are typed so nobody sums them into a
  double count, and only the COUNT measures are reconciled: incidences and
  intensities are not summable across territories at all.

Values are stored as integers multiplied by ten: the source publishes percentages
with at most one decimal and counts with none, so the conversion stays exact and no
float ever reaches the artifact.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-poverta-assoluta-2014-2024.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-poverta-assoluta-2014-2024.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-poverta-assoluta-2014-2024.meta.json"

DATASET_ID = "istat-poverta-assoluta"
# Trailing slash on purpose: without it "https://esploradati.istat.it" is also a
# literal prefix of "https://esploradati.istat.it.example.org".
OFFICIAL_PREFIX = "https://esploradati.istat.it/"

INPUT_FILENAME = "poverta-assoluta.csv"

CAVEATS = (
    "Non è spesa pubblica. Sono incidenze, intensità e conteggi di famiglie e individui: "
    "non vanno sommati né accostati a SIOPE, OpenBDAP o all'IRPEF dichiarata, e non misurano "
    "quanto lo Stato spende contro la povertà.",
    "Incidenza, intensità e composizione percentuale sono misure diverse con unità diverse: "
    "non si sommano fra loro e non stanno sullo stesso asse.",
    "Famiglie e individui sono denominatori distinti e non intercambiabili: l'incidenza "
    "familiare e quella individuale non sono la stessa grandezza.",
    "Le incidenze e le intensità NON sono sommabili fra territori: solo i conteggi in migliaia "
    "lo sono. Sommare le percentuali delle ripartizioni non dà il valore nazionale.",
    "Le aree composite (Nord = Nord-ovest + Nord-est, Mezzogiorno = Sud + Isole) contengono già "
    "le aree che le compongono: sommarle alle loro parti è un doppio conteggio.",
    "È la serie corrente post-revisione, che parte dal 2014. Le serie 34_201 e 34_202 si fermano "
    "al 2013 e la serie interrotta 34_728 copre il 1997-2021: sono serie distinte e non vanno "
    "mai giuntate a questa.",
    "Una cella con flag non è uno zero osservato: il flag «0» della fonte significa che il dato "
    "non raggiunge la metà della cifra minima considerata, cioè un valore positivo sotto la "
    "soglia di arrotondamento.",
    "ISTAT non pubblica la povertà a livello comunale, ed è un'indagine campionaria: per la "
    "povertà assoluta il dettaglio territoriale si ferma alle ripartizioni.",
    "Il dato non dice nulla su efficacia di una manovra, merito o responsabilità di un governo.",
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
    # La licenza NON viene inferita: la risposta SDMX non espone alcun campo di
    # licenza, e un lock che ne dichiarasse una sarebbe sospetto.
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
    if spec["measure"].get("scale") != 10:
        raise SnapshotError("source lock: la scala dichiarata deve essere 10")
    return spec


def _tenths(raw: str, where: str) -> int:
    """Convert a published value to tenths, exactly or not at all."""
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"valore non numerico {raw!r} in {where}") from error
    # Il lock dichiara che la fonte pubblica AL PIÙ un decimale: è ciò che rende
    # esatta la conversione. Se un rilascio futuro cambiasse precisione non sarebbe
    # più lo stesso contratto, quindi ci si ferma invece di arrotondare in silenzio.
    if -value.as_tuple().exponent > 1:
        raise SnapshotError(
            f"valore {raw!r} in {where} ha più di un decimale: la fonte ne dichiarava al più uno"
        )
    scaled = value * 10
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"valore {raw!r} in {where} non è convertibile esattamente in decimi")
    return int(scaled)


Cell = tuple[str, str, int]  # (measure, territory, year)


def _read_rows(payload: bytes, spec: dict[str, Any]) -> dict[Cell, int | None]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"risposta SDMX non decodificabile: {error}") from error
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise SnapshotError("risposta SDMX vuota")

    # Le nove dimensioni fissate devono restare tali: se la fonte ne aprisse una,
    # la chiave non sarebbe più completamente specificata e i byte non sarebbero
    # più deterministici.
    for column, expected in spec["expected"]["fixedDimensions"].items():
        observed = {row.get(column) for row in rows}
        if observed != {expected}:
            raise SnapshotError(
                f"{column}: attesa la sola {expected!r}, trovate {sorted(map(str, observed))!r} — "
                "la chiave deve restare completamente specificata"
            )

    territories = {t["code"] for t in spec["expected"]["territories"]}
    measures = {m["code"] for m in spec["expected"]["measures"]}
    years = set(spec["expected"]["years"])
    known_flags = set(spec["expected"]["flagMarker"]["knownValues"])

    out: dict[Cell, int | None] = {}
    flagged = 0
    for row in rows:
        territory = row["REF_AREA"]
        measure = row["DATA_TYPE"]
        try:
            year = int(row["TIME_PERIOD"])
        except (TypeError, ValueError) as error:
            raise SnapshotError(f"anno non valido {row.get('TIME_PERIOD')!r}") from error
        if territory not in territories or measure not in measures or year not in years:
            raise SnapshotError(f"cella fuori dal lock: {measure}/{territory}/{year}")
        key: Cell = (measure, territory, year)
        if key in out:
            raise SnapshotError(f"cella duplicata nella risposta: {key}")

        status = (row.get("OBS_STATUS") or "").strip()
        raw = (row.get("OBS_VALUE") or "").strip()
        if status:
            # Un flag non è mai uno zero: il valore resta null e viene contato.
            if status not in known_flags:
                raise SnapshotError(
                    f"flag {status!r} sconosciuto su {key}: non è in CL_FLAG come dichiarato nel lock"
                )
            if raw:
                raise SnapshotError(
                    f"cella {key}: flag {status!r} con un valore presente — la fonte "
                    "dichiarava le celle flaggate come vuote"
                )
            out[key] = None
            flagged += 1
            continue
        if not raw:
            raise SnapshotError(f"cella {key}: valore vuoto senza flag, non è interpretabile")
        out[key] = _tenths(raw, f"{measure}/{territory}/{year}")

    expected_cells = spec["expected"]["cells"]
    if len(out) != expected_cells:
        raise SnapshotError(f"copertura: {len(out)} celle, attese {expected_cells}")
    if flagged != spec["expected"]["flagged"]:
        raise SnapshotError(
            f"celle flaggate: {flagged}, attese {spec['expected']['flagged']} — "
            "un cambio di soppressione va dichiarato nel lock, non assorbito"
        )
    return out


def _reconcile(cells: dict[Cell, int | None], spec: dict[str, Any]) -> dict[str, Any]:
    """Check the declared partitions on the COUNT measures only.

    Nothing is corrected: the source's own totals stay the published ones and the
    gap is only bounded.  The bound is empirical because the source rounds counts
    to whole thousands, so a five-part partition can differ by a few units without
    anything being wrong.  Rates and compositions are deliberately NOT reconciled
    by sum: they are not summable, and that is asserted as a negative check.
    """
    rules = spec["reconciliation"]
    tolerance = rules["toleranceTenths"]
    years = spec["expected"]["years"]
    by_code = {m["code"]: m for m in spec["expected"]["measures"]}
    countable = [m["code"] for m in spec["expected"]["measures"] if m["kind"] == "count"]

    checks: list[dict[str, Any]] = []
    worst_overall = 0

    for measure in countable:
        for rule in rules["territorial"]:
            whole, parts = rule["whole"], rule["parts"]
            worst = 0
            worst_at = None
            count = 0
            for year in years:
                if (measure, whole, year) not in cells:
                    raise SnapshotError(f"manca il totale {whole} per {measure}/{year}")
                total = cells[(measure, whole, year)]
                summed = 0
                for part in parts:
                    if (measure, part, year) not in cells:
                        raise SnapshotError(f"manca {part} per {measure}/{year}")
                    value = cells[(measure, part, year)]
                    if value is None or total is None:
                        raise SnapshotError(
                            f"riconciliazione {measure}/{whole}/{year}: una parte è flaggata, "
                            "la partizione non è verificabile e non viene dichiarata valida"
                        )
                    summed += value
                gap = abs(total - summed)
                count += 1
                if gap > tolerance:
                    raise SnapshotError(
                        f"territorio {whole} su {measure}/{year}: scarto {gap} decimi, oltre la "
                        f"tolleranza dichiarata di {tolerance} — non è più arrotondamento"
                    )
                if gap > worst:
                    worst, worst_at = gap, f"{measure}/{year}"
            worst_overall = max(worst_overall, worst)
            checks.append({"kind": "territorio", "measure": measure, "whole": whole,
                           "parts": list(parts), "comparisons": count,
                           "maxGapTenths": worst, "maxGapAt": worst_at})

    # Le composizioni percentuali chiudono a 100 sulle ripartizioni base.
    base = rules["compositionBase"]
    total_tenths = rules["compositionTotalTenths"]
    composition_tolerance = rules["compositionToleranceTenths"]
    for measure, entry in by_code.items():
        if entry["kind"] != "composition":
            continue
        worst = 0
        worst_at = None
        count = 0
        for year in years:
            summed = 0
            for part in base:
                value = cells.get((measure, part, year))
                if value is None:
                    raise SnapshotError(f"composizione {measure}/{year}: parte {part} assente o flaggata")
                summed += value
            gap = abs(summed - total_tenths)
            count += 1
            if gap > composition_tolerance:
                raise SnapshotError(
                    f"composizione {measure}/{year}: somma {summed} decimi contro {total_tenths} "
                    f"attesi, scarto {gap} oltre la tolleranza di {composition_tolerance}"
                )
            if gap > worst:
                worst, worst_at = gap, str(year)
        checks.append({"kind": "composizione", "measure": measure, "whole": "100%",
                       "parts": list(base), "comparisons": count,
                       "maxGapTenths": worst, "maxGapAt": worst_at})

    # Controllo NEGATIVO: le incidenze non devono chiudere per somma. Se un giorno
    # chiudessero, significherebbe che la misura non è più un tasso e il contratto
    # starebbe pubblicando un'altra cosa con la stessa etichetta.
    negative: list[dict[str, Any]] = []
    for measure, entry in by_code.items():
        if entry["kind"] != "rate":
            continue
        for year in years:
            national = cells.get((measure, "IT", year))
            summed = 0
            complete = True
            for part in base:
                value = cells.get((measure, part, year))
                if value is None:
                    complete = False
                    break
                summed += value
            if not complete or national is None:
                continue
            if abs(national - summed) <= tolerance:
                raise SnapshotError(
                    f"{measure}/{year}: la somma delle ripartizioni coincide con il valore "
                    "nazionale entro la tolleranza dei conteggi. Un tasso non si comporta così: "
                    "o la misura è cambiata natura, o è stata classificata male"
                )
        negative.append({"measure": measure, "assertion": "somma delle ripartizioni != valore nazionale"})

    return {"note": rules["note"], "toleranceTenths": tolerance,
            "maxGapTenths": worst_overall, "checks": checks, "notSummable": negative}


def build_data(payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    cells = _read_rows(payload, spec)
    observations = [
        {"measure": measure, "territory": territory, "year": year, "valueTenths": value}
        for (measure, territory, year), value in sorted(cells.items())
    ]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "caveats": list(CAVEATS),
        "scale": {
            "factor": spec["measure"]["scale"],
            "note": spec["measure"]["scaleNote"],
        },
        "measures": [dict(m) for m in spec["expected"]["measures"]],
        "territories": [dict(t) for t in spec["expected"]["territories"]],
        "observations": observations,
        "flags": {
            "attribute": spec["expected"]["flagMarker"]["attribute"],
            "codelist": spec["expected"]["flagMarker"]["codelist"],
            "note": spec["expected"]["flagMarker"]["note"],
            "flaggedCells": sum(1 for o in observations if o["valueTenths"] is None),
        },
        "coverage": {"expectedCells": spec["expected"]["cells"], "observedCells": len(observations)},
        "reconciliation": _reconcile(cells, spec),
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "scale", "measures",
                "territories", "observations", "flags", "coverage", "reconciliation"):
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

    territories = {t["code"] for t in data["territories"]}
    measures = {m["code"] for m in data["measures"]}
    years = range(data["period"]["from"], data["period"]["to"] + 1)
    seen = set()
    for observation in data["observations"]:
        key = (observation["measure"], observation["territory"], observation["year"])
        if key in seen:
            raise SnapshotError(f"data artifact: osservazione duplicata {key}")
        seen.add(key)
        if observation["territory"] not in territories or observation["measure"] not in measures:
            raise SnapshotError(f"data artifact: codice fuori anagrafica in {key}")
        if observation["year"] not in years:
            raise SnapshotError(f"data artifact: anno fuori periodo in {key}")
        value = observation["valueTenths"]
        if value is None:
            continue
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise SnapshotError(f"data artifact: valueTenths non valido in {key}")

    if not any(t["kind"] == "composite" for t in data["territories"]):
        raise SnapshotError("data artifact: le aree composite devono restare marcate come tali")
    for territory in data["territories"]:
        if territory["kind"] == "composite" and not territory.get("parts"):
            raise SnapshotError(f"data artifact: composito {territory['code']} senza le sue parti")
    # Nessuna misura relativa può entrare in questa fetta: sarebbe un altro dataset.
    for measure in data["measures"]:
        if "POVREL" in measure["code"]:
            raise SnapshotError(
                f"data artifact: {measure['code']} è una misura di povertà relativa e non "
                "appartiene a questo dataset (è la Fetta B, id e artefatti separati)"
            )
        if measure["kind"] not in {"rate", "composition", "count"}:
            raise SnapshotError(f"data artifact: kind inatteso per {measure['code']}")
        if measure["kind"] != "count" and measure["summableAcrossTerritories"]:
            raise SnapshotError(
                f"data artifact: {measure['code']} non è un conteggio e non può essere "
                "dichiarato sommabile fra territori"
            )


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
            "dataflowId": source["dataflowId"],
            "dataflowLabel": source["dataflowLabel"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "seriesNote": source["seriesNote"],
            "acquisition": dict(source["acquisition"]),
            "assets": {name: dict(asset) for name, asset in source["assets"].items()},
        },
        "measures": [dict(m) for m in spec["expected"]["measures"]],
        "reconciliation": dict(data["reconciliation"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md).
        "semantics": {
            "soldi": {
                "unit": "nessuna — il dataset non contiene importi",
                "nature": (
                    "incidenze e intensità in percentuale e conteggi di famiglie e individui in "
                    "migliaia: non sono euro, non sono spesa pubblica, non sono cassa né competenza"
                ),
                "note": (
                    "L'asse soldi è dichiarato ASSENTE, non ricostruito. Nessuna somma né "
                    "accostamento con SIOPE, OpenBDAP o mef_irpef: misurano un'altra cosa."
                ),
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": source["seriesNote"],
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]] + sorted(a["url"] for a in source["assets"].values()),
                # ISTAT non dichiara una data di pubblicazione nella risposta: restano
                # la data di acquisizione e quella di verifica, che sono ciò che
                # possiamo affermare davvero.
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
            print("istat-poverta-assoluta: lock, data e meta coerenti")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con la risposta SDMX-CSV, oppure --check")
        spec = load_source_spec(args.spec)
        _, asset = next(iter(spec["source"]["assets"].items()))
        path = args.input_dir / INPUT_FILENAME
        if not path.is_file():
            raise SnapshotError(f"input mancante: {path}")
        payload = path.read_bytes()
        if sha256_bytes(payload) != asset["sha256"] or len(payload) != asset["bytes"]:
            raise SnapshotError(f"input {path.name}: byte diversi da quelli vincolati nel lock")
        data = build_data(payload, spec)
        validate_snapshot(data)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(
                f"istat-poverta-assoluta: build ok ({len(data['observations'])} osservazioni, "
                f"{len(data_bytes)} byte) — usa --write per salvare"
            )
            return 0
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_metadata(spec, data_bytes, data)
        args.meta.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"istat-poverta-assoluta: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"istat-poverta-assoluta: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
