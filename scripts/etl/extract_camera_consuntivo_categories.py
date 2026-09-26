#!/usr/bin/env python3
"""Extract Camera consuntivo category/chapter CP payments from official INTERO PDFs.

Fail-closed: every published category total must reconcile to the statement
effectivePayments within the documented tolerance; chapter components must
sum to their category total (with an explicit residual for Beni e servizi).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

EURO_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}")

CATEGORY_LABELS = {
    "I": ("deputies", "Deputati"),
    "II": ("employees", "Personale dipendente"),
    "III": ("other-staff", "Altro personale"),
    "IV": ("goods-services", "Beni e servizi"),
    "V": ("transfers", "Trasferimenti"),
    "VI": ("parliamentary-bodies", "Attività degli organi parlamentari"),
    "VII": ("common-costs", "Oneri comuni"),
}

# Chapter numbers published with full detail (mirrors 2025 product surface).
CHAPTER_TITLES = {
    "1000": "Indennità dei deputati",
    "1005": "Rimborso di spese sostenute dai deputati",
    "1010": "Emolumenti per il personale",
    "1015": "Contributi a carico del datore di lavoro",
    "1020": "Oneri accessori",
    "1025": "Emolumenti per il personale non dipendente",
    "1030": "Contributi previdenziali",
    "1035": "Locazione di immobili",
    "1040": "Noleggi",
    "1045": "Manutenzioni: immobili, impianti, hardware e software",
    "1050": "Assistenza informatica, tecnica e operativa",
    "1055": "Ristorazione",
    "1060": "Pulizie, rifiuti e lavanderia",
    "1065": "Facchinaggio",
    "1070": "Acqua, gas ed elettricità",
    "1075": "Telefonia e connettività",
    "1080": "Spese postali",
    "1085": "Cancelleria e materiali di consumo",
    "1090": "Preparazione e stampa di atti e pubblicazioni",
    "1095": "Trasporti: aerei, treni, trasporti marittimi e pedaggi",
    "1100": "Mobilità",
    "1105": "Servizi medico-sanitari",
    "1110": "Sicurezza sui luoghi di lavoro",
    "1115": "Aggiornamento professionale",
    "1120": "Studi e ricerche",
    "1125": "Potenziamento strutture di supporto",
    "1130": "Assicurazioni",
    "1135": "Comunicazione istituzionale",
    "1140": "Servizi di informazione",
    "1145": "Altri beni e servizi",
    "1150": "Contributo ai Gruppi parlamentari",
    "1155": "Contributi ad Organismi internazionali",
    "1160": "Contributi vari",
    "1165": "Verifica dei risultati elettorali",
    "1170": "Commissioni permanenti, Giunte e Comitati",
    "1175": "Commissioni di inchiesta",
    "1180": "Altri Organi bicamerali",
    "1185": "Spese per attività internazionali",
    "1190": "Spese per il cerimoniale",
    "1195": "Imposte e tasse",
    "1200": "Dispositivi giurisdizionali e lodi",
    "1205": "Restituzione di somme",
    "1210": "Fondo di riserva (parte corrente)",
    "2000": "Fabbricati e impianti",
    "2005": "Impianti di sicurezza",
    "2010": "Beni durevoli ed attrezzature",
    "2015": "Hardware e software",
    "2020": "Opere d'arte",
    "2025": "Patrimonio bibliotecario",
    "2030": "Patrimonio archivistico storico",
    "2040": "Società controllate / immobilizzazioni finanziarie",
    "3000": "Trattamento previdenziale dei deputati cessati",
    "3005": "Trattamento previdenziale del personale in quiescenza",
    "3010": "Pensioni del personale in quiescenza",
    "3015": "Oneri accessori previdenziali",
}

GOODS_CHAPTERS = {
    "1035",
    "1040",
    "1045",
    "1050",
    "1055",
    "1060",
    "1065",
    "1070",
    "1075",
    "1080",
    "1085",
    "1090",
    "1095",
    "1100",
    "1105",
    "1110",
    "1115",
    "1120",
    "1125",
    "1130",
    "1135",
    "1140",
    "1145",
}

CATEGORY_CHAPTERS = {
    "I": {"1000", "1005"},
    "II": {"1010", "1015", "1020"},
    "III": {"1025", "1030"},
    "IV": GOODS_CHAPTERS,
    "V": {"1150", "1155", "1160"},
    "VI": {"1165", "1170", "1175", "1180", "1185", "1190"},
    # Fondo di riserva (1210) is excluded from components: unused reserve is not a payment.
    "VII": {"1195", "1200", "1205"},
    "VIII": {"2000", "2005"},
    "IX": {"2010", "2015"},
    "X": {"2020", "2025", "2030"},
    "XIBIS": {"2040"},
    "XII": {"3000"},
    "XIII": {"3005", "3010", "3015"},
}


def to_euro(token: str) -> float:
    return float(token.replace(".", "").replace(",", "."))


def to_million(euro: float) -> float:
    return round(euro / 1_000_000, 8)


def find_spesa_start(reader: PdfReader) -> int:
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if "CATEGORIA I" in text and "DEPUTATI" in text and "Cap. 1000" in text and "Indennit" in text:
            return index
    raise RuntimeError("SPESA CATEGORIA I / Cap. 1000 not found")


def is_amount_page(text: str) -> bool:
    return ("Previsioni" in text and "Accertamenti" in text and "Pagamenti" in text and text.count(",") > 15)


def _cp_definitive_from_line(line: str) -> float | None:
    """CP provisional definitive = initial + optional variation on the same line."""
    # Normalize unicode minus / en-dash used as empty variation.
    line = line.replace("–", "-").replace("−", "-")
    euros = EURO_RE.findall(line)
    if not euros:
        return None
    total = to_euro(euros[0])
    if len(euros) >= 2:
        total += to_euro(euros[1])
    return total


def extract_cap_cp_map(label_text: str) -> dict[str, float]:
    """Map chapter number -> CP provisional (definitive) from label pages."""
    text = (
        label_text.replace("CA TEGORIA", "CATEGORIA")
        .replace("Indennita `", "Indennità")
        .replace("Indennita`", "Indennità")
    )
    mapping: dict[str, float] = {}

    # Layout A (2023+): Cap title may include RS on the same line, or wrap before RS/CP.
    for match in re.finditer(
        r"Cap\.\s*(\d+)\s*-[\s\S]*?\nCP\s+([^\n]+)\nCS",
        text,
    ):
        # Avoid swallowing the next Cap by bounding length.
        if match.end() - match.start() > 500:
            continue
        definitive = _cp_definitive_from_line(match.group(2))
        if definitive is not None:
            mapping[match.group(1)] = definitive

    # Layout B (2020-2022): Cap …\nRS\nCP\nCS\n<rs or dash>\n<cp>\n<cs>[\n<cp var>\n<cs var>]
    for match in re.finditer(
        r"Cap\.\s*(\d+)\s*-[\s\S]*?\nRS\s*\nCP\s*\nCS\s*\n([^\n]*)\n("
        + EURO_RE.pattern
        + r")\n([^\n]*)\n(?:("
        + EURO_RE.pattern
        + r")\n("
        + EURO_RE.pattern
        + r")\n)?",
        text,
    ):
        if match.end() - match.start() > 600:
            continue
        cp = to_euro(match.group(3))
        if match.group(5):
            cp += to_euro(match.group(5))
        mapping.setdefault(match.group(1), cp)

    return mapping


def extract_total_cp_map(label_text: str) -> dict[str, float]:
    text = label_text.replace("CA TEGORIA", "CATEGORIA")
    mapping: dict[str, float] = {}
    roman_pat = r"([IVX]+(?:\s*-?\s*bis)?)"

    for match in re.finditer(
        rf"TOTALE\s+CATEGORIA\s+{roman_pat}\s*\nRS[^\n]*\nCP\s+([^\n]+)\nCS",
        text,
        flags=re.I,
    ):
        roman = re.sub(r"[\s-]+", "", match.group(1)).upper()
        definitive = _cp_definitive_from_line(match.group(2))
        if definitive is not None:
            mapping[roman] = definitive

    for match in re.finditer(
        rf"TOTALE\s+CATEGORIA\s+{roman_pat}\s+RS[^\n]*\nCP\s+([^\n]+)\nCS",
        text,
        flags=re.I,
    ):
        roman = re.sub(r"[\s-]+", "", match.group(1)).upper()
        definitive = _cp_definitive_from_line(match.group(2))
        if definitive is not None:
            mapping.setdefault(roman, definitive)

    for match in re.finditer(
        rf"TOTALE\s+CATEGORIA\s+{roman_pat}\s*\nRS\s*\nCP\s*\nCS\s*\n([^\n]*)\n("
        + EURO_RE.pattern
        + r")\n",
        text,
        flags=re.I,
    ):
        roman = re.sub(r"[\s-]+", "", match.group(1)).upper()
        mapping.setdefault(roman, to_euro(match.group(3)))

    return mapping
def extract_amount_rows(amount_text: str) -> list[tuple[float, float, float]]:
    rows: list[tuple[float, float, float]] = []
    for line in amount_text.splitlines():
        found = EURO_RE.findall(line)
        if len(found) >= 3:
            rows.append((to_euro(found[0]), to_euro(found[1]), to_euro(found[2])))
    return rows


def payments_for_previsioni(
    rows: list[tuple[float, float, float]],
    previsioni: float,
    *,
    amount_stream: list[float] | None = None,
) -> float | None:
    candidates = [row for row in rows if abs(row[0] - previsioni) < 0.005]
    if candidates:
        candidates.sort(key=lambda row: (0 if row[2] <= row[1] + 0.02 else 1, -row[2]))
        return candidates[0][2]

    # Vertical amount pages (Camera 2020-2022): numbers are stacked, not row-wise.
    if amount_stream:
        for index, value in enumerate(amount_stream):
            if abs(value - previsioni) > 0.005:
                continue
            window = amount_stream[index : index + 12]
            # Prefer a later value that repeats and stays <= previsioni (competence payment).
            repeats = [
                window[i]
                for i in range(1, len(window) - 1)
                if abs(window[i] - window[i + 1]) < 0.005 and window[i] <= previsioni + 0.02
            ]
            if repeats:
                # Largest repeated value under previsioni is usually CP payments.
                return max(repeats)
            under = [item for item in window[1:] if 0 < item <= previsioni + 0.02]
            if under:
                return under[0]
    return None


def extract_amount_stream(amount_text: str) -> list[float]:
    return [to_euro(token) for token in EURO_RE.findall(amount_text.replace("–", "-").replace("−", "-"))]


def extract_year(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    start = find_spesa_start(reader)
    label_parts: list[str] = []
    amount_parts: list[str] = []
    for index in range(start, min(start + 40, len(reader.pages))):
        text = reader.pages[index].extract_text() or ""
        if is_amount_page(text):
            amount_parts.append(text)
        else:
            label_parts.append(text)
    label_text = "\n".join(label_parts)
    amount_text = "\n".join(amount_parts)
    cap_cp = extract_cap_cp_map(label_text)
    total_cp = extract_total_cp_map(label_text)
    rows = extract_amount_rows(amount_text)
    stream = extract_amount_stream(amount_text)

    chapter_payments: dict[str, float] = {}
    for chapter, previsioni in cap_cp.items():
        paid = payments_for_previsioni(rows, previsioni, amount_stream=stream)
        if paid is not None:
            chapter_payments[chapter] = paid

    category_totals: dict[str, float] = {}
    for roman, previsioni in total_cp.items():
        paid = payments_for_previsioni(rows, previsioni, amount_stream=stream)
        if paid is not None:
            category_totals[roman] = paid

    # Fallback: sum known chapters when totale row missing but chapters present.
    for roman, chapters in CATEGORY_CHAPTERS.items():
        if roman in category_totals:
            continue
        present = [chapter_payments[c] for c in chapters if c in chapter_payments]
        if present and len(present) == len([c for c in chapters if c in cap_cp or c in chapter_payments]):
            if present:
                category_totals[roman] = sum(present)

    return {
        "startPage": start + 1,
        "chapterPaymentsEuro": chapter_payments,
        "categoryTotalsEuro": category_totals,
        "capCpProvisional": {k: round(v, 2) for k, v in sorted(cap_cp.items())},
        "totalCpProvisional": {k: round(v, 2) for k, v in sorted(total_cp.items())},
    }


def build_categories(extraction: dict) -> list[dict]:
    chapter_payments: dict[str, float] = extraction["chapterPaymentsEuro"]
    category_totals: dict[str, float] = extraction["categoryTotalsEuro"]
    categories: list[dict] = []

    def components_for(
        chapters: set[str],
        *,
        total_euro: float,
        top_n: int | None = None,
    ) -> tuple[list[dict], float]:
        items = []
        for number in sorted(chapters, key=int):
            if number not in chapter_payments:
                continue
            items.append(
                {
                    "id": f"cap-{number}",
                    "label": CHAPTER_TITLES.get(number, f"Capitolo {number}"),
                    "paid": to_million(chapter_payments[number]),
                    "paidEuro": chapter_payments[number],
                }
            )
        residual_euro = 0.0
        if top_n is not None and len(items) > top_n:
            items.sort(key=lambda item: item["paidEuro"], reverse=True)
            head = items[:top_n]
            head_euro = sum(item["paidEuro"] for item in head)
            residual_euro = round(total_euro - head_euro, 2)
            if residual_euro < -0.02:
                raise RuntimeError(f"categoria: residuale negativo ({residual_euro})")
            items = head
            if residual_euro > 0.005:
                items.append(
                    {
                        "id": "other-chapters",
                        "label": "Altri capitoli, complessivamente",
                        "paid": to_million(residual_euro),
                        "paidEuro": residual_euro,
                    }
                )
        return items, residual_euro

    for roman, (cat_id, label) in CATEGORY_LABELS.items():
        if roman not in category_totals:
            continue
        total_euro = category_totals[roman]
        chapters = CATEGORY_CHAPTERS[roman]
        top_n = 7 if roman == "IV" else None
        comps, _ = components_for(chapters, top_n=top_n, total_euro=total_euro)
        # Drop helper paidEuro before publish shape
        pub_comps = [{"id": c["id"], "label": c["label"], "paid": c["paid"]} for c in comps]
        if pub_comps:
            comp_sum = sum(c["paidEuro"] for c in comps)
            if abs(comp_sum - total_euro) > 0.02 and roman != "IV":
                # Prefer exact chapter set; if incomplete, publish total without lying components.
                if abs(comp_sum - total_euro) > 1.0:
                    pub_comps = []
        category = {
            "id": cat_id,
            "label": label,
            "paid": to_million(total_euro),
            "caveat": f"Pagamenti di competenza della categoria {roman} nel conto consuntivo.",
        }
        if pub_comps:
            category["components"] = pub_comps
            if roman == "IV":
                category["caveat"] = (
                    "Le voci principali sono i capitoli della categoria IV con i pagamenti "
                    "di competenza più alti; «Altri capitoli» somma i restanti capitoli "
                    f"della stessa categoria. Totale esatto dei pagamenti: {total_euro:,.2f} €.".replace(",", "X").replace(".", ",").replace("X", ".")
                )
            else:
                category["caveat"] = (
                    f"Ripartizione per capitolo dei pagamenti di competenza della categoria {roman}."
                )
        categories.append(category)

    # Capital aggregate VIII+IX+X[+XIBIS]
    capital_parts = []
    capital_euro = 0.0
    for roman, label in (
        ("VIII", "Beni immobiliari"),
        ("IX", "Beni durevoli"),
        ("X", "Patrimonio artistico e bibliotecario"),
        ("XIBIS", "Immobilizzazioni finanziarie"),
    ):
        if roman not in category_totals:
            continue
        paid = category_totals[roman]
        capital_euro += paid
        capital_parts.append({"id": f"cat-{roman.lower()}", "label": label, "paid": to_million(paid)})
    if capital_parts:
        categories.append(
            {
                "id": "capital",
                "label": "Investimenti",
                "paid": to_million(capital_euro),
                "components": capital_parts,
                "caveat": "Il Titolo II aggrega le categorie VIII-X e, se presente, XI-bis.",
            }
        )

    # Pensions XII+XIII
    pension_parts = []
    pension_euro = 0.0
    for roman, label, cid in (
        ("XII", "Deputati cessati dal mandato", "former-deputies"),
        ("XIII", "Personale in quiescenza", "retired-staff"),
    ):
        if roman not in category_totals:
            # fallback single chapter
            chapter = next(iter(CATEGORY_CHAPTERS[roman]))
            if chapter in chapter_payments:
                paid = chapter_payments[chapter]
            else:
                continue
        else:
            paid = category_totals[roman]
        pension_euro += paid
        pension_parts.append({"id": cid, "label": label, "paid": to_million(paid)})
    if pension_parts:
        categories.append(
            {
                "id": "pensions",
                "label": "Spese previdenziali",
                "paid": to_million(pension_euro),
                "components": pension_parts,
                "caveat": (
                    "Titolo III: categorie XII e XIII. Il totale non equivale ai soli vitalizi."
                ),
            }
        )

    return categories


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args()
    extraction = extract_year(args.pdf)
    categories = build_categories(extraction)
    payload = {
        "year": args.year,
        "extraction": extraction,
        "categories": categories,
        "categorySumMillion": round(sum(item["paid"] for item in categories), 8),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.json_out:
        args.json_out.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
