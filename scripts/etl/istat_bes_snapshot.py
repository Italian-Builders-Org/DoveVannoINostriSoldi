#!/usr/bin/env python3
"""Build the hash-pinned ISTAT BesT snapshot (DF_BES_TERRIT_4, benessere economico).

The input is the SDMX-CSV response of the ISTAT dataflow `DF_BES_TERRIT_4` for the
`BES_04` domain: `FREQ`, `DOMAIN` and `EDITION` are pinned literally, `DATA_TYPE`
and `SEX` are enumerated, and `REF_AREA` is deliberately left open in the key while
the 139-territory anagrafica is pinned in the lock.  A territory outside that list
fails closed, and one more territory changes the bytes and therefore the hash.
Runtime and CI never call ISTAT.

Six properties of the source are carried into the artifact instead of being smoothed
away:

* **There is not one period.**  Each indicator has its own span (2004-2024 for one,
  2021-2023 for another) and its own sex availability.  Coverage is declared per
  indicator: a single "2004-2024" would be false for four measures out of five.
* **The level of a territory is read, not guessed.**  `CL_ITTER107` declares an
  explicit `<structure:Parent>` hierarchy, so depth comes from the source.  Code
  length would be wrong: `ITCD` and `ITFG` are four characters like the regions.
* **The source hierarchy does not mark the composites.**  `ITCD` (Nord) and `ITFG`
  (Mezzogiorno) are siblings of the five ripartizioni, all direct children of `IT`,
  with zero children of their own.  Compositeness is therefore declared, not derived.
* **The parent chain has a hole.**  `ITD10` Bolzano and `ITD20` Trento point at
  `ITD1`/`ITD2`, which are absent from this slice — the region level carries `ITDA`
  instead.  Rolling provinces up by parent would silently lose two provinces, so the
  gap is declared and checked rather than patched.
* **Nothing here is a count.**  Every measure is a per-capita average or a
  percentage, so territorial partitions are NOT verifiable by sum and the contract
  does not pretend otherwise.  The invariant that does hold for averages is that the
  total sits between the two sexes.
* **`OBS_STATUS` is bound to `CL_FLAG`, not `CL_OBS_STATUS`.**  The code `g` means
  "the phenomenon exists but the data are not known": the cell stays null and never
  becomes zero.

Values are stored as integers multiplied by ten: the source publishes at most one
decimal, so the conversion stays exact and no float ever reaches the artifact.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-bes-economico-2004-2024.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-bes-economico-2004-2024.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-bes-economico-2004-2024.meta.json"

DATASET_ID = "istat-bes-economico"
# Trailing slash on purpose: without it "https://esploradati.istat.it" is also a
# literal prefix of "https://esploradati.istat.it.example.org".
OFFICIAL_PREFIX = "https://esploradati.istat.it/"

INPUT_FILENAME = "bes-economico.csv"

CAVEATS = (
    "Non è spesa pubblica. Sono redditi, retribuzioni e pensioni delle famiglie, più due "
    "indicatori di disagio economico: misurano quanto le famiglie hanno, non quanto lo Stato "
    "spende. Nessuna somma né accostamento con SIOPE, OpenBDAP o l'IRPEF dichiarata.",
    "Sono medie pro capite e percentuali: NON sono sommabili fra territori. La media di una "
    "ripartizione non è la somma delle medie delle sue province.",
    "Ogni indicatore ha il proprio periodo e la propria disponibilità per sesso: non esiste un "
    "unico intervallo valido per tutti. Confrontare gli estremi di indicatori diversi significa "
    "confrontare anni diversi.",
    "Le aree composite (Nord = Nord-ovest + Nord-est, Mezzogiorno = Sud + Isole) contengono già "
    "le aree che le compongono: sommarle alle loro parti è un doppio conteggio.",
    "Il totale per sesso non è la somma di femmine e maschi: è la media sull'intera popolazione, "
    "e sta fra i due valori.",
    "L'anagrafica delle province NON è stabile sulla serie: include sia province istituite dopo "
    "l'inizio del periodo sia le tre sarde soppresse nel 2016. Un confronto fra gli estremi della "
    "serie non è a perimetro costante.",
    "Bolzano e Trento compaiono fra le province ma il loro livello regionale in questa fetta è "
    "il Trentino Alto Adige: risalire dalle province alle regioni seguendo il legame di "
    "parentela le perderebbe.",
    "Una cella con flag non è uno zero: il flag «g» della fonte significa che il fenomeno esiste "
    "ma il dato non si conosce.",
    "Non esiste un indice composito del benessere in questo dataset e non ne viene costruito "
    "uno: niente punteggi sintetici, niente classifiche di «miglior territorio».",
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
    # Nessuna misura può dichiararsi sommabile: qui non esistono conteggi.
    for indicator in spec["expected"]["indicators"]:
        if indicator.get("summableAcrossTerritories"):
            raise SnapshotError(
                f"source lock: {indicator['code']} è una media o una percentuale e non può "
                "dichiararsi sommabile fra territori"
            )
    if spec["reconciliation"].get("territorialSum") is not False:
        raise SnapshotError("source lock: la somma territoriale non è una riconciliazione valida qui")
    return spec


def _tenths(raw: str, where: str) -> int:
    """Convert a published value to tenths, exactly or not at all."""
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"valore non numerico {raw!r} in {where}") from error
    if -value.as_tuple().exponent > 1:
        raise SnapshotError(
            f"valore {raw!r} in {where} ha più di un decimale: la fonte ne dichiarava al più uno"
        )
    scaled = value * 10
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"valore {raw!r} in {where} non è convertibile esattamente in decimi")
    return int(scaled)


Cell = tuple[str, str, str, int]  # (indicator, territory, sex, year)


def _read_rows(payload: bytes, spec: dict[str, Any]) -> dict[Cell, int | None]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"risposta SDMX non decodificabile: {error}") from error
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise SnapshotError("risposta SDMX vuota")

    for column, expected in spec["expected"]["fixedDimensions"].items():
        observed = {row.get(column) for row in rows}
        if observed != {expected}:
            raise SnapshotError(
                f"{column}: attesa la sola {expected!r}, trovate {sorted(map(str, observed))!r} — "
                "dominio, frequenza ed edizione devono restare fissati"
            )

    indicators = {i["code"]: i for i in spec["expected"]["indicators"]}
    territories = {t["code"] for t in spec["expected"]["territories"]}
    sexes = set(spec["expected"]["sexes"])
    known_flags = set(spec["expected"]["flagMarker"]["knownValues"])

    out: dict[Cell, int | None] = {}
    flagged = 0
    units: dict[str, set[str]] = {}
    for row in rows:
        indicator = row["DATA_TYPE"]
        territory = row["REF_AREA"]
        sex = row["SEX"]
        try:
            year = int(row["TIME_PERIOD"])
        except (TypeError, ValueError) as error:
            raise SnapshotError(f"anno non valido {row.get('TIME_PERIOD')!r}") from error
        if indicator not in indicators:
            raise SnapshotError(f"indicatore fuori dal lock: {indicator}")
        if territory not in territories:
            raise SnapshotError(
                f"territorio fuori dall'anagrafica vincolata: {territory} — "
                "un territorio nuovo va dichiarato nel lock, non assorbito"
            )
        if sex not in sexes:
            raise SnapshotError(f"modalità di sesso fuori dal lock: {sex!r}")

        declared = indicators[indicator]
        if sex not in declared["sexes"]:
            raise SnapshotError(f"{indicator}: sesso {sex!r} non dichiarato per questo indicatore")
        if not declared["from"] <= year <= declared["to"]:
            raise SnapshotError(
                f"{indicator}: anno {year} fuori dal periodo dichiarato "
                f"{declared['from']}-{declared['to']} — la copertura è per indicatore"
            )
        units.setdefault(indicator, set()).add(row.get("UNIT_MEAS") or "")

        key: Cell = (indicator, territory, sex, year)
        if key in out:
            raise SnapshotError(f"cella duplicata nella risposta: {key}")

        status = (row.get("OBS_STATUS") or "").strip()
        raw = (row.get("OBS_VALUE") or "").strip()
        if status:
            if status not in known_flags:
                raise SnapshotError(
                    f"flag {status!r} sconosciuto su {key}: non è in CL_FLAG come dichiarato nel lock"
                )
            if raw:
                raise SnapshotError(f"cella {key}: flag {status!r} con un valore presente")
            out[key] = None
            flagged += 1
            continue
        if not raw:
            raise SnapshotError(f"cella {key}: valore vuoto senza flag, non è interpretabile")
        out[key] = _tenths(raw, f"{indicator}/{territory}/{sex}/{year}")

    # L'unità è dichiarata inline dalla fonte: deve essere una sola per indicatore
    # e coincidere con quella del lock.
    for indicator, observed in units.items():
        declared_unit = indicators[indicator]["unit"]
        if observed != {declared_unit}:
            raise SnapshotError(
                f"{indicator}: UNIT_MEAS {sorted(observed)!r} diverge da {declared_unit!r} nel lock"
            )

    if len(out) != spec["expected"]["cells"]:
        raise SnapshotError(f"copertura: {len(out)} celle, attese {spec['expected']['cells']}")
    if flagged != spec["expected"]["flagged"]:
        raise SnapshotError(
            f"celle flaggate: {flagged}, attese {spec['expected']['flagged']} — "
            "un cambio di disponibilità va dichiarato nel lock, non assorbito"
        )
    for indicator, declared in indicators.items():
        seen = sum(1 for key in out if key[0] == indicator)
        if seen != declared["observations"]:
            raise SnapshotError(
                f"{indicator}: {seen} osservazioni, attese {declared['observations']}"
            )
    return out


def _validate_territories(spec: dict[str, Any]) -> None:
    """The territory anagrafica must stay explicit: levels are read, not guessed."""
    territories = {t["code"]: t for t in spec["expected"]["territories"]}
    kinds = {t["kind"] for t in territories.values()}
    if not {"country", "ripartizione", "regione", "provincia", "composite"} <= kinds:
        raise SnapshotError("anagrafica: mancano livelli territoriali attesi")
    for code, entry in territories.items():
        if entry["kind"] == "composite":
            parts = entry.get("parts")
            if not parts:
                raise SnapshotError(f"anagrafica: il composito {code} non dichiara le sue parti")
            for part in parts:
                if part not in territories:
                    raise SnapshotError(f"anagrafica: il composito {code} cita una parte sconosciuta")
        parent = entry.get("parent")
        if parent is not None and parent not in territories:
            raise SnapshotError(f"anagrafica: {code} punta a un padre {parent} fuori anagrafica")
        # La rottura della catena va dichiarata, non lasciata implicita.
        if entry.get("parentOutsideDataset") and entry.get("parent") is not None:
            raise SnapshotError(
                f"anagrafica: {code} dichiara un padre fuori dataset ma anche un padre interno"
            )


def _reconcile(cells: dict[Cell, int | None], spec: dict[str, Any]) -> dict[str, Any]:
    """Averages do not sum: the invariant is that the total sits between the sexes."""
    rules = spec["reconciliation"]
    total = rules["totalBetweenSexes"]["total"]
    parts = rules["totalBetweenSexes"]["parts"]

    compared = 0
    worst = 0
    worst_at = None
    for (indicator, territory, sex, year), value in cells.items():
        if sex != total or value is None:
            continue
        values = [cells.get((indicator, territory, part, year)) for part in parts]
        if any(v is None for v in values):
            continue
        low, high = min(values), max(values)
        compared += 1
        if not low <= value <= high:
            gap = max(low - value, value - high)
            raise SnapshotError(
                f"{indicator}/{territory}/{year}: il totale {value} sta fuori dall'intervallo "
                f"[{low}, {high}] dei due sessi di {gap} decimi. Una media totale non si comporta "
                "così: o la misura non è una media, o le modalità sono state scambiate"
            )
        margin = min(value - low, high - value)
        if margin > worst:
            worst, worst_at = margin, f"{indicator}/{territory}/{year}"

    return {
        "note": rules["note"],
        "kind": "totale-fra-i-sessi",
        "comparisons": compared,
        "violations": 0,
        "widestMarginTenths": worst,
        "widestMarginAt": worst_at,
        "territorialSum": False,
    }


def build_data(payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    _validate_territories(spec)
    cells = _read_rows(payload, spec)
    observations = [
        {"indicator": indicator, "territory": territory, "sex": sex, "year": year, "valueTenths": value}
        for (indicator, territory, sex, year), value in sorted(cells.items())
    ]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "periodNote": spec["periodNote"],
        "caveats": list(CAVEATS),
        "scale": {"factor": spec["measure"]["scale"], "note": spec["measure"]["scaleNote"]},
        "domain": {
            "code": spec["measure"]["domain"],
            "label": spec["measure"]["domainLabel"],
            "edition": spec["measure"]["edition"],
            "editionNote": spec["measure"]["editionNote"],
        },
        "indicators": [dict(i) for i in spec["expected"]["indicators"]],
        "territories": [dict(t) for t in spec["expected"]["territories"]],
        "sexes": list(spec["expected"]["sexes"]),
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
    for key in ("schemaVersion", "datasetId", "period", "periodNote", "caveats", "scale", "domain",
                "indicators", "territories", "sexes", "observations", "flags", "coverage",
                "reconciliation"):
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

    indicators = {i["code"]: i for i in data["indicators"]}
    territories = {t["code"] for t in data["territories"]}
    sexes = set(data["sexes"])
    seen = set()
    for observation in data["observations"]:
        key = (observation["indicator"], observation["territory"], observation["sex"], observation["year"])
        if key in seen:
            raise SnapshotError(f"data artifact: osservazione duplicata {key}")
        seen.add(key)
        if observation["indicator"] not in indicators or observation["territory"] not in territories:
            raise SnapshotError(f"data artifact: codice fuori anagrafica in {key}")
        if observation["sex"] not in sexes:
            raise SnapshotError(f"data artifact: sesso fuori anagrafica in {key}")
        declared = indicators[observation["indicator"]]
        if not declared["from"] <= observation["year"] <= declared["to"]:
            raise SnapshotError(f"data artifact: anno fuori dal periodo dell'indicatore in {key}")
        value = observation["valueTenths"]
        if value is None:
            continue
        if not isinstance(value, int) or isinstance(value, bool):
            raise SnapshotError(f"data artifact: valueTenths non valido in {key}")

    if not any(t["kind"] == "composite" for t in data["territories"]):
        raise SnapshotError("data artifact: le aree composite devono restare marcate come tali")
    if not any(t["kind"] == "provincia" for t in data["territories"]):
        raise SnapshotError("data artifact: il livello provinciale fa parte del perimetro concordato")
    # Nessuna misura può dichiararsi sommabile fra territori.
    for indicator in data["indicators"]:
        if indicator.get("summableAcrossTerritories"):
            raise SnapshotError(f"data artifact: {indicator['code']} non può dichiararsi sommabile")
        if indicator["unit"] not in {"EURO", "VAL_PERC"}:
            raise SnapshotError(f"data artifact: unità inattesa per {indicator['code']}")
    if data["reconciliation"].get("territorialSum") is not False:
        raise SnapshotError("data artifact: la somma territoriale non è una riconciliazione valida")


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
            "dataStructure": source["dataStructure"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "acquisition": dict(source["acquisition"]),
            "assets": {name: dict(asset) for name, asset in source["assets"].items()},
        },
        "indicators": [dict(i) for i in spec["expected"]["indicators"]],
        "reconciliation": dict(data["reconciliation"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md).
        "semantics": {
            "soldi": {
                "unit": "euro correnti per gli indicatori EURO; nessuna per quelli VAL_PERC",
                "nature": (
                    "redditi, retribuzioni e importi pensionistici delle FAMIGLIE, come medie "
                    "pro capite — non è spesa pubblica, non è cassa, non è gettito"
                ),
                "note": (
                    "L'asse soldi è presente ma delimitato: misura quanto le famiglie hanno, non "
                    "quanto lo Stato spende. Nessuna somma né accostamento con SIOPE, OpenBDAP o "
                    "mef_irpef. Le medie pro capite non sono sommabili fra territori."
                ),
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": spec["periodNote"],
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]] + sorted(a["url"] for a in source["assets"].values()),
                "publicationEdition": spec["measure"]["edition"],
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
    _validate_territories(spec)
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
            print(f"{DATASET_ID}: lock, data e meta coerenti")
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
                f"{DATASET_ID}: build ok ({len(data['observations'])} osservazioni, "
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
        print(f"{DATASET_ID}: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
