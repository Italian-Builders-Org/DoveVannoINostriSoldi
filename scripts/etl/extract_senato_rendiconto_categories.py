#!/usr/bin/env python3
"""Extract Senato rendiconto chapter payments from pinned Doc. VIII PDFs.

Fail-closed: published categories must reconcile to Titoli I+II payments
(al netto delle partite di giro). Year-specific layouts are supported explicitly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

YEARS = {
    2024: {
        "pdf": ROOT / "data/parliament/pinned/senato-rendiconto-2024.pdf",
        "sha256": "de109375206e4fc931443bce671f50b2063ca6b5c5e1c9100b6b3b4450289df5",
        "bytes": 966927,
        "url": "https://www.senato.it/service/PDF/PDFServer/BGT/1487093.pdf",
        "layout": "s-prefix",
        "titoli_i_ii": 495.9277309,
        "contribution": 505.3605,
        "pages": (12, 18),
    },
    2023: {
        "pdf": ROOT / "data/parliament/pinned/senato-rendiconto-2023.pdf",
        "sha256": "95fc92c39c59a3ae6cb35c14bd96a8bfe11dfa0dbde435177508a50941aaee43",
        "bytes": 465155,
        "url": "https://www.senato.it/service/PDF/PDFServer/BGT/1435880.pdf",
        "layout": "five-column",
        "titoli_i_ii": 488.27606969,
        "contribution": 505.3605,
        "pages": (15, 27),
    },
    2022: {
        "pdf": ROOT / "data/parliament/pinned/senato-rendiconto-2022.pdf",
        "sha256": "6c75c285a98edc415cf60cbec3ab41a8b8c907ff2d104af67c5fa710df73c60f",
        "bytes": 1719929,
        "url": "https://www.senato.it/service/PDF/PDFServer/BGT/1391468.pdf",
        "layout": "2022-split",
        "titoli_i_ii": 487.70931283,
        "contribution": 505.3605,
        "pages": (15, 28),
    },
}

EURO_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
CHAPTER_TOTAL_RE = re.compile(
    r"Totale\s+[Cc]apitolo\s+(\d+\.\d+)\s*[\s\S]{0,120}?",
    re.I,
)
ARTICLE_S_RE = re.compile(
    r"S\.1\.1\.(\d+)\s+(.+?)\s+([\d\.]+,\d{2})\s+([\d\.]+,\d{2})",
    re.S,
)
ARTICLE_PLAIN_RE = re.compile(
    r"(1\.1\.(\d+))\s+(.+?)\s+[e»s]\s*((?:"
    + EURO_RE.pattern
    + r"\s+){4}"
    + EURO_RE.pattern
    + r")",
    re.S | re.I,
)


def euro_to_million(raw: str) -> float:
    return round(float(raw.replace(".", "").replace(",", ".")) / 1_000_000, 8)


def require_pdf(spec: dict) -> None:
    path: Path = spec["pdf"]
    raw = path.read_bytes()
    if len(raw) != spec["bytes"]:
        raise SystemExit(f"{path.name}: bytes {len(raw)} != {spec['bytes']}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != spec["sha256"]:
        raise SystemExit(f"{path.name}: sha256 {digest}")
    if not raw.startswith(b"%PDF"):
        raise SystemExit(f"{path.name}: PDF non valido")


def extract_text(path: Path, pages: tuple[int, int]) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    start, end = pages
    chunks = []
    for index in range(start - 1, min(end, len(reader.pages))):
        chunks.append(reader.pages[index].extract_text() or "")
    text = "\n".join(chunks)
    if "Cap. 1.1" not in text and "Cap. 1.1" not in text.replace("–", "-"):
        raise SystemExit("sezione spese non trovata nel PDF pinnato")
    return text


def spent_from_total_line(blob: str) -> float | None:
    # Repair lone OCR fragment "00,0" without breaking real amounts like 2.200.000,00.
    cleaned = re.sub(r"(?<![\d.])00,0(?!\d)", "0,00", blob)
    nums = EURO_RE.findall(cleaned)
    if len(nums) >= 5:
        return euro_to_million(nums[3])
    if len(nums) == 2:
        return euro_to_million(nums[1])
    if len(nums) == 4:
        # initial, definitive, spent, economy (riserva OCR assente)
        return euro_to_million(nums[2])
    return None


def parse_chapters_two_column(text: str) -> dict[str, float]:
    """2024 layout: Totale Capitolo N forecast spent on one line."""
    chapters: dict[str, float] = {}
    for match in re.finditer(
        r"Totale\s+[Cc]apitolo\s+(\d+\.\d+)\s+(" + EURO_RE.pattern + r")\s+(" + EURO_RE.pattern + r")",
        text,
    ):
        chapters[match.group(1)] = euro_to_million(match.group(3))
    return chapters


def parse_chapters_five_column(text: str) -> dict[str, float]:
    """2022-2023 layout: initial, definitive, reserve, spent, economy (may wrap)."""
    chapters: dict[str, float] = {}
    for match in CHAPTER_TOTAL_RE.finditer(text):
        number = match.group(1)
        window = text[match.start() : match.start() + 280]
        paid = spent_from_total_line(window)
        if paid is None:
            continue
        chapters[number] = paid
    if "1.0" in chapters and "1.00" not in chapters:
        chapters["1.00"] = chapters["1.0"]
    return chapters


def sum_chapter_articles(text: str, number: str) -> float | None:
    """Sum article spent amounts when Totale Capitolo is lost across a page break."""
    escaped = re.escape(number)
    block = re.search(
        rf"Cap\.\s*{escaped}\b(.*?)(?=Cap\.\s*\d+\.\d+\b|TOTALE SEZIONE)",
        text,
        re.S | re.I,
    )
    if not block:
        return None
    blob = block.group(1)
    article_re = re.compile(
        rf"{escaped}\.(\d+)\s+[\s\S]*?((?:" + EURO_RE.pattern + r"\s+){4}" + EURO_RE.pattern + r")",
        re.I,
    )
    paid_total = 0.0
    found = 0
    for match in article_re.finditer(blob):
        nums = EURO_RE.findall(match.group(2))
        paid_total += euro_to_million(nums[3])
        found += 1
    if found == 0:
        return None
    return round(paid_total, 8)


def chapter_from_riepilogo(text: str, number: str) -> float | None:
    """Read Cap. N from the SPESE – RIEPILOGO PER TITOLI E CAPITOLI table."""
    marker = re.search(r"RIEPILOGO\s+PER\s+TITOLI\s+E\s+CAPITOLI", text, re.I)
    if not marker:
        return None
    section = text[marker.start() :]
    escaped = re.escape(number)
    amount_run = rf"((?:{EURO_RE.pattern}\s+){{4}}{EURO_RE.pattern})"
    match = re.search(
        rf"Cap\.\s*{escaped}\s+-[^\n]*?»\s*{amount_run}",
        section,
        re.I,
    )
    if not match:
        # Label may wrap onto the next line before the amounts.
        match = re.search(
            rf"Cap\.\s*{escaped}\s+-.*?\n[^\n]*?»\s*{amount_run}",
            section,
            re.I | re.S,
        )
    if not match:
        return None
    nums = EURO_RE.findall(match.group(1))
    return euro_to_million(nums[3])


def fill_missing_chapters(text: str, chapters: dict[str, float], required: list[str]) -> None:
    for number in required:
        if number in chapters or number == "1.00":
            continue
        paid = chapter_from_riepilogo(text, number)
        if paid is None:
            paid = sum_chapter_articles(text, number)
        if paid is None:
            continue
        chapters[number] = paid


def parse_chapters(text: str, layout: str) -> dict[str, float]:
    if layout == "s-prefix":
        return parse_chapters_two_column(text)
    return parse_chapters_five_column(text)


def parse_articles_s_prefix(text: str) -> dict[int, tuple[str, float]]:
    articles: dict[int, tuple[str, float]] = {}
    for match in ARTICLE_S_RE.finditer(text):
        number = int(match.group(1))
        label = re.sub(r"\s+", " ", match.group(2)).strip()
        articles[number] = (label, euro_to_million(match.group(4)))
    if set(range(1, 14)) - set(articles):
        raise SystemExit(f"articoli Cap. 1.1 incompleti: {sorted(articles)}")
    return articles


def parse_articles_plain(text: str) -> dict[int, tuple[str, float]]:
    articles: dict[int, tuple[str, float]] = {}
    for match in ARTICLE_PLAIN_RE.finditer(text):
        number = int(match.group(2))
        label = re.sub(r"\s+", " ", match.group(3)).strip(" .")
        nums = EURO_RE.findall(match.group(4))
        articles[number] = (label, euro_to_million(nums[3]))
    needed = set(range(1, 14))
    if needed - set(articles):
        raise SystemExit(f"articoli Cap. 1.1 incompleti: {sorted(articles)}")
    return articles


def build_2024_style(
    year: int,
    spec: dict,
    chapters: dict[str, float],
    articles: dict[int, tuple[str, float]],
    *,
    article_caveat_prefix: str,
) -> dict:
    senatori_ids = range(1, 9)
    personale_ids = range(9, 14)
    senatori = round(sum(articles[i][1] for i in senatori_ids), 8)
    personale = round(sum(articles[i][1] for i in personale_ids), 8)
    if abs(senatori + personale - chapters["1.1"]) > 1e-6:
        raise SystemExit(
            f"{year}: Cap. 1.1 non riconciliato ({senatori + personale} != {chapters['1.1']})"
        )

    functioning_keys = [
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
    missing = [key for key in functioning_keys if key not in chapters and key != "1.00"]
    # 1.00 may be absent (zero) on some years.
    soft_missing = [key for key in missing if key not in {"1.00"}]
    if soft_missing:
        raise SystemExit(f"{year}: capitoli funzionamento mancanti: {soft_missing}")

    goods = round(sum(chapters.get(item, 0.0) for item in functioning_keys), 8)
    previdenza = round(chapters["1.19"] + chapters["1.20"], 8)
    investments = round(
        sum(chapters.get(key, 0.0) for key in ("2.22", "2.23", "2.24", "2.25", "2.26")),
        8,
    )
    effective = round(senatori + personale + goods + previdenza + investments, 8)
    expected = spec["titoli_i_ii"]
    if abs(effective - expected) > 0.02:
        raise SystemExit(f"{year}: categorie non riconciliate: {effective} != {expected}")

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

    return {
        "kind": "account",
        "year": year,
        "title": f"Rendiconto delle entrate e delle spese {year}",
        "documentUrl": spec["url"],
        "values": {
            "effectivePayments": effective,
            "annualStateContribution": spec["contribution"],
            "functioningExpenditure": round(senatori + personale + goods, 8),
        },
        "categoryReconciliationTolerance": 0.02,
        "categories": [
            {
                "id": "senators",
                "label": "Senatori",
                "paid": senatori,
                "caveat": f"{article_caveat_prefix}1-8 del Cap. 1.1 (emolumenti e rimborsi ai senatori).",
                "components": components(senatori_ids),
            },
            {
                "id": "staff",
                "label": "Personale",
                "paid": personale,
                "caveat": f"{article_caveat_prefix}9-13 del Cap. 1.1 (personale di ruolo, non dipendente, consulenze e personale distaccato).",
                "components": components(personale_ids),
            },
            {
                "id": "functioning-other",
                "label": "Funzionamento e beni/servizi",
                "paid": goods,
                "caveat": "Capitoli di funzionamento della sezione A, esclusi gli emolumenti del Cap. 1.1.",
            },
            {
                "id": "previdenza",
                "label": "Spese previdenziali",
                "paid": previdenza,
                "caveat": "Sezione B: trattamenti previdenziali e oneri a carico dell'Amministrazione. Il totale non equivale ai soli vitalizi.",
                "components": [
                    {"id": "cap-1-19", "label": "Spese previdenziali (Cap. 1.19)", "paid": chapters["1.19"]},
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
                "caveat": "Titolo II: acquisti e manutenzioni straordinarie.",
            },
        ],
        "meaning": (
            f"Pagamenti del rendiconto Senato {year} sui Titoli I e II (spesa al netto delle "
            "partite di giro). La ripartizione segue i capitoli ufficiali. Non va sommato a "
            "Camera o Quirinale."
        ),
    }


def build_2022(spec: dict, chapters: dict[str, float]) -> dict:
    required = ["1.1", "1.2", "1.3", "1.4", "1.26", "1.27", "2.30", "2.31", "2.32"]
    missing = [key for key in required if key not in chapters]
    if missing:
        raise SystemExit(f"2022: capitoli mancanti: {missing}")

    senatori = round(chapters["1.1"] + chapters["1.2"], 8)
    personale = round(chapters["1.3"] + chapters["1.4"], 8)
    functioning_keys = [f"1.{index}" for index in range(5, 26)]
    goods = round(sum(chapters.get(key, 0.0) for key in functioning_keys), 8)
    previdenza = round(chapters["1.26"] + chapters["1.27"], 8)
    investments = round(
        chapters["2.30"] + chapters["2.31"] + chapters["2.32"] + chapters.get("2.33", 0.0),
        8,
    )
    effective = round(senatori + personale + goods + previdenza + investments, 8)
    expected = spec["titoli_i_ii"]
    if abs(effective - expected) > 0.02:
        raise SystemExit(f"2022: categorie non riconciliate: {effective} != {expected}")

    return {
        "kind": "account",
        "year": 2022,
        "title": "Rendiconto delle entrate e delle spese 2022",
        "documentUrl": spec["url"],
        "values": {
            "effectivePayments": effective,
            "annualStateContribution": spec["contribution"],
            "functioningExpenditure": round(senatori + personale + goods, 8),
        },
        "categoryReconciliationTolerance": 0.02,
        "categories": [
            {
                "id": "senators",
                "label": "Senatori",
                "paid": senatori,
                "caveat": "Cap. 1.1 (competenze) e Cap. 1.2 (rimborsi di natura indennitaria) del rendiconto 2022.",
                "components": [
                    {"id": "cap-1-1", "label": "Competenze dei Senatori (Cap. 1.1)", "paid": chapters["1.1"]},
                    {
                        "id": "cap-1-2",
                        "label": "Rimborsi di natura indennitaria (Cap. 1.2)",
                        "paid": chapters["1.2"],
                    },
                ],
            },
            {
                "id": "staff",
                "label": "Personale",
                "paid": personale,
                "caveat": "Cap. 1.3-1.4 (trattamento del personale) del rendiconto 2022.",
                "components": [
                    {"id": "cap-1-3", "label": "Trattamento del personale (Cap. 1.3)", "paid": chapters["1.3"]},
                    {"id": "cap-1-4", "label": "Trattamento del personale (Cap. 1.4)", "paid": chapters["1.4"]},
                ],
            },
            {
                "id": "functioning-other",
                "label": "Funzionamento e beni/servizi",
                "paid": goods,
                "caveat": "Capitoli 1.5-1.25 di funzionamento, esclusi emolumenti e previdenza.",
            },
            {
                "id": "previdenza",
                "label": "Spese previdenziali",
                "paid": previdenza,
                "caveat": "Cap. 1.26-1.27. Il totale non equivale ai soli vitalizi.",
                "components": [
                    {
                        "id": "cap-1-26",
                        "label": "Trattamenti previdenziali (Cap. 1.26)",
                        "paid": chapters["1.26"],
                    },
                    {
                        "id": "cap-1-27",
                        "label": "Oneri di natura previdenziale (Cap. 1.27)",
                        "paid": chapters["1.27"],
                    },
                ],
            },
            {
                "id": "investments",
                "label": "Spese in conto capitale",
                "paid": investments,
                "caveat": "Titolo II: Cap. 2.30-2.33.",
            },
        ],
        "meaning": (
            "Pagamenti del rendiconto Senato 2022 sui Titoli I e II (spesa al netto delle "
            "partite di giro). Nel 2022 i senatori sono su Cap. 1.1-1.2 e il personale su "
            "Cap. 1.3-1.4. Non va sommato a Camera o Quirinale."
        ),
    }


def extract_year(year: int) -> dict:
    spec = YEARS[year]
    require_pdf(spec)
    text = extract_text(spec["pdf"], spec["pages"])
    layout = spec["layout"]
    chapters = parse_chapters(text, layout)
    if layout == "s-prefix":
        articles = parse_articles_s_prefix(text)
        return build_2024_style(year, spec, chapters, articles, article_caveat_prefix="Articoli S.1.1.")
    if layout == "five-column":
        fill_missing_chapters(
            text,
            chapters,
            [
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
                "1.19",
                "1.20",
                "2.22",
                "2.23",
                "2.24",
                "2.25",
                "2.26",
            ],
        )
        articles = parse_articles_plain(text)
        return build_2024_style(year, spec, chapters, articles, article_caveat_prefix="Articoli 1.1.")
    if layout == "2022-split":
        return build_2022(spec, chapters)
    raise SystemExit(f"layout sconosciuto: {layout}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, choices=sorted(YEARS), required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    statement = extract_year(args.year)
    if args.json:
        json.dump(statement, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    elif args.check:
        print(
            f"ok senato-{args.year} categories={len(statement['categories'])} "
            f"effectivePayments={statement['values']['effectivePayments']}"
        )
    else:
        print(json.dumps(statement, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
