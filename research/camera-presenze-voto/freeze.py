#!/usr/bin/env python3
"""Freeze the Camera attendance distribution into the study capsule."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src/data/generated/camera-partecipazione-voto.json"
CAPSULE = ROOT / "src/content/studies/camera-presenze.json"
DISTRIBUTION = Path(__file__).resolve().parent / "generated" / "distribution.json"


def parse_pct(raw: str) -> float:
    if not raw.endswith("%"):
        raise ValueError(raw)
    value = float(raw[:-1])
    if not 0 <= value <= 100:
        raise ValueError(raw)
    return value


def quantile(sorted_vals: list[float], q: float) -> float:
    n = len(sorted_vals)
    if n == 0:
        raise ValueError("empty")
    if n == 1:
        return sorted_vals[0]
    index = (n - 1) * q
    low = int(index)
    high = min(low + 1, n - 1)
    weight = index - low
    return sorted_vals[low] * (1 - weight) + sorted_vals[high] * weight


def round1(value: float) -> float:
    return round(value * 10) / 10


def clean(text: str) -> str:
    return text.replace("\u2014", " · ").replace("\u2013", "-")


def main() -> None:
    raw = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    matched = [row for row in raw["deputies"] if row.get("deputyId") and row.get("numericId")]
    if not matched:
        raise SystemExit("nessun deputato abbinato")

    values = [parse_pct(row["presencePercent"]) for row in matched]
    sorted_vals = sorted(values)

    bins = []
    counts = [0] * 20
    for value in values:
        index = 19 if value >= 100 else min(19, int(value // 5))
        counts[index] += 1
    for index, count in enumerate(counts):
        start = index * 5
        bins.append({"from": start, "to": start + 5, "label": f"{start}-{start + 5}%", "count": count})

    by_group: dict[str, list[float]] = defaultdict(list)
    for row, value in zip(matched, values):
        by_group[row["groupLabel"]].append(value)

    groups = []
    for label, group_values in by_group.items():
        if len(group_values) < 3:
            continue
        ordered = sorted(group_values)
        groups.append(
            {
                "groupLabel": label,
                "count": len(ordered),
                "mean": round1(sum(ordered) / len(ordered)),
                "median": round1(quantile(ordered, 0.5)),
                "p25": round1(quantile(ordered, 0.25)),
                "p75": round1(quantile(ordered, 0.75)),
                "min": round1(ordered[0]),
                "max": round1(ordered[-1]),
            }
        )
    groups.sort(key=lambda item: (-item["count"], item["groupLabel"]))

    p10 = quantile(sorted_vals, 0.1)
    tail = sum(1 for value in values if value < p10)

    previous = json.loads(CAPSULE.read_text(encoding="utf-8")) if CAPSULE.exists() else {}
    assets = previous.get("assets", {"presenze-camera.pdf": {"bytes": 0, "sha256": "0" * 64}})

    capsule = {
        "version": "1",
        "revisedAt": "2026-11-20",
        "series": "Quaderni parlamentari",
        "publishedOn": "2026-11-20",
        "title": "Presenze al voto alla Camera",
        "subtitle": "Distribuzione ufficiale della partecipazione alle votazioni elettroniche",
        "description": (
            "Mediana, fasce e gruppi parlamentari sulla tabella ufficiale della Camera "
            "per la XIX legislatura, fino a febbraio 2026."
        ),
        "limitations": (
            "Presenza = voti espressi + missioni sulle votazioni elettroniche in Aula. "
            "Le missioni non sono presenza fisica. Il lavoro in commissione non è incluso. "
            "Il Senato non pubblica una tabella equivalente. Solo deputati con match "
            "anagrafico entrano nella distribuzione. Non equivale a peer review esterna."
        ),
        "sourcesConsultedOn": raw["period"]["observedDate"],
        "headline": {
            "matchedDeputies": len(matched),
            "mean": round1(sum(values) / len(values)),
            "median": round1(quantile(sorted_vals, 0.5)),
            "p10": round1(quantile(sorted_vals, 0.1)),
            "p90": round1(quantile(sorted_vals, 0.9)),
            "min": round1(sorted_vals[0]),
            "max": round1(sorted_vals[-1]),
            "tailBelowP10": tail,
        },
        "period": {
            "label": raw["period"]["label"],
            "observedDate": raw["period"]["observedDate"],
            "monthLabel": raw["period"]["monthLabel"],
            "legislature": raw["legislature"]["label"],
        },
        "source": {
            "owner": raw["source"]["owner"],
            "title": clean(raw["source"]["title"]),
            "pageUrl": raw["source"]["pageUrl"],
            "landingUrl": raw["source"]["landingUrl"],
        },
        "bins": bins,
        "groups": groups,
        "caveats": [
            "Presenza = voti espressi + missioni sulle votazioni elettroniche in Aula.",
            "Le missioni non sono presenza fisica in Aula; il lavoro in commissione non è incluso.",
            "Il Senato non pubblica una tabella ufficiale equivalente: nessuna distribuzione Senato.",
            clean(raw["caveats"][0]),
            clean(raw["caveats"][1]),
        ],
        "assets": assets,
    }

    blob = json.dumps(capsule, ensure_ascii=False)
    if "\u2014" in blob or "\u2013" in blob:
        raise SystemExit("em/en dash nella capsule")

    CAPSULE.write_text(json.dumps(capsule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DISTRIBUTION.parent.mkdir(parents=True, exist_ok=True)
    DISTRIBUTION.write_text(
        json.dumps(
            {
                "headline": capsule["headline"],
                "period": capsule["period"],
                "bins": bins,
                "groups": groups,
                "source": capsule["source"],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"capsule={CAPSULE} median={capsule['headline']['median']} n={capsule['headline']['matchedDeputies']}")


if __name__ == "__main__":
    main()
