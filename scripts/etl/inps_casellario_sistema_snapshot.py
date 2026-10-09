#!/usr/bin/env python3
"""Build the hash-pinned INPS Casellario (sistema pensionistico) snapshot.

The primary byte source is the official INPS press release PDF for the
31.12.2024 stock. Year-2024 absolute totals are extracted from that PDF.
Year-2023 totals are the prior-year national totals of the same Osservatorio
release, locked in the source spec and reconciled to the YoY percentages
printed in the PDF (fail-closed).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/inps-casellario-sistema.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/inps-casellario-sistema.json"

HEX64 = re.compile(r"^[a-f0-9]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class SnapshotError(ValueError):
    """Raised when the PDF, source lock, or generated snapshot diverges."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    candidate = copy.deepcopy(lock)
    integrity = candidate.get("integrity")
    if not isinstance(integrity, dict) or "lockSha256" not in integrity:
        raise SnapshotError("integrity.lockSha256 mancante nel source lock")
    integrity["lockSha256"] = ""
    artifact = integrity.get("dataArtifact")
    if isinstance(artifact, dict):
        artifact["bytes"] = 0
        artifact["sha256"] = ""
    return sha256_bytes(canonical_bytes(candidate))


def _dict(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} deve essere un oggetto")
    return value


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotError(f"{label} mancante")
    return value.strip()


def _int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise SnapshotError(f"{label} non è un intero non negativo")
    return value


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"{label} illeggibile: {path}") from error
    return _dict(value, label)


def _pdf_text(path: Path) -> str:
    try:
        reader = PdfReader(str(path))
    except Exception as error:  # noqa: BLE001 - surface as SnapshotError
        raise SnapshotError(f"PDF illeggibile: {path}") from error
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _require_italian_int(text: str, value: int, label: str) -> None:
    formatted = f"{value:,}".replace(",", ".")
    if formatted not in text:
        raise SnapshotError(f"{label} assente dal comunicato: atteso {formatted}")


def _require_phrase(text: str, phrase: str, label: str) -> None:
    if phrase not in text:
        raise SnapshotError(f"{label} assente dal comunicato: {phrase!r}")


def _round1(value: float) -> float:
    return round(value + 1e-12, 1)


def _validate_yoy(prior: dict[str, Any], latest: dict[str, Any], expected: dict[str, Any]) -> None:
    percents = _dict(expected.get("yoyPercentsFromComunicato"), "yoyPercentsFromComunicato")
    for key in ("pensionCount", "pensionerCount", "amountMillionEuros"):
        before = _int(prior[key], f"2023.{key}")
        after = _int(latest[key], f"2024.{key}")
        if before <= 0:
            raise SnapshotError(f"base YoY invalida per {key}")
        observed = _round1((after / before - 1.0) * 100.0)
        declared = percents.get(key)
        if not isinstance(declared, (int, float)) or _round1(float(declared)) != observed:
            raise SnapshotError(
                f"YoY {key}: osservato {observed}% vs comunicato {declared}%",
            )


def _assert_published_mean(amount_million: int, count: int, published: int, label: str) -> None:
    if count <= 0:
        raise SnapshotError("conteggio nullo per la media")
    computed = (amount_million * 1_000_000) / count
    if abs(computed - published) > 1.0:
        raise SnapshotError(f"{label}: media pubblicata {published} non riconcilia ({computed:.3f})")


