# Posti letto: contesto sanitario

Pilota di [#251](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/251):
la dotazione ospedaliera accompagna i costi CE in `/spese/sanita`.
Le righe hanno un solo identificativo nel corpus: `salute-posti-letto-2023`.
Non esiste uno snapshot JSON parallelo per la pagina.

## Fonte e perimetro

- Titolare: Ministero della Salute.
- [Scheda del rilascio](https://www.dati.salute.gov.it/it/dataset/posti-letto-regione-e-disciplina-2023/).
- [CSV originale](https://www.dati.salute.gov.it/sites/default/files/2025-07/Posti%20letto%20per%20Regione%20e%20disciplina_2023_0.csv).
- [Dizionario](https://www.dati.salute.gov.it/dati/documenti/Dataset-PostiLettoRegioneDisciplina2020.pdf), versione 3.0 del 23 maggio 2022.
- Licenza dichiarata nella scheda: **Italian Open Data License 2.0**.
- Riferimento: **1° gennaio 2023**; pubblicazione: **29 luglio 2025**;
  acquisizione e verifica: **6 settembre 2026**. Frequenza annuale,
  promozione manuale dopo verifica del nuovo rilascio.
- Byte: **86.277**, SHA-256
  `365a98b0ee40137dc8c477d17e429cdf6a150a04bc41cb666de2072117d1b39b`.

Il CSV originale, incluso come fixture completa, contiene 1.019 righe per
21 codici regionali/Province autonome e 68 discipline. Latin-1, separatore `;`,
CRLF e spazi delle etichette restano nei byte verificati; `.gitattributes`
impedisce la conversione dei fine riga. I codici mantengono gli zeri iniziali.

**Soldi:** asse assente; le misure sono conteggi di posti letto e reparti.
**Periodo:** colonna `Anno` e istante dichiarato nella scheda.
**Provenienza:** metadati e ricevuta del corpus con hash dei byte sorgente.
Gli URL sono di dataset, non riferimenti puntuali a singoli reparti.

La somma delle righe è 212.768 posti letto. Le quattro modalità riconciliano:
191.547 ordinari + 1.545 a pagamento + 11.563 day hospital + 8.113 day surgery.
È una somma dei dati pubblicati, non una stima delle strutture con modelli
HSP12/HSP13 non trasmessi. Zero osservato rimane zero; valori mancanti,
duplicati, anni inattesi o totali incoerenti bloccano la vista aggregata.

Acuti, riabilitazione (discipline 28, 56, 75) e lungodegenza (60) restano
distinti; Nido (31) è escluso. La geografia è quella delle strutture, non dei
pazienti. Bolzano (041) e Trento (042) non sono accorpate.

Il CE 2024 e la capacità 2023 hanno anni e perimetri diversi: nessun costo per
posto letto, somma monetaria o indice di qualità. Questo pilota realizza
l’alternativa “posti letto” dello scope della issue; indicatori LEA/NSG,
demografia per età e outcome richiedono fonti e contratti ulteriori.

## Lettura pubblica

- `/spese/sanita#posti-letto`: totale delle righe e tabella regionale espandibile,
  ordinata per codice, con limiti e fonti.
- `/dati/salute-posti-letto-2023`: tutte le discipline, filtri e paginazione.
- `/api/dati/salute-posti-letto-2023?q=PIEMONTE&limit=5`: stesso selettore pubblico.
- MCP: `query_dataset` con `dataset: "salute_posti_letto"`,
  `query: "PIEMONTE"`, `limit: 5`. L’alias dedicato usa lo stesso selettore
  e resta accessibile anche da `spesa_pa_dettaglio` con il codice del corpus.

La pagina aggrega le righe attraverso `integrated-public-view.ts` soltanto
sul server. La tabella generica conserva i conteggi: “Totale posti letto”
non viene formattato in euro.

## Riproduzione offline

La spec del corpus fissa encoding, intestazioni, righe, byte e SHA-256.
`tests/etl/test_salute_hospital_beds.py` ricostruisce la proiezione dalla
fixture completa con `parse_dataset`/`build_dataset`, e confronta **ogni riga**
e la ricevuta con gli artifact pubblicati.

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci \
python3 -m unittest discover -s tests/etl -p 'test_salute_hospital_beds.py'
node --experimental-strip-types --test tests/salute-hospital-beds.test.mjs
```

Per rigenerare questa sola proiezione nella checkout isolata, usare
la funzione di append condivisa. Conserva gli altri artifact byte per byte,
senza richiedere l’archivio privato storico:

```sh
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 - <<'PY'
from pathlib import Path
from siope_nonmunicipal_corpus import append
from integrated_source_release import ReleasePaths, build_release
from siope_nonmunicipal import build_committed_view_proof

append(
    spec_path=Path("scripts/etl/specs/integrated-curated-datasets.source.json"),
    source_root=Path("tests/fixtures"),
    dataset_ids={"salute-posti-letto-2023"},
    catalog_path=Path("src/data/generated/integrated/catalog.json"),
    rows_dir=Path("src/data/generated/integrated/rows"),
    receipts_dir=Path("data/source-ledger/datasets"),
    proof_path=Path("data/source-ledger/dataset-proof.json"),
)
build_release(ReleasePaths())
build_committed_view_proof()
PY
```

L’ultimo comando aggiorna soltanto il riferimento alla release generale
nella prova della vista SIOPE, senza cambiare i dati SIOPE.
I gate completi di `CONTRIBUTING.md` devono passare prima della PR.

Delta di ricezione di questo import: **+1 dataset, +1.019 righe sorgente,
+1.019 righe pubbliche, +86.277 byte**. Nessuna variazione delle righe
`catalog-only`, `derived-only`, degli elementi del vecchio archivio o delle
identità del catalogo fonti.
