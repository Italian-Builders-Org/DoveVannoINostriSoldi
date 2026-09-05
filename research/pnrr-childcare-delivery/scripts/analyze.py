#!/usr/bin/env python3
"""Riproduce analisi, tabelle e figure del paper PNRR prima infanzia."""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
import statsmodels.api as sm
import statsmodels.formula.api as smf


PROJECT_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = Path(__file__).resolve().parents[3]
SOURCE_PATH = REPO_DIR / "src/data/generated/pnrr-childcare.data.json"
SOURCE_COMMIT = "6dbbfc00db21a3f821fc58115c6a06d0b6fafec9"
ISTAT_PATH = PROJECT_DIR / "data/istat_childcare_2023.csv"
MANIFEST_PATH = PROJECT_DIR / "data/mcp_pnrr_manifest.json"
GENERATED_DIR = PROJECT_DIR / "generated"
FIGURE_DIR = PROJECT_DIR / "figures"
TABLE_DIR = PROJECT_DIR / "tables"

for directory in (GENERATED_DIR, FIGURE_DIR, TABLE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

COLORS = {
    "blue": "#155EEF",
    "navy": "#16324F",
    "teal": "#087E8B",
    "green": "#228B5B",
    "amber": "#D97706",
    "red": "#C2413B",
    "grey": "#667085",
    "light": "#E8EEF5",
}

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.titlesize": 12,
        "axes.labelsize": 10,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.dpi": 140,
        "savefig.bbox": "tight",
        "savefig.facecolor": "white",
    }
)


REGION_NAMES = {
    "PIEMONTE": "Piemonte",
    "VALLE D'AOSTA": "Valle d'Aosta",
    "VALLE D’AOSTA": "Valle d'Aosta",
    "VALLE D'AOSTA/VALLÉE D'AOSTE": "Valle d'Aosta",
    "LIGURIA": "Liguria",
    "LOMBARDIA": "Lombardia",
    "TRENTINO-ALTO ADIGE": "Trentino-Alto Adige",
    "TRENTINO ALTO ADIGE": "Trentino-Alto Adige",
    "TRENTINO-ALTO ADIGE/SÜDTIROL": "Trentino-Alto Adige",
    "VENETO": "Veneto",
    "FRIULI-VENEZIA GIULIA": "Friuli-Venezia Giulia",
    "FRIULI VENEZIA GIULIA": "Friuli-Venezia Giulia",
    "EMILIA-ROMAGNA": "Emilia-Romagna",
    "EMILIA ROMAGNA": "Emilia-Romagna",
    "TOSCANA": "Toscana",
    "UMBRIA": "Umbria",
    "MARCHE": "Marche",
    "LAZIO": "Lazio",
    "ABRUZZO": "Abruzzo",
    "MOLISE": "Molise",
    "CAMPANIA": "Campania",
    "PUGLIA": "Puglia",
    "BASILICATA": "Basilicata",
    "CALABRIA": "Calabria",
    "SICILIA": "Sicilia",
    "SARDEGNA": "Sardegna",
}

MATURITY_ORDER = [
    "Concluso",
    "Collaudo non concluso",
    "Esecuzione lavori",
    "Prima dell'esecuzione",
    "Fase non disponibile",
]

REFERENCE_DATE = pd.Timestamp("2026-06-13")
TENDER_PROCEDURE_ORDER = [
    "Affidamento diretto semplice",
    "Procedura negoziata",
    "Procedura aperta",
    "Adesione/accordo quadro",
    "Procedura ristretta",
    "Altro affidamento diretto",
    "Altro/non disponibile",
]
CONTRACT_ORDER = ["Servizi", "Lavori", "Forniture", "Altro/non disponibile"]


def text(value: object) -> str:
    return "" if value is None else str(value).strip()


def parse_year(value: object) -> float:
    match = re.match(r"^(\d{4})", text(value))
    return float(match.group(1)) if match else np.nan


def parse_date(value: object) -> pd.Timestamp | pd.NaT:
    if not text(value):
        return pd.NaT
    return pd.to_datetime(value, errors="coerce", utc=True).tz_localize(None)


def normalize_region(value: object) -> str | None:
    raw = text(value).upper().replace("’", "'")
    return REGION_NAMES.get(raw)


def classify_type(value: object) -> str:
    raw = text(value).upper()
    if "NUOVA REALIZZAZIONE" in raw:
        return "Nuova realizzazione"
    if "AMPLIAMENTO" in raw or "POTENZIAMENTO" in raw:
        return "Ampliamento"
    if any(token in raw for token in ("RISTRUTTURAZIONE", "RECUPERO", "RESTAURO")):
        return "Ristrutturazione/recupero"
    if "DEMOLIZIONE" in raw:
        return "Demolizione/ricostruzione"
    return "Altro"


def classify_maturity(progress: object, phase: object) -> str:
    progress_u = text(progress).upper()
    phase_u = text(phase).upper()
    if progress_u == "CONCLUSO":
        return "Concluso"
    if "COLLAUDO" in phase_u:
        return "Collaudo non concluso"
    if "ESECUZIONE LAVORI" in phase_u:
        return "Esecuzione lavori"
    if not phase_u or "NON DISPONIBILE" in phase_u:
        return "Fase non disponibile"
    return "Prima dell'esecuzione"


def classify_tender_procedure(procedure: object) -> str:
    raw = text(procedure).upper()
    if raw == "AFFIDAMENTO DIRETTO":
        return "Affidamento diretto semplice"
    if "NEGOZIAT" in raw or "DIALOGO COMPETITIVO" in raw:
        return "Procedura negoziata"
    if "APERTA" in raw:
        return "Procedura aperta"
    if "ACCORDO QUADRO" in raw or "CONVENZIONE" in raw:
        return "Adesione/accordo quadro"
    if "RISTRETTA" in raw:
        return "Procedura ristretta"
    if "DIRETT" in raw:
        return "Altro affidamento diretto"
    return "Altro/non disponibile"


def classify_contract_type(value: object) -> str:
    raw = text(value).upper()
    if "SERVIZ" in raw:
        return "Servizi"
    if "LAVOR" in raw:
        return "Lavori"
    if "FORNIT" in raw:
        return "Forniture"
    return "Altro/non disponibile"