def build_snapshot(spec: dict[str, Any], pdf_path: Path, pdf_payload: bytes) -> dict[str, Any]:
    source = _dict(spec.get("source"), "source")
    assets = _dict(source.get("assets"), "source.assets")
    asset = _dict(assets.get("comunicatoStampa"), "comunicatoStampa")
    expected = _dict(spec.get("expected"), "expected")
    observations = expected.get("observations")
    if not isinstance(observations, list) or len(observations) != 2:
        raise SnapshotError("attese due osservazioni (2023 e 2024)")

    if asset.get("bytes") != len(pdf_payload) or asset.get("sha256") != sha256_bytes(pdf_payload):
        raise SnapshotError("byte/hash del comunicato divergenti dal lock")
    if not Path(str(asset.get("path", ""))).as_posix().endswith(
        "3913_Cs_Osservatorio-Prestazioni-pensionistiche-e-beneficiari-del-sistema-pensionistico-italiano.pdf",
    ):
        raise SnapshotError("path fixture comunicato inatteso")

    text = _pdf_text(pdf_path)
    by_year = {int(row["year"]): row for row in observations}
    latest = _dict(by_year.get(2024), "observation 2024")
    prior = _dict(by_year.get(2023), "observation 2023")

    _require_italian_int(text, int(latest["pensionCount"]), "pensioni 2024")
    _require_italian_int(text, int(latest["pensionerCount"]), "pensionati 2024")
    _require_italian_int(text, int(latest["amountMillionEuros"]), "importo 2024")
    _require_phrase(text, "+0,4%", "delta pensioni")
    _require_phrase(text, "+0,5%", "delta pensionati")
    _require_phrase(text, "+4,9%", "delta importo")
    _require_phrase(text, "31.12.2024", "data stock")
    _require_phrase(text, "Casellario centrale", "perimetro Casellario")
    _validate_yoy(prior, latest, expected)

    nature = _dict(expected.get("natureSharesPercent"), "natureSharesPercent")
    for label, value in (
        ("previdenzialiIvs", "77,2%"),
        ("assistenziali", "20,2%"),
        ("indennitarie", "2,7%"),
    ):
        _require_phrase(text, value, label)
        if float(nature[label]) != float(value.replace("%", "").replace(",", ".")):
            raise SnapshotError(f"quota {label} non allineata al comunicato")

    gender = _dict(expected.get("genderMeanPensionerIncomeEuros"), "genderMeanPensionerIncomeEuros")
    _require_italian_int(text, int(gender["maschi"]), "reddito medio uomini")
    _require_italian_int(text, int(gender["femmine"]), "reddito medio donne")
    if int(expected.get("pensionsPerPensionerTenths")) != 14:
        raise SnapshotError("pensioni pro capite attese 1,4")
    _require_phrase(text, "1,4", "pensioni pro capite")

    built_obs: list[dict[str, Any]] = []
    for year in (2023, 2024):
        row = _dict(by_year[year], f"year {year}")
        amount = _int(row["amountMillionEuros"], f"{year}.amount")
        pensions = _int(row["pensionCount"], f"{year}.pensions")
        pensioners = _int(row["pensionerCount"], f"{year}.pensioners")
        mean_benefit = _int(row["meanBenefitEuros"], f"{year}.meanBenefit")
        mean_income = _int(row["meanPensionerIncomeEuros"], f"{year}.meanIncome")
        _assert_published_mean(amount, pensions, mean_benefit, f"media pensione {year}")
        _assert_published_mean(amount, pensioners, mean_income, f"media pensionato {year}")
        as_of = _text(row.get("asOf"), f"{year}.asOf")
        if not ISO_DATE.fullmatch(as_of):
            raise SnapshotError(f"{year}.asOf non ISO")
        built_obs.append(
            {
                "year": year,
                "asOf": as_of,
                "pensionCount": pensions,
                "pensionerCount": pensioners,
                "amountMillionEuros": amount,
                "meanBenefitEuros": mean_benefit,
                "meanPensionerIncomeEuros": mean_income,
                "pensionsPerPensionerTenths": int(
                    round((pensions / pensioners) * 10),
                ),
                "source": "comunicato-extract" if year == 2024 else "osservatorio-prior-year",
            },
        )

    if built_obs[-1]["pensionsPerPensionerTenths"] != 14:
        raise SnapshotError("pensioni pro capite 2024 non pari a 1,4")

    snapshot = {
        "schemaVersion": 1,
        "generatedAt": "2026-10-09T21:15:00+02:00",
        "scope": "casellario-sistema-pensionistico",
        "asOf": _text(expected.get("asOf"), "expected.asOf"),
        "stock": {
            "measure": "Prestazioni e beneficiari del sistema pensionistico italiano (Casellario centrale)",
            "unitBenefits": "benefits",
            "unitPensioners": "people",
            "amountUnit": "million-euros",
            "amountNote": "Importo complessivo annuo in milioni di euro: 13 mensilità sull'importo di gennaio, 12 per l'indennità di accompagnamento.",
            "pensionCount": built_obs[-1]["pensionCount"],
            "pensionerCount": built_obs[-1]["pensionerCount"],
            "amountMillionEuros": built_obs[-1]["amountMillionEuros"],
            "meanBenefitEuros": built_obs[-1]["meanBenefitEuros"],
            "meanPensionerIncomeEuros": built_obs[-1]["meanPensionerIncomeEuros"],
            "pensionsPerPensionerTenths": built_obs[-1]["pensionsPerPensionerTenths"],
        },
        "series": {
            "measure": "Stock Casellario al 31 dicembre",
            "warning": "La serie 2023-2024 prosegue il Casellario ISTAT 2012-2022 sullo stesso perimetro di sistema, ma è pubblicata dall'INPS. Non sommare i due archivi e non confonderli con lo stock delle sole pensioni erogate dall'INPS.",
            "observations": built_obs,
        },
        "natureShares": {
            "unit": "percent-of-benefits",
            "items": [
                {"id": "previdenziali-ivs", "label": "Previdenziali (IVS)", "sharePercent": float(nature["previdenzialiIvs"])},
                {"id": "assistenziali", "label": "Assistenziali", "sharePercent": float(nature["assistenziali"])},
                {"id": "indennitarie", "label": "Indennitarie", "sharePercent": float(nature["indennitarie"])},
            ],
            "note": "Quote sul numero di prestazioni, come nel comunicato. La somma può scostarsi da 100 per arrotondamento della fonte.",
        },
        "gender": {
            "unit": "mean-annual-pensioner-income-euros",
            "maschiMeanEuros": int(gender["maschi"]),
            "femmineMeanEuros": int(gender["femmine"]),
            "note": "Reddito pensionistico medio annuo per sesso (cumulo delle prestazioni del beneficiario).",
        },
        "methodology": {
            "perimeter": "Casellario centrale dei pensionati: tutte le prestazioni del sistema pensionistico italiano, non solo quelle erogate dall'INPS.",
            "progressioneIstat": "Dopo il Casellario ISTAT 2012-2022, questi anni sono l'aggiornamento ufficiale di sistema pubblicato dall'Osservatorio INPS.",
            "amounts": "Importo complessivo annuo da mensilità di stock (13/12), come dichiarato dalla fonte.",
            "priorYear": "Il totale 2023 è il totale nazionale dello stesso rilascio Osservatorio, riconciliato ai delta percentuali stampati nel comunicato 2024.",
        },
        "sources": [
            {
                "id": "cs-osservatorio-casellario-2024",
                "title": _text(asset.get("title"), "asset.title"),
                "owner": _text(source.get("owner"), "source.owner"),
                "url": _text(asset.get("url"), "asset.url"),
                "landingUrl": _text(source.get("landingUrl"), "landingUrl"),
                "newsUrl": _text(source.get("newsUrl"), "newsUrl"),
                "documentDate": _text(asset.get("documentDate"), "documentDate"),
                "publicationDate": _text(source.get("publicationDate"), "publicationDate"),
                "acquiredAt": _text(source.get("acquiredAt"), "acquiredAt"),
                "checkedAt": _text(source.get("checkedAt"), "checkedAt"),
                "sha256": _text(asset.get("sha256"), "sha256"),
                "bytes": _int(asset.get("bytes"), "bytes"),
                "licenseId": _text(source.get("licenseId"), "licenseId"),
                "rightsNote": _text(source.get("licenseNote"), "licenseNote"),
            },
        ],
        "caveats": [
            "Non coincide con lo stock delle sole pensioni erogate dall'INPS al 1 gennaio.",
            "Non sostituisce il Casellario ISTAT 2012-2022: è la prosecuzione di sistema pubblicata dall'INPS.",
            "Le medie sono quelle della fonte (importo complessivo / conteggio); non è pubblicata una mediana nazionale in questo comunicato.",
        ],
    }
    return snapshot


