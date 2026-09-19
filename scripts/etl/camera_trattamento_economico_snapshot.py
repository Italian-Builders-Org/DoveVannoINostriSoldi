#!/usr/bin/env python3
"""Camera institutional economic treatment (indemnity / allowances rates).

Official source: the public page that states the Ufficio di Presidenza rates for
deputies. These are institutional amounts, not individual payslips. Senato rates
are intentionally omitted while programmatic fetches hit a WAF challenge and
cannot be hashed.
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
    locks = (source.get("committedResponses") or {}).get("page") or {}
    require(isinstance(locks.get("bytes"), int) and locks["bytes"] > 5_000, "lock bytes")
    require(bool(SHA_RE.match(str(locks.get("sha256") or ""))), "lock sha")
    floor = (spec.get("coverageFloor") or {}).get("components")
    require(isinstance(floor, int) and floor >= 4, "coverageFloor.components")
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


def build_snapshot(spec: dict[str, Any], page: bytes, acquired_at: str) -> dict[str, Any]:
    html = page.decode("utf-8", errors="replace")
    require("Il trattamento economico" in html, "titolo trattamento economico assente")
    text = plain_text(html)
    require("Indennità parlamentare" in text or "indennità parlamentare" in text, "sezione indennità assente")
    components = extract_components(text)
    floor = spec["coverageFloor"]["components"]
    require(len(components) >= floor, f"componenti sotto soglia: {len(components)}")

    source = spec["source"]
    locks = source["committedResponses"]["page"]
    digest = hashlib.sha256(page).hexdigest()
    require(len(page) == locks["bytes"], f"bytes drift: {len(page)} != {locks['bytes']}")
    require(digest == locks["sha256"], "sha256 drift")

    by_id = {item["id"]: item for item in components}
    return {
        "schemaVersion": 1,
        "chamber": "camera",
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
            "observedDate": spec["period"]["observedDate"],
            "acquiredAt": acquired_at,
            "responses": {"page": {"bytes": len(page), "sha256": digest}},
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
        },
        "components": components,
        "caveats": list(spec["caveats"]),
    }


def validate_snapshot(payload: dict[str, Any], *, floor: int, locks: dict[str, Any]) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion")
    require(payload.get("chamber") == "camera", "chamber")
    require(payload.get("soldi", {}).get("present") is True, "soldi.present")
    require(payload.get("soldi", {}).get("unit") == "EUR-cent", "soldi.unit")
    components = payload.get("components")
    require(isinstance(components, list) and len(components) >= floor, "components")
    require(payload["coverage"]["components"] == len(components), "coverage")
    response = payload["source"]["responses"]["page"]
    require(response["bytes"] == locks["bytes"], "bytes lock")
    require(response["sha256"] == locks["sha256"], "sha lock")
    ids = [item["id"] for item in components]
    require(len(ids) == len(set(ids)), "component id duplicati")
    for item in components:
        require(item["amountCents"] == euro_to_cents(item["amountEuro"]), "cents/euro drift")
        require(item["amountCents"] > 0, "importo non positivo")


def check_committed(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    require(OUTPUT.is_file(), "artefatto trattamento economico assente")
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    validate_snapshot(
        payload,
        floor=spec["coverageFloor"]["components"],
        locks=spec["source"]["committedResponses"]["page"],
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
        locks=spec["source"]["committedResponses"]["page"],
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
