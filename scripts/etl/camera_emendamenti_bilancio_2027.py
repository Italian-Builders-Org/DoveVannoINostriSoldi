#!/usr/bin/env python3
"""Emendamenti alla legge di bilancio 2027 (C. 3174-bis), V Commissione Camera.

Fonte: l'elenco ufficiale delle proposte emendative pubblicate nel Bollettino
delle Giunte e Commissioni del 23 novembre 2026 e la pagina ufficiale di ogni
proposta (testo, firmatari, esito di ammissibilita').

Fatti presi dalla fonte: numero, articolo, firmatari, esito, annotazione,
proposte identiche. Campi ricavati dal testo con regole dichiarate e
conservative, sempre accompagnati dalla frase di origine: spesa dichiarata e
Comuni nominati. Non sono stime di impatto: la Camera non pubblica una
relazione tecnica per queste proposte.

Il JSON completo non e' versionato (dvns_snapshots su Supabase): lo script
scrive il payload locale e la ricevuta tipizzata che il sito usa per
verificarlo. Senza --fetch lavora solo sulla cache locale.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/camera-emendamenti-bilancio-2027.source.json"
DEFAULT_CACHE = ROOT / ".cache/camera-emendamenti-3174-bis"
DEFAULT_OUTPUT = ROOT / "src/data/generated/camera-emendamenti-bilancio-2027.json"
DEFAULT_RECEIPT = ROOT / "src/data/generated/camera-emendamenti-bilancio-2027.receipt.json"
DEPUTIES = ROOT / "src/data/generated/politici-camera-xix.json"
GEOGRAPHY = ROOT / "src/data/generated/istat-municipality-geography.json"
USER_AGENT = "Mozilla/5.0 (compatible; dvns-etl/1.0)"

REGIONS = {
    "01": "Piemonte", "02": "Valle d'Aosta", "03": "Lombardia", "04": "Trentino-Alto Adige",
    "05": "Veneto", "06": "Friuli-Venezia Giulia", "07": "Liguria", "08": "Emilia-Romagna",
    "09": "Toscana", "10": "Umbria", "11": "Marche", "12": "Lazio", "13": "Abruzzo",
    "14": "Molise", "15": "Campania", "16": "Puglia", "17": "Basilicata", "18": "Calabria",
    "19": "Sicilia", "20": "Sardegna",
}

INADMISSIBILITY_REASONS = {
    "(inammissibile per carenza di compensazione)": "carenza_compensazione",
    "(inammissibile per inidoneità di compensazione)": "inidoneita_compensazione",
    "(inammissibile per carenza e inidoneità di compensazione)": "carenza_e_inidoneita_compensazione",
    "(inammissibile per estraneità di materia)": "estraneita_materia",
}


INADMISSIBILITY_NOTES = {reason: note for note, reason in INADMISSIBILITY_REASONS.items()}


class EmendamentiError(ValueError):
    """The source does not match what the lock or the parser expects."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def clean(fragment: str) -> str:
    """Visible text of an HTML fragment, with single spaces."""
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def amendment_id(raw: str) -> str:
    value = raw.strip().rstrip(".")
    if not re.fullmatch(r"(?:Tab\.[0-9A-Z]+|\d+)\.\d+", value):
        raise EmendamentiError(f"numero di proposta inatteso: {raw!r}")
    return value


# ── elenco ufficiale ─────────────────────────────────────────────────────────

ROW = re.compile(
    r'<tr class="(rigaArticoloNormale|normale)" id="([^"]+)"[^>]*>(.*?)</tr>', re.S
)
PERSON = re.compile(r'idPersona=(\d+)&amp;webType=Normale">([^<]+)</a>')


