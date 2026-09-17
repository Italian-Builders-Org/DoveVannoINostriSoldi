# OpenCivitas 2015 — Comuni, servizi totali (FC20TOT)

Refs #282. Fetta 2015 dell'epica OpenCivitas: fonte `opencivitas`, API
`/api/spese/opencivitas-2015`, dataset MCP `opencivitas_fabbisogni_2015`.
Nessuna UI in questa tranche.

## Identità e acquisizione

La [scheda ufficiale](https://www.opencivitas.it/it/dataset/2015-comuni-servizi-totali-indicatori-e-determinanti)
dichiara periodo 2015, pubblicazione e ultima modifica 23 maggio 2019, **versione 2**
con motivazione «Nuova fornitura derivante dall'aggiornamento della spesa storica»,
licenza CC BY 4.0 (badge della scheda), autore ed editore SOSE, **titolare dei diritti
il Dipartimento delle Finanze** e frequenza di aggiornamento irregolare.

Il titolare cambia rispetto agli anni dal 2017 in poi, dove è la Ragioneria Generale
dello Stato: il valore resta quello dichiarato dalla scheda, senza uniformarlo. Il link
CC BY 3.0 IT presente in pagina riguarda i «Dati esterni — Fonte Open Data Istat», non
il dataset.

Acquisizione e verifica: 16 settembre 2026, TLS verificato.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [CSV indicatori](https://docs.opencivitas.it/Ind_FC20TOT_2_csv.zip) | 4.609.719 | `9dffeca1c95eaaabb7387a22d9157086eff85b141aa4620f2439c7dbe355b23c` |
| [Metadati indicatori](https://docs.opencivitas.it/Metadati_Ind_FC20TOT_2_xlsx.zip) | 8.454 | `eef1ea5855f7f3e6f7b814ca1d3dbb0c8d4331fe503eb7297e7888c46eeb68ad` |
| [Metadati enti](https://docs.opencivitas.it/Metadati_Enti_2015_2_xlsx.zip) | 312.672 | `e7115b7de20b55c6d07d1e1e01f95ca1c70c6931944570714244ad9e54e3d0a1` |

Il CSV 2015 è l'unico della serie senza prefisso d'anno nel nome del file.

## Tre differenze rispetto agli anni già integrati

### 1. Codifica cp1252, non UTF-8

L'unico byte non ASCII è `0xE0` (la «à» di «Viabilità»), presente in 679 righe del
campo `SERV_NO_VALUT_OUT_TOT`; su quel byte cp1252 e latin-1 coincidono, quindi la
decodifica è univoca. La codifica è **dichiarata nel lock per rilascio**: `load_raw_data`
la riceve come parametro e non tenta alcun ripiego da UTF-8. Un test verifica che
leggere il CSV come UTF-8 fallisca invece di degradare in silenzio.

### 2. Punto decimale, non virgola

I valori sono del tipo `12024382.302` e `604.36179642`: nessun separatore delle
migliaia, nessun valore con più di un punto. Anche il separatore è dichiarato nel lock
e `decimal_value` applica la regex stretta corrispondente: la virgola degli anni
recenti viene rifiutata su questo rilascio, e il punto viene rifiutato sugli altri.

### 3. Fabbisogno standard riproporzionato sul totale della spesa storica

Sui 6.664 Comuni RSO le due somme distano **0,52 €** sui valori pubblicati e **2,59 €**
dopo l'arrotondamento al centesimo di ogni Comune, su 33,5 miliardi; l'aggregato
`ZZ999ITA001` pubblicato dalla fonte è identico all'euro. La differenza nazionale è
quindi **nulla per costruzione** e non è un risultato.

Vale anche per il 2022, mentre dal 2017 al 2021 lo standard supera la storica di circa
il 2%:

| Anno | Famiglia | Comuni | Spesa storica | Fabbisogno standard | Standard vs storica |
| --- | --- | ---: | ---: | ---: | ---: |
| 2015 | FC20TOT v2 | 6.664 | 33,544 Mld€ | 33,544 Mld€ | 0,000% |
| 2016 | FC30TOT v1 | 6.647 | 33,207 Mld€ | 33,207 Mld€ | 0,000% |
| 2017 | FC40TOT v1 | 6.627 | 33,521 Mld€ | 34,179 Mld€ | +1,962% |
| 2018 | FC50TOT v1 | 6.606 | 34,221 Mld€ | 34,878 Mld€ | +1,922% |
| 2019 | FC60TOT v2 | 6.567 | 34,883 Mld€ | 35,541 Mld€ | +1,885% |
| 2021 | FC70TOT v1 | 6.565 | 37,112 Mld€ | 37,769 Mld€ | +1,772% |
| 2022 | FC80TOT v2 | 6.557 | 38,795 Mld€ | 38,795 Mld€ | 0,000% |

I totali per regione invece differiscono, da −10,65% (Abruzzo) a +11,30% (Liguria):
è il riproporzionamento nazionale a essere vincolato, non quello territoriale.
L'invariante è scritta nella spec e verificata dall'ETL: se un rilascio futuro
smettesse di riproporzionare, il bundle si blocca invece di pubblicare una differenza
aggregata che sembrerebbe un dato.

## Perimetro pubblicato

6.664 Comuni delle 15 Regioni a statuto ordinario. Le 30 entità senza anagrafica sono
esattamente gli aggregati `ZZ999…` (Italia, ripartizioni, regioni, fasce) già esclusi
dagli altri anni. I metadati indicatori contengono 25 definizioni e i nove indicatori
pubblicati da DVNS hanno descrizione, funzione `TOTALE`, lingua `IT` e tipo `FS`/`LQP`
identici a quelli verificati sul 2017.

Nessuna anomalia e nessun flag privacy sui nove indicatori, nessun codice ISTAT
duplicato. Il livello di spesa è assente per 31 Comuni e quello dei servizi per 49:
corrispondono ai motivi di non valutabilità pubblicati dalla fonte (`cod_sps_noval`,
`cod_no_quest`, `cod_out_noval`, `cod_out_noval_nospesa`) e restano distinti dallo zero.

## Significato e limiti

La differenza fra spesa storica e spesa standard non è spreco; i livelli 0–10 della
fonte non sono un ranking di efficienza; gli euro per abitante sono quelli pubblicati,
senza popolazioni ricostruite. Le annualità restano separate: FC20TOT 2015, FC30TOT
2016, FC40TOT 2017, FC50TOT 2018, FC60TOT 2019, FC70TOT 2021 e FC80TOT 2022 non si
sommano né si confrontano in silenzio, e il 2020 non viene ricostruito perché la fonte
non pubblica servizi totali per quell'anno.

## Percorso tecnico

```bash
python scripts/etl/opencivitas_2015_snapshot.py --input-dir /percorso/degli/zip-ufficiali
python scripts/etl/opencivitas_2015_snapshot.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python -m unittest discover -s tests/etl -p 'test_opencivitas_2015_snapshot.py'
node --experimental-strip-types --test tests/opencivitas-2015-contract.test.mjs tests/opencivitas-2015-route.test.mjs
```
