#!/usr/bin/env python3
"""Build the source-locked OECD Taxing Wages snapshot for /cuneo-fiscale.

Inputs are four local SDMX-CSV responses from the OECD public REST API for
`DSD_TAX_WAGES_COMP@DF_TW_COMP` (Taxing Wages comparative indicators, CC BY 4.0
via the Taxing Wages 2025 publication). Runtime and CI stay offline: URLs, byte
lengths and SHA-256 hashes are pinned in the source lock.

Rates are stored as millionths of a percentage point so no float reaches the
artifact. The tax wedge (share of labour cost) and the IRPEF/SSC components
(share of gross wage) keep distinct units; the ETL checks that

    (ITR + EE + ER) / (100 + ER) * 100 ≈ AV_TW

within the declared rounding tolerance, instead of inventing a blended rate.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/oecd-taxing-wages-2000-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/oecd-taxing-wages-2000-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/oecd-taxing-wages-2000-2025.meta.json"
DATASET_ID = "oecd-taxing-wages"
OFFICIAL_API_PREFIX = "https://sdmx.oecd.org/"
OFFICIAL_OECD_PREFIX = "https://www.oecd.org/"
OFFICIAL_DOI_PREFIX = "https://doi.org/"
OFFICIAL_CC_PREFIX = "https://creativecommons.org/"
OFFICIAL_EXPLORER_PREFIX = "https://data-explorer.oecd.org/"

CAVEATS = (
    "Il cuneo fiscale OECD Taxing Wages è un indicatore su profili tipo (reddito e composizione familiare dichiarati), non la busta paga di una persona reale.",
    "AV_TW è espresso in percentuale del costo del lavoro (lordo + contributi del datore). Le componenti IRPEF e contributi sono in percentuale del lordo: non sommarle al cuneo come se avessero lo stesso denominatore.",
    "Non è IRPEF dichiarata MEF, non è gettito riscosso e non è un pagamento SIOPE o uno stanziamento di bilancio.",
    "Il confronto con Francia, Germania, Spagna e media OECD vale solo a parità di profilo (single senza figli, 100% del salario medio OECD).",
    "La serie AW67 (low wage) è conservata solo come controllo rispetto a Eurostat earn_nt_taxwedge: non sostituisce il profilo principale AW100.",
    "Differenze tra paesi o anni non dimostrano da sole efficienza, spreco o merito di una riforma.",
)


class SnapshotError(ValueError):
    """Raised when an input, source lock, or generated snapshot diverges."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    clone = json.loads(json.dumps(lock))
    clone["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(clone))


def require_official_url(url: str, *prefixes: str, field: str) -> None:
    if not any(url.startswith(prefix) for prefix in prefixes):
        raise SnapshotError(f"source lock: {field} non ufficiale ({url!r})")


def load_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "CC-BY-4.0":
        raise SnapshotError("source lock: licenza OECD inattesa")
    if source.get("agencyId") != "OECD.CTP.TPS":
        raise SnapshotError("source lock: agency inattesa")
    if source.get("dataflowId") != "DSD_TAX_WAGES_COMP@DF_TW_COMP":
        raise SnapshotError("source lock: dataflow inatteso")
    if source.get("dataflowVersion") != "2.1":
        raise SnapshotError("source lock: versione dataflow inattesa")
    require_official_url(str(source.get("landingUrl", "")), OFFICIAL_OECD_PREFIX, field="landingUrl")
    require_official_url(str(source.get("dataExplorerUrl", "")), OFFICIAL_EXPLORER_PREFIX, field="dataExplorerUrl")
    require_official_url(str(source.get("apiHost", "")), OFFICIAL_API_PREFIX, field="apiHost")
    require_official_url(str(source.get("termsUrl", "")), OFFICIAL_CC_PREFIX, field="termsUrl")
    publication = source.get("publication") or {}
    require_official_url(str(publication.get("doi", "")), OFFICIAL_DOI_PREFIX, field="publication.doi")
    assets = source.get("assets")
    expected_assets = {"italy-wedge-aw100", "italy-components-aw100", "peers-wedge-aw100", "italy-wedge-aw67"}
    if not isinstance(assets, dict) or set(assets) != expected_assets:
        raise SnapshotError("source lock: set asset inatteso")
    for name, asset in assets.items():
        require_official_url(str(asset.get("url", "")), OFFICIAL_API_PREFIX, field=f"assets.{name}.url")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
        digest = str(asset.get("sha256", ""))
        if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        if asset.get("format") != "sdmx-csv-with-labels":
            raise SnapshotError(f"source lock: formato inatteso per {name}")
    expected = spec.get("expected") or {}
    if expected.get("rateScale") != 1_000_000:
        raise SnapshotError("source lock: rateScale inatteso")
    if canonical_lock_sha256(spec) != spec.get("integrity", {}).get("lockSha256"):
        raise SnapshotError("source lock: lockSha256 divergente")
    return spec


def scaled_rate(value: object, scale: int, where: str) -> int:
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"{where}: valore non numerico {value!r}") from error
    scaled = decimal * scale
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"{where}: precisione {value!r} oltre quella pubblicabile")
    return int(scaled)


