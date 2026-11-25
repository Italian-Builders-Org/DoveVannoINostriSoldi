#!/usr/bin/env python3
"""Camera institutional economic treatment (indemnity / allowances rates).

Official source: the public page that states the Ufficio di Presidenza rates for
deputies. These are institutional amounts, not individual payslips. Senato rates
are intentionally omitted while programmatic fetches hit a WAF challenge and
cannot be hashed.

The lock is on the visible text of the section, not on the raw bytes: Drupal
appends a cache token to every CSS link (``?tmfoic``) that changes between
cache nodes while the published text stays identical.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import re
import ssl
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/camera-trattamento-economico.source.json"
OUTPUT = ROOT / "src/data/generated/camera-trattamento-economico.json"
DATASET = "camera-trattamento-economico"
USER_AGENT = (
    "DoveVannoINostriSoldi-ETL/1.0 "
    "(+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi; trattamento economico)"
)
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
AMOUNT = r"(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)"
CONTENT_START = "INDENNITA' PARLAMENTARE"
CONTENT_END = re.compile(r"Ultimo aggiornamento: (\d{1,2}) (\w+) (\d{4})")
MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}

# Exact phrases pinned to the official page text (fail-closed on wording drift).
COMPONENTS = (
    {
        "id": "indennita-parlamentare-lordo",
        "label": "Indennità parlamentare (lordo mensile)",
        "pattern": r"importo lordo di (10\.435,00) euro",
        "frequency": "monthly",
        "grossNet": "gross",
    },
    {
        "id": "indennita-parlamentare-netto-prima-addizionali",
        "label": "Indennità parlamentare (netto mensile prima delle addizionali)",
        "pattern": r"indennità parlamentare, corrisposto per 12 mensilità, è pari a (5\.290,71) euro",
        "frequency": "monthly",
        "grossNet": "net-before-local-surtaxes",
    },
    {
        "id": "diaria",
        "label": "Diaria (rimborso forfetario mensile)",
        "pattern": r"fissandone l'ammontare in (3\.503,11) euro",
        "frequency": "monthly",
        "grossNet": "allowance",
    },
    {
        "id": "rimborso-eletti-elettori",
        "label": "Rimborso spese inerenti al rapporto eletto–elettori (mensile)",
        "pattern": r"è stato ridotto nel luglio 2010 a (3\.690) euro",
        "frequency": "monthly",
        "grossNet": "allowance",
    },
    {
        "id": "indennita-parlamentare-lordo-altra-attivita",
        "label": "Indennità parlamentare per chi ha un'altra attività lavorativa (lordo mensile)",
        "pattern": r"l'importo netto dell'indennità ammonta a circa 4\.750 euro, corrispondenti a (9\.975,00) euro lordi",
        "frequency": "monthly",
        "grossNet": "gross",
    },
    {
        "id": "rimborso-spese-accessorie-viaggio-fino-100km",
        "label": "Rimborso spese accessorie di viaggio, distanza fino a 100 km (trimestrale)",
        "pattern": r"pari o inferiore a 100 km, il rimborso ammonta a (3\.323,70) euro trimestrali",
        "frequency": "quarterly",
        "grossNet": "allowance",
    },
    {
        "id": "rimborso-spese-accessorie-viaggio-oltre-100km",
        "label": "Rimborso spese accessorie di viaggio, distanza oltre 100 km (trimestrale)",
        "pattern": r"nel caso sia superiore, l'importo è pari a (3\.995,10) euro a trimestre",
        "frequency": "quarterly",
        "grossNet": "allowance",
    },
    {
        "id": "rimborso-spese-telefoniche",
        "label": "Rimborso forfetario delle spese telefoniche (annuo)",
        "pattern": r"ridotto il rimborso forfetario delle spese telefoniche da 3\.098,74 a (1\.200) euro annui",
        "frequency": "annual",
        "grossNet": "allowance",
    },
    {
        "id": "trattenuta-assistenza-sanitaria",
        "label": "Trattenuta sull'indennità lorda per l'assistenza sanitaria integrativa (mensile)",
        "pattern": r"pari a (526,66) euro mensili, destinata al sistema di assistenza sanitaria integrativa",
        "frequency": "monthly",
        "grossNet": "withholding",
    },
    {
        "id": "trattenuta-assegno-fine-mandato",
        "label": "Trattenuta sull'indennità lorda per l'assegno di fine mandato (mensile)",
        "pattern": r"una quota della propria indennità lorda, pari a (784,14) euro\. Al termine del mandato",
        "frequency": "monthly",
        "grossNet": "withholding",
    },
)



class SnapshotError(ValueError):
    """Official payload or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(source.get("pageUrl") == "https://www.camera.it/deputati/trattamento-economico", "pageUrl")
    locks = source.get("committedContent") or {}
    require(isinstance(locks.get("chars"), int) and locks["chars"] > 5_000, "lock chars")
    require(bool(SHA_RE.match(str(locks.get("sha256") or ""))), "lock sha")
    floor = (spec.get("coverageFloor") or {}).get("components")
    require(isinstance(floor, int) and floor >= len(COMPONENTS), "coverageFloor.components")
    return spec


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}, method="GET")
    try:
        with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=90) as response:
            return response.read()
    except urllib.error.URLError as error:
        raise SnapshotError(f"pagina trattamento economico non raggiungibile: {error}") from error


