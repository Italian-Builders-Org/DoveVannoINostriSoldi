"""Spec-driven normalizer for one pinned OpenCivitas per-function release.

Every source quirk is declared in the release spec and verified, never guessed:
CSV encoding and header list, decimal separator, row and definition counts,
the nine indicator descriptions, excluded Comuni and national totals. A release
that drifts from its lock raises StructuralError instead of publishing.

The 2021/2022 per-function adapters predate this module and stay unchanged.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import re

from opencivitas_common import (
    MUNICIPALITY_COLUMNS,
    StructuralError,
    basis_points,
    cents,
    clean_metric,
    load_entities,
    read_outer_file,
    row_dicts,
    snapshot_text,
    xlsx_rows,
)

SPEC_DIR = Path(__file__).with_name("specs")
MONEY_CODES = (
    "FST_RIPROPORZIONATO_BI",
    "FST_RIPROPORZIONATO_BI_PROAB",
    "SPESA_STORICA",
    "SPESA_STORICA_PROAB",
)
# Codici per funzione (senza suffisso _TOT). Le descrizioni sono bloccate nella
# spec di ciascun rilascio: la fonte cambia maiuscole ("Da"/"da") e unità.
SELECTED_CODES = (
    *MONEY_CODES,
    "DIFF_OUT_PERC",
    "POSIZIONE_SPESA_PERC",
    "POSIZIONE_OUTPUT_PERC",
    "DESCR_NON_VALUTABILE_SPESA",
    "DESCR_NON_VALUTABILE_OUT",
)
# Colonne CSV che il normalizzatore legge; Privacy può mancare (FC60RIFIUTI).
REQUIRED_CSV_COLUMNS = {"USERNAME", "Indicatore/Determinante", "Valore", "Anomalia"}


@dataclass(frozen=True)
class FunctionRelease:
    spec_name: str
    output: Path
    semantic_sha256: str
    function: str
    family: str
    scope: str
    label: str

    @property
    def spec(self) -> dict:
        return json.loads((SPEC_DIR / self.spec_name).read_text(encoding="utf-8"))


def verify_bytes(release: FunctionRelease, spec: dict, payload: bytes, key: str) -> None:
    expected = spec["files"][key]
    if len(payload) != expected["bytes"] or hashlib.sha256(payload).hexdigest() != expected["sha256"]:
        raise StructuralError(f"{release.family}: byte/SHA-256 {key} diversi dal lock")


def verify_definitions(release: FunctionRelease, spec: dict, definitions: list[dict]) -> None:
    codes = [row.get("VAR_IND_COD") for row in definitions]
    if len(codes) != spec["indicatorDefinitionCount"] or len(set(codes)) != len(codes):
        raise StructuralError(f"{release.family}: metadati indicatori inattesi o duplicati")
    descriptions = spec["indicatorDescriptions"]
    if set(descriptions) != set(SELECTED_CODES):
        raise StructuralError(f"{release.family}: la spec non blocca i nove indicatori attesi")
    by_code = {row["VAR_IND_COD"]: row for row in definitions}
    for code in SELECTED_CODES:
        row = by_code.get(code, {})
        expected_tip = "FS" if code in MONEY_CODES else "LQP"
        if (
            row.get("VAR_IND_DES") != descriptions[code]
            or row.get("VAR_IND_FUNZIONE") != release.function
            or row.get("VAR_IND_LINGUA") != "IT"
            or row.get("VAR_IND_TIP") != expected_tip
        ):
            raise StructuralError(f"{release.family}: definizione/unità/perimetro inattesi per {code}")


def load_raw_data(release: FunctionRelease, spec: dict, payload: bytes) -> dict[str, dict[str, dict[str, str]]]:
    raw_csv = read_outer_file(payload, ".csv")
    # Codifica dichiarata nel lock: Amministrazione 2019 è cp1252, le altre UTF-8.
    reader = csv.DictReader(
        io.TextIOWrapper(io.BytesIO(raw_csv), encoding=spec["csvEncoding"], newline=""),
        delimiter=";",
    )
    if reader.fieldnames is None or list(reader.fieldnames) != spec["csvHeaders"]:
        raise StructuralError(f"{release.family}: schema CSV inatteso")
    if not REQUIRED_CSV_COLUMNS.issubset(reader.fieldnames):
        raise StructuralError(f"{release.family}: colonne mancanti {sorted(REQUIRED_CSV_COLUMNS - set(reader.fieldnames))}")
    selected: dict[str, dict[str, dict[str, str]]] = {}
    row_count = 0
    for row in reader:
        row_count += 1
        code = row["Indicatore/Determinante"]
        if code not in SELECTED_CODES:
            continue
        bucket = selected.setdefault(row["USERNAME"], {})
        if code in bucket:
            raise StructuralError(f"{release.family}: dati duplicati {row['USERNAME']} / {code}")
        bucket[code] = {
            "value": row["Valore"].strip(),
            "anomaly": row["Anomalia"].strip(),
            "privacy": (row.get("Privacy") or "").strip(),
        }
    if row_count != spec["csvRowCount"]:
        raise StructuralError(f"{release.family}: numero di righe CSV diverso dal lock")
    return selected


def per_capita_reconciles(historical: Decimal, historical_pc: Decimal, population: Decimal) -> bool:
    """La popolazione implicita dalla spesa storica coincide con quella dal fabbisogno.

    Oltre allo scarto relativo di 1e-6 accetta solo l'arrotondamento dell'ultima
    cifra pubblicata: Nola (063050) pubblica 1 € di spesa storica Istruzione 2019
    e 0,0000291834 € per abitante, dove il troncamento a dieci decimali da solo
    sposta la popolazione implicita di 1,6e-6.
    """
    if abs(historical / historical_pc - population) / population <= Decimal("0.000001"):
        return True
    last_digit = Decimal(1).scaleb(historical_pc.as_tuple().exponent)
    return abs(historical / population - historical_pc) <= last_digit


def normalize_municipality(release: FunctionRelease, spec: dict, username: str, entity: dict, rows: dict) -> dict:
    warnings: list[str] = []
    separator = spec["decimalSeparator"]

    def metric(code: str, *, required: bool = True) -> Decimal | None:
        return clean_metric(rows, code, warnings, required=required, decimal_separator=separator)

    for code in MONEY_CODES:
        if rows[code]["anomaly"] or rows[code]["privacy"]:
            raise StructuralError(f"{username}: flag su misura monetaria {code}")

    historical = metric("SPESA_STORICA")
    standard = metric("FST_RIPROPORZIONATO_BI")
    historical_pc = metric("SPESA_STORICA_PROAB")
    standard_pc = metric("FST_RIPROPORZIONATO_BI_PROAB")
    if historical is None or standard is None or historical_pc is None or standard_pc is None:
        raise StructuralError(f"{username}: valori monetari principali non disponibili")
    if historical < 0 or standard <= 0 or historical_pc < 0 or standard_pc <= 0:
        raise StructuralError(f"{username}: valori monetari fuori intervallo")
    if historical > 0 and not per_capita_reconciles(historical, historical_pc, standard / standard_pc):
        raise StructuralError(f"{username}: totali e valori per abitante non riconciliati")

    historical_cents = cents(historical, "SPESA_STORICA")
    standard_cents = cents(standard, "FST_RIPROPORZIONATO_BI")
    historical_pc_cents = cents(historical_pc, "SPESA_STORICA_PROAB")
    standard_pc_cents = cents(standard_pc, "FST_RIPROPORZIONATO_BI_PROAB")

    output_difference = metric("DIFF_OUT_PERC", required=False)
    spending_level = metric("POSIZIONE_SPESA_PERC", required=False)
    service_level = metric("POSIZIONE_OUTPUT_PERC", required=False)
    for value, field in ((spending_level, "livello spesa"), (service_level, "livello servizi")):
        if value is not None and (value != value.to_integral_value() or not 0 <= value <= 10):
            raise StructuralError(f"{username}: {field} fuori intervallo")

    return {
        **entity,
        "historicalSpendingCents": historical_cents,
        "standardSpendingCents": standard_cents,
        "differenceCents": historical_cents - standard_cents,
        "historicalPerCapitaCents": historical_pc_cents,
        "standardPerCapitaCents": standard_pc_cents,
        "differencePerCapitaCents": historical_pc_cents - standard_pc_cents,
        "differenceBasisPoints": basis_points((historical - standard) / standard * 100, "differenza percentuale"),
        "serviceDifferenceBasisPoints": None if output_difference is None else basis_points(output_difference, "differenza servizi"),
        "spendingLevel": None if spending_level is None else int(spending_level),
        "serviceLevel": None if service_level is None else int(service_level),
        "spendingAssessmentReason": rows["DESCR_NON_VALUTABILE_SPESA"]["value"] or None,
        "servicesAssessmentReason": rows["DESCR_NON_VALUTABILE_OUT"]["value"] or None,
        "sourceWarnings": warnings,
    }


def incomplete_historical(rows: dict) -> bool:
    return any(not rows[code]["value"] for code in MONEY_CODES)


def scientific_historical(rows: dict) -> bool:
    # Residui di zero come "2,728484E-12": non sono importi decimali del rilascio.
    return any("E" in rows[code]["value"].upper() for code in ("SPESA_STORICA", "SPESA_STORICA_PROAB"))


def non_positive_standard(rows: dict, separator: str) -> bool:
    cell = rows["FST_RIPROPORZIONATO_BI"]
    if not cell["value"] or cell["anomaly"] or cell["privacy"]:
        return False
    value = cell["value"].replace(",", ".") if separator == "," else cell["value"]
    return Decimal(value) <= 0


def excluded_standard_cents(spec: dict, raw: dict, usernames: set[str]) -> int:
    total = 0
    for username in usernames:
        value = raw[username]["FST_RIPROPORZIONATO_BI"]["value"]
        if value:
            total += cents(Decimal(value.replace(",", ".")), "FST_RIPROPORZIONATO_BI")
    return total


def normalize_rows(release: FunctionRelease, spec: dict, entities: dict, raw: dict) -> list[dict]:
    unknown = set(raw) - set(entities)
    if unknown != set(spec["excludedAggregates"]):
        raise StructuralError(f"{release.family}: join enti sconosciuti o aggregati inattesi")
    seen = {"excludedIncompleteHistorical": set(), "excludedScientificHistorical": set(), "excludedNonPositiveStandard": set()}
    result = []
    for username in sorted(set(raw) & set(entities)):
        entity = dict(entities[username])
        # I metadati enti 2019 usano entrambe le grafie per la stessa regione.
        if entity["region"] == "EMILIA ROMAGNA":
            entity["region"] = "EMILIA-ROMAGNA"
        if entity["region"] not in spec["regionCounts"]:
            raise StructuralError(f"{release.family}: Comune fuori RSO {username}")
        rows = raw[username]
        if set(rows) != set(SELECTED_CODES):
            raise StructuralError(f"{release.family}: indicatori comunali mancanti {username}")
        if incomplete_historical(rows):
            seen["excludedIncompleteHistorical"].add(username)
            continue
        if scientific_historical(rows):
            seen["excludedScientificHistorical"].add(username)
            continue
        if non_positive_standard(rows, spec["decimalSeparator"]):
            seen["excludedNonPositiveStandard"].add(username)
            continue
        result.append(normalize_municipality(release, spec, username, entity, rows))
    for key, found in seen.items():
        if found != set(spec[key]):
            raise StructuralError(
                f"{release.family}: {key} diversi dal lock (attesi {sorted(spec[key])}, trovati {sorted(found)})"
            )
    if len(result) != spec["municipalities"] or Counter(row["region"] for row in result) != spec["regionCounts"]:
        raise StructuralError(f"{release.family}: copertura RSO non riconciliata")
    codes = [row["istatCode"] for row in result]
    if len(set(codes)) != len(codes):
        raise StructuralError(f"{release.family}: codice ISTAT duplicato")
    excluded = set().union(*seen.values())
    verify_national_totals(release, spec, result, excluded_standard_cents(spec, raw, excluded))
    return sorted(result, key=lambda row: row["istatCode"])


def verify_national_totals(release: FunctionRelease, spec: dict, published: list[dict], excluded_standard: int) -> None:
    """Blocca il bundle se i totali nazionali escono dal lock.

    Dove la fonte riproporziona il fabbisogno sul totale della spesa storica
    della funzione, l'uguaglianza vale sull'insieme joinato: fabbisogno pubblicato
    più quello dei Comuni esclusi. Uno scarto oltre l'arrotondamento non viene
    pubblicato come risparmio apparente. Dove la fonte non riproporziona
    (Sociale e asili nido) i totali restano comunque bloccati.
    """
    expected = spec["nationalTotals"]
    historical = sum(row["historicalSpendingCents"] for row in published)
    standard = sum(row["standardSpendingCents"] for row in published)
    if historical != expected["historicalSpendingCents"]:
        raise StructuralError(f"{release.family}: spesa storica totale diversa dal lock")
    if standard != expected["standardSpendingCentsPublished"]:
        raise StructuralError(f"{release.family}: fabbisogno totale pubblicato diverso dal lock")
    if excluded_standard != expected["standardSpendingCentsExcluded"]:
        raise StructuralError(f"{release.family}: fabbisogno dei Comuni esclusi diverso dal lock")
    if expected["reproportioned"]:
        joined = standard + excluded_standard
        if abs(historical - joined) > expected["roundingToleranceCents"]:
            raise StructuralError(f"{release.family}: il fabbisogno non riproporziona più sul totale della spesa storica")


def normalize(release: FunctionRelease, data: bytes, entities: bytes, indicators: bytes, observed_at: str) -> dict:
    spec = release.spec
    for key, payload in (("data", data), ("entities", entities), ("indicators", indicators)):
        verify_bytes(release, spec, payload, key)
    definitions = list(row_dicts(xlsx_rows(read_outer_file(indicators, ".xlsx"))))
    verify_definitions(release, spec, definitions)
    municipalities = normalize_rows(release, spec, load_entities(entities), load_raw_data(release, spec, data))
    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "scope": release.scope,
        "referenceYear": spec["referenceYear"],
        "publishedAt": spec["publishedAt"],
        "modifiedAt": spec["modifiedAt"],
        "generatedAt": observed_at,
        "coverage": {
            "municipalities": len(municipalities),
            "regions": 15,
            "regionNames": sorted(spec["regionCounts"]),
            "territorialScope": "Comuni delle Regioni a statuto ordinario",
            "function": release.function,
        },
        "municipalityColumns": list(MUNICIPALITY_COLUMNS),
        "municipalityRows": [[row[column] for column in MUNICIPALITY_COLUMNS] for row in municipalities],
        "source": {
            "owner": spec["owner"],
            "publisher": spec["publisher"],
            "dataset": f"Comuni · {release.label} · Indicatori e determinanti {spec['referenceYear']} ({release.family})",
            "landingUrl": "https://www.opencivitas.it/it/open-data",
            "datasetUrl": spec["datasetPageUrl"],
            **{key + "Url": item["url"] for key, item in spec["files"].items()},
            "license": spec["license"],
            "licenseUrl": spec["licenseUrl"],
            "observedAt": observed_at,
            "declaredCadence": "Irregolare",
            "family": release.family,
            "releaseVersion": spec["releaseVersion"],
            "sha256": {key: item["sha256"] for key, item in spec["files"].items()},
            "bytes": {key: item["bytes"] for key, item in spec["files"].items()},
        },
        "methodology": {
            "differenceMeaning": f"Differenza tra spesa storica e spesa standard sulla funzione {release.label}. Non è una misura di spreco.",
            "serviceMeaning": f"Il confronto sui servizi usa la media dei Comuni della stessa fascia di popolazione, perimetro {release.label}.",
            "perCapitaMeaning": "Euro per abitante pubblicati dalla fonte; nessuna popolazione ricostruita o imputata.",
            "coverageWarning": spec["coverageWarning"],
            "rankingWarning": "I livelli della fonte non costituiscono un ranking di efficienza.",
            "functionSeparationWarning": (
                f"{release.family} {spec['referenceYear']} è distinto da FC60TOT 2019 (servizi totali) e dalla funzione "
                f"{release.label} 2021 e 2022: nessuna somma o confronto silenzioso fra funzioni o annualità."
            ),
            "nationalDifferenceWarning": spec["nationalTotals"]["note"],
        },
    }


def semantic_digest(snapshot: dict) -> str:
    value = {key: item for key, item in snapshot.items() if key != "generatedAt"}
    value["source"] = {key: item for key, item in snapshot["source"].items() if key != "observedAt"}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def validate_snapshot(release: FunctionRelease, snapshot: dict) -> None:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("source"), dict):
        raise StructuralError(f"{release.family}: oggetto snapshot e fonte attesi")
    observed = snapshot.get("generatedAt")
    if (
        not isinstance(observed, str)
        or observed != snapshot["source"].get("observedAt")
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", observed)
    ):
        raise StructuralError(f"{release.family}: timestamp di acquisizione non coerenti")
    published = datetime.fromisoformat(release.spec["publishedAt"]).replace(tzinfo=timezone.utc)
    try:
        date = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if date.tzinfo is None or date < published:
            raise ValueError("acquisizione precedente al rilascio")
    except ValueError as error:
        raise StructuralError(f"{release.family}: timestamp ISO con fuso atteso") from error
    if release.semantic_sha256 == "PENDING":
        raise StructuralError(f"{release.family}: SEMANTIC_SHA256 non ancora fissato")
    if semantic_digest(snapshot) != release.semantic_sha256:
        raise StructuralError(f"{release.family}: SHA-256 semantico diverso dal rilascio verificato")


def main(release: FunctionRelease, description: str | None = None) -> None:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input-dir", type=Path, help="Directory dei tre ZIP ufficiali pinned; nessuna rete")
    parser.add_argument("--output", type=Path, default=release.output)
    parser.add_argument("--print-semantic-sha", action="store_true", help="Stampa il digest senza pin (solo build)")
    args = parser.parse_args()
    year = release.spec["referenceYear"]
    if args.check:
        validate_snapshot(release, json.loads(args.output.read_text(encoding="utf-8")))
        print(f"{release.family} {year}: snapshot verificato offline")
        return
    if args.input_dir is None:
        parser.error("specificare --input-dir con i tre ZIP ufficiali")
    payloads = {
        key: (args.input_dir / item["url"].rsplit("/", 1)[1]).read_bytes()
        for key, item in release.spec["files"].items()
    }
    result = normalize(
        release,
        **payloads,
        observed_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )
    digest = semantic_digest(result)
    if args.print_semantic_sha or release.semantic_sha256 == "PENDING":
        print(f"{release.family} semantic sha256={digest}")
    if release.semantic_sha256 != "PENDING":
        validate_snapshot(release, result)
    if args.output.exists() and release.semantic_sha256 != "PENDING":
        current = json.loads(args.output.read_text(encoding="utf-8"))
        validate_snapshot(release, current)
        if semantic_digest(current) == digest:
            print(f"{release.family} {year}: nessuna variazione")
            return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(snapshot_text(result).encode("utf-8"))
    print(f"{release.family} {year}: {len(result['municipalityRows'])} Comuni")
