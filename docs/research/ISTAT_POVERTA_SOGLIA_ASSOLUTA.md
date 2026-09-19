# ISTAT · soglia di povertà assoluta (34_211)

Fonte tipizzata `istat-poverta-soglia-assoluta`, API
`/api/territori/poverta-soglia-assoluta`, dataset MCP
`istat_poverta_soglia_assoluta`. Nessuna UI dedicata.

## Acquisizione (2026-09-17)

| Asset | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,34_211,1.0/) | 2.799.511 | `b2dc1b9d7159e23833eb034935d7b2ea1c67d2f127c45e1ed3964166f91ad450` |
| [Structure](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/34_211/1.0?references=all) | 9.494.308 | `ead331120fccb1c9e752c2b654eb4ea9f49f5abaa2883783af7ad53e2399a7b4` |

`dataflowLastUpdate` dalla structure: `2025-10-14T08:00:39.239Z`.
Licenza payload `not-declared`. Scale factor **100** (centesimi di euro).
`UNIT_MEAS` vuoto nel CSV: dichiarato nel lock senza inventare un codice SDMX.

## Perimetro

36.078 osservazioni; `DATA_TYPE=SOGLIA_POVASS`, `MEASURE=15` (valori medi),
`FREQ=A`. 30.028 valori e 6.050 celle con `OBS_VALUE` vuoto e `OBS_STATUS`
vuoto → **null ≠ zero**. Anni 2005–2024; fino al 2013 solo ITCD/ITE/ITFG;
dal 2014 le regioni. Tipologie `CL_TIPOLOGIA_FAMILIARE2` e ampiezze da
`CL_ITTER107`.

## Limiti

- Non è spesa pubblica; non confrontabile/sommabile con le incidenze 34_727.
- Soglia assoluta ≠ relativa (34_212 chiusa al 2013, fuori scope).
- Nord e Mezzogiorno sovrappongono parti: non sommare.
- Non inventare gap rispetto ai dataset di incidenza.
