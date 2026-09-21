#!/usr/bin/env python3
"""Build/check the locked Eurostat AROPE snapshot (ilc_peps01n), offline.

Europe 2030 definition: people at risk of poverty or social exclusion for Italy,
age TOTAL, sex T. Publishes percentage (PC, tenths) and persons (THS_PER, integers).
Not public spending; not comparable to ISTAT absolute/relative poverty rates.
"""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/eurostat-arope-2015-2025.source.json"
DATA = ROOT / "src/data/generated/eurostat-arope-2015-2025.data.json"
META = ROOT / "src/data/generated/eurostat-arope-2015-2025.meta.json"
FIXTURE = ROOT / "tests/fixtures/eurostat-arope/ilc_peps01n-IT-TOTAL-T-2015-2025.csv"
DATASET = "eurostat-arope"
RATE_SCALE = 10
YEARS = tuple(range(2015, 2026))
CANONICAL_URL = (
    "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/"
    "ilc_peps01n/A.PC+THS_PER.TOTAL.T.IT?format=SDMX-CSV&startPeriod=2015&endPeriod=2025"
)
LANDING_URL = "https://ec.europa.eu/eurostat/databrowser/view/ilc_peps01n/default/table?lang=en"
HEADERS = (
    "DATAFLOW",
    "LAST UPDATE",
    "freq",
    "unit",
    "age",
    "sex",
    "geo",
    "TIME_PERIOD",
    "OBS_VALUE",
    "OBS_FLAG",
    "CONF_STATUS",
)
EXPECTED_LAST_UPDATE = "17/09/26 23:00:00"
EXPECTED_RATES = {
    2015: "28.4",
    2016: "27.8",
    2017: "25.9",
    2018: "25.7",
    2019: "24.6",
    2020: "24.9",
    2021: "25.2",
    2022: "24.4",
    2023: "22.8",
    2024: "23.1",
    2025: "22.6",
}
EXPECTED_PERSONS = {
    2015: "17291",
    2016: "16832",
    2017: "15652",
    2018: "15463",
    2019: "14803",
    2020: "14821",
    2021: "14834",
    2022: "14305",
    2023: "13392",
    2024: "13525",
    2025: "13265",
}


