#!/usr/bin/env python3
"""Reproduce a hash-pinned TED search for Italian buyers with open competition deadlines."""

from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import io
import json
import re
import tempfile
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/ted-open-notices.source.json"

NATURE_LABELS = {
    "works": "Lavori",
    "services": "Servizi",
    "supplies": "Forniture",
}


class SourceError(ValueError):
    """The acquired search no longer satisfies the declared open-notice scope."""


def verified_bytes(path: Path, expected: dict) -> bytes:
    payload = path.read_bytes()
    if len(payload) != expected["bytes"] or corpus.sha256_bytes(payload) != expected["sha256"]:
        raise SourceError("byte sorgente divergenti")
    return payload


def read_pages(spec: dict, input_dir: Path | None = None) -> list[dict]:
    pages = []
    for source in spec["pages"]:
        if input_dir is None:
            payload = gzip.decompress(verified_bytes(ROOT / source["fixture"]["path"], source["fixture"]))
        else:
            payload = (input_dir / source["path"]).read_bytes()
        if len(payload) != source["bytes"] or corpus.sha256_bytes(payload) != source["sha256"]:
            raise SourceError("risposta TED divergente dal lock")
        pages.append(json.loads(payload))
    return pages


def strings(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item.strip() for item in value):
        raise SourceError(f"{label}: valori mancanti o invalidi")
    return value


def optional_strings(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise SourceError("array opzionale inatteso")
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def parse_deadline(values: list[str], cutoff: datetime.date) -> str:
    if not values:
        raise SourceError("scadenza mancante")
    dates: list[datetime.date] = []
    for raw in values:
        if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:\+[0-9]{2}:[0-9]{2}|Z|-[0-9]{2}:[0-9]{2})?", raw):
            raise SourceError("scadenza con formato inatteso")
        dates.append(datetime.date.fromisoformat(raw[:10]))
    if max(dates) < cutoff:
        raise SourceError("scadenza precedente al perimetro aperto")
    return max(dates).isoformat()


def parse_amount_cents(value: object, currency: object) -> str:
    if value is None or value == "":
        return ""
    if currency not in (None, "EUR"):
        return ""
    if isinstance(value, list):
        if len(value) != 1:
            raise SourceError("importo multiplo inatteso")
        value = value[0]
    if not isinstance(value, str) or not value.strip():
        return ""
    try:
        amount = Decimal(value.strip())
    except InvalidOperation as error:
        raise SourceError("importo stimato non numerico") from error
    if amount < 0:
        raise SourceError("importo stimato negativo")
    cents = int((amount * 100).to_integral_value())
    return str(cents)


