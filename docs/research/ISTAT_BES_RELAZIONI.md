# BesT Relazioni sociali — edizione 2025

Refs #281. Dominio BesT Relazioni sociali: fonte `istat-bes-relazioni`, API
`/api/territori/bes-relazioni`, dataset MCP `istat_bes_relazioni`. Nessuna UI in
questa tranche.

## Identità e acquisizione

Il catalogo SDMX ufficiale identifica `IT1,DF_BES_TERRIT_5,1.0` come “Relazioni
sociali”, con DSD `BES_TERRIT` 1.1, frequenza annuale e ultimo aggiornamento del
dataflow `2025-06-30T15:22:06.201Z`. La pagina
[Bes dei territori edizione 2025](https://www.istat.it/notizia/bes-dei-territori-edizione-2025/)
indica il 1 luglio 2025 come data di pubblicazione; ogni indicatore conserva
comunque il proprio intervallo effettivo.

Acquisizione e verifica: 13 settembre 2026.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_5,1.0/A..BES_05..F+M+T.2025) | 149.423 | `f9820b41179e7466b4ca2e87b63432669d3ef456c12589cc077f12b4d86cd2a8` |
| [Struttura e codelist](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_5/1.0?references=all) | 13.319.271 | `36abf6e0326ac2a36e0abcbc315626f950ac2ad3723a7cdc9e9a02e5efe2a277` |

L'acquisizione del primo asset usa content negotiation `Accept: text/csv`;
senza questo header lo stesso endpoint restituisce SDMX-ML. La query chiede
`F+M+T`, ma il payload restituito contiene soltanto `SEX=T`: le serie F/M non
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

Il payload contiene 1.330 osservazioni, due indicatori e 135 territori, di cui
107 province o città metropolitane. I valori sono decimi esatti dell'unità:

| Indicatore | Unità | Periodo | Osservazioni |
| --- | --- | --- | ---: |
| `05REL007P` scuole accessibili | percentuale | 2024 | 135 |
| `05REL008` organizzazioni non profit | per 10.000 abitanti | 2011–2022 | 1.195 |

`05REL008` non pubblica 2012–2014; nel 2016 la copertura territoriale è
incompleta (115 territori). Le 8 celle senza valore hanno esclusivamente il
flag `n` e appartengono a `05REL007P` 2024; restano nulle e distinte da zero
osservato e da una riga assente. Il payload acquisito non contiene zeri, ma il
contratto accetta lo zero osservato.

`ITCD` e `ITFG` sono aggregati compositi sovrapposti alle proprie parti.
Bolzano e Trento mantengono i padri `ITD1` e `ITD2` esterni alla fetta. Nessun
totale geografico o per sesso viene ricostruito.

## Significato e limiti

Sono indicatori con unità e denominatori diversi, non importi o spesa pubblica.
La percentuale di scuole accessibili e le organizzazioni non profit per 10.000
abitanti non si sommano e non formano un indice composito. I dati non misurano
qualità o efficienza amministrativa, inclusione scolastica complessiva,
volontariato individuale, causalità politica o regolarità. La geografia è
provinciale, non comunale, e cambia nel tempo. La serie BesT edizione 2025 non
va concatenata automaticamente con indicatori omonimi di edizioni o
classificazioni precedenti.

## Percorso tecnico

Si riusa il confine tipizzato già adottato dagli altri domini BesT: source lock
con byte e hash, ETL offline fail-closed, artefatti canonici, contratto runtime,
un solo selettore condiviso da API e MCP, registro degli artefatti e source
health. Schema, codelist, copertura, flag, unità, periodo e provenienza restano
specifici di BES_05; nessuna regola di altri domini viene trasferita.

```bash
python3 scripts/etl/istat_bes_relazioni.py --input /tmp/best-relazioni.csv --structure /tmp/best-relazioni-structure.xml --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/istat_bes_relazioni.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_istat_bes_relazioni.py'
```
