# OpenCivitas 2022 — Amministrazione (FC80AMMIN)

Refs #591, parent #282. Quarta funzione comunale dopo Rifiuti, Viabilità e territorio
e Sociale e asili nido: fonte `opencivitas`, API
`/api/spese/opencivitas-2022-amministrazione`, dataset MCP
`opencivitas_amministrazione_2022`. Nessuna UI in questa tranche.

## Identità e acquisizione

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2022-comuni-amministrazione-indicatori-e-determinanti)
dichiara periodo 2022, pubblicazione e ultima modifica 16 giugno 2025, versione 1
(«nessuna variazione»), licenza CC BY 4.0, titolare dei diritti la Ragioneria Generale
dello Stato e frequenza irregolare.

Acquisizione e verifica: 22 settembre 2026, TLS verificato.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [CSV indicatori](https://docs.opencivitas.it/2022_Ind_FC80AMMIN_1_csv.zip) | 1.783.464 | `5ff2ccea482e07b3949c955b52f66ffe8d779ab9356b2b4e324677b9dc24e165` |
| [Metadati indicatori](https://docs.opencivitas.it/2022_Metadati_Ind_FC80AMMIN_1_xlsx.zip) | 11.880 | `5d1fd326a5d81eb7501f20db2251ebe5f015a58ed77ce54a792455124013b946` |
| [Metadati enti](https://docs.opencivitas.it/Metadati_Enti_2022_xlsx.zip) | 518.899 | `9f50652797ed5080d31291cb7a1c74fad74b37189ac19d2cac2921a2939ed6a1` |

I metadati enti sono gli stessi già vincolati dalle altre fette 2022, con identici byte
e hash.

## Perimetro pubblicato

Il CSV è UTF-8 con separatore decimale virgola, 263.480 righe, 40 codici e 6.587 entità.
I metadati dichiarano 35 definizioni, tutte con `VAR_IND_FUNZIONE = AMMINISTRAZIONE`.

Le 30 entità senza anagrafica sono gli aggregati `ZZ999…` esclusi anche dalle altre
fette; restano 6.557 Comuni delle 15 Regioni a statuto ordinario, di cui **6.548
pubblicati**.

**Le descrizioni degli indicatori non sono riusabili fra funzioni**: qui i livelli sono
«Livello della spesa - da 0 a 10» con la *d minuscola*, mentre in FC80SOCNID sono «Da 0
a 10». Il lock blocca le stringhe esatte di questo rilascio.

## Le tre particolarità del rilascio

### 1. Nove Comuni senza spesa storica

`SPESA_STORICA` e `SPESA_STORICA_PROAB` sono vuote — con il fabbisogno invece presente —
per `CH013SIF11AX`, `CS052SIF11BP`, `CZ138SIF11KN`, `PE003SIF11JR`, `PE008SIF11JW`,
`RC040SIF11KA`, `VC003SIF11IO`, `VC045SIF11JM` e `VC089SIF11KI`. Restano esclusi e
dichiarati nella spec, senza imputazione a zero, come già fatto per Sociale e asili nido.

### 2. Il fabbisogno riproporziona, ma sull'insieme completo

Sui 6.557 Comuni joinati la somma del fabbisogno standard coincide con quella della
spesa storica: 8.622.765.613,16 € contro 8.622.765.613,05 €, **0,11 € di scarto** da
arrotondamento al centesimo, e l'aggregato `ZZ999ITA001` pubblicato dalla fonte dichiara
8.622.765.612,90 € su entrambi i lati.

L'uguaglianza vale però **prima** dell'esclusione: i nove Comuni senza spesa storica
portano **3,20 milioni** di fabbisogno senza contropartita, quindi sui 6.548 Comuni
pubblicati il fabbisogno resta inferiore alla spesa storica esattamente di quell'importo.
La differenza aggregata non è quindi un risparmio né uno spreco: è il residuo
dell'esclusione. Entrambi i lati sono vincolati nella spec e verificati dall'ETL, che si
blocca se il rapporto cambia.

### 3. Due anomalie dichiarate dalla fonte

`DIFF_OUT_PERC` ha il flag di anomalia per i Comuni `018105` e `054045`: la differenza
dei servizi resta `null` e il motivo della fonte finisce in `sourceWarnings`, senza
valori inventati.

## Non valutabilità

Nove Comuni senza livello di spesa (`cod_sps_noval`) — gli stessi esclusi — e 356
Comuni pubblicati senza livello dei servizi (`cod_no_quest` in larga maggioranza, più
`cod_out_noval_nospesa` e `cod_out_noval`). Restano `null`, distinti dallo zero.

## Significato e limiti

La differenza fra spesa storica e spesa standard non è spreco; i livelli 0–10 non sono un
ranking di efficienza; gli euro per abitante sono quelli pubblicati dalla fonte. La
funzione Amministrazione è distinta da FC80TOT (servizi totali) e dalle altre funzioni:
non si somma né si confronta in silenzio, né fra funzioni né fra annualità.

## Percorso tecnico

```bash
python scripts/etl/opencivitas_2022_amministrazione_snapshot.py --input-dir /percorso/degli/zip-ufficiali
python scripts/etl/opencivitas_2022_amministrazione_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_opencivitas_2022_amministrazione_snapshot.py'
node --experimental-strip-types --test tests/opencivitas-2022-amministrazione-contract.test.mjs tests/opencivitas-2022-amministrazione-route.test.mjs
```
