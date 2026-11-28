#!/usr/bin/env python3
"""Study on a wealth tax (patrimoniale) for Italy.

Every figure comes from a pinned official document (path, URL and SHA-256 in
scripts/etl/specs/patrimoniale.source.json). Before publishing, the script
checks that each quoted figure and phrase is really in its document: a source
that changes stops the build instead of publishing a stale number.

The distribution of household wealth comes from the ECB Distributional Wealth
Accounts (DWA). Above the threshold of the top decile the tail is modelled as a
Pareto distribution whose parameter is read from the published mean of the top
decile; the model is checked against the published share of the top 5%.
Scenarios are always labelled as hypotheses, never as forecasts.

Outputs, as for the other studies: a typed receipt in the repository and the
full payload in dvns_snapshots (Supabase).
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
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "src/data/generated"
DEFAULT_SPEC = ROOT / "scripts/etl/specs/patrimoniale.source.json"
DEFAULT_OUTPUT = GEN / "patrimoniale.json"
DEFAULT_RECEIPT = GEN / "patrimoniale.receipt.json"

# DWA publishes totals in millions of euro and per-household values and
# thresholds in thousands: a different multiplier means a different series.
UNIT_MULT = {"EUR": "6", "EUR_R_NH": "3", "EUR_R_POP": "3", "EUR_T": "3", "EUR_MD": "0", "EUR_MN": "0", "PT": "0", "GI": "0"}
BANDS = [("Q1", 20), ("Q2", 20), ("Q3", 20), ("Q4", 20), ("D9", 10), ("D10", 10)]
BAND_LABELS = {
    "Q1": "20% più povero",
    "Q2": "dal 20° al 40°",
    "Q3": "dal 40° al 60°",
    "Q4": "dal 60° all'80°",
    "D9": "dall'80° al 90°",
    "D10": "10% più ricco",
}
INSTRUMENTS = {
    "NUN": "Abitazioni",
    "NUB": "Imprese non finanziarie (non societarie)",
    "F51M": "Partecipazioni in società non quotate",
    "F511": "Azioni quotate",
    "F52": "Fondi comuni",
    "F3": "Titoli di debito",
    "F2M": "Depositi",
    "F62": "Assicurazioni vita e rendite",
    "F61": "Altre riserve assicurative",
}


class PatrimonialeError(Exception):
    """A source does not match its lock or does not say what the study quotes."""


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def plain(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def compact(text: str) -> str:
    """Text without any whitespace: PDF extraction splits words at random."""
    return re.sub(r"\s+", "", plain(text))


def require_phrases(text: str, phrases: list[str], label: str) -> None:
    body = compact(text)
    missing = [phrase for phrase in phrases if compact(phrase) not in body]
    if missing:
        raise PatrimonialeError(f"{label}: non trovato nel documento: {missing}")


# ── ECB Distributional Wealth Accounts ────────────────────────────────────


def dwa_value(rows: list[dict[str, str]], period: str, instrument: str, group: str, unit: str, entry: str) -> float:
    """One observation, refusing a missing or duplicated series and an unexpected unit multiplier."""
    found = [
        r for r in rows
        if r["TIME_PERIOD"] == period and r["INSTR_ASSET"] == instrument and r["DWA_GRP"] == group
        and r["UNIT_MEASURE"] == unit and r["ACCOUNT_ENTRY"] == entry
    ]
    if len(found) != 1:
        raise PatrimonialeError(f"DWA {entry}.{instrument}.{group}.{unit} {period}: {len(found)} osservazioni invece di una")
    if found[0]["UNIT_MULT"] != UNIT_MULT[unit]:
        raise PatrimonialeError(f"DWA {found[0]['KEY']}: UNIT_MULT {found[0]['UNIT_MULT']} inatteso")
    return float(found[0]["OBS_VALUE"])


def households(total_mn: float, mean_k: float) -> float:
    """Millions of households: total net wealth (millions) over the mean per household (thousands)."""
    return total_mn / mean_k / 1000


def distribution(rows: list[dict[str, str]], period: str) -> dict[str, Any]:
    total = dwa_value(rows, period, "NWA", "_Z", "EUR", "N")
    mean = dwa_value(rows, period, "NWA", "_Z", "EUR_R_NH", "N")
    # DWA does not publish the lower deciles for Italy: quintiles below the
    # top fifth, then the ninth and tenth deciles, cover every household once.
    bands = []
    for group, share in BANDS:
        bands.append({
            "group": group,
            "label": BAND_LABELS[group],
            "householdsPct": share,
            "wealthBn": round(dwa_value(rows, period, "NWA", group, "EUR", "N") / 1000, 1),
            "perHouseholdK": dwa_value(rows, period, "NWA", group, "EUR_R_NH", "N"),
            "thresholdK": None if group == "Q1" else dwa_value(rows, period, "NWA", group, "EUR_T", "N"),
        })
    summed = sum(b["wealthBn"] for b in bands)
    if abs(summed - total / 1000) > max(1.0, total / 1000 * 0.002):
        raise PatrimonialeError(f"DWA {period}: le fasce (quintili e decili) sommano a {summed:.1f} miliardi invece di {total / 1000:.1f}")
    return {
        "period": period,
        "totalBn": round(total / 1000, 1),
        "households": round(households(total, mean), 3),
        "meanK": mean,
        "medianK": round(dwa_value(rows, period, "NWA", "_Z", "EUR_MD", "N") / 1000, 1),
        "top10Pct": dwa_value(rows, period, "NWA", "T10", "PT", "_Z"),
        "top5Pct": dwa_value(rows, period, "NWA", "T5", "PT", "_Z"),
        "bottom50Pct": dwa_value(rows, period, "NWA", "B50", "PT", "_Z"),
        "gini": dwa_value(rows, period, "NWA", "_Z", "GI", "_Z"),
        "bands": bands,
    }


def composition(rows: list[dict[str, str]], period: str, group: str) -> dict[str, Any]:
    """Assets by instrument and debts of a group, in billions; they must add up to its net wealth."""
    items = [
        {"id": key, "label": label, "valueBn": round(dwa_value(rows, period, key, group, "EUR", "A") / 1000, 1)}
        for key, label in INSTRUMENTS.items()
    ]
    assets = dwa_value(rows, period, "F_NNA", group, "EUR", "A") / 1000
    debts = -dwa_value(rows, period, "F_NNA", group, "EUR", "L") / 1000
    net = dwa_value(rows, period, "NWA", group, "EUR", "N") / 1000
    if abs(sum(i["valueBn"] for i in items) - assets) > max(2.0, assets * 0.003):
        raise PatrimonialeError(f"DWA {group}: le attività per strumento non sommano al totale")
    if abs(assets - debts - net) > max(2.0, net * 0.003):
        raise PatrimonialeError(f"DWA {group}: attività meno debiti diverse dalla ricchezza netta")
    return {"group": group, "items": items, "assetsBn": round(assets, 1), "debtsBn": round(debts, 1), "netBn": round(net, 1)}


def share_series(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Fourth quarter of each year (and the latest quarter): shares of the top 10%, top 5%, bottom 50% and Gini."""
    periods = sorted({r["TIME_PERIOD"] for r in rows if r["INSTR_ASSET"] == "NWA" and r["DWA_GRP"] == "T10" and r["UNIT_MEASURE"] == "PT"})
    chosen = [p for p in periods if p.endswith("Q4")]
    if periods and periods[-1] not in chosen:
        chosen.append(periods[-1])
    return [
        {
            "period": p,
            "top10Pct": dwa_value(rows, p, "NWA", "T10", "PT", "_Z"),
            "top5Pct": dwa_value(rows, p, "NWA", "T5", "PT", "_Z"),
            "bottom50Pct": dwa_value(rows, p, "NWA", "B50", "PT", "_Z"),
            "gini": dwa_value(rows, p, "NWA", "_Z", "GI", "_Z"),
        }
        for p in chosen
    ]


