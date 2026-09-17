#!/usr/bin/env python3
"""Reproduce a small set of descriptive ANAC CIG indicators.

The script deliberately measures CIG records and declared lot values. It does
not estimate unit prices, waste, corruption, or unlawful contract splitting.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import zipfile
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable, TextIO


REQUIRED_COLUMNS = {
    "cig",
    "importo_lotto",
    "oggetto_principale_contratto",
    "tipo_scelta_contraente",
    "modalita_realizzazione",
    "anno_pubblicazione",
    "mese_pubblicazione",
    "flag_prevalente",
    "stato",
}

DIRECT_AWARD = "AFFIDAMENTO DIRETTO"
OPEN_PROCEDURE = "PROCEDURA APERTA"
SERVICES_AND_SUPPLIES = {"SERVIZI", "FORNITURE"}
CONTRACT = "CONTRATTO D'APPALTO"
LOWER_THRESHOLD = Decimal("135000")
UPPER_THRESHOLD = Decimal("140000")
ANAC_SCOPE_MIN = Decimal("5000")
ANAC_SCOPE_MAX = Decimal("25000000")
ANAC_DATASET_URL = "https://dati.anticorruzione.it/opendata/dataset/cig-2025"
ANAC_RESOURCE_IDS = {
    1: "a1a4be23-11f5-4a95-93d0-5e3267ec6c3f",
    2: "a87a23dd-44a3-4b49-a7ad-b96566476979",
    3: "dab282d9-f5c5-4595-9a9b-e17cdae7c98f",
    4: "a047f20f-84e4-48ac-8c54-f69127075d67",
    5: "28288080-14c7-45d1-8ff5-26e25fb4159a",
    6: "039b8d17-756e-454b-a1a2-dda46237c6ea",
    7: "f99292f4-87a0-4e78-bf57-1c54bc4ba5ba",
    8: "fffb1c60-ff4e-43d4-b36f-1596eef7f079",
    9: "bd56cf08-e8a1-4b96-8c41-bfcdf05d3c9c",
    10: "12b9c75f-cc6c-43c7-aeb9-f73f262b3a23",
    11: "8bc58a13-f600-4198-ad10-38738d4b4cc0",
    12: "ebf0b0df-0ce0-4242-b297-a0b9c5cecac7",
}
ANAC_RESOURCE_LAST_MODIFIED = "2026-01-16"
ANAC_VERIFIED_INPUT_SHA256 = {
    1: "8133cd5ea2b592b4e48afa1eb0ec2db1a831f00a254de077518f8263818a371c",
    2: "ddeb33a5c46fd3f1c4f2988c73e28ca148628670848b8a2a86fd12bffd02045f",
    3: "231c2f7713af92c1aef4314a42ccafddb2914d5a6730d8159d13bd54590f3a1f",
    4: "2b8651f49312bca7e356a63b29dc47da5945dfbf7b78bed57ce9aaff54ba1055",
    5: "8f4ef20c3d7a3bf43ff2181341b063e86abc10e0e09232cffd11d3e193aac7b4",
    6: "9006c457b0604f7040a2826ba0294da55379f75cd2756dcf1ad93a90276ebf34",
    7: "ad0c6265c81e78749d703e6a474e387e043ec69f2e5400264fcd4f91599315e8",
    8: "c16e7aa06d6fb0e0880cf797e6d04fdedf37e076c2fd83563dc4f4973e6b539f",
    9: "1b7d009a7120b92444f9ffc8d986a75bdd008cf86623721692e7f74bbf9ff154",
    10: "6e7e467cbb008cc846ee096d3b8e1955fe338d3426a913f0750218bca52901d5",
    11: "cb40213cb6b294650099bf6a6ccd656d9139c374796c903302d17359accc2e60",
    12: "6f696155e0b2ab4b2d608fe403e1bdc88a8a2c0d08812de325dd97ddedc6013a",
}


def official_resource_metadata(month: int) -> dict[str, str | None]:
    resource_id = ANAC_RESOURCE_IDS[month]
    return {
        "resourcePageUrl": f"{ANAC_DATASET_URL}/resource/{resource_id}",
        "resourceUrl": (
            "https://dati.anticorruzione.it/opendata/download/dataset/"
            f"cig-2025/filesystem/cig_csv_2025_{month:02d}.zip"
        ),
        "sourcePublishedAt": None,
        "sourceLastModified": ANAC_RESOURCE_LAST_MODIFIED,
    }


class AuditInputError(ValueError):
    """Raised when an input cannot support a reproducible calculation."""


@dataclass
class Counts:
    raw_rows: int = 0
    rows: int = 0
    direct_awards: int = 0
    direct_award_family: int = 0
    open_procedures: int = 0
    services_and_supplies: int = 0
    services_and_supplies_below_threshold: int = 0
    direct_below_threshold: int = 0
    direct_family_below_threshold: int = 0
    threshold_band_services_and_supplies: int = 0
    threshold_band_direct: int = 0
    threshold_band_strict_contract: int = 0
    non_positive_amounts: int = 0
    inactive_records: int = 0
    anac_scope_direct_below: int = 0
    anac_scope_non_direct_above: int = 0


def parse_amount(raw: str, *, cig: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except (InvalidOperation, AttributeError) as exc:
        raise AuditInputError(f"Importo non valido per il CIG {cig or 'sconosciuto'}") from exc
    if not value.is_finite():
        raise AuditInputError(f"Importo non valido per il CIG {cig or 'sconosciuto'}")
    return value


def percentage(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round((numerator / denominator) * 100, 6)


def euro_to_cents(amount: Decimal) -> int:
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def csv_stream(path: Path) -> tuple[TextIO, zipfile.ZipFile | None]:
    if path.suffix.lower() != ".zip":
        return path.open("r", encoding="utf-8-sig", newline=""), None

    archive = zipfile.ZipFile(path)
    members = [name for name in archive.namelist() if name.lower().endswith(".csv")]
    if len(members) != 1:
        archive.close()
        raise AuditInputError(f"{path.name}: atteso un solo CSV nello ZIP")
    stream = io.TextIOWrapper(archive.open(members[0]), encoding="utf-8-sig", newline="")
    return stream, archive


def audit(
    paths: Iterable[Path],
    reference_year: int,
    *,
    require_complete_year: bool = False,
    attach_official_provenance: bool = False,
) -> dict[str, object]:
    if reference_year != 2025:
        raise AuditInputError(
            "Questa replica implementa soltanto le soglie e il perimetro ANAC del 2025"
        )

    counts = Counts()
    choice_counts: Counter[str] = Counter()
    choice_amount_cents: Counter[str] = Counter()
    exact_amounts: Counter[Decimal] = Counter()
    seen_cigs: set[str] = set()
    all_cigs: set[str] = set()
    active_cigs: set[str] = set()
    observed_months: set[int] = set()
    inputs: list[dict[str, object]] = []
    total_positive_amount_cents = 0
    direct_award_amount_cents = 0
    direct_award_family_amount_cents = 0
    open_procedure_amount_cents = 0

    for path in sorted(paths):
        if not path.is_file():
            raise AuditInputError(f"File non trovato: {path}")
        input_metadata: dict[str, object] = {
            "name": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        input_months: set[int] = set()
        stream, archive = csv_stream(path)
        try:
            reader = csv.DictReader(stream, delimiter=";")
            headers = set(reader.fieldnames or [])
            missing = sorted(REQUIRED_COLUMNS - headers)
            if missing:
                raise AuditInputError(f"{path.name}: colonne mancanti: {', '.join(missing)}")

            for row in reader:
                cig = (row["cig"] or "").strip()
                if not cig:
                    raise AuditInputError(f"{path.name}: CIG vuoto")
                counts.raw_rows += 1
                all_cigs.add(cig)
                if (row["flag_prevalente"] or "").strip() != "1":
                    continue
                if cig in seen_cigs:
                    raise AuditInputError(f"CIG duplicato tra gli input: {cig}")
                seen_cigs.add(cig)

                year = (row["anno_pubblicazione"] or "").strip()
                if year != str(reference_year):
                    raise AuditInputError(
                        f"{path.name}: CIG {cig} appartiene al {year or 'periodo ignoto'}, non al {reference_year}"
                    )

                try:
                    month = int((row["mese_pubblicazione"] or "").strip())
                except ValueError as exc:
                    raise AuditInputError(f"{path.name}: mese non valido per il CIG {cig}") from exc
                if month not in range(1, 13):
                    raise AuditInputError(f"{path.name}: mese non valido per il CIG {cig}")
                observed_months.add(month)
                input_months.add(month)

                state = (row["stato"] or "").strip()
                if state != "ATTIVO":
                    counts.inactive_records += 1
                    continue

                amount = parse_amount(row["importo_lotto"] or "", cig=cig)
                choice = (row["tipo_scelta_contraente"] or "").strip()
                subject = (row["oggetto_principale_contratto"] or "").strip()
                realization = (row["modalita_realizzazione"] or "").strip()
                is_direct = choice == DIRECT_AWARD
                is_direct_family = choice.startswith(DIRECT_AWARD)
                is_services_or_supplies = subject in SERVICES_AND_SUPPLIES
                is_below_threshold = Decimal("0") < amount < UPPER_THRESHOLD
                is_threshold_band = LOWER_THRESHOLD <= amount < UPPER_THRESHOLD
                is_anac_scope = (
                    is_services_or_supplies and ANAC_SCOPE_MIN < amount < ANAC_SCOPE_MAX
                )

                counts.rows += 1
                active_cigs.add(cig)
                counts.non_positive_amounts += int(amount <= 0)
                counts.direct_awards += int(is_direct)
                counts.direct_award_family += int(is_direct_family)
                counts.open_procedures += int(choice == OPEN_PROCEDURE)
                counts.services_and_supplies += int(is_services_or_supplies)
                counts.services_and_supplies_below_threshold += int(
                    is_services_or_supplies and is_below_threshold
                )
                counts.direct_below_threshold += int(
                    is_services_or_supplies and is_below_threshold and is_direct
                )
                counts.direct_family_below_threshold += int(
                    is_services_or_supplies and is_below_threshold and is_direct_family
                )
                counts.threshold_band_services_and_supplies += int(
                    is_services_or_supplies and is_threshold_band
                )
                counts.threshold_band_direct += int(
                    is_services_or_supplies and is_threshold_band and is_direct
                )
                counts.threshold_band_strict_contract += int(
                    is_services_or_supplies
                    and is_threshold_band
                    and is_direct
                    and realization == CONTRACT
                )
                counts.anac_scope_direct_below += int(
                    is_anac_scope and is_direct and amount < UPPER_THRESHOLD
                )
                counts.anac_scope_non_direct_above += int(
                    is_anac_scope and not is_direct_family and amount >= UPPER_THRESHOLD
                )
                label = choice or "NON INDICATA"
                choice_counts[label] += 1
                exact_amounts[amount] += 1
                if amount > 0:
                    cents = euro_to_cents(amount)
                    choice_amount_cents[label] += cents
                    total_positive_amount_cents += cents
                    if is_direct:
                        direct_award_amount_cents += cents
                    if is_direct_family:
                        direct_award_family_amount_cents += cents
                    if choice == OPEN_PROCEDURE:
                        open_procedure_amount_cents += cents
        finally:
            stream.close()
            if archive is not None:
                archive.close()

        input_metadata["observedMonths"] = sorted(input_months)
        if attach_official_provenance:
            if len(input_months) != 1:
                raise AuditInputError(
                    f"{path.name}: una distribuzione ufficiale deve contenere un solo mese"
                )
            input_month = next(iter(input_months))
            if input_metadata["sha256"] != ANAC_VERIFIED_INPUT_SHA256[input_month]:
                raise AuditInputError(
                    f"{path.name}: hash diverso dalla distribuzione ANAC verificata per il mese {input_month}"
                )
            input_metadata.update(official_resource_metadata(input_month))
        inputs.append(input_metadata)

    expected_months = set(range(1, 13))
    missing_months = sorted(expected_months - observed_months)
    if require_complete_year and missing_months:
        raise AuditInputError(
            "Replica annuale incompleta: mancano i mesi "
            + ", ".join(str(month) for month in missing_months)
        )

    return {
        "schemaVersion": 1,
        "referenceYear": reference_year,
        "inputs": inputs,
        "population": {
            "rawRows": counts.raw_rows,
            "records": counts.rows,
            "uniqueCigs": len(active_cigs),
            "cigsWithoutPrevalentCpv": len(all_cigs - seen_cigs),
            "nonPositiveAmountRecords": counts.non_positive_amounts,
            "inactiveRecordsExcluded": counts.inactive_records,
            "servicesAndSupplies": counts.services_and_supplies,
        },
        "coverage": {
            "observedMonths": sorted(observed_months),
            "missingMonths": missing_months,
            "completeYear": not missing_months,
        },
        "procedureChoice": {
            "directAward": {
                "records": counts.direct_awards,
                "sharePercent": percentage(counts.direct_awards, counts.rows),
                "amountEuroCents": direct_award_amount_cents,
                "amountSharePercent": percentage(
                    direct_award_amount_cents,
                    total_positive_amount_cents,
                ),
            },
            "directAwardFamily": {
                "records": counts.direct_award_family,
                "sharePercent": percentage(counts.direct_award_family, counts.rows),
                "amountEuroCents": direct_award_family_amount_cents,
                "amountSharePercent": percentage(
                    direct_award_family_amount_cents,
                    total_positive_amount_cents,
                ),
                "meaning": "Etichette che iniziano con AFFIDAMENTO DIRETTO; non sono tutte equivalenti.",
            },
            "openProcedure": {
                "records": counts.open_procedures,
                "sharePercent": percentage(counts.open_procedures, counts.rows),
                "amountEuroCents": open_procedure_amount_cents,
                "amountSharePercent": percentage(
                    open_procedure_amount_cents,
                    total_positive_amount_cents,
                ),
            },
            "allLabels": dict(choice_counts.most_common()),
            "allLabelsAmountEuroCents": {
                label: choice_amount_cents[label] for label, _ in choice_counts.most_common()
            },
            "totalPositiveAmountEuroCents": total_positive_amount_cents,
            "amountMeaning": (
                "Somma di importo_lotto > 0 per etichetta; i CIG con importo non positivo "
                "restano nel conteggio ma non nel totale euro."
            ),
        },
        "servicesAndSuppliesBelow140000": {
            "records": counts.services_and_supplies_below_threshold,
            "directAwardRecords": counts.direct_below_threshold,
            "directAwardSharePercent": percentage(
                counts.direct_below_threshold,
                counts.services_and_supplies_below_threshold,
            ),
            "directAwardFamilyRecords": counts.direct_family_below_threshold,
            "directAwardFamilySharePercent": percentage(
                counts.direct_family_below_threshold,
                counts.services_and_supplies_below_threshold,
            ),
        },
        "thresholdBand135000To140000": {
            "interval": "[135000, 140000)",
            "servicesAndSuppliesRecords": counts.threshold_band_services_and_supplies,
            "directAwardRecords": counts.threshold_band_direct,
            "strictContractRecords": counts.threshold_band_strict_contract,
            "strictContractDefinition": (
                "SERVIZI o FORNITURE; AFFIDAMENTO DIRETTO; "
                "CONTRATTO D'APPALTO; importo_lotto tra 135000 incluso e 140000 escluso"
            ),
        },
        "anacPublishedScopeProxy": {
            "directBelowThresholdRecords": counts.anac_scope_direct_below,
            "nonDirectAboveThresholdRecords": counts.anac_scope_non_direct_above,
            "denominatorRecords": (
                counts.anac_scope_direct_below + counts.anac_scope_non_direct_above
            ),
            "directAwardSharePercent": percentage(
                counts.anac_scope_direct_below,
                counts.anac_scope_direct_below + counts.anac_scope_non_direct_above,
            ),
            "definition": (
                "CIG attivi; SERVIZI o FORNITURE; 5000 < importo_lotto < 25000000; "
                "affidamenti diretti sotto 140000 divisi per gli stessi affidamenti più "
                "le procedure non dirette da 140000 in su"
            ),
        },
        "exactContractAmounts": {
            "39900": exact_amounts[Decimal("39900")],
            "139000": exact_amounts[Decimal("139000")],
            "139900": exact_amounts[Decimal("139900")],
        },
        "interpretationLimits": [
            "importo_lotto è il valore del lotto dichiarato nella BDNCP; non è un prezzo unitario né l'importo finale",
            "un addensamento vicino a una soglia è un segnale statistico, non prova un frazionamento",
            "la scelta della procedura non dimostra da sola spreco, illecito o cattiva qualità",
            "questi file non bastano per misurare la concentrazione per fornitore",
        ],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", required=True, type=Path)
    parser.add_argument("--reference-year", required=True, type=int)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--official-anac-resources",
        action="store_true",
        help="allega URL e date ufficiali solo dopo la verifica degli hash noti",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        result = audit(
            args.input,
            args.reference_year,
            require_complete_year=True,
            attach_official_provenance=args.official_anac_resources,
        )
    except (AuditInputError, OSError, zipfile.BadZipFile) as exc:
        print(f"Errore: {exc}", file=sys.stderr)
        return 2

    payload = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
