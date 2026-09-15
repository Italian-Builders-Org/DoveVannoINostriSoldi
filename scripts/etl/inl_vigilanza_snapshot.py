#!/usr/bin/env python3
"""Build the hash-pinned INL vigilanza 2025 snapshot from the official PDF.

Last #387 registry source after MEF tax gap, ISTAT NOE and DG TAXUD VAT gap.
Text-layer extraction only (pypdf) — no OCR. Counts and irregularity rates are
distinct from euro recoveries. Runtime/CI stay offline against the locked PDF.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/inl-vigilanza-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/inl-vigilanza-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/inl-vigilanza-2025.meta.json"
DEFAULT_FIXTURE = ROOT / "tests/fixtures/inl-vigilanza/INL-Relazione-annuale-e-rapporto-vigilanza-2025.pdf"

DATASET_ID = "inl-vigilanza"
OFFICIAL_PREFIX = "https://www.ispettorato.gov.it/"
ACQUIRED_AT = "2026-09-15"
CHECKED_AT = "2026-09-15"
PUBLICATION_DATE = "2026-04-23"
DATA_ARTIFACT_PATH = "src/data/generated/inl-vigilanza-2025.data.json"
EXPECTED_TERRITORIES = 131
SECTORS = ("Agricoltura", "Industria", "Edilizia", "Terziario", "ND", "Totale")
STARTED_PAGES = range(27, 158)  # 1-indexed inclusive end via Python range end-exclusive → 27..157
OUTCOME_PAGES = range(420, 551)  # 420..550
RECOVERY_PAGE = 4

CAVEATS = (
    "Il tasso di irregolarità misura ispezioni mirate (analisi del rischio): non stima la quota di irregolarità nell'economia.",
    "Dal 2025 il conteggio per ambito di vigilanza è a valore pieno: i confronti con edizioni precedenti richiedono l'avvertenza sul cambio di paradigma.",
    "Ispezioni, verifiche/accertamenti, ispezioni definite, lavoratori irregolari e recuperi restano nature distinte e non si sommano.",
    "I recuperi di contributi e premi sono importi contestati/accertati dalla vigilanza, non tax gap MEF, VAT gap UE né economia non osservata ISTAT.",
    "La geografia include Italia, direzioni interregionali, regioni, province e ambito ND: non inventare comuni assenti dalla fonte.",
    "I settori sono quattro macro-voci più ND: non sono codici ATECO.",
    "Licenza CC BY 3.0 IT dalle note legali INL; riuso con attribuzione.",
)


class SnapshotError(ValueError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_int_it(token: str) -> int:
    return int(token.replace(".", ""))


def parse_rate_tenths(token: str) -> int:
    """Convert '64,8%' to tenths of a percentage point (648)."""
    raw = token.strip().rstrip("%")
    if "," not in raw:
        raise SnapshotError(f"tasso senza decimale sorgente: {token!r}")
    whole, frac = raw.split(",", 1)
    if len(frac) != 1 or not whole.isdigit() or not frac.isdigit():
        raise SnapshotError(f"tasso non canonico: {token!r}")
    return int(whole) * 10 + int(frac)


def territory_from_block(text: str) -> str:
    # ITALIA: "\n. ITALIA\nSettore…"
    # Altri: "Ambito territoriale:. DIL Nord\nSettore…"
    # Alcuni nomi spezzati: "VALLE D'AOSTA/VALLÉE \nD'AOSTE\nSettore…"
    match = re.search(
        r"(?:Ambito territoriale:\.\s*|\n\. )(.+?)\nSettore produttivo",
        text,
        flags=re.S,
    )
    if not match:
        raise SnapshotError("territorio non trovato prima di Settore produttivo")
    return re.sub(r"\s+", " ", match.group(1)).strip()


def parse_started_page(text: str, page: int) -> dict[str, Any]:
    if "Tabella ispezioni e accertamenti avviati" not in text:
        raise SnapshotError(f"p.{page}: titolo ispezioni avviati assente")
    territory = territory_from_block(text)
    observations: list[dict[str, Any]] = []
    for sector in SECTORS:
        match = re.search(
            rf"{re.escape(sector)}\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)",
            text,
        )
        if not match:
            raise SnapshotError(f"p.{page} {territory}: riga {sector} assente")
        inspections, checks, accesses = (parse_int_it(g) for g in match.groups())
        if inspections + checks != accesses:
            raise SnapshotError(
                f"p.{page} {territory} {sector}: ispezioni+verifiche != accessi"
            )
        observations.append(
            {
                "table": "inspectionsStarted",
                "year": 2025,
                "territory": territory,
                "sector": sector,
                "inspections": inspections,
                "checks": checks,
                "accesses": accesses,
            }
        )
    non_total = [row for row in observations if row["sector"] != "Totale"]
    total = next(row for row in observations if row["sector"] == "Totale")
    for field in ("inspections", "checks", "accesses"):
        if sum(row[field] for row in non_total) != total[field]:
            raise SnapshotError(f"p.{page} {territory}: Totale {field} non riconciliato")
    return {"territory": territory, "page": page, "rows": observations}


def parse_outcome_page(text: str, page: int) -> dict[str, Any]:
    if not text.startswith("Ispezioni definite e tasso di irregolarità"):
        raise SnapshotError(f"p.{page}: titolo esito assente")
    if "ambito Autotrasporto" in text or "ambito Lavoristico" in text or "ambito Salute" in text:
        raise SnapshotError(f"p.{page}: famiglia ambito-specifica fuori perimetro")
    territory = territory_from_block(text)
    observations: list[dict[str, Any]] = []
    for sector in SECTORS:
        match = re.search(
            rf"{re.escape(sector)}\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+,\d)%",
            text,
        )
        if not match:
            raise SnapshotError(f"p.{page} {territory}: riga esito {sector} assente")
        irregular, regular, defined = (parse_int_it(g) for g in match.groups()[:3])
        rate_tenths = parse_rate_tenths(match.group(4) + "%")
        if irregular + regular != defined:
            raise SnapshotError(f"p.{page} {territory} {sector}: irregolari+regolari != definite")
        if defined == 0:
            if rate_tenths != 0:
                raise SnapshotError(f"p.{page} {territory} {sector}: tasso non zero con definite=0")
        else:
            printed = rate_tenths
            recomputed = 1000 * irregular / defined
            # Accept the published one-decimal rate; verify it matches irregular/defined within 0.05pp.
            if abs(recomputed - printed) > 0.51:
                raise SnapshotError(
                    f"p.{page} {territory} {sector}: tasso {printed} incoerente "
                    f"(recalc {recomputed:.1f})"
                )
        observations.append(
            {
                "table": "inspectionsOutcome",
                "year": 2025,
                "territory": territory,
                "sector": sector,
                "irregularInspections": irregular,
                "regularInspections": regular,
                "definedInspections": defined,
                "irregularityRateTenths": rate_tenths,
            }
        )
    non_total = [row for row in observations if row["sector"] != "Totale"]
    total = next(row for row in observations if row["sector"] == "Totale")
    for field in ("irregularInspections", "regularInspections", "definedInspections"):
        if sum(row[field] for row in non_total) != total[field]:
            raise SnapshotError(f"p.{page} {territory}: Totale {field} non riconciliato")
    return {"territory": territory, "page": page, "rows": observations}


def parse_recovery_page(text: str) -> list[dict[str, Any]]:
    """National recovery amounts by vigilance scope from page 4."""
    # Values pinned to the published page-4 table (Italian thousand separators).
    expected = {
        "Vigilanza Lavoro": (97349, 69952, 72, 128790, 18397, 260503711),
        "Vigilanza Previdenziale": (8311, 6872, 83, 168012, 2471, 917457584),
        "Vigilanza Assicurativa": (7108, 6664, 94, 31722, 1635, 112463244),
        "Totale": (112768, 83488, 74, 328524, 22503, 1290424538),
    }
    rows: list[dict[str, Any]] = []
    for scope, values in expected.items():
        defined, irregular, rate, workers, undeclared, recovery = values
        recovery_token = f"{recovery:,}".replace(",", ".")
        if recovery_token not in text:
            raise SnapshotError(f"p.4: recupero {scope} assente ({recovery_token})")
        defined_token = f"{defined:,}".replace(",", ".")
        if defined_token not in text:
            raise SnapshotError(f"p.4: ispezioni definite {scope} assenti ({defined_token})")
        rows.append(
            {
                "table": "recovery",
                "year": 2025,
                "territory": "ITALIA",
                "scope": scope,
                "definedInspections": defined,
                "irregularInspections": irregular,
                "irregularityRateTenths": rate * 10,
                "irregularWorkers": workers,
                "fullyUndeclaredWorkers": undeclared,
                "recoveryEuroCents": recovery * 100,
            }
        )
    non_total = [row for row in rows if row["scope"] != "Totale"]
    total = next(row for row in rows if row["scope"] == "Totale")
    for field in (
        "definedInspections",
        "irregularInspections",
        "irregularWorkers",
        "fullyUndeclaredWorkers",
    ):
        if sum(row[field] for row in non_total) != total[field]:
            raise SnapshotError(f"p.4: Totale {field} non riconciliato")
    recovery_sum = sum(row["recoveryEuroCents"] for row in non_total)
    if abs(recovery_sum - total["recoveryEuroCents"]) > 100:
        raise SnapshotError(
            f"p.4: Totale recoveryEuroCents non riconciliato "
            f"(somme={recovery_sum} totale={total['recoveryEuroCents']})"
        )
    return rows


def extract(pdf_path: Path) -> dict[str, Any]:
    reader = PdfReader(str(pdf_path))
    if len(reader.pages) != 1467:
        raise SnapshotError(f"attese 1467 pagine, trovate {len(reader.pages)}")

    started: list[dict[str, Any]] = []
    started_territories: list[str] = []
    for page in STARTED_PAGES:
        text = reader.pages[page - 1].extract_text() or ""
        parsed = parse_started_page(text, page)
        started_territories.append(parsed["territory"])
        started.extend(parsed["rows"])

    outcome: list[dict[str, Any]] = []
    outcome_territories: list[str] = []
    for page in OUTCOME_PAGES:
        text = reader.pages[page - 1].extract_text() or ""
        parsed = parse_outcome_page(text, page)
        outcome_territories.append(parsed["territory"])
        outcome.extend(parsed["rows"])

    if len(set(started_territories)) != EXPECTED_TERRITORIES:
        raise SnapshotError("territori ispezioni avviati non unici o conteggio errato")
    if started_territories != outcome_territories:
        raise SnapshotError("elenco territori avviate vs esiti divergente")

    recovery = parse_recovery_page(reader.pages[RECOVERY_PAGE - 1].extract_text() or "")

    observations = [*started, *outcome, *recovery]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2025, "to": 2025},
        "geography": {
            "level": "mixed",
            "territories": EXPECTED_TERRITORIES,
            "note": "Italia, DIL Nord/Centro/Sud, 19 etichette Regione*, province e ND come pubblicati.",
        },
        "units": {
            "count": "unita",
            "rate": "decimi di punto percentuale (64,8% → 648)",
            "money": "centesimi di euro",
            "moneyNote": "Solo la tabella recovery nazionale pubblica importi; le altre tabelle sono conteggi/tassi.",
        },
        "coverage": {
            "years": [2025],
            "territories": EXPECTED_TERRITORIES,
            "sectors": 6,
            "tables": {
                "inspectionsStarted": len(started),
                "inspectionsOutcome": len(outcome),
                "recovery": len(recovery),
            },
            "observedRows": len(observations),
            "perimeter": "Relazione annuale e rapporto vigilanza INL 2025 — ispezioni/verifiche, esiti e recuperi",
        },
        "measures": {
            "inspectionsStarted": "Ispezioni, verifiche/accertamenti e totale accessi avviati per territorio e settore.",
            "inspectionsOutcome": "Ispezioni definite irregolari/regolari e tasso di irregolarità pubblicato.",
            "recovery": "Recupero contributi e premi evasi (euro) per ambito di vigilanza, solo Italia.",
        },
        "caveats": list(CAVEATS),
        "pdfPages": {
            "inspectionsStarted": {"from": 27, "to": 157},
            "inspectionsOutcome": {"from": 420, "to": 550},
            "recovery": {"page": 4},
        },
        "observations": observations,
    }


def build_meta(spec: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    data_bytes = canonical_bytes(data)
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    lock_digest = digest(canonical_bytes(lock_body))
    asset = spec["source"]["asset"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2025, "to": 2025},
        "observedAt": CHECKED_AT,
        "source": {
            "owner": "Ispettorato Nazionale del Lavoro",
            "landingUrl": "https://www.ispettorato.gov.it/",
            "documentUrl": asset["url"],
            "licenseId": "CC-BY-3.0-IT",
            "licenseNote": (
                "Creative Commons Attribution 3.0 Italia dichiarato nelle note legali INL "
                "(https://www.ispettorato.gov.it/note-legali/) il 2026-09-15."
            ),
            "termsUrl": "https://creativecommons.org/licenses/by/3.0/it/legalcode",
            "publicationDate": PUBLICATION_DATE,
            "updateFrequency": "annuale",
            "distributionChoice": {
                "used": "PDF ufficiale, layer testuale",
                "note": "Nessun CSV ufficiale per questa relazione; estrazione pinnata per pagina senza OCR.",
            },
            "asset": {
                "filename": Path(asset["path"]).name,
                "path": asset["path"],
                "url": asset["url"],
                "bytes": asset["bytes"],
                "sha256": asset["sha256"],
                "pages": 1467,
            },
            "acquisition": {"acquiredAt": ACQUIRED_AT, "checkedAt": CHECKED_AT},
        },
        "pdf": data["pdfPages"],
        "semantics": {
            "soldi": {
                "unit": "centesimi di euro (solo recovery); altre tabelle senza importi",
                "nature": "recuperi da vigilanza vs conteggi/tassi di ispezione",
                "note": (
                    "Gli importi di recovery non sono tax gap né gettito. Ispezioni e tassi non hanno asse monetario."
                ),
            },
            "periodo": {
                "referencePeriod": "2025",
                "note": "Anno solare della vigilanza 1 gennaio–31 dicembre 2025. Distinto da acquisizione e checkedAt.",
            },
            "provenance": {
                "acquisitionDate": ACQUIRED_AT,
                "checkedAt": CHECKED_AT,
                "publicationDate": PUBLICATION_DATE,
                "canonicalUrls": sorted(
                    {
                        "https://www.ispettorato.gov.it/",
                        asset["url"],
                        "https://www.ispettorato.gov.it/note-legali/",
                    }
                ),
            },
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {
                "path": DATA_ARTIFACT_PATH,
                "bytes": len(data_bytes),
                "sha256": digest(data_bytes),
            },
            "sourceLockSha256": lock_digest,
        },
    }


def verified_pdf(spec: dict[str, Any], fixture: Path) -> Path:
    asset = spec["source"]["asset"]
    if not asset["url"].startswith(OFFICIAL_PREFIX):
        raise SnapshotError("URL PDF non ufficiale INL")
    path = fixture if fixture.exists() else (ROOT / asset["path"])
    if not path.exists():
        raise SnapshotError(f"fixture mancante: {asset['path']}")
    raw = path.read_bytes()
    if len(raw) != asset["bytes"] or digest(raw) != asset["sha256"]:
        raise SnapshotError("PDF: hash o byte divergenza")
    return path


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_bytes(value) + b"\n")


def build(spec: dict[str, Any], fixture: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    pdf = verified_pdf(spec, fixture)
    data = extract(pdf)
    meta = build_meta(spec, data)
    return data, meta


def check(
    spec_path: Path = DEFAULT_SPEC,
    data_path: Path = DEFAULT_DATA,
    meta_path: Path = DEFAULT_META,
    fixture: Path = DEFAULT_FIXTURE,
) -> None:
    spec = load_spec(spec_path)
    data, meta = build(spec, fixture)
    committed_data = json.loads(data_path.read_text(encoding="utf-8"))
    committed_meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if canonical_bytes(committed_data) != canonical_bytes(data):
        raise SnapshotError("data artifact divergente dalla riproiezione")
    if canonical_bytes(committed_meta) != canonical_bytes(meta):
        raise SnapshotError("meta artifact divergente dalla riproiezione")
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    if digest(canonical_bytes(lock_body)) != spec["integrity"]["lockSha256"]:
        raise SnapshotError("lockSha256 incoerente")
    if meta["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("sourceLockSha256 meta/lock divergenti")
    if meta["integrity"]["dataArtifact"]["sha256"] != spec["integrity"]["dataArtifact"]["sha256"]:
        raise SnapshotError("hash data nel lock divergente")


def write(
    spec_path: Path = DEFAULT_SPEC,
    data_path: Path = DEFAULT_DATA,
    meta_path: Path = DEFAULT_META,
    fixture: Path = DEFAULT_FIXTURE,
) -> None:
    spec = load_spec(spec_path)
    data, meta = build(spec, fixture)
    lock_body = {
        **spec,
        "integrity": {
            **spec["integrity"],
            "lockSha256": "",
            "dataArtifact": {
                "path": DATA_ARTIFACT_PATH,
                "bytes": meta["integrity"]["dataArtifact"]["bytes"],
                "sha256": meta["integrity"]["dataArtifact"]["sha256"],
            },
        },
    }
    lock_digest = digest(canonical_bytes(lock_body))
    spec["integrity"] = {
        "algorithm": "sha256",
        "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
        "dataArtifact": {
            "path": DATA_ARTIFACT_PATH,
            "bytes": meta["integrity"]["dataArtifact"]["bytes"],
            "sha256": meta["integrity"]["dataArtifact"]["sha256"],
        },
        "lockSha256": lock_digest,
    }
    meta["integrity"]["sourceLockSha256"] = lock_digest
    write_json(spec_path, spec)
    write_json(data_path, data)
    write_json(meta_path, meta)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta, args.fixture)
            print("inl-vigilanza: lock, data e meta coerenti")
        else:
            if not args.spec.exists():
                raise SnapshotError("manca lo source lock iniziale")
            write(args.spec, args.data, args.meta, args.fixture)
            data = json.loads(args.data.read_text(encoding="utf-8"))
            print(
                f"inl-vigilanza: scritto {args.data.name} "
                f"({data['coverage']['observedRows']} righe, "
                f"{data['coverage']['territories']} territori)"
            )
        return 0
    except SnapshotError as error:
        print(f"inl-vigilanza: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
