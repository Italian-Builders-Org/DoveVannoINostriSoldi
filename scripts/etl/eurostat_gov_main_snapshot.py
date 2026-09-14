#!/usr/bin/env python3
"""Build the hash-pinned Eurostat snapshot of general government revenue and expenditure.

The two input files are the JSON-stat 2.0 responses of the Eurostat dissemination
API for `gov_10a_main` (CC BY 4.0, verified on the Eurostat copyright notice), one
per published unit: million euro and percentage of GDP, Italy, sector S13,
1995-2025.  They are passed as local files: runtime and CI never call Eurostat,
and a structure or hash drift fails closed before an existing artifact is replaced.

The lock pins the whole response (all 119 `na_item` codes), so no selection is
hidden in the acquisition.  The artifact publishes the three SEC totals, the
components of their accounting identities and one memo item:

* `TR` = P11_P12_P131 + D2REC + D39REC + D4REC + D5REC + D61REC + D7REC + D9REC
* `TE` = P2 + P5 + NP + D1PAY + D29PAY + D3PAY + D4PAY + D5PAY + D62PAY + D632PAY
  + D7PAY + D9PAY  (`D8PAY` is not part of the dataset)
* `B9` = TR - TE
* `D41PAY` (interest) is published as a memo item of `D4PAY`.  It is the same item
  `public-debt.json` uses for the interest share on /debito: `--check` requires the
  two artifacts to agree to the cent on every year they share, so the site never
  shows two different numbers for one Eurostat item.

Eurostat rounds every cell to one decimal independently, so identities hold only
within rounding.  Totals stay the published totals: gaps are measured and bounded,
never corrected.  Money is stored in cents and GDP shares in hundredths of a
percentage point; the source publishes at most one decimal, so both conversions
stay exact on integers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-gov-main-1995-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-gov-main-1995-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/eurostat-gov-main-1995-2025.meta.json"
DEFAULT_PUBLIC_DEBT = ROOT / "src/data/generated/public-debt.json"

DATASET_ID = "eurostat-gov-main"
# Trailing slash on purpose: "https://ec.europa.eu/eurostat" without it also
# accepts "https://ec.europa.eu/eurostat.example.org".
OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/"
EXPECTED_DIMENSIONS = ["freq", "unit", "sector", "na_item", "geo", "time"]

CENTS_PER_MILLION_EUR = 100_000_000
HUNDREDTHS_PER_POINT = 100

TOTALS = ("TR", "TE", "B9")
REVENUE_COMPONENTS = ("P11_P12_P131", "D2REC", "D39REC", "D4REC", "D5REC", "D61REC", "D7REC", "D9REC")
EXPENDITURE_COMPONENTS = (
    "P2", "P5", "NP", "D1PAY", "D29PAY", "D3PAY", "D4PAY", "D5PAY", "D62PAY", "D632PAY", "D7PAY", "D9PAY",
)
MEMO_ITEMS = {"D41PAY": "D4PAY"}
PUBLISHED_ITEMS = TOTALS + REVENUE_COMPONENTS + EXPENDITURE_COMPONENTS + tuple(MEMO_ITEMS)
# SEC signs: net lending/borrowing, acquisitions less disposals of non-produced
# assets and gross capital formation (which includes changes in inventories) can
# be negative.  Any other published item below zero is a structural surprise.
SIGNED_ITEMS = frozenset({"B9", "NP", "P5"})

# Tolerances are the rounding itself, not a licence to absorb a real divergence.
# Amounts: 0.5 million euro, agreed in #485; observed worst case 0.1 on 1995-2025.
TOLERANCE_CENTS = 5 * CENTS_PER_MILLION_EUR // 10
# Shares: the expenditure identity compares thirteen independently rounded
# figures (TE plus twelve components), 13 * 0.05 = 0.65 points; observed worst
# case 0.3 on 1995-2025.
TOLERANCE_SHARE = 65 * HUNDREDTHS_PER_POINT // 100

KNOWN_FLAGS = {"p": "provvisorio", "b": "interruzione della serie storica"}

CAVEATS = (
    "Contabilità nazionale SEC 2010, competenza economica delle Amministrazioni pubbliche "
    "(S13): non sono incassi né pagamenti di cassa. Non confrontabile con i pagamenti SIOPE "
    "dei Comuni di /entrate e non sommabile a CPT, OpenBDAP o alla spesa per funzione COFOG.",
    "B9 è l'indebitamento (−) o accreditamento (+) netto SEC dell'intero settore S13. Non "
    "coincide con i saldi di cassa del bilancio dello Stato spesso citati come «deficit».",
    "I totali TR, TE e B9 sono quelli pubblicati dalla fonte, non ricostruzioni: le identità "
    "con le componenti tornano entro il solo arrotondamento, fino a 0,1 milioni di euro e "
    "0,3 punti di PIL sul periodo coperto.",
    "D41PAY, gli interessi passivi, è una voce «di cui» di D4PAY ed è la stessa voce usata "
    "per la quota degli interessi su /debito: non è una seconda fonte e non va sommata a D4PAY.",
    "La quota di PIL usa il PIL pubblicato da Eurostat nello stesso rilascio. I conti "
    "vengono rivisti: lo snapshot resta bloccato sui byte verificati fino a una nuova "
    "acquisizione.",
    "Le voci descrivono la composizione contabile di entrate e uscite: non misurano "
    "efficienza, qualità della spesa né responsabilità di chi amministra.",
)


class SnapshotError(ValueError):
    """Raised when an input, source lock, or generated snapshot diverges."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    stripped = json.loads(json.dumps(lock))
    stripped["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(stripped))


def _spec_items(spec: dict[str, Any]) -> list[dict[str, str]]:
    expected = spec["expected"]
    items = (
        list(expected["totals"])
        + list(expected["revenueComponents"])
        + list(expected["expenditureComponents"])
        + list(expected["memoItems"])
    )
    if tuple(item["code"] for item in items) != PUBLISHED_ITEMS:
        raise SnapshotError("source lock: voci pubblicate diverse da quelle del contratto")
    return items


def load_source_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if not isinstance(spec, dict):
        raise SnapshotError("source lock: atteso un oggetto")
    for key in ("schemaVersion", "datasetId", "period", "source", "expected", "coverage", "integrity"):
        if key not in spec:
            raise SnapshotError(f"source lock: campo {key} mancante")
    if spec["datasetId"] != DATASET_ID:
        raise SnapshotError("source lock: datasetId inatteso")
    if spec["source"].get("licenseId") != "CC-BY-4.0":
        raise SnapshotError("source lock: licenza attesa CC-BY-4.0 dichiarata dalla fonte")
    if spec["source"].get("datasetCode") != "gov_10a_main":
        raise SnapshotError("source lock: dataset Eurostat non autorizzato")
    for field in ("landingUrl", "termsUrl"):
        if not str(spec["source"].get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale Eurostat")
    assets = spec["source"].get("assets") or {}
    if {asset.get("unit") for asset in assets.values()} != {"MIO_EUR", "PC_GDP"} or len(assets) != 2:
        raise SnapshotError("source lock: attesi esattamente gli asset MIO_EUR e PC_GDP")
    for name, asset in assets.items():
        if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: URL non ufficiale per {name}")
        if len(str(asset.get("sha256", ""))) != 64 or not set(str(asset["sha256"])) <= set("0123456789abcdef"):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
    expected = spec["expected"]
    if (expected.get("freq"), expected.get("sector"), expected.get("geo")) != ("A", "S13", "IT"):
        raise SnapshotError("source lock: filtri freq/sector/geo non autorizzati")
    years = expected.get("years")
    if years != list(range(spec["period"]["from"], spec["period"]["to"] + 1)):
        raise SnapshotError("source lock: anni incoerenti con il periodo")
    if expected.get("cellsPerUnit") != len(PUBLISHED_ITEMS) * len(years):
        raise SnapshotError("source lock: cellsPerUnit incoerente con voci e anni")
    _spec_items(spec)
    return spec


def _scaled_int(raw: object, scale: int, where: str) -> int:
    """Convert a source figure to an exact integer, refusing anything finer."""
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"valore non numerico {raw!r} in {where}") from error
    scaled = value * scale
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"valore {raw!r} in {where} ha più precisione di quanta la fonte ne dichiari")
    return int(scaled)