class _VisibleTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style"}:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._chunks.append(data)

    def handle_entityref(self, name: str) -> None:
        if self._skip_depth == 0:
            self._chunks.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if self._skip_depth == 0:
            self._chunks.append(f"&#{name};")

    def text(self) -> str:
        return " ".join(self._chunks)


def plain_text(raw_html: str) -> str:
    parser = _VisibleTextExtractor()
    parser.feed(raw_html)
    parser.close()
    text = html_lib.unescape(parser.text())
    return re.sub(r"\s+", " ", text)


def euro_to_cents(value: str) -> int:
    require(re.fullmatch(r"\d{1,3}(?:\.\d{3})*(?:,\d{2})?", value), f"importo non italiano: {value!r}")
    if "," in value:
        whole, frac = value.split(",", 1)
        require(len(frac) == 2, f"decimali non validi: {value!r}")
    else:
        whole, frac = value, "00"
    digits = whole.replace(".", "") + frac
    require(digits.isdigit(), f"cifre non valide: {value!r}")
    return int(digits)


def extract_components(text: str) -> list[dict[str, Any]]:
    components: list[dict[str, Any]] = []
    for spec in COMPONENTS:
        match = re.search(spec["pattern"], text, flags=re.I)
        require(match is not None, f"importo assente o testo cambiato: {spec['id']}")
        amount = match.group(1)
        if "," not in amount:
            amount = f"{amount},00"
        components.append(
            {
                "id": spec["id"],
                "label": spec["label"],
                "amountEuro": amount,
                "amountCents": euro_to_cents(amount),
                "currency": "EUR",
                "frequency": spec["frequency"],
                "grossNet": spec["grossNet"],
                "appliesTo": "deputato",
            }
        )
    return components


def cents_to_euro(cents: int) -> str:
    whole, frac = divmod(cents, 100)
    return f"{whole:,}".replace(",", ".") + f",{frac:02d}"


def iso_date(day: str, month: str, year: str) -> str:
    require(month.lower() in MONTHS, f"mese non riconosciuto: {month!r}")
    return f"{int(year):04d}-{MONTHS[month.lower()]:02d}-{int(day):02d}"


def content_text(text: str) -> tuple[str, str]:
    """Section text from the first heading through the page's own update date."""
    start = text.find(CONTENT_START)
    require(start >= 0, "inizio sezione trattamento economico assente")
    end = CONTENT_END.search(text, start)
    require(end is not None, "data di ultimo aggiornamento assente")
    return text[start : end.end()].strip(), iso_date(*end.groups())


