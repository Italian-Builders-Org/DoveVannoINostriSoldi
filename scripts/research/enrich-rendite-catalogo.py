#!/usr/bin/env python3
"""Merge official source pointers into rendite-catalogo.json (no monetary estimates)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "src/lib/data/rendite-catalogo.json"
OUT_EVIDENCE = ROOT / "research/rendite-inefficienze/sources/evidence-notes-2026-11-18.json"
CHECKED = "2026-11-18"


def src(label: str, url: str, holder: str, note: str | None = None) -> dict:
    row = {"label": label, "url": url, "holder": holder, "checkedAt": CHECKED}
    if note:
        row["note"] = note
    return row


# Primary/official starting points per case. Notes stay non-monetary.
ITEM_SOURCES: dict[str, list[dict]] = {
    "taxi": [
        src(
            "AGCM S4778 — segnalazione taxi Roma, Milano, Napoli",
            "https://www.agcm.it/media/comunicati-stampa/2023/11/S4778",
            "AGCM",
            "Licenze attive dichiarate: Roma 7.962; Milano 4.853; Napoli 2.364 (comunicato 3 novembre 2023). Non è una stima nazionale di spreco.",
        ),
        src(
            "Decreto-legge 104/2023 (Asset) — Normattiva",
            "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legge:2023-08-10;104",
            "Normattiva",
            "Contesto normativo sul tetto straordinario di aumento licenze citato da AGCM.",
        ),
    ],
    "balneari": [
        src(
            "AGCM Bollettino 22/2024 — concessioni demaniali marittime",
            "https://www.agcm.it/pubblicazioni/bollettino-settimanale/2024/22/Bollettino-22-2024",
            "AGCM",
            "Segnalazioni AS1973–AS1977 (3 giugno 2024) su proroghe di concessioni turistico-ricreative.",
        ),
        src(
            "AGCM Bollettino 22/2024 (PDF)",
            "https://www.agcm.it/dotcmsdoc/bollettini/2024/22-24.pdf",
            "AGCM",
        ),
    ],
    "notai": [
        src(
            "Ministero della Giustizia — home istituzionale",
            "https://www.giustizia.it/",
            "Ministero della Giustizia",
            "Pista istituzionale; acquisire tabelle e regolamenti notarili specifici.",
        ),
        src("Consiglio Nazionale del Notariato", "https://www.notariato.it/", "CNN"),
    ],
    "farmacie": [
        src(
            "Ministero della Salute",
            "https://www.salute.gov.it/",
            "Ministero della Salute",
            "Alcuni percorsi tematici rispondono con challenge CDN; usare atti e open data puntuali.",
        ),
        src("AIFA", "https://www.aifa.gov.it/", "AIFA"),
    ],
    "tabaccai": [
        src("Agenzia delle Dogane e dei Monopoli", "https://www.adm.gov.it/", "ADM", "Pista su rete di distribuzione e vincoli fiscali/sanitari."),
    ],
    "edicole": [src("AGCOM", "https://www.agcom.it/", "AGCOM", "Pista su pluralismo e distribuzione editoriale.")],
    "autostrade": [
        src("MIT — Ministero delle Infrastrutture e dei Trasporti", "https://www.mit.gov.it/", "MIT"),
        src(
            "ART — Autorità di regolazione dei trasporti",
            "https://www.autorita-trasporti.it/",
            "ART",
            "Verificare accessibilità HTTP (403 osservato su alcuni endpoint); usare delibere pubblicate.",
        ),
    ],
    "concessioni-gioco": [
        src("Agenzia delle Dogane e dei Monopoli", "https://www.adm.gov.it/", "ADM", "Distinguere gettito, vigilanza e costi sociali."),
    ],
    "tv-frequenze": [src("AGCOM", "https://www.agcom.it/", "AGCOM")],
    "porti-turistici": [src("MIT", "https://www.mit.gov.it/", "MIT"), src("ENAC (contesto infrastrutture)", "https://www.enac.gov.it/", "ENAC", "Perimetro aeroportuale; per porti usare atti MIT/AdSP.")],
    "funerari": [src("Ministero della Salute", "https://www.salute.gov.it/", "Ministero della Salute")],
    "ordini": [
        src(
            "Gazzetta Ufficiale",
            "https://www.gazzettaufficiale.it/",
            "Gazzetta Ufficiale",
            "Norme istitutive e riforme degli ordini da individuare caso per caso.",
        ),
    ],
    "casse": [
        src(
            "COVIP",
            "https://www.covip.it/",
            "COVIP",
            "Pista su previdenza complementare/casse; alcuni percorsi rispondono 403.",
        ),
    ],
    "siae": [
        src("SIAE", "https://www.siae.it/", "SIAE"),
        src("AGCM", "https://www.agcm.it/", "AGCM", "Cercare provvedimenti su diritti d'autore e intermediazione."),
    ],
    "editoria": [
        src("AGCOM", "https://www.agcom.it/", "AGCOM"),
        src("Dipartimento per l'Informazione e l'Editoria", "https://www.informazioneeditoria.gov.it/", "Presidenza del Consiglio"),
    ],
    "aci-pra": [
        src(
            "D.lgs. 98/2017 — Documento Unico e razionalizzazione dati veicolo",
            "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2017-05-29;98",
            "Normattiva",
        ),
        src("ACI — Pubblico Registro Automobilistico", "https://www.aci.it/i-servizi/servizi-online/pubblico-registro-automobilistico.html", "ACI"),
        src("ACI — Dati e statistiche", "https://www.aci.it/laci/studi-e-ricerche/dati-e-statistiche.html", "ACI"),
        src("MIT", "https://www.mit.gov.it/", "MIT"),
    ],
    "camere": [
        src("Unioncamere", "https://www.unioncamere.gov.it/", "Unioncamere"),
        src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate"),
    ],
    "bollo": [
        src("ACI", "https://www.aci.it/", "ACI"),
        src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate"),
    ],
    "bonifica": [
        src("MASAF", "https://www.masaf.gov.it/", "MASAF", "Consorzi e funzioni idrauliche: bilanci e leggi regionali da acquisire."),
    ],
    "dop-doc": [src("MASAF", "https://www.masaf.gov.it/", "MASAF")],
    "riciclo": [
        src("CONAI", "https://www.conai.org/", "CONAI", "Alcuni endpoint possono rispondere 403; usare bilanci e rapporti pubblicati."),
        src("MASE", "https://www.mase.gov.it/", "MASE"),
        src("ISPRA — rifiuti", "https://www.isprambiente.gov.it/it/attivita/rifiuti", "ISPRA"),
    ],
    "sport": [src("CONI", "https://www.coni.it/", "CONI")],
    "caa": [src("AGEA", "https://www.agea.gov.it/", "AGEA")],
    "cnel": [
        src(
            "CNEL — sito istituzionale",
            "https://www.cnel.it/",
            "CNEL",
            "Organo costituzionale; l'abolizione non è un intervento amministrativo ordinario.",
        ),
        src(
            "Costituzione art. 99 — pagina Senato",
            "https://www.senato.it/istituzione/la-costituzione/parte-ii/titolo-iii/sezione-iii/articolo-99",
            "Senato della Repubblica",
            "Snapshot HTML può essere bloccato da WAF; verificare nel browser.",
        ),
    ],
    "fondazioni-bancarie": [src("ACRI", "https://www.acri.it/", "ACRI"), src("MEF", "https://www.mef.gov.it/", "MEF")],
    "terna-snam": [
        src("ARERA — Relazione annuale 2024", "https://www.arera.it/it/relaz_ann/24/ra24.htm", "ARERA"),
        src("Terna", "https://www.terna.it/", "Terna"),
        src("Snam", "https://www.snam.it/", "Snam"),
    ],
    "multiutility": [src("ARERA", "https://www.arera.it/", "ARERA")],
    "aeroporti": [src("ENAC", "https://www.enac.gov.it/", "ENAC"), src("MIT", "https://www.mit.gov.it/", "MIT")],
    "telecom": [src("AGCOM", "https://www.agcom.it/", "AGCOM")],
    "energia-retail": [
        src("ARERA — Relazione annuale 2024", "https://www.arera.it/it/relaz_ann/24/ra24.htm", "ARERA"),
        src("ARERA", "https://www.arera.it/", "ARERA"),
    ],
    "poste": [src("AGCOM", "https://www.agcom.it/", "AGCOM"), src("Poste Italiane", "https://www.poste.it/", "Poste Italiane")],
    "rai": [src("AGCOM", "https://www.agcom.it/", "AGCOM"), src("RAI", "https://www.rai.it/", "RAI")],
    "banche": [
        src(
            "Banca d'Italia — Relazione annuale",
            "https://www.bancaditalia.it/pubblicazioni/relazione-annuale/",
            "Banca d'Italia",
        ),
        src("Banca d'Italia", "https://www.bancaditalia.it/", "Banca d'Italia"),
    ],
    "assicurazioni": [src("IVASS", "https://www.ivass.it/", "IVASS")],
    "risparmio-gestito": [
        src("CONSOB", "https://www.consob.it/", "CONSOB"),
        src("Banca d'Italia", "https://www.bancaditalia.it/", "Banca d'Italia"),
    ],
    "buoni-pasto": [src("MEF", "https://www.mef.gov.it/", "MEF")],
    "polizze-obbligatorie": [src("IVASS", "https://www.ivass.it/", "IVASS")],
    "bonifici": [src("Banca d'Italia", "https://www.bancaditalia.it/", "Banca d'Italia")],
    "informazioni-creditizie": [
        src("AGCM", "https://www.agcm.it/", "AGCM"),
        src("Garante Privacy", "https://www.garanteprivacy.it/", "Garante Privacy"),
    ],
    "broker": [src("IVASS", "https://www.ivass.it/", "IVASS"), src("CONSOB", "https://www.consob.it/", "CONSOB")],
    "commercialisti": [src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate")],
    "patronati": [src("INPS", "https://www.inps.it/", "INPS")],
    "caf": [
        src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate"),
        src("INPS", "https://www.inps.it/", "INPS"),
    ],
    "agenzie-auto": [src("ACI", "https://www.aci.it/", "ACI"), src("MIT", "https://www.mit.gov.it/", "MIT")],
    "geometri": [src("MIT", "https://www.mit.gov.it/", "MIT")],
    "riscossione-locale": [src("MEF — RGS", "https://www.rgs.mef.gov.it/", "Ragioneria Generale dello Stato")],
    "software": [src("AgID", "https://www.agid.gov.it/", "AgID")],
    "editori-giuridici": [src("Gazzetta Ufficiale", "https://www.gazzettaufficiale.it/", "Gazzetta Ufficiale")],
    "formazione": [src("Ministero del Lavoro", "https://www.lavoro.gov.it/", "Ministero del Lavoro")],
    "traduzioni": [src("Ministero della Giustizia", "https://www.giustizia.it/", "Ministero della Giustizia")],
    "immobiliare": [
        src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate"),
    ],
    "sanita": [
        src("AIFA", "https://www.aifa.gov.it/", "AIFA"),
        src("Ministero della Salute", "https://www.salute.gov.it/", "Ministero della Salute"),
        src("Corte dei conti", "https://www.corteconti.it/", "Corte dei conti"),
    ],
    "tpl": [
        src("MIT", "https://www.mit.gov.it/", "MIT"),
        src(
            "ART",
            "https://www.autorita-trasporti.it/",
            "ART",
            "Perimetro TPL; verificare accessibilità e delibere puntuali.",
        ),
    ],
    "partecipate": [
        src("MEF", "https://www.mef.gov.it/", "MEF"),
        src("Dipartimento del Tesoro", "https://www.dt.mef.gov.it/", "MEF"),
        src("Corte dei conti", "https://www.corteconti.it/", "Corte dei conti"),
    ],
    "ater": [src("MIT / Politiche abitative", "https://www.mit.gov.it/", "MIT")],
    "cooperative": [src("Ministero del Lavoro", "https://www.lavoro.gov.it/", "Ministero del Lavoro")],
    "ristorazione": [src("Consip", "https://www.consip.it/", "Consip")],
    "pulizie": [src("Consip", "https://www.consip.it/", "Consip")],
    "appalti": [
        src("ANAC", "https://www.anticorruzione.it/", "ANAC", "Usare portale ANAC se anac.gov.it non risolve."),
        src("Consip", "https://www.consip.it/", "Consip"),
    ],
    "tributi-locali": [src("MEF", "https://www.mef.gov.it/", "MEF"), src("IFEL", "https://www.fondazioneifel.it/", "IFEL")],
    "difesa": [
        src("Ministero della Difesa", "https://www.difesa.it/", "Ministero della Difesa"),
        src("Corte dei conti", "https://www.corteconti.it/", "Corte dei conti"),
    ],
    "rifiuti-speciali": [
        src("MASE", "https://www.mase.gov.it/", "MASE"),
        src("ISPRA — rifiuti", "https://www.isprambiente.gov.it/it/attivita/rifiuti", "ISPRA"),
    ],
    "npl": [src("Banca d'Italia", "https://www.bancaditalia.it/", "Banca d'Italia")],
    "catasto": [src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate")],
    "agenzie-fiscali": [
        src("Agenzia delle Entrate", "https://www.agenziaentrate.gov.it/portale/", "Agenzia delle Entrate"),
        src("Agenzia del Demanio", "https://www.agenziademanio.it/", "Agenzia del Demanio"),
    ],
    "banca-italia": [
        src(
            "Banca d'Italia — Relazione annuale",
            "https://www.bancaditalia.it/pubblicazioni/relazione-annuale/",
            "Banca d'Italia",
        ),
    ],
    "vigilanza": [src("IVASS", "https://www.ivass.it/", "IVASS"), src("CONSOB", "https://www.consob.it/", "CONSOB")],
    "universita": [src("MUR", "https://www.mur.gov.it/", "MUR"), src("ANVUR", "https://www.anvur.it/", "ANVUR")],
    "mercati": [src("MASAF", "https://www.masaf.gov.it/", "MASAF")],
    "tari": [
        src("ARERA", "https://www.arera.it/", "ARERA"),
        src("ISPRA — rifiuti", "https://www.isprambiente.gov.it/it/attivita/rifiuti", "ISPRA"),
    ],
    "cultura": [src("MiC", "https://www.cultura.gov.it/", "Ministero della Cultura")],
    "rsa": [src("Ministero della Salute", "https://www.salute.gov.it/", "Ministero della Salute")],
    "gioco-sociale": [src("ADM", "https://www.adm.gov.it/", "ADM"), src("Istituto Superiore di Sanità", "https://www.iss.it/", "ISS")],
    "editori-scolastici": [src("MIM", "https://www.mim.gov.it/", "MIM")],
    "uibm": [src("UIBM — MIMIT", "https://uibm.mise.gov.it/", "MIMIT")],
    "tempo": [
        src(
            "ISTAT",
            "https://www.istat.it/",
            "ISTAT",
            "Uso del tempo / carico amministrativo: serie da selezionare, non un totale di spreco.",
        ),
    ],
    "pil-mancante": [
        src("ISTAT — Conti nazionali", "https://www.istat.it/statistiche-per-temi/conti-nazionali/", "ISTAT"),
    ],
    "produttivita": [
        src("ISTAT", "https://www.istat.it/", "ISTAT"),
        src("Banca d'Italia", "https://www.bancaditalia.it/", "Banca d'Italia"),
    ],
    "digitale": [
        src("AgID", "https://www.agid.gov.it/", "AgID"),
        src("Dipartimento Transformazione Digitale", "https://innovazione.gov.it/", "Presidenza del Consiglio"),
    ],
}

PROPOSAL_SOURCES: dict[str, list[dict]] = {
    "aci-pra": ITEM_SOURCES["aci-pra"],
    "camere": ITEM_SOURCES["camere"],
    "cnel": ITEM_SOURCES["cnel"],
    "patronati-caf": ITEM_SOURCES["patronati"] + ITEM_SOURCES["caf"],
    "balneari": ITEM_SOURCES["balneari"],
    "ordini": ITEM_SOURCES["ordini"],
    "bonifica": ITEM_SOURCES["bonifica"],
}

EVIDENCE = {
    "taxi": {
        "sourceUrl": "https://www.agcm.it/media/comunicati-stampa/2023/11/S4778",
        "holder": "AGCM",
        "publishedOn": "2023-11-03",
        "acquiredAt": CHECKED,
        "facts": [
            "Roma: 7.962 licenze attive (2,8 ogni 1.000 residenti).",
            "Milano: 4.853 licenze attive (3,5 ogni 1.000 residenti).",
            "Napoli: 2.364 licenze attive (2,6 ogni 1.000 abitanti).",
            "AGCM rileva inadeguatezza strutturale dell'offerta rispetto alla domanda nelle tre città e sollecita bandi e monitoraggio.",
        ],
        "doesNotShow": "Non stima un risparmio nazionale né un costo eliminabile di bilancio.",
    },
    "balneari": {
        "sourceUrl": "https://www.agcm.it/dotcmsdoc/bollettini/2024/22-24.pdf",
        "holder": "AGCM",
        "publishedOn": "2024-06-03",
        "acquiredAt": CHECKED,
        "facts": [
            "Bollettino settimanale n. 22/2024 (pubblicato 3 giugno 2024) include le segnalazioni AS1973–AS1977.",
            "Oggetto: proroghe di concessioni demaniali marittime con finalità turistico-ricreative (Pietrasanta, Viareggio, Camaiore, Forte dei Marmi, Minori).",
            "AGCM richiama il contrasto delle proroghe automatiche con l'art. 49 TFUE e chiede procedure a evidenza pubblica.",
        ],
        "doesNotShow": "Non quantifica un gettito mancante nazionale né un risparmio di bilancio da attribuire a DVNS.",
    },
    "aci-pra": {
        "sourceUrl": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2017-05-29;98",
        "holder": "Normattiva",
        "publishedOn": "2017-05-29",
        "acquiredAt": CHECKED,
        "facts": [
            "Il D.lgs. 98/2017 disciplina il Documento unico e la razionalizzazione dei dati relativi ai veicoli.",
            "Il testo Normattiva indica entrata in vigore il 24/07/2017, con eccezioni (art. 5, commi 1 e 2) dal 1/7/2018.",
            "ACI pubblica pagine istituzionali sul Pubblico Registro Automobilistico e su dati/statistiche.",
        ],
        "doesNotShow": "Non dimostra da solo che PRA/ACI siano una rendita eliminabile né un importo di ineffficienza.",
    },
    "cnel": {
        "sourceUrl": "https://www.cnel.it/",
        "holder": "CNEL",
        "acquiredAt": CHECKED,
        "facts": [
            "Il CNEL si presenta come Consiglio Nazionale dell'Economia e del Lavoro, organo costituzionale con sito istituzionale attivo.",
            "La pagina Senato sull'art. 99 della Costituzione risulta protetta da WAF in acquisizione automatica (snapshot non affidabile).",
        ],
        "doesNotShow": "Non fornisce un costo netto eliminabile né una stima di risparmio da pubblicare.",
    },
}


def main() -> None:
    catalogue = json.loads(CATALOG.read_text(encoding="utf-8"))
    missing = []
    for group in catalogue["groups"]:
        for item in group["items"]:
            sources = ITEM_SOURCES.get(item["id"])
            if not sources:
                missing.append(item["id"])
                continue
            item["sources"] = sources
            if item["id"] in EVIDENCE:
                item["evidence"] = EVIDENCE[item["id"]]
            elif "evidence" in item:
                del item["evidence"]
    for proposal in catalogue["proposals"]:
        sources = PROPOSAL_SOURCES.get(proposal["id"])
        if sources:
            proposal["sources"] = sources
    if missing:
        raise SystemExit(f"Missing sources for: {missing}")
    catalogue["meta"] = {
        "title": "Rendite e inefficienze: casi da verificare",
        "kind": "research-catalogue",
        "acquiredAt": CHECKED,
        "disclaimer": "Catalogo di indagine con fonti ufficiali di partenza. Non pubblica stime economiche non documentate e non attribuisce validazione DVNS agli importi del contributo originario.",
    }
    CATALOG.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_EVIDENCE.write_text(json.dumps(EVIDENCE, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {CATALOG} with sources for {sum(len(g['items']) for g in catalogue['groups'])} items and evidence for {len(EVIDENCE)} cases")


if __name__ == "__main__":
    main()