def _read_bundle(payload: bytes, unit: str, spec: dict[str, Any]) -> dict[tuple[int, str], tuple[int, str | None]]:
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"bundle {unit}: JSON-stat illeggibile: {error}") from error

    if doc.get("class") != "dataset" or doc.get("version") != "2.0":
        raise SnapshotError(f"bundle {unit}: non è un dataset JSON-stat 2.0")
    if doc.get("source") != "ESTAT":
        raise SnapshotError(f"bundle {unit}: provenienza inattesa {doc.get('source')!r}")
    if doc.get("label") != spec["source"]["datasetLabel"]:
        raise SnapshotError(f"bundle {unit}: label del dataset inattesa")

    structure = doc.get("extension", {}).get("datastructure", {})
    for key, value in spec["source"]["structure"].items():
        if str(structure.get(key)) != str(value):
            raise SnapshotError(f"bundle {unit}: struttura {key}={structure.get(key)!r}, atteso {value!r}")
    if doc.get("updated") != spec["expected"]["sourceUpdated"]:
        raise SnapshotError(f"bundle {unit}: updated {doc.get('updated')!r} diverso dal lock")

    ids, sizes = doc.get("id"), doc.get("size")
    if ids != EXPECTED_DIMENSIONS or not isinstance(sizes, list) or len(sizes) != len(ids):
        raise SnapshotError(f"bundle {unit}: dimensioni inattese {ids!r}")
    dims = doc["dimension"]
    expected = spec["expected"]
    for name, code in (("freq", expected["freq"]), ("unit", unit), ("sector", expected["sector"]), ("geo", expected["geo"])):
        if dims[name]["category"]["index"] != {code: 0}:
            raise SnapshotError(f"bundle {unit}: {name} inatteso, atteso {code}")

    items = dims["na_item"]["category"]["index"]
    labels = dims["na_item"]["category"].get("label", {})
    if len(items) != expected["naItemsInResponse"]:
        raise SnapshotError(f"bundle {unit}: {len(items)} voci na_item, attese {expected['naItemsInResponse']}")
    for item in _spec_items(spec):
        if item["code"] not in items:
            raise SnapshotError(f"bundle {unit}: voce {item['code']} assente")
        if labels.get(item["code"]) != item["label"]:
            raise SnapshotError(f"bundle {unit}: label di {item['code']} diversa dal lock")

    years = dims["time"]["category"]["index"]
    if sorted(int(year) for year in years) != expected["years"]:
        raise SnapshotError(f"bundle {unit}: anni diversi da quelli del lock")

    stride = [1] * len(sizes)
    for index in range(len(sizes) - 2, -1, -1):
        stride[index] = stride[index + 1] * sizes[index + 1]
    na_position, time_position = ids.index("na_item"), ids.index("time")
    values = doc.get("value")
    statuses = doc.get("status") or {}
    if not isinstance(values, dict):
        raise SnapshotError(f"bundle {unit}: valori non in forma sparsa JSON-stat")
    scale = CENTS_PER_MILLION_EUR if unit == "MIO_EUR" else HUNDREDTHS_PER_POINT

    out: dict[tuple[int, str], tuple[int, str | None]] = {}
    missing: list[str] = []
    for code in PUBLISHED_ITEMS:
        for year_code, year_index in years.items():
            coordinates = [0] * len(sizes)
            coordinates[na_position], coordinates[time_position] = items[code], year_index
            cell = str(sum(position * step for position, step in zip(coordinates, stride)))
            raw = values.get(cell)
            if raw is None:
                missing.append(f"{year_code}/{code}")
                continue
            flag = statuses.get(cell)
            if flag is not None and flag not in KNOWN_FLAGS:
                raise SnapshotError(f"bundle {unit}: flag di stato {flag!r} su una voce pubblicata {year_code}/{code}")
            out[(int(year_code), code)] = (_scaled_int(raw, scale, f"{unit} {year_code}/{code}"), flag)
    if missing:
        raise SnapshotError(
            f"bundle {unit}: copertura incompleta, {len(missing)} celle assenti (prime: {', '.join(missing[:5])})"
        )
    if len(out) != expected["cellsPerUnit"]:
        raise SnapshotError(f"bundle {unit}: {len(out)} celle, attese {expected['cellsPerUnit']}")
    return out


