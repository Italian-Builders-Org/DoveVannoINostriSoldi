# BesT Lavoro e conciliazione dei tempi di vita — edizione 2025

Refs #281. Quarto dominio BesT integrato: fonte `istat-bes-lavoro`, API
`/api/territori/bes-lavoro`, dataset MCP `istat_bes_lavoro`. Nessuna UI in
questa tranche.

## Identità e acquisizione

Il catalogo SDMX ufficiale identifica `IT1,DF_BES_TERRIT_3,1.0` come “Lavoro
e conciliazione dei tempi di vita”, con DSD `BES_TERRIT` 1.1, frequenza annuale
e ultimo aggiornamento del dataflow `2025-06-30T15:22:06.201Z`. La pagina
[Bes dei territori edizione 2025](https://www.istat.it/notizia/bes-dei-territori-edizione-2025/)
indica il 1 luglio 2025 come data di pubblicazione e il 2024 come periodo di
riferimento dell'aggiornamento; ogni indicatore conserva comunque il proprio
intervallo effettivo.

Acquisizione e verifica: 12 settembre 2026.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_3,1.0/A..BES_03.03LAV001-N22+03LAV002-N22+03LAV003P-N22+03LAV004P+03LAV006P-N22+03LAV007.F+M+T.2025) | 2.194.924 | `b44db9455f6b49b6b27856e2cfc4e68fbaccfcc5d94e29875f7a02e3da151c0f` |
| [Struttura e codelist](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_3/1.0?references=all) | 13.319.297 | `0496adb473f213a11560da1d4f707729319bcfc1eace7ea68e06b0afb243a5da` |

L'acquisizione del primo asset usa content negotiation `Accept: text/csv`;
senza questo header lo stesso endpoint restituisce SDMX-ML.

La risposta SDMX non dichiara una licenza: il source lock usa
`not-declared`. Le pagine generali ISTAT [Open Data](https://www.istat.it/dati/open-data/)
e [Note legali](https://www.istat.it/note-legali/) dichiarano CC BY 4.0 per i
dati e contenuti ISTAT; questa evidenza resta distinta e non viene promossa a
licenza incorporata nello specifico payload SDMX.

## Perimetro pubblicato

Il payload contiene 19.120 osservazioni, sei indicatori e 135 territori, di cui
107 province o città metropolitane. I valori sono decimi esatti dell'unità:

| Indicatore | Unità | Periodo | Osservazioni |
| --- | --- | --- | ---: |
| `03LAV001-N22` tasso di occupazione 20–64 anni | percentuale | 2018–2024 | 2.458 |
| `03LAV002-N22` tasso di mancata partecipazione 15–74 anni | percentuale | 2018–2024 | 2.767 |
| `03LAV003P-N22` tasso di occupazione 15–29 anni | percentuale | 2018–2024 | 2.767 |
| `03LAV004P` giornate retribuite nell'anno | percentuale delle 312 teoriche | 2008–2023 | 6.339 |
| `03LAV006P-N22` mancata partecipazione 15–29 anni | percentuale | 2018–2024 | 2.765 |
| `03LAV007` infortuni mortali o con inabilità permanente | per 10.000 occupati | 2018–2022 | 2.024 |

Tutti gli indicatori espongono `F`, `M` e `T`, ma la copertura territoriale per
anno e sesso non è uniforme. Le 122 celle senza valore hanno esclusivamente il
flag `g` e appartengono alle giornate retribuite; restano nulle e distinte da
zero osservato e da una riga assente. Il payload acquisito non contiene zeri,
ma il contratto accetta lo zero osservato.

`ITCD` e `ITFG` sono aggregati compositi sovrapposti alle proprie parti.
Bolzano e Trento mantengono i padri `ITD1` e `ITD2` esterni alla fetta; le
province storiche presenti nella codelist restano identità distinte. Nessun
totale geografico o per sesso viene ricostruito.

## Significato e limiti

Sono tassi con denominatori diversi, non importi o spesa pubblica. Il tasso di
occupazione, la mancata partecipazione, le giornate INPS e gli infortuni INAIL
non si sommano e non formano un indice composito. I dati non misurano qualità o
efficienza amministrativa, causalità politica, regolarità del lavoro o sicurezza
di una singola impresa. La geografia è provinciale, non comunale, e cambia nel
tempo. La serie BesT edizione 2025 non va concatenata automaticamente con
indicatori omonimi di edizioni o classificazioni precedenti.

## Percorso tecnico

Si riusa il confine tipizzato già adottato dagli altri domini BesT: source lock
con byte e hash, ETL offline fail-closed, artefatti canonici, contratto runtime,
un solo selettore condiviso da API e MCP, registro degli artefatti e source
health. Schema, codelist, copertura, flag, unità, periodo e provenienza restano
specifici di BES_03; nessuna regola del benessere economico viene trasferita.

```bash
python3 scripts/etl/istat_bes_lavoro.py --input /tmp/best-lavoro.csv --structure /tmp/best-lavoro-structure.xml --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/istat_bes_lavoro.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_istat_bes_lavoro.py'
```