def projection(pages: list[dict], spec: dict) -> bytes:
    if len(pages) != len(spec["pages"]):
        raise SourceError("pagine mancanti")
    cutoff = datetime.date.fromisoformat(spec["openDeadlineCutoff"])
    records = []
    ids: set[str] = set()
    forms: Counter = Counter()
    natures: Counter = Counter()
    multilingual = 0
    international = 0
    missing_amount = 0
    for page, source in zip(pages, spec["pages"], strict=True):
        if set(page) != {"notices", "totalNoticeCount", "iterationNextToken", "timedOut"}:
            raise SourceError("schema risposta inatteso")
        if page["timedOut"] is not False or page["iterationNextToken"] is not None:
            raise SourceError("risposta incompleta")
        if page["totalNoticeCount"] != spec["totalNotices"]:
            raise SourceError("totale avvisi divergente")
        if not isinstance(page["notices"], list) or len(page["notices"]) != source["rows"]:
            raise SourceError("copertura pagina divergente")
        for notice in page["notices"]:
            allowed_keys = {*spec["request"]["fields"], "links"}
            required_keys = {
                "publication-number",
                "publication-date",
                "notice-title",
                "buyer-name",
                "buyer-country",
                "form-type",
                "classification-cpv",
                "deadline-receipt-tender-date-lot",
                "contract-nature-main-proc",
                "links",
            }
            if not isinstance(notice, dict) or not required_keys <= set(notice) <= allowed_keys:
                raise SourceError("schema avviso inatteso")
            number = notice["publication-number"]
            if not isinstance(number, str) or re.fullmatch(r"[1-9][0-9]*-[0-9]{4}", number) is None or number in ids:
                raise SourceError("numero pubblicazione invalido o duplicato")
            ids.add(number)
            date = notice["publication-date"]
            if not isinstance(date, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:\+[0-9]{2}:[0-9]{2}|Z|-[0-9]{2}:[0-9]{2})?", date):
                raise SourceError("data pubblicazione inattesa")
            countries = strings(notice["buyer-country"], "paesi committenti")
            if "ITA" not in countries or any(re.fullmatch(r"[A-Z]{3}", value) is None for value in countries):
                raise SourceError("perimetro geografico divergente")
            international += len(set(countries)) > 1
            titles = notice["notice-title"]
            if not isinstance(titles, dict) or not isinstance(titles.get("ita"), str) or not titles["ita"].strip():
                raise SourceError("titolo italiano mancante")
            buyers = notice["buyer-name"]
            if not isinstance(buyers, dict) or not set(buyers) <= {"ita", "eng", "deu", "fra", "mlt", "spa", "swe"} or not {"ita", "eng"} & set(buyers):
                raise SourceError("lingua committenti inattesa")
            language = "ita" if "ita" in buyers else "eng"
            names = strings(buyers[language], "committenti")
            multilingual += language == "eng"
            cpvs = strings(notice["classification-cpv"], "CPV")
            if any(re.fullmatch(r"[0-9]{8}", value) is None for value in cpvs):
                raise SourceError("CPV invalido")
            form = notice["form-type"]
            if not isinstance(form, str) or form not in spec["forms"]:
                raise SourceError("tipo avviso inatteso")
            forms[form] += 1
            nature = notice.get("contract-nature-main-proc")
            if nature not in NATURE_LABELS:
                raise SourceError("natura contratto inattesa")
            natures[nature] += 1
            deadline = parse_deadline(strings(notice["deadline-receipt-tender-date-lot"], "scadenza"), cutoff)
            amount = parse_amount_cents(notice.get("estimated-value-proc"), notice.get("BT-27-Procedure-Currency"))
            if not amount:
                missing_amount += 1
            cities = optional_strings(notice.get("place-of-performance-city-lot"))
            city_json = json.dumps(sorted(set(cities)), ensure_ascii=False, separators=(",", ":")) if cities else ""
            url = f"https://ted.europa.eu/it/notice/-/detail/{number}"
            if notice["links"].get("html", {}).get("ITA") != url:
                raise SourceError("link ufficiale divergente")
            arrays = [
                json.dumps(names, ensure_ascii=False, separators=(",", ":")),
                json.dumps(countries, ensure_ascii=False, separators=(",", ":")),
                json.dumps(cpvs, ensure_ascii=False, separators=(",", ":")),
            ]
            records.append([
                number,
                date[:10],
                form,
                NATURE_LABELS[nature],
                titles["ita"],
                arrays[0],
                language,
                arrays[1],
                arrays[2],
                deadline,
                amount,
                city_json,
                url,
            ])
    if (
        len(ids) != spec["totalNotices"]
        or dict(forms) != spec["forms"]
        or dict(natures) != spec["natures"]
        or international != spec["internationalNotices"]
        or multilingual != spec["englishBuyerNotices"]
        or missing_amount != spec["missingEstimatedValue"]
    ):
        raise SourceError("copertura open divergente")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(spec["publicHeaders"])
    writer.writerows(sorted(records, key=lambda row: (row[9], row[1], int(row[0].split("-")[0]))))
    return output.getvalue().encode("utf-8")


def check_committed(spec: dict, payload: bytes) -> None:
    corpus_spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    item = next(item for item in datasets if item["id"] == spec["datasetId"])
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / item["relativePath"]).write_bytes(payload)
        parsed = corpus.parse_dataset(source_root, item)
        _, expected_rows, receipt, _ = corpus.build_dataset(item, parsed, corpus.resolved_source_metadata(corpus_spec, item["id"]))
    actual_rows = b"".join(
        gzip.decompress(path.read_bytes())
        for path in sorted((ROOT / "src/data/generated/integrated/rows").glob(f"{item['id']}.part-*.jsonl.gz"))
    )
    actual_receipt = json.loads((ROOT / f"data/source-ledger/datasets/{item['id']}.receipt.json").read_bytes())
    if expected_rows != actual_rows or receipt != actual_receipt:
        raise SourceError("righe pubbliche o ricevuta divergenti dagli avvisi TED aperti")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, help="Original pinned API pages; defaults to committed gzip responses")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.output_dir and not args.check:
        parser.error("specificare --output-dir o --check")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    payload = projection(read_pages(spec, args.input_dir), spec)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / f"{spec['datasetId']}.psv").write_bytes(payload)
    if args.check:
        check_committed(spec, payload)
    print("PASS: avvisi TED aperti completi, univoci e proiezione verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
