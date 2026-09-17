# BesT Politica e istituzioni — edizione 2025

Refs #281 / #519. Dominio BesT Politica e istituzioni: fonte `istat-bes-politica`,
API `/api/territori/bes-politica`, dataset MCP `istat_bes_politica`. Nessuna UI in
questa tranche.

## Identità e acquisizione

Il catalogo SDMX ufficiale identifica `IT1,DF_BES_TERRIT_6,1.0` come “Politica e
istituzioni”, con DSD `BES_TERRIT` 1.1, frequenza annuale e ultimo aggiornamento
del dataflow `2025-06-30T15:22:06.201Z`. La pagina
[Bes dei territori edizione 2025](https://www.istat.it/notizia/bes-dei-territori-edizione-2025/)
indica il 1 luglio 2025 come data di pubblicazione; ogni indicatore conserva
comunque il proprio intervallo effettivo.

Acquisizione e verifica: 16 settembre 2026.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_6,1.0/A..BES_06..T.2025) | 1.233.613 | `1f6afa9e1462fec222cff2e10e3821e57879f3f00f4c9758752721dd09026b97` |
| [Struttura e codelist](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_6/1.0?references=all) | 13.319.283 | `a34d956cbdc38123271b0d70e18b40cf543ba8c05631cb3ff692e331bb0cfe20` |

L'acquisizione del CSV usa content negotiation `Accept: text/csv`. La chiave
richiede solo `SEX=T`, coerente con il payload restituito: le serie F/M non
vengono inventate.

La struttura SDMX include un ID e un istante di preparazione della risposta.
Il suo hash identifica la cattura originale, non una rappresentazione stabile
dell’endpoint: un nuovo download va verificato e non deve aggiornare il lock
automaticamente. Il checksum del CSV resta verificato prima della proiezione.

La risposta SDMX non dichiara una licenza: il source lock usa
`not-declared`. Le pagine generali ISTAT [Open Data](https://www.istat.it/dati/open-data/)
e [Note legali](https://www.istat.it/note-legali/) dichiarano CC BY 4.0 per i
dati e contenuti ISTAT; questa evidenza resta distinta e non viene promossa a
licenza incorporata nello specifico payload SDMX.

## Perimetro pubblicato

Il payload contiene 15.818 osservazioni, sette indicatori e 139 territori, di cui
111 province o città metropolitane. I valori sono decimi esatti dell'unità
dichiarata nel lock (derivata da `CL_BES_UNIT_MEASURE` e dalle note ufficiali,
perché `UNIT_MEAS` nel CSV è vuoto):

| Indicatore | Unità | Periodo | Osservazioni |
| --- | --- | --- | ---: |
| `06POL001` partecipazione elettorale | `I_VOTERS` | 2004–2024 | 657 |
| `06POL001P` partecipazione elettorale (regionali) | `I_VOTERS_RC` | 2004–2024 | 2.613 |
| `06POL002P` amministratori comunali donne | `I_WOMEL` | 2004–2024 | 2.781 |
| `06POL003P` amministratori comunali < 40 anni | `I_ADMY` | 2004–2024 | 2.784 |
| `06POL007P` capacità di riscossione provinciali | `ASCERT` | 2007–2022 | 2.081 |
| `06POL009P` capacità di riscossione comunali | `ASCERT` | 2007–2022 | 2.149 |
| `06POL012P` affollamento istituti di pena | `I_PRISON` | 2004–2024 | 2.753 |

Le 2.115 celle con `OBS_VALUE` vuoto hanno anche `OBS_STATUS` vuoto: restano
nulle senza flag inventato, distinte da zero osservato e da una riga assente.
`NOTE_DATA_TYPE_*` nel CSV sono vuoti; descrizione e fonte restano nel lock dalla
structure.

`ITCD` e `ITFG` sono aggregati compositi sovrapposti alle proprie parti.
Bolzano e Trento mantengono i padri `ITD1` e `ITD2` esterni alla fetta. Nessun
totale geografico o per sesso viene ricostruito.

## Significato e limiti

Sono indicatori con unità e denominatori diversi, non importi o spesa pubblica.
Partecipazione elettorale, rappresentanza, capacità di riscossione e affollamento
carcerario non si sommano e non formano un indice composito. I dati non misurano
qualità o efficienza amministrativa, causalità politica o regolarità. La
geografia è provinciale, non comunale, e cambia nel tempo. La serie BesT edizione
2025 non va concatenata automaticamente con indicatori omonimi di edizioni o
classificazioni precedenti.

## Percorso tecnico

Si riusa il confine tipizzato già adottato dagli altri domini BesT: source lock
con byte e hash, ETL offline fail-closed, artefatti canonici, contratto runtime,
un solo selettore condiviso da API e MCP, registro degli artefatti e source
health. Schema, codelist, copertura, unità, periodo e provenienza restano
specifici di BES_06; nessuna regola di altri domini viene trasferita.

```bash
python3 scripts/etl/istat_bes_politica.py --input /tmp/best-politica.csv --structure /tmp/best-politica-structure.xml --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/istat_bes_politica.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_istat_bes_politica.py'
```