def euro_area(rows: list[dict[str, str]], period: str, names: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for area in sorted({r["REF_AREA"] for r in rows}):
        scoped = [r for r in rows if r["REF_AREA"] == area]
        if not any(r["TIME_PERIOD"] == period for r in scoped):
            continue
        if area not in names:
            raise PatrimonialeError(f"DWA: area {area} senza nome")
        out.append({
            "area": area,
            "name": names[area],
            "top10Pct": dwa_value(scoped, period, "NWA", "T10", "PT", "_Z"),
            "top5Pct": dwa_value(scoped, period, "NWA", "T5", "PT", "_Z"),
            "bottom50Pct": dwa_value(scoped, period, "NWA", "B50", "PT", "_Z"),
            "gini": dwa_value(scoped, period, "NWA", "_Z", "GI", "_Z"),
        })
    return sorted(out, key=lambda item: -item["top10Pct"])


# ── Pareto tail and scenarios ─────────────────────────────────────────────


def pareto_alpha(threshold_k: float, mean_k: float) -> float:
    """Pareto parameter from the threshold of the top decile and its mean: mean = threshold * a / (a - 1)."""
    if mean_k <= threshold_k or threshold_k <= 0:
        raise PatrimonialeError("la media del decile più ricco deve superare la sua soglia")
    return mean_k / (mean_k - threshold_k)


def pareto_tail(threshold_k: float, alpha: float, households_m: float) -> Callable[[float], dict[str, float]]:
    """Households above a level, their wealth and the base above the level (billions), for levels in the tail."""

    def above(level_k: float) -> dict[str, float]:
        if level_k < threshold_k:
            raise PatrimonialeError(f"{level_k} mila euro è sotto la soglia del decile più ricco: il modello vale solo nella coda")
        count = households_m * 1e6 * (threshold_k / level_k) ** alpha
        wealth = count * level_k * alpha / (alpha - 1) / 1e6
        base = count * level_k / (alpha - 1) / 1e6
        return {"households": count, "wealthBn": wealth, "baseBn": base}

    return above


def top5_check(alpha: float, threshold_k: float, households_m: float, total_bn: float, published_pct: float) -> dict[str, float]:
    """Share of the top 5% implied by the model, to compare with the share DWA publishes."""
    tail = pareto_tail(threshold_k, alpha, households_m / 10)
    level = threshold_k * 2 ** (1 / alpha)
    model = tail(level)["wealthBn"] / total_bn * 100
    return {"thresholdK": round(level, 1), "modelPct": round(model, 2), "publishedPct": published_pct, "gapPts": round(model - published_pct, 2)}


def scenario_grid(
    tail: Callable[[float], dict[str, float]],
    thresholds_k: list[float],
    rates_pct: list[float],
    erosion_pct: list[float] | None = None,
) -> list[dict[str, Any]]:
    cells = []
    for threshold in thresholds_k:
        above = tail(threshold)
        for rate in rates_pct:
            for erosion in erosion_pct or [0]:
                base = above["baseBn"] * (1 - erosion / 100)
                cells.append({
                    "kind": "scenario",
                    "thresholdK": threshold,
                    "ratePct": rate,
                    "erosionPct": erosion,
                    "households": round(above["households"]),
                    "baseBn": round(above["baseBn"], 1),
                    "revenueBn": round(base * rate / 100, 2),
                })
    return cells


def progressive_revenue(tail: Callable[[float], dict[str, float]], schedule: list[dict[str, float]]) -> dict[str, Any]:
    """Each slice of wealth taxed at its own rate, as in the Spanish and Swiss schedules."""
    ordered = sorted(schedule, key=lambda s: s["fromK"])
    revenue = 0.0
    for index, step in enumerate(ordered):
        upper = ordered[index + 1]["fromK"] if index + 1 < len(ordered) else None
        base = tail(step["fromK"])["baseBn"] - (tail(upper)["baseBn"] if upper else 0.0)
        revenue += base * step["ratePct"] / 100
    return {"kind": "scenario", "schedule": ordered, "households": round(tail(ordered[0]["fromK"])["households"]), "revenueBn": round(revenue, 2)}


# ── Source readers ────────────────────────────────────────────────────────


def read_locked(spec: dict[str, Any], key: str) -> bytes:
    entry = spec["artefacts"][key]
    payload = (ROOT / entry["path"]).read_bytes()
    if sha256(payload) != entry["sha256"]:
        raise PatrimonialeError(f"{entry['path']}: SHA-256 diverso dal source lock")
    return payload


def csv_rows(spec: dict[str, Any], key: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(read_locked(spec, key).decode("utf-8"))))


