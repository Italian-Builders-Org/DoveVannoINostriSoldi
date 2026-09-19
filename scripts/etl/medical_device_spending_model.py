"""Release-bound ETL model; no runtime snapshot or public corpus is written.

Identifiers use identity normalization: no trimming, numeric casts or padding.
Source cells remain available after the shared corpus privacy projection.
Consumers must exhaust/validate the inputs and reconcile before publication.
"""
from __future__ import annotations

from datetime import date, datetime
from collections.abc import Iterable, Mapping

import integrated_curated_datasets as corpus
import medical_device_spending_profile as source


SPENDING_FIELDS = {
    "anno": "Anno", "codice_regione": "CodRegCommit",
    "codice_azienda_sanitaria": "CodASL", "denominazione_azienda_sanitaria": "AziendaSanitaria",
    "tipo_dispositivo": "CodTipoDM", "numero_repertorio": "NumRep",
    "codice_classificazione_fonte": "CodiceCND", "spesa_originale": "CostoAcq",
}
PUBLISHABLE_RELEASES = {
    2018: ("open-data-spesa-2018", "historical-candidate"),
    2019: ("open-data-spesa-2019", "historical-candidate"),
    2020: ("open-data-spesa-2020", "pilot-candidate"),
    2021: ("open-data-spesa-2021", "pilot-candidate"),
}
REGISTRY_DATASET = "salute-dispositivi-bdrdm"
CND_DATASET = "salute-classificazione-cnd"
# Both fiscal fields are protected, including occurrences copied into free text.
# Do not reinterpret PARTITAIVA_VATNUMBER_MAND as the manufacturer's VAT number:
# this acquired header differs from p_iva_fabbr_ass in the published dictionary.
REGISTRY_PRIVATE_FIELDS = {"cod_fiscale", "PARTITAIVA_VATNUMBER_MAND"}
REGISTRY_PUBLIC_HEADERS = source.REGISTRY_HEADERS[:-1]


def snapshot_metadata(item: dict, dataset_id: str) -> dict:
    source._require_official_urls(item, ("landingUrl", "downloadUrl"), dataset_id)
    fingerprint = item.get("archive", item)["sha256"]
    if not source.SHA256_RE.fullmatch(fingerprint):
        raise source.SourceError("Hash snapshot non valido")
    for field in ("referenceDate", "acquisitionDate"):
        source._require_iso_date(item[field], field)
    return {
        "dataset_id": dataset_id, "snapshot_id": f"{dataset_id}:{fingerprint}",
        "reference_date": item["referenceDate"], "acquisition_date": item["acquisitionDate"],
        "publication_date": None, "extraction_date": None,
        "source_urls": [item["landingUrl"], item["downloadUrl"]],
        "license_status": item["licenseStatus"],
    }


def public_source_row(raw: dict, headers: list[str], dataset_id: str, ordinal: int,
                      private_fields: set[str] | None = None) -> dict:
    if set(raw) != set(headers):
        raise source.SourceError("Header del record sorgente divergenti")
    source._require_row_shape(raw, headers, dataset_id, ordinal, allow_missing_empty_header=True)
    if type(ordinal) is not int or ordinal < 1:
        raise source.SourceError("Ordinale sorgente non valido")
    private_fields = private_fields or set()
    private_values = corpus.repeated_private_identifiers(raw, private_fields)
    cells, redactions = {}, []
    for field in headers:
        if raw[field] is None:
            cells[field] = None
            continue
        value, reasons = corpus.sanitize_public_cell(
            field, raw[field], private_fields, private_values if field not in private_fields else set(),
        )
        cells[field] = value
        redactions.extend({"field": field, "reason": reason} for reason in reasons)
    digest = corpus.sha256_bytes(corpus.canonical_json(cells))
    # Same public commitment as build_dataset, never a hash of private values.
    row_id = "row-" + corpus.sha256_bytes(f"{dataset_id}:{ordinal}:{digest}".encode())[:24]
    return {"id": row_id, "sourceRow": ordinal, "sourceRowSha256": digest,
            "cells": cells, "redactions": redactions}


def source_date(raw: str, *, conventional_end: bool = False) -> dict:
    if not raw:
        return {"original": raw, "normalized": None, "status": "missing"}
    normalized = raw.replace("/", "-")
    try:
        if len(normalized) == 10:
            normalized = date.fromisoformat(normalized).isoformat()
        elif len(normalized) == 19 and normalized[10] in {" ", "T"}:
            normalized = datetime.fromisoformat(normalized).isoformat()
        else:
            raise ValueError()
    except ValueError as error:
        raise source.SourceError("Data sorgente non valida") from error
    if conventional_end and normalized[:10] == "9999-12-31":
        return {"original": raw, "normalized": None, "status": "conventional-open-end"}
    return {"original": raw, "normalized": normalized, "status": "observed"}