class SnapshotError(ValueError):
    """Source bytes or public AROPE contract differ from the reviewed lock."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def lock_hash(spec: dict) -> str:
    normalized = {**spec, "integrity": {**spec["integrity"], "sourceLockSha256": ""}}
    return sha256_bytes(canonical_bytes(normalized))


def rate_tenths(raw: str) -> int:
    try:
        value = Decimal(raw)
        require(value.is_finite() and value >= 0, "invalid AROPE rate")
        scaled = value * RATE_SCALE
        require(scaled == scaled.to_integral_value(), f"rate has more than one decimal: {raw!r}")
        return int(scaled)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"invalid AROPE rate: {raw!r}") from error


def persons_thousands(raw: str) -> int:
    try:
        value = Decimal(raw)
        require(value.is_finite() and value >= 0, "invalid AROPE headcount")
        require(value == value.to_integral_value(), f"headcount is not an integer thousand: {raw!r}")
        return int(value)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"invalid AROPE headcount: {raw!r}") from error


def parse_csv(payload: bytes) -> dict[int, dict[str, str]]:
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8")))
    require(tuple(reader.fieldnames or ()) == HEADERS, "unexpected SDMX columns/order")
    by_year: dict[int, dict[str, str]] = {}
    for row in reader:
        require(None not in row.values(), "malformed CSV row")
        require(row["DATAFLOW"] == "ESTAT:ILC_PEPS01N(1.0)", "unexpected dataflow id")
        require(row["LAST UPDATE"] == EXPECTED_LAST_UPDATE, "LAST UPDATE diverges from lock")
        require(row["freq"] == "A", "unexpected frequency")
        require(row["age"] == "TOTAL", "unexpected age")
        require(row["sex"] == "T", "unexpected sex")
        require(row["geo"] == "IT", "unexpected geo")
        require(row["OBS_FLAG"] == "", "unexpected observation flag")
        require(row["CONF_STATUS"] == "", "unexpected confidentiality status")
        year = int(row["TIME_PERIOD"])
        require(year in YEARS, f"year outside published period: {year}")
        unit = row["unit"]
        require(unit in {"PC", "THS_PER"}, f"unexpected unit: {unit}")
        bucket = by_year.setdefault(year, {})
        require(unit not in bucket, f"duplicate {unit} for {year}")
        bucket[unit] = row["OBS_VALUE"]
    require(set(by_year) == set(YEARS), "missing or extra years")
    for year, values in by_year.items():
        require(set(values) == {"PC", "THS_PER"}, f"incomplete units for {year}")
        require(values["PC"] == EXPECTED_RATES[year], f"rate drift for {year}")
        require(values["THS_PER"] == EXPECTED_PERSONS[year], f"headcount drift for {year}")
    return by_year


def build_data(by_year: dict[int, dict[str, str]]) -> dict:
    observations = []
    for year in YEARS:
        observations.append(
            {
                "territory": "IT",
                "year": year,
                "rateTenths": rate_tenths(by_year[year]["PC"]),
                "personsThousands": persons_thousands(by_year[year]["THS_PER"]),
                "status": None,
            }
        )
    return {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "domain": {
            "code": "ilc_peps01n",
            "label": "Persons at risk of poverty or social exclusion by age and sex (Europe 2030)",
            "dataflowId": "ilc_peps01n",
        },
        "period": {"from": 2015, "to": 2025},
        "periodNote": (
            "Serie nazionale Italia, definizione Europa 2030 (ilc_peps01n), anni 2015–2025. "
            "Non giuntare con la serie Europa 2020 (ilc_peps01)."
        ),
        "definitionNote": (
            "AROPE = quota di popolazione in almeno una delle tre condizioni: rischio di povertà "
            "(reddito sotto il 60% della mediana), grave deprivazione materiale e sociale, "
            "bassa intensità di lavoro. Le persone contano una sola volta."
        ),
        "indicators": [
            {
                "code": "AROPE",
                "label": "Rischio di povertà o esclusione sociale (Europa 2030)",
                "unit": "PC / THS_PER",
                "coverage": {str(year): 1 for year in YEARS},
            }
        ],
        "territories": [{"code": "IT", "label": "Italia", "kind": "country"}],
        "flags": {
            "attribute": "OBS_FLAG",
            "note": "In questa fetta tutte le osservazioni hanno OBS_FLAG vuoto; un flag futuro deve restare distinto da zero.",
            "knownValues": {},
        },
        "caveats": [
            "AROPE non è spesa pubblica e non si somma né si confronta con SIOPE, OpenBDAP o IRPEF.",
            "AROPE non è la povertà assoluta né la povertà relativa ISTAT (34_727): definizioni, denominatori e periodi restano distinti; non crearne un totale o una differenza.",
            "Questa fetta usa la definizione Europa 2030 (ilc_peps01n). La serie Europa 2020 (ilc_peps01) è un altro dataset e non va giuntata.",
            "PC è una percentuale di popolazione; THS_PER è un conteggio in migliaia di persone. Non sommare percentuali e conteggi.",
            "Solo Italia, età TOTAL, sessi T. Nessun dettaglio regionale in questa fetta.",
            "I componenti (rischio di povertà, deprivazione, bassa intensità) restano fuori: sono tabelle Eurostat separate e non si ricostruiscono qui.",
        ],
        "reconciliation": {
            "observations": 11,
            "years": list(YEARS),
            "units": ["PC", "THS_PER"],
            "note": "11 anni × 2 unità nella fonte CSV = 22 righe; l'artefatto pubblica 11 osservazioni con entrambe le misure.",
        },
        "scale": {
            "rateFactor": RATE_SCALE,
            "rateNote": "Percentuali con al più un decimale, memorizzate in decimi (×10).",
            "personsUnit": "thousands",
            "personsNote": "THS_PER Eurostat: migliaia di persone, interi senza decimali.",
        },
        "observations": observations,
    }


def build_source(payload: bytes, data: dict) -> dict:
    data_bytes = canonical_bytes(data)
    source = {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "domain": data["domain"],
        "period": data["period"],
        "periodNote": data["periodNote"],
        "definitionNote": data["definitionNote"],
        "indicators": data["indicators"],
        "territories": data["territories"],
        "flags": data["flags"],
        "caveats": data["caveats"],
        "reconciliation": data["reconciliation"],
        "observations": 11,
        "scale": data["scale"],
        "headers": list(HEADERS),
        "fixedDimensions": {
            "DATAFLOW": "ESTAT:ILC_PEPS01N(1.0)",
            "freq": "A",
            "age": "TOTAL",
            "sex": "T",
            "geo": "IT",
            "LAST UPDATE": EXPECTED_LAST_UPDATE,
        },
        "units": ["PC", "THS_PER"],
        "expectedRates": EXPECTED_RATES,
        "expectedPersons": EXPECTED_PERSONS,
        "source": {
            "owner": "Eurostat",
            "landingUrl": LANDING_URL,
            "informationUrl": (
                "https://ec.europa.eu/eurostat/statistics-explained/index.php?"
                "title=Glossary:At_risk_of_poverty_or_social_exclusion_(AROPE)"
            ),
            "termsUrl": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
            "apiPath": "/eurostat/api/dissemination/sdmx/2.1/data/ilc_peps01n/",
            "dataflowId": "ilc_peps01n",
            "dataflowLabel": "Persons at risk of poverty or social exclusion by age and sex",
            "licenseId": "CC-BY-4.0",
            "licenseNote": "Eurostat copyright notice: riuso consentito con attribuzione (CC BY 4.0).",
            "seriesNote": (
                "ilc_peps01n è la definizione corrente Europa 2030 (grave deprivazione materiale e "
                "sociale). ilc_peps01 (Europa 2020) resta fuori perimetro. ISTAT pubblica gli stessi "
                "ordini di grandezza nei comunicati EU-SILC; i byte pinnati sono la risposta Eurostat."
            ),
            "acquisitionDate": "2026-09-21",
            "assets": {
                "arope-italy": {
                    "url": CANONICAL_URL,
                    "format": "SDMX-CSV 1.0.0",
                    "bytes": len(payload),
                    "sha256": sha256_bytes(payload),
                    "fixturePath": "tests/fixtures/eurostat-arope/ilc_peps01n-IT-TOTAL-T-2015-2025.csv",
                }
            },
            "reuseTermsEvidence": [
                "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
                LANDING_URL,
            ],
        },
        "semantics": {
            "soldi": {
                "present": False,
                "note": "Percentuali e conteggi di persone: non importi, stanziamenti o pagamenti.",
            },
            "periodo": {
                "reference": "Anno di indagine EU-SILC / riferimento AROPE pubblicato da Eurostat",
                "publication": EXPECTED_LAST_UPDATE,
                "acquisition": "2026-09-21",
                "note": "Il reddito usato nel componente rischio di povertà è tipicamente quello dell'anno precedente l'indagine; restiamo sul TIME_PERIOD pubblicato senza inventare un secondo calendario.",
            },
            "provenance": {
                "holder": "Eurostat (EU-SILC; per l'Italia la raccolta è ISTAT)",
                "channel": "Eurostat SDMX 2.1 dissemination API",
                "note": "Hash del CSV ufficiale; LAST UPDATE fissato nel lock.",
            },
        },
        "integrity": {
            "sourceLockSha256": "",
            "dataArtifact": {
                "path": "src/data/generated/eurostat-arope-2015-2025.data.json",
                "bytes": len(data_bytes),
                "sha256": sha256_bytes(data_bytes),
            },
        },
    }
    source["integrity"]["sourceLockSha256"] = lock_hash(source)
    return source


def build_meta(spec: dict) -> dict:
    return {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "period": spec["period"],
        "acquiredAt": spec["source"]["acquisitionDate"],
        "source": spec["source"],
        "semantics": spec["semantics"],
        "publicMetadata": {
            "period": [
                f"Anni {spec['period']['from']}–{spec['period']['to']}",
                spec["semantics"]["periodo"]["note"],
                f"LAST UPDATE fonte {EXPECTED_LAST_UPDATE}; acquisizione {spec['source']['acquisitionDate']}",
            ],
            "units": [
                f"Tasso AROPE in decimi di punto percentuale (×{RATE_SCALE})",
                "Persone in migliaia (THS_PER Eurostat)",
            ],
            "coverage": spec["periodNote"],
            "references": [
                {"label": "Eurostat · ilc_peps01n", "url": LANDING_URL},
                {
                    "label": "Eurostat · glossario AROPE",
                    "url": spec["source"]["informationUrl"],
                },
                {"label": "Eurostat · copyright", "url": spec["source"]["termsUrl"]},
            ],
        },
        "integrity": spec["integrity"],
    }


def load_spec(path: Path = SPEC) -> dict:
    spec = json.loads(path.read_bytes())
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    require(spec["source"]["licenseId"] == "CC-BY-4.0", "Eurostat license must be CC-BY-4.0")
    require(spec["semantics"]["soldi"]["present"] is False, "AROPE must declare soldi absent")
    require(spec["integrity"]["sourceLockSha256"] == lock_hash(spec), "source lock hash differs")
    asset = spec["source"]["assets"]["arope-italy"]
    require(asset["url"] == CANONICAL_URL, "canonical URL differs")
    require(str(asset["url"]).startswith("https://ec.europa.eu/eurostat/"), "unofficial source URL")
    return spec


def check(spec: dict | None = None) -> None:
    spec = spec or load_spec()
    fixture = ROOT / spec["source"]["assets"]["arope-italy"]["fixturePath"]
    payload = fixture.read_bytes()
    asset = spec["source"]["assets"]["arope-italy"]
    require(len(payload) == asset["bytes"], "fixture byte length differs")
    require(sha256_bytes(payload) == asset["sha256"], "fixture hash differs")
    data = build_data(parse_csv(payload))
    data_bytes = canonical_bytes(data)
    require(len(data_bytes) == spec["integrity"]["dataArtifact"]["bytes"], "data artifact bytes differ")
    require(sha256_bytes(data_bytes) == spec["integrity"]["dataArtifact"]["sha256"], "data artifact hash differs")
    require(DATA.read_bytes() == data_bytes, "committed data artifact differs")
    meta = build_meta(spec)
    require(META.read_bytes() == canonical_bytes(meta), "committed metadata differs")


def write(payload: bytes) -> None:
    by_year = parse_csv(payload)
    data = build_data(by_year)
    spec = build_source(payload, data)
    meta = build_meta(spec)
    SPEC.parent.mkdir(parents=True, exist_ok=True)
    DATA.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_bytes(payload)
    SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DATA.write_bytes(canonical_bytes(data))
    META.write_bytes(canonical_bytes(meta))
    check(spec)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--input", type=Path, help="Official SDMX-CSV payload")
    args = parser.parse_args()
    if args.write:
        require(args.input is not None, "--write requires --input")
        write(args.input.read_bytes())
        print("eurostat-arope: source lock and artifacts written")
        return
    if args.check:
        check()
        print("eurostat-arope: source lock and artifacts coherent")
        return
    raise SystemExit("specify --check or --write")


if __name__ == "__main__":
    main()