def pdf_text(spec: dict[str, Any], key: str) -> str:
    from pypdf import PdfReader

    entry = spec["artefacts"][key]
    reader = PdfReader(io.BytesIO(read_locked(spec, key)))
    pages = entry.get("pages") or range(1, len(reader.pages) + 1)
    return "\n".join(reader.pages[page - 1].extract_text() or "" for page in pages)


def html_text(spec: dict[str, Any], key: str) -> str:
    body = read_locked(spec, key).decode("utf-8", errors="replace")
    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", body)
    return html.unescape(re.sub(r"<[^>]+>", " ", body))


def source_text(spec: dict[str, Any], key: str) -> str:
    path = spec["artefacts"][key]["path"]
    if path.endswith(".pdf"):
        return pdf_text(spec, key)
    if path.endswith((".html", ".htm")):
        return html_text(spec, key)
    return read_locked(spec, key).decode("utf-8", errors="replace")


def check_quotes(spec: dict[str, Any]) -> None:
    """Every phrase quoted in the spec must be in its locked document."""
    texts: dict[str, str] = {}
    for quote in spec.get("quotes", []):
        key = quote["artefact"]
        if key not in texts:
            texts[key] = source_text(spec, key)
        require_phrases(texts[key], [quote["phrase"]], f"{key} ({quote['id']})")


