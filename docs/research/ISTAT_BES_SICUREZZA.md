# BesT Sicurezza — edizione 2025

Refs #281 / #521. Dominio BesT Sicurezza: fonte `istat-bes-sicurezza`, API
`/api/territori/bes-sicurezza`, dataset MCP `istat_bes_sicurezza`. Nessuna UI in
questa tranche.

## Identità e acquisizione

Il catalogo SDMX ufficiale identifica `IT1,DF_BES_TERRIT_7,1.0` come “Sicurezza”,
con DSD `BES_TERRIT` 1.1, frequenza annuale e ultimo aggiornamento del dataflow
`2025-06-30T15:22:06.201Z`. La pagina
[Bes dei territori edizione 2025](https://www.istat.it/notizia/bes-dei-territori-edizione-2025/)
indica il 1 luglio 2025 come data di pubblicazione; ogni indicatore conserva
comunque il proprio intervallo effettivo.

Acquisizione e verifica: 16 settembre 2026.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_7,1.0/A..BES_07..T.2025) | 1.661.976 | `2e3d3b9313db9d10030a6ba748fdfe462a795b12baf1e97c802a330582e1c280` |
| [Struttura e codelist](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_7/1.0?references=all) | 13.319.250 | `4285fb1d40fd79329d983ed1a9b4fc41cf8ec849341a61a26ff74e3b4a91c3a9` |

L'acquisizione del CSV usa content negotiation `Accept: text/csv`. La chiave
richiede solo `SEX=T`, coerente con il payload restituito: le serie F/M non
vengono inventate.

La risposta SDMX non dichiara una licenza: il source lock usa
`not-declared`. Le pagine generali ISTAT [Open Data](https://www.istat.it/dati/open-data/)
e [Note legali](https://www.istat.it/note-legali/) dichiarano CC BY 4.0; questa
evidenza resta distinta e non viene promossa a licenza incorporata nello
specifico payload SDMX.

## Perimetro pubblicato

Il payload contiene 14.481 osservazioni, sei indicatori e 139 territori, di cui
111 province o città metropolitane. I valori sono decimi esatti dell'unità:

| Indicatore | Unità | Periodo | Osservazioni |
| --- | --- | --- | ---: |
| `07SIC001P` omicidi volontari | per 100.000 abitanti | 2006–2023 | 2.376 |
| `07SIC004P` furti in abitazione | per 100.000 abitanti | 2006–2023 | 2.370 |
| `07SIC005P` borseggi | per 100.000 abitanti | 2006–2023 | 2.342 |
| `07SIC006P` rapine | per 100.000 abitanti | 2006–2023 | 2.390 |
| `07SIC007P` altri delitti mortali | per 100.000 abitanti | 2006–2023 | 2.294 |
| `07SIC008P` mortalità stradale extraurbana | percentuale | 2004–2023 | 2.709 |

Una sola cella ha flag `g` (`07SIC008P` / `ITG2B` / 2013): resta null, distinta
da zero osservato e da una riga assente.

## Significato e limiti

Sono indicatori con unità e denominatori diversi, non importi o spesa pubblica
COFOG GF03. Tassi di delitti per 100.000 abitanti e mortalità stradale
percentuale non si sommano e non formano un indice composito. I dati non
misurano qualità o efficienza delle forze di polizia, causalità politica o
regolarità. La geografia è provinciale, non comunale.

## Percorso tecnico

```bash
python3 scripts/etl/istat_bes_sicurezza.py --input /tmp/best-sicurezza.csv --structure /tmp/best-sicurezza-structure.xml --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/istat_bes_sicurezza.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_istat_bes_sicurezza.py'
```
