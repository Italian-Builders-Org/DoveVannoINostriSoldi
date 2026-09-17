#!/usr/bin/env python3
"""Build a compact, auditable overview from the annual MEF participation census."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://www.de.mef.gov.it"
INDEX_URL = f"{BASE_URL}/it/attivita_istituzionali/partecipazioni_pubbliche/open_data_partecipazioni/index.html"
OUTPUT = Path("src/data/generated/mef-participations-overview.json")
REQUIRED_COLUMNS = {
    "Amministrazione Denominazione",
    "Amministrazione Codice Fiscale",
    "Partecipata Denominazione",
    "Partecipata Codice Fiscale",
    "Partecipazione indiretta",
    "Tipo controllo",
    *(f"Modalità affidamento servizio {index}" for index in range(1, 6)),
}


@dataclass(frozen=True)
class Release:
    year: int
    reference_date: str
    published_at: str
    landing_url: str
    asset_url: str


def decode(raw: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "cp1252", "iso-8859-1"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("Il CSV MEF non usa una codifica supportata")


def tax_code(value: str | None) -> str:
    return (value or "").strip().removeprefix("[").removesuffix("]").strip()


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "DoveVannoINostriSoldi/0.6 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def absolute_url(path: str) -> str:
    if path.startswith("https://www.de.mef.gov.it/"):
        return path
    if path.startswith("/"):
        return f"{BASE_URL}{path}"
    raise ValueError(f"URL MEF inatteso: {path}")


def discover_release() -> Release:
    index_text = fetch_bytes(INDEX_URL).decode("utf-8", errors="strict")
    candidates = re.findall(r'href="([^"]*dati_partecipazioni_(\d{4})\.html)"', index_text)
    if not candidates:
        raise ValueError("Nessuna annualità MEF trovata nell'indice ufficiale")

    landing_path, year_text = max(candidates, key=lambda item: int(item[1]))
    landing_url = absolute_url(html.unescape(landing_path))
    landing_text = fetch_bytes(landing_url).decode("utf-8", errors="strict")
    asset_match = re.search(r'href="([^"]*dati_partecipazioni_anno_\d{4}\.csv)"', landing_text)
    publication_match = re.search(
        r"Data di pubblicazione:</strong>(?:&nbsp;|\s|<[^>]+>)*(\d{2}/\d{2}/\d{4})",
        landing_text,
    )
    if not asset_match or not publication_match:
        raise ValueError(f"Metadati incompleti nella pagina MEF {landing_url}")

    year = int(year_text)
    published_at = datetime.strptime(publication_match.group(1), "%d/%m/%Y").date().isoformat()
    return Release(
        year=year,
        reference_date=f"{year}-12-31",
        published_at=published_at,
        landing_url=landing_url,
        asset_url=absolute_url(html.unescape(asset_match.group(1))),
    )


def read_release(
    input_path: Path | None,
    reference_year: int | None,
    published_at: str | None,
) -> tuple[bytes, Release]:
    if input_path:
        if reference_year is None or published_at is None:
            raise ValueError("--input richiede --reference-year e --published-at")
        datetime.strptime(published_at, "%Y-%m-%d")
        return input_path.read_bytes(), Release(
            year=reference_year,
            reference_date=f"{reference_year}-12-31",
            published_at=published_at,
            landing_url=f"{BASE_URL}/it/attivita_istituzionali/partecipazioni_pubbliche/open_data_partecipazioni/dati_partecipazioni_{reference_year}.html",
            asset_url=f"{BASE_URL}/modules/documenti_it/attivo_patrimonio/partecipazioni_{reference_year}/dati_partecipazioni_anno_{reference_year}.csv",
        )
    release = discover_release()
    return fetch_bytes(release.asset_url), release


def build_snapshot(raw: bytes, release: Release) -> dict[str, object]:
    decoded, encoding = decode(raw)
    reader = csv.DictReader(io.StringIO(decoded), delimiter=";")
    headers = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - headers)
    if missing:
        raise ValueError(f"Schema MEF incompleto, colonne mancanti: {', '.join(missing)}")

    rows = 0
    direct_rows = 0
    indirect_rows = 0
    analog_control_rows = 0
    direct_award_rows = 0
    combined_evidence_rows = 0
    administrations: set[str] = set()
    companies: dict[str, str] = {}
    company_administrations: dict[str, set[str]] = defaultdict(set)

    for record in reader:
        admin_cf = tax_code(record.get("Amministrazione Codice Fiscale"))
        company_cf = tax_code(record.get("Partecipata Codice Fiscale"))
        if not admin_cf or not company_cf:
            raise ValueError(f"Chiave fiscale mancante alla riga dati {rows + 2}")

        rows += 1
        administrations.add(admin_cf)
        company_name = " ".join((record.get("Partecipata Denominazione") or "").split())
        companies.setdefault(company_cf, company_name or "Denominazione non disponibile")
        company_administrations[company_cf].add(admin_cf)

        participation_kind = (record.get("Partecipazione indiretta") or "").strip().upper()
        if participation_kind not in {"SI", "NO"}:
            raise ValueError(
                f"Valore inatteso per Partecipazione indiretta alla riga dati {rows + 1}: "
                f"{participation_kind or '<vuoto>'}"
            )
        indirect = participation_kind == "SI"
        indirect_rows += int(indirect)
        direct_rows += int(not indirect)

        analog_control = "controllo analogo" in (record.get("Tipo controllo") or "").lower()
        direct_award = any(
            (record.get(f"Modalità affidamento servizio {index}") or "").strip().lower() == "diretto"
            for index in range(1, 6)
        )
        analog_control_rows += int(analog_control)
        direct_award_rows += int(direct_award)
        combined_evidence_rows += int(analog_control and direct_award)

    if rows == 0:
        raise ValueError("Il CSV MEF non contiene record")

    top_companies = sorted(
        (
            {
                "taxCode": company_cf,
                "name": companies[company_cf],
                "declaringAdministrations": len(admin_codes),
            }
            for company_cf, admin_codes in company_administrations.items()
        ),
        key=lambda item: (-item["declaringAdministrations"], item["name"]),
    )[:20]

    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "referenceYear": release.year,
        "referenceDate": release.reference_date,
        "publishedAt": release.published_at,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "owner": "MEF · Dipartimento dell'Economia",
            "landingUrl": release.landing_url,
            "assetUrl": release.asset_url,
            "license": "CC BY 4.0",
            "rawSha256": hashlib.sha256(raw).hexdigest(),
            "detectedEncoding": encoding,
            "delimiter": ";",
        },
        "totals": {
            "participationRecords": rows,
            "declaringAdministrations": len(administrations),
            "participatedOrganizations": len(companies),
            "directParticipationRecords": direct_rows,
            "indirectParticipationRecords": indirect_rows,
        },
        "declaredEvidence": {
            "analogControlRecords": analog_control_rows,
            "directAwardRecords": direct_award_rows,
            "bothSignalsRecords": combined_evidence_rows,
            "legalMeaning": f"Dichiarazioni riferite alla rilevazione {release.year}; non certificano uno status in-house corrente.",
        },
        "topCompaniesByDeclaringAdministrations": top_companies,
    }


def validate(snapshot: dict[str, object]) -> None:
    if snapshot.get("schemaVersion") != 1:
        raise ValueError("Versione snapshot MEF non supportata")
    totals = snapshot.get("totals")
    if not isinstance(totals, dict) or not isinstance(totals.get("participationRecords"), int):
        raise ValueError("Totali snapshot MEF non validi")
    if totals["participationRecords"] <= 0:
        raise ValueError("Lo snapshot MEF deve contenere almeno un record")
    source = snapshot.get("source")
    if not isinstance(source, dict) or not str(source.get("assetUrl", "")).startswith("https://www.de.mef.gov.it/"):
        raise ValueError("URL sorgente MEF non ufficiale")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="CSV locale già scaricato")
    parser.add_argument("--reference-year", type=int, help="Anno del CSV locale; obbligatorio con --input")
    parser.add_argument("--published-at", help="Data ISO di pubblicazione del CSV locale; obbligatoria con --input")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot versionato senza rete")
    args = parser.parse_args()

    if args.check:
        snapshot = json.loads(args.output.read_text(encoding="utf-8"))
    else:
        raw, release = read_release(args.input, args.reference_year, args.published_at)
        snapshot = build_snapshot(raw, release)
        validate(snapshot)
        if args.output.exists():
            current = json.loads(args.output.read_text(encoding="utf-8"))
            if (
                current.get("schemaVersion") == snapshot.get("schemaVersion")
                and current.get("transformVersion") == snapshot.get("transformVersion")
                and current.get("source", {}).get("rawSha256") == snapshot.get("source", {}).get("rawSha256")
            ):
                snapshot = current
                validate(snapshot)
                print("Nessun nuovo rilascio MEF: snapshot invariato")
            else:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    validate(snapshot)
    totals = snapshot["totals"]
    print(
        f"MEF {snapshot['referenceYear']}: {totals['participationRecords']} relazioni, "
        f"{totals['declaringAdministrations']} amministrazioni, "
        f"{totals['participatedOrganizations']} partecipate"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
