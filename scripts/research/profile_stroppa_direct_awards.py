#!/usr/bin/env python3
"""Profile a selectively extracted Stroppa direct-awards TSV/JSON pair.

The report contains aggregate quality evidence only. It never copies rows,
names, tax identifiers, objects or URLs to the output.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse


NULLISH = {"", "n.d.", "nd", "n/a", "na", "null", "none", "-"}
EXPECTED_FIELDS = ("ente", "ipa", "cig", "contraente", "cf", "importo", "oggetto", "data", "url")
ARTICLE_50_MARKERS = ("art. 50", "art.50", "art 50")
EVENT_OR_CAMPAIGN_MARKERS = ("evento", "convegno", "campagna", "pubblicit")


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def normalized(value: object) -> str | None:
    if value is None or str(value).strip().lower() in NULLISH:
        return None
    return str(value).strip()


def amount(value: object) -> Decimal | None:
    text = normalized(value)
    if text is None:
        return None
    try:
        return Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"importo non parseabile: {text!r}") from error


def source_precision(value: str) -> str:
    if re.fullmatch(r"\d{4}-\d{2}", value):
        return "month_only"
    if re.fullmatch(r"\d{4}-01-01", value):
        return "possible_year_default"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return "exact_day"
    raise ValueError(f"data non supportata: {value!r}")


def assert_digest(path: Path, expected: str | None) -> str:
    observed = digest(path)
    if expected and observed != expected:
        raise ValueError(f"hash inatteso per {path.name}: {observed}")
    return observed


def profile(tsv_path: Path, json_path: Path, expected_tsv: str | None, expected_json: str | None) -> dict[str, object]:
    with tsv_path.open("r", encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="|")
        if tuple(reader.fieldnames or ()) != EXPECTED_FIELDS:
            raise ValueError("header affidamenti diretti inatteso")
        rows = list(reader)
    with json_path.open("r", encoding="utf-8") as stream:
        payload = json.load(stream)
    items = payload.get("items")
    if not isinstance(items, list) or len(items) != len(rows):
        raise ValueError("TSV e JSON non riconciliano sul conteggio")

    comparison_fields = ("ente", "ipa", "cig", "contraente", "cf", "oggetto", "data", "url")
    for index, (row, item) in enumerate(zip(rows, items, strict=True), start=2):
        for field in comparison_fields:
            if normalized(row[field]) != normalized(item.get(field)):
                raise ValueError(f"TSV e JSON divergono alla riga {index}, campo {field}")
        json_amount = item.get("importo", {})
        item_amount = json_amount.get("eur") if json_amount.get("parse_ok") else None
        if amount(row["importo"]) != (Decimal(str(item_amount)) if item_amount is not None else None):
            raise ValueError(f"TSV e JSON divergono alla riga {index}, campo importo")

    amounts = [parsed for row in rows if (parsed := amount(row["importo"])) is not None]
    if any(value < 0 for value in amounts):
        raise ValueError("importo negativo non supportato")
    url_counts = Counter(row["url"] for row in rows if normalized(row["url"]) is not None)
    malformed_urls = [url for url in url_counts if urlparse(url).scheme != "https" or not urlparse(url).netloc]
    if malformed_urls:
        raise ValueError("URL non HTTPS o malformati")
    date_precision = Counter(source_precision(row["data"]) for row in rows)
    exact_rows = {tuple(row[field] for field in EXPECTED_FIELDS) for row in rows}
    cig_values = [normalized(row["cig"]) for row in rows]
    present_cigs = [value for value in cig_values if value is not None]

    by_entity: dict[str, dict[str, int]] = {}
    for row in rows:
        entity = row["ipa"]
        bucket = by_entity.setdefault(entity, {"records": 0, "withAmount": 0})
        bucket["records"] += 1
        bucket["withAmount"] += amount(row["importo"]) is not None

    declared_sum = Decimal(str(payload.get("importo_somma_parse_ok")))
    if payload.get("n") != len(rows) or payload.get("n_con_importo") != len(amounts):
        raise ValueError("metadati JSON non riconciliati")
    if payload.get("n_importo_nd") != len(rows) - len(amounts) or sum(amounts, Decimal("0")) != declared_sum:
        raise ValueError("copertura o somma JSON non riconciliata")
    if payload.get("non_catalogo_238_11mln") is not True:
        raise ValueError("flag non_catalogo_238_11mln mancante")

    objects = [row["oggetto"].casefold() for row in rows]
    return {
        "schemaVersion": 1,
        "inputs": {
            "tsv": {"basename": tsv_path.name, "bytes": tsv_path.stat().st_size, "sha256": assert_digest(tsv_path, expected_tsv)},
            "json": {"basename": json_path.name, "bytes": json_path.stat().st_size, "sha256": assert_digest(json_path, expected_json)},
        },
        "records": len(rows),
        "identity": {
            "exactDuplicateRows": len(rows) - len(exact_rows),
            "cigPresent": len(present_cigs),
            "cigDuplicateValues": len(present_cigs) - len(set(present_cigs)),
        },
        "coverage": {
            "contractorPresent": sum(normalized(row["contraente"]) is not None for row in rows),
            "taxIdPresent": sum(normalized(row["cf"]) is not None for row in rows),
            "amountPresent": len(amounts),
            "amountMissing": len(rows) - len(amounts),
            "amountKnownSubsetCents": int(sum(amounts, Decimal("0")) * 100),
            "urlPresent": sum(url_counts.values()),
            "urlDistinct": len(url_counts),
            "repeatedUrlGroups": sum(count > 1 for count in url_counts.values()),
            "rowsBeyondFirstPerUrl": sum(count - 1 for count in url_counts.values() if count > 1),
            "datePrecision": dict(sorted(date_precision.items())),
            "byEntity": dict(sorted(by_entity.items())),
        },
        "derivedSignals": {
            "ruleVersion": "stroppa-direct-award-text-v1",
            "sourceField": "oggetto",
            "directAwardPhrase": sum("affidamento diretto" in value for value in objects),
            "article50Phrase": sum(any(marker in value for marker in ARTICLE_50_MARKERS) for value in objects),
            "directNegotiationPhrase": sum("trattativa diretta" in value for value in objects),
            "eventOrCampaignCandidate": sum(any(marker in value for marker in EVENT_OR_CAMPAIGN_MARKERS) for value in objects),
        },
        "sidePopulations": {
            "nonCatalogo238_11m": True,
            "catalogoNuoviT3rn": payload.get("catalogo_nuovi_t3rn"),
            "includedInMaster": False,
        },
        "boundaries": [
            "missing_amount_is_not_zero",
            "repeated_url_is_not_row_level_act",
            "method_is_text_derived_not_source_field",
            "possible_year_default_dates_block_monthly_or_seasonal_benchmarks",
            "entity_totals_are_not_comparable_with_uneven_missingness",
            "license_not_verified",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tsv", type=Path)
    parser.add_argument("json", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--expected-tsv-sha256")
    parser.add_argument("--expected-json-sha256")
    args = parser.parse_args()
    report = profile(args.tsv, args.json, args.expected_tsv_sha256, args.expected_json_sha256)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