def _sentence(pattern: str, text: str, what: str) -> re.Match[str]:
    match = re.search(pattern.replace("AMOUNT", AMOUNT), text)
    require(match is not None, f"frase dello storico assente o cambiata: {what}")
    return match


def extract_history(text: str) -> list[dict[str, Any]]:
    """Step series of the published rates; every "da X a Y" must start from the previous step."""
    history: list[dict[str, Any]] = []
    last: dict[str, int] = {}

    def add(component_id: str, cents: int, evidence: str, *, from_year: int | None = None,
            from_date: str | None = None, chain_from: str | None = None, basis: str = "literal") -> None:
        if chain_from is not None:
            require(last.get(component_id) == euro_to_cents(chain_from), f"catena importi incoerente: {component_id}")
        history.append({
            "componentId": component_id,
            "fromYear": from_year,
            "fromDate": from_date,
            "amountEuro": cents_to_euro(cents),
            "amountCents": cents,
            "basis": basis,
            "evidence": evidence,
        })
        last[component_id] = cents

    ind, other = "indennita-parlamentare-lordo", "indennita-parlamentare-lordo-altra-attivita"
    m = _sentence(r"A partire dal (\d{4}), anno in cui l'importo dell'indennità parlamentare era pari a AMOUNT euro mensili lordi", text, "indennità 2005")
    add(ind, euro_to_cents(m[2]), m[0], from_year=int(m[1]))
    m = _sentence(r"nel (\d{4}), l'importo mensile dell'indennità parlamentare è stato ridotto da AMOUNT euro lordi a AMOUNT euro lordi", text, "indennità 2006")
    add(ind, euro_to_cents(m[3]), m[0], from_year=int(m[1]), chain_from=m[2])
    m = _sentence(
        r"per il triennio (\d{4})-\d{4}, l'indennità mensile è stata nuovamente e ulteriormente ridotta [^;]*?"
        r"da AMOUNT euro lordi a AMOUNT euro lordi; tale riduzione è stata raddoppiata [^:]*: da AMOUNT euro lordi a AMOUNT euro lordi",
        text, "indennità 2011",
    )
    # Before 2011 the reduced rate did not exist: its first "da" is the ordinary rate.
    require(euro_to_cents(m[4]) == last[ind], "catena importi incoerente: altra attività 2011")
    add(ind, euro_to_cents(m[3]), m[0], from_year=int(m[1]), chain_from=m[2])
    add(other, euro_to_cents(m[5]), m[0], from_year=int(m[1]))
    m = _sentence(
        r"nel (\d{4}), l'importo dell'indennità parlamentare mensile è stato nuovamente ridotto: da AMOUNT euro lordi a AMOUNT euro lordi; "
        r"per i deputati che svolgono [^:]*: da AMOUNT euro lordi a AMOUNT euro lordi",
        text, "indennità 2012",
    )
    add(ind, euro_to_cents(m[3]), m[0], from_year=int(m[1]), chain_from=m[2])
    add(other, euro_to_cents(m[5]), m[0], from_year=int(m[1]), chain_from=m[4])

    m = _sentence(r"Nella riunione del (\d{1,2}) (\w+) (\d{4}) l'Ufficio di Presidenza ha ridotto di (\d+) euro la misura mensile della diaria, fissandone l'ammontare in AMOUNT euro", text, "diaria")
    diaria = euro_to_cents(m[5])
    add("diaria", diaria + int(m[4]) * 100, m[0], basis="derived")
    add("diaria", diaria, m[0], from_year=int(m[3]), from_date=iso_date(m[1], m[2], m[3]))

    m = _sentence(r"originariamente pari a AMOUNT euro \(la medesima misura del contributo previgente\), è stato ridotto nel (\w+) (\d{4}) a AMOUNT euro", text, "rimborso mandato")
    require(m[2].lower() in MONTHS, f"mese non riconosciuto: {m[2]!r}")
    add("rimborso-eletti-elettori", euro_to_cents(m[1]), m[0])
    add("rimborso-eletti-elettori", euro_to_cents(m[4]), m[0], from_year=int(m[3]))

    m = _sentence(r"a decorrere dal (\d{1,2})° (\w+) (\d{4}) l'Ufficio di Presidenza ha ridotto il rimborso forfetario delle spese telefoniche da AMOUNT a AMOUNT euro annui", text, "spese telefoniche")
    add("rimborso-spese-telefoniche", euro_to_cents(m[4]), m[0])
    add("rimborso-spese-telefoniche", euro_to_cents(m[5]), m[0], from_year=int(m[3]), from_date=iso_date(m[1], m[2], m[3]))
    return history


