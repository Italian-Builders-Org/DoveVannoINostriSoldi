#!/usr/bin/env python3
"""Validate and atomically refresh the official Quirinale oath registry."""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
import tempfile
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY = ROOT / "scripts/etl/specs/government-scorecard-chronology.json"
EXPECTED_GOVERNMENTS = (
    ("dini-i", "Dini I", "1995-01-17", "historical"),
    ("prodi-i", "Prodi I", "1996-05-18", "historical"),
    ("dalema-i", "D'Alema I", "1998-10-21", "historical"),
    ("dalema-ii", "D'Alema II", "1999-12-22", "historical"),
    ("amato-ii", "Amato II", "2000-04-26", "historical"),
    ("berlusconi-ii", "Berlusconi II", "2001-06-11", "historical"),
    ("berlusconi-iii", "Berlusconi III", "2005-04-23", "historical"),
    ("prodi-ii", "Prodi II", "2006-05-17", "historical"),
    ("berlusconi-iv", "Berlusconi IV", "2008-05-08", "historical"),
    ("monti-i", "Monti I", "2011-11-16", "historical"),
    ("letta-i", "Letta I", "2013-04-28", "historical"),
    ("renzi-i", "Renzi I", "2014-02-22", "historical"),
    ("gentiloni-i", "Gentiloni I", "2016-12-12", "appointments"),
    ("conte-i", "Conte I", "2018-06-01", "appointments"),
    ("conte-ii", "Conte II", "2019-09-05", "appointments"),
    ("draghi-i", "Draghi I", "2021-02-13", "appointments"),
    ("meloni-i", "Meloni I", "2022-10-22", "meloni"),
)
SOURCE_URLS = {
    "historical": "https://archivio.quirinale.it/comunicati/Quaderno-comunicati-16-marzo.pdf",
    "appointments": "https://www.quirinale.it/it/pagine/nomine-presidente-sergio-mattarella",
    "meloni": "https://www.quirinale.it/it/notizie/cerimonia-giuramento-governo-meloni-3",
}
TOP_LEVEL_FIELDS = {
    "schemaVersion",
    "registryVersion",
    "verifiedAt",
    "asOfDate",
    "eventDefinition",
    "constitutionalSourceUrl",
    "governments",
}
GOVERNMENT_FIELDS = {
    "id",
    "name",
    "startDate",
    "sourceOwner",
    "sourceUrl",
    "sourceLocator",
}


class RegistryValidationError(ValueError):
    """The candidate cannot replace the last valid chronology registry."""


def _iso_date(value: object, field: str) -> str:
    if not isinstance(value, str) or len(value) != 10:
        raise RegistryValidationError(f"{field}: data ISO richiesta")
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except ValueError as error:
        raise RegistryValidationError(f"{field}: data ISO non valida") from error
    return value


def validate_registry(candidate: object) -> dict[str, Any]:
    if not isinstance(candidate, dict) or set(candidate) != TOP_LEVEL_FIELDS:
        raise RegistryValidationError("campi del registro v6 inattesi")
    if candidate.get("schemaVersion") != 1 or candidate.get("registryVersion") != "quirinale-government-oaths-v1":
        raise RegistryValidationError("versione del registro v6 inattesa")
    _iso_date(candidate["verifiedAt"], "verifiedAt")
    _iso_date(candidate["asOfDate"], "asOfDate")
    if candidate["verifiedAt"] < candidate["asOfDate"]:
        raise RegistryValidationError("registro verificato prima della data di riferimento")
    if candidate.get("eventDefinition") != "Giuramento del Presidente del Consiglio e dei ministri nelle mani del Presidente della Repubblica":
        raise RegistryValidationError("evento istituzionale inatteso")
    if candidate.get("constitutionalSourceUrl") != "https://www.senato.it/istituzione/la-costituzione/parte-ii/titolo-iii/sezione-i/articolo-93":
        raise RegistryValidationError("fonte costituzionale inattesa")

    governments = candidate.get("governments")
    if not isinstance(governments, list) or len(governments) < len(EXPECTED_GOVERNMENTS):
        raise RegistryValidationError("il registro deve contenere almeno i 17 governi verificati")
    previous_start: str | None = None
    ids = set()
    for index, government in enumerate(governments):
        if not isinstance(government, dict) or set(government) != GOVERNMENT_FIELDS:
            raise RegistryValidationError(f"governo {index}: campi mancanti o editoriali inattesi")
        start = _iso_date(government.get("startDate"), f"governo {index}.startDate")
        if index < len(EXPECTED_GOVERNMENTS):
            expected_id, expected_name, expected_start, source_key = EXPECTED_GOVERNMENTS[index]
            if (government.get("id"), government.get("name"), start, government.get("sourceUrl")) != (expected_id, expected_name, expected_start, SOURCE_URLS[source_key]):
                raise RegistryValidationError(f"governo {index}: ID, nome, data o fonte divergente")
        else:
            url = urllib.parse.urlparse(government.get("sourceUrl", ""))
            if (url.scheme != "https" or url.netloc != "www.quirinale.it"
                    or not url.path.startswith("/it/notizie/") or len(url.path) <= len("/it/notizie/")
                    or url.query or url.fragment or start > candidate["asOfDate"]):
                raise RegistryValidationError("nuovo giuramento: fonte o data non verificabile")
        if (government.get("sourceOwner") != "Presidenza della Repubblica"
                or not isinstance(government.get("id"), str) or not re.fullmatch(r"[a-z0-9-]+", government["id"])
                or government["id"] in ids or not isinstance(government.get("name"), str) or not government["name"].strip()):
            raise RegistryValidationError("identita governo inattesa o duplicata")
        ids.add(government["id"])
        locator = government.get("sourceLocator")
        if not isinstance(locator, str) or len(locator.strip()) < 30 or start[:4] not in locator:
            raise RegistryValidationError(f"governo {index}: locator Quirinale mancante")
        if previous_start is not None and start <= previous_start:
            raise RegistryValidationError(f"governo {index}: data duplicata o non crescente")
        previous_start = start
    return candidate


def refresh_registry(candidate: object, output: Path) -> None:
    validated = validate_registry(candidate)
    payload = (json.dumps(validated, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=f".{output.name}.", delete=False) as temporary:
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, output)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--output", type=Path, default=DEFAULT_REGISTRY)
    args = parser.parse_args()
    candidate = json.loads(args.input.read_text(encoding="utf-8"))
    refresh_registry(candidate, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
