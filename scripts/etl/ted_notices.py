#!/usr/bin/env python3
"""Reproduce a complete, hash-pinned monthly TED search without live requests."""

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
from pathlib import Path

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/ted-notices.source.json"


class SourceError(ValueError):
    """The acquired search no longer satisfies the declared publication scope."""


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


def projection(pages: list[dict], spec: dict) -> bytes:
    if len(pages) != len(spec["pages"]):
        raise SourceError("pagine mancanti")
    records = []
    ids: set[str] = set()
    forms: Counter = Counter()
    multilingual = 0
    international = 0
    for page, source in zip(pages, spec["pages"], strict=True):
        if set(page) != {"notices", "totalNoticeCount", "iterationNextToken", "timedOut"}:
            raise SourceError("schema risposta inatteso")
        if page["timedOut"] is not False or page["iterationNextToken"] is not None or page["totalNoticeCount"] != spec["totalNotices"]:
            raise SourceError("risposta incompleta o totale divergente")
        if not isinstance(page["notices"], list) or len(page["notices"]) != source["rows"]:
            raise SourceError("copertura pagina divergente")
        for notice in page["notices"]:
            if not isinstance(notice, dict) or set(notice) != {*spec["request"]["fields"], "links"}:
                raise SourceError("schema avviso inatteso")
            number = notice["publication-number"]
            if not isinstance(number, str) or re.fullmatch(r"[1-9][0-9]*-2026", number) is None or number in ids:
                raise SourceError("numero pubblicazione invalido o duplicato")
            ids.add(number)
            date = notice["publication-date"]
            if not isinstance(date, str) or re.fullmatch(r"2026-08-[0-9]{2}\+02:00", date) is None:
                raise SourceError("periodo pubblicazione divergente")
            datetime.date.fromisoformat(date[:10])
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
            url = f"https://ted.europa.eu/it/notice/-/detail/{number}"
            if notice["links"].get("html", {}).get("ITA") != url:
                raise SourceError("link ufficiale divergente")
            # Lists stay JSON arrays: names are not joined positionally to countries or lots.
            arrays = [json.dumps(values, ensure_ascii=False, separators=(",", ":")) for values in (names, countries, cpvs)]
            records.append([number, date[:10], form, titles["ita"], arrays[0], language,
                            arrays[1], arrays[2], url])
    if len(ids) != spec["totalNotices"] or dict(forms) != spec["forms"] or international != spec["internationalNotices"] or multilingual != spec["englishBuyerNotices"]:
        raise SourceError("copertura mensile divergente")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(spec["publicHeaders"])
    writer.writerows(sorted(records, key=lambda row: (row[1], int(row[0].split("-")[0])), reverse=True))
    return output.getvalue().encode("utf-8")


def check_committed(spec: dict, payload: bytes) -> None:
    corpus_spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    item = next(item for item in datasets if item["id"] == spec["datasetId"])
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / item["relativePath"]).write_bytes(payload)
        parsed = corpus.parse_dataset(source_root, item)
        _, expected_rows, receipt, _ = corpus.build_dataset(item, parsed, corpus.resolved_source_metadata(corpus_spec, item["id"]))
    actual_rows = b"".join(gzip.decompress(path.read_bytes()) for path in sorted(
        (ROOT / "src/data/generated/integrated/rows").glob(f"{item['id']}.part-*.jsonl.gz")
    ))
    actual_receipt = json.loads((ROOT / f"data/source-ledger/datasets/{item['id']}.receipt.json").read_bytes())
    if expected_rows != actual_rows or receipt != actual_receipt:
        raise SourceError("righe pubbliche o ricevuta divergenti dagli avvisi TED")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, help="Original pinned API pages; defaults to committed gzip responses")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.output_dir and not args.check:
        parser.error("specificare --output-dir o --check")
    spec = json.loads(SPEC.read_text())
    payload = projection(read_pages(spec, args.input_dir), spec)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / f"{spec['datasetId']}.psv").write_bytes(payload)
    if args.check:
        check_committed(spec, payload)
    print("PASS: pagine TED complete, avvisi univoci e proiezione verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