def extract_freeze(text: str) -> dict[str, Any]:
    m = _sentence(
        r"dal (\d{4}) è stata disposta, per 5 anni, la sospensione degli adeguamenti retributivi\. "
        r"Tale misura è stata successivamente prorogata senza soluzione di continuità, da ultimo, fino a tutto il (\d{4})",
        text, "sospensione adeguamenti",
    )
    through = int(m[2])
    allowances = re.findall(r"confermata, senza soluzione di continuità, fino al 31 dicembre (\d{4})", text)
    require(len(allowances) == 2, "proroghe di diaria e rimborso non trovate")
    require(all(int(year) == through for year in allowances), "proroghe con anni diversi")
    return {"adjustmentsSuspendedFromYear": int(m[1]), "confirmedThroughYear": through, "evidence": m[0]}


def build_snapshot(spec: dict[str, Any], page: bytes, acquired_at: str) -> dict[str, Any]:
    html = page.decode("utf-8", errors="replace")
    require("Il trattamento economico" in html, "titolo trattamento economico assente")
    content, publication_date = content_text(plain_text(html))
    components = extract_components(content)
    floor = spec["coverageFloor"]["components"]
    require(len(components) >= floor, f"componenti sotto soglia: {len(components)}")

    source = spec["source"]
    locks = source["committedContent"]
    content_sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    require(len(content) == locks["chars"], f"testo della sezione cambiato: {len(content)} != {locks['chars']} caratteri")
    require(content_sha == locks["sha256"], "sha256 del testo della sezione cambiato")

    counterfactual = _sentence(r"sarebbe attualmente pari a AMOUNT euro lordi", content, "indennità senza riduzioni")
    pension = _sentence(r"contributo pari all'(\d{1,2}),(\d{2}) per cento dell'indennità parlamentare lorda", content, "contributo pensione")

    history = extract_history(content)
    freeze = extract_freeze(content)
    first_year = min(step["fromYear"] for step in history if step["fromYear"] is not None)
    by_id = {item["id"]: item for item in components}
    return {
        "schemaVersion": 2,
        "chamber": "camera",
        "referencePeriod": f"{first_year}-{freeze['confirmedThroughYear']}",
        "period": {
            "label": spec["period"]["label"],
            "observedDate": spec["period"]["observedDate"],
        },
        "coverage": {"components": len(components)},
        "soldi": {
            "present": True,
            "unit": "EUR-cent",
            "nature": "institutional-rate",
            "note": spec["semantics"]["soldi"]["note"],
        },
        "source": {
            "owner": source["owner"],
            "title": spec["title"],
            "pageUrl": source["pageUrl"],
            "landingUrl": source["landingUrl"],
            "license": source["license"],
            "licenseUrl": source["licenseUrl"],
            "publicationDate": publication_date,
            "observedDate": spec["period"]["observedDate"],
            "acquiredAt": acquired_at,
            "responses": {"page": {"bytes": len(page), "sha256": hashlib.sha256(page).hexdigest()}},
            "content": {"chars": len(content), "sha256": content_sha},
            "cadence": "pagina istituzionale (indennità ferma dal 2012 salvo delibere)",
        },
        "provenance": {
            "kind": "official-html-page",
            "page": source["pageUrl"],
            "gap": (
                "Pagina Senato del trattamento economico non acquisibile in modo ripetibile "
                "(challenge WAF): nessun importo senatorio in questo snapshot."
            ),
        },
        "summary": {
            "indemnityGrossMonthlyCents": by_id["indennita-parlamentare-lordo"]["amountCents"],
            "indemnityNetBeforeLocalSurtaxesMonthlyCents": by_id[
                "indennita-parlamentare-netto-prima-addizionali"
            ]["amountCents"],
            "diariaMonthlyCents": by_id["diaria"]["amountCents"],
            "constituentAllowanceMonthlyCents": by_id["rimborso-eletti-elettori"]["amountCents"],
            "indemnityGrossWithoutCutsMonthlyCents": euro_to_cents(counterfactual[1]),
            "pensionContributionBasisPoints": int(pension[1]) * 100 + int(pension[2]),
        },
        "components": components,
        "history": history,
        "freeze": freeze,
        "caveats": list(spec["caveats"]),
    }


