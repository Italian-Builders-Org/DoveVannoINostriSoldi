#!/usr/bin/env python3
"""Build a typed snapshot from RGS «Bilancio in Breve» XLSX editions.

Source: machine-readable Tavole e grafici published by Ragioneria Generale
dello Stato. Values are previsione di bilancio (competenza/cassa), never
payments. Amounts stay in whole euro as published in the XLSX cells.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    import openpyxl
except ImportError as error:  # pragma: no cover
    raise SystemExit("openpyxl required: python3 -m pip install openpyxl") from error

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CACHE = ROOT / ".cache" / "manovra-rgs"
DEFAULT_OUT = ROOT / "src" / "data" / "generated" / "rgs-bilancio-in-breve.json"
ARCHIVE_URL = (
    "https://www.rgs.mef.gov.it/VERSIONE-I/archivio/index.html"
    "?tipologia=Pubblicazioni&ambito=Attivit%C3%A0+istituzionali"
    "&argomento=Bilancio+di+previsione&titolo=Bilancio+in+Breve&nCircolare=&cerca="
)
UA = "DVNS-bilancio-in-breve/1.0"

# Editions with comparable XLSX tavole (first-year LB is the enacted manovra year).
EDITIONS = (
    {
        "id": "lb-2023-2025",
        "label": "Legge di bilancio 2023-2025",
        "firstYear": 2023,
        "years": [2023, 2024, 2025],
        "xlsxRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2023/"
            "La-legge-di-bilancio-2023-2025-in-breve_tavole-e-grafici.xlsx"
        ),
        "pdfRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2023/LLDBIB-2023-2025.pdf"
        ),
        "landing": (
            "https://www.rgs.mef.gov.it/VERSIONE-I/attivita_istituzionali/"
            "formazione_e_gestione_del_bilancio/bilancio_di_previsione/bilancio_in_breve/2023/"
        ),
    },
    {
        "id": "lb-2024-2026",
        "label": "Bilancio dello Stato 2024-2026",
        "firstYear": 2024,
        "years": [2024, 2025, 2026],
        "xlsxRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2024/"
            "Tavole-e-grafici_bilancio-dello-Stato-in-breve_2024_2026.xlsx"
        ),
        "pdfRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2024/"
            "Il-bilancio-dello-Stato-2024-2026-in-breve.pdf"
        ),
        "landing": (
            "https://www.rgs.mef.gov.it/VERSIONE-I/attivita_istituzionali/"
            "formazione_e_gestione_del_bilancio/bilancio_di_previsione/bilancio_in_breve/2024/"
        ),
    },
    {
        "id": "lb-2025-2027",
        "label": "Bilancio dello Stato 2025-2027",
        "firstYear": 2025,
        "years": [2025, 2026, 2027],
        "xlsxRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2025/"
            "Tavole-e-grafici_bilancio-dello-Stato-in-breve_2025_2027.xlsx"
        ),
        "pdfRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2025/"
            "Il-bilancio-dello-Stato-2025-2027-in-breve.pdf"
        ),
        "landing": (
            "https://www.rgs.mef.gov.it/VERSIONE-I/attivita_istituzionali/"
            "formazione_e_gestione_del_bilancio/bilancio_di_previsione/bilancio_in_breve/2025/"
        ),
    },
    {
        "id": "lb-2026-2028",
        "label": "Bilancio dello Stato 2026-2028",
        "firstYear": 2026,
        "years": [2026, 2027, 2028],
        "xlsxRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2026/"
            "Tavole_NB_2026_2028-per-pubblicazione.xlsx"
        ),
        "pdfRel": (
            "/_Documenti/VERSIONE-I/attivita_istituzionali/formazione_e_gestione_del_bilancio/"
            "bilancio_di_previsione/bilancio_in_breve/2026/"
            "Il-bilancio-dello-Stato-2026-2028-in-breve.pdf"
        ),
        "landing": (
            "https://www.rgs.mef.gov.it/VERSIONE-I/attivita_istituzionali/"
            "formazione_e_gestione_del_bilancio/bilancio_di_previsione/bilancio_in_breve/2026/"
        ),
    },
)

SUMMARY_LABELS = {
    "Entrate tributarie": "entrateTributarie",
    "Entrate extra-tributarie": "entrateExtraTributarie",
    "Alienaz. ed ammort.  beni patrim. e riscos. crediti": "alienazioniAmmortamenti",
    "Alienaz. ed ammort. beni patrim. e riscos. crediti": "alienazioniAmmortamenti",
    "Entrate finali": "entrateFinali",
    "Spese correnti": "speseCorrenti",
    "di cui interessi": "interessi",
    "Spese in c/capitale": "speseContoCapitale",
    "Spese finali": "speseFinali",
    "Rimborso passività finanziarie": "rimborsoPassivita",
    "Risparmio pubblico": "risparmioPubblico",
    "Saldo netto da finanziare": "saldoNettoDaFinanziare",
    "Ricorso al mercato": "ricorsoAlMercato",
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def ensure_file(cache: Path, rel: str) -> tuple[Path, dict]:
    url = "https://www.rgs.mef.gov.it" + rel
    name = Path(rel).name
    path = cache / name
    if not path.is_file():
        path.write_bytes(fetch(url))
    raw = path.read_bytes()
    return path, {
        "url": url,
        "fileName": name,
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def sheet_by_aliases(wb, aliases: tuple[str, ...]):
    normalized = {
        re.sub(r"\s+", "", sn.lower().replace(".", "")): sn for sn in wb.sheetnames
    }
    for alias in aliases:
        key = re.sub(r"\s+", "", alias.lower().replace(".", ""))
        if key in normalized:
            return wb[normalized[key]]
        for cand, sn in normalized.items():
            if key in cand or cand in key:
                return wb[sn]
    raise KeyError(f"Sheet not found for {aliases}; have {wb.sheetnames}")


def cell_text(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def as_number(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "").replace(",", ".")
    if not text or text == "-":
        return None
    if not re.fullmatch(r"[+-]?\d+(\.\d+)?([eE][+-]?\d+)?", text):
        return None
    return float(text)


def euro_int(value) -> int | None:
    number = as_number(value)
    if number is None:
        return None
    return int(round(number))


def read_matrix(ws) -> list[list]:
    rows = []
    for row in ws.iter_rows(values_only=True):
        rows.append(list(row))
    return rows


def find_label_row(rows: list[list], label: str) -> list | None:
    target = re.sub(r"\s+", " ", label).strip().lower()
    exact = None
    fuzzy = None
    for row in rows:
        for cell in row[:3]:
            text = cell_text(cell).lower()
            if not text:
                continue
            if text == target:
                exact = row
                break
            if target in text or text in target:
                fuzzy = fuzzy or row
        if exact is not None:
            return exact
    return fuzzy


def parse_summary(ws, edition_years: list[int]) -> dict:
    """Extract LB first-year CP/CS from Quadro generale riassuntivo."""
    rows = read_matrix(ws)
    # Find header row with CP CS under LB columns. Pattern: previous LB, Assestato, current LB.
    # First-year CP/CS are the first pair under the current LB block.
    # Empirically columns: after label col, [prevCP, prevCS, assCP, assCS, y1CP, y1CS, y2CP, y2CS, ...]
    # Locate a known label to discover column offsets.
    sample = find_label_row(rows, "Entrate finali")
    if not sample:
        raise ValueError("Missing Entrate finali in Tav. 2.1")
    # Collect numeric cells after label
    # pairs: prev LB, assestato, year1, year2, ... — absolute column indices.
    label_idx = 0
    for idx, value in enumerate(sample[:3]):
        if cell_text(value):
            label_idx = idx
            break
    absolute = []
    for col, value in enumerate(sample):
        if col <= label_idx:
            continue
        if as_number(value) is not None:
            absolute.append(col)
    if len(absolute) < 6:
        raise ValueError("Unexpected Tav. 2.1 layout for Entrate finali")
    year_cols = {}
    for index, year in enumerate(edition_years):
        start = 4 + index * 2  # index into absolute list
        if start + 1 >= len(absolute):
            break
        year_cols[year] = (absolute[start], absolute[start + 1])

    metrics = {}
    for source_label, key in SUMMARY_LABELS.items():
        row = find_label_row(rows, source_label)
        if not row:
            continue
        series = {}
        for year, (cp_col, cs_col) in year_cols.items():
            series[str(year)] = {
                "competenzaEur": euro_int(row[cp_col] if cp_col < len(row) else None),
                "cassaEur": euro_int(row[cs_col] if cs_col < len(row) else None),
            }
        metrics[key] = {"label": source_label, "byYear": series}

    if "entrateFinali" not in metrics or "speseFinali" not in metrics:
        raise ValueError("Required summary metrics missing")
    return metrics


def parse_manovra_share(ws) -> list[dict]:
    rows = read_matrix(ws)
    year_row = None
    header_row = None
    for index, row in enumerate(rows):
        year_hits = [
            (col, int(number))
            for col, value in enumerate(row)
            for number in [as_number(value)]
            if number is not None and 2000 <= number <= 2100
        ]
        if len(year_hits) >= 2:
            year_row = (index, year_hits)
        # Column headers are short cells, not the long Tav. title.
        short = [cell_text(value).lower() for value in row if cell_text(value)]
        if (
            any(text == "manovra" or text.startswith("manovra") for text in short)
            and any("legislazione" in text for text in short)
            and max((len(text) for text in short), default=0) < 40
        ):
            header_row = index
    if not year_row or header_row is None:
        return []
    year_blocks = [(year, col) for col, year in year_row[1]]
    aggregates = []
    for row in rows[header_row + 1 :]:
        label = cell_text(row[1] if len(row) > 1 and row[1] is not None else (row[2] if len(row) > 2 else None))
        if not label or label.lower().startswith("tav") or label.lower().startswith("("):
            continue
        entry = {"aggregate": label, "byYear": {}}
        for year, start in year_blocks:
            legislazione = as_number(row[start] if start < len(row) else None)
            manovra = as_number(row[start + 1] if start + 1 < len(row) else None)
            totale = as_number(row[start + 2] if start + 2 < len(row) else None)
            if legislazione is None and manovra is None:
                continue
            entry["byYear"][str(year)] = {
                "legislazioneVigentePct": legislazione,
                "manovraPct": manovra,
                "totalePct": totale,
            }
        if entry["byYear"]:
            aggregates.append(entry)
    return aggregates


def programmatic_key(label: str) -> str | None:
    text = re.sub(r"\s+", " ", label).strip().lower()
    if "indebitamento netto" in text and "pil" in text:
        return "indebitamentoNettoPilPct"
    if "saldo primario" in text and "pil" in text:
        return "saldoPrimarioPilPct"
    if "debito pubblico" in text and "pil" in text:
        return "debitoPubblicoPilPct"
    if "crescita della spesa netta" in text:
        return "crescitaSpesaNettaPct"
    return None


def parse_programmatic(ws) -> dict:
    rows = read_matrix(ws)
    # Find year headers
    year_cols = {}
    for row in rows[:8]:
        for col, value in enumerate(row):
            number = as_number(value)
            if number and 2000 <= number <= 2100:
                year_cols[int(number)] = col
    if len(year_cols) < 2:
        return {"available": False, "note": "Questa edizione non espone il quadro programmatico confrontabile in Tav. 1.", "series": {}}
    series = {}
    for row in rows:
        label = cell_text(row[1] if len(row) > 1 else None) or cell_text(row[0])
        key = programmatic_key(label)
        if not key:
            continue
        points = {}
        for year, col in year_cols.items():
            points[str(year)] = as_number(row[col] if col < len(row) else None)
        series[key] = {"label": label, "byYear": points}
    return {"available": bool(series), "series": series}


def parse_detail_series(ws, edition_years: list[int], unit: str) -> list[dict]:
    """Parse annex tables like Tav. A.1 / A.2 (LB block, euro or millions)."""
    rows = read_matrix(ws)
    year_row_idx = None
    year_hits: list[tuple[int, int]] = []
    for index, row in enumerate(rows[:12]):
        hits = [
            (col, int(number))
            for col, value in enumerate(row)
            for number in [as_number(value)]
            if number is not None and 2000 <= number <= 2100
        ]
        if len(hits) >= 2:
            year_row_idx = index
            year_hits = hits
    if year_row_idx is None:
        return []
    # Prefer the current LB year block: last contiguous run matching edition_years.
    wanted = set(edition_years)
    matched = [(col, year) for col, year in year_hits if year in wanted]
    if len(matched) < len(edition_years):
        matched = year_hits[: len(edition_years)]
    # Each year has CP/CS pair under the year header in modern sheets.
    year_cols: dict[int, tuple[int, int]] = {}
    for col, year in matched:
        year_cols[year] = (col, col + 1)

    entries: list[dict] = []
    for row in rows[year_row_idx + 2 :]:
        label = cell_text(row[0] if row else None) or cell_text(row[1] if len(row) > 1 else None)
        if not label or label.lower().startswith("tav"):
            continue
        if label.lower() in {"cp", "cs"}:
            continue
        by_year = {}
        for year, (cp_col, cs_col) in year_cols.items():
            cp = as_number(row[cp_col] if cp_col < len(row) else None)
            cs = as_number(row[cs_col] if cs_col < len(row) else None)
            if cp is None and cs is None:
                continue
            if unit == "EUR":
                by_year[str(year)] = {
                    "competenzaEur": euro_int(cp),
                    "cassaEur": euro_int(cs),
                }
            else:
                by_year[str(year)] = {
                    "competenzaMillionEur": cp,
                    "cassaMillionEur": cs,
                }
        if by_year:
            entries.append({"label": label, "byYear": by_year})
    return entries


def parse_mission_history(ws) -> dict:
    """Parse Tav. A.3 mission history (values published in milioni di euro)."""
    rows = read_matrix(ws)
    year_row = None
    header_idx = 0
    for index, row in enumerate(rows[:8]):
        hits = [
            (col, int(number))
            for col, value in enumerate(row)
            for number in [as_number(value)]
            if number is not None and 2000 <= number <= 2100
        ]
        if len(hits) >= 2:
            year_row = hits
            header_idx = index
            break
    if not year_row:
        return {"available": False, "unit": "millionEUR", "years": [], "missions": []}
    # Columns alternate amount/% for some layouts; keep only year columns with numeric mission values.
    year_cols = [(col, year) for col, year in year_row]
    missions = []
    for row in rows[header_idx + 2 :]:
        label = ""
        for cell in row[:3]:
            text = cell_text(cell)
            if text and not re.fullmatch(r"[+-]?\d+([.,]\d+)?", text):
                label = text
                break
        if not label:
            continue
        by_year = {}
        for col, year in year_cols:
            amount = as_number(row[col] if col < len(row) else None)
            if amount is None:
                continue
            by_year[str(year)] = amount
        if label.lower().startswith("totale"):
            continue
        if by_year:
            missions.append({"mission": label, "byYearMillionEur": by_year})
    years = sorted({year for _, year in year_cols})
    return {
        "available": bool(missions),
        "unit": "millionEUR",
        "years": years,
        "missions": missions,
        "note": (
            "Valori di Tav. A.3 in milioni di euro come pubblicati da RGS (competenza). "
            "Esclusa la riga totale. «Tutela della salute» nel bilancio dello Stato è "
            "limitata: la sanità territoriale passa soprattutto dai trasferimenti alle autonomie."
        ),
    }


def enrich_manovra_share_with_euro(manovra_share: list[dict], summary: dict) -> list[dict]:
    """Attach euro amounts implied by Tav. 2.2 percentages of spese finali."""
    spese = summary.get("speseFinali", {}).get("byYear", {})
    enriched = []
    for row in manovra_share:
        by_year = {}
        for year, point in row.get("byYear", {}).items():
            total = (spese.get(year) or {}).get("competenzaEur")
            manovra_pct = point.get("manovraPct")
            totale_pct = point.get("totalePct")
            legislazione_pct = point.get("legislazioneVigentePct")
            entry = dict(point)
            if isinstance(total, int) and total != 0:
                if manovra_pct is not None:
                    entry["manovraEur"] = int(round(total * float(manovra_pct) / 100.0))
                if totale_pct is not None:
                    entry["stanziamentoEur"] = int(round(total * float(totale_pct) / 100.0))
                if legislazione_pct is not None:
                    entry["legislazioneVigenteEur"] = int(
                        round(total * float(legislazione_pct) / 100.0)
                    )
            by_year[year] = entry
        enriched.append({**row, "byYear": by_year})
    return enriched


def build_edition(cache: Path, meta: dict, acquired_at: str) -> dict:
    xlsx_path, xlsx_receipt = ensure_file(cache, meta["xlsxRel"])
    _, pdf_receipt = ensure_file(cache, meta["pdfRel"])
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    try:
        summary_ws = sheet_by_aliases(wb, ("Tav. 2.1", "T 2.1", "Tav 2.1"))
        manovra_ws = sheet_by_aliases(wb, ("Tav. 2.2", "T2.2", "Tav 2.2"))
        try:
            prog_ws = sheet_by_aliases(wb, ("Tav. 1", "T1", "Tav 1"))
            programmatic = parse_programmatic(prog_ws)
        except KeyError:
            programmatic = {"available": False, "series": {}, "note": "Tav. 1 assente"}
        summary = parse_summary(summary_ws, meta["years"])
        manovra_share = enrich_manovra_share_with_euro(
            parse_manovra_share(manovra_ws), summary
        )
        try:
            revenue_detail = parse_detail_series(
                sheet_by_aliases(wb, ("Tav. A.1", "Tav A.1", "TA.1")),
                meta["years"],
                "EUR",
            )
        except KeyError:
            revenue_detail = []
        try:
            spend_detail = parse_detail_series(
                sheet_by_aliases(wb, ("Tav. A.2", "Tav A.2", "TA.2")),
                meta["years"],
                "EUR",
            )
        except KeyError:
            spend_detail = []
        try:
            mission_history = parse_mission_history(
                sheet_by_aliases(wb, ("Tav. A.3", "Tav A.3", "TA.3")),
            )
        except KeyError:
            mission_history = {
                "available": False,
                "unit": "millionEUR",
                "years": [],
                "missions": [],
                "note": "Tav. A.3 assente in questa edizione",
            }
    finally:
        wb.close()

    first = str(meta["firstYear"])
    first_cp = summary["entrateFinali"]["byYear"][first]["competenzaEur"]
    first_spese = summary["speseFinali"]["byYear"][first]["competenzaEur"]
    first_saldo = summary["saldoNettoDaFinanziare"]["byYear"][first]["competenzaEur"]
    first_ricorso = summary["ricorsoAlMercato"]["byYear"][first]["competenzaEur"]

    return {
        "id": meta["id"],
        "label": meta["label"],
        "firstYear": meta["firstYear"],
        "years": meta["years"],
        "nature": "previsione-legge-di-bilancio",
        "unit": "EUR",
        "landingUrl": meta["landing"],
        "xlsx": xlsx_receipt,
        "pdf": pdf_receipt,
        "acquiredAt": acquired_at,
        "headline": {
            "entrateFinaliCompetenzaEur": first_cp,
            "speseFinaliCompetenzaEur": first_spese,
            "saldoNettoDaFinanziareCompetenzaEur": first_saldo,
            "ricorsoAlMercatoCompetenzaEur": first_ricorso,
        },
        "summary": summary,
        "manovraShareOfAppropriationsPct": manovra_share,
        "programmatic": programmatic,
        "revenueDetail": revenue_detail,
        "spendDetail": spend_detail,
        "missionHistory": mission_history,
        "caveats": [
            "Importi di previsione dal Quadro generale riassuntivo (competenza e cassa).",
            "Non confrontare questi stanziamenti con pagamenti SIOPE/OpenBDAP.",
            "I totali possono non coincidere con la somma dei componenti per arrotondamenti della fonte.",
            "Le edizioni RGS 2001–2022 restano in archivio soprattutto come PDF: le tavole XLSX confrontabili del Quadro 2.1 partono dal 2023. La Tav. A.3, quando presente, riporta anche missioni storiche (milioni di euro).",
            "Gli euro della Tav. 2.2 (effetto manovra) sono ricavati applicando le % pubblicate alle spese finali di competenza dello stesso anno; non sono una tavola distinta RGS.",
        ],
    }


def compare_first_years(editions: list[dict]) -> list[dict]:
    ordered = sorted(editions, key=lambda item: item["firstYear"])
    rows = []
    for previous, current in zip(ordered, ordered[1:]):
        prev_h = previous["headline"]
        curr_h = current["headline"]
        def delta(key: str) -> dict:
            before = prev_h[key]
            after = curr_h[key]
            return {
                "fromEur": before,
                "toEur": after,
                "deltaEur": after - before,
                "deltaPct": None if before == 0 else (after - before) / abs(before) * 100,
            }
        rows.append(
            {
                "fromEditionId": previous["id"],
                "toEditionId": current["id"],
                "fromYear": previous["firstYear"],
                "toYear": current["firstYear"],
                "entrateFinali": delta("entrateFinaliCompetenzaEur"),
                "speseFinali": delta("speseFinaliCompetenzaEur"),
                "saldoNettoDaFinanziare": delta("saldoNettoDaFinanziareCompetenzaEur"),
                "ricorsoAlMercato": delta("ricorsoAlMercatoCompetenzaEur"),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    acquired_at = datetime.now(timezone.utc).isoformat()
    editions = [build_edition(args.cache, meta, acquired_at) for meta in EDITIONS]
    latest = max(editions, key=lambda item: item["firstYear"])
    payload = {
        "schemaVersion": 1,
        "title": "Manovre di bilancio a confronto (Bilancio in Breve RGS)",
        "holder": "Ragioneria Generale dello Stato — Ministero dell'Economia e delle Finanze",
        "archiveUrl": ARCHIVE_URL,
        "moneyNature": "stanziamento-previsione",
        "unit": "EUR",
        "referenceNote": (
            "Ogni edizione pubblica un triennio. Il confronto principale tra manovre usa "
            "l'anno 1 (prima annualità della legge di bilancio pubblicata). Nell'edizione "
            "2026-2028 i valori 2027 e 2028 sono la seconda e terza annualità dello stesso "
            "atto, già nelle tavole XLSX. Il Disegno di legge di bilancio 2027-2029 è online "
            "su «Bilancio finanziario» RGS, ma il «Bilancio in Breve» 2027-2029 con XLSX "
            "confrontabile non risulta ancora pubblicato: non inventiamo valori da soli PDF. "
            "Le pagine RGS 2018–2022 espongono solo PDF; le tavole XLSX machine-readable "
            "del Quadro generale (Tav. 2.1/2.2) partono dal 2023."
        ),
        "coverage": {
            "comparableXlsxFirstYears": [edition["firstYear"] for edition in editions],
            "pdfOnlyLandingYears": [2018, 2019, 2020, 2021, 2022],
            "pendingBilancioInBreveFirstYears": [2027],
            "archiveCatalogUrl": ARCHIVE_URL,
            "note": (
                "Verificato sulle landing ufficiali RGS: 2018–2022 hanno PDF «Bilancio in Breve»; "
                "XLSX confrontabili Tavole e grafici risultano pubblicati dal 2023 al 2026. "
                "Il DLB 2027-2029 è già sul Bilancio finanziario; manca ancora il Bilancio in Breve "
                "2027-2029 con tavole XLSX. Fino ad allora il 2027 si legge come anno 2 della LB 2026-2028."
            ),
        },
        "acquiredAt": acquired_at,
        "checkedAt": acquired_at,
        "latestEditionId": latest["id"],
        "editions": editions,
        "firstYearComparisons": compare_first_years(editions),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.output} editions={len(editions)} latest={latest['id']}")


if __name__ == "__main__":
    main()
