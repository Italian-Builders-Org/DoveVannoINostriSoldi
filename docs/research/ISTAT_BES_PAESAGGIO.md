# BesT Paesaggio e patrimonio culturale — edizione 2025

Refs #281 / #523. Dominio BesT Paesaggio: fonte `istat-bes-paesaggio`, API
`/api/territori/bes-paesaggio`, dataset MCP `istat_bes_paesaggio`. Nessuna UI.

Nota: `DF_BES_TERRIT_8` non esiste nel catalogo ufficiale IstatData; questa fetta
usa `DF_BES_TERRIT_9` / `BES_09`.

## Acquisizione (2026-09-16)

| Asset | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_9,1.0/A..BES_09..T.2025) | 409.062 | `f3b7748112e3af0018b02344011dad0f28e3988f5e23bfa3fb5c181429e047f5` |
| [Structure](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_9/1.0?references=all) | 13.319.299 | `c3c3184df4e204843404f0f9104ecc8b3836a3eead50446c3caf614b9902844a` |

Licenza payload `not-declared`. Solo `SEX=T`. Scale factor **100** (centesimi)
perché `09PAE002` pubblica due decimali.

## Perimetro

3.760 osservazioni, tre indicatori, 139 territori (111 province). Tre celle null
(`n`/`g`). Indicatori: densità patrimonio museale, agriturismi, verde storico.
Non è spesa pubblica; non sommabili.
