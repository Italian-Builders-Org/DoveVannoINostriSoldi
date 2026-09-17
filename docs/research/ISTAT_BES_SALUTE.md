# Bes dei territori — Salute

Secondo dominio della [issue #281](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/281),
separato dal dominio economico della PR #310. Il
[lock pubblicato prima del codice](https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi/issues/281#issuecomment-5578156544)
fissa `IT1,DF_BES_TERRIT_1,1.0`, DSD `BES_TERRIT` 1.1, frequenza annuale,
dominio `BES_01`, edizione 2025. Gli altri domini e una nuova UI restano fuori
da questa fetta; l'epica non viene chiusa.

## Fonte e acquisizione

Acquisizione e verifica: **8 settembre 2026**. La data di pubblicazione non è
dichiarata nella risposta: resta `null`, distinta dall'edizione 2025.

| Asset ufficiale | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_1,1.0/A..BES_01.01SAL001+01SAL004+01SAL005+01SAL006+01SAL007+01SAL020.F+M+T.2025) | 5.173.261 | `4c7a6de5c5b553a801f00391ef37f53164d847b8c6b7bad3365622c685d2f508` |
| [Struttura e codelist](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_1/1.0?references=all) | 13.319.248 | `3c86c4b4749eae51b3a527e1ad41b503fac022169c3f2717f6899efdbe7708fa` |

Il CSV si acquisisce con `Accept: application/vnd.sdmx.data+csv;version=1.0.0`.
La query del dominio senza selezione di indicatori, sesso ed edizione ha
restituito gli stessi byte: i sei indicatori costituiscono il dominio completo
disponibile in questa acquisizione. Licenza `not-declared`: nessuna licenza
inferita da altri dataset ISTAT. La struttura vincolata conserva la prova delle
definizioni; il lock ne pubblica la proiezione italiana pertinente.

## Indicatori e denominatori

| Codice | Indicatore | Unità | Periodo | Osservazioni |
| --- | --- | --- | --- | ---: |
| `01SAL001` | Speranza di vita alla nascita | Numero medio di anni | 2004–2024 | 8.306 |
| `01SAL004` | Mortalità infantile | Per 1.000 nati vivi residenti | 2004–2022 | 7.473 |
| `01SAL005` | Mortalità per incidenti stradali, 15–34 anni | Tasso standardizzato per 10.000 residenti | 2004–2023 | 7.930 |
| `01SAL006` | Mortalità per tumore, 20–64 anni | Tasso standardizzato per 10.000 residenti | 2004–2022 | 7.659 |
| `01SAL007` | Mortalità per demenze e malattie del sistema nervoso, 65 anni e più | Tasso standardizzato per 10.000 residenti | 2004–2022 | 7.376 |
| `01SAL020` | Mortalità evitabile, 0–74 anni | Tasso standardizzato per 10.000 residenti | 2004–2022 | 7.413 |

Ogni indicatore conserva etichetta, definizione, fonte specifica, codice e
descrizione dell'unità, periodo e conteggio delle celle per sesso/anno.
I tassi standardizzati usano la popolazione europea 2013 nelle classi di età
indicate dalla fonte. Non sono conteggi e non sono percentuali. I valori in
`valueTenths` sono interi esatti: dividere per 10 nell'unità dell'indicatore.

La descrizione inglese della mortalità infantile contiene «10.000», ma
`UNIT_MEAS=PER_1THOU_LBIRTHS`, la codelist bilingue `CL_BES_UNIT_MEASURE` e la
descrizione italiana `CL_BES_INDICATOR_NOTE` concordano su **1.000 nati vivi**.
La discordanza è dichiarata nei caveat: nessuna conversione dei valori.

## Geografia, sesso e disponibilità

Le 46.157 osservazioni riguardano 135 territori complessivi: Italia,
5 ripartizioni, 2 compositi, 20 regioni e 107 province. Profondità e parentela
provengono da `CL_ITTER107` e dai suoi `Parent`, non dalla lunghezza dei codici.
`ITCD` Nord e `ITFG` Mezzogiorno sono tipizzati come compositi con parti esplicite.
Bolzano e Trento mantengono i padri `ITD1`/`ITD2` esterni al dominio; non si
inventa un raccordo con `ITDA`.

Sono assenti `ITG29`, `ITG2A`, `ITG2B`, `ITG2C`, presenti nel dominio economico.
Le 107 province non costituiscono una griglia costante per ogni anno e
indicatore. Nessun dato provinciale è presentato come comunale; nessuna somma,
imputazione, graduatoria o indice composito viene prodotto.

F, M e T sono osservazioni distinte. Non si ricostruisce T sommando o mediando
F/M e non si applica automaticamente il controllo economico «T fra F e M» a
speranza di vita o tassi standardizzati. L'ETL verifica unicità, copertura,
unità, edizione, significato delle celle e integrità, senza fingere una
riconciliazione additiva.

Una sola cella ha `OBS_STATUS=n` di `CL_FLAG`: `01SAL005 / ITC45 / F / 2021`.
Significa dato statisticamente non significativo, non privacy: `valueTenths`
resta `null` e `status` resta `n`. Zero osservato conserva valore `0` e status
`null`. Una combinazione non pubblicata non genera una riga, nemmeno nulla.

L'asse soldi è **assente**: esiti sanitari e demografici, non spesa pubblica,
LEA, efficienza amministrativa o causalità politica.

## Percorso applicativo

Si estende il percorso BesT tipizzato esistente: identità di dominio, unità
eterogenee, celle con significato statistico e gerarchia con compositi/padri
esterni formano un contratto unico. Non si crea un JSON di pagina o un secondo
ID nel corpus integrato. Questa fetta non cambia le righe o le prove del corpus;
eventuali futuri lettori del corpus continuano a passare da
`integrated-public-view.ts`.

L'ETL Salute condivide con l'ETL economico soltanto le primitive di
serializzazione canonica e SHA-256. Parser, unità, flag e riconciliazione sono
dedicati. Il contratto runtime valida hash del lock, byte/hash dell'artefatto,
metadati completi e copertura. Nessun client importa osservazioni raw.

- Fonte: `istat-bes-salute`.
- API: `/api/territori/bes-salute?territorio=IT&anno=2022`.
- MCP: `istat_bes_salute`, filtri `territory`, `year`, `measure`, `sex`,
  `limit`, `offset`. API e MCP restituiscono al massimo 100 osservazioni per
  pagina, con totale, conteggio restituito e `nextOffset` espliciti. L'ordine è
  per chiave dell'osservazione, non per valore o ranking.
- Un solo selettore per API/MCP; almeno un filtro obbligatorio. Parametri API
  sconosciuti o ripetuti falliscono. Un anno valido ma assente per l'indicatore
  restituisce zero righe e conserva il periodo ufficiale nei metadati.

## Rigenerazione e verifiche

Input ufficiali esterni al repository, con byte/hash identici al lock:

```sh
python3 scripts/etl/istat_bes_salute.py --input /percorso/salute.csv --structure /percorso/structure.xml --write
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 scripts/etl/istat_bes_salute.py --check
DVNS_OFFLINE_GUARD=1 PYTHONPATH=scripts/etl:scripts/ci python3 -m unittest discover -s tests/etl -p 'test_istat_bes_salute.py'
node --experimental-strip-types --test tests/istat-bes-salute.test.mjs
```

`scripts/mcp_http_smoke.mjs`, eseguito dal runner di produzione, confronta API
e MCP reali sulla cella non significativa e rifiuta un indicatore economico
nel dominio Salute. I test offline non sono una prova del trasporto HTTP.
