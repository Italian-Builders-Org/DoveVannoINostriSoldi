"""Verified shared tabular and nine-indicator primitives for FC60 (2019)/FC70 (2021).

Release pins, metadata definitions, coverage and snapshot contracts stay in their
respective adapters. Extraction preserves the existing FC70 transformation.
"""
from __future__ import annotations
import csv
import io
import json
import re
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

MAX_SAFE_INTEGER = 9_007_199_254_740_991
SELECTED_INDICATORS = {
    "FST_RIPROPORZIONATO_BI": "Spesa standard - Euro",
    "FST_RIPROPORZIONATO_BI_PROAB": "Spesa standard - Euro per abitante",
    "SPESA_STORICA": "Spesa storica - euro",
    "SPESA_STORICA_PROAB": "Spesa storica - Euro per abitante",
    "DIFF_OUT_PERC_TOT": "Quantità di servizi offerti dal comune rispetto alla media di fascia di popolazione - %",
    "POSIZIONE_SPESA_PERC_TOT": "Livello della spesa - Da 0 a 10",
    "POSIZIONE_OUTPUT_PERC_TOT": "Livello dei servizi erogati - Da 0 a 10",
    "DESCR_NON_VALUTABILE_SPESA_TOT": "Motivo di non valutabilità per la spesa",
    "DESCR_NON_VALUTABILE_OUT_TOT": "Motivo di non valutabilità per i servizi offerti",
}
MUNICIPALITY_COLUMNS = (
    "istatCode",
    "name",
    "province",
    "region",
    "historicalSpendingCents",
    "standardSpendingCents",
    "differenceCents",
    "historicalPerCapitaCents",
    "standardPerCapitaCents",
    "differencePerCapitaCents",
    "differenceBasisPoints",
    "serviceDifferenceBasisPoints",
    "spendingLevel",
    "serviceLevel",
    "spendingAssessmentReason",
    "servicesAssessmentReason",
    "sourceWarnings",
)


class StructuralError(RuntimeError):
    """The upstream data no longer matches the declared contract."""

def read_outer_file(payload: bytes, suffix: str) -> bytes:
    try:
        with ZipFile(io.BytesIO(payload)) as archive:
            matches = [name for name in archive.namelist() if name.lower().endswith(suffix.lower()) and not name.startswith("__MACOSX/")]
            if len(matches) != 1:
                raise StructuralError(f"Archivio: atteso un solo file {suffix}, trovati {len(matches)}")
            return archive.read(matches[0])
    except BadZipFile as error:
        raise StructuralError("Archivio ZIP non valido") from error


def column_index(cell_reference: str) -> int:
    match = re.match(r"([A-Z]+)", cell_reference)
    if not match:
        raise StructuralError(f"Riferimento cella XLSX non valido: {cell_reference}")
    result = 0
    for char in match.group(1):
        result = result * 26 + ord(char) - 64
    return result - 1


def xlsx_rows(payload: bytes, preferred_sheet: str | None = None):
    main_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    package_rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    with ZipFile(io.BytesIO(payload)) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in root.findall(f"{{{main_ns}}}si")]

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {node.attrib["Id"]: node.attrib["Target"] for node in relationships.findall(f"{{{package_rel_ns}}}Relationship")}
        sheets = workbook.find(f"{{{main_ns}}}sheets")
        if sheets is None or not list(sheets):
            raise StructuralError("XLSX senza fogli")
        selected = next(
            (sheet for sheet in sheets if sheet.attrib.get("name") == preferred_sheet),
            None,
        )
        if selected is None:
            selected = list(sheets)[0]
        relation_id = selected.attrib.get(f"{{{rel_ns}}}id")
        if not relation_id or relation_id not in targets:
            raise StructuralError("Relazione del foglio XLSX mancante")
        target = targets[relation_id]
        sheet_path = str(PurePosixPath("xl") / target) if not target.startswith("/") else target.lstrip("/")
        sheet_path = str(PurePosixPath(sheet_path))

        with archive.open(sheet_path) as stream:
            for event, element in ET.iterparse(stream, events=("end",)):
                if element.tag != f"{{{main_ns}}}row":
                    continue
                values: dict[int, str] = {}
                for cell in element.findall(f"{{{main_ns}}}c"):
                    index = column_index(cell.attrib.get("r", ""))
                    cell_type = cell.attrib.get("t")
                    value_node = cell.find(f"{{{main_ns}}}v")
                    if cell_type == "inlineStr":
                        inline = cell.find(f"{{{main_ns}}}is")
                        value = "" if inline is None else "".join(inline.itertext())
                    elif value_node is None:
                        value = ""
                    elif cell_type == "s":
                        value = shared[int(value_node.text or "0")]
                    else:
                        value = value_node.text or ""
                    values[index] = value
                width = max(values, default=-1) + 1
                yield [values.get(index, "") for index in range(width)]
                element.clear()


