#!/usr/bin/env python3
"""DVNS Index: how each Comune spends compared with similar Comuni.

The index has an objective base (official data already locked in the
repository, plus the ANAC CIG 2025 files pinned by
`specs/anac-entity-procurement.source.json`) and a declared indicator part:
the rules below on what counts as better and how much it weighs.

Pillars, each a percentile among similar Comuni, then weighted:

1. Resa della spesa (50%): OpenCivitas services vs the band average minus
   spending vs the standard need, average of the 2021 and 2022 percentiles.
2. Spesa non giustificata (15%): spending above the standard need that is not
   matched by services above the average, 2021 and 2022.
3. Capacità di investire (20%): SIOPE capital payments over current + capital,
   2024 and 2025 pooled.
4. Apertura degli appalti (15%): share of the value of 2025 CIGs >= 40.000 euro
   assigned without a competitive procedure (60%) and concentration of awarded
   value on operators (40%), both shrunk toward the national median when a
   Comune has few observations.

Only Comuni with all four pillars enter the ranking. The full payload is not
versioned: it is imported into dvns_snapshots and checked against the receipt.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import random
import re
import statistics
import sys
import zipfile
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Iterable

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "src/data/generated"
DEFAULT_SPEC = ROOT / "scripts/etl/specs/dvns-index.source.json"
DEFAULT_CACHE = ROOT / ".cache/dvns-index/anac"
DEFAULT_OUTPUT = GEN / "dvns-index.json"
DEFAULT_RECEIPT = GEN / "dvns-index.receipt.json"

BANDS = "ABCDE"
FUNCTIONS = ("amministrazione", "istruzione", "polizia", "rifiuti", "sociale-asili", "viabilita")


class IndexError_(ValueError):
    """An input drifted or a rule cannot be applied: publication is blocked."""


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


# ── pure rules (unit tested) ────────────────────────────────────────────────

def population_band(population: int) -> int:
    for limit, band in ((1_000, 0), (5_000, 1), (20_000, 2), (50_000, 3), (100_000, 4)):
        if population < limit:
            return band
    return 5


def surface_band(square_metres: int) -> int:
    km2 = square_metres / 1_000_000
    for limit, band in ((10, 0), (50, 1), (200, 2), (500, 3)):
        if km2 < limit:
            return band
    return 4


def percentile(value: float, values: list[float]) -> float:
    """Share of peers strictly below, ties counted half, on a 0-100 scale."""
    if not values:
        raise IndexError_("percentile senza valori di confronto")
    below = sum(v < value for v in values)
    equal = sum(v == value for v in values)
    return 100 * (below + 0.5 * equal) / len(values)


def shrink(observed: float, observations: int, median: float, pseudo_count: int) -> float:
    """Few observations move toward the national median; many keep the observed value."""
    return median + (observed - median) * observations / (observations + pseudo_count)


def unjustified_spending(spending_vs_need: float, services_vs_average: float) -> float:
    """Percentage points of spending above the need not covered by extra services (>= 0)."""
    return max(0.0, spending_vs_need - max(0.0, services_vs_average))


def procedure_class(kind: str, spec: dict[str, Any]) -> str | None:
    """'reduced', 'competitive' or None (neutral or unknown code, left out)."""
    if kind in spec["reducedCompetition"]:
        return "reduced"
    if kind in spec["neutral"] or kind.startswith("ND "):
        return None
    return "competitive"


def procedure_owner(row: dict[str, str]) -> str:
    """A procedure delegated to a purchasing body stays with the delegating Comune."""
    if row["FLAG_DELEGA"] == "1" and row["CF_SA_DELEGANTE"]:
        return row["CF_SA_DELEGANTE"]
    return row["cf_amministrazione_appaltante"]


def peer_position(score: float, peer_scores: list[float]) -> tuple[int, int]:
    """Position among the Comuni it is compared with (its own peer list), itself included."""
    return 1 + sum(other > score for other in peer_scores), 1 + len(peer_scores)


def rank_interval(positions: list[int]) -> tuple[int | None, int | None]:
    """5th and 95th percentile of the positions over the weight draws: where the Comune falls with other weights."""
    if not positions:
        return None, None
    ordered = sorted(positions)
    low = ordered[int(0.05 * (len(ordered) - 1))]
    high = ordered[int(round(0.95 * (len(ordered) - 1)))]
    return low, high


def band_of(position: int, total: int) -> str:
    return BANDS[min(4, (position - 1) * 5 // total)]


def weighted_score(pillars: dict[str, float], weights: dict[str, float]) -> float | None:
    present = {name: weight for name, weight in weights.items() if name in pillars}
    if "resa" not in present:
        return None
    return sum(pillars[name] * weight for name, weight in present.items()) / sum(present.values())


# ── inputs ──────────────────────────────────────────────────────────────────

def read_locked(spec: dict[str, Any], key: str) -> bytes:
    entry = spec["artefacts"][key]
    payload = (ROOT / entry["path"]).read_bytes()
    if sha256(payload) != entry["sha256"]:
        raise IndexError_(f"{entry['path']}: SHA-256 diverso dal source lock")
    return payload


def load_geography(spec: dict[str, Any]) -> dict[str, dict[str, Any]]:
    data = json.loads(read_locked(spec, "geography"))
    year = max(data["years"], key=lambda item: item["year"])
    out = {}
    for istat, tax, region, name, surface, pop, _py, alt, _m, coastal, island, urb in year["rows"]:
        if pop is None:
            continue
        out[istat] = dict(istat=istat, tax=tax, region=region, name=name, pop=pop, surface=surface, alt=alt, urb=urb,
                          coastal=coastal, island=island, pband=population_band(pop), sband=surface_band(surface))
    return out


def anac_procedures(spec: dict[str, Any], cache: Path) -> Iterable[dict[str, str]]:
    lock = json.loads(read_locked(spec, "anacCigSpec"))
    for entry in lock["inputs"]["cig"]:
        archive = cache / entry["fileName"]
        payload = archive.read_bytes()
        if len(payload) != entry["archiveBytes"] or sha256(payload) != entry["archiveSha256"]:
            raise IndexError_(f"ANAC {entry['fileName']}: byte o SHA-256 diversi dal lock")
        with zipfile.ZipFile(io.BytesIO(payload)) as z:
            handle = io.TextIOWrapper(z.open(entry["member"]["name"]), encoding="utf-8-sig")
            yield from csv.DictReader(handle, delimiter=";")


# ── build ───────────────────────────────────────────────────────────────────

def build(spec: dict[str, Any], cache: Path) -> dict[str, Any]:
    rules = spec["rules"]
    weights = rules["weights"]
    geo = load_geography(spec)
    by_tax = {g["tax"]: g["istat"] for g in geo.values() if g["tax"]}
    raw: dict[str, dict[str, float]] = defaultdict(dict)
    facts: dict[str, dict[str, Any]] = defaultdict(dict)

    rso: set[str] = set()
    for year in (2021, 2022):
        data = json.loads(read_locked(spec, f"opencivitas{year}"))
        cols = data["municipalityColumns"]
        for row in data["municipalityRows"]:
            r = dict(zip(cols, row))
            rso.add(r["istatCode"])
            if r["istatCode"] not in geo or r["differenceBasisPoints"] is None or r["serviceDifferenceBasisPoints"] is None:
                continue
            if r["servicesAssessmentReason"] or r["spendingAssessmentReason"]:
                continue
            spend, serv = r["differenceBasisPoints"] / 100, r["serviceDifferenceBasisPoints"] / 100
            raw[r["istatCode"]][f"resa{year}"] = serv - spend
            raw[r["istatCode"]][f"sovraspesa{year}"] = -unjustified_spending(spend, serv)
            facts[r["istatCode"]][f"spending{year}"] = round(spend, 2)
            facts[r["istatCode"]][f"services{year}"] = round(serv, 2)

    functions: dict[str, dict[str, float]] = defaultdict(dict)
    for name in FUNCTIONS:
        data = json.loads(read_locked(spec, f"opencivitas2022-{name}"))
        cols = data["municipalityColumns"]
        for row in data["municipalityRows"]:
            r = dict(zip(cols, row))
            if r["differenceBasisPoints"] is not None and r["serviceDifferenceBasisPoints"] is not None:
                functions[r["istatCode"]][name] = round((r["serviceDifferenceBasisPoints"] - r["differenceBasisPoints"]) / 100, 1)

    payments: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for year in (2024, 2025):
        data = json.loads(read_locked(spec, f"siope{year}"))
        for item in data["municipalities"]:
            row = dict(zip(data["columns"], item))
            istat = by_tax.get(row["taxCode"])
            if istat and row["titleCents"]:
                titles = dict(zip(data["titleOrder"], row["titleCents"]))
                payments[istat][0] += titles["1"]
                payments[istat][1] += titles["2"]
    for istat, (current, capital) in payments.items():
        if current + capital > 0:
            raw[istat]["investimenti"] = capital / (current + capital)
            facts[istat]["investmentShare"] = round(100 * capital / (current + capital), 1)
            facts[istat]["paymentsCents"] = current + capital

    threshold = Decimal(rules["procurementThresholdEuro"])
    latest: dict[str, tuple[str, str, str]] = {}
    for row in anac_procedures(spec, cache):
        if row["COD_MOTIVO_CANCELLAZIONE"]:
            continue
        latest[row["cig"]] = (procedure_owner(row), row["importo_lotto"], row["tipo_scelta_contraente"])
    competition: dict[str, list] = defaultdict(lambda: [Decimal(0), Decimal(0), 0])
    for owner, amount, kind in latest.values():
        istat = by_tax.get(owner)
        klass = procedure_class(kind, rules)
        if not istat or klass is None:
            continue
        try:
            value = Decimal(amount.replace(",", "."))
        except InvalidOperation:
            continue
        if value < threshold:
            continue
        acc = competition[istat]
        acc[0] += value
        acc[2] += 1
        if klass == "reduced":
            acc[1] += value
    observed = {i: (float(r / t), n) for i, (t, r, n) in competition.items() if n >= rules["minProcedures"] and t > 0}
    if not observed:
        raise IndexError_("ANAC: nessun Comune con procedure sufficienti")
    median_share = statistics.median(share for share, _ in observed.values())
    for istat, (share, n) in observed.items():
        raw[istat]["concorrenza"] = -shrink(share, n, median_share, rules["shrinkProcedures"])
        facts[istat]["withoutTenderShare"] = round(100 * share, 1)
        facts[istat]["procedures"] = n

    peers_snapshot = json.loads(gzip.decompress(read_locked(spec, "anacPeers")))
    ipa_to_istat = {r["codiceIpa"]: r["istatCode"] for r in peers_snapshot["rows"] if r.get("istatCode")}
    hhi_obs: dict[str, tuple[float, int]] = {}
    meta = json.loads(read_locked(spec, "anacAwardsMeta"))
    for shard in meta["shards"]:
        payload = (ROOT / shard["path"]).read_bytes()
        if sha256(payload) != shard["sha256"]:
            raise IndexError_(f"{shard['path']}: diverso da meta.json")
        for line in gzip.decompress(payload).decode("utf-8").splitlines():
            if not line.strip():
                continue
            entity = json.loads(line)
            istat = ipa_to_istat.get(entity["codiceIpa"])
            if not istat or istat not in geo:
                continue
            by_operator: dict[str, float] = defaultdict(float)
            n = 0
            for award in entity["awards"]:
                if award["attribution"] == "single-operator" and award["amountStatus"].startswith("positive"):
                    by_operator[award["operatorRefs"][0]] += float(award["amount"])
                    n += 1
            total = sum(by_operator.values())
            if n >= rules["minAwards"] and total > 0:
                hhi_obs[istat] = (sum((v / total) ** 2 for v in by_operator.values()), n)
                facts[istat]["topSupplierShare"] = round(100 * max(by_operator.values()) / total, 1)
                facts[istat]["awards"] = n
    median_hhi = statistics.median(h for h, _ in hhi_obs.values())
    for istat, (hhi, n) in hhi_obs.items():
        raw[istat]["fornitori"] = -shrink(hhi, n, median_hhi, rules["shrinkAwards"])

    pillars_def = {name: [(ind["id"], ind["weight"]) for ind in pillar["indicators"]] for name, pillar in rules["pillars"].items()}
    required = {name: pillar["required"] for name, pillar in rules["pillars"].items()}

    groups: dict[tuple, list[str]] = defaultdict(list)
    stages: list[tuple[Callable[[dict], tuple | None], int, str]] = [
        (lambda g: ("big",) if g["pop"] >= 100_000 else None, 5, "big"),
        (lambda g: ("a", g["pband"], g["sband"], g["alt"], g["urb"], g["coastal"], g["island"]), 10, "a"),
        (lambda g: ("b", g["pband"], g["sband"], g["alt"], g["urb"]), 10, "b"),
        (lambda g: ("c", g["pband"], g["sband"], g["alt"]), 10, "c"),
        (lambda g: ("d", g["pband"], g["sband"]), 10, "d"),
        (lambda g: ("f", g["pband"]), 10, "f"),
    ]
    for g in geo.values():
        for stage, _, _ in stages:
            key = stage(g)
            if key is not None:
                groups[key].append(g["istat"])

    def peers_of(g: dict) -> tuple[tuple | None, list[str]]:
        for stage, minimum, _ in stages:
            key = stage(g)
            if key is not None and len(groups[key]) - 1 >= minimum:
                return key, [i for i in groups[key] if i != g["istat"]]
        return None, []

    results = []
    for g in geo.values():
        key, members = peers_of(g)
        mine = raw.get(g["istat"], {})
        pillars: dict[str, float] = {}
        complete = True
        for name, parts in pillars_def.items():
            acc = weight = 0.0
            for indicator, w in parts:
                values = [raw[p][indicator] for p in members if indicator in raw.get(p, {})]
                if indicator in mine and len(values) >= rules["minPeerValues"]:
                    acc += w * percentile(mine[indicator], values)
                    weight += w
            if weight:
                pillars[name] = acc / weight
            if not weight or not all(i in mine for i in required[name]):
                complete = False
        score = weighted_score(pillars, weights)
        if g["istat"] not in rso:
            status = "special-statute"
        elif score is None:
            status = "no-opencivitas"
        elif complete:
            status = "ranked"
        else:
            status = "partial"
        results.append(dict(g=g, key=key, members=members, pillars=pillars, score=score, status=status))

    ranked = sorted([r for r in results if r["status"] == "ranked"], key=lambda r: (-r["score"], r["g"]["istat"]))
    total = len(ranked)
    if total < rules["minRanked"]:
        raise IndexError_(f"solo {total} Comuni in classifica, attesi almeno {rules['minRanked']}")
    for position, r in enumerate(ranked, 1):
        r["rank"] = position
        r["band"] = band_of(position, total)
    ranked_score = {r["g"]["istat"]: r["score"] for r in ranked}
    for r in ranked:
        r["peerRank"], r["peerRanked"] = peer_position(r["score"], [ranked_score[i] for i in r["members"] if i in ranked_score])

    rng = random.Random(rules["sensitivity"]["seed"])
    stable: dict[str, int] = defaultdict(int)
    positions: dict[str, list[int]] = defaultdict(list)
    draws = rules["sensitivity"]["draws"]
    spread = rules["sensitivity"]["spread"]
    for _ in range(draws):
        raw_w = {p: max(0.05, w + rng.uniform(-spread, spread)) for p, w in weights.items()}
        norm = sum(raw_w.values())
        alt_weights = {p: v / norm for p, v in raw_w.items()}
        order = sorted(ranked, key=lambda r: (-weighted_score(r["pillars"], alt_weights), r["g"]["istat"]))
        for position, r in enumerate(order, 1):
            positions[r["g"]["istat"]].append(position)
            if band_of(position, total) == r["band"]:
                stable[r["g"]["istat"]] += 1

    group_ids: dict[tuple, int] = {}
    group_rows = []
    for r in results:
        key = r["key"]
        if key is not None and key not in group_ids:
            group_ids[key] = len(group_rows)
            group_rows.append({"id": len(group_rows), "stage": key[0], "values": list(key[1:]), "size": len(groups[key])})

    rows = []
    for r in sorted(results, key=lambda r: r["g"]["istat"]):
        g, f, p = r["g"], facts.get(r["g"]["istat"], {}), r["pillars"]
        rows.append([
            g["istat"], g["tax"], g["name"], g["region"], g["pop"], r["status"],
            None if r["score"] is None else round(r["score"], 1),
            r.get("band"), None if "band" not in r else round(stable[g["istat"]] / draws, 3),
            r.get("rank"), *rank_interval(positions.get(g["istat"], [])), r.get("peerRank"), r.get("peerRanked"),
            None if r["key"] is None else group_ids[r["key"]],
            *[None if name not in p else round(p[name], 1) for name in ("resa", "sovraspesa", "investire", "appalti")],
            f.get("spending2022"), f.get("services2022"), f.get("spending2021"), f.get("services2021"),
            f.get("investmentShare"), f.get("withoutTenderShare"), f.get("procedures"), f.get("topSupplierShare"), f.get("awards"),
            [functions.get(g["istat"], {}).get(name) for name in FUNCTIONS],
        ])

    scores = sorted(r["score"] for r in ranked)
    return {
        "schemaVersion": 1,
        "datasetId": "dvns-index",
        "version": spec["version"],
        "rules": rules,
        "functions": list(FUNCTIONS),
        "columns": ["istat", "taxCode", "name", "region", "population", "status", "score", "band", "bandStability", "rank", "rankLow", "rankHigh", "peerRank", "peerRanked", "group",
                    "pResa", "pSovraspesa", "pInvestire", "pAppalti",
                    "spending2022", "services2022", "spending2021", "services2021",
                    "investmentShare", "withoutTenderShare", "procedures", "topSupplierShare", "awards", "functionResa"],
        "rows": rows,
        "groups": group_rows,
        "summary": {
            "municipalities": len(results),
            "ranked": total,
            "partial": sum(r["status"] == "partial" for r in results),
            "specialStatute": sum(r["status"] == "special-statute" for r in results),
            "noOpenCivitas": sum(r["status"] == "no-opencivitas" for r in results),
            "medianScore": round(statistics.median(scores), 1),
            "medianStability": round(statistics.median(stable[r["g"]["istat"]] / draws for r in ranked), 3),
            "bandCutoffs": [round(ranked[min(total - 1, i * total // 5 - 1)]["score"], 1) for i in range(1, 5)],
            "anacProcedures": len(latest),
            "medianWithoutTenderShare": round(100 * median_share, 1),
        },
        "sources": spec["sources"],
        "provenance": {key: {"path": entry["path"], "sha256": entry["sha256"]} for key, entry in spec["artefacts"].items()},
    }


def serialize(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--code-sha")
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    try:
        data = build(spec, args.cache)
    except (IndexError_, FileNotFoundError) as error:
        print(f"dvns-index: {error}", file=sys.stderr)
        return 1
    payload = serialize(data)
    if args.write:
        if not args.code_sha or not re.fullmatch(r"[0-9a-f]{40}", args.code_sha):
            print("dvns-index: --write richiede --code-sha di 40 caratteri", file=sys.stderr)
            return 1
        DEFAULT_OUTPUT.write_bytes(payload)
        receipt = {
            "schemaVersion": 1,
            "documentPath": DEFAULT_OUTPUT.relative_to(ROOT).as_posix(),
            "codeSha": args.code_sha,
            "sourceSha256": sha256(payload),
            "sourceBytes": len(payload),
            "version": spec["version"],
            "ranked": data["summary"]["ranked"],
        }
        DEFAULT_RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"dvns-index: {data['summary']['ranked']} in classifica, payload {len(payload)} byte, sha256 {sha256(payload)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