def _reconcile(observations: list[dict[str, Any]]) -> dict[str, Any]:
    """Check the three SEC identities and the memo item within rounding."""
    by_year: dict[int, dict[str, dict[str, Any]]] = {}
    for observation in observations:
        by_year.setdefault(observation["year"], {})[observation["naItem"]] = observation

    def gap(year: int, row: dict[str, dict[str, Any]], field: str, identity: str) -> int:
        if identity == "revenue":
            return abs(row["TR"][field] - sum(row[code][field] for code in REVENUE_COMPONENTS))
        if identity == "expenditure":
            return abs(row["TE"][field] - sum(row[code][field] for code in EXPENDITURE_COMPONENTS))
        return abs((row["TR"][field] - row["TE"][field]) - row["B9"][field])

    result: dict[str, Any] = {
        "note": (
            "I totali pubblicati non sono ricostruiti: Eurostat arrotonda ogni cella a un decimale "
            "in modo indipendente, quindi le identità SEC tornano entro l'arrotondamento. Lo "
            "scarto è misurato e limitato, mai corretto."
        ),
        "toleranceCents": TOLERANCE_CENTS,
        "toleranceShareHundredths": TOLERANCE_SHARE,
    }
    for identity in ("revenue", "expenditure", "balance"):
        worst_cents, worst_share, worst_at = 0, 0, None
        for year, row in sorted(by_year.items()):
            if set(row) != set(PUBLISHED_ITEMS):
                raise SnapshotError(f"{year}: voci incomplete per le riconciliazioni")
            gap_cents = gap(year, row, "amountCents", identity)
            gap_share = gap(year, row, "shareOfGdpHundredths", identity)
            if gap_cents > TOLERANCE_CENTS or gap_share > TOLERANCE_SHARE:
                raise SnapshotError(
                    f"{year}: identità {identity} oltre l'arrotondamento "
                    f"({gap_cents} centesimi, {gap_share} centesimi di punto)"
                )
            if gap_cents > worst_cents:
                worst_cents, worst_at = gap_cents, str(year)
            worst_share = max(worst_share, gap_share)
        result[identity] = {"maxGapCents": worst_cents, "maxGapShareHundredths": worst_share, "maxGapAt": worst_at}
    for memo, parent in MEMO_ITEMS.items():
        for year, row in sorted(by_year.items()):
            if row[memo]["amountCents"] > row[parent]["amountCents"]:
                raise SnapshotError(f"{year}: la voce «di cui» {memo} supera {parent}")
    return result


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    bundles = {
        asset["unit"]: _read_bundle(inputs[name], asset["unit"], spec)
        for name, asset in spec["source"]["assets"].items()
    }
    amounts, shares = bundles["MIO_EUR"], bundles["PC_GDP"]
    if set(amounts) != set(shares):
        raise SnapshotError("le due unità coprono celle diverse: il confronto non sarebbe onesto")

    order = {code: position for position, code in enumerate(PUBLISHED_ITEMS)}
    observations = []
    for year, code in sorted(amounts, key=lambda key: (key[0], order[key[1]])):
        amount_cents, amount_flag = amounts[(year, code)]
        share, share_flag = shares[(year, code)]
        if amount_flag != share_flag:
            raise SnapshotError(f"flag discordanti fra unità su {year}/{code}: {amount_flag!r} vs {share_flag!r}")
        observation = {"year": year, "naItem": code, "amountCents": amount_cents, "shareOfGdpHundredths": share}
        if amount_flag:
            observation["flag"] = amount_flag
        observations.append(observation)

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "caveats": list(CAVEATS),
        "units": {
            "amountCents": "centesimi di euro (la fonte pubblica milioni di euro con un decimale)",
            "shareOfGdpHundredths": "centesimi di punto percentuale di PIL",
        },
        "flags": dict(KNOWN_FLAGS),
        "items": [dict(item) for item in _spec_items(spec)],
        "memoItems": dict(MEMO_ITEMS),
        "observations": observations,
        "coverage": {
            "expectedCells": spec["expected"]["cellsPerUnit"],
            "observedCells": len(observations),
            "flagged": sum(1 for observation in observations if "flag" in observation),
        },
        "reconciliation": _reconcile(observations),
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "units", "flags", "items",
                "memoItems", "observations", "coverage", "reconciliation"):
        if key not in data:
            raise SnapshotError(f"data artifact: campo {key} mancante")
    if data["datasetId"] != DATASET_ID or data["schemaVersion"] != 1:
        raise SnapshotError("data artifact: identità inattesa")
    if not data["caveats"]:
        raise SnapshotError("data artifact: caveats assenti — i limiti del dato fanno parte del dato")
    if tuple(item["code"] for item in data["items"]) != PUBLISHED_ITEMS:
        raise SnapshotError("data artifact: voci pubblicate inattese")
    if data["memoItems"] != MEMO_ITEMS:
        raise SnapshotError("data artifact: voci «di cui» inattese")
    years = range(data["period"]["from"], data["period"]["to"] + 1)
    expected_cells = len(PUBLISHED_ITEMS) * len(years)
    if data["coverage"]["expectedCells"] != expected_cells or data["coverage"]["observedCells"] != expected_cells:
        raise SnapshotError("data artifact: copertura incompleta")
    if len(data["observations"]) != expected_cells:
        raise SnapshotError("data artifact: osservazioni e copertura non coincidono")

    seen = set()
    for observation in data["observations"]:
        key = (observation["year"], observation["naItem"])
        if key in seen:
            raise SnapshotError(f"data artifact: osservazione duplicata {key}")
        seen.add(key)
        if observation["naItem"] not in PUBLISHED_ITEMS or observation["year"] not in years:
            raise SnapshotError(f"data artifact: cella fuori perimetro {key}")
        for field in ("amountCents", "shareOfGdpHundredths"):
            value = observation[field]
            if not isinstance(value, int) or isinstance(value, bool):
                raise SnapshotError(f"data artifact: {field} non intero in {key}")
            if value < 0 and observation["naItem"] not in SIGNED_ITEMS:
                raise SnapshotError(f"data artifact: {field} negativo in {key} su una voce che il SEC non ammette negativa")
        if "flag" in observation and observation["flag"] not in data["flags"]:
            raise SnapshotError(f"data artifact: flag sconosciuto in {key}")
    if sum(1 for observation in data["observations"] if "flag" in observation) != data["coverage"]["flagged"]:
        raise SnapshotError("data artifact: conteggio flag divergente")
    recomputed = _reconcile(data["observations"])
    for identity in ("revenue", "expenditure", "balance"):
        if recomputed[identity] != data["reconciliation"].get(identity):
            raise SnapshotError(f"data artifact: riconciliazione {identity} dichiarata diversa dai dati")


