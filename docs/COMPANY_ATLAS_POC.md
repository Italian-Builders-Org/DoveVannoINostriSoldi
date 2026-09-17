# Atlante Imprese Italia — contratto del modulo

Questo documento descrive il perimetro del modulo `/imprese` proposto come
contributo additivo a DoveVannoINostriSoldi. Non è una clearance legale delle
fonti né una promessa sulla disponibilità futura degli URL.

## Snapshot verificato

- generato: `2026-08-26T00:00:00+02:00`;
- schema: `1`;
- osservazioni: `12.880`;
- geografie: `20` regioni;
- classificazione: `ATECO 2025`;
- tipologia ammessa: `aggregate`;
- licenza dichiarata dalle tre fonti: `CC BY 4.0`.

La copertura workforce comprende `118.673` righe sorgente, `437` celle
regione × sezione osservate e `23` celle senza bucket, mantenute come `null`.
I totali riconciliati della release sono `19.490.025` addetti e `6.394.474`
localizzazioni attive.

Il file generato è `src/data/generated/company-atlas-snapshot.json`. Il comando
`npm run company-atlas:refresh` scarica le fonti in parallelo, normalizza i dati,
controlla cardinalità, valori null, copertura e riconciliazioni e valida lo snapshot con
`src/lib/company-atlas-contract.ts`. `--check` valida il file committato senza
rete.

## Fonti

### Stock imprese attive

- URL: <https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia.json>
- pubblicatore indicato: CCIAA Marche su dati InfoCamere;
- ultimo aggiornamento osservato: `2026-08-11`;
- periodo più recente acquisito: `2026-07-31`;
- dimensioni usate: regione, sezione ATECO 2025, mese;
- semantica: stock di sedi di impresa attive.

Non è un elenco nominativo e non contiene ricavi o valore della produzione per
singola impresa.

### Addetti e localizzazioni attive

- URL: <https://opendata.marche.camcom.it/data/2026-Q2-Addetti-Localizzazioni-Attive-Italia.csv>
- pubblicatore indicato: CCIAA Marche su dati InfoCamere;
- ultimo aggiornamento osservato: `2026-08-04`;
- periodo acquisito: `2026-Q2`;
- righe lette: `118.673`;
- colonne: `Regione`, `Provincia`, `Settore`, `Divisione`, `Classe`, `Sottocategoria`, `Addetti`, `Localizzazioni Attive`.
- metadati e caveat ufficiali: <https://opendata.marche.camcom.it/pivot-table.htm?indic=Addetti%26geo%3DItalia>.

Ogni riga del CSV è un bucket ATECO osservato distinto, anche quando condivide
regione, provincia, settore e divisione con righe a maggiore specificità. La
pipeline non sceglie una riga canonica e non scarta classi o sottocategorie:
somma tutti i bucket provinciali a regione × sezione ATECO. Le celle prive di
righe sorgente restano `null`, non vengono trasformate in zero.

Il risultato non è un elenco di lavoratori o di imprese: è un aggregato
regionale per sezione. Le posizioni previdenziali attive sono riferite al
trimestre precedente a quello indicato; non rappresentano il livello di
occupazione nel territorio e non sono direttamente comparabili con ISTAT/ASIA.

### Fasce di valore della produzione

- URL: <https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia-Valore-Produzione.json>
- pubblicatore indicato: CCIAA Marche su dati InfoCamere;
- ultimo aggiornamento osservato: `2026-01-23`;
- periodo acquisito: `2025-12-31`;
- fasce: da `NEG` a `50M_OVER`;
- dimensioni usate: regione, sezione ATECO 2025, fascia.

La fonte tratta il valore della produzione derivato dai bilanci depositati. Il
modulo mostra i conteggi per fascia. Non li chiama fatturato, non li chiama
ricavi esatti e non li usa per identificare o ordinare singole società.

### Fatturato aggregato delle imprese (ISTAT)

- URL: <https://www.istat.it/wp-content/uploads/2026/03/Tavole20marzo2026.zip>
- landing page: <https://www.istat.it/tavole-di-dati/stima-anticipata-dei-dati-economici-delle-imprese-a-livello-territoriale-il-registro-frame-territoriale-anticipato-anno-2024/>
- pubblicatore: Istituto Nazionale di Statistica (ISTAT);
- lavoro: Stima anticipata dei dati economici delle imprese a livello territoriale - Registro Frame Territoriale Anticipato - Anno 2024 (Tavola 1 e Tavola 2);
- licenza: Creative Commons Attribution 4.0 International (CC BY 4.0);
- integrità archivio: ZIP ufficiale verificato con 393.392 byte e SHA-256 `d774bcd5862467aa0a7529b8b972f3fd80f85f14f7993aaf355362596960ad04`;
- periodo: `2024`;
- classificazione: `ATECO 2007 agg. 2022` (mantenuta rigorosamente distinta da `ATECO 2025` delle fonti camerali);
- unità di misura: `migliaia di euro`;
- perimetro e copertura: unità locali di imprese con almeno un dipendente (Registro Frame Territoriale Anticipato 2024); non è l'universo completo delle sedi attive;
- granularità: 20 regioni italiane e macro-settori economici (`ALL`, `INDUSTRIA`, `SERVIZI`);
- riconciliazione: Totale e macro-settori sono letti dalle tavole ufficiali pubblicate separatamente; differenze di pochi migliaia di euro tra somme e totale sono mantenute e possono riflettere gli arrotondamenti della fonte;
- garanzia non-nominativa: nessun dato a livello di singola azienda, nessuna partita IVA o codice fiscale, nessun fatturato individuale.

Il file generato è `src/data/generated/istat-enterprise-turnover-2024.json`. Il comando
`python3 scripts/etl/istat_enterprise_turnover.py` genera lo snapshot, e con `--check`
ne valida offline l'integrità matematica, la copertura e le riconciliazioni formali.

## Contratto UI e MCP

Le metriche territoriali disponibili sono:

- `active_enterprises` (CCIAA Marche / InfoCamere, ATECO 2025);
- `employees` (CCIAA Marche / InfoCamere, ATECO 2025);
- `active_local_units` (CCIAA Marche / InfoCamere, ATECO 2025);
- `production_value_band_count` (CCIAA Marche / InfoCamere, ATECO 2025);
- `turnover` (ISTAT Frame Territoriale Anticipato, ATECO 2007 agg. 2022, migliaia di euro).

La pagina principale `/imprese` adatta automaticamente filtri, classificazione e metadati
in base alla fonte selezionata.

Il catalogo MCP espone quattro dataset business:

- `company_active_enterprises`;
- `company_workforce`;
- `company_production_value_bands`;
- `company_turnover_istat`.

Le risposte MCP sono limitate a 100 righe per pagina e contengono dati, periodo,
query normalizzata, provenienza e caveat. Il server è read-only e non espone
dati personali.

## Evoluzione prevista

Questo modulo è deliberatamente più piccolo di un registro imprese: prima
stabilisce contratto, provenienza e lettura territoriale. Un eventuale dataset
entity-level richiederebbe una fonte e una licenza specifiche, policy per
correzioni e rettifiche, controlli di aggiornamento e una valutazione separata
di privacy e uso commerciale.
