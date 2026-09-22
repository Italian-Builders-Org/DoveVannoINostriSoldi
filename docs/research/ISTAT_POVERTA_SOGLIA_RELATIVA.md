# ISTAT · soglia di povertà relativa (34_727_DF_DCCV_POVERTA_11)

Fonte tipizzata `istat-poverta-soglia-relativa`, API
`/api/territori/poverta-soglia-relativa`, dataset MCP
`istat_poverta_soglia_relativa`, sezione di contesto su `/poverta`.

## Acquisizione (2026-09-21)

| Asset | Byte | SHA-256 |
| --- | ---: | --- |
| [SDMX-CSV](https://esploradati.istat.it/SDMXWS/rest/data/IT1,34_727_DF_DCCV_POVERTA_11,1.0/A.IT.SOGLIA_POVREL.ALL.N1+N2+N3+N4+N5+N6+N7_GE.HH.TOTAL.99.ALL.9.TOTAL) | 9.424 | `2ccc07c4de9e82d85bd2e8ce9be26335c12c25a16df224849b093c9301a1a222` |
| [Structure](https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/34_727_DF_DCCV_POVERTA_11/1.0?references=all) | 9.898.373 | `1bc97d259dc91e7b928eedb32d443109b9374caea98ba9c26669468dad1a6b25` |

`dataflowLastUpdate` dalla structure: `2025-10-14T08:02:20.381Z`.
Licenza payload `not-declared`. Scale factor **100** (centesimi di euro).
`UNIT_MEAS` vuoto nel CSV.

## Perimetro

77 osservazioni nella fonte (7 ampiezze × 11 anni); **70 pubblicate**.
`DATA_TYPE=SOGLIA_POVREL`, solo `REF_AREA=IT`, ampiezze `N1`…`N6` e `N7_GE`.
`TOT` e `FAM_VAL_PERC_POV` fuori perimetro (#329).

## Esclusione del 2021

I valori 2021 sono circa 2,6× quelli del 2020 e circa 2,2× quelli del 2022.
La soglia relativa non può variare così: decisione #329 opzione (a) — pubblicare
con buco dichiarato. Il lock fallisce se il 2021 sparisce dalla fonte o se
l'anomalia N1 scompare.

## Limiti

- Non è spesa pubblica; non confrontabile/sommabile con le incidenze 34_727.
- Soglia relativa ≠ assoluta (34_211): solo Italia vs regioni; nessuna riga
  confrontabile.
- Non inventare gap rispetto ai dataset di incidenza.
