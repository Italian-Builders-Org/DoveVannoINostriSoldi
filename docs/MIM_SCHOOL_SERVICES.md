# Scuole statali: contesto dei servizi nel Comune

Il primo incremento dell'issue #283 usa una sola anagrafe ufficiale: le scuole
statali MIM dell'anno scolastico 2026/27, con dati al **1 settembre 2026**.
Non comprende ospedali, stazioni, scuole paritarie o asili nido.

## Fonte e date

- [CSV ufficiale](https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFESTAT20262720260901.csv), HTTP 200 verificato il 6 settembre 2026; UTF-8, 20 colonne, 50.273 record, 13.069.213 byte.
- SHA-256: `b62e43b672f1d293c6e12d9b3f2b7da32a3d73cd905f3bc702e99798e4bcd8b6`.
- [Scheda ministeriale](https://dati.istruzione.it/opendata/opendata/catalogo/elements1/leaf?area=Scuole&datasetId=DS0400SCUANAGRAFESTAT): titolare Ministero dell'Istruzione e del Merito, licenza **IODL 2.0**, esclusione di Aosta, Trento e Bolzano.
- Il catalogo riporta il 18 giugno 2026 come pubblicazione della famiglia; non lo attribuiamo al file di settembre. La data di pubblicazione della specifica distribuzione resta `null`. Acquisizione e ultimo controllo: 6 settembre 2026.
- URL, byte, hash e dizionario di riferimento sono registrati in `scripts/etl/specs/mim-school-services.source.json`.

## Conteggio e raccordo territoriale

`CODICESCUOLA` identifica univocamente ciascuno dei 50.273 record. Il conteggio
usa il valore letterale `SEDESCOLASTICA=SI`: 39.713 codici. Gli altri 10.560
codici (`NO`) restano in una colonna distinta, senza inferirne la funzione.
Non sono conteggi di edifici distinti, classi, posti o studenti.

`CODICECOMUNESCUOLA` contiene un codice **catastale**, non ISTAT. Il raccordo
usa le identità del [file comunale MEF IRPEF 2024](https://www1.finanze.gov.it/finanze/analisi_stat/public/v_4_0_0/contenuti/Redditi_e_principali_variabili_IRPEF_su_base_comunale_CSV_2024.zip),
già versionate nel progetto, con licenza [CC BY 3.0 IT](https://creativecommons.org/licenses/by/3.0/it/).
La licenza MIM non si estende alla fonte MEF. Il source lock conserva hash della
ZIP MEF e dello snapshot usato; ne selezioniamo solo le identità territoriali,
nessuna misura fiscale. Sono obbligatori codice catastale esatto, univocità del
codice ISTAT a sei cifre e regione concorde. Non confrontiamo nomi di Comuni.
Tutti i record del rilascio hanno un raccordo univoco; qualsiasi divergenza
interrompe l'import. Comune, Provincia e Regione pubblicati mantengono i testi
MIM. Le differenze di data fra anagrafi sono un limite esplicito.

La proiezione ha 6.648 righe comunali: 6.518 con almeno un codice `SI`, 130
con soli codici `NO`. Per questi ultimi il conteggio osservato è `0`; un Comune
senza record è `not_found`, le regioni escluse sono `out_of_scope`. Nessuno di
questi stati prova l'assenza di scuole sul territorio. Non si stimano tempi di
accesso, copertura della domanda, qualità, efficienza o rapporti con la spesa.

## Pubblicazione e riproduzione

`mim-scuole-statali-comuni` passa dal corpus integrato e dallo stesso selettore
server per `/dati`, `/api/dati` e MCP `spesa_pa_dettaglio`. La sezione “Scuole”
della scheda Comune e `/api/enti` usano l'identità IPA/MEF già riconciliata,
verificano anche il codice catastale e conservano il row ID della tabella.
Non occorrono richieste al Ministero durante la visita.

La fixture gzip conserva sette colonne originali di **tutti** i record, senza
nomi delle scuole, indirizzi o contatti. Il file completo resta un input esterno.
La fixture occupa 683.327 byte; la vista PSV 357.029 byte, con otto colonne.
Le righe pubbliche sono partizionate in sette gzip. La ricerca comunale esamina
al massimo le 6.648 righe, entro il limite del selettore condiviso di 8.000;
controlla l'esaurimento e rifiuta risultati parziali. Il profilo completo deve
restare sotto 100 kB, come verificato dal test sul Comune di Benevento.

```bash
# Ambiente .venv e guard offline da CONTRIBUTING.md.
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python scripts/etl/mim_school_services.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci .venv/bin/python -m unittest discover -s tests/etl -p 'test_mim_school_services.py'
node --experimental-strip-types --test tests/mim-school-services.test.mjs tests/municipality-profile.test.mjs
# Riproduzione dal CSV MIM originale già acquisito, senza download impliciti:
.venv/bin/python scripts/etl/mim_school_services.py --input /percorso/SCUANAGRAFESTAT20262720260901.csv --check
```

La riproduzione confronta celle, conteggi, righe pubbliche e ricevuta. I test
coprono duplicati, schema, flag, anno, byte, copertura e raccordi divergenti.
Il registro `generated-artifacts.json` collega questi controlli al gruppo
`integrated-rows`; la release chiusa verifica separatamente tutti gli 88 dataset.
Un aggiornamento richiede acquisizione, revisione del lock e nuova PR.
