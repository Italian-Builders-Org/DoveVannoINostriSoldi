# OpenCivitas · servizi totali 2017

Fetta della [issue #282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282):
**FC40TOT 2017, versione 1**, 6.627 Comuni delle 15 Regioni a statuto ordinario.
Snapshot + API/MCP, senza UI. L'epica resta aperta per altre annualità e funzioni.

## Fonte e lock

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2017-comuni-servizi-totali-indicatori-e-determinanti)
dichiara periodo 2017, pubblicazione e ultima modifica **15 marzo 2021**,
versione 1 (nessuna variazione), autore/editore SOSE, titolare Ragioneria Generale
dello Stato, CC BY 4.0 e frequenza irregolare. Acquisizione DVNS: 12 settembre 2026.
Periodo, pubblicazione e acquisizione restano date distinte.

| Archivio ufficiale | Byte ZIP | SHA-256 |
| --- | ---: | --- |
| [Dati](https://docs.opencivitas.it/2017_Ind_FC40TOT_1_csv.zip) | 5368963 | `266a1dd568df603039e0615cbbf6e9f9484abaeaa03b0dce0deca1ded35729d6` |
| [Enti](https://docs.opencivitas.it/Metadati_Enti_2017_xlsx.zip) | 345720 | `49fcf34d7381d9fc7613a00bc890c033d3742a95efc54377c3ec6f5295a0c854` |
| [Indicatori](https://docs.opencivitas.it/2017_Metadati_Ind_FC40TOT_1_xlsx.zip) | 8989 | `df9a1565e197dc9b0e1edda20ef61bf1cca4c6909b162e2c3397c3a86da4e282` |

La verifica TLS resta attiva e aggiunge solo il certificato intermedio pubblico
descritto in `scripts/etl/certs/README.md`. I controlli offline usano i byte locali
vincolati in `scripts/etl/specs/opencivitas-2017.source.json`.

## Contratto

FC40 contiene 605.787 righe CSV, 91 codici e 6.657 entità. Trenta aggregati
`ZZ999…` di Italia, aree, regioni e fasce sono enumerati ed esclusi. Il join usa
USERNAME → codice ISTAT a sei cifre dai metadati ufficiali. Le RSS e le Province
autonome sono fuori perimetro; la copertura delle RSO è verificata per regione.
La grafia `EMILIA ROMAGNA` della fonte è riconciliata esplicitamente con
`EMILIA-ROMAGNA` usata dal prodotto.

I metadati FC40 contengono 25 definizioni. I nove indicatori esposti coincidono
con FC50 per codice, descrizione, lingua, funzione e tipo; si riusano quindi le
primitive tabulari, numeriche e del modello comunale, mentre pin e contratto
annuale restano indipendenti. Nei nove indicatori non ci sono flag anomalia o
privacy. Flag inattesi, duplicati, valori principali mancanti e riconciliazioni
rotte bloccano la generazione. Zero e cella opzionale vuota restano distinti.

Gli importi in euro sono convertiti in centesimi. Gli importi per abitante sono
quelli ufficiali e non pubblicano una popolazione ricostruita. La differenza
servizi usa la media dei Comuni della stessa fascia demografica; la differenza
tra spesa storica e standard non prova spreco. I livelli 0–10 non sono una
graduatoria di efficienza. Le annualità 2017, 2018, 2019, 2021 e 2022 restano
separate e il 2020 non viene ricostruito.

## Riproduzione e superfici

```bash
PYTHONPATH=scripts/etl python3 scripts/etl/opencivitas_2017_snapshot.py --input-dir /directory/dei-tre-zip
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/opencivitas_2017_snapshot.py --check
node --experimental-strip-types --test tests/opencivitas-2017-contract.test.mjs tests/opencivitas-2017-route.test.mjs
```

API: `/api/spese/opencivitas-2017?codice=058091&anno=2017`.
MCP: `opencivitas_fabbisogni_2017`, con `code` oppure `region`, anno 2017
facoltativo e paginazione. API e MCP condividono il selettore server; filtri
ignoti o ripetuti, richieste senza perimetro e annualità diverse sono rifiutati.
