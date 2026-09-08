#!/usr/bin/env python3
"""Build and validate the OpenCivitas 2021 FC70TOT municipal snapshot.

Distinct from the production 2022 FC80TOT snapshot. Do not sum the two years.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from zipfile import ZipFile

from opencivitas_common import (
    SELECTED_INDICATORS, MUNICIPALITY_COLUMNS, StructuralError,
    read_outer_file, xlsx_rows, row_dicts, load_entities,
    normalize_municipality, load_raw_data, snapshot_text,
)

REFERENCE_YEAR = 2021
FAMILY = "FC70TOT"
PUBLISHED_AT = "2024-05-30"
LANDING_URL = "https://www.opencivitas.it/it/open-data"
DATASET_URL = "https://www.opencivitas.it/it/dataset/2021-comuni-servizi-totali-indicatori-e-determinanti"
DATA_URL = "https://docs.opencivitas.it/2021_Ind_FC70TOT_1_csv.zip"
ENTITIES_URL = "https://docs.opencivitas.it/Metadati_Enti_2021_xlsx.zip"
INDICATORS_URL = "https://docs.opencivitas.it/2021_Metadati_Ind_FC70TOT_1_xlsx.zip"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
OUTPUT = Path("src/data/generated/opencivitas-2021.json")
CERTIFICATE = Path(__file__).with_name("certs") / "sectigo-public-server-authentication-ca-ov-r36.pem"
OFFICIAL_HOSTS = {"docs.opencivitas.it", "www.opencivitas.it", "opencivitas.it"}
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504}
MAX_RETRIES = 2
# Exact coverage of the hash-pinned FC70 release, distinct from FC80 (6557).
MIN_MUNICIPALITIES = 6_565
MAX_MUNICIPALITIES = 6_565
LOCKED_SHA256 = {
    "data": "0d7732aade6e584281416ba80564d42823da2a9a4b62f62d1184c2e86ba74c60",
    "entities": "ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b",
    "indicators": "43c8a22d52a54d0417665f774f36d1c5d467b637f7897ed74c3aea56434aec72",
}




def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def official_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS:
        raise StructuralError(f"URL OpenCivitas non ufficiale: {value}")


def tls_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=str(CERTIFICATE))
    return context


def download_text(url: str, timeout: int) -> str:
    official_url(url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
    )
    with urllib.request.urlopen(request, timeout=timeout, context=tls_context()) as response:
        official_url(response.geturl())
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise StructuralError(f"{url}: pagina HTML attesa, ricevuto {content_type or 'nessun Content-Type'}")
        return response.read().decode("utf-8")


def discover_latest_total_services_year(timeout: int) -> int:
    html = download_text(LANDING_URL, timeout)
    years = {
        int(year)
        for year in re.findall(
            r'href=["\'](?:https://www\.opencivitas\.it)?/it/dataset/(\d{4})-comuni-servizi-totali-indicatori-e-determinanti["\']',
            html,
        )
    }
    if not years:
        raise StructuralError("OpenCivitas: nessuna annualità dei servizi totali trovata")
    return max(years)


def download_zip(url: str, timeout: int) -> bytes:
    official_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/zip"})
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=tls_context()) as response:
                official_url(response.geturl())
                payload = response.read()
            if not payload.startswith(b"PK"):
                raise StructuralError(f"{url}: archivio ZIP atteso")
            with ZipFile(io.BytesIO(payload)) as archive:
                if archive.testzip() is not None:
                    raise StructuralError(f"{url}: archivio ZIP danneggiato")
            return payload
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, socket.timeout) as error:
            status = error.code if isinstance(error, urllib.error.HTTPError) else None
            if (status is not None and status not in TRANSIENT_HTTP) or attempt >= MAX_RETRIES:
                raise
            wait_seconds = 2**attempt
            print(f"::warning::Download OpenCivitas fallito ({error}); nuovo tentativo tra {wait_seconds}s", file=sys.stderr)
            time.sleep(wait_seconds)
    raise AssertionError("ciclo retry terminato senza risultato")


def verify_indicators(payload: bytes) -> None:
    xlsx = read_outer_file(payload, ".xlsx")
    definitions: dict[str, str] = {}
    preferred = f"Indicatori_{FAMILY}_{REFERENCE_YEAR}"
    for row in row_dicts(xlsx_rows(xlsx, preferred)):
        if "VAR_IND_COD" not in row or "VAR_IND_DES" not in row:
            raise StructuralError("Metadati indicatori: colonne VAR_IND_COD/VAR_IND_DES mancanti")
        definitions[row["VAR_IND_COD"]] = row["VAR_IND_DES"]
    missing = [code for code in SELECTED_INDICATORS if definitions.get(code) != SELECTED_INDICATORS[code]]
    if missing:
        found = {code: definitions.get(code) for code in missing}
        raise StructuralError(
            f"Schema FC70 diverso da FC80 sui metadati {missing}. "
            f"Trovato={found}. Segnalare in PR prima di unire i tipi."
        )


def normalize(data_payload: bytes, entities_payload: bytes, indicators_payload: bytes, generated_at: str) -> dict:
    entities = load_entities(entities_payload)
    verify_indicators(indicators_payload)
    raw = load_raw_data(data_payload)
    municipalities = []
    for username, entity in entities.items():
        rows = raw.get(username)
        if rows is None:
            continue
        municipalities.append(normalize_municipality(username, entity, rows))

    municipalities.sort(key=lambda item: item["istatCode"])
    if not (MIN_MUNICIPALITIES <= len(municipalities) <= MAX_MUNICIPALITIES):
        raise StructuralError(
            f"Copertura comunale fuori fascia attesa ({MIN_MUNICIPALITIES}-{MAX_MUNICIPALITIES}): {len(municipalities)}"
        )
    if len({item["istatCode"] for item in municipalities}) != len(municipalities):
        raise StructuralError("Codici ISTAT comunali duplicati")
    regions = sorted({item["region"] for item in municipalities})
    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "scope": "ordinary-statute-municipalities-total-services-fc70-2021",
        "referenceYear": REFERENCE_YEAR,
        "publishedAt": PUBLISHED_AT,
        "generatedAt": generated_at,
        "coverage": {
            "municipalities": len(municipalities),
            "regions": len(regions),
            "regionNames": regions,
            "territorialScope": "Comuni delle Regioni a statuto ordinario",
        },
        "municipalityColumns": list(MUNICIPALITY_COLUMNS),
        "municipalityRows": [
            [municipality[column] for column in MUNICIPALITY_COLUMNS]
            for municipality in municipalities
        ],
        "source": {
            "owner": "OpenCivitas · Sogei",
            "dataset": "Comuni · Servizi totali · Indicatori e determinanti 2021 (FC70TOT)",
            "landingUrl": LANDING_URL,
            "datasetUrl": DATASET_URL,
            "dataUrl": DATA_URL,
            "entitiesUrl": ENTITIES_URL,
            "indicatorsUrl": INDICATORS_URL,
            "license": "CC BY 4.0",
            "licenseUrl": LICENSE_URL,
            "observedAt": generated_at,
            "declaredCadence": "Irregolare",
            "platformCheckCadence": "Snapshot 2021 FC70TOT pinnato per hash; non sostituisce il 2022 FC80TOT",
            "family": FAMILY,
            "sha256": dict(LOCKED_SHA256),
        },
        "methodology": {
            "differenceMeaning": "Differenza tra spesa storica e spesa standard. Non è una misura di spreco.",
            "serviceMeaning": "Il confronto sui servizi usa la media dei Comuni della stessa fascia di popolazione.",
            "coverageWarning": "La fonte non copre i Comuni delle Regioni a statuto speciale e delle Province autonome.",
            "rankingWarning": "Per confrontare Comuni di dimensioni diverse usare anche il valore per abitante e il livello dei servizi.",
            "yearSeparationWarning": "FC70TOT 2021 e FC80TOT 2022 non sono sommabili né confrontabili in silenzio.",
        },
    }


def validate_snapshot(snapshot: object) -> None:
    if not isinstance(snapshot, dict):
        raise StructuralError("Snapshot: oggetto atteso")
    if snapshot.get("schemaVersion") != 1 or snapshot.get("transformVersion") != 1:
        raise StructuralError("Snapshot: versione non supportata")
    if snapshot.get("scope") != "ordinary-statute-municipalities-total-services-fc70-2021":
        raise StructuralError("Snapshot: perimetro inatteso")
    if snapshot.get("referenceYear") != REFERENCE_YEAR or snapshot.get("publishedAt") != PUBLISHED_AT:
        raise StructuralError("Snapshot: anno o data di pubblicazione inattesi")
    generated_at = snapshot.get("generatedAt")
    if not isinstance(generated_at, str):
        raise StructuralError("Snapshot: generatedAt mancante")
    datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    source = snapshot.get("source")
    if not isinstance(source, dict) or source.get("observedAt") != generated_at:
        raise StructuralError("Snapshot: provenienza temporale non valida")
    for key, expected in (("landingUrl", LANDING_URL), ("datasetUrl", DATASET_URL), ("dataUrl", DATA_URL), ("entitiesUrl", ENTITIES_URL), ("indicatorsUrl", INDICATORS_URL)):
        if source.get(key) != expected:
            raise StructuralError(f"Snapshot: URL ufficiale inatteso per {key}")
    columns = snapshot.get("municipalityColumns")
    if columns != list(MUNICIPALITY_COLUMNS):
        raise StructuralError("Snapshot: colonne comunali inattese")
    rows = snapshot.get("municipalityRows")
    if not isinstance(rows, list) or not (MIN_MUNICIPALITIES <= len(rows) <= MAX_MUNICIPALITIES):
        raise StructuralError("Snapshot: elenco Comuni fuori fascia")
    codes = []
    for index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != len(MUNICIPALITY_COLUMNS):
            raise StructuralError(f"municipalityRows[{index}]: riga non valida")
        item = zip_pairs(MUNICIPALITY_COLUMNS, row)
        code = item.get("istatCode")
        if not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
            raise StructuralError(f"municipalityRows[{index}]: codice ISTAT non valido")
        codes.append(code)
        integer_fields = ("historicalSpendingCents", "standardSpendingCents", "differenceCents", "historicalPerCapitaCents", "standardPerCapitaCents", "differencePerCapitaCents", "differenceBasisPoints")
        if any(isinstance(item.get(field), bool) or not isinstance(item.get(field), int) for field in integer_fields):
            raise StructuralError(f"municipalityRows[{index}]: valori interi attesi")
        if item["differenceCents"] != item["historicalSpendingCents"] - item["standardSpendingCents"]:
            raise StructuralError(f"municipalityRows[{index}]: differenza totale non riconciliata")
        if item["differencePerCapitaCents"] != item["historicalPerCapitaCents"] - item["standardPerCapitaCents"]:
            raise StructuralError(f"municipalityRows[{index}]: differenza pro capite non riconciliata")
        for field in ("spendingLevel", "serviceLevel"):
            value = item.get(field)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 10):
                raise StructuralError(f"municipalityRows[{index}].{field}: valore non valido")
    if codes != sorted(codes) or len(codes) != len(set(codes)):
        raise StructuralError("Snapshot: codici ISTAT non ordinati o duplicati")
    coverage = snapshot.get("coverage")
    if not isinstance(coverage, dict) or coverage.get("municipalities") != len(rows):
        raise StructuralError("Snapshot: copertura non riconciliata")

    # The immutable historical release is pinned independently of acquisition time.
    payload = json.dumps(semantic_view(snapshot), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if hashlib.sha256(payload).hexdigest() != "bab851fd276d3568269f641cd62a85065a0be7366ae11538973917586f2c8234":
        raise StructuralError("Snapshot: SHA-256 semantico diverso dal rilascio verificato")


def semantic_view(snapshot: dict) -> dict:
    copied = json.loads(json.dumps(snapshot))
    copied.pop("generatedAt", None)
    copied.get("source", {}).pop("observedAt", None)
    return copied


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise StructuralError(f"{path}: oggetto JSON atteso")
    return value


def write_if_changed(snapshot: dict, output: Path) -> bool:
    if output.exists():
        current = load_json(output)
        validate_snapshot(current)
        if semantic_view(current) == semantic_view(snapshot):
            print("Nessuna variazione nei dati OpenCivitas.")
            return False
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(snapshot_text(snapshot), encoding="utf-8")
    return True


def zip_pairs(columns, row):
    if len(row) != len(columns):
        raise StructuralError(f"Riga con {len(row)} campi, attesi {len(columns)}")
    return dict(zip(columns, row))


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def file_or_download(path: Path | None, url: str, timeout: int, lock_key: str) -> bytes:
    payload = path.read_bytes() if path else download_zip(url, timeout)
    if not payload.startswith(b"PK"):
        raise StructuralError(f"{path or url}: ZIP atteso")
    digest = sha256_hex(payload)
    expected = LOCKED_SHA256[lock_key]
    if digest != expected:
        raise StructuralError(
            f"SHA-256 {lock_key} non coincide col lock: atteso {expected}, calcolato {digest}"
        )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot senza rete")
    parser.add_argument("--data-zip", type=Path)
    parser.add_argument("--entities-zip", type=Path)
    parser.add_argument("--indicators-zip", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    if args.check:
        validate_snapshot(load_json(args.output))
        print(f"Snapshot OpenCivitas valido: {args.output}")
        return 0
    provided = [args.data_zip, args.entities_zip, args.indicators_zip]
    if not all(provided):
        parser.error("prima fetta 2021: specificare --data-zip, --entities-zip e --indicators-zip (niente download automatico del 2022)")
    snapshot = normalize(
        file_or_download(args.data_zip, DATA_URL, args.timeout, "data"),
        file_or_download(args.entities_zip, ENTITIES_URL, args.timeout, "entities"),
        file_or_download(args.indicators_zip, INDICATORS_URL, args.timeout, "indicators"),
        utc_now(),
    )
    validate_snapshot(snapshot)
    changed = write_if_changed(snapshot, args.output)
    rome_index = snapshot["municipalityColumns"].index("istatCode")
    rome_row = next(row for row in snapshot["municipalityRows"] if row[rome_index] == "058091")
    rome = zip_pairs(snapshot["municipalityColumns"], rome_row)
    print(json.dumps({"changed": changed, "municipalities": snapshot["coverage"]["municipalities"], "regions": snapshot["coverage"]["regions"], "romeDifferenceCents": rome["differenceCents"], "romeDifferencePerCapitaCents": rome["differencePerCapitaCents"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