def parse_list(markup: str) -> list[dict[str, Any]]:
    """One record per published amendment, in publication order."""
    rows: list[dict[str, Any]] = []
    section: str | None = None
    for kind, row_id, body in ROW.findall(markup):
        if kind == "rigaArticoloNormale":
            label = re.search(r'<a href="javascript:[^"]*">([^<]+)</a>', body)
            if not label:
                raise EmendamentiError(f"intestazione senza etichetta: {row_id}")
            section = clean(label.group(1))
            if not re.fullmatch(r"(?:Art\. \d+|Tabella [0-9A-Z]+)", section):
                raise EmendamentiError(f"sezione inattesa: {section!r}")
            continue
        match = re.fullmatch(r"tr\.id\.(.+)\.position\.(\d{8})\.(\d+)", row_id)
        cells = re.findall(r"<td[^>]*?(?:/>|>(.*?)</td>)", body, re.S)
        if not match or len(cells) != 4 or section is None:
            raise EmendamentiError(f"riga inattesa: {row_id}")
        number_cell, signers_cell, outcome_cell = cells[1], cells[2], cells[3]
        link = re.search(r'idPropostaEmendativa=([^&"]+)&amp;position=(\d{8})"[^>]*>([^<]+)</a>', number_cell)
        if not link or amendment_id(link.group(1)) != match.group(1) or amendment_id(link.group(3)) != match.group(1):
            raise EmendamentiError(f"numero incoerente nella riga {row_id}")
        people = PERSON.findall(signers_cell)
        signers_text = clean(signers_cell)
        if people:
            more = signers_text.endswith(" e altri")
            if not more and len(people) not in (1, 2):
                raise EmendamentiError(f"firmatari inattesi nella riga {row_id}")
            first = {"personId": people[0][0], "name": clean(people[0][1])}
            listed = None if more else len(people)
        elif signers_text == "Il Governo":
            first, listed = {"personId": None, "name": "Il Governo"}, 1
        else:
            raise EmendamentiError(f"proponente inatteso: {signers_text!r}")
        outcome = clean(outcome_cell)
        partial = re.search(r'<span class="ammissibilita">(.*?)</span>', number_cell, re.S)
        identical = re.search(r'<span class="emendamentiIdentici">(.*?)</span>', number_cell, re.S)
        reason = None
        if outcome:
            status = re.search(r'<span class="esitoInammissibile">inammissibile</span>', outcome_cell)
            note = re.search(r'<span class="annotazioneEsito">(.*?)</span>', outcome_cell, re.S)
            if not status or not note or clean(note.group(1)) not in INADMISSIBILITY_REASONS or partial:
                raise EmendamentiError(f"esito non riconosciuto: {outcome!r} ({match.group(1)})")
            reason = INADMISSIBILITY_REASONS[clean(note.group(1))]
        partial_note = clean(partial.group(1)) if partial else None
        if partial_note is not None and not re.fullmatch(r"\(inammissibile per .+ limitatamente .+\)", partial_note):
            raise EmendamentiError(f"annotazione parziale inattesa: {partial_note!r}")
        identical_ids: list[str] = []
        if identical:
            inner = re.fullmatch(r"\(ident\. (.+?)\s*\)", clean(identical.group(1)))
            if not inner:
                raise EmendamentiError(f"proposte identiche inattese: {clean(identical.group(1))!r}")
            identical_ids = [amendment_id(item) for item in inner.group(1).split(",")]
        rows.append({
            "id": match.group(1),
            "section": section,
            "position": int(match.group(3)),
            "published": match.group(2),
            "first": first,
            "listedSigners": listed,
            "outcome": "inammissibile" if reason else ("parzialmente_inammissibile" if partial_note else "ammissibile"),
            "reason": reason,
            "partialNote": partial_note[1:-1] if partial_note else None,
            "identicalTo": identical_ids,
        })
    if [row["position"] for row in rows] != list(range(1, len(rows) + 1)):
        raise EmendamentiError("posizioni non consecutive nell'elenco")
    if len({row["id"] for row in rows}) != len(rows):
        raise EmendamentiError("numeri di proposta duplicati nell'elenco")
    return rows


# ── pagina della singola proposta ────────────────────────────────────────────

