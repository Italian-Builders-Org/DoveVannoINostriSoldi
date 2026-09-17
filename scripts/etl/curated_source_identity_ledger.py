#!/usr/bin/env python3
"""Rebuild the private source-identity ledger from pinned curated sources.

The output is intentionally private and must remain outside the Git checkout.
An optional frozen base ledger can preserve identities that predate the
integrated dataset specification.  In that mode a pinned base specification
defines the datasets already accounted for; only genuinely new dataset IDs are
merged into the base.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import stat
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import integrated_curated_datasets as dataset_etl


ROOT = Path(__file__).resolve().parents[2]
HEADERS = ("dataset", "field", "kind", "value", "occurrences")
SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")
# This is the extraction boundary used by the pre-existing private ledger.  A
# closing parenthesis or quote terminates prose URLs; terminal punctuation is
# not part of the identity. Semicolons inside URLs (for example Normattiva URNs)
# remain intact. Unsafe/local URLs are deliberately retained so the downstream
# catalog policy can quarantine them instead of hiding them.
EMBEDDED_URL_RE = re.compile(r"https?://[^\s|)\"']+", re.IGNORECASE)
TERMINAL_URL_PUNCTUATION = ".,;:]}\"'"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_LEDGER_BYTES = 64 * 1024 * 1024


class IdentityLedgerError(ValueError):
    """A private input or pinned dataset violates the ledger contract."""


@dataclass(frozen=True)
class LedgerBuild:
    payload: bytes
    identities: int
    occurrences: int
    delta_identities: int
    delta_occurrences: int
    datasets: int
    delta_datasets: int

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.payload).hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _within_repository(path: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(ROOT.resolve())
    except ValueError:
        return False
    return True


def require_private_file(path: Path, label: str) -> Path:
    if _within_repository(path):
        raise IdentityLedgerError(f"{label} deve restare fuori dal repository")
    if path.is_symlink():
        raise IdentityLedgerError(f"{label} non puo essere un link simbolico")
    resolved = path.resolve(strict=False)
    try:
        metadata = resolved.stat()
    except OSError as error:
        raise IdentityLedgerError(f"{label} non leggibile") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise IdentityLedgerError(f"{label} deve essere un file regolare")
    if metadata.st_size > MAX_LEDGER_BYTES:
        raise IdentityLedgerError(f"{label} supera il limite dimensionale")
    return resolved


def require_private_output(path: Path) -> Path:
    if _within_repository(path):
        raise IdentityLedgerError("output privato deve restare fuori dal repository")
    if path.is_symlink():
        raise IdentityLedgerError("output privato non puo essere un link simbolico")
    return path.resolve(strict=False)


def read_private_payload(path: Path, label: str) -> bytes:
    resolved = require_private_file(path, label)
    try:
        return resolved.read_bytes()
    except OSError as error:
        raise IdentityLedgerError(f"{label} non leggibile") from error


def parse_positive_integer(raw: str, label: str) -> int:
    if re.fullmatch(r"[1-9][0-9]*", raw) is None:
        raise IdentityLedgerError(f"{label} non valido")
    value = int(raw)
    if value > MAX_SAFE_INTEGER:
        raise IdentityLedgerError(f"{label} supera il limite intero")
    return value


def parse_private_ledger(payload: bytes) -> Counter[tuple[str, str, str, str]]:
    if len(payload) > MAX_LEDGER_BYTES:
        raise IdentityLedgerError("ledger base supera il limite dimensionale")
    if payload.startswith(b"\xef\xbb\xbf") or b"\x00" in payload:
        raise IdentityLedgerError("ledger base non e UTF-8 canonico")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise IdentityLedgerError("ledger base non e UTF-8 stretto") from error
    reader = csv.reader(io.StringIO(text, newline=""), delimiter="\t", strict=True)
    try:
        headers = next(reader)
    except (StopIteration, csv.Error) as error:
        raise IdentityLedgerError("ledger base vuoto o malformed") from error
    if headers != list(HEADERS):
        raise IdentityLedgerError("header ledger base divergente")

    identities: Counter[tuple[str, str, str, str]] = Counter()
    try:
        for row_number, row in enumerate(reader, start=1):
            if len(row) != len(HEADERS):
                raise IdentityLedgerError(
                    f"ledger base riga {row_number} con numero campi divergente"
                )
            dataset, field, kind, value, raw_occurrences = row
            if not dataset or not field or kind not in {"url", "identity"} or not value:
                raise IdentityLedgerError(f"ledger base riga {row_number} non valida")
            identity = (dataset, field, kind, value)
            if identity in identities:
                raise IdentityLedgerError("ledger base contiene identita duplicate")
            identities[identity] = parse_positive_integer(
                raw_occurrences,
                f"ledger base riga {row_number} occurrences",
            )
    except csv.Error as error:
        raise IdentityLedgerError("ledger base contiene quoting TSV malformed") from error
    if not identities:
        raise IdentityLedgerError("ledger base non contiene identita")
    if sum(identities.values()) > MAX_SAFE_INTEGER:
        raise IdentityLedgerError("occorrenze ledger base oltre il limite")
    if render_ledger(identities) != payload:
        raise IdentityLedgerError("ledger base non e ordinato e canonico")
    return identities


def render_ledger(identities: Counter[tuple[str, str, str, str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="\t", lineterminator="\n")
    writer.writerow(HEADERS)
    for identity in sorted(identities):
        occurrences = identities[identity]
        if occurrences <= 0 or occurrences > MAX_SAFE_INTEGER:
            raise IdentityLedgerError("occorrenze aggregate non valide")
        writer.writerow((*identity, str(occurrences)))
    return output.getvalue().encode("utf-8")


def extract_cell_identities(value: str) -> list[tuple[str, str]]:
    """Return every embedded URL occurrence, or one non-URL identity."""

    normalized = value.strip()
    if not normalized:
        return []
    urls = [
        match.group(0).rstrip(TERMINAL_URL_PUNCTUATION)
        for match in EMBEDDED_URL_RE.finditer(normalized)
    ]
    urls = [url for url in urls if url]
    if urls:
        return [("url", url) for url in urls]
    return [("identity", normalized)]


def _source_contract(item: dict[str, Any]) -> dict[str, Any]:
    """Select the dataset fields that can change source-identity extraction."""

    keys = {
        "relativePath",
        "sources",
        "dataKind",
        "delimiter",
        "itemsField",
        "countField",
        "sourceFields",
        "expected",
    }
    return {key: item[key] for key in sorted(keys) if key in item}


def _validated_specs(
    expanded_spec_path: Path,
    base_spec_path: Path | None,
    expected_base_spec_sha256: str | None,
) -> tuple[list[dict[str, Any]], set[str]]:
    try:
        _, expanded = dataset_etl.load_spec(expanded_spec_path)
    except dataset_etl.DatasetBuildError as error:
        raise IdentityLedgerError("spec integrata non valida") from error
    expanded_by_id = {item["id"]: item for item in expanded}
    if base_spec_path is None:
        return expanded, set()
    if (
        expected_base_spec_sha256 is None
        or SHA256_RE.fullmatch(expected_base_spec_sha256) is None
    ):
        raise IdentityLedgerError("SHA-256 atteso della spec base non valido")
    try:
        base_spec_payload = base_spec_path.read_bytes()
    except OSError as error:
        raise IdentityLedgerError("spec base non leggibile") from error
    if sha256_bytes(base_spec_payload) != expected_base_spec_sha256:
        raise IdentityLedgerError("byte della spec base divergenti")
    try:
        _, base = dataset_etl.load_spec(base_spec_path)
    except dataset_etl.DatasetBuildError as error:
        raise IdentityLedgerError("spec base non valida") from error
    for item in base:
        expanded_item = expanded_by_id.get(item["id"])
        if expanded_item is None:
            raise IdentityLedgerError("dataset della spec base assente dalla spec espansa")
        if _source_contract(item) != _source_contract(expanded_item):
            raise IdentityLedgerError(
                f"contratto sorgente base divergente per {item['id']}"
            )
    return expanded, {item["id"] for item in base}


def _dataset_labels(
    item: dict[str, Any],
    parsed: dataset_etl.ParsedDataset,
) -> dict[str, str]:
    labels: dict[str, str] = {}
    for source in parsed.sources:
        label = Path(source.relative_path).name
        if not label:
            raise IdentityLedgerError(f"nome sorgente mancante per {item['id']}")
        labels[source.id] = label
    return labels


def identities_for_dataset(
    item: dict[str, Any],
    parsed: dataset_etl.ParsedDataset,
) -> Counter[tuple[str, str, str, str]]:
    source_fields = list(item["sourceFields"])
    header_indexes = {header: index for index, header in enumerate(parsed.headers)}
    labels = _dataset_labels(item, parsed)
    identities: Counter[tuple[str, str, str, str]] = Counter()
    for row, (source_id, _) in zip(parsed.rows, parsed.row_origins, strict=True):
        dataset_label = labels[source_id]
        for field in source_fields:
            for kind, value in extract_cell_identities(row[header_indexes[field]]):
                identities[(dataset_label, field, kind, value)] += 1
    return identities


def verify_expected_base(
    payload: bytes,
    identities: Counter[tuple[str, str, str, str]],
    *,
    expected_sha256: str,
    expected_identities: int,
    expected_occurrences: int,
) -> None:
    if not SHA256_RE.fullmatch(expected_sha256):
        raise IdentityLedgerError("SHA-256 atteso del ledger base non valido")
    if (
        sha256_bytes(payload) != expected_sha256
        or len(identities) != expected_identities
        or sum(identities.values()) != expected_occurrences
    ):
        raise IdentityLedgerError("contratto forte del ledger base divergente")


def build_ledger(
    *,
    source_root: Path,
    spec_path: Path,
    base_ledger_path: Path | None = None,
    base_spec_path: Path | None = None,
    expected_base_spec_sha256: str | None = None,
    expected_base_sha256: str | None = None,
    expected_base_identities: int | None = None,
    expected_base_occurrences: int | None = None,
) -> LedgerBuild:
    if (
        source_root.is_symlink()
        or not source_root.is_dir()
        or _within_repository(source_root)
    ):
        raise IdentityLedgerError("source root privato non valido")
    if (base_ledger_path is None) != (base_spec_path is None):
        raise IdentityLedgerError("base ledger e base spec devono essere forniti insieme")
    expected_base = (
        expected_base_spec_sha256,
        expected_base_sha256,
        expected_base_identities,
        expected_base_occurrences,
    )
    if base_ledger_path is None and any(value is not None for value in expected_base):
        raise IdentityLedgerError("contratto base fornito senza ledger base")
    if base_ledger_path is not None and any(value is None for value in expected_base):
        raise IdentityLedgerError("contratto forte del ledger base incompleto")

    datasets, base_dataset_ids = _validated_specs(
        spec_path,
        base_spec_path,
        expected_base_spec_sha256,
    )
    base_identities: Counter[tuple[str, str, str, str]] = Counter()
    if base_ledger_path is not None:
        base_payload = read_private_payload(base_ledger_path, "ledger base")
        base_identities = parse_private_ledger(base_payload)
        verify_expected_base(
            base_payload,
            base_identities,
            expected_sha256=str(expected_base_sha256),
            expected_identities=int(expected_base_identities),
            expected_occurrences=int(expected_base_occurrences),
        )

    delta: Counter[tuple[str, str, str, str]] = Counter()
    for item in datasets:
        try:
            parsed = dataset_etl.parse_dataset(source_root, item)
        except dataset_etl.DatasetBuildError as error:
            raise IdentityLedgerError(
                f"sorgente pinned divergente per {item['id']}"
            ) from error
        extracted = identities_for_dataset(item, parsed)
        # Parsing/extraction is deliberately performed for base datasets too:
        # this keeps every declared source field and pinned source under check.
        if item["id"] not in base_dataset_ids:
            delta.update(extracted)

    merged = base_identities.copy()
    for identity, occurrences in delta.items():
        combined = merged[identity] + occurrences
        if combined > MAX_SAFE_INTEGER:
            raise IdentityLedgerError("una identita supera il limite intero")
        merged[identity] = combined
    total_occurrences = sum(merged.values())
    if total_occurrences > MAX_SAFE_INTEGER:
        raise IdentityLedgerError("occorrenze totali oltre il limite")
    payload = render_ledger(merged)
    return LedgerBuild(
        payload=payload,
        identities=len(merged),
        occurrences=total_occurrences,
        delta_identities=len(delta),
        delta_occurrences=sum(delta.values()),
        datasets=len(datasets),
        delta_datasets=len(datasets) - len(base_dataset_ids),
    )


def enforce_output_expectations(
    build: LedgerBuild,
    *,
    expected_sha256: str | None,
    expected_identities: int | None,
    expected_occurrences: int | None,
) -> None:
    if expected_sha256 is not None and (
        not SHA256_RE.fullmatch(expected_sha256) or build.sha256 != expected_sha256
    ):
        raise IdentityLedgerError("SHA-256 output divergente")
    if expected_identities is not None and build.identities != expected_identities:
        raise IdentityLedgerError("conteggio identita output divergente")
    if expected_occurrences is not None and build.occurrences != expected_occurrences:
        raise IdentityLedgerError("conteggio occorrenze output divergente")


def write_private_output(path: Path, payload: bytes) -> None:
    resolved = require_private_output(path)
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{resolved.name}.",
            dir=resolved.parent,
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, resolved)
        finally:
            if temporary.exists():
                temporary.unlink()
    except OSError as error:
        raise IdentityLedgerError("output privato non scrivibile") from error


def check_private_output(path: Path, payload: bytes) -> None:
    actual = read_private_payload(path, "output privato")
    if actual != payload:
        raise IdentityLedgerError("output privato non riproducibile")


def summary(build: LedgerBuild) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "datasets": build.datasets,
        "deltaDatasets": build.delta_datasets,
        "identities": build.identities,
        "occurrences": build.occurrences,
        "deltaIdentities": build.delta_identities,
        "deltaOccurrences": build.delta_occurrences,
        "bytes": len(build.payload),
        "sha256": build.sha256,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--base-ledger", type=Path)
    parser.add_argument("--base-spec", type=Path)
    parser.add_argument("--base-spec-sha256")
    parser.add_argument("--base-sha256")
    parser.add_argument("--base-identities", type=int)
    parser.add_argument("--base-occurrences", type=int)
    parser.add_argument("--expect-sha256")
    parser.add_argument("--expect-identities", type=int)
    parser.add_argument("--expect-occurrences", type=int)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--build", action="store_true")
    action.add_argument("--check", action="store_true")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        output = require_private_output(args.output)
        for candidate, label in (
            (args.base_ledger, "ledger base"),
            (args.base_spec, "spec base"),
            (args.spec, "spec espansa"),
        ):
            if candidate is not None and output == candidate.resolve(strict=False):
                raise IdentityLedgerError(f"output privato alias di {label}")
        built = build_ledger(
            source_root=args.source_root,
            spec_path=args.spec,
            base_ledger_path=args.base_ledger,
            base_spec_path=args.base_spec,
            expected_base_spec_sha256=args.base_spec_sha256,
            expected_base_sha256=args.base_sha256,
            expected_base_identities=args.base_identities,
            expected_base_occurrences=args.base_occurrences,
        )
        enforce_output_expectations(
            built,
            expected_sha256=args.expect_sha256,
            expected_identities=args.expect_identities,
            expected_occurrences=args.expect_occurrences,
        )
        if args.build:
            write_private_output(output, built.payload)
        else:
            check_private_output(output, built.payload)
    except IdentityLedgerError as error:
        print(f"errore: {error}", file=os.sys.stderr)
        return 1
    print(json.dumps(summary(built), sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
