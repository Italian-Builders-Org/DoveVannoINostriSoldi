#!/usr/bin/env python3
"""Riproduce analisi, tabelle e figure del paper PNRR prima infanzia."""

from __future__ import annotations

import hashlib
import json
import math
import re
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


def text(value: object) -> str:
    return "" if value is None else str(value).strip()


def parse_year(value: object) -> float:
    match = re.match(r"^(\d{4})", text(value))
    return float(match.group(1)) if match else np.nan


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
                    "is_direct": int("AFFIDAMENTO DIRETTO" in text(tender.get("procedure")).upper()),
                    "is_works": int("LAVORI" in text(tender.get("contractType")).upper()),
                    "is_framework": int(
                        bool(tender.get("frameworkCig"))
                        or "ACCORDO QUADRO" in text(tender.get("deliveryMode")).upper()
                    ),
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
            }
        )
    regional = pd.DataFrame(rows).merge(istat, on="region", how="left", validate="one_to_one")
    regional["estimated_children_0_2"] = regional["authorized_places"] / (regional["coverage_per_100"] / 100)
    regional["funding_per_child"] = regional["total_funding_eur"] / regional["estimated_children_0_2"]
    regional["projects_per_100k_children"] = regional["projects"] / regional["estimated_children_0_2"] * 100_000
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
    axes[0].set_title(f"Copertura preesistente e avanzamento\nSpearman ρ={rho_comm:.2f}, p={p_comm:.3f}")
    axes[0].grid(alpha=0.18)

    axes[1].scatter(usable["coverage_per_100"], usable["funding_per_child"], s=sizes, color=COLORS["blue"], alpha=0.75, edgecolor="white")
    axes[1].set_xlabel("Posti autorizzati ogni 100 bambini, 2023/24")
    axes[1].set_ylabel("Finanziamento associato per bambino 0–2 stimato (€)")
    axes[1].set_title(f"Copertura preesistente e intensità finanziaria\nSpearman ρ={rho_fund:.2f}, p={p_fund:.3f}")
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


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    actual_sha = sha256(SOURCE_PATH)
    if actual_sha != manifest["local_snapshot_sha256"]:
        raise RuntimeError(f"Hash snapshot inatteso: {actual_sha}")

    payload = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
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
    completeness_frame = completeness(projects, tenders)
    completeness_frame.to_csv(GENERATED_DIR / "completeness.csv", index=False)
    models, fe_models, fit_summary = fit_models(projects, istat)
    models.to_csv(GENERATED_DIR / "models_odds_ratios.csv", index=False)
    fe_models.to_csv(GENERATED_DIR / "models_region_fe_odds_ratios.csv", index=False)
    sensitivity = sensitivity_checks(projects, full_projects)
    sensitivity.to_csv(GENERATED_DIR / "sensitivity.csv", index=False)
    make_tables(projects, tenders, pipeline, regional, completeness_frame, models, sensitivity, full_projects)

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