def parse_page(markup: str, expected_id: str) -> dict[str, Any]:
    block = re.search(r'<div class="propostaEmendativa">(.*)</div></div></div></div>', markup, re.S)
    if not block or markup.count('class="propostaEmendativa"') != 1:
        raise EmendamentiError(f"{expected_id}: pagina senza una proposta unica")
    body = block.group(1)
    number = re.search(r'<div class="numero"><strong>([^<]+)</strong></div>', body)
    if not number or amendment_id(number.group(1)) != expected_id:
        raise EmendamentiError(f"{expected_id}: numero diverso nella pagina")
    text = re.search(r'<div class="testo">(.*?)</div><div class="proponenti">', body, re.S)
    signers = re.search(r'<div class="proponenti">(.*?)</div>', body, re.S)
    if not text or not signers:
        raise EmendamentiError(f"{expected_id}: testo o proponenti assenti")
    people = [{"personId": pid, "name": clean(name)} for pid, name in PERSON.findall(signers.group(1))]
    signers_text = clean(signers.group(1))
    if not people and signers_text != "Il Governo":
        raise EmendamentiError(f"{expected_id}: proponenti inattesi {signers_text!r}")
    outcome = re.search(r'<div class="esito">(.*?)</div>', body, re.S)
    paragraphs = [clean(part) for part in re.findall(r"<p[^>]*>(.*?)</p>", text.group(1), re.S)]
    title = re.search(r"<p align=\"center\"[^>]*>\s*Art\.[^<]*(?:<i>[^<]*</i>)?\.?\s*<br />\s*<i>\((.*?)\)</i>", text.group(1), re.S)
    return {
        "text": " ".join(part for part in paragraphs if part) or clean(text.group(1)),
        "title": clean(title.group(1)) if title else None,
        "signers": people or [{"personId": None, "name": "Il Governo"}],
        "outcomeText": clean(outcome.group(1)) if outcome else "",
    }


def excerpt(text: str, start: int, end: int, *, before: int, after: int) -> str:
    """Sentence around text[start:end], cut on word boundaries and marked with "…"."""
    period = text.rfind(". ", 0, start)
    sentence = 0 if period < 0 else period + 2
    left = max(sentence, start - before)
    if left > sentence:
        left = text.find(" ", left) + 1
    stop = text.find(". ", end)
    right = len(text) if stop < 0 else stop + 1
    if right > end + after:
        right = max(end, text.rfind(" ", end, end + after + 1))
    body = text[left:right].strip()
    return ("… " if left > sentence else "") + body + (" …" if right < len(text) and not body.endswith(".") else "")


# ── spesa dichiarata nel testo ───────────────────────────────────────────────

AMOUNT = r"\d[\d.]*(?:,\d+)?"
UNIT = r"milioni|miliardi|mila"
MONEY = rf"(?:euro\s+(?P<pre>{AMOUNT})(?:\s*(?P<preunit>{UNIT}))?|(?P<num>{AMOUNT})\s*(?P<unit>{UNIT})?\s*(?:di\s+)?euro)"
# After the first amount the text often drops the word: "di 50 milioni per il 2028".
MONEY_NEXT = rf"(?:{MONEY}|(?P<bare>{AMOUNT})\s*(?P<bareunit>milioni|miliardi|milione|miliardo))"
YEAR_LIST = r"\d{4}(?:\s*,\s*\d{4})*(?:\s+e\s+\d{4})?"
YEARS = (
    r"(?P<annual>\s+annui|\s+l'anno)?,?\s+(?:"
    rf"(?:da\s+erogare\s+)?(?:per|in)\s+ciascuno\s+degli\s+anni\s+(?P<each>{YEAR_LIST})"
    r"|(?P<everyrange>per\s+ciascuno\s+degli\s+anni\s+)?dal\s+(?P<from>\d{4})\s+al\s+(?P<to>\d{4})"
    r"|(?:per|nel)(?:\s+l')?\s*anno\s+(?P<one>\d{4})"
    r"|per\s+il\s+(?P<onebare>\d{4})(?!\s*-)"
    r"|a\s+decorrere\s+dal(?:l'anno)?\s+(?P<since>\d{4})"
    r")"
)
ITEM = re.compile(MONEY + r"(?:" + YEARS + r")?", re.I)
ITEM_NEXT = re.compile(MONEY_NEXT + r"(?:" + YEARS + r")?", re.I)
SEPARATOR = re.compile(r"\s*(?:,\s*(?:e\s+)?|\s+e\s+|\s+ed\s+)(?:(?:di|pari\s+a|a)\s+)?")
BREAKDOWN = re.compile(r"(?:\s+per\s+il\s+triennio\s+2027-2029)?,\s+di\s+cui\s+", re.I)
# Year written before the formula: "Per l'anno 2027 è autorizzata la spesa di ...".
LEADING_YEARS = re.compile(rf"\bper\s+(?:l'anno\s+(?P<one>\d{{4}})|ciascuno\s+degli\s+anni\s+(?P<each>{YEAR_LIST}))[^.;:]{{0,60}}$", re.I)
ANCHORS = (
    ("spesa autorizzata", r"autorizzata\s+(?:la|una)\s+spesa\s+(?P<total>complessiva\s+)?(?:di|pari\s+a)\s+"),
    ("contributo", r"(?:assegnato|concesso|attribuito|riconosciuto|autorizzato|erogato)\s+un\s+contributo\s+(?:straordinario\s+)?(?:di|pari\s+a)\s+"),
    ("dotazione di un fondo", r"con\s+una\s+dotazione\s+(?:iniziale\s+|finanziaria\s+)?(?:di|pari\s+a)\s+"),
)
BUDGET_YEARS = (2027, 2028, 2029)
UNIT_SCALE = {"milioni": 10**8, "milione": 10**8, "miliardi": 10**11, "miliardo": 10**11, "mila": 10**5, None: 100}