def row_dicts(rows):
    iterator = iter(rows)
    try:
        headers = [str(value).strip() for value in next(iterator)]
    except StopIteration as error:
        raise StructuralError("File tabellare vuoto") from error
    if len(headers) != len(set(headers)):
        raise StructuralError("Intestazioni duplicate")
    for row in iterator:
        padded = list(row) + [""] * (len(headers) - len(row))
        yield {header: str(padded[index]).strip() for index, header in enumerate(headers)}


def load_entities(payload: bytes) -> dict[str, dict[str, str]]:
    xlsx = read_outer_file(payload, ".xlsx")
    required = {"USERNAME", "ENTE_TIPOLOGIA", "ENTE", "REGIONE_DES", "PROVINCIA_DES", "COMUNE_ISTAT_COD"}
    entities: dict[str, dict[str, str]] = {}
    istat_codes: set[str] = set()
    for row in row_dicts(xlsx_rows(xlsx)):
        if not required.issubset(row):
            raise StructuralError(f"Metadati enti: colonne mancanti {sorted(required - set(row))}")
        if row["ENTE_TIPOLOGIA"] != "COMUNE" or not row["COMUNE_ISTAT_COD"]:
            continue
        username = row["USERNAME"]
        istat_code = row["COMUNE_ISTAT_COD"].zfill(6)
        if not re.fullmatch(r"\d{6}", istat_code):
            raise StructuralError(f"Codice ISTAT Comune non valido: {istat_code}")
        if username in entities or istat_code in istat_codes:
            raise StructuralError(f"Metadati enti duplicati: {username}/{istat_code}")
        entities[username] = {
            "istatCode": istat_code,
            "name": row["ENTE"],
            "province": row["PROVINCIA_DES"],
            "region": row["REGIONE_DES"],
        }
        istat_codes.add(istat_code)
    if not entities:
        raise StructuralError("Metadati enti: nessun Comune")
    return entities


def decimal_value(value: str, field: str, *, required: bool = True) -> Decimal | None:
    cleaned = value.strip()
    if not cleaned:
        if required:
            raise StructuralError(f"{field}: valore numerico mancante")
        return None
    if not re.fullmatch(r"-?\d+(?:,\d+)?", cleaned):
        raise StructuralError(f"{field}: formato numerico italiano inatteso")
    try:
        parsed = Decimal(cleaned.replace(",", "."))
    except InvalidOperation as error:
        raise StructuralError(f"{field}: numero non valido") from error
    if not parsed.is_finite():
        raise StructuralError(f"{field}: numero non finito")
    return parsed


def cents(value: Decimal, field: str) -> int:
    result = int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if abs(result) > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: importo oltre il limite sicuro JavaScript")
    return result


def basis_points(value: Decimal, field: str) -> int:
    result = int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if abs(result) > 1_000_000:
        raise StructuralError(f"{field}: percentuale fuori intervallo")
    return result


def load_raw_data(payload: bytes) -> dict[str, dict[str, dict[str, str]]]:
    raw_csv = read_outer_file(payload, ".csv")
    reader = csv.DictReader(io.TextIOWrapper(io.BytesIO(raw_csv), encoding="utf-8-sig", newline=""), delimiter=";")
    required = {"USERNAME", "Indicatore/Determinante", "Valore", "Anomalia", "Privacy"}
    if reader.fieldnames is None or not required.issubset(reader.fieldnames):
        raise StructuralError(f"Dati OpenCivitas: colonne mancanti {sorted(required - set(reader.fieldnames or []))}")
    selected: dict[str, dict[str, dict[str, str]]] = {}
    for row in reader:
        code = row["Indicatore/Determinante"]
        if code not in SELECTED_INDICATORS:
            continue
        bucket = selected.setdefault(row["USERNAME"], {})
        if code in bucket:
            raise StructuralError(f"Dati duplicati: {row['USERNAME']} / {code}")
        bucket[code] = {"value": row["Valore"].strip(), "anomaly": row["Anomalia"].strip(), "privacy": row["Privacy"].strip()}
    return selected