def wilson(successes: int, total: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if total == 0:
        return (np.nan, np.nan)
    proportion = successes / total
    denominator = 1 + z**2 / total
    centre = (proportion + z**2 / (2 * total)) / denominator
    half = z * math.sqrt(proportion * (1 - proportion) / total + z**2 / (4 * total**2)) / denominator
    return centre - half, centre + half


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def project_rows(payload: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows: list[dict] = []
    tender_rows: list[dict] = []
    for project in payload["projects"]:
        status = project.get("status") or {}
        classification = project.get("classification") or {}
        funding = project.get("funding") or {}
        timeline = project.get("timeline") or {}
        locations = project.get("locations") or []
        tenders = project.get("tenders") or []
        location = locations[0] if locations else {}
        region = normalize_region(location.get("region"))

        procedure_values = [text(t.get("procedure")).upper() for t in tenders]
        contract_values = [text(t.get("contractType")).upper() for t in tenders]
        has_works = any("LAVORI" in value for value in contract_values)
        direct_count = sum("AFFIDAMENTO DIRETTO" in value for value in procedure_values)
        framework_count = sum(
            bool(t.get("frameworkCig")) or "ACCORDO QUADRO" in text(t.get("deliveryMode")).upper()
            for t in tenders
        )
        maturity = classify_maturity(status.get("progress"), status.get("phase"))
        start_year = parse_year(timeline.get("actualStart"))

        row = {
            "cup": project.get("cup"),
            "region": region,
            "municipality_code": location.get("municipalityCode"),
            "province_code": location.get("provinceCode"),
            "municipality_key": f"{text(location.get('provinceCode'))}{text(location.get('municipalityCode'))}",
            "progress": status.get("progress"),
            "phase": status.get("phase"),
            "category": classification.get("category"),
            "maturity": maturity,
            "concluded": int(text(status.get("progress")).upper() == "CONCLUSO"),
            "commissioning_or_concluded": int(maturity in ("Concluso", "Collaudo non concluso")),
            "actual_end_recorded": int(bool(timeline.get("actualEnd"))),
            "actual_start": timeline.get("actualStart"),
            "actual_end": timeline.get("actualEnd"),
            "planned_end": timeline.get("plannedEnd"),
            "start_year": start_year,
            "existing": int(text(project.get("existingProject")).upper() in ("SÌ", "SI")),
            "project_type_raw": classification.get("type"),
            "project_group": classify_type(classification.get("type")),
            "total_funding_eur": (funding.get("totalCents") or 0) / 100,
            "pnrr_funding_eur": (funding.get("pnrrCents") or 0) / 100,
            "tender_count": len(tenders),
            "awardee_count": len(project.get("awardees") or []),
            "has_tenders": int(bool(tenders)),
            "has_works_tender": int(has_works),
            "direct_tender_count": direct_count,
            "framework_tender_count": framework_count,
            "location_count": len(locations),
        }
        rows.append(row)

        for tender in tenders:
            is_framework = bool(tender.get("frameworkCig")) or "ACCORDO QUADRO" in text(tender.get("deliveryMode")).upper()
            published_at = parse_date(tender.get("publishedAt"))
            awarded_at = parse_date(tender.get("awardedAt"))
            tender_rows.append(
                {
                    "cup": project.get("cup"),
                    "region": region,
                    "maturity": maturity,
                    "category": classification.get("category"),
                    "amount_eur": (tender.get("amountCents") or 0) / 100,
                    "award_amount_eur": (tender.get("awardAmountCents") or 0) / 100,
                    "has_amount": int(tender.get("amountCents") is not None),
                    "has_award_amount": int(tender.get("awardAmountCents") is not None),
                    "has_published_at": int(bool(tender.get("publishedAt"))),
                    "has_awarded_at": int(bool(tender.get("awardedAt"))),
                    "has_cig": int(bool(tender.get("cig"))),
                    "has_procedure": int(bool(tender.get("procedure"))),
                    "has_contract_type": int(bool(tender.get("contractType"))),
                    "procedure_raw": tender.get("procedure"),
                    "procedure_group": classify_tender_procedure(tender.get("procedure")),
                    "contract_type_raw": tender.get("contractType"),
                    "contract_group": classify_contract_type(tender.get("contractType")),
                    "published_at": published_at,
                    "awarded_at": awarded_at,
                    "award_days": (awarded_at - published_at).days if pd.notna(published_at) and pd.notna(awarded_at) else np.nan,
                    "is_direct": int("AFFIDAMENTO DIRETTO" in text(tender.get("procedure")).upper()),
                    "is_works": int("LAVORI" in text(tender.get("contractType")).upper()),
                    "is_framework": int(is_framework),
                }
            )
    return pd.DataFrame(rows), pd.DataFrame(tender_rows)


def save_figure(fig: plt.Figure, stem: str) -> None:
    fig.savefig(FIGURE_DIR / f"{stem}.pdf")
    fig.savefig(FIGURE_DIR / f"{stem}.png", dpi=180)
    plt.close(fig)


def latex_escape(value: object) -> str:
    string = text(value)
    replacements = {
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "€": r"\texteuro{}",
        "–": "--",
        "—": "---",
        "≥": r"\(\geq\)",
        "≤": r"\(\leq\)",
    }
    for old, new in replacements.items():
        string = string.replace(old, new)
    return string


def write_table(path: Path, columns: list[str], rows: list[list[object]], alignment: str | None = None) -> None:
    alignment = alignment or ("l" + "r" * (len(columns) - 1))
    lines = [
        rf"\begin{{tabular}}{{{alignment}}}",
        r"\toprule",
        " & ".join(latex_escape(value) for value in columns) + r" \\",
        r"\midrule",
    ]
    for row in rows:
        lines.append(" & ".join(latex_escape(value) for value in row) + r" \\")
    lines.extend([r"\bottomrule", r"\end{tabular}", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def plot_pipeline(projects: pd.DataFrame) -> pd.DataFrame:
    pipeline = (
        projects.groupby("maturity", observed=False)
        .agg(projects=("cup", "count"), funding=("total_funding_eur", "sum"))
        .reindex(MATURITY_ORDER)
        .fillna(0)
    )
    pipeline["project_share"] = pipeline["projects"] / len(projects)
    pipeline["funding_share"] = pipeline["funding"] / projects["total_funding_eur"].sum()

    ordered = list(reversed(MATURITY_ORDER))
    view = pipeline.loc[ordered]
    colors = [COLORS["grey"], COLORS["amber"], COLORS["blue"], COLORS["teal"], COLORS["green"]]
    fig, axes = plt.subplots(1, 2, figsize=(11.2, 4.8), gridspec_kw={"wspace": 0.42})
    axes[0].barh(ordered, view["projects"], color=colors)
    axes[0].set_title("Progetti per stato amministrativo")
    axes[0].set_xlabel("Numero di progetti")
    for y, (_, row) in enumerate(view.iterrows()):
        axes[0].text(row["projects"] + 20, y, f"{int(row['projects']):,}  ({row['project_share']:.1%})".replace(",", "."), va="center", fontsize=9)
    axes[0].set_xlim(0, max(view["projects"]) * 1.32)

    axes[1].barh(ordered, view["funding"] / 1e9, color=colors)
    axes[1].set_title("Finanziamento totale associato")
    axes[1].set_xlabel("Miliardi di euro")
    axes[1].set_yticklabels([])
    for y, (_, row) in enumerate(view.iterrows()):
        axes[1].text(row["funding"] / 1e9 + 0.02, y, f"€{row['funding']/1e9:.2f} mld  ({row['funding_share']:.1%})", va="center", fontsize=9)
    axes[1].set_xlim(0, max(view["funding"] / 1e9) * 1.42)
    fig.suptitle("La pipeline non coincide con il target dei posti certificati", fontsize=14, x=0.49)
    fig.text(0.01, -0.02, "Fonte: elaborazione su DVNS/PNRR, riferimento 13 giugno 2026. Il finanziamento non misura pagamenti effettuati.", fontsize=8, color=COLORS["grey"])
    save_figure(fig, "01_pipeline")
    return pipeline.reset_index()


def regional_frame(projects: pd.DataFrame, istat: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for region, group in projects.groupby("region", dropna=False):
        concluded = int(group["concluded"].sum())
        commissioning = int(group["commissioning_or_concluded"].sum())
        n = len(group)
        c_low, c_high = wilson(concluded, n)
        m_low, m_high = wilson(commissioning, n)
        rows.append(
            {
                "region": region,
                "projects": n,
                "concluded": concluded,
                "concluded_share": concluded / n,
                "concluded_low": c_low,
                "concluded_high": c_high,
                "commissioning": commissioning,
                "commissioning_share": commissioning / n,
                "commissioning_low": m_low,
                "commissioning_high": m_high,
                "total_funding_eur": group["total_funding_eur"].sum(),
                "pnrr_funding_eur": group["pnrr_funding_eur"].sum(),
                "mature_funding_eur": group.loc[group["commissioning_or_concluded"] == 1, "total_funding_eur"].sum(),
            }
        )
    regional = pd.DataFrame(rows).merge(istat, on="region", how="left", validate="one_to_one")
    regional["estimated_children_0_2"] = regional["authorized_places"] / (regional["coverage_per_100"] / 100)
    regional["funding_per_child"] = regional["total_funding_eur"] / regional["estimated_children_0_2"]
    regional["projects_per_100k_children"] = regional["projects"] / regional["estimated_children_0_2"] * 100_000
    regional["mature_funding_per_child"] = regional["mature_funding_eur"] / regional["estimated_children_0_2"]
    regional["mature_funding_share"] = regional["mature_funding_eur"] / regional["total_funding_eur"]
    return regional


def plot_regions(regional: pd.DataFrame) -> None:
    view = regional.sort_values("commissioning_share", ascending=True).reset_index(drop=True)
    y = np.arange(len(view))
    fig, ax = plt.subplots(figsize=(8.5, 8.0))
    ax.hlines(y, view["concluded_share"] * 100, view["commissioning_share"] * 100, color=COLORS["light"], linewidth=3)
    ax.errorbar(
        view["commissioning_share"] * 100,
        y,
        xerr=np.vstack(
            [
                (view["commissioning_share"] - view["commissioning_low"]) * 100,
                (view["commissioning_high"] - view["commissioning_share"]) * 100,
            ]
        ),
        fmt="o",
        color=COLORS["teal"],
        ecolor="#9DCFD3",
        capsize=2,
        label="Concluso o in collaudo",
    )
    ax.scatter(view["concluded_share"] * 100, y, color=COLORS["green"], marker="s", s=25, label="Concluso")
    ax.set_yticks(y, [f"{r}  (n={n})" for r, n in zip(view["region"], view["projects"])])
    ax.set_xlabel("Quota dei progetti regionali (%)")
    ax.set_title("L'avanzamento amministrativo varia tra regioni")
    ax.grid(axis="x", alpha=0.2)
    ax.legend(loc="lower right", frameon=False)
    fig.text(0.01, -0.01, "Intervalli al 95% di Wilson sulla quota conclusa o in collaudo. Fonte: DVNS/PNRR, 13 giugno 2026.", fontsize=8, color=COLORS["grey"])
    save_figure(fig, "02_regioni_avanzamento")


def plot_coverage(regional: pd.DataFrame) -> dict:
    usable = regional.dropna(subset=["coverage_per_100", "commissioning_share"]).copy()
    rho_comm, p_comm = spearmanr(usable["coverage_per_100"], usable["commissioning_share"])
    rho_conc, p_conc = spearmanr(usable["coverage_per_100"], usable["concluded_share"])
    rho_fund, p_fund = spearmanr(usable["coverage_per_100"], usable["funding_per_child"])

    fig, axes = plt.subplots(1, 2, figsize=(11.3, 5.2), gridspec_kw={"wspace": 0.3})
    sizes = 25 + usable["projects"] * 0.42
    axes[0].scatter(usable["coverage_per_100"], usable["commissioning_share"] * 100, s=sizes, color=COLORS["teal"], alpha=0.75, edgecolor="white")
    axes[0].set_xlabel("Posti autorizzati ogni 100 bambini, 2023/24")
    axes[0].set_ylabel("Progetti conclusi o in collaudo (%)")
    axes[0].set_title(f"Copertura 2023/24 e avanzamento\nSpearman ρ={rho_comm:.2f}, p={p_comm:.3f}")
    axes[0].grid(alpha=0.18)

    axes[1].scatter(usable["coverage_per_100"], usable["funding_per_child"], s=sizes, color=COLORS["blue"], alpha=0.75, edgecolor="white")
    axes[1].set_xlabel("Posti autorizzati ogni 100 bambini, 2023/24")
    axes[1].set_ylabel("Finanziamento associato per bambino 0–2 stimato (€)")
    axes[1].set_title(f"Copertura 2023/24 e intensità finanziaria\nSpearman ρ={rho_fund:.2f}, p={p_fund:.3f}")
    axes[1].grid(alpha=0.18)

    for ax, y_col, scale in ((axes[0], "commissioning_share", 100), (axes[1], "funding_per_child", 1)):
        candidates = usable.nlargest(2, y_col).index.union(usable.nsmallest(2, y_col).index)
        candidates = candidates.union(usable.nsmallest(2, "coverage_per_100").index)
        for idx in candidates:
            row = usable.loc[idx]
            ax.annotate(row["region"], (row["coverage_per_100"], row[y_col] * scale), xytext=(4, 4), textcoords="offset points", fontsize=8)

    fig.suptitle("Il bisogno territoriale e la maturità amministrativa sono dimensioni diverse", fontsize=14, y=1.06)
    fig.subplots_adjust(top=0.80)
    fig.text(0.01, -0.02, "Bolle proporzionali al numero di progetti. La popolazione 0–2 è stimata da posti/copertura ISTAT; correlazioni ecologiche, non causali.", fontsize=8, color=COLORS["grey"])
    save_figure(fig, "03_copertura_istat")
    return {
        "coverage_vs_commissioning": {"rho": rho_comm, "p_value": p_comm, "n": len(usable)},
        "coverage_vs_concluded": {"rho": rho_conc, "p_value": p_conc, "n": len(usable)},
        "coverage_vs_funding_per_child": {"rho": rho_fund, "p_value": p_fund, "n": len(usable)},
    }


def plot_procurement(projects: pd.DataFrame, tenders: pd.DataFrame) -> pd.DataFrame:
    stats = (
        projects.groupby("maturity")
        .agg(
            projects=("cup", "count"),
            median_tenders=("tender_count", "median"),
            p75_tenders=("tender_count", lambda s: s.quantile(0.75)),
            works_share=("has_works_tender", "mean"),
            direct_any_share=("direct_tender_count", lambda s: (s > 0).mean()),
            framework_any_share=("framework_tender_count", lambda s: (s > 0).mean()),
        )
        .reindex(MATURITY_ORDER)
    )

    fig, axes = plt.subplots(1, 2, figsize=(11.2, 5.0), gridspec_kw={"wspace": 0.35})
    arrays = [projects.loc[projects["maturity"] == category, "tender_count"].clip(upper=20) for category in MATURITY_ORDER]
    box = axes[0].boxplot(arrays, tick_labels=["Concluso", "Collaudo", "Esecuzione", "Pre-esec.", "N.d."], patch_artist=True, showfliers=False)
    for patch in box["boxes"]:
        patch.set_facecolor(COLORS["light"])
        patch.set_edgecolor(COLORS["blue"])
    axes[0].set_ylabel("Numero di procedure osservate per progetto")
    axes[0].set_title("Impronta procedurale (valori oltre 20 troncati)")
    axes[0].tick_params(axis="x", rotation=20)
    axes[0].grid(axis="y", alpha=0.18)

    x = np.arange(len(MATURITY_ORDER))
    width = 0.36
    axes[1].bar(x - width / 2, stats["works_share"] * 100, width, label="Almeno una gara lavori", color=COLORS["teal"])
    axes[1].bar(x + width / 2, stats["direct_any_share"] * 100, width, label="Almeno un affidamento diretto", color=COLORS["amber"])
    axes[1].set_xticks(x, ["Concluso", "Collaudo", "Esecuzione", "Pre-esec.", "N.d."], rotation=20)
    axes[1].set_ylabel("Quota di progetti (%)")
    axes[1].set_title("Tipi di procedura osservati")
    axes[1].legend(frameon=False, fontsize=9)
    axes[1].grid(axis="y", alpha=0.18)
    fig.suptitle("Le gare descrivono una traccia amministrativa, non una causa dell'avanzamento", fontsize=14)
    fig.text(0.01, -0.02, f"Fonte: {len(tenders):,} procedure collegate a {len(projects):,} progetti DVNS/PNRR.".replace(",", "."), fontsize=8, color=COLORS["grey"])
    save_figure(fig, "04_impronta_appalti")
    return stats.reset_index()


def procurement_number_value(tenders: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    procedure = (
        tenders.groupby("procedure_group")
        .agg(
            procedures=("cup", "size"),
            observed_base_amounts=("has_amount", "sum"),
            base_amount_eur=("amount_eur", "sum"),
        )
        .reindex(TENDER_PROCEDURE_ORDER, fill_value=0)
        .reset_index()
    )
    procedure["number_share"] = procedure["procedures"] / len(tenders)
    procedure["value_share"] = procedure["base_amount_eur"] / procedure["base_amount_eur"].sum()

    contract = (
        tenders.groupby("contract_group")
        .agg(
            procedures=("cup", "size"),
            observed_base_amounts=("has_amount", "sum"),
            base_amount_eur=("amount_eur", "sum"),
        )
        .reindex(CONTRACT_ORDER, fill_value=0)
        .reset_index()
    )
    contract["number_share"] = contract["procedures"] / len(tenders)
    contract["value_share"] = contract["base_amount_eur"] / contract["base_amount_eur"].sum()

    fig, axes = plt.subplots(1, 2, figsize=(11.4, 5.6), gridspec_kw={"wspace": 0.35})
    for ax, frame, title in (
        (axes[0], procedure, "Procedure per modalità di affidamento"),
        (axes[1], contract, "Procedure per tipo di contratto"),
    ):
        view = frame.iloc[::-1].reset_index(drop=True)
        y = np.arange(len(view))
        height = 0.36
        ax.barh(y - height / 2, view["number_share"] * 100, height, color=COLORS["amber"], label="Quota per numero")
        ax.barh(y + height / 2, view["value_share"] * 100, height, color=COLORS["blue"], label="Quota del valore a base osservato")
        labels = view.iloc[:, 0].str.replace("Affidamento diretto semplice", "Diretto semplice", regex=False)
        labels = labels.str.replace("Adesione/accordo quadro", "Accordo quadro", regex=False)
        labels = labels.str.replace("Altro/non disponibile", "Altro/n.d.", regex=False)
        ax.set_yticks(y, labels)
        ax.set_xlabel("Quota (%)")
        ax.set_title(title)
        ax.grid(axis="x", alpha=0.18)
        ax.set_xlim(0, max(90, (view[["number_share", "value_share"]].max().max() * 100) * 1.12))
    axes[0].legend(frameon=False, loc="lower right", fontsize=8.5)
    fig.suptitle("Il denominatore cambia il racconto degli appalti", fontsize=14)
    fig.text(
        0.01,
        -0.02,
        f"Fonte: {len(tenders):,} righe procedura. Il valore è la somma degli importi a base disponibili, non pagamenti né importi aggiudicati.".replace(",", "."),
        fontsize=8,
        color=COLORS["grey"],
    )
    save_figure(fig, "07_appalti_numero_valore")
    return procedure, contract


def procurement_timing(tenders: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    paired = tenders["award_days"].notna()
    negative = paired & tenders["award_days"].lt(0)
    usable = paired & tenders["award_days"].between(0, 730, inclusive="both")
    over = paired & tenders["award_days"].gt(730)
    quality = pd.DataFrame(
        [
            ["Date non entrambe disponibili", int((~paired).sum())],
            ["Aggiudicazione precedente alla pubblicazione", int(negative.sum())],
            ["Durata 0--730 giorni utilizzabile", int(usable.sum())],
            ["Durata oltre 730 giorni", int(over.sum())],
        ],
        columns=["quality_group", "procedures"],
    )
    quality["share"] = quality["procedures"] / len(tenders)

    usable_tenders = tenders.loc[usable].copy()
    timing = (
        usable_tenders.groupby("procedure_group")["award_days"]
        .agg(n="size", p25=lambda s: s.quantile(0.25), median="median", p75=lambda s: s.quantile(0.75), p90=lambda s: s.quantile(0.90))
        .reindex(TENDER_PROCEDURE_ORDER)
        .dropna(subset=["n"])
        .reset_index()
    )
    total_row = pd.DataFrame(
        [
            {
                "procedure_group": "Tutte le procedure utilizzabili",
                "n": len(usable_tenders),
                "p25": usable_tenders["award_days"].quantile(0.25),
                "median": usable_tenders["award_days"].median(),
                "p75": usable_tenders["award_days"].quantile(0.75),
                "p90": usable_tenders["award_days"].quantile(0.90),
            }
        ]
    )
    timing = pd.concat([total_row, timing], ignore_index=True)

    fig, axes = plt.subplots(1, 2, figsize=(11.3, 5.5), gridspec_kw={"wspace": 0.44})
    quality_colors = [COLORS["grey"], COLORS["red"], COLORS["teal"], COLORS["amber"]]
    quality_view = quality.iloc[::-1].reset_index(drop=True)
    y_quality = np.arange(len(quality_view))
    axes[0].barh(y_quality, quality_view["share"] * 100, color=list(reversed(quality_colors)))
    quality_labels = ["Date mancanti", "Ordine negativo", "0--730 giorni validi", ">730 giorni"]
    axes[0].set_yticks(y_quality, list(reversed(quality_labels)))
    axes[0].set_xlim(0, 75)
    axes[0].set_xlabel("Quota di tutte le righe (%)")
    axes[0].set_title("Validità della coppia di date")
    axes[0].grid(axis="x", alpha=0.18)
    for index, row in quality_view.iterrows():
        axes[0].text(row["share"] * 100 + 0.8, index, f"{int(row['procedures']):,} ({row['share']:.1%})".replace(",", "."), va="center", fontsize=8.5)

    timing_view = timing[timing["procedure_group"] != "Tutte le procedure utilizzabili"].copy()
    timing_view = timing_view[timing_view["n"] >= 20].sort_values("median", ascending=True)
    y = np.arange(len(timing_view))
    axes[1].hlines(y, timing_view["p25"], timing_view["p75"], color=COLORS["light"], linewidth=7)
    axes[1].scatter(timing_view["median"], y, color=COLORS["blue"], s=42, zorder=3)
    labels = timing_view["procedure_group"].str.replace("Affidamento diretto semplice", "Diretto semplice", regex=False)
    labels = labels.str.replace("Adesione/accordo quadro", "Accordo quadro", regex=False)
    labels = labels.str.replace("Altro/non disponibile", "Altro/n.d.", regex=False)
    axes[1].set_yticks(y, [f"{label} (n={int(n):,})".replace(",", ".") for label, n in zip(labels, timing_view["n"])])
    axes[1].set_xlabel("Giorni tra pubblicazione e aggiudicazione")
    axes[1].set_title("Mediana e intervallo interquartile\nsolo coppie 0--730 giorni")
    axes[1].grid(axis="x", alpha=0.18)
    fig.suptitle("La gara mediana dura 14 giorni, ma solo metà delle date è utilizzabile", fontsize=14, y=0.97)
    fig.subplots_adjust(top=0.80, bottom=0.12)
    fig.text(0.01, -0.02, "Tempi descrittivi, non durata dell'intero procurement né del cantiere. Le date negative sono escluse, non corrette.", fontsize=8, color=COLORS["grey"])
    save_figure(fig, "08_tempi_appalti")
    return quality, timing


def equity_tiers(regional: pd.DataFrame) -> pd.DataFrame:
    frame = regional.copy()
    labels = ["<20", "20--32,9", "33--39,9", "≥40"]
    frame["coverage_tier"] = pd.cut(
        frame["coverage_per_100"],
        bins=[-np.inf, 20, 33, 40, np.inf],
        right=False,
        labels=labels,
    )
    tiers = (
        frame.groupby("coverage_tier", observed=False)
        .agg(
            regions=("region", "size"),
            estimated_children_0_2=("estimated_children_0_2", "sum"),
            projects=("projects", "sum"),
            concluded=("concluded", "sum"),
            commissioning=("commissioning", "sum"),
            total_funding_eur=("total_funding_eur", "sum"),
            mature_funding_eur=("mature_funding_eur", "sum"),
        )
        .reset_index()
    )
    tiers["concluded_share"] = tiers["concluded"] / tiers["projects"]
    tiers["commissioning_share"] = tiers["commissioning"] / tiers["projects"]
    tiers["projects_per_100k_children"] = tiers["projects"] / tiers["estimated_children_0_2"] * 100_000
    tiers["funding_per_child"] = tiers["total_funding_eur"] / tiers["estimated_children_0_2"]
    tiers["mature_funding_per_child"] = tiers["mature_funding_eur"] / tiers["estimated_children_0_2"]
    tiers["mature_funding_share"] = tiers["mature_funding_eur"] / tiers["total_funding_eur"]

    x = np.arange(len(tiers))
    fig, axes = plt.subplots(1, 2, figsize=(11.3, 5.1), gridspec_kw={"wspace": 0.34})
    axes[0].bar(x, tiers["funding_per_child"], color=COLORS["light"], edgecolor=COLORS["blue"], label="Finanziamento associato")
    axes[0].bar(x, tiers["mature_funding_per_child"], color=COLORS["blue"], label="Associato a conclusi/collaudo")
    axes[0].set_xticks(x, tiers["coverage_tier"])
    axes[0].set_xlabel("Copertura iniziale: posti ogni 100 bambini")
    axes[0].set_ylabel("Euro per bambino 0--2 stimato")
    axes[0].set_title("Intensità finanziaria assegnata e maturata")
    axes[0].legend(frameon=False, fontsize=8.5)
    axes[0].grid(axis="y", alpha=0.18)

    width = 0.36
    axes[1].bar(x - width / 2, tiers["commissioning_share"] * 100, width, color=COLORS["teal"], label="Quota progetti maturi")
    axes[1].bar(x + width / 2, tiers["mature_funding_share"] * 100, width, color=COLORS["navy"], label="Quota fondi associata a maturi")
    axes[1].set_xticks(x, tiers["coverage_tier"])
    axes[1].set_xlabel("Copertura iniziale: posti ogni 100 bambini")
    axes[1].set_ylabel("Quota (%)")
    axes[1].set_title("Fattore di consegna amministrativa")
    axes[1].legend(frameon=False, fontsize=8.5)
    axes[1].grid(axis="y", alpha=0.18)
    fig.suptitle("La perequazione finanziaria si attenua lungo la pipeline", fontsize=14)
    fig.text(
        0.01,
        -0.02,
        "Il valore 'maturato' è finanziamento associato a progetti conclusi o in collaudo: non è spesa, posto certificato o servizio aperto.",
        fontsize=8,
        color=COLORS["grey"],
    )
    save_figure(fig, "09_equita_consegna")
    return tiers


def kaplan_meier_curve(duration: pd.Series, event: pd.Series) -> pd.DataFrame:
    data = pd.DataFrame({"duration": duration.astype(float), "event": event.astype(int)}).sort_values("duration")
    survival = 1.0
    rows = [{"day": 0.0, "survival": 1.0, "completion": 0.0, "at_risk": len(data), "events": 0}]
    for day in np.sort(data.loc[data["event"] == 1, "duration"].unique()):
        at_risk = int((data["duration"] >= day).sum())
        events = int(((data["duration"] == day) & (data["event"] == 1)).sum())
        survival *= 1 - events / at_risk
        rows.append({"day": float(day), "survival": survival, "completion": 1 - survival, "at_risk": at_risk, "events": events})
    # Extend only to the observed follow-up, never beyond it.
    if len(data) and float(data["duration"].max()) > rows[-1]["day"]:
        rows.append({"day": float(data["duration"].max()), "survival": survival, "completion": 1 - survival, "at_risk": int((data["duration"] == data["duration"].max()).sum()), "events": 0})
    return pd.DataFrame(rows)


def completion_time_analysis(projects: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    frame = projects.copy()
    frame["start_date"] = pd.to_datetime(frame["actual_start"], errors="coerce", utc=True).dt.tz_localize(None)
    frame["end_date"] = pd.to_datetime(frame["actual_end"], errors="coerce", utc=True).dt.tz_localize(None)
    frame = frame[frame["start_date"].between(pd.Timestamp("2021-01-01"), REFERENCE_DATE, inclusive="both")].copy()
    frame["event"] = (frame["concluded"].eq(1) & frame["end_date"].notna() & frame["end_date"].le(REFERENCE_DATE)).astype(int)
    frame["duration_days"] = np.where(
        frame["event"].eq(1),
        (frame["end_date"] - frame["start_date"]).dt.days,
        (REFERENCE_DATE - frame["start_date"]).dt.days,
    )
    frame = frame[frame["duration_days"].ge(0)].copy()

    curves = []
    group_order = ["Nuova realizzazione", "Ampliamento", "Ristrutturazione/recupero", "Demolizione/ricostruzione", "Altro"]
    for group_name, subset in [("Tutti", frame), *[(group, frame[frame["project_group"] == group]) for group in group_order]]:
        curve = kaplan_meier_curve(subset["duration_days"], subset["event"])
        curve["project_group"] = group_name
        curve["n_total"] = len(subset)
        curve["events_total"] = int(subset["event"].sum())
        curves.append(curve)
    curves_frame = pd.concat(curves, ignore_index=True)

    milestones = []
    for group_name in ["Tutti", *group_order]:
        subset = frame if group_name == "Tutti" else frame[frame["project_group"] == group_name]
        curve = curves_frame[curves_frame["project_group"] == group_name].sort_values("day")
        for years, day in ((1, 365), (2, 730), (3, 1095), (4, 1460)):
            prior = curve[curve["day"] <= day]
            completion = 0.0 if prior.empty else float(prior.iloc[-1]["completion"])
            milestones.append(
                {
                    "project_group": group_name,
                    "years": years,
                    "completion_probability": completion,
                    "at_risk": int((subset["duration_days"] >= day).sum()),
                    "n": len(subset),
                    "events": int(subset["event"].sum()),
                }
            )
    milestone_frame = pd.DataFrame(milestones)

    cohort = (
        projects[projects["start_year"].between(2021, 2026, inclusive="both")]
        .groupby("start_year")
        .agg(
            projects=("cup", "size"),
            concluded=("concluded", "sum"),
            commissioning=("commissioning_or_concluded", "sum"),
        )
        .reset_index()
    )
    cohort["concluded_share"] = cohort["concluded"] / cohort["projects"]
    cohort["commissioning_share"] = cohort["commissioning"] / cohort["projects"]

    fig, ax = plt.subplots(figsize=(9.4, 6.2))
    group_colors = {
        "Nuova realizzazione": COLORS["blue"],
        "Ampliamento": COLORS["green"],
        "Ristrutturazione/recupero": COLORS["teal"],
        "Demolizione/ricostruzione": COLORS["red"],
        "Altro": COLORS["amber"],
    }
    for group in group_order:
        curve = curves_frame[curves_frame["project_group"] == group]
        if curve.empty:
            continue
        ax.step(curve["day"] / 365.25, curve["completion"] * 100, where="post", color=group_colors[group], label=group, linewidth=1.8)
    ax.set_xlim(0, 4.1)
    ax.set_ylim(0, 45)
    ax.set_xlabel("Anni dall'avvio effettivo")
    ax.set_ylabel("Probabilità cumulata di conclusione registrata (%)")
    ax.set_title("Tempo alla conclusione registrata: stima Kaplan--Meier descrittiva")
    ax.grid(alpha=0.18)
    ax.legend(frameon=False, fontsize=8.5, loc="upper left")
    fig.text(
        0.01,
        -0.02,
        f"Avvii dal 2021; n={len(frame):,}, eventi={int(frame['event'].sum()):,}. I progetti non conclusi al 13 giugno 2026 sono censurati a destra; non è una previsione.".replace(",", "."),
        fontsize=8,
        color=COLORS["grey"],
    )
    save_figure(fig, "10_tempo_conclusione")
    return curves_frame, milestone_frame, cohort


def composition_adjusted_regions(projects: pd.DataFrame) -> pd.DataFrame:
    frame = projects[(projects["total_funding_eur"] > 0) & projects["start_year"].notna() & projects["region"].notna()].copy()
    frame["log2_funding"] = np.log2(frame["total_funding_eur"] / 1_000_000)
    frame["log2_tenders_plus1"] = np.log2(frame["tender_count"] + 1)
    frame["start_year_c"] = frame["start_year"] - 2021
    formula = (
        "commissioning_or_concluded ~ log2_funding + "
        "C(project_group, Treatment(reference='Nuova realizzazione')) + existing + "
        "start_year_c + log2_tenders_plus1 + has_works_tender"
    )
    model = smf.glm(formula=formula, data=frame, family=sm.families.Binomial()).fit()
    frame["expected_probability"] = model.predict(frame)
    adjusted = (
        frame.groupby("region")
        .agg(
            complete_cases=("cup", "size"),
            actual_mature=("commissioning_or_concluded", "sum"),
            expected_mature=("expected_probability", "sum"),
            actual_share=("commissioning_or_concluded", "mean"),
            expected_share=("expected_probability", "mean"),
        )
        .reset_index()
    )
    adjusted["composition_gap"] = adjusted["actual_share"] - adjusted["expected_share"]

    view = adjusted.sort_values("composition_gap").reset_index(drop=True)
    y = np.arange(len(view))
    colors = np.where(view["composition_gap"].ge(0), COLORS["teal"], COLORS["red"])
    fig, ax = plt.subplots(figsize=(8.5, 7.8))
    ax.hlines(y, 0, view["composition_gap"] * 100, color=colors, linewidth=2.5)
    ax.scatter(view["composition_gap"] * 100, y, color=colors, s=38)
    ax.axvline(0, color=COLORS["grey"], linewidth=1)
    ax.set_yticks(y, [f"{region} (n={int(n)})" for region, n in zip(view["region"], view["complete_cases"])])
    ax.set_xlabel("Quota osservata meno quota attesa (punti percentuali)")
    ax.set_title("Scarto regionale dopo l'aggiustamento per composizione dei progetti")
    ax.grid(axis="x", alpha=0.18)
    fig.text(
        0.01,
        -0.01,
        "Valori attesi da un modello pooled di scala, tipo, progetto esistente, anno e gare. Residui descrittivi in-sample: non effetti regionali né graduatoria di performance.",
        fontsize=8,
        color=COLORS["grey"],
    )
    save_figure(fig, "11_regioni_aggiustate")
    return adjusted


def monitoring_priorities(projects: pd.DataFrame, limit: int = 15) -> pd.DataFrame:
    priority = projects[projects["maturity"].isin(["Esecuzione lavori", "Fase non disponibile"])].copy()
    priority = priority.sort_values(["total_funding_eur", "cup"], ascending=[False, True]).head(limit)
    return priority[["cup", "region", "maturity", "total_funding_eur", "actual_start", "tender_count"]]


def completeness(projects: pd.DataFrame, tenders: pd.DataFrame) -> pd.DataFrame:
    metrics = [
        ("Progetti", "Regione", projects["region"].notna().mean()),
        ("Progetti", "Finanziamento totale", (projects["total_funding_eur"] > 0).mean()),
        ("Progetti", "Data inizio effettiva", projects["actual_start"].notna().mean()),
        ("Progetti", "Data fine effettiva", projects["actual_end"].notna().mean()),
        ("Progetti", "Fase disponibile", (projects["maturity"] != "Fase non disponibile").mean()),
        ("Progetti", "Almeno una procedura", projects["has_tenders"].mean()),
        ("Procedure", "CIG", tenders["has_cig"].mean()),
        ("Procedure", "Importo a base", tenders["has_amount"].mean()),
        ("Procedure", "Importo aggiudicato", tenders["has_award_amount"].mean()),
        ("Procedure", "Data pubblicazione", tenders["has_published_at"].mean()),
        ("Procedure", "Data aggiudicazione", tenders["has_awarded_at"].mean()),
        ("Procedure", "Tipo procedura", tenders["has_procedure"].mean()),
        ("Procedure", "Tipo contratto", tenders["has_contract_type"].mean()),
    ]
    frame = pd.DataFrame(metrics, columns=["level", "metric", "share"])
    frame = frame.sort_values(["level", "share"], ascending=[True, True]).reset_index(drop=True)
    y = np.arange(len(frame))
    colors = frame["level"].map({"Progetti": COLORS["blue"], "Procedure": COLORS["teal"]})
    fig, ax = plt.subplots(figsize=(8.3, 6.4))
    ax.hlines(y, 0, frame["share"] * 100, color=COLORS["light"], linewidth=3)
    ax.scatter(frame["share"] * 100, y, color=colors, s=45)
    ax.set_yticks(y, [f"{metric}  [{level.lower()}]" for metric, level in zip(frame["metric"], frame["level"])])
    ax.set_xlim(0, 105)
    ax.set_xlabel("Record con informazione disponibile (%)")
    ax.set_title("Quello che il monitoraggio misura — e quello che manca")
    ax.grid(axis="x", alpha=0.18)
    for index, share in enumerate(frame["share"]):
        ax.text(share * 100 + 1.0, index, f"{share:.1%}", va="center", fontsize=9)
    fig.text(0.01, -0.01, "La completezza tecnica non colma l'assenza di una variabile pubblica sui posti creati e certificati.", fontsize=8, color=COLORS["grey"])
    save_figure(fig, "05_completezza")
    return frame


def fit_models(projects: pd.DataFrame, istat: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    model_data = projects.merge(istat[["region", "coverage_per_100"]], on="region", how="left", validate="many_to_one").copy()
    model_data = model_data[(model_data["total_funding_eur"] > 0) & model_data["start_year"].notna() & model_data["coverage_per_100"].notna()].copy()
    model_data["log2_funding"] = np.log2(model_data["total_funding_eur"] / 1_000_000)
    model_data["log2_tenders_plus1"] = np.log2(model_data["tender_count"] + 1)
    model_data["coverage_10pp"] = model_data["coverage_per_100"] / 10
    model_data["start_year_c"] = model_data["start_year"] - 2021

    common = (
        "log2_funding + C(project_group, Treatment(reference='Nuova realizzazione')) + "
        "existing + start_year_c + log2_tenders_plus1 + has_works_tender"
    )
    formulas = {
        "Concluso": f"concluded ~ {common} + coverage_10pp",
        "Concluso o in collaudo": f"commissioning_or_concluded ~ {common} + coverage_10pp",
    }
    models = {
        label: smf.glm(formula=formula, data=model_data, family=sm.families.Binomial()).fit(
            cov_type="cluster", cov_kwds={"groups": model_data["region"]}
        )
        for label, formula in formulas.items()
    }
    fe_models = {
        "Concluso": smf.glm(formula=f"concluded ~ {common} + C(region)", data=model_data, family=sm.families.Binomial()).fit(cov_type="HC1"),
        "Concluso o in collaudo": smf.glm(formula=f"commissioning_or_concluded ~ {common} + C(region)", data=model_data, family=sm.families.Binomial()).fit(cov_type="HC1"),
    }

    rows = []
    for label, model in models.items():
        conf = model.conf_int()
        for term, coefficient in model.params.items():
            if term == "Intercept":
                continue
            rows.append(
                {
                    "outcome": label,
                    "term": term,
                    "odds_ratio": math.exp(coefficient),
                    "ci_low": math.exp(conf.loc[term, 0]),
                    "ci_high": math.exp(conf.loc[term, 1]),
                    "p_value": model.pvalues[term],
                    "n": int(model.nobs),
                    "aic": model.aic,
                }
            )
    results = pd.DataFrame(rows)

    fe_rows = []
    for label, model in fe_models.items():
        conf = model.conf_int()
        for term, coefficient in model.params.items():
            if term == "Intercept" or term.startswith("C(region)"):
                continue
            fe_rows.append(
                {
                    "outcome": label,
                    "term": term,
                    "odds_ratio": math.exp(coefficient),
                    "ci_low": math.exp(conf.loc[term, 0]),
                    "ci_high": math.exp(conf.loc[term, 1]),
                    "p_value": model.pvalues[term],
                    "n": int(model.nobs),
                    "aic": model.aic,
                }
            )
    fe_results = pd.DataFrame(fe_rows)

    labels = {
        "log2_funding": "Finanziamento: raddoppio",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Altro]": "Altro vs nuova realizzazione",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Ampliamento]": "Ampliamento vs nuova realizzazione",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Demolizione/ricostruzione]": "Demolizione vs nuova realizzazione",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Ristrutturazione/recupero]": "Ristrutturazione vs nuova realizzazione",
        "existing": "Progetto già esistente",
        "start_year_c": "Anno di avvio: +1",
        "log2_tenders_plus1": "Procedure +1: raddoppio",
        "has_works_tender": "Almeno una gara lavori",
        "coverage_10pp": "Copertura nidi regionale: +10 p.p.",
    }
    plot_data = results[results["term"].isin(labels)].copy()
    plot_data["label"] = plot_data["term"].map(labels)
    label_order = list(reversed(list(labels.values())))

    fig, ax = plt.subplots(figsize=(9.0, 6.8))
    offsets = {"Concluso": -0.13, "Concluso o in collaudo": 0.13}
    outcome_colors = {"Concluso": COLORS["green"], "Concluso o in collaudo": COLORS["teal"]}
    for outcome in ("Concluso", "Concluso o in collaudo"):
        subset = plot_data[plot_data["outcome"] == outcome].set_index("label").reindex(label_order).dropna().reset_index()
        y = np.array([label_order.index(value) for value in subset["label"]]) + offsets[outcome]
        ax.errorbar(
            subset["odds_ratio"],
            y,
            xerr=np.vstack([subset["odds_ratio"] - subset["ci_low"], subset["ci_high"] - subset["odds_ratio"]]),
            fmt="o",
            capsize=2,
            color=outcome_colors[outcome],
            label=outcome,
        )
    ax.axvline(1, color=COLORS["grey"], linewidth=1, linestyle="--")
    ax.set_xscale("log")
    ax.set_yticks(np.arange(len(label_order)), label_order)
    ax.set_xlabel("Odds ratio con intervallo robusto al 95% (scala logaritmica)")
    ax.set_title("Associazioni condizionate, non effetti causali")
    ax.grid(axis="x", alpha=0.18)
    ax.legend(frameon=False)
    fig.text(0.01, -0.01, f"Regressioni logistiche su {len(model_data):,} progetti con covariate complete; errori standard raggruppati per regione.".replace(",", "."), fontsize=8, color=COLORS["grey"])
    save_figure(fig, "06_modelli")

    fit_summary = {
        label: {"n": int(model.nobs), "aic": model.aic, "deviance": model.deviance}
        for label, model in models.items()
    }
    fit_summary["region_fixed_effects"] = {
        label: {"n": int(model.nobs), "aic": model.aic, "deviance": model.deviance}
        for label, model in fe_models.items()
    }
    return results, fe_results, fit_summary


def sensitivity_checks(projects: pd.DataFrame, full_measure: pd.DataFrame) -> pd.DataFrame:
    checks = []
    base_n = len(projects)
    checks.append({"check": "Campione completo", "n": base_n, "outcome": "Concluso", "share": projects["concluded"].mean()})
    checks.append({"check": "Campione completo", "n": base_n, "outcome": "Concluso o in collaudo", "share": projects["commissioning_or_concluded"].mean()})
    checks.append({"check": "Campione completo", "n": base_n, "outcome": "Data fine effettiva presente", "share": projects["actual_end_recorded"].mean()})
    known_phase = projects[projects["maturity"] != "Fase non disponibile"]
    checks.append({"check": "Esclusa fase non disponibile", "n": len(known_phase), "outcome": "Concluso o in collaudo", "share": known_phase["commissioning_or_concluded"].mean()})
    early = projects[projects["start_year"].le(2023)]
    checks.append({"check": "Avvio entro il 2023", "n": len(early), "outcome": "Concluso", "share": early["concluded"].mean()})
    checks.append({"check": "Avvio entro il 2023", "n": len(early), "outcome": "Concluso o in collaudo", "share": early["commissioning_or_concluded"].mean()})
    checks.append({"check": "Intera misura 0–6", "n": len(full_measure), "outcome": "Concluso", "share": full_measure["concluded"].mean()})
    checks.append({"check": "Intera misura 0–6", "n": len(full_measure), "outcome": "Concluso o in collaudo", "share": full_measure["commissioning_or_concluded"].mean()})
    return pd.DataFrame(checks)


def make_tables(
    projects: pd.DataFrame,
    tenders: pd.DataFrame,
    pipeline: pd.DataFrame,
    regional: pd.DataFrame,
    completeness_frame: pd.DataFrame,
    models: pd.DataFrame,
    sensitivity: pd.DataFrame,
    full_measure: pd.DataFrame,
    procedure_mix: pd.DataFrame,
    contract_mix: pd.DataFrame,
    timing_quality: pd.DataFrame,
    timing_stats: pd.DataFrame,
    tiers: pd.DataFrame,
    km_milestones: pd.DataFrame,
    cohort: pd.DataFrame,
    adjusted_regions: pd.DataFrame,
    priorities: pd.DataFrame,
) -> None:
    concluded = int(projects["concluded"].sum())
    commissioning = int(projects["commissioning_or_concluded"].sum())
    summary_rows = [
        ["Campione principale: asili nido", f"{len(projects):,}".replace(",", "."), "progetti"],
        ["Intera misura M4C1-18", f"{len(full_measure):,}".replace(",", "."), "controllo 0–6 anni"],
        ["Comuni interessati", f"{projects['municipality_key'].nunique():,}".replace(",", "."), "codici ISTAT composti"],
        ["Finanziamento totale associato", f"€{projects['total_funding_eur'].sum()/1e9:.2f}", "miliardi"],
        ["Finanziamento PNRR associato", f"€{projects['pnrr_funding_eur'].sum()/1e9:.2f}", "miliardi"],
        ["Progetti conclusi", f"{concluded:,} ({concluded/len(projects):.1%})".replace(",", "."), "stato amministrativo"],
        ["Conclusi o in collaudo", f"{commissioning:,} ({commissioning/len(projects):.1%})".replace(",", "."), "stato amministrativo"],
        ["Procedure di gara collegate", f"{len(tenders):,}".replace(",", "."), "righe procedura"],
        ["Progetti con almeno una procedura", f"{projects['has_tenders'].sum():,} ({projects['has_tenders'].mean():.1%})".replace(",", "."), "progetti"],
    ]
    write_table(TABLE_DIR / "summary.tex", ["Indicatore", "Valore", "Unità/nota"], summary_rows, "lrl")

    pipeline_rows = []
    for _, row in pipeline.iterrows():
        pipeline_rows.append(
            [
                row["maturity"],
                f"{int(row['projects']):,}".replace(",", "."),
                f"{row['project_share']:.1%}",
                f"{row['funding']/1e9:.2f}",
                f"{row['funding_share']:.1%}",
            ]
        )
    write_table(TABLE_DIR / "pipeline.tex", ["Stato", "Progetti", "Quota", "Mld €", "Quota fondi"], pipeline_rows, "lrrrr")

    region_rows = []
    for _, row in regional.sort_values("region").iterrows():
        region_rows.append(
            [
                row["region"],
                f"{int(row['projects'])}",
                f"{row['concluded_share']:.1%}",
                f"{row['commissioning_share']:.1%}",
                f"{row['coverage_per_100']:.1f}",
                f"{row['funding_per_child']:.0f}",
            ]
        )
    write_table(TABLE_DIR / "regions.tex", ["Regione", "N", "Conclusi", "Conclusi/collaudo", "Copertura", "€/bambino"], region_rows, "lrrrrr")

    complete_rows = [[row["level"], row["metric"], f"{row['share']:.1%}"] for _, row in completeness_frame.iterrows()]
    write_table(TABLE_DIR / "completeness.tex", ["Livello", "Campo", "Disponibile"], complete_rows, "llr")

    display_terms = {
        "log2_funding": "Finanziamento (raddoppio)",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Ampliamento]": "Ampliamento",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Demolizione/ricostruzione]": "Demolizione/ricostruzione",
        "C(project_group, Treatment(reference='Nuova realizzazione'))[T.Ristrutturazione/recupero]": "Ristrutturazione/recupero",
        "existing": "Progetto esistente",
        "start_year_c": "Anno di avvio (+1)",
        "log2_tenders_plus1": "Procedure +1 (raddoppio)",
        "has_works_tender": "Almeno una gara lavori",
        "coverage_10pp": "Copertura regionale (+10 p.p.)",
    }
    model_rows = []
    for term, label in display_terms.items():
        entries = []
        for outcome in ("Concluso", "Concluso o in collaudo"):
            found = models[(models["term"] == term) & (models["outcome"] == outcome)]
            if found.empty:
                entries.append("—")
            else:
                row = found.iloc[0]
                stars = "***" if row["p_value"] < 0.001 else "**" if row["p_value"] < 0.01 else "*" if row["p_value"] < 0.05 else ""
                entries.append(f"{row['odds_ratio']:.2f}{stars} [{row['ci_low']:.2f}; {row['ci_high']:.2f}]")
        model_rows.append([label, *entries])
    write_table(TABLE_DIR / "models.tex", ["Covariata", "Concluso", "Concluso/collaudo"], model_rows, "lcc")

    sensitivity_rows = [
        [row["check"], f"{int(row['n']):,}".replace(",", "."), row["outcome"], f"{row['share']:.1%}"]
        for _, row in sensitivity.iterrows()
    ]
    write_table(TABLE_DIR / "sensitivity.tex", ["Campione", "N", "Esito", "Quota"], sensitivity_rows, "lrlr")

    procedure_rows = [
        [
            row["procedure_group"],
            f"{int(row['procedures']):,}".replace(",", "."),
            f"{row['number_share']:.1%}",
            f"{row['base_amount_eur']/1e6:.1f}",
            f"{row['value_share']:.1%}",
        ]
        for _, row in procedure_mix.iterrows()
    ]
    write_table(
        TABLE_DIR / "procurement_number_value.tex",
        ["Modalità", "Righe", "Quota N", "Base mln €", "Quota valore"],
        procedure_rows,
        "lrrrr",
    )

    contract_rows = [
        [
            row["contract_group"],
            f"{int(row['procedures']):,}".replace(",", "."),
            f"{row['number_share']:.1%}",
            f"{row['base_amount_eur']/1e6:.1f}",
            f"{row['value_share']:.1%}",
        ]
        for _, row in contract_mix.iterrows()
    ]
    write_table(
        TABLE_DIR / "contract_number_value.tex",
        ["Tipo contratto", "Righe", "Quota N", "Base mln €", "Quota valore"],
        contract_rows,
        "lrrrr",
    )

    timing_quality_rows = [
        [row["quality_group"], f"{int(row['procedures']):,}".replace(",", "."), f"{row['share']:.1%}"]
        for _, row in timing_quality.iterrows()
    ]
    write_table(TABLE_DIR / "timing_quality.tex", ["Esito controllo date", "Righe", "Quota"], timing_quality_rows, "lrr")

    timing_rows = [
        [
            row["procedure_group"],
            f"{int(row['n']):,}".replace(",", "."),
            f"{row['p25']:.0f}",
            f"{row['median']:.0f}",
            f"{row['p75']:.0f}",
            f"{row['p90']:.0f}",
        ]
        for _, row in timing_stats.iterrows()
    ]
    write_table(TABLE_DIR / "procurement_timing.tex", ["Modalità", "N", "P25", "Mediana", "P75", "P90"], timing_rows, "lrrrrr")

    tier_rows = [
        [
            row["coverage_tier"],
            f"{int(row['regions'])}",
            f"{int(row['projects']):,}".replace(",", "."),
            f"{row['funding_per_child']:.0f}",
            f"{row['mature_funding_per_child']:.0f}",
            f"{row['commissioning_share']:.1%}",
            f"{row['mature_funding_share']:.1%}",
        ]
        for _, row in tiers.iterrows()
    ]
    write_table(
        TABLE_DIR / "equity_tiers.tex",
        ["Copertura", "Regioni", "Progetti", "€/bambino", "€/bambino maturi", "Progetti maturi", "Fondi maturi"],
        tier_rows,
        "lrrrrrr",
    )

    km_rows = []
    for group in ["Tutti", "Nuova realizzazione", "Ampliamento", "Ristrutturazione/recupero", "Demolizione/ricostruzione", "Altro"]:
        subset = km_milestones[km_milestones["project_group"] == group]
        row = [group, f"{int(subset.iloc[0]['n']):,}".replace(",", "."), f"{int(subset.iloc[0]['events']):,}".replace(",", ".")]
        for years in (1, 2, 3, 4):
            point = subset[subset["years"] == years].iloc[0]
            row.append(f"{point['completion_probability']:.1%} ({int(point['at_risk']):,})".replace(",", "."))
        km_rows.append(row)
    write_table(
        TABLE_DIR / "km_completion.tex",
        ["Tipo", "N", "Eventi", "1 anno", "2 anni", "3 anni", "4 anni"],
        km_rows,
        "lrrrrrr",
    )

    cohort_rows = [
        [
            f"{int(row['start_year'])}",
            f"{int(row['projects']):,}".replace(",", "."),
            f"{int(row['concluded']):,}".replace(",", "."),
            f"{row['concluded_share']:.1%}",
            f"{row['commissioning_share']:.1%}",
        ]
        for _, row in cohort.iterrows()
    ]
    write_table(TABLE_DIR / "start_cohorts.tex", ["Avvio", "N", "Conclusi", "Quota conclusa", "Conclusi/collaudo"], cohort_rows, "lrrrr")

    adjusted_rows = [
        [
            row["region"],
            f"{int(row['complete_cases'])}",
            f"{row['actual_share']:.1%}",
            f"{row['expected_share']:.1%}",
            f"{row['composition_gap']*100:+.1f}",
        ]
        for _, row in adjusted_regions.sort_values("composition_gap", ascending=False).iterrows()
    ]
    write_table(TABLE_DIR / "regional_adjusted.tex", ["Regione", "N", "Osservata", "Attesa", "Scarto p.p."], adjusted_rows, "lrrrr")

    priority_rows = [
        [
            row["cup"],
            row["region"],
            row["maturity"],
            f"{row['total_funding_eur']/1e6:.1f}",
            text(row["actual_start"])[:10] or "n.d.",
            f"{int(row['tender_count'])}",
        ]
        for _, row in priorities.iterrows()
    ]
    write_table(TABLE_DIR / "monitoring_priorities.tex", ["CUP", "Regione", "Stato", "Mln €", "Avvio", "Gare"], priority_rows, "lllrrr")


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    source_bytes = SOURCE_PATH.read_bytes() if SOURCE_PATH.exists() else b""
    if hashlib.sha256(source_bytes).hexdigest() != manifest["local_snapshot_sha256"]:
        # A new live snapshot must not silently rewrite a historical paper.
        source_bytes = subprocess.check_output(
            ["git", "show", f"{SOURCE_COMMIT}:src/data/generated/pnrr-childcare.data.json"],
            cwd=REPO_DIR,
        )
    actual_sha = hashlib.sha256(source_bytes).hexdigest()
    if actual_sha != manifest["local_snapshot_sha256"]:
        raise RuntimeError(f"Hash snapshot inatteso: {actual_sha}")

    payload = json.loads(source_bytes)
    full_projects, full_tenders = project_rows(payload)
    full_projects["maturity"] = pd.Categorical(full_projects["maturity"], categories=MATURITY_ORDER, ordered=True)
    if len(full_projects) != manifest["coverage"]["projects"]:
        raise RuntimeError("Il numero di progetti non coincide con il manifest MCP")
    if len(full_tenders) != manifest["coverage"]["tender_rows"]:
        raise RuntimeError("Il numero di procedure non coincide con il manifest MCP")
    if round(full_projects["total_funding_eur"].sum() * 100) != manifest["totals_cents"]["total_funding"]:
        raise RuntimeError("Il totale finanziamenti non coincide con il manifest MCP")

    projects = full_projects[full_projects["category"] == "ASILI NIDO"].copy()
    tenders = full_tenders[full_tenders["cup"].isin(projects["cup"])].copy()
    if len(projects) != 2980:
        raise RuntimeError("La popolazione principale ASILI NIDO non ha la numerosità attesa")

    istat = pd.read_csv(ISTAT_PATH)
    full_projects.to_csv(GENERATED_DIR / "projects_full_measure_analytic.csv", index=False)
    projects.to_csv(GENERATED_DIR / "projects_analytic.csv", index=False)
    tenders.to_csv(GENERATED_DIR / "tenders_analytic.csv", index=False)

    pipeline = plot_pipeline(projects)
    regional = regional_frame(projects, istat)
    regional.to_csv(GENERATED_DIR / "regional_summary.csv", index=False)
    plot_regions(regional)
    correlations = plot_coverage(regional)
    procurement = plot_procurement(projects, tenders)
    procurement.to_csv(GENERATED_DIR / "procurement_by_maturity.csv", index=False)
    procedure_mix, contract_mix = procurement_number_value(tenders)
    procedure_mix.to_csv(GENERATED_DIR / "procurement_procedure_number_value.csv", index=False)
    contract_mix.to_csv(GENERATED_DIR / "procurement_contract_number_value.csv", index=False)
    timing_quality, timing_stats = procurement_timing(tenders)
    timing_quality.to_csv(GENERATED_DIR / "procurement_timing_quality.csv", index=False)
    timing_stats.to_csv(GENERATED_DIR / "procurement_timing_stats.csv", index=False)
    completeness_frame = completeness(projects, tenders)
    completeness_frame.to_csv(GENERATED_DIR / "completeness.csv", index=False)
    models, fe_models, fit_summary = fit_models(projects, istat)
    models.to_csv(GENERATED_DIR / "models_odds_ratios.csv", index=False)
    fe_models.to_csv(GENERATED_DIR / "models_region_fe_odds_ratios.csv", index=False)
    sensitivity = sensitivity_checks(projects, full_projects)
    sensitivity.to_csv(GENERATED_DIR / "sensitivity.csv", index=False)
    tiers = equity_tiers(regional)
    tiers.to_csv(GENERATED_DIR / "equity_tiers.csv", index=False)
    km_curves, km_milestones, cohort = completion_time_analysis(projects)
    km_curves.to_csv(GENERATED_DIR / "km_curves.csv", index=False)
    km_milestones.to_csv(GENERATED_DIR / "km_milestones.csv", index=False)
    cohort.to_csv(GENERATED_DIR / "start_cohorts.csv", index=False)
    adjusted_regions = composition_adjusted_regions(projects)
    adjusted_regions.to_csv(GENERATED_DIR / "regional_composition_adjusted.csv", index=False)
    priorities = monitoring_priorities(projects)
    priorities.to_csv(GENERATED_DIR / "monitoring_priorities.csv", index=False)

    if int(procedure_mix["procedures"].sum()) != len(tenders):
        raise RuntimeError("Le classi di procedura non ricostruiscono il denominatore")
    if int(contract_mix["procedures"].sum()) != len(tenders):
        raise RuntimeError("Le classi di contratto non ricostruiscono il denominatore")
    if int(timing_quality["procedures"].sum()) != len(tenders):
        raise RuntimeError("Gli esiti del controllo date non ricostruiscono il denominatore")
    if int(tiers["projects"].sum()) != len(projects) or int(tiers["regions"].sum()) != 20:
        raise RuntimeError("Le fasce territoriali non ricostruiscono campione e regioni")
    if adjusted_regions["region"].nunique() != 20:
        raise RuntimeError("Il confronto aggiustato non copre tutte le regioni")

    duration_frame = projects.copy()
    duration_frame["start_date"] = pd.to_datetime(duration_frame["actual_start"], errors="coerce", utc=True).dt.tz_localize(None)
    duration_frame["end_date"] = pd.to_datetime(duration_frame["actual_end"], errors="coerce", utc=True).dt.tz_localize(None)
    completed_duration = (duration_frame.loc[duration_frame["concluded"].eq(1), "end_date"] - duration_frame.loc[duration_frame["concluded"].eq(1), "start_date"]).dt.days.dropna()
    open_duration = (REFERENCE_DATE - duration_frame.loc[duration_frame["concluded"].eq(0), "start_date"]).dt.days.dropna()
    duration_summary = {
        "completed": {
            "n": int(len(completed_duration)),
            "p25_days": float(completed_duration.quantile(0.25)),
            "median_days": float(completed_duration.median()),
            "p75_days": float(completed_duration.quantile(0.75)),
            "p90_days": float(completed_duration.quantile(0.90)),
        },
        "open_elapsed": {
            "n": int(len(open_duration)),
            "p25_days": float(open_duration.quantile(0.25)),
            "median_days": float(open_duration.median()),
            "p75_days": float(open_duration.quantile(0.75)),
            "p90_days": float(open_duration.quantile(0.90)),
        },
    }
    make_tables(
        projects,
        tenders,
        pipeline,
        regional,
        completeness_frame,
        models,
        sensitivity,
        full_projects,
        procedure_mix,
        contract_mix,
        timing_quality,
        timing_stats,
        tiers,
        km_milestones,
        cohort,
        adjusted_regions,
        priorities,
    )

    summary = {
        "source": {
            "dataset": payload.get("dataset"),
            "reference_date": payload.get("referenceDate"),
            "snapshot_sha256": actual_sha,
            "projects_full_measure": len(full_projects),
            "tenders_full_measure": len(full_tenders),
            "projects_primary_sample": len(projects),
            "tenders_primary_sample": len(tenders),
        },
        "headline": {
            "concluded": int(projects["concluded"].sum()),
            "concluded_share": projects["concluded"].mean(),
            "commissioning_or_concluded": int(projects["commissioning_or_concluded"].sum()),
            "commissioning_or_concluded_share": projects["commissioning_or_concluded"].mean(),
            "actual_end_recorded": int(projects["actual_end_recorded"].sum()),
            "actual_end_recorded_share": projects["actual_end_recorded"].mean(),
            "total_funding_eur": projects["total_funding_eur"].sum(),
            "pnrr_funding_eur": projects["pnrr_funding_eur"].sum(),
            "projects_with_tenders": int(projects["has_tenders"].sum()),
        },
        "full_measure_robustness": {
            "projects": len(full_projects),
            "concluded": int(full_projects["concluded"].sum()),
            "concluded_share": full_projects["concluded"].mean(),
            "commissioning_or_concluded": int(full_projects["commissioning_or_concluded"].sum()),
            "commissioning_or_concluded_share": full_projects["commissioning_or_concluded"].mean(),
        },
        "pipeline": pipeline.to_dict(orient="records"),
        "correlations": correlations,
        "model_fit": fit_summary,
        "procurement": {
            "procedure_number_value": procedure_mix.to_dict(orient="records"),
            "contract_number_value": contract_mix.to_dict(orient="records"),
            "timing_quality": timing_quality.to_dict(orient="records"),
            "timing_stats": timing_stats.to_dict(orient="records"),
        },
        "delivery_equity": tiers.to_dict(orient="records"),
        "time_to_completion": {
            "recorded_duration": duration_summary,
            "milestones": km_milestones.to_dict(orient="records"),
            "start_cohorts": cohort.to_dict(orient="records"),
        },
        "regional_composition_adjusted": adjusted_regions.to_dict(orient="records"),
        "limitations": [
            "Nessuna variabile pubblica nel dataset misura i posti creati o certificati.",
            "Le associazioni tra appalti e avanzamento non hanno interpretazione causale.",
            "La copertura ISTAT e regionale e riferita al 2023/24; il progetto e l'unita micro.",
            "Finanziamenti e importi di gara non equivalgono a pagamenti erogati.",
        ],
    }
    (GENERATED_DIR / "analysis_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary["headline"], ensure_ascii=False, indent=2))
    print(json.dumps(correlations, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
