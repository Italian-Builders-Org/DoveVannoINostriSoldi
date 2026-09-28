"""Build the bounded Mantova offices snapshot from saved official HTML pages.

Acquire the five URLs in SOURCE_URLS with curl -fsSL into --source-dir first,
using the filenames in SOURCE_FILES.
The raw pages are deliberately kept outside Git; the release records their hashes.
"""

import argparse
import hashlib
import json
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


SOURCE_URLS = {
    "giunta": "https://www.comune.mantova.it/it/unita_organizzative/giunta-comunale",
    "nomina": "https://www.comune.mantova.it/it/news/la-nuova-giunta-del-comune-di-mantova",
    "consiglio": "https://www.comune.mantova.it/it/unita_organizzative/consiglio-comunale",
    "insediamento": "https://www.comune.mantova.it/it/news/142087/il-nuovo-consiglio-comunale-campisi-presidente",
    "licenza": "https://www.comune.mantova.it/it/legal_notices",
}
SOURCE_FILES = {
    "giunta": "mantova-giunta.html",
    "nomina": "mantova-giunta-nomina.html",
    "consiglio": "mantova-consiglio.html",
    "insediamento": "mantova-consiglio-insediamento.html",
    "licenza": "mantova-note-legali.html",
}
LICENSE_URL = "https://www.comune.mantova.it/it/legal_notices"
PROFILE_PATH = re.compile(r"/it/person/[a-z0-9-]+/?$")


class OfficialPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_parts = []
        self.links = []
        self._href = None
        self._link_text = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self._skip += 1
        if tag == "a" and not self._skip:
            self._href = dict(attrs).get("href")
            self._link_text = []

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self._skip:
            self._skip -= 1
        if tag == "a" and self._href is not None:
            label = " ".join(" ".join(self._link_text).split())
            self.links.append((self._href, label))
            self._href = None
            self._link_text = []

    def handle_data(self, data):
        if self._skip:
            return
        self.text_parts.append(data)
        if self._href is not None:
            self._link_text.append(data)

    @property
    def text(self):
        return " ".join(" ".join(self.text_parts).split())

    def members(self):
        result = {}
        for url, label in self.links:
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.netloc != "www.comune.mantova.it" or not PROFILE_PATH.fullmatch(parsed.path):
                continue
            if label == "Vai alla Pagina":
                continue
            if url in result and result[url] != label:
                raise ValueError(f"profilo con due identità: {url}")
            result[url] = label
        return result


