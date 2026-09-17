"""Derive operator history metrics from complete, source-locked award relations."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal
from functools import reduce
from typing import Mapping

from anac_operator_awards_index import ContractError, base
from anac_operator_cig_enrich import clean_text
from monetary import add_decimals


ATTRIBUTABLE_STATUSES = {"positive-exact-cent", "positive-subcent", "zero"}
CIG_FIELDS = (
    "cig",
    "anno_pubblicazione",
    "flag_prevalente",
    "stato",
    "importo_lotto",
    "oggetto_principale_contratto",
    "tipo_scelta_contraente",
    "modalita_realizzazione",
    "cf_amministrazione_appaltante",
    "denominazione_amministrazione_appaltante",
    "oggetto_lotto",
    "oggetto_gara",
    "cod_cpv",
    "descrizione_cpv",
)


def validate_summary(record: Mapping[str, object]) -> None:
    expected = {
        "ref",
        "awardCount",
        "yearly",
        "distinctContractingAuthorityCount",
        "awardsWithoutAuthority",
        "awardsWithoutCigMatch",
        "authorities",
        "screening2025",
        "name",
        "nameVariants",
        "yearMin",
        "yearMax",
        "attributedAwardCount",
        "attributedValue",
    }
    if set(record) != expected:
        raise ContractError("Campi dello storico inattesi")
    total = record["awardCount"]
    if not isinstance(total, int) or isinstance(total, bool) or total <= 0:
        raise ContractError("Conteggio storico non valido")
    years = record["yearly"]
    if sum(row["awardCount"] for row in years) != total:
        raise ContractError("Conteggi annuali non riconciliati")
    if len({row["year"] for row in years}) != len(years):
        raise ContractError("Anno duplicato nello storico")
    if (
        sum(row["attributedAwardCount"] for row in years)
        != record["attributedAwardCount"]
    ):
        raise ContractError("Conteggio attribuibile non riconciliato")
    for row in years:
        if not 0 <= row["attributedAwardCount"] <= row["awardCount"]:
            raise ContractError("Denominatore annuale non valido")
        if (row["attributedAwardCount"] == 0) != (row["attributedValue"] is None):
            raise ContractError("Valore annuale mancante confuso con zero")
    authorities = record["authorities"]
    refs = {row["ref"] for row in authorities}
    if (
        len(refs) != len(authorities)
        or len(refs) != record["distinctContractingAuthorityCount"]
    ):
        raise ContractError("Enti distinti non riconciliati")
    if (
        sum(row["awardCount"] for row in authorities) + record["awardsWithoutAuthority"]
        != total
    ):
        raise ContractError("Copertura enti non riconciliata")
    if (
        not 0
        <= record["awardsWithoutCigMatch"]
        <= record["awardsWithoutAuthority"]
        <= total
    ):
        raise ContractError("Copertura CIG non valida")
    screening = record["screening2025"]
    if (
        screening["classifiableCigs"] + screening["excludedCigs"]
        != screening["matchedCigs"]
    ):
        raise ContractError("Denominatore screening non riconciliato")
    if (
        not 0
        <= screening["band135000To140000"]
        <= screening["below140000"]
        <= screening["classifiableCigs"]
        <= total
    ):
        raise ContractError("Fasce dello screening incoerenti")
    if (
        not 0
        <= screening["directBelow140000"] + screening["missingProcedureBelow140000"]
        <= screening["below140000"]
    ):
        raise ContractError("Copertura procedure dello screening incoerente")


def lot_amount(raw: str) -> tuple[str | None, str]:
    status, amount, _scale = base.parse_amount(raw.replace(",", "."))
    return amount, "positive" if status.startswith("positive-") else status


def project_cig(row: Mapping[str, str]) -> dict[str, object]:
    missing = set(CIG_FIELDS) - row.keys()
    if missing:
        raise ContractError(f"CIG: colonne mancanti: {', '.join(sorted(missing))}")
    year = row["anno_pubblicazione"].strip()
    if not year.isdigit() or len(year) != 4 or not 2007 <= int(year) <= 2025:
        raise ContractError("CIG: anno di pubblicazione fuori dal source lock")
    amount, status = lot_amount(row["importo_lotto"])
    return {
        "cigYear": int(year),
        "prevalent": row["flag_prevalente"].strip() == "1",
        "state": row["stato"].strip() or None,
        "lotAmount": amount,
        "lotAmountStatus": status,
        "category": row["oggetto_principale_contratto"].strip() or None,
        "procedure": row["tipo_scelta_contraente"].strip() or None,
        "realization": row["modalita_realizzazione"].strip() or None,
        "description": clean_text(row["oggetto_lotto"] or row["oggetto_gara"], 500),
        "cpvCode": clean_text(row["cod_cpv"], 40),
        "cpvLabel": clean_text(row["descrizione_cpv"], 500),
    }


def screening_2025(procedures: Mapping[str, Mapping[str, object]]) -> dict[str, int]:
    counts: Counter[str] = Counter(
        matchedCigs=0,
        classifiableCigs=0,
        below140000=0,
        band135000To140000=0,
        directBelow140000=0,
        missingProcedureBelow140000=0,
        excludedCigs=0,
    )
    for procedure in procedures.values():
        if procedure["cigYear"] != 2025:
            continue
        counts["matchedCigs"] += 1
        eligible = (
            procedure["prevalent"] is True
            and procedure["state"] == "ATTIVO"
            and procedure["category"] in {"SERVIZI", "FORNITURE"}
            and procedure["realization"] == "CONTRATTO D'APPALTO"
            and procedure["lotAmountStatus"] == "positive"
        )
        if not eligible:
            counts["excludedCigs"] += 1
            continue
        counts["classifiableCigs"] += 1
        amount = Decimal(str(procedure["lotAmount"]))
        if amount < 140_000:
            counts["below140000"] += 1
            counts["band135000To140000"] += int(amount >= 135_000)
            counts["directBelow140000"] += int(
                procedure["procedure"] == "AFFIDAMENTO DIRETTO"
            )
            counts["missingProcedureBelow140000"] += int(procedure["procedure"] is None)
    return dict(counts)


def summarize_history(
    operator: Mapping[str, object],
    procedures: Mapping[str, Mapping[str, object]],
) -> dict[str, object]:
    awards = operator["awards"]
    if (
        not isinstance(awards, list)
        or len(awards) != operator["awardCount"]
        or operator["awardsTruncated"]
    ):
        raise ContractError(
            "Lo storico richiede tutte le aggiudicazioni dell'operatore"
        )
    yearly: dict[int | None, dict[str, object]] = {}
    authorities: dict[str, dict[str, object]] = {}
    matched: dict[str, Mapping[str, object]] = {}
    award_keys: set[tuple[str, str]] = set()
    unmatched = 0
    missing_authority = 0
    for award in awards:
        key = (award["cig"], award["awardId"])
        if key in award_keys:
            raise ContractError("Relazione operatore/aggiudicazione duplicata")
        award_keys.add(key)
        year = int(award["awardedAt"][:4]) if award["awardedAt"] else None
        bucket = yearly.setdefault(
            year,
            {
                "year": year,
                "awardCount": 0,
                "attributedAwardCount": 0,
                "value": Decimal(0),
            },
        )
        bucket["awardCount"] += 1
        if (
            award["attribution"] == "single-operator"
            and award["amountStatus"] in ATTRIBUTABLE_STATUSES
        ):
            if award["amount"] is None:
                raise ContractError("Importo attribuibile mancante")
            bucket["value"] = add_decimals(bucket["value"], Decimal(award["amount"]))
            bucket["attributedAwardCount"] += 1
        procedure = procedures.get(award["cig"])
        if procedure is None:
            unmatched += 1
            missing_authority += 1
            continue
        matched[award["cig"]] = procedure
        authority_ref = procedure.get("authorityRef")
        if not authority_ref:
            missing_authority += 1
            continue
        authority = authorities.setdefault(
            str(authority_ref),
            {
                "ref": authority_ref,
                "label": procedure.get("authorityLabel"),
                "awardCount": 0,
            },
        )
        authority["awardCount"] += 1
    years = []
    for year in sorted(yearly, key=lambda value: (value is None, value or 0)):
        bucket = yearly[year]
        years.append(
            {
                "year": year,
                "awardCount": bucket["awardCount"],
                "attributedAwardCount": bucket["attributedAwardCount"],
                "attributedValue": (
                    format(bucket["value"], "f")
                    if bucket["attributedAwardCount"]
                    else None
                ),
            }
        )
    attributed_count = sum(item["attributedAwardCount"] for item in years)
    attributed_value = reduce(
        add_decimals,
        (
            Decimal(item["attributedValue"])
            for item in years
            if item["attributedValue"] is not None
        ),
        Decimal(0),
    )
    if attributed_count != operator[
        "attributedAwardCount"
    ] or attributed_value != Decimal(str(operator["attributedValue"])):
        raise ContractError(
            "La serie annuale non riconcilia il riepilogo dell'operatore"
        )
    return {
        "yearly": years,
        "distinctContractingAuthorityCount": len(authorities),
        "awardsWithoutAuthority": missing_authority,
        "awardsWithoutCigMatch": unmatched,
        "authorities": sorted(
            authorities.values(), key=lambda item: (-item["awardCount"], item["ref"])
        ),
        "screening2025": screening_2025(matched),
    }
