#!/usr/bin/env python3
"""Freeze the Camera attendance study (v2) into the study capsule.

Inputs are snapshots already committed and validated in the repository:
the official participation table, the Camera roster and the Government roster.
No network access. Every number shown by the page and the PDF comes from here.
"""

from __future__ import annotations

import json
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src/data/generated/camera-partecipazione-voto.json"
ROSTER = ROOT / "src/data/generated/politici-camera-xix.json"
GOVERNMENT = ROOT / "src/data/generated/governo-meloni.json"
PAY = ROOT / "src/data/generated/camera-trattamento-economico.json"
CAPSULE = ROOT / "src/content/studies/camera-presenze.json"
# Per-deputy rows live apart so that the site-wide study registry stays small.
DEPUTIES = ROOT / "src/content/studies/camera-presenze-deputati.json"
DISTRIBUTION = Path(__file__).resolve().parent / "generated" / "distribution.json"

VERSION = "2"
REVISED_AT = "2026-11-20"
PUBLISHED_ON = "2026-11-20"

# Group label printed by the Camera for the period -> short label and bloc.
# The bloc follows the vote of confidence to the Meloni Government; the Misto
# group mixes majority and opposition components and stays on its own.
GROUPS = [
    ("fratelli d italia", "FdI", "Fratelli d'Italia", "maggioranza"),
    ("lega", "Lega", "Lega", "maggioranza"),
    ("forza italia", "FI", "Forza Italia", "maggioranza"),
    ("noi moderati", "NM", "Noi Moderati", "maggioranza"),
    ("partito democratico", "PD", "Partito Democratico", "opposizione"),
    ("movimento 5 stelle", "M5S", "MoVimento 5 Stelle", "opposizione"),
    ("alleanza verdi e sinistra", "AVS", "Alleanza Verdi e Sinistra", "opposizione"),
    ("azione", "Azione", "Azione", "opposizione"),
    ("italia viva", "IV", "Italia Viva", "opposizione"),
    ("misto", "Misto", "Misto", "misto"),
]
BLOC_LABELS = {"maggioranza": "Maggioranza", "opposizione": "Opposizione", "misto": "Gruppo Misto"}


def fold(text: str) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " ".join("".join(c if c.isalnum() else " " for c in plain.casefold()).split())


def group_of(label: str) -> dict:
    folded = fold(label)
    for prefix, short, name, bloc in GROUPS:
        if folded == prefix or folded.startswith(prefix + " "):
            return {"short": short, "name": name, "bloc": bloc}
    raise SystemExit(f"gruppo non classificato: {label}")


def parse_pct(raw: str) -> float:
    if not raw.endswith("%"):
        raise ValueError(raw)
    value = float(raw[:-1])
    if not 0 <= value <= 100:
        raise ValueError(raw)
    return value


def quantile(sorted_vals: list[float], q: float) -> float:
    """Linear interpolation (type 7), as in the atlas view."""
    n = len(sorted_vals)
    if n == 0:
        raise ValueError("empty")
    index = (n - 1) * q
    low = int(index)
    high = min(low + 1, n - 1)
    return sorted_vals[low] + (sorted_vals[high] - sorted_vals[low]) * (index - low)


def r1(value: float) -> float:
    return round(value * 10) / 10


def summary(values: list[float]) -> dict:
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "mean": r1(sum(ordered) / len(ordered)),
        "median": r1(quantile(ordered, 0.5)),
        "p10": r1(quantile(ordered, 0.1)),
        "p25": r1(quantile(ordered, 0.25)),
        "p75": r1(quantile(ordered, 0.75)),
        "p90": r1(quantile(ordered, 0.9)),
        "min": r1(ordered[0]),
        "max": r1(ordered[-1]),
    }