def build_snapshot(source_dir: Path, as_of: str):
    date.fromisoformat(as_of)
    pages = {}
    hashes = {}
    for source_id, filename in SOURCE_FILES.items():
        raw = (source_dir / filename).read_bytes()
        if not raw:
            raise ValueError(f"fonte vuota: {filename}")
        page = OfficialPage()
        page.feed(raw.decode("utf-8"))
        pages[source_id] = page
        hashes[source_id] = hashlib.sha256(raw).hexdigest()

    giunta = pages["giunta"]
    consiglio = pages["consiglio"]
    news = pages["insediamento"]
    appointment = pages["nomina"]
    if "nominata il giorno 8 giugno 2026" not in giunta.text or "Sindaco Andrea Murari" not in giunta.text:
        raise ValueError("atto/data di nomina Giunta non riconciliati")
    if not re.search(r"Ultimo aggiornamento\s*:\s*19 giugno 2026", giunta.text):
        raise ValueError("aggiornamento Giunta non riconciliato")
    if "Consiglio comunale" not in consiglio.text or "Campisi Matteo (Presidente del Consiglio Comunale)" not in consiglio.text:
        raise ValueError("organo o presidenza Consiglio non riconciliati")
    if not re.search(r"Ultimo aggiornamento\s*:\s*7 settembre 2026", consiglio.text):
        raise ValueError("aggiornamento Consiglio non riconciliato")
    if "10 giugno" not in news.text or "mandato Amministrativo 2026/2031" not in news.text:
        raise ValueError("insediamento Consiglio non riconciliato")
    if "11 giugno 2026" not in news.text or not re.search(r"Ultimo aggiornamento\s*:\s*23 giugno 2026", news.text):
        raise ValueError("pubblicazione/aggiornamento insediamento non riconciliati")
    if "8 giugno 2026" not in appointment.text or not re.search(r"Ultimo aggiornamento\s*:\s*25 giugno 2026", appointment.text):
        raise ValueError("pubblicazione/aggiornamento nomina Giunta non riconciliati")
    if "Il vicesindaco sarà l’assessora Chiara Sortino" not in appointment.text:
        raise ValueError("ruolo della Vicesindaca non riconciliato")
    if "i dati, i documenti e le informazioni pubblicati sul sito sono rilasciati con licenza CC-BY 4.0" not in pages["licenza"].text:
        raise ValueError("condizioni di riuso non riconciliate")

    giunta_members = giunta.members()
    consiglio_members = consiglio.members()
    if len(giunta_members) != 10 or len(consiglio_members) != 32:
        raise ValueError(f"copertura organi cambiata: Giunta {len(giunta_members)}, Consiglio {len(consiglio_members)}")
    mayor_url = "https://www.comune.mantova.it/it/person/murari-andrea"
    if giunta_members.get(mayor_url) != "Andrea Murari":
        raise ValueError("Sindaco non riconciliato con il profilo ufficiale")

    def normalize_name(value):
        return " ".join(re.sub(r"[^\w ]", " ", value.casefold().replace("-", "")).split())

    for people, article, organ in (
        (giunta_members, appointment, "Giunta"),
        (consiglio_members, news, "Consiglio"),
    ):
        body = normalize_name(article.text)
        for name in people.values():
            parts = name.split()
            alternatives = (normalize_name(name), normalize_name(parts[-1] + " " + " ".join(parts[:-1])))
            if not any(candidate in body for candidate in alternatives):
                raise ValueError(f"membro {organ} non presente nel comunicato di inizio mandato: {name}")

    sources = []
    for source_id in SOURCE_URLS:
        sources.append({
            "id": source_id,
            "publisher": "Comune di Mantova",
            "url": SOURCE_URLS[source_id],
            "publishedAt": {
                "nomina": "2026-06-08",
                "insediamento": "2026-06-11",
            }.get(source_id),
            "lastModifiedAt": {
                "giunta": "2026-06-19",
                "nomina": "2026-06-25",
                "consiglio": "2026-09-07",
                "insediamento": "2026-06-23",
                "licenza": None,
            }[source_id],
            "acquiredAt": as_of,
            "verifiedAt": as_of,
            "license": "CC-BY-4.0",
            "licenseUrl": LICENSE_URL,
            "sha256": hashes[source_id],
        })

    members = []
    for organ, people, start_date, evidence in (
        ("giunta", giunta_members, "2026-06-08", ["giunta", "nomina"]),
        ("consiglio", consiglio_members, "2026-06-10", ["consiglio", "insediamento"]),
    ):
        for person_url, name in people.items():
            if person_url == mayor_url:
                role = "Sindaco"
            elif organ == "giunta" and person_url.endswith("/sortino-chiara"):
                role = "Vicesindaca"
            elif organ == "giunta":
                role = "Assessore o assessora"
            elif person_url.endswith("/campisi-matteo"):
                role = "Presidente del Consiglio"
            elif person_url.endswith(("/grassi-maddalena", "/baschieri-pierluigi")):
                role = "Vicepresidente del Consiglio"
            else:
                role = "Componente del Consiglio"
            members.append({
                "organ": organ,
                "name": name,
                "personUrl": person_url,
                "role": role,
                "membershipStartDate": start_date,
                "membershipEndDate": None,
                "evidenceSourceIds": evidence,
            })

    return {
        "schemaVersion": 1,
        "municipality": {"ipaCode": "c_e897", "taxCode": "00189800204", "name": "Comune di Mantova"},
        "coverage": {"organs": ["giunta", "consiglio"], "historical": False, "verifiedAt": as_of},
        "sources": sources,
        "members": members,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--as-of", default=date.today().isoformat())
    args = parser.parse_args()
    snapshot = build_snapshot(args.source_dir, args.as_of)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