def check_public_debt_invariant(data: dict[str, Any], public_debt_path: Path) -> list[int]:
    """D41PAY and TE must match public-debt.json to the cent on every shared year."""
    try:
        history = json.loads(public_debt_path.read_text(encoding="utf-8"))["annualInterest"]["history"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise SnapshotError(f"public-debt.json illeggibile per l'invariante: {error}") from error
    by_cell = {(o["year"], o["naItem"]): o for o in data["observations"]}
    shared: list[int] = []
    for point in history:
        year = point["year"]
        if (year, "TE") not in by_cell:
            continue
        shared.append(year)
        if by_cell[(year, "D41PAY")]["amountCents"] != point["interestExpenseCents"]:
            raise SnapshotError(f"{year}: D41PAY diverso da public-debt.json, stessa voce con due valori")
        if by_cell[(year, "TE")]["amountCents"] != point["totalGovernmentExpenditureCents"]:
            raise SnapshotError(f"{year}: TE diverso da public-debt.json, stessa voce con due valori")
    if not shared:
        raise SnapshotError("nessun anno in comune con public-debt.json: invariante non verificabile")
    return shared


def build_metadata(spec: dict[str, Any], data_bytes: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        # Top level on purpose: docs/SOURCE_SNAPSHOT_INVENTORY.md reads it from here.
        "observedAt": spec["coverage"]["observedAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "datasetCode": source["datasetCode"],
            "datasetLabel": source["datasetLabel"],
            "structure": dict(source["structure"]),
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "termsUrl": source["termsUrl"],
            "acquisition": dict(source["acquisition"]),
            "assets": {name: dict(asset) for name, asset in source["assets"].items()},
        },
        "coverage": dict(spec["coverage"]),
        "reconciliation": dict(data["reconciliation"]),
        "semantics": {
            "soldi": {
                "unit": "centesimi di euro",
                "nature": (
                    "entrate e uscite delle Amministrazioni pubbliche (S13) di competenza economica "
                    "SEC 2010 — non sono incassi, pagamenti di cassa, stanziamenti o impegni"
                ),
                "note": (
                    "Accanto all'importo, la quota di PIL in centesimi di punto. I totali sono quelli "
                    "della fonte e riconciliano con le componenti entro il solo arrotondamento."
                ),
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": "Anno dalla dimensione time del dataset, mai dedotto dall'URL. I conti vengono rivisti.",
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]] + sorted(asset["url"] for asset in source["assets"].values()),
                "publicationDate": spec["expected"]["sourceUpdated"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
                "hashes": "SHA-256 per asset in source.assets; artefatto in integrity.dataArtifact",
            },
        },
        "publicDebtInvariant": {
            "items": ["D41PAY", "TE"],
            "artifact": "src/data/generated/public-debt.json",
            "rule": "uguali al centesimo su ogni anno in comune: stessa voce Eurostat, non una seconda fonte",
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {
                "path": spec["integrity"]["dataArtifact"]["path"],
                "bytes": len(data_bytes),
                "sha256": sha256_bytes(data_bytes),
            },
            "sourceLockSha256": canonical_lock_sha256(spec),
        },
    }