def read_rows(payload: bytes, name: str, spec: dict[str, Any]) -> list[dict[str, str]]:
    asset = spec["source"]["assets"][name]
    if len(payload) != asset["bytes"]:
        raise SnapshotError(f"{name}: byte length {len(payload)} != lock {asset['bytes']}")
    digest = sha256_bytes(payload)
    if digest != asset["sha256"]:
        raise SnapshotError(f"{name}: sha256 divergente dal lock")
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"{name}: encoding non UTF-8") from error
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise SnapshotError(f"{name}: CSV senza header")
    required = {
        "REF_AREA",
        "MEASURE",
        "UNIT_MEASURE",
        "HOUSEHOLD_TYPE",
        "INCOME_PRINCIPAL",
        "INCOME_SPOUSE",
        "FREQ",
        "TIME_PERIOD",
        "OBS_VALUE",
    }
    if not required.issubset(set(reader.fieldnames)):
        raise SnapshotError(f"{name}: colonne mancanti {sorted(required - set(reader.fieldnames))}")
    rows = list(reader)
    if not rows:
        raise SnapshotError(f"{name}: nessuna riga")
    return rows


def require_profile(row: dict[str, str], profile: dict[str, str], where: str) -> None:
    for field, expected in (
        ("HOUSEHOLD_TYPE", profile["householdType"]),
        ("INCOME_PRINCIPAL", profile["incomePrincipal"]),
        ("INCOME_SPOUSE", profile["incomeSpouse"]),
        ("FREQ", profile.get("frequency", "A")),
    ):
        if row.get(field) != expected:
            raise SnapshotError(f"{where}: {field}={row.get(field)!r}, atteso {expected!r}")


def collect_series(
    rows: list[dict[str, str]],
    *,
    name: str,
    areas: set[str],
    measures: set[str],
    unit: str,
    profile: dict[str, str],
    years: list[int],
    scale: int,
) -> dict[tuple[str, str, int], int]:
    observed: dict[tuple[str, str, int], int] = {}
    for index, row in enumerate(rows):
        where = f"{name}[{index}]"
        require_profile(row, profile, where)
        area = row["REF_AREA"]
        measure = row["MEASURE"]
        if area not in areas:
            raise SnapshotError(f"{where}: area inattesa {area!r}")
        if measure not in measures:
            raise SnapshotError(f"{where}: misura inattesa {measure!r}")
        if row["UNIT_MEASURE"] != unit:
            raise SnapshotError(f"{where}: unità {row['UNIT_MEASURE']!r}, attesa {unit!r}")
        try:
            year = int(row["TIME_PERIOD"])
        except ValueError as error:
            raise SnapshotError(f"{where}: anno non intero") from error
        if year not in years:
            raise SnapshotError(f"{where}: anno {year} fuori dal lock")
        key = (area, measure, year)
        if key in observed:
            raise SnapshotError(f"{where}: duplicato {key}")
        observed[key] = scaled_rate(row["OBS_VALUE"], scale, where)
    expected_keys = {(area, measure, year) for area in areas for measure in measures for year in years}
    missing = sorted(expected_keys - set(observed))
    extra = sorted(set(observed) - expected_keys)
    if missing or extra:
        raise SnapshotError(f"{name}: copertura divergente missing={missing[:5]} extra={extra[:5]}")
    return observed


