# A misura di Comune: struttura demografica

MVP di [#280](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/280):
tre indicatori comunali del sistema informativo ISTAT **A misura di Comune**,
classificato come statistica sperimentale. Sono tabelle del corpus integrato,
con accesso dal catalogo, dalle API e da MCP. Non esiste un secondo snapshot di
pagina. Il blocco nelle schede Comune resta una possibile superficie successiva.

## Fonte, date e unità

- Titolare: Istituto nazionale di statistica (ISTAT).
- [Pagina del sistema](https://www.istat.it/statistica-sperimentale/aggiornamento-degli-indicatori-del-sistema-informativo-a-misura-di-comune/).
- [File XLSX](https://www.istat.it/storage/misura-comune/1d-Popolazione-indicatori-struttura.xlsx).
- [Nota metodologica](https://www.istat.it/storage/misura-comune/Nota-metodologica.pdf).
- File: 4.603.162 byte, SHA-256
  `e7e363c4c42c840a68f7baf48fd3a7204bcaadbea8092498fa27d1a5a9d3e408`.
- Anni osservati: **2014–2024**, al **31 dicembre di ciascun anno**.
- Geografia della release: **31 dicembre 2024**.
- Aggiornamento delle tavole: **1° gennaio 2026**, dichiarato nel foglio
  `Indice delle Tavole`, cella A15. La pagina web è aggiornata al **26 maggio
  2026**; la sua pubblicazione originaria del 2018 riguarda il sistema.
- Pubblicazione della specifica release: non dichiarata; `publicationDate`
  rimane `null`. Acquisizione e controllo: **6 settembre 2026**.
- Aggiornamenti periodici; acquisizione e promozione manuali, senza fetch a runtime.

Il file non dichiara una licenza specifica nelle tavole: il catalogo conserva
`not-declared`. Le [note legali ISTAT](https://www.istat.it/note-legali/)
dichiarano CC BY 4.0 per i contenuti pubblicati sul sito salvo diversa
indicazione; questo riferimento resta esplicito, senza trasformarlo in una
dichiarazione interna al singolo asset. La proiezione è attribuita a ISTAT e
la trasformazione DVNS è dichiarata.

| Dataset del corpus | Tavola comunale | Rapporto per 100 |
| --- | --- | --- |
| `istat-misura-comune-vecchiaia` | 6.1 | Residenti di almeno 65 anni / residenti da 0 a 14 anni |
| `istat-misura-comune-dipendenza-anziani` | 7.1 | Residenti di almeno 65 anni / residenti da 15 a 64 anni |
| `istat-misura-comune-dipendenza-strutturale` | 8.1 | Residenti da 0 a 14 anni e di almeno 65 anni / residenti da 15 a 64 anni |

Ogni tabella contiene **7.896 righe comunali** e 11 colonne annuali. In tutto:
23.688 righe e 260.568 celle indicatore, comprese quelle non disponibili.
I rapporti possono superare 100. Non si sommano né si mediano tra Comuni, anni
o indicatori; non sono quote del bilancio pubblico.

**Soldi:** asse assente. **Periodo:** intestazioni annuali e istante al 31
dicembre. **Provenienza:** URL ufficiali, hash dell'XLSX, hash dei membri XML,
source lock e ricevute delle tre proiezioni. I link sono di dataset, non prove
puntuali di qualità dei servizi o di responsabilità amministrativa.

## Geografia e dati mancanti

Le serie usano i confini al 31 dicembre 2024 ricostruiti da ISTAT anche per gli
anni precedenti. Fusioni e cambi di provincia seguono quella configurazione.
DVNS non attribuisce ai Comuni valori provinciali o regionali. Il codice
ISTAT comunale è conservato come stringa a sei cifre; i nomi non diventano
chiavi di join. Nessun join automatico con SIOPE, IRPEF o altre annualità.

- `..`: **dato non ricostruibile nella fonte amministrativa**, secondo la
  cella A16 dell'indice. Sono 10 celle per indicatore: Mappano 2014–2016 e
  Misiliscemi 2014–2020, con la spiegazione territoriale nelle celle A13/A14.
- `N.C.`: **indice di vecchiaia non calcolabile** perché il denominatore
  (popolazione 0–14 anni) è zero. Sono 21 celle della sola tavola 6.1.
- `0`: valore numerico osservato, conservato separatamente dai due simboli.

Nessun simbolo diventa zero o soppressione per privacy. Dal 2018 la fonte tiene
conto del Censimento permanente della popolazione. Non vengono pubblicati
MESWI, AMPI, classifiche di benessere o punteggi compositi; i tre rapporti sono
indicatori demografici definiti dalla fonte.

## Contratto e riproduzione

`scripts/etl/specs/istat-misura-comune.source.json` blocca workbook, membri
XML, intestazioni, note, copertura, marcatori e date. Il parser legge i
lessici numerici XML senza passare da `float`: la conversione in PSV conserva
le cifre della fonte. Non aggiunge precisione né ricalcola i rapporti.

La fixture `tests/fixtures/istat-misura-comune/structure-cells.zip` contiene
copie byte-identiche dei soli shared strings, indice e tre fogli comunali.
Il workbook originale resta acquisibile dall'URL con hash verificato; non si
pubblicano i suoi metadati d'autore o percorsi di lavorazione. Gli hash dei
cinque membri legano la fixture all'XLSX acquisito. Province/regioni sono fuori
dal perimetro scelto, non usate per colmare celle comunali.

Il foglio 8.1 ripete la nota di fonte 1.022 volte in colonne formattate oltre
la tabella. Il parser verifica testo, riga e conteggio di queste ripetizioni,
senza trattarle come osservazioni. Qualunque altro contenuto fuori tabella
fallisce. Titoli, anni, note, duplicati, formule, geografia e simboli inattesi
bloccano la proiezione.

I tre rapporti riconciliano sulla stessa anagrafica e sulle stesse celle
mancanti. La dipendenza strutturale è almeno pari a quella degli anziani;
quando il denominatore dell'indice di vecchiaia è zero, le due dipendenze
coincidono. Negli altri casi non nulli, la relazione tra i tre rapporti è
verificata con tolleranza assoluta `0.00000001`, conservando i valori originali.

```sh
# Dalle celle sorgente versionate, senza rete:
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/istat_misura_comune.py --check

# Dal workbook originale già scaricato e verificato mediante source lock:
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 scripts/etl/istat_misura_comune.py --input /percorso/al/file.xlsx --check

DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 -m unittest discover -s tests/etl -p 'test_istat_misura_comune.py'
node --experimental-strip-types --test tests/istat-misura-comune.test.mjs
```

`--check` riproduce **ogni riga pubblica e ogni ricevuta** dalle celle
bloccate. Per ricostruire la fixture dal workbook, leggere i cinque membri
con `read_members(..., original=True)` e scriverli nell'ordine del lock in un
ZIP DEFLATE livello 9, timestamp dei membri `1980-01-01 00:00:00`, attributi
esterni `0600 << 16`. Il risultato deve coincidere con hash e byte della
fixture nel source lock; nessun file estraneo va aggiunto.

Per promuovere le tre proiezioni, generarle in una directory temporanea con
`--output-dir`, poi usare l'append condiviso:

```python
from pathlib import Path
from siope_nonmunicipal_corpus import append
from integrated_source_release import ReleasePaths, build_release
from siope_nonmunicipal import build_committed_view_proof

append(
    spec_path=Path("scripts/etl/specs/integrated-curated-datasets.source.json"),
    source_root=Path("/percorso/alle/proiezioni"),
    dataset_ids={
        "istat-misura-comune-vecchiaia",
        "istat-misura-comune-dipendenza-anziani",
        "istat-misura-comune-dipendenza-strutturale",
    },
    catalog_path=Path("src/data/generated/integrated/catalog.json"),
    rows_dir=Path("src/data/generated/integrated/rows"),
    receipts_dir=Path("data/source-ledger/datasets"),
    proof_path=Path("data/source-ledger/dataset-proof.json"),
)
build_release(ReleasePaths())
build_committed_view_proof()
```

La prova della vista SIOPE aggiorna solo il riferimento alla release comune.
L'archivio storico, le identità di fonte e gli altri dataset restano invariati.
Delta del corpus: **+3 dataset, +23.688 righe sorgente/pubbliche,
+5.909.362 byte** delle proiezioni PSV. Le celle annuali non sono contate come
Comuni aggiuntivi; i byte PSV non sono presentati come dimensione dell'XLSX.

## Accesso pubblico

- Catalogo: `/dati?vista=tutti`, poi uno dei tre ID riportati sopra.
- Pagina: `/dati/istat-misura-comune-vecchiaia`.
- API: `/api/dati/istat-misura-comune-vecchiaia?q=Mappano&limit=5`.
- MCP: `query_dataset` con `dataset: "spesa_pa_dettaglio"`,
  `code: "istat-misura-comune-vecchiaia"`, `query: "Mappano"`, `limit: 5`.

`q`/`query` è una ricerca testuale, non un join esatto. Gli anni sono colonne,
non un filtro `year`; ogni risposta conserva l'intera serie della riga.
Si usa la paginazione/cursor comune e il selettore pubblico
`integrated-public-view.ts`, senza un altro ID MCP per la stessa tabella.
