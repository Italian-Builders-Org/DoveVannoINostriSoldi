#!/usr/bin/env python3
"""Validate the MASAF Mercati typed snapshot from the committed seed, offline."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/masaf-logistica-mercati.source.json"
SEED = ROOT / "scripts/etl/fixtures/masaf-logistica-mercati.seed.json"
DATA = ROOT / "src/data/generated/masaf-logistica-mercati.data.json"
META = ROOT / "src/data/generated/masaf-logistica-mercati.meta.json"
DATASET = "masaf-logistica-mercati"
CUP_RE = re.compile(r"^[A-Z0-9]{15}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
OFFICIAL_HOSTS = frozenset({"www.masaf.gov.it", "masaf.gov.it", "www.italiadomani.gov.it"})
MACRO_AREAS = frozenset({"Nord", "Centro", "Sud"})
STATI = frozenset({"in-graduatoria", "concessione-pubblicata"})
MAX_AGEVOLAZIONE_EURO = Decimal("10000000")


class SnapshotError(ValueError):
    """Seed, money, provenance or published artifacts diverge from the lock."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def euro_to_cents(value: object, field: str) -> int:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"{field}: importo non numerico") from error
    require(amount.is_finite() and amount >= 0, f"{field}: importo non valido")
    cents = amount * 100
    require(cents == cents.to_integral_value(), f"{field}: più di due decimali")
    return int(cents)


def require_official_url(url: str, field: str) -> None:
    parsed = urlparse(url)
    require(parsed.scheme == "https" and parsed.hostname in OFFICIAL_HOSTS, f"{field}: URL non ufficiale")


def load_spec(path: Path = SPEC) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    require(spec["measure"]["line"] == "mercati", "perimetro diverso dalla linea Mercati")
    require(spec["measure"]["pnrrCode"] == "M2C1I2.01", "codice PNRR inatteso")
    require(spec["source"]["licenseId"] == "not-declared", "licenza non va inferita")
    require_official_url(spec["landingUrl"], "landingUrl")
    require_official_url(spec["source"]["landingUrl"], "source.landingUrl")
    return spec


def load_seed(spec: dict, path: Path = SEED) -> dict:
    raw = path.read_bytes()
    asset = spec["source"]["assets"]["seed"]
    require(len(raw) == asset["bytes"] and sha256_bytes(raw) == asset["sha256"], "seed bytes/hash differ")
    seed = json.loads(raw)
    require(seed["schemaVersion"] == 1, "schemaVersion inattesa")
    require(seed["measure"]["line"] == "mercati", "seed fuori perimetro Mercati")
    require(seed["licenseStatus"] == "not-declared", "licenza seed diversa dal lock")
    require(seed["referencePeriod"]["avvisoYear"] == spec["period"]["avvisoYear"], "periodo avviso diverge")
    require(
        seed["acquisition"]["regisExtractionDate"] == spec["period"]["regisExtractionDate"],
        "data estrazione ReGiS diverge",
    )
    for key, source in seed["sources"].items():
        require_official_url(source["url"], f"sources.{key}.url")
        if source.get("pdfUrl"):
            require_official_url(source["pdfUrl"], f"sources.{key}.pdfUrl")
    return seed


