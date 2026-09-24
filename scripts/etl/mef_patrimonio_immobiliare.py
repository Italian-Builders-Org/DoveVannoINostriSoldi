#!/usr/bin/env python3
"""Aggregate the MEF 2023 public real-estate census of Comuni and ERP bodies into corpus rows.

The 42 official ZIP files and the compliance file (Dati_Adempimento) are too
large to version: they stay in a local directory passed with --input-dir and
are verified against the source lock.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import tempfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets
from monetary import AmountError, MoneyPolicy, parse_cents

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/mef-patrimonio-immobiliare.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"

FISCAL_CODE = re.compile(r"\[(\d{11})\]")
SURFACE = re.compile(r"(?:0|[1-9][0-9]*)(?:,[0-9]+)?")
CANONE = MoneyPolicy(
    pattern=re.compile(r"(?:0|[1-9][0-9]*)"),
    decimal_separator=",",
    unit="euros",
    allow_negative=False,
    rounding="reject",
    strip_whitespace=False,
)

# Identity and measures come first so the catalog table is readable without
# scrolling; the entity registry details, repeated on every row, go last.
ENTITY_ID_HEADERS = ["Codice fiscale ente", "Ente"]
ENTITY_DETAIL_HEADERS = [
    "Tipologia ente",
    "Regione ente",
    "Provincia ente",
    "Comune ente",
    "Codice catastale comune ente",
]
TRAILER_HEADERS = ["Anno", "URL fonte"]
BENI_HEADERS = ENTITY_ID_HEADERS + [
    "Titolo",
    "Utilizzo del bene",
    "Dato a terzi",
    "Tipologia bene",
    "Beni",
    "Beni con superficie",
    "Superficie di riferimento (m²)",
    "Regione del bene",
    "Comune del bene",
    "Codice catastale comune del bene",
] + ENTITY_DETAIL_HEADERS + TRAILER_HEADERS
CONTRATTI_HEADERS = ENTITY_ID_HEADERS + [
    "Tipo detenzione",
    "Finalità persona fisica",
    "Tipologia bene",
    "Contratti",
    "Contratti su intera unità",
    "Contratti con canone positivo",
    "Contratti con canone zero",
    "Contratti senza canone",
    "Canone annuo totale (EUR)",
    "Contratti per rapporto canone/superficie",
    "Canone annuo per rapporto (EUR)",
    "Superficie per rapporto (m²)",
] + ENTITY_DETAIL_HEADERS + TRAILER_HEADERS
# One row per Comune or ERP body obliged or listed in the compliance file. Source
# values stay as published: "Si"/"No", and an empty cell is not a "No".
ADEMPIMENTO_HEADERS = ENTITY_ID_HEADERS + [
    "Obbligo di comunicazione",
    "Invio comunicazione 2023",
    "Dichiarazione negativa",
    "Dichiarazione di completezza",
    "Beni in proprietà dichiarati",
    "Beni in detenzione dichiarati",
    "Presente nel censimento pubblicato",
    "Presente nelle detenzioni pubblicate",
] + ENTITY_DETAIL_HEADERS + TRAILER_HEADERS
ADEMPIMENTO_URL_PREFIX = "https://www.de.mef.gov.it/modules/documenti_it/attivo_patrimonio/immobili_2023/"
YES_NO = {"Si", "No"}
COUNT = re.compile(r"0|[1-9][0-9]*")
SOURCE_ENTITY_FIELDS = [
    "Amministrazione Denominazione",
    "Tipologia Amministrazione",
    "Regione (Amministrazione)",
    "Provincia (Amministrazione)",
    "Comune (Amministrazione)",
    "Cod. Comune (Amministrazione)",
]


# The source leaves "Utilizzo del bene" empty mostly when the asset is given to third
# parties; these two flags say so. Only the combinations observed in the 2023 release
# are mapped, anything else fails closed.
THIRD_PARTY = {
    ("Sì", "No"): "Interamente",
    ("Sì", "Sì"): "Interamente",
    ("No", "Sì"): "Parzialmente",
    ("No", "No"): "No",
    ("", ""): "Non indicato",
}


class SourceError(ValueError):
    """The acquired archives or committed projection violate the reviewed contract."""


def expected_corpus_metadata(spec: dict, dataset_key: str = "beni") -> dict:
    source = spec["source"]
    reference_period = (
        "Anno 2023 dichiarato dalla fonte; per gli enti che non hanno comunicato nel 2023 "
        "i dati possono risalire a comunicazioni precedenti; aggregazione DVNS per ente dichiarante"
    )
    if dataset_key == "adempimento":
        reference_period = (
            "Adempimento per l'annualità 2023 (beni al 31/12/2023) dichiarato dalla fonte; "
            "una riga per ente, senza aggregazioni DVNS"
        )
    # The compliance file is linked only from the census landing page and was acquired separately.
    acquired = spec["adempimento"]["acquiredAt"] if dataset_key == "adempimento" else source["acquiredAt"]
    return {
        "holder": source["holder"],
        "referencePeriod": reference_period,
        "publicationDate": source["publicationDate"],
        "acquisitionDate": acquired,
        "checkedAt": spec["adempimento"]["acquiredAt"] if dataset_key == "adempimento" else source["checkedAt"],
        "updateFrequency": source["updateFrequency"],
        "canonicalUrls": source["landingUrls"][:1] if dataset_key == "adempimento" else source["landingUrls"],
    }


def validate_contract(spec: dict, *, require_corpus: bool = True) -> None:
    source = spec.get("source")
    if not isinstance(source, dict):
        raise SourceError("contratto fonte mancante")
    if (
        source.get("holder") != "Ministero dell'Economia e delle Finanze – Dipartimento dell'Economia"
        or source.get("license") != "CC-BY-4.0"
        or source.get("referenceYear") != 2023
        or source.get("referenceDate") != "2023-12-31"
        or not all(url.startswith("https://www.de.mef.gov.it/") for url in source.get("landingUrls", []))
    ):
        raise SourceError("identità, licenza o periodo della fonte divergenti")
    for key in ("publicationDate", "acquiredAt", "checkedAt"):
        if not isinstance(source.get(key), str) or corpus.DATE_RE.fullmatch(source[key]) is None:
            raise SourceError(f"data non valida nel lock: {key}")

    semantics = spec.get("semantics", {})
    if semantics.get("soldi", {}).get("present") is not True or semantics.get("soldi", {}).get("unit") != "euro interi":
        raise SourceError("asse soldi divergente")
    if semantics.get("periodo") != {
        "referencePeriod": "Anno 2023 dichiarato dalla fonte",
        "publicationDate": source["publicationDate"],
        "acquisitionDate": source["acquiredAt"],
        "checkedAt": source["checkedAt"],
    }:
        raise SourceError("asse periodo divergente")
    if semantics.get("provenance") != {
        "holder": source["holder"],
        "canonicalUrls": source["landingUrls"],
        "license": source["license"],
        "licenseUrl": source["landingUrls"][0],
    }:
        raise SourceError("asse provenance divergente")

    files = spec.get("files", [])
    names = [item["file"] for item in files]
    if len(names) != len(set(names)) or len(files) != 42:
        raise SourceError("elenco archivi del lock divergente")
    for item in files:
        if item["kind"] not in {"immobili", "detenzioni"} or item["perimeter"] not in {"comuni", "erp"}:
            raise SourceError(f"archivio non classificato: {item['file']}")
        if not item["url"].startswith("https://www.de.mef.gov.it/modules/documenti_it/attivo_patrimonio/immobili_2023/"):
            raise SourceError(f"URL non ufficiale: {item['file']}")
    adempimento = spec.get("adempimento")
    if (
        not isinstance(adempimento, dict)
        or adempimento.get("url") != ADEMPIMENTO_URL_PREFIX + adempimento.get("file", "")
        or adempimento.get("encoding") != "utf-8"
        or adempimento.get("delimiter") != ";"
    ):
        raise SourceError("lock del file di adempimento divergente")
    if set(spec.get("datasets", {})) != {"beni", "contratti", "adempimento"}:
        raise SourceError("dataset del rilascio divergenti")
    if not require_corpus:
        return

    corpus_spec = json.loads(CORPUS_SPEC.read_text(encoding="utf-8"))
    overrides = corpus_spec.get("sourceMetadata", {}).get("overrides", {})
    for key, dataset_id in spec["datasets"].items():
        if overrides.get(dataset_id) != expected_corpus_metadata(spec, key):
            raise SourceError(f"metadati corpus divergenti dal source lock: {dataset_id}")


def verified_rows(spec: dict, item: dict, input_dir: Path):
    payload = (input_dir / item["file"]).read_bytes()
    if len(payload) != item["bytes"] or corpus.sha256_bytes(payload) != item["sha256"]:
        raise SourceError(f"byte sorgente divergenti dal lock: {item['file']}")
    try:
        archive = ZipFile(io.BytesIO(payload))
    except BadZipFile as error:
        raise SourceError(f"archivio ZIP non valido: {item['file']}") from error
    with archive:
        if archive.namelist() != [item["member"]]:
            raise SourceError(f"membri ZIP divergenti: {item['file']}")
        try:
            text = archive.read(item["member"]).decode(spec["csv"]["encoding"])
        except UnicodeDecodeError as error:
            raise SourceError(f"codifica divergente: {item['file']}") from error
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=spec["csv"]["delimiter"])
    headers = next(reader, None)
    if headers != spec["csv"]["headers"][item["kind"]]:
        raise SourceError(f"header divergenti: {item['file']}")
    count = 0
    for row in reader:
        if not row:
            continue
        if len(row) != len(headers):
            raise SourceError(f"numero di colonne divergente: {item['file']} riga {count + 2}")
        count += 1
        yield dict(zip(headers, row))
    if count != item["rows"]:
        raise SourceError(f"righe divergenti dal lock: {item['file']}")


def entity(row: dict, item: dict, spec: dict, registry: dict) -> tuple[str, ...]:
    match = FISCAL_CODE.fullmatch(row["Amministrazione Codice Fiscale"])
    if match is None:
        raise SourceError(f"codice fiscale ente non valido: {item['file']}")
    if row["Tipologia Amministrazione"] != spec["domains"]["tipologiaEnte"][item["perimeter"]]:
        raise SourceError(f"tipologia ente fuori perimetro: {item['file']}")
    key = (match.group(1), *(row[field] for field in SOURCE_ENTITY_FIELDS))
    # Each entity must be described once and come from one regional archive.
    known = registry.setdefault(match.group(1), (key, item["url"]))
    if known != (key, item["url"]):
        raise SourceError(f"anagrafica ente incoerente tra righe o archivi: {match.group(1)}")
    return key


def surface(raw: str, label: str) -> Decimal | None:
    if raw == "":
        return None
    if SURFACE.fullmatch(raw) is None:
        raise SourceError(f"superficie non valida: {label}")
    return Decimal(raw.replace(",", "."))


def canone_euros(raw: str, label: str) -> int | None:
    if raw == "":
        return None
    try:
        return parse_cents(raw, CANONE) // 100
    except AmountError as error:
        raise SourceError(f"canone non valido: {label}") from error


def decimal_text(value: Decimal) -> str:
    return format(value, "f")


def beni_projection(spec: dict, input_dir: Path, registry: dict) -> bytes:
    domains = spec["domains"]
    groups: dict[tuple, list] = defaultdict(lambda: [0, 0, Decimal(0)])
    urls: dict[str, str] = {}
    seen: set[bytes] = set()
    total = duplicates = 0
    for item in (value for value in spec["files"] if value["kind"] == "immobili"):
        for row in verified_rows(spec, item, input_dir):
            total += 1
            fingerprint = hashlib.blake2b("\x1f".join(row.values()).encode(), digest_size=16).digest()
            duplicates += fingerprint in seen
            seen.add(fingerprint)
            owner = entity(row, item, spec, registry)
            proprieta, detenzione = row["Titolo proprietà"], row["Titolo detenzione"]
            if (proprieta == "") == (detenzione == ""):
                raise SourceError(f"titolo del bene assente o doppio: {row['ID bene']}")
            if proprieta and proprieta not in domains["titoloProprieta"]:
                raise SourceError(f"titolo di proprietà fuori dominio: {proprieta}")
            if detenzione and detenzione not in domains["titoloDetenzione"]:
                raise SourceError(f"titolo di detenzione fuori dominio: {detenzione}")
            utilizzo = row["Utilizzo del bene"]
            if utilizzo not in domains["utilizzo"]:
                raise SourceError(f"utilizzo fuori dominio: {utilizzo}")
            area = surface(row["Superficie di Riferimento (mq)"], row["ID bene"])
            flags = (row["ui data interamente a terzi"], row["ui data parzialmente a terzi"])
            if flags not in THIRD_PARTY:
                raise SourceError(f"combinazione dei flag «dato a terzi» fuori dominio: {flags}")
            location = (row["Regione del bene"], row["Comune del bene"], row["Codice Comune del bene"])
            group = groups[(owner, proprieta or detenzione, utilizzo or "Non indicato", THIRD_PARTY[flags],
                            row["Tipologia Bene Immobile"], location)]
            group[0] += 1
            if area is not None and area > 0:
                group[1] += 1
                group[2] += area
            urls[owner[0]] = item["url"]
    expected = spec["expected"]
    if total != expected["immobiliRows"] or duplicates != expected["immobiliExactDuplicateRows"]:
        raise SourceError("righe totali o righe identiche del censimento divergenti dal lock")
    if sum(value[0] for value in groups.values()) != total:
        raise SourceError("aggregazione beni non riconciliata con le righe sorgente")
    rows = [
        [*owner[:2], titolo, utilizzo, terzi, tipologia, str(count), str(with_area), decimal_text(area),
         *location, *owner[2:], "2023", urls[owner[0]]]
        for (owner, titolo, utilizzo, terzi, tipologia, location), (count, with_area, area) in sorted(groups.items())
    ]
    return delimited_payload(BENI_HEADERS, rows)


def contratti_projection(spec: dict, input_dir: Path, registry: dict) -> bytes:
    domains = spec["domains"]
    groups: dict[tuple, list] = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0, 0, Decimal(0)])
    urls: dict[str, str] = {}
    total = 0
    for item in (value for value in spec["files"] if value["kind"] == "detenzioni"):
        for row in verified_rows(spec, item, input_dir):
            total += 1
            owner = entity(row, item, spec, registry)
            tipo, intera, finalita = row["Tipo detenzione a terzi"], row["Detenzione Intera UI"], row["Finalità PF"]
            if tipo not in domains["tipoDetenzioneTerzi"]:
                raise SourceError(f"tipo detenzione fuori dominio: {tipo}")
            if intera not in domains["detenzioneInteraUi"] or finalita not in domains["finalitaPf"]:
                raise SourceError(f"detenzione intera o finalità fuori dominio: {row['ID variazione']}")
            canone = canone_euros(row["Canone annuale"], row["ID variazione"])
            area = surface(row["Superficie di Riferimento (mq)"], row["ID variazione"])
            group = groups[(owner, tipo, finalita or "Non indicata", row["Tipologia Bene Immobile"])]
            group[0] += 1
            group[1] += intera == "Sì"
            if canone is None:
                group[4] += 1
            else:
                group[2 if canone > 0 else 3] += 1
                group[5] += canone
            # The ratio uses only whole units, where the reference surface is the leased one.
            if intera == "Sì" and canone and area is not None and area > 0:
                group[6] += 1
                group[7] += canone
                group[8] += area
            urls[owner[0]] = item["url"]
    if total != spec["expected"]["detenzioniRows"] or sum(value[0] for value in groups.values()) != total:
        raise SourceError("aggregazione contratti non riconciliata con le righe sorgente")
    rows = [
        [*owner[:2], tipo, finalita, tipologia, *(str(value) for value in metrics[:8]), decimal_text(metrics[8]),
         *owner[2:], "2023", urls[owner[0]]]
        for (owner, tipo, finalita, tipologia), metrics in sorted(groups.items())
    ]
    return delimited_payload(CONTRATTI_HEADERS, rows)


def adempimento_rows(spec: dict, input_dir: Path):
    lock = spec["adempimento"]
    payload = (input_dir / lock["file"]).read_bytes()
    if len(payload) != lock["bytes"] or corpus.sha256_bytes(payload) != lock["sha256"]:
        raise SourceError(f"byte sorgente divergenti dal lock: {lock['file']}")
    try:
        text = payload.decode(lock["encoding"])
    except UnicodeDecodeError as error:
        raise SourceError(f"codifica divergente: {lock['file']}") from error
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=lock["delimiter"])
    if next(reader, None) != lock["headers"]:
        raise SourceError(f"header divergenti: {lock['file']}")
    count = 0
    for row in reader:
        if not row:
            continue
        if len(row) != len(lock["headers"]):
            raise SourceError(f"numero di colonne divergente: {lock['file']} riga {count + 2}")
        count += 1
        yield dict(zip(lock["headers"], row))
    if count != lock["rows"]:
        raise SourceError(f"righe divergenti dal lock: {lock['file']}")


def adempimento_projection(spec: dict, input_dir: Path, beni_registry: dict, contratti_registry: dict) -> bytes:
    """One row per Comune/ERP body, reconciled with the entities of the published census."""
    lock = spec["adempimento"]
    perimeter = {label: key for key, label in spec["domains"]["tipologiaEnte"].items()}
    seen: set[str] = set()
    counts: dict[str, int] = defaultdict(int)
    rows = []
    for row in adempimento_rows(spec, input_dir):
        match = FISCAL_CODE.fullmatch(row["Amministrazione Codice Fiscale"])
        if match is None or match.group(1) in seen:
            raise SourceError(f"codice fiscale ente non valido o duplicato: {row['Amministrazione Codice Fiscale']}")
        fiscal_code = match.group(1)
        seen.add(fiscal_code)
        invio, negativa, completezza, obbligo = (
            row["Invio comunicazione"], row["Dichiarazione negativa"],
            row["Dich. di completezza dei dati"], row["Obbligo di comunicazione"],
        )
        if invio not in YES_NO or obbligo not in YES_NO | {""}:
            raise SourceError(f"invio o obbligo fuori dominio: {fiscal_code}")
        # A declaration exists only when the communication was sent, and then both flags are filled.
        declarations = {negativa, completezza}
        if (invio == "No" and declarations != {""}) or (invio == "Si" and not declarations <= YES_NO):
            raise SourceError(f"dichiarazioni incoerenti con l'invio: {fiscal_code}")
        if obbligo == "" and row["Settore Istituzionale"] != "AMMINISTRAZIONI NON S13":
            raise SourceError(f"obbligo assente per un'amministrazione S13: {fiscal_code}")
        declared = [row["Numero beni in proprieta'"], row["Numero beni in detenzione"]]
        if not all(COUNT.fullmatch(value) for value in declared):
            raise SourceError(f"conteggio beni non valido: {fiscal_code}")
        kind = perimeter.get(row["Tipologia Amministrazione"])
        if kind is None:
            counts["outsidePerimeter"] += 1
            continue
        in_beni = fiscal_code in beni_registry
        in_contratti = fiscal_code in contratti_registry
        # The file names the census files of each body: they must match the published archives exactly.
        if (row["Nome file Beni Immobili Dichiarati"] != "") != in_beni or (
            row["Nome file Detenzioni a favore di terzi"] != ""
        ) != in_contratti or (row["Nome sezione"] != "") != in_beni:
            raise SourceError(f"presenza nel censimento incoerente con l'adempimento: {fiscal_code}")
        if in_beni:
            census = beni_registry[fiscal_code][0]
            # Names of merged Comuni differ only in case or hyphenation: compare every field but that one.
            if [census[1], census[2], census[3], census[4], census[6]] != [
                row["Amministrazione Denominazione"], row["Tipologia Amministrazione"],
                row["Regione (Amministrazione)"], row["Provincia (Amministrazione)"],
                row["Cod. Comune (Amministrazione)"],
            ]:
                raise SourceError(f"anagrafica ente diversa tra censimento e adempimento: {fiscal_code}")
        counts[kind] += 1
        counts["invioNo"] += invio == "No"
        counts["invioNoInCensimento"] += invio == "No" and in_beni
        counts["negativaConBeni"] += negativa == "Si" and declared != ["0", "0"]
        counts["completezzaNo"] += completezza == "No"
        rows.append([
            fiscal_code, row["Amministrazione Denominazione"], obbligo, invio, negativa, completezza,
            *declared, "Si" if in_beni else "No", "Si" if in_contratti else "No",
            row["Tipologia Amministrazione"], row["Regione (Amministrazione)"], row["Provincia (Amministrazione)"],
            row["Comune (Amministrazione)"], row["Cod. Comune (Amministrazione)"], "2023", lock["url"],
        ])
    missing = (set(beni_registry) | set(contratti_registry)) - seen
    if missing:
        raise SourceError(f"enti del censimento assenti dall'adempimento: {sorted(missing)[:3]}")
    if dict(counts) != lock["expected"]:
        raise SourceError(f"conteggi dell'adempimento divergenti dal lock: {dict(counts)}")
    return delimited_payload(ADEMPIMENTO_HEADERS, sorted(rows))


def delimited_payload(headers: list[str], rows: list[list[str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def projections(spec: dict, input_dir: Path, *, require_corpus: bool = True) -> dict[str, bytes]:
    validate_contract(spec, require_corpus=require_corpus)
    beni_registry: dict = {}
    contratti_registry: dict = {}
    return {
        spec["datasets"]["beni"]: beni_projection(spec, input_dir, beni_registry),
        spec["datasets"]["contratti"]: contratti_projection(spec, input_dir, contratti_registry),
        spec["datasets"]["adempimento"]: adempimento_projection(spec, input_dir, beni_registry, contratti_registry),
    }


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset patrimonio MEF assente dalla specifica corpus")
    catalog = json.loads(CATALOG.read_bytes())
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            item = selected[dataset_id]
            (source_root / item["relativePath"]).write_bytes(payload)
            parsed = corpus.parse_dataset(source_root, item)
            entry, expected_rows, expected_receipt, _ = corpus.build_dataset(
                item, parsed, corpus.resolved_source_metadata(corpus_spec, dataset_id)
            )
            actual_rows = b"".join(
                gzip.decompress(path.read_bytes())
                for path in sorted(ROWS_DIR.glob(f"{dataset_id}.part-*.jsonl.gz"))
            )
            actual_receipt = json.loads((RECEIPTS_DIR / f"{dataset_id}.receipt.json").read_bytes())
            actual_entry = next((value for value in catalog["datasets"] if value["id"] == dataset_id), None)
            if expected_rows != actual_rows or expected_receipt != actual_receipt or entry != actual_entry:
                raise SourceError(f"proiezione pubblica divergente dalla fonte MEF: {dataset_id}")


def publish(payloads: dict[str, bytes]) -> None:
    # Datasets already in the corpus are verified by --check, never appended twice.
    published = {value["id"] for value in json.loads(CATALOG.read_bytes())["datasets"]}
    payloads = {dataset_id: body for dataset_id, body in payloads.items() if dataset_id not in published}
    if not payloads:
        raise SourceError("nessun dataset del rilascio da aggiungere al corpus")
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            (source_root / f"{dataset_id}.psv").write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC,
            source_root=source_root,
            dataset_ids=set(payloads),
            catalog_path=CATALOG,
            rows_dir=ROWS_DIR,
            receipts_dir=RECEIPTS_DIR,
            proof_path=DATASET_PROOF,
            release_proof_path=RELEASE_PROOF,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True, help="directory con i 42 ZIP e il file di adempimento del lock")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.output_dir, args.publish, args.check)) != 1:
        parser.error("specificare una sola azione: --output-dir, --publish o --check")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    # --output-dir precedes the corpus registration, so it cannot require the overrides yet.
    payloads = projections(spec, args.input_dir, require_corpus=not args.output_dir)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, body in payloads.items():
            (args.output_dir / f"{dataset_id}.psv").write_bytes(body)
            print(f"{dataset_id}: bytes={len(body)} sha256={corpus.sha256_bytes(body)} rows={body.count(b'\n') - 1}")
    elif args.publish:
        publish(payloads)
    else:
        check_committed(payloads)
    print("PASS: MEF patrimonio immobiliare 2023, archivi e riconciliazioni verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