def money_cents(number: str, unit: str | None) -> int:
    value = number.replace(".", "").replace(",", ".")
    scale = UNIT_SCALE[unit.lower() if unit else None]
    # Decimal arithmetic by hand: a float would round amounts such as 1,35 milioni.
    whole, _, fraction = value.partition(".")
    return int(whole) * scale + (int(fraction) * scale // 10 ** len(fraction) if fraction else 0)


def read_items(text: str, position: int, *, bare_first: bool = False) -> tuple[list[dict[str, Any]], int]:
    """Consecutive amounts starting at `position`, each with the years the text ties to it."""
    items: list[dict[str, Any]] = []
    end = position
    while True:
        pattern = ITEM_NEXT if items or bare_first else ITEM
        item = pattern.match(text, position)
        if not item:
            break
        groups = item.groupdict()
        cents = money_cents(
            groups["pre"] or groups["num"] or groups.get("bare"),
            groups["preunit"] or groups["unit"] or groups.get("bareunit"),
        )
        years: list[int] | None = None
        since: int | None = None
        if groups["each"]:
            years = [int(year) for year in re.findall(r"\d{4}", groups["each"])]
        elif groups["from"] and (groups["annual"] or groups["everyrange"]):
            years = list(range(int(groups["from"]), int(groups["to"]) + 1))
        elif groups["from"]:
            # "40 milioni dal 2027 al 2031" does not say whether the amount is yearly: stop before it.
            item = pattern.match(text, position, item.start("from") - 5)
        elif groups["one"] or groups["onebare"]:
            years = [int(groups["one"] or groups["onebare"])]
        elif groups["since"]:
            since = int(groups["since"])
        items.append({"cents": cents, "years": years, "since": since})
        position = end = item.end() if item else end
        separator = SEPARATOR.match(text, position)
        if not separator:
            break
        position = separator.end()
    return items, end


def parse_spending(text: str) -> dict[str, Any] | None:
    """First explicit spending clause of the text, with its per-year amounts.

    Only literal formulas are read. When the text does not tie every amount to
    a year ("10 milioni di euro annui", "per gli anni 2027 e 2028") the clause
    is kept with `trienniumCents` null instead of guessing. Coverage clauses
    ("agli oneri ... si provvede") are not read.
    """
    best: tuple[str, re.Match[str]] | None = None
    for label, pattern in ANCHORS:
        found = re.search(pattern, text, re.I)
        if found and (best is None or found.start() < best[1].start()):
            best = (label, found)
    if best is None:
        return None
    label, anchor = best
    start = anchor.start()
    items, end = read_items(text, anchor.end())
    if not items or any(entry["cents"] <= 0 for entry in items):
        return None
    if len(items) == 1 and items[0]["years"] is None and items[0]["since"] is None:
        breakdown = BREAKDOWN.match(text, end)
        leading = LEADING_YEARS.search(text, max(0, start - 140), start)
        if breakdown:
            # "spesa complessiva di X, di cui A per l'anno 2027 e B per il 2028": the parts must give X.
            parts, parts_end = read_items(text, breakdown.end(), bare_first=True)
            dated = parts and all(part["years"] is not None for part in parts)
            if dated and sum(part["cents"] * len(part["years"]) for part in parts) == items[0]["cents"]:
                items, end = parts, parts_end
        elif leading:
            years = [int(leading.group("one"))] if leading.group("one") else [int(year) for year in re.findall(r"\d{4}", leading.group("each"))]
            items = [{"cents": items[0]["cents"], "years": years, "since": None}]
            start = leading.start()
    dated = all(entry["years"] is not None or entry["since"] is not None for entry in items)
    by_year = {year: 0 for year in BUDGET_YEARS}
    if dated:
        for entry in items:
            covered = entry["years"] if entry["years"] is not None else [year for year in BUDGET_YEARS if year >= entry["since"]]
            for year in covered:
                if year in by_year:
                    by_year[year] += entry["cents"]
        # Amounts tied only to years outside 2027-2029 are not "zero in the triennium" for the reader.
        dated = sum(by_year.values()) > 0
    return {
        "kind": label,
        "items": items,
        "byYearCents": by_year if dated else None,
        "trienniumCents": sum(by_year.values()) if dated else None,
        # True when the text keeps spending after the last budget year, with or without an end.
        "permanent": any(entry["since"] is not None or any(year > BUDGET_YEARS[-1] for year in entry["years"] or []) for entry in items),
        "evidence": excerpt(text, start, end, before=160, after=0),
    }


# ── Comuni nominati nel testo ────────────────────────────────────────────────

def fold(value: str) -> str:
    base = unicodedata.normalize("NFKD", value.replace("’", "'").replace("`", "'"))
    base = "".join(char for char in base if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", base.replace("-", " ")).strip().casefold()


# Usual spellings of official names; the last two cover "Comune dell'Aquila" and
# "Comune della Spezia", the only article forms read (a generic "della" would
# turn "Comuni della Valle d'Aosta" into the Comune of La Valle).
NAME_ALIASES = {
    "reggio calabria": "Reggio di Calabria",
    "reggio emilia": "Reggio nell'Emilia",
    "dell'aquila": "L'Aquila",
    "della spezia": "La Spezia",
}


def municipalities_source(path: Path = GEOGRAPHY) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    latest = max(data["years"], key=lambda year: year["year"])
    day, month, year = latest["referenceDate"].split("/")
    return {"owner": data["source"]["owner"], "landingUrl": data["source"]["catalogUrl"], "referenceDate": f"{year}-{month}-{day}"}


def load_municipalities(path: Path = GEOGRAPHY) -> dict[str, list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    columns = data["columns"]
    latest = max(data["years"], key=lambda year: year["year"])
    index: dict[str, list[dict[str, Any]]] = {}
    for row in latest["rows"] if isinstance(latest.get("rows"), list) else latest["municipalities"]:
        record = dict(zip(columns, row))
        entry = {
            "istatCode": record["istatCode"],
            "name": record["name"],
            "regionCode": record["regionCode"],
            "population": record["residentPopulation"],
        }
        # Bilingual official names ("Bolzano/Bozen") are matched on either part.
        for variant in {record["name"], *record["name"].split("/")}:
            index.setdefault(fold(variant), []).append(entry)
    for alias, official in NAME_ALIASES.items():
        index[alias] = index[fold(official)]
    return index


MENTION = re.compile(r"\b(?:[Cc]omun[ei]|[Cc]ittà)\s+(?:di\s+|(?=dell'Aquila\b|della\s+Spezia\b))")
TOKEN = re.compile(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*")
MAX_NAME_TOKENS = 7


def match_name(text: str, position: int, index: dict[str, list[dict[str, Any]]]) -> tuple[list[dict[str, Any]], int] | None:
    """Longest official Comune name starting at `position`, capitalised in the text."""
    tokens: list[re.Match[str]] = []
    cursor = position
    while len(tokens) < MAX_NAME_TOKENS:
        token = TOKEN.match(text, cursor)
        if not token:
            break
        tokens.append(token)
        gap = re.match(r"[ ]", text[token.end():token.end() + 1])
        if not gap:
            break
        cursor = token.end() + 1
    if not tokens:
        return None
    article = tokens[0].group(0) in ("dell'Aquila", "della")
    if not article and not tokens[0].group(0)[0].isupper():
        return None
    for size in range(len(tokens), 0, -1):
        candidate = text[tokens[0].start():tokens[size - 1].end()].rstrip(".")
        found = index.get(fold(candidate))
        if found:
            return found, tokens[0].start() + len(candidate)
    return None


def parse_municipalities(text: str, index: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    """Comuni named after "comune di", "comuni di" or "città di", lists included."""
    found: dict[str, dict[str, Any]] = {}
    ambiguous: list[str] = []
    evidence: str | None = None
    for mention in MENTION.finditer(text):
        position = mention.end()
        while True:
            matched = match_name(text, position, index)
            if not matched:
                break
            entries, end = matched
            if len(entries) == 1:
                found.setdefault(entries[0]["istatCode"], entries[0])
            else:
                ambiguous.append(entries[0]["name"])
            if evidence is None:
                evidence = excerpt(text, mention.start(), end, before=140, after=120)
            separator = re.match(r"\s*(?:,\s*(?:e\s+)?|\s+e\s+|\s+ed\s+)(?:di\s+)?", text[end:])
            if not separator:
                break
            position = end + separator.end()
    if not found and not ambiguous:
        return None
    return {
        "municipalities": sorted(found.values(), key=lambda item: item["istatCode"]),
        "ambiguousNames": sorted(set(ambiguous)),
        "evidence": evidence,
    }


# ── copertura indicata nel testo ─────────────────────────────────────────────

COVERAGE_SENTENCE = re.compile(r"si\s+provvede|mediante\s+corrispondente\s+riduzione|a\s+valere\s+su", re.I)
COVERAGE_FUNDS = (
    # Fondo per interventi strutturali di politica economica, art. 10, c. 5, DL 282/2004.
    ("fispe", re.compile(r"fondo\s+per\s+(?:gli\s+)?interventi\s+strutturali\s+di\s+politica\s+economica|articolo\s+10,\s+comma\s+5,?\s+del\s+decreto-legge.{0,45}?\b282\b", re.I)),
    # Fondo per far fronte ad esigenze indifferibili, art. 1, c. 200, L. 190/2014.
    ("esigenze_indifferibili", re.compile(r"fondo\s+per\s+(?:far\s+fronte\s+ad\s+|le\s+)?esigenze\s+indifferibili|articolo\s+1,\s+comma\s+200,?\s+della\s+legge.{0,45}?\b190\b", re.I)),
)


def parse_coverage(text: str) -> list[str] | None:
    """Funds named in the coverage clauses; None when the text has no coverage clause.

    An empty list means a coverage clause that names neither of the two funds.
    """
    # "n. 190" and "art. 1" are not sentence ends.
    joined = re.sub(r"\b(n|art|artt|lett)\.\s", lambda match: match.group(1) + ".\x00", text)
    sentences = [sentence for sentence in re.split(r"(?<=\.)\s", joined) if COVERAGE_SENTENCE.search(sentence)]
    if not sentences:
        return None
    clauses = " ".join(sentences).replace("\x00", " ")
    return [key for key, pattern in COVERAGE_FUNDS if pattern.search(clauses)]


# ── assemblaggio ─────────────────────────────────────────────────────────────

def expected_page_outcome(row: dict[str, Any]) -> str:
    """Text the amendment page must show for the outcome read in the list."""
    if row["outcome"] == "inammissibile":
        return f"inammissibile {INADMISSIBILITY_NOTES[row['reason']]}"
    return ""


def constituency_region(constituency: str | None) -> str | None:
    if not constituency:
        return None
    folded = fold(constituency)
    for code, name in REGIONS.items():
        if folded.startswith(fold(name)):
            return code
    return None


def load_deputies(path: Path = DEPUTIES) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    deputies = {deputy["numericId"]: deputy for deputy in data["deputies"]}
    groups = [{"id": group["id"], "label": group["displayLabel"], "members": group["memberCount"]} for group in data["groups"]]
    return deputies, groups, data["source"]


def build(spec: dict[str, Any], cache: Path) -> dict[str, Any]:
    source = spec["source"]
    list_bytes = (cache / "lista.html").read_bytes()
    if len(list_bytes) != source["list"]["bytes"] or sha256_bytes(list_bytes) != source["list"]["sha256"]:
        raise EmendamentiError("elenco: byte o SHA-256 diversi dal source lock")
    rows = parse_list(list_bytes.decode("utf-8"))
    expected = spec["expected"]
    deputies, groups, deputies_source = load_deputies()
    municipalities = load_municipalities()
    manifest = hashlib.sha256()
    page_bytes = 0
    proponents: dict[str, dict[str, Any]] = {}
    amendments: list[dict[str, Any]] = []
    for row in rows:
        payload = (cache / "pages" / f"{row['id']}.html").read_bytes()
        page_bytes += len(payload)
        manifest.update(f"{row['id']}\t{sha256_bytes(payload)}\n".encode())
        page = parse_page(payload.decode("utf-8"), row["id"])
        first = page["signers"][0]
        if first["personId"] != row["first"]["personId"] or (row["listedSigners"] is not None and row["listedSigners"] != len(page["signers"])):
            raise EmendamentiError(f"{row['id']}: firmatari della pagina diversi dall'elenco")
        if page["outcomeText"] != expected_page_outcome(row):
            raise EmendamentiError(f"{row['id']}: esito della pagina diverso dall'elenco")
        key = first["personId"] or "governo"
        if key not in proponents:
            deputy = deputies.get(first["personId"]) if first["personId"] else None
            proponents[key] = {
                "key": key,
                "name": deputy["displayName"] if deputy else first["name"],
                "groupId": deputy["groupId"] if deputy else ("governo" if key == "governo" else None),
                "constituency": deputy["constituency"] if deputy else None,
                "regionCode": constituency_region(deputy["constituency"]) if deputy else None,
            }
        territory = parse_municipalities(page["text"], municipalities)
        signer_groups = sorted({deputies[signer["personId"]]["groupId"] for signer in page["signers"] if signer["personId"] in deputies})
        if key == "governo":
            signer_groups = ["governo"]
        spending = parse_spending(page["text"])
        if spending is not None:
            spending = {key: value for key, value in spending.items() if key != "items"}
        amendments.append({
            "id": row["id"],
            "section": row["section"],
            "position": row["position"],
            "additionalArticle": row["id"].split(".")[-1].startswith("0") and not row["id"].startswith("Tab."),
            "title": page["title"],
            "proponent": key,
            "signers": len(page["signers"]),
            "signerGroups": signer_groups,
            "coverage": parse_coverage(page["text"]),
            "outcome": row["outcome"],
            "reason": row["reason"],
            "partialNote": row["partialNote"],
            "identicalTo": row["identicalTo"],
            "spending": spending,
            "territory": territory,
        })
    totals = {
        "amendments": len(amendments),
        "inadmissible": sum(item["outcome"] == "inammissibile" for item in amendments),
        "partiallyInadmissible": sum(item["outcome"] == "parzialmente_inammissibile" for item in amendments),
        "byReason": {reason: sum(item["reason"] == reason for item in amendments) for reason in sorted(set(INADMISSIBILITY_REASONS.values()))},
        "withIdentical": sum(bool(item["identicalTo"]) for item in amendments),
        "sections": len({item["section"] for item in amendments}),
        "singleSigner": sum(item["signers"] == 1 for item in amendments),
    }
    for key, value in expected["totals"].items():
        if totals.get(key) != value:
            raise EmendamentiError(f"totale {key}: {totals.get(key)} diverso dall'atteso {value}")
    if manifest.hexdigest() != source["pages"]["manifestSha256"] or page_bytes != source["pages"]["bytes"]:
        raise EmendamentiError("pagine: manifest o byte diversi dal source lock")
    unknown = sorted(item["key"] for item in proponents.values() if item["groupId"] is None)
    if unknown != expected["proponentsWithoutGroup"]:
        raise EmendamentiError(f"primi firmatari senza gruppo inattesi: {unknown}")
    return {
        "schemaVersion": 1,
        "datasetId": spec["datasetId"],
        "act": spec["act"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "listUrl": source["list"]["url"],
            "amendmentUrlTemplate": source["pages"]["urlTemplate"],
            "license": source["license"],
            "licenseUrl": source["licenseUrl"],
            "acquiredAt": source["acquiredAt"],
            "list": {"bytes": source["list"]["bytes"], "sha256": source["list"]["sha256"]},
            "pages": {"count": len(rows), "bytes": page_bytes, "manifestSha256": manifest.hexdigest()},
        },
        "deputiesSource": {
            "datasetId": "politici-camera-xix",
            "owner": deputies_source["owner"],
            "landingUrl": deputies_source["landingUrl"],
            "license": deputies_source["license"],
            "acquiredAt": deputies_source["acquiredAt"][:10],
        },
        "municipalitiesSource": municipalities_source(),
        "totals": totals,
        "groups": groups + [{"id": "governo", "label": "Governo", "members": None}],
        "proponents": sorted(proponents.values(), key=lambda item: item["key"]),
        "amendments": amendments,
    }


def serialize(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n").encode("utf-8")


def receipt_for(payload: bytes, data: dict[str, Any], output: Path, code_sha: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "documentPath": output.relative_to(ROOT).as_posix(),
        "codeSha": code_sha,
        "sourceSha256": sha256_bytes(payload),
        "sourceBytes": len(payload),
        "amendments": data["totals"]["amendments"],
        "sittingDate": data["act"]["sittingDate"],
    }


# ── acquisizione (solo con --fetch) ──────────────────────────────────────────

def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:  # noqa: S310 - URL ufficiale fissato nello spec
        return response.read()


def acquire(spec: dict[str, Any], cache: Path) -> None:
    pages = cache / "pages"
    pages.mkdir(parents=True, exist_ok=True)
    list_path = cache / "lista.html"
    if not list_path.exists():
        list_path.write_bytes(fetch(spec["source"]["list"]["url"]))
    rows = parse_list(list_path.read_text(encoding="utf-8"))
    template = spec["source"]["pages"]["urlTemplate"]

    def one(row: dict[str, Any]) -> None:
        target = pages / f"{row['id']}.html"
        if target.exists():
            return
        for attempt in range(5):
            try:
                payload = fetch(template.replace("{id}", row["id"]).replace("{published}", row["published"]))
                parse_page(payload.decode("utf-8"), row["id"])
                target.write_bytes(payload)
                time.sleep(0.15)
                return
            except Exception:  # noqa: BLE001 - riprova, poi fallisce in modo esplicito
                time.sleep(2 + attempt * 3)
        raise EmendamentiError(f"pagina non acquisita: {row['id']}")

    with ThreadPoolExecutor(4) as executor:
        list(executor.map(one, rows))


def update_lock(spec_path: Path, spec: dict[str, Any], cache: Path) -> None:
    """Pin the acquisition just made: list bytes and hash, and the manifest of the pages."""
    list_bytes = (cache / "lista.html").read_bytes()
    manifest = hashlib.sha256()
    page_bytes = 0
    for row in parse_list(list_bytes.decode("utf-8")):
        payload = (cache / "pages" / f"{row['id']}.html").read_bytes()
        page_bytes += len(payload)
        manifest.update(f"{row['id']}\t{sha256_bytes(payload)}\n".encode())
    spec["source"]["list"].update(bytes=len(list_bytes), sha256=sha256_bytes(list_bytes))
    spec["source"]["pages"].update(bytes=page_bytes, manifestSha256=manifest.hexdigest())
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    parser.add_argument("--code-sha", help="SHA del codice con cui il payload viene importato in dvns_snapshots")
    parser.add_argument("--fetch", action="store_true", help="scarica elenco e pagine mancanti dalla Camera")
    parser.add_argument("--update-lock", action="store_true", help="dopo una nuova acquisizione, riscrive byte e hash nel source lock")
    parser.add_argument("--write", action="store_true", help="scrive payload locale e ricevuta")
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    try:
        if args.fetch:
            acquire(spec, args.cache)
        if args.update_lock:
            update_lock(args.spec, spec, args.cache)
        data = build(spec, args.cache)
    except (EmendamentiError, FileNotFoundError) as error:
        print(f"camera-emendamenti-bilancio-2027: {error}", file=sys.stderr)
        return 1
    payload = serialize(data)
    if args.write:
        if not args.code_sha or not re.fullmatch(r"[0-9a-f]{40}", args.code_sha):
            print("camera-emendamenti-bilancio-2027: --write richiede --code-sha di 40 caratteri", file=sys.stderr)
            return 1
        args.output.write_bytes(payload)
        receipt = receipt_for(payload, data, args.output, args.code_sha)
        args.receipt.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"camera-emendamenti-bilancio-2027: {data['totals']['amendments']} proposte, payload {len(payload)} byte, sha256 {sha256_bytes(payload)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
