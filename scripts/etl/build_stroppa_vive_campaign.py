#!/usr/bin/env python3
"""Build the compact verified VIVE editorial-campaign evidence snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import date
from fractions import Fraction
from pathlib import Path


CIG = re.compile(r"^[A-Z0-9]{10}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
COMPARABLE_SCOPE = "generic_editorial_campaign"
EXCLUDED_SCOPE = "named_digital_media_platform"
COHORT_ID = "cohort:vive-maddalena-editorial-2026"
ITALIAN_MONTHS = (
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
)


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def js_round(value: Fraction) -> int:
    """Match Math.round for exact rational inputs, including negative values."""
    return math.floor(value + Fraction(1, 2))


def quantile_r7(values: list[int], probability: Fraction) -> int:
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return js_round(ordered[lower] * (1 - weight) + ordered[upper] * weight)


def euros(cents: int) -> str:
    whole, fraction = divmod(abs(cents), 100)
    grouped = f"{whole:,}".replace(",", ".")
    sign = "−" if cents < 0 else ""
    return f"{sign}€{grouped}" if fraction == 0 else f"{sign}€{grouped},{fraction:02d}"


def italian_date(value: str) -> str:
    parsed = date.fromisoformat(value)
    return f"{parsed.day} {ITALIAN_MONTHS[parsed.month - 1]} {parsed.year}"


def source_id(record: dict[str, object]) -> str:
    return f"source:mic:determina-{record['determination']}"


def observation_id(record: dict[str, object]) -> str:
    return f"observation:{str(record['cig']).lower()}"


def validate_spec(spec: dict[str, object]) -> list[dict[str, object]]:
    if spec.get("schemaVersion") != 1:
        raise ValueError("schemaVersion non supportata")
    records = spec.get("records")
    if not isinstance(records, list) or len(records) != 5:
        raise ValueError("cinque record ufficiali attesi")
    cigs: set[str] = set()
    determinations: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("record non valido")
        cig = record.get("cig")
        determination = record.get("determination")
        if not isinstance(cig, str) or not CIG.fullmatch(cig) or cig in cigs:
            raise ValueError("CIG non valido o duplicato")
        if not isinstance(determination, str) or determination in determinations:
            raise ValueError("determina non valida o duplicata")
        cigs.add(cig)
        determinations.add(determination)
        amounts = [record.get(key) for key in ("netCents", "vatCents", "grossCents", "packageAmountCents")]
        if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in amounts):
            raise ValueError(f"{cig}: importi interi non negativi attesi")
        if record["netCents"] + record["vatCents"] != record["grossCents"]:
            raise ValueError(f"{cig}: netto, IVA e lordo non riconciliati")
        if record["packageAmountCents"] not in (record["netCents"], record["grossCents"]):
            raise ValueError(f"{cig}: importo pacchetto non riconciliato")
        if record.get("scope") not in (COMPARABLE_SCOPE, EXCLUDED_SCOPE):
            raise ValueError(f"{cig}: perimetro sconosciuto")
        expected_inclusion = record["scope"] == COMPARABLE_SCOPE
        if record.get("includedInBenchmark") is not expected_inclusion:
            raise ValueError(f"{cig}: inclusione benchmark incoerente")
        document_hash = record.get("officialDocumentSha256")
        if not isinstance(document_hash, str) or not SHA256.fullmatch(document_hash):
            raise ValueError(f"{cig}: hash documento ufficiale non valido")
        for key in ("pageUrl", "officialDocumentUrl"):
            if not isinstance(record.get(key), str) or not record[key].startswith("https://trasparenza.cultura.gov.it/"):
                raise ValueError(f"{cig}: URL ufficiale non valido")
    if sum(record["includedInBenchmark"] is True for record in records) != 4:
        raise ValueError("quattro record comparabili attesi")
    return records


def build(spec: dict[str, object]) -> tuple[dict[str, object], dict[str, object]]:
    records = validate_spec(spec)
    campaign = spec["campaign"]
    observed_at = spec["observedAt"]
    package = spec["packageInput"]
    included = [record for record in records if record["includedInBenchmark"]]
    values = [record["netCents"] for record in included]
    median = quantile_r7(values, Fraction(1, 2))
    p25 = quantile_r7(values, Fraction(1, 4))
    p75 = quantile_r7(values, Fraction(3, 4))
    p90 = quantile_r7(values, Fraction(9, 10))
    cohort_fingerprint = digest_bytes(canonical_bytes([
        {
            "cig": record["cig"],
            "determination": record["determination"],
            "netCents": record["netCents"],
            "officialDocumentSha256": record["officialDocumentSha256"],
        }
        for record in sorted(included, key=lambda item: item["cig"])
    ]))

    official_sources = [
        {
            "id": source_id(record),
            "role": "official_primary",
            "verification": "verified",
            "publisher": "Vittoriano e Palazzo Venezia - Ministero della Cultura",
            "title": f"Determina {record['determination']} del {record['determinationDate']}",
            "url": record["officialDocumentUrl"],
            "locator": f"CIG {record['cig']}; pagina ufficiale {record['pageUrl']}",
            "publishedAt": record["pagePublishedAt"],
            "observedAt": observed_at,
            "sha256": record["officialDocumentSha256"],
            "licenseOrReuse": None,
        }
        for record in records
    ]
    sources = sorted(official_sources + [{
        "id": "source:package:affidamenti-diretti",
        "role": "package_input",
        "verification": "package_only_unverified",
        "publisher": "Pacchetto ricevuto da Andrea Stroppa",
        "title": "Catalogo affidamenti diretti",
        "url": None,
        "locator": package["path"],
        "publishedAt": None,
        "observedAt": observed_at,
        "sha256": package["sha256"],
        "licenseOrReuse": None,
    }], key=lambda item: item["id"])

    subjects = []
    observations = []
    benchmarks = []
    assessments = []
    cards = []
    for record in sorted(records, key=lambda item: item["cig"]):
        cig = record["cig"]
        sid = source_id(record)
        oid = observation_id(record)
        subject = f"subject:award:{cig.lower()}"
        package_basis = "netto" if record["packageAmountCents"] == record["netCents"] else "lordo"
        subjects.append({
            "id": subject,
            "kind": "award",
            "displayName": f"Affidamento editoriale a {record['supplier']}",
            "identifiers": [{
                "scheme": "cig",
                "value": cig,
                "sourceId": sid,
                "validFrom": None,
                "validTo": None,
            }],
            "personalDataPublication": "not_personal",
        })
        observations.append({
            "id": oid,
            "topic": "advertising",
            "subjectId": subject,
            "sourceIds": sorted([sid, "source:package:affidamenti-diretti"]),
            "what": f"{campaign['category']} della mostra «{campaign['title']}»",
            "amount": {
                "cents": record["netCents"],
                "currency": "EUR",
                "phase": "award",
                "taxTreatment": "net",
                "unit": "total",
            },
            "period": {
                "kind": "award",
                "start": record["determinationDate"],
                "end": record["determinationDate"],
                "referenceYear": 2026,
                "coverage": "complete",
                "sourcePrecision": "exact_day",
            },
            "procurement": {
                "sourceLabel": "Affidamento diretto ai sensi dell'art. 50, comma 1, lett. b), D.Lgs. 36/2023",
                "normalized": "direct_award",
                "classification": {
                    "origin": "source_field",
                    "sourceField": "Procedura nella determina",
                    "ruleVersion": None,
                    "confidence": "source_declared",
                },
                "cig": cig,
                "ocid": None,
                "cpv": None,
                "awardStatus": "awarded",
                "ruleVersionId": None,
            },
            "caveats": [
                f"Importo netto verificato nell'atto; nel pacchetto il campo importo coincide con il {package_basis} ufficiale.",
                "Il preventivo e le metriche di copertura editoriale non sono pubblicati nell'allegato verificato.",
                "La determina autorizza l'affidamento; non prova pagamento, esecuzione o conformità del servizio.",
            ],
        })
        assessment = f"assessment:{cig.lower()}"
        if record["includedInBenchmark"]:
            bid = f"benchmark:{cig.lower()}"
            delta = record["netCents"] - median
            relative = js_round(Fraction(10_000 * delta, median)) if median > 0 else None
            benchmarks.append({
                "id": bid,
                "observationId": oid,
                "cohortId": COHORT_ID,
                "observedCents": record["netCents"],
                "medianCents": median,
                "deltaCents": delta,
                "relativeDeltaBasisPoints": relative,
                "formula": "observedCents - medianCents",
            })
            assessments.append({
                "id": assessment,
                "observationId": oid,
                "classification": "benchmark_deviation",
                "strength": "reproduced_computation",
                "benchmarkId": bid,
            })
            direction = "sopra" if delta >= 0 else "sotto"
            cards.append({
                "id": f"card:{cig.lower()}",
                "assessmentId": assessment,
                "sourceIds": [sid],
                "publicationStatus": "publishable",
                "title": f"{euros(record['netCents'])} netti per promuovere una mostra",
                "spender": campaign["spender"],
                "what": f"Campagna editoriale affidata a {record['supplier']}",
                "amountLabel": f"{euros(record['netCents'])} netti; {euros(record['grossCents'])} con IVA",
                "periodLabel": f"Determina {record['determination']} del {italian_date(record['determinationDate'])}",
                "benchmarkLabel": f"{euros(abs(delta))} {direction} la mediana di 4 affidamenti editoriali per la stessa mostra ({euros(median)})",
                "evidenceLabel": "Confronto calcolato su 4 determine ufficiali",
                "caveat": "Confronta importi netti totali, non prezzi unitari. L'atto autorizza l'affidamento, non prova pagamento o conformità.",
            })
        else:
            assessments.append({
                "id": assessment,
                "observationId": oid,
                "classification": "incomplete_or_not_comparable",
                "strength": "insufficient_evidence",
                "reasons": [
                    "La determina specifica una singola piattaforma editoriale con perimetro diverso dagli altri quattro affidamenti.",
                ],
            })

    cohort = {
        "id": COHORT_ID,
        "metricVersion": 1,
        "comparability": {
            "categoryTaxonomy": "vive-editorial-campaign-v1",
            "categoryValue": "generic-editorial-promotion-same-exhibition",
            "periodKey": "2026-04",
            "periodPrecision": "exact_day",
            "amountPhase": "award",
            "taxTreatment": "net",
            "unit": "total",
            "procurementScope": "same spender, exhibition, chapter, procedure and generic service wording",
            "geography": "Roma",
        },
        "status": "verified",
        "denominator": {
            "label": "Cinque affidamenti editoriali individuati per la stessa mostra",
            "candidateRecords": 5,
            "includedRecords": 4,
            "excludedByReason": {"piattaforma-editoriale-specifica": 1},
        },
        "summary": {
            "quantileConvention": "linear_interpolation_r7",
            "minimumCohortSize": 4,
            "count": 4,
            "medianCents": median,
            "p25Cents": p25,
            "p75Cents": p75,
            "p90Cents": p90,
        },
        "formulaVersion": "net-award-median-r7-v1",
        "sourceIds": sorted(source_id(record) for record in included),
        "inputFingerprint": cohort_fingerprint,
    }
    snapshot = {
        "schemaVersion": 1,
        "transformVersion": 1,
        "generatedAt": observed_at,
        "subjects": sorted(subjects, key=lambda item: item["id"]),
        "sources": sources,
        "observations": sorted(observations, key=lambda item: item["id"]),
        "benchmarkCohorts": [cohort],
        "benchmarks": sorted(benchmarks, key=lambda item: item["id"]),
        "assessments": sorted(assessments, key=lambda item: item["id"]),
        "publicationChecks": [],
        "shareCards": sorted(cards, key=lambda item: item["id"]),
    }
    snapshot_bytes = canonical_bytes(snapshot)
    meta = {
        "schemaVersion": 1,
        "generatedAt": observed_at,
        "sourceSpecSha256": None,
        "snapshotSha256": digest_bytes(snapshot_bytes),
        "records": 5,
        "benchmarkCandidates": 5,
        "benchmarkIncluded": 4,
        "benchmarkExcludedByReason": {"piattaforma-editoriale-specifica": 1},
        "packageAmountBasisObserved": {"gross": 2, "net": 3},
        "officialDocumentHashesPinned": 5,
        "licenseOrReuse": "not_verified",
        "boundaries": [
            "descriptive_award_distribution_not_market_price",
            "package_amount_basis_was_mixed_and_is_normalized_from_official_acts",
            "proposals_and_editorial_reach_not_published",
            "deviation_is_not_evidence_of_waste_or_illegality",
        ],
    }
    return snapshot, meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", type=Path)
    parser.add_argument("--data-out", type=Path, required=True)
    parser.add_argument("--meta-out", type=Path, required=True)
    args = parser.parse_args()
    spec_bytes = args.spec.read_bytes()
    spec = json.loads(spec_bytes)
    snapshot, meta = build(spec)
    data_bytes = canonical_bytes(snapshot)
    meta["sourceSpecSha256"] = digest_bytes(spec_bytes)
    meta["snapshotSha256"] = digest_bytes(data_bytes)
    args.data_out.parent.mkdir(parents=True, exist_ok=True)
    args.meta_out.parent.mkdir(parents=True, exist_ok=True)
    args.data_out.write_bytes(data_bytes)
    args.meta_out.write_bytes(canonical_bytes(meta))


if __name__ == "__main__":
    main()
