# OpenCivitas 2021 FC70TOT

Il contratto snapshot separato segue il perimetro approvato in issue #282: fonte,
API e MCP per i servizi totali dei Comuni RSO, senza UI. Il 2022 FC80TOT resta
un dataset distinto. Differenza tra spesa storica e standard non significa spreco.

I tre ZIP ufficiali sono vincolati agli SHA-256 presenti nel generatore e nella
provenienza. La riproduzione del rilascio verifica 6.565 Comuni in 15 regioni.
I contratti Python e TypeScript verificano anche il digest semantico SHA-256
`bab851fd276d3568269f641cd62a85065a0be7366ae11538973917586f2c8234`:
JSON con chiavi ordinate, UTF-8, senza spazi; esclusi solo `generatedAt` e
`source.observedAt`. Una variazione della fonte richiede revisione esplicita dei
raw e del digest, non un aggiornamento automatico del pin.

La licenza della scheda ufficiale è CC BY 4.0; pubblicazione 30 maggio 2024,
riferimento economico 2021. Le date di acquisizione restano distinte.

API: `/api/spese/opencivitas-2021?regione=Lazio&limit=20&offset=0`.
MCP `query_dataset`: `dataset=opencivitas_fabbisogni_2021`, `region=Lazio`,
`year=2021`, `limit=20`, `offset=0`. In alternativa usare `codice` nell'API
e `code` nel tool, con codice ISTAT comunale di sei cifre.

Serve almeno regione o codice. La pagina contiene al massimo 100 Comuni;
`pagination.total` descrive i risultati filtrati, `coverage` l'intero rilascio.
Offset ammesso 0–100000. Parametri sconosciuti, ripetuti, vuoti o annualità
diverse producono un errore; gli errori HTTP non sono memorizzabili in cache.

Riproduzione offline con i tre ZIP verificati:

```sh
python scripts/etl/opencivitas_2021_snapshot.py --data-zip 2021_Ind_FC70TOT_1_csv.zip --entities-zip Metadati_Enti_2021_xlsx.zip --indicators-zip 2021_Metadati_Ind_FC70TOT_1_xlsx.zip
python scripts/etl/opencivitas_2021_snapshot.py --check
```
