#!/usr/bin/env python3
"""AIFA spesa e consumo per ATC: snapshot vincolato agli hash (issue #371).

AIFA pubblica un CSV per anno (il 2025 dentro uno zip) con spesa e confezioni per
mese, regione, classe di rimborsabilità e ATC IV livello, su due canali distinti:
tracciabilità (acquisti delle strutture pubbliche, incluse DD e DPC) e
convenzionata (farmacie, prezzo al pubblico lordo). I due canali non si sommano.

Questo modulo vincola i byte al lock, legge il tracciato così com'è pubblicato e
aggrega senza perdere centesimi. Runtime e CI non chiamano AIFA: i CSV grezzi
(circa 30 MB l'uno) restano fuori dal repository, come per i bundle Eurostat.

Lo snapshot pubblica l'aggregato annuale per regione, classe e ATC di II livello.
Il dettaglio mensile e di IV livello resta nella fonte: qui verrebbe un artefatto
di decine di MB senza che il prodotto lo usi.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/aifa-spesa-consumi-2022-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/aifa-spesa-consumi-2022-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/aifa-spesa-consumi-2022-2025.meta.json"

DATASET_ID = "aifa-spesa-consumi"
OFFICIAL_PREFIX = "https://www.aifa.gov.it/"
DATA_ARTIFACT_PATH = "src/data/generated/aifa-spesa-consumi-2022-2025.data.json"

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
CLASS_LABELS = {
    "A": "Classe A (rimborsata dal SSN)",
    "C": "Classe C (a carico del cittadino)",
    "C-bis": "Classe C-bis (senza obbligo di ricetta)",
    "Cnn": "Classe Cnn (non negoziata)",
    "H": "Classe H (uso ospedaliero)",
    "N": "Classe non attribuita dalla fonte",
    "": "Classe assente nel rilascio",
}

CHANNELS = {
    "traceability": ("numero_confezioni_traccia", "spesa_flusso_tracciabilita"),
    "convenzionata": ("numero_confezioni_convenzionata", "spesa_convenzionata"),
}
CHANNEL_LABELS = {
    "traceability": "Tracciabilità: acquisti delle strutture sanitarie pubbliche, inclusa distribuzione diretta e per conto, sell-in al lordo dell'IVA.",
    "convenzionata": "Convenzionata: farmacie aperte al pubblico, spesa lorda a prezzo al pubblico, inclusi ticket e sconti.",
}
# Solo la tracciabilità ammette negativi (resi e note di credito nel flusso di sell-in).
SIGNED_CHANNELS = frozenset({"traceability"})

GRANULARITIES = {
    "annual-region-class-atc2": ("year", "regionCode", "class", "atc2"),
    "annual-region-class-atc4": ("year", "regionCode", "class", "atc4"),
    "monthly-region-class-atc2": ("year", "month", "regionCode", "class", "atc2"),
}
PUBLISHED_GRANULARITY = "annual-region-class-atc2"

CAVEATS = (
    "Tracciabilità e convenzionata sono due canali distinti e non vanno sommati: il primo è il sell-in "
    "alle strutture pubbliche al lordo dell'IVA, il secondo è la spesa lorda in farmacia a prezzo al pubblico.",
    "Gli importi sono al lordo dei payback: non sono la spesa netta a carico del Servizio sanitario nazionale.",
    "Non sommabile al Conto economico del SSN, a SIOPE sanità o alla funzione COFOG GF07: perimetri e nature diversi.",
    "Una cella vuota significa canale assente per quella combinazione, e resta distinta da uno zero osservato.",
    "La tracciabilità contiene importi e confezioni negativi (resi e note di credito): sono conservati, non azzerati.",
    "Lo snapshot pubblica l'aggregato annuale per regione, classe e ATC di II livello: il dettaglio mensile e di "
    "IV livello resta nella fonte e non viene ricostruito.",
    "Nel 2024 la convenzionata del rilascio open data supera di circa 297 milioni di euro (+3,1%) il dato che il "
    "Rapporto OsMed 2024 ricava dalle Distinte Contabili Riepilogative; la causa non è documentata dalla fonte.",
    "Il rilascio 2025 può essere rivisto: la fonte non lo marca come provvisorio ma aggiorna i file nel tempo.",
    "Numero di confezioni non è consumo in dosi (DDD) e la spesa per confezione non è un prezzo.",
)

_MONEY = re.compile(r"^(-?)(\d+)(?:\.(\d{1,2}))?$")
_INTEGER = re.compile(r"^-?\d+$")


class SnapshotError(ValueError):
    """Raised when a release diverges from the lock or from the published record layout."""


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    if spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: datasetId inatteso")
    if spec["source"].get("licenseId") != "CC-BY-4.0":
        raise SnapshotError("source lock: licenza attesa CC-BY-4.0")
    for field in ("landingUrl", "catalogUrl", "manualUrl"):
        if not str(spec["source"].get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale AIFA")
    for year, asset in spec["source"]["assets"].items():
        if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: URL non ufficiale per {year}")
        if len(str(asset.get("sha256", ""))) != 64:
            raise SnapshotError(f"source lock: sha256 non valido per {year}")
    if spec.get("granularity") != PUBLISHED_GRANULARITY:
        raise SnapshotError("source lock: granularità pubblicata inattesa")
    return spec


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
            "atc2Label": cell["descrizione_atc2"].strip(),
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
    totals: dict[tuple[str, str, int], int] = defaultdict(int)
    for row in rows:
        for channel in CHANNELS:
            spend = row["measures"][channel]["spendCents"]
            if spend is not None:
                totals[(channel, row["regionCode"], row["month"])] += spend
    positive: dict[str, set[tuple[str, int]]] = {channel: set() for channel in CHANNELS}
    for (channel, region, month), cents in totals.items():
        if cents > 0:
            positive[channel].add((region, month))
    expected = {(region, month) for region in REGION_CODES for month in MONTHS}
    for channel, cells in positive.items():
        missing = sorted(expected - cells)
        if missing:
            raise SnapshotError(
                f"{year}: {channel} senza spesa positiva in {len(missing)} celle regione×mese (prime: {missing[:3]})"
            )


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


def load_releases(spec: dict[str, Any], input_dir: Path) -> dict[int, list[dict[str, Any]]]:
    releases: dict[int, list[dict[str, Any]]] = {}
    for key, asset in sorted(spec["source"]["assets"].items()):
        year = int(asset["year"])
        path = input_dir / asset["filename"]
        if not path.is_file():
            raise SnapshotError(f"rilascio mancante: {path}")
        payload = read_release(
            path,
            expected_bytes=asset["bytes"],
            expected_sha256=asset["sha256"],
            member=asset.get("member"),
            member_bytes=asset.get("memberBytes"),
            member_sha256=asset.get("memberSha256"),
        )
        rows = parse_release(payload, year)
        check_coverage(rows, year)
        expected_rows = spec["expected"]["sourceRows"].get(key)
        if expected_rows is not None and len(rows) != expected_rows:
            raise SnapshotError(f"{year}: {len(rows)} righe, attese {expected_rows}")
        releases[year] = rows
    if sorted(releases) != list(spec["expected"]["years"]):
        raise SnapshotError("anni del lock diversi dai rilasci letti")
    return releases


def build_data(spec: dict[str, Any], releases: dict[int, list[dict[str, Any]]]) -> dict[str, Any]:
    observations: list[dict[str, Any]] = []
    by_year: list[dict[str, Any]] = []
    regions: dict[str, str] = {}
    atc2: dict[str, str] = {}
    for year in sorted(releases):
        rows = releases[year]
        for row in rows:
            regions.setdefault(row["regionCode"], row["regionLabel"])
            if row["atc2"]:
                atc2.setdefault(row["atc2"], row["atc2Label"])
        for group in aggregate(rows, PUBLISHED_GRANULARITY):
            observations.append({
                "year": group["year"],
                "regionCode": group["regionCode"],
                "class": group["class"],
                "atc2": group["atc2"],
                "sourceRows": group["sourceRows"],
                "traceabilityPacks": group["measures"]["traceability"]["packs"],
                "traceabilitySpendCents": group["measures"]["traceability"]["spendCents"],
                "convenzionataPacks": group["measures"]["convenzionata"]["packs"],
                "convenzionataSpendCents": group["measures"]["convenzionata"]["spendCents"],
            })
        totals = release_totals(rows)
        by_year.append({
            "year": year,
            "sourceRows": len(rows),
            "traceabilityPacks": totals["traceability"]["packs"],
            "traceabilitySpendCents": totals["traceability"]["spendCents"],
            "convenzionataPacks": totals["convenzionata"]["packs"],
            "convenzionataSpendCents": totals["convenzionata"]["spendCents"],
        })

    published = spec["expected"]["publishedRows"]
    if len(observations) != published:
        raise SnapshotError(f"attese {published} righe pubblicate, prodotte {len(observations)}")
    keys = {(row["year"], row["regionCode"], row["class"], row["atc2"]) for row in observations}
    if len(keys) != len(observations):
        raise SnapshotError("chiavi anno×regione×classe×ATC II non uniche")

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "granularity": PUBLISHED_GRANULARITY,
        "units": {
            "spendCents": "centesimi di euro (la fonte pubblica euro con due decimali)",
            "packs": "numero di confezioni",
            "money": "spesa lorda, al lordo dei payback; la tracciabilità è al lordo dell'IVA",
        },
        "channels": [
            {"id": channel, "label": CHANNEL_LABELS[channel], "signed": channel in SIGNED_CHANNELS}
            for channel in sorted(CHANNELS)
        ],
        "regions": [{"code": code, "label": regions[code]} for code in sorted(regions)],
        "classes": [{"code": code, "label": CLASS_LABELS[code]} for code in sorted(KNOWN_CLASSES)],
        "atc2": [{"code": code, "label": atc2[code]} for code in sorted(atc2)],
        "coverage": {
            "years": list(spec["expected"]["years"]),
            "regions": len(regions),
            "months": 12,
            "publishedRows": len(observations),
            "sourceRows": {str(year): len(releases[year]) for year in sorted(releases)},
            "note": spec["coverage"]["note"],
        },
        "reconciliation": {
            "note": (
                "I totali per anno e canale sono ricalcolati dalle righe del rilascio e devono coincidere al "
                "centesimo con la somma dell'aggregato pubblicato."
            ),
            "byYear": by_year,
        },
        "caveats": list(CAVEATS),
        "observations": observations,
    }


def build_meta(spec: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    data_bytes = canonical_bytes(data)
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    lock_digest = digest(canonical_bytes(lock_body))
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "observedAt": spec["coverage"]["observedAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "catalogUrl": source["catalogUrl"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "termsUrl": source["termsUrl"],
            "manualUrl": source["manualUrl"],
            "manualNote": source["manualNote"],
            "sourceUpdated": source["sourceUpdated"],
            "acquisition": dict(source["acquisition"]),
            "assets": {key: dict(asset) for key, asset in source["assets"].items()},
        },
        "coverage": dict(spec["coverage"]),
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md).
        "semantics": {
            "soldi": {
                "unit": "centesimi di euro",
                "nature": (
                    "spesa lorda per farmaci su due canali distinti: sell-in alle strutture pubbliche "
                    "(tracciabilità, lordo IVA) e spesa in farmacia a prezzo al pubblico (convenzionata). "
                    "Non è spesa netta del SSN e non è cassa."
                ),
                "note": (
                    "Gli importi sono al lordo dei payback. Accanto alla spesa, il numero di confezioni resta "
                    "una misura separata: non è consumo in dosi (DDD)."
                ),
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": (
                    "Anno di erogazione dichiarato dalla fonte, dettaglio mensile aggregato ad anno. "
                    "Il rilascio 2025 può essere rivisto nelle edizioni successive."
                ),
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": sorted(
                    {source["landingUrl"], source["catalogUrl"], *(asset["url"] for asset in source["assets"].values())}
                ),
                "publicationDate": source["sourceUpdated"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
                "hashes": "SHA-256 per rilascio in source.assets; artefatto in integrity.dataArtifact",
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


def write_data_artifact(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Nessun newline finale: i byte scritti qui sono esattamente quelli di cui lock e
    # meta dichiarano dimensione e SHA-256, come per gli altri artefatti generati.
    # newline="\n": su Windows write_text tradurrebbe in CRLF e gli artefatti non
    # sarebbero più identici byte per byte a quelli costruiti su Linux.
    path.write_text(canonical_bytes(value).decode("utf-8"), encoding="utf-8", newline="\n")


def write_meta(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Il meta è documentazione di provenienza da leggere in review: indentato, come
    # negli altri ETL del repo. Nessun hash dipende dalla sua formattazione.
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


def build(spec: dict[str, Any], input_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    releases = load_releases(spec, input_dir)
    data = build_data(spec, releases)
    return data, build_meta(spec, data)


def check(spec_path: Path, data_path: Path, meta_path: Path) -> None:
    """Offline: valida gli artefatti committati senza rileggere i CSV della fonte."""
    spec = load_spec(spec_path)
    lock_body = {**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}
    if digest(canonical_bytes(lock_body)) != spec["integrity"]["lockSha256"]:
        raise SnapshotError("lockSha256 non corrisponde al contenuto del lock")
    data_bytes = data_path.read_bytes()
    data = json.loads(data_bytes.decode("utf-8"))
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    canonical = canonical_bytes(data)
    artifact = metadata["integrity"]["dataArtifact"]
    # Prima i byte come stanno su disco: sono quelli che finiscono nel commit e che
    # la provenienza dichiara. Confrontare solo la forma canonica ricostruita
    # lascerebbe passare un file che differisce per spaziatura o newline finale.
    if artifact["bytes"] != len(data_bytes) or artifact["sha256"] != digest(data_bytes):
        raise SnapshotError("data artifact: i byte su disco divergono da quanto dichiarato nel meta")
    if data_bytes != canonical:
        raise SnapshotError("data artifact: il file su disco non è nella forma canonica")
    if artifact["sha256"] != digest(canonical) or artifact["bytes"] != len(canonical):
        raise SnapshotError("meta: hash o dimensione del data artifact divergenti")
    if artifact["sha256"] != spec["integrity"]["dataArtifact"]["sha256"]:
        raise SnapshotError("lock: hash del data artifact divergente dal meta")
    if metadata["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente dal lock")
    if data["granularity"] != PUBLISHED_GRANULARITY or data["datasetId"] != DATASET_ID:
        raise SnapshotError("data artifact: identità o granularità inattese")
    if len(data["observations"]) != spec["expected"]["publishedRows"]:
        raise SnapshotError("data artifact: righe pubblicate divergenti dal lock")
    keys = {(row["year"], row["regionCode"], row["class"], row["atc2"]) for row in data["observations"]}
    if len(keys) != len(data["observations"]):
        raise SnapshotError("data artifact: chiavi non uniche")
    totals = {entry["year"]: entry for entry in data["reconciliation"]["byYear"]}
    sums: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in data["observations"]:
        for field in ("traceabilityPacks", "traceabilitySpendCents", "convenzionataPacks", "convenzionataSpendCents"):
            if row[field] is not None:
                sums[row["year"]][field] += row[field]
    for year, entry in totals.items():
        for field in ("traceabilityPacks", "traceabilitySpendCents", "convenzionataPacks", "convenzionataSpendCents"):
            if sums[year][field] != entry[field]:
                raise SnapshotError(f"{year}: {field} dell'aggregato non riconcilia con i totali dichiarati")


def write(spec_path: Path, data_path: Path, meta_path: Path, input_dir: Path) -> dict[str, Any]:
    spec = load_spec(spec_path)
    data, meta = build(spec, input_dir)
    spec["integrity"] = {
        "algorithm": "sha256",
        "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
        "dataArtifact": dict(meta["integrity"]["dataArtifact"]),
        "lockSha256": "",
    }
    lock_digest = digest(canonical_bytes({**spec, "integrity": {**spec["integrity"], "lockSha256": ""}}))
    spec["integrity"]["lockSha256"] = lock_digest
    meta["integrity"]["sourceLockSha256"] = lock_digest
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    write_data_artifact(data_path, data)
    write_meta(meta_path, meta)
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="valida gli artefatti committati senza rete")
    mode.add_argument("--write", action="store_true", help="ricostruisce artefatti e integrity dal lock")
    mode.add_argument("--profile", type=Path, help="profila un singolo rilascio (diagnostica)")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input-dir", type=Path, help="cartella con i rilasci annuali vincolati")
    parser.add_argument("--year", type=int)
    args = parser.parse_args()

    try:
        if args.check:
            check(args.spec, args.data, args.meta)
            print("aifa-spesa-consumi: lock, data e meta coerenti")
            return 0
        if args.profile:
            spec = load_spec(args.spec)
            asset = next(a for a in spec["source"]["assets"].values() if int(a["year"]) == args.year)
            payload = read_release(
                args.profile,
                expected_bytes=asset["bytes"], expected_sha256=asset["sha256"],
                member=asset.get("member"), member_bytes=asset.get("memberBytes"),
                member_sha256=asset.get("memberSha256"),
            )
            rows = parse_release(payload, args.year)
            check_coverage(rows, args.year)
            for channel, total in release_totals(rows).items():
                print(f"{args.year} {channel}: {total['spendCents']} centesimi, {total['packs']} confezioni, {total['observedRows']} righe")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con i rilasci vincolati, oppure --check")
        data = write(args.spec, args.data, args.meta, args.input_dir)
        print(f"aifa-spesa-consumi: scritti gli artefatti ({len(data['observations'])} righe pubblicate)")
        return 0
    except SnapshotError as error:
        print(f"aifa-spesa-consumi: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