def reconcile_italy(
    wedge: dict[tuple[str, str, int], int],
    components: dict[tuple[str, str, int], int],
    years: list[int],
    tolerance: int,
) -> dict[str, Any]:
    gaps: dict[str, int] = {}
    scale = Decimal(1_000_000)
    for year in years:
        tw = Decimal(wedge[("ITA", "AV_TW", year)]) / scale
        itr = Decimal(components[("ITA", "AV_ITR", year)]) / scale
        ee = Decimal(components[("ITA", "AV_R_EMPEE_SSC", year)]) / scale
        er = Decimal(components[("ITA", "AV_R_EMPER_SSC", year)]) / scale
        recon = (itr + ee + er) / (Decimal(100) + er) * Decimal(100)
        gap = int(((tw - recon) * scale).to_integral_value(rounding=ROUND_HALF_EVEN))
        if abs(gap) > tolerance:
            raise SnapshotError(f"riconciliazione Italia {year}: gap {gap} oltre tolleranza {tolerance}")
        gaps[str(year)] = gap
    return {
        "toleranceMillionths": tolerance,
        "gapByYearMillionths": gaps,
        "note": (
            "Per ogni anno italiano AW100, (AV_ITR + AV_R_EMPEE_SSC + AV_R_EMPER_SSC) / "
            "(100 + AV_R_EMPER_SSC) * 100 riconcilia AV_TW entro la sola tolleranza di arrotondamento. "
            "Le componenti restano sul lordo; il cuneo resta sul costo del lavoro."
        ),
    }


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    expected = spec["expected"]
    scale = expected["rateScale"]
    profile = expected["profile"]
    low = expected["lowWageProfile"] | {"frequency": "A"}
    italy_years = list(expected["yearsItaly"])
    peer_years = list(expected["yearsPeers"])
    peers = set(expected["geographies"]["peers"])

    italy_wedge_rows = read_rows(inputs["italy-wedge-aw100"], "italy-wedge-aw100", spec)
    italy_component_rows = read_rows(inputs["italy-components-aw100"], "italy-components-aw100", spec)
    peer_rows = read_rows(inputs["peers-wedge-aw100"], "peers-wedge-aw100", spec)
    low_rows = read_rows(inputs["italy-wedge-aw67"], "italy-wedge-aw67", spec)

    italy_wedge = collect_series(
        italy_wedge_rows,
        name="italy-wedge-aw100",
        areas={"ITA"},
        measures=set(expected["measures"]["italyWedge"]),
        unit=expected["measures"]["wedgeUnit"],
        profile=profile,
        years=italy_years,
        scale=scale,
    )
    italy_components = collect_series(
        italy_component_rows,
        name="italy-components-aw100",
        areas={"ITA"},
        measures=set(expected["measures"]["italyComponents"]),
        unit=expected["measures"]["componentUnit"],
        profile=profile,
        years=italy_years,
        scale=scale,
    )
    peer_wedge = collect_series(
        peer_rows,
        name="peers-wedge-aw100",
        areas=peers,
        measures=set(expected["measures"]["peersWedge"]),
        unit=expected["measures"]["wedgeUnit"],
        profile=profile,
        years=peer_years,
        scale=scale,
    )
    low_wedge = collect_series(
        low_rows,
        name="italy-wedge-aw67",
        areas={"ITA"},
        measures=set(expected["measures"]["lowWageWedge"]),
        unit=expected["measures"]["wedgeUnit"],
        profile=low,
        years=italy_years,
        scale=scale,
    )

    # Peer extract must match the Italy wedge extract on overlapping years.
    for year in peer_years:
        if peer_wedge[("ITA", "AV_TW", year)] != italy_wedge[("ITA", "AV_TW", year)]:
            raise SnapshotError(f"peer ITA {year} diverge dal wedge Italia")

    reconciliation = reconcile_italy(
        italy_wedge,
        italy_components,
        italy_years,
        expected["reconciliationToleranceMillionths"],
    )

    geography_labels = {
        "ITA": {"code": "ITA", "label": "Italia", "kind": "country"},
        "FRA": {"code": "FRA", "label": "Francia", "kind": "country"},
        "DEU": {"code": "DEU", "label": "Germania", "kind": "country"},
        "ESP": {"code": "ESP", "label": "Spagna", "kind": "country"},
        "OECD_REP": {"code": "OECD_REP", "label": "Media OECD", "kind": "aggregate"},
    }
    measure_labels = {
        "AV_TW": {"code": "AV_TW", "label": "Average tax wedge", "unit": "PT_COS_LB"},
        "AV_ITR": {"code": "AV_ITR", "label": "Average income tax rate", "unit": "PT_WG_EARN_G"},
        "AV_R_EMPEE_SSC": {
            "code": "AV_R_EMPEE_SSC",
            "label": "Average rate of employees' social security contributions",
            "unit": "PT_WG_EARN_G",
        },
        "AV_R_EMPER_SSC": {
            "code": "AV_R_EMPER_SSC",
            "label": "Average rate of employer's social security contributions",
            "unit": "PT_WG_EARN_G",
        },
        "AV_RITEESSC": {
            "code": "AV_RITEESSC",
            "label": "Average rate of income tax and employees' social security contributions",
            "unit": "PT_WG_EARN_G",
        },
        "NPATR": {"code": "NPATR", "label": "Net personal average tax rate", "unit": "PT_WG_EARN_G"},
    }

    italy_observations = [
        {
            "year": year,
            "taxWedgeMillionths": italy_wedge[("ITA", "AV_TW", year)],
            "incomeTaxMillionths": italy_components[("ITA", "AV_ITR", year)],
            "employeeSscMillionths": italy_components[("ITA", "AV_R_EMPEE_SSC", year)],
            "employerSscMillionths": italy_components[("ITA", "AV_R_EMPER_SSC", year)],
            "incomeTaxAndEmployeeSscMillionths": italy_components[("ITA", "AV_RITEESSC", year)],
            "netPersonalAverageTaxMillionths": italy_components[("ITA", "NPATR", year)],
            "lowWageTaxWedgeMillionths": low_wedge[("ITA", "AV_TW", year)],
        }
        for year in italy_years
    ]
    peer_observations = [
        {
            "geo": area,
            "year": year,
            "taxWedgeMillionths": peer_wedge[(area, "AV_TW", year)],
        }
        for area in expected["geographies"]["peers"]
        for year in peer_years
    ]

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": italy_years[0], "to": italy_years[-1], "peersFrom": peer_years[0], "peersTo": peer_years[-1]},
        "caveats": list(CAVEATS),
        "units": {
            "taxWedgeMillionths": "milionesimi di punto percentuale del costo del lavoro (PT_COS_LB)",
            "componentMillionths": "milionesimi di punto percentuale del lordo (PT_WG_EARN_G)",
        },
        "profile": {
            "householdType": profile["householdType"],
            "householdLabel": profile["householdLabel"],
            "incomePrincipal": profile["incomePrincipal"],
            "incomeSpouse": profile["incomeSpouse"],
            "frequency": profile["frequency"],
        },
        "lowWageProfile": {
            "householdType": low["householdType"],
            "incomePrincipal": low["incomePrincipal"],
            "incomeSpouse": low["incomeSpouse"],
        },
        "geographies": [geography_labels[code] for code in expected["geographies"]["peers"]],
        "measures": [measure_labels[code] for code in (
            "AV_TW",
            "AV_ITR",
            "AV_R_EMPEE_SSC",
            "AV_R_EMPER_SSC",
            "AV_RITEESSC",
            "NPATR",
        )],
        "italyObservations": italy_observations,
        "peerObservations": peer_observations,
        "coverage": {
            "expectedCells": len(italy_observations) * 7 + len(peer_observations),
            "observedCells": len(italy_observations) * 7 + len(peer_observations),
            "italyYears": len(italy_years),
            "peerYears": len(peer_years),
            "peerGeographies": len(peers),
        },
        "reconciliation": reconciliation,
    }


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != DATASET_ID:
        raise SnapshotError("data: identità inattesa")
    expected = spec["expected"]
    italy_years = list(expected["yearsItaly"])
    peer_years = list(expected["yearsPeers"])
    if data["period"] != {
        "from": italy_years[0],
        "to": italy_years[-1],
        "peersFrom": peer_years[0],
        "peersTo": peer_years[-1],
    }:
        raise SnapshotError("data: periodo divergente")
    if len(data.get("caveats") or []) < 5:
        raise SnapshotError("data: caveats insufficienti")
    italy = data.get("italyObservations") or []
    if [row["year"] for row in italy] != italy_years:
        raise SnapshotError("data: anni Italia divergenti")
    peers = data.get("peerObservations") or []
    expected_peer_keys = [
        (area, year)
        for area in expected["geographies"]["peers"]
        for year in peer_years
    ]
    if [(row["geo"], row["year"]) for row in peers] != expected_peer_keys:
        raise SnapshotError("data: osservazioni peer divergenti")
    for year in italy_years:
        row = next(item for item in italy if item["year"] == year)
        for field in (
            "taxWedgeMillionths",
            "incomeTaxMillionths",
            "employeeSscMillionths",
            "employerSscMillionths",
            "incomeTaxAndEmployeeSscMillionths",
            "netPersonalAverageTaxMillionths",
            "lowWageTaxWedgeMillionths",
        ):
            if not isinstance(row[field], int):
                raise SnapshotError(f"data: {year}.{field} non intero")
    # Re-run the economic identity on the published integers.
    scale = Decimal(1_000_000)
    tolerance = expected["reconciliationToleranceMillionths"]
    for row in italy:
        tw = Decimal(row["taxWedgeMillionths"]) / scale
        itr = Decimal(row["incomeTaxMillionths"]) / scale
        ee = Decimal(row["employeeSscMillionths"]) / scale
        er = Decimal(row["employerSscMillionths"]) / scale
        recon = (itr + ee + er) / (Decimal(100) + er) * Decimal(100)
        gap = int(((tw - recon) * scale).to_integral_value(rounding=ROUND_HALF_EVEN))
        if abs(gap) > tolerance:
            raise SnapshotError(f"data: riconciliazione {row['year']} fallita ({gap})")
        if data["reconciliation"]["gapByYearMillionths"][str(row["year"])] != gap:
            raise SnapshotError(f"data: gap dichiarato diverge per {row['year']}")


