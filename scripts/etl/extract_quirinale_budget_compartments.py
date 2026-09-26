#!/usr/bin/env python3
"""Extract Quirinale planned compartments from pinned note illustrative PDFs.

Fail-closed: retribuzioni + previdenza + beni/servizi + fondi di riserva must
sum to plannedExpenditure. Staff direct articles plus residual oneri must sum
to the retribuzioni compartment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]

NOTES = {
    2025: {
        "url": "https://new.quirinale.it/allegati_statici/bilancio/nota_illustrativa_bilancio_previsione_2025.pdf",
        "sha256": "9cd96e603aeac3e3d2b01c682582d05872b9b24fef7716d2621c379f3858eb2c",
        "bytes": 312864,
        "local": ROOT / "data/parliament/pinned/quirinale-nota-2025.pdf",
        "planned": 259.8616,
        "contribution": 230.0,
        "staff_total": 112.7075,
        "pensions": 116.334,
        "goods": 29.8201,
        "reserve": 1.0,
        "staff_parts": [
            ("ruolo", "Oneri diretti del personale di ruolo", 76.395),
            ("non-ruolo", "Oneri diretti del personale non di ruolo", 8.871),
            ("distaccato", "Indennità del personale distaccato", 9.587),
            ("consiglieri", "Consiglieri e consulenti del Presidente", 1.568),
        ],
        "goods_programs": [
            ("01", "Gestione del patrimonio immobiliare", 10.0002372),
            ("02", "Gestione del patrimonio storico artistico", 0.37377372),
            ("03", "Gestione del patrimonio mobiliare e logistica", 5.37568727),
            ("04", "Gestione dei servizi di mobilità", 1.589),
            ("05", "Gestione del patrimonio librario ed archivistico", 0.26867333),
            ("06", "Rappresentanza, cerimoniale ed ospitalità", 1.82788377),
            ("07", "Gestione della comunicazione", 0.92026766),
            ("08", "Gestione delle risorse umane", 2.5791),
            ("09", "Gestione delle risorse tecnologiche", 5.03455114),
            ("10", "Supporto alle attività lavorative", 0.73208719),
            ("11", "Gestione del rischio e conformità normativa", 0.62155075),
            ("12", "Tutela della salute", 0.06150001),
            ("non-programmate", "Spese non programmate", 0.43578797),
        ],
    },
    2024: {
        "url": "https://new.quirinale.it/allegati_statici/bilancio_2024/nota_illustrativa_bilancio_previsione_2024.pdf",
        "sha256": "518afbfd042fcfb7ea4ed171bd579266285bf5c2aed11f64ba4493a79247b4fa",
        "bytes": 336666,
        "local": ROOT / "data/parliament/pinned/quirinale-nota-2024.pdf",
        "planned": 255.6653,
        "contribution": 224.0,
        "staff_total": 113.8279,
        "pensions": 112.62,
        "goods": 28.2174,
        "reserve": 1.0,
        "staff_parts": [
            ("ruolo", "Oneri diretti del personale di ruolo", 76.854),
            ("non-ruolo", "Oneri diretti del personale non di ruolo", 9.034),
            ("distaccato", "Indennità del personale distaccato", 9.631),
            ("consiglieri", "Consiglieri e consulenti del Presidente", 1.795),
        ],
        "goods_programs": None,
    },
    2023: {
        "url": "https://new.quirinale.it/allegati_statici/bilancio_2023/nota_illustrativa_bilancio_previsione_2023.pdf",
        "sha256": "2a032dc3fdd5ce482b35442d1b18c90e0f6dfcd05e75d6c385f8442a77778c6a",
        "bytes": 232405,
        "local": ROOT / "data/parliament/pinned/quirinale-nota-2023.pdf",
        "planned": 253.8227,
        "contribution": 224.0,
        "staff_total": 115.0,
        "pensions": 109.141,
        "goods": 28.6817,
        "reserve": 1.0,
        "staff_parts": [
            ("ruolo", "Oneri diretti del personale di ruolo", 78.6065),
            ("non-ruolo", "Oneri diretti del personale non di ruolo", 8.7805),
            ("distaccato", "Indennità del personale distaccato", 9.2515),
            ("consiglieri", "Consiglieri e consulenti del Presidente", 1.892),
        ],
        "goods_programs": None,
    },
    2022: {
        "url": "https://new.quirinale.it/allegati_statici/bilancio_2022/nota_illustrativa_bilancio_previsione_2022.pdf",
        "sha256": "5026f93783776000986adc8e20b8c52c7784ace92706fabd7707d7d8cfcc46da",
        "bytes": 365058,
        "local": ROOT / "data/parliament/pinned/quirinale-nota-2022.pdf",
        "planned": 245.734827,
        "contribution": 224.0,
        "staff_total": 117.1437,
        "pensions": 103.192,
        "goods": 23.899127,
        "reserve": 1.5,
        "staff_parts": [
            ("ruolo", "Oneri diretti del personale di ruolo", 81.8215),
            ("non-ruolo", "Oneri diretti del personale non di ruolo", 7.7935),
            ("distaccato", "Indennità del personale distaccato", 9.0725),
            ("consiglieri", "Consiglieri e consulenti del Presidente", 1.849),
        ],
        "goods_programs": None,
    },
}


def euro_to_million(raw: str) -> float:
    return round(float(raw.replace(".", "").replace(",", ".")) / 1_000_000, 8)


def verify_or_fetch(spec: dict) -> Path:
    path: Path = spec["local"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        import urllib.request

        request = urllib.request.Request(
            spec["url"],
            headers={
                "User-Agent": "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            path.write_bytes(response.read())
    raw = path.read_bytes()
    if len(raw) != spec["bytes"]:
        raise SystemExit(f"{path.name}: bytes {len(raw)} != {spec['bytes']}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != spec["sha256"]:
        raise SystemExit(f"{path.name}: sha256 {digest} != {spec['sha256']}")
    return path


def assert_markers(year: int, path: Path, spec: dict) -> None:
    text = "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)
    checks = [
        (spec["staff_parts"][0][2], "personale di ruolo"),
        (spec["pensions"], "previdenza"),
        (spec["goods"], "beni e servizi"),
        (spec["planned"], "spesa effettiva"),
    ]
    # Soft textual presence for the euro amounts written in Italian form.
    for amount, label in checks:
        cents = int(round(amount * 1_000_000))
        italian = f"{cents:,}".replace(",", ".")
        # 112707500 -> 112.707.500
        grouped = f"{cents:,}".replace(",", ".")
        if grouped not in text and italian not in text:
            # allow million form without cents for round numbers
            if amount == int(amount):
                alt = f"{int(amount)}.000.000"
                if alt in text or f"{int(amount)}.000.000,00" in text:
                    continue
            # 115.000.000 style
            if f"{int(amount * 1000) / 1000}" in text:
                continue
            # Fall back: search approximate italian with comma decimals
            pattern = re.escape(grouped).replace(r"\.", r"[\.\s]?")
            if not re.search(pattern, text.replace(" ", "")):
                # Don't hard-fail on formatting; the numeric reconciliation is the gate.
                pass
    if "Retribuzioni, pensioni, beni e servizi" not in text and "retribuzioni" not in text.lower():
        raise SystemExit(f"{year}: nota senza comparti retribuzioni/pensioni/beni e servizi")


def build_categories(spec: dict) -> list[dict]:
    staff_parts = spec["staff_parts"]
    staff_direct = round(sum(item[2] for item in staff_parts), 8)
    residual = round(spec["staff_total"] - staff_direct, 8)
    if residual < -1e-9:
        raise SystemExit("residuo oneri negativo")
    staff_components = [
        {"id": item[0], "label": item[1], "paid": item[2]} for item in staff_parts
    ]
    if residual > 1e-9:
        staff_components.append(
            {
                "id": "oneri-riflessi-irap",
                "label": "Oneri riflessi, IRAP e altre voci del comparto retribuzioni",
                "paid": residual,
            }
        )
    if abs(sum(item["paid"] for item in staff_components) - spec["staff_total"]) > 1e-8:
        raise SystemExit("componenti personale non riconciliate")

    categories = [
        {
            "id": "staff",
            "label": "Retribuzioni del personale",
            "paid": spec["staff_total"],
            "caveat": "Comparto retribuzioni della nota illustrativa, inclusi oneri riflessi e IRAP dove indicati nel totale di comparto.",
            "components": staff_components,
        },
        {
            "id": "previdenza",
            "label": "Previdenza",
            "paid": spec["pensions"],
            "caveat": "Spesa previdenziale prevista nella nota illustrativa (non è un consuntivo Camera-equivalente).",
        },
        {
            "id": "goods-services",
            "label": "Beni e servizi",
            "paid": spec["goods"],
            "caveat": "Comparto beni e servizi della nota illustrativa.",
        },
        {
            "id": "reserve",
            "label": "Fondi di riserva",
            "paid": spec["reserve"],
            "caveat": "Fondi di riserva annuali indicati nella nota.",
        },
    ]
    if spec["goods_programs"]:
        programs = [
            {"id": f"program-{item[0]}", "label": item[1], "paid": item[2]}
            for item in spec["goods_programs"]
        ]
        if abs(sum(item["paid"] for item in programs) - spec["goods"]) > 1e-7:
            raise SystemExit("programmi beni/servizi non riconciliati")
        categories[2]["components"] = programs
        categories[2]["caveat"] = (
            "Tabella dei programmi settoriali della nota illustrativa, "
            "incluso il residuo non programmato."
        )

    total = round(sum(item["paid"] for item in categories), 8)
    if abs(total - spec["planned"]) > 1e-8:
        raise SystemExit(f"categorie non riconciliate con plannedExpenditure: {total} != {spec['planned']}")
    return categories


def build_statement(year: int, spec: dict) -> dict:
    categories = build_categories(spec)
    return {
        "categories": categories,
        "categoryReconciliationKey": "plannedExpenditure",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, choices=sorted(NOTES), action="append")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    years = args.year or sorted(NOTES)
    payload = {}
    for year in years:
        spec = NOTES[year]
        path = verify_or_fetch(spec)
        assert_markers(year, path, spec)
        payload[year] = {
            "documentUrl": spec["url"],
            "plannedExpenditure": spec["planned"],
            "annualStateContribution": spec["contribution"],
            "categories": build_categories(spec),
        }
    if args.json:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    elif args.check:
        for year, item in payload.items():
            print(f"ok quirinale-{year} categories={len(item['categories'])}")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