def _check(spec_path: Path, data_path: Path, meta_path: Path, public_debt_path: Path) -> list[int]:
    spec = load_source_spec(spec_path)
    if spec["integrity"]["lockSha256"] != canonical_lock_sha256(spec):
        raise SnapshotError("lockSha256 non corrisponde al contenuto del lock")
    data_bytes = data_path.read_bytes()
    data = json.loads(data_bytes.decode("utf-8"))
    validate_snapshot(data)
    if data["period"] != spec["period"]:
        raise SnapshotError("data artifact: periodo divergente dal lock")
    if data["coverage"]["expectedCells"] != spec["expected"]["cellsPerUnit"]:
        raise SnapshotError("data artifact: celle attese divergenti dal lock")
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    artifact = metadata["integrity"]["dataArtifact"]
    if artifact["sha256"] != sha256_bytes(data_bytes) or artifact["bytes"] != len(data_bytes):
        raise SnapshotError("meta: hash o dimensione del data artifact divergenti")
    if metadata["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente dal lock")
    return check_public_debt_invariant(data, public_debt_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--public-debt", type=Path, default=DEFAULT_PUBLIC_DEBT)
    parser.add_argument("--input-dir", type=Path, help="cartella con le due risposte JSON-stat")
    parser.add_argument("--check", action="store_true", help="valida gli artefatti committati senza rete")
    parser.add_argument("--write", action="store_true", help="scrive artefatti e integrity nel lock")
    args = parser.parse_args()

    try:
        if args.check:
            shared = _check(args.spec, args.data, args.meta, args.public_debt)
            print(
                f"eurostat-gov-main: lock, data e meta coerenti; D41PAY e TE uguali a public-debt "
                f"su {shared[0]}-{shared[-1]}"
            )
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con le due risposte JSON-stat, oppure --check")
        spec = load_source_spec(args.spec)
        inputs = {}
        for name, asset in spec["source"]["assets"].items():
            path = args.input_dir / f"gov_10a_main-{asset['unit']}.json"
            if not path.is_file():
                raise SnapshotError(f"input mancante: {path}")
            payload = path.read_bytes()
            if sha256_bytes(payload) != asset["sha256"] or len(payload) != asset["bytes"]:
                raise SnapshotError(f"input {path.name}: byte diversi da quelli vincolati nel lock")
            inputs[name] = payload
        data = build_data(inputs, spec)
        validate_snapshot(data)
        shared = check_public_debt_invariant(data, args.public_debt)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(
                f"eurostat-gov-main: build ok ({len(data['observations'])} osservazioni, {len(data_bytes)} byte; "
                f"invariante public-debt su {shared[0]}-{shared[-1]}) — usa --write per salvare"
            )
            return 0
        # newline="\n": on Windows write_text would translate to CRLF, and the
        # artifacts would no longer be byte-identical to those built on Linux.
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8", newline="\n")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        metadata = build_metadata(spec, data_bytes, data)
        args.meta.write_text(
            json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n"
        )
        print(f"eurostat-gov-main: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"eurostat-gov-main: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
