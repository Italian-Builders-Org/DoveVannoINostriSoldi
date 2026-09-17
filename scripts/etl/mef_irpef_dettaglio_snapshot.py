#!/usr/bin/env python3
"""Build the hash-pinned MEF IRPEF detail snapshot (income type, tax computation, benefit).

The 79 inputs are the yearly CSV files published in the open data catalogue of the
Dipartimento delle Finanze, for the nine families that cross the total-income class
with one of three breakdowns (region, age class, sex).  They are deliberately passed
as local files: runtime and CI never call the portal, and a schema or hash drift
fails closed before an existing artifact can be replaced.

Four properties of the source are carried into the artifact instead of being
smoothed away:

* The `bonus_irpef` family measures TWO DIFFERENT instruments under one name.  The
  columns say Bonus IRPEF up to 2020, Trattamento integrativo from 2022, and 2021
  carries both.  A time series keyed on the family name would splice two distinct
  fiscal policies into one line, so the instruments stay separate and the artifact
  declares which one each table carries.
* The schema is pinned PER FILE, not per family: 79 files resolve to 18 distinct
  schemas.  "Perdita di spettanza dell'imprenditore in contabilita' semplificata"
  vanishes from all three breakdowns in 2019, returns for the regional breakdown
  only in 2020-2022, then goes for good.  Reasoning on "the latest schema" would be
  wrong for the years in between, so availability is declared per family x
  breakdown x year and an absent measure is an explicit absence.
* An empty cell is not a zero.  The source publishes 43300 empty cells alongside
  77193 explicit zeros, side by side in the same rows: the empty ones stay `null`.
* Frequenza (taxpayers) and Ammontare in euro are different natures and are never
  summed or compared; `Numero contribuenti` is a third, standalone count.

Two catalogue links are dead (`cla_anno_calcolo_irpef_2018`, `cla_anno_bonus_irpef_2018`
return 404): those years stay absent and declared, never imputed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/mef-irpef-dettaglio-2017-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/mef-irpef-dettaglio-2017-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/mef-irpef-dettaglio-2017-2025.meta.json"

DATASET_ID = "mef-irpef-dettaglio"
# Trailing slash on purpose: without it "https://www1.finanze.gov.it" is also a
# literal prefix of "https://www1.finanze.gov.it.example.org".
OFFICIAL_PREFIX = "https://www1.finanze.gov.it/"

# Integers with a dot as thousands separator and no decimals at all (verified on
# every one of the 686426 cells).  A comma would mean the source changed the way
# it writes numbers, which is a drift and must stop the build.
INTEGER = re.compile(r"^-?\d{1,3}(\.\d{3})*$")

CAVEATS = (
    "Gli anni dei file, delle tabelle e dei filtri sono anni di dichiarazione (2017-2025); gli anni di imposta sono 2016-2024, dichiarati nel catalogo e nel campo taxYear. Anche le transizioni degli strumenti qui indicate usano anni di dichiarazione.",
    "La famiglia bonus misura due strumenti diversi sotto lo stesso nome: Bonus IRPEF fino al 2020, "
    "Trattamento integrativo dal 2022, entrambi nel 2021. Non sono concatenabili in una serie unica.",
    "Imposta dichiarata non e' gettito riscosso: sono le dichiarazioni dei contribuenti, non gli incassi "
    "dell'Agenzia delle Entrate, e non si sommano a SIOPE ne' ai bilanci pubblici.",
    "Frequenza (numero di contribuenti con quella voce) e Ammontare in euro sono nature diverse: non si "
    "sommano ne' si confrontano fra loro. Numero contribuenti e' un terzo conteggio, a se' stante.",
    "Classe di reddito, regione, classe di eta' e sesso sono dimensioni distinte e non denominatori "
    "intercambiabili: i tagli non si sommano fra loro.",
    "Una cella vuota non e' uno zero osservato: resta null. La fonte pubblica entrambe le cose nelle "
    "stesse righe e la distinzione e' sua, non nostra.",
    "Esistono importi e frequenze negativi, coerenti con le classi di reddito negative e con le "
    "restituzioni: sono un fatto della fonte e restano col loro segno.",
    "La disponibilita' delle misure non e' uniforme: una misura puo' esistere in un taglio e non in un "
    "altro nello stesso anno. L'assenza e' dichiarata, mai riempita.",
    "I totali non vanno ricostruiti sommando le classi di reddito: la fonte non pubblica qui un totale e "
    "inventarlo significherebbe attribuirle un dato che non ha.",
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
    for key in ("schemaVersion", "datasetId", "period", "source", "instruments", "expected", "integrity"):
        if key not in spec:
            raise SnapshotError(f"source lock: campo {key} mancante")
    if spec["datasetId"] != DATASET_ID:
        raise SnapshotError("source lock: datasetId inatteso")
    if spec["source"].get("licenseId") != "CC-BY-3.0-IT":
        raise SnapshotError("source lock: licenza attesa CC-BY-3.0-IT verificata per dataset")
    if not str(spec["source"].get("landingUrl", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: landing URL non ufficiale del Dipartimento delle Finanze")
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
        if table.get("schemaId") not in spec["expected"]["schemas"]:
            raise SnapshotError(f"source lock: schema sconosciuto per {name}")
    # Un rilascio con la sola intestazione non puo' passare in silenzio: o e'
    # dichiarato, o la build si ferma. E cio' che e' dichiarato vuoto deve
    # esserlo davvero, altrimenti la dichiarazione invecchia senza accorgersene.
    vuoti_osservati = {f"{n}.csv" for n, t in tables.items() if t["rows"] == 0}
    vuoti_dichiarati = set(spec["source"].get("emptyReleases", {}))
    if vuoti_osservati - vuoti_dichiarati:
        raise SnapshotError(
            "source lock: rilasci vuoti non dichiarati: " + ", ".join(sorted(vuoti_osservati - vuoti_dichiarati))
        )
    if vuoti_dichiarati - vuoti_osservati:
        raise SnapshotError(
            "source lock: dichiarati vuoti ma con righe: " + ", ".join(sorted(vuoti_dichiarati - vuoti_osservati))
        )
    if spec.get("periodBasis") != "declaration-year" or spec.get("taxPeriod") != {"from": 2016, "to": 2024}:
        raise SnapshotError("source lock: periodo fiscale non dichiarato")
    for table in tables.values():
        if table.get("taxYear") != table["year"] - 1 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", table.get("publicationDate", "")):
            raise SnapshotError("source lock: anni o data pubblicazione incoerenti")
    return spec


def _parse_cell(raw: str, where: str) -> int | None:
    value = raw.strip()
    if value == "":
        # Cella vuota: resta assente. Non diventa mai zero.
        return None
    if "," in value:
        raise SnapshotError(
            f"valore {raw!r} in {where}: la fonte non usava decimali, una virgola e' una deriva del formato"
        )
    if not INTEGER.match(value):
        raise SnapshotError(f"valore non intero {raw!r} in {where}")
    return int(value.replace(".", ""))


def _read_table(payload: bytes, name: str, table: dict[str, Any], spec: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        text = payload.decode(spec["source"]["encoding"])
    except UnicodeDecodeError as error:
        raise SnapshotError(f"{name}: non decodificabile in {spec['source']['encoding']}: {error}") from error

    rows = list(csv.reader(io.StringIO(text), delimiter=spec["source"]["delimiter"]))
    if not rows:
        raise SnapshotError(f"{name}: file vuoto")

    schema = spec["expected"]["schemas"][table["schemaId"]]
    expected_header = list(schema["dimensions"]) + [m["name"] for m in schema["measures"]]
    if rows[0] != expected_header:
        raise SnapshotError(
            f"{name}: intestazione diversa dallo schema {table['schemaId']} vincolato nel lock "
            f"({len(rows[0])} colonne contro {len(expected_header)})"
        )

    width = len(expected_header)
    out: list[dict[str, Any]] = []
    empty = negative = 0
    for index, row in enumerate(rows[1:], start=2):
        if len(row) != width:
            raise SnapshotError(f"{name}: riga {index} ha {len(row)} campi, attesi {width}")
        keys = [row[0].strip(), row[1].strip()]
        if not keys[0] or not keys[1]:
            raise SnapshotError(f"{name}: riga {index} senza dimensioni")
        values: list[int | None] = []
        for column, raw in zip(expected_header[2:], row[2:]):
            parsed = _parse_cell(raw, f"{name} riga {index} colonna {column!r}")
            if parsed is None:
                empty += 1
            elif parsed < 0:
                negative += 1
            values.append(parsed)
        out.append({"k": keys, "v": values})

    if len(out) != table["rows"]:
        raise SnapshotError(f"{name}: {len(out)} righe, attese {table['rows']}")
    if empty != table["emptyCells"]:
        raise SnapshotError(f"{name}: {empty} celle vuote, attese {table['emptyCells']}")
    if negative != table["negativeCells"]:
        raise SnapshotError(f"{name}: {negative} celle negative, attese {table['negativeCells']}")
    return out


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    tables_spec = spec["expected"]["tables"]
    order = sorted(tables_spec)
    tables: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []

    for position, name in enumerate(order):
        table = tables_spec[name]
        parsed = _read_table(inputs[name], name, table, spec)
        tables.append({
            "id": name, "family": table["family"], "breakdown": table["breakdown"],
            "year": table["year"], "taxYear": table["taxYear"], "publicationDate": table["publicationDate"], "schemaId": table["schemaId"],
            "instruments": list(table["instruments"]),
            "rows": table["rows"], "emptyCells": table["emptyCells"],
            "negativeCells": table["negativeCells"],
        })
        for row in parsed:
            rows.append({"t": position, "k": row["k"], "v": row["v"]})

    # Disponibilita' dichiarata per famiglia x taglio x anno: una misura assente e'
    # un'assenza esplicita, non uno zero e non un errore generico.
    availability: dict[str, dict[str, dict[str, str]]] = {}
    for table in tables:
        availability.setdefault(table["family"], {}).setdefault(table["breakdown"], {})[str(table["year"])] = table["schemaId"]

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "periodBasis": spec["periodBasis"],
        "taxPeriod": dict(spec["taxPeriod"]),
        "caveats": list(CAVEATS),
        "instruments": dict(spec["instruments"]),
        "schemas": {sid: {"dimensions": list(s["dimensions"]),
                          "measures": [dict(m) for m in s["measures"]]}
                    for sid, s in spec["expected"]["schemas"].items()},
        "tables": tables,
        "availability": availability,
        "rows": rows,
        "coverage": {
            "expectedFiles": spec["expected"]["files"],
            "observedFiles": len(tables),
            "expectedRows": spec["expected"]["rows"],
            "observedRows": len(rows),
            "emptyCells": sum(t["emptyCells"] for t in tables),
            "negativeCells": sum(t["negativeCells"] for t in tables),
            "missingFiles": dict(spec["source"]["missingFiles"]),
            "emptyReleases": dict(spec["source"]["emptyReleases"]),
        },
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "instruments",
                "schemas", "tables", "availability", "rows", "coverage"):
        if key not in data:
            raise SnapshotError(f"data artifact: campo {key} mancante")
    if data["datasetId"] != DATASET_ID or data["schemaVersion"] != 1:
        raise SnapshotError("data artifact: identita' inattesa")
    if not data["caveats"]:
        raise SnapshotError("data artifact: caveats assenti - i limiti del dato fanno parte del dato")

    coverage = data["coverage"]
    if coverage["observedFiles"] != coverage["expectedFiles"]:
        raise SnapshotError("data artifact: file attesi e osservati non coincidono")
    if coverage["observedRows"] != coverage["expectedRows"]:
        raise SnapshotError("data artifact: righe attese e osservate non coincidono")
    if len(data["rows"]) != coverage["expectedRows"]:
        raise SnapshotError("data artifact: righe e copertura dichiarata non coincidono")
    if not coverage["missingFiles"]:
        raise SnapshotError("data artifact: i file mancanti devono restare dichiarati")
    vuoti = {t["id"] + ".csv" for t in data["tables"] if t["rows"] == 0}
    if vuoti != set(coverage.get("emptyReleases", {})):
        raise SnapshotError("data artifact: i rilasci vuoti non coincidono con quelli dichiarati")

    widths = {sid: len(s["measures"]) for sid, s in data["schemas"].items()}
    empty = negative = 0
    keys = set()
    counts = [0] * len(data["tables"])
    for index, table in enumerate(data["tables"]):
        if table["schemaId"] not in widths:
            raise SnapshotError(f"data artifact: schema sconosciuto in {table['id']}")
        if table["family"] == "bonus_irpef" and not table["instruments"]:
            raise SnapshotError(f"data artifact: {table['id']} non dichiara lo strumento misurato")
    for row in data["rows"]:
        if type(row.get("t")) is not int or not 0 <= row["t"] < len(data["tables"]):
            raise SnapshotError("data artifact: indice tabella non valido")
        key = (row["t"], *row["k"])
        if key in keys:
            raise SnapshotError("data artifact: riga duplicata")
        keys.add(key)
        counts[row["t"]] += 1
        table = data["tables"][row["t"]]
        width = widths[table["schemaId"]]
        if len(row["v"]) != width:
            raise SnapshotError(f"data artifact: riga con {len(row['v'])} valori, attesi {width} in {table['id']}")
        if len(row["k"]) != 2:
            raise SnapshotError(f"data artifact: chiavi malformate in {table['id']}")
        for value in row["v"]:
            if value is None:
                empty += 1
            elif not isinstance(value, int) or isinstance(value, bool) or abs(value) > 2**53 - 1:
                raise SnapshotError(f"data artifact: valore non intero in {table['id']}")
            elif value < 0:
                negative += 1
    if counts != [t["rows"] for t in data["tables"]]:
        raise SnapshotError("data artifact: conteggio righe per tabella divergente")
    if empty != coverage["emptyCells"]:
        raise SnapshotError("data artifact: conteggio delle celle vuote divergente")
    if negative != coverage["negativeCells"]:
        raise SnapshotError("data artifact: conteggio delle celle negative divergente")

    # I due strumenti non possono confondersi: il 2021 li porta entrambi, gli altri
    # anni uno solo, e il contratto lo pretende esplicito.
    bonus = {t["year"]: set(t["instruments"]) for t in data["tables"] if t["family"] == "bonus_irpef"}
    if not any(s == {"bonus", "trattamento"} for s in bonus.values()):
        raise SnapshotError("data artifact: manca l'anno che espone entrambi gli strumenti")


def build_metadata(spec: dict[str, Any], data_bytes: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "periodBasis": spec["periodBasis"],
        "taxPeriod": dict(spec["taxPeriod"]),
        "observedAt": source["acquisition"]["acquiredAt"],
        "source": {
            "owner": source["owner"],
            "catalogReceipt": dict(source["catalogReceipt"]),
            "landingUrl": source["landingUrl"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "encoding": source["encoding"],
            "delimiter": source["delimiter"],
            "numberNote": source["numberNote"],
            "acquisition": dict(source["acquisition"]),
            "missingFiles": dict(source["missingFiles"]),
            "emptyReleases": dict(source["emptyReleases"]),
            "files": {name: {"url": t["url"], "bytes": t["bytes"], "sha256": t["sha256"]}
                      for name, t in sorted(spec["expected"]["tables"].items())},
        },
        "instruments": dict(spec["instruments"]),
        "availability": dict(data["availability"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md).
        "semantics": {
            "soldi": {
                "unit": "euro (colonne Ammontare) e conteggi di contribuenti (colonne Frequenza e Numero contribuenti)",
                "nature": ("imposta e redditi DICHIARATI nelle dichiarazioni dei redditi, non gettito riscosso: "
                           "non e' cassa, non e' spesa, non e' un bilancio"),
                "note": ("Frequenza, Ammontare e Numero contribuenti sono tre nature distinte e non si sommano. "
                         "Cella vuota non e' zero. I negativi esistono e restano col loro segno."),
            },
            "periodo": {
                "referencePeriod": f"{spec['taxPeriod']['from']}-{spec['taxPeriod']['to']}",
                "note": ("Anni di imposta 2016-2024, distinti dagli anni di dichiarazione 2017-2025 usati nei filtri. "
                         "La corrispondenza e la data di pubblicazione vengono dalle schede del catalogo ufficiale. Due file delle dichiarazioni 2018 sono elencati "
                         "dal catalogo ma rispondono 404: quegli anni restano assenti e dichiarati. La famiglia "
                         "bonus espone entrambi gli strumenti nelle dichiarazioni 2021 (anno di imposta 2020); le serie non sono concatenabili."),
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]]
                + sorted(t["url"] for t in spec["expected"]["tables"].values()),
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
                "hashes": "SHA-256 per file in source.files; artefatto in integrity.dataArtifact",
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
    if spec["integrity"]["dataArtifact"] != artifact:
        raise SnapshotError("data artifact: hash divergente dal source lock")
    if metadata != build_metadata(spec, data_bytes, data):
        raise SnapshotError("meta: metadati divergenti dal source lock")
    if data["schemas"] != spec["expected"]["schemas"]:
        raise SnapshotError("data artifact: schemi divergenti dal lock")
    for table in data["tables"]:
        expected = spec["expected"]["tables"].get(table["id"])
        if expected is None or any(table[key] != expected[key] for key in table if key != "id"):
            raise SnapshotError("data artifact: tabella divergente dal lock")
    if metadata["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente dal lock")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input-dir", type=Path, help="cartella con i 79 CSV")
    parser.add_argument("--check", action="store_true", help="valida gli artefatti committati senza rete")
    parser.add_argument("--write", action="store_true", help="scrive artefatti e integrity nel lock")
    args = parser.parse_args()

    try:
        if args.check:
            _check(args.spec, args.data, args.meta)
            print("mef-irpef-dettaglio: lock, data e meta coerenti")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con i 79 CSV, oppure --check")
        spec = load_source_spec(args.spec)
        inputs = {}
        for name, table in spec["expected"]["tables"].items():
            path = args.input_dir / table["file"]
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
            print(f"mef-irpef-dettaglio: build ok ({len(data['rows'])} righe, {len(data_bytes)} byte) - usa --write per salvare")
            return 0
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_metadata(spec, data_bytes, data)
        args.meta.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"mef-irpef-dettaglio: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"mef-irpef-dettaglio: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
