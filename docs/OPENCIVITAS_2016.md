# OpenCivitas 2016 — Comuni, servizi totali (FC30TOT)

Refs #537, parent #282. Ultima annualità mancante della serie «servizi totali»:
fonte `opencivitas`, API `/api/spese/opencivitas-2016`, dataset MCP
`opencivitas_fabbisogni_2016`. Nessuna UI in questa tranche.

## Identità e acquisizione

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2016-comuni-servizi-totali-indicatori-e-determinanti)
dichiara periodo 2016, pubblicazione e ultima modifica 23 maggio 2019, **versione 1**
(«nessuna variazione»), licenza CC BY 4.0 dal badge della scheda, autore ed editore
SOSE, titolare dei diritti il **Dipartimento delle Finanze** e frequenza irregolare.

Come per il 2015, il titolare è il Dipartimento delle Finanze e non la Ragioneria
Generale dello Stato: il valore resta quello dichiarato dalla scheda.

Acquisizione e verifica: 16 settembre 2026, TLS verificato.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [CSV indicatori](https://docs.opencivitas.it/2016_Ind_FC30TOT_1_csv.zip) | 4.588.520 | `b9285a8e66f94e263abb172cce9110074f73afe5342ed3c6e9b9351a42eebdb9` |
| [Metadati indicatori](https://docs.opencivitas.it/2016_Metadati_Ind_FC30TOT_1_xlsx.zip) | 8.462 | `55b17aeeca6d55f360124e9e1f819d147a9e4660831c5eca70c00f87df962986` |
| [Metadati enti](https://docs.opencivitas.it/Metadati_Enti_2016_xlsx.zip) | 340.961 | `ad515515a0e4a646b68d6a9fdb8f28b77251b80a5fc134a7f196b3abb83a0b79` |

## Stesse tre particolarità del 2015

1. **CSV in cp1252**, non UTF-8: 1.484 righe contengono il byte `0xE0` (la «à» di
   «Viabilità») nel campo dei motivi di non valutabilità.
2. **Punto decimale**, non virgola.
3. **Fabbisogno standard riproporzionato sul totale nazionale della spesa storica**:
   33.206.859.578,09 € di spesa storica contro 33.206.859.575,09 € di fabbisogno,
   **3,00 € di scarto** su 33,2 miliardi, dovuto solo all'arrotondamento al centesimo
   di ogni Comune. La differenza aggregata è nulla per costruzione e non è un
   risultato; l'invariante è vincolata nella spec e verificata dall'ETL.

Codifica e separatore sono parametri del rilascio in `opencivitas_common.py` dal
merge della fetta 2015 (#533): questa fetta li dichiara nella propria spec e non
tocca il modulo condiviso.

## La serie completa

| Anno | Famiglia | Comuni | Spesa storica | Fabbisogno standard | Standard vs storica |
| --- | --- | ---: | ---: | ---: | ---: |
| 2015 | FC20TOT v2 | 6.664 | 33,544 Mld€ | 33,544 Mld€ | 0,000% |
| **2016** | **FC30TOT v1** | **6.647** | **33,207 Mld€** | **33,207 Mld€** | **0,000%** |
| 2017 | FC40TOT v1 | 6.627 | 33,521 Mld€ | 34,179 Mld€ | +1,962% |
| 2018 | FC50TOT v1 | 6.606 | 34,221 Mld€ | 34,878 Mld€ | +1,922% |
| 2019 | FC60TOT v2 | 6.567 | 34,883 Mld€ | 35,541 Mld€ | +1,885% |
| 2021 | FC70TOT v1 | 6.565 | 37,112 Mld€ | 37,769 Mld€ | +1,772% |
| 2022 | FC80TOT v2 | 6.557 | 38,795 Mld€ | 38,795 Mld€ | 0,000% |

Il riproporzionamento nazionale vale per 2015, 2016 e 2022; negli altri anni lo
standard supera la storica di circa il 2%. Il 2020 non esiste nell'indice ufficiale
e non viene ricostruito. Le annualità restano separate: nessuna somma né confronto
silenzioso.

## Perimetro pubblicato

6.647 Comuni delle 15 Regioni a statuto ordinario. Le 30 entità senza anagrafica sono
gli aggregati `ZZ999…` esclusi anche dagli altri anni. I metadati contengono 25
definizioni nel foglio `Indicatori_FC30TOT_2016` e i nove indicatori DVNS hanno
descrizione, funzione `TOTALE`, lingua `IT` e tipo `FS`/`LQP` verificati.

Nessuna anomalia e nessun flag privacy sui nove indicatori, nessun codice ISTAT
duplicato. Il livello di spesa è assente per **109** Comuni e quello dei servizi per
**190**, con i motivi pubblicati dalla fonte (`cod_sps_noval` 109; `cod_no_quest` 173,
`cod_out_noval` 9, `cod_out_noval_nospesa` 8), distinti dallo zero. Rispetto al 2015
(31 e 49) la copertura degli indicatori di livello è quindi sensibilmente più bassa:
è un dato della fonte, non una scelta della pipeline.

## Significato e limiti

La differenza fra spesa storica e spesa standard non è spreco; i livelli 0–10 non sono
un ranking di efficienza; gli euro per abitante sono quelli pubblicati, senza
popolazioni ricostruite. RSS e Province autonome restano fuori perimetro.

## Percorso tecnico

```bash
python scripts/etl/opencivitas_2016_snapshot.py --input-dir /percorso/degli/zip-ufficiali
python scripts/etl/opencivitas_2016_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_opencivitas_2016_snapshot.py'
node --experimental-strip-types --test tests/opencivitas-2016-contract.test.mjs tests/opencivitas-2016-route.test.mjs
```