def validate_project(project: dict, seen_codes: set[str], seen_cups: set[str]) -> None:
    code = project["codiceDomanda"]
    require(isinstance(code, str) and code.strip(), "codice domanda assente")
    require(code not in seen_codes, f"domanda duplicata: {code}")
    seen_codes.add(code)
    require(project["macroArea"] in MACRO_AREAS, f"{code}: macro-area inattesa")
    stato = project["statoDocumentato"]
    require(stato in STATI, f"{code}: stato documentato inatteso")
    require(project["erogazioniEuro"] is None and project["pagamentiEuro"] is None, f"{code}: pagamenti inventati")

    richiesta_cents = euro_to_cents(project["agevolazioneRichiestaEuro"], f"{code}.richiesta")
    require(project["agevolazioneRichiestaCents"] == richiesta_cents, f"{code}: centesimi richiesta divergono")
    require(Decimal(str(project["agevolazioneRichiestaEuro"])) <= MAX_AGEVOLAZIONE_EURO, f"{code}: richiesta oltre tetto")

    concessa = project["agevolazioneConcessaEuro"]
    if concessa is None:
        require(project["agevolazioneConcessaCents"] is None, f"{code}: concessa nulla ma centesimi presenti")
    else:
        concessa_cents = euro_to_cents(concessa, f"{code}.concessa")
        require(project["agevolazioneConcessaCents"] == concessa_cents, f"{code}: centesimi concessa divergono")
        require(Decimal(str(concessa)) <= MAX_AGEVOLAZIONE_EURO, f"{code}: concessa oltre tetto")

    pnrr = project["finanziamentoPnrrEuro"]
    if pnrr is None:
        require(project["finanziamentoPnrrCents"] is None, f"{code}: finanziamento PNRR nullo ma centesimi presenti")
    else:
        require(project["finanziamentoPnrrCents"] == euro_to_cents(pnrr, f"{code}.pnrr"), f"{code}: centesimi PNRR divergono")

    totale = project["finanziamentoTotaleEuro"]
    if totale is None:
        require(project["finanziamentoTotaleCents"] is None, f"{code}: finanziamento totale nullo ma centesimi presenti")
    else:
        require(
            project["finanziamentoTotaleCents"] == euro_to_cents(totale, f"{code}.totale"),
            f"{code}: centesimi totale divergono",
        )

    cup = project["cup"]
    concessione = project["concessione"]
    if stato == "concessione-pubblicata":
        require(isinstance(concessione, dict), f"{code}: concessione attesa")
        require_official_url(concessione["url"], f"{code}.concessione.url")
        require(SHA_RE.fullmatch(concessione["sha256"]), f"{code}: hash decreto assente")
        require(isinstance(concessione["bytes"], int) and concessione["bytes"] > 0, f"{code}: byte decreto assenti")
        if cup is not None:
            require(isinstance(cup, str) and CUP_RE.fullmatch(cup), f"{code}: CUP non valido")
            require(cup not in seen_cups, f"CUP duplicato: {cup}")
            seen_cups.add(cup)
    else:
        require(cup is None, f"{code}: CUP presente senza decreto")
        require(concessione is None, f"{code}: decreto presente solo in graduatoria")
        require(concessa is None, f"{code}: concessa inventata senza decreto")


def counts_from(projects: list[dict], denials: list[dict]) -> dict[str, int]:
    return {
        "projects": len(projects),
        "withCup": sum(1 for project in projects if project.get("cup")),
        "withGranted": sum(1 for project in projects if project.get("agevolazioneConcessaEuro") is not None),
        "withRegis": sum(1 for project in projects if project.get("statoAvanzamentoRegis")),
        "denials": len(denials),
    }


def build(seed: dict, spec: dict) -> tuple[dict, dict]:
    projects = seed["projects"]
    denials = seed["denials"]
    require(isinstance(projects, list) and isinstance(denials, list), "seed senza elenchi")
    seen_codes: set[str] = set()
    seen_cups: set[str] = set()
    seen_denials: set[str] = set()
    for project in projects:
        validate_project(project, seen_codes, seen_cups)
    for denial in denials:
        code = denial["codiceDomanda"]
        require(code not in seen_denials, f"diniego duplicato: {code}")
        seen_denials.add(code)
        require(code not in seen_codes, f"diniego e ammissione con lo stesso codice: {code}")
    counts = counts_from(projects, denials)
    require(counts == spec["coverage"], "copertura diversa dal lock")
    data = {"projects": projects, "denials": denials}
    meta = {
        "datasetId": DATASET,
        "schemaVersion": seed["schemaVersion"],
        "measure": seed["measure"],
        "sources": seed["sources"],
        "referencePeriod": seed["referencePeriod"],
        "acquisition": seed["acquisition"],
        "licenseStatus": seed["licenseStatus"],
        "caveats": seed["caveats"],
        "counts": counts,
    }
    return data, meta


def check(spec_path: Path = SPEC, seed_path: Path = SEED, data_path: Path = DATA, meta_path: Path = META) -> None:
    spec = load_spec(spec_path)
    seed = load_seed(spec, seed_path)
    data, meta = build(seed, spec)
    require(json.loads(data_path.read_text(encoding="utf-8")) == data, "data artifact differs from seed")
    require(json.loads(meta_path.read_text(encoding="utf-8")) == meta, "meta artifact differs from seed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida seed e artefatti committati senza rete")
    args = parser.parse_args()
    if not args.check:
        raise SnapshotError("usa --check: lo snapshot è curato dal seed committato")
    check()
    print(f"{DATASET}: seed lock, copertura, soldi e provenance verificati offline")


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as error:
        raise SystemExit(f"{DATASET}: {error}") from error
