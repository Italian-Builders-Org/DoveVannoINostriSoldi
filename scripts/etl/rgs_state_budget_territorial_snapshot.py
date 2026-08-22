#!/usr/bin/env python3
"""Build a compact snapshot of the official 2023 territorial State-budget dataset."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import tempfile
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/rgs-state-budget-territorial-2023.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/rgs-state-budget-territorial-2023.json"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
SHA256_RE = re.compile(r"[0-9a-f]{64}")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
AMOUNT_RE = re.compile(r"\d+\.\d{2}")

HEADERS = [
    "Anno di Interesse",
    "Territorio",
    "Titolo",
    "Categoria",
    "Missione",
    "Tipo Misura",
    "Importo",
]

EXPECTED_SOURCE = {
    "publisher": "Ragioneria Generale dello Stato",
    "recordId": "SRS_SPE_BIL_SPESR_001",
    "recordNumber": 33477,
    "reportNumber": 5318,
    "uuid": "6e4f0ada-f0f6-4122-ba4a-350818773daf@rgs",
    "year": 2023,
    "createdAt": "2025-11-21",
    "updatedAt": "2025-11-25",
    "dataObservedAt": "2025-09-03",
    "downloadObservedAt": "2026-08-22",
    "landingUrl": "https://bdap-opendata.rgs.mef.gov.it/content/2023-distribuzione-territoriale-della-spesa-del-bilancio-dello-stato-spesa-statale?metadati=showall",
    "schemaUrl": "https://bdap-opendata.rgs.mef.gov.it/sites/default/files/metadata_updfile/report/5318_Spesa%20Statale%20Regionalizzata%20-%20Bilancio.pdf",
    "csvUrl": "https://bdap-opendata.rgs.mef.gov.it/export/csv/2023---Distribuzione-territoriale-della-spesa-del-bilancio-dello-Stato---Spesa-Statale-Regionalizzata.csv",
    "sourceBytes": 3_933_609,
    "sourceSha256": "bf37c613ea9d467a95618684b0cd69cf332e276792e67e6c985358173b01cf16",
    "encoding": "cp1252",
    "delimiter": ";",
    "quoteChar": '"',
    "lineEnding": "CRLF",
    "licenseStatus": "not_declared",
}

TERRITORIES_BY_LEVEL = {
    "region": [
        "ABRUZZO", "BASILICATA", "CALABRIA", "CAMPANIA", "EMILIA-ROMAGNA",
        "FRIULI-VENEZIA GIULIA", "LAZIO", "LIGURIA", "LOMBARDIA", "MARCHE",
        "MOLISE", "PIEMONTE", "PUGLIA", "SARDEGNA", "SICILIA", "TOSCANA",
        "TRENTINO-ALTO ADIGE/SÜDTIROL", "UMBRIA", "VALLE D'AOSTA/VALLÉE D'AOSTE",
        "VENETO",
    ],
    "macroarea": ["CENTRO", "ISOLE", "NORD-EST", "NORD-OVEST", "SUD"],
    "national": ["ITALIA"],
}

MEASURES = [
    {
        "label": "Spesa Complessiva - Valori Assoluti (mln)",
        "publishedUnit": "million_eur",
        "storageUnit": "hundredths_of_million_eur",
        "scale": 2,
        "additiveWithinOneTerritoryLevel": True,
        "denominatorStatus": "not_applicable",
    },
    {
        "label": "Spesa Complessiva - in rapporto al PIL (%)",
        "publishedUnit": "percent_of_gdp",
        "storageUnit": "hundredths_of_percent",
        "scale": 2,
        "additiveWithinOneTerritoryLevel": False,
        "denominatorStatus": "publisher_derived_not_versioned",
    },
    {
        "label": "Spesa Complessiva - per abitante (Euro)",
        "publishedUnit": "eur_per_inhabitant",
        "storageUnit": "hundredths_of_eur_per_inhabitant",
        "scale": 2,
        "additiveWithinOneTerritoryLevel": False,
        "denominatorStatus": "publisher_derived_not_versioned",
    },
    {
        "label": "Spesa Complessiva - per Kmq (Euro)",
        "publishedUnit": "eur_per_square_kilometre",
        "storageUnit": "hundredths_of_eur_per_square_kilometre",
        "scale": 2,
        "additiveWithinOneTerritoryLevel": False,
        "denominatorStatus": "publisher_derived_not_versioned",
    },
]

EXPECTED_COUNTS = {
    "sourceRows": 20_268,
    "dimensionRows": 5_067,
    "rowsPerMeasure": 5_067,
    "zeroValues": 3_880,
    "territoryCount": 26,
    "titleCount": 2,
    "categoryCount": 17,
    "missionCount": 33,
}

EXPECTED_RECONCILIATION = {
    "nationalHundredthsMillionEur": 29_735_168,
    "regionsHundredthsMillionEur": 29_735_159,
    "regionDeltaHundredthsMillionEur": -9,
    "macroareasHundredthsMillionEur": 29_735_164,
    "macroareaDeltaHundredthsMillionEur": -4,
    "completeRegionKeys": 82,
    "maxRegionKeyAbsDeltaHundredthsMillionEur": 3,
    "completeMacroareaKeys": 192,
    "maxMacroareaKeyAbsDeltaHundredthsMillionEur": 2,
}

SNAPSHOT_TITLE = "Spesa del Bilancio dello Stato per territorio destinatario"
SNAPSHOT_GRAIN = (
    "Una riga per territorio, titolo, categoria e missione; "
    "quattro misure sorgente separate e ordinate."
)
METHODOLOGY = {
    "scope": (
        "La landing ufficiale descrive il dataset come spesa territorializzata del Bilancio "
        "dello Stato al netto degli interessi sul debito pubblico. La trasformazione conserva "
        "tutte le righe pubblicate e non applica filtri per categoria o missione."
    ),
    "transformation": (
        "Ogni importo decimale è convertito senza float in un intero pari a cento volte il "
        "valore pubblicato; l'unità resta quella dichiarata per ciascuna misura."
    ),
    "storage": (
        "Le dimensioni sorgente sono dizionari ordinati; gli interi nelle righe sono indici "
        "di storage, non codici ufficiali."
    ),
    "validation": (
        "Il validatore semantico controlla tipi, domini e riconciliazioni; il comando --check "
        "ricostruisce invece lo snapshot dalla fonte hash-pinned e richiede uguaglianza byte per byte."
    ),
}
CAVEATS = [
    "Il CSV non espone codici territoriali, zone o un campo soggetto; questi campi non sono ricostruiti.",
    "Italia, macroaree e regioni sono livelli sovrapposti e non devono essere sommati insieme.",
    "Le misure percentuale, pro capite e per km² hanno denominatori calcolati dall'editore ma non versionati nel record.",
    "Una riga assente non è zero; zero è conservato soltanto quando osservato nel CSV.",
    "Gli scarti di riconciliazione sono controlli di arrotondamento sui valori pubblicati in centesimi di milione.",
    (
        "Per ITALIA, l'incrocio fra categoria 09 e missione 034 riporta 8.057,70 milioni. "
        "Il CSV contiene quindi righe etichettate interessi e debito pubblico: la snapshot le "
        "conserva e non prova che ogni importo con queste etichette sia incluso o escluso dal "
        "perimetro descritto dalla landing."
    ),
]


class SnapshotError(ValueError):
    """The source, contract, or committed artifact diverges from the verified shape."""


def require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} deve essere un oggetto")
    return value


def require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise SnapshotError(f"{label} deve essere un elenco")
    return value


def require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotError(f"{label} deve essere testo non vuoto")
    return value


def require_safe_integer(value: object, label: str, *, non_negative: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or abs(value) > MAX_SAFE_INTEGER:
        raise SnapshotError(f"{label} deve essere un intero sicuro")
    if non_negative and value < 0:
        raise SnapshotError(f"{label} non può essere negativo")
    return value


def require_bool(value: object, label: str) -> bool:
    if type(value) is not bool:
        raise SnapshotError(f"{label} deve essere booleano")
    return value


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def unique_sorted_texts(value: object, label: str, expected_count: int) -> list[str]:
    items = require_list(value, label)
    texts = [require_text(item, f"{label}[]") for item in items]
    if len(texts) != expected_count or texts != sorted(set(texts)):
        raise SnapshotError(f"{label} deve contenere {expected_count} valori unici e ordinati")
    return texts


def validate_spec(spec: dict[str, object]) -> None:
    expected_keys = {
        "schemaVersion", "datasetId", "generatedAt", "source", "headers",
        "territories", "titles", "categories", "missions", "measures", "expected",
    }
    if set(spec) != expected_keys:
        raise SnapshotError("chiavi source spec inattese")
    if require_safe_integer(spec.get("schemaVersion"), "schemaVersion") != 1:
        raise SnapshotError("versione source spec non supportata")
    if spec.get("datasetId") != "rgs-state-budget-territorial-2023":
        raise SnapshotError("datasetId inatteso")
    if not TIMESTAMP_RE.fullmatch(require_text(spec.get("generatedAt"), "generatedAt")):
        raise SnapshotError("generatedAt non valido")
    if spec.get("headers") != HEADERS:
        raise SnapshotError("header source spec divergenti")

    source = require_dict(spec.get("source"), "source")
    if source != EXPECTED_SOURCE:
        raise SnapshotError("identità o formato della fonte divergenti")
    for key in ("recordNumber", "reportNumber", "year", "sourceBytes"):
        require_safe_integer(source.get(key), f"source.{key}", non_negative=True)
    if not SHA256_RE.fullmatch(require_text(source.get("sourceSha256"), "source.sourceSha256")):
        raise SnapshotError("hash sorgente non valido")
    for key in ("createdAt", "updatedAt", "dataObservedAt", "downloadObservedAt"):
        if not DATE_RE.fullmatch(require_text(source.get(key), f"source.{key}")):
            raise SnapshotError(f"source.{key} non valida")

    territories = require_dict(spec.get("territories"), "territories")
    if territories != TERRITORIES_BY_LEVEL:
        raise SnapshotError("allowlist o livelli territoriali divergenti")
    titles = unique_sorted_texts(spec.get("titles"), "titles", EXPECTED_COUNTS["titleCount"])
    categories = unique_sorted_texts(
        spec.get("categories"), "categories", EXPECTED_COUNTS["categoryCount"]
    )
    missions = unique_sorted_texts(
        spec.get("missions"), "missions", EXPECTED_COUNTS["missionCount"]
    )
    if not all(re.fullmatch(r"\d{2}-.+", item) for item in categories):
        raise SnapshotError("formato categorie inatteso")
    if not all(re.fullmatch(r"\d{3}-.+", item) for item in missions):
        raise SnapshotError("formato missioni inatteso")
    if not all(item.startswith("TITOLO ") for item in titles):
        raise SnapshotError("formato titoli inatteso")

    measures = require_list(spec.get("measures"), "measures")
    if measures != MEASURES:
        raise SnapshotError("definizioni delle misure divergenti")
    for index, raw_measure in enumerate(measures):
        measure = require_dict(raw_measure, f"measures[{index}]")
        require_safe_integer(measure.get("scale"), f"measures[{index}].scale")
        require_bool(
            measure.get("additiveWithinOneTerritoryLevel"),
            f"measures[{index}].additiveWithinOneTerritoryLevel",
        )

    expected = require_dict(spec.get("expected"), "expected")
    if set(expected) != {*EXPECTED_COUNTS, "absoluteReconciliation"}:
        raise SnapshotError("chiavi expected inattese")
    for key, expected_value in EXPECTED_COUNTS.items():
        if require_safe_integer(expected.get(key), f"expected.{key}", non_negative=True) != expected_value:
            raise SnapshotError(f"expected.{key} divergente")
    reconciliation = require_dict(
        expected.get("absoluteReconciliation"), "expected.absoluteReconciliation"
    )
    if reconciliation != EXPECTED_RECONCILIATION:
        raise SnapshotError("riconciliazione attesa divergente")
    for key, value in reconciliation.items():
        require_safe_integer(value, f"expected.absoluteReconciliation.{key}")


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, object]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source spec illeggibile: {path}") from error
    validate_spec(require_dict(spec, "source spec"))
    return spec


def parse_hundredths(raw: str) -> int:
    if not AMOUNT_RE.fullmatch(raw):
        raise SnapshotError(f"importo non canonico: {raw!r}")
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise SnapshotError(f"importo non numerico: {raw!r}") from error
    scaled = value * 100
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"importo con precisione inattesa: {raw!r}")
    return require_safe_integer(int(scaled), "importo scalato", non_negative=True)


def validate_wire_format(payload: bytes, source: dict[str, object]) -> str:
    if len(payload) != source["sourceBytes"]:
        raise SnapshotError("dimensione del CSV divergente")
    if sha256_bytes(payload) != source["sourceSha256"]:
        raise SnapshotError("hash del CSV divergente")
    if not payload.endswith(b"\r\n") or b"\n" in payload.replace(b"\r\n", b""):
        raise SnapshotError("line ending del CSV divergente")
    lines = payload.splitlines(keepends=True)
    if not lines or any(
        not line.startswith(b'"') or not line.endswith(b'"\r\n') or line.count(b'";"') != 6
        for line in lines
    ):
        raise SnapshotError("quoting o delimitatore del CSV divergenti")
    try:
        return payload.decode(str(source["encoding"]), errors="strict")
    except UnicodeDecodeError as error:
        raise SnapshotError("encoding del CSV divergente") from error


def parse_csv(payload: bytes, source: dict[str, object]) -> list[dict[str, object]]:
    text = validate_wire_format(payload, source)
    reader = csv.DictReader(
        io.StringIO(text, newline=""),
        delimiter=str(source["delimiter"]),
        quotechar=str(source["quoteChar"]),
        strict=True,
    )
    if reader.fieldnames != HEADERS:
        raise SnapshotError("header CSV divergenti")
    records: list[dict[str, object]] = []
    seen: set[tuple[str, ...]] = set()
    for line_number, row in enumerate(reader, start=2):
        if set(row) != set(HEADERS) or any(value is None for value in row.values()):
            raise SnapshotError(f"riga {line_number}: colonne divergenti")
        year = require_text(row["Anno di Interesse"], f"riga {line_number}/anno")
        territory = require_text(row["Territorio"], f"riga {line_number}/territorio")
        title = require_text(row["Titolo"], f"riga {line_number}/titolo")
        category = require_text(row["Categoria"], f"riga {line_number}/categoria")
        mission = require_text(row["Missione"], f"riga {line_number}/missione")
        measure = require_text(row["Tipo Misura"], f"riga {line_number}/misura")
        raw_amount = require_text(row["Importo"], f"riga {line_number}/importo")
        key = (year, territory, title, category, mission, measure)
        if key in seen:
            raise SnapshotError(f"riga {line_number}: chiave duplicata")
        seen.add(key)
        records.append({
            "year": year,
            "territory": territory,
            "title": title,
            "category": category,
            "mission": mission,
            "measure": measure,
            "value": parse_hundredths(raw_amount),
        })
    return records


def territory_entries(spec: dict[str, object]) -> list[dict[str, str]]:
    territories = require_dict(spec["territories"], "territories")
    entries = [
        {"label": str(label), "level": level}
        for level in ("region", "macroarea", "national")
        for label in require_list(territories[level], f"territories.{level}")
    ]
    return sorted(entries, key=lambda item: item["label"])


def compute_coverage(rows: list[dict[str, object]], measures: list[dict[str, object]]) -> dict[str, object]:
    measure_counts = []
    for index, measure in enumerate(measures):
        values = [require_list(row["values"], "row.values")[index] for row in rows]
        measure_counts.append({
            "label": measure["label"],
            "sourceRows": len(values),
            "zeroValues": sum(value == 0 for value in values),
        })
    return {
        "sourceRows": len(rows) * len(measures),
        "dimensionRows": len(rows),
        "zeroValues": sum(int(item["zeroValues"]) for item in measure_counts),
        "byMeasure": measure_counts,
    }


def compute_reconciliation(
    rows: list[dict[str, object]],
    territories: list[dict[str, str]],
) -> dict[str, int]:
    labels = [item["label"] for item in territories]
    region_labels = {item["label"] for item in territories if item["level"] == "region"}
    macroarea_labels = {item["label"] for item in territories if item["level"] == "macroarea"}
    totals: dict[str, int] = defaultdict(int)
    groups: dict[tuple[int, int, int], dict[str, int]] = defaultdict(dict)
    for row in rows:
        territory = labels[require_safe_integer(row["territory"], "row.territory")]
        value = require_safe_integer(require_list(row["values"], "row.values")[0], "row.values[0]")
        totals[territory] += value
        groups[(int(row["title"]), int(row["category"]), int(row["mission"]))][territory] = value

    national = totals["ITALIA"]
    regions = sum(totals[label] for label in region_labels)
    macroareas = sum(totals[label] for label in macroarea_labels)
    complete_region_groups = [
        values for values in groups.values() if region_labels | {"ITALIA"} <= set(values)
    ]
    complete_macroarea_groups = [
        values for values in groups.values() if macroarea_labels | {"ITALIA"} <= set(values)
    ]
    return {
        "nationalHundredthsMillionEur": national,
        "regionsHundredthsMillionEur": regions,
        "regionDeltaHundredthsMillionEur": regions - national,
        "macroareasHundredthsMillionEur": macroareas,
        "macroareaDeltaHundredthsMillionEur": macroareas - national,
        "completeRegionKeys": len(complete_region_groups),
        "maxRegionKeyAbsDeltaHundredthsMillionEur": max(
            (abs(sum(values[label] for label in region_labels) - values["ITALIA"])
             for values in complete_region_groups),
            default=0,
        ),
        "completeMacroareaKeys": len(complete_macroarea_groups),
        "maxMacroareaKeyAbsDeltaHundredthsMillionEur": max(
            (abs(sum(values[label] for label in macroarea_labels) - values["ITALIA"])
             for values in complete_macroarea_groups),
            default=0,
        ),
    }


def build_snapshot(spec: dict[str, object], payload: bytes) -> dict[str, object]:
    validate_spec(spec)
    source = require_dict(spec["source"], "source")
    records = parse_csv(payload, source)
    expected = require_dict(spec["expected"], "expected")
    if len(records) != expected["sourceRows"]:
        raise SnapshotError("conteggio righe sorgente divergente")

    territories = territory_entries(spec)
    titles = [str(item) for item in require_list(spec["titles"], "titles")]
    categories = [str(item) for item in require_list(spec["categories"], "categories")]
    missions = [str(item) for item in require_list(spec["missions"], "missions")]
    measures = [require_dict(item, "measures[]") for item in require_list(spec["measures"], "measures")]
    territory_index = {item["label"]: index for index, item in enumerate(territories)}
    title_index = {label: index for index, label in enumerate(titles)}
    category_index = {label: index for index, label in enumerate(categories)}
    mission_index = {label: index for index, label in enumerate(missions)}
    measure_index = {str(item["label"]): index for index, item in enumerate(measures)}

    if {str(record["year"]) for record in records} != {str(source["year"])}:
        raise SnapshotError("anno sorgente divergente")
    if {str(record["territory"]) for record in records} != set(territory_index):
        raise SnapshotError("dominio territoriale divergente")
    if {str(record["title"]) for record in records} != set(title_index):
        raise SnapshotError("dominio titoli divergente")
    if {str(record["category"]) for record in records} != set(category_index):
        raise SnapshotError("dominio categorie divergente")
    if {str(record["mission"]) for record in records} != set(mission_index):
        raise SnapshotError("dominio missioni divergente")
    if {str(record["measure"]) for record in records} != set(measure_index):
        raise SnapshotError("dominio misure divergente")

    grouped: dict[tuple[int, int, int, int], list[int | None]] = {}
    for record in records:
        key = (
            territory_index[str(record["territory"])],
            title_index[str(record["title"])],
            category_index[str(record["category"])],
            mission_index[str(record["mission"])],
        )
        values = grouped.setdefault(key, [None] * len(measures))
        index = measure_index[str(record["measure"])]
        if values[index] is not None:
            raise SnapshotError("misura duplicata per la stessa chiave dimensionale")
        values[index] = int(record["value"])

    rows = []
    for key in sorted(grouped):
        values = grouped[key]
        if any(value is None for value in values):
            raise SnapshotError("misura mancante per una chiave dimensionale")
        rows.append({
            "territory": key[0],
            "title": key[1],
            "category": key[2],
            "mission": key[3],
            "values": [int(value) for value in values if value is not None],
        })
    if len(rows) != expected["dimensionRows"]:
        raise SnapshotError("conteggio chiavi dimensionali divergente")

    coverage = compute_coverage(rows, measures)
    reconciliation = compute_reconciliation(rows, territories)
    if coverage["sourceRows"] != expected["sourceRows"] or coverage["zeroValues"] != expected["zeroValues"]:
        raise SnapshotError("copertura sorgente divergente")
    if any(item["sourceRows"] != expected["rowsPerMeasure"] for item in coverage["byMeasure"]):
        raise SnapshotError("conteggio per misura divergente")
    if reconciliation != expected["absoluteReconciliation"]:
        raise SnapshotError("riconciliazione assoluta divergente")

    snapshot = {
        "schemaVersion": 1,
        "datasetId": spec["datasetId"],
        "generatedAt": spec["generatedAt"],
        "year": source["year"],
        "title": SNAPSHOT_TITLE,
        "grain": SNAPSHOT_GRAIN,
        "source": source,
        "dimensions": {
            "territories": territories,
            "titles": titles,
            "categories": categories,
            "missions": missions,
            "measures": measures,
        },
        "coverage": coverage,
        "reconciliation": reconciliation,
        "methodology": METHODOLOGY,
        "caveats": CAVEATS,
        "rows": rows,
    }
    validate_snapshot(snapshot, spec)
    return snapshot


def validate_snapshot(snapshot: dict[str, object], spec: dict[str, object]) -> None:
    """Validate semantics; use check_snapshot to detect aggregate-preserving content drift."""

    validate_spec(spec)
    expected_top_keys = {
        "schemaVersion", "datasetId", "generatedAt", "year", "title", "grain",
        "source", "dimensions", "coverage", "reconciliation", "methodology", "caveats", "rows",
    }
    if set(snapshot) != expected_top_keys:
        raise SnapshotError("chiavi snapshot inattese")
    if require_safe_integer(snapshot.get("schemaVersion"), "schemaVersion") != 1:
        raise SnapshotError("schemaVersion snapshot inattesa")
    if require_safe_integer(snapshot.get("year"), "year") != 2023:
        raise SnapshotError("anno snapshot inatteso")
    if snapshot.get("datasetId") != spec["datasetId"] or snapshot.get("generatedAt") != spec["generatedAt"]:
        raise SnapshotError("identità snapshot divergente")
    if snapshot.get("title") != SNAPSHOT_TITLE or snapshot.get("grain") != SNAPSHOT_GRAIN:
        raise SnapshotError("titolo o grana snapshot divergenti")

    source = require_dict(snapshot.get("source"), "source")
    for key in ("recordNumber", "reportNumber", "year", "sourceBytes"):
        require_safe_integer(source.get(key), f"source.{key}", non_negative=True)
    if source != spec["source"]:
        raise SnapshotError("fonte snapshot divergente dalla source spec")

    dimensions = require_dict(snapshot.get("dimensions"), "dimensions")
    if set(dimensions) != {"territories", "titles", "categories", "missions", "measures"}:
        raise SnapshotError("chiavi dimensioni inattese")
    expected_territories = territory_entries(spec)
    raw_territories = require_list(dimensions.get("territories"), "dimensions.territories")
    for index, raw_item in enumerate(raw_territories):
        item = require_dict(raw_item, f"dimensions.territories[{index}]")
        if set(item) != {"label", "level"}:
            raise SnapshotError("chiavi territorio inattese")
        require_text(item.get("label"), f"dimensions.territories[{index}].label")
        require_text(item.get("level"), f"dimensions.territories[{index}].level")
    if raw_territories != expected_territories:
        raise SnapshotError("dimensione territori divergente")
    for key in ("titles", "categories", "missions"):
        values = require_list(dimensions.get(key), f"dimensions.{key}")
        if not all(isinstance(value, str) and value for value in values) or values != spec[key]:
            raise SnapshotError(f"dimensione {key} divergente")
    raw_measures = require_list(dimensions.get("measures"), "dimensions.measures")
    for index, raw_measure in enumerate(raw_measures):
        measure = require_dict(raw_measure, f"dimensions.measures[{index}]")
        require_safe_integer(measure.get("scale"), f"dimensions.measures[{index}].scale")
        require_bool(
            measure.get("additiveWithinOneTerritoryLevel"),
            f"dimensions.measures[{index}].additiveWithinOneTerritoryLevel",
        )
    if raw_measures != spec["measures"]:
        raise SnapshotError("dimensione misure divergente")

    rows = require_list(snapshot.get("rows"), "rows")
    parsed_rows: list[dict[str, object]] = []
    seen: set[tuple[int, int, int, int]] = set()
    sort_keys: list[tuple[int, int, int, int]] = []
    limits = (
        len(raw_territories),
        len(require_list(dimensions["titles"], "dimensions.titles")),
        len(require_list(dimensions["categories"], "dimensions.categories")),
        len(require_list(dimensions["missions"], "dimensions.missions")),
    )
    for index, raw_row in enumerate(rows):
        row = require_dict(raw_row, f"rows[{index}]")
        if set(row) != {"territory", "title", "category", "mission", "values"}:
            raise SnapshotError(f"chiavi riga inattese: rows[{index}]")
        key = tuple(
            require_safe_integer(row.get(field), f"rows[{index}].{field}", non_negative=True)
            for field in ("territory", "title", "category", "mission")
        )
        if any(value >= limit for value, limit in zip(key, limits, strict=True)):
            raise SnapshotError(f"indice dimensionale fuori dominio: rows[{index}]")
        if key in seen:
            raise SnapshotError(f"chiave dimensionale duplicata: rows[{index}]")
        seen.add(key)
        sort_keys.append(key)
        values = require_list(row.get("values"), f"rows[{index}].values")
        if len(values) != len(raw_measures):
            raise SnapshotError(f"numero misure inatteso: rows[{index}]")
        parsed_values = [
            require_safe_integer(value, f"rows[{index}].values[{value_index}]", non_negative=True)
            for value_index, value in enumerate(values)
        ]
        parsed_rows.append({
            "territory": key[0], "title": key[1], "category": key[2],
            "mission": key[3], "values": parsed_values,
        })
    if sort_keys != sorted(sort_keys):
        raise SnapshotError("ordinamento righe divergente")

    coverage = require_dict(snapshot.get("coverage"), "coverage")
    if set(coverage) != {"sourceRows", "dimensionRows", "zeroValues", "byMeasure"}:
        raise SnapshotError("chiavi copertura inattese")
    for key in ("sourceRows", "dimensionRows", "zeroValues"):
        require_safe_integer(coverage.get(key), f"coverage.{key}", non_negative=True)
    by_measure = require_list(coverage.get("byMeasure"), "coverage.byMeasure")
    for index, raw_item in enumerate(by_measure):
        item = require_dict(raw_item, f"coverage.byMeasure[{index}]")
        if set(item) != {"label", "sourceRows", "zeroValues"}:
            raise SnapshotError("chiavi copertura misura inattese")
        require_text(item.get("label"), f"coverage.byMeasure[{index}].label")
        require_safe_integer(item.get("sourceRows"), f"coverage.byMeasure[{index}].sourceRows")
        require_safe_integer(item.get("zeroValues"), f"coverage.byMeasure[{index}].zeroValues")
    expected_coverage = compute_coverage(
        parsed_rows,
        [require_dict(item, "measures[]") for item in raw_measures],
    )
    if coverage != expected_coverage:
        raise SnapshotError("copertura snapshot divergente")
    expected = require_dict(spec["expected"], "expected")
    if (
        coverage["sourceRows"] != expected["sourceRows"]
        or coverage["dimensionRows"] != expected["dimensionRows"]
        or coverage["zeroValues"] != expected["zeroValues"]
        or any(item["sourceRows"] != expected["rowsPerMeasure"] for item in by_measure)
    ):
        raise SnapshotError("copertura snapshot divergente dalla source spec")

    reconciliation = require_dict(snapshot.get("reconciliation"), "reconciliation")
    if set(reconciliation) != set(EXPECTED_RECONCILIATION):
        raise SnapshotError("chiavi riconciliazione inattese")
    for key, value in reconciliation.items():
        require_safe_integer(value, f"reconciliation.{key}")
    expected_reconciliation = compute_reconciliation(parsed_rows, expected_territories)
    if reconciliation != expected_reconciliation or reconciliation != expected["absoluteReconciliation"]:
        raise SnapshotError("riconciliazione snapshot divergente")

    methodology = require_dict(snapshot.get("methodology"), "methodology")
    if methodology != METHODOLOGY:
        raise SnapshotError("metodologia snapshot divergente")
    caveats = require_list(snapshot.get("caveats"), "caveats")
    if caveats != CAVEATS:
        raise SnapshotError("limiti snapshot divergenti")


def write_snapshot(snapshot: dict[str, object], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(canonical_json(snapshot) + b"\n")
    temporary.replace(output)


def check_snapshot(spec: dict[str, object], payload: bytes, output: Path) -> None:
    """Require canonical bytes to match a rebuild from the pinned official source payload."""

    try:
        committed = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError("snapshot committed illeggibile") from error
    validate_snapshot(require_dict(committed, "snapshot"), spec)
    expected = canonical_json(build_snapshot(spec, payload)) + b"\n"
    if output.read_bytes() != expected:
        raise SnapshotError("snapshot committed divergente: rigenerare l'artefatto")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = load_spec(args.spec)
    payload = args.input.read_bytes()
    if args.check:
        check_snapshot(spec, payload, args.output)
    else:
        write_snapshot(build_snapshot(spec, payload), args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