def check_facts(spec: dict[str, Any]) -> dict[str, float]:
    """Every fact's phrase must be in its locked document and must contain the quoted value."""
    texts: dict[str, str] = {}
    values: dict[str, float] = {}
    for fact in spec["facts"]:
        if compact(fact["valueText"]) not in compact(fact["phrase"]):
            raise PatrimonialeError(f"{fact['id']}: il valore {fact['valueText']} non è nella frase citata")
        key = fact["artefact"]
        if key not in texts:
            texts[key] = source_text(spec, key)
        require_phrases(texts[key], [fact["phrase"]], f"{key} ({fact['id']})")
        values[fact["id"]] = fact["value"]
    return values


# ── Italian regional data ─────────────────────────────────────────────────


def _region_key(name: str) -> str:
    return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", name.lower()))


def region_values(table: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Housing market value owned by people, by region (billions); regions must add up to Italy."""
    body = table[0]["body"]
    regions = [
        {"region": row["celle"][0].strip(), "valueBn": float(row["celle"][1])}
        for row in body
        if row["stile"] != "subtotale" and row["celle"][0].strip() != "Italia"
    ]
    total = [float(row["celle"][1]) for row in body if row["celle"][0].strip() == "Italia"]
    if len(total) != 1 or abs(sum(r["valueBn"] for r in regions) - total[0]) > 1.0:
        raise PatrimonialeError("le regioni non sommano al totale nazionale")
    return regions


def region_ratios(table: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Mean market value of a main home (euro) and market value over IMU value, by region."""
    out = {}
    for row in table[0]["body"]:
        cells = [cell.strip() for cell in row["celle"]]
        out[_region_key(cells[0])] = {"mainHomeEuro": float(cells[1]), "ratioMain": float(cells[2]), "ratioOther": float(cells[4])}
    if len(out) != 20:
        raise PatrimonialeError(f"rapporto VSM/VIP: {len(out)} regioni invece di 20")
    return out


def ibf_areas(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Mean and median household net wealth by area, Banca d'Italia survey 2022 (new weights)."""
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(read_locked(spec, "ibfStoriche")), read_only=True, data_only=True)
    values: dict[str, dict[str, float]] = {}
    for sheet, field in (("tav.S40", "meanEuro"), ("tav.S41", "medianEuro")):
        ws = workbook[sheet]
        if str(ws["AB4"].value).strip() != "2022 (2)" or str(ws["A26"].value).strip() != "Area geografica":
            raise PatrimonialeError(f"{sheet}: intestazioni inattese")
        for row, label in zip(range(27, 31), ("Nord", "Centro", "Sud e Isole", "Totale")):
            if str(ws[f"A{row}"].value).strip() != label:
                raise PatrimonialeError(f"{sheet}: riga {row} non è {label}")
            values.setdefault(label, {})[field] = float(ws[f"AB{row}"].value)
    return [{"area": label, **values[label]} for label in ("Nord", "Centro", "Sud e Isole", "Totale")]


# ── OECD ──────────────────────────────────────────────────────────────────


def oecd_ranking(rows: list[dict[str, str]], names: dict[str, str], year: int) -> list[dict[str, Any]]:
    """Recurrent taxes on net wealth (4200) as % of GDP, latest year up to `year`, countries above zero."""
    latest: dict[str, tuple[int, float]] = {}
    for r in rows:
        if r["SECTOR"] != "S13" or r["STANDARD_REVENUE"] != "T_4200" or r["UNIT_MEASURE"] != "PT_B1GQ" or not r["OBS_VALUE"]:
            continue
        y = int(r["TIME_PERIOD"])
        if y <= year and (r["REF_AREA"] not in latest or y > latest[r["REF_AREA"]][0]):
            latest[r["REF_AREA"]] = (y, float(r["OBS_VALUE"]))
    out = []
    for code, (y, value) in latest.items():
        # Below a thousandth of GDP the share rounds to zero: not a wealth tax worth listing.
        if round(value, 3) <= 0:
            continue
        if code not in names:
            raise PatrimonialeError(f"OCSE: paese {code} senza nome")
        out.append({"code": code, "name": names[code], "year": y, "pctGdp": round(value, 3)})
    return sorted(out, key=lambda item: -item["pctGdp"])


def oecd_series(rows: list[dict[str, str]], countries: list[str], first: int) -> list[dict[str, Any]]:
    """Taxes on the net wealth of individuals (4210), % of GDP, one row per year."""
    by_year: dict[int, dict[str, float]] = {}
    for r in rows:
        if r["STANDARD_REVENUE"] == "T_4210" and r["UNIT_MEASURE"] == "PT_B1GQ" and r["REF_AREA"] in countries and r["OBS_VALUE"]:
            y = int(r["TIME_PERIOD"])
            if y >= first:
                by_year.setdefault(y, {})[r["REF_AREA"]] = round(float(r["OBS_VALUE"]), 3)
    return [{"year": y, **{c: values.get(c) for c in countries}} for y, values in sorted(by_year.items())]


def oecd_local(rows: list[dict[str, str]], country: str, code: str, year: int) -> float:
    found = [r for r in rows if r["REF_AREA"] == country and r["STANDARD_REVENUE"] == code and r["UNIT_MEASURE"] == "XDC" and r["TIME_PERIOD"] == str(year)]
    if len(found) != 1 or found[0]["UNIT_MULT"] != "9":
        raise PatrimonialeError(f"OCSE {country} {code} {year}: serie in valuta nazionale assente o ambigua")
    return float(found[0]["OBS_VALUE"])


def avs_schedule(facts: dict[str, float], upper_first: float, upper_second: float) -> list[dict[str, float]]:
    """The amendment taxes the base above the exemption: brackets in total wealth start at exemption + upper bounds."""
    exempt = facts["avsSoglia"] / 1000
    return [
        {"fromK": exempt, "ratePct": facts["avsAliquota1"]},
        {"fromK": exempt + upper_first / 1000, "ratePct": facts["avsAliquota2"]},
        {"fromK": exempt + upper_second / 1000, "ratePct": facts["avsAliquota3"]},
    ]


# ── Build ─────────────────────────────────────────────────────────────────

PERIOD = "2026-Q2"
COUNT_LEVELS_K = [1000, 2000, 5000, 10000]


def gdp_2025(spec: dict[str, Any]) -> float:
    data = json.loads(read_locked(spec, "gdp"))
    found = [row for row in data["annualObservations"] if row["period"] == "2025"]
    if len(found) != 1:
        raise PatrimonialeError("PIL 2025 assente")
    return found[0]["nominalMillionEuroTenths"] / 10


def build(spec: dict[str, Any]) -> dict[str, Any]:
    facts = check_facts(spec)
    rows = csv_rows(spec, "dwaIt")
    dist = distribution(rows, PERIOD)
    top = dist["bands"][-1]
    alpha = pareto_alpha(top["thresholdK"], top["perHouseholdK"])
    tail = pareto_tail(top["thresholdK"], alpha, dist["households"] / 10)
    check = top5_check(alpha, top["thresholdK"], dist["households"], dist["totalBn"], dist["top5Pct"])
    if abs(check["gapPts"]) > 2:
        raise PatrimonialeError(f"il modello della coda si discosta di {check['gapPts']} punti dalla quota del 5% più ricco")
    comp_all = composition(rows, PERIOD, "_Z")
    comp_top = composition(rows, PERIOD, "D10")
    gdp = gdp_2025(spec)

    # Shares of the top decile's assets used to reduce the base in the variants.
    top_items = {item["id"]: item["valueBn"] for item in comp_top["items"]}
    housing_share = top_items["NUN"] / comp_top["assetsBn"]
    business_share = (top_items["NUB"] + top_items["F51M"]) / comp_top["assetsBn"]
    ratio = facts["rapportoVsmVip"]
    catasto = round(housing_share * (1 - 1 / ratio) * 100, 1)
    imprese = round(business_share * 100, 1)
    variants = [
        {"id": "piena", "label": "Tutto il patrimonio netto ai valori di mercato", "erosionPct": 0.0},
        {"id": "catasto", "label": "Case ai valori catastali usati per l'IMU", "erosionPct": catasto},
        {"id": "catastoImprese", "label": "Case ai valori catastali e imprese esenti", "erosionPct": round(catasto + imprese, 1)},
    ]
    sc = spec["scenarios"]
    grid = scenario_grid(tail, sc["thresholdsK"], sc["ratesPct"])
    variant_grid = [
        {**cell, "variant": variant["id"]}
        for variant in variants
        for cell in scenario_grid(tail, sc["thresholdsK"], [sc["variantRatePct"]], [variant["erosionPct"]])
    ]

    for phrase_id, bound in (("avsAliquota1", "2.100.000"), ("avsAliquota2", "4.600.000")):
        if bound not in next(f["phrase"] for f in spec["facts"] if f["id"] == phrase_id):
            raise PatrimonialeError(f"{phrase_id}: limite dello scaglione {bound} non citato")
    schedule = avs_schedule(facts, 2100000, 4600000)
    avs_full = progressive_revenue(tail, schedule)
    avs = {
        "act": "A.C. 3174-bis, emendamento 41.012",
        "group": "Alleanza Verdi e Sinistra",
        "status": "Dichiarato ammissibile in Commissione Bilancio; esito del voto non pubblicato al 28 novembre 2026",
        "exemptEuro": facts["avsSoglia"],
        "schedule": schedule,
        "mainHomeExemptEuro": facts["avsPrimaCasa"],
        "capPctIncome": facts["avsTetto"],
        "declarationAboveEuro": facts["avsDichiarazione"],
        "households": avs_full["households"],
        "revenue": [
            {"variant": v["id"], "kind": "scenario", "revenueBn": round(avs_full["revenueBn"] * (1 - v["erosionPct"] / 100), 2)}
            for v in variants
        ],
    }

    oecd_rows = csv_rows(spec, "oecdAll")
    series_rows = csv_rows(spec, "oecdSeries")
    ratios = region_ratios(json.loads(read_locked(spec, "immobiliRapporto")))
    regions = []
    for item in region_values(json.loads(read_locked(spec, "immobiliRegioni"))):
        key = _region_key(item["region"])
        if key not in ratios:
            raise PatrimonialeError(f"rapporto VSM/VIP assente per {item['region']}")
        regions.append({**item, **ratios[key]})

    def pct(value_mn: float) -> float:
        return round(value_mn / gdp * 100, 3)

    existing = [
        {"id": "imuComuni", "label": "IMU, quota dei Comuni", "year": 2025, "valueMn": facts["imuComuni2025"], "basis": "Versamenti F24", "source": "mef"},
        {"id": "imuStato", "label": "IMU sugli immobili produttivi, quota dello Stato", "year": 2025, "valueMn": facts["imuStato2025"], "basis": "Competenza", "source": "mef"},
        {"id": "bollo", "label": "Imposta di bollo, tutte le voci", "year": 2025, "valueMn": facts["bollo2025"], "basis": "Competenza", "source": "mef"},
        {"id": "successioni", "label": "Imposta sulle successioni e donazioni", "year": 2025, "valueMn": facts["successioni2025"], "basis": "Competenza", "source": "mef"},
        {"id": "tobin", "label": "Imposta sulle transazioni finanziarie", "year": 2025, "valueMn": facts["tobin2025"], "basis": "Competenza", "source": "mef"},
        {"id": "ivie", "label": "IVIE, immobili all'estero", "year": 2024, "valueMn": facts["ivie2024"], "basis": "Imposta dichiarata dalle persone fisiche", "source": "irpef"},
        {"id": "ivafe", "label": "IVAFE, attività finanziarie all'estero", "year": 2024, "valueMn": facts["ivafe2024"], "basis": "Imposta dichiarata dalle persone fisiche", "source": "irpef"},
    ]
    for item in existing:
        item["pctGdp"] = pct(item["valueMn"])

    return {
        "schemaVersion": 1,
        "datasetId": "patrimoniale",
        "version": spec["version"],
        "observedAt": spec["observedAt"],
        "gdp2025Mn": gdp,
        "distribution": dist,
        "composition": {"all": comp_all, "top10": comp_top},
        "shareSeries": share_series(rows),
        "euroArea": euro_area(csv_rows(spec, "dwaShares"), PERIOD, spec["euroAreaNames"]),
        "tail": {
            "alpha": round(alpha, 4),
            "thresholdK": top["thresholdK"],
            "check": check,
            "levels": [
                {"thresholdK": level, "households": round(tail(level)["households"]), "wealthBn": round(tail(level)["wealthBn"], 1), "extrapolated": level > check["thresholdK"]}
                for level in COUNT_LEVELS_K
            ],
        },
        "existingTaxes": existing,
        "existingContext": {"ricottiTotalBn": facts["ricottiGettito"], "ricottiBolloBn": facts["ricottiBollo"], "immobiliTotaleBn": facts["immobiliTotale"], "renditaCatastaleBn": facts["renditaCatastale"], "ratioVsmVip": ratio},
        "territory": {"areas": ibf_areas(spec), "regions": regions},
        "scenarios": {
            "note": sc["note"],
            "thresholdsK": sc["thresholdsK"],
            "ratesPct": sc["ratesPct"],
            "variantRatePct": sc["variantRatePct"],
            "grid": grid,
            "variants": variants,
            "variantGrid": variant_grid,
            "housingSharePct": round(housing_share * 100, 1),
            "businessSharePct": imprese,
        },
        "proposals": {"avs": avs, "s2102": {"act": "S.2102", "title": "Imposta grandi patrimoni", "initiative": "Iniziativa popolare", "presented": "2026-11-19", "status": "Da assegnare a una commissione; testo non ancora pubblicato"}},
        "international": {
            "ranking": oecd_ranking(oecd_rows, spec["oecdNames"], 2024),
            "series": oecd_series(series_rows, ["CHE", "NOR", "ESP", "FRA", "ITA"], 1995),
            "local2024": {
                "CHE": round(oecd_local(series_rows, "CHE", "T_4210", 2024), 2),
                "NOR": round(oecd_local(series_rows, "NOR", "T_4210", 2024), 2),
                "ESP": round(oecd_local(series_rows, "ESP", "T_4210", 2024), 2),
                "FRA": round(oecd_local(series_rows, "FRA", "T_4210", 2024), 2),
            },
            "spain": {"revenue2024Euro": facts["esTotale2024"], "declarants2024": facts["esDichiaranti2024"], "itsgf2023Mn": facts["esItsgf2023"], "itsgf2024Mn": facts["esItsgf2024"], "itsgf2025Mn": facts["esItsgf2025"], "capPctIncome": facts["esTetto"], "exemptEuro": facts["esMinimo"], "mainHomeEuro": facts["esViviendaHabitual"], "topRatePct": facts["esEscalaMax"], "itsgfAboveEuro": facts["esItsgfSoglia"]},
            "switzerland": {"thresholdFromChf": facts["chSoglie"], "federalAbolished": int(facts["chFederale1959"])},
            "norway": {"municipalThresholdNok": facts["noSogliaComune"], "stateThresholdNok": facts["noSogliaStato"], "taxpayers2024": facts["noContribuenti2024"], "municipalRatePct": facts["noAliquotaComune"], "stateRatePct": facts["noAliquotaStato"], "stateTopRatePct": facts["noAliquotaStatoAlta"]},
            "france": {"ifi2025Mn": facts["frIfiGettito"], "ifiTaxpayers2025": facts["frIfiContribuenti"]},
        },
        "sources": spec["sources"],
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
    except (PatrimonialeError, FileNotFoundError) as error:
        print(f"patrimoniale: {error}", file=sys.stderr)
        return 1
    payload = serialize(data)
    if args.write:
        if not args.code_sha or not re.fullmatch(r"[0-9a-f]{40}", args.code_sha):
            print("patrimoniale: --write richiede --code-sha di 40 caratteri", file=sys.stderr)
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
    print(f"patrimoniale: payload {len(payload)} byte, sha256 {sha256(payload)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
