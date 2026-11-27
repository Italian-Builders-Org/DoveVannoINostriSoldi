#!/usr/bin/env python3
"""Study on an exit tax for people who move their tax residence abroad.

Every figure comes from a pinned official document (byte size and SHA-256 in
scripts/etl/specs/exit-tax.source.json). Before publishing, the script checks
that the quoted figures and phrases are really in those documents: a changed
source stops the build instead of publishing a stale number.

Outputs, as for the DVNS Index: a typed receipt in the repository and the full
payload in dvns_snapshots (Supabase). Scenarios are computed here and always
labelled as hypotheses, never as forecasts.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "src/data/generated"
DEFAULT_SPEC = ROOT / "scripts/etl/specs/exit-tax.source.json"
DEFAULT_OUTPUT = GEN / "exit-tax.json"
DEFAULT_RECEIPT = GEN / "exit-tax.receipt.json"


class ExitTaxError(Exception):
    """A source does not match its lock or does not say what the study quotes."""


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_locked(spec: dict[str, Any], key: str) -> bytes:
    entry = spec["artefacts"][key]
    payload = (ROOT / entry["path"]).read_bytes()
    if sha256(payload) != entry["sha256"]:
        raise ExitTaxError(f"{entry['path']}: SHA-256 diverso dal source lock")
    return payload


def plain(text: str) -> str:
    """One space between words, whatever the PDF or HTML did with line breaks and non-breaking spaces."""
    text = unicodedata.normalize("NFKC", text).replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def compact(text: str) -> str:
    """Text without any whitespace: PDF extraction splits words at random ("plus valenze", "per ce nto")."""
    return re.sub(r"\s+", "", plain(text))


def require_phrases(text: str, phrases: list[str], label: str) -> None:
    body = compact(text)
    missing = [phrase for phrase in phrases if compact(phrase) not in body]
    if missing:
        raise ExitTaxError(f"{label}: non trovato nel documento: {missing}")


def italian_number(text: str) -> float:
    return float(text.replace(".", "").replace(",", "."))


def read_estimate_inputs(text: str, expected_potential: float | None = None) -> dict[str, float]:
    """The figures of the technical report, read from its text rather than copied by hand."""
    body = compact(text)
    patterns = {
        "substituteTax": r"plusvalenze\(([\d.]+)milionidieuro\)",
        "shareAboveThreshold": r"rappresentanoil([\d,]+)percentodellaricchezza",
        "emigrationRate": r"intornoallo([\d,]+)percentodellapopolazione",
        "potential": r"gettitopotenzialedell'exittaxsiaparia([\d,]+)milioni",
    }
    values = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, body)
        if not match:
            raise ExitTaxError(f"relazione tecnica: valore {key} non trovato")
        values[key] = italian_number(match.group(1))
    if expected_potential is not None and abs(values["potential"] - expected_potential) > 0.005:
        raise ExitTaxError(f"relazione tecnica: gettito {values['potential']} diverso da {expected_potential}")
    return values


def government_estimate(substitute_tax_mn: float, share_pct: float, emigration_pct: float) -> dict[str, float]:
    """The technical report's formula: yearly substitute tax × share above the threshold × emigration rate.

    It applies an annual flow (tax on gains realised in a year) where the exit tax
    hits a stock (gains accumulated over many years): the study shows both.
    """
    from decimal import ROUND_HALF_UP, Decimal

    cent = Decimal("0.01")
    # Same order as the report: round the potential, then halve it (13,47 / 2 = 6,735 -> 6,74).
    potential = (Decimal(str(substitute_tax_mn)) * Decimal(str(share_pct)) * Decimal(str(emigration_pct)) / 10000).quantize(cent, ROUND_HALF_UP)
    annual = (potential / 2).quantize(cent, ROUND_HALF_UP)
    half = (annual / 2).quantize(cent, ROUND_HALF_UP)
    return {"potential": float(potential), "annual": float(annual), "firstYear": float(half), "refunds": float(half)}


def scenario_tax(stock_bn: float, emigration_pct: float, gain_share_pct: float, rate_pct: float) -> dict[str, float]:
    leaving = stock_bn * emigration_pct / 100
    gains = leaving * gain_share_pct / 100
    tax_mn = gains * rate_pct / 100 * 1000
    return {
        "leavingStockBn": round(leaving, 3),
        "gainsBn": round(gains, 3),
        "taxMn": round(tax_mn, 1),
        "advanceMn": round(tax_mn / 2, 1),
    }


def scenario_grid(stock_bn: float, emigration: list[float], gains: list[float], rate_pct: float) -> list[dict[str, Any]]:
    return [
        {"kind": "scenario", "emigrationPct": e, "gainSharePct": g, **scenario_tax(stock_bn, e, g, rate_pct)}
        for e in emigration
        for g in gains
    ]


def _header_years(rows: list[list[Any]]) -> tuple[int, list[tuple[int, int]]]:
    for index, row in enumerate(rows):
        if row and row[0] in ("REGIONI", "Paesi"):
            years = [(column, int(value)) for column, value in enumerate(row) if isinstance(value, (int, float))]
            return index, years
    raise ExitTaxError("tavola ISTAT: intestazione degli anni non trovata")


def _cancellations(rows: list[list[Any]], start: int) -> list[list[Any]]:
    for index in range(start, len(rows)):
        label = str(rows[index][0] or "").upper()
        if label.startswith("CANCELLA"):
            return rows[index + 1:]
    raise ExitTaxError("tavola ISTAT: sezione delle cancellazioni non trovata")


def _breakdown(row: list[Any], column: int, year: int, label: str) -> dict[str, int]:
    low, medium, high, total = (int(row[column + offset] or 0) for offset in range(4))
    if low + medium + high != total:
        raise ExitTaxError(f"tavola ISTAT {label} {year}: basso + medio + alto diverso dal totale")
    return {"year": year, "low": low, "medium": medium, "high": high, "total": total}


def istat_emigrants(rows: list[list[Any]]) -> list[dict[str, int]]:
    """Italians cancelled for abroad by year and education (tavola 9, row ITALIA)."""
    header, years = _header_years(rows)
    for row in _cancellations(rows, header):
        if str(row[0] or "").strip().upper() == "ITALIA":
            return [_breakdown(row, column, year, "ITALIA") for column, year in years]
    raise ExitTaxError("tavola 9: riga ITALIA delle cancellazioni non trovata")


def istat_destinations(rows: list[list[Any]], year: int) -> list[dict[str, Any]]:
    """Italians cancelled for abroad in one year by main destination country (tavola 12)."""
    header, years = _header_years(rows)
    column = dict((y, c) for c, y in years).get(year)
    if column is None:
        raise ExitTaxError(f"tavola 12: anno {year} assente")
    out = []
    for row in _cancellations(rows, header):
        name = str(row[0] or "").strip()
        if not name or name.upper() in ("TOTALE", "ALTRI PAESI", "ITALIA") or name.upper().startswith("TOTALE"):
            continue
        if not isinstance(row[column + 3], (int, float)):
            continue
        out.append({"country": name, **{k: v for k, v in _breakdown(row, column, year, name).items() if k != "year"}})
    return sorted(out, key=lambda item: -item["total"])


def wealth_by_group(rows: list[dict[str, str]], assets: list[str], groups: list[str]) -> tuple[str, dict[str, Any]]:
    """Latest quarter of the ECB Distributional Wealth Accounts: totals in billions, per household in thousands."""
    quarter = max(row["TIME_PERIOD"] for row in rows)
    expected_mult = {"EUR": "6", "EUR_R_NH": "3"}
    out: dict[str, Any] = {group: {"totalBn": {}, "perHouseholdThousand": {}} for group in groups}
    for row in rows:
        if row["TIME_PERIOD"] != quarter or row["INSTR_ASSET"] not in assets or row["DWA_GRP"] not in groups:
            continue
        unit = row["UNIT_MEASURE"]
        if unit not in expected_mult:
            continue
        if row["UNIT_MULT"] != expected_mult[unit]:
            raise ExitTaxError(f"BCE DWA: unità inattesa {unit} x10^{row['UNIT_MULT']}")
        value = float(row["OBS_VALUE"])
        if unit == "EUR":
            out[row["DWA_GRP"]]["totalBn"][row["INSTR_ASSET"]] = round(value / 1000, 3)
        else:
            out[row["DWA_GRP"]]["perHouseholdThousand"][row["INSTR_ASSET"]] = round(value, 3)
    return quarter, out


def pdf_text(spec: dict[str, Any], key: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(read_locked(spec, key)))
    return "\n".join(reader.pages[index].extract_text() or "" for index in spec["artefacts"][key]["pages"])


def html_text(spec: dict[str, Any], key: str) -> str:
    body = read_locked(spec, key).decode("utf-8", errors="replace")
    return html.unescape(re.sub(r"<[^>]+>", " ", body))


def full_pdf_text(spec: dict[str, Any], key: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(read_locked(spec, key)))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def source_text(spec: dict[str, Any], key: str) -> str:
    path = spec["artefacts"][key]["path"]
    if path.endswith(".html"):
        return html_text(spec, key)
    if "pages" in spec["artefacts"][key]:
        return pdf_text(spec, key)
    return full_pdf_text(spec, key)


def xlsx_rows(spec: dict[str, Any], key: str) -> list[list[Any]]:
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(read_locked(spec, key)), read_only=True, data_only=True)
    return [list(row) for row in workbook[workbook.sheetnames[0]].iter_rows(values_only=True)]


def amendments(spec: dict[str, Any]) -> list[dict[str, Any]]:
    data = json.loads(read_locked(spec, "cameraAmendments"))
    groups = {g["id"]: g["label"] for g in data["groups"]} if isinstance(data["groups"], list) else {}
    out = []
    for item in data["amendments"]:
        # Additional articles placed after art. 17 (17.01, 17.02...) deal with other topics.
        if item["section"] != "Art. 17" or item["additionalArticle"]:
            continue
        out.append({
            "id": item["id"],
            "title": item["title"],
            "outcome": item["outcome"],
            "additionalArticle": bool(item["additionalArticle"]),
            "groups": [groups.get(g, g) for g in item["signerGroups"]],
        })
    if not out:
        raise ExitTaxError("emendamenti: nessun emendamento all'art. 17")
    return out


def build(spec: dict[str, Any]) -> dict[str, Any]:
    proposal = spec["proposal"]
    for key, phrases in proposal["phrases"].items():
        require_phrases(source_text(spec, key), phrases, key)

    estimate_spec = spec["governmentEstimate"]
    inputs = read_estimate_inputs(source_text(spec, "ac3174Relazione"), expected_potential=estimate_spec["potentialMn"])
    estimate = government_estimate(inputs["substituteTax"], inputs["shareAboveThreshold"], inputs["emigrationRate"])
    if abs(estimate["potential"] - inputs["potential"]) > 0.01:
        raise ExitTaxError("la formula ricostruita non riproduce il gettito della relazione tecnica")

    require_phrases(source_text(spec, "corteConti2027"), [spec["corteConti"]["phrase"]], "Corte dei conti")
    require_phrases(source_text(spec, "ag42Relazione"), spec["businessExitTax"]["phrases"], "relazione AG 42")

    for row in spec["international"]:
        for source in row["sources"]:
            require_phrases(source_text(spec, source["artefact"]), [source["phrase"]], f"{row['country']} ({source['artefact']})")

    emigrants = istat_emigrants(xlsx_rows(spec, "istatTavola9"))
    last_year = emigrants[-1]["year"]
    destinations = istat_destinations(xlsx_rows(spec, "istatTavola12"), last_year)

    scenario_spec = spec["scenarios"]
    dwa = list(csv.DictReader(io.StringIO(read_locked(spec, "ecbDwa").decode("utf-8"))))
    quarter, wealth = wealth_by_group(dwa, ["F3", "F5", "F51", "F511", "F51M", "F52", "F2M"], scenario_spec["groups"])
    total_assets = sum(wealth["_Z"]["totalBn"][a] for a in scenario_spec["assets"])
    top_assets = sum(wealth["D10"]["totalBn"][a] for a in scenario_spec["assets"])
    stock = total_assets * inputs["shareAboveThreshold"] / 100
    grid = scenario_grid(stock, scenario_spec["emigrationPct"], scenario_spec["gainSharePct"], scenario_spec["ratePct"])

    amendment_rows = amendments(spec)
    return {
        "schemaVersion": 1,
        "datasetId": spec["datasetId"],
        "version": spec["version"],
        "observedAt": spec["observedAt"],
        "proposal": {k: v for k, v in proposal.items() if k != "phrases"},
        "governmentEstimate": {"inputs": inputs, **estimate},
        "corteConti": spec["corteConti"]["quote"],
        "businessExitTax": {k: v for k, v in spec["businessExitTax"].items() if k != "phrases"},
        "amendments": {
            "rows": amendment_rows,
            "total": len(amendment_rows),
            "admissible": sum(1 for a in amendment_rows if a["outcome"] == "ammissibile"),
        },
        "emigration": {"series": emigrants, "destinationsYear": last_year, "destinations": destinations[:10]},
        "wealth": {
            "quarter": quarter,
            "groups": wealth,
            "assetsBn": round(total_assets, 1),
            "topDecileAssetsBn": round(top_assets, 1),
            "topDecileSharePct": round(100 * top_assets / total_assets, 1),
            "stockAboveThresholdBn": round(stock, 1),
        },
        "scenarios": {
            "ratePct": scenario_spec["ratePct"],
            "emigrationPct": scenario_spec["emigrationPct"],
            "gainSharePct": scenario_spec["gainSharePct"],
            "note": scenario_spec["note"],
            "grid": grid,
        },
        "international": [{k: v for k, v in row.items() if k != "sources"} | {"sourceUrls": sorted({spec["artefacts"][s["artefact"]]["url"] for s in row["sources"]})} for row in spec["international"]],
        "sources": spec["sources"],
        "provenance": {key: {"url": entry["url"], "sha256": entry["sha256"]} for key, entry in spec["artefacts"].items()},
    }


def serialize(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--code-sha")
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    try:
        data = build(spec)
    except (ExitTaxError, FileNotFoundError) as error:
        print(f"exit-tax: {error}", file=sys.stderr)
        return 1
    payload = serialize(data)
    if args.write:
        if not args.code_sha or not re.fullmatch(r"[0-9a-f]{40}", args.code_sha):
            print("exit-tax: --write richiede --code-sha di 40 caratteri", file=sys.stderr)
            return 1
        DEFAULT_OUTPUT.write_bytes(payload)
        receipt = {
            "schemaVersion": 1,
            "documentPath": DEFAULT_OUTPUT.relative_to(ROOT).as_posix(),
            "codeSha": args.code_sha,
            "sourceSha256": sha256(payload),
            "sourceBytes": len(payload),
            "version": spec["version"],
        }
        DEFAULT_RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"exit-tax: payload {len(payload)} byte, sha256 {sha256(payload)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