def registry_records(rows: Iterable[dict], metadata: dict):
    seen = set()
    for ordinal, raw in enumerate(rows, 1):
        # The locked dump has 16 cells per row, but a trailing delimiter in its
        # header declares a nonexistent 17th field. Do not drop an observed cell.
        if set(raw) != set(source.REGISTRY_HEADERS) or raw[""] is not None:
            raise source.SourceError("Colonna BD/RDM senza intestazione non assente")
        raw = {field: raw[field] for field in REGISTRY_PUBLIC_HEADERS}
        row = public_source_row(raw, REGISTRY_PUBLIC_HEADERS, metadata["dataset_id"], ordinal,
                                REGISTRY_PRIVATE_FIELDS)
        cells = row["cells"]
        key = (cells["tipologia_dm"], cells["progressivo_dm_ass"])
        if key[0] not in {"1", "2"} or not source.DEVICE_NUMBER_RE.fullmatch(key[1] or ""):
            raise source.SourceError("Chiave BD/RDM non valida")
        if key in seen:
            raise source.SourceError("Chiave BD/RDM duplicata: join ambiguo, pubblicazione bloccata")
        seen.add(key)
        if cells["iscrizione_repertorio"] not in {"S", "N", ""}:
            raise source.SourceError("Flag repertorio non valido")
        yield {
            "key": key, "source_dataset_id": metadata["dataset_id"],
            "source_record_id": row["id"], "anagrafica_snapshot_id": metadata["snapshot_id"],
            "tipo_dispositivo": key[0], "numero_repertorio": key[1],
            "denominazione_commerciale": cells["denominazione_commerciale"],
            "codice_catalogo": cells["cod_catalogo_fabbr_ass"],
            "fabbricante_assemblatore": cells["fabbricante_assemblatore"],
            "ruolo": "fabbricante" if key[0] == "1" else "assemblatore",
            "codice_classificazione_anagrafica": cells["classificazione_cnd"],
            "sistema_classificazione": "CND", "versione_classificazione": None,
            "iscrizione_repertorio": cells["iscrizione_repertorio"],
            "dates": {field: source_date(raw[field], conventional_end=field == "data_fine_validita")
                      for field in ("data_prima_pubblicazione", "data_inizio_validita",
                                    "data_fine_validita", "data_fine_commercio")},
            "source": row,
        }


def classification_records(rows: Iterable[dict], metadata: dict):
    seen = set()
    for ordinal, raw in enumerate(rows, 1):
        row = public_source_row(raw, source.CND_HEADERS, metadata["dataset_id"], ordinal)
        cells = row["cells"]
        start = source_date(raw["data_inzio_validita"])
        end = source_date(raw["data_fine_validita"], conventional_end=True)
        # The source has revisions with the same code/start but different ends.
        # Preserve their complete intervals; never select a historical version here.
        key = (cells["codice_ramo_cnd"], start["normalized"], end["original"])
        if not all(key[:2]) or cells["livello_finale"] not in {"S", "N"}:
            raise source.SourceError("Chiave o livello CND non valido")
        if key in seen:
            raise source.SourceError("Versione CND duplicata")
        seen.add(key)
        yield {"key": key, "sistema_classificazione": "CND",
               "classificazione_snapshot_id": metadata["snapshot_id"],
               "codice": key[0], "descrizione": cells["descrizione_ramo_cnd"],
               "valid_from": start, "valid_to": end, "source": row}


def spending_fact(raw: dict, ordinal: int, release: dict, metadata: dict,
                  registry: Mapping[tuple[str, str], str]) -> dict:
    """Join against unique registry key → public record ID; never names or bare IDs.

    registry must be built by exhausting registry_records before calling this.
    Null money is rejected by the observed pilot contract, not converted to zero.
    """
    year = int(release["referencePeriod"])
    expected_release = PUBLISHABLE_RELEASES.get(year)
    if (expected_release != (release["releaseId"], release["publicationDisposition"])
            or release["licenseStatus"] != "IODL-2.0"):
        raise source.SourceError("Release fuori dal perimetro pubblicabile selezionato")
    dataset_id = f"salute-spesa-dispositivi-{year}"
    row = public_source_row(raw, source.spending_headers(year), dataset_id, ordinal)
    cells = row["cells"]
    if cells["Anno"] != str(year):
        raise source.SourceError("Periodo del fatto divergente")
    amount = source.parse_source_euros(cells["CostoAcq"])
    key = (cells["CodTipoDM"], cells["NumRep"])
    if not all(key):
        status = "missing_key"
    elif key[0] not in {"1", "2"} or not source.DEVICE_NUMBER_RE.fullmatch(key[1]):
        status = "invalid_key"
    else:
        status = "matched" if key in registry else "not_found"
    return {
        **{alias: cells[header] for alias, header in SPENDING_FIELDS.items()},
        "source_dataset_id": dataset_id, "source_release_id": release["releaseId"],
        "source_record_id": row["id"], "source": row,
        "denominazione_regione": cells.get("RegioneCommit"),
        "azienda_key": (cells["Anno"], cells["CodRegCommit"], cells["CodASL"]),
        "spesa_normalizzata": format(amount, "f"), "unita": "EUR",
        "natura": "spesa rilevata per acquisto di dispositivi medici",
        "sistema_classificazione": "CND", "versione_classificazione": None,
        "join_status": status, "anagrafica_snapshot_id": metadata["snapshot_id"],
        "anagrafica_record_id": registry[key] if status == "matched" else None,
        "publication_date": release["publicationDate"],
        "acquisition_date": release["acquisitionDate"], "checked_at": release["checkedAt"],
        "extraction_date": None, "anagrafica_date": metadata["reference_date"],
        "source_urls": [release["landingUrl"], release["downloadUrl"]],
    }