def bins_of(values: list[float]) -> list[dict]:
    counts = [0] * 20
    for value in values:
        counts[min(19, int(value // 5))] += 1
    return [{"from": i * 5, "to": i * 5 + 5, "label": f"{i * 5}-{i * 5 + 5}%", "count": c} for i, c in enumerate(counts)]


def title_name(source_name: str) -> str:
    """'BOSSI UMBERTO' -> 'Umberto Bossi' only when the split is unambiguous."""
    parts = source_name.split()
    words = [w.capitalize() for w in parts]
    return f"{words[1]} {words[0]}" if len(words) == 2 else " ".join(words)


def age_band(birth: str | None, at: date) -> str | None:
    if not birth:
        return None
    born = date.fromisoformat(birth)
    age = at.year - born.year - ((at.month, at.day) < (born.month, born.day))
    if age < 40:
        return "Meno di 40 anni"
    if age < 50:
        return "40-49 anni"
    if age < 60:
        return "50-59 anni"
    return "60 anni e oltre"


def elected_in(deputy: dict) -> str:
    college = (deputy.get("college") or "").lower()
    if "uninominale" in college:
        return "Collegio uninominale"
    if "plurinominale" in college:
        return "Lista proporzionale"
    return "Circoscrizione Estero"


def clean(text: str) -> str:
    return text.replace("\u2014", ",").replace("\u2013", "-")


def segment(rows: list[dict], label: str) -> dict:
    return {
        "label": label,
        "count": len(rows),
        "presence": r1(quantile(sorted(r["presence"] for r in rows), 0.5)),
        "votes": r1(quantile(sorted(r["votes"] for r in rows), 0.5)),
        "missions": r1(quantile(sorted(r["missions"] for r in rows), 0.5)),
        "meanVotes": r1(sum(r["votes"] for r in rows) / len(rows)),
        "meanMissions": r1(sum(r["missions"] for r in rows) / len(rows)),
        "meanAbsences": r1(sum(r["absences"] for r in rows) / len(rows)),
        "missionsOver50": sum(1 for r in rows if r["missions"] > 50),
    }


def main() -> None:
    raw = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    roster = {d["id"]: d for d in json.loads(ROSTER.read_text(encoding="utf-8"))["deputies"]}
    gov_raw = json.loads(GOVERNMENT.read_text(encoding="utf-8"))
    government = {p["personaId"]: p for p in gov_raw["people"]}
    pay = json.loads(PAY.read_text(encoding="utf-8"))
    observed = date.fromisoformat(raw["period"]["observedDate"])
    total_votes = max(r["presenceTotal"] + r["absences"] for r in raw["deputies"])

    rows = []
    for item in raw["deputies"]:
        votable = item["presenceTotal"] + item["absences"]
        if item["presenceTotal"] != item["votesCast"] + item["missions"]:
            raise SystemExit(f"presenze incoerenti: {item['sourceName']}")
        deputy = roster.get(item["deputyId"]) if item.get("deputyId") else None
        if item.get("deputyId") and deputy is None:
            raise SystemExit(f"deputato non in anagrafe: {item['deputyId']}")
        group = group_of(item["groupLabel"])
        gov = government.get(item.get("numericId") or "")
        institutional = (deputy or {}).get("institutionalRole") or None
        role = None
        if gov:
            role = gov["primaryRoleLabel"]
        elif institutional:
            role = institutional["label"]
        rows.append(
            {
                "name": deputy["displayName"] if deputy else title_name(item["sourceName"]),
                "sourceName": item["sourceName"],
                "matched": deputy is not None,
                "group": group["short"],
                "groupLabel": item["groupLabel"],
                "bloc": group["bloc"],
                "presence": parse_pct(item["presencePercent"]),
                "votes": parse_pct(item["votesCastPercent"]),
                "missions": parse_pct(item["missionsPercent"]),
                "absences": parse_pct(item["absencesPercent"]),
                "justified": parse_pct(item["justifiedAbsencesPercent"]),
                "absCount": item["absences"],
                "justCount": item["justifiedAbsences"],
                "missionsCount": item["missions"],
                "votesCount": item["votesCast"],
                "votable": votable,
                "government": bool(gov),
                "role": role,
                "gender": (deputy or {}).get("gender"),
                "age": age_band((deputy or {}).get("birthDate"), observed) if deputy else None,
                "elected": elected_in(deputy) if deputy else None,
            }
        )
    rows.sort(key=lambda r: (fold(r["sourceName"])))

    presence = [r["presence"] for r in rows]
    votes = [r["votes"] for r in rows]
    p10 = quantile(sorted(presence), 0.1)
    tail = [r for r in rows if r["presence"] < p10]
    abs_total = sum(r["absCount"] for r in rows)
    just_total = sum(r["justCount"] for r in rows)
    slots = sum(r["votable"] for r in rows)
    lowest_decile = sorted(rows, key=lambda r: r["presence"])[: round(len(rows) / 10)]
    gov_rows = [r for r in rows if r["government"]]
    non_gov = [r for r in rows if not r["government"]]

    headline = {
        "rows": len(rows),
        "matchedDeputies": sum(1 for r in rows if r["matched"]),
        "totalVotes": total_votes,
        "partialTenure": sum(1 for r in rows if r["votable"] < total_votes),
        "presence": summary(presence),
        "votes": summary(votes),
        "tailBelowP10": len(tail),
        "presenceBelow50": sum(1 for v in presence if v < 50),
        "votesBelow50": sum(1 for v in votes if v < 50),
        "presenceAtLeast95": sum(1 for v in presence if v >= 95),
        "missionsOver20": sum(1 for r in rows if r["missions"] > 20),
        "missionsOver50": sum(1 for r in rows if r["missions"] > 50),
        "gapOver20": sum(1 for r in rows if r["presence"] - r["votes"] > 20),
        "aggregate": {
            "votesShare": r1(100 * sum(r["votesCount"] for r in rows) / slots),
            "missionsShare": r1(100 * sum(r["missionsCount"] for r in rows) / slots),
            "absencesShare": r1(100 * abs_total / slots),
            "justifiedOfAbsences": r1(100 * just_total / abs_total),
        },
        "lowestDecileCount": len(lowest_decile),
        "lowestDecileAbsenceShare": r1(100 * sum(r["absCount"] for r in lowest_decile) / abs_total),
        "governmentCount": len(gov_rows),
        "governmentMedianPresence": r1(quantile(sorted(r["presence"] for r in gov_rows), 0.5)),
        "governmentMedianVotes": r1(quantile(sorted(r["votes"] for r in gov_rows), 0.5)),
        "nonGovernmentMedianVotes": r1(quantile(sorted(r["votes"] for r in non_gov), 0.5)),
    }

    by_group: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_group[r["group"]].append(r)
    groups = []
    for short, name_bloc in ((g[1], (g[2], g[3])) for g in GROUPS):
        members = by_group.get(short, [])
        if not members:
            continue
        seg = segment(members, name_bloc[0])
        stats = summary([m["presence"] for m in members])
        groups.append({**seg, "short": short, "bloc": name_bloc[1], "p25": stats["p25"], "p75": stats["p75"]})
    groups.sort(key=lambda g: (-g["presence"], -g["count"]))

    blocs = [segment([r for r in rows if r["bloc"] == key], label) | {"key": key} for key, label in BLOC_LABELS.items()]

    def profile(key: str, order: list[str]) -> list[dict]:
        out = []
        for label in order:
            members = [r for r in rows if r[key] == label]
            if members:
                out.append(segment(members, label))
        return out

    profiles = {
        "gender": [
            {**segment([r for r in rows if r["gender"] == g], lab)}
            for g, lab in (("female", "Donne"), ("male", "Uomini"))
        ],
        "age": profile("age", ["Meno di 40 anni", "40-49 anni", "50-59 anni", "60 anni e oltre"]),
        "elected": profile("elected", ["Collegio uninominale", "Lista proporzionale", "Circoscrizione Estero"]),
        "roles": [
            segment(gov_rows, "Membri del Governo"),
            segment([r for r in rows if not r["government"] and r["role"]], "Ufficio di Presidenza della Camera"),
            segment([r for r in rows if not r["government"] and not r["role"]], "Altri deputati"),
        ],
    }

    # Unjustified absences: absences the Camera does not mark as justified.
    unjustified = [r1(r["absences"] - r["justified"]) for r in rows]
    absences = {
        "unjustified": summary(unjustified),
        "justified": summary([r["justified"] for r in rows]),
        "unjustifiedOver20": sum(1 for v in unjustified if v > 20),
        "noJustified": sum(1 for r in rows if r["justCount"] == 0),
    }

    deputies = [
        {
            "name": r["name"],
            "group": r["group"],
            "presence": r["presence"],
            "votes": r["votes"],
            "missions": r["missions"],
            "absences": r["absences"],
            "justified": r["justified"],
            "votable": r["votable"],
            **({"role": r["role"]} if r["role"] else {}),
            **({"government": True} if r["government"] else {}),
            **({"unmatched": True} if not r["matched"] else {}),
        }
        for r in rows
    ]

    diaria = next(c for c in pay["components"] if c["id"] == "diaria")
    previous = json.loads(CAPSULE.read_text(encoding="utf-8")) if CAPSULE.exists() else {}
    assets = previous.get("assets", {})
    if previous.get("version") != VERSION:
        assets = {"presenze-camera.pdf": {"bytes": 0, "sha256": "0" * 64}}

    capsule = {
        "version": VERSION,
        "revisedAt": REVISED_AT,
        "series": "Quaderni parlamentari",
        "publishedOn": PUBLISHED_ON,
        "title": "Presenze al voto alla Camera",
        "subtitle": "Chi vota, chi è in missione, chi manca: 397 deputati e 17.081 votazioni della XIX legislatura",
        "description": (
            "Lo studio completo sulla tabella ufficiale della Camera: presenze deputato per deputato, "
            "peso delle missioni, gruppi, maggioranza e opposizione, governo e assenze, fino a febbraio 2026."
        ),
        "limitations": (
            "Presenza = voti espressi + missioni sulle votazioni elettroniche in Aula. Le missioni non sono presenza "
            "fisica. Il lavoro in commissione non è incluso. Il Senato non è incluso. Incarichi di governo e "
            "dell'Ufficio di Presidenza sono quelli in corso alla data degli snapshot, non lungo tutto il periodo. "
            "Non equivale a peer review esterna."
        ),
        "sourcesConsultedOn": raw["period"]["observedDate"],
        "headline": headline,
        "period": {
            "label": raw["period"]["label"],
            "observedDate": raw["period"]["observedDate"],
            "monthLabel": raw["period"]["monthLabel"],
            "legislature": raw["legislature"]["label"],
            "legislatureStart": "2022-10-13",
        },
        "source": {
            "owner": raw["source"]["owner"],
            "title": clean(raw["source"]["title"]),
            "pageUrl": raw["source"]["pageUrl"],
            "landingUrl": raw["source"]["landingUrl"],
            "sha256": raw["source"]["responses"]["vista"]["sha256"],
        },
        "joins": {
            "roster": {"title": "Camera dei deputati, anagrafe XIX legislatura (dati.camera.it)", "acquiredAt": "2026-09-17"},
            "government": {"title": clean(gov_raw["government"]["label"]) + ", incarichi in corso (dati.camera.it)", "acquiredAt": "2026-09-17"},
        },
        "diaria": {
            "monthlyEuro": diaria["amountEuro"],
            "dailyDeductionEuro": "206,58",
            "pageUrl": pay["source"]["pageUrl"],
            "observedDate": pay["period"]["observedDate"],
        },
        "external": [
            {
                "owner": "Openpolis",
                "title": "Nella XIX legislatura diminuiscono le assenze ma aumentano le missioni",
                "url": "https://www.openpolis.it/numeri/nella-xix-legislatura-diminuiscono-le-assenze-ma-aumentano-le-missioni/",
                "finding": "Nei dati della XIX legislatura analizzati da Openpolis le missioni pesano il 14,7% delle votazioni, la quota più alta tra le legislature confrontate.",
            },
            {
                "owner": "Openpolis",
                "title": "Presenze in Parlamento: come si contano e cosa non sappiamo",
                "url": "https://blog.openpolis.it/presenze-in-parlamento-come-si-contano-e-cosa-non-sappiamo-intema-14",
                "finding": "La decurtazione della diaria scatta per giornata: chi partecipa ad almeno un terzo circa delle votazioni del giorno la evita, e l'indennità non viene toccata.",
            },
        ],
        "presenceBins": bins_of(presence),
        "votesBins": bins_of(votes),
        "groups": groups,
        "blocs": blocs,
        "profiles": profiles,
        "absences": absences,
        "caveats": [
            "Presenza = voti espressi + missioni, in percentuale delle votazioni elettroniche in Aula a cui il deputato poteva partecipare.",
            "La missione è un'assenza per incarico istituzionale (governo, incarichi della Camera fuori sede): conta come presenza nella statistica ufficiale ma non è un voto.",
            "Il lavoro in commissione, nelle giunte e nelle delegazioni non è misurato da questa tabella.",
            "Un voto non espresso può essere una scelta politica, ad esempio uscire dall'Aula per far mancare il numero legale: la tabella non distingue i motivi.",
            "Il gruppo è quello indicato dalla Camera per il periodo; incarichi di governo e dell'Ufficio di Presidenza sono quelli in corso a settembre 2026.",
            "Undici deputati sono entrati o usciti nel corso della legislatura: le loro percentuali sono calcolate sulle votazioni del loro mandato.",
            "Il Senato non è incluso: non abbiamo ancora acquisito una sua fonte equivalente con hash e periodo verificati.",
            clean(raw["caveats"][3]),
        ],
        "assets": assets,
    }

    blob = json.dumps(capsule, ensure_ascii=False)
    if "\u2014" in blob or "\u2013" in blob:
        raise SystemExit("em/en dash nella capsule")

    if "\u2014" in json.dumps(deputies, ensure_ascii=False):
        raise SystemExit("em dash nelle righe")
    CAPSULE.write_text(json.dumps(capsule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DEPUTIES.write_text(
        json.dumps({"version": VERSION, "observedDate": raw["period"]["observedDate"], "deputies": deputies}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    DISTRIBUTION.parent.mkdir(parents=True, exist_ok=True)
    DISTRIBUTION.write_text(
        json.dumps(
            {k: capsule[k] for k in ("headline", "period", "presenceBins", "votesBins", "groups", "blocs", "profiles", "absences", "source")},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    h = capsule["headline"]
    print(f"rows={h['rows']} median={h['presence']['median']} votesMedian={h['votes']['median']} gov={h['governmentCount']}")


if __name__ == "__main__":
    main()
