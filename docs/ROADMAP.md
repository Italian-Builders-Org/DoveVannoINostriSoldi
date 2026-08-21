# Roadmap

## Fase 0: fondamenta
- [x] identità e dashboard responsive
- [x] source registry
- [x] metodologia e principi legali
- [x] primo endpoint OpenBDAP
- [x] CI

## Fase 1: dati reali
- [x] ingestore IPA e schede canoniche degli enti
- [x] discovery dei dataset OpenBDAP
- [x] ingestore SIOPE e OpenBDAP per pagamenti aggregati
- [ ] ingestore ANAC BDNCP
- [x] snapshot e provenance per le fonti integrate
- [x] pagina ente con URL sorgente e freshness
- [ ] ricerca unificata per ente, CIG, CUP e fornitore
- [x] ricerca backend OpenBDAP MOP per CUP esatto

## Fase 2: pagamenti distribuiti
- [ ] crawler Amministrazione Trasparente a partire da IPA
- [ ] validatore schema ANAC art. 4-bis
- [ ] coverage report per ente
- [ ] deduplicazione e versioning
- [ ] pagina pagamenti con filtri temporali e categorie

## Fase 3: investimenti e territorio
- [ ] ReGiS / PNRR
- [x] overview nazionale OpenCoesione con snapshot riconciliato, retry ETL, grafici, API e refresh automatico
- [ ] drill-down OpenCoesione per progetto, soggetto e territorio con regole anti-doppio conteggio
- [x] contratto OpenBDAP MOP, controllo schema e ricerca puntuale per CUP
- [ ] ingestione persistente e serie storica completa delle opere OpenBDAP MOP
- [ ] geometrie ISTAT
- [ ] confronti regionali, provinciali e comunali
- [ ] normalizzazione pro capite con popolazione ufficiale
- [x] redditi, contribuenti, imposta netta dichiarata e addizionali MEF 2024, con segreto statistico e riga non attribuita preservati
- [ ] popolazione comunale ISTAT per denominatori annuali coerenti, senza confondere residenti e contribuenti
- [ ] indice compatto ANAC CIG↔CUP con link di provenienza, senza replicare la BDNCP
- [ ] arricchimento OpenCUP mensile indicizzato offline per CUP
- [ ] progetti PNRR Italia Domani per CUP, soggetto attuatore, fonti di finanziamento e stato amministrativo, senza chiamare i finanziamenti “spesa realizzata”
- [ ] conto economico SSN 2024: personale sanitario e prestazioni esterne come voci contabili distinte, senza stimare gettonisti o cooperative
- [ ] spesa statale regionalizzata RGS e bilanci regionali Istat in dataset separati, con fasi contabili esplicite
- [ ] eventuale contesto Istat sulla soddisfazione soltanto alla geografia pubblicata; nessuna imputazione ai singoli Comuni

## Fase 4: Parlamento e incarichi
- [x] Consulenti Pubblici
- [x] consuntivo e bilancio Camera; documenti ufficiali Senato collegati
- [ ] gare delle istituzioni
- [ ] trattamento economico con granularità rigorosamente aderente alle fonti

## Fase 5: controlli sui dati insoliti
- [ ] concentrazione fornitori
- [ ] affidamenti ripetuti
- [ ] prossimità alle soglie
- [ ] proroghe e rinnovi
- [ ] benchmark di prezzo su categorie realmente comparabili
- [x] contratto che separa dati osservati, stime, esposizioni al rischio e stock
- [x] regole pubbliche che vietano conclusioni automatiche e somme incompatibili
- [ ] test quantitativi contro falsi positivi sui futuri indicatori automatici

## Definition of done per connettore

Un connettore non è “fatto” finché non ha:

- fonte e condizioni documentate;
- fixture reale e test;
- idempotenza;
- retry e timeout;
- schema validation;
- metriche di qualità;
- provenance completa;
- gestione dei cambi di schema;
- stato/freshness visibile in UI.