def write_outputs(spec_path: Path, data_path: Path) -> dict[str, Any]:
    spec = _load_json(spec_path, "source lock")
    asset = _dict(_dict(_dict(spec.get("source"), "source").get("assets"), "assets").get("comunicatoStampa"), "comunicato")
    pdf_path = ROOT / _text(asset.get("path"), "path")
    payload = pdf_path.read_bytes()
    snapshot = build_snapshot(spec, pdf_path, payload)
    encoded = canonical_bytes(snapshot)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile("wb", delete=False, dir=str(data_path.parent))
    try:
        tmp.write(encoded)
        tmp.write(b"\n")
        tmp.flush()
        tmp.close()
        Path(tmp.name).replace(data_path)
    finally:
        try:
            Path(tmp.name).unlink(missing_ok=True)
        except OSError:
            pass

    spec = copy.deepcopy(spec)
    spec["integrity"]["dataArtifact"] = {
        "path": data_path.relative_to(ROOT).as_posix(),
        "bytes": data_path.stat().st_size,
        "sha256": sha256_bytes(data_path.read_bytes()),
    }
    spec["integrity"]["lockSha256"] = ""
    spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
    spec_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return snapshot


def check(spec_path: Path, data_path: Path) -> None:
    spec = _load_json(spec_path, "source lock")
    data = _load_json(data_path, "data artifact")
    asset = _dict(_dict(_dict(spec.get("source"), "source").get("assets"), "assets").get("comunicatoStampa"), "comunicato")
    pdf_path = ROOT / _text(asset.get("path"), "path")
    payload = pdf_path.read_bytes()
    rebuilt = build_snapshot(spec, pdf_path, payload)
    if canonical_bytes(rebuilt) != canonical_bytes(data):
        raise SnapshotError("artifact divergente dalla ricostruzione fail-closed")
    artifact = _dict(_dict(spec.get("integrity"), "integrity").get("dataArtifact"), "dataArtifact")
    raw = data_path.read_bytes()
    if artifact.get("bytes") != len(raw) or artifact.get("sha256") != sha256_bytes(raw):
        raise SnapshotError("integrity.dataArtifact non quadra")
    expected_lock = canonical_lock_sha256(spec)
    if not HEX64.fullmatch(str(spec["integrity"].get("lockSha256", ""))) or spec["integrity"]["lockSha256"] != expected_lock:
        raise SnapshotError("integrity.lockSha256 non valido")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check(args.spec, args.output)
        print("ok")
        return
    write_outputs(args.spec, args.output)
    check(args.spec, args.output)
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
