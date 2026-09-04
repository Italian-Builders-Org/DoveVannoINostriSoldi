#!/usr/bin/env python3
"""Build the hash-pinned Eurostat COFOG snapshot (government expenditure by function).

The two input files are the JSON-stat 2.0 responses of the Eurostat dissemination
API for `gov_10a_exp` (CC BY 4.0, verified on the Eurostat copyright notice), one
per published unit: million euro and percentage of GDP.  They are deliberately
passed as local files: runtime and CI never call Eurostat, and a structure or
hash drift fails closed before an existing artifact can be replaced.

Three properties of the source are carried into the artifact instead of being
smoothed away:

* `TOTAL` is NOT the sum of the ten divisions.  Eurostat rounds every cell to one
  decimal independently, so the published total differs from the sum of its parts
  by up to 0.4 million euro (measured on 2014-2024).  The snapshot keeps the
  source's own total and checks the gap against a tolerance derived from that
  rounding; it never recomputes the total from the parts.
* Cells carry Eurostat status flags.  `p` means provisional (the value may be
  revised) and `b` means break in time series (values across it are not
  comparable).  Both travel with the observation, because a trend drawn across a
  break without saying so is a claim the source does not make.
* Coverage is complete and is *required* to be.  Every geography, year and
  function has a value for both units; a future gap must stop the build rather
  than be interpolated.

Money is stored in cents and GDP shares in hundredths of a percentage point, so
no float ever reaches the artifact: the source publishes at most one decimal.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-cofog-2014-2024.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-cofog-2014-2024.data.json"
DEFAULT_META = ROOT / "src/data/generated/eurostat-cofog-2014-2024.meta.json"

DATASET_ID = "eurostat-cofog"
# Trailing slash on purpose: "https://ec.europa.eu/eurostat" without it also
# accepts "https://ec.europa.eu/eurostat.example.org".
OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/"

# Million euro -> cents, and percentage points -> hundredths of a point.  The
# source publishes at most one decimal (verified on every cell of both units),
# so both conversions stay exact on integers.
CENTS_PER_MILLION_EUR = 100_000_000
HUNDREDTHS_PER_POINT = 100

# Twelve independently rounded figures (one total plus eleven divisions) can
# drift by at most 12 * 0.05 = 0.6 in the published unit.  Observed worst case
# over 2014-2024 is 0.4 million euro and 0.3 points, so this bound is the
# rounding itself, not a licence to absorb a real divergence.
TOLERANCE_CENTS = 6 * CENTS_PER_MILLION_EUR // 10
TOLERANCE_SHARE = 6 * HUNDREDTHS_PER_POINT // 10

KNOWN_FLAGS = {"p": "provvisorio", "b": "interruzione della serie storica"}

CAVEATS = (
    "Contabilità nazionale SEC 2010, competenza economica: non sono pagamenti di cassa. "
    "Non confrontabile con SIOPE e non sommabile alle missioni del bilancio dello Stato.",
    "La ripartizione per funzione COFOG non misura efficienza, qualità del servizio né "
    "responsabilità di chi amministra: è una classificazione contabile della spesa.",
    "Il totale è quello pubblicato dalla fonte, non una ricostruzione: differisce dalla "
    "somma delle dieci divisioni fino a 0,4 milioni di euro per solo arrotondamento.",
    "Le celle con flag «b» segnano una interruzione della serie storica: i valori a "
    "cavallo non sono confrontabili fra loro. Quelle con flag «p» sono provvisorie.",
    "Le geografie aggregate (UE27, area euro) non vanno sommate agli Stati membri: "
    "li contengono già.",
    "Il 2025 non è pubblicato: alla data di acquisizione la fonte lo espone per il solo "
    "Lussemburgo, e un singolo Stato membro non è un confronto europeo.",
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
    for field in ("landingUrl", "termsUrl"):
        if not str(spec["source"].get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale Eurostat")
    if not spec["source"]["assets"]:
        raise SnapshotError("source lock: nessun asset dichiarato")
    for name, asset in spec["source"]["assets"].items():
        if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: URL non ufficiale per {name}")
        if len(str(asset.get("sha256", ""))) != 64 or not set(str(asset["sha256"])) <= set("0123456789abcdef"):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
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


def _read_bundle(payload: bytes, unit: str, spec: dict[str, Any]) -> dict[tuple[str, int, str], tuple[int, str | None]]:
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"bundle {unit}: JSON-stat illeggibile: {error}") from error

    if doc.get("class") != "dataset" or doc.get("version") != "2.0":
        raise SnapshotError(f"bundle {unit}: non è un dataset JSON-stat 2.0")
    if doc.get("source") != "ESTAT":
        raise SnapshotError(f"bundle {unit}: provenienza inattesa {doc.get('source')!r}")

    structure = doc.get("extension", {}).get("datastructure", {})
    expected_structure = spec["source"]["structure"]
    for key, value in expected_structure.items():
        if str(structure.get(key)) != str(value):
            raise SnapshotError(f"bundle {unit}: struttura {key}={structure.get(key)!r}, atteso {value!r}")

    if doc.get("updated") != spec["expected"]["sourceUpdated"]:
        raise SnapshotError(f"bundle {unit}: updated {doc.get('updated')!r} diverso dal lock")

    dims = doc["dimension"]
    if dims["unit"]["category"]["index"] != {unit: 0}:
        raise SnapshotError(f"bundle {unit}: unità inattesa nel bundle")
    for name, expected in (("sector", spec["expected"]["sector"]), ("na_item", spec["expected"]["naItem"])):
        if list(dims[name]["category"]["index"]) != [expected]:
            raise SnapshotError(f"bundle {unit}: {name} inatteso, atteso {expected}")

    years = {code: pos for code, pos in dims["time"]["category"]["index"].items()}
    geos = {code: pos for code, pos in dims["geo"]["category"]["index"].items()}
    functions = {code: pos for code, pos in dims["cofog99"]["category"]["index"].items()}

    if sorted(int(y) for y in years) != sorted(spec["expected"]["years"]):
        raise SnapshotError(f"bundle {unit}: anni diversi da quelli del lock")
    if sorted(geos) != sorted(g["code"] for g in spec["expected"]["geographies"]):
        raise SnapshotError(f"bundle {unit}: geografie diverse da quelle del lock")
    if sorted(functions) != sorted(f["code"] for f in spec["expected"]["functions"]):
        raise SnapshotError(f"bundle {unit}: funzioni COFOG diverse da quelle del lock")

    n_geo, n_time = len(geos), len(years)
    values = doc["value"]
    statuses = doc.get("status") or {}
    scale = CENTS_PER_MILLION_EUR if unit == "MIO_EUR" else HUNDREDTHS_PER_POINT

    out: dict[tuple[str, int, str], tuple[int, str | None]] = {}
    missing: list[str] = []
    for function, fi in functions.items():
        for geo, gi in geos.items():
            for year, ti in years.items():
                cell = str((fi * n_geo + gi) * n_time + ti)
                raw = values.get(cell)
                if raw is None:
                    missing.append(f"{geo}/{year}/{function}")
                    continue
                flag = statuses.get(cell)
                if flag is not None and flag not in KNOWN_FLAGS:
                    raise SnapshotError(f"bundle {unit}: flag di stato sconosciuto {flag!r} su {geo}/{year}/{function}")
                out[(geo, int(year), function)] = (
                    _scaled_int(raw, scale, f"{unit} {geo}/{year}/{function}"),
                    flag,
                )

    expected_cells = spec["expected"]["cellsPerUnit"]
    if missing:
        raise SnapshotError(
            f"bundle {unit}: copertura incompleta, {len(missing)} celle assenti "
            f"(prime: {', '.join(missing[:5])}) — il lock pretende {expected_cells} celle piene"
        )
    if len(out) != expected_cells:
        raise SnapshotError(f"bundle {unit}: {len(out)} celle, attese {expected_cells}")
    return out


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    bundles = {
        asset["unit"]: _read_bundle(inputs[name], asset["unit"], spec)
        for name, asset in spec["source"]["assets"].items()
    }
    amounts = bundles["MIO_EUR"]
    shares = bundles["PC_GDP"]
    if set(amounts) != set(shares):
        raise SnapshotError("le due unità coprono celle diverse: il confronto non sarebbe onesto")

    observations = []
    for (geo, year, function) in sorted(amounts):
        amount_cents, amount_flag = amounts[(geo, year, function)]
        share, share_flag = shares[(geo, year, function)]
        if amount_flag != share_flag:
            raise SnapshotError(
                f"flag discordanti fra unità su {geo}/{year}/{function}: {amount_flag!r} vs {share_flag!r}"
            )
        observation = {
            "geo": geo,
            "year": year,
            "function": function,
            "amountCents": amount_cents,
            "shareOfGdpHundredths": share,
        }
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
        "functions": [dict(f) for f in spec["expected"]["functions"]],
        "geographies": [dict(g) for g in spec["expected"]["geographies"]],
        "observations": observations,
        "coverage": {
            "expectedCells": spec["expected"]["cellsPerUnit"],
            "observedCells": len(observations),
            "flagged": sum(1 for o in observations if "flag" in o),
        },
        "reconciliation": _reconcile(observations),
    }


def _reconcile(observations: list[dict[str, Any]]) -> dict[str, Any]:
    """Compare the source's own TOTAL with the sum of its ten divisions.

    The gap is rounding, so it is measured and bounded, never corrected: the
    published total stays the published total.
    """
    by_key: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
    for observation in observations:
        by_key.setdefault((observation["geo"], observation["year"]), {})[observation["function"]] = observation

    worst_amount = 0
    worst_share = 0
    worst_at: str | None = None
    for (geo, year), functions in sorted(by_key.items()):
        if "TOTAL" not in functions:
            raise SnapshotError(f"manca il totale per {geo}/{year}")
        divisions = [functions[f"GF{n:02d}"] for n in range(1, 11) if f"GF{n:02d}" in functions]
        if len(divisions) != 10:
            raise SnapshotError(f"{geo}/{year}: attese dieci divisioni COFOG, trovate {len(divisions)}")
        gap_amount = abs(functions["TOTAL"]["amountCents"] - sum(d["amountCents"] for d in divisions))
        gap_share = abs(
            functions["TOTAL"]["shareOfGdpHundredths"] - sum(d["shareOfGdpHundredths"] for d in divisions)
        )
        if gap_amount > TOLERANCE_CENTS or gap_share > TOLERANCE_SHARE:
            raise SnapshotError(
                f"{geo}/{year}: il totale si scosta dalla somma delle divisioni oltre l'arrotondamento "
                f"({gap_amount} centesimi, {gap_share} centesimi di punto)"
            )
        if gap_amount > worst_amount:
            worst_amount, worst_at = gap_amount, f"{geo}/{year}"
        worst_share = max(worst_share, gap_share)

    return {
        "note": (
            "Il totale pubblicato non è la somma delle divisioni: Eurostat arrotonda ogni cella a un "
            "decimale in modo indipendente. Lo scarto è misurato e limitato, mai corretto."
        ),
        "toleranceCents": TOLERANCE_CENTS,
        "toleranceShareHundredths": TOLERANCE_SHARE,
        "maxGapCents": worst_amount,
        "maxGapShareHundredths": worst_share,
        "maxGapAt": worst_at,
    }


def validate_snapshot(data: dict[str, Any]) -> None:
    for key in ("schemaVersion", "datasetId", "period", "caveats", "functions",
                "geographies", "observations", "coverage", "reconciliation"):
        if key not in data:
            raise SnapshotError(f"data artifact: campo {key} mancante")
    if data["datasetId"] != DATASET_ID or data["schemaVersion"] != 1:
        raise SnapshotError("data artifact: identità inattesa")
    if not data["caveats"]:
        raise SnapshotError("data artifact: caveats assenti — i limiti del dato fanno parte del dato")
    if data["coverage"]["observedCells"] != data["coverage"]["expectedCells"]:
        raise SnapshotError("data artifact: copertura incompleta")
    if len(data["observations"]) != data["coverage"]["expectedCells"]:
        raise SnapshotError("data artifact: osservazioni e copertura non coincidono")

    geos = {g["code"] for g in data["geographies"]}
    functions = {f["code"] for f in data["functions"]}
    years = range(data["period"]["from"], data["period"]["to"] + 1)
    seen = set()
    for observation in data["observations"]:
        key = (observation["geo"], observation["year"], observation["function"])
        if key in seen:
            raise SnapshotError(f"data artifact: osservazione duplicata {key}")
        seen.add(key)
        if observation["geo"] not in geos or observation["function"] not in functions:
            raise SnapshotError(f"data artifact: codice fuori anagrafica in {key}")
        if observation["year"] not in years:
            raise SnapshotError(f"data artifact: anno fuori periodo in {key}")
        # La spesa pubblica per funzione non è negativa in questa fonte, ma il
        # controllo resta sul tipo: un intero, mai un float arrivato di straforo.
        for field in ("amountCents", "shareOfGdpHundredths"):
            if not isinstance(observation[field], int) or isinstance(observation[field], bool):
                raise SnapshotError(f"data artifact: {field} non intero in {key}")
            if observation[field] < 0:
                raise SnapshotError(f"data artifact: {field} negativo in {key}")
        if "flag" in observation and observation["flag"] not in data["flags"]:
            raise SnapshotError(f"data artifact: flag sconosciuto in {key}")
    if len(seen) != data["coverage"]["expectedCells"]:
        raise SnapshotError("data artifact: celle attese non tutte presenti")


def build_metadata(spec: dict[str, Any], data_bytes: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        # Al livello superiore perché l'inventario pubblico degli snapshot la
        # legge da qui: una data che abbiamo dichiarato non deve comparire
        # come «non dichiarato» in docs/SOURCE_SNAPSHOT_INVENTORY.md.
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
        # I TRE ASSI SEMANTICI OBBLIGATORI (docs/DATA_IMPORT_STANDARD.md): soldi, periodo,
        # provenance — espliciti nel metadata dello snapshot, non deducibili dal lettore.
        "semantics": {
            "soldi": {
                "unit": "centesimi di euro",
                "nature": (
                    "spesa delle Amministrazioni pubbliche (S13) di competenza economica SEC 2010 — "
                    "non è stanziamento, non è impegno, non è pagamento di cassa"
                ),
                "note": (
                    "Accanto all'importo, la quota di PIL in centesimi di punto è il denominatore "
                    "comparabile fra Stati. Il totale è quello della fonte e non la somma delle "
                    "divisioni, da cui differisce per solo arrotondamento."
                ),
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "note": (
                    "Anno dalla dimensione time del dataset, mai dedotto dall'URL. Il 2025 è escluso "
                    "perché la fonte lo pubblica per il solo Lussemburgo. Le celle con flag «b» "
                    "segnano una interruzione della serie: a cavallo non sono confrontabili."
                ),
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"]] + sorted(a["url"] for a in source["assets"].values()),
                "publicationDate": spec["expected"]["sourceUpdated"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
                "hashes": "SHA-256 per asset in source.assets; artefatto in integrity.dataArtifact",
            },
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


def _check(spec_path: Path, data_path: Path, meta_path: Path) -> None:
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input-dir", type=Path, help="cartella con le due risposte JSON-stat")
    parser.add_argument("--check", action="store_true", help="valida gli artefatti committati senza rete")
    parser.add_argument("--write", action="store_true", help="scrive artefatti e integrity nel lock")
    args = parser.parse_args()

    try:
        if args.check:
            _check(args.spec, args.data, args.meta)
            print("eurostat-cofog: lock, data e meta coerenti")
            return 0
        if not args.input_dir:
            raise SnapshotError("serve --input-dir con le due risposte JSON-stat, oppure --check")
        spec = load_source_spec(args.spec)
        inputs = {}
        for name, asset in spec["source"]["assets"].items():
            path = args.input_dir / f"gov_10a_exp-{asset['unit']}.json"
            if not path.is_file():
                raise SnapshotError(f"input mancante: {path}")
            payload = path.read_bytes()
            if sha256_bytes(payload) != asset["sha256"] or len(payload) != asset["bytes"]:
                raise SnapshotError(f"input {path.name}: byte diversi da quelli vincolati nel lock")
            inputs[name] = payload
        data = build_data(inputs, spec)
        validate_snapshot(data)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(
                f"eurostat-cofog: build ok ({len(data['observations'])} osservazioni, "
                f"{len(data_bytes)} byte) — usa --write per salvare"
            )
            return 0
        args.data.write_text(data_bytes.decode("utf-8"), encoding="utf-8")
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        metadata = build_metadata(spec, data_bytes, data)
        args.meta.write_text(json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"eurostat-cofog: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except SnapshotError as error:
        print(f"eurostat-cofog: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
