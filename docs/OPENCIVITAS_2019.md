# OpenCivitas · servizi totali 2019

Fetta della [issue #282](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282):
**FC60TOT 2019, versione 2**, 6.567 Comuni delle 15 Regioni a statuto ordinario.
L'epica resta aperta per altre annualità ufficiali e funzioni. Nessuna nuova UI,
graduatoria di efficienza o serie ottenuta sommando gli anni.

## Fonte e periodo

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2019-comuni-servizi-totali-indicatori-e-determinanti)
dichiara periodo 2019, pubblicazione 30 maggio 2023, ultima modifica 30 maggio
2024 e versione 2, che aggiorna la non valutabilità di spesa e servizi.
Autore/editore: SOSE; titolare dei diritti: Ragioneria Generale dello Stato.
Licenza CC BY 4.0, aggiornamento irregolare. Acquisizione DVNS: 8 settembre 2026;
la data di acquisizione non sostituisce pubblicazione o ultima modifica.

Il [lock dichiarato prima del codice](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/282#issuecomment-5578084281)
è versionato in `scripts/etl/specs/opencivitas-2019.source.json`:

| Archivio ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [Dati CSV](https://docs.opencivitas.it/2019_Ind_FC60TOT_2_csv.zip) | 4.631.408 | `5292914fcbda4b26047020fa11bc9cdca70ff7cf93e5b4a0bd33b5153cb1a8d1` |
| [Metadati indicatori](https://docs.opencivitas.it/2019_Metadati_Ind_FC60TOT_2_xlsx.zip) | 8.919 | `63bbd57d9106934a03da81e2ede394c51549b98e5aee8b170c2c14bd2f2c6cf7` |
| [Metadati enti](https://docs.opencivitas.it/Metadati_Enti_2019_xlsx.zip) | 423.591 | `bae9771f05dbaf05686553ab5c3110d7b0eb5083c0e3322fb960afff09c1a30c` |

I download mantengono la verifica TLS e il certificato intermedio pubblico
descritto in `scripts/etl/certs/README.md`.

## La lacuna 2020

La ricognizione dell'[indice ufficiale](https://www.opencivitas.it/it/open-data)
ha letto tutte le 55 pagine (271 link dataset distinti) l'8 settembre 2026.
Per i servizi totali comunali risultano 2015, 2016, 2017, 2018, 2019, 2021 e
2022. La [pagina 8 dell'indice](https://www.opencivitas.it/it/open-data?page=7)
passa dal 2021 al 2019. I due dataset con prefisso 2020 riguardano il Fondo di
solidarietà comunale, un perimetro diverso. La URL 2020 con il formato delle
annualità integrate rispondeva 404. Questo documenta la release non trovata nel
catalogo consultato, senza dedurne l'inesistenza di qualsiasi dato 2020.
FC60TOT è verificato come 2019 dai metadati e dalla scheda, non inferito dal nome.

## Contratto e denominatori

Il CSV ha cinque colonne: `USERNAME`, `Indicatore/Determinante`, `Valore`,
`Anomalia`, `Privacy`. Contiene 606.924 righe, 92 codici per 6.597 entità.
Trenta entità `ZZ999…` sono aggregati di Italia, regioni, aree e fasce: la spec
li enumera e il join li esclude. Qualsiasi altra entità sconosciuta blocca l'ETL.

Il join usa `USERNAME` dei metadati per ottenere il codice ISTAT del Comune a
sei cifre. Le 390 righe comunali siciliane nei metadati non hanno indicatori in
questa fetta; RSS e Province autonome restano fuori perimetro. La copertura è
riconciliata esattamente per ciascuna delle 15 RSO. Le 325 denominazioni
`EMILIA ROMAGNA` e le tre `EMILIA-ROMAGNA` sono ricondotte alla seconda forma,
coerente con il resolver territoriale già usato dal prodotto.

I nove indicatori esposti hanno codici e descrizioni verificati separatamente
nei metadati FC60 e FC70. Le primitive tabulari, numeriche e del modello comunale
sono condivise; pin, metadati, periodo, copertura e contratti restano distinti.
Gli artifact 2021/2022 e i loro digest restano invariati. Il binario è lo snapshot
tipizzato storico già adottato per OpenCivitas, senza duplicare tabelle nel corpus
integrato o importarle nei Client Component.

- Spesa storica e standard: euro ufficiali convertiti in centesimi, con
  arrotondamento al centesimo più vicino. La differenza è storica meno standard.
- Euro per abitante: valori ufficiali; i rapporti totale/pro capite devono
  riconciliarsi fra storica e standard entro un errore relativo di un milionesimo.
  Non viene pubblicata una popolazione ricostruita.
- Differenza percentuale di spesa: `(storica − standard) / standard`, con
  denominatore standard positivo, espressa in punti base.
- Differenza dei servizi: percentuale ufficiale rispetto alla media dei Comuni
  della medesima fascia di popolazione, convertita in punti base.
- Livelli spesa/servizi: scala della fonte 0–10; non è una graduatoria di
  efficienza. Motivi di non valutabilità conservati come testo o `null`.

Nei nove indicatori selezionati non sono presenti flag. Flag di anomalia/privacy
inattesi, indicatori mancanti, duplicati, importi principali assenti e denominatori
non riconciliati bloccano la generazione. Uno zero osservato resta zero; un valore
opzionale vuoto resta `null`. Le altre variabili del CSV, incluse quelle con flag,
non sono esposte. Nessuna differenza viene interpretata come spreco.

## Riproduzione e consumo

```bash
PYTHONPATH=scripts/etl python scripts/etl/opencivitas_2019_snapshot.py --input-dir /directory/dei/tre/zip
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python scripts/etl/opencivitas_2019_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_opencivitas*'
node --experimental-strip-types --test tests/opencivitas-2019-contract.test.mjs tests/opencivitas-2019-route.test.mjs
```

La generazione non usa rete, verifica i tre ZIP e non riscrive uno snapshot
semanticamente identico. Python e TypeScript verificano indipendentemente un
digest dell'intero artifact, esclusi soltanto timestamp di acquisizione coerenti
e con fuso. Il pin protegge anche unità, null, metadati, caveat e modifiche
aritmeticamente coerenti. Un rilascio diverso richiede nuovo lock e review.

API: `/api/spese/opencivitas-2019?codice=058091&anno=2019`.
MCP: `opencivitas_fabbisogni_2019`, con `code` oppure `region`, `year: 2019`
facoltativo, `limit` 1–100 e `offset` 0–100000. Entrambi usano lo stesso selettore,
ordinato per codice ISTAT. Parametri ignoti/ripetuti, filtri vuoti e anni diversi
sono rifiutati; un codice non presente restituisce un risultato vuoto con
copertura e caveat, senza imputare valori. La prova HTTP reale API/MCP e i casi
di anno errato sono nel runner produzione `scripts/mcp_http_smoke.mjs`.
