#!/usr/bin/env python3
"""Additional descriptive sensitivity checks; no causal interpretation."""
import json
import pandas as pd
from scipy.stats import spearmanr

from analyze import GENERATED_DIR, TABLE_DIR, write_table


def main():
    projects = pd.read_csv(GENERATED_DIR / "projects_analytic.csv")
    regional = pd.read_csv(GENERATED_DIR / "regional_summary.csv")
    rows = []
    for column, label in [
        ("commissioning_share", "Quota almeno in collaudo"),
        ("concluded_share", "Quota conclusa"),
        ("funding_per_child", "Fondi totali per bambino"),
    ]:
        values = [float(spearmanr(sub["coverage_per_100"], sub[column]).statistic)
                  for index in regional.index for sub in [regional.drop(index)]]
        rows.append({"indicator": label,
                     "rho": float(spearmanr(regional["coverage_per_100"], regional[column]).statistic),
                     "loo_min": min(values), "loo_max": max(values)})
    pd.DataFrame(rows).to_csv(GENERATED_DIR / "regional_leave_one_out.csv", index=False)
    write_table(TABLE_DIR / "regional_leave_one_out.tex",
                ["Indicatore", "Rho (20 regioni)", "Min LOO", "Max LOO"],
                [[v["indicator"], *[f'{v[k]:.3f}'.replace(".", ",") for k in ["rho", "loo_min", "loo_max"]]] for v in rows], "lrrr")
    joined = projects.merge(regional[["region", "coverage_per_100"]], on="region", validate="many_to_one")
    joined["tier"] = pd.cut(joined["coverage_per_100"], [0, 20, 33, 40, 100],
                             labels=["<20", "20--32,9", "33--39,9", ">=40"], right=False)
    funds = []
    for tier, sub in joined.groupby("tier", observed=True):
        for column in ["total_funding_eur", "pnrr_funding_eur"]:
            funds.append({"tier": str(tier), "funding_basis": column,
                          "mature_share": float(sub.loc[sub["commissioning_or_concluded"].eq(1), column].sum() / sub[column].sum())})
    pd.DataFrame(funds).to_csv(GENERATED_DIR / "funding_basis_sensitivity.csv", index=False)
    write_table(TABLE_DIR / "funding_basis_sensitivity.tex", ["Copertura", "Fondi totali: maturi", "Fondi PNRR: maturi"],
                [[str(tier), *[f"{100 * row['mature_share']:.1f}%".replace(".", ",") for row in funds if row["tier"] == str(tier)]]
                 for tier in joined["tier"].cat.categories], "lrr")
    tenders = pd.read_csv(GENERATED_DIR / "tenders_analytic.csv")
    timing = []
    for cap in [365, 730, None]:
        valid = tenders["award_days"].ge(0)
        if cap is not None:
            valid &= tenders["award_days"].le(cap)
        sample = tenders.loc[valid, "award_days"]
        timing.append({"cap_days": cap, "n": len(sample), "median": float(sample.median())})
    result = {"leave_one_out": rows, "funding_basis": funds, "timing_caps": timing,
              "unknown_phase": int(projects["maturity"].eq("Fase non disponibile").sum()),
              "mature_lower": float(projects["commissioning_or_concluded"].mean()),
              "mature_upper_unknown": float((projects["commissioning_or_concluded"].sum() + projects["maturity"].eq("Fase non disponibile").sum()) / len(projects))}
    (GENERATED_DIR / "robustness_summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
