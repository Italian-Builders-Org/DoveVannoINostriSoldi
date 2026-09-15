#!/usr/bin/env python3
"""AIFA spesa e consumo per ATC: lettura fail-closed dei rilasci annuali (issue #371).

AIFA pubblica un CSV per anno (il 2025 dentro uno zip) con spesa e confezioni per
mese, regione, classe di rimborsabilità e ATC IV livello, su due canali distinti:
tracciabilità (acquisti delle strutture pubbliche, incluse DD e DPC) e
convenzionata (farmacie, prezzo al pubblico lordo). I due canali non si sommano.

Questo modulo vincola i byte al lock, legge il tracciato così com'è pubblicato e
aggrega senza perdere centesimi. Runtime e CI non chiamano AIFA: i CSV grezzi
(circa 30 MB l'uno) restano fuori dal repository, come per COFOG.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

DATASET_ID = "aifa-spesa-consumi"
OFFICIAL_PREFIX = "https://www.aifa.gov.it/"

HEADER = (
    "anno", "mese", "codreg", "regione", "classe",
    "atc1", "descrizione_atc1", "atc2", "descrizione_atc2",
    "atc3", "descrizione_atc3", "atc4", "descrizione_atc4",
    "numero_confezioni_traccia", "spesa_flusso_tracciabilita",
    "numero_confezioni_convenzionata", "spesa_convenzionata",
)

# Codici ISTAT delle 19 regioni e delle due province autonome, come nel manuale AIFA.
REGION_CODES = frozenset({
    "010", "020", "030", "041", "042", "050", "060", "070", "080", "090", "100",
    "110", "120", "130", "140", "150", "160", "170", "180", "190", "200",
})
MONTHS = tuple(range(1, 13))

# Classi osservate nei rilasci 2022-2025. «C-BIS» compare nel 2024 accanto a «C-bis»;
# vuoto e «N» restano classi esplicite: scartarle toglierebbe spesa reale dal totale.
CLASS_ALIASES = {"C-BIS": "C-bis"}
KNOWN_CLASSES = frozenset({"A", "C", "H", "C-bis", "Cnn", "N", ""})

CHANNELS = {
    "traceability": ("numero_confezioni_traccia", "spesa_flusso_tracciabilita"),
    "convenzionata": ("numero_confezioni_convenzionata", "spesa_convenzionata"),
}
# Solo la tracciabilità ammette negativi (resi e note di credito nel flusso di sell-in).
SIGNED_CHANNELS = frozenset({"traceability"})

GRANULARITIES = {
    "annual-region-class-atc2": ("year", "regionCode", "class", "atc2"),
    "annual-region-class-atc4": ("year", "regionCode", "class", "atc4"),
    "monthly-region-class-atc2": ("year", "month", "regionCode", "class", "atc2"),
}

_MONEY = re.compile(r"^(-?)(\d+)(?:\.(\d{1,2}))?$")
_INTEGER = re.compile(r"^-?\d+$")


class SnapshotError(ValueError):
    """Raised when a release diverges from the lock or from the published record layout."""


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_release(
    path: Path,
    *,
    expected_bytes: int,
    expected_sha256: str,
    member: str | None = None,
    member_bytes: int | None = None,
    member_sha256: str | None = None,
) -> bytes:
    """Return the CSV bytes of a release after pinning the file, and the zip member if any."""
    raw = path.read_bytes()
    if len(raw) != expected_bytes or digest(raw) != expected_sha256:
        raise SnapshotError(f"{path.name}: byte o SHA-256 diversi dal lock")
    if member is None:
        return raw
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise SnapshotError(f"{path.name}: zip illeggibile") from error
    if archive.namelist() != [member]:
        raise SnapshotError(f"{path.name}: attesa una sola voce {member!r}, trovate {archive.namelist()}")
    inner = archive.read(member)
    if len(inner) != member_bytes or digest(inner) != member_sha256:
        raise SnapshotError(f"{path.name}:{member}: byte o SHA-256 diversi dal lock")
    return inner


def parse_money_cents(raw: str, label: str, *, signed: bool) -> int | None:
    value = raw.strip()
    if value == "":
        return None
    match = _MONEY.match(value)
    if not match:
        raise SnapshotError(f"{label}: importo non valido {raw!r}")
    sign, units, decimals = match.groups()
    cents = int(units) * 100 + int((decimals or "").ljust(2, "0"))
    if sign:
        if not signed:
            raise SnapshotError(f"{label}: importo negativo non ammesso su questo canale")
        cents = -cents
    return cents


def parse_packs(raw: str, label: str, *, signed: bool) -> int | None:
    value = raw.strip()
    if value == "":
        return None
    if not _INTEGER.match(value):
        raise SnapshotError(f"{label}: numero di confezioni non intero {raw!r}")
    packs = int(value)
    if packs < 0 and not signed:
        raise SnapshotError(f"{label}: confezioni negative non ammesse su questo canale")
    return packs


def atc_level(atc4: str) -> str:
    if atc4 == "":
        return "none"
    return "IV" if len(atc4) == 5 else "above-IV"


def parse_release(payload: bytes, year: int) -> list[dict[str, Any]]:
    """Parse one annual release into typed rows, refusing anything the lock did not describe."""
    if payload.count(b"\n") != payload.count(b"\r\n"):
        raise SnapshotError(f"{year}: attesi terminatori di riga CRLF")
    try:
        text = payload.decode("cp1252")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"{year}: codifica non cp1252") from error
    reader = csv.reader(io.StringIO(text, newline=""), delimiter="|")
    try:
        header = next(reader)
    except StopIteration as error:
        raise SnapshotError(f"{year}: file vuoto") from error
    if tuple(header) != HEADER:
        raise SnapshotError(f"{year}: header diverso dal tracciato atteso")

    rows: list[dict[str, Any]] = []
    seen: set[tuple[int, str, str, str]] = set()
    for line, record in enumerate(reader, start=2):
        if len(record) != len(HEADER):
            raise SnapshotError(f"{year}: riga {line} con {len(record)} campi")
        cell = dict(zip(HEADER, record))
        where = f"{year} riga {line}"
        if cell["anno"] != str(year):
            raise SnapshotError(f"{where}: anno {cell['anno']!r} fuori dal rilascio")
        if not re.fullmatch(r"(0[1-9]|1[0-2])", cell["mese"]):
            raise SnapshotError(f"{where}: mese non canonico {cell['mese']!r}")
        if cell["codreg"] not in REGION_CODES:
            raise SnapshotError(f"{where}: codice regione sconosciuto {cell['codreg']!r}")
        class_raw = cell["classe"].strip()
        normalized_class = CLASS_ALIASES.get(class_raw, class_raw)
        if normalized_class not in KNOWN_CLASSES:
            raise SnapshotError(f"{where}: classe sconosciuta {class_raw!r}")

        atc = {level: cell[f"atc{level}"].strip() for level in (1, 2, 3, 4)}
        if atc[4]:
            if not (atc[1] and atc[2].startswith(atc[1]) and atc[3].startswith(atc[2]) and atc[4].startswith(atc[3])):
                raise SnapshotError(f"{where}: gerarchia ATC incoerente {atc}")
        elif any(atc.values()):
            raise SnapshotError(f"{where}: ATC parziale senza IV livello {atc}")

        measures: dict[str, dict[str, int | None]] = {}
        for channel, (packs_column, spend_column) in CHANNELS.items():
            signed = channel in SIGNED_CHANNELS
            packs = parse_packs(cell[packs_column], f"{where} {packs_column}", signed=signed)
            spend = parse_money_cents(cell[spend_column], f"{where} {spend_column}", signed=signed)
            if (packs is None) != (spend is None):
                raise SnapshotError(f"{where}: {channel} con confezioni e spesa non entrambe presenti")
            measures[channel] = {"packs": packs, "spendCents": spend}

        month = int(cell["mese"])
        key = (month, cell["codreg"], class_raw, atc[4])
        if key in seen:
            raise SnapshotError(f"{where}: chiave duplicata mese×regione×classe×atc4 {key}")
        seen.add(key)
        rows.append({
            "year": year,
            "month": month,
            "regionCode": cell["codreg"],
            "regionLabel": cell["regione"].strip(),
            "classRaw": class_raw,
            "class": normalized_class,
            "atc1": atc[1],
            "atc2": atc[2],
            "atc3": atc[3],
            "atc4": atc[4],
            "atc4Label": cell["descrizione_atc4"].strip(),
            "atcLevel": atc_level(atc[4]),
            "measures": measures,
        })
    if not rows:
        raise SnapshotError(f"{year}: nessuna riga dati")
    return rows


def check_coverage(rows: Iterable[dict[str, Any]], year: int) -> None:
    """Every region × month must carry positive spend on both channels."""
    positive: dict[str, set[tuple[str, int]]] = {channel: set() for channel in CHANNELS}
    totals: dict[tuple[str, str, int], int] = defaultdict(int)
    for row in rows:
        for channel in CHANNELS:
            spend = row["measures"][channel]["spendCents"]
            if spend is not None:
                totals[(channel, row["regionCode"], row["month"])] += spend
    for (channel, region, month), cents in totals.items():
        if cents > 0:
            positive[channel].add((region, month))
    expected = {(region, month) for region in REGION_CODES for month in MONTHS}
    for channel, cells in positive.items():
        missing = sorted(expected - cells)
        if missing:
            raise SnapshotError(f"{year}: {channel} senza spesa positiva in {len(missing)} celle regione×mese (prime: {missing[:3]})")


def release_totals(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, int]]:
    totals = {channel: {"packs": 0, "spendCents": 0, "observedRows": 0} for channel in CHANNELS}
    for row in rows:
        for channel in CHANNELS:
            measure = row["measures"][channel]
            if measure["spendCents"] is None:
                continue
            totals[channel]["packs"] += measure["packs"]
            totals[channel]["spendCents"] += measure["spendCents"]
            totals[channel]["observedRows"] += 1
    return totals


def aggregate(rows: list[dict[str, Any]], granularity: str) -> list[dict[str, Any]]:
    """Sum each channel separately along the chosen dimensions.

    A channel with no observed row in a group stays null: absence is not zero.
    The result must reconcile to the release totals to the cent, or the build stops.
    """
    if granularity not in GRANULARITIES:
        raise SnapshotError(f"granularità sconosciuta {granularity!r}")
    dimensions = GRANULARITIES[granularity]
    groups: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(row[dimension] for dimension in dimensions)
        group = groups.get(key)
        if group is None:
            group = {dimension: row[dimension] for dimension in dimensions}
            group["sourceRows"] = 0
            group["measures"] = {channel: {"packs": None, "spendCents": None, "observedRows": 0} for channel in CHANNELS}
            groups[key] = group
        group["sourceRows"] += 1
        for channel in CHANNELS:
            source = row["measures"][channel]
            if source["spendCents"] is None:
                continue
            target = group["measures"][channel]
            target["packs"] = (target["packs"] or 0) + source["packs"]
            target["spendCents"] = (target["spendCents"] or 0) + source["spendCents"]
            target["observedRows"] += 1
    result = [groups[key] for key in sorted(groups, key=lambda key: tuple(str(part) for part in key))]
    reconcile(rows, result)
    return result


def reconcile(rows: list[dict[str, Any]], aggregated: list[dict[str, Any]]) -> None:
    expected = release_totals(rows)
    for channel in CHANNELS:
        packs = sum(group["measures"][channel]["packs"] or 0 for group in aggregated)
        spend = sum(group["measures"][channel]["spendCents"] or 0 for group in aggregated)
        observed = sum(group["measures"][channel]["observedRows"] for group in aggregated)
        if (packs, spend, observed) != (
            expected[channel]["packs"], expected[channel]["spendCents"], expected[channel]["observedRows"],
        ):
            raise SnapshotError(f"{channel}: l'aggregato non riconcilia con i totali del rilascio")
    if sum(group["sourceRows"] for group in aggregated) != len(rows):
        raise SnapshotError("l'aggregato non conserva tutte le righe di origine")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True, help="CSV o zip di un rilascio annuale")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--bytes", type=int, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--member")
    parser.add_argument("--member-bytes", type=int)
    parser.add_argument("--member-sha256")
    args = parser.parse_args()
    try:
        payload = read_release(
            args.profile,
            expected_bytes=args.bytes,
            expected_sha256=args.sha256,
            member=args.member,
            member_bytes=args.member_bytes,
            member_sha256=args.member_sha256,
        )
        rows = parse_release(payload, args.year)
        check_coverage(rows, args.year)
        totals = release_totals(rows)
        for granularity in GRANULARITIES:
            groups = aggregate(rows, granularity)
            print(f"{args.year} {granularity}: {len(groups)} gruppi")
        for channel, total in totals.items():
            print(f"{args.year} {channel}: {total['spendCents']} centesimi, {total['packs']} confezioni, {total['observedRows']} righe")
        return 0
    except SnapshotError as error:
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
