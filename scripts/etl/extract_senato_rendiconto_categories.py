#!/usr/bin/env python3
"""Extract Senato rendiconto chapter payments from a pinned Doc. VIII PDF.

Fail-closed: category totals must sum to Titoli I+II spese (al netto delle
partite di giro). Senatori and personale components must sum to Cap. 1.1.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PINNED = ROOT / "data/parliament/pinned/senato-rendiconto-2024.pdf"
EXPECTED_SHA256 = "de109375206e4fc931443bce671f50b2063ca6b5c5e1c9100b6b3b4450289df5"
EXPECTED_BYTES = 966927
DOCUMENT_URL = "https://www.senato.it/service/PDF/PDFServer/BGT/1487093.pdf"

CHAPTER_RE = re.compile(
    r"Totale\s+[Cc]apitolo\s+(\d+\.\d+)\s+([\d\.]+,\d{2})\s+([\d\.]+,\d{2})"
)
ARTICLE_RE = re.compile(
    r"S\.1\.1\.(\d+)\s+(.+?)\s+([\d\.]+,\d{2})\s+([\d\.]+,\d{2})",
    re.S,
)


def euro_to_million(raw: str) -> float:
    return round(float(raw.replace(".", "").replace(",", ".")) / 1_000_000, 8)


def require_pdf(path: Path) -> str:
    raw = path.read_bytes()
    if len(raw) != EXPECTED_BYTES:
        raise SystemExit(f"bytes inattesi: {len(raw)} != {EXPECTED_BYTES}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"sha256 inatteso: {digest}")
    if not raw.startswith(b"%PDF"):
        raise SystemExit("PDF Senato non valido")
    return digest


def extract_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    # Spese tables live on pages 12-18 (1-indexed).
    pages = []
    for index, page in enumerate(reader.pages):
        if 11 <= index <= 17:
            pages.append(page.extract_text() or "")
    text = "\n".join(pages)
    if "Cap. 1.1" not in text and "Emolumenti" not in text:
        raise SystemExit("sezione spese non trovata nel PDF pinnato")
    return text


def parse_chapters(text: str) -> dict[str, float]:
    chapters: dict[str, float] = {}
    for match in CHAPTER_RE.finditer(text):
        number, _forecast, spent = match.group(1), match.group(2), match.group(3)
        # Keep last occurrence: spese pages override any earlier noise.
        chapters[number] = euro_to_million(spent)
    required = {
        "1.1",
        "1.3",
        "1.19",
        "1.20",
        "2.23",
        "2.24",
        "2.25",
    }
    missing = sorted(required - set(chapters))
    if missing:
        raise SystemExit(f"capitoli mancanti: {missing}")
    return chapters


def parse_emolument_articles(text: str) -> dict[int, tuple[str, float]]:
    articles: dict[int, tuple[str, float]] = {}
    for match in ARTICLE_RE.finditer(text):
        number = int(match.group(1))
        label = re.sub(r"\s+", " ", match.group(2)).strip()
        articles[number] = (label, euro_to_million(match.group(4)))
    if set(range(1, 14)) - set(articles):
        raise SystemExit(f"articoli Cap. 1.1 incompleti: {sorted(articles)}")
    return articles


def build_statement(chapters: dict[str, float], articles: dict[int, tuple[str, float]]) -> dict:
    senatori_ids = range(1, 9)
    personale_ids = range(9, 14)
    senatori = round(sum(articles[i][1] for i in senatori_ids), 8)
    personale = round(sum(articles[i][1] for i in personale_ids), 8)
    if abs(senatori + personale - chapters["1.1"]) > 1e-8:
        raise SystemExit("Cap. 1.1 non riconciliato con Senatori+Personale")

    functioning_other = [
        "1.00",
        "1.2",
        "1.3",
        "1.4",
        "1.5",
        "1.6",
        "1.7",
        "1.8",
        "1.9",
        "1.10",
        "1.11",
        "1.12",
        "1.13",
        "1.14",
        "1.15",
        "1.16",
        "1.17",
        "1.18",
    ]
    goods = round(sum(chapters.get(item, 0.0) for item in functioning_other), 8)
    previdenza = round(chapters["1.19"] + chapters["1.20"], 8)
    investments = round(
        chapters.get("2.22", 0.0)
        + chapters.get("2.23", 0.0)
        + chapters.get("2.24", 0.0)
        + chapters.get("2.25", 0.0)
        + chapters.get("2.26", 0.0),
        8,
    )
    effective = round(senatori + personale + goods + previdenza + investments, 8)
    expected_total = 495.9277309
    if abs(effective - expected_total) > 1e-8:
        raise SystemExit(f"categorie non riconciliate: {effective} != {expected_total}")

    def components(ids: range) -> list[dict]:
        return [
            {
                "id": f"art-1-1-{number}",
                "label": articles[number][0],
                "paid": articles[number][1],
            }
            for number in ids
            if articles[number][1] > 0
        ]

    categories = [
        {
            "id": "senators",
            "label": "Senatori",
            "paid": senatori,
            "caveat": "Articoli S.1.1.1-S.1.1.8 del Cap. 1.1 (emolumenti e rimborsi ai senatori).",
            "components": components(senatori_ids),
        },
        {
            "id": "staff",
            "label": "Personale",
            "paid": personale,
            "caveat": "Articoli S.1.1.9-S.1.1.13 del Cap. 1.1 (personale di ruolo, non dipendente, consulenze e personale distaccato).",
            "components": components(personale_ids),
        },
        {
            "id": "functioning-other",
            "label": "Funzionamento e beni/servizi",
            "paid": goods,
            "caveat": "Capitoli 1.00 e 1.2-1.18 della sezione A (funzionamento), esclusi gli emolumenti del Cap. 1.1.",
        },
        {
            "id": "previdenza",
            "label": "Spese previdenziali",
            "paid": previdenza,
            "caveat": "Sezione B: Cap. 1.19 (assegni vitalizi/pensioni senatori e pensioni del personale) e Cap. 1.20 (oneri previdenziali a carico dell'Amministrazione). Il totale non equivale ai soli vitalizi.",
            "components": [
                {
                    "id": "cap-1-19",
                    "label": "Spese previdenziali (Cap. 1.19)",
                    "paid": chapters["1.19"],
                },
                {
                    "id": "cap-1-20",
                    "label": "Oneri previdenziali e assistenziali (Cap. 1.20)",
                    "paid": chapters["1.20"],
                },
            ],
        },
        {
            "id": "investments",
            "label": "Spese in conto capitale",
            "paid": investments,
            "caveat": "Titolo II: acquisti e manutenzioni straordinarie (Cap. 2.22-2.26).",
        },
    ]

    return {
        "kind": "account",
        "year": 2024,
        "title": "Rendiconto delle entrate e delle spese 2024",
        "documentUrl": DOCUMENT_URL,
        "values": {
            "effectivePayments": effective,
            "annualStateContribution": 505.3605,
            "functioningExpenditure": 257.42854029,
        },
        "categories": categories,
        "meaning": (
            "Pagamenti del rendiconto Senato 2024 sui Titoli I e II (spesa al netto delle "
            "partite di giro). La ripartizione segue i capitoli ufficiali: emolumenti ai "
            "senatori, personale, funzionamento, previdenza e conto capitale. Non va "
            "sommato a Camera o Quirinale."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=PINNED)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    require_pdf(args.pdf)
    text = extract_text(args.pdf)
    chapters = parse_chapters(text)
    articles = parse_emolument_articles(text)
    statement = build_statement(chapters, articles)
    if args.json:
        json.dump(statement, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    elif args.check:
        print(
            f"ok senato-2024 categories={len(statement['categories'])} "
            f"effectivePayments={statement['values']['effectivePayments']}"
        )
    else:
        print(json.dumps(statement, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
