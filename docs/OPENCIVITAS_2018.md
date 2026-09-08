# OpenCivitas · servizi totali 2018

Fetta della [issue #282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282):
**FC50TOT 2018, versione 1**, 6.606 Comuni delle 15 Regioni a statuto ordinario.
Snapshot + API/MCP, senza UI. L'epica resta aperta per altre annualità e funzioni.

## Fonte e lock

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2018-comuni-servizi-totali-indicatori-e-determinanti)
dichiara periodo 2018, pubblicazione e ultima modifica **14 febbraio 2022**,
versione 1 (nessuna variazione), autore/editore SOSE, titolare Ragioneria Generale
dello Stato, CC BY 4.0 e frequenza irregolare. Acquisizione DVNS: 8 settembre 2026.
Queste date non sono intercambiabili.

Il [lock dichiarato prima del codice](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282#issuecomment-5579591808)
è versionato in `scripts/etl/specs/opencivitas-2018.source.json`:

| Archivio ufficiale | Byte ZIP | SHA-256 |
| --- | ---: | --- |
| [Dati](https://docs.opencivitas.it/2018_Ind_FC50TOT_1_csv.zip) | 4649896 | `78107746fe7edac1791ac61d3d6b09ba5bd4d65f80db896c1c6c450e5bca55c0` |
| [Enti](https://docs.opencivitas.it/Metadati_Enti_2018_xlsx.zip) | 340823 | `91a5ecfb4f0d5d1842e23eb46b30191e373ee5e8b035fcae0326d846fab6b392` |
| [Indicatori](https://docs.opencivitas.it/2018_Metadati_Ind_FC50TOT_1_xlsx.zip) | 8906 | `a3e081eed7039b7507130876dbdea5b324a30b4a5d443e669f2a9700c9306c8d` |

TLS resta verificato con il certificato intermedio pubblico descritto in
`scripts/etl/certs/README.md`. Generazione e controlli usano i byte locali pinned.

## Contratto annuale e riuso verificato

FC50 contiene 603.876 righe CSV, 91 codici e 6.636 entità. Trenta aggregati
`ZZ999…` di Italia, aree, regioni e fasce non sono Comuni: sono enumerati ed
esclusi. Il join usa USERNAME → codice ISTAT comunale a sei cifre dai metadati
ufficiali; nessuna geografia dedotta dai nomi o RSS imputata. I 331 Comuni con
regione `EMILIA ROMAGNA` usano la forma prodotto `EMILIA-ROMAGNA`. La copertura
è verificata separatamente per ciascuna RSO, non confrontata con l'anagrafica odierna.

I metadati FC50 hanno **25 definizioni**, contro le 27 del FC60 2019. I nove
indicatori esposti hanno codici, descrizioni, unità, lingua IT, funzione TOTALE
e tipi FS/LQP verificati nei byte 2018. Sono quindi riutilizzate le primitive
numeriche, tabulari e del modello comunale; il contratto annuale e i pin restano
indipendenti. La fixture di Roma deriva dal CSV 2018, non dal 2019.
FC50 non ha `FL_NO_CONFRONTO_SPESA` e `FL_NO_CONFRONTO_OUT`; inoltre
`SERV_NO_VALUT_SPESA_TOT` e `SERV_NO_VALUT_OUT_TOT` sono NAVIGA, mentre in FC60
sono LQP con descrizioni diverse. Queste variabili non vengono importate né
confuse con i due indicatori selezionati `DESCR_NON_VALUTABILE_*`.

Nel 2018 sette Comuni conservano `cod_no_quest` come motivo servizi; quattro
hanno anche `cod_sps_noval` come motivo spesa. Sono codici testuali della fonte,
conservati senza traduzioni inferite. Nel 2019 i due motivi sono sempre `null`:
questa differenza annuale è coperta dai test, senza riempire o cancellare celle.

- Spesa storica e standard: euro convertiti in centesimi con arrotondamento al
  centesimo più vicino; differenza storica meno standard.
- Euro per abitante: valori ufficiali, riconciliati fra storica e standard con
  tolleranza relativa di un milionesimo. Nessuna popolazione ricostruita pubblicata.
- Differenza spesa: `(storica − standard) / standard`, denominatore standard
  positivo, espressa in punti base.
- Differenza servizi: percentuale ufficiale rispetto alla media della stessa
  fascia di popolazione, convertita in punti base; non è la differenza di spesa.
- Livelli spesa/servizi: scala ufficiale 0–10; motivi di non valutabilità come
  testo o `null`. Nessun ranking di efficienza e nessuna inferenza di spreco.

Nei nove indicatori selezionati non ci sono flag. Privacy/anomalia inattese,
importi principali assenti, duplicati, indicatori mancanti, metadati divergenti
e denominatori non riconciliati bloccano la generazione. Uno zero resta zero;
una cella opzionale vuota resta `null`. Le altre variabili non vengono esposte.

Il binario è lo snapshot tipizzato storico già adottato per OpenCivitas, senza
creare copie di pagina o tabelle parallele nel corpus integrato. Gli snapshot
2019/2021/2022 restano invariati; nessuna somma o confronto silenzioso fra anni.
La lacuna 2020 documentata nella fetta 2019 non viene ricostruita.

## Riproduzione e superfici

```bash
PYTHONPATH=scripts/etl python3 scripts/etl/opencivitas_2018_snapshot.py --input-dir /directory/dei/tre/zip
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/opencivitas_2018_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_opencivitas*'
node --experimental-strip-types --test tests/opencivitas-2018-contract.test.mjs tests/opencivitas-2018-route.test.mjs
```

Python e TypeScript verificano indipendentemente il digest dell'intero artifact;
sono esclusi solo timestamp di acquisizione coerenti e con fuso. I file di una
nuova release richiedono nuovo lock e review, senza aggiornamenti silenziosi.

API: `/api/spese/opencivitas-2018?codice=058091&anno=2018`.
MCP: `opencivitas_fabbisogni_2018`, `code` oppure `region`, `year: 2018`
facoltativo, `limit` 1–100 e `offset` 0–100000. Selettore comune API/MCP,
ordinamento ISTAT; filtri ignoti/ripetuti, vuoti e anni diversi sono rifiutati.
Un codice assente restituisce risultato vuoto, copertura e caveat.
Lo smoke produzione `scripts/mcp_http_smoke.mjs` verifica API e MCP HTTP reali,
provenance e rifiuto di 2019/2020/2021/2022 sul dataset 2018.
