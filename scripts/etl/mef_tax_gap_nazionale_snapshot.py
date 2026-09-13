#!/usr/bin/env python3
"""Build the source-locked MEF national tax-gap snapshot (Tab. I.1 / I.2).

Reads the official PDF *Relazione sull'economia non osservata e sull'evasione
fiscale e contributiva 2025*. Runtime and CI stay offline: URL, bytes, SHA-256,
PDF page indexes and table titles live in the source lock. Extraction uses the
PDF text layer only (pypdf) — no OCR.

Money is converted exactly from whole million euro to euro-cents. Propensione
values keep one source decimal as tenths of a percentage point. Min/max forks
stay pairs; point estimates stay single values. Contribution rows exist only in
Tab. I.1 and never invent a propensione from Tab. I.2.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/mef-tax-gap-nazionale.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/mef-tax-gap-nazionale.data.json"
DEFAULT_META = ROOT / "src/data/generated/mef-tax-gap-nazionale.meta.json"
DATASET_ID = "mef-tax-gap-nazionale"
OFFICIAL_PREFIX = "https://www.mef.gov.it/"
MILLION_EURO_TO_CENTS = 100_000_000
YEARS = (2018, 2019, 2020, 2021, 2022)
MONEY_TOKEN = re.compile(r"-?(?:0|[1-9]\d{0,2}(?:\.\d{3})+|\d+)")
PCT_TOKEN = re.compile(r"-?\d+,\d%")
SUM_TOLERANCE_MILLION = 1  # source rounding on range endpoints

CAVEATS = (
    "Il tax gap MEF è una stima con ipotesi di modello: non è evasione accertata, "
    "né recupero, né gettito riscosso.",
    "Il 2022 è semi-definitivo nella Relazione 2025; le forchette min/max restano forchette "
    "e non vanno collassate in un unico punto.",
    "Questa slice è solo nazionale (Tab. I.1 e I.2). Non pubblica ripartizioni, regioni o "
    "province e non le inventa.",
    "Non si somma né si confronta in silenzio con il VAT compliance gap DG TAXUD, con "
    "l'economia non osservata ISTAT o con i risultati di vigilanza INL.",
    "Le stime delle entrate contributive convivono con quelle tributarie ma restano nature "
    "distinte: i totali pubblicati dalla fonte non vengono ricostruiti sommando pezzi assenti.",
    "La revisione dei conti nazionali può rendere edizioni precedenti non confrontabili senza "
    "avvertenza: questa fetta pubblica solo i valori della Relazione 2025.",
    "Valori dell’edizione iniziale della Relazione 2025 (2018-2022). L’aggiornamento MEF "
    "successivo per il 2019-2023 rivede anche il 2022 e non è incluso in questo snapshot.",
    "La licenza del PDF non è dichiarata sul file: resta not-declared, senza inferenze.",
)

# Order matches the published tables after the header block.
GAP_ROWS: tuple[tuple[str, str, str], ...] = (
    ("irpef-lavoro-dipendente-irregolare", "range", "IRPEF lavoro dipendente (irregolare)"),
    ("addizionali-locali-irpef-lavoro-dipendente", "range", "Addizionali locali IRPEF (lavoro dipendente)"),
    ("irpef-lavoro-autonomo-impresa", "point", "IRPEF lavoro autonomo e impresa"),
    ("ires", "point", "IRES"),
    ("iva", "point", "IVA"),
    ("irap", "point", "IRAP"),
    ("locazioni", "point", "LOCAZIONI"),
    ("canone-rai", "point", "CANONE RAI"),
    ("accise-prodotti-energetici", "point", "ACCISE sui prodotti energetici (benzina e gasolio)"),
    ("imu-tasi", "point", "IMU-TASI"),
    ("totale-entrate-tributarie", "range", "Totale entrate tributarie"),
    ("totale-entrate-tributarie-netto-accise-imu", "range", "Totale entrate tributarie (al netto delle accise e dell'IMU)"),
    ("entrate-contributive-carico-lavoratore", "range", "Entrate contributive carico lavoratore dipendente"),
    ("entrate-contributive-carico-datore", "range", "Entrate contributive carico datore di lavoro"),
    ("totale-entrate-contributive", "range", "Totale entrate contributive"),
    ("totale-entrate-tributarie-e-contributive", "range", "Totale entrate tributarie e contributive"),
)

PROPENSIONE_ROWS: tuple[tuple[str, str, str], ...] = tuple(
    row for row in GAP_ROWS if not row[0].startswith("entrate-contributive")
    and row[0] != "totale-entrate-contributive"
    and row[0] != "totale-entrate-tributarie-e-contributive"
)


class SnapshotError(ValueError):
    """Schema, provenance or cell drift blocks publication."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    clone = json.loads(json.dumps(lock))
    clone["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(clone))


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "not-declared":
        raise SnapshotError("source lock: licenza PDF deve restare not-declared")
    if not str(source.get("url", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: URL download non ufficiale MEF")
    if not str(source.get("landingUrl", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: landing non ufficiale MEF")
    if not isinstance(source.get("bytes"), int) or source["bytes"] <= 0:
        raise SnapshotError("source lock: bytes non validi")
    digest = str(source.get("sha256", ""))
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise SnapshotError("source lock: sha256 non valido")
    pdf = spec.get("pdf") or {}
    if pdf.get("tableI1PageIndex") != 8 or pdf.get("tableI2PageIndex") != 9:
        raise SnapshotError("source lock: indici pagina Tab. I.1/I.2 pinnati")
    if canonical_lock_sha256(spec) != (spec.get("integrity") or {}).get("lockSha256"):
        raise SnapshotError("source lock: lockSha256 divergente")
    return spec


def verified_payload(spec: dict[str, Any], path: Path | None = None) -> bytes:
    source = spec["source"]
    source_path = path or ROOT / source["path"]
    try:
        payload = source_path.read_bytes()
    except OSError as error:
        raise SnapshotError(f"fixture PDF illeggibile: {error}") from error
    if len(payload) != source["bytes"]:
        raise SnapshotError("fixture PDF: byte divergenti dal lock")
    if sha256_bytes(payload) != source["sha256"]:
        raise SnapshotError("fixture PDF: SHA-256 divergente dal lock")
    if not payload.startswith(b"%PDF"):
        raise SnapshotError("fixture PDF: magic header assente")
    return payload


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def page_text(payload: bytes, page_index: int) -> str:
    import io

    reader = PdfReader(io.BytesIO(payload))
    if page_index < 0 or page_index >= len(reader.pages):
        raise SnapshotError("PDF: indice pagina fuori range")
    text = reader.pages[page_index].extract_text() or ""
    if not text.strip():
        raise SnapshotError(f"PDF: pagina {page_index + 1} senza layer testuale")
    return text


def parse_money_token(token: str) -> int:
    negative = token.startswith("-")
    body = token[1:] if negative else token
    value = int(body.replace(".", ""))
    return -value if negative else value


def parse_pct_token(token: str) -> int:
    negative = token.startswith("-")
    body = (token[1:] if negative else token).rstrip("%")
    whole, decimal = body.split(",")
    if len(decimal) != 1:
        raise SnapshotError("propensione: atteso un solo decimale")
    value = int(whole) * 10 + int(decimal)
    return -value if negative else value


def extract_table_body(page: str, title: str, footnote_prefix: str) -> str:
    if title not in page:
        raise SnapshotError(f"PDF: titolo tabella assente ({title})")
    body = page.split(title, 1)[1]
    cut = body.find(footnote_prefix)
    if cut < 0:
        raise SnapshotError(f"PDF: nota a piè di tabella assente ({footnote_prefix})")
    return normalize_text(body[:cut])


def consume_series(nums: list[int], shape: str) -> dict[str, Any]:
    width = 14 if shape == "range" else 7
    if len(nums) < width:
        raise SnapshotError("tabella: token insufficienti per la riga")
    chunk = nums[:width]
    del nums[:width]
    years: list[dict[str, Any]] = []
    if shape == "range":
        for index, year in enumerate(YEARS):
            lo = chunk[index * 2]
            hi = chunk[index * 2 + 1]
            years.append({"year": year, "min": lo, "max": hi})
        return {
            "years": years,
            "difference2022vs2018": {"min": chunk[10], "max": chunk[11]},
            "average2018to2022": {"min": chunk[12], "max": chunk[13]},
        }
    for index, year in enumerate(YEARS):
        years.append({"year": year, "value": chunk[index]})
    return {
        "years": years,
        "difference2022vs2018": {"value": chunk[5]},
        "average2018to2022": {"value": chunk[6]},
    }


def parse_gap_table(page: str, title: str) -> dict[str, dict[str, Any]]:
    body = extract_table_body(page, title, "Per le accise")
    marker = "IRPEF lavoro dipendente (irregolare) "
    start = body.find(marker)
    if start < 0:
        raise SnapshotError("Tab. I.1: ancora prima riga assente")
    tokens = MONEY_TOKEN.findall(body[start + len(marker) :])
    nums = [parse_money_token(token) for token in tokens]
    expected = sum(14 if shape == "range" else 7 for _, shape, _ in GAP_ROWS)
    if len(nums) != expected:
        raise SnapshotError(f"Tab. I.1: attesi {expected} numeri, trovati {len(nums)}")
    rows: dict[str, dict[str, Any]] = {}
    for row_id, shape, label in GAP_ROWS:
        series = consume_series(nums, shape)
        series["id"] = row_id
        series["sourceLabel"] = label
        series["shape"] = shape
        rows[row_id] = series
    if nums:
        raise SnapshotError("Tab. I.1: token residui dopo il consumo")
    return rows


def parse_propensione_table(page: str, title: str) -> dict[str, dict[str, Any]]:
    body = extract_table_body(page, title, "Per le accise")
    marker = "IRPEF lavoro dipendente (irregolare) "
    start = body.find(marker)
    if start < 0:
        raise SnapshotError("Tab. I.2: ancora prima riga assente")
    tokens = PCT_TOKEN.findall(body[start + len(marker) :])
    nums = [parse_pct_token(token) for token in tokens]
    expected = sum(14 if shape == "range" else 7 for _, shape, _ in PROPENSIONE_ROWS)
    if len(nums) != expected:
        raise SnapshotError(f"Tab. I.2: attesi {expected} percentuali, trovate {len(nums)}")
    rows: dict[str, dict[str, Any]] = {}
    for row_id, shape, label in PROPENSIONE_ROWS:
        series = consume_series(nums, shape)
        series["id"] = row_id
        series["sourceLabel"] = label
        series["shape"] = shape
        rows[row_id] = series
    if nums:
        raise SnapshotError("Tab. I.2: token residui dopo il consumo")
    return rows


def money_cell_from_million(shape: str, payload: dict[str, int]) -> dict[str, Any]:
    if shape == "range":
        return {
            "status": "observed",
            "shape": "range",
            "minCents": payload["min"] * MILLION_EURO_TO_CENTS,
            "maxCents": payload["max"] * MILLION_EURO_TO_CENTS,
            "valueCents": None,
        }
    value = payload["value"] * MILLION_EURO_TO_CENTS
    return {
        "status": "observed",
        "shape": "point",
        "minCents": None,
        "maxCents": None,
        "valueCents": value,
    }


def propensione_cell(shape: str, payload: dict[str, int] | None) -> dict[str, Any]:
    if payload is None:
        return {
            "status": "absent",
            "shape": "absent",
            "minTenthsPp": None,
            "maxTenthsPp": None,
            "valueTenthsPp": None,
        }
    if shape == "range":
        return {
            "status": "observed",
            "shape": "range",
            "minTenthsPp": payload["min"],
            "maxTenthsPp": payload["max"],
            "valueTenthsPp": None,
        }
    return {
        "status": "observed",
        "shape": "point",
        "minTenthsPp": None,
        "maxTenthsPp": None,
        "valueTenthsPp": payload["value"],
    }


def year_payload(shape: str, year_row: dict[str, Any]) -> dict[str, int]:
    if shape == "range":
        return {"min": year_row["min"], "max": year_row["max"]}
    return {"value": year_row["value"]}


def build_data(gap_rows: dict[str, dict[str, Any]], prop_rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    tax_rows: list[dict[str, Any]] = []
    for row_id, shape, label in GAP_ROWS:
        gap = gap_rows[row_id]
        prop = prop_rows.get(row_id)
        if gap["sourceLabel"] != label or gap["shape"] != shape:
            raise SnapshotError(f"riga {row_id}: etichetta/shape divergente")
        series = []
        for index, year in enumerate(YEARS):
            gap_year = gap["years"][index]
            if gap_year["year"] != year:
                raise SnapshotError("anni gap fuori ordine")
            prop_year = None
            if prop is not None:
                prop_year_row = prop["years"][index]
                if prop_year_row["year"] != year:
                    raise SnapshotError("anni propensione fuori ordine")
                prop_year = year_payload(shape, prop_year_row)
            series.append({
                "year": year,
                "gap": money_cell_from_million(shape, year_payload(shape, gap_year)),
                "propensione": propensione_cell(shape, prop_year),
            })
        tax_rows.append({
            "id": row_id,
            "sourceLabel": label,
            "shape": shape,
            "series": series,
            "difference2022vs2018": {
                "gap": money_cell_from_million(shape, gap["difference2022vs2018"]),
                "propensione": propensione_cell(
                    shape,
                    None if prop is None else prop["difference2022vs2018"],
                ),
            },
            "average2018to2022": {
                "gap": money_cell_from_million(shape, gap["average2018to2022"]),
                "propensione": propensione_cell(
                    shape,
                    None if prop is None else prop["average2018to2022"],
                ),
            },
        })
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "geography": {"code": "IT", "label": "Italia"},
        "period": {"from": 2018, "to": 2022},
        "units": {
            "money": "euro-cents",
            "sourceMoney": "million-euro",
            "propensione": "tenths-of-a-percentage-point",
        },
        "caveats": list(CAVEATS),
        "taxRows": tax_rows,
    }


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("datasetId") != DATASET_ID or data.get("schemaVersion") != 1:
        raise SnapshotError("data: identità inattesa")
    if data.get("period") != {"from": 2018, "to": 2022}:
        raise SnapshotError("data: periodo divergente")
    if data.get("geography") != {"code": "IT", "label": "Italia"}:
        raise SnapshotError("data: geografia non nazionale")
    if data.get("caveats") != list(CAVEATS):
        raise SnapshotError("data: caveat divergenti")
    rows = data.get("taxRows")
    if not isinstance(rows, list) or len(rows) != len(GAP_ROWS):
        raise SnapshotError("data: numero righe divergente")
    by_id = {row["id"]: row for row in rows}
    for row_id, shape, label in GAP_ROWS:
        row = by_id.get(row_id)
        if row is None or row.get("sourceLabel") != label or row.get("shape") != shape:
            raise SnapshotError(f"data: riga {row_id} assente o alterata")
        if len(row.get("series") or []) != 5:
            raise SnapshotError(f"data: serie incompleta per {row_id}")
        for item in row["series"]:
            gap = item["gap"]
            if gap["status"] != "observed":
                raise SnapshotError(f"data: gap non osservato ({row_id})")
            if shape == "point":
                if gap["valueCents"] is None or gap["minCents"] is not None:
                    raise SnapshotError(f"data: shape point incoerente ({row_id})")
            else:
                if gap["minCents"] is None or gap["maxCents"] is None or gap["valueCents"] is not None:
                    raise SnapshotError(f"data: shape range incoerente ({row_id})")
                # Min/Max are hypothesis columns from the PDF, not a sorted interval.
            prop = item["propensione"]
            contributive = row_id.startswith("entrate-contributive") or row_id in {
                "totale-entrate-contributive",
                "totale-entrate-tributarie-e-contributive",
            }
            if contributive:
                if prop["status"] != "absent":
                    raise SnapshotError(f"data: propensione inventata su {row_id}")
            elif prop["status"] != "observed":
                raise SnapshotError(f"data: propensione assente su {row_id}")

    # Soft partition check on 2022 published totals (±1 million euro).
    def million_from_cents(cell: dict[str, Any], edge: str) -> int:
        if cell["shape"] == "point":
            return cell["valueCents"] // MILLION_EURO_TO_CENTS
        return cell[edge] // MILLION_EURO_TO_CENTS

    year_2022 = {
        row["id"]: next(item for item in row["series"] if item["year"] == 2022)
        for row in rows
    }
    trib = year_2022["totale-entrate-tributarie"]["gap"]
    contrib = year_2022["totale-entrate-contributive"]["gap"]
    total = year_2022["totale-entrate-tributarie-e-contributive"]["gap"]
    for edge, key in (("minCents", "min"), ("maxCents", "max")):
        summed = million_from_cents(trib, edge) + million_from_cents(contrib, edge)
        published = million_from_cents(total, edge)
        if abs(summed - published) > SUM_TOLERANCE_MILLION:
            raise SnapshotError(f"data: totale 2022 {key} fuori tolleranza di arrotondamento")

    expected_ids = [row_id for row_id, _, _ in GAP_ROWS]
    if [row["id"] for row in rows] != expected_ids:
        raise SnapshotError("data: ordine righe divergente dal lock")
    if spec["expected"]["taxRowIds"] != expected_ids:
        raise SnapshotError("source lock: elenco taxRowIds divergente")


def metadata(spec: dict[str, Any], payload: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": data["period"],
        "observedAt": source["acquiredAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "url": source["url"],
            "filename": source["filename"],
            "versionDate": source["versionDate"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "publicationDate": source["publicationDate"],
            "acquiredAt": source["acquiredAt"],
            "checkedAt": source["checkedAt"],
            "bytes": source["bytes"],
            "sha256": source["sha256"],
            "path": source["path"],
            "geography": source["geography"],
            "updateFrequency": source["updateFrequency"],
        },
        "coverage": {
            "years": 5,
            "taxRows": len(GAP_ROWS),
            "propensioneRows": len(PROPENSIONE_ROWS),
            "tables": ["I.1", "I.2"],
        },
        "pdf": {
            "tableI1PageIndex": spec["pdf"]["tableI1PageIndex"],
            "tableI2PageIndex": spec["pdf"]["tableI2PageIndex"],
            "tableI1Title": spec["pdf"]["tableI1Title"],
            "tableI2Title": spec["pdf"]["tableI2Title"],
            "tableI1TextSha256": spec["pdf"]["tableI1TextSha256"],
            "tableI2TextSha256": spec["pdf"]["tableI2TextSha256"],
        },
        "integrity": {
            "sourceLockSha256": spec["integrity"]["lockSha256"],
            "dataSha256": sha256_bytes(payload),
            "dataBytes": len(payload),
        },
        "semantics": {
            "soldi": {
                "unit": "euro-cents",
                "sourceUnit": "million-euro",
                "nature": "stima tax gap MEF (tributario/contributivo); non accertamento né recupero",
            },
            "periodo": {
                "referencePeriod": "2018-2022",
                "semiDefinitiveYear": 2022,
            },
            "provenance": {
                "holder": source["owner"],
                "publicationDate": source["publicationDate"],
                "acquiredAt": source["acquiredAt"],
                "checkedAt": source["checkedAt"],
            },
        },
    }


def artifact_bytes(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_artifacts(spec: dict[str, Any], data: dict[str, Any], data_path: Path, meta_path: Path) -> None:
    payload = artifact_bytes(data)
    meta = metadata(spec, payload, data)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_bytes(payload)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def extract_tables(spec: dict[str, Any], pdf_payload: bytes) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], str, str]:
    page_i1 = page_text(pdf_payload, spec["pdf"]["tableI1PageIndex"])
    page_i2 = page_text(pdf_payload, spec["pdf"]["tableI2PageIndex"])
    title_i1 = spec["pdf"]["tableI1Title"]
    title_i2 = spec["pdf"]["tableI2Title"]
    text_i1 = normalize_text(page_i1)
    text_i2 = normalize_text(page_i2)
    if sha256_bytes(text_i1.encode("utf-8")) != spec["pdf"]["tableI1TextSha256"]:
        raise SnapshotError("PDF: hash testo pagina Tab. I.1 divergente")
    if sha256_bytes(text_i2.encode("utf-8")) != spec["pdf"]["tableI2TextSha256"]:
        raise SnapshotError("PDF: hash testo pagina Tab. I.2 divergente")
    gap_rows = parse_gap_table(page_i1, title_i1)
    prop_rows = parse_propensione_table(page_i2, title_i2)
    return gap_rows, prop_rows, text_i1, text_i2


def check(spec_path: Path = DEFAULT_SPEC, data_path: Path = DEFAULT_DATA, meta_path: Path = DEFAULT_META) -> None:
    spec = load_spec(spec_path)
    payload = data_path.read_bytes()
    data = json.loads(payload.decode("utf-8"))
    validate_data(data, spec)
    expected_meta = metadata(spec, payload, data)
    if json.loads(meta_path.read_text(encoding="utf-8")) != expected_meta:
        raise SnapshotError("Metadata or artifact hash drift")
    if spec.get("dataCanonicalSha256") != sha256_bytes(canonical_bytes(data)):
        raise SnapshotError("dataCanonicalSha256 drift")
    pdf_payload = verified_payload(spec)
    gap_rows, prop_rows, _, _ = extract_tables(spec, pdf_payload)
    rebuilt = build_data(gap_rows, prop_rows)
    if canonical_bytes(rebuilt) != canonical_bytes(data):
        raise SnapshotError("riproiezione dal PDF diverge dall'artifact")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input", type=Path, help="path to the official PDF (defaults to lock path)")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta)
            print("mef-tax-gap-nazionale: lock, data e meta coerenti")
            return 0
        if not args.write:
            raise SnapshotError("specificare --write oppure --check")

        draft = load_spec(args.spec)
        pdf_payload = verified_payload(draft, args.input)
        gap_rows, prop_rows, _, _ = extract_tables(draft, pdf_payload)
        data = build_data(gap_rows, prop_rows)
        validate_data(data, draft)
        draft["dataCanonicalSha256"] = sha256_bytes(canonical_bytes(data))
        draft["integrity"]["lockSha256"] = ""
        draft["integrity"]["lockSha256"] = canonical_lock_sha256(draft)
        args.spec.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_artifacts(draft, data, args.data, args.meta)
        check(args.spec, args.data, args.meta)
        print(f"mef-tax-gap-nazionale: scritto {args.data}")
        return 0
    except SnapshotError as error:
        print(f"mef-tax-gap-nazionale: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