def clean_metric(rows: dict[str, dict[str, str]], code: str, warnings: list[str], *, required: bool = True) -> Decimal | None:
    if code not in rows:
        if required:
            raise StructuralError(f"Indicatore {code} mancante")
        return None
    row = rows[code]
    flags = [flag for flag in (row["anomaly"], row["privacy"]) if flag]
    if flags:
        warnings.append(f"{code}: {', '.join(flags)}")
        return None
    return decimal_value(row["value"], code, required=required)


def normalize_municipality(username: str, entity: dict, rows: dict) -> dict:
    warnings: list[str] = []
    historical = clean_metric(rows, "SPESA_STORICA", warnings)
    standard = clean_metric(rows, "FST_RIPROPORZIONATO_BI", warnings)
    historical_pc = clean_metric(rows, "SPESA_STORICA_PROAB", warnings)
    standard_pc = clean_metric(rows, "FST_RIPROPORZIONATO_BI_PROAB", warnings)
    if None in (historical, standard, historical_pc, standard_pc):
        raise StructuralError(f"{username}: valori monetari principali non disponibili")
    assert historical is not None and standard is not None and historical_pc is not None and standard_pc is not None
    if historical < 0 or standard <= 0 or historical_pc < 0 or standard_pc <= 0:
        raise StructuralError(f"{username}: valori monetari fuori intervallo")
    if historical > 0:
        population_from_historical = historical / historical_pc
        population_from_standard = standard / standard_pc
        relative_population_gap = abs(population_from_historical - population_from_standard) / population_from_standard
        if relative_population_gap > Decimal("0.000001"):
            raise StructuralError(f"{username}: totali e valori per abitante non riconciliati")

    historical_cents = cents(historical, "SPESA_STORICA")
    standard_cents = cents(standard, "FST_RIPROPORZIONATO_BI")
    historical_pc_cents = cents(historical_pc, "SPESA_STORICA_PROAB")
    standard_pc_cents = cents(standard_pc, "FST_RIPROPORZIONATO_BI_PROAB")
    difference_cents = historical_cents - standard_cents
    difference_pc_cents = historical_pc_cents - standard_pc_cents
    calculated_difference_bp = basis_points((historical - standard) / standard * 100, "differenza percentuale")

    output_difference = clean_metric(rows, "DIFF_OUT_PERC_TOT", warnings, required=False)
    spending_level = clean_metric(rows, "POSIZIONE_SPESA_PERC_TOT", warnings, required=False)
    service_level = clean_metric(rows, "POSIZIONE_OUTPUT_PERC_TOT", warnings, required=False)
    for value, field in ((spending_level, "livello spesa"), (service_level, "livello servizi")):
        if value is not None and (value != value.to_integral_value() or not 0 <= value <= 10):
            raise StructuralError(f"{username}: {field} fuori intervallo")

    spending_reason = rows.get("DESCR_NON_VALUTABILE_SPESA_TOT", {}).get("value") or None
    services_reason = rows.get("DESCR_NON_VALUTABILE_OUT_TOT", {}).get("value") or None
    return {
        **entity,
        "historicalSpendingCents": historical_cents,
        "standardSpendingCents": standard_cents,
        "differenceCents": difference_cents,
        "historicalPerCapitaCents": historical_pc_cents,
        "standardPerCapitaCents": standard_pc_cents,
        "differencePerCapitaCents": difference_pc_cents,
        "differenceBasisPoints": calculated_difference_bp,
        "serviceDifferenceBasisPoints": None if output_difference is None else basis_points(output_difference, "differenza servizi"),
        "spendingLevel": None if spending_level is None else int(spending_level),
        "serviceLevel": None if service_level is None else int(service_level),
        "spendingAssessmentReason": spending_reason,
        "servicesAssessmentReason": services_reason,
        "sourceWarnings": warnings,
    }


def snapshot_text(snapshot: dict) -> str:
    chunks = ["{"]
    items = list(snapshot.items())
    for item_index, (key, value) in enumerate(items):
        suffix = "," if item_index < len(items) - 1 else ""
        if key == "municipalityRows":
            chunks.append(f"  {json.dumps(key)}: [")
            for row_index, row in enumerate(value):
                row_suffix = "," if row_index < len(value) - 1 else ""
                chunks.append(
                    "    "
                    + json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                    + row_suffix
                )
            chunks.append(f"  ]{suffix}")
            continue
        rendered = json.dumps(value, ensure_ascii=False, indent=2)
        rendered = rendered.replace("\n", "\n  ")
        chunks.append(f"  {json.dumps(key)}: {rendered}{suffix}")
    chunks.append("}")
    return "\n".join(chunks) + "\n"
