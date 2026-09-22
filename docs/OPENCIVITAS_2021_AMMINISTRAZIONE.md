# OpenCivitas 2021 — Amministrazione (FC70AMMIN)

Refs #602, parent #282. Annualità precedente della funzione già integrata per il 2022
(#591): fonte `opencivitas`, API `/api/spese/opencivitas-2021-amministrazione`, dataset
MCP `opencivitas_amministrazione_2021`. Nessuna UI in questa tranche.

## Identità e acquisizione

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2021-comuni-amministrazione-indicatori-e-determinanti)
dichiara periodo 2021, pubblicazione e ultima modifica 30 maggio 2024, versione 1
(«nessuna variazione»), licenza CC BY 4.0, titolare dei diritti la Ragioneria Generale
dello Stato e frequenza irregolare.

Acquisizione e verifica: 22 settembre 2026, TLS verificato.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [CSV indicatori](https://docs.opencivitas.it/2021_Ind_FC70AMMIN_1_csv.zip) | 2.240.179 | `26d3eb84d5e17db86827d7a6c7fa20e52e58e51fbc379b6117bea3fb0d291ab1` |
| [Metadati indicatori](https://docs.opencivitas.it/2021_Metadati_Ind_FC70AMMIN_1_xlsx.zip) | 6.896 | `75b23ba6108787a9afd231a1aa013d0c987c1898263920b003470d3d4833b811` |
| [Metadati enti](https://docs.opencivitas.it/Metadati_Enti_2021_xlsx.zip) | 429.597 | `ef1a547c281b0f47ed9b5d6fd17b8919eff3ad5eaae163ed2bf108ba02eca83b` |

## Due differenze dal rilascio 2022, entrambe dichiarate nel lock

### Il CSV è in cp1252, non UTF-8

Il rilascio 2021 pubblica il CSV in cp1252, mentre quello 2022 è UTF-8. La codifica è un
parametro del rilascio, letto dalla spec: **nessun ripiego automatico** fra le due, così
un file che non corrisponde fallisce invece di essere interpretato a caso. È la stessa
scelta già adottata per i servizi totali 2015 e 2016, dove la codifica cambia nello stesso
modo fra annualità della stessa serie.

### Quindici Comuni senza spesa storica

`SPESA_STORICA` e `SPESA_STORICA_PROAB` sono vuote con il fabbisogno presente per 15
Comuni (erano 9 nel 2022). Restano esclusi e dichiarati nella spec, senza imputazione a
zero: i Comuni pubblicati sono **6.550** sui 6.565 joinati.

## Confronto con la stessa funzione nel 2022

| | **FC70AMMIN 2021** | FC80AMMIN 2022 |
| --- | --- | --- |
| Codifica CSV | **cp1252** | UTF-8 |
| Righe / codici | 356.130 / 54 | 263.480 / 40 |
| Definizioni indicatori | 49 | 35 |
| Comuni joinati | 6.565 | 6.557 |
| Esclusi senza spesa storica | 15 | 9 |
| Comuni pubblicati | 6.550 | 6.548 |
| Anomalie su `DIFF_OUT_PERC` | nessuna | 2 |
| Senza livello dei servizi | 255 | 356 |
| Spesa storica | 8,143 Mld€ | 8,623 Mld€ |
| Scarto del riproporzionamento | 3 centesimi | 11 centesimi |

Le due annualità **non si sommano e non si confrontano in silenzio**: sono contratti
distinti, come fra funzioni diverse.

## Riproporzionamento del fabbisogno

Sui 6.565 Comuni joinati la somma del fabbisogno standard coincide con quella della spesa
storica a meno di **3 centesimi** su 8,14 miliardi. L'uguaglianza vale prima
dell'esclusione: i quindici Comuni esclusi portano **13,95 milioni** di fabbisogno senza
contropartita, quindi sui 6.550 pubblicati il fabbisogno resta inferiore alla spesa
storica esattamente di quell'importo. La differenza aggregata è il residuo
dell'esclusione, non un risparmio: l'invariante è vincolata nella spec e verificata
dall'ETL, che si blocca se il rapporto cambia.

## Qualità del rilascio

Nessuna anomalia e nessun flag privacy dichiarati dalla fonte su questo rilascio. 255
Comuni pubblicati non hanno livello dei servizi, con i motivi di non valutabilità della
fonte: restano `null`, distinti dallo zero. Le 30 entità senza anagrafica sono gli
aggregati `ZZ999…` esclusi anche altrove.

## Significato e limiti

La differenza fra spesa storica e spesa standard non è spreco, i livelli 0–10 non sono un
ranking di efficienza, e gli euro per abitante sono quelli pubblicati dalla fonte, senza
popolazioni ricostruite. RSS e Province autonome restano fuori perimetro.

## Percorso tecnico

```bash
python scripts/etl/opencivitas_2021_amministrazione_snapshot.py --input-dir /percorso/degli/zip-ufficiali
python scripts/etl/opencivitas_2021_amministrazione_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_opencivitas_2021_amministrazione_snapshot.py'
node --experimental-strip-types --test tests/opencivitas-2021-amministrazione-contract.test.mjs tests/opencivitas-2021-amministrazione-route.test.mjs
```