def validate_history(history: Any, components: list[dict[str, Any]]) -> None:
    require(isinstance(history, list) and history, "history")
    current = {item["id"]: item["amountCents"] for item in components}
    series: dict[str, list[dict[str, Any]]] = {}
    for step in history:
        require(step.get("componentId") in current, f"history su componente ignoto: {step.get('componentId')}")
        require(step.get("basis") in {"literal", "derived"}, "history.basis")
        require(bool(step.get("evidence")), "history.evidence")
        require(step["amountCents"] == euro_to_cents(step["amountEuro"]) and step["amountCents"] > 0, "history cents/euro")
        series.setdefault(step["componentId"], []).append(step)
    for component_id, steps in series.items():
        # Only the first step may have an unknown start; later ones must move strictly forward.
        require(all(step["fromYear"] is not None for step in steps[1:]), f"history senza anno: {component_id}")
        keys = [(step["fromYear"] or 0, step["fromDate"] or "") for step in steps]
        require(keys == sorted(keys) and len(set(keys)) == len(keys), f"history fuori ordine: {component_id}")
        require(steps[-1]["amountCents"] == current[component_id], f"history non arriva all'importo in vigore: {component_id}")


def validate_snapshot(payload: dict[str, Any], *, floor: int, locks: dict[str, Any]) -> None:
    require(payload.get("schemaVersion") == 2, "schemaVersion")
    require(payload.get("chamber") == "camera", "chamber")
    require(payload.get("soldi", {}).get("present") is True, "soldi.present")
    require(payload.get("soldi", {}).get("unit") == "EUR-cent", "soldi.unit")
    components = payload.get("components")
    require(isinstance(components, list) and len(components) >= floor, "components")
    require(payload["coverage"]["components"] == len(components), "coverage")
    require(re.fullmatch(r"\d{4}-\d{4}", payload.get("referencePeriod") or ""), "period.referencePeriod")
    content = payload["source"]["content"]
    require(content["chars"] == locks["chars"], "chars lock")
    require(content["sha256"] == locks["sha256"], "sha lock")
    ids = [item["id"] for item in components]
    require(len(ids) == len(set(ids)), "component id duplicati")
    for item in components:
        require(item["amountCents"] == euro_to_cents(item["amountEuro"]), "cents/euro drift")
        require(item["amountCents"] > 0, "importo non positivo")
    validate_history(payload.get("history"), components)


def check_committed(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    require(OUTPUT.is_file(), "artefatto trattamento economico assente")
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    validate_snapshot(
        payload,
        floor=spec["coverageFloor"]["components"],
        locks=spec["source"]["committedContent"],
    )
    return payload


def write_snapshot(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    page = fetch_bytes(spec["source"]["pageUrl"])
    acquired_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = build_snapshot(spec, page, acquired_at)
    validate_snapshot(
        payload,
        floor=spec["coverageFloor"]["components"],
        locks=spec["source"]["committedContent"],
    )
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    require(args.check ^ args.write, "specificare --check oppure --write")
    if args.check:
        payload = check_committed()
        print(f"OK camera-trattamento-economico components={payload['coverage']['components']}")
        return
    payload = write_snapshot()
    print(f"WROTE {OUTPUT} components={payload['coverage']['components']}")


if __name__ == "__main__":
    main()