def build_metadata(data: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    assets = {
        name: {
            "filename": asset["filename"],
            "url": asset["url"],
            "bytes": asset["bytes"],
            "sha256": asset["sha256"],
            "format": asset["format"],
            "note": asset["note"],
        }
        for name, asset in source["assets"].items()
    }
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": data["period"],
        "referencePeriod": f"{data['period']['from']}-{data['period']['to']} (Italia AW100/AW67); "
        f"{data['period']['peersFrom']}-{data['period']['peersTo']} (confronto peer AW100)",
        "observedAt": source["acquisition"]["checkedAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "dataExplorerUrl": source["dataExplorerUrl"],
            "apiHost": source["apiHost"],
            "agencyId": source["agencyId"],
            "dataflowId": source["dataflowId"],
            "dataflowVersion": source["dataflowVersion"],
            "datasetLabel": source["datasetLabel"],
            "publication": source["publication"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "termsUrl": source["termsUrl"],
            "oecdTermsUrl": source["oecdTermsUrl"],
            "acquisition": source["acquisition"],
            "assets": assets,
        },
        "semantics": {
            "soldi": {
                "applicable": False,
                "unit": "non applicabile",
                "nature": "aliquote effettive medie su profilo tipo OECD Taxing Wages",
                "note": "Nessun importo di spesa pubblica: sono percentuali su costo del lavoro o lordo di un lavoratore tipo.",
            },
            "periodo": {
                "referencePeriod": f"{data['period']['from']}/{data['period']['to']}",
                "note": "TIME_PERIOD della fonte SDMX; il confronto peer ha una finestra più corta.",
            },
            "provenance": {
                "holder": source["owner"],
                "license": source["licenseId"],
                "publicationDate": None,
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "canonicalUrls": [
                    source["landingUrl"],
                    source["publication"]["doi"],
                    source["dataExplorerUrl"],
                ],
            },
        },
        "coverage": data["coverage"],
        "reconciliation": data["reconciliation"],
        "integrity": {
            "sourceLockSha256": spec["integrity"]["lockSha256"],
            "dataSha256": "",
        },
    }


def finalize_metadata(metadata: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    metadata = json.loads(json.dumps(metadata))
    metadata["integrity"]["dataSha256"] = sha256_bytes(canonical_bytes(data))
    return metadata


def validate_metadata(metadata: dict[str, Any], data: dict[str, Any], spec: dict[str, Any]) -> None:
    if metadata.get("schemaVersion") != 1 or metadata.get("datasetId") != DATASET_ID:
        raise SnapshotError("meta: identità inattesa")
    if metadata["integrity"]["sourceLockSha256"] != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente")
    expected_data_hash = sha256_bytes(canonical_bytes(data))
    if metadata["integrity"]["dataSha256"] != expected_data_hash:
        raise SnapshotError("meta: dataSha256 divergente")
    if metadata["semantics"]["soldi"]["applicable"] is not False:
        raise SnapshotError("meta: soldi devono essere non applicabili")
    if metadata["source"]["licenseId"] != "CC-BY-4.0":
        raise SnapshotError("meta: licenza inattesa")


def load_inputs(input_dir: Path, spec: dict[str, Any]) -> dict[str, bytes]:
    payloads: dict[str, bytes] = {}
    for name, asset in spec["source"]["assets"].items():
        path = input_dir / asset["filename"]
        try:
            payloads[name] = path.read_bytes()
        except OSError as error:
            raise SnapshotError(f"input mancante {path}: {error}") from error
    return payloads


def write_artifacts(data: dict[str, Any], metadata: dict[str, Any], data_path: Path, meta_path: Path) -> None:
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check_committed(spec_path: Path, data_path: Path, meta_path: Path) -> None:
    spec = load_spec(spec_path)
    try:
        data = json.loads(data_path.read_text(encoding="utf-8"))
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"artifact illeggibile: {error}") from error
    validate_data(data, spec)
    validate_metadata(metadata, data, spec)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.check and args.write:
            raise SnapshotError("usare --check oppure --write, non entrambi")
        if args.check:
            check_committed(args.spec, args.data, args.meta)
            print("ok: oecd-taxing-wages snapshot")
            return 0
        if not args.write:
            raise SnapshotError("specificare --write o --check")
        if args.input_dir is None:
            raise SnapshotError("--write richiede --input-dir")
        spec = load_spec(args.spec)
        inputs = load_inputs(args.input_dir, spec)
        data = build_data(inputs, spec)
        validate_data(data, spec)
        metadata = finalize_metadata(build_metadata(data, spec), data)
        validate_metadata(metadata, data, spec)
        write_artifacts(data, metadata, args.data, args.meta)
        print(f"wrote {args.data}")
        print(f"wrote {args.meta}")
        return 0
    except SnapshotError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
