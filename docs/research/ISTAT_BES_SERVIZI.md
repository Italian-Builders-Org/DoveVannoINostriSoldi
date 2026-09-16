# BesT Qualità dei servizi — edizione 2025

Refs #281 / #526. Dominio BesT Qualità dei servizi: fonte `istat-bes-servizi`,
API `/api/territori/bes-servizi`, dataset MCP `istat_bes_servizi`. Nessuna UI.

## Acquisizione (2026-09-16)

| Asset | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,DF_BES_TERRIT_12,1.0/A..BES_12..T.2025) | 1.765.495 | `3c5104f7a4f61407ede4c7bc17afe42e49bce5f23f7ab8dd71c1714388749003` |
| [Structure](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/DF_BES_TERRIT_12/1.0?references=all) | 13.319.281 | `07effbc5aaaf16ff8b7735db7b4ee4d6428b53e1db5f93cb0c6424377d838b67` |

Licenza payload `not-declared`. Solo `SEX=T`. Scale factor **10** (decimi).

## Perimetro

15.858 osservazioni, otto indicatori, 139 territori (111 province). Settantasei
celle null (`n`/`g`). Indicatori: medici specialisti, posti letto, irregolarità
elettriche, TPL, banda ultra-veloce, raccolta differenziata, emigrazione
ospedaliera. Non è spesa pubblica; non sommabili.
