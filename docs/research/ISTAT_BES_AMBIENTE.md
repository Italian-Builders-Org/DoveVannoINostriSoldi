# BesT Ambiente — edizione 2025

Refs #281 / #525. Dominio BesT Ambiente: fonte `istat-bes-ambiente`, API
`/api/territori/bes-ambiente`, dataset MCP `istat_bes_ambiente`. Nessuna UI.

## Acquisizione (2026-09-16)

| Asset | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_10,1.0/A..BES_10..T.2025) | 1.438.056 | `c84d70c0b40b0a7be099cdbea3e857d7bbc4c6da6f185fad01a528abba8bacec` |
| [Structure](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_10/1.0?references=all) | 13.319.259 | `049de92a0654495694f9ca2bf1c5b6841378258e3ca447877e8ec0a1d6c7b8bd` |

Licenza payload `not-declared`. Solo `SEX=T`. Scale factor **100** (centesimi).

## Perimetro

13.423 osservazioni, undici indicatori, 139 territori (111 province). 412 celle
null (`g`). Indicatori: PM10/PM2.5, perdite idriche, verde urbano, frane,
alluvioni, aree protette, rinnovabili, raccolta differenziata, impermeabilizzazione,
rifiuti. Per `10AMB018P` il CSV lascia vuoti `UNIT_MEAS` e note: non inventati.
Non è spesa pubblica; non sommabili.
